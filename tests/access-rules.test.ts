/**
 * Roles (Scott, 20 October 2026): Product Focused sees everything, Commercial
 * only the Reference section, and the Admin section is for admins.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_ROLE, canSee, landingFor, navSectionsFor, normalise } from '../src/lib/access-rules'

const product = normalise({ role: 'product' })
const commercial = normalise({ role: 'commercial' })
const admin = normalise({ role: 'commercial', isAdmin: true })

test('Commercial sees the Reference section and nothing else', () => {
  for (const p of ['/process-docs', '/process-docs/f/x', '/process-docs/a/y', '/docs-raw/y', '/templates', '/workflow', '/data-dictionary/gpc/t']) assert.ok(canSee(commercial, p), p)
  for (const p of ['/', '/objectives', '/projects/1', '/actions', '/decisions', '/series', '/intake', '/changes', '/api/scores', '/api/ask-yaara', '/admin']) assert.ok(!canSee(commercial, p), p)
  assert.equal(landingFor(commercial), '/process-docs')
})

test('a path that only starts like a Reference page is not one', () => {
  assert.ok(!canSee(commercial, '/workflowx'))
  assert.ok(!canSee(commercial, '/templates-secret'))
})

test('Product Focused sees everything but the Admin section', () => {
  for (const p of ['/', '/objectives', '/series/abc', '/process-docs']) assert.ok(canSee(product, p), p)
  assert.ok(!canSee(product, '/admin'))
  assert.equal(landingFor(product), '/')
})

test('an admin sees the Admin section, whatever their role, and may always edit documentation', () => {
  assert.ok(canSee(admin, '/admin'))
  assert.ok(!canSee(admin, '/objectives'), 'still Commercial everywhere else')
  assert.equal(admin.canEditDocs, true)
  assert.ok(navSectionsFor(admin).has('admin'))
})

test('nobody on the list is Commercial, with no extra rights', () => {
  assert.deepEqual(normalise(null), NO_ROLE)
  assert.deepEqual(normalise({ role: 'something else' }).role, 'commercial')
})

test('the nav shows Commercial only Reference, and product everything but Admin', () => {
  assert.deepEqual([...navSectionsFor(commercial)], ['reference'])
  assert.ok(!navSectionsFor(product).has('admin'))
  assert.ok(navSectionsFor(product).has('work'))
})

test('the proxy leaves the embedded database of local development alone', async () => {
  const { usesEmbeddedDb } = await import('../src/lib/access-rules')
  assert.equal(usesEmbeddedDb({ DATABASE_URL: 'pglite:./.data/pcr' }), true)
  assert.equal(usesEmbeddedDb({}), true)
  assert.equal(usesEmbeddedDb({ DATABASE_URL: 'postgres://u:p@host/db' }), false)
  assert.equal(usesEmbeddedDb({ DATABASE_URL: 'postgresql://u:p@host/db' }), false)
})

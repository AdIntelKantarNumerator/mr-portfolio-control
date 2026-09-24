import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { isPublic } from '../src/proxy'

/**
 * Every machine endpoint must be exempt from the BROWSER session gate.
 *
 * Not from authentication — each one checks SYNC_TOKEN itself. But a caller
 * with no Google cookie gets redirected to /signin, which answers 200 with an
 * HTML page, so the failure surfaces at the far end as "unexpected token '<'"
 * rather than as 401. That is a genuinely confusing hour, and it happened:
 * /api/agent/* was added and this list was not.
 *
 * So the list is derived from the filesystem rather than trusted.
 */
const MACHINE_ROUTE_DIRS = ['sync', 'digest', 'webhooks', 'slack', 'agent', 'health']
const apiDir = join(new URL('..', import.meta.url).pathname, 'src/app/api')

test('every machine route directory that exists is exempt from the session gate', () => {
  for (const dir of MACHINE_ROUTE_DIRS) {
    if (!existsSync(join(apiDir, dir))) continue
    assert.ok(
      isPublic(`/api/${dir}/anything`),
      `/api/${dir}/ is not in PUBLIC_PREFIXES, so its callers get redirected to an HTML sign-in page`,
    )
  }
})

test('no route outside api is accidentally exempt', () => {
  for (const name of readdirSync(join(apiDir, '..'), { withFileTypes: true })) {
    if (!name.isDirectory() || name.name.startsWith('(') || name.name.startsWith('api')) continue
    if (name.name === 'signin') continue
    assert.equal(isPublic(`/${name.name}`), false, `/${name.name} should require a session`)
  }
})

test('the app itself still requires a session', () => {
  assert.equal(isPublic('/'), false)
  assert.equal(isPublic('/initiatives'), false)
  assert.equal(isPublic('/sources'), false)
})

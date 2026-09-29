/**
 * Every place the navigation points at is a place.
 *
 * Twice in one week a link shipped to a route that did not exist: the home
 * cards linked to /actions for a day before that page was written, and the
 * nav linked to /objectives through the whole hierarchy rotation. Both are
 * invisible to the typechecker — an href is a string — and both are a 404 for
 * whoever clicks first.
 *
 * So this walks src/app and asserts that each nav href has a page.tsx behind
 * it. It reads the filesystem rather than importing the routes, because the
 * question is "does the file exist", and a test that imports them would pass
 * on a route whose page throws.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The hrefs, read out of the source rather than imported — nav.ts pulls in
 *  .tsx icon components, which node:test cannot load without a JSX loader. */
function navHrefs(): string[] {
  const src = readFileSync('src/components/nav.ts', 'utf8')
  return [...src.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]!)
}

function pageFor(href: string): string {
  return join('src/app', href === '/' ? '' : href, 'page.tsx')
}

test('every nav destination has a page', () => {
  const missing = navHrefs().filter((h) => !existsSync(pageFor(h)))
  assert.deepEqual(missing, [], `these nav links would 404: ${missing.join(', ')}`)
})

test('no two nav items point at the same place', () => {
  const hrefs = navHrefs()
  assert.equal(new Set(hrefs).size, hrefs.length, 'a duplicate href highlights two items at once')
})

test('the rail covers every page a person can reach', () => {
  // The other direction: a page that exists and is in no section is a page
  // nobody finds. Route groups, dynamic segments and the API are excluded —
  // /signin is reached by being signed out, and /intake/new by a button on
  // /intake.
  const top = readdirSync('src/app').filter((d) => {
    if (d.startsWith('(') || d.startsWith('[') || d.startsWith('_')) return false
    if (d === 'api' || d === 'signin') return false
    try {
      return statSync(join('src/app', d)).isDirectory() && existsSync(join('src/app', d, 'page.tsx'))
    } catch {
      return false
    }
  })

  /*
   * Pages deliberately kept out of the rail.
   *
   * This list is the whole value of the exception: an unlinked page is
   * normally an accident, and the only way to tell an accident from a
   * decision is that somebody wrote the decision down. Anything not named
   * here still fails.
   */
  const UNLINKED: Record<string, string> = {
    // Taken out of Reference on request — the page still answers who is
    // committed to two things at once, and nobody was opening it.
    contention: 'People: removed from the rail, kept so the answer is not lost',
  }

  const linked = new Set(navHrefs().map((h) => h.replace(/^\//, '')))
  const orphans = top.filter((d) => !linked.has(d) && !(d in UNLINKED))
  assert.deepEqual(orphans, [], `reachable but not in the rail: ${orphans.join(', ')}`)
})

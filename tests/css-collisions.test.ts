/**
 * No class name in globals.css is also a Tailwind utility.
 *
 * This has now broken the app three times, each time silently and each time
 * looking like something else:
 *
 *   .rail    — the sidebar and a card's milestone rail shared a name, and
 *              cards grew to 1361px with a sticky full-height bar down them.
 *   .grid    — `<table className="grid">` picked up Tailwind's
 *              `display: grid`, so thead and tbody became separate grid items
 *              and sized their columns independently. Every table in the app
 *              had headings standing over the wrong columns, and it read as a
 *              table bug rather than a CSS one.
 *   .fixed   — `<table className="dtable fixed">`, meaning "fixed layout",
 *              got `position: fixed`, and the tables piled up over each other
 *              in the top-left of the viewport.
 *
 * None of it is visible to the typechecker, the linter, or a test that does
 * not render. The cascade is the only place the two definitions meet, and
 * Tailwind's utilities are generated after globals.css, so Tailwind wins.
 *
 * WHY THIS ASKS TAILWIND RATHER THAN CHECKING A LIST
 *
 * A hand-maintained list of utility names is wrong the day Tailwind adds one,
 * and wrong in the direction that lets the bug through. So the test loads the
 * real design system and asks it to generate CSS for each of our class names:
 * anything it can generate is a name we must not use. `.w` and `.right` are
 * ours to keep; `.grid` and `.static` never were.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __unstable__loadDesignSystem } from 'tailwindcss'

const CSS = 'src/app/globals.css'
const TW = 'node_modules/tailwindcss'

/** Every class name globals.css defines a rule for, comments stripped. */
function appClasses(): string[] {
  const raw = readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const names = new Set<string>()
  for (const [, selector] of raw.matchAll(/(^|\})([^{}@]+)\{/g)) {
    for (const [, cls] of selector.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) names.add(cls)
  }
  return [...names].sort()
}

async function tailwind() {
  const read = (p: string) => readFileSync(p, 'utf8')
  return __unstable__loadDesignSystem(read(join(TW, 'index.css')), {
    base: process.cwd(),
    loadStylesheet: async (id: string, base: string) => {
      // `@import 'tailwindcss/theme.css'` and friends, resolved off the
      // installed package rather than through node resolution, which does not
      // reach a bare .css specifier.
      const rel = id.replace(/^tailwindcss\/?/, '') || 'index.css'
      const path = join(TW, rel.endsWith('.css') ? rel : `${rel}.css`)
      return { base, content: read(path), path }
    },
    // Nothing here loads a plugin or a JS config; this exists to satisfy the
    // signature, and is reached only if index.css grows an `@plugin`.
    loadModule: async () => {
      throw new Error('this probe does not load Tailwind plugins')
    },
  })
}

test('no app class name is also a Tailwind utility', async () => {
  const ds = await tailwind()
  const ours = appClasses()
  const clashing = ours.filter((c) => ds.candidatesToCss([c])[0])

  assert.deepEqual(
    clashing,
    [],
    `Tailwind also defines ${clashing.join(', ')} — it is generated after globals.css, so it wins. Rename ours.`,
  )
})

test('the probe can tell a utility from a name of ours', async () => {
  // Guards the guard: if the unstable API changes shape and starts returning
  // nothing for everything, the test above would pass while checking nothing.
  const ds = await tailwind()
  assert.ok(ds.candidatesToCss(['grid'])[0], 'expected Tailwind to define .grid')
  assert.equal(ds.candidatesToCss(['irow'])[0], null, 'expected .irow to be ours alone')
})

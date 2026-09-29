/**
 * globals.css parses.
 *
 * Nothing else checks this. The typechecker does not read CSS, the linter
 * does not read CSS, and the collision test extracts class names with a
 * regex — so a stray brace passes all three and then every page in the app
 * returns 500, because the stylesheet is imported by the root layout.
 *
 * That is exactly what happened: a script that removed dead rules assumed one
 * rule per line, ate the opening line of a rule whose body ran over two, and
 * left the closing brace behind. Full test suite green, typecheck clean, lint
 * clean, app entirely down.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

const CSS = 'src/app/globals.css'

test('globals.css is valid CSS', async () => {
  const text = readFileSync(CSS, 'utf8')
  await assert.doesNotReject(async () => {
    // `from` so a syntax error names the file and line rather than <input>.
    await postcss([]).process(text, { from: CSS })
  })
})

test('every brace in globals.css is closed, and none closes nothing', () => {
  // The parse above catches this too, but this says which line, which is the
  // thing you actually need when it fails.
  const text = readFileSync(CSS, 'utf8')
  let depth = 0
  let line = 1
  for (const ch of text) {
    if (ch === '\n') line++
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      assert.ok(depth >= 0, `stray closing brace at ${CSS}:${line}`)
    }
  }
  assert.equal(depth, 0, `${depth} unclosed rule(s) in ${CSS}`)
})

test('no rule body is left without a selector', () => {
  // The other half of the same accident: had the script eaten the closing
  // brace instead, the braces would still balance and the orphaned
  // declarations would silently join the rule above.
  // Comments out first: they are prose, and this file's prose says things
  // like "width:100% stretched every tick box across its whole row".
  const text = readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const lines = text.split('\n')
  let depth = 0
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim()
    // A declaration ends in a semicolon; a selector ends in a comma or a
    // brace. Without that, `input:not([type='radio']),` opening a multi-line
    // selector list reads as a property called "input".
    if (depth === 0 && /^[-a-z]+\s*:/.test(line) && line.endsWith(';') && !line.startsWith('--')) {
      assert.fail(`${CSS}:${i + 1} is a declaration outside any rule: ${line.slice(0, 60)}`)
    }
    for (const ch of raw) {
      if (ch === '{') depth++
      else if (ch === '}') depth = Math.max(0, depth - 1)
    }
  }
})

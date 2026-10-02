/**
 * The chat panel's Markdown, added 1 October 2026 with the Yaara sidebar.
 *
 * The cases are what her answers actually contain (bold, lists, tables, links
 * to portfolio screens, snake_case table names) and the one thing that must
 * never happen: text in an answer becoming markup or a script link.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInline, parseMarkdown, safeHref } from '../src/lib/markdown-lite'
import { readPage } from '../src/lib/yaara-chat'

test('what her answers contain', async (t) => {
  await t.test('bold, a list and a link to a screen', () => {
    const blocks = parseMarkdown('The **Sports Sponsorship** dataset is partial.\n\n- four tables are empty\n- one has a different grain\n\nSee the [Data Dictionary](https://portfolio.test/data-dictionary).')
    assert.deepEqual(blocks.map((b) => b.t), ['p', 'ul', 'p'])
    assert.deepEqual(blocks[0], { t: 'p', c: [{ t: 'text', v: 'The ' }, { t: 'strong', c: [{ t: 'text', v: 'Sports Sponsorship' }] }, { t: 'text', v: ' dataset is partial.' }] })
    assert.equal((blocks[1] as { items: unknown[] }).items.length, 2)
    const link = (blocks[2] as { c: Array<{ t: string; href?: string }> }).c.find((n) => n.t === 'link')
    assert.equal(link?.href, 'https://portfolio.test/data-dictionary')
  })
  await t.test('a table', () => {
    const [table] = parseMarkdown('| Dataset | Dev |\n|---|---|\n| Sports | Partial |\n| Ratings | Loaded |')
    assert.equal(table!.t, 'table')
    assert.equal((table as { rows: unknown[] }).rows.length, 2)
  })
  await t.test('snake_case table names are not turned into italics', () => {
    assert.deepEqual(parseInline('gpc_detail.sports_sponsorship_entity_detail'), [{ t: 'text', v: 'gpc_detail.sports_sponsorship_entity_detail' }])
  })
  await t.test('numbered lists, and a heading', () => {
    assert.deepEqual(parseMarkdown('## Next\n1. one\n2. two').map((b) => b.t), ['h', 'ol'])
  })
})

test('nothing in an answer becomes markup or a script', async (t) => {
  await t.test('angle brackets stay text', () => {
    assert.deepEqual(parseInline('<script>alert(1)</script>'), [{ t: 'text', v: '<script>alert(1)</script>' }])
  })
  await t.test('only http(s) and paths in this app are followed', () => {
    assert.equal(safeHref('javascript:alert(1)'), null)
    assert.equal(safeHref('//evil.example/x'), null)
    assert.equal(safeHref('/workflow'), '/workflow')
    assert.deepEqual(parseInline('[click](javascript:alert(1))').map((n) => n.t), ['text'])
  })
})

test('the page a panel question comes from', async (t) => {
  await t.test('a path in this app and a short title', () => {
    assert.deepEqual(readPage({ path: '/initiatives/abc?tab=x', title: '  GPC \n · MR Portfolio Control ' }), { path: '/initiatives/abc?tab=x', title: 'GPC · MR Portfolio Control' })
  })
  await t.test('anything else is dropped, because it goes into her prompt', () => {
    assert.equal(readPage({ path: 'https://evil.example/' }), null)
    assert.equal(readPage({ path: '//evil.example/' }), null)
    assert.equal(readPage({ path: '/x"><script>' }), null)
    assert.equal(readPage(null), null)
  })
})

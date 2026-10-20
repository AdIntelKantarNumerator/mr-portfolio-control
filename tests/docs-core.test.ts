/** Process Documentation: an upload looks on the site as it does on Claude (20 October 2026). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { completeDocument, folderPathParts, isWholeDocument, markdownToHtml, nameFromFile, prepareUpload, readableText, snippet, titleOf } from '../src/lib/docs-core'

const FRAGMENT = '<title>Release process</title><style>:root{--bg:#fff}</style><main><h1>Release</h1><p>Ship it.</p></main><script>document.title</script>'

test('a fragment, as Claude writes it, gets the skeleton Claude publishes it in', () => {
  const html = completeDocument(FRAGMENT)
  assert.match(html, /^<!doctype html><html><head><meta charset="utf-8"><meta name="viewport"/)
  assert.match(html, /color-scheme:light/)
  assert.match(html, /body\{margin:0;font:14px/)
  assert.ok(html.includes(FRAGMENT), 'the artifact itself untouched')
})

test('a whole document is left exactly as it is', () => {
  const doc = '<!DOCTYPE html>\n<html lang="en"><head><title>x</title></head><body>y</body></html>'
  assert.equal(completeDocument(doc), doc)
  assert.ok(isWholeDocument('  <html><body></body></html>'))
})

test('the name comes from what was given, then the page title, then the file name', () => {
  assert.equal(prepareUpload({ content: FRAGMENT, fileName: 'x.html', name: 'Given' }).name, 'Given')
  assert.equal(prepareUpload({ content: FRAGMENT, fileName: 'x.html' }).name, 'Release process')
  assert.equal(prepareUpload({ content: '<p>hi</p>', fileName: 'Hotfix-checklist_v2.html' }).name, 'Hotfix checklist v2')
  assert.equal(nameFromFile('notes.md'), 'notes')
})

test('search reads the words on the page, not its scripts or styles', () => {
  const text = readableText(completeDocument(FRAGMENT))
  assert.match(text, /Release Ship it\./)
  assert.ok(!text.includes('document.title') && !text.includes('--bg'))
  assert.equal(snippet('the hotfix branch is cut on Tuesdays', 'branch', 6), '…otfix branch is cu…')
  assert.equal(titleOf('<title> A &amp; B </title>'), 'A & B')
})

test('a Markdown artifact becomes a readable page, its text escaped', () => {
  const html = markdownToHtml('# Steps\n\n1. Cut <branch>\n2. **Tag** it\n\n| a | b |\n|---|---|\n| 1 | 2 |', 'Steps')
  assert.match(html, /<h1>Steps<\/h1>/)
  assert.match(html, /&lt;branch&gt;/)
  assert.match(html, /<table>/)
  assert.ok(prepareUpload({ content: '# Hi', fileName: 'a.md' }).html.includes('<h1>Hi</h1>'))
})

test('a folder path from Claude is split and trimmed', () => {
  assert.deepEqual(folderPathParts(' Guides / Release//Hotfix '), ['Guides', 'Release', 'Hotfix'])
  assert.deepEqual(folderPathParts(''), [])
})

test('a Markdown artifact is named by its first heading', () => {
  assert.equal(prepareUpload({ content: '# Release calendar\n\nEvery other Tuesday.', fileName: 'release-calendar.md' }).name, 'Release calendar')
})

/** Turning item refs in a session summary into links (12 October 2026). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkRefs } from '../src/lib/series'

const hrefs = new Map([['A525', '/actions?focus=A525'], ['D14', '/decisions?focus=D14']])

test('known refs become links; unknown refs and existing links are left alone', () => {
  assert.equal(linkRefs('Build the filters (A525).', hrefs), 'Build the filters ([A525](/actions?focus=A525)).')
  assert.equal(linkRefs('| A525 | Shashank |', hrefs), '| [A525](/actions?focus=A525) | Shashank |')
  assert.equal(linkRefs('See D14 and A9999.', hrefs), 'See [D14](/decisions?focus=D14) and A9999.')
  assert.equal(linkRefs('Already [A525](/x).', hrefs), 'Already [A525](/x).')
  assert.equal(linkRefs('BA525 and A5250x', hrefs), 'BA525 and A5250x')
})

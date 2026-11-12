/**
 * Sample creatives on the Taxonomy Comparison Sankey (Scott, 12 November
 * 2026): what to show for a creative, from its provider's reference to the
 * file. The shapes are the ones that answered on 12 November.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetCandidates } from '../src/lib/creative-assets'

const MD5 = '00061739c75fe347eeb66e16fb513902'

test('an AdClarity image is at /creatives/<md5>.<ext>, with or without the size in the name', () => {
  assert.deepEqual(assetCandidates(`US.${MD5}.jpg`, 'BIS')[0], { url: `https://ads.adclarity.com/creatives/${MD5}.jpg`, kind: 'image' })
  assert.equal(assetCandidates(`US.${MD5}.250.300.0.jpeg`, 'BISSocial')[0]!.url, `https://ads.adclarity.com/creatives/${MD5}.jpeg`)
})

test('an AdClarity video tries _6_video (Digital, CTV) then _video (Social)', () => {
  const c = assetCandidates(`US.${MD5}.720.1280.0.mp4`, 'BIS').map((x) => x.url.split('/').pop())
  assert.deepEqual(c.slice(0, 2), [`${MD5}_6_video.mp4`, `${MD5}_video.mp4`])
  assert.ok(assetCandidates(`US.${MD5}.mp4`, 'BIS').every((x) => x.kind === 'video'))
})

test('an HTML5 or carousel zip shows the screenshot first, an image', () => {
  const c = assetCandidates(`US.${MD5}.682.740.0.zip`, 'BIS')
  assert.deepEqual(c[0], { url: `https://ads.adclarity.com/capturer_creatives/${MD5}.jpeg`, kind: 'image' })
  assert.ok(c.some((x) => x.kind === 'video'), 'a Social carousel can be a video')
})

test("a provider address is used as it is: TROI's are images, PlayOn's and DeepListen's videos", () => {
  assert.deepEqual(assetCandidates('https://s3.us-east-1.amazonaws.com/AdBinariesBucket/Binaries/zzzy%3D', 'TROI'), [
    { url: 'https://s3.us-east-1.amazonaws.com/AdBinariesBucket/Binaries/zzzy%3D', kind: 'image' },
  ])
  assert.equal(assetCandidates('https://s3.amazonaws.com/VideoAdBinariesBucket/Binaries/zzzv%3D', 'PlayOn')[0]!.kind, 'video')
  assert.equal(assetCandidates('https://s3.us-east-2.amazonaws.com/data.prod.deeplisten.tv/posts/safe/x.PA3.mp4', 'DeepListen')[0]!.kind, 'video')
})

test('nothing to go on, nothing to show', () => {
  assert.deepEqual(assetCandidates(null, 'BIS'), [])
  assert.deepEqual(assetCandidates('-2199610931610.PA3.MP4', 'DeepListen'), [])
  assert.deepEqual(assetCandidates('http://insecure.example/x.jpg', 'TROI'), [])
})

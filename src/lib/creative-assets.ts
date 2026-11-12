/**
 * Something to look at for a creative: an image or a video the browser can
 * show as a thumbnail, and an address to open it (Scott, 12 November 2026).
 *
 * Each creative carries its provider's reference to the file, read from
 * bronze.creative_unique_urls by the creative's url hash:
 *
 *   TROI, PlayOn, DeepListen  a public Amazon S3 address - TROI's are JPEG
 *                             images, PlayOn's and DeepListen's MP4 videos.
 *   AdClarity (BIS, BISSocial, AVOD BISCTV)  only a file name,
 *                             "US.<md5>.<h>.<w>.0.<ext>". The address is at
 *                             ads.adclarity.com, keyed by the md5.
 *
 * AdClarity's raw feeds carry the full address for CTV and part of Social,
 * but not Digital, and the global Social feed had 2,137 of 20,000 September
 * US Social creatives (the US feed stopped in October 2025). So the address
 * is built from the file name, in the shapes found on 12 November 2026, and
 * each is checked to exist before it is shown - never a guess on the screen:
 *
 *   jpg, jpeg, png, gif  /creatives/<md5>.<ext>
 *   mp4                  /creatives/<md5>_6_video.mp4 (Digital, CTV), else
 *                        /creatives/<md5>_video.mp4 (Social)
 *   zip (HTML5, carousel) /capturer_creatives/<md5>.jpeg (a screenshot), else
 *                        /creatives/<md5>.jpeg, else /creatives/<md5>_video.mp4
 *
 * 55 of 56 randomly sampled AdClarity creatives, across every media type and
 * format, resolved this way.
 */

export type AssetKind = 'image' | 'video'

export interface Asset {
  url: string
  kind: AssetKind
}

const ADCLARITY = 'https://ads.adclarity.com'
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])

const kindOf = (url: string): AssetKind => (/\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'image')

/** Where to look, best first. A provider address is the only candidate; an AdClarity file name gives several. */
export function assetCandidates(file: string | null | undefined, providerCode: string | null | undefined): Asset[] {
  if (!file) return []
  const f = file.trim()
  if (/^https:\/\//i.test(f)) {
    // PlayOn's and DeepListen's are videos; TROI's (AdBinariesBucket) images, with no extension to say so.
    const video = /\.(mp4|webm|mov)(\?|$)/i.test(f) || /VideoAdBinaries|deeplisten/i.test(f) || providerCode === 'PlayOn' || providerCode === 'DeepListen'
    return [{ url: f, kind: video ? 'video' : 'image' }]
  }
  const m = /^[A-Z]{2}\.([0-9a-f]{32})\.(?:.*\.)?([a-z0-9]+)$/i.exec(f)
  if (!m) return []
  const md5 = m[1]!.toLowerCase()
  const ext = m[2]!.toLowerCase()
  const at = (path: string) => ({ url: `${ADCLARITY}/${path}`, kind: kindOf(path) })
  if (IMAGE.has(ext)) return [at(`creatives/${md5}.${ext}`), at(`creatives/${md5}.jpeg`), at(`creatives/${md5}.jpg`)]
  if (ext === 'mp4') return [at(`creatives/${md5}_6_video.mp4`), at(`creatives/${md5}_video.mp4`), at(`creatives/${md5}.mp4`)]
  if (ext === 'zip') return [at(`capturer_creatives/${md5}.jpeg`), at(`creatives/${md5}.jpeg`), at(`creatives/${md5}_video.mp4`), at(`creatives/${md5}_6_video.mp4`)]
  return [at(`creatives/${md5}.${ext}`)]
}

/** Whether an address answers, without downloading it. */
async function exists(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * The first candidate that exists, or null. Provider addresses are trusted
 * without a check: they are the provider's own, and S3 answered for every one
 * tried. AdClarity's are checked in order, so a creative is shown with the
 * address that works or not at all.
 */
export async function resolveAsset(file: string | null | undefined, providerCode: string | null | undefined, timeoutMs = 6000): Promise<Asset | null> {
  const list = assetCandidates(file, providerCode)
  if (!list.length) return null
  if (/^https:\/\//i.test(file!.trim())) return list[0]!
  for (const c of list) if (await exists(c.url, timeoutMs)) return c
  return null
}

/**
 * The Insights Studio bundle a client moves to, from the platforms it has today: the commercial team's rule (Scott,
 * 24 November 2026, sheet "Legacy platform to Insights Studio: migration paths", from Salesforce entitlements):
 *
 *   MediaRadar Classic (MRC) and Winmo  -> Commercial
 *   360                                 -> Competitive
 *   Magnifier and AdScope               -> Creative
 *
 * A client on several platforms gets every package its platforms map to, except Classic with Magnifier (and no
 * 360), which gets Creative only. Winmo and AdScope are not in Client Evaluation yet, so they never appear here.
 */
import type { Platform } from '../types'

export interface BundleItem {
  key: 'commercial' | 'competitive' | 'creative'
  why: string
}

const WHY: Record<BundleItem['key'], string> = {
  competitive: '360 moves to Competitive (the commercial team’s migration rule).',
  commercial: 'MediaRadar Classic moves to Commercial (the commercial team’s migration rule).',
  creative: 'Magnifier moves to Creative (the commercial team’s migration rule).',
}

export function bundleFor(platforms: Iterable<Platform>): BundleItem[] {
  const has = new Set(platforms)
  // Classic with Magnifier, and no 360: Creative only.
  if (has.has('classic') && has.has('magnifier') && !has.has('360')) return [{ key: 'creative', why: 'MediaRadar Classic with Magnifier moves to Creative only (the commercial team’s migration rule).' }]
  const out: BundleItem[] = []
  if (has.has('classic')) out.push({ key: 'commercial', why: WHY.commercial })
  if (has.has('360')) out.push({ key: 'competitive', why: WHY.competitive })
  if (has.has('magnifier')) out.push({ key: 'creative', why: WHY.creative })
  return out
}

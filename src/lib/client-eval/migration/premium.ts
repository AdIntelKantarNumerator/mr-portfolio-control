import { MEDIA, PREMIUM_MEDIA } from './catalog'
import type { PlanAccount } from './types'

/**
 * Premium media (Social, AVOD, Live Streaming Sports): a client keeps those it has today and does not get the
 * others by default (Scott, 24 November 2026). Said once in the summary, since it is neither a gain nor a loss.
 */
export function premiumNote(accounts: PlanAccount[]): string | null {
  const names = MEDIA.filter((m) => PREMIUM_MEDIA.has(m.id)).map((m) => m.name)
  const kept = new Set(accounts.flatMap((a) => a.coverage.media.filter((m) => m.status === 'premium').map((m) => m.name)))
  const keep = names.filter((n) => kept.has(n))
  const not = names.filter((n) => !kept.has(n))
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]!)
  const rule = `${list(names)} are premium: a client gets them only if it has them today.`
  if (!not.length) return `${rule} They keep all three.`
  return `${rule} ${keep.length ? `They keep ${list(keep)}; ${list(not)} ${not.length === 1 ? 'is' : 'are'} not included.` : `None is included, as they have none of them today.`}`
}

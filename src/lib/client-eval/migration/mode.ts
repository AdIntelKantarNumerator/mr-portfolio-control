import type { Entitlements } from '../types'
import type { AccountType } from './catalog'

/**
 * Agency holding companies (Scott, 24 November 2026): planned account by account, each keeping what it may see
 * today. A user on one brand team must not see another's data ("a Publicis user on Lexus Texas should not see
 * Verizon"), which matters most with Creative Intel. Known by name, with several accounts.
 */
const HOLDING = /\b(publicis|omnicom|omg|horizon media|groupm|group m|wpp|interpublic|ipg|mediabrands|dentsu|havas|spark ?foundry|starcom|zenith|mindshare|wavemaker|essence ?mediacom|mediacom|omd|phd|hearts ?(&|and) ?science|initiative|universal mccann|carat|iprospect|digitas)\b/i

/** How the client's accounts are planned: one per legacy account, one with market workspaces, or the model's split. */
export type PlanMode = 'holding' | 'markets' | 'standard'

const hasMarkets = (a: { ent: Entitlements }) => (a.ent.kind === '360' ? a.ent.filters.some((f) => /market/i.test(f.type) && f.include.length) : a.ent.kind === 'magnifier' ? a.ent.access.some((x) => /market/i.test(x.label)) : false)

export function planMode(client: string, company: string | null, pool: Array<{ type: AccountType; ent: Entitlements }>): { mode: PlanMode; why: string } {
  const agencies = pool.filter((a) => a.type === 'brand_agency')
  if (agencies.length >= 3 && (HOLDING.test(client) || HOLDING.test(company ?? '')))
    return { mode: 'holding', why: `An agency holding company: each of its ${agencies.length} agency accounts becomes its own Insights Studio account and keeps the advertisers and categories it may see today.` }
  const marketed = pool.filter(hasMarkets)
  if (pool.length >= 3 && marketed.length * 2 >= pool.length)
    return { mode: 'markets', why: `${marketed.length} of its ${pool.length} accounts are each limited to a market: one account with every market, and a workspace per market for that market's users.` }
  return { mode: 'standard', why: '' }
}

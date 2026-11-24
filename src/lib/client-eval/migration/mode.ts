import type { Entitlements } from '../types'
import type { AccountType } from './catalog'

/**
 * The big ad agency holding companies and their media networks (Scott, 24 November 2026: "just big ad agencies with
 * many accounts"). The largest agency companies (Ad Age Agency Report 2026; COMvergence's network ranking): Omnicom,
 * which took in Interpublic in November 2025 (OMD, PHD, Hearts & Science, Initiative, UM, Mediabrands, FCB, McCann),
 * Publicis (Zenith, Starcom, Spark Foundry, Digitas), WPP (WPP Media, formerly GroupM: Mindshare, Wavemaker,
 * EssenceMediacom), Dentsu (Carat, iProspect), Havas and Horizon Media. Matched on the client's own name only: a
 * brand whose 360 license group names its agency ("Nissan North America", group "OMD/Nissan") is a brand client.
 */
const AGENCY = /\b(omnicom|omg|interpublic|ipg|publicis|wpp|groupm|group m|dentsu|dentsux|havas|horizon media|omd|phd|hearts ?(&|and) ?science|initiative|universal mccann|mediabrands|zenith|starcom|spark ?foundry|digitas|mindshare|wavemaker|essence ?mediacom|mediacom|carat|iprospect)\b/i

/** Many accounts: below this a big agency's client is planned as one. Three keeps Horizon Media (4 active), which Scott named. */
const MANY = 3

/** How a client's accounts are planned: one with market workspaces, the model's split, or (an account's own plan) on its own. */
export type PlanMode = 'holding' | 'markets' | 'standard'

const hasMarkets = (a: { ent: Entitlements }) => (a.ent.kind === '360' ? a.ent.filters.some((f) => /market/i.test(f.type) && f.include.length) : a.ent.kind === 'magnifier' ? a.ent.access.some((x) => /market/i.test(x.label)) : false)

/** A client plan's mode. Big agencies never reach here: theirs are account plans (isHoldingClient), always 'holding'. */
export function planMode(_client: string, _company: string | null, pool: Array<{ type: AccountType; ent: Entitlements }>): { mode: PlanMode; why: string } {
  const marketed = pool.filter(hasMarkets)
  if (pool.length >= 3 && marketed.length * 2 >= pool.length)
    return { mode: 'markets', why: `${marketed.length} of its ${pool.length} accounts are each limited to a market: one account with every market, and a workspace per market for that market's users.` }
  return { mode: 'standard', why: '' }
}

/**
 * A big ad agency, planned account by account (each from its own row), not as one client: its name names a big
 * agency company or network, it has MANY (three) active accounts or more, and it buys media: no more than a quarter of its
 * accounts are 360 Media Owner (publisher) user sets. Media companies with many accounts, such as NBC or Sinclair,
 * are planned at the client level and will likely be one Insights Studio account (Scott, 24 November 2026).
 */
export function isHoldingClient(name: string, accounts: Array<{ active: boolean; summary: string | null }>): boolean {
  if (!AGENCY.test(name)) return false
  const live = accounts.filter((a) => a.active)
  if (live.length < MANY) return false
  const owners = live.filter((a) => /^media owner/i.test(a.summary ?? '')).length
  return owners * 4 <= live.length
}

/** A plan for one legacy account, not a client: "acct|360:12345". */
export const ACCOUNT_PLAN = 'acct|'
export const accountPlanId = (member: string) => `${ACCOUNT_PLAN}${member}`
export const accountOfPlan = (id: string) => (id.startsWith(ACCOUNT_PLAN) ? id.slice(ACCOUNT_PLAN.length) : null)

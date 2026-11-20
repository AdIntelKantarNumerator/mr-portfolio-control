/**
 * What an Impact Deck says (Scott, 20 November 2026): for a client, one of its
 * accounts, or one person, what changes when they move to Insights Studio
 * (GPC). Per platform they have:
 *
 *   media      today's media entitlement against the media GPC carries in Prod
 *              ClickHouse: what stays, what drops, what is added; TROI's
 *              websites for anyone with digital (media-map.ts).
 *   from → to  their five largest advertisers or categories followed into
 *              GPC, as Taxonomy Comparison follows them (lib/taxonomy-dbx.ts):
 *              360 is VX1, Magnifier VX2. Largest is Aug–Sep 2026 spend.
 *   in GPC     for the advertisers, everything the GPC advertiser spends,
 *              how much of it the legacy taxonomy cannot see today, and by
 *              media - what Insights Studio adds.
 *
 * Which advertisers or categories: the entitlement's own restrictions first
 * (360 FILTER, Magnifier RELs); without any, those picked in the reports used
 * in 2026 (360); then the 360 reporting profiles' lists. Classic has no
 * advertiser or category restrictions and no saved reports, so its slides are
 * media only.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { ceAccounts, ceClients } from '@/db/schema'
import { completeJson } from '@/lib/llm'
export type { SankeyData, SankeyNode } from './deck-sankey'
import { chunks, NAME_FIELDS_SQL, namesSql, q360, safePrefix, SINCE } from '@/lib/import360/source'
import { dbxCategoryFlows, dbxFlows, dbxGpcTotals, dbxVx2AdvertiserIds } from '@/lib/taxonomy-dbx'
import { connectMagnifier, magnifierConfig } from './load-magnifier'
import { currentMedia, mediaChange, TROI_NOTE, type MediaChange } from './media-map'
import { parseRel } from './rel'
import { relNames } from './rel-names'
import { catLabel, sankeyOf, UNKNOWN, type SankeyData } from './deck-sankey'
import { clientPeople } from './store'
import { PLATFORM_LABEL, parseMember, PLATFORMS, type Ent360, type EntClassic, type EntMagnifier, type Platform } from './types'

export type DeckScope = { kind: 'client'; clientId: string } | { kind: 'account'; key: string } | { kind: 'person'; clientId: string; person: string }

export interface FocusEntity {
  id: string
  name: string
  spend: number
  sankey: SankeyData
  /** Where its dollars land: share with a GPC advertiser, top GPC category. */
  facts: string[]
  /** Advertisers only: everything the GPC advertiser spends in GPC. */
  gpc?: { name: string; total: number; unseen: number; byMedia: Array<{ media: string; spend: number }> }
}

export interface PlatformSection {
  platform: Platform
  accounts: Array<{ id: string; name: string }>
  media: MediaChange
  focus: {
    kind: 'advertiser' | 'category' | null
    source: 'entitlement' | 'reports' | 'profiles' | null
    taxonomy: 'VX1' | 'VX2' | null
    entities: FocusEntity[]
    note: string | null
  }
}

export interface DeckData {
  title: string
  subtitle: string
  generated: string
  sections: PlatformSection[]
  highlights: string[]
  notes: string[]
}

type Progress = (step: string, done?: number, total?: number) => Promise<void>
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`)
const CANDIDATES = 40
const TOP = 5

// ------------------------------------------------------------------ who the deck is for

interface Target {
  title: string
  subtitle: string
  /** Accounts per platform; for a person, their user ids on 360. */
  accounts: Map<Platform, string[]>
  usrIds: number[] | null
}

async function resolve(scope: DeckScope): Promise<Target> {
  const accounts = new Map<Platform, string[]>()
  const add = (p: Platform, id: string) => (accounts.get(p) ?? accounts.set(p, []).get(p)!).push(id)
  if (scope.kind === 'account') {
    const m = parseMember(scope.key)
    if (!m) throw new Error('Unknown account.')
    add(m.platform, m.accountId)
    const [a] = await db.select({ name: ceAccounts.name }).from(ceAccounts).where(and(eq(ceAccounts.platform, m.platform), eq(ceAccounts.accountId, m.accountId))).limit(1)
    return { title: a?.name ?? scope.key, subtitle: `${PLATFORM_LABEL[m.platform]} account ${m.accountId}`, accounts, usrIds: null }
  }
  const [c] = await db.select().from(ceClients).where(eq(ceClients.clientId, scope.clientId)).limit(1)
  if (!c) throw new Error('That client is not in the list. It may have changed with a refresh.')
  if (scope.kind === 'client') {
    for (const k of c.members as string[]) {
      const m = parseMember(k)
      if (m) add(m.platform, m.accountId)
    }
    return { title: c.name, subtitle: 'Client', accounts, usrIds: null }
  }
  const people = await clientPeople(db, scope.clientId)
  const p = people?.people.find((x) => x.key === scope.person)
  if (!p) throw new Error('That person is not in this client any more.')
  for (const a of p.accounts) if (!(accounts.get(a.platform) ?? []).includes(a.accountId)) add(a.platform, a.accountId)
  const usrIds = p.accounts.filter((a) => a.platform === '360').map((a) => Number(a.userId))
  return { title: p.name, subtitle: `${p.email ?? ''}${p.email ? ' · ' : ''}${c.name}`, accounts, usrIds }
}

// ------------------------------------------------------------------ which advertisers or categories

interface Candidates {
  kind: 'advertiser' | 'category'
  source: 'entitlement' | 'reports' | 'profiles'
  taxonomy: 'VX1' | 'VX2'
  items: Array<{ id: string; name: string }>
}

/** 360 entity types, and the id dbxFlows / dbxCategoryFlows take for each. */
const ADV_360: Record<number, (id: number) => string> = { 118: (i) => String(i), 102: (i) => `P${i}`, 139: (i) => `B${i}`, 100: (i) => `V${i}` }
const CAT_360 = [103, 135, 104]

async function names360(want: Map<number, Set<number>>): Promise<Map<string, string>> {
  const where = new Map((await q360<{ entmaj_id: number; table_n: string; id_field: string; name_field: string }>(NAME_FIELDS_SQL)).map((f) => [Number(f.entmaj_id), f]))
  const out = new Map<string, string>()
  for (const [e, ids] of want) {
    const f = where.get(e)
    if (!f) continue
    for (const part of chunks([...ids], 2000)) {
      const text = namesSql(f, part)
      if (!text) break
      for (const r of await q360<{ id: number; n: string | null }>(text)) if (r.n) out.set(`${e}:${Number(r.id)}`, String(r.n).trim())
    }
  }
  return out
}

/** Rows of (entity type, id, weight) into 360 candidates: advertisers if any, else categories. */
async function pick360(rows: Array<{ e: number; id: number; w: number }>, source: Candidates['source']): Promise<Candidates | null> {
  const adv = rows.filter((r) => ADV_360[r.e])
  const cat = rows.filter((r) => CAT_360.includes(r.e))
  const use = adv.length ? adv : cat
  if (!use.length) return null
  const top = [...use].sort((a, b) => b.w - a.w).slice(0, CANDIDATES)
  const want = new Map<number, Set<number>>()
  for (const r of top) (want.get(r.e) ?? want.set(r.e, new Set()).get(r.e)!).add(r.id)
  const names = await names360(want)
  return {
    kind: adv.length ? 'advertiser' : 'category',
    source,
    taxonomy: 'VX1',
    items: top.map((r) => ({ id: adv.length ? ADV_360[r.e]!(r.id) : `C${r.id}`, name: names.get(`${r.e}:${r.id}`) ?? `#${r.id}` })),
  }
}

const ints = (xs: Array<string | number>) => xs.map(Number).filter((x) => Number.isInteger(x) && x > 0)

async function candidates360(usrsets: number[], usrIds: number[] | null): Promise<Candidates | null> {
  const types = [...Object.keys(ADV_360).map(Number), ...CAT_360]
  // 1. The entitlement's own restrictions.
  const ent = await q360<{ e: number; id: number }>(
    `SELECT DISTINCT f.entmaj_id AS e, f.master_id AS id FROM iddb_ar.dbo.FILTER f JOIN iddb_ar.dbo.FILTERSET fs ON fs.filterset_id = f.filterset_id
     WHERE fs.active_f = 1 AND f.include_f = 1 AND f.entmaj_id IN (${types.join(',')}) AND fs.usrset_id IN (${usrsets.join(',')})`,
  )
  const fromEnt = await pick360(ent.map((r) => ({ e: Number(r.e), id: Number(r.id), w: 1 })), 'entitlement')
  if (fromEnt) return fromEnt

  // 2. What their reports used in 2026 pick, weighted by how many reports pick it.
  const sets = await q360<{ usrset_id: number; mnemonic_a: string }>(`SELECT usrset_id, mnemonic_a FROM iddb_ar.dbo.USRSET WHERE usrset_id IN (${usrsets.join(',')})`)
  const prefixes = [...new Set(sets.map((s) => String(s.mnemonic_a ?? '').trim()).filter((p) => /^[A-Za-z0-9_]+$/.test(p)))]
  const present = prefixes.length
    ? new Set((await q360<{ name: string }>(`SELECT name FROM sys.tables WHERE name IN (${prefixes.map((p) => `'${safePrefix(p)}_reportset'`).join(',')})`)).map((r) => r.name.toLowerCase()))
    : new Set<string>()
  const counts = new Map<string, { e: number; id: number; w: number }>()
  for (const p of prefixes) {
    if (!present.has(`${p.toLowerCase()}_reportset`)) continue
    const t = safePrefix(p)
    const who = usrIds?.length ? ` AND r.usr_id IN (${usrIds.join(',')})` : ` AND r.usrset_id IN (${usrsets.join(',')})`
    for (const r of await q360<{ e: number; id: number; n: number }>(
      `SELECT b.entmaj_id AS e, b.master_id AS id, COUNT(DISTINCT r.reportset_id) AS n
       FROM [${t}_reportset] r JOIN [${t}_reportdet] d ON d.reportset_id = r.reportset_id JOIN [${t}_bucketdet] b ON b.bucketset_id = d.master_id
       WHERE r.lastused_d >= '${SINCE}' AND d.mpt_id NOT IN (11, 13) AND (ISNULL(b.optmask_id, 0) & 64) = 0 AND ISNULL(b.secondary_id, 0) = 0
         AND b.entmaj_id IN (${types.join(',')})${who}
       GROUP BY b.entmaj_id, b.master_id`,
    )) {
      const k = `${r.e}:${r.id}`
      const x = counts.get(k) ?? counts.set(k, { e: Number(r.e), id: Number(r.id), w: 0 }).get(k)!
      x.w += Number(r.n)
    }
  }
  const fromReports = await pick360([...counts.values()], 'reports')
  if (fromReports) return fromReports

  // 3. The reporting profiles' lists.
  const who = usrIds?.length ? `s.usr_id IN (${usrIds.join(',')})` : `s.usrset_id IN (${usrsets.join(',')})`
  const prof = await q360<{ e: number; id: number; n: number }>(
    `SELECT i.entity_type_id AS e, i.entity_id AS id, COUNT(*) AS n FROM iddb_appl.dbo.entity_set s JOIN iddb_appl.dbo.entity_item i ON i.entity_set_id = s.entity_set_id
     WHERE s.active_f = 1 AND s.reporting_profile_id IS NOT NULL AND ${who} AND i.entity_id > 0 AND i.entity_type_id IN (${types.join(',')})
     GROUP BY i.entity_type_id, i.entity_id`,
  )
  return pick360(prof.map((r) => ({ e: Number(r.e), id: Number(r.id), w: Number(r.n) })), 'profiles')
}

async function candidatesMagnifier(accountIds: string[]): Promise<{ c: Candidates | null; note: string | null }> {
  const cfg = magnifierConfig()
  if (!cfg) return { c: null, note: 'Magnifier is not configured on this server.' }
  const conn = await connectMagnifier(cfg)
  let rels: string[] = []
  try {
    const [rows] = await conn.query(
      `SELECT c.RULE_RAW FROM (SELECT DISTINCT USER_ACCOUNT_CODE, REPORT_ID FROM USER_ACCOUNT_REPORTING) r
       JOIN REPORT_CONFIGURATION rc ON rc.REPORT_ID = r.REPORT_ID AND rc.IS_ENABLED = 1
       JOIN CRITERIA c ON c.ID = rc.CRITERIA_ID
       WHERE r.USER_ACCOUNT_CODE IN (?)`,
      [accountIds],
    )
    rels = (rows as Array<{ RULE_RAW: string | null }>).map((r) => String(r.RULE_RAW ?? ''))
  } finally {
    await conn.end().catch(() => {})
  }
  if (!rels.length) return { c: null, note: 'No Magnifier reports are set up, so there are no advertiser or category restrictions to follow.' }
  const adv = new Map<string, number>()
  const cats = new Map<string, number>()
  let canadian = 0
  for (const raw of rels)
    for (const f of parseRel(raw).fields) {
      for (const code of f.codes) {
        if (/^\d+$/.test(code)) {
          canadian++
          continue
        }
        if (f.field === 'advertiser_code' || f.field === 'parent_advertiser_code') adv.set(code, (adv.get(code) ?? 0) + 1)
        else if (f.field === 'category_code' || f.field === 'category_t1_code') cats.set(`C${code}`, (cats.get(`C${code}`) ?? 0) + 1)
        else if (f.field === 'subcategory_code' || f.field === 'category_t2_code') cats.set(`S${code}`, (cats.get(`S${code}`) ?? 0) + 1)
      }
    }
  const canadaNote = canadian && !adv.size && !cats.size ? "This account's RELs are Canadian (VX2 Canada). GPC's Canadian coverage is not part of this comparison yet." : null
  if (adv.size) {
    const codes = [...adv].sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES).map(([c]) => c)
    const ids = await dbxVx2AdvertiserIds(codes)
    const items = codes.map((c) => ids.get(c)).filter((x): x is { id: string; name: string } => !!x)
    if (items.length) return { c: { kind: 'advertiser', source: 'entitlement', taxonomy: 'VX2', items }, note: null }
  }
  if (cats.size) {
    const keys = [...cats].sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES).map(([k]) => k)
    const want = new Map([
      ['category' as const, new Set(keys.filter((k) => k.startsWith('C')).map((k) => k.slice(1)))],
      ['subcategory' as const, new Set(keys.filter((k) => k.startsWith('S')).map((k) => k.slice(1)))],
    ])
    const { lookup } = await relNames(want)
    return {
      c: { kind: 'category', source: 'entitlement', taxonomy: 'VX2', items: keys.map((k) => ({ id: k, name: lookup(k.startsWith('C') ? 'category' : 'subcategory', k.slice(1)) ?? k.slice(1) })) },
      note: null,
    }
  }
  return { c: null, note: canadaNote ?? 'The RELs restrict media and dates only, not advertisers or categories.' }
}

// ------------------------------------------------------------------ from → to

/** Once more after a pause when Databricks drops the connection: a reset is usually momentary. */
async function retry<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (err) {
    if (!/could not be reached|ECONNRESET|ETIMEDOUT|socket hang up|503|502|429/i.test(String((err as Error)?.message ?? err))) throw err
    await new Promise((r) => setTimeout(r, 8000))
    return f()
  }
}

async function follow(c: Candidates, progress: Progress, label: string): Promise<FocusEntity[]> {
  await progress(`${label}: following ${c.items.length} ${c.kind === 'advertiser' ? 'advertisers' : 'categories'} into GPC (Databricks, a minute or two)`)
  const ids = c.items.map((i) => i.id)
  const flows = await retry(() => (c.kind === 'advertiser' ? dbxFlows(c.taxonomy, ids, new Map()) : dbxCategoryFlows(c.taxonomy, ids)))
  const nameOf = new Map(c.items.map((i) => [i.id, i.name]))
  const ranked = [...flows]
    .map(([id, fl]) => ({ id, flows: fl, spend: fl.reduce((s, f) => s + f.spend, 0) }))
    .filter((x) => x.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, TOP)
  const out: FocusEntity[] = ranked.map((r) => {
    const name = nameOf.get(r.id) ?? r.id
    const withAdv = r.flows.filter((f) => f.gpcId).reduce((s, f) => s + f.spend, 0)
    // The category as the Sankey shows it (the industry where the product sits at that level), the unidentified left out.
    const cats = new Map<string, number>()
    for (const f of r.flows) {
      const k = catLabel(f)
      if (k !== UNKNOWN) cats.set(k, (cats.get(k) ?? 0) + f.spend)
    }
    const topCat = [...cats].sort((a, b) => b[1] - a[1])[0]
    // GPC advertisers that matter: those with at least 1% of the spend (co-op partners on a creative take tiny slices).
    const byParent = new Map<string, number>()
    for (const f of r.flows) if (f.gpcParentId) byParent.set(f.gpcParentId, (byParent.get(f.gpcParentId) ?? 0) + f.spend)
    const major = [...byParent.values()].filter((v) => v >= r.spend * 0.01).length
    const facts = [
      `${money(r.spend)} of Aug–Sep 2026 spend followed from ${c.taxonomy}.`,
      `${Math.round((100 * withAdv) / r.spend)}% lands on a GPC advertiser${major > 1 ? `; ${major} GPC advertisers each take 1% or more` : ''}.`,
      ...(topCat ? [`Largest GPC category: ${topCat[0]} (${Math.round((100 * topCat[1]) / r.spend)}%).`] : []),
    ]
    return { id: r.id, name, spend: r.spend, sankey: sankeyOf(name, r.flows, c.kind, c.taxonomy), facts }
  })

  // What the GPC advertisers spend in all, and how much of it the legacy taxonomy cannot see today.
  if (c.kind === 'advertiser' && out.length) {
    const parentOf = new Map<string, { id: string; name: string }>()
    for (const r of ranked) {
      const t = new Map<string, { name: string; s: number }>()
      for (const f of r.flows) if (f.gpcParentId) t.set(f.gpcParentId, { name: f.gpcParentName ?? f.gpcParentId, s: (t.get(f.gpcParentId)?.s ?? 0) + f.spend })
      const best = [...t].sort((a, b) => b[1].s - a[1].s)[0]
      if (best) parentOf.set(r.id, { id: best[0], name: best[1].name })
    }
    const parentIds = [...new Set([...parentOf.values()].map((p) => p.id))]
    if (parentIds.length) {
      await progress(`${label}: reading what the GPC advertisers spend in all (Databricks)`)
      try {
        const totals = await retry(() => dbxGpcTotals(c.taxonomy, [], parentIds))
        for (const e of out) {
          const p = parentOf.get(e.id)
          if (!p) continue
          const mine = totals.filter((t) => t.gby === 'parent' && t.key === p.id)
          if (!mine.length) continue
          const total = mine.reduce((s, t) => s + t.spend, 0)
          // No FROM entity: the creative has no legacy product, so the legacy taxonomy cannot see it ('OTHER' is seen, just beyond the cap).
          const unseen = mine.filter((t) => !t.fromId).reduce((s, t) => s + t.spend, 0)
          const byMedia = new Map<string, number>()
          for (const t of mine) byMedia.set(t.media, (byMedia.get(t.media) ?? 0) + t.spend)
          e.gpc = { name: p.name, total, unseen, byMedia: [...byMedia].map(([media, spend]) => ({ media, spend })).sort((a, b) => b.spend - a.spend) }
        }
      } catch (err) {
        console.error('[client-eval] GPC totals', err)
      }
    }
  }
  return out
}

// ------------------------------------------------------------------ the whole deck

export async function deckData(scope: DeckScope, progress: Progress): Promise<DeckData> {
  await progress('Reading the client and its entitlements')
  const t = await resolve(scope)
  const sections: PlatformSection[] = []
  const platforms = PLATFORMS.filter((p) => t.accounts.get(p)?.length)
  let step = 0
  for (const p of platforms) {
    step++
    const label = `${PLATFORM_LABEL[p]} (${step} of ${platforms.length})`
    await progress(`${label}: media coverage`, step - 1, platforms.length)
    const ids = t.accounts.get(p)!
    const accts = await db.select().from(ceAccounts).where(and(eq(ceAccounts.platform, p), inArray(ceAccounts.accountId, ids)))
    // Media across the accounts: everything any of them has.
    const media = new Set<string>()
    let restricted = true
    for (const a of accts) {
      const m = currentMedia(p, a.entitlements as Ent360 | EntClassic | EntMagnifier)
      for (const x of m.media) media.add(x)
      if (!m.restricted) restricted = false
    }
    const section: PlatformSection = {
      platform: p,
      accounts: accts.map((a) => ({ id: a.accountId, name: a.name })),
      media: mediaChange(p, [...media], restricted),
      focus: { kind: null, source: null, taxonomy: null, entities: [], note: null },
    }
    try {
      let c: Candidates | null = null
      if (p === '360') c = await candidates360(ints(ids), t.usrIds)
      else if (p === 'magnifier') {
        const m = await candidatesMagnifier(ids)
        c = m.c
        section.focus.note = m.note
      } else section.focus.note = 'Classic has no advertiser or category restrictions and no saved reports, so there is nothing to follow into GPC: media only.'
      if (p === '360' && !c) section.focus.note = 'No advertiser or category restrictions, report selections or reporting profile lists were found.'
      if (c) {
        section.focus = { kind: c.kind, source: c.source, taxonomy: c.taxonomy, entities: await follow(c, progress, label), note: null }
        if (!section.focus.entities.length) section.focus.note = `None of these ${c.kind === 'advertiser' ? 'advertisers' : 'categories'} had US spend in Aug–Sep 2026.`
      }
    } catch (err) {
      console.error('[client-eval] deck focus', p, err)
      section.focus.note = `The from → to view could not be built: ${(err as Error).message}`.slice(0, 300)
    }
    sections.push(section)
  }

  await progress('Writing the summary (model)', platforms.length, platforms.length)
  const highlights = await summarise(t.title, sections)
  return {
    title: t.title,
    subtitle: t.subtitle,
    generated: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    sections,
    highlights,
    notes: [
      'Media: each platform’s media mapped by name onto the media GPC carries in Prod ClickHouse (spend since August 2026).',
      'From → to: Aug–Sep 2026 US spend of the five largest advertisers or categories, followed creative by creative into GPC as Taxonomy Comparison does. 360 is VX1, Magnifier is VX2.',
      'GPC totals: everything the GPC advertiser spends in Aug–Sep 2026, and the part with no legacy product, which the legacy taxonomy cannot see today.',
      TROI_NOTE.text,
    ],
  }
}

/** The model's few lines on what changes overall; computed lines when it is unavailable. */
async function summarise(title: string, sections: PlatformSection[]): Promise<string[]> {
  const facts = sections.map((s) => ({
    platform: PLATFORM_LABEL[s.platform],
    mediaKept: s.media.kept,
    mediaDropped: s.media.dropped,
    mediaAdded: s.media.added,
    digitalToday: s.media.hasDigital,
    followed: s.focus.kind,
    entities: s.focus.entities.map((e) => ({ name: e.name, spend: Math.round(e.spend), facts: e.facts, gpcTotal: e.gpc ? Math.round(e.gpc.total) : null, gpcUnseenToday: e.gpc ? Math.round(e.gpc.unseen) : null })),
    note: s.focus.note,
  }))
  const computed = sections.flatMap((s) => {
    const out: string[] = []
    if (s.media.added.length) out.push(`${PLATFORM_LABEL[s.platform]}: ${s.media.added.length} media added, including ${s.media.added.slice(0, 3).join(', ')}.`)
    if (s.media.dropped.length) out.push(`${PLATFORM_LABEL[s.platform]}: ${s.media.dropped.join(', ')} will no longer be covered.`)
    return out
  })
  try {
    const { text } = await completeJson(
      `You write the opening slide of a client-facing deck about moving from MediaRadar's legacy products (360, Classic, Magnifier) to Insights Studio, which runs on GPC data.
Write 4 to 6 short bullets, each under 25 words, on the major changes this client will experience: media gained and lost, broader coverage, and how their key advertisers or categories map into the new taxonomy.
Be specific with names and figures from the facts. Be positive but honest about anything that drops. No marketing fluff. Reply with JSON only: {"bullets":["..."]}`,
      `Client: ${title}\nFacts: ${JSON.stringify(facts)}`,
      { maxTokens: 900 },
    )
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { bullets?: unknown }
    const bullets = Array.isArray(json.bullets) ? json.bullets.map((b) => String(b).trim()).filter(Boolean).slice(0, 6) : []
    if (bullets.length) return bullets
  } catch (err) {
    console.error('[client-eval] deck summary', err)
  }
  return computed.length ? computed : ['Media coverage and taxonomy changes are summarised on the following slides.']
}

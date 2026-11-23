/**
 * Magnifier's saved searches (Scott, 23 November 2026), from Magnifier's
 * MongoDB: criteriaService.savedSearches. Magnifier's equivalent of a 360
 * user's saved reports, so Client Evaluation counts each person's searches
 * saved or updated in 2026 ("Just 2026") and shows them.
 *
 * The server is MongoDB 3.2, which the current Node driver will not talk to:
 * this uses mongodb@3.7. No login; read only (find and aggregate, on a
 * secondary). Configured by MAGNIFIER_MONGO_URL. The app reaches it.
 *
 * A search names its user (userCode = Magnifier USER.USER_CODE) and account
 * (accountCode), a title, the report it runs (reportId, schemaNamespace) and
 * its filters: fields[] and summaryTags[], each { name: "<schema>/<field>",
 * include, exclude }. The values are the same codes Magnifier's RELs use - US
 * VX2 codes, Canadian numeric ids, media letters - so they are named the same
 * way (rel.ts, rel-names.ts).
 */
import type { MongoClient } from 'mongodb'
import { fieldLabel, readable, schemaCountry, type ReadableRel, type RelSummary, mediaOf, FIELDS, wildcardIndustry, type NameKind } from './rel'
import { relNames } from './rel-names'

/** Searches saved or updated from this day count (Scott: "Just 2026"). */
export const SEARCHES_SINCE = new Date('2026-01-01T00:00:00Z')

export const mongoUrl = (env: Record<string, string | undefined> = process.env) => env.MAGNIFIER_MONGO_URL?.trim() || null

async function connect(): Promise<MongoClient> {
  const url = mongoUrl()
  if (!url) throw new Error('Magnifier MongoDB is not configured here (MAGNIFIER_MONGO_URL).')
  // mongodb@3 is CommonJS: from an ES import its classes can sit on the default export.
  const mod = (await import('mongodb')) as unknown as typeof import('mongodb') & { default?: typeof import('mongodb') }
  const MongoClient = mod.MongoClient ?? mod.default!.MongoClient
  const c = new MongoClient(url, { useUnifiedTopology: true, serverSelectionTimeoutMS: 15_000, socketTimeoutMS: 120_000 })
  await c.connect()
  return c
}

const since = { $or: [{ updatedAt: { $gte: SEARCHES_SINCE } }, { createdAt: { $gte: SEARCHES_SINCE } }] }

/**
 * Each user's searches saved or updated since 2026, by "<account>|<user>", lower case: MongoDB has
 * user codes in lower case ("sarafraser") where Magnifier's MySQL has them in capitals ("ZOERAY").
 */
export async function searchCounts(): Promise<Map<string, number>> {
  const c = await connect()
  try {
    const rows = await c
      .db('criteriaService')
      .collection('savedSearches')
      .aggregate<{ _id: { a: string; u: string }; n: number }>([{ $match: since }, { $group: { _id: { a: '$accountCode', u: '$userCode' }, n: { $sum: 1 } } }], { allowDiskUse: true })
      .toArray()
    const out = new Map<string, number>()
    for (const r of rows) {
      const k = `${String(r._id.a ?? '').trim()}|${String(r._id.u ?? '').trim()}`.toLowerCase()
      out.set(k, (out.get(k) ?? 0) + r.n)
    }
    return out
  } finally {
    await c.close()
  }
}

/** A saved search's filter fields, as the REL fields they match; the rest by their own label. */
const AS_REL: Record<string, string> = {
  advertiserName: 'advertiser_code',
  advertiserProduct: 'advertiser_code',
  parentAdvertiserName: 'parent_advertiser_code',
  parentAdvertiserProduct: 'parent_advertiser_code',
  productName: 'product_code',
  productCode: 'product_code',
  categoryTier1Name: 'category_code',
  category: 'category_code',
  categoryName: 'category_code',
  categoryTier2Name: 'subcategory_code',
  subcategoryName: 'subcategory_code',
  categoryParentAdvertiserProduct: 'subcategory_code',
  mediaTier1Name: 'media_t1_code',
  mediaTier2Name: 'media_t2_code',
  dmaName: 'dma_code',
  messageElementNames: 'message_element_codes',
}
const OWN_LABEL: Record<string, string> = {
  culturalNames: 'Cultural',
  languageName: 'Languages',
  targetMarketName: 'Target markets',
  regionName: 'Regions',
  adPlacementT2Name: 'Placements',
  unitValue: 'Ad lengths',
  newRecutName: 'New or recut',
}

interface RawField {
  name?: string
  include?: unknown[]
  exclude?: unknown[]
}
interface RawSearch {
  _id: unknown
  title?: string
  userCode?: string
  accountCode?: string
  reportId?: string
  schemaNamespace?: string
  timeFrame?: string
  startDate?: Date
  endDate?: Date
  shared?: boolean
  fields?: RawField[]
  summaryTags?: RawField[]
  search?: { values?: unknown[] } | null
  createdAt?: Date
  updatedAt?: Date
}

/** A saved search's filters as a REL summary, so rel.ts reads it. */
export function searchAsRel(s: Pick<RawSearch, 'fields' | 'summaryTags'>): RelSummary {
  const fields = new Map<string, { field: string; label: string; codes: Set<string>; excluded: Set<string> }>()
  const media = new Set<string>()
  for (const f of [...(s.fields ?? []), ...(s.summaryTags ?? [])]) {
    const raw = String(f.name ?? '').split('/').pop() ?? ''
    const inc = (f.include ?? []).map(String).filter(Boolean)
    const exc = (f.exclude ?? []).map(String).filter(Boolean)
    if (!raw || (!inc.length && !exc.length)) continue
    const field = AS_REL[raw] ?? raw
    const label = AS_REL[raw] ? fieldLabel(field) : (OWN_LABEL[raw] ?? raw.replace(/Names?$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()))
    const x = fields.get(field) ?? fields.set(field, { field, label, codes: new Set(), excluded: new Set() }).get(field)!
    for (const c of inc) x.codes.add(c)
    for (const c of exc) x.excluded.add(c)
    if (field === 'media_t1_code' || field === 'media_t2_code')
      for (const c of inc) {
        const m = mediaOf(field, c)
        if (m) media.add(m)
      }
  }
  return {
    fields: [...fields.values()].map((f) => ({ field: f.field, label: f.label, codes: [...f.codes], excluded: [...f.excluded] })),
    media: [...media].sort(),
    dates: [],
    notes: '',
    rules: fields.size,
  }
}

/** The codes in these summaries, by the kind of name each needs (rel-names.ts). */
export function codesToName(rels: RelSummary[]): Map<NameKind, Set<string>> {
  const want = new Map<NameKind, Set<string>>()
  for (const rel of rels)
    for (const f of rel.fields) {
      const kind = FIELDS[f.field]?.kind
      if (!kind) continue
      for (const c of [...f.codes, ...f.excluded]) {
        const ind = kind === 'advertiser' ? wildcardIndustry(c) : null
        const k: NameKind = ind ? 'industry' : kind
        ;(want.get(k) ?? want.set(k, new Set()).get(k)!).add(ind ?? c)
      }
    }
  return want
}

export interface SavedSearchView {
  id: string
  title: string
  report: string | null
  country: string | null
  /** "Last 2 months", "1 May 2023 to 8 Jan 2024"... */
  period: string | null
  keyword: string | null
  shared: boolean
  saved: string | null
  updated: string | null
  rel: ReadableRel
}

const DAY = (d: Date | undefined) => (d instanceof Date ? d.toISOString().slice(0, 10) : null)
const long = (d: Date) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function period(s: RawSearch): string | null {
  if (s.timeFrame === 'custom' && s.startDate instanceof Date && s.endDate instanceof Date) return `${long(s.startDate)} to ${long(s.endDate)}`
  // Magnifier's time frames, as stored: 7d, 1m, 2q, yesterday, ytd, ly, today...
  const named: Record<string, string> = { yesterday: 'Yesterday', today: 'Today', ytd: 'Year to date', ly: 'Last year' }
  if (s.timeFrame && named[s.timeFrame]) return named[s.timeFrame]!
  const m = /^(\d+)([dwmqy])$/.exec(s.timeFrame ?? '')
  if (m) return `Last ${m[1]} ${{ d: 'day', w: 'week', m: 'month', q: 'quarter', y: 'year' }[m[2] as 'd' | 'w' | 'm' | 'q' | 'y']}${m[1] === '1' ? '' : 's'}`
  return s.timeFrame || null
}

/** One person's searches on these accounts saved or updated in 2026, newest first, filters by name. Read live. */
export async function liveSearches(userCode: string, accountCodes: string[]): Promise<{ searches: SavedSearchView[]; namesNote: string | null }> {
  const c = await connect()
  let rows: RawSearch[]
  try {
    rows = await c
      .db('criteriaService')
      .collection<RawSearch>('savedSearches')
      // The user code in any case: MongoDB keeps it in lower case, MySQL in capitals.
      .find({ userCode: { $in: [...new Set([userCode, userCode.toLowerCase(), userCode.toUpperCase()])] }, ...(accountCodes.length ? { accountCode: { $in: accountCodes } } : {}), ...since })
      .sort({ updatedAt: -1 })
      .limit(300)
      .toArray()
  } finally {
    await c.close()
  }
  const rels = rows.map(searchAsRel)
  const { lookup, error } = await relNames(codesToName(rels))
  return {
    namesNote: error,
    searches: rows.map((s, i) => ({
      id: String(s._id),
      title: s.title?.trim() || 'Untitled search',
      report: s.reportId ?? null,
      country: schemaCountry(s.schemaNamespace ?? ''),
      period: period(s),
      keyword: Array.isArray(s.search?.values) && s.search!.values.length ? s.search!.values.map(String).join(', ') : null,
      shared: s.shared === true,
      saved: DAY(s.createdAt),
      updated: DAY(s.updatedAt),
      rel: readable(rels[i]!, lookup),
    })),
  }
}

/**
 * The advertisers and categories in these accounts' 2026 searches (or one
 * person's), with how many searches name each: the Impact Deck's fallback when
 * an account's RELs name none.
 */
export async function searchFocus(accountCodes: string[], userCodes: string[] | null): Promise<{ adv: Map<string, number>; cats: Map<string, number> }> {
  const adv = new Map<string, number>()
  const cats = new Map<string, number>()
  if (!mongoUrl() || !accountCodes.length) return { adv, cats }
  const c = await connect()
  let rows: RawSearch[]
  try {
    rows = await c
      .db('criteriaService')
      .collection<RawSearch>('savedSearches')
      .find({ accountCode: { $in: accountCodes }, ...(userCodes?.length ? { userCode: { $in: userCodes } } : {}), ...since }, { projection: { fields: 1, summaryTags: 1 } })
      .limit(5000)
      .toArray()
  } finally {
    await c.close()
  }
  for (const s of rows)
    for (const f of searchAsRel(s).fields)
      for (const code of f.codes) {
        if (/^\d+$/.test(code)) continue // Canadian ids: not in this comparison
        if (f.field === 'advertiser_code' || f.field === 'parent_advertiser_code') adv.set(code, (adv.get(code) ?? 0) + 1)
        else if (f.field === 'category_code') cats.set(`C${code}`, (cats.get(`C${code}`) ?? 0) + 1)
        else if (f.field === 'subcategory_code') cats.set(`S${code}`, (cats.get(`S${code}`) ?? 0) + 1)
      }
  return { adv, cats }
}

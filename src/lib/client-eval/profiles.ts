/**
 * 360 reporting profiles (Scott, 20 November 2026), for Client Evaluation.
 *
 * A reporting profile is a 360 user's saved reporting defaults, kept in
 * iddb_appl: reporting_profile (one row per profile, owned by a USR), its
 * settings as JSON in reporting_profile_custom_reporting_preferences, and the
 * profile each user starts from in user_default_reporting_profile. 360 creates
 * an untitled "My New Profile" for many users (about 40,000 of 107,000).
 *
 * A profile's lists - My Brands, Competitive Brands, My Accounts, Prospects,
 * Properties, Categories, Markets, Media - are entity_set rows tied to it by
 * reporting_profile_id, with their members in entity_item (entity_type_id is
 * 360's entity type: 118 advertiser, 139 brand, 373 property...). Members are
 * named from iddb_master the way the importer names report selections.
 *
 * The JSON carries the choices and also every option the screen offered
 * (AvailableDemographics, AvailableRatingTypes...), up to 80 KB. Only the
 * choices are read out: measures, media by media type, markets, demographics,
 * rating type, and the layout options as 360 words them.
 */
import { chunks, NAME_FIELDS_SQL, namesSql, q360 } from '@/lib/import360/source'

export interface ProfileSummary {
  id: number
  name: string
  description: string | null
  isDefault: boolean
  lastUsed: string | null
  changed: string | null
  measures: string[]
  /** null: all media. Otherwise the media picked, grouped by media type (empty: not set). */
  media: Array<{ type: string; media: string[] }> | null
  /** null: all markets. Empty: not set in the settings (a Markets list may still hold them). */
  markets: string[] | null
  /** The profile's lists (entity_set): My Brands, Competitive Brands, Properties... Names are capped; count is the full number. */
  lists: Array<{ list: string; type: string; count: number; names: string[] }>
  demographics: string[]
  demographicMarket: string | null
  rating: string | null
  options: string[]
}

type Json = Record<string, unknown>
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : [])
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : null)

/** The choices in a profile's settings. Anything unreadable is left out rather than guessed. */
export function summariseProfile(raw: string | null): Omit<ProfileSummary, 'id' | 'name' | 'description' | 'isDefault' | 'lastUsed' | 'changed' | 'lists'> {
  let d: Json = {}
  try {
    d = raw ? (JSON.parse(raw) as Json) : {}
  } catch {
    d = {}
  }
  const measuresBlock = obj(d.Measures)
  const measures = arr(measuresBlock.MeasuresList).map((m) => txt(m.Description)).filter((x): x is string => !!x)

  const mediaBlock = obj(d.Media)
  let media: ProfileSummary['media'] = null
  if (mediaBlock.AllMediaAreSelected !== true) {
    const byType = new Map<string, string[]>()
    for (const m of arr(mediaBlock.MediaList)) {
      const name = txt(m.Description)
      if (!name) continue
      const type = txt(m.MediaTypeDescription) ?? 'Other'
      ;(byType.get(type) ?? byType.set(type, []).get(type)!).push(name)
    }
    media = [...byType].map(([type, list]) => ({ type, media: list }))
  }

  const marketsBlock = obj(d.Markets)
  // Two shapes: MarketsList with AllMarketsAreSelected, and (newer) EntityItemsBasic with AllEntitiesAreSelected.
  const allMarkets = marketsBlock.AllMarketsAreSelected === true || marketsBlock.AllEntitiesAreSelected === true
  const markets = allMarkets ? null : [...arr(marketsBlock.MarketsList), ...arr(marketsBlock.EntityItemsBasic)].map((m) => txt(m.LongName) ?? txt(m.Name)).filter((x): x is string => !!x)

  const demographics = arr(obj(d.Demographics).DemographicsList).map((x) => txt(x.Description)).filter((x): x is string => !!x)
  const hasRatings = measuresBlock.HasTVRatingsMeasures === true || measures.some((m) => /GRP|TV IMP|rating/i.test(m))
  const rating = hasRatings ? txt(obj(d.RatingType).Description) : null

  const options = [measuresBlock.MeasureFormatDesc, measuresBlock.UseThousandsDesc, measuresBlock.GroupMeasureDesc, d.TotalColumnDesc, d.IncludeColumnActivityDesc, d.IncludeSubtotalsForSingleRecordsDesc]
    .map(txt)
    .filter((x): x is string => !!x)

  return { measures, media, markets, demographics, demographicMarket: txt(obj(d.DemographicMarketType).Description), rating, options }
}

/** One 360 user's reporting profiles, read live, the one they start from first, then the most recently used. */
export async function liveProfiles(usrId: number): Promise<ProfileSummary[]> {
  if (!Number.isInteger(usrId) || usrId <= 0) throw new Error('Unknown 360 user.')
  const rows = await q360<Record<string, unknown>>(`SELECT p.reporting_profile_id, p.reporting_profile_n, p.reporting_profile_desc, p.lastused_d, p.modify_d,
      CASE WHEN d.reporting_profile_id IS NULL THEN 0 ELSE 1 END AS is_default, c.custom_reporting_preferences AS prefs
    FROM iddb_appl.dbo.reporting_profile p
    LEFT JOIN iddb_appl.dbo.user_default_reporting_profile d ON d.reporting_profile_id = p.reporting_profile_id AND d.usr_id = p.usr_id
    LEFT JOIN iddb_appl.dbo.reporting_profile_custom_reporting_preferences c ON c.reporting_profile_id = p.reporting_profile_id
    WHERE p.usr_id = ${usrId}`)
  const lists = await profileLists(rows.map((r) => Number(r.reporting_profile_id)))
  return rows
    .map((r) => {
      const desc = txt(r.reporting_profile_desc)
      return {
        id: Number(r.reporting_profile_id),
        name: txt(r.reporting_profile_n) ?? `Profile ${r.reporting_profile_id}`,
        // 360's placeholder for an empty description says nothing.
        description: desc && desc !== 'Enter description here' ? desc : null,
        isDefault: Number(r.is_default) === 1,
        lastUsed: day(r.lastused_d),
        changed: day(r.modify_d),
        ...summariseProfile(typeof r.prefs === 'string' ? r.prefs : null),
        lists: lists.get(Number(r.reporting_profile_id)) ?? [],
      }
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (b.lastUsed ?? '').localeCompare(a.lastUsed ?? ''))
}

/** 360's names for the entity types in profile lists. */
const TYPE_LABEL: Record<number, string> = { 100: 'Products', 102: 'Parents', 103: 'Categories', 104: 'Majors', 118: 'Advertisers', 135: 'Subcategories', 139: 'Brands', 301: 'Media', 373: 'Properties', 476: 'Media owners', 500: 'Markets' }
const LIST_KEEP = 300

/** The lists of these profiles, their members named. */
async function profileLists(ids: number[]): Promise<Map<number, ProfileSummary['lists']>> {
  const out = new Map<number, ProfileSummary['lists']>()
  if (!ids.length) return out
  const items: Array<{ profile: number; list: string; type: number; id: number }> = []
  for (const part of chunks(ids, 500))
    for (const r of await q360<Record<string, unknown>>(`SELECT s.reporting_profile_id, s.entity_set_n, t.entity_set_type_n, i.entity_type_id, i.entity_id
      FROM iddb_appl.dbo.entity_set s
      JOIN iddb_appl.dbo.entity_item i ON i.entity_set_id = s.entity_set_id
      LEFT JOIN iddb_appl.dbo.entity_set_type t ON t.entity_set_type_id = s.entity_set_type_id
      WHERE s.active_f = 1 AND s.reporting_profile_id IN (${part.map(Number).join(',')})
      ORDER BY s.reporting_profile_id, s.entity_set_id, i.order_id`))
      items.push({ profile: Number(r.reporting_profile_id), list: txt(r.entity_set_n) ?? txt(r.entity_set_type_n) ?? 'List', type: Number(r.entity_type_id), id: Number(r.entity_id) })

  // Names, from iddb_master, for the members shown.
  const where = new Map((await q360<{ entmaj_id: number; table_n: string; id_field: string; name_field: string }>(NAME_FIELDS_SQL)).map((f) => [Number(f.entmaj_id), f]))
  const want = new Map<number, Set<number>>()
  const kept = new Map<string, number>()
  for (const it of items) {
    const k = `${it.profile}|${it.list}|${it.type}`
    const n = (kept.get(k) ?? 0) + 1
    kept.set(k, n)
    if (n <= LIST_KEEP) (want.get(it.type) ?? want.set(it.type, new Set()).get(it.type)!).add(it.id)
  }
  const names = new Map<string, string>()
  for (const [e, idSet] of want) {
    const f = where.get(e)
    if (!f) continue
    for (const part of chunks([...idSet].filter((x) => x > 0), 2000)) {
      const text = namesSql(f, part)
      if (!text) break
      for (const r of await q360<{ id: number; n: string | null }>(text)) if (r.n) names.set(`${e}:${Number(r.id)}`, String(r.n).trim())
    }
  }

  const groups = new Map<string, { profile: number; list: string; type: number; count: number; names: string[] }>()
  for (const it of items) {
    const k = `${it.profile}|${it.list}|${it.type}`
    const g = groups.get(k) ?? groups.set(k, { profile: it.profile, list: it.list, type: it.type, count: 0, names: [] }).get(k)!
    g.count++
    if (g.names.length < LIST_KEEP) g.names.push(names.get(`${it.type}:${it.id}`) ?? (it.id > 0 ? `#${it.id}` : 'All'))
  }
  for (const g of groups.values())
    (out.get(g.profile) ?? out.set(g.profile, []).get(g.profile)!).push({ list: g.list, type: TYPE_LABEL[g.type] ?? `Type ${g.type}`, count: g.count, names: g.names })
  return out
}

/** Every 360 user's number of reporting profiles, for the snapshot. */
export async function profileCounts(): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  for (const r of await q360<{ usr_id: number; n: number }>(`SELECT usr_id, COUNT(*) AS n FROM iddb_appl.dbo.reporting_profile GROUP BY usr_id`)) out.set(Number(r.usr_id), Number(r.n))
  return out
}

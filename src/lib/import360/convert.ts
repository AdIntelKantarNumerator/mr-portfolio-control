/**
 * A 360 Explore report, made into a Report Builder report on GPC data
 * (12 November 2026).
 *
 * Scott, 12 November 2026: the point is a NEW report on GPC that shows
 * roughly what the 360 report shows - not the same creatives. So each 360
 * brand, advertiser, product, category, property or market is matched to GPC
 * by name, best effort: one 360 entity may become several GPC ones (Tremfya
 * as two GPC products; GPC's product is the brand, so a 360 brand is a GPC
 * product with no caveat), and anything without a
 * match, or a capability Report Builder lacks (ratings, creative rows, growth
 * %), is left out. Every change becomes a Note - what it was, why, what was
 * done instead - shown before importing and kept with the saved report. A
 * report type Report Builder cannot produce (a TV schedule) is refused, with
 * the nearest report it can build offered instead.
 *
 * The period always becomes August to October 2026, the months GPC covers in
 * full; the original is noted.
 *
 * Pure: names are matched through a Matcher (the report engine's bulk name
 * lookup in the portfolio, a fake in tests).
 */
import { normName, type DimKey } from '@/lib/report-builder/data/types'
import type { Described } from './decode'

export type Impact = 'dropped' | 'changed' | 'approximate'
export interface Note {
  impact: Impact
  /** What it was in 360. */
  what: string
  why: string
  /** What the import did instead. */
  did: string
}

export interface Candidate {
  id: string
  name: string
  context: string
  spend: number
}
/** GPC entities of one kind whose names match, keyed by normName(name); and, for a few names, a search by part of the name. */
export interface Matcher {
  match(dim: DimKey, names: string[]): Promise<Map<string, Candidate[]>>
  search?(dim: DimKey, text: string): Promise<Candidate[]>
  /** GPC names of these ids ("market:91"), where GPC has them: for kinds whose ids GPC shares with 360. */
  byId?(ids: string[]): Promise<Map<string, string>>
}

/** Markets: 360 and GPC share ids (Scott, 12 November 2026), so they are matched by id and the names only checked. */
const SAME_IDS: DimKey[] = ['market']
/** Whether two spellings of a name agree, loosely: "EL PASO(LAS CRUCES),TX" and "El Paso", "* TOTAL US" and "National". */
export function similarNames(a360: string, gpc: string): boolean {
  if (/total us/i.test(a360) && /national/i.test(gpc)) return true
  const clean = (x: string) => normName(x.replace(/\(.*?\)/g, ' ').replace(/,\s*[A-Z]{2}\b.*$/, ''))
  const a = clean(a360)
  const b = clean(gpc)
  return !!a && !!b && (a.includes(b) || b.includes(a) || a.slice(0, 5) === b.slice(0, 5))
}

// ---------------------------------------------------------------- spelling

/**
 * How a 360 name is spelled in GPC. Markets carry their state in 360
 * ("ABILENE-SWEETWATER,TX") but not in GPC; products are "Advertiser :
 * Product" in 360 and just the product in GPC - the advertiser part is kept
 * as context, to tell apart products with the same name.
 */
export function gpcSpelling(dim: DimKey, name: string): { name: string; context: string | null } {
  if (dim === 'market') {
    if (/total us/i.test(name)) return { name: 'National', context: null }
    return { name: name.replace(/,\s*[A-Z]{2}(\s*\(.*\))?$/, '').trim(), context: null }
  }
  if (dim === 'product' && name.includes(' : ')) {
    const at = name.indexOf(' : ')
    return { name: name.slice(at + 3).trim(), context: name.slice(0, at).trim() }
  }
  return { name, context: null }
}

const CORPORATE = /\b(the|inc|incorporated|co|company|corp|corporation|llc|ltd|limited|plc|lp|sa|ag|nv|holdings?|group|usa|us|america|assn|association|and)\b/g
/** A name with corporate words and punctuation gone: "Procter & Gamble Co" and "The Procter & Gamble Company" agree. */
export const looseKey = (s: string) => normName(s.toLowerCase().replace(/&/g, ' and ').replace(CORPORATE, ' '))
/**
 * The word to search by: the longest that is not a corporate word ("Procter",
 * "Lilly", "Tillamook"). Search finds names containing it, so it must be one
 * word: "Procter Gamble" is not inside "The Procter & Gamble Company". The
 * looseKey comparison then picks the real match among what it finds.
 */
export const coreName = (s: string) =>
  s
    .replace(/[.,&:()'"/-]/g, ' ')
    .replace(new RegExp(CORPORATE.source, 'gi'), ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] ?? s
/** A product's advertiser, when 360 gave one, must agree with GPC's: the first word of one in the other. */
function fitsContext(h: Candidate, context: string | null): boolean {
  if (!context) return true
  const a = looseKey(context).slice(0, 6)
  const b = looseKey(h.context)
  return !a || !b || b.includes(a) || a.includes(b.slice(0, 6))
}

/**
 * What the person (or the creative lookup) settled for one 360 name, keyed
 * "<entmaj>:<id>": GPC ids to use, or null to leave it out.
 */
export type Choice = { ids: string[]; names: string[]; how: 'creatives' | 'picked'; why?: string } | null
export type Choices = Record<string, Choice>

/** 360 entity types whose unmatched names can be looked up by their creatives (lib/import360/creatives.ts). */
export const LOOKUP_TYPES = [118, 102, 139]

export interface Converted {
  /** ok: nothing to report; partial: imported with notes; refused: the type cannot be built (nearest offered). */
  verdict: 'ok' | 'partial' | 'refused'
  refusal: string | null
  spec: Record<string, unknown>
  notes: Note[]
  /** Advertisers, parents and brands not found by name and not yet settled: for the creative lookup. */
  unresolved: Array<{ e: number; label: string; id: number; name: string }>
  /** Each selection, in 360 and in Report Builder: for the review's lists. */
  lists: Array<{ label: string; from: string[]; to: Array<{ id: string; name: string }> }>
}

/** The period every import gets. */
export const IMPORT_PERIOD = { mode: 'static', start: '2026-08', end: '2026-10' }
const PERIOD_LABEL = 'Aug – Oct 2026'

// ---------------------------------------------------------------- 360 entity types in GPC terms

type Map360 = { dim: DimKey; note?: string } | { drop: string }
const GPC_HAS_NO = (what: string) => ({ drop: `GPC data does not record ${what}.` })
const NOT_IN_RB = (what: string) => ({ drop: `Report Builder cannot break out by ${what} yet.` })

/** How each 360 entity type (entmaj) is read in GPC, as a breakout or a selection. */
export const ENTITY: Record<number, Map360> = {
  118: { dim: 'advertiser' },
  102: { dim: 'top_parent' },
  101: { dim: 'advertiser', note: 'GPC has no subsidiary level; advertisers are used.' },
  // GPC's product is the brand: a 360 brand is a GPC product, one for one.
  139: { dim: 'product' },
  100: { dim: 'product' },
  105: { dim: 'industry' },
  107: { dim: 'industry', note: 'GPC has no industry group; industries are used.' },
  104: { dim: 'category', note: 'GPC has no major category; categories are used.' },
  103: { dim: 'category' },
  135: { dim: 'subcategory' },
  136: { dim: 'subcategory', note: 'GPC has no microcategory; subcategories are used.' },
  301: { dim: 'media_type' },
  413: { dim: 'media_type' },
  300: { dim: 'media_type', note: 'Submedia are shown as media types.' },
  328: { dim: 'media_type', note: 'Media groups are shown as media types.' },
  331: { dim: 'media_type', note: 'TV breakouts are shown as media types.' },
  373: { dim: 'property' },
  477: { dim: 'master_property', note: 'Media brands are matched to master properties.' },
  476: { dim: 'media_owner' },
  478: { dim: 'media_owner', note: 'Ultimate media brands are matched to media owners.' },
  500: { dim: 'market' },
  303: { dim: 'market', note: 'National/local is shown by market; "National" is one of them.' },
  309: { dim: 'program' },
  310: { dim: 'program_genre', note: 'Program types are matched to program genres.' },
  325: { dim: 'program_genre' },
  324: { dim: 'program_genre', note: 'Program clusters are matched to program genres.' },
  308: { dim: 'daypart' },
  316: { dim: 'daypart' },
  314: { dim: 'length' },
  379: { dim: 'language' },
  482: { dim: 'direct_indirect' },
  // Time, by grain.
  735: { dim: 'month' },
  736: { dim: 'month' },
  737: { dim: 'month' },
  744: { dim: 'month' },
  724: { dim: 'broadcast_month' },
  725: { dim: 'broadcast_month' },
  728: { dim: 'broadcast_week' },
  729: { dim: 'broadcast_week' },
  741: { dim: 'week' },
  742: { dim: 'week' },
  726: { dim: 'quarter', note: 'Broadcast quarters are shown as calendar quarters.' },
  727: { dim: 'quarter', note: 'Broadcast quarters are shown as calendar quarters.' },
  738: { dim: 'quarter' },
  739: { dim: 'quarter' },
  740: { dim: 'quarter' },
  730: { dim: 'year' },
  743: { dim: 'year' },
  746: { dim: 'day' },
  747: { dim: 'day' },
  // Not available.
  460: NOT_IN_RB('creative'),
  322: NOT_IN_RB('creative'),
  438: NOT_IN_RB('creative'),
  320: NOT_IN_RB('creative first appearance'),
  319: NOT_IN_RB('creative attributes'),
  797: NOT_IN_RB('day of week'),
  796: NOT_IN_RB('weekday or weekend'),
  798: GPC_HAS_NO('broadcast time of day'),
  111: GPC_HAS_NO('state, except for streaming'),
  305: GPC_HAS_NO('network affiliation'),
  407: GPC_HAS_NO('web categories'),
  408: GPC_HAS_NO('web parent sites'),
  339: GPC_HAS_NO('web ad types'),
  338: GPC_HAS_NO('web ad sizes'),
  384: GPC_HAS_NO('outdoor ad types'),
  431: GPC_HAS_NO('radio formats'),
  364: GPC_HAS_NO('pod position'),
  361: GPC_HAS_NO('pod placement'),
  443: GPC_HAS_NO('search keywords'),
  445: GPC_HAS_NO('search display URLs'),
  35: GPC_HAS_NO('this grouping'),
  333: GPC_HAS_NO('house-ad types'),
}
const TIME_GENERIC = 700

/** 360 measures in GPC: $ and units and impressions come across; ratings and print and web measures do not. */
const MEASURE: Record<number, { m: 'spend' | 'occurrences' | 'impressions'; note?: string } | { drop: string }> = {
  800: { m: 'spend' },
  // Units and occurrences are the same thing under two names: no note.
  801: { m: 'occurrences' },
  834: { m: 'occurrences' },
  840: { m: 'occurrences' },
  837: { m: 'impressions' },
  842: { m: 'impressions', note: 'OLV impressions are part of GPC impressions.' },
  843: { drop: 'GPC data has no cinema.' },
}
const RATINGS = [802, 803, 804, 805, 819, 820, 821, 822, 823, 654, 657, 37, 38, 39, 40, 41]

/** 360 media names GPC spells differently, compared as normName does. */
const MEDIA_ALIAS: Record<string, string> = {
  spanlangnettv: 'Spanish Language Network TV',
  spanishlangnettvnatl: 'Spanish Language Network TV',
  networktvnational: 'Network TV',
  syndicationnational: 'Syndication',
  avodplayon: 'AVOD',
  bisavod: 'AVOD',
  syndicatio: 'Syndication',
  localcable: 'Local Cable TV',
  nationalmagazines: 'Magazines',
  localmagazines: 'Magazines',
  nationalnewspapers: 'Newspapers',
  localnewspapers: 'Newspapers',
  newspaper: 'Newspapers',
}

/** Report types Report Builder builds, and why the others cannot be. */
const BUILDS: Record<number, string> = { 2301: 'advertiser_trend', 2307: 'summary', 2302: 'media_mix' }
const REFUSED: Record<number, string> = {
  803: 'A TV schedule lists individual airings, which Report Builder does not produce.',
  804: 'A magazine schedule lists individual insertions, which Report Builder does not produce.',
  805: 'A newspaper schedule lists individual insertions, which Report Builder does not produce.',
  811: 'A radio schedule lists individual spots, and GPC data has no radio.',
  2308: "360's zero-share report is built around 360 media selections; use Report Builder's own Zero share report instead.",
  2309: 'An "exclusive to me" report needs 360 competitive sets, which Report Builder does not have yet.',
  2310: 'A mutual report needs 360 competitive sets, which Report Builder does not have yet.',
  2311: 'A new-business report compares against an earlier period that GPC data does not cover.',
  2312: 'An inactive report compares against an earlier period that GPC data does not cover.',
}

const CALC = { vertical: 1, horizontal: 2, grand: 8 }

const list = (xs: string[], max = 5) => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`)
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export async function convert360(d: Described, matcher: Matcher, opts: { nearest?: boolean; choices?: Choices } = {}): Promise<Converted> {
  const notes: Note[] = []
  const note = (impact: Impact, what: string, why: string, did: string) => notes.push({ impact, what, why, did })

  // ---- the report type
  const typeId = d.type.id ?? 2307
  const refusal = BUILDS[typeId] ? null : (REFUSED[typeId] ?? `Report Builder cannot build a ${d.type.name} report.`)
  if (refusal && !opts.nearest) return { verdict: 'refused', refusal, spec: {}, notes: [], unresolved: [], lists: [] }
  const unresolved: Converted['unresolved'] = []
  const lists: Converted['lists'] = []
  if (refusal) note('changed', `${d.type.name} report`, refusal, 'Imported as a summary with the same selections and breakouts, the nearest report it can build.')

  // ---- the layout: pages and extra columns become rows; one column breakout
  const asDim = (e: number, timeE: number | null): Map360 | undefined => (e === TIME_GENERIC ? (timeE != null ? ENTITY[timeE] : { dim: 'month' }) : ENTITY[e])
  const rows: DimKey[] = []
  let columns: DimKey | null = null
  const typeNotes = new Set<string>()
  const place = (item: { e: number; label: string }, where: 'row' | 'col' | 'page') => {
    const m = asDim(item.e, d.time.e)
    if (!m) return note('dropped', `${item.label} ${where === 'col' ? 'columns' : 'rows'}`, 'Report Builder has no equivalent.', 'Left out.')
    if ('drop' in m) return note('dropped', `${item.label} ${where === 'col' ? 'columns' : 'rows'}`, m.drop, 'Left out.')
    if (m.note && !typeNotes.has(m.note)) {
      typeNotes.add(m.note)
      note('approximate', item.label, m.note, `Shown by ${m.dim.replace(/_/g, ' ')}.`)
    }
    if (where === 'col' && !columns) columns = m.dim
    else if (!rows.includes(m.dim) && columns !== m.dim) {
      rows.push(m.dim)
      if (where === 'page') note('changed', `${item.label} pages`, 'Report Builder has no page breakouts.', `${item.label} became the first row level.`)
      if (where === 'col') note('changed', `${item.label} columns`, 'Report Builder has one column breakout.', `${item.label} became a row level.`)
    }
  }
  for (const p of d.pages) place(p, 'page')
  // Pages lead the rows, as they lead the report in 360.
  const pageRows = [...rows]
  rows.length = 0
  for (const r of d.rows) place(r, 'row')
  for (const c of d.columns) place(c, 'col')
  rows.unshift(...pageRows.filter((r) => !rows.includes(r)))
  if (!rows.length) {
    rows.push('advertiser')
    note('changed', 'Rows', 'The report had no rows Report Builder can show.', 'Broken out by advertiser.')
  }

  // ---- measures and calculations
  const measures: Array<'spend' | 'occurrences' | 'impressions'> = []
  const calcs = new Set<string>()
  for (const c of d.data) {
    if (RATINGS.includes(c.e) || c.demo) {
      note('dropped', c.label, 'GPC data has no ratings or demographics.', 'Left out; spend, occurrences and impressions are kept where asked for.')
      continue
    }
    const m = MEASURE[c.e]
    if (!m || 'drop' in m) {
      note('dropped', c.label, m && 'drop' in m ? m.drop : 'GPC data does not have this measure.', 'Left out.')
      continue
    }
    if (m.note && !typeNotes.has(m.note)) {
      typeNotes.add(m.note)
      note('approximate', c.label, m.note, `Shown as ${m.m}.`)
    }
    if (!measures.includes(m.m)) measures.push(m.m)
    if (c.calc === CALC.vertical || c.calc === CALC.grand) {
      calcs.add('share')
      if (c.calc === CALC.grand) note('approximate', `${c.label} grand %`, 'Report Builder shows percent of the column or of the total, not of the grand total across pages.', 'Shown as % down.')
    } else if (c.calc === CALC.horizontal) {
      if (columns) calcs.add('share_across')
      else note('dropped', `${c.label} horizontal %`, 'A percent across needs a column breakout, and this report has none in Report Builder.', 'Left out.')
    } else if (c.calc > 0) {
      note('dropped', `${c.label} calculation`, 'Growth and difference calculations compare with an earlier period, which GPC data does not cover in full.', 'Left out.')
    }
  }
  if (!measures.length) {
    measures.push('spend')
    note('changed', 'Measures', 'None of the report\'s measures are in GPC data.', 'Shows spend.')
  }
  if (d.sortedByName) note('changed', 'Row order', '360 sorted these rows by name or in a chosen order.', 'Rows are sorted by the first measure, largest first.')

  // ---- selections, matched to GPC by name
  const filters: Record<string, string[]> = {}
  const mediaPick = new Set<string>()
  const mediaMiss: string[] = []
  const media = d.selections.filter((s) => [301, 413, 300, 328, 331].includes(s.e))
  // One media list is enough (360 repeats media as rollups and submedia); prefer media itself.
  const mediaSel = [301, 413, 328, 331, 300].map((e) => media.find((s) => s.e === e)).find(Boolean)
  if (mediaSel && mediaSel.picked.length) {
    const want = mediaSel.picked.map((p) => MEDIA_ALIAS[normName(p.name)] ?? p.name)
    const found = await matcher.match('media_type', want)
    const to = new Map<string, string>()
    mediaSel.picked.forEach((p, i) => {
      const hits = found.get(normName(want[i]!)) ?? []
      if (hits.length)
        for (const h of hits) {
          mediaPick.add(h.id)
          to.set(h.id, h.name)
        }
      else mediaMiss.push(p.name)
    })
    lists.push({ label: mediaSel.label, from: mediaSel.picked.map((p) => p.name), to: [...to].map(([id, name]) => ({ id, name })) })
    if (mediaMiss.length) note('dropped', `Media: ${list(mediaMiss)}`, 'GPC data has no equivalent media type.', 'Left out of the media selection.')
    if (mediaPick.size) filters.media_type = [...mediaPick]
    else note('dropped', 'Media selection', 'None of the selected media are in GPC data.', 'The report covers all media.')
  }

  for (const s of d.selections) {
    const excluded = () => note('dropped', `Excluded ${s.label.toLowerCase()}: ${list(s.excluded.map((x) => x.name))}`, 'Report Builder can only include, not exclude.', 'The exclusion was left out.')
    // Media were matched above, from one list; only that list's exclusions are worth saying.
    if (media.includes(s)) {
      if (s === mediaSel && s.excluded.length) excluded()
      continue
    }
    if (s.e === 333) {
      if (s.excluded.some((x) => /house/i.test(x.name))) note('approximate', 'Excluding house ads', 'GPC reports always leave out promos and public service announcements, the nearest equivalent.', 'House ads are not separately excluded.')
      continue
    }
    if (s.excluded.length) excluded()
    if (!s.picked.length) continue
    const m = ENTITY[s.e]
    if (!m || 'drop' in m || m.dim === 'month' || ['quarter', 'year', 'week', 'broadcast_week', 'broadcast_month', 'day'].includes(m.dim)) {
      note('dropped', `${s.label} selection (${plural(s.picked.length, 'value')})`, m && 'drop' in m ? m.drop : 'Report Builder cannot select on this.', 'Left out; the report is not limited by it.')
      continue
    }
    // Markets: "* TOTAL US" (360 market -1) is GPC's National market (also -1), matched
    // by name below like any other. A list of nearly every local market means all of them.
    if (m.dim === 'market' && !s.picked.some((p) => p.id === -1 || /total us/i.test(p.name)) && s.picked.length >= 150) {
      note('changed', `Market selection (${plural(s.picked.length, 'market')})`, 'The 360 selection is the whole country.', 'The report covers every market.')
      continue
    }
    // Brands are GPC products, but a name not found there may be an advertiser;
    // subsidiaries have no GPC level. Try the nearest kinds in turn.
    const kinds: DimKey[] = s.e === 139 ? ['product', 'advertiser'] : s.e === 101 ? ['advertiser', 'top_parent'] : s.e === 102 ? ['top_parent', 'advertiser'] : [m.dim]
    // Each 360 name, and how it would be spelled in GPC (see gpcSpelling).
    const left = new Map(s.picked.map((p) => [p.name, gpcSpelling(m.dim, p.name)]))
    const picked = new Map<DimKey, Set<string>>()
    const to = new Map<string, string>()
    let split = 0
    const loose: string[] = []
    const add = (id: string, name: string) => {
      const kind = id.slice(0, id.indexOf(':')) as DimKey
      const set = picked.get(kind) ?? new Set<string>()
      set.add(id)
      picked.set(kind, set)
      to.set(id, name)
    }
    const take = (kind: DimKey, name: string, hits: Candidate[]) => {
      if (hits.length > 1) split++
      for (const h of hits) add(h.id, h.name)
      left.delete(name)
    }
    // Kinds whose ids GPC shares with 360 match by id; a name that disagrees is said.
    const unlike: string[] = []
    if (SAME_IDS.includes(m.dim) && matcher.byId) {
      const got = await matcher.byId(s.picked.map((p) => `${m.dim}:${p.id}`))
      for (const p of s.picked) {
        const name = got.get(`${m.dim}:${p.id}`)
        if (!name) continue
        add(`${m.dim}:${p.id}`, name)
        left.delete(p.name)
        if (!similarNames(p.name, name)) unlike.push(`${p.name} → ${name}`)
      }
    }
    // Names already settled - by their creatives, or by the person - before any matching.
    const settled: { creatives: string[]; picked: string[]; dropped: string[] } = { creatives: [], picked: [], dropped: [] }
    for (const p of s.picked) {
      const key = `${s.e}:${p.id}`
      if (!opts.choices || !(key in opts.choices)) continue
      const c = opts.choices[key]
      left.delete(p.name)
      if (!c || !c.ids.length) {
        settled.dropped.push(p.name)
        continue
      }
      c.ids.forEach((id, i) => add(id, c.names[i] ?? id))
      settled[c.how === 'creatives' ? 'creatives' : 'picked'].push(`${p.name} → ${c.names.join(', ')}${c.why ? ` (${c.why})` : ''}`)
    }
    for (const kind of kinds) {
      if (!left.size) break
      const found = await matcher.match(kind, [...left.values()].map((v) => v.name))
      for (const [name, v] of [...left]) {
        const hits = (found.get(normName(v.name)) ?? []).filter((h) => h.spend > 0 && fitsContext(h, v.context))
        if (hits.length) take(kind, name, hits)
      }
    }
    // A second, looser pass for the few left: the same name without "Inc", "Co", "The"... found by search.
    if (left.size && left.size <= 40 && matcher.search) {
      for (const [name, v] of [...left]) {
        for (const kind of kinds) {
          const hits = (await matcher.search(kind, coreName(v.name))).filter((h) => h.spend > 0 && looseKey(h.name) === looseKey(v.name) && fitsContext(h, v.context))
          if (hits.length) {
            take(kind, name, hits)
            loose.push(`${name} → ${hits.map((h) => h.name).join(', ')}`)
            break
          }
        }
      }
    }
    for (const [kind, ids] of picked) filters[kind] = [...new Set([...(filters[kind] ?? []), ...ids])]
    lists.push({ label: s.label, from: s.picked.map((p) => p.name), to: [...to].map(([id, name]) => ({ id, name })) })
    if (unlike.length) note('approximate', `${s.label}: ${plural(unlike.length, 'name')} differ in GPC`, `Matched by id, which 360 and GPC share, but GPC names ${unlike.length === 1 ? 'it' : 'them'} differently.`, `Matched ${list(unlike, 3)}.`)
    if (settled.creatives.length) note('approximate', `${s.label}: ${plural(settled.creatives.length, 'name')} found by its creatives`, `No GPC ${s.label.toLowerCase()} has that name, so a sample of its creatives was followed into GPC.`, `Matched ${list(settled.creatives, 3)}.`)
    if (settled.picked.length) note('approximate', `${s.label}: ${plural(settled.picked.length, 'name')} matched by you`, 'Not found in GPC by name or with certainty by its creatives.', `You chose ${list(settled.picked, 3)}.`)
    if (settled.dropped.length) note('dropped', `${s.label}: ${list(settled.dropped)}`, 'Not found in GPC by name or by its creatives.', 'You chose to leave it out.')
    // Unmatched advertisers, parents and brands can still be found by their creatives.
    if (LOOKUP_TYPES.includes(s.e)) for (const p of s.picked) if (left.has(p.name)) unresolved.push({ e: s.e, label: s.label, id: p.id, name: p.name })
    const matched = s.picked.length - left.size - settled.dropped.length
    if (loose.length) note('approximate', `${s.label}: ${plural(loose.length, 'name')} matched with a different spelling`, 'GPC spells some company names differently.', `Matched ${list(loose, 3)}.`)
    if (m.note && !typeNotes.has(m.note)) {
      typeNotes.add(m.note)
      note('approximate', s.label, m.note, `Matched by name in GPC.`)
    }
    if (split) note('approximate', `${s.label}: ${plural(split, 'name')} matched more than one GPC entity`, 'GPC splits some of these into several advertisers or products of the same name.', 'All of them are included, so totals may be larger than in 360.')
    if (left.size)
      note(
        matched ? 'approximate' : 'dropped',
        `${s.label}: ${plural(left.size, 'name')} not found in GPC (${list([...left.keys()])})`,
        `No ${s.label.toLowerCase()} by that name has spend in GPC data for ${PERIOD_LABEL}.`,
        matched ? `Left out; ${matched === 1 ? `the other ${s.label.toLowerCase()} is` : `the other ${plural(matched, s.label.toLowerCase())} are`} included.` : 'Left out; the report is not limited by it.',
      )
  }

  // ---- the period, and promos
  note('changed', `Period: ${d.time.label ?? 'as set in 360'}`, 'GPC data covers all media from August 2026.', `Set to ${PERIOD_LABEL}.`)
  if (d.includePromos) note('changed', 'Including promos', 'Report Builder always leaves out promos and public service announcements.', 'Promos are not included.')

  const who = ['advertiser', 'top_parent', 'product', 'industry', 'category', 'subcategory'].some((k) => filters[k]?.length)
  const spec: Record<string, unknown> = {
    template: refusal ? 'summary' : BUILDS[typeId],
    rows,
    columns,
    measures,
    calcs: [...calcs],
    filters,
    time: IMPORT_PERIOD,
    options: { final_only: true, top_n: null },
    ...(who ? {} : { scope: 'all' }),
  }
  // Every import changes the period; anything beyond that makes it partial.
  const verdict = refusal ? 'refused' : notes.every((n) => n.what.startsWith('Period:')) ? 'ok' : 'partial'
  return { verdict, refusal, spec, notes, unresolved, lists }
}

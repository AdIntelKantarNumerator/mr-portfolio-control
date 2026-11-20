/**
 * A Magnifier REL, read well enough to show a person (Client Evaluation).
 *
 * A REL is Magnifier's report criteria: comment lines (#...), then rules,
 *
 *   rules.<name>=<field>:<codes separated by spaces or tabs>
 *   rules.<name>=AND:<rule names> | OR:... | NOT:...
 *   rules.<name>=DATE_RANGE:for:<field> from:MM/DD/YYYY to:MM/DD/YYYY
 *   tlrs.online=<the final rule>        transforms.<name>=...
 *
 * This does not evaluate the logic. It lists what each field lets in (and,
 * under a NOT, keeps out), the media rolled up from the media letters, and the
 * dates. The codes are turned into names by rel-names.ts at refresh time:
 * US RELs use VX2 codes ("WALMRT"), Canadian ones VX2 Canada's numeric ids.
 */

/**
 * Media, rolled up (Scott, 20 November 2026: "roll it up to MEDIA"). Top-level
 * codes are Omnis FMEDIA_DEF, plus PS (paid social, used in about 160 RELs);
 * online, online video and mobile are all Digital. A two-letter submedia code
 * rolls up by its first letter, where D is Digital (DO, DE, DB mirror O, E, B).
 */
const MEDIA_T1: Record<string, string> = {
  T: 'TV',
  P: 'Print',
  R: 'Radio',
  O: 'Digital',
  E: 'Digital',
  B: 'Digital',
  X: 'Outdoor',
  C: 'Cinema',
  D: 'Direct mail',
  M: 'Email',
  S: 'Social',
  V: 'Social',
  PS: 'Paid social',
}
const MEDIA_T2_FIRST: Record<string, string> = { T: 'TV', P: 'Print', R: 'Radio', X: 'Outdoor', D: 'Digital', M: 'Email', S: 'Social', C: 'Cinema' }
const MEDIA_FIELDS = new Set(['media', 'media_t1_code', 'media_t2_code'])

export function mediaOf(field: string, code: string): string | null {
  const c = code.toUpperCase()
  if (field === 'media_t2_code') return MEDIA_T1[c] === 'Paid social' ? 'Paid social' : (MEDIA_T2_FIRST[c[0]!] ?? null)
  return MEDIA_T1[c] ?? null
}

/** What each field is, for people, and which name table its codes resolve in (rel-names.ts). */
export const FIELDS: Record<string, { label: string; kind?: NameKind }> = {
  advertiser_code: { label: 'Advertisers', kind: 'advertiser' },
  coop_advertiser_code: { label: 'Co-op advertisers', kind: 'advertiser' },
  coop_advertiser_codes: { label: 'Co-op advertisers', kind: 'advertiser' },
  parent_advertiser_code: { label: 'Parent advertisers', kind: 'parent' },
  category_code: { label: 'Categories', kind: 'category' },
  category_t1_code: { label: 'Categories', kind: 'category' },
  subcategory_code: { label: 'Subcategories', kind: 'subcategory' },
  category_t2_code: { label: 'Subcategories', kind: 'subcategory' },
  product_code: { label: 'Products', kind: 'product' },
  industry_group_code: { label: 'Industry groups', kind: 'industry' },
  dma_code: { label: 'Markets' },
  market_code: { label: 'Markets' },
  target_market_code: { label: 'Target markets' },
  country_code: { label: 'Countries' },
  message_element_codes: { label: 'Message elements' },
  keyword: { label: 'Keywords' },
  ad_id: { label: 'Specific ads' },
  adcode: { label: 'Specific ads' },
  flag_codes: { label: 'Flags' },
}
export type NameKind = 'advertiser' | 'parent' | 'category' | 'subcategory' | 'product' | 'industry'

export const fieldLabel = (f: string) => FIELDS[f]?.label ?? f.replace(/_codes?$/, '').replace(/_/g, ' ')

/** Market codes that are not places. */
const MARKET_LABEL: Record<string, string> = { USA: 'National (US)', CAN: 'National (Canada)', NET: 'Network', CAB: 'Cable', SYN: 'Syndication' }
const COUNTRY_LABEL: Record<string, string> = { USA: 'US', CAN: 'Canada' }

export interface RelField {
  field: string
  label: string
  codes: string[]
  excluded: string[]
}

export interface RelSummary {
  fields: RelField[]
  media: string[]
  dates: Array<{ for: string; from: string; to: string }>
  /** The comment text: who it was made for, ticket numbers. */
  notes: string
  rules: number
}

const SEGMENT = /(?:^|\s)((?:rules|tlrs|transforms)\.[\w.-]+)=/g

export function parseRel(raw: string | null | undefined): RelSummary {
  const text = String(raw ?? '')
  const out: RelSummary = { fields: [], media: [], dates: [], notes: '', rules: 0 }
  const marks = [...text.matchAll(SEGMENT)]
  out.notes = (marks.length ? text.slice(0, marks[0]!.index) : text)
    .split('#')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' · ')
    .slice(0, 600)
  const defs = new Map<string, string>()
  marks.forEach((m, i) => {
    const start = m.index! + m[0].length
    const end = i + 1 < marks.length ? marks[i + 1]!.index! : text.length
    // A comment can follow a rule on the same line: it is not more codes.
    defs.set(m[1]!, text.slice(start, end).split('#')[0]!.trim())
  })

  // Rules under a NOT keep codes out rather than let them in.
  const negated = new Set<string>()
  for (const [, body] of defs) {
    const not = /^NOT:\s*(.*)$/.exec(body)
    if (not) for (const r of not[1]!.split(/\s+/)) if (r) negated.add(r)
  }

  const fields = new Map<string, { codes: Set<string>; excluded: Set<string> }>()
  const media = new Set<string>()
  for (const [name, body] of defs) {
    if (!name.startsWith('rules.')) continue
    out.rules++
    const date = /^DATE_RANGE:for:(\S+)\s+from:(\S+)\s+to:(\S+)/.exec(body)
    if (date) {
      out.dates.push({ for: date[1]!, from: date[2]!, to: date[3]! })
      continue
    }
    if (/^(AND|OR|NOT):/.test(body)) continue
    const leaf = /^([a-z0-9_]+):(.*)$/i.exec(body)
    if (!leaf) continue
    const field = leaf[1]!
    const codes = leaf[2]!.split(/\s+/).filter(Boolean)
    const short = name.slice('rules.'.length)
    const keptOut = negated.has(short) || negated.has(name)
    let f = fields.get(field)
    if (!f) fields.set(field, (f = { codes: new Set(), excluded: new Set() }))
    for (const c of codes) (keptOut ? f.excluded : f.codes).add(c)
    if (!keptOut && MEDIA_FIELDS.has(field))
      for (const c of codes) {
        const m = mediaOf(field, c)
        if (m) media.add(m)
      }
  }
  out.fields = [...fields].map(([field, f]) => ({ field, label: fieldLabel(field), codes: [...f.codes], excluded: [...f.excluded] }))
  out.media = [...media].sort()
  return out
}

/** SCHEMA_ID to country (Scott: brand-c = US; brand-n and brand-monthly = Canada). */
export function schemaCountry(schema: string | null | undefined): string | null {
  const s = String(schema ?? '').toLowerCase()
  if (s.startsWith('brand-c')) return 'US'
  if (s.startsWith('brand-n') || s.startsWith('brand-monthly')) return 'Canada'
  return null
}

/** A REL as a person reads it: each restriction as names, media rolled up, dates. */
export interface ReadableRel {
  media: string[]
  rows: Array<{ label: string; items: string[]; excluded: string[]; total: number }>
  dates: string[]
  notes: string
}

/** How many names each restriction keeps for the page; the count says how many there are. */
const KEEP = 150

/** A wildcard advertiser code ("*IN"): every advertiser in that industry group. */
export const wildcardIndustry = (code: string) => (/^\*([A-Z]{2})$/i.exec(code)?.[1] ?? null)

export function readable(rel: RelSummary, name: (kind: NameKind, code: string) => string | undefined): ReadableRel {
  const rows: ReadableRel['rows'] = []
  const byLabel = new Map<string, ReadableRel['rows'][number]>()
  const show = (field: string, code: string): string => {
    const kind = FIELDS[field]?.kind
    if (kind === 'advertiser') {
      const ind = wildcardIndustry(code)
      if (ind) return `All of ${name('industry', ind) ?? `industry ${ind}`}`
    }
    if (kind) return name(kind, code) ?? code
    if (field === 'dma_code' || field === 'market_code') return MARKET_LABEL[code] ?? code
    if (field === 'country_code') return COUNTRY_LABEL[code] ?? code
    return code
  }
  for (const f of rel.fields) {
    if (MEDIA_FIELDS.has(f.field)) continue
    const label = fieldLabel(f.field)
    let row = byLabel.get(label)
    if (!row) {
      row = { label, items: [], excluded: [], total: 0 }
      byLabel.set(label, row)
      rows.push(row)
    }
    row.total += f.codes.length + f.excluded.length
    for (const c of f.codes) if (row.items.length < KEEP) row.items.push(show(f.field, c))
    for (const c of f.excluded) if (row.excluded.length < KEEP) row.excluded.push(show(f.field, c))
  }
  for (const r of rows) {
    r.items = [...new Set(r.items)].sort((a, b) => a.localeCompare(b))
    r.excluded = [...new Set(r.excluded)].sort((a, b) => a.localeCompare(b))
  }
  // Media kept out are worth saying: "everything but Social".
  const mediaOut = new Set<string>()
  for (const f of rel.fields) if (MEDIA_FIELDS.has(f.field)) for (const c of f.excluded) {
    const m = mediaOf(f.field, c)
    if (m) mediaOut.add(m)
  }
  if (mediaOut.size) rows.unshift({ label: 'Media kept out', items: [...mediaOut].sort(), excluded: [], total: mediaOut.size })
  const fmt = (d: string) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d)
    return m ? new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]))).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : d
  }
  return { media: rel.media, rows, dates: rel.dates.map((d) => `${fmt(d.from)} to ${fmt(d.to)}`), notes: rel.notes }
}

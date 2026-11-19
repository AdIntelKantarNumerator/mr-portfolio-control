/**
 * A Magnifier REL, read well enough to summarise (Client Evaluation).
 *
 * A REL is Magnifier's report criteria: comment lines (#...), then rules,
 *
 *   rules.<name>=<field>:<codes separated by spaces or tabs>
 *   rules.<name>=AND:<rule names> | OR:... | NOT:...
 *   rules.<name>=DATE_RANGE:for:<field> from:MM/DD/YYYY to:MM/DD/YYYY
 *   tlrs.online=<the final rule>        transforms.<name>=...
 *
 * The codes resolve in VX2's taxonomy (advertiser, category, product) and in
 * Omnis (media letters). This does not evaluate the logic: it lists which
 * fields a REL restricts, how many codes each names, the media and the dates,
 * which is what a person comparing entitlements needs first.
 */

/** Omnis FMEDIA_DEF: the first letter of a media code. */
export const MEDIA_LETTER: Record<string, string> = {
  T: 'TV',
  P: 'Print',
  R: 'Radio',
  O: 'Online',
  E: 'Online video',
  B: 'Mobile',
  X: 'Outdoor',
  C: 'Cinema',
  D: 'Direct mail',
  M: 'Opt-in email',
  S: 'Social',
  V: 'Social',
}

const FIELD_LABEL: Record<string, string> = {
  media_t1_code: 'Media',
  media_t2_code: 'Submedia',
  advertiser_code: 'Advertisers',
  category_t1_code: 'Categories',
  category_t2_code: 'Subcategories',
  product_code: 'Products',
  dma_code: 'Markets',
  industry_group_code: 'Industry groups',
  cultural_code: 'Cultural',
}
export const fieldLabel = (f: string) => FIELD_LABEL[f] ?? f.replace(/_code$/, '').replace(/_/g, ' ')

export interface RelSummary {
  /** Restricted fields, with how many codes each names (excluded ones counted apart). */
  fields: Array<{ field: string; label: string; codes: number; excluded: number; sample: string[] }>
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
    defs.set(m[1]!, text.slice(start, end).trim())
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
    const out2 = negated.has(short) || negated.has(name)
    let f = fields.get(field)
    if (!f) fields.set(field, (f = { codes: new Set(), excluded: new Set() }))
    for (const c of codes) (out2 ? f.excluded : f.codes).add(c)
    if (!out2 && (field === 'media_t1_code' || field === 'media_t2_code'))
      for (const c of codes) {
        const m = MEDIA_LETTER[c[0]!.toUpperCase()]
        if (m) media.add(m)
      }
  }
  out.fields = [...fields].map(([field, f]) => ({ field, label: fieldLabel(field), codes: f.codes.size, excluded: f.excluded.size, sample: [...f.codes].slice(0, 12) }))
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

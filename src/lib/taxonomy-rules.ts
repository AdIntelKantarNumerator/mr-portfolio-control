/**
 * Taxonomy Comparison: the pure rules (Scott, 29 October 2026).
 *
 * Advertiser-level spend compared across four taxonomies — VX1, VX2, GPC and
 * MediaRadar Classic — by media type and month. Temporary: built for a
 * one-off comparison, so the window and media types are constants, not
 * settings.
 *
 * No database, no network: the screen, the run and the tests read the same
 * rules. lib/taxonomy-run.ts does the fetching and the model calls.
 */

export const TAXONOMIES = ['VX1', 'VX2', 'GPC', 'Classic'] as const
export type Taxonomy = (typeof TAXONOMIES)[number]

export const TAXONOMY_LABEL: Record<Taxonomy, string> = {
  VX1: 'VX1',
  VX2: 'VX2',
  GPC: 'GPC',
  Classic: 'MediaRadar Classic',
}

export const MEDIA_TYPES = ['Digital', 'Social', 'Print', 'Linear TV', 'CTV'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

/**
 * August and September 2026 only. October was in the original ask and was
 * dropped (Scott, 29 October 2026): the Classic snapshot cannot hold a
 * complete October yet.
 */
export const MONTHS = ['2026-08', '2026-09'] as const
export type Month = (typeof MONTHS)[number]

export const MONTH_LABEL: Record<Month, string> = { '2026-08': 'Aug 2026', '2026-09': 'Sep 2026' }

/** Media a taxonomy does not track at all, so a blank there is not a gap. */
export const NOT_TRACKED: Partial<Record<Taxonomy, MediaType[]>> = {
  Classic: ['CTV'],
  // Databricks has no GPC print; ClickHouse Dev does, but its August was half
  // loaded on 29 October 2026. Scott: fine to leave it out.
  GPC: ['Print'],
}

export const MAX_ADVERTISERS = 25

/**
 * One advertiser per line. Commas are not separators: "Procter & Gamble Co.,
 * The" is one name. Blank lines and repeats (ignoring case) are dropped.
 */
export function parseAdvertisers(text: string): { names: string[]; error?: string } {
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name.slice(0, 120))
  }
  if (!names.length) return { names, error: 'Paste at least one advertiser, one per line.' }
  if (names.length > MAX_ADVERTISERS) return { names, error: `Up to ${MAX_ADVERTISERS} advertisers at a time; you pasted ${names.length}.` }
  return { names }
}

const SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'plc', 'corp', 'corporation', 'co', 'company', 'companies',
  'the', 'group', 'holdings', 'holding', 'sa', 'ag', 'nv', 'gmbh', 'brands', 'us', 'usa', 'na',
])

/** A name reduced to the words that identify it: case, punctuation and legal suffixes gone. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !SUFFIXES.has(w))
    .join(' ')
}

/**
 * Search terms for finding candidates by name: the longest distinctive word
 * runs first. "The Procter & Gamble Company" → ["procter and gamble", "procter",
 * "gamble"]. Short words are dropped; a three-letter brand name stays whole.
 */
export function searchTerms(name: string): string[] {
  const norm = normaliseName(name)
  if (!norm) return [name.trim().toLowerCase()].filter(Boolean)
  const words = norm.split(' ')
  const terms = [norm]
  const long = words.filter((w) => w.length >= 4 && w !== 'and').sort((a, b) => b.length - a.length)
  for (const w of long.slice(0, 2)) if (!terms.includes(w)) terms.push(w)
  return terms
}

/** exact: the same name. close: the same once case, punctuation and suffixes are ignored. different: anything else. */
export type MatchKind = 'exact' | 'close' | 'different'

export function matchKind(input: string, found: string): MatchKind {
  if (input.trim().toLowerCase() === found.trim().toLowerCase()) return 'exact'
  return normaliseName(input) === normaliseName(found) ? 'close' : 'different'
}

export interface Candidate {
  id: string
  name: string
  /** Total spend in the window, where the source can say cheaply (Classic), to tell the real advertiser from a namesake. */
  spend?: number
  /** Otherwise a size the source can count quickly: "308 products", "5,161 creatives". */
  size?: string
  /** For ordering when there is no model: spend, or the count behind `size`. */
  weight?: number
  /** What the source calls the level this name sits at, when it is not the advertiser itself. */
  via?: string
}

export interface Resolved {
  id: string
  name: string
  kind: MatchKind
  /** Why this entity was chosen, in a sentence, when it was not an exact name match. */
  reason?: string
}

/** spend[media][month], dollars. Absent is zero. */
export type Grid = Partial<Record<MediaType, Partial<Record<Month, number>>>>

export interface TaxonomyResult {
  entity: Resolved | null
  /** Why nothing matched, when nothing did. */
  missing?: string
  grid: Grid
}

export interface Flag {
  /** name: matched under a different name. missing: no entity found. gap: spend in some taxonomies and not this one. spread: amounts disagree. */
  kind: 'name' | 'missing' | 'gap' | 'spread'
  taxonomy?: Taxonomy
  media?: MediaType
  text: string
}

export interface AdvertiserResult {
  input: string
  taxonomies: Record<Taxonomy, TaxonomyResult>
  flags: Flag[]
  commentary: string
}

export const total = (grid: Grid, media?: MediaType): number => {
  let sum = 0
  for (const m of media ? [media] : MEDIA_TYPES) for (const mo of MONTHS) sum += grid[m]?.[mo] ?? 0
  return sum
}

export const cell = (grid: Grid, media: MediaType, month: Month): number => grid[media]?.[month] ?? 0

export function addToGrid(grid: Grid, media: MediaType, month: Month, spend: number): void {
  if (!Number.isFinite(spend) || spend === 0) return
  const row = (grid[media] ??= {})
  row[month] = (row[month] ?? 0) + spend
}

/** A disagreement is worth a flag when the largest is more than this much above the smallest. */
export const SPREAD_RATIO = 1.5
/** Below this, per media type over the window, differences are noise and not flagged. */
export const MATERIAL = 10_000

/**
 * The flags for one advertiser, computed — never left to the model — so the
 * same numbers always raise the same flags.
 */
export function computeFlags(input: string, taxonomies: Record<Taxonomy, TaxonomyResult>): Flag[] {
  const flags: Flag[] = []
  for (const t of TAXONOMIES) {
    const r = taxonomies[t]
    if (!r.entity) {
      flags.push({ kind: 'missing', taxonomy: t, text: `${TAXONOMY_LABEL[t]}: no matching advertiser found${r.missing ? ` — ${r.missing}` : ''}.` })
    } else if (r.entity.kind !== 'exact') {
      flags.push({
        kind: 'name',
        taxonomy: t,
        text: `${TAXONOMY_LABEL[t]}: matched "${r.entity.name}"${r.entity.kind === 'close' ? ' (same name, different punctuation or suffix)' : ''}${r.entity.reason ? ` — ${r.entity.reason}` : ''}.`,
      })
    }
  }

  for (const media of MEDIA_TYPES) {
    const present = TAXONOMIES.filter((t) => taxonomies[t].entity && !NOT_TRACKED[t]?.includes(media))
    const amounts = present.map((t) => ({ t, v: total(taxonomies[t].grid, media) }))
    const nonzero = amounts.filter((a) => a.v > 0)
    if (!nonzero.length) continue
    const max = Math.max(...nonzero.map((a) => a.v))
    if (max < MATERIAL) continue
    const zero = amounts.filter((a) => a.v === 0)
    if (zero.length) {
      flags.push({
        kind: 'gap',
        media,
        text: `${media}: no spend in ${list(zero.map((a) => TAXONOMY_LABEL[a.t]))}, while ${list(nonzero.map((a) => `${TAXONOMY_LABEL[a.t]} has ${money(a.v)}`))}.`,
      })
    }
    if (nonzero.length >= 2) {
      const min = Math.min(...nonzero.map((a) => a.v))
      if (max > min * SPREAD_RATIO) {
        const hi = nonzero.find((a) => a.v === max)!
        const lo = nonzero.find((a) => a.v === min)!
        flags.push({
          kind: 'spread',
          media,
          text: `${media}: ${TAXONOMY_LABEL[hi.t]} ${money(hi.v)} is ${(max / min).toFixed(1)}× ${TAXONOMY_LABEL[lo.t]} ${money(lo.v)}.`,
        })
      }
    }
  }
  return flags
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

export function money(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Math.round(v)}`
}

/** The whole comparison as CSV: one row per advertiser, taxonomy, media type and month. */
export function toCsv(results: AdvertiserResult[]): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [['Advertiser (as entered)', 'Taxonomy', 'Matched entity', 'Entity ID', 'Match', 'Media type', 'Month', 'Spend (USD)', 'Flags'].join(',')]
  for (const r of results) {
    const flagText = r.flags.map((f) => f.text).join(' | ')
    for (const t of TAXONOMIES) {
      const tr = r.taxonomies[t]
      for (const media of MEDIA_TYPES) {
        for (const month of MONTHS) {
          const tracked = !NOT_TRACKED[t]?.includes(media)
          lines.push(
            [
              r.input,
              TAXONOMY_LABEL[t],
              tr.entity?.name ?? '',
              tr.entity?.id ?? '',
              tr.entity ? tr.entity.kind : 'not found',
              media,
              MONTH_LABEL[month],
              tracked ? Math.round(cell(tr.grid, media, month)) : 'not tracked',
              flagText,
            ]
              .map(esc)
              .join(','),
          )
        }
      }
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

// --- progress ---------------------------------------------------------------

export type StepState = 'waiting' | 'running' | 'done' | 'failed'

export interface Step {
  key: string
  label: string
  state: StepState
  detail?: string
  startedAt?: string
  endedAt?: string
}

export const STEP_KEYS = ['candidates', 'match', 'spend-dbx', 'spend-classic', 'commentary'] as const

export function initialSteps(): Step[] {
  return [
    { key: 'candidates', label: 'Find candidate advertisers in each taxonomy', state: 'waiting' },
    { key: 'match', label: 'Decide which entity is the advertiser', state: 'waiting' },
    { key: 'spend-dbx', label: 'Read VX1, VX2 and GPC spend from Databricks', state: 'waiting' },
    { key: 'spend-classic', label: 'Read MediaRadar Classic spend', state: 'waiting' },
    { key: 'commentary', label: 'Write the commentary', state: 'waiting' },
  ]
}

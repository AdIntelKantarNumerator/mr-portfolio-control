/**
 * Taxonomy Comparison: running one comparison.
 *
 * A run is a row in taxonomy_runs. Starting one returns at once; the work
 * carries on in this process and writes its progress to the row after every
 * step, and the screen polls the row. Databricks can take minutes on a cold
 * warehouse, longer than a request may stay open on App Service.
 *
 *   1. candidates   each pasted name searched by name in every taxonomy
 *   2. match        the model decides which candidate (if any) is the advertiser
 *   3. spend        VX1, VX2 and GPC from Databricks; Classic from the snapshot
 *   4. commentary   computed flags, then the model writes a short paragraph
 *
 * Flags are computed (lib/taxonomy-rules.ts), never the model's: the same
 * numbers always raise the same flags. The model only chooses among real
 * candidates — an id it did not get is discarded — and writes prose.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { classicNames, classicSpend, taxonomyRuns } from '@/db/schema'
import { completeJson, ModelError, resolveProvider } from './llm'
import { dbxCandidates, dbxSpend } from './taxonomy-dbx'
import {
  addToGrid,
  computeFlags,
  initialSteps,
  matchKind,
  MEDIA_TYPES,
  money,
  MONTHS,
  normaliseName,
  searchTerms,
  TAXONOMIES,
  TAXONOMY_LABEL,
  total,
  type AdvertiserResult,
  type Candidate,
  type Grid,
  type MediaType,
  type Month,
  type Resolved,
  type Step,
  type Taxonomy,
  type TaxonomyResult,
} from './taxonomy-rules'

export interface RunResult {
  advertisers: AdvertiserResult[]
  model: string | null
  classicLoadedAt: string | null
  finishedAt: string
}

type Candidates = Record<Taxonomy, Candidate[]>

export async function startRun(names: string[], askedBy: string | null): Promise<string> {
  const [row] = await db
    .insert(taxonomyRuns)
    .values({ input: JSON.stringify(names), askedBy, status: 'running', progress: JSON.stringify(initialSteps()) })
    .returning({ id: taxonomyRuns.id })
  void execute(row.id, names).catch(async (err) => {
    console.error('[taxonomy] run failed', err)
    await db
      .update(taxonomyRuns)
      .set({ status: 'failed', error: (err as Error).message?.slice(0, 1000) ?? 'Failed' })
      .where(eq(taxonomyRuns.id, row.id))
  })
  return row.id
}

async function execute(id: string, names: string[]): Promise<void> {
  const steps = initialSteps()
  const save = () => db.update(taxonomyRuns).set({ progress: JSON.stringify(steps) }).where(eq(taxonomyRuns.id, id))
  const step = async <T>(key: string, work: (note: (detail: string) => Promise<void>) => Promise<T>): Promise<T> => {
    const s = steps.find((x) => x.key === key)!
    s.state = 'running'
    s.startedAt = new Date().toISOString()
    await save()
    const note = async (detail: string) => {
      s.detail = detail
      await save()
    }
    try {
      const out = await work(note)
      s.state = 'done'
      s.endedAt = new Date().toISOString()
      await save()
      return out
    } catch (err) {
      s.state = 'failed'
      s.detail = (err as Error).message
      s.endedAt = new Date().toISOString()
      await save()
      throw err
    }
  }

  const candidates = await step('candidates', async (note) => {
    const classic = await classicCandidates(names)
    await note('Classic searched; searching Databricks…')
    const dbx = await dbxCandidates(names, (s) => note(`Searching Databricks… ${s}s`))
    const per = names.map((n): Candidates => ({ VX1: dbx.VX1.get(n) ?? [], VX2: dbx.VX2.get(n) ?? [], GPC: dbx.GPC.get(n) ?? [], Classic: classic.get(n) ?? [] }))
    const found = per.reduce((a, c) => a + TAXONOMIES.filter((t) => c[t].length).length, 0)
    await note(`${found} of ${names.length * TAXONOMIES.length} name searches found candidates`)
    return per
  })

  const { resolved, model } = await step('match', async (note) => {
    const out = await resolveAll(names, candidates)
    await note(out.model ? `Decided by ${out.model}` : 'No model configured: matched by name only')
    return out
  })

  const idsFor = (t: Taxonomy) => [...new Set(resolved.flatMap((r) => (r[t] ? [r[t]!.id] : [])))]

  const dbxGrids = await step('spend-dbx', async (note) => {
    const ids = { VX1: idsFor('VX1'), VX2: idsFor('VX2'), GPC: idsFor('GPC') }
    if (!ids.VX1.length && !ids.VX2.length && !ids.GPC.length) {
      await note('Nothing matched in Databricks')
      return { VX1: new Map<string, Grid>(), VX2: new Map<string, Grid>(), GPC: new Map<string, Grid>() }
    }
    return dbxSpend(ids, (s) => note(`Query running… ${s}s`))
  })

  const classicGrids = await step('spend-classic', async () => classicSpendFor(idsFor('Classic').map(Number)))

  const advertisers: AdvertiserResult[] = names.map((input, i) => {
    const taxonomies = {} as Record<Taxonomy, TaxonomyResult>
    for (const t of TAXONOMIES) {
      const entity = resolved[i][t]
      const grids = t === 'Classic' ? classicGrids : dbxGrids[t]
      taxonomies[t] = {
        entity,
        missing: entity ? undefined : candidates[i][t].length ? 'candidates were found, none is this advertiser' : 'no name like it',
        grid: entity ? (grids.get(entity.id) ?? {}) : {},
      }
    }
    return { input, taxonomies, flags: computeFlags(input, taxonomies), commentary: '' }
  })

  await step('commentary', async (note) => {
    const written = await writeCommentary(advertisers)
    for (const a of advertisers) a.commentary = written.get(a.input) ?? fallbackCommentary(a)
    await note(written.size ? 'Written' : 'Summarised without a model')
  })

  const [loaded] = await db.select({ at: sql<string>`max(${classicSpend.loadedAt})` }).from(classicSpend)
  const result: RunResult = {
    advertisers,
    model,
    classicLoadedAt: loaded?.at ? new Date(loaded.at).toISOString() : null,
    finishedAt: new Date().toISOString(),
  }
  await db.update(taxonomyRuns).set({ status: 'done', result: JSON.stringify(result) }).where(eq(taxonomyRuns.id, id))
}

// --- Classic, from the snapshot -------------------------------------------

async function classicCandidates(names: string[]): Promise<Map<string, Candidate[]>> {
  const out = new Map<string, Candidate[]>()
  for (const name of names) {
    const terms = searchTerms(name)
    const byId = new Map<number, { via?: string; exact: boolean }>()
    for (const term of terms) {
      const rows = await db
        .select({ id: classicNames.advertiserId, name: classicNames.name, level: classicNames.level })
        .from(classicNames)
        .where(sql`lower(${classicNames.name}) like ${'%' + term.replace(/[%_]/g, '') + '%'}`)
        .limit(200)
      for (const r of rows) {
        const exact = normaliseName(r.name) === normaliseName(name)
        const prior = byId.get(r.id)
        if (!prior || (exact && !prior.exact)) byId.set(r.id, { via: r.level === 'advertiser' ? undefined : `found via ${r.level} "${r.name}"`, exact })
      }
      if (byId.size >= 12) break
    }
    if (!byId.size) {
      out.set(name, [])
      continue
    }
    const ids = [...byId.keys()]
    const rows = await db
      .select({ id: classicSpend.advertiserId, name: classicSpend.advertiserName, spend: sql<number>`sum(${classicSpend.spend})` })
      .from(classicSpend)
      .where(inArray(classicSpend.advertiserId, ids))
      .groupBy(classicSpend.advertiserId, classicSpend.advertiserName)
    const list = rows
      .map((r) => ({ id: String(r.id), name: r.name, spend: Number(r.spend), via: byId.get(r.id)?.via, exact: byId.get(r.id)?.exact }))
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.spend - a.spend)
      .slice(0, 10)
      .map(({ exact: _e, ...c }) => c)
    out.set(name, list)
  }
  return out
}

async function classicSpendFor(ids: number[]): Promise<Map<string, Grid>> {
  const out = new Map<string, Grid>()
  if (!ids.length) return out
  const rows = await db.select().from(classicSpend).where(inArray(classicSpend.advertiserId, ids))
  for (const r of rows) {
    const grid = out.get(String(r.advertiserId)) ?? {}
    if ((MEDIA_TYPES as readonly string[]).includes(r.mediaType) && (MONTHS as readonly string[]).includes(r.month)) {
      addToGrid(grid, r.mediaType as MediaType, r.month as Month, r.spend)
    }
    out.set(String(r.advertiserId), grid)
  }
  return out
}

// --- deciding which entity is the advertiser --------------------------------

const MATCH_SYSTEM = `You match advertiser names across four media-measurement taxonomies (VX1, VX2, GPC, MediaRadar Classic).
For each pasted advertiser and each taxonomy you get candidate entities found by name search, each with an id, its name, a size (Classic: its Aug–Sep 2026 ad spend; VX1 and VX2: its product count; GPC: its creative count including child entities) and sometimes its parent, or the subsidiary or brand name that led to it.
In GPC a parent entity includes its children's spend: when both "The Progressive Corporation" and its child "Progressive" are offered, pick the top entity that is the advertiser itself.
Pick the ONE candidate that is the same real-world advertiser at the ADVERTISER level (the company that buys the media, not a brand or product line), or null when none is.
Rules:
- Same company under a different legal suffix or punctuation is a match.
- A parent company is a match when the pasted name is the company itself; prefer the entity whose name is the advertiser, not a subsidiary or brand, when both exist.
- A namesake in a different business (e.g. "Progressive Lighting" for "Progressive" the insurer) is NOT a match. Use spend size and the other taxonomies' choices to tell the real advertiser from a namesake.
- MediaRadar Classic offers only top-level companies. When the pasted advertiser is a subsidiary there (e.g. GEICO under Berkshire Hathaway, found via company "GEICO"), pick that top company and say in the reason that its spend includes other subsidiaries.
- VX1 offers both advertisers and parent companies (ids starting "P"). When the company's spend is spread over brand-named advertisers (Procter & Gamble's brands), the parent company is the advertiser-level match; when one VX1 advertiser carries the company's spend (Progressive), pick that advertiser.
- Use only ids you were given. Never invent one.
- For every pick whose name is not identical to the pasted name, give a one-sentence reason a salesperson would understand.
Reply with JSON only: {"matches":[{"input":"<pasted name>","VX1":{"id":"…","reason":"…"}|null,"VX2":…,"GPC":…,"Classic":…}]}`

async function resolveAll(names: string[], candidates: Candidates[]): Promise<{ resolved: Record<Taxonomy, Resolved | null>[]; model: string | null }> {
  const byName = names.map((n, i) => byNameOnly(n, candidates[i]))
  if (!resolveProvider()) return { resolved: byName, model: null }

  const prompt = names
    .map((n, i) => {
      const lines = [`ADVERTISER: ${n}`]
      for (const t of TAXONOMIES) {
        const c = candidates[i][t]
        lines.push(`  ${t}: ${c.length ? '' : '(no candidates)'}`)
        for (const x of c) lines.push(`    - id=${x.id} | ${x.name} | ${x.spend != null ? `spend ${money(x.spend)}` : (x.size ?? '')}${x.via ? ` | ${x.via}` : ''}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')

  try {
    const { text, model } = await completeJson(MATCH_SYSTEM, prompt, { maxTokens: 4000, timeoutMs: 150_000 })
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as {
      matches?: ({ input?: string } & Partial<Record<Taxonomy, { id?: string; reason?: string } | null>>)[]
    }
    const resolved = names.map((n, i) => {
      const m = parsed.matches?.find((x) => x.input?.trim().toLowerCase() === n.toLowerCase()) ?? parsed.matches?.[i]
      if (!m) return byName[i]
      const out = {} as Record<Taxonomy, Resolved | null>
      for (const t of TAXONOMIES) {
        const pick = m[t]
        const c = pick?.id ? candidates[i][t].find((x) => x.id === String(pick.id)) : undefined
        out[t] = c ? { id: c.id, name: c.name, kind: matchKind(n, c.name), reason: matchKind(n, c.name) === 'exact' ? undefined : pick?.reason?.slice(0, 300) } : null
      }
      return out
    })
    return { resolved, model }
  } catch (err) {
    console.error('[taxonomy] model match failed, matching by name', err instanceof ModelError ? err.message : err)
    return { resolved: byName, model: null }
  }
}

/** Without a model: the candidate whose name is the same once normalised, largest spend first. */
function byNameOnly(name: string, c: Candidates): Record<Taxonomy, Resolved | null> {
  const out = {} as Record<Taxonomy, Resolved | null>
  for (const t of TAXONOMIES) {
    const pick = c[t].filter((x) => normaliseName(x.name) === normaliseName(name)).sort((a, b) => (b.weight ?? b.spend ?? 0) - (a.weight ?? a.spend ?? 0))[0]
    out[t] = pick ? { id: pick.id, name: pick.name, kind: matchKind(name, pick.name) } : null
  }
  return out
}

// --- commentary ---------------------------------------------------------------

const COMMENTARY_SYSTEM = `You write short commentary comparing one advertiser's ad spend across taxonomies (VX1, VX2, GPC, MediaRadar Classic) for Aug–Sep 2026.
You get the matched entity names, spend totals by media type per taxonomy, and computed flags. MediaRadar Classic does not track CTV.
Write 2–4 plain sentences per advertiser: where the taxonomies agree, the biggest disagreement and by how much, and any entity-match caveat. Use the numbers given; do not invent any. No preamble, no bullet points.
Reply with JSON only: {"commentary":[{"input":"<pasted name>","text":"…"}]}`

async function writeCommentary(advertisers: AdvertiserResult[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!resolveProvider()) return out
  const prompt = advertisers
    .map((a) => {
      const lines = [`ADVERTISER: ${a.input}`]
      for (const t of TAXONOMIES) {
        const r = a.taxonomies[t]
        if (!r.entity) {
          lines.push(`  ${TAXONOMY_LABEL[t]}: not found`)
          continue
        }
        const parts = MEDIA_TYPES.map((m) => `${m} ${money(total(r.grid, m))}`).join(', ')
        lines.push(`  ${TAXONOMY_LABEL[t]} ("${r.entity.name}"): total ${money(total(r.grid))}; ${parts}`)
      }
      for (const f of a.flags) lines.push(`  FLAG: ${f.text}`)
      return lines.join('\n')
    })
    .join('\n\n')
  try {
    const { text } = await completeJson(COMMENTARY_SYSTEM, prompt, { maxTokens: 3500, timeoutMs: 150_000 })
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { commentary?: { input?: string; text?: string }[] }
    for (const c of parsed.commentary ?? []) {
      const a = advertisers.find((x) => x.input.toLowerCase() === c.input?.trim().toLowerCase())
      if (a && c.text?.trim()) out.set(a.input, c.text.trim().slice(0, 1500))
    }
  } catch (err) {
    console.error('[taxonomy] commentary failed', err instanceof ModelError ? err.message : err)
  }
  return out
}

export function fallbackCommentary(a: AdvertiserResult): string {
  const found = TAXONOMIES.filter((t) => a.taxonomies[t].entity)
  if (!found.length) return 'Not found in any taxonomy.'
  const totals = found.map((t) => `${TAXONOMY_LABEL[t]} ${money(total(a.taxonomies[t].grid))}`).join(', ')
  const issues = a.flags.filter((f) => f.kind === 'spread' || f.kind === 'gap').length
  return `Aug–Sep total: ${totals}.${issues ? ` ${issues} media-type difference${issues === 1 ? '' : 's'} flagged.` : ' The taxonomies broadly agree.'}`
}

export async function readRun(id: string) {
  const [row] = await db.select().from(taxonomyRuns).where(eq(taxonomyRuns.id, id))
  if (!row) return null
  return {
    id: row.id,
    input: JSON.parse(row.input) as string[],
    askedBy: row.askedBy,
    status: row.status as 'running' | 'done' | 'failed',
    steps: JSON.parse(row.progress) as Step[],
    result: row.result ? (JSON.parse(row.result) as RunResult) : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  }
}

export type RunView = NonNullable<Awaited<ReturnType<typeof readRun>>>

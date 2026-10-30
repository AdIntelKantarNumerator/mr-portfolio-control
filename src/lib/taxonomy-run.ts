/**
 * Taxonomy Comparison: running one comparison, FROM a taxonomy TO GPC.
 *
 * A run is a row in taxonomy_runs. Starting one returns at once; the work
 * carries on in this process and writes its progress to the row after every
 * step, and the screen polls the row. Databricks can take minutes on a cold
 * warehouse, longer than a request may stay open on App Service.
 *
 *   1. candidates   each pasted name searched by name in the FROM taxonomy only
 *   2. match        the model decides which candidate (if any) is the advertiser
 *   3. flows        that entity's creatives followed into GPC (lib/taxonomy-dbx.ts)
 *   4. commentary   computed flags, then the model writes a short paragraph
 *
 * GPC is never searched by name: its side of the answer is whatever the FROM
 * advertiser's creatives are assigned to there.
 *
 * Flags are computed (lib/taxonomy-rules.ts), never the model's: the same
 * numbers always raise the same flags. The model only chooses among real
 * candidates — an id it did not get is discarded — and writes prose.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { classicBrandProducts, classicNames, classicSpend, taxonomyRuns } from '@/db/schema'
import { completeJson, ModelError, resolveProvider } from './llm'
import { dbxCandidates, dbxFlows } from './taxonomy-dbx'
import {
  compactName,
  computeFlags,
  filterFlows,
  flowTotal,
  initialSteps,
  isFromTaxonomy,
  matchKind,
  MEDIA_TYPES,
  money,
  MONTHS,
  namePatterns,
  normaliseName,
  pct,
  rankAdvertisers,
  rankNodes,
  TAXONOMY_LABEL,
  type AdvertiserResult,
  type Candidate,
  type Flow,
  type FromTaxonomy,
  type Resolved,
  type Step,
} from './taxonomy-rules'

export interface RunResult {
  /** 2 since FROM → GPC (30 October 2026); results without it are the side-by-side version. */
  version: 2
  from: FromTaxonomy
  advertisers: AdvertiserResult[]
  model: string | null
  classicLoadedAt: string | null
  finishedAt: string
}

/** What a run was asked: stored as JSON in taxonomy_runs.input. Older runs stored a bare string[]. */
export interface RunInput {
  from: FromTaxonomy | null
  names: string[]
}

export function parseRunInput(raw: string): RunInput {
  const v = JSON.parse(raw) as unknown
  if (Array.isArray(v)) return { from: null, names: v.map(String) }
  const o = v as { from?: string; names?: unknown[] }
  return { from: o.from && isFromTaxonomy(o.from) ? o.from : null, names: (o.names ?? []).map(String) }
}

export async function startRun(from: FromTaxonomy, names: string[], askedBy: string | null): Promise<string> {
  const [row] = await db
    .insert(taxonomyRuns)
    .values({ input: JSON.stringify({ from, names }), askedBy, status: 'running', progress: JSON.stringify(initialSteps(from)) })
    .returning({ id: taxonomyRuns.id })
  void execute(row.id, from, names).catch(async (err) => {
    console.error('[taxonomy] run failed', err)
    await db
      .update(taxonomyRuns)
      .set({ status: 'failed', error: (err as Error).message?.slice(0, 1000) ?? 'Failed' })
      .where(eq(taxonomyRuns.id, row.id))
  })
  return row.id
}

async function execute(id: string, from: FromTaxonomy, names: string[]): Promise<void> {
  const steps = initialSteps(from)
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
    const found =
      from === 'Classic' ? await classicCandidates(names) : await dbxCandidates(from, names, (s) => note(`Searching Databricks… ${s}s`))
    const per = names.map((n) => found.get(n) ?? [])
    await note(`${per.filter((c) => c.length).length} of ${names.length} names found candidates`)
    return per
  })

  const { resolved, model } = await step('match', async (note) => {
    const out = await resolveAll(from, names, candidates)
    await note(out.model ? `Decided by ${out.model}` : 'No model configured: matched by name only')
    return out
  })

  const ids = [...new Set(resolved.flatMap((r) => (r ? [r.id] : [])))]
  const flows = await step('flows', async (note) => {
    if (!ids.length) {
      await note('Nothing matched, so nothing to follow')
      return new Map<string, Flow[]>()
    }
    const products = from === 'Classic' ? await classicProductsFor(ids) : new Map<string, number[]>()
    return dbxFlows(from, ids, products, (s) => note(`Query running… ${s}s`))
  })
  const reported = from === 'Classic' ? await classicReportedFor(ids) : new Map<string, number>()

  const advertisers: AdvertiserResult[] = names.map((input, i) => {
    const entity = resolved[i]
    const r: AdvertiserResult = {
      input,
      entity,
      candidates: candidates[i],
      missing: entity ? undefined : candidates[i].length ? 'candidates were found, none is this advertiser' : 'no name like it',
      flows: entity ? (flows.get(entity.id) ?? []) : [],
      classicReported: entity && from === 'Classic' ? (reported.get(entity.id) ?? 0) : undefined,
      flags: [],
      commentary: '',
    }
    r.flags = computeFlags(r, from)
    return r
  })

  await step('commentary', async (note) => {
    const written = await writeCommentary(from, advertisers)
    for (const a of advertisers) a.commentary = written.get(a.input) ?? fallbackCommentary(a)
    await note(written.size ? 'Written' : 'Summarised without a model')
  })

  const result: RunResult = { version: 2, from, advertisers, model, classicLoadedAt: await classicLoadedAt(), finishedAt: new Date().toISOString() }
  await db.update(taxonomyRuns).set({ status: 'done', result: JSON.stringify(result) }).where(eq(taxonomyRuns.id, id))
}

async function classicLoadedAt(): Promise<string | null> {
  const [loaded] = await db.select({ at: sql<string>`max(${classicSpend.loadedAt})` }).from(classicSpend)
  return loaded?.at ? new Date(loaded.at).toISOString() : null
}

// --- Classic, from the snapshot -------------------------------------------

/**
 * Classic candidates in one query per name: every advertiser with any name —
 * its own, a subsidiary's or a brand's — that matches a pattern once both
 * sides are letters and digits only. A name identical in that form ranks
 * first, then the biggest spender.
 */
async function classicCandidates(names: string[]): Promise<Map<string, Candidate[]>> {
  const out = new Map<string, Candidate[]>()
  const compact = sql`regexp_replace(lower(${classicNames.name}), '[^a-z0-9]', '', 'g')`
  for (const name of names) {
    const key = compactName(name)
    const pats = namePatterns(name)
    if (!pats.length) {
      out.set(name, [])
      continue
    }
    const rows = (await db.execute(sql`
      WITH hits AS (
        SELECT ${classicNames.advertiserId} AS id, ${classicNames.name} AS name, ${classicNames.level} AS level, (${compact} = ${key}) AS exact
        FROM ${classicNames}
        WHERE ${sql.join(pats.map((p) => sql`${compact} LIKE ${p}`), sql` OR `)}
      ),
      best AS (
        SELECT DISTINCT ON (id) id, name, level, exact FROM hits
        ORDER BY id, exact DESC, (level = 'advertiser') DESC
      )
      SELECT b.id, b.name AS matched, b.level, b.exact, s.name, s.spend
      FROM best b
      JOIN (SELECT ${classicSpend.advertiserId} AS id, max(${classicSpend.advertiserName}) AS name, sum(${classicSpend.spend}) AS spend
            FROM ${classicSpend}
            WHERE ${inArray(classicSpend.mediaType, [...MEDIA_TYPES])} AND ${inArray(classicSpend.month, [...MONTHS])}
            GROUP BY ${classicSpend.advertiserId}) s ON s.id = b.id
      ORDER BY b.exact DESC, s.spend DESC
      LIMIT 12`)) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[]
    const list = (Array.isArray(rows) ? rows : (rows.rows ?? [])).map((r) => {
      const spend = Number(r.spend)
      return {
        id: String(r.id),
        name: String(r.name),
        spend,
        weight: spend,
        via: r.level === 'advertiser' ? undefined : `found via ${r.level} "${r.matched}"`,
      }
    })
    out.set(name, list)
  }
  return out
}

async function classicProductsFor(ids: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  const nums = ids.map(Number).filter(Number.isInteger)
  if (!nums.length) return out
  const rows = await db.select().from(classicBrandProducts).where(inArray(classicBrandProducts.advertiserId, nums))
  for (const r of rows) {
    const list = out.get(String(r.advertiserId)) ?? []
    list.push(r.vxProductId)
    out.set(String(r.advertiserId), list)
  }
  return out
}

/** Classic's own Aug–Sep spend for each entity, across the compared media. */
async function classicReportedFor(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const nums = ids.map(Number).filter(Number.isInteger)
  if (!nums.length) return out
  const rows = await db
    .select({ id: classicSpend.advertiserId, spend: sql<number>`sum(${classicSpend.spend})` })
    .from(classicSpend)
    .where(sql`${inArray(classicSpend.advertiserId, nums)} AND ${inArray(classicSpend.mediaType, [...MEDIA_TYPES])} AND ${inArray(classicSpend.month, [...MONTHS])}`)
    .groupBy(classicSpend.advertiserId)
  for (const r of rows) out.set(String(r.id), Number(r.spend))
  return out
}

// --- deciding which entity is the advertiser --------------------------------

const matchSystem = (from: FromTaxonomy) => `You match pasted advertiser names to entities in the ${TAXONOMY_LABEL[from]} media-measurement taxonomy.
For each pasted advertiser you get candidate entities found by name search, each with an id, its name, a size (${
  from === 'Classic' ? 'its Aug–Sep 2026 ad spend' : 'its product count'
}) and sometimes its parent, or the subsidiary or brand name that led to it.
Pick the ONE candidate that is the same real-world advertiser at the ADVERTISER level (the company that buys the media, not a brand or product line), or null when none is.
Rules:
- Same company under a different legal suffix or punctuation is a match.
- Prefer the entity whose name is the advertiser itself over a subsidiary or brand when both exist.
- A namesake in a different business (e.g. "Progressive Lighting" for "Progressive" the insurer) is NOT a match. Use size to tell the real advertiser from a namesake.${
  from === 'Classic'
    ? `
- MediaRadar Classic offers only top-level companies. When the pasted advertiser is a subsidiary there (e.g. GEICO under Berkshire Hathaway, found via company "GEICO"), pick that top company and say in the reason that its spend includes other subsidiaries.`
    : ''
}${
  from === 'VX1'
    ? `
- VX1 offers both advertisers and parent companies (marked "Parent company", ids starting "P"). When the company's spend is spread over brand-named advertisers (Procter & Gamble's brands), the parent company is the match; when one VX1 advertiser carries the company's spend (Progressive), pick that advertiser.`
    : ''
}
- Use only ids you were given. Never invent one.
- For every pick whose name is not identical to the pasted name, give a one-sentence reason a salesperson would understand.
Reply with JSON only: {"matches":[{"input":"<pasted name>","pick":{"id":"…","reason":"…"}|null}]}`

async function resolveAll(from: FromTaxonomy, names: string[], candidates: Candidate[][]): Promise<{ resolved: (Resolved | null)[]; model: string | null }> {
  const byName = names.map((n, i) => byNameOnly(n, candidates[i]))
  if (!resolveProvider()) return { resolved: byName, model: null }

  const prompt = names
    .map((n, i) => {
      const c = candidates[i]
      const lines = [`ADVERTISER: ${n}${c.length ? '' : '  (no candidates)'}`]
      for (const x of c) {
        const size = x.spend != null ? `spend ${money(x.spend)}` : (x.size ?? '')
        lines.push(`  - id=${x.id} | ${x.level ? `${x.level}: ` : ''}${x.name} | ${size}${x.via ? ` | ${x.via}` : ''}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')

  try {
    const { text, model } = await completeJson(matchSystem(from), prompt, { maxTokens: 4000, timeoutMs: 180_000, tier: 'advanced' })
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as {
      matches?: { input?: string; pick?: { id?: string; reason?: string } | null }[]
    }
    const resolved = names.map((n, i) => {
      const m = parsed.matches?.find((x) => x.input?.trim().toLowerCase() === n.toLowerCase()) ?? parsed.matches?.[i]
      if (!m) return byName[i]
      const c = m.pick?.id ? candidates[i].find((x) => x.id === String(m.pick!.id)) : undefined
      if (!c) return null
      const kind = matchKind(n, c.name)
      return { id: c.id, name: c.name, level: c.level, kind, reason: kind === 'exact' ? undefined : m.pick?.reason?.slice(0, 300) }
    })
    return { resolved, model }
  } catch (err) {
    console.error('[taxonomy] model match failed, matching by name', err instanceof ModelError ? err.message : err)
    return { resolved: byName, model: null }
  }
}

/** Without a model: the candidate whose name is the same once normalised, largest first. */
function byNameOnly(name: string, c: Candidate[]): Resolved | null {
  const pick = c
    .filter((x) => normaliseName(x.name) === normaliseName(name))
    .sort((a, b) => (b.weight ?? b.spend ?? 0) - (a.weight ?? a.spend ?? 0))[0]
  return pick ? { id: pick.id, name: pick.name, level: pick.level, kind: matchKind(name, pick.name) } : null
}

// --- commentary ---------------------------------------------------------------

const COMMENTARY_SYSTEM = `You write short commentary on where one advertiser's ad spend lands in GPC, the target taxonomy.
The spend is that of the advertiser's entity in a FROM taxonomy (VX1, VX2 or MediaRadar Classic), Aug–Sep 2026. Its creatives were followed into GPC: you get the GPC advertisers those creatives are assigned to and the GPC taxonomy nodes, with dollars and shares, and computed flags.
Write 2–4 plain sentences per advertiser: how cleanly it maps (one GPC advertiser or several, how much has none), where it sits in the GPC taxonomy, and any match caveat. Use only the numbers given. No preamble, no bullet points.
Reply with JSON only: {"commentary":[{"input":"<pasted name>","text":"…"}]}`

function describe(from: FromTaxonomy, a: AdvertiserResult): string {
  const lines = [`ADVERTISER: ${a.input}`]
  if (!a.entity) return `${lines[0]}\n  not found in ${TAXONOMY_LABEL[from]}`
  const total = flowTotal(a.flows)
  lines.push(`  ${TAXONOMY_LABEL[from]} entity: "${a.entity.name}"${a.entity.level ? ` (${a.entity.level})` : ''}; creative spend ${money(total)}`)
  if (a.classicReported != null) lines.push(`  Classic's own reported spend: ${money(a.classicReported)}`)
  for (const r of rankAdvertisers(a.flows).slice(0, 8)) lines.push(`  GPC advertiser: ${r.label} ${money(r.spend)} (${pct(total ? r.spend / total : 0)})`)
  for (const r of rankNodes(a.flows, 'category').slice(0, 6)) lines.push(`  GPC category: ${r.label} ${money(r.spend)} (${pct(total ? r.spend / total : 0)})`)
  for (const m of MEDIA_TYPES) {
    const t = flowTotal(filterFlows(a.flows, { media: m }))
    if (t) lines.push(`  ${m}: ${money(t)}`)
  }
  for (const f of a.flags) lines.push(`  FLAG: ${f.text}`)
  return lines.join('\n')
}

async function writeCommentary(from: FromTaxonomy, advertisers: AdvertiserResult[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!resolveProvider()) return out
  const prompt = advertisers.map((a) => describe(from, a)).join('\n\n')
  try {
    const { text } = await completeJson(COMMENTARY_SYSTEM, prompt, { maxTokens: 3500, timeoutMs: 180_000, tier: 'advanced' })
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
  if (!a.entity) return 'Not found.'
  const total = flowTotal(a.flows)
  if (!total) return 'No creative spend found in Aug–Sep 2026.'
  const top = rankAdvertisers(a.flows)[0]
  return `${money(total)} of creative spend; ${pct(top.spend / total)} lands on ${top.label} in GPC.`
}

// --- a person picks a different FROM entity ---------------------------------

/**
 * Only a candidate the run's search found may be picked. Its creatives are
 * followed into GPC again, the flags recomputed and the commentary
 * rewritten, and the run's stored result is updated — so the page, the CSV
 * and anyone else opening the run see the choice.
 */
export async function chooseEntity(runId: string, input: string, candidateId: string | null, by: string): Promise<{ error?: string }> {
  const run = await readRun(runId)
  if (!run?.result || run.result.version !== 2) return { error: 'That comparison has not finished.' }
  const from = run.result.from
  const a = run.result.advertisers.find((x) => x.input === input)
  if (!a) return { error: 'That advertiser is not in this comparison.' }

  if (!candidateId) {
    Object.assign(a, { entity: null, missing: `set to none by ${by}`, flows: [], classicReported: undefined })
  } else {
    const c = a.candidates.find((x) => x.id === candidateId)
    if (!c) return { error: 'That entity was not among the candidates found.' }
    const products = from === 'Classic' ? await classicProductsFor([c.id]) : new Map<string, number[]>()
    const flows = await dbxFlows(from, [c.id], products)
    Object.assign(a, {
      entity: { id: c.id, name: c.name, level: c.level, kind: matchKind(input, c.name), chosenBy: by, reason: `chosen by ${by}` },
      missing: undefined,
      flows: flows.get(c.id) ?? [],
      classicReported: from === 'Classic' ? ((await classicReportedFor([c.id])).get(c.id) ?? 0) : undefined,
    })
  }
  a.flags = computeFlags(a, from)
  a.commentary = (await writeCommentary(from, [a])).get(a.input) ?? fallbackCommentary(a)
  await db.update(taxonomyRuns).set({ result: JSON.stringify(run.result) }).where(eq(taxonomyRuns.id, runId))
  return {}
}

export async function readRun(id: string) {
  const [row] = await db.select().from(taxonomyRuns).where(eq(taxonomyRuns.id, id))
  if (!row) return null
  const result = row.result ? (JSON.parse(row.result) as RunResult | { version?: undefined }) : null
  return {
    id: row.id,
    input: parseRunInput(row.input),
    askedBy: row.askedBy,
    status: row.status as 'running' | 'done' | 'failed',
    steps: JSON.parse(row.progress) as Step[],
    /** Null for a run of the earlier side-by-side version: the page asks for it to be run again. */
    result: result && result.version === 2 ? result : null,
    outdated: Boolean(result && result.version !== 2),
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  }
}

export type RunView = NonNullable<Awaited<ReturnType<typeof readRun>>>

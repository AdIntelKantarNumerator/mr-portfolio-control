/**
 * Cost Analysis (Scott, 16 November 2026): what a decision does to cloud cost.
 *
 * Not a cost tracker. Datadog is the tracker; this takes a typical day from it,
 * pins each dollar to a component on the Workflow map, and asks what happens
 * when a decision changes the volume a component handles or the price it pays
 * per item. Pure: no database, no network, so the page and the tests read the
 * same arithmetic.
 *
 *   1. Map the bill   A Datadog cost line (GCP project) names the component it
 *                     pays for. Anything unmatched is Unallocated, so the total
 *                     always agrees with Datadog.
 *   2. Baseline       The typical day: the mean of the last seven complete days.
 *   3. Drivers        Each component's cost moves with one driver (new
 *                     creatives, or sports games), or with none.
 *   4. Levers         A decision scales a driver or a rate. Most levers are
 *                     percentages, so they work before anyone has supplied an
 *                     absolute volume.
 *
 * Replaces the csuite-costs branch's model: medium is not a cost lane here
 * (classification, dedup and serving are shared by every medium), and nothing
 * is priced from AWS list prices, which is not where we run.
 */

export type Driver = 'creatives' | 'games' | 'none'
export type Lifecycle = 'go-forward' | 'parallel' | 'eliminating'

export interface CostComponent {
  key: string
  name: string
  /** The component's name on the Workflow map, or null when it is billed but not drawn there. */
  mapName: string | null
  /** GCP project names, after "MLT Prod " / "DL Prod ", that bill to this component. */
  projects: string[]
  driver: Driver
  /** Its AI calls could wait for a batch job, so the batch lever applies. */
  batchable: boolean
  lifecycle: Lifecycle
}

/**
 * Datadog → map. Project names are from the GCP billing lines Datadog reports
 * (Cloud Cost Explorer, 13 November 2026). Matching ignores case, spaces and
 * punctuation, because Datadog's tag values normalise them.
 */
export const COST_COMPONENTS: CostComponent[] = [
  { key: 'dedupe', name: 'Fingerprint Dedupe', mapName: 'Fingerprint Dedupe', projects: ['Deduplication'], driver: 'creatives', batchable: true, lifecycle: 'go-forward' },
  { key: 'gpcce', name: 'GPC Class Engine', mapName: 'GPC Class Engine', projects: ['Global Product Cat'], driver: 'creatives', batchable: true, lifecycle: 'go-forward' },
  { key: 'vx0ce', name: 'VX0 Class Engine', mapName: 'VX0 Class Engine', projects: ['Classification Engine'], driver: 'creatives', batchable: true, lifecycle: 'parallel' },
  { key: 'logo', name: 'Logo Recognition (Live Sports)', mapName: 'Logo Recognition Engine', projects: ['Live Sports'], driver: 'games', batchable: false, lifecycle: 'go-forward' },
  { key: 'variant', name: 'Variant Detection', mapName: null, projects: ['Variant Detection'], driver: 'creatives', batchable: true, lifecycle: 'go-forward' },
  { key: 'nsfw', name: 'NSFW Classifier', mapName: 'NSFW Classifier', projects: ['NSFW'], driver: 'creatives', batchable: true, lifecycle: 'go-forward' },
  { key: 'junk', name: 'JunkAd Classifier', mapName: 'JunkAd Classifier', projects: ['Junk Ads Detector'], driver: 'creatives', batchable: true, lifecycle: 'go-forward' },
  { key: 'vxmap', name: 'Legacy Taxonomy Mapping', mapName: 'VX0 → VX1 / VX2 / MR Mapping', projects: ['Legacy Taxonomy Mappn'], driver: 'creatives', batchable: true, lifecycle: 'go-forward' },
  { key: 'agents', name: 'Agentic Platform', mapName: 'Agentic Experience', projects: ['Agentic Platform'], driver: 'none', batchable: false, lifecycle: 'go-forward' },
]

export const UNALLOCATED = 'unallocated'

export type Env = 'prod' | 'dev'

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Which component and environment a GCP project bills to. "MLT Prod
 * Deduplication" → dedupe, prod. A project with no Prod/Dev marker counts as
 * prod; one that matches nothing is Unallocated.
 */
export function matchProject(project: string): { key: string; env: Env } {
  const s = squash(project)
  const env: Env = /(^|mlt|dl)dev/.test(s) ? 'dev' : 'prod'
  for (const c of COST_COMPONENTS) {
    if (c.projects.some((p) => s.endsWith(squash(p)))) return { key: c.key, env }
  }
  return { key: UNALLOCATED, env }
}

export interface CostRow {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string
  project: string
  cost: number
}

export interface ComponentDay {
  key: string
  /** Mean cost per day over the window, production only. */
  perDay: number
  /** Cost for each day of the window, oldest first. */
  days: number[]
}

export interface Baseline {
  /** The days averaged, oldest first. */
  window: string[]
  components: ComponentDay[]
  /** Unmatched production projects, by project, so Unallocated can be read. */
  unallocated: { project: string; perDay: number }[]
  /** Development projects, all components together. */
  devPerDay: number
  total: number
}

const DAY = 86_400_000
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

/**
 * The typical day. GCP billing reaches Datadog one to two days late, so the
 * window ends `lagDays` before `today` and runs seven days back from there:
 * a whole week, so the weekend pattern (sports up, GPC billed on Sunday) is in
 * it once.
 */
export function typicalDay(rows: CostRow[], today: string, lagDays = 2, windowDays = 7): Baseline {
  const last = addDays(today, -lagDays)
  const window = Array.from({ length: windowDays }, (_, i) => addDays(last, i - windowDays + 1))
  const at = new Map(window.map((d, i) => [d, i]))

  const byKey = new Map<string, number[]>()
  const byProject = new Map<string, number>()
  let dev = 0
  for (const r of rows) {
    const i = at.get(r.day)
    if (i === undefined || !Number.isFinite(r.cost)) continue
    const { key, env } = matchProject(r.project)
    if (env === 'dev') {
      dev += r.cost
      continue
    }
    if (key === UNALLOCATED) {
      byProject.set(r.project, (byProject.get(r.project) ?? 0) + r.cost)
      continue
    }
    const days = byKey.get(key) ?? Array(windowDays).fill(0)
    days[i] += r.cost
    byKey.set(key, days)
  }

  const components = COST_COMPONENTS.filter((c) => byKey.has(c.key)).map((c) => {
    const days = byKey.get(c.key)!
    return { key: c.key, perDay: days.reduce((a, b) => a + b, 0) / windowDays, days }
  })
  const unallocated = [...byProject]
    .map(([project, sum]) => ({ project, perDay: sum / windowDays }))
    .filter((u) => u.perDay >= 0.5)
    .sort((a, b) => b.perDay - a.perDay)
  const total = components.reduce((a, c) => a + c.perDay, 0) + unallocated.reduce((a, u) => a + u.perDay, 0)
  return { window, components, unallocated, devPerDay: dev / windowDays, total }
}

// ---- Levers ----------------------------------------------------------------

export interface Levers {
  /** More (or fewer) new creatives a day, in percent: new coverage. */
  coveragePct: number
  /** Past months of creatives to run through classify and dedup once. */
  historyMonths: number
  /** Multiplier on dedup's cost per creative (see DEDUP_OPTIONS). */
  dedupFactor: number
  /** Run batchable AI through batch jobs. */
  batch: boolean
  /** End the VX0 Classification Engine parallel run. */
  retireParallel: boolean
  /** More (or fewer) live sports games, in percent. */
  gamesPct: number
}

export const NO_CHANGE: Levers = { coveragePct: 0, historyMonths: 0, dedupFactor: 1, batch: false, retireParallel: false, gamesPct: 0 }

/**
 * Assumptions the levers rest on. Each is shown on the page beside the number
 * it moves, because none of them is measured yet.
 */
export const ASSUMPTIONS = {
  /** Batch price as a share of online. Vertex AI quotes about half; not yet checked against our contract. */
  batchShare: 0.5,
  /** One past month holds about as many creatives as a current month. */
  historyMonthVsNow: 1,
  daysPerMonth: 30.4,
}

/** Dedup method → cost per creative against today's. From the 13 Nov GCP AI cost review (60–80% saving). */
export const DEDUP_OPTIONS: { factor: number; label: string; hint: string }[] = [
  { factor: 1, label: 'As today', hint: 'Gemini 3.5 Flash and 2.5 Flash with thinking, some 2.5 Pro' },
  { factor: 0.45, label: 'Flash Lite', hint: 'A smaller model with thinking off: about 55% cheaper per creative (estimate)' },
  { factor: 0.25, label: '+ pre-filter', hint: 'Fingerprint or embedding pre-filter before the model: about 75% cheaper (estimate)' },
  { factor: 1.6, label: 'Deeper', hint: 'More candidate matches checked per creative: about 60% more per creative (estimate)' },
]

export interface ScenarioRow {
  key: string
  base: number
  next: number
  /** One-time cost of the history lever for this component. */
  oneTime: number
}

export interface Scenario {
  rows: ScenarioRow[]
  baseDay: number
  nextDay: number
  /** Change in yearly run rate. */
  runRateDelta: number
  oneTime: number
}

const byKey = new Map(COST_COMPONENTS.map((c) => [c.key, c]))
export const costComponent = (key: string) => byKey.get(key)

/**
 * What the levers do to the baseline. A component's cost per day is
 * rate × volume: coverage and games scale volume, dedup method and batch scale
 * rate, retiring the parallel run sets it to zero. History is one-time: past
 * months of creatives at the scenario's rate, so batching a backfill shows up
 * as a cheaper backfill. Unallocated cost does not move.
 */
export function scenario(baseline: Pick<Baseline, 'components' | 'unallocated'>, levers: Levers): Scenario {
  const rows: ScenarioRow[] = baseline.components.map((c) => {
    const def = byKey.get(c.key)
    let rate = 1
    let volume = 1
    if (def) {
      if (def.key === 'dedupe') rate *= levers.dedupFactor
      if (levers.batch && def.batchable) rate *= ASSUMPTIONS.batchShare
      if (def.driver === 'creatives') volume *= 1 + levers.coveragePct / 100
      if (def.driver === 'games') volume *= 1 + levers.gamesPct / 100
    }
    const off = levers.retireParallel && def?.lifecycle === 'parallel'
    const next = off ? 0 : Math.max(0, c.perDay * rate * volume)
    const oneTime =
      !off && def?.driver === 'creatives'
        ? c.perDay * rate * ASSUMPTIONS.daysPerMonth * ASSUMPTIONS.historyMonthVsNow * levers.historyMonths
        : 0
    return { key: c.key, base: c.perDay, next, oneTime }
  })
  const fixed = baseline.unallocated.reduce((a, u) => a + u.perDay, 0)
  const baseDay = rows.reduce((a, r) => a + r.base, 0) + fixed
  const nextDay = rows.reduce((a, r) => a + r.next, 0) + fixed
  return {
    rows,
    baseDay,
    nextDay,
    runRateDelta: (nextDay - baseDay) * 365,
    oneTime: rows.reduce((a, r) => a + r.oneTime, 0),
  }
}

/**
 * What else a change reaches on the map, not priced: components downstream of
 * the ones whose cost moved, up to `depth` links away.
 */
export function downstream(start: string[], links: { from: string; to: string }[], depth = 2): Set<string> {
  const out = new Map<string, string[]>()
  for (const l of links) out.set(l.from, [...(out.get(l.from) ?? []), l.to])
  const seen = new Set(start)
  let frontier = start
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const to of out.get(id) ?? []) {
        if (seen.has(to)) continue
        seen.add(to)
        next.push(to)
      }
    }
    frontier = next
  }
  for (const s of start) seen.delete(s)
  return seen
}

// ---- Snapshot ----------------------------------------------------------------

/**
 * What the page shows until Datadog is connected: production GCP AI cost per
 * day, 5–11 November 2026, read from Datadog for the 13 November GCP AI cost
 * review. Five components only; the other GCP AI projects (about $150–300 a
 * day) were not split by day in that review, so they are left out rather than
 * guessed.
 */
export const SNAPSHOT_TODAY = '2026-11-13'
const SNAPSHOT_DAYS: Record<string, number[]> = {
  'MLT Prod Global Product Cat': [1030, 913, 2, 1510, 653, 637, 774],
  'MLT Prod Classification Engine': [726, 680, 0, 1260, 482, 468, 608],
  'MLT Prod Deduplication': [982, 959, 776, 1050, 856, 768, 795],
  'DL Prod Variant Detection': [289, 267, 234, 229, 278, 299, 262],
  'MLT Prod Live Sports': [159, 111, 691, 1130, 229, 49, 232],
}
export const SNAPSHOT_ROWS: CostRow[] = Object.entries(SNAPSHOT_DAYS).flatMap(([project, days]) =>
  days.map((cost, i) => ({ day: addDays('2026-11-05', i), project, cost })),
)

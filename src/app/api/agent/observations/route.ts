/**
 * Where an agent writes what it observed.
 *
 *   POST /api/agent/observations
 *
 * Protected by SYNC_TOKEN.
 *
 * TWO THINGS THIS ENFORCES, RATHER THAN TRUSTING THE CALLER TO
 *
 * 1. Citations resolve. A bullet citing an evidence id that is not in the
 *    payload is dropped here, not just at the agent. The agent already does
 *    this; doing it again is cheap, and the day someone points a different
 *    agent at this endpoint it is the only thing standing between the portfolio
 *    and confident fiction.
 *
 * 2. Machine-written is recorded as machine-written. An assessment posted here
 *    is stored with `authoredBy` set to the agent's name and `reviewedBy` null.
 *    There is no field in this payload that lets a caller claim otherwise.
 *
 * The response says what was dropped and why. A caller that silently loses half
 * its bullets learns nothing; one that gets told will get fixed.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { agentObservations, assessments, initiatives, projects } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = new Set(['progress', 'blocker', 'decision_needed', 'decision_made', 'risk', 'change'])
const AUDIENCES = new Set(['engineering', 'stakeholder'])
const RAGS = new Set(['green', 'amber', 'red', 'unknown'])
const ENTITY_TYPES = new Set(['initiative', 'project'])

interface Incoming {
  entityType?: string
  entityId?: string
  agent?: string
  bullets?: Array<{ kind?: string; audience?: string; text?: string; citations?: string[] }>
  recent?: Array<{ text?: string; citations?: string[]; at?: string | null; source?: string | null }>
  activity?: { score?: number; windowHours?: number; count?: number } | null
  health?: { rag?: string; confidence?: string; rationale?: string; citations?: string[] } | null
  evidence?: Array<{ id?: string; source?: string; title?: string; url?: string | null; occurredAt?: string | null }>
  model?: string
  servedBy?: string | null
  generatedAt?: string
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  let body: Incoming
  try {
    body = (await req.json()) as Incoming
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const entityType = String(body.entityType ?? '')
  const entityId = String(body.entityId ?? '')
  if (!ENTITY_TYPES.has(entityType) || !entityId) {
    return Response.json(
      { error: 'entityType must be "initiative" or "project", and entityId is required.' },
      { status: 400 },
    )
  }

  const agent = (body.agent ?? 'yaara').slice(0, 64)
  const dropped: string[] = []

  // Evidence first — it is what everything else is checked against.
  const evidence = (body.evidence ?? [])
    .filter((e) => e?.id && e?.title)
    .map((e) => ({
      id: String(e.id),
      source: String(e.source ?? 'unknown'),
      title: String(e.title).slice(0, 300),
      url: e.url ? String(e.url) : null,
      occurredAt: e.occurredAt ? String(e.occurredAt) : null,
    }))
  const known = new Set(evidence.map((e) => e.id))

  const items = []
  for (const b of body.bullets ?? []) {
    const kind = String(b?.kind ?? '')
    const audience = String(b?.audience ?? '')
    const text = String(b?.text ?? '').trim()
    const citations = (b?.citations ?? []).map(String).filter((c) => known.has(c))

    if (!KINDS.has(kind)) { dropped.push(`bullet with unknown kind "${kind}"`); continue }
    if (!AUDIENCES.has(audience)) { dropped.push(`bullet with unknown audience "${audience}"`); continue }
    if (!text) continue
    if (citations.length === 0) { dropped.push(`uncited bullet: "${text.slice(0, 50)}…"`); continue }

    items.push({ kind, audience, text: text.slice(0, 600), citations })
    if (items.length >= 12) break
  }

  // What happened, held to the same bar as a bullet. An uncited line here is
  // the "progress was made" filler that makes a front page worthless.
  const recent = (body.recent ?? [])
    .map((r) => ({
      text: String(r?.text ?? '').trim().slice(0, 200),
      citations: (r?.citations ?? []).map(String).filter((c) => known.has(c)),
      at: r?.at ? String(r.at) : null,
      source: r?.source ? String(r.source) : null,
    }))
    .filter((r) => {
      if (!r.text) return false
      if (r.citations.length === 0) {
        dropped.push(`uncited recent line: "${r.text.slice(0, 50)}…"`)
        return false
      }
      return true
    })
    .slice(0, 3)

  // The score is arithmetic the caller did, and it is clamped rather than
  // trusted: a front page ordered by an unbounded number a caller supplies is
  // one bad payload away from one project pinned to the top forever.
  const rawScore = Number(body.activity?.score ?? 0)
  const activityScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(rawScore, 1000)) : 0
  const rawWindow = Number(body.activity?.windowHours ?? 0)
  const activityWindowHours =
    Number.isFinite(rawWindow) && rawWindow > 0 ? Math.min(Math.round(rawWindow), 8760) : null

  const generatedAt = body.generatedAt ? new Date(body.generatedAt) : new Date()
  const model = String(body.model ?? 'unknown').slice(0, 200)

  // Only the newest observation per entity is shown; older ones stay as history.
  await db
    .update(agentObservations)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(agentObservations.entityType, entityType),
        eq(agentObservations.entityId, entityId),
        eq(agentObservations.agent, agent),
      ),
    )

  const [row] = await db
    .insert(agentObservations)
    .values({
      entityType,
      entityId,
      agent,
      items: JSON.stringify(items),
      recent: JSON.stringify(recent),
      activityScore,
      activityWindowHours,
      evidence: JSON.stringify(evidence),
      model,
      servedBy: body.servedBy ? String(body.servedBy) : null,
      generatedAt: Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt,
    })
    .returning()

  // The health call, if one survives the same checks.
  let assessmentWritten = false
  const h = body.health
  if (h) {
    const rag = String(h.rag ?? '')
    const rationale = String(h.rationale ?? '').trim()
    const citations = (h.citations ?? []).map(String).filter((c) => known.has(c))

    if (!RAGS.has(rag)) dropped.push(`health call with unknown rag "${rag}"`)
    else if (!rationale) dropped.push('health call with no rationale')
    else if (citations.length === 0 && rag !== 'unknown') dropped.push('uncited health call')
    else {
      await db
        .update(assessments)
        .set({ current: false })
        .where(
          and(
            eq(assessments.entityType, entityType),
            eq(assessments.entityId, entityId),
            eq(assessments.authoredBy, agent),
            eq(assessments.current, true),
          ),
        )

      await db.insert(assessments).values({
        entityType,
        entityId,
        rag,
        confidence: ['low', 'medium', 'high'].includes(String(h.confidence)) ? String(h.confidence) : 'medium',
        rationale: rationale.slice(0, 2000),
        evidence: citations.join(', '),
        asOf: generatedAt,
        // The flag that keeps this honest. Nothing in the payload can set it.
        authoredBy: agent,
        reviewedBy: null,
        reviewedAt: null,
        current: true,
      })
      assessmentWritten = true
    }
  }

  return Response.json({
    id: row?.id ?? null,
    bullets: items.length,
    recent: recent.length,
    activityScore,
    assessment: assessmentWritten,
    dropped,
  })
}

/**
 * What has already been concluded, so it does not have to be concluded again.
 *
 *   GET /api/agent/observations?name=Ratings
 *
 * Asking "what is the status of X" used to mean listing the whole portfolio,
 * reading every source, and re-deriving an answer that had been written down an
 * hour earlier — four model round trips and a minute of waiting to reproduce
 * something already stored here.
 *
 * The portfolio is the system of record. Reading it back is one call, and it
 * also means the answer in Slack is the same answer on the screen rather than a
 * second opinion that happens to be close.
 */
export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const needle = (new URL(req.url).searchParams.get('name') ?? '').trim().toLowerCase()

  const [rows, current, inits, projs] = await Promise.all([
    db
      .select()
      .from(agentObservations)
      .where(isNull(agentObservations.supersededAt))
      .orderBy(desc(agentObservations.generatedAt)),
    db.select().from(assessments).where(eq(assessments.current, true)).orderBy(desc(assessments.asOf)),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives),
    db.select({ id: projects.id, name: projects.name }).from(projects),
  ])

  const nameOf = new Map<string, string>([
    ...inits.map((i) => [`initiative:${i.id}`, i.name] as const),
    ...projs.map((p) => [`project:${p.id}`, p.name] as const),
  ])

  const assessmentFor = new Map<string, (typeof current)[number]>()
  for (const a of current) {
    const key = `${a.entityType}:${a.entityId}`
    if (!assessmentFor.has(key)) assessmentFor.set(key, a)
  }

  const seen = new Set<string>()
  const observations = []

  for (const r of rows) {
    const key = `${r.entityType}:${r.entityId}`
    if (seen.has(key)) continue
    seen.add(key)

    const entityName = nameOf.get(key) ?? null
    if (needle && !entityName?.toLowerCase().includes(needle)) continue

    const a = assessmentFor.get(key)
    let items: unknown = []
    try {
      items = JSON.parse(r.items)
    } catch {
      items = []
    }

    observations.push({
      entityType: r.entityType,
      entityId: r.entityId,
      entityName,
      items,
      model: r.model,
      generatedAt: r.generatedAt.toISOString(),
      ageHours: Math.round((Date.now() - r.generatedAt.getTime()) / 3_600_000),
      health: a
        ? {
            rag: a.rag,
            confidence: a.confidence,
            rationale: a.rationale,
            asOf: a.asOf.toISOString(),
            authoredBy: a.authoredBy,
            reviewed: Boolean(a.reviewedAt),
          }
        : null,
    })
  }

  return Response.json({ observations })
}

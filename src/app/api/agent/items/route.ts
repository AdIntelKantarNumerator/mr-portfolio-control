/**
 * Blockers, decisions and action items, for Yaara to follow up.
 *
 *   GET  /api/agent/items?scope=project:<id>&status=open|all&active=1&unscored=1&owner=<name>&kind=blocker,action
 *        → { items: [...] }  open by default; the newest 400
 *   GET  /api/agent/items?ref=A269
 *        → { items: [one], history: [...] }  open or closed, however old, with every event
 *   POST /api/agent/items  { updates: [{ ref, action, note?, source?, duplicateOf?, owner?, factors?, reasons?, delta? }], agent? }
 *        → { results: [{ ref, ok, error?, status?, score? }] }
 *
 * Protected by SYNC_TOKEN.
 *
 * WHY THIS EXISTS (5 October 2026)
 *
 * Yaara could create register entries only from a document she cited, could
 * close an action item only when someone told her in chat, and could not
 * resolve, withdraw, re-own, merge or score anything. So items were written
 * and never closed: 10 of 251 action items, 11 of 71 blockers. This is the
 * route she follows them up through, with whatever evidence she has - a
 * Slack message, a merged pull request, a closed Linear ticket, a reply to a
 * reminder - and it records each change the way a person's change is recorded
 * (lib/items.ts applyItemUpdate).
 *
 * actions: resolve | drop | reopen | progress | duplicate | owner | score | adjust | nudged
 */
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { applyItemUpdate, inScope, itemHistory, itemPath, loadItems, scopeIds, type ItemAction, type ItemUpdate } from '@/lib/items'
import { parseScope } from '@/lib/hierarchy'
import type { ItemKind } from '@/lib/importance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS = new Set<ItemAction>(['resolve', 'drop', 'reopen', 'progress', 'duplicate', 'owner', 'score', 'adjust', 'nudged', 'hold'])
const KINDS = new Set<ItemKind>(['blocker', 'decision', 'action'])

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const q = new URL(req.url).searchParams

  const kinds = (q.get('kind') ?? '').split(',').map((k) => k.trim()).filter((k): k is ItemKind => KINDS.has(k as ItemKind))
  const ref = q.get('ref')?.trim().toUpperCase()
  // One item by ref, open or closed, however old: "where did A269 come
  // from?" (7 October 2026). She could list items but not look one up, so she
  // answered that she had no idea, with the meeting notes on record.
  const all = q.get('status') === 'all' || Boolean(ref)
  let items = await loadItems({
    kinds: kinds.length ? kinds : undefined,
    closedSince: ref ? new Date(0) : all ? new Date(Date.now() - 30 * 86_400_000) : null,
  })
  if (ref) items = items.filter((i) => i.ref.toUpperCase() === ref)

  const scope = parseScope(q.get('scope'))
  if (scope) items = inScope(items, await scopeIds(scope.level, scope.id))
  if (!all) items = items.filter((i) => i.open)
  if (q.get('active') === '1') items = items.filter((i) => !i.inactive)
  if (q.get('unscored') === '1') items = items.filter((i) => i.score == null)
  const owner = q.get('owner')?.trim().toLowerCase()
  if (owner) items = items.filter((i) => (i.ownerName ?? '').toLowerCase().includes(owner))

  items.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
  const history = ref && items[0] ? (await itemHistory(items[0].ref)).map((e) => ({ ...e, at: e.at.toISOString() })) : undefined
  return Response.json({
    ...(history ? { history } : {}),
    items: items.slice(0, 400).map((i) => ({
      ref: i.ref,
      kind: i.kind,
      title: i.title,
      body: i.body ? i.body.slice(0, 600) : null,
      status: i.status,
      open: i.open,
      inactive: i.inactive,
      owner: i.ownerName,
      placeOwner: i.placeOwner,
      places: i.places,
      createdAt: i.createdAt.toISOString(),
      lastActivityAt: i.lastActivityAt.toISOString(),
      closedAt: i.closedAt?.toISOString() ?? null,
      dueDate: i.dueDate?.toISOString() ?? null,
      heldUntil: i.heldUntil ? i.heldUntil.toISOString().slice(0, 10) : null,
      score: i.score,
      band: i.band,
      factors: i.factors,
      mentions: i.mentions,
      nudgedAt: i.nudgedAt?.toISOString() ?? null,
      source: i.sourceTitle,
      // Where it was raised, when there is a link, and the page showing just
      // this item: both go in the morning reminders.
      sourceUrl: i.sourceUrl,
      raisedBy: i.raisedBy,
      path: itemPath(i),
    })),
  })
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  let body: { updates?: unknown; agent?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'The body is not JSON.' }, { status: 400 })
  }
  const list = Array.isArray(body.updates) ? body.updates.slice(0, 200) : []
  if (!list.length) return Response.json({ error: 'Send updates: [{ ref, action, ... }].' }, { status: 400 })
  const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim().slice(0, 60) : 'Yaara'

  const results = []
  for (const raw of list) {
    const u = raw as Record<string, unknown>
    const ref = typeof u.ref === 'string' ? u.ref.trim() : ''
    const action = String(u.action ?? '') as ItemAction
    if (!ref || !ACTIONS.has(action)) {
      results.push({ ref, ok: false, error: `Each update needs a ref and one of: ${[...ACTIONS].join(', ')}.` })
      continue
    }
    const source = (u.source ?? null) as { title?: unknown; url?: unknown } | null
    const update: ItemUpdate = {
      ref,
      action,
      // Whose words, when it came from a person through her ("Priya, by Slack
      // reply"); otherwise hers.
      actor: typeof u.actor === 'string' && u.actor.trim() ? u.actor.trim().slice(0, 200) : agent,
      note: typeof u.note === 'string' ? u.note.slice(0, 1000) : null,
      source: source ? { title: typeof source.title === 'string' ? source.title : null, url: typeof source.url === 'string' ? source.url : null } : null,
      duplicateOf: typeof u.duplicateOf === 'string' ? u.duplicateOf : null,
      owner: typeof u.owner === 'string' ? u.owner : null,
      factors: Array.isArray(u.factors) ? u.factors.map(String) : null,
      reasons: Array.isArray(u.reasons)
        ? u.reasons.map((r) => r as Record<string, unknown>).map((r) => ({
            factor: String(r.factor ?? ''),
            why: String(r.why ?? '').slice(0, 300),
            quote: typeof r.quote === 'string' ? r.quote.slice(0, 300) : null,
            source: typeof r.source === 'string' ? r.source.slice(0, 200) : null,
            url: typeof r.url === 'string' ? r.url.slice(0, 500) : null,
          }))
        : null,
      delta: typeof u.delta === 'number' ? u.delta : null,
      until: typeof u.until === 'string' && u.until.trim() ? u.until.trim() : null,
      quiet: u.quiet === true,
    }
    try {
      results.push(await applyItemUpdate(update))
    } catch (err) {
      results.push({ ref, ok: false, error: (err as Error).message.slice(0, 300) })
    }
  }
  return Response.json({ results })
}

/**
 * The yaara_chats relay: a question goes in from the chat screen, Yaara takes
 * it out, and her progress and answer come back the same way.
 *
 * WAITING WITHOUT POLLING HARD
 *
 * Two things wait here: Yaara, for a question, and the chat screen, for her
 * answer. Both are woken by an in-process signal the moment a row changes, so
 * neither depends on a polling interval for speed. Both also re-read the table
 * every couple of seconds regardless, because App Service can run more than one
 * instance and a signal only reaches the instance that sent it. The database is
 * the truth; the signal only makes it arrive sooner.
 *
 * CLAIMING
 *
 * A question is claimed with a conditional update (status still 'queued'), so
 * if two of Yaara's workers ask at the same moment exactly one gets it. No
 * row locks, which keeps this the same on PGlite and on Postgres.
 */
import { EventEmitter } from 'node:events'
import { and, asc, eq, lt } from 'drizzle-orm'
import { db } from '@/db/client'
import { yaaraChats } from '@/db/schema'
import type { Asker, Turn } from './yaara-chat'

type ChatRow = typeof yaaraChats.$inferSelect
export type ChatStatus = 'queued' | 'working' | 'answered' | 'failed' | 'abandoned'

/** Kept on globalThis so a dev-server reload does not strand waiters on an old emitter. */
const bus: EventEmitter = ((globalThis as { __yaaraChatBus?: EventEmitter }).__yaaraChatBus ??= (() => {
  const e = new EventEmitter()
  e.setMaxListeners(200)
  return e
})())

const KEEP_FOR_MS = 2 * 86_400_000

/** Resolve on the named signal or after `ms`, whichever is first. */
function waitFor(event: string, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      bus.off(event, done)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    bus.once(event, done)
    signal?.addEventListener('abort', done, { once: true })
  })
}

export async function enqueueChat(asker: Asker, chatId: string | null, turns: Turn[]): Promise<string> {
  // Housekeeping on the way in: nothing here is worth keeping past two days.
  await db.delete(yaaraChats).where(lt(yaaraChats.askedAt, new Date(Date.now() - KEEP_FOR_MS)))
  const [row] = await db
    .insert(yaaraChats)
    .values({ askedByEmail: asker.email, askedByName: asker.name, chatId, messages: JSON.stringify(turns) })
    .returning({ id: yaaraChats.id })
  bus.emit('queued')
  return row!.id
}

export interface ClaimedChat {
  id: string
  askedAt: string
  askedBy: Asker
  chatId: string | null
  messages: Turn[]
}

async function claimOne(): Promise<ClaimedChat | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [next] = await db
      .select({ id: yaaraChats.id })
      .from(yaaraChats)
      .where(eq(yaaraChats.status, 'queued'))
      .orderBy(asc(yaaraChats.askedAt))
      .limit(1)
    if (!next) return null
    const [row] = await db
      .update(yaaraChats)
      .set({ status: 'working', claimedAt: new Date() })
      .where(and(eq(yaaraChats.id, next.id), eq(yaaraChats.status, 'queued')))
      .returning()
    if (row) {
      bus.emit(`chat:${row.id}`)
      return {
        id: row.id,
        askedAt: row.askedAt.toISOString(),
        askedBy: { email: row.askedByEmail, name: row.askedByName },
        chatId: row.chatId,
        messages: JSON.parse(row.messages) as Turn[],
      }
    }
    // Somebody else claimed it between the read and the update. Try the next.
  }
  return null
}

/** The oldest waiting question, waiting up to `ms` for one to arrive. */
export async function claimNextChat(ms: number, signal?: AbortSignal): Promise<ClaimedChat | null> {
  const deadline = Date.now() + ms
  for (;;) {
    const claimed = await claimOne()
    if (claimed) return claimed
    const left = deadline - Date.now()
    if (left <= 0 || signal?.aborted) return null
    await waitFor('queued', Math.min(left, 2_000), signal)
  }
}

export async function readChat(id: string): Promise<ChatRow | null> {
  const [row] = await db.select().from(yaaraChats).where(eq(yaaraChats.id, id))
  return row ?? null
}

/** Wait for anything to happen to one chat, or `ms`. */
export function waitForChat(id: string, ms: number, signal?: AbortSignal): Promise<void> {
  return waitFor(`chat:${id}`, ms, signal)
}

/** Append a progress note. Ignored once the chat is no longer being worked on. */
export async function addProgress(id: string, note: string): Promise<boolean> {
  const row = await readChat(id)
  if (!row || row.status !== 'working') return false
  const progress = [...(JSON.parse(row.progress) as string[]), note.slice(0, 300)].slice(-40)
  await db.update(yaaraChats).set({ progress: JSON.stringify(progress) }).where(and(eq(yaaraChats.id, id), eq(yaaraChats.status, 'working')))
  bus.emit(`chat:${id}`)
  return true
}

/**
 * Record the answer, or why there is none. Returns false when the person has
 * already stopped waiting, so Yaara can tell an answer that reached somebody
 * from one that did not.
 */
export async function finishChat(
  id: string,
  outcome: { reply: string; model?: string | null; servedBy?: string | null } | { error: string },
): Promise<boolean> {
  const values =
    'error' in outcome
      ? { status: 'failed', error: outcome.error.slice(0, 2000), finishedAt: new Date() }
      : { status: 'answered', reply: outcome.reply, model: outcome.model ?? null, servedBy: outcome.servedBy ?? null, finishedAt: new Date() }
  const [row] = await db
    .update(yaaraChats)
    .set(values)
    .where(and(eq(yaaraChats.id, id), eq(yaaraChats.status, 'working')))
    .returning({ id: yaaraChats.id })
  bus.emit(`chat:${id}`)
  return Boolean(row)
}

/** The person stopped waiting, or the wait ran out. */
export async function abandonChat(id: string, why: string): Promise<void> {
  await db
    .update(yaaraChats)
    .set({ status: 'abandoned', error: why, finishedAt: new Date() })
    .where(and(eq(yaaraChats.id, id), eq(yaaraChats.status, 'queued')))
  await db
    .update(yaaraChats)
    .set({ status: 'abandoned', error: why, finishedAt: new Date() })
    .where(and(eq(yaaraChats.id, id), eq(yaaraChats.status, 'working')))
  bus.emit(`chat:${id}`)
}

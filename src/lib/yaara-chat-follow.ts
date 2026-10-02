/**
 * Following one queued question until Yaara has answered it.
 *
 * Shared by the two windows that ask her: Open WebUI's OpenAI-shaped route
 * and the chat panel inside the portfolio. Each turns these events into its
 * own stream format; the waiting, the time limits and the "she is not
 * picking up" cases are the same, so they live here once.
 *
 * Re-reads the row on every wake-up rather than trusting the signal, because
 * the signal only reaches this instance (lib/yaara-chat-store.ts).
 */
import { ANSWER_TIMEOUT_MS, CLAIM_TIMEOUT_MS, unansweredText } from './yaara-chat'
import { abandonChat, readChat, waitForChat } from './yaara-chat-store'

export type FollowEvent = { type: 'progress'; note: string } | { type: 'reply'; text: string } | { type: 'idle' }

export async function* followChat(id: string, signal: AbortSignal): AsyncGenerator<FollowEvent> {
  const started = Date.now()
  let seen = 0
  for (;;) {
    const row = await readChat(id)
    if (!row) {
      yield { type: 'reply', text: unansweredText('failed', 'the question was lost before I saw it') }
      return
    }
    const progress = JSON.parse(row.progress) as string[]
    for (; seen < progress.length; seen++) yield { type: 'progress', note: progress[seen]! }

    if (row.status === 'answered') {
      yield { type: 'reply', text: row.reply ?? '' }
      return
    }
    if (row.status === 'failed') {
      yield { type: 'reply', text: unansweredText('failed', row.error) }
      return
    }
    if (row.status === 'abandoned') {
      yield { type: 'reply', text: unansweredText('timeout') }
      return
    }
    if (row.status === 'queued' && Date.now() - row.askedAt.getTime() > CLAIM_TIMEOUT_MS) {
      await abandonChat(id, 'Nobody collected the question.')
      yield { type: 'reply', text: unansweredText('unclaimed') }
      return
    }
    if (Date.now() - started > ANSWER_TIMEOUT_MS) {
      await abandonChat(id, 'The chat stopped waiting.')
      yield { type: 'reply', text: unansweredText('timeout') }
      return
    }
    if (signal.aborted) {
      // The person pressed stop or closed the window. Marking it abandoned
      // tells Yaara her answer would reach nobody.
      await abandonChat(id, 'The person stopped waiting.')
      return
    }
    yield { type: 'idle' }
    await waitForChat(id, 2_000, signal)
  }
}

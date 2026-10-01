/**
 * The model list Open WebUI reads: Yaara, and nobody else.
 *
 *   GET /api/yaara/v1/models
 *
 * Protected by YAARA_CHAT_TOKEN (lib/machine-auth.ts). Open WebUI calls this
 * when it starts and when its model list is refreshed; with one model listed
 * and set as the default, the chat screen opens talking to her.
 */
import { chatError, chatRelayAuthorised } from '@/lib/machine-auth'
import { modelList } from '@/lib/yaara-chat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!chatRelayAuthorised(req)) return chatError(401, 'Send Authorization: Bearer <YAARA_CHAT_TOKEN>.')
  return Response.json(modelList(Math.floor(Date.UTC(2026, 9, 1) / 1000)))
}

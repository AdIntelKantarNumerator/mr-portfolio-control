/**
 * The model list Open WebUI reads: Yaara, and the Report Builder prototype.
 *
 *   GET /api/yaara/v1/models
 *
 * Protected by YAARA_CHAT_TOKEN (lib/machine-auth.ts). Open WebUI calls this
 * when it starts and when its model list is refreshed; with one model listed
 * and set as the default, the chat screen opens talking to her.
 */
import { chatError, chatRelayAuthorised } from '@/lib/machine-auth'
import { modelList } from '@/lib/yaara-chat'
import { REPORT_BUILDER_MODEL_ID, REPORT_BUILDER_MODEL_NAME } from '@/lib/report-builder/agent'
import { chooseModel } from '@/lib/report-builder/model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!chatRelayAuthorised(req)) return chatError(401, 'Send Authorization: Bearer <YAARA_CHAT_TOKEN>.')
  const list = modelList(Math.floor(Date.UTC(2026, 9, 1) / 1000))
  // Report Builder, the prototype, when a model that can call tools is configured.
  // Listed to everyone (Open WebUI fetches this list once, not per person); a
  // person without "Sees prototypes" is told so when they ask it something.
  if (chooseModel()) {
    list.data.push({ id: REPORT_BUILDER_MODEL_ID, object: 'model', created: Math.floor(Date.UTC(2026, 10, 11) / 1000), owned_by: 'mediaradar', name: REPORT_BUILDER_MODEL_NAME })
  }
  return Response.json(list)
}

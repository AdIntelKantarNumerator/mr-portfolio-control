/**
 * Report Builder V2's server side (20 November 2026): V1's session, tools and
 * engine, plus the builder's own edits, the export link and the overview.
 *
 * Every V1 click (choose, run, save, open or run a saved report) still goes
 * through V1's tools with no model. What V2 adds is also model-free: edits
 * from the builder (a patch on the report, validated by the engine), switching
 * the report type, and an export link for the report as it stands. Only a
 * typed chat message reaches the model.
 */
import type { Spec } from '../engine'
import { ACTION_TOOL, actionInput, cannedText, downloadUrl, engineFor, loadUser, modelTurn, reply, withSession, type PageAction, type PageReply } from '../agent'
import { suggestName } from '../page-view'
import { REPORT_BUILDER_V2_SKILL } from '../skill'
import { runTool, status, type IntelMode, type ToolContext } from '../tools'
import type { Turn } from '../model'
import { builderCatalog, builderState, cleanPatch, switchTemplate, unknownFields, type BuilderCatalog, type BuilderState } from './builder'

export type V2Action =
  | PageAction
  | { type: 'edit'; patch: unknown; said?: string }
  | { type: 'template'; id: string }
  | { type: 'export' }

export interface V2Reply extends PageReply {
  builder: BuilderState
  catalog: BuilderCatalog
  /** For an export: the link, without its format. */
  exportUrl?: string
}

async function v2Reply(ctx: ToolContext, text: string, extra: Partial<V2Reply> = {}): Promise<V2Reply> {
  const base = await reply(ctx, text)
  return {
    ...base,
    builder: await builderState(ctx.engine, ctx.chat, (s) => suggestName(ctx.engine, s)),
    catalog: await builderCatalog(ctx.engine, ctx.chat),
    ...extra,
  }
}

/** Marks the chat as V2's, so its tools offer V2's templates. */
function v2(ctx: ToolContext, mode?: IntelMode) {
  ctx.chat.v2 = true
  if (mode) ctx.setMode?.(mode)
}

/** A click on the page, in the chat or the builder. No model. Errors come back as words. */
export function v2Action(email: string, chatId: string, appUrl: string, action: V2Action): Promise<V2Reply> {
  return withSession(email, chatId, appUrl, async (ctx) => {
    v2(ctx, action.type === 'start' ? action.mode : undefined)
    try {
      switch (action.type) {
        case 'edit': {
          const patch = cleanPatch(action.patch)
          if (!patch) throw new Error('Nothing to change.')
          if (!ctx.chat.report) throw new Error('Pick a report type first.')
          // A field this data does not have is refused here, before it can break the report.
          const missing = unknownFields(patch, ((await ctx.engine.catalog()) as unknown as { dimensions: Array<{ key: string }> }).dimensions.map((d) => d.key))
          if (missing.length) throw new Error(`${missing.map((k) => k.replace(/_/g, ' ')).join(', ')} is not available on this data, so nothing was changed.`)
          await status(ctx, await ctx.engine.validate(ctx.chat.report, patch))
          return await v2Reply(ctx, cannedText(ctx.view))
        }
        case 'template': {
          const tpl = (await ctx.engine.catalog()).templates.find((t) => t.id === action.id)
          if (!tpl) throw new Error('That report type is not available here.')
          await status(ctx, await ctx.engine.validate(switchTemplate(ctx.chat.report, tpl)))
          return await v2Reply(ctx, cannedText(ctx.view))
        }
        case 'export': {
          if (!ctx.chat.report) throw new Error('There is no report to export yet.')
          const v = await ctx.engine.validate(ctx.chat.report)
          if (!v.ok) throw new Error(`The report is not finished yet: ${v.errors[0]?.message ?? v.questions[0]?.prompt}`)
          const name = ctx.chat.editing?.name ?? (await suggestName(ctx.engine, v.spec))
          return await v2Reply(ctx, 'Your file is downloading.', { exportUrl: await downloadUrl(appUrl, v.spec as Spec, name) })
        }
        default: {
          const out = (await runTool(ctx, ACTION_TOOL[action.type], actionInput(action))) as { competitive_set?: string }
          if (action.type === 'save_comp_set') return await v2Reply(ctx, `Saved as your competitive set: ${out.competitive_set}.`)
          return await v2Reply(ctx, cannedText(ctx.view))
        }
      }
    } catch (err) {
      return v2Reply(ctx, (err as Error).message)
    }
  })
}

/** A typed message: the model, with V2's instructions. */
export function v2Turn(input: { email: string; chatId: string; turns: Turn[]; appUrl: string; signal?: AbortSignal }): Promise<V2Reply> {
  return withSession(input.email, input.chatId, input.appUrl, async (ctx) => {
    v2(ctx)
    const text = await modelTurn(ctx, input, REPORT_BUILDER_V2_SKILL)
    return v2Reply(ctx, text)
  })
}

/** Names for the builder's filter and competitive-set boxes. */
export async function v2Search(email: string, q: string, types: string[]) {
  const who = email.trim().toLowerCase()
  const { engine } = await engineFor(await loadUser(who), who)
  const hits = await engine.search(q, { types: types.length ? types : undefined, limit: 10 })
  return hits.map((h) => ({ id: h.id, label: h.label, kind: h.type_label, context: h.context }))
}

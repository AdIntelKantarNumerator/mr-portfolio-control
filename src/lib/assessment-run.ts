/**
 * Running an assessment: the two model calls around the walk, and the
 * fallback to keywords when there is no model or the model fails.
 *
 * Everything that decides anything lives in lib/assessment.ts and is tested
 * there. This file is the IO: send the prompts, parse strictly, and on any
 * failure answer with keywords and say so, rather than show an error where an
 * answer could have been.
 */
import {
  EXPLAIN_SYSTEM,
  MATCH_SYSTEM,
  buildRelied,
  combine,
  explainPrompt,
  keywordAnswer,
  matchPrompt,
  parseExplain,
  parseMatch,
  shortIds,
  walkDownstream,
  type Answer,
  type AnswerItem,
  type AssessComponent,
  type AssessGroup,
  type AssessLink,
  type Relied,
  addFlagged,
} from './assessment'
import { completeJson, ModelError, resolveProvider } from './llm'

/** Past this many downstream components, the rest go in by distance rather than by judgement. */
const MAX_JUDGED = 40

export interface AssessmentResult {
  answer: Answer
  relied: Relied
  method: 'model' | 'keywords'
  model: string | null
}

export async function runAssessment(
  question: string,
  components: AssessComponent[],
  links: AssessLink[],
  groups: AssessGroup[],
): Promise<AssessmentResult> {
  if (!resolveProvider()) return { ...keywordAnswer(question, components, links), method: 'keywords', model: null }
  try {
    return await withModel(question, components, links, groups)
  } catch (err) {
    const why = err instanceof ModelError || err instanceof Error ? err.message : String(err)
    const fallback = keywordAnswer(question, components, links)
    fallback.answer.notes.unshift(`The language model could not answer (${why.slice(0, 200)}), so this answer used keywords instead. Asking again may get a fuller one.`)
    return { ...fallback, method: 'keywords', model: null }
  }
}

async function withModel(
  question: string,
  components: AssessComponent[],
  links: AssessLink[],
  groups: AssessGroup[],
): Promise<AssessmentResult> {
  const byId = new Map(components.map((c) => [c.id, c]))
  const { toShort, toLong } = shortIds(components)
  const notes: string[] = []

  // 1. What changes directly.
  const first = await completeJson(MATCH_SYSTEM, matchPrompt(question, components, groups, toShort), { maxTokens: 900, timeoutMs: 60_000 })
  const match = parseMatch(first.text, toLong, new Set(groups.map((g) => g.key)))
  if (match.dropped) notes.push(`The model named ${match.dropped} component${match.dropped === 1 ? '' : 's'} not on the map; ${match.dropped === 1 ? 'it was' : 'they were'} ignored.`)

  if (!match.direct.length) {
    return {
      answer: {
        summary: 'Nothing on the map is what this request changes.',
        direct: [],
        likely: [],
        possible: [],
        unaffected: [],
        none: match.none ?? 'No component on the map covers this.',
        suggestion: match.suggestion ?? { name: '', groupKey: null, kind: 'software', description: question.trim().slice(0, 600) },
        notes,
      },
      relied: { components: [], links: [], walkedFrom: [] },
      method: 'model',
      model: first.model,
    }
  }

  const direct: AnswerItem[] = match.direct.map((d) => ({ id: d.id, name: byId.get(d.id)!.name, why: d.why }))

  // 2. What is downstream: arithmetic, not the model. Then the components
  // that flagged themselves in their descriptions, wherever they are, first.
  const walk = walkDownstream(direct.map((d) => d.id), links)
  const { reached, walked } = addFlagged(walk.reached, walk.walked, match.affected, direct.map((d) => d.id), links)
  const walkedFrom = walk.walkedFrom

  if (!reached.length) {
    const answer: Answer = {
      summary: `${direct.map((d) => d.name).join(', ')} ${direct.length === 1 ? 'changes' : 'change'} directly. Nothing on the map is downstream of ${direct.length === 1 ? 'it' : 'them'}, which may mean a connection is missing.`,
      direct,
      likely: [],
      possible: [],
      unaffected: [],
      none: null,
      suggestion: null,
      notes,
    }
    return { answer, relied: buildRelied(answer, reached, walked, walkedFrom, byId), method: 'model', model: first.model }
  }

  // 3. Of what the walk found, what is likely and what is only possible.
  const judgedSet = reached.slice(0, MAX_JUDGED)
  const second = await completeJson(EXPLAIN_SYSTEM, explainPrompt(question, direct, judgedSet, byId, toShort), {
    maxTokens: 2200,
    timeoutMs: 90_000,
  })
  const explained = parseExplain(second.text, toLong, new Set(judgedSet.map((r) => r.id)))
  const tiers = combine(reached, explained.judged, byId)
  if (tiers.unjudged) {
    notes.push(
      `${tiers.unjudged} downstream component${tiers.unjudged === 1 ? ' was' : 's were'} not judged by the model and ${tiers.unjudged === 1 ? 'is' : 'are'} placed by distance: one step "likely", further "possible".`,
    )
  }

  const answer: Answer = {
    summary: explained.summary || `${direct.map((d) => d.name).join(', ')} change directly; ${tiers.likely.length} components are likely to need attention.`,
    direct,
    likely: tiers.likely,
    possible: tiers.possible,
    unaffected: tiers.unaffected,
    none: null,
    suggestion: null,
    notes,
  }
  return { answer, relied: buildRelied(answer, reached, walked, walkedFrom, byId), method: 'model', model: second.model }
}

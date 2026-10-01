'use server'

/**
 * Asking the map a question.
 *
 * Not logged to Activity: a question changes nothing, and Activity is the
 * record of what changed. The question and its answer are kept in
 * workflow_assessments instead, where the page lists them.
 */
import { revalidatePath } from 'next/cache'
import { db } from '@/db/client'
import { workflowAssessments } from '@/db/schema'
import { editor } from '@/lib/auth/editor'
import { runAssessment } from '@/lib/assessment-run'
import { readAssessmentInputs, toAssessmentView, type AssessmentView } from '@/lib/workflow'

export interface AssessState {
  ok?: boolean
  error?: string
  view?: AssessmentView
  stamp?: number
}

export async function askAssessment(_prev: AssessState, formData: FormData): Promise<AssessState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const question = String(formData.get('question') ?? '').trim()
  if (question.length < 8) return { error: 'Describe the change in a few words, for example "change how we group media in Insights Studio".' }
  if (question.length > 1500) return { error: 'Keep it under 1,500 characters; the first sentence or two is what matters.' }

  const { components, links, groups } = await readAssessmentInputs()
  if (!components.length) return { error: 'The map is empty, so there is nothing to assess against yet.' }

  const result = await runAssessment(question, components, links, groups)
  const [row] = await db
    .insert(workflowAssessments)
    .values({
      question,
      askedBy: who.name,
      method: result.method,
      model: result.model,
      answer: JSON.stringify(result.answer),
      relied: JSON.stringify(result.relied),
    })
    .returning()

  revalidatePath('/workflow')
  return { ok: true, view: toAssessmentView(row!), stamp: Date.now() }
}

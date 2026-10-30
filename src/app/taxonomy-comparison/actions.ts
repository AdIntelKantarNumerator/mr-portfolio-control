'use server'

/**
 * Taxonomy Comparison: starting a run, reading its progress, and picking a
 * different FROM entity.
 *
 * Open to every role (Scott, 29 October 2026): the page is under Reference,
 * which everyone signed in may see. Not logged to Activity — a comparison
 * changes nothing.
 */
import { editor } from '@/lib/auth/editor'
import { isFromTaxonomy, parseAdvertisers } from '@/lib/taxonomy-rules'
import { chooseEntity, readRun, startRun, type RunView } from '@/lib/taxonomy-run'

export interface StartState {
  error?: string
  runId?: string
}

export async function startComparison(_prev: StartState, formData: FormData): Promise<StartState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const from = String(formData.get('from') ?? '')
  if (!isFromTaxonomy(from)) return { error: 'Pick the taxonomy to compare from.' }
  const { names, error } = parseAdvertisers(String(formData.get('advertisers') ?? ''))
  if (error) return { error }
  return { runId: await startRun(from, names, who.name) }
}

export async function pollRun(id: string): Promise<RunView | null> {
  const who = await editor()
  if (!who.ok) return null
  return readRun(id)
}

/** Swap the FROM entity for one advertiser, from the candidates the run found; '' for none. */
export async function pickEntity(runId: string, input: string, candidateId: string): Promise<{ error?: string; run?: RunView | null }> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  try {
    const out = await chooseEntity(runId, input, candidateId || null, who.name)
    if (out.error) return out
  } catch (err) {
    return { error: (err as Error).message }
  }
  return { run: await readRun(runId) }
}

'use server'

/**
 * Taxonomy Comparison: starting a run and reading its progress.
 *
 * Open to every role (Scott, 29 October 2026): the page is under Reference,
 * which everyone signed in may see. Not logged to Activity — a comparison
 * changes nothing.
 */
import { editor } from '@/lib/auth/editor'
import { TAXONOMIES, parseAdvertisers, type Taxonomy } from '@/lib/taxonomy-rules'
import { chooseEntity, readRun, startRun, type RunView } from '@/lib/taxonomy-run'

export interface StartState {
  error?: string
  runId?: string
}

export async function startComparison(_prev: StartState, formData: FormData): Promise<StartState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const { names, error } = parseAdvertisers(String(formData.get('advertisers') ?? ''))
  if (error) return { error }
  return { runId: await startRun(names, who.name) }
}

export async function pollRun(id: string): Promise<RunView | null> {
  const who = await editor()
  if (!who.ok) return null
  return readRun(id)
}

/** Swap the entity one taxonomy is compared on, from the candidates the run found; '' for none. */
export async function pickEntity(runId: string, input: string, taxonomy: string, candidateId: string): Promise<{ error?: string; run?: RunView | null }> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  if (!(TAXONOMIES as readonly string[]).includes(taxonomy)) return { error: 'Unknown taxonomy.' }
  try {
    const out = await chooseEntity(runId, input, taxonomy as Taxonomy, candidateId || null, who.name)
    if (out.error) return out
  } catch (err) {
    return { error: (err as Error).message }
  }
  return { run: await readRun(runId) }
}

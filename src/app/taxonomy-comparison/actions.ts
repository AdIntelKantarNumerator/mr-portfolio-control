'use server'

/**
 * Taxonomy Comparison: starting a run and reading its progress.
 *
 * Open to every role (Scott, 29 October 2026): the page is under Reference,
 * which everyone signed in may see. Not logged to Activity — a comparison
 * changes nothing.
 */
import { editor } from '@/lib/auth/editor'
import { parseAdvertisers } from '@/lib/taxonomy-rules'
import { readRun, startRun, type RunView } from '@/lib/taxonomy-run'

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

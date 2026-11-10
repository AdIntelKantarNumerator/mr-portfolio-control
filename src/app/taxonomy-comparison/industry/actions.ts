'use server'

/**
 * Industry View: starting and polling reads of the taxonomy tree and of a
 * node's spenders (lib/taxonomy-industry.ts). Open to every role, like the
 * comparison: it is under Reference and changes nothing.
 */
import { editor } from '@/lib/auth/editor'
import { isLegacyTaxonomy, type IndustryResult, type TaxNode } from '@/lib/taxonomy-industry-rules'
import { legacyKey, nodeKey, readIndustry, startIndustry, TREE_KEY, type IndustryView } from '@/lib/taxonomy-industry'

export async function pollTree(): Promise<IndustryView<TaxNode[]> | null> {
  const who = await editor()
  if (!who.ok) return null
  return readIndustry<TaxNode[]>(TREE_KEY)
}

/** Read the tree again from Databricks: a node added in GPC since appears. */
export async function rereadTree(): Promise<IndustryView<TaxNode[]> | null> {
  const who = await editor()
  if (!who.ok) return null
  await startIndustry(TREE_KEY, who.name, true)
  return readIndustry<TaxNode[]>(TREE_KEY)
}

/** A node's spenders: kept from the last read, or read now. `again` reads it afresh. */
export async function openNode(id: string, again = false): Promise<{ error?: string; view?: IndustryView<IndustryResult> | null }> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  if (!/^\d{1,12}$/.test(id)) return { error: 'Not a taxonomy node.' }
  try {
    await startIndustry(nodeKey(id), who.name, again)
  } catch (err) {
    return { error: (err as Error).message }
  }
  return { view: await readIndustry<IndustryResult>(nodeKey(id)) }
}

export async function pollNode(id: string): Promise<IndustryView<IndustryResult> | null> {
  const who = await editor()
  if (!who.ok || !/^\d{1,12}$/.test(id)) return null
  return readIndustry<IndustryResult>(nodeKey(id))
}

/** A legacy node's spenders for "Compare to": kept from the last read, or read now. */
export async function openLegacy(tax: string, level: string, id: string, again = false): Promise<{ error?: string; view?: IndustryView<IndustryResult> | null }> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  if (!isLegacyTaxonomy(tax) || !/^[a-z0-9]{1,20}$/.test(level) || !/^\d{1,12}$/.test(id)) return { error: 'Not a legacy taxonomy node.' }
  try {
    await startIndustry(legacyKey(tax, level, id), who.name, again)
  } catch (err) {
    return { error: (err as Error).message }
  }
  return { view: await readIndustry<IndustryResult>(legacyKey(tax, level, id)) }
}

export async function pollLegacy(tax: string, level: string, id: string): Promise<IndustryView<IndustryResult> | null> {
  const who = await editor()
  if (!who.ok || !isLegacyTaxonomy(tax) || !/^[a-z0-9]{1,20}$/.test(level) || !/^\d{1,12}$/.test(id)) return null
  return readIndustry<IndustryResult>(legacyKey(tax, level, id))
}

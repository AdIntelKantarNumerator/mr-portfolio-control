'use client'

/**
 * A select that applies itself.
 *
 * The Tables tab's filters are a plain GET form, so the page stays
 * server-rendered and every filter is in the address bar. But a select in such
 * a form does nothing until the Filter button is pressed, while it already
 * displays the new choice. On 2 October 2026 that read as a broken filter:
 * "Not in a dataset" was showing and tables already in a dataset were still
 * listed, because the list had never been asked for again. Changing one of
 * these submits the form at once.
 */
import type { SelectHTMLAttributes } from 'react'

export function AutoSubmitSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
}

'use client'

import { useId, useState, type ReactNode } from 'react'

/**
 * Expand/collapse for one initiative.
 *
 * A real `<button>` with `aria-expanded` / `aria-controls` rather than a click
 * handler on a div, so the row works from the keyboard and screen readers
 * announce the state. The panel stays in the DOM when collapsed so browser
 * find-in-page still hits the project names inside it — in a review that is how
 * people locate work whose initiative they cannot remember.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  labelText,
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  /** Announced on the toggle, since the visible summary is a block of chips. */
  labelText: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${labelText}`}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <svg
          viewBox="0 0 12 12"
          width="12"
          height="12"
          aria-hidden="true"
          className="mt-[5px] shrink-0 transition-transform"
          style={{
            color: 'var(--muted)',
            transform: open ? 'rotate(90deg)' : 'none',
          }}
        >
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="min-w-0 flex-1">{summary}</span>
      </button>
      <div id={panelId} hidden={!open} className="mt-3">
        {children}
      </div>
    </>
  )
}

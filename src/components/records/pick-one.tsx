'use client'

/**
 * Pick one thing out of a long list, by typing.
 *
 * WHY NOT A `<select>`
 *
 * The dependency dialogs offer every piece of work in the portfolio as the
 * other end of a link. On a real portfolio that is several hundred options,
 * and a native select answers a list that long with a scrollbar and
 * single-letter type-ahead. Finding one workstream means scrolling, or
 * pressing its first letter until you arrive.
 *
 * WHY NOT A `<datalist>`
 *
 * It is one attribute and it would be tempting. But a datalist's value IS its
 * label, and what the form has to submit here is an id — so the two cannot be
 * different, which is the whole requirement. It also drops the grouping, which
 * is what tells a reader whether "Creative Central" is a project or a
 * workstream when both exist.
 *
 * SO: A COMBOBOX, AND A HIDDEN INPUT
 *
 * The visible input filters; the hidden input carries the id under the field
 * name the server action already reads, so nothing downstream changes. It
 * works with the keyboard alone — arrows move, Enter chooses, Escape closes —
 * and clicking away commits whatever was highlighted rather than silently
 * discarding what the reader typed.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { filterOptions, groupsOf, moveHighlight, type Pickable } from '@/lib/pick-filter'

export function PickOne({
  name,
  options,
  value,
  placeholder = 'Type to search…',
  required,
  /** What the current value is called when the live list no longer carries it. */
  currentLabel,
  id,
}: {
  name: string
  options: Pickable[]
  value?: string
  placeholder?: string
  required?: boolean
  currentLabel?: string | null
  id?: string
}) {
  const fallbackId = useId()
  const inputId = id ?? fallbackId
  const listId = `${inputId}-list`

  /*
   * A record can point at work that has since ended, and that is not a reason
   * to silently move it: the current value stays selectable even when the live
   * list no longer carries it.
   */
  const all = useMemo(() => {
    if (!value || options.some((o) => o.value === value)) return options
    return [{ value, label: currentLabel ?? 'What it points at now', group: 'Currently' }, ...options]
  }, [options, value, currentLabel])

  const [picked, setPicked] = useState(value ?? '')
  const [query, setQuery] = useState(() => all.find((o) => o.value === value)?.label ?? '')
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(-1)
  const box = useRef<HTMLDivElement>(null)

  // Only filter once the reader has changed what is in the box. Otherwise
  // opening a dialog on an existing value would show that one option alone,
  // which reads as "there is nothing else to choose".
  const [typing, setTyping] = useState(false)
  const shown = useMemo(() => (typing ? filterOptions(all, query) : all), [all, query, typing])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const choose = (o: Pickable) => {
    setPicked(o.value)
    setQuery(o.label)
    setTyping(false)
    setOpen(false)
    setAt(-1)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) setOpen(true)
      setAt((n) => moveHighlight(n < 0 ? -1 : n, e.key === 'ArrowDown' ? 1 : -1, shown.length))
      return
    }
    if (e.key === 'Enter' && open) {
      // Only when something is highlighted: Enter on a half-typed search
      // should submit the form, which is what a reader expects of a text box.
      const hit = shown[at]
      if (hit) {
        e.preventDefault()
        choose(hit)
      }
    }
  }

  let index = -1

  return (
    <div className="pick" ref={box}>
      <input type="hidden" name={name} value={picked} />
      <input
        id={inputId}
        type="text"
        className="pick-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        // The requirement is on the hidden value, not on the text: typing a
        // name that matches nothing must not count as having chosen one.
        required={required && !picked}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setTyping(true)
          setOpen(true)
          setAt(-1)
          // What is in the box no longer describes what is selected, so
          // nothing is selected until they pick again.
          setPicked('')
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />

      {open && (
        <div className="pick-list" id={listId} role="listbox">
          {shown.length === 0 ? (
            <p className="pick-none">Nothing matches “{query}”.</p>
          ) : (
            groupsOf(shown).map((g) => (
              <div key={g} className="pick-group">
                <p className="pick-gname">{g}</p>
                {shown
                  .filter((o) => o.group === g)
                  .map((o) => {
                    index += 1
                    const here = index
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="option"
                        aria-selected={o.value === picked}
                        className={`pick-opt${here === at ? ' on' : ''}${o.value === picked ? ' is' : ''}`}
                        // mousedown, not click: the blur that a click causes
                        // would close the list before the click landed.
                        onMouseDown={(e) => {
                          e.preventDefault()
                          choose(o)
                        }}
                        onMouseEnter={() => setAt(here)}
                      >
                        {o.label}
                      </button>
                    )
                  })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * Everything that has happened on this work, as Yaara reported it.
 *
 * The control room shows the last three bullets. This is all of them, and the
 * reason it earns a place on the page is that the three-bullet version answers
 * "what is moving" while nobody could answer "what happened in August" without
 * opening Slack and scrolling.
 *
 * WHAT THIS IS NOT
 *
 * Not an audit log. It is a machine's record of what it noticed, which is a
 * narrower thing: it has no bullet for the week a source was down, and it
 * carries no opinion about whether any of this was good. So it says whose
 * reading it is, at the top, once — the same warning every other agent-written
 * surface in this app carries.
 *
 * PAGED, TWENTY AT A TIME
 *
 * A workstream with a year of history pushed Conversations, Readiness and
 * everything below it off the bottom of the page. An archive is something you
 * go looking for; the sections under it are things people scroll past on the
 * way to something else, and an archive that buries them has made the page
 * worse for the people not reading it.
 *
 * Paged in the browser rather than the URL: the whole history is already
 * loaded, a page number in the query string would be shared with every other
 * section on the page, and a round trip to move between pages of text already
 * in memory would be slower for no benefit. The cost is that the page resets
 * on navigation, which is the right thing to lose.
 *
 * Months still group within a page. They are how people ask the question
 * ("what happened in August"), and the only grouping available that needs no
 * judgement about what belongs together.
 */
import { useState } from 'react'
import type { UpdateEntry } from '@/lib/observations'
import { Card, CardHeading, Muted } from './ui'

const PER_PAGE = 20

function monthKey(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function day(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * How long it stayed live, in words.
 *
 * The pass count is meaningful — she reassesses hourly, so a bullet carried by
 * forty passes was considered current for the better part of two days — but
 * "40 passes" is a number about the machine, not about the work. Only shown
 * when it is long enough to say something.
 */
function heldFor(entry: UpdateEntry): string | null {
  const hours = Math.round((entry.lastReported.getTime() - entry.firstReported.getTime()) / 3_600_000)
  if (hours < 24) return null
  const days = Math.round(hours / 24)
  return days === 1 ? 'still current a day later' : `still current ${days} days later`
}

function PageButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-40"
      style={{ background: 'var(--surface)', color: 'var(--muted)', borderColor: 'var(--line)' }}
    >
      {children}
    </button>
  )
}

export function Updates({
  entries,
  kind,
}: {
  entries: UpdateEntry[]
  kind: 'workstream' | 'project'
}) {
  const [page, setPage] = useState(0)
  const heading = kind === 'workstream' ? 'Workstream updates' : 'Project updates'
  const sub =
    'Everything Yaara has reported about this, oldest kept — the full version of the bullets on the control room.'

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeading title={heading} sub={sub} />
        <Muted>
          Nothing recorded yet. These appear once Yaara has read something that mentions this work —
          a commit, a message in a connected channel, a meeting note.
        </Muted>
      </Card>
    )
  }

  const pages = Math.ceil(entries.length / PER_PAGE)
  // Clamped rather than trusted: entries can shrink between renders, and a
  // page index left pointing past the end would render an empty archive.
  const current = Math.min(page, pages - 1)
  const start = current * PER_PAGE
  const shown = entries.slice(start, start + PER_PAGE)

  // Grouped in one pass over the visible slice, preserving its order. A month
  // spanning a page boundary gets its heading again on the next page, which is
  // what you want when the page is the only thing you can see.
  const months: { label: string; entries: UpdateEntry[] }[] = []
  for (const entry of shown) {
    const label = monthKey(entry.at ?? entry.firstReported)
    const last = months.at(-1)
    if (last && last.label === label) last.entries.push(entry)
    else months.push({ label, entries: [entry] })
  }

  return (
    <Card>
      <CardHeading title={heading} sub={sub} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[11.5px]" style={{ color: 'var(--muted)' }}>
          {pages > 1
            ? `${start + 1}–${start + shown.length} of ${entries.length}, newest first.`
            : `${entries.length} update${entries.length === 1 ? '' : 's'}, newest first.`}{' '}
          Written by Yaara from what she read — not a complete record of everything that happened,
          and not reviewed by anyone.
        </p>

        {/* At the top, not the bottom: the whole point of paging this was to
            stop people scrolling, and controls below twenty entries would make
            them scroll to find the controls. */}
        {pages > 1 ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <PageButton onClick={() => setPage(current - 1)} disabled={current === 0}>
              ← Newer
            </PageButton>
            <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
              {current + 1} / {pages}
            </span>
            <PageButton onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>
              Older →
            </PageButton>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        {months.map((month) => (
          <section key={month.label} className="flex flex-col gap-1.5">
            <h3
              className="m-0 text-[11px] font-semibold uppercase tracking-[0.05em]"
              style={{ color: 'var(--muted)' }}
            >
              {month.label}
            </h3>

            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {month.entries.map((entry) => {
                const held = heldFor(entry)
                return (
                  <li
                    key={`${entry.text}-${entry.firstReported.toISOString()}`}
                    className="flex flex-col gap-0.5 border-l-2 pl-2.5"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <p className="m-0 text-[12.5px]">{entry.text}</p>

                    <p
                      className="m-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]"
                      style={{ color: 'var(--muted)' }}
                    >
                      <span>{day(entry.at ?? entry.firstReported)}</span>
                      {entry.source ? <span>· {entry.source}</span> : null}
                      {held ? <span>· {held}</span> : null}

                      {/* The citations are the point of the whole feature: a
                          bullet a reader cannot trace is a claim, not a record.
                          A citation named the same as the source is dropped
                          rather than printed twice — "#ratings-eng · #ratings-eng"
                          reads as a bug, which is what it was. */}
                      {entry.citations
                        .filter((c) => (c.title || c.source) !== entry.source || c.url)
                        .map((c) =>
                          c.url ? (
                            <a
                              key={c.id}
                              href={c.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="underline"
                              style={{ color: 'var(--brand)' }}
                            >
                              {c.title || c.source}
                            </a>
                          ) : (
                            <span key={c.id}>· {c.title || c.source}</span>
                          ),
                        )}
                    </p>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* Repeated below only when there is enough above it to have lost sight
          of the first set. */}
      {pages > 1 && shown.length > 8 ? (
        <div className="mt-3 flex items-center gap-1.5">
          <PageButton onClick={() => setPage(current - 1)} disabled={current === 0}>
            ← Newer
          </PageButton>
          <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {current + 1} / {pages}
          </span>
          <PageButton onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>
            Older →
          </PageButton>
        </div>
      ) : null}
    </Card>
  )
}

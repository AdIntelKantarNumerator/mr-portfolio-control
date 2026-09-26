'use client'

/**
 * The changelog, grouped and timed in the reader's own timezone.
 *
 * WHY THE GROUPING MOVED TO THE CLIENT TOO
 *
 * Formatting the times locally and leaving the day headings on the server
 * would be worse than leaving both wrong. Azure runs in UTC, so an edit made
 * at 9pm in New York is 1am the next day in UTC: the heading would say the
 * 27th and the row beneath it 9:15 PM on the 26th, and the page would look
 * broken in a way that is hard to explain.
 *
 * Both happen here, from one Date, so the heading and the time can never
 * disagree.
 */
import { LocalTime, LocalZone } from '@/components/local-time'
import { Card, Chip, Empty, Muted, type Tone } from '@/components/ui'

export interface ChangeEntry {
  id: string
  /** ISO. Serialised on the way out of the server component. */
  at: string
  kind: string
  actor: string
  summary: string
  detail: string | null
  entityType: string | null
  entityId: string | null
}

const KIND_TONE: Record<string, Tone> = {
  change: 'blue',
  note: 'slate',
  sync: 'green',
  conflict: 'amber',
  error: 'red',
}

/** "today", "yesterday", or how many days back — from the reader's midnight. */
function relativeDay(d: Date, now: Date): string {
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  return `${Math.floor(days / 7)} weeks ago`
}

export function ChangeLog({ entries }: { entries: ChangeEntry[] }) {
  if (entries.length === 0) return <Empty>Nothing has been logged yet.</Empty>

  const now = new Date()

  // Grouped by the reader's calendar day. `entries` arrives newest first, so
  // the map's insertion order is the display order and needs no re-sort.
  const byDay = new Map<string, { label: string; when: Date; items: ChangeEntry[] }>()
  for (const e of entries) {
    const d = new Date(e.at)
    if (Number.isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (!byDay.has(key)) {
      byDay.set(key, {
        label: new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(d),
        when: d,
        items: [],
      })
    }
    byDay.get(key)!.items.push(e)
  }

  return (
    <div className="flex flex-col gap-4">
      <Muted>
        Times are shown in <LocalZone />.
      </Muted>

      {[...byDay.values()].map((day) => (
        <div key={day.label} suppressHydrationWarning>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="m-0 text-[13px] font-bold tracking-[-0.01em]">{day.label}</h3>
            <Muted>{relativeDay(day.when, now)}</Muted>
          </div>

          <div className="flex flex-col gap-2 border-l-2 pl-3 sm:pl-4" style={{ borderColor: 'var(--line)' }}>
            {day.items.map((e) => (
              <Card key={e.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <LocalTime at={e.at} show="time" className="text-[11px] tabular-nums opacity-70" />
                  <Chip tone={KIND_TONE[e.kind] ?? 'slate'}>{e.kind}</Chip>
                  <span className="text-[12px] font-semibold">{e.actor}</span>
                </div>
                <div className="mt-1 text-[13px] font-semibold leading-snug">{e.summary}</div>
                {e.detail ? (
                  <p className="m-0 mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {e.detail}
                  </p>
                ) : null}
                {e.entityType ? (
                  <div className="full-only mt-1.5">
                    <Muted>
                      {e.entityType}
                      {e.entityId ? ` · ${e.entityId}` : ''}
                    </Muted>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

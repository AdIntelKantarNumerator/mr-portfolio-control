/**
 * The "what changed" log.
 *
 * In a review the delta is the story — people already have the current state on
 * the other screens. This page answers "what moved since I last looked, who
 * moved it, and did the last sync actually work".
 */
import { desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { syncRuns } from '@/db/schema'
import { Card, CardHeading, Chip, Empty, Kicker, Muted, SectionNote, type Tone } from '@/components/ui'
import { label } from '@/lib/domain'
import { recentChanges } from '@/lib/portfolio'
import { fmtDate, relativeDays } from '@/lib/util'

// This page reads the live portfolio; prerendering it would serve stale data.
export const dynamic = 'force-dynamic'

const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

const KIND_TONE: Record<string, Tone> = {
  change: 'blue',
  sync: 'accent',
  note: 'slate',
  decision: 'violet',
}

const SYNC_TONE: Record<string, Tone> = {
  success: 'green',
  running: 'blue',
  partial: 'amber',
  failed: 'red',
}

/**
 * `stats` is JSON text written by whichever sync produced it, so its shape is
 * not guaranteed. Anything unreadable is reported as unreadable rather than
 * swallowed — a sync log that quietly hides a malformed payload is worse than
 * no log.
 */
function parseStats(raw: string | null): { group: string; parts: string[] }[] | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null

  return Object.entries(value as Record<string, unknown>).map(([group, v]) => {
    if (typeof v === 'object' && v !== null) {
      return {
        group,
        parts: Object.entries(v as Record<string, unknown>).map(([k, n]) => `${k} ${String(n)}`),
      }
    }
    return { group, parts: [String(v)] }
  })
}

function SyncPanel({ run }: { run: typeof syncRuns.$inferSelect | null }) {
  if (!run) {
    return (
      <Card>
        <CardHeading title="Last sync" sub="Provenance for everything below." />
        <Empty>
          No sync has run against this database yet. Every row in the log below was typed here.
        </Empty>
      </Card>
    )
  }

  const bad = run.status === 'failed' || run.status === 'partial'
  const stats = parseStats(run.stats)

  return (
    <Card tone={bad ? 'alert' : undefined}>
      <CardHeading
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Last sync · {label('sourceSystem', run.system)}
            <Chip tone={SYNC_TONE[run.status] ?? 'slate'}>{run.status}</Chip>
          </span>
        }
        sub={`Triggered ${run.trigger} · started ${fmtDate(run.startedAt, { year: true })} ${TIME.format(run.startedAt)}${
          run.finishedAt
            ? ` · finished ${fmtDate(run.finishedAt, { year: true })} ${TIME.format(run.finishedAt)}`
            : ' · still running'
        }`}
        right={<Muted>{relativeDays(run.startedAt)}</Muted>}
      />

      {bad ? (
        <SectionNote tone="red">
          <strong>This sync did not complete cleanly.</strong> Everything sourced below may be
          stale.
          {run.error ? (
            <span className="mt-1 block font-mono text-[11px] leading-relaxed">{run.error}</span>
          ) : (
            <span className="mt-1 block">No error text was recorded, which is itself a gap.</span>
          )}
        </SectionNote>
      ) : null}

      {stats && stats.length > 0 ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {stats.map((s) => (
            <span key={s.group} className="text-[12px]">
              <span className="font-semibold">{s.group}</span>{' '}
              <span style={{ color: 'var(--muted)' }}>{s.parts.join(' · ')}</span>
            </span>
          ))}
        </div>
      ) : run.stats ? (
        <Muted>Counters were recorded but could not be read as JSON.</Muted>
      ) : (
        <Muted>No counters recorded for this run.</Muted>
      )}
    </Card>
  )
}

export default async function ChangesPage() {
  const [entries, runs] = await Promise.all([
    recentChanges(),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1),
  ])

  // Group by calendar day. `recentChanges` already returns newest first, so the
  // insertion order of the map is the display order and needs no re-sort.
  const byDay = new Map<string, typeof entries>()
  for (const e of entries) {
    const key = fmtDate(e.at, { year: true })
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(e)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Kicker>What changed</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
          Every sync and every hand edit, newest first
        </h2>
        <p className="m-0 mt-1 max-w-[760px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Reconciliation rule: the most recent dated source wins, except pinned overrides, which
          survive. A pinned value is a deliberate local fact — a board-locked date, a corrected
          owner — and no sync overwrites it until a human unpins it.
        </p>
      </div>

      <SyncPanel run={runs[0] ?? null} />

      {entries.length === 0 ? (
        <Empty>Nothing has been logged yet.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {[...byDay.entries()].map(([day, items]) => (
            <div key={day}>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="m-0 text-[13px] font-bold tracking-[-0.01em]">{day}</h3>
                <Muted>{relativeDays(items[0].at)}</Muted>
              </div>

              <div
                className="flex flex-col gap-2 border-l-2 pl-3 sm:pl-4"
                style={{ borderColor: 'var(--line)' }}
              >
                {items.map((e) => (
                  <Card key={e.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="text-[11px] tabular-nums"
                        style={{ color: 'var(--muted)' }}
                      >
                        {TIME.format(e.at)}
                      </span>
                      <Chip tone={KIND_TONE[e.kind] ?? 'slate'}>{e.kind}</Chip>
                      <span className="text-[12px] font-semibold">{e.actor}</span>
                    </div>
                    <div className="mt-1 text-[13px] font-semibold leading-snug">{e.summary}</div>
                    {e.detail ? (
                      <p
                        className="m-0 mt-1 text-[12px] leading-relaxed"
                        style={{ color: 'var(--muted)' }}
                      >
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
      )}
    </div>
  )
}

/**
 * What is actually moving, and what moved.
 *
 * The front page used to open with what is wrong — the squeeze, the holes.
 * Both are real and both are still here, at the bottom, because a page that
 * only ever shows trouble is one people stop opening. This opens with what is
 * happening.
 *
 * Every line under a name is something that occurred, cited to the evidence it
 * came from, written by Yaara in her assessment pass. Ordered by a count she
 * made, not by a judgement she made: "how active" is arithmetic.
 */
import Link from 'next/link'
import { Card, CardHeading, Empty, Muted, Pill } from './ui'
import type { ActiveWork } from '@/lib/observations'

/** "in the last 24 hours", or how much further back she had to look. */
function windowLabel(hours: number | null): string | null {
  if (!hours) return null
  if (hours <= 24) return 'last 24 hours'
  if (hours <= 72) return 'last 3 days'
  if (hours <= 168) return 'last week'
  if (hours <= 336) return 'last fortnight'
  return 'last month'
}

const SOURCE_LABEL: Record<string, string> = {
  linear: 'Linear',
  github: 'GitHub',
  azdo: 'Azure DevOps',
  slack: 'Slack',
  meeting: 'meeting',
}

function when(at: string | null): string | null {
  if (!at) return null
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function ActiveWorkCard({
  title,
  sub,
  work,
  href,
  hrefLabel,
}: {
  title: string
  sub: string
  work: ActiveWork[]
  href: string
  hrefLabel: string
}) {
  return (
    <Card>
      <CardHeading title={title} sub={sub} />

      {work.length === 0 ? (
        <Empty>
          Nothing recorded yet. Yaara writes this during her assessment passes — the first one
          after a deploy fills it in.
        </Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {work.map((w) => {
            const win = windowLabel(w.windowHours)
            return (
              <li key={`${w.type}:${w.id}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  {/* The name is the thing you scan for, so it is the one
                      coloured element in the block rather than the same ink as
                      the lines underneath it. */}
                  <Link
                    href={w.href}
                    className="text-[13px] font-semibold no-underline hover:underline"
                    style={{ color: 'var(--brand)' }}
                  >
                    {w.name}
                  </Link>
                  {/* Saying WHICH window matters as much as the activity. A
                      quiet week reading "last month" is the honest signal, and
                      the same card with no label would imply it was yesterday. */}
                  {win ? <Muted>{win}</Muted> : null}
                </div>

                {w.recent.length === 0 ? (
                  <p className="m-0 mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
                    Activity recorded, but nothing specific enough to summarise.
                  </p>
                ) : (
                  // Real bullets. A left rule read as a quote block rather than
                  // a list, which is not what three separate facts are.
                  <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                    {w.recent.map((r, ix) => (
                      <li
                        key={ix}
                        className="flex gap-1.5 text-[12.5px] leading-relaxed"
                        style={{ color: 'var(--ink)' }}
                      >
                        <span aria-hidden className="select-none" style={{ color: 'var(--muted)' }}>
                          •
                        </span>
                        <span>
                        {r.text}
                        {when(r.at) || r.source ? (
                          <Muted>
                            {' '}
                            ·{when(r.at) ? ` ${when(r.at)}` : ''}
                            {r.source ? ` ${SOURCE_LABEL[r.source] ?? r.source}` : ''}
                          </Muted>
                        ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className="m-0 mt-3 flex flex-wrap items-center gap-2 text-[12px]">
        <Link href={href} className="font-semibold hover:underline" style={{ color: 'var(--brand)' }}>
          {hrefLabel} →
        </Link>
        {work.length > 0 ? (
          <Pill tone="slate">Written by Yaara · not reviewed</Pill>
        ) : null}
      </p>
    </Card>
  )
}

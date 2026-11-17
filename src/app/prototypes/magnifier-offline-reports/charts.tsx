/**
 * The small charts, drawn as plain HTML and SVG on the server. Hover detail
 * is the native tooltip (title) on every mark; every chart has a table on
 * one of the drill-down tabs.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { money, pct } from '@/lib/magnifier-reports/rules'

/** The colour class for a series slot (1-8), grey for 0 or none. */
export const sc = (slot: number | undefined) => `s${slot ?? 0}`

export function Card({ title, more, note, w = 6, children }: { title: string; more?: string; note?: string; w?: 3 | 4 | 6 | 8 | 12; children: ReactNode }) {
  return (
    <section className={`mor-card w${w}`}>
      <h3>
        {title}
        {note ? <span className="note">{note}</span> : null}
        {more ? (
          <Link className="more" href={more} scroll={false}>
            Details →
          </Link>
        ) : null}
      </h3>
      {children}
    </section>
  )
}

export function Kpi({ label, value, foot, name }: { label: string; value: ReactNode; foot?: ReactNode; name?: boolean }) {
  return (
    <section className="mor-card w3 mor-kpi">
      <div className="lab">{label}</div>
      <div className={`big ${name ? 'name' : ''}`}>{value}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </section>
  )
}

export function Delta({ v, points }: { v: number | null; points?: boolean }) {
  if (v == null) return <span className="mor-up">New</span>
  if (!Number.isFinite(v) || v === 0) return <span>—</span>
  const txt = points ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)} pts` : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
  return <span className={v > 0 ? 'mor-up' : 'mor-down'}>{v > 0 ? '▲' : '▼'} {txt}</span>
}

/** Vertical columns, one per period; `on` marks the period the report is about. */
export function Columns({ items }: { items: Array<{ label: string; value: number; on?: boolean; href?: string }> }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div>
      <div className="mor-cols">
        {items.map((i) => {
          const body = (
            <>
              <span className="v">{money(i.value)}</span>
              <span className="b" style={{ height: `${(i.value / max) * 100}%` }} />
            </>
          )
          return i.href ? (
            <Link key={i.label} href={i.href} scroll={false} className={`mor-col ${i.on ? 'on' : ''}`} title={`${i.label}: ${money(i.value)}`}>
              {body}
            </Link>
          ) : (
            <div key={i.label} className={`mor-col ${i.on ? 'on' : ''}`} title={`${i.label}: ${money(i.value)}`}>
              {body}
            </div>
          )
        })}
      </div>
      <div className="mor-xlab">
        {items.map((i) => (
          <span key={i.label}>{i.label}</span>
        ))}
      </div>
    </div>
  )
}

export interface Segment {
  name: string
  value: number
  slot: number
}

/** A 100% bar split into segments. */
export function Stack({ segs, tall }: { segs: Segment[]; tall?: boolean }) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div className="mor-stack" style={tall ? { height: 34 } : undefined}>
      {segs
        .filter((x) => x.value > 0)
        .map((x) => (
          <span key={x.name} className={sc(x.slot)} style={{ flex: `${x.value / total} 1 0` }} title={`${x.name}: ${money(x.value)} · ${pct(x.value / total)}`} />
        ))}
    </div>
  )
}

export function Legend({ segs, total }: { segs: Segment[]; total?: number }) {
  const t = total ?? segs.reduce((s, x) => s + x.value, 0)
  return (
    <div className="mor-legend">
      {segs.map((x) => (
        <span key={x.name} className={sc(x.slot)}>
          <i />
          {x.name} <b>{pct(t ? x.value / t : 0)}</b>
        </span>
      ))}
    </div>
  )
}

/** Horizontal bars with a name and a value; the name can link somewhere. */
export function HBars({ items }: { items: Array<{ name: string; value: number; slot?: number; href?: string; extra?: string }> }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="mor-hbars">
      {items.map((i) => (
        <Row key={i.name} i={i} max={max} />
      ))}
    </div>
  )
}
function Row({ i, max }: { i: { name: string; value: number; slot?: number; href?: string; extra?: string }; max: number }) {
  return (
    <>
      {i.href ? (
        <Link className="n" href={i.href} scroll={false} title={i.name}>
          {i.name}
        </Link>
      ) : (
        <span className="n" title={i.name}>
          {i.name}
        </span>
      )}
      <span className={`t ${i.slot != null ? sc(i.slot) : 's1'}`} title={`${i.name}: ${money(i.value)}`}>
        <i style={{ width: `${(i.value / max) * 100}%` }} />
      </span>
      <span className="v">
        {money(i.value)}
        {i.extra ? <span className="muted"> · {i.extra}</span> : null}
      </span>
    </>
  )
}

/** Change between two periods, decreases to the left of the line, increases to the right. */
export function Shifts({ items }: { items: Array<{ name: string; from: number; to: number; href?: string }> }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.to - i.from)))
  return (
    <div className="mor-shift">
      {items.map((i) => {
        const d = i.to - i.from
        const w = `${(Math.abs(d) / max) * 100}%`
        const tip = `${i.name}: ${money(i.from)} → ${money(i.to)} (${d >= 0 ? '+' : ''}${money(d)})`
        return (
          <div key={i.name} style={{ display: 'contents' }}>
            {i.href ? (
              <Link className="n" href={i.href} scroll={false} title={i.name}>
                {i.name}
              </Link>
            ) : (
              <span className="n">{i.name}</span>
            )}
            <span className="l" title={tip}>{d < 0 ? <i style={{ width: w }} /> : null}</span>
            <span className="r" title={tip}>{d > 0 ? <i style={{ width: w }} /> : null}</span>
            <span className={`v ${d >= 0 ? 'mor-up' : 'mor-down'}`}>
              {d >= 0 ? '+' : ''}
              {money(d)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function Spark({ values, slot, w = 72, h = 22 }: { values: number[]; slot?: number; w?: number; h?: number }) {
  if (values.length < 2) return null
  const max = Math.max(...values), min = Math.min(...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 2 - (max === min ? (h - 4) / 2 : ((v - min) / (max - min)) * (h - 4))}`).join(' ')
  return (
    <svg className={`mor-spark ${sc(slot)}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} />
    </svg>
  )
}

/** A creative's thumbnail from MediaRadar's API, through the portfolio's proxy; it opens the ad itself. */
export function Thumb({ id, alt, big }: { id: string; alt: string; big?: boolean }) {
  return (
    <a href={`/taxonomy-comparison/creative/${id}?type=creative`} target="_blank" rel="noreferrer" title="Open the ad">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={big ? undefined : 'mor-thumb'} src={`/taxonomy-comparison/creative/${id}?type=thumbnail`} alt={alt} loading="lazy" />
    </a>
  )
}

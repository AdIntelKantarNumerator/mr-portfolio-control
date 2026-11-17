/**
 * Prototypes > Magnifier Offline Reports (Scott, 16 November 2026).
 *
 * The Magnifier offline Excel reports (Summary Report, Occurrence Table,
 * Weekly FastTrack) as one dashboard on GPC data, in the look of Insights
 * Studio. First a GPC taxonomy node is picked, at any level; then the
 * dashboard opens on it, and every element drills into a tab mirroring a
 * sheet of the workbooks. Live from Dev ClickHouse (lib/magnifier-reports).
 *
 * Only people with "Sees prototypes" reach it (lib/access-rules.ts).
 */
import Link from 'next/link'
import { Suspense } from 'react'
import * as data from '@/lib/magnifier-reports/data'
import { addDays, dayLabel, monthLabel, trail, type Level } from '@/lib/magnifier-reports/rules'
import { FilterBar, type PillSpec } from './filter-bar'
import { CategoryPicker } from './picker'
import { href, readState, TABS, type State } from './state'
import { ReportView, type Ctx } from './views'
import './mor.css'

export const metadata = { title: 'Magnifier Offline Reports' }
export const dynamic = 'force-dynamic'

type Search = Promise<Record<string, string | string[] | undefined>>

export default async function MagnifierOfflineReportsPage({ searchParams }: { searchParams: Search }) {
  const s = readState(await searchParams)
  if (!data.configured()) {
    return (
      <div className="mor">
        <h1 className="mor-title">Magnifier Offline Reports</h1>
        <div className="mor-card w12 mor-empty">Dev ClickHouse is not connected here (CLICKHOUSE_DEV_URL).</div>
      </div>
    )
  }

  let months: number[], tax: Awaited<ReturnType<typeof data.taxonomy>>
  try {
    months = await data.months()
    tax = await data.taxonomy(months.at(-1)!)
  } catch (err) {
    return (
      <div className="mor">
        <h1 className="mor-title">Magnifier Offline Reports</h1>
        <div className="mor-card w12 mor-empty">{(err as Error).message}</div>
      </div>
    )
  }
  const latest = months.at(-1)!
  const node = s.node != null ? tax.nodes.find((n) => n.id === s.node) : undefined

  if (!node) {
    return (
      <div className="mor">
        <div className="mor-kicker">Magnifier Offline Reports</div>
        <h1 className="mor-title">Pick a category</h1>
        <p className="mor-sub">
          GPC taxonomy · spend in {monthLabel(latest)}
        </p>
        <CategoryPicker nodes={tax.nodes} spend={tax.spend} monthName={monthLabel(latest)} />
      </div>
    )
  }

  const ym = s.m != null && months.includes(s.m) ? s.m : latest
  const weeks = await data.weeks(months[0]).catch(() => [] as string[])
  const week = s.w && weeks.includes(s.w) ? s.w : (weeks.at(-1) ?? '')
  const path = trail(tax.nodes, node.id)
  const ctx: Ctx = { s: { ...s, m: ym === latest ? null : ym }, node, months, ym, weeks, week }
  const st = ctx.s

  // The filter pills. Each option is the address it leads to.
  const weekly = st.tab === 'fasttrack' || st.tab === 'occurrences'
  const pills: PillSpec[] = []
  if (weekly) {
    pills.push({
      label: 'Week',
      value: href(st),
      options: [...weeks].reverse().map((w) => ({ label: `${dayLabel(w)}–${dayLabel(addDays(w, 6))}`, href: href(st, { w: w === weeks.at(-1) ? null : w }) })),
    })
  } else {
    pills.push({ label: 'Month', value: href(st), options: [...months].reverse().map((m) => ({ label: monthLabel(m), href: href(st, { m: m === latest ? null : m }) })) })
    if (['media', 'outlets', 'creatives'].includes(st.tab)) {
      pills.push({
        label: 'Period',
        value: href(st),
        options: [
          { label: 'The month', href: href(st, { span: 'month' }) },
          { label: `${monthLabel(months[0], true)} to ${monthLabel(ym, true)}`, href: href(st, { span: 'all' }) },
        ],
      })
    }
  }
  const mediaNames = await data
    .cube({ node: node.id, level: node.level as Level }, months)
    .then((rows) => [...new Set(rows.map((r) => r.media))].sort())
    .catch(() => [] as string[])
  pills.push({ label: 'Media', value: href(st), options: [{ label: 'All media', href: href(st, { media: null }) }, ...mediaNames.map((m) => ({ label: m, href: href(st, { media: m }) }))] })
  pills.push({
    label: 'Advertiser level',
    value: href(st),
    options: [
      { label: 'Advertiser', href: href(st, { who: 'advertiser', adv: st.who === 'advertiser' ? st.adv : null }) },
      { label: 'Parent company', href: href(st, { who: 'parent', adv: st.who === 'parent' ? st.adv : null }) },
    ],
  })
  const focusName = st.adv ? await focusLabel(node.id, node.level as Level, months, st) : null

  // The Excel download for this tab: the workbook clients get today.
  const kind = st.tab === 'fasttrack' ? 'fasttrack' : st.tab === 'occurrences' ? 'occurrences' : 'summary'
  const excel = {
    href: `/prototypes/magnifier-offline-reports/workbook${href(st)}${href(st) === '?' ? '' : '&'}kind=${kind}`,
    label: kind === 'fasttrack' ? 'FastTrack' : kind === 'occurrences' ? 'Occurrence Table' : 'Summary Report',
  }

  return (
    <div className="mor">
      <div className="mor-kicker">
        <Link href="?">Magnifier Offline Reports</Link>
        {path.slice(0, -1).map((p) => (
          <span key={p.id} style={{ display: 'contents' }}>
            <span className="sep">›</span>
            <Link href={href({ ...st, node: p.id, adv: null })}>{p.name}</Link>
          </span>
        ))}
        <span className="mor-chip">{node.level}</span>
      </div>
      <h1 className="mor-title">{node.name}</h1>
      <p className="mor-sub">
        {weekly && week ? `Week of ${dayLabel(week)}` : monthLabel(ym)}
        {st.media ? ` · ${st.media}` : ' · all media'} · <Link href="?" style={{ color: 'var(--mor-accent)' }}>Change category</Link>
      </p>
      <FilterBar pills={pills} focus={focusName ? { name: focusName, clear: href(st, { adv: null }) } : null} excel={excel} />
      <nav className="mor-tabs" aria-label="Report sections">
        {TABS.map((t) => (
          <Link key={t.id} href={href(st, { tab: t.id })} className={t.id === st.tab ? 'on' : undefined} scroll={false}>
            {t.label}
          </Link>
        ))}
      </nav>
      <Suspense key={href(st)} fallback={<Loading />}>
        <Body ctx={ctx} />
      </Suspense>
      <p className="mor-foot">
        Prototype on development data (GPC, Dev ClickHouse). Every media from {monthLabel(months[0])}; the current month is left out until it is complete.
      </p>
    </div>
  )
}

async function Body({ ctx }: { ctx: Ctx }) {
  try {
    return await ReportView(ctx)
  } catch (err) {
    return <div className="mor-card w12 mor-empty">This part of the report could not be read: {(err as Error).message}</div>
  }
}

function Loading() {
  return (
    <div className="mor-loading" aria-label="Loading">
      <div className="w12" />
      <div />
      <div />
      <div />
      <div />
    </div>
  )
}

/** The focus advertiser's name, from the node's cube (already read for the media list). */
async function focusLabel(node: number, level: Level, months: number[], s: State): Promise<string | null> {
  const rows = await data.cube({ node, level }, months).catch(() => [])
  const r = rows.find((x) => (s.who === 'parent' ? x.pid : x.aid) === s.adv)
  return r ? (s.who === 'parent' ? r.pname || r.aname : r.aname) : `#${s.adv}`
}

/**
 * The report itself: the dashboard and the drill-down tabs, each mirroring a
 * sheet of the Magnifier offline workbooks (Summary Report, Occurrence Table,
 * Weekly FastTrack). Server components; every number is read live from Dev
 * ClickHouse through lib/magnifier-reports/data.ts.
 */
import Link from 'next/link'
import * as data from '@/lib/magnifier-reports/data'
import {
  addDays, colourSlots, dayLabel, int, LEVEL_SQL, mediaMatrix, money, monthLabel, monthTotals, ordinal, pct, rank, shifts, sumBy,
  type CubeRow, type Level, type Ranked, type TaxNode,
} from '@/lib/magnifier-reports/rules'
import { Card, Columns, Delta, HBars, Kpi, Legend, Shifts, Spark, Stack, Thumb, sc, type Segment } from './charts'
import { href, type State } from './state'

export interface Ctx {
  s: State
  node: TaxNode
  months: number[]
  ym: number
  weeks: string[]
  week: string
}

const scopeOf = (c: Ctx, withAdv: boolean): data.Scope => ({ node: c.node.id, level: c.node.level as Level, media: c.s.media, who: c.s.who, adv: withAdv ? c.s.adv : null })
const spanMonths = (c: Ctx) => (c.s.span === 'all' ? c.months.filter((m) => m <= c.ym) : [c.ym])
const spanName = (c: Ctx) => (c.s.span === 'all' ? `${monthLabel(c.months[0], true)}–${monthLabel(c.ym)}` : monthLabel(c.ym))
const weekNum = (w: string) => Number(w.replaceAll('-', ''))
const weekName = (w: string) => `${dayLabel(w)}–${dayLabel(addDays(w, 6))}`

/** One colour per advertiser for the whole window, so it is the same on every chart. */
function slotsFor(rows: CubeRow[], c: Ctx) {
  return colourSlots(sumBy(rows, (r) => (c.s.who === 'parent' ? r.pid : r.aid), () => '').map((x) => ({ key: x.key })))
}
/** Media colours the same way: by their spend over the window. */
function mediaSlots(rows: CubeRow[]) {
  const m = new Map<string, number>()
  sumBy(rows, (r) => r.media, (r) => r.media).slice(0, 8).forEach((x, i) => m.set(x.key, i + 1))
  return m
}

export async function ReportView(c: Ctx) {
  switch (c.s.tab) {
    case 'advertisers': return <Advertisers {...c} />
    case 'products': return <Products {...c} />
    case 'media': return <Media {...c} />
    case 'outlets': return <Outlets {...c} />
    case 'creatives': return <Creatives {...c} />
    case 'occurrences': return <Occurrences {...c} />
    case 'fasttrack': return <FastTrack {...c} />
    default: return <Dashboard {...c} />
  }
}

function Empty({ text = 'No spend recorded here for this period.' }: { text?: string }) {
  return <div className="mor-card w12 mor-empty">{text}</div>
}

// ================================================================== Dashboard

async function Dashboard(c: Ctx) {
  const { s, ym, months } = c
  const window = months.filter((m) => m <= ym)
  const [rows, ads] = await Promise.all([data.cube(scopeOf(c, false), window), data.creatives(scopeOf(c, false), { months: [ym] }, 80)])
  const ranked = rank(rows, ym, window, s.who)
  const now = ranked.filter((r) => r.spend > 0)
  if (!now.length) return <Empty />
  const slots = slotsFor(rows, c)
  const totals = monthTotals(rows, window)
  const total = totals.at(-1) ?? 0
  const prior = window.length > 1 ? totals.at(-2)! : null
  const leader = now[0]
  const focus = s.adv ? ranked.find((r) => r.key === s.adv) ?? null : null
  const ptd = rank(rows, ym, window, s.who).map((r) => ({ ...r, ptd: r.trend.reduce((a, b) => a + b, 0) })).sort((a, b) => b.ptd - a.ptd)
  const ptdTotal = ptd.reduce((a, r) => a + r.ptd, 0)
  const ptdFocus = focus ? ptd.findIndex((r) => r.key === focus.key) : -1
  const go = (patch: Partial<State>) => href(s, patch)
  const focusHref = (k: number) => go({ adv: k })

  // Share of voice: the top seven this month and everyone else, this month against the last.
  const top = now.slice(0, 7)
  const segsFor = (key: 'spend' | 'prior'): Segment[] => {
    const head = top.map((r) => ({ name: r.name, value: r[key], slot: slots.get(r.key) ?? 0 }))
    const rest = ranked.filter((r) => !top.includes(r)).reduce((a, r) => a + r[key], 0)
    return [...head, { name: 'Others', value: rest, slot: 0 }]
  }

  // Media allocation: the market, the focus and the top five.
  const mm = mediaMatrix(rows, ym, s.who)
  const mslots = mediaSlots(rows)
  const mediaSegs = (k: number | null): Segment[] => mm.media.map((m) => ({ name: m.name, value: k == null ? m.spend : mm.at(k, m.key), slot: mslots.get(m.key) ?? 0 }))
  const mediaRows = [...(focus && !now.slice(0, 5).includes(focus) ? [focus] : []), ...now.slice(0, 5)]

  // Category allocation: the node's children this month.
  const kids = sumBy(rows, (r) => r.cid, (r) => r.cname, (r) => r.ym === ym).filter((k) => k.spend > 0)
  const childLabel = LEVEL_SQL[c.node.level as Level].child.label

  // Creative highlights: the heaviest ad of each of the top six.
  const seen = new Set<number>()
  const highlights = ads.filter((a) => {
    const k = s.who === 'parent' ? a.advertiser : a.aid
    if (seen.has(k as number) || seen.size >= 6) return false
    seen.add(k as number)
    return true
  })

  const month = monthLabel(ym)
  return (
    <div className="mor-grid">
      <Kpi label={`Total market · ${month}`} value={money(total)} foot={prior != null ? <><Delta v={prior ? total / prior - 1 : null} /> vs {monthLabel(window.at(-2)!, true)}</> : `${now.length} advertisers`} />
      <Kpi label={`Leader · ${month}`} name value={<a href={focusHref(leader.key)}>{leader.name}</a>} foot={<>{pct(leader.sov)} share · {money(leader.spend)}</>} />
      {focus ? (
        <>
          <Kpi label={`${focus.name} · ${month}`} value={focus.rank ? ordinal(focus.rank) : '—'} foot={<>{money(focus.spend)} · {pct(focus.sov)} share · <Delta v={focus.delta} /></>} />
          <Kpi
            label="Gap to the leader"
            value={focus.key === leader.key ? 'Leading' : money(focus.spend - leader.spend)}
            foot={focus.key === leader.key ? `${pct(leader.sov - (now[1]?.sov ?? 0))} ahead of ${now[1]?.name ?? 'the next'}` : <>{((focus.sov - leader.sov) * 100).toFixed(1)} pts of share · since {monthLabel(window[0], true)}: {ptdFocus >= 0 ? ordinal(ptdFocus + 1) : '—'}</>}
          />
        </>
      ) : (
        <>
          <Kpi label={`Advertisers · ${month}`} value={int(now.length)} foot={`Top 5 hold ${pct(now.slice(0, 5).reduce((a, r) => a + r.sov, 0))}`} />
          <Kpi label={`Since ${monthLabel(window[0], true)}`} value={money(ptdTotal)} foot={<>Leader {ptd[0]?.name} · {pct(ptdTotal ? ptd[0].ptd / ptdTotal : 0)}</>} />
        </>
      )}

      <Card title="Total market spending" note="by month" more={go({ tab: 'advertisers' })}>
        <Columns items={window.map((m, i) => ({ label: monthLabel(m), value: totals[i], on: m === ym, href: go({ m }) }))} />
      </Card>

      <Card title="Share of voice leaders" note={`${month} vs ${window.length > 1 ? monthLabel(window.at(-2)!, true) : '—'}`} more={go({ tab: 'advertisers' })}>
        {window.length > 1 ? (
          <div className="mor-stackrow tall">
            <span>{monthLabel(window.at(-2)!, true)}</span>
            <Stack segs={segsFor('prior')} tall />
          </div>
        ) : null}
        <div className="mor-stackrow tall">
          <span>{monthLabel(ym, true)}</span>
          <Stack segs={segsFor('spend')} tall />
        </div>
        <Legend segs={segsFor('spend')} />
      </Card>

      <Card title="Spending shifts" note={window.length > 1 ? `${monthLabel(window.at(-2)!, true)} → ${monthLabel(ym, true)}` : undefined} more={go({ tab: 'advertisers' })}>
        {window.length > 1 ? <Shifts items={shifts(ranked, 10).map((r) => ({ name: r.name, from: r.prior, to: r.spend, href: focusHref(r.key) }))} /> : <div className="mor-empty">No earlier month to compare.</div>}
      </Card>

      <Card title="Advertiser rankings" note={month} more={go({ tab: 'advertisers' })}>
        <RankTable ranked={now.slice(0, 10)} slots={slots} focus={s.adv} hrefFor={focusHref} />
      </Card>

      <Card title="Media allocation" note={month} more={go({ tab: 'media' })}>
        <div className="mor-stackrow tall">
          <b>Market</b>
          <Stack segs={mediaSegs(null)} tall />
        </div>
        {mediaRows.map((r) => (
          <div key={r.key} className="mor-stackrow">
            <Link href={focusHref(r.key)} scroll={false} title={r.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: r.key === s.adv ? 700 : 400 }}>
              {r.name}
            </Link>
            <Stack segs={mediaSegs(r.key)} />
          </div>
        ))}
        <Legend segs={mediaSegs(null)} />
      </Card>

      <Card title={`${childLabel} allocation`} note={month} more={c.node.level === 'Subcategory' ? go({ tab: 'products' }) : undefined}>
        <HBars
          items={kids.slice(0, 12).map((k) => ({
            name: k.name,
            value: k.spend,
            extra: pct(total ? k.spend / total : 0, 0),
            href: c.node.level === 'Subcategory' || !k.key ? undefined : href({ ...s, node: k.key, adv: null }),
          }))}
        />
      </Card>

      <Card title="Creative messaging highlights" note={`heaviest ad of the leading advertisers, ${month}`} w={12} more={go({ tab: 'creatives' })}>
        <div className="mor-ads">
          {highlights.map((a) => (
            <article key={a.id} className="mor-ad">
              <Thumb id={a.id} alt={a.title || a.advertiser} big />
              <div className="body">
                <span className={`who ${sc(slots.get(s.who === 'parent' ? -1 : a.aid))}`}>
                  <i className="mor-dot" />
                  {a.advertiser}
                  {a.firstSeen && a.firstSeen >= `${String(ym).slice(0, 4)}-${String(ym).slice(4)}-01` ? <span className="mor-badge">New</span> : null}
                </span>
                <span className="t">{a.title || a.product}</span>
                {a.lead ? <span className="lead">{a.lead}</span> : null}
                <span>{a.media.join(', ')}{a.length ? ` · ${a.length}s` : ''}</span>
                <span className="money">
                  {money(a.spend)} · {pct(a.advTotal ? a.spend / a.advTotal : 0, 0)} of the advertiser
                </span>
              </div>
            </article>
          ))}
        </div>
      </Card>
    </div>
  )
}

function RankTable({ ranked, slots, focus, hrefFor }: { ranked: Ranked[]; slots: Map<number, number>; focus: number | null; hrefFor: (k: number) => string }) {
  return (
    <div className="mor-tablewrap">
      <table className="mor-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Advertiser</th>
            <th>Trend</th>
            <th className="num">Spend</th>
            <th className="num">SOV</th>
            <th className="num">Change</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r) => (
            <tr key={r.key} className={r.key === focus ? 'me' : undefined}>
              <td className="num muted">{r.rank}</td>
              <td>
                <Link className={`mor-name ${sc(slots.get(r.key))}`} href={hrefFor(r.key)} scroll={false}>
                  <i className="mor-dot" />
                  {r.name}
                </Link>
              </td>
              <td>
                <Spark values={r.trend} slot={slots.get(r.key)} />
              </td>
              <td className="num">{money(r.spend)}</td>
              <td className="num">{pct(r.sov)}</td>
              <td className="num">
                <Delta v={r.delta} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ================================================================== Advertisers (Summary + AdvertiserQuickPivot)

async function Advertisers(c: Ctx) {
  const { s, ym, months } = c
  const window = months.filter((m) => m <= ym)
  const rows = await data.cube(scopeOf(c, false), window)
  const ranked = rank(rows, ym, window, s.who)
  if (!ranked.length) return <Empty />
  const slots = slotsFor(rows, c)
  const totals = monthTotals(rows, window)
  const all = totals.reduce((a, b) => a + b, 0)
  const total = totals.at(-1)!, priorTotal = window.length > 1 ? totals.at(-2)! : 0
  const hasPrior = window.length > 1
  return (
    <div className="mor-grid">
      <Card title="Spending summary with share of voice" note={`${monthLabel(ym)}${hasPrior ? ` vs ${monthLabel(window.at(-2)!)}` : ''} · ${int(ranked.length)} ${s.who === 'parent' ? 'parents' : 'advertisers'}`} w={12}>
        <div className="mor-tablewrap">
          <table className="mor-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{s.who === 'parent' ? 'Parent' : 'Advertiser'}</th>
                {window.map((m) => (
                  <th key={m} className="num">{monthLabel(m, true)}</th>
                ))}
                <th className="num">Since {monthLabel(window[0], true)}</th>
                <th className="num">SOV {monthLabel(ym, true)}</th>
                {hasPrior ? <th className="num">SOV {monthLabel(window.at(-2)!, true)}</th> : null}
                {hasPrior ? <th className="num">SOV change</th> : null}
                {hasPrior ? <th className="num">Spend change</th> : null}
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, 200).map((r) => (
                <tr key={r.key} className={r.key === s.adv ? 'me' : undefined}>
                  <td className="num muted">{r.rank || '—'}</td>
                  <td>
                    <Link className={`mor-name ${sc(slots.get(r.key))}`} href={href(s, { adv: r.key })} scroll={false}>
                      <i className="mor-dot" />
                      {r.name}
                    </Link>
                  </td>
                  {r.trend.map((v, i) => (
                    <td key={i} className={`num ${v ? '' : 'zero'}`}>{v ? money(v) : '–'}</td>
                  ))}
                  <td className="num">{money(r.trend.reduce((a, b) => a + b, 0))}</td>
                  <td className="num">{pct(r.sov)}</td>
                  {hasPrior ? <td className="num">{pct(r.priorSov)}</td> : null}
                  {hasPrior ? <td className="num"><Delta v={r.sov - r.priorSov} points /></td> : null}
                  {hasPrior ? <td className="num"><Delta v={r.delta} /></td> : null}
                </tr>
              ))}
              <tr className="total">
                <td />
                <td>Total market</td>
                {totals.map((v, i) => (
                  <td key={i} className="num">{money(v)}</td>
                ))}
                <td className="num">{money(all)}</td>
                <td className="num">100%</td>
                {hasPrior ? <td className="num">100%</td> : null}
                {hasPrior ? <td /> : null}
                {hasPrior ? <td className="num"><Delta v={priorTotal ? total / priorTotal - 1 : null} /></td> : null}
              </tr>
            </tbody>
          </table>
        </div>
        {ranked.length > 200 ? <p className="mor-foot">The top 200 of {int(ranked.length)}.</p> : null}
      </Card>
    </div>
  )
}

// ================================================================== Products (Product|Campaign, Product|Media|Trend)

async function Products(c: Ctx) {
  const { s, ym, months } = c
  const window = months.filter((m) => m <= ym)
  const list = await data.products(scopeOf(c, true), { months: window }, s.bymedia)
  if (!list.length) return <Empty />
  const groups: Array<{ aid: number; name: string; rows: typeof list }> = []
  for (const p of list) {
    const g = groups.at(-1)
    if (g && g.aid === p.aid) g.rows.push(p)
    else groups.push({ aid: p.aid, name: p.advertiser, rows: [p] })
  }
  const sumMonth = (rows: typeof list, m: number) => rows.reduce((a, r) => a + (r.byMonth[m] ?? 0), 0)
  return (
    <div className="mor-grid">
      <Card title={s.bymedia ? 'Monthly trend by product and media' : 'Monthly spending trend by product'} note={`${monthLabel(window[0], true)}–${monthLabel(ym)}`} w={12}>
        <div className="mor-bar" style={{ border: 0, padding: 0, background: 'none', marginBottom: 8 }}>
          <Link className="mor-btn" href={href(s, { bymedia: !s.bymedia })} scroll={false}>
            {s.bymedia ? 'Products only' : 'Split by media'}
          </Link>
        </div>
        <div className="mor-tablewrap">
          <table className="mor-table">
            <thead>
              <tr>
                <th>Advertiser</th>
                <th>Subcategory</th>
                <th>Product</th>
                {s.bymedia ? <th>Media</th> : null}
                {window.map((m) => (
                  <th key={m} className="num">{monthLabel(m, true)}</th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <ProductGroup key={g.aid} g={g} window={window} bymedia={s.bymedia} sumMonth={sumMonth} focusHref={href(s, { adv: g.aid, who: 'advertiser' })} />
              ))}
            </tbody>
          </table>
        </div>
        {list.length >= 400 ? <p className="mor-foot">The first 400 rows. Focus an advertiser or pick a narrower category for the rest.</p> : null}
      </Card>
    </div>
  )
}

function ProductGroup({ g, window, bymedia, sumMonth, focusHref }: { g: { aid: number; name: string; rows: data.ProductRow[] }; window: number[]; bymedia: boolean; sumMonth: (rows: data.ProductRow[], m: number) => number; focusHref: string }) {
  return (
    <>
      {g.rows.map((p, i) => (
        <tr key={`${p.pid}|${p.media}`}>
          <td>{i === 0 ? <Link href={focusHref} scroll={false}>{g.name}</Link> : null}</td>
          <td className="muted">{p.subcategory || p.category}</td>
          <td>{p.product}</td>
          {bymedia ? <td className="muted">{p.media}</td> : null}
          {window.map((m) => (
            <td key={m} className={`num ${p.byMonth[m] ? '' : 'zero'}`}>{p.byMonth[m] ? money(p.byMonth[m]) : '–'}</td>
          ))}
          <td className="num">{money(p.total)}</td>
        </tr>
      ))}
      <tr className="sub">
        <td colSpan={bymedia ? 4 : 3}>{g.name} total</td>
        {window.map((m) => (
          <td key={m} className="num">{money(sumMonth(g.rows, m))}</td>
        ))}
        <td className="num">{money(g.rows.reduce((a, r) => a + r.total, 0))}</td>
      </tr>
    </>
  )
}

// ================================================================== Media (MediaType, MediaMix, MediaSOV)

async function Media(c: Ctx) {
  const { s, ym, months } = c
  const window = months.filter((m) => m <= ym)
  const rows = await data.cube(scopeOf(c, false), window)
  const keep = new Set(spanMonths(c))
  const mm = mediaMatrix(rows.filter((r) => keep.has(r.ym)), null, s.who)
  if (!mm.people.length) return <Empty />
  const slots = slotsFor(rows, c)
  const people = mm.people.slice(0, 40)
  const focus = s.adv ? mm.people.find((p) => p.key === s.adv) : null
  if (focus && !people.includes(focus)) people.unshift(focus)
  const marketTotal = mm.media.reduce((a, m) => a + m.spend, 0)
  const views: Array<[State['view'], string]> = [['spend', 'Spending'], ['mix', 'Media mix %'], ['sov', 'Share of voice %']]
  const cell = (pk: number, pTotal: number, media: { key: string; spend: number }) => {
    const v = mm.at(pk, media.key)
    if (s.view === 'mix') return { v: pTotal ? v / pTotal : 0, txt: pct(pTotal ? v / pTotal : 0, 0) }
    if (s.view === 'sov') return { v: media.spend ? v / media.spend : 0, txt: pct(media.spend ? v / media.spend : 0, 0) }
    return { v: 0, txt: v ? money(v) : '–' }
  }
  return (
    <div className="mor-grid">
      <Card title={views.find((v) => v[0] === s.view)![1].replace(' %', '')} note={`${spanName(c)} · ${s.view === 'mix' ? 'each row adds to 100%' : s.view === 'sov' ? 'each column adds to 100%' : 'by media'}`} w={12}>
        <div className="mor-bar" style={{ border: 0, padding: 0, background: 'none', marginBottom: 8 }}>
          {views.map(([v, label]) => (
            <Link key={v} className="mor-btn" href={href(s, { view: v })} scroll={false} style={v === s.view ? { borderColor: 'var(--mor-accent)', color: 'var(--mor-accent)' } : undefined}>
              {label}
            </Link>
          ))}
        </div>
        <div className="mor-tablewrap">
          <table className="mor-table">
            <thead>
              <tr>
                <th>{s.who === 'parent' ? 'Parent' : 'Advertiser'}</th>
                {mm.media.map((m) => (
                  <th key={m.key} className="num">
                    <Link href={href(s, { media: m.key, tab: 'dashboard' })} title={`Narrow the report to ${m.key}`}>{m.key}</Link>
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.key} className={p.key === s.adv ? 'me' : undefined}>
                  <td>
                    <Link className={`mor-name ${sc(slots.get(p.key))}`} href={href(s, { adv: p.key })} scroll={false}>
                      <i className="mor-dot" />
                      {p.name}
                    </Link>
                  </td>
                  {mm.media.map((m) => {
                    const x = cell(p.key, p.spend, m)
                    return (
                      <td key={m.key} className={`num ${s.view !== 'spend' ? 'heat' : ''}`} style={s.view !== 'spend' ? { ['--h' as string]: x.v } : undefined}>
                        {x.txt}
                      </td>
                    )
                  })}
                  <td className="num">{s.view === 'spend' ? money(p.spend) : s.view === 'mix' ? '100%' : pct(marketTotal ? p.spend / marketTotal : 0, 0)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Total market</td>
                {mm.media.map((m) => (
                  <td key={m.key} className="num">{s.view === 'spend' ? money(m.spend) : s.view === 'mix' ? pct(marketTotal ? m.spend / marketTotal : 0, 0) : '100%'}</td>
                ))}
                <td className="num">{s.view === 'spend' ? money(marketTotal) : '100%'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {mm.people.length > people.length ? <p className="mor-foot">The top {people.length} of {int(mm.people.length)}.</p> : null}
      </Card>
    </div>
  )
}

// ================================================================== Outlets (MediaOutlet)

async function Outlets(c: Ctx) {
  const { s, ym, months } = c
  const window = months.filter((m) => m <= ym)
  const sm = spanMonths(c)
  const [rows, list] = await Promise.all([data.cube(scopeOf(c, false), window), data.outlets(scopeOf(c, true), { months: sm })])
  if (!list.length) return <Empty />
  const slots = slotsFor(rows, c)
  const keep = new Set(sm)
  const cols = s.adv
    ? [{ key: s.adv, name: rank(rows, ym, window, s.who).find((r) => r.key === s.adv)?.name ?? 'Focus' }]
    : sumBy(rows, (r) => (s.who === 'parent' ? r.pid : r.aid), (r) => (s.who === 'parent' ? r.pname || r.aname : r.aname), (r) => keep.has(r.ym)).slice(0, 8)
  return (
    <div className="mor-grid">
      <Card title="Spending by media outlet" note={`${spanName(c)} · top ${list.length} outlets`} w={12}>
        <div className="mor-tablewrap">
          <table className="mor-table">
            <thead>
              <tr>
                <th>Media</th>
                <th>Market</th>
                <th>Outlet</th>
                {cols.map((a) => (
                  <th key={a.key} className="num">
                    <Link className={`mor-name ${sc(slots.get(a.key))}`} href={href(s, { adv: a.key })} scroll={false}>
                      <i className="mor-dot" />
                      {a.name.length > 18 ? `${a.name.slice(0, 17)}…` : a.name}
                    </Link>
                  </th>
                ))}
                {s.adv ? null : <th className="num">Others</th>}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => {
                const shown = cols.reduce((a, k) => a + (o.byAdv[k.key] ?? 0), 0)
                return (
                  <tr key={`${o.media}|${o.market}|${o.outlet}`}>
                    <td className="muted">{o.media}</td>
                    <td className="muted">{o.market}</td>
                    <td title={o.owner}>{o.outlet}</td>
                    {cols.map((a) => (
                      <td key={a.key} className={`num ${o.byAdv[a.key] ? '' : 'zero'}`}>{o.byAdv[a.key] ? money(o.byAdv[a.key]) : '–'}</td>
                    ))}
                    {s.adv ? null : <td className="num">{money(o.total - shown)}</td>}
                    <td className="num">{money(o.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ================================================================== Creatives

async function Creatives(c: Ctx) {
  const { s } = c
  const sm = spanMonths(c)
  const list = await data.creatives(scopeOf(c, true), { months: sm }, 100)
  if (!list.length) return <Empty />
  const start = `${String(sm[0]).slice(0, 4)}-${String(sm[0]).slice(4)}-01`
  return (
    <div className="mor-grid">
      <Card title="Creative list with ad spend and occurrences" note={`${spanName(c)} · top ${list.length} by spend`} w={12}>
        <div className="mor-tablewrap">
          <table className="mor-table">
            <thead>
              <tr>
                <th>Ad</th>
                <th>Advertiser</th>
                <th>Title / lead</th>
                <th>Media</th>
                <th>Format</th>
                <th>Product</th>
                <th>First run</th>
                <th className="num">Spend</th>
                <th className="num">Share of adv.</th>
                <th className="num">Occ.</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td><Thumb id={a.id} alt={a.title || a.advertiser} /></td>
                  <td><Link href={href(s, { adv: a.aid, who: 'advertiser' })} scroll={false}>{a.advertiser}</Link></td>
                  <td className="wrap" title={a.summary}>
                    <b>{a.title || '—'}</b>
                    {a.firstSeen && a.firstSeen >= start ? <span className="mor-badge">New</span> : null}
                    {a.lead ? <div className="muted">{a.lead.length > 140 ? `${a.lead.slice(0, 139)}…` : a.lead}</div> : null}
                  </td>
                  <td className="muted">{a.media.join(', ')}</td>
                  <td className="muted">{[a.format || a.type, a.length ? `${a.length}s` : ''].filter(Boolean).join(' · ')}</td>
                  <td>{a.product}<div className="muted">{a.subcategory}</div></td>
                  <td className="muted date">{a.firstSeen ?? "—"}</td>
                  <td className="num">{money(a.spend)}</td>
                  <td className="num">{pct(a.advTotal ? a.spend / a.advTotal : 0, 0)}</td>
                  <td className="num">{int(a.occ)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ================================================================== Occurrences (Occurrence Table, FastTrack Detail)

async function Occurrences(c: Ctx) {
  const { week } = c
  const { rows, more } = await data.occurrences(scopeOf(c, true), week, addDays(week, 6))
  if (!rows.length) return <Empty text="No occurrences recorded here this week." />
  return (
    <div className="mor-grid">
      <Card title="Occurrence list" note={`${weekName(week)} · ${more ? `the latest ${rows.length}; the Occurrence Table download has them all` : `${rows.length} rows`}`} w={12}>
        <div className="mor-tablewrap">
          <table className="mor-table">
            <thead>
              <tr>
                <th>Run date</th>
                <th>Advertiser</th>
                <th>Ad</th>
                <th>Media</th>
                <th>Product</th>
                <th>Market</th>
                <th>Outlet</th>
                <th>First run</th>
                <th className="num">Spend</th>
                <th className="num">Occ.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o, i) => (
                <tr key={i}>
                  <td className="muted date">{o.date}</td>
                  <td>{o.advertiser}</td>
                  <td>
                    <a href={`/taxonomy-comparison/creative/${o.creative}?type=creative`} target="_blank" rel="noreferrer" title={`Creative ${o.creative}`}>
                      {o.title || o.creative}
                    </a>
                  </td>
                  <td className="muted">{o.media}</td>
                  <td>{o.product}</td>
                  <td className="muted">{o.market}</td>
                  <td>{o.outlet}</td>
                  <td className="muted date">{o.firstSeen ?? "—"}</td>
                  <td className="num">{money(o.spend)}</td>
                  <td className="num">{int(o.occ)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ================================================================== Weekly FastTrack

async function FastTrack(c: Ctx) {
  const { s, weeks, week } = c
  const upto = weeks.filter((w) => w <= week)
  const prevW = upto.length > 1 ? upto.at(-2)! : null
  const rows = await data.weekCube(scopeOf(c, false), upto[0], week)
  const nums = upto.map(weekNum)
  const ranked = rank(rows, weekNum(week), nums, s.who, prevW ? weekNum(prevW) : 0)
  const now = ranked.filter((r) => r.spend > 0 || r.prior > 0)
  if (!now.length) return <Empty text="No spend recorded here this week." />
  const slots = slotsFor(rows, c)
  const totals = monthTotals(rows, nums)
  const total = totals.at(-1)!, prior = prevW ? totals.at(-2)! : 0
  const leader = ranked[0]
  const ptd = ranked.map((r) => ({ r, v: r.trend.reduce((a, b) => a + b, 0) })).sort((a, b) => b.v - a.v)
  const ptdTotal = totals.reduce((a, b) => a + b, 0)
  const focus = s.adv ? ranked.find((r) => r.key === s.adv) : null
  const fptd = focus ? ptd.findIndex((x) => x.r.key === focus.key) : -1
  const mm = mediaMatrix(rows, weekNum(week), s.who)
  const lastWeeks = upto.slice(-13)
  const lastIdx = lastWeeks.map((w) => upto.indexOf(w))
  return (
    <div className="mor-grid">
      <Kpi label={`Total market · week of ${dayLabel(week)}`} value={money(total)} foot={prevW ? <><Delta v={prior ? total / prior - 1 : null} /> vs last week</> : undefined} />
      <Kpi label="This week's leader" name value={<Link href={href(s, { adv: leader.key })} scroll={false}>{leader.name}</Link>} foot={<>{pct(leader.sov)} share · {money(leader.spend)}</>} />
      {focus ? (
        <Kpi label={focus.name} value={focus.rank ? ordinal(focus.rank) : '—'} foot={<>{money(focus.spend)} · {pct(focus.sov)} share · <Delta v={focus.delta} /></>} />
      ) : (
        <Kpi label="Advertisers this week" value={int(ranked.filter((r) => r.spend > 0).length)} foot={`${int(ranked.filter((r) => r.spend > 0 && !r.prior).length)} not seen last week`} />
      )}
      <Kpi
        label={`Since ${dayLabel(upto[0])}`}
        value={money(ptdTotal)}
        foot={focus ? <>{focus.name}: {fptd >= 0 ? ordinal(fptd + 1) : '—'} · {pct(ptdTotal && fptd >= 0 ? ptd[fptd].v / ptdTotal : 0)}</> : <>Leader {ptd[0].r.name} · {pct(ptdTotal ? ptd[0].v / ptdTotal : 0)}</>}
      />

      <Card title="Total market spending trend" note="by week" w={12}>
        <Columns items={lastWeeks.map((w, i) => ({ label: dayLabel(w), value: totals[lastIdx[i]], on: w === week, href: href(s, { w }) }))} />
      </Card>

      <Card title="Week at a glance" note={`${weekName(week)}${prevW ? ` vs ${weekName(prevW)}` : ''}`} w={12}>
        <div className="mor-tablewrap">
          <table className="mor-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{s.who === 'parent' ? 'Parent' : 'Advertiser'}</th>
                <th className="num">This week</th>
                <th className="num">Last week</th>
                <th className="num">$ change</th>
                <th className="num">% change</th>
                <th className="num">SOV</th>
                <th className="num">SOV last week</th>
                <th>Last {lastWeeks.length} weeks</th>
              </tr>
            </thead>
            <tbody>
              {now.slice(0, 30).map((r) => (
                <tr key={r.key} className={r.key === s.adv ? 'me' : undefined}>
                  <td className="num muted">{r.rank || '—'}</td>
                  <td>
                    <Link className={`mor-name ${sc(slots.get(r.key))}`} href={href(s, { adv: r.key })} scroll={false}>
                      <i className="mor-dot" />
                      {r.name}
                    </Link>
                  </td>
                  <td className="num">{money(r.spend)}</td>
                  <td className="num">{money(r.prior)}</td>
                  <td className={`num ${r.spend >= r.prior ? 'mor-up' : 'mor-down'}`}>{r.spend >= r.prior ? '+' : ''}{money(r.spend - r.prior)}</td>
                  <td className="num"><Delta v={r.delta} /></td>
                  <td className="num">{pct(r.sov)}</td>
                  <td className="num">{pct(r.priorSov)}</td>
                  <td><Spark values={lastIdx.map((i) => r.trend[i])} slot={slots.get(r.key)} w={110} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Weekly media usage" note={weekName(week)} w={12} more={href(s, { tab: 'media' })}>
        <div className="mor-tablewrap">
          <table className="mor-table">
            <thead>
              <tr>
                <th>{s.who === 'parent' ? 'Parent' : 'Advertiser'}</th>
                {mm.media.map((m) => (
                  <th key={m.key} className="num">{m.key}</th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {mm.people.slice(0, 20).map((p) => (
                <tr key={p.key} className={p.key === s.adv ? 'me' : undefined}>
                  <td>{p.name}</td>
                  {mm.media.map((m) => {
                    const v = mm.at(p.key, m.key)
                    return <td key={m.key} className={`num ${v ? '' : 'zero'}`}>{v ? money(v) : '–'}</td>
                  })}
                  <td className="num">{money(p.spend)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Total market</td>
                {mm.media.map((m) => (
                  <td key={m.key} className="num">{money(m.spend)}</td>
                ))}
                <td className="num">{money(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

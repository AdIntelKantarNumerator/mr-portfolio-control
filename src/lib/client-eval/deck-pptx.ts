/**
 * The Impact Deck as a PowerPoint file (Scott, 20 November 2026), from
 * deck-data.ts. Sankeys are drawn as native shapes (curved freeform bands), so
 * they stay sharp and can be edited in PowerPoint.
 */
import PptxGenJS from 'pptxgenjs'
import type { DeckData, FocusEntity, PlatformSection, SankeyData } from './deck-data'
import { GPC_GROUP, TROI_NOTE, type GpcMedia } from './media-map'
import { PLATFORM_LABEL } from './types'

const INK = '1F2430'
const MUTED = '6B7280'
const BRAND = 'E2542B'
const BRAND2 = '1E4C8F'
const LINE = 'E5E7EB'
const GREEN = '15803D'
const RED = 'B91C1C'
const PALETTE = ['1E4C8F', 'E2542B', '0F766E', '7C3AED', 'CA8A04', 'DB2777', '0369A1', '64748B']
const FONT = 'Calibri'

const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${Math.round(v)}`)
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—')

type Slide = ReturnType<PptxGenJS['addSlide']>

function header(s: Slide, title: string, kicker?: string) {
  if (kicker) s.addText(kicker.toUpperCase(), { x: 0.5, y: 0.3, w: 12.3, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: BRAND, charSpacing: 1 })
  s.addText(title, { x: 0.5, y: kicker ? 0.55 : 0.4, w: 12.3, h: 0.7, fontFace: FONT, fontSize: 26, bold: true, color: INK })
  s.addShape('line', { x: 0.5, y: 1.3, w: 12.3, h: 0, line: { color: LINE, width: 1 } })
}

function footer(s: Slide, d: DeckData) {
  s.addText(`${d.title} · Impact of moving to Insights Studio · ${d.generated}`, { x: 0.5, y: 7.05, w: 10, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED })
}

export async function buildDeck(d: DeckData): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = `${d.title}: moving to Insights Studio`
  pptx.company = 'MediaRadar'

  // Title
  const t = pptx.addSlide()
  t.background = { color: 'FFFFFF' }
  t.addShape('rect', { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: BRAND } })
  t.addText('MOVING TO INSIGHTS STUDIO', { x: 0.9, y: 2.2, w: 11, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: BRAND, charSpacing: 2 })
  t.addText(d.title, { x: 0.9, y: 2.7, w: 11.5, h: 1.2, fontFace: FONT, fontSize: 40, bold: true, color: INK, fit: 'shrink' })
  t.addText(d.subtitle, { x: 0.9, y: 3.9, w: 11, h: 0.4, fontFace: FONT, fontSize: 16, color: MUTED })
  t.addText(`What changes in media coverage and taxonomy · ${d.generated}`, { x: 0.9, y: 6.4, w: 11, h: 0.4, fontFace: FONT, fontSize: 12, color: MUTED })

  // What changes
  const h = pptx.addSlide()
  header(h, 'What changes for you', 'Overview')
  h.addText(
    d.highlights.map((b) => ({ text: b, options: { bullet: { code: '25CF' }, paraSpaceAfter: 10 } })),
    { x: 0.6, y: 1.6, w: 8.2, h: 5.2, fontFace: FONT, fontSize: 17, color: INK, valign: 'top' },
  )
  const plats = d.sections.map((s) => `${PLATFORM_LABEL[s.platform]}: ${s.accounts.length} account${s.accounts.length === 1 ? '' : 's'}`)
  h.addShape('roundRect', { x: 9.2, y: 1.6, w: 3.6, h: 2.6, fill: { color: 'F5F7FB' }, line: { color: LINE }, rectRadius: 0.08 })
  h.addText([{ text: 'Platforms today', options: { bold: true, breakLine: true } }, ...plats.map((p) => ({ text: p, options: { breakLine: true } }))], {
    x: 9.4,
    y: 1.75,
    w: 3.3,
    h: 2.3,
    fontFace: FONT,
    fontSize: 13,
    color: INK,
    valign: 'top',
    paraSpaceAfter: 4,
  })
  footer(h, d)

  for (const s of d.sections) {
    mediaSlide(pptx, d, s)
    if (s.focus.entities.length) for (const e of s.focus.entities) sankeySlide(pptx, d, s, e)
    // Classic never restricts advertisers or categories (Scott, 20 November 2026): its media slide says it all.
    else if (s.platform !== 'classic') noteSlide(pptx, d, s)
  }

  // How this was put together
  const n = pptx.addSlide()
  header(n, 'How this was put together', 'Notes')
  n.addText(
    d.notes.map((x) => ({ text: x, options: { bullet: true, paraSpaceAfter: 8 } })),
    { x: 0.6, y: 1.6, w: 12, h: 5, fontFace: FONT, fontSize: 13, color: INK, valign: 'top' },
  )
  footer(n, d)

  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  return out
}

function mediaSlide(pptx: PptxGenJS, d: DeckData, s: PlatformSection) {
  const sl = pptx.addSlide()
  const name = PLATFORM_LABEL[s.platform]
  header(sl, `Media coverage: ${name} today → Insights Studio`, name)
  const cols: Array<{ title: string; color: string; items: string[]; empty: string }> = [
    { title: 'Stays', color: BRAND2, items: groupMedia(s.media.kept), empty: 'Nothing in common' },
    { title: 'Drops', color: RED, items: s.media.dropped, empty: 'Nothing drops' },
    { title: 'Added in Insights Studio', color: GREEN, items: groupMedia(s.media.added), empty: 'Nothing new' },
  ]
  cols.forEach((c, i) => {
    const x = 0.5 + i * 4.15
    sl.addShape('roundRect', { x, y: 1.55, w: 3.95, h: 4.3, fill: { color: 'FFFFFF' }, line: { color: LINE }, rectRadius: 0.06 })
    sl.addShape('rect', { x, y: 1.55, w: 3.95, h: 0.08, fill: { color: c.color } })
    sl.addText(c.title, { x: x + 0.2, y: 1.7, w: 3.6, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: c.color })
    sl.addText(c.items.length ? c.items.map((t) => ({ text: t, options: { breakLine: true } })) : c.empty, {
      x: x + 0.2,
      y: 2.2,
      w: 3.6,
      h: 3.5,
      fontFace: FONT,
      fontSize: 13,
      color: c.items.length ? INK : MUTED,
      valign: 'top',
      paraSpaceAfter: 5,
      fit: 'shrink',
    })
  })
  const notes: string[] = []
  if (s.media.hasDigital) notes.push(TROI_NOTE.text)
  if (!s.media.restricted) notes.push(`${name} does not restrict media for ${s.accounts.length === 1 ? 'this account' : 'these accounts'}: compared against everything ${name} collects.`)
  if (s.media.unknown.length) notes.push(`Not mapped: ${s.media.unknown.join(', ')}.`)
  notes.push(`Accounts: ${s.accounts.slice(0, 6).map((a) => a.name).join(', ')}${s.accounts.length > 6 ? ` and ${s.accounts.length - 6} more` : ''}.`)
  sl.addText(notes.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), {
    x: 0.5,
    y: 6.0,
    w: 12.3,
    h: 1.0,
    fontFace: FONT,
    fontSize: 11,
    color: MUTED,
    valign: 'top',
    fit: 'shrink',
  })
  footer(sl, d)
}

/** GPC media as "TV: Network TV, Cable TV" lines. */
function groupMedia(media: GpcMedia[]): string[] {
  const g = new Map<string, string[]>()
  for (const m of media) (g.get(GPC_GROUP[m]) ?? g.set(GPC_GROUP[m], []).get(GPC_GROUP[m])!).push(m)
  return [...g].map(([k, v]) => `${k}: ${v.join(', ')}`)
}

function noteSlide(pptx: PptxGenJS, d: DeckData, s: PlatformSection) {
  const sl = pptx.addSlide()
  const name = PLATFORM_LABEL[s.platform]
  header(sl, `${name} advertisers and categories in Insights Studio`, name)
  sl.addText(s.focus.note ?? 'Nothing to show.', { x: 0.6, y: 1.7, w: 12, h: 1.2, fontFace: FONT, fontSize: 16, color: MUTED })
  footer(sl, d)
}

function sankeySlide(pptx: PptxGenJS, d: DeckData, s: PlatformSection, e: FocusEntity) {
  const sl = pptx.addSlide()
  const name = PLATFORM_LABEL[s.platform]
  const what = s.focus.kind === 'advertiser' ? 'advertiser' : 'category'
  const why = s.focus.source === 'entitlement' ? 'from their entitlements' : s.focus.source === 'reports' ? 'picked in their 2026 reports' : 'from their 360 reporting profiles'
  header(sl, `${e.name}: ${name} Taxonomy → Insights Studio Taxonomy`, `${name} · one of their five largest ${what === 'advertiser' ? 'advertisers' : 'categories'}, ${why}`)
  drawSankey(sl, e.sankey, { x: 0.5, y: 1.75, w: 8.6, h: 5.0 })

  // The facts beside it.
  const px = 9.4
  sl.addShape('roundRect', { x: px, y: 1.6, w: 3.45, h: 5.3, fill: { color: 'F5F7FB' }, line: { color: LINE }, rectRadius: 0.06 })
  const runs: PptxGenJS.TextProps[] = [{ text: 'Where it lands', options: { bold: true, fontSize: 14, breakLine: true } }]
  for (const f of e.facts) runs.push({ text: f, options: { bullet: true, breakLine: true } })
  if (e.gpc) {
    runs.push({ text: ' ', options: { breakLine: true } })
    runs.push({ text: `In Insights Studio: ${e.gpc.name}`, options: { bold: true, fontSize: 14, breakLine: true } })
    runs.push({ text: `${money(e.gpc.total)} of Aug–Sep 2026 spend in Insights Studio.`, options: { bullet: true, breakLine: true } })
    if (e.gpc.unseen > 0)
      runs.push({ text: `${money(e.gpc.unseen)} (${pct(e.gpc.unseen, e.gpc.total)}) has no product in the ${name} Taxonomy, so ${name} cannot show it today.`, options: { bullet: true, breakLine: true } })
    runs.push({ text: `By media: ${e.gpc.byMedia.map((m) => `${m.media} ${pct(m.spend, e.gpc!.total)}`).join(', ')}.`, options: { bullet: true, breakLine: true } })
  }
  sl.addText(runs, { x: px + 0.15, y: 1.75, w: 3.15, h: 5.0, fontFace: FONT, fontSize: 12, color: INK, valign: 'top', paraSpaceAfter: 4, fit: 'shrink' })
  footer(sl, d)
}

/** A left-to-right Sankey: node bars per column, curved bands between them, labels beside the bars. */
export function drawSankey(sl: Slide, data: SankeyData, box: { x: number; y: number; w: number; h: number }) {
  const cols = data.nodes.length
  const nodeW = 0.16
  const gap = 0.1
  const labelLeft = 1.7
  const labelRight = 2.1
  const usable = box.w - labelLeft - labelRight - nodeW
  const colX = data.nodes.map((_, i) => box.x + labelLeft + (cols === 1 ? 0 : (usable * i) / (cols - 1)))
  const total = Math.max(1, ...data.nodes.map((col) => col.reduce((s, n) => s + n.spend, 0)))
  const maxNodes = Math.max(...data.nodes.map((c) => c.length))
  const scale = (box.h - 0.35 - gap * (maxNodes - 1)) / total
  const top = box.y + 0.35

  // Column titles.
  data.columns.forEach((c, i) =>
    sl.addText(c, { x: colX[i]! - 1, y: box.y - 0.05, w: 2.2, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: MUTED, align: 'center' }),
  )

  // Node positions, each column centred vertically.
  const pos = data.nodes.map((col) => {
    const height = col.reduce((s, n) => s + n.spend * scale, 0) + gap * (col.length - 1)
    let y = top + (box.h - 0.35 - height) / 2
    return col.map((n) => {
      const hgt = Math.max(0.02, n.spend * scale)
      const p = { y, h: hgt }
      y += hgt + gap
      return p
    })
  })

  // Bands, stacked in each node's out- and in-edges.
  const outOff = data.nodes.map((col) => col.map(() => 0))
  const inOff = data.nodes.map((col) => col.map(() => 0))
  const sorted = [...data.links].sort((a, b) => a.col - b.col || a.from - b.from || a.to - b.to)
  for (const l of sorted) {
    const thick = l.spend * scale
    if (thick < 0.003) continue
    const a = pos[l.col]![l.from]!
    const b = pos[l.col + 1]![l.to]!
    const x1 = colX[l.col]! + nodeW
    const x2 = colX[l.col + 1]!
    const y1 = a.y + outOff[l.col]![l.from]!
    const y2 = b.y + inOff[l.col + 1]![l.to]!
    outOff[l.col]![l.from]! += thick
    inOff[l.col + 1]![l.to]! += thick
    const minY = Math.min(y1, y2)
    const maxY = Math.max(y1, y2) + thick
    const w = x2 - x1
    const mid = w / 2
    const ry1 = y1 - minY
    const ry2 = y2 - minY
    const color = PALETTE[(l.col === 0 ? l.to : l.from) % PALETTE.length]!
    // The type list leaves custGeom out, though pptxgenjs draws it (SHAPE_TYPE.CUSTOM_GEOMETRY).
    sl.addShape('custGeom' as PptxGenJS.SHAPE_NAME, {
      x: x1,
      y: minY,
      w,
      h: maxY - minY,
      fill: { color, transparency: 55 },
      line: { color, width: 0, transparency: 100 },
      points: [
        { x: 0, y: ry1 },
        { x: w, y: ry2, curve: { type: 'cubic', x1: mid, y1: ry1, x2: mid, y2: ry2 } },
        { x: w, y: ry2 + thick },
        { x: 0, y: ry1 + thick, curve: { type: 'cubic', x1: mid, y1: ry2 + thick, x2: mid, y2: ry1 + thick } },
        { close: true },
      ],
    } as PptxGenJS.ShapeProps)
  }

  // Bars and labels. A label that would sit on the one above it is left off; the bar stays.
  data.nodes.forEach((col, ci) => {
    let below = -Infinity
    col.forEach((n, ni) => {
      const p = pos[ci]![ni]!
      const color = ci === 0 ? INK : PALETTE[ni % PALETTE.length]!
      sl.addShape('rect', { x: colX[ci]!, y: p.y, w: nodeW, h: p.h, fill: { color }, line: { color, width: 0 } })
      const label = `${n.name} · ${money(n.spend)}`
      const ly = Math.max(p.y + p.h / 2 - 0.16, below)
      if (ly > p.y + p.h + 0.05) return
      below = ly + 0.3
      if (ci === 0) sl.addText(label, { x: box.x, y: ly, w: labelLeft - 0.08, h: 0.32, fontFace: FONT, fontSize: 9, color: INK, align: 'right', fit: 'shrink' })
      else
        sl.addText(label, {
          x: colX[ci]! + nodeW + 0.06,
          y: ly,
          w: ci === cols - 1 ? labelRight - 0.1 : 1.9,
          h: 0.32,
          fontFace: FONT,
          fontSize: 9,
          color: INK,
          fit: 'shrink',
          fill: ci === cols - 1 ? undefined : { color: 'FFFFFF', transparency: 25 },
        })
    })
  })
}

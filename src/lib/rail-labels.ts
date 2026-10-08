/**
 * Where the milestone rail's labels go, and how wide each may be.
 *
 * The dots are placed by date (lib/home.ts), so the gaps between them mean
 * something. The labels used to be laid out as if they did not: each got an
 * even share of the rail and was aligned by its place in the list. Four
 * milestones a few days apart then got four full shares on top of each other,
 * and a lone milestone near the start was right-aligned off the left end.
 *
 * So the layout is worked out from the real positions:
 *
 * - Marks close enough that their labels could never both fit are one label,
 *   "first name +N more". Every dot is still drawn where its date puts it;
 *   only the words are shared.
 * - A label near an end is aligned to that end, so it grows inwards.
 * - Each label may use the space up to halfway to its neighbours, and no
 *   further. Neighbours share the midpoint, so no two labels can overlap.
 * - A label with too little room shows no text rather than two letters and an
 *   ellipsis. The hover and the click-through list still name it.
 *
 * Positions and widths are percentages of the rail, because the rail's width
 * in pixels is not known until it is drawn.
 */

export interface RailMark {
  id: string
  name: string
  /** 0–100, by date. */
  at: number
  /** The date, for the hover. */
  on?: string | null
  /** The work it is recorded on - "Project: Creative Central" - for the hover. */
  from?: string | null
}

/**
 * One milestone, as its hover says it: name, date, and the work it comes
 * from. The last because an objective's rail mixes the milestones of every
 * initiative and project beneath it, and "Rollout - 2026-10-15" alone does
 * not say whose rollout (Scott, 8 October 2026).
 */
export function markTitle(m: Pick<RailMark, 'name' | 'on' | 'from'>): string {
  return `${m.on ? `${m.name} — ${m.on}` : m.name}${m.from ? ` · ${m.from}` : ''}`
}

export type RailAnchor = 'left' | 'center' | 'right'

export interface RailLabel {
  key: string
  /** Empty when there is no room to say anything useful. */
  text: string
  /** Every name in the cluster, with its date. */
  title: string
  /** Where the label is anchored, 0–100. */
  at: number
  anchor: RailAnchor
  /** How wide it may be, in points of the rail. */
  width: number
}

/** Marks this close together share a label. */
export const CLUSTER = 8
/** Within this distance of an end, a label is aligned to that end. */
export const EDGE = 12
/** Narrower than this, a label shows no text. */
export const MIN_WIDTH = 5

export function railLabels(marks: readonly RailMark[]): RailLabel[] {
  const sorted = [...marks].sort((a, b) => a.at - b.at)

  // Each mark joins the cluster when it is close to the previous mark, so a
  // steady run of close dates is one cluster rather than several touching ones.
  const clusters: RailMark[][] = []
  for (const m of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && m.at - last[last.length - 1].at < CLUSTER) last.push(m)
    else clusters.push([m])
  }

  const centres = clusters.map((c) => (c[0].at + c[c.length - 1].at) / 2)

  return clusters.map((c, i) => {
    const at = clamp(centres[i])
    const lo = i === 0 ? 0 : (centres[i - 1] + centres[i]) / 2
    const hi = i === clusters.length - 1 ? 100 : (centres[i] + centres[i + 1]) / 2

    const anchor: RailAnchor = at < EDGE ? 'left' : at > 100 - EDGE ? 'right' : 'center'
    const width =
      anchor === 'left' ? hi - at : anchor === 'right' ? at - lo : 2 * Math.min(at - lo, hi - at)

    const first = c[0].name
    const text = width < MIN_WIDTH ? '' : c.length > 1 ? `${first} +${c.length - 1} more` : first
    const title = c.map(markTitle).join('\n')

    return { key: c.map((m) => m.id).join('+'), text, title, at, anchor, width: Math.max(0, width) }
  })
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n))
}

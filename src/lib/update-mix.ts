/**
 * What a list of update bullets is made of.
 *
 * WHY THIS REPLACED A RING
 *
 * The two update tiles on every detail page each carried a dial. The number
 * inside it was the count of bullets, which is a fact. The arc around it was
 * the share of those bullets Yaara had classified as progress or a decision
 * made — a proportion of her prose, drawn in the shape the rest of the app
 * used for completion. So "3" inside a two-thirds-full ring read as "67%
 * done" at a glance, and meant "two of the three things she wrote mention
 * progress".
 *
 * The count and the colour survive, because both are true: the count is a
 * count, and the colour is the worst kind of thing in the list. What the arc
 * was gesturing at — the composition — is now said in words, which is both
 * honest and more use: "2 progress · 1 blocker" tells a reader what is in
 * there, and a two-thirds arc never could.
 */

/** Worst first. A reader scanning a tile should meet the problems first. */
const ORDER = ['blocker', 'risk', 'decision_needed', 'decision_made', 'change', 'progress'] as const

const LABEL: Record<string, string> = {
  blocker: 'blocker',
  risk: 'risk',
  decision_needed: 'decision needed',
  decision_made: 'decision made',
  change: 'change',
  progress: 'progress',
}

/** The plural of each, where adding an s is wrong. */
const PLURAL: Record<string, string> = {
  decision_needed: 'decisions needed',
  decision_made: 'decisions made',
  progress: 'progress',
}

export interface MixPart {
  kind: string
  count: number
  /** Already pluralised: "2 blockers", "1 decision needed". */
  text: string
}

export function updateMix(items: ReadonlyArray<{ kind: string }>): MixPart[] {
  const counted = new Map<string, number>()
  for (const i of items) counted.set(i.kind, (counted.get(i.kind) ?? 0) + 1)

  // Known kinds in their severity order, then anything unrecognised in the
  // order it arrived. Yaara's vocabulary can grow; a bullet whose kind this
  // list has not heard of should still be counted rather than vanish.
  const known = ORDER.filter((k) => counted.has(k))
  const rest = [...counted.keys()].filter((k) => !(ORDER as readonly string[]).includes(k))

  return [...known, ...rest].map((kind) => {
    const count = counted.get(kind)!
    const one = LABEL[kind] ?? kind.replace(/_/g, ' ')
    const many = PLURAL[kind] ?? `${one}s`
    return { kind, count, text: `${count} ${count === 1 ? one : many}` }
  })
}

/** The whole composition on one line, for a caption or a hover. */
export function updateMixText(items: ReadonlyArray<{ kind: string }>): string {
  return updateMix(items)
    .map((p) => p.text)
    .join(' · ')
}

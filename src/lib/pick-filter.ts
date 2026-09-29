/**
 * Narrowing a long list of things to pick from.
 *
 * The dependency dialogs offer every piece of work in the portfolio as the
 * other end of the link — objectives, initiatives, projects and milestones,
 * which on a real portfolio is several hundred options in one dropdown. A
 * native select answers that with a scrollbar and single-letter type-ahead,
 * so finding "Insight Studio — Client Launch (MVP)" means either knowing it
 * starts with I and pressing I eleven times, or scrolling.
 *
 * THE MATCHING RULE
 *
 * Every word the reader types has to appear somewhere in the option — in its
 * label or in its group — but not in that order and not as a prefix. People
 * type what they remember, and what they remember is two words from the
 * middle: "studio launch" should find "Insight Studio — Client Launch (MVP)",
 * and it does. Requiring the words in order, or anchoring them to the start,
 * turns a search into a guessing game about how the thing was named.
 *
 * Matching the group as well means "project gpc" narrows to the GPC
 * projects, which is how people describe what they are after when the list
 * is grouped in front of them.
 */

export interface Pickable {
  value: string
  label: string
  group: string
}

/**
 * The options worth showing for what has been typed.
 *
 * An empty query returns everything, because an empty box means "I have not
 * said anything yet", not "nothing matches".
 */
export function filterOptions<T extends Pickable>(options: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...options]
  return options.filter((o) => {
    const hay = `${o.label} ${o.group}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** The groups present in a list, in the order they first appear. */
export function groupsOf<T extends Pickable>(options: readonly T[]): string[] {
  return [...new Set(options.map((o) => o.group))]
}

/**
 * Where the highlight goes when an arrow key is pressed.
 *
 * It stops at both ends rather than wrapping. A list that wraps means holding
 * Down past the last item silently returns you to the first, and on a list of
 * three hundred nobody notices they have been round.
 */
export function moveHighlight(current: number, delta: number, count: number): number {
  if (count === 0) return -1
  return Math.max(0, Math.min(count - 1, current + delta))
}

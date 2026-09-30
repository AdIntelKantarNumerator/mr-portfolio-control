/**
 * Each point of an assessment, with the evidence it cites.
 *
 * Yaara's bullets carry the ids of the evidence they rest on, and the same
 * observation carries that evidence with its source and link. The card used
 * to throw the ids away and list the evidence separately, so a reader could
 * see that a meeting was read but not which sentence it supported. Joined
 * here, each point can end with the marks of its own sources — and a link to
 * the meeting's document when there is one.
 */

export interface Cite {
  source: string
  title: string
  url: string | null
}

export interface CitedPoint {
  text: string
  kind: string
  cites: Cite[]
}

/** Several messages from one channel are one source, not five icons. */
const MAX_CITES = 4

export function citedPoints(itemsJson: string | null | undefined, evidenceJson: string | null | undefined): CitedPoint[] {
  const evidence = parseArray<{ id?: string; source?: string; title?: string; url?: string | null }>(evidenceJson)
  const byId = new Map(evidence.filter((e) => e.id).map((e) => [e.id as string, e]))

  return parseArray<{ text?: string; kind?: string; citations?: unknown }>(itemsJson)
    .filter((i) => typeof i.text === 'string' && i.text.trim())
    .map((i) => {
      const seen = new Set<string>()
      const cites: Cite[] = []
      for (const id of Array.isArray(i.citations) ? i.citations : []) {
        const e = byId.get(String(id))
        if (!e?.source) continue
        // Same source and same link (or same title, when there is no link)
        // is the same place to look.
        const key = `${e.source}\u0000${e.url || e.title || ''}`
        if (seen.has(key)) continue
        seen.add(key)
        cites.push({ source: e.source, title: e.title ?? e.source, url: e.url || null })
        if (cites.length >= MAX_CITES) break
      }
      return { text: (i.text as string).trim(), kind: i.kind ?? '', cites }
    })
}

/** First of each text, in order: a rolled-up card repeats its children's points. */
export function dedupePoints(points: CitedPoint[]): CitedPoint[] {
  const seen = new Set<string>()
  return points.filter((p) => (seen.has(p.text) ? false : (seen.add(p.text), true)))
}

function parseArray<T>(json: string | null | undefined): T[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

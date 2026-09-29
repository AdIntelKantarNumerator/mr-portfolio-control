/**
 * Reading a GraphQL schema well enough to build a query it will accept.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * Nothing here talks to Linear or to the database — it is the rules for
 * turning an introspection result into a selection set — and keeping it
 * separate means these rules can be tested without opening a database
 * connection to do it.
 *
 * WHY FIELD NAMES WERE NOT ENOUGH
 *
 * The sync returned 400 on every run for days:
 *
 *   Field "status" of type "InitiativeStatus!" must have a selection of subfields
 *
 * Linear had changed Initiative.status from an enum to an object. The old probe
 * asked only whether a field called "status" still existed — it did — and went
 * on requesting it as a leaf. One invalid field takes the whole query down
 * with it, which is precisely what probing the schema was supposed to prevent:
 * the point of probing is to lose a field, not a sync.
 *
 * So the probe reads each field's type as well, and `pick` refuses to ask for
 * an object bare.
 */

export interface LinearCapabilities {
  types: Map<string, Set<string>>
  has(type: string, field: string): boolean
  hasQuery(name: string): boolean
  /**
   * True when this field can be asked for on its own — a scalar or an enum.
   * False for an object, which needs a selection of subfields, and for a field
   * this schema does not have at all.
   */
  isLeaf(type: string, field: string): boolean
}

/** A GraphQL type reference, through however many NON_NULL and LIST wrappers. */
export interface TypeRef {
  kind: string
  name?: string | null
  ofType?: TypeRef | null
}

export interface IntrospectionResult {
  __schema: {
    queryType: { name: string }
    types: Array<{ name: string; kind: string; fields: Array<{ name: string; type?: TypeRef }> | null }>
  }
}

/** The kind of the named type underneath, past NON_NULL and LIST wrappers. */
export function namedKind(ref: TypeRef | null | undefined): string {
  let cur = ref
  while (cur && !cur.name && cur.ofType) cur = cur.ofType
  return cur?.kind ?? 'SCALAR'
}

const LEAF_KINDS = new Set(['SCALAR', 'ENUM'])

export function capabilitiesFrom(data: IntrospectionResult): LinearCapabilities {
  const types = new Map<string, Set<string>>()
  const leaves = new Map<string, Set<string>>()
  for (const t of data.__schema.types) {
    if (!t.fields) continue
    types.set(t.name, new Set(t.fields.map((f) => f.name)))
    leaves.set(
      t.name,
      // A field with no type in the response is treated as a leaf: that is the
      // old behaviour, and it is the safe direction for a schema that answers
      // an introspection we did not expect.
      new Set(t.fields.filter((f) => !f.type || LEAF_KINDS.has(namedKind(f.type))).map((f) => f.name)),
    )
  }
  const root = types.get(data.__schema.queryType.name) ?? new Set<string>()

  return {
    types,
    has: (type, field) => types.get(type)?.has(field) ?? false,
    hasQuery: (name) => root.has(name),
    isLeaf: (type, field) => leaves.get(type)?.has(field) ?? false,
  }
}

/**
 * Keep only the fields the live schema exposes AND can return bare.
 *
 * A candidate written with its own selection — "owner { id }" — is taken as
 * given: the caller has said what to ask for. A bare candidate is kept only
 * when the schema says it is a scalar or an enum.
 *
 * `objects` is how a caller says what to do when a field HAS become an object:
 * `{ status: 'status { name type }' }`. Without an entry the field is dropped
 * and the sync carries on with everything else, which is the whole point of
 * probing rather than hard-coding.
 */
export function pick(
  caps: LinearCapabilities,
  type: string,
  candidates: string[],
  objects: Record<string, string> = {},
  /**
   * Told about a field that exists but became an object nobody said how to
   * select. Worth surfacing: the sync keeps working, quietly stops carrying
   * that column, and the next person to notice is whoever wonders why every
   * status says "planned".
   */
  onSkip?: (field: string, why: string) => void,
): string[] {
  const out: string[] = []
  for (const candidate of candidates) {
    const name = candidate.split(/[\s({]/)[0]!
    if (!caps.has(type, name)) continue
    if (candidate !== name) {
      out.push(candidate)
      continue
    }
    if (caps.isLeaf(type, name)) {
      out.push(name)
      continue
    }
    const sub = objects[name]
    if (sub) out.push(sub)
    else onSkip?.(name, `${type}.${name} is now an object and was skipped; it needs a selection of subfields`)
  }
  return out
}

/**
 * "Query too complex": how much smaller the next page has to be.
 *
 * Linear scores a query by multiplying the page sizes down every nested
 * connection, and its error states both the score and the ceiling. That makes
 * the right page size arithmetic rather than guesswork — which matters,
 * because the alternative is a smaller constant that works until the next
 * time a workspace grows or somebody adds a field.
 *
 * Lives here with the other rules about talking to a GraphQL server, so it
 * can be tested without a network or a database.
 */
export function complexityRatio(message: string): number | null {
  /*
   * One regex for both numbers, in order, rather than two.
   *
   * Two separate searches looked right and were not: "Complexity:" also
   * occurs inside "Maximum allowed complexity:", so a message whose first
   * number was malformed matched the ceiling twice and returned a ratio of
   * 1 — a "shrink" to the same size, which is a retry loop.
   */
  const m = /\bComplexity:\s*(\d+)\D+?maximum allowed complexity:\s*(\d+)/i.exec(message)
  if (!m) return null
  const from = Number(m[1])
  const to = Number(m[2])
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return null
  return to / from
}

/** The page size to try next, or null when there is no smaller one worth trying. */
export function shrinkPage(pageSize: number, message: string): number | null {
  const ratio = complexityRatio(message)
  if (ratio === null || pageSize <= 1) return null
  // 0.8 of what would just fit: the score is not perfectly linear in the page
  // size, and landing exactly on the ceiling is how this comes back the first
  // time somebody adds a field.
  const next = Math.max(1, Math.floor(pageSize * ratio * 0.8))
  return next < pageSize ? next : null
}

/**
 * The types the sync asks capability questions about.
 *
 * WHY THE PROBE IS NARROW
 *
 * It used to introspect the whole schema — every type, every field, each
 * field's type unwrapped three levels deep. Linear's schema has hundreds of
 * types, and that query is the single most expensive thing a sync does. It is
 * also the FIRST thing a sync does, so when Linear refuses it on complexity
 * the run dies before writing anything, and the adaptive page-shrink cannot
 * help because a schema probe has no page size to shrink.
 *
 * Four types are all that is ever asked about, so four types are all it asks
 * for. A name this list gets wrong comes back null and that type simply has
 * no capabilities — the same outcome as a type the schema does not have,
 * which is the behaviour the callers already handle.
 */
export const PROBE_TYPES = ['Team', 'User', 'Initiative', 'Project'] as const

/** One `__type` block per type, aliased so the response can be put back together. */
export function probeQuery(types: readonly string[] = PROBE_TYPES): string {
  const blocks = types
    .map(
      (t, i) => `    t${i}: __type(name: "${t}") {
      name
      kind
      fields(includeDeprecated: false) {
        name
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
      }
    }`,
    )
    .join('\n')

  return `query Caps {
    __schema { queryType { name fields(includeDeprecated: false) { name } } }
${blocks}
  }`
}

export interface ProbeResult {
  __schema: { queryType: { name: string; fields: Array<{ name: string }> | null } }
  [alias: string]: unknown
}

/**
 * Put the narrow probe back into the shape `capabilitiesFrom` reads.
 *
 * Kept as a translation rather than a second reader so there is still one
 * function deciding what a capability is — the rule that field names alone
 * were not enough is written down once, and tested once.
 */
export function probeToIntrospection(
  data: ProbeResult,
  types: readonly string[] = PROBE_TYPES,
): IntrospectionResult {
  const rootName = data.__schema?.queryType?.name ?? 'Query'
  const out: IntrospectionResult['__schema']['types'] = [
    {
      name: rootName,
      kind: 'OBJECT',
      fields: (data.__schema?.queryType?.fields ?? []).map((f) => ({ name: f.name })),
    },
  ]

  for (let i = 0; i < types.length; i++) {
    const t = data[`t${i}`] as IntrospectionResult['__schema']['types'][number] | null | undefined
    // A type the schema does not have comes back null. Left out entirely, so
    // `has` answers false for it rather than throwing.
    if (t?.name) out.push({ name: t.name, kind: t.kind ?? 'OBJECT', fields: t.fields ?? null })
  }

  return { __schema: { queryType: { name: rootName }, types: out } }
}

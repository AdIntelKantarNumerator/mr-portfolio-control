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
 *   Field "status" of type "ProjectStatus!" must have a selection of subfields
 *
 * Linear had changed Project.status from an enum to an object. The old probe
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

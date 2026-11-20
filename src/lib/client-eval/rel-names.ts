/**
 * The names behind Magnifier REL codes, read from Databricks at refresh time.
 *
 * US RELs use VX2 codes, in mrdpp_prod.vx2_taxonomy: d_advertiser.CODE,
 * d_category.CODE, d_subcategory.CODE, d_product.PRCODE, d_industry.CODE (the
 * same 85 industry groups as Omnis FIGROUP). Canadian RELs use VX2 Canada's
 * numeric ids, in mrdpp_prod.vx2_taxonomy_ca: advertiser, category,
 * subcategory, product, and corporation for parent advertisers (checked 20
 * November 2026: parent 126797 is TD Bank Financial Group). So a code is looked
 * up by its shape: digits in Canada's tables, letters in the US ones.
 *
 * Read-only, as every Databricks read here is (lib/databricks.ts).
 */
import { databricksConfig, dbxQuery, type DatabricksConfig } from '@/lib/databricks'
import type { NameKind } from './rel'

const US = 'mrdpp_prod.vx2_taxonomy'
const CA = 'mrdpp_prod.vx2_taxonomy_ca'

/** Per kind: the US table (code -> name) and the Canadian one (id -> name). */
const TABLES: Record<NameKind, { us?: [string, string, string]; ca?: [string, string, string] }> = {
  advertiser: { us: [`${US}.d_advertiser`, 'CODE', 'NAME'], ca: [`${CA}.advertiser`, 'ADVERTISERID', 'ADVERTISERNAME'] },
  parent: { us: [`${US}.d_advertiser`, 'CODE', 'NAME'], ca: [`${CA}.corporation`, 'CORPORATIONID', 'CORPORATIONNAME'] },
  category: { us: [`${US}.d_category`, 'CODE', 'NAME'], ca: [`${CA}.category`, 'CATEGORYID', 'CATEGORYNAME'] },
  subcategory: { us: [`${US}.d_subcategory`, 'CODE', 'NAME'], ca: [`${CA}.subcategory`, 'SUBCATEGORYID', 'SUBCATEGORYNAME'] },
  product: { us: [`${US}.d_product`, 'PRCODE', 'PRNAME'], ca: [`${CA}.product`, 'PRODUCTID', 'PRODUCTNAME'] },
  industry: { us: [`${US}.d_industry`, 'CODE', 'NAME'] },
}

const CHUNK = 200

export type NameLookup = (kind: NameKind, code: string) => string | undefined

/** Every code's name, or an empty lookup when Databricks is not configured here (the codes are shown as they are). */
export async function relNames(want: Map<NameKind, Set<string>>, onStep?: (done: number, total: number) => void | Promise<void>): Promise<{ lookup: NameLookup; error: string | null }> {
  const config = databricksConfig()
  const names = new Map<string, string>()
  const lookup: NameLookup = (kind, code) => names.get(`${kind}:${code}`)
  if (!config) return { lookup, error: 'Databricks is not configured here, so REL codes are shown as codes.' }
  const jobs: Array<{ kind: NameKind; table: [string, string, string]; codes: string[]; numeric: boolean }> = []
  for (const [kind, codes] of want) {
    const t = TABLES[kind]
    const nums = [...codes].filter((c) => /^\d+$/.test(c))
    const words = [...codes].filter((c) => !/^\d+$/.test(c) && /^[A-Za-z0-9&_-]+$/.test(c))
    for (let i = 0; i < words.length; i += CHUNK) if (t.us) jobs.push({ kind, table: t.us, codes: words.slice(i, i + CHUNK), numeric: false })
    for (let i = 0; i < nums.length; i += CHUNK) if (t.ca) jobs.push({ kind, table: t.ca, codes: nums.slice(i, i + CHUNK), numeric: true })
  }
  try {
    for (let i = 0; i < jobs.length; i++) {
      await read(config, jobs[i]!, names)
      await onStep?.(i + 1, jobs.length)
    }
    return { lookup, error: null }
  } catch (err) {
    return { lookup, error: `Some REL names could not be read from Databricks: ${(err as Error).message}` }
  }
}

async function read(config: DatabricksConfig, job: { kind: NameKind; table: [string, string, string]; codes: string[]; numeric: boolean }, names: Map<string, string>) {
  const [table, key, name] = job.table
  const params = job.codes.map((c, i) => ({ name: `c${i}`, value: c }))
  const keyExpr = job.numeric ? `CAST(${key} AS STRING)` : key
  const rows = await dbxQuery(config, `SELECT ${keyExpr} AS k, MAX(${name}) AS n FROM ${table} WHERE ${keyExpr} IN (${params.map((p) => `:${p.name}`).join(', ')}) GROUP BY ${keyExpr}`, params, { timeoutMs: 5 * 60_000 })
  for (const r of rows) if (r.k && r.n) names.set(`${job.kind}:${r.k}`, tidy(r.n))
}

/** Canada's names are in capitals ("TD BANK FINANCIAL GROUP"); title-case them so the two countries read alike. */
export function tidy(n: string): string {
  const s = n.trim()
  if (s !== s.toUpperCase() || !/[A-Z]{3}/.test(s)) return s
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Tv|Td|Bmo|Cibc|Rbc|Usa|Us|Pc|Suv|Atm)\b/g, (m) => m.toUpperCase())
}

/**
 * Reading Databricks, and only reading it — for Taxonomy Comparison.
 *
 * Plain `fetch` against the SQL Statement Execution API, no driver: the app
 * sends a handful of fixed SELECTs. A statement is submitted without waiting
 * and then polled, which is what lets the screen show "still running, 40s" on
 * a slow warehouse instead of a request that times out.
 *
 * CONFIGURATION
 *
 *   DATABRICKS_HOST       https://adb-….azuredatabricks.net (scheme optional)
 *   DATABRICKS_HTTP_PATH  /sql/1.0/warehouses/<id> — or DATABRICKS_WAREHOUSE_ID
 *   DATABRICKS_TOKEN      a Key Vault reference in Azure
 *
 * The token is Scott's personal access token (his decision, 29 October 2026),
 * which has his full rights. So every statement is checked here to be a single
 * SELECT before it is sent; values always travel as named parameters
 * (`:name`), never spliced into the SQL.
 */

export interface DatabricksConfig {
  host: string
  warehouseId: string
  token: string
}

export class DatabricksError extends Error {}

export function databricksConfig(env: Record<string, string | undefined> = process.env): DatabricksConfig | null {
  const rawHost = env.DATABRICKS_HOST?.trim()
  const token = env.DATABRICKS_TOKEN?.trim()
  const warehouseId = env.DATABRICKS_WAREHOUSE_ID?.trim() || env.DATABRICKS_HTTP_PATH?.trim().split('/').filter(Boolean).pop()
  if (!rawHost || !token || !warehouseId) return null
  const host = (/^https?:\/\//.test(rawHost) ? new URL(rawHost).origin : `https://${rawHost.split('/')[0]}`).replace(/\/+$/, '')
  return { host, warehouseId, token }
}

/** One statement, beginning SELECT or WITH, with no second statement after a semicolon. */
export function assertSelect(sql: string): void {
  const s = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/;\s*$/, '')
  if (!/^(select|with)\b/i.test(s)) throw new DatabricksError('Only SELECT statements may be sent to Databricks.')
  if (s.includes(';')) throw new DatabricksError('One statement at a time.')
  if (/\b(insert|update|delete|merge|drop|create|alter|truncate|grant|revoke|copy|optimize|vacuum)\b\s/i.test(s.replace(/'[^']*'/g, "''"))) {
    throw new DatabricksError('That statement is not read-only.')
  }
}

type Param = { name: string; value: string; type?: 'STRING' | 'INT' | 'BIGINT' | 'DATE' }

interface StatementResponse {
  statement_id: string
  status: { state: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'CLOSED'; error?: { message?: string } }
  manifest?: { schema?: { columns?: { name: string }[] }; total_chunk_count?: number }
  result?: { data_array?: (string | null)[][]; next_chunk_internal_link?: string }
}

/**
 * Run one SELECT and return its rows as objects of strings (Databricks sends
 * every value as a string in JSON_ARRAY form; callers convert).
 *
 * `onWait` is called every few seconds while the warehouse works, with the
 * seconds elapsed, so progress can be shown.
 */
export async function dbxQuery(
  config: DatabricksConfig,
  sql: string,
  params: Param[] = [],
  options: { onWait?: (seconds: number) => void | Promise<void>; timeoutMs?: number } = {},
): Promise<Record<string, string | null>[]> {
  assertSelect(sql)
  const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }
  const started = Date.now()
  const deadline = started + (options.timeoutMs ?? 15 * 60_000)

  const call = async (path: string, init?: RequestInit): Promise<StatementResponse> => {
    let res: Response
    try {
      res = await fetch(`${config.host}${path}`, { ...init, headers, cache: 'no-store' })
    } catch (err) {
      const cause = (err as { cause?: unknown }).cause
      throw new DatabricksError(`Databricks could not be reached: ${cause instanceof Error ? cause.message : (err as Error).message}`)
    }
    const body = await res.text()
    if (!res.ok) throw new DatabricksError(`Databricks answered ${res.status}: ${body.slice(0, 300)}`)
    return JSON.parse(body) as StatementResponse
  }

  let r = await call('/api/2.0/sql/statements', {
    method: 'POST',
    body: JSON.stringify({
      warehouse_id: config.warehouseId,
      statement: sql,
      parameters: params.map((p) => ({ name: p.name, value: p.value, type: p.type ?? 'STRING' })),
      wait_timeout: '10s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    }),
  })

  while (r.status.state === 'PENDING' || r.status.state === 'RUNNING') {
    if (Date.now() > deadline) {
      await call(`/api/2.0/sql/statements/${r.statement_id}/cancel`, { method: 'POST' }).catch(() => undefined)
      throw new DatabricksError('The Databricks query took too long and was cancelled.')
    }
    await options.onWait?.(Math.round((Date.now() - started) / 1000))
    await new Promise((resolve) => setTimeout(resolve, 2500))
    r = await call(`/api/2.0/sql/statements/${r.statement_id}`)
  }
  if (r.status.state !== 'SUCCEEDED') {
    throw new DatabricksError(`The Databricks query ${r.status.state.toLowerCase()}: ${r.status.error?.message?.slice(0, 400) ?? 'no detail'}`)
  }

  const cols = (r.manifest?.schema?.columns ?? []).map((c) => c.name)
  const rows: (string | null)[][] = [...(r.result?.data_array ?? [])]
  let next = r.result?.next_chunk_internal_link
  while (next) {
    const chunk = (await call(next)) as unknown as { data_array?: (string | null)[][]; next_chunk_internal_link?: string }
    rows.push(...(chunk.data_array ?? []))
    next = chunk.next_chunk_internal_link
  }
  return rows.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i] ?? null])))
}

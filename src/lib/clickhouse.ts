/**
 * Reading ClickHouse, and only reading it.
 *
 * The portfolio talks to ClickHouse over its HTTP interface with plain
 * `fetch` — no client library, because the app sends a handful of fixed
 * queries against system tables and a dependency would be most of the code.
 * Every statement goes through `assertReadOnly` and every request carries
 * `readonly=2`; see lib/clickhouse-guard.ts for why both, and why the account
 * itself is not trusted to be read-only.
 *
 * CONFIGURATION
 *
 * One set of variables per environment, so Prod can be added without
 * touching Dev:
 *
 *   CLICKHOUSE_DEV_URL       http://20.10.60.14:8123   (scheme, host, port)
 *   CLICKHOUSE_DEV_USER
 *   CLICKHOUSE_DEV_PASSWORD  a Key Vault reference in Azure; see deploy/AZURE.md
 *   CLICKHOUSE_PROD_URL / _USER / _PASSWORD
 *
 * An environment with no URL is "not connected", which the screen says in so
 * many words. That is the normal state of Prod today and must not read as an
 * error.
 *
 * Values travel as ClickHouse query parameters ({db:String}), never spliced
 * into the SQL, so a table name typed into a URL cannot become part of a
 * statement.
 */
import { assertReadOnly, READ_ONLY_PARAMS } from './clickhouse-guard'
import type { Environment } from './dictionary-rules'

export interface ClickHouseConfig {
  env: Environment
  url: string
  user: string
  password: string
}

export function clickhouseConfig(
  env: Environment,
  source: Record<string, string | undefined> = process.env,
): ClickHouseConfig | null {
  const prefix = env === 'prod' ? 'CLICKHOUSE_PROD' : 'CLICKHOUSE_DEV'
  const url = source[`${prefix}_URL`]?.trim()
  if (!url) return null
  return {
    env,
    url: url.replace(/\/+$/, ''),
    user: source[`${prefix}_USER`]?.trim() || 'default',
    password: source[`${prefix}_PASSWORD`] ?? '',
  }
}

export class ClickHouseError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
  ) {
    super(message)
    this.name = 'ClickHouseError'
  }
}

/**
 * Run one read and return its rows.
 *
 * `params` become `param_<name>` on the URL and are referenced in the SQL as
 * `{name:Type}`. The response is JSON with the rows under `data`.
 */
export async function chQuery<T = Record<string, unknown>>(
  config: ClickHouseConfig,
  sql: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  assertReadOnly(sql)

  const qs = new URLSearchParams({ ...READ_ONLY_PARAMS, default_format: 'JSON' })
  for (const [k, v] of Object.entries(params)) qs.set(`param_${k}`, v)

  let res: Response
  try {
    res = await fetch(`${config.url}/?${qs.toString()}`, {
      method: 'POST',
      headers: {
        'X-ClickHouse-User': config.user,
        'X-ClickHouse-Key': config.password,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: sql,
      // A system-table read answers in milliseconds. Twenty seconds is the
      // server-side cap too; past it the page should say "could not reach"
      // rather than hang.
      signal: AbortSignal.timeout(22_000),
      cache: 'no-store',
    })
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause
    const detail = cause?.code ?? cause?.message ?? (err as Error).message
    throw new ClickHouseError(`Could not reach ClickHouse ${config.env} at ${new URL(config.url).host} (${detail}).`)
  }

  const body = await res.text()
  if (!res.ok) {
    // ClickHouse puts "Code: 516. DB::Exception: ..." in the body. The code
    // is kept for the caller; the message is trimmed of the version tail.
    const m = body.match(/Code:\s*(\d+)\.\s*(?:DB::Exception:\s*)?([^\n]*)/)
    const code = m ? Number(m[1]) : null
    const why = (m?.[2] ?? body).replace(/\s*\(version [^)]*\)\s*$/, '').slice(0, 300)
    if (code === 516) throw new ClickHouseError(`ClickHouse ${config.env} refused the credentials. Check the user and password.`, code)
    throw new ClickHouseError(`ClickHouse ${config.env} returned an error: ${why}`, code)
  }

  try {
    return (JSON.parse(body) as { data: T[] }).data
  } catch {
    throw new ClickHouseError(`ClickHouse ${config.env} returned something that is not JSON.`)
  }
}

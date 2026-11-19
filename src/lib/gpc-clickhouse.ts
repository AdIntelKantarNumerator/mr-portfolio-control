/**
 * Where the GPC serving model lives in ClickHouse, for Report Builder and the
 * Magnifier Offline Reports prototype (Scott, 19 November 2026).
 *
 * Both read Prod ClickHouse. Dev dropped its gpc_* serving databases (only
 * gpc_entitlement is left there), and since 19 November the web app reaches
 * Prod over the KMI dev VNet. Prod names the databases without Dev's gpc_
 * prefix and calls the monthly tables _monthly, not _month; the columns the
 * prototypes read are the same (checked table by table that day).
 *
 * Every read still goes through lib/clickhouse.ts: SELECT only, readonly=2.
 */
import { clickhouseConfig, ClickHouseError, type ClickHouseConfig } from './clickhouse'

/** The ClickHouse environment that holds the GPC serving model. */
export const GPC_ENV = 'prod' as const

export const GPC_SUMMARY_DB = 'summary'

export const GPC_TABLES = {
  /** Spend by month x property x paying entity x product, every id with its name. */
  propertyMonthly: `${GPC_SUMMARY_DB}.property_product_summary_monthly`,
  /** Creative x product x media, by month and by day: the smaller creative summaries. */
  creativeMediaMonthly: 'creative.creative_product_media_summary_monthly',
  creativeMediaDaily: 'creative.creative_product_media_summary_daily',
  /** The fuller creative summaries, which also record market and master property. */
  creativeMonthly: 'creative.creative_product_summary_monthly',
  creativeDaily: 'creative.creative_product_summary_daily',
  /** One row per creative: title, lead text, first audio, summaries. */
  creative: 'creative.creative',
  /** One row per airing. */
  tvAirings: 'detail.tv_product_detail',
  liveStreamAirings: 'detail.live_stream_product_detail',
  /** The GPC taxonomy tree. */
  taxonomyNode: 'reference.taxonomy_node',
} as const

/** A per-media daily summary table, such as summary.tv_product_summary_daily. */
export const gpcDailyTable = (media: string) => `${GPC_SUMMARY_DB}.${media}_product_summary_daily`

/** The ClickHouse connection for the GPC serving model, or null when it is not configured here. */
export const gpcClickhouseConfig = (env: Record<string, string | undefined> = process.env) => clickhouseConfig(GPC_ENV, env)

/** The same, failing with a plain message when it is not configured. */
export function requireGpcClickhouse(): ClickHouseConfig {
  const c = gpcClickhouseConfig()
  if (!c) throw new ClickHouseError('Prod ClickHouse is not configured (CLICKHOUSE_PROD_URL).')
  return c
}

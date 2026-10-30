/**
 * Load the MediaRadar Classic snapshot for Taxonomy Comparison.
 *
 *   npm run load:classic                               # into DATABASE_URL (or local PGlite)
 *
 * Reads the production SQL Server named in ../.sqlserver.env (SQLSERVER_SERVER,
 * _DATABASE, _USERNAME, _PASSWORD) and replaces classic_spend and classic_names
 * whole. Run it from a machine the SQL Server lets in: the deployed app is not
 * on its network group's list, which is why Classic is a snapshot at all.
 *
 * WHAT "ADVERTISER" MEANS IN CLASSIC
 *
 * The top of the company tree (companies.subsidiaryOf = 1). It is the same id
 * in all three sources: TV's ParentCompanyId, Print's ParentBrandId and the
 * digital tables' CompanyPrimogenitor.
 *
 * MEDIA TYPES
 *
 *   Linear TV  DW.TvAdMetricsMonthly.EstTvSpend (national and local).
 *   Print      DW.PrintAdMetricsWeeklyDetailed.PrintSpendReported, by the
 *              month of WeekOf (a week is not split across months).
 *   Digital    AllMedia.Companies_Sites_Instances_Spend: display, mobile, video,
 *              native, podcast, OTT on desktop and mobile, email, whitepaper and
 *              webinar.
 *   Social     AllFormatSpendReported less the Digital columns above — the
 *              Facebook, Instagram, X and TikTok spend. Checked against
 *              DW.SocialSpendMonthly on 29 October 2026: within 1.5%.
 *   CTV        Classic does not track it.
 *
 * Read-only on the SQL Server: SELECTs only, with read-only intent.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sql from 'mssql'
import { connect, warnIfServerRunning } from './_connect'

const MONTHS = ['2026-08-01', '2026-09-01']
const END = '2026-10-01'

function readEnvFile(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
  )
}

const DIGITAL = `ISNULL(DisplaySpendReported,0)+ISNULL(MobileSpendReported,0)+ISNULL(VideoSpendReported,0)+ISNULL(NativeSpendReported,0)
  +ISNULL(PodcastSpendReported,0)+ISNULL(OttDesktopSpendReported,0)+ISNULL(OttMobileSpendReported,0)
  +ISNULL(EmailSpendReported,0)+ISNULL(WhitepaperSpendReported,0)+ISNULL(WebinarSpendReported,0)`

const SPEND_SQL = `
SELECT ParentCompanyId id, 'Linear TV' media, CONVERT(char(7), Month, 126) month, SUM(CAST(EstTvSpend AS float)) spend
  FROM DW.TvAdMetricsMonthly WHERE Month >= @start AND Month < @end GROUP BY ParentCompanyId, CONVERT(char(7), Month, 126)
UNION ALL
SELECT ParentBrandId, 'Print', CONVERT(char(7), WeekOf, 126), SUM(CAST(PrintSpendReported AS float))
  FROM DW.PrintAdMetricsWeeklyDetailed WHERE WeekOf >= @start AND WeekOf < @end GROUP BY ParentBrandId, CONVERT(char(7), WeekOf, 126)
UNION ALL
SELECT CompanyPrimogenitor, 'Digital', CONVERT(char(7), RptDate, 126), SUM(CAST(${DIGITAL} AS float))
  FROM AllMedia.Companies_Sites_Instances_Spend WHERE RptDate >= @start AND RptDate < @end GROUP BY CompanyPrimogenitor, CONVERT(char(7), RptDate, 126)
UNION ALL
SELECT CompanyPrimogenitor, 'Social', CONVERT(char(7), RptDate, 126),
  SUM(CAST(CASE WHEN ISNULL(AllFormatSpendReported,0) > ${DIGITAL} THEN ISNULL(AllFormatSpendReported,0) - (${DIGITAL}) ELSE 0 END AS float))
  FROM AllMedia.Companies_Sites_Instances_Spend WHERE RptDate >= @start AND RptDate < @end GROUP BY CompanyPrimogenitor, CONVERT(char(7), RptDate, 126)`

const NAMES_SQL = `
SELECT DISTINCT ParentCompanyId id, ParentCompanyName name, 'advertiser' level FROM DW.TvAdMetricsMonthly WHERE Month >= @start AND Month < @end
UNION SELECT DISTINCT ParentCompanyId, BrandName, 'brand' FROM DW.TvAdMetricsMonthly WHERE Month >= @start AND Month < @end
UNION SELECT DISTINCT ParentBrandId, ParentBrandName, 'advertiser' FROM DW.PrintAdMetricsWeeklyDetailed WHERE WeekOf >= @start AND WeekOf < @end
UNION SELECT DISTINCT ParentBrandId, BrandName, 'brand' FROM DW.PrintAdMetricsWeeklyDetailed WHERE WeekOf >= @start AND WeekOf < @end
UNION SELECT DISTINCT CompanyPrimogenitor, CompanyPrimogenitorName, 'advertiser' FROM AllMedia.Companies_Sites_Instances_Spend WHERE RptDate >= @start AND RptDate < @end
UNION SELECT DISTINCT CompanyPrimogenitor, CompanyName, 'company' FROM AllMedia.Companies_Sites_Instances_Spend WHERE RptDate >= @start AND RptDate < @end`

// Each advertiser's brands and companies — and the advertiser itself — to the
// VX0 products Vivvix.Product maps them to. Checked 29 October 2026: brands
// carrying 93% of Classic TV spend and 80% of digital are mapped.
const PRODUCTS_SQL = `
WITH b AS (
  SELECT DISTINCT ParentCompanyId top_id, BrandId brand_id FROM DW.TvAdMetricsMonthly WHERE Month >= @start AND Month < @end
  UNION SELECT DISTINCT CompanyPrimogenitor, CompanyId FROM AllMedia.Companies_Sites_Instances_Spend WHERE RptDate >= @start AND RptDate < @end
  UNION SELECT DISTINCT ParentCompanyId, ParentCompanyId FROM DW.TvAdMetricsMonthly WHERE Month >= @start AND Month < @end
  UNION SELECT DISTINCT CompanyPrimogenitor, CompanyPrimogenitor FROM AllMedia.Companies_Sites_Instances_Spend WHERE RptDate >= @start AND RptDate < @end)
SELECT DISTINCT b.top_id id, p.VxProductId product_id FROM b JOIN Vivvix.Product p ON p.MrBrandId = b.brand_id
WHERE b.top_id IS NOT NULL AND p.VxProductId IS NOT NULL`

async function main() {
  const env = readEnvFile(process.env.SQLSERVER_ENV_FILE ?? join(process.cwd(), '..', '.sqlserver.env'))
  const [server, port] = env.SQLSERVER_SERVER.replace(/^tcp:/, '').split(',')
  const pool = await sql.connect({
    server,
    port: port ? Number(port) : 1433,
    database: env.SQLSERVER_DATABASE,
    user: env.SQLSERVER_USERNAME,
    password: env.SQLSERVER_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true, readOnlyIntent: true },
    requestTimeout: 900_000,
    connectionTimeout: 30_000,
  })

  const read = async <T>(text: string) =>
    (await pool.request().input('start', sql.Date, MONTHS[0]).input('end', sql.Date, END).query<T>(text)).recordset

  console.log('Reading Classic spend…')
  const spendRows = (await read<{ id: number; media: string; month: string; spend: number }>(SPEND_SQL)).filter(
    (r) => r.id != null && r.spend > 0,
  )
  console.log('Reading Classic names…')
  const nameRows = (await read<{ id: number; name: string; level: string }>(NAMES_SQL)).filter((r) => r.id != null && r.name?.trim())
  console.log('Reading Classic brand → VX product links…')
  const productRows = await read<{ id: number; product_id: number }>(PRODUCTS_SQL)
  await pool.close()

  // The advertiser's own name: the advertiser-level row, else any.
  const advertiserName = new Map<number, string>()
  for (const r of nameRows) if (r.level === 'advertiser' && !advertiserName.has(r.id)) advertiserName.set(r.id, r.name.trim())

  // Several media and months per advertiser; the same name at two levels keeps the highest.
  const rank = { advertiser: 0, company: 1, brand: 2 } as Record<string, number>
  const names = new Map<string, { name: string; advertiserId: number; level: string }>()
  for (const r of nameRows) {
    const name = r.name.trim()
    const key = `${name}\u0000${r.id}`
    const prior = names.get(key)
    if (!prior || rank[r.level] < rank[prior.level]) names.set(key, { name, advertiserId: r.id, level: r.level })
  }

  const spend = spendRows.map((r) => ({
    advertiserId: r.id,
    advertiserName: advertiserName.get(r.id) ?? `Classic company ${r.id}`,
    mediaType: r.media,
    month: r.month,
    spend: r.spend,
  }))

  const { db, close, embedded } = await connect()
  const s = await import('../src/db/schema')
  try {
    await db.transaction(async (tx) => {
      await tx.delete(s.classicSpend)
      await tx.delete(s.classicNames)
      const now = new Date()
      for (let i = 0; i < spend.length; i += 2000) {
        await tx.insert(s.classicSpend).values(spend.slice(i, i + 2000).map((r) => ({ ...r, loadedAt: now })))
      }
      const all = [...names.values()]
      for (let i = 0; i < all.length; i += 4000) await tx.insert(s.classicNames).values(all.slice(i, i + 4000))
      await tx.delete(s.classicBrandProducts)
      const links = productRows.map((r) => ({ advertiserId: r.id, vxProductId: r.product_id }))
      for (let i = 0; i < links.length; i += 8000) await tx.insert(s.classicBrandProducts).values(links.slice(i, i + 8000))
    })
    const totals = new Map<string, number>()
    for (const r of spend) totals.set(`${r.month} ${r.mediaType}`, (totals.get(`${r.month} ${r.mediaType}`) ?? 0) + r.spend)
    console.log(`Loaded ${spend.length} spend rows for ${advertiserName.size} advertisers, ${names.size} names, ${productRows.length} product links.`)
    for (const [k, v] of [...totals].sort()) console.log(`  ${k.padEnd(20)} $${Math.round(v).toLocaleString()}`)
    await warnIfServerRunning(embedded)
  } finally {
    await close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * Google Sheets ingestion.
 *
 * Deliberately uses the CSV export endpoint rather than the Sheets API, so a
 * program manager can wire up a tracker by sharing a link — no OAuth consent
 * screen, no service account, no Workspace admin ticket. The trade-off is that
 * the sheet must be shared ("anyone with the link can view", or published to
 * the web); for anything sensitive, set GOOGLE_SERVICE_ACCOUNT_JSON and the
 * authenticated path below is used instead.
 *
 * This is how non-Linear workstreams get onto the same timeline: the rows in
 * someone's spreadsheet become projects with the same shape as synced ones.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, projects, sourceRecords, syncRuns } from '@/db/schema'
import { logChange } from '../portfolio'
import { slugify } from '../util'
import { STATUS_ALIASES, csvUrlFor, parseCsv, rowsToObjects } from './csv'

export { csvUrlFor, parseCsv, rowsToObjects } from './csv'

export interface SheetMapping {
  /** Column header → field on the project. Unmapped columns are ignored. */
  name: string
  status?: string
  startDate?: string
  targetDate?: string
  lead?: string
  initiative?: string
  progress?: string
  notes?: string
  /** Column holding a stable per-row id. Falls back to the row's name. */
  key?: string
}

export interface SheetSource {
  id: string
  label: string
  url: string
  mapping: SheetMapping
}

async function fetchSheet(url: string): Promise<string> {
  const headers: Record<string, string> = {}
  const token = process.env.GOOGLE_ACCESS_TOKEN
  if (token) headers.authorization = `Bearer ${token}`

  const res = await fetch(csvUrlFor(url), { headers, redirect: 'follow', cache: 'no-store' })
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? `Sheet is not readable (${res.status}). Share it with "anyone with the link can view", or set GOOGLE_ACCESS_TOKEN.`
        : `Sheet fetch failed with ${res.status}`,
    )
  }
  const body = await res.text()
  if (body.trimStart().startsWith('<')) {
    throw new Error('Got an HTML sign-in page instead of CSV — the sheet is not shared.')
  }
  return body
}

function parseDate(v?: string): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Load a configured sheet and upsert its rows as projects. */
export async function syncSheet(source: SheetSource) {
  const counters = { created: 0, updated: 0, skipped: 0 }
  const [run] = await db
    .insert(syncRuns)
    .values({ system: 'sheets', trigger: 'manual', status: 'running' })
    .returning({ id: syncRuns.id })

  try {
    const objects = rowsToObjects(parseCsv(await fetchSheet(source.url)))
    const m = source.mapping

    for (const rowData of objects) {
      const name = rowData[m.name]?.trim()
      if (!name) {
        counters.skipped += 1
        continue
      }

      const rowKey = (m.key ? rowData[m.key] : '') || name
      const externalId = `${source.id}:${slugify(rowKey)}`

      const [link] = await db
        .select({ entityId: sourceRecords.entityId })
        .from(sourceRecords)
        .where(and(eq(sourceRecords.system, 'sheets'), eq(sourceRecords.externalId, externalId)))
        .limit(1)

      // Initiatives are matched by name rather than created, so a typo in a
      // spreadsheet cannot silently fork the portfolio's structure.
      let initiativeId: string | null = null
      if (m.initiative && rowData[m.initiative]) {
        const wanted = rowData[m.initiative].trim().toLowerCase()
        const all = await db.select().from(initiatives)
        initiativeId = all.find((i) => i.name.toLowerCase() === wanted)?.id ?? null
      }

      const rawProgress = m.progress ? Number(String(rowData[m.progress]).replace('%', '')) : NaN
      const values = {
        name,
        description: m.notes ? (rowData[m.notes] || null) : null,
        status: STATUS_ALIASES[(m.status ? rowData[m.status] : '').toLowerCase()] ?? 'backlog',
        startDate: parseDate(m.startDate ? rowData[m.startDate] : undefined),
        targetDate: parseDate(m.targetDate ? rowData[m.targetDate] : undefined),
        progress: Number.isFinite(rawProgress) ? Math.min(1, Math.max(0, rawProgress > 1 ? rawProgress / 100 : rawProgress)) : 0,
        ...(initiativeId ? { initiativeId } : {}),
      }

      let entityId: string
      if (link) {
        await db.update(projects).set(values).where(eq(projects.id, link.entityId))
        entityId = link.entityId
        counters.updated += 1
      } else {
        const [created] = await db
          .insert(projects)
          .values({ ...values, key: `sheet-${slugify(rowKey)}`.slice(0, 60) })
          .returning({ id: projects.id })
        entityId = created.id
        counters.created += 1
      }

      await db
        .insert(sourceRecords)
        .values({
          system: 'sheets',
          externalId,
          entityType: 'project',
          entityId,
          url: source.url,
          raw: JSON.stringify(rowData),
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [sourceRecords.system, sourceRecords.externalId],
          set: { entityId, raw: JSON.stringify(rowData), fetchedAt: new Date() },
        })
    }

    await db
      .update(syncRuns)
      .set({
        status: 'success',
        finishedAt: new Date(),
        stats: JSON.stringify({ [source.label]: counters }),
        cursor: new Date(),
      })
      .where(eq(syncRuns.id, run.id))

    await logChange({
      actor: 'sheets-sync',
      kind: 'sync',
      summary: `Sheet "${source.label}" — ${counters.created} created, ${counters.updated} updated`,
    })

    return { status: 'success' as const, counters }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .update(syncRuns)
      .set({ status: 'failed', finishedAt: new Date(), error: message })
      .where(eq(syncRuns.id, run.id))
    return { status: 'failed' as const, counters, error: message }
  }
}

/**
 * Sheet sources are configured as JSON in SHEETS_SOURCES rather than in code,
 * so adding a tracker is a config change rather than a deploy.
 */
export function configuredSheets(): SheetSource[] {
  const raw = process.env.SHEETS_SOURCES
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as SheetSource[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    console.error('[sheets] SHEETS_SOURCES is not valid JSON; ignoring it.')
    return []
  }
}

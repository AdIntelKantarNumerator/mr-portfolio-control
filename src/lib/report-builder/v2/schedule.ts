/**
 * Report Builder V2: scheduled reports (20 November 2026).
 *
 * A schedule is a saved report, a cadence, a format and who gets it. At each
 * run the saved report is read again by id, so a rolling period moves with
 * the data and an edit to the report applies to the next delivery (PRD:
 * "most recent run uses the recent rolling dates"). The file goes out as an
 * email attachment, so recipients need no login.
 *
 * Runs need no model. The server checks for due schedules once a minute
 * (instrumentation.ts startScheduleTicker); a claim on next_run_at keeps two
 * servers from sending the same run twice. A failed run is recorded on the
 * schedule (the list shows it) and, when email works, told to the owner.
 */
import { and, desc, eq, lte } from 'drizzle-orm'
import { db } from '@/db/client'
import { reportBuilderSchedules } from '@/db/schema'
import type { Spec } from '../engine'
import { engineFor, loadUser } from '../agent'
import { csvFile, FORMATS, xlsxFile, type FileMeta } from '../export/files'
import { describeReport } from '../page-view'
import { emptyChat } from '../tools'
import { mailBlockedReason, sendMail } from './mail'
import { nextRun, validZone, wall, whenText, zoned } from './cadence'
export { nextRun, whenText, zoned }

export type Cadence = 'once' | 'daily' | 'weekly' | 'monthly'
export type Row = typeof reportBuilderSchedules.$inferSelect

export interface ScheduleInput {
  reportId: string
  reportName: string
  cadence: Cadence
  /** The first run's date, YYYY-MM-DD, in timezone. */
  startDate: string
  /** HH:MM, in timezone. */
  timeOfDay: string
  timezone: string
  /** weekly: 0..6 (Sunday first). monthly with no dayOfMonth: the first such weekday of the month. */
  dayOfWeek: number | null
  /** monthly: 1..28, or -1 for the last day. */
  dayOfMonth: number | null
  period: { mode: string; unit?: string; count?: number } | null
  format: 'xlsx' | 'csv'
  recipients: string[]
}

// ---------------------------------------------------------------- the store

export function checkInput(raw: Record<string, unknown>): ScheduleInput {
  const str = (k: string, max = 200) => (typeof raw[k] === 'string' ? (raw[k] as string).trim().slice(0, max) : '')
  const num = (k: string) => (typeof raw[k] === 'number' && Number.isInteger(raw[k]) ? (raw[k] as number) : null)
  const cadence = str('cadence') as Cadence
  if (!['once', 'daily', 'weekly', 'monthly'].includes(cadence)) throw new Error('Choose how often it runs.')
  const startDate = str('startDate')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Choose the date of the first run.')
  const timeOfDay = str('timeOfDay')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) throw new Error('Choose a time, like 08:00.')
  const timezone = str('timezone', 60) || 'America/New_York'
  if (!validZone(timezone)) throw new Error('That time zone is not one I know.')
  const dayOfWeek = num('dayOfWeek')
  const dayOfMonth = num('dayOfMonth')
  if (dayOfWeek != null && (dayOfWeek < 0 || dayOfWeek > 6)) throw new Error('Choose a day of the week.')
  if (dayOfMonth != null && !(dayOfMonth === -1 || (dayOfMonth >= 1 && dayOfMonth <= 28))) throw new Error('Choose a day of the month from 1 to 28, or the last day.')
  const recipients = (Array.isArray(raw.recipients) ? raw.recipients : String(raw.recipients ?? '').split(/[,;\s]+/))
    .map((r) => String(r).trim().toLowerCase())
    .filter(Boolean)
  if (!recipients.length) throw new Error('Add at least one email address.')
  const bad = recipients.filter((r) => !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(r))
  if (bad.length) throw new Error(`Not an email address: ${bad.join(', ')}.`)
  if (recipients.length > 25) throw new Error('At most 25 recipients.')
  const p = raw.period as { mode?: unknown; unit?: unknown; count?: unknown } | null | undefined
  const period =
    p && typeof p === 'object' && (p.mode === 'rolling' || p.mode === 'ytd')
      ? p.mode === 'ytd'
        ? { mode: 'ytd' }
        : { mode: 'rolling', unit: ['month', 'quarter', 'year', 'week'].includes(String(p.unit)) ? String(p.unit) : 'month', count: Math.max(1, Math.min(36, Number(p.count) || 1)) }
      : null
  const reportId = str('reportId', 80)
  if (!reportId) throw new Error('Save the report before scheduling it.')
  return { reportId, reportName: str('reportName', 120) || 'Report', cadence, startDate, timeOfDay, timezone, dayOfWeek, dayOfMonth, period, format: raw.format === 'csv' ? 'csv' : 'xlsx', recipients: [...new Set(recipients)] }
}

function rowFrom(email: string, i: ScheduleInput) {
  const [y, m, d] = i.startDate.split('-').map(Number) as [number, number, number]
  const [hh, mm] = i.timeOfDay.split(':').map(Number) as [number, number]
  const startAt = zoned(y, m, d, hh, mm, i.timezone)
  const base = {
    email,
    reportId: i.reportId,
    reportName: i.reportName,
    cadence: i.cadence,
    startAt,
    timeOfDay: i.timeOfDay,
    timezone: i.timezone,
    dayOfWeek: i.cadence === 'weekly' || (i.cadence === 'monthly' && i.dayOfMonth == null) ? (i.dayOfWeek ?? 1) : null,
    dayOfMonth: i.cadence === 'monthly' ? i.dayOfMonth : null,
    period: i.period,
    format: i.format,
    recipients: i.recipients,
    runs: 0,
  }
  const next = nextRun(base, new Date())
  if (i.cadence === 'once' && startAt.getTime() < Date.now() - 60_000) throw new Error('That time has passed. Choose a time in the future.')
  return { ...base, nextRunAt: next }
}

export interface ScheduleView {
  id: string
  reportId: string
  reportName: string
  cadence: Cadence
  when: string
  timezone: string
  timeOfDay: string
  startDate: string
  dayOfWeek: number | null
  dayOfMonth: number | null
  period: ScheduleInput['period']
  periodText: string
  format: 'xlsx' | 'csv'
  recipients: string[]
  active: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  runs: number
}

const periodText = (p: ScheduleInput['period']) =>
  !p ? "The report's own period" : p.mode === 'ytd' ? 'Year to date, at each run' : `Last ${(p.count ?? 1) > 1 ? `${p.count} ` : ''}complete ${p.unit}${(p.count ?? 1) > 1 ? 's' : ''}, at each run`

export function view(r: Row): ScheduleView {
  const w = wall(r.startAt, r.timezone)
  return {
    id: r.id,
    reportId: r.reportId,
    reportName: r.reportName,
    cadence: r.cadence as Cadence,
    when: whenText(r),
    timezone: r.timezone,
    timeOfDay: r.timeOfDay,
    startDate: `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`,
    dayOfWeek: r.dayOfWeek,
    dayOfMonth: r.dayOfMonth,
    period: (r.period as ScheduleInput['period']) ?? null,
    periodText: periodText((r.period as ScheduleInput['period']) ?? null),
    format: r.format === 'csv' ? 'csv' : 'xlsx',
    recipients: r.recipients,
    active: r.active,
    nextRunAt: r.active && r.nextRunAt ? r.nextRunAt.toISOString() : null,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    lastStatus: r.lastStatus,
    lastError: r.lastError,
    runs: r.runs,
  }
}

export async function listSchedules(email: string): Promise<ScheduleView[]> {
  const rows = await db.select().from(reportBuilderSchedules).where(eq(reportBuilderSchedules.email, email)).orderBy(desc(reportBuilderSchedules.createdAt))
  return rows.map(view)
}

async function own(email: string, id: string): Promise<Row> {
  const [r] = await db.select().from(reportBuilderSchedules).where(and(eq(reportBuilderSchedules.id, id), eq(reportBuilderSchedules.email, email))).limit(1)
  if (!r) throw new Error('No such schedule.')
  return r
}

export async function createSchedule(email: string, input: ScheduleInput): Promise<ScheduleView> {
  const [r] = await db.insert(reportBuilderSchedules).values(rowFrom(email, input)).returning()
  return view(r!)
}

export async function updateSchedule(email: string, id: string, input: ScheduleInput): Promise<ScheduleView> {
  await own(email, id)
  const v = rowFrom(email, input)
  const [r] = await db.update(reportBuilderSchedules).set({ ...v, runs: undefined, active: true, updatedAt: new Date() }).where(eq(reportBuilderSchedules.id, id)).returning()
  return view(r!)
}

export async function setActive(email: string, id: string, active: boolean): Promise<ScheduleView> {
  const r = await own(email, id)
  const next = active ? nextRun(r, new Date()) : r.nextRunAt
  const [u] = await db.update(reportBuilderSchedules).set({ active, nextRunAt: next, updatedAt: new Date() }).where(eq(reportBuilderSchedules.id, id)).returning()
  return view(u!)
}

export async function deleteSchedule(email: string, id: string): Promise<void> {
  await own(email, id)
  await db.delete(reportBuilderSchedules).where(eq(reportBuilderSchedules.id, id))
}

// ---------------------------------------------------------------- running

export interface Delivery {
  filename: string
  content: Buffer
  contentType: string
  subject: string
  text: string
}

/** The file one run of a schedule sends, made now, on the owner's saved report and the data loaded now. */
export async function buildDelivery(r: Pick<Row, 'email' | 'reportId' | 'reportName' | 'period' | 'format'>, appUrl: string): Promise<Delivery> {
  const { engine } = await engineFor(await loadUser(r.email), r.email)
  let saved: Awaited<ReturnType<typeof engine.getSaved>>
  try {
    saved = await engine.getSaved(r.reportId)
  } catch {
    throw new Error(`The saved report "${r.reportName}" no longer exists.`)
  }
  const spec: Spec = { ...saved.spec, ...(r.period ? { time: r.period } : {}) }
  const v = await engine.validate(spec)
  if (!v.ok) throw new Error(`"${saved.name}" cannot run: ${v.errors[0]?.message ?? v.questions[0]?.prompt ?? 'it is not complete'}`)
  const result = await engine.run(v.spec)
  const panel = await describeReport(engine, { ...emptyChat(), report: v.spec })
  const meta: FileMeta = {
    title: saved.name,
    completed: new Date(),
    summary: panel.rows.concat([{ label: 'Period', value: `${result.period.label} (${result.period.how})` }, { label: 'Data', value: `Final data through ${result.data_through_label}` }]),
    owner: r.email,
    appUrl,
  }
  const format = r.format === 'csv' ? 'csv' : 'xlsx'
  const body = format === 'xlsx' ? await xlsxFile(result, meta) : csvFile(result, meta)
  const content = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body)
  const filename = `${saved.name.replace(/[^A-Za-z0-9 &'()-]+/g, '').trim().slice(0, 80) || 'Report'} (${result.period.label.replace('–', 'to')}).${FORMATS[format].ext}`
  return {
    filename,
    content,
    contentType: FORMATS[format].type,
    subject: `${saved.name}: ${result.period.label}`,
    text: [
      `${saved.name}`,
      '',
      `${result.summary}`,
      `Period: ${result.period.label} (${result.period.how})`,
      `Data: final through ${result.data_through_label}`,
      `Rows: ${result.row_count.toLocaleString('en-US')}`,
      ...(result.notes.length ? ['', ...Array.from(new Set(result.notes))] : []),
      '',
      `The ${format.toUpperCase()} file is attached. Scheduled by ${r.email} in MediaRadar Report Builder.`,
    ].join('\n'),
  }
}

/** Run one schedule now and record the outcome. Returns the schedule as it stands. */
export async function runOne(r: Row, appUrl: string, opts: { advance: boolean }): Promise<ScheduleView> {
  const now = new Date()
  try {
    const blocked = mailBlockedReason()
    if (blocked) throw new Error(blocked)
    const d = await buildDelivery(r, appUrl)
    await sendMail({ to: r.recipients, subject: d.subject, text: d.text, attachments: [{ filename: d.filename, content: d.content, contentType: d.contentType }] })
    const runs = r.runs + 1
    const [u] = await db
      .update(reportBuilderSchedules)
      .set({ lastRunAt: now, lastStatus: 'ok', lastError: null, runs, ...(opts.advance ? { nextRunAt: nextRun({ ...r, runs }, now) } : {}), updatedAt: now })
      .where(eq(reportBuilderSchedules.id, r.id))
      .returning()
    return view(u!)
  } catch (err) {
    const message = (err as Error).message.slice(0, 500)
    const runs = r.runs + 1
    const [u] = await db
      .update(reportBuilderSchedules)
      .set({ lastRunAt: now, lastStatus: 'failed', lastError: message, runs, ...(opts.advance ? { nextRunAt: nextRun({ ...r, runs }, now) } : {}), updatedAt: now })
      .where(eq(reportBuilderSchedules.id, r.id))
      .returning()
    // No silent failures: tell the owner, when mail itself works.
    if (!mailBlockedReason()) {
      await sendMail({
        to: [r.email],
        subject: `Scheduled report failed: ${r.reportName}`,
        text: `Your scheduled report "${r.reportName}" did not go out.\n\n${message}\n\nIt will try again at its next run. Open Report Builder V2 to change or pause the schedule.`,
      }).catch((e) => console.error('[report schedules] could not tell the owner', e))
    }
    return view(u!)
  }
}

export async function runNow(email: string, id: string, appUrl: string): Promise<ScheduleView> {
  return runOne(await own(email, id), appUrl, { advance: false })
}

/** Every due schedule, each claimed first so two servers never send the same run. */
export async function runDue(appUrl: string, now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(reportBuilderSchedules)
    .where(and(eq(reportBuilderSchedules.active, true), lte(reportBuilderSchedules.nextRunAt, now)))
    .limit(20)
  let n = 0
  for (const r of due) {
    if (!r.nextRunAt) continue
    // The claim: move next_run_at on, only if nobody else has.
    const claimed = await db
      .update(reportBuilderSchedules)
      .set({ nextRunAt: nextRun(r, now), lastStatus: 'running', updatedAt: now })
      .where(and(eq(reportBuilderSchedules.id, r.id), eq(reportBuilderSchedules.nextRunAt, r.nextRunAt)))
      .returning()
    if (!claimed.length) continue
    await runOne({ ...claimed[0]!, runs: r.runs }, appUrl, { advance: false })
    n++
  }
  return n
}

declare global {
  var __rbScheduleTicker: ReturnType<typeof setInterval> | undefined
}

/** Checks for due schedules once a minute, for the life of the server. Off with REPORT_SCHEDULES=off. */
export function startScheduleTicker() {
  if (globalThis.__rbScheduleTicker || process.env.REPORT_SCHEDULES?.trim().toLowerCase() === 'off') return
  const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, '') || `http://localhost:${process.env.PORT ?? 3000}`
  let busy = false
  globalThis.__rbScheduleTicker = setInterval(() => {
    if (busy) return
    busy = true
    runDue(appUrl)
      .then((n) => n && console.log(`[report schedules] ran ${n}`))
      .catch((err) => console.error('[report schedules] check failed', err))
      .finally(() => (busy = false))
  }, 60_000)
  globalThis.__rbScheduleTicker.unref?.()
}

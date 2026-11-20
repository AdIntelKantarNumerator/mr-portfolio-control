/**
 * When a scheduled report runs (20 November 2026): pure date arithmetic on
 * the schedule's own time zone, kept apart from the store so it is tested
 * without a database.
 */
type Cadenced = { cadence: string; startAt: Date; timeOfDay: string; timezone: string; dayOfWeek: number | null; dayOfMonth: number | null; runs: number }

// ---------------------------------------------------------------- time, in the schedule's own zone

/** The parts of an instant on a zone's wall clock. */
export function wall(t: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, x.value]))
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!) }
}

/** The instant a zone's wall clock reads y-m-d h:min. */
export function zoned(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min)
  let t = guess
  for (let i = 0; i < 2; i++) {
    const w = wall(new Date(t), tz)
    const shown = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min)
    t += guess - shown
  }
  return new Date(t)
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
export const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Whether a calendar day is one this schedule runs on. */
function runsOn(s: Pick<Cadenced, 'cadence' | 'dayOfWeek' | 'dayOfMonth'>, y: number, m: number, d: number): boolean {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (s.cadence === 'daily' || s.cadence === 'once') return true
  if (s.cadence === 'weekly') return dow === (s.dayOfWeek ?? 1)
  if (s.dayOfMonth != null) return s.dayOfMonth === -1 ? d === daysIn(y, m) : d === Math.min(s.dayOfMonth, daysIn(y, m))
  // "The first Monday": the first such weekday of the month.
  return dow === (s.dayOfWeek ?? 1) && d <= 7
}

/** The next run strictly after `after`, on or after the start. Null when a one-off has run. */
export function nextRun(s: Cadenced, after: Date): Date | null {
  const [hh, mm] = s.timeOfDay.split(':').map(Number) as [number, number]
  if (s.cadence === 'once') return s.runs > 0 ? null : s.startAt
  const from = new Date(Math.max(after.getTime(), s.startAt.getTime() - 1))
  const w = wall(from, s.timezone)
  // Walk forward day by day on the zone's calendar; 400 days covers any monthly rule.
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(w.y, w.m - 1, w.d + i))
    const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()]
    if (!runsOn(s, y, m, d)) continue
    const t = zoned(y, m, d, hh, mm, s.timezone)
    if (t > from) return t
  }
  return null
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
export function whenText(r: Omit<Cadenced, 'runs'>): string {
  const at = `at ${r.timeOfDay}`
  if (r.cadence === 'once') {
    const w = wall(r.startAt, r.timezone)
    return `Once, ${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')} ${at}`
  }
  if (r.cadence === 'daily') return `Every day ${at}`
  if (r.cadence === 'weekly') return `Every ${DAYS[r.dayOfWeek ?? 1]} ${at}`
  if (r.dayOfMonth === -1) return `Last day of each month ${at}`
  if (r.dayOfMonth != null) return `Monthly on the ${ord(r.dayOfMonth)} ${at}`
  return `First ${DAYS[r.dayOfWeek ?? 1]} of each month ${at}`
}


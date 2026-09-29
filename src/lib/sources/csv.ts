/**
 * CSV parsing and Google Sheets URL handling.
 *
 * Kept free of database and network imports so it can be tested directly —
 * and so the parser can be reused by any future file-based source.
 */

/**
 * Minimal RFC 4180 CSV parser.
 *
 * Splitting on commas breaks the moment a project name contains one, which in
 * a real tracker is immediately. Quoted fields, escaped quotes and CRLF are
 * handled; anything more exotic belongs in a real parser, but this covers
 * every export Sheets and Excel produce.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  // Blank rows are noise in every real export — trailing newlines, spacer rows.
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => (obj[h] = (r[i] ?? '').trim()))
    return obj
  })
}

/** Turn any Google Sheets URL into its CSV export URL. */
export function csvUrlFor(url: string): string {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!idMatch) return url // already a direct CSV link
  const sheetId = idMatch[1]
  const gidMatch = url.match(/[#&?]gid=(\d+)/)
  const gid = gidMatch ? gidMatch[1] : '0'
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
}

/** Column values people actually type, mapped onto the project vocabulary. */
export const STATUS_ALIASES: Record<string, string> = {
  'not started': 'backlog',
  backlog: 'backlog',
  planned: 'planned',
  'in progress': 'in_progress',
  'in-progress': 'in_progress',
  active: 'in_progress',
  started: 'in_progress',
  paused: 'paused',
  'on hold': 'paused',
  blocked: 'paused',
  done: 'completed',
  complete: 'completed',
  completed: 'completed',
  cancelled: 'canceled',
  canceled: 'canceled',
}

/** A CSV field: quoted when it has a comma, quote or line break; a leading = + - @ is defused so a spreadsheet won't run it as a formula. */
export function csvField(v: string | null | undefined): string {
  let s = (v ?? '').trim()
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

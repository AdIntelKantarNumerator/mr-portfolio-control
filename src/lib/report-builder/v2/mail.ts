/**
 * Email for scheduled reports: SMTP, configured the same way as Yaara's
 * (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM), so the same
 * relay account can serve both. Without it, schedules still save and the list
 * says why nothing went out.
 */
import nodemailer from 'nodemailer'

function config(env: NodeJS.ProcessEnv = process.env) {
  const host = env.SMTP_HOST?.trim()
  const user = env.SMTP_USER?.trim()
  const pass = env.SMTP_PASSWORD?.trim()
  const from = env.SMTP_FROM?.trim() || user
  if (!host || !user || !pass || !from) return null
  return { host, port: Number(env.SMTP_PORT ?? 587), user, pass, from }
}

export function mailBlockedReason(env: NodeJS.ProcessEnv = process.env): string | null {
  return config(env) ? null : 'Email is not set up on this server yet (SMTP_HOST, SMTP_USER, SMTP_PASSWORD), so scheduled reports cannot be sent.'
}

export async function sendMail(m: { to: string[]; subject: string; text: string; attachments?: Array<{ filename: string; content: Buffer; contentType: string }> }) {
  const c = config()
  if (!c) throw new Error(mailBlockedReason() ?? 'Email is not set up.')
  const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } })
  await transport.sendMail({ from: c.from, to: m.to.join(', '), subject: m.subject, text: m.text, attachments: m.attachments })
}

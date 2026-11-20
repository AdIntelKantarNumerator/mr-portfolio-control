/**
 * Email for scheduled reports.
 *
 * Azure Communication Services Email first (20 November 2026): the portfolio's
 * own sender (mr-portfolio-comms in rg-mr-portfolio-control), set by
 *   ACS_CONNECTION_STRING   endpoint=https://...;accesskey=...  (a Key Vault reference on the app)
 *   ACS_EMAIL_SENDER        DoNotReply@<domain>.azurecomm.net, or a verified mediaradar.com address later
 * It is called over its REST interface, each request signed with the access
 * key (HMAC-SHA256), so no Azure SDK is needed. The app's managed identity
 * would avoid the key, but assigning it a role needs rights the portfolio's
 * owner does not have.
 *
 * SMTP otherwise (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM),
 * which is what local work uses (a catcher on localhost). Without either,
 * schedules still save and the list says why nothing went out.
 */
import { createHash, createHmac } from 'node:crypto'
import nodemailer from 'nodemailer'

export interface Mail {
  to: string[]
  subject: string
  text: string
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>
}

type Env = Record<string, string | undefined>

function smtpConfig(env: Env) {
  const host = env.SMTP_HOST?.trim()
  const user = env.SMTP_USER?.trim()
  const pass = env.SMTP_PASSWORD?.trim()
  const from = env.SMTP_FROM?.trim() || user
  if (!host || !user || !pass || !from) return null
  return { host, port: Number(env.SMTP_PORT ?? 587), user, pass, from }
}

export function acsConfig(env: Env = process.env): { endpoint: string; key: string; sender: string } | null {
  const cs = env.ACS_CONNECTION_STRING?.trim()
  const sender = env.ACS_EMAIL_SENDER?.trim()
  if (!cs || !sender) return null
  const parts = Object.fromEntries(
    cs
      .split(';')
      .filter((p) => p.includes('='))
      .map((p) => [p.slice(0, p.indexOf('=')).trim().toLowerCase(), p.slice(p.indexOf('=') + 1).trim()]),
  )
  if (!parts.endpoint || !parts.accesskey) return null
  return { endpoint: parts.endpoint.replace(/\/+$/, ''), key: parts.accesskey, sender }
}

export function mailBlockedReason(env: Env = process.env): string | null {
  return acsConfig(env) || smtpConfig(env) ? null : 'Email is not set up on this server yet (ACS_CONNECTION_STRING and ACS_EMAIL_SENDER, or SMTP_*), so scheduled reports cannot be sent.'
}

const API = '2023-03-31'

/**
 * The headers that sign one request to Communication Services with its access key:
 * "VERB\npath?query\ndate;host;content-hash", HMAC-SHA256 with the decoded key.
 */
export function acsSign(method: string, url: string, body: string, key: string, now: Date = new Date()): Record<string, string> {
  const u = new URL(url)
  const date = now.toUTCString()
  const hash = createHash('sha256').update(body, 'utf8').digest('base64')
  const toSign = `${method}\n${u.pathname}${u.search}\n${date};${u.host};${hash}`
  const signature = createHmac('sha256', Buffer.from(key, 'base64')).update(toSign, 'utf8').digest('base64')
  return {
    'x-ms-date': date,
    'x-ms-content-sha256': hash,
    authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
  }
}

/** The body Communication Services takes for one message. */
export function acsBody(m: Mail, sender: string) {
  return {
    senderAddress: sender,
    recipients: { to: m.to.map((address) => ({ address })) },
    content: { subject: m.subject, plainText: m.text },
    ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ name: a.filename, contentType: a.contentType, contentInBase64: a.content.toString('base64') })) } : {}),
  }
}

async function sendAcs(m: Mail, c: { endpoint: string; key: string; sender: string }) {
  const url = `${c.endpoint}/emails:send?api-version=${API}`
  const body = JSON.stringify(acsBody(m, c.sender))
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...acsSign('POST', url, body, c.key) }, body })
  if (res.status !== 202) {
    const said = await res.text().catch(() => '')
    throw new Error(`Azure email refused the message (${res.status}): ${said.slice(0, 300)}`)
  }
  // Accepted is not delivered: follow the operation until it settles, so a failure shows on the schedule.
  const op = res.headers.get('operation-location')
  if (!op) return
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, i < 3 ? 2000 : 5000))
    const r = await fetch(op, { headers: acsSign('GET', op, '', c.key) })
    if (!r.ok) continue
    const s = (await r.json().catch(() => ({}))) as { status?: string; error?: { message?: string } }
    if (s.status === 'Succeeded') return
    if (s.status === 'Failed' || s.status === 'Canceled') throw new Error(`Azure email could not send it: ${s.error?.message ?? s.status}`)
  }
}

export async function sendMail(m: Mail, env: Env = process.env) {
  const acs = acsConfig(env)
  if (acs) return sendAcs(m, acs)
  const c = smtpConfig(env)
  if (!c) throw new Error(mailBlockedReason(env) ?? 'Email is not set up.')
  const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } })
  await transport.sendMail({ from: c.from, to: m.to.join(', '), subject: m.subject, text: m.text, attachments: m.attachments })
}

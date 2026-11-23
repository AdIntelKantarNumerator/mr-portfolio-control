/**
 * Magnifier's last logins, from the SSO user pool (Scott, 23 November 2026).
 *
 * MediaRadar's applications, Magnifier among them, sign in through one AWS
 * Cognito user pool (mr-clientapps-usprod), keyed by email. The pool keeps
 * each user's sign-in history (advanced security, audit mode), read one user
 * at a time with AdminListUserAuthEvents. So, to ask AWS as little as possible
 * (Scott: "store info on our side and minimize AWS cost"):
 *
 *   - only people who have signed in are listed (status CONFIRMED or
 *     EXTERNAL_PROVIDER; about 85% of the pool never has), one call per 60;
 *   - of those, only Magnifier users (by email) have their history read;
 *   - what is read is kept in ce_signins, and a person is read again only
 *     when their last read is a day old.
 * About 2,200 people, a few minutes the first time and less after.
 *
 * The sign-ins are for the whole pool, so for any application, not Magnifier
 * alone: the page says "last sign-in (SSO)".
 *
 * Access: an IAM user's key (COGNITO_ACCESS_KEY_ID, COGNITO_SECRET_ACCESS_KEY)
 * that may only assume COGNITO_ROLE_ARN, which may read the pool
 * (COGNITO_USER_POOL_ID, COGNITO_REGION). Read only.
 */
import { AdminListUserAuthEventsCommand, CognitoIdentityProviderClient, ListUsersCommand, type AuthEventType } from '@aws-sdk/client-cognito-identity-provider'
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts'
import { inArray, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { ceSignins } from '@/db/schema'
import type { UserSnap } from './types'

export interface CognitoConfig {
  region: string
  poolId: string
  accessKeyId: string
  secretAccessKey: string
  roleArn: string | null
}

export function cognitoConfig(env: Record<string, string | undefined> = process.env): CognitoConfig | null {
  const poolId = env.COGNITO_USER_POOL_ID?.trim()
  const accessKeyId = env.COGNITO_ACCESS_KEY_ID?.trim()
  const secretAccessKey = env.COGNITO_SECRET_ACCESS_KEY?.trim()
  if (!poolId || !accessKeyId || !secretAccessKey) return null
  return { region: env.COGNITO_REGION?.trim() || poolId.split('_')[0]!, poolId, accessKeyId, secretAccessKey, roleArn: env.COGNITO_ROLE_ARN?.trim() || null }
}

/** Read again only after this long. */
const STALE_MS = 20 * 3600_000
/** Each reader's calls a second, and how many read at once: about 20 a second, under Cognito's per-account rate for these reads. */
const RATE = 4
const WORKERS = 5

async function client(c: CognitoConfig): Promise<CognitoIdentityProviderClient> {
  let credentials = { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, sessionToken: undefined as string | undefined }
  if (c.roleArn) {
    const sts = new STSClient({ region: c.region, credentials })
    const r = await sts.send(new AssumeRoleCommand({ RoleArn: c.roleArn, RoleSessionName: 'client-evaluation', DurationSeconds: 3600 }))
    if (!r.Credentials?.AccessKeyId) throw new Error('Could not take on the Cognito role.')
    credentials = { accessKeyId: r.Credentials.AccessKeyId, secretAccessKey: r.Credentials.SecretAccessKey!, sessionToken: r.Credentials.SessionToken }
  }
  // A call that hangs is given up and retried, not waited on.
  return new CognitoIdentityProviderClient({ region: c.region, credentials, maxAttempts: 6, requestHandler: { connectionTimeout: 10_000, requestTimeout: 20_000 } })
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** From a user's sign-in events (newest first): the last successful sign-in, and how many in the last 30 days. */
export function summariseEvents(events: Array<Pick<AuthEventType, 'EventType' | 'EventResponse' | 'CreationDate'>>, now = Date.now()): { last: Date | null; logins30: number } {
  const ok = events.filter((e) => e.EventType === 'SignIn' && e.EventResponse === 'Pass' && e.CreationDate)
  const since = now - 30 * 86_400_000
  return { last: ok[0]?.CreationDate ?? null, logins30: ok.filter((e) => e.CreationDate!.getTime() >= since).length }
}

type Progress = (step: string, done?: number, total?: number) => void | Promise<void>

/**
 * Bring ce_signins up to date for these emails (Magnifier users'), and give
 * each its last sign-in and 30-day count. Emails not in the pool, or never
 * signed in, have none.
 */
export async function syncSignins(d: Database, emails: Set<string>, progress: Progress): Promise<Map<string, { last: string | null; logins30: number }>> {
  const cfg = cognitoConfig()
  const out = new Map<string, { last: string | null; logins30: number }>()
  if (!cfg || !emails.size) return out
  const cog = await client(cfg)

  // Who has signed in: the pool's CONFIRMED and EXTERNAL_PROVIDER users, with their email.
  await progress('Listing who has signed in (SSO)')
  const signedIn = new Map<string, { username: string; status: string }>()
  for (const status of ['CONFIRMED', 'EXTERNAL_PROVIDER']) {
    let token: string | undefined
    do {
      const r = await cog.send(new ListUsersCommand({ UserPoolId: cfg.poolId, Filter: `cognito:user_status = "${status}"`, AttributesToGet: ['email'], PaginationToken: token }))
      for (const u of r.Users ?? []) {
        const email = u.Attributes?.find((a) => a.Name === 'email')?.Value?.trim().toLowerCase()
        if (email && emails.has(email) && u.Username) signedIn.set(email, { username: u.Username, status })
      }
      token = r.PaginationToken
      await pause(1000 / RATE)
    } while (token)
  }

  // What we already hold; read again only the people not read in the last day.
  const held = new Map<string, typeof ceSignins.$inferSelect>()
  const list = [...signedIn.keys()]
  for (let i = 0; i < list.length; i += 1000)
    for (const r of await d.select().from(ceSignins).where(inArray(ceSignins.email, list.slice(i, i + 1000)))) held.set(r.email, r)
  const due = list.filter((e) => {
    const h = held.get(e)
    return !h || !h.checkedAt || Date.now() - h.checkedAt.getTime() > STALE_MS
  })

  let done = 0
  let next = 0
  let failed = 0
  const readOne = async (email: string) => {
    const who = signedIn.get(email)!
    const events: AuthEventType[] = []
    let token: string | undefined
    // Newest first; past 30 days only the latest is needed, which the first page has.
    do {
      const r = await cog.send(new AdminListUserAuthEventsCommand({ UserPoolId: cfg.poolId, Username: who.username, MaxResults: 60, NextToken: token }))
      events.push(...(r.AuthEvents ?? []))
      const oldest = events[events.length - 1]?.CreationDate?.getTime() ?? 0
      // At most 10 pages: an account that signs in all day (an integration) would otherwise page for minutes. Its count reads 600+.
      token = r.NextToken && oldest >= Date.now() - 30 * 86_400_000 && events.length < 600 ? r.NextToken : undefined
      await pause(1000 / RATE)
    } while (token)
    const s = summariseEvents(events)
    const row = { email, username: who.username, status: who.status, lastSignin: s.last, logins30: s.logins30, checkedAt: new Date() }
    await d
      .insert(ceSignins)
      .values(row)
      .onConflictDoUpdate({ target: ceSignins.email, set: { username: row.username, status: row.status, lastSignin: row.lastSignin, logins30: row.logins30, checkedAt: row.checkedAt } })
    held.set(email, { ...row })
    if (++done % 25 === 0) await progress(`Reading sign-in history (SSO): ${done} of ${due.length}`, done, due.length)
  }
  // A few people at a time: each call waits on the network far longer than on AWS's rate.
  await progress(`Reading sign-in history (SSO): 0 of ${due.length}`, 0, due.length)
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (next < due.length) {
        const email = due[next++]!
        // One person's failure leaves them for the next refresh, not the rest.
        await readOne(email).catch((err) => {
          failed++
          if (failed <= 3) console.error('[client-eval] SSO sign-ins for one person', (err as Error).message)
        })
      }
    }),
  )
  await progress(`Read sign-ins for ${due.length - failed} people${failed ? ` (${failed} failed)` : ''}; ${list.length - due.length} were read in the last day`, due.length, due.length)

  for (const e of list) {
    const h = held.get(e)
    if (h) out.set(e, { last: h.lastSignin ? h.lastSignin.toISOString().slice(0, 10) : null, logins30: h.logins30 })
  }
  return out
}

/** Give Magnifier's users their SSO last sign-in and 30-day count, by email. */
export async function applySignins(d: Database, users: UserSnap[], progress: Progress): Promise<void> {
  if (!cognitoConfig()) return
  const emails = new Set(users.map((u) => u.email).filter((e): e is string => !!e))
  const s = await syncSignins(d, emails, progress)
  for (const u of users) {
    const x = u.email ? s.get(u.email) : undefined
    if (!x) continue
    u.lastSeen = x.last
    u.logins30 = x.logins30
  }
}

/** How many people ce_signins holds, for a check. */
export async function signinCount(d: Database): Promise<number> {
  const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(ceSignins)
  return r?.n ?? 0
}

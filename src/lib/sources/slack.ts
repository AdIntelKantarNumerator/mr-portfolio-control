/**
 * Slack integration: intake in, digest out.
 *
 * Intake arrives as a slash command (see app/api/slack/intake). Digests go out
 * through an incoming webhook, because a webhook needs no bot token, no scopes
 * review and no app-install approval — the lowest-friction path to getting a
 * weekly portfolio summary in front of people who will not open a dashboard.
 */
import { getPortfolio, gaps, personLoads, risks, upcomingMilestones } from '../portfolio'

export { verifySlackSignature, parseSlackIntake } from './slack-protocol'
import { fmtDate, relativeDays } from '../util'

export interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  elements?: { type: string; text: string }[]
}

/** The weekly digest, as Slack blocks. */
export async function buildDigest(baseUrl?: string) {
  const p = await getPortfolio()
  const now = new Date()
  const red = risks(p, now).filter((r) => r.rag === 'red')
  const hot = personLoads(p).filter((l) => l.hot)
  const next = upcomingMilestones(p, 5, now)
  const contested = p.decisions.filter((d) => d.contested && d.status !== 'decided')
  const noOwner = gaps(p, now).filter((g) => g.kind === 'no_owner')

  const lines: string[] = []

  if (next.length) {
    lines.push(
      '*Next up*\n' +
        next
          .map(
            (m) =>
              `• ${fmtDate(m.targetDate, { year: true })} — ${m.name} _(${m.project.name}, ${relativeDays(m.targetDate)})_${m.contested ? ' ⚠️ contested' : ''}`,
          )
          .join('\n'),
    )
  }

  if (red.length) {
    lines.push(
      `*Assessed red (${red.length})*\n` +
        red.slice(0, 6).map((r) => `• ${r.name} — ${r.why}`).join('\n'),
    )
  }

  if (hot.length) {
    lines.push(
      '*Single-threaded people*\n' +
        hot
          .slice(0, 5)
          .map((h) => `• ${h.person.name} — ${h.projects.length} open projects`)
          .join('\n'),
    )
  }

  if (contested.length) {
    lines.push(
      `*Contested decisions (${contested.length})*\n` +
        contested.map((d) => `• ${d.ref} ${d.title} — owner: ${d.ownerText ?? 'unassigned'}`).join('\n'),
    )
  }

  if (noOwner.length) {
    lines.push(`*No owner set*: ${noOwner.map((g) => g.name).join(', ')}`)
  }

  if (lines.length === 0) lines.push('Nothing outstanding this week.')

  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: 'Portfolio control room' } },
    ...lines.map((text) => ({ type: 'section', text: { type: 'mrkdwn', text } })),
  ]

  if (baseUrl) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${baseUrl}|Open the control room>` }],
    })
  }

  return blocks
}

export async function postDigest(baseUrl?: string): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return { ok: false, error: 'SLACK_WEBHOOK_URL is not set' }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks: await buildDigest(baseUrl) }),
  })
  if (!res.ok) return { ok: false, error: `Slack returned ${res.status}: ${await res.text()}` }
  return { ok: true }
}

/**
 * Prototypes > Report Builder (11 November 2026).
 *
 * The page the left nav opens. Report Builder itself is a chat: a model in
 * Open WebUI, answered by the portfolio (lib/report-builder/). Open WebUI
 * cannot be framed here (README in deploy/open-webui says why), so this page
 * explains it, shows the person's saved reports, and opens the chat in its
 * own window with Report Builder already chosen.
 *
 * Only people with "Sees prototypes" reach it (lib/access-rules.ts).
 */
import { Card, Kicker, Muted } from '@/components/ui'
import { currentAccess } from '@/lib/auth/access'
import { engineFor, loadUser, REPORT_BUILDER_MODEL_ID } from '@/lib/report-builder/agent'
import { chooseModel } from '@/lib/report-builder/model'

export const metadata = { title: 'Report Builder' }
export const dynamic = 'force-dynamic'

const EXAMPLES = [
  'I need a custom report',
  'Media mix for Toyota and Ford, last 6 months',
  "Which automotive advertisers aren't buying on ESPN?",
  'Run my auto insurance share report',
]

export default async function ReportBuilderPage() {
  const access = await currentAccess()
  const chatUrl = process.env.YAARA_CHAT_URL?.trim().replace(/\/+$/, '') || null
  const openUrl = chatUrl ? `${chatUrl}/?model=${REPORT_BUILDER_MODEL_ID}` : null
  const model = chooseModel()
  const saved = access.email ? engineFor(await loadUser(access.email.toLowerCase())).engine.listSaved() : []

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Prototypes</Kicker>
          <h1>Report Builder</h1>
        </div>
      </div>

      <Card>
        <div className="flex flex-col gap-3" style={{ maxWidth: '68ch' }}>
          <p>
            Set up a custom report or data extract by conversation instead of a long setup form. Ask in one sentence, answer a question or two by
            number, and get a preview, a spreadsheet, and a saved report you can re-run whenever new data arrives.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {openUrl && model ? (
              <a className="btn btn-primary" href={openUrl} target="report-builder" rel="noopener">
                Open Report Builder
              </a>
            ) : (
              <span className="btn" aria-disabled="true">
                Open Report Builder
              </span>
            )}
            <Muted>Opens in its own window, in the chat where you also talk to Yaara. Sign in with Google there if asked.</Muted>
          </div>
          {!openUrl ? <Muted>The chat is not set up on this deployment (YAARA_CHAT_URL is not set).</Muted> : null}
          {openUrl && !model ? <Muted>No model that can run Report Builder is configured yet (REPORT_BUILDER_MODEL and REPORT_BUILDER_PROVIDERS for OpenRouter, or ANTHROPIC_API_KEY).</Muted> : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-[15px] font-semibold">Things to try</h2>
        <ul className="list-disc pl-5 text-[13.5px]" style={{ lineHeight: 1.8 }}>
          {EXAMPLES.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-[15px] font-semibold">Your saved reports</h2>
        {saved.length ? (
          <ul className="flex flex-col gap-2 text-[13.5px]">
            {saved.map((r) => (
              <li key={r.id}>
                <b>{r.name}</b>
                <div>
                  <Muted>
                    {r.summary}
                    {r.last_run ? ` · last run ${r.last_run.period_label}` : ''}
                  </Muted>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>None yet. Save a report in the chat and it appears here. Your first visit to the chat adds an example to re-run.</Muted>
        )}
      </Card>

      <Muted>
        A prototype. Advertiser and media names are real; the figures are illustrative sample data, not measured spend, and nothing here reads
        ClickHouse.
      </Muted>
    </div>
  )
}

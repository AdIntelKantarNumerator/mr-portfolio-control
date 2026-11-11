/**
 * Prototypes > Report Builder (11 November 2026).
 *
 * Set up custom reports and data extracts by conversation. The conversation
 * runs here, in the portfolio (chat.tsx), so the page can draw choices as
 * buttons, tables and charts, which Open WebUI's text-only chat cannot. The
 * same model is also listed in Open WebUI, as plain text.
 *
 * Only people with "Sees prototypes" reach it (lib/access-rules.ts).
 */
import { Kicker } from '@/components/ui'
import { currentAccess } from '@/lib/auth/access'
import { REPORT_BUILDER_MODEL_ID, reportBuilderOverview } from '@/lib/report-builder/agent'
import { chooseModel } from '@/lib/report-builder/model'
import { ReportBuilderChat } from './chat'

export const metadata = { title: 'Report Builder' }
export const dynamic = 'force-dynamic'

export default async function ReportBuilderPage() {
  const access = await currentAccess()
  const overview = await reportBuilderOverview(access.email || 'local@localhost')
  const chatUrl = process.env.YAARA_CHAT_URL?.trim().replace(/\/+$/, '') || null

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Prototypes</Kicker>
          <h1>Report Builder</h1>
        </div>
        {chatUrl ? (
          <a className="rb-muted rb-cap" href={`${chatUrl}/?model=${REPORT_BUILDER_MODEL_ID}`} target="report-builder" rel="noopener">
            Also in the chat window, as text
          </a>
        ) : null}
      </div>
      <ReportBuilderChat initialSaved={overview.saved} initialThrough={overview.dataThrough} modelReady={Boolean(chooseModel())} live={overview.live} />
      <p className="rb-muted rb-cap">
        {overview.live
          ? `A prototype on live data from the development data server. All media are covered from ${overview.allMediaFrom}; earlier months hold only some media, and development figures can change while the data team works.`
          : 'A prototype. Advertiser and media names are real; the figures are illustrative sample data, not measured spend.'}
      </p>
    </div>
  )
}

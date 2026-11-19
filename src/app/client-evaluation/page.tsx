/**
 * Client Evaluation (Scott, 19 November 2026): every client across 360,
 * MediaRadar Classic and Magnifier on one list, for client migrations - which
 * platforms each has, its people, its 2026 360 reports, and each platform's
 * own entitlements. Only for people ticked "Sees Client Evaluation" in Admin
 * (lib/access-rules.ts CLIENT_EVALUATION_PATHS).
 *
 * Everything shown comes from snapshots (lib/client-eval/), refreshed per
 * platform: 360 and Magnifier from here, Classic from Scott's laptop.
 */
import { Kicker } from '@/components/ui'
import { REFRESH_CONTACT } from '@/lib/client-eval/types'
import { ClientEvaluation } from './evaluation'

export const metadata = { title: 'Client Evaluation' }
export const dynamic = 'force-dynamic'

export default function ClientEvaluationPage() {
  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Reference</Kicker>
          <h1>Client Evaluation</h1>
          <p className="ce-lede">Clients across 360, Classic and Magnifier, with their people, reports and entitlements.</p>
        </div>
      </div>
      <ClientEvaluation contact={REFRESH_CONTACT} />
    </div>
  )
}

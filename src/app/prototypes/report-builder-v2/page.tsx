/**
 * Prototypes > Report Builder V2 (20 November 2026).
 *
 * The V1 conversation on the left; on the right, the report being built as
 * its selections (report type, rows, columns, metrics, period, filters),
 * editable by hand, like the Insights Studio builder prototype. Save, Run,
 * Export and Schedule sit at the top right. Opening, running, exporting and
 * scheduling a saved report need no model: only setting one up by typing does.
 *
 * Only people with "Sees prototypes" reach it (lib/access-rules.ts).
 */
import { currentAccess } from '@/lib/auth/access'
import { reportBuilderOverview } from '@/lib/report-builder/agent'
import { chooseModel } from '@/lib/report-builder/model'
import { ReportBuilderV2 } from './builder'

export const metadata = { title: 'Report Builder V2' }
export const dynamic = 'force-dynamic'

export default async function ReportBuilderV2Page() {
  const access = await currentAccess()
  const email = access.email || 'local@localhost'
  const overview = await reportBuilderOverview(email)
  return (
    <div className="stack">
      <ReportBuilderV2
        email={email}
        initialSaved={overview.saved}
        initialComp={overview.compSet}
        initialBrands={overview.brandSet}
        initialMode={overview.mode}
        modelReady={Boolean(chooseModel())}
        live={overview.live}
        dataThrough={overview.dataThrough}
      />
      <p className="rb-muted rb-cap">
        {overview.live
          ? `A prototype on live production GPC data. All media are covered from ${overview.allMediaFrom}; earlier months hold only some media.`
          : 'A prototype. Advertiser and media names are real; the figures are illustrative sample data, not measured spend.'}
      </p>
    </div>
  )
}

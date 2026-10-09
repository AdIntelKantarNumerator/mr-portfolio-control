/**
 * Meeting series: recurring meetings followed from one session to the next.
 * See src/lib/series.ts.
 */
import { Kicker } from '@/components/ui'
import { listSeries } from '@/lib/series-data'
import { SeriesList } from './list'

export const metadata = { title: 'Meeting series' }
export const dynamic = 'force-dynamic'

export default async function SeriesPage() {
  const rows = await listSeries()
  return (
    <div className="stack">
      <div>
        <Kicker>Work in progress</Kicker>
        <h1>Meeting series</h1>
      </div>
      <SeriesList rows={rows} />
    </div>
  )
}

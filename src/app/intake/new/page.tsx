import Link from 'next/link'
import { asc } from 'drizzle-orm'
import { db } from '@/db/client'
import { appAreas, initiatives, themes } from '@/db/schema'
import { Kicker, Muted } from '@/components/ui'
import { RequestForm } from './request-form'

export const metadata = { title: 'New request · Portfolio Control Room' }

// The taxonomies are edited by the program team in the same session someone is
// filing a request, so a cached page would offer stale routing options.
export const dynamic = 'force-dynamic'

export default async function NewRequestPage() {
  const [themeRows, areaRows, initiativeRows] = await Promise.all([
    db.select({ id: themes.id, name: themes.name }).from(themes).orderBy(asc(themes.sortOrder)),
    db.select({ id: appAreas.id, name: appAreas.name }).from(appAreas).orderBy(asc(appAreas.sortOrder)),
    db
      .select({ id: initiatives.id, name: initiatives.name })
      .from(initiatives)
      .orderBy(asc(initiatives.sortOrder), asc(initiatives.name)),
  ])

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Kicker>Intake</Kicker>
          <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">New request</h2>
          <Muted>
            Nothing here commits anyone to anything. It puts the request in one queue where it can
            be compared against everything else competing for the same people.
          </Muted>
        </div>
        <Link href="/intake" className="btn no-print">
          Back to the queue
        </Link>
      </div>

      <RequestForm themes={themeRows} appAreas={areaRows} initiatives={initiativeRows} />
    </div>
  )
}

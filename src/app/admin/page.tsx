/**
 * Admin: who can see and edit what (Scott, 20 October 2026). Admins only -
 * the proxy refuses this path to anyone else (lib/access-rules.ts).
 */
import { notFound } from 'next/navigation'
import { Kicker } from '@/components/ui'
import { currentAccess } from '@/lib/auth/access'
import { listSiteUsers } from '@/lib/site-users'
import { PeopleTable } from './people'

export const metadata = { title: 'Roles & access' }
export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const access = await currentAccess()
  // The proxy already refuses this page to non-admins; this is the second lock.
  if (!access.isAdmin) notFound()
  const people = await listSiteUsers()
  return (
    <div className="stack">
      <div>
        <Kicker>Admin</Kicker>
        <h1>Roles & access</h1>
      </div>
      <PeopleTable people={people} me={access.email} />
    </div>
  )
}

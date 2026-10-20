'use server'

/** The Admin section's changes. Every one checks the caller is an admin. */
import { revalidatePath } from 'next/cache'
import { currentAccess } from '@/lib/auth/access'
import { logChange } from '@/lib/portfolio'
import { AccessError, addSiteUser, updateSiteUser, type SiteUser } from '@/lib/site-users'
import { ROLE_LABEL, type Role } from '@/lib/access-rules'

export interface AdminState {
  ok?: boolean
  error?: string
  user?: SiteUser
}

async function admin(): Promise<string> {
  const a = await currentAccess()
  if (!a.isAdmin) throw new AccessError('Only admins can change access.')
  return a.name || a.email || 'An admin'
}

const isRole = (r: unknown): r is Role => r === 'product' || r === 'commercial'

export async function changeAccess(input: { email: string; role?: string; isAdmin?: boolean; canEditDocs?: boolean }): Promise<AdminState> {
  try {
    const by = await admin()
    if (input.role !== undefined && !isRole(input.role)) return { error: 'Unknown role.' }
    const user = await updateSiteUser(input.email, { role: input.role as Role | undefined, isAdmin: input.isAdmin, canEditDocs: input.canEditDocs }, by)
    const what =
      input.role !== undefined
        ? `role ${ROLE_LABEL[user.role]}`
        : input.isAdmin !== undefined
          ? input.isAdmin ? 'made an admin' : 'no longer an admin'
          : input.canEditDocs ? 'may edit documentation' : 'may no longer edit documentation'
    await logChange({ actor: by, kind: 'change', summary: `Access: ${user.name ?? user.email} — ${what}` })
    revalidatePath('/admin')
    return { ok: true, user }
  } catch (err) {
    return { error: err instanceof AccessError ? err.message : 'That could not be saved.' }
  }
}

export async function addPerson(input: { email: string; name: string; role: string; isAdmin: boolean; canEditDocs: boolean }): Promise<AdminState> {
  try {
    const by = await admin()
    if (!isRole(input.role)) return { error: 'Pick a role.' }
    const user = await addSiteUser({ email: input.email, name: input.name, role: input.role, isAdmin: input.isAdmin, canEditDocs: input.canEditDocs }, by)
    await logChange({ actor: by, kind: 'change', summary: `Access: added ${user.name ?? user.email} as ${ROLE_LABEL[user.role]}${user.isAdmin ? ', admin' : ''}` })
    revalidatePath('/admin')
    return { ok: true, user }
  } catch (err) {
    return { error: err instanceof AccessError ? err.message : 'That could not be saved.' }
  }
}

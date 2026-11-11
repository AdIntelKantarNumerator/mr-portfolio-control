/**
 * Who may see what (Scott, 20 October 2026). Pure rules, no database, so the
 * request gate (proxy.ts), the left nav and the tests all read the same ones.
 *
 *   product      Product, Program management and Technology: everything, for now.
 *   commercial   The Commercial organisation: the Reference section only - not
 *                Home, the work, work in progress, Inbound or Activity. Also
 *                anyone with no role yet, until an admin assigns one.
 *   admin        A flag on top of either role: the Admin section, and
 *                documentation editing.
 *   canEditDocs  A flag: create folders, upload, rename, replace and remove in
 *                Process Documentation. Admins always have it.
 *   canSeePrototypes  A flag (11 November 2026): the Prototypes section, work
 *                in trial such as Report Builder. Independent of role, and not
 *                implied by admin: each person is switched on deliberately.
 */

export type Role = 'product' | 'commercial'

export interface Access {
  role: Role
  isAdmin: boolean
  canEditDocs: boolean
  canSeePrototypes: boolean
}

export const ROLE_LABEL: Record<Role, string> = {
  product: 'Product Focused',
  commercial: 'Commercial',
}

/** Nobody has said what this person is: the least they could need. */
export const NO_ROLE: Access = { role: 'commercial', isAdmin: false, canEditDocs: false, canSeePrototypes: false }

/** Everything, for local development where sign-in is switched off. */
export const EVERYTHING: Access = { role: 'product', isAdmin: true, canEditDocs: true, canSeePrototypes: true }

export function normalise(
  row: { role?: string | null; isAdmin?: boolean | null; canEditDocs?: boolean | null; canSeePrototypes?: boolean | null } | null | undefined,
): Access {
  if (!row) return NO_ROLE
  const isAdmin = Boolean(row.isAdmin)
  return {
    role: row.role === 'product' ? 'product' : 'commercial',
    isAdmin,
    canEditDocs: isAdmin || Boolean(row.canEditDocs),
    canSeePrototypes: Boolean(row.canSeePrototypes),
  }
}

/** The Reference section's pages, and the raw artifact pages they show. */
export const REFERENCE_PATHS = ['/process-docs', '/docs-raw', '/templates', '/workflow', '/data-dictionary', '/taxonomy-comparison']

/** The Admin section. */
export const ADMIN_PATHS = ['/admin']

/** The Prototypes section: whoever has the flag, whatever their role. */
export const PROTOTYPE_PATHS = ['/prototypes']

const under = (pathname: string, prefixes: readonly string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))

/**
 * Whether a person may open a path. Checked for every request by the proxy,
 * which covers pages, in-app navigation and form actions alike.
 */
export function canSee(access: Access, pathname: string): boolean {
  if (under(pathname, ADMIN_PATHS)) return access.isAdmin
  if (under(pathname, PROTOTYPE_PATHS)) return access.canSeePrototypes
  if (access.role === 'product') return true
  return under(pathname, REFERENCE_PATHS)
}

/** Whether this is the embedded database of local development rather than Postgres. */
export function usesEmbeddedDb(env: Record<string, string | undefined> = process.env): boolean {
  return !/^postgres(ql)?:\/\//.test(env.DATABASE_URL?.trim() ?? '')
}

/** Where a person lands when they open the site, or a page they may not see. */
export function landingFor(access: Access): string {
  return access.role === 'product' ? '/' : '/process-docs'
}

/** Which left-nav sections a person sees, by section id (components/nav.ts). */
export function navSectionsFor(access: Access): Set<string | null> {
  const sections = new Set<string | null>(access.role === 'product' ? [null, 'work', 'decide', 'inbound', 'reference', 'log'] : ['reference'])
  if (access.canSeePrototypes) sections.add('prototypes')
  if (access.isAdmin) sections.add('admin')
  return sections
}

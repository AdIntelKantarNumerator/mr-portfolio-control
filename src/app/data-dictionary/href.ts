/**
 * One way to build a Data Dictionary link, so the environment, the edit
 * toggle and the filters survive every click between tabs and tables.
 *
 * Edit mode lives in the URL rather than in component state because every tab
 * is server-rendered: a toggle held in the browser would reset on the first
 * link somebody followed, and they would have to find the button again.
 */
import type { Environment } from '@/lib/dictionary-rules'

export interface DictView {
  env: Environment
  tab?: 'datasets' | 'schemas' | 'tables'
  edit?: boolean
  showAll?: boolean
  q?: string
  db?: string
}

function query(v: DictView, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (v.env !== 'dev') p.set('env', v.env)
  if (v.tab && v.tab !== 'datasets') p.set('tab', v.tab)
  if (v.edit) p.set('edit', '1')
  if (v.showAll) p.set('show', 'all')
  if (v.q) p.set('q', v.q)
  if (v.db) p.set('db', v.db)
  for (const [k, val] of Object.entries(extra)) p.set(k, val)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function dictHref(v: DictView): string {
  return `/data-dictionary${query(v)}`
}

/** The two tabs on a table page. Fields is the default and has no parameter. */
export type TablePane = 'fields' | 'preview'

export function tableHref(v: Pick<DictView, 'env' | 'edit'> & { pane?: TablePane }, database: string, table: string): string {
  const extra: Record<string, string> = v.pane === 'preview' ? { view: 'preview' } : {}
  return `/data-dictionary/${encodeURIComponent(database)}/${encodeURIComponent(table)}${query({ env: v.env, edit: v.edit }, extra)}`
}

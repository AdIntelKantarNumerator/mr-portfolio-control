/**
 * The bar across the top of every Data Dictionary page: which environment,
 * when it was read, and the Edit toggle.
 *
 * The connection state is spelled out rather than shown as a coloured dot,
 * because "Prod is not connected" and "Dev could not be reached" call for
 * different people to do different things.
 */
import Link from 'next/link'
import { ENVIRONMENTS, ENV_LABEL, type Environment } from '@/lib/dictionary-rules'
import type { CatalogResult } from '@/lib/dictionary'
import { rereadCatalog } from './actions'

export function DictionaryHeader({
  env,
  result,
  edit,
  hrefFor,
}: {
  env: Environment
  result: CatalogResult
  edit: boolean
  hrefFor: (change: { env?: Environment; edit?: boolean }) => string
}) {
  const read =
    result.state === 'ok'
      ? `Read ${new Date(result.catalog.readAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · ${result.catalog.databases.length} databases · ${result.catalog.tables.length} tables`
      : result.state === 'not_connected'
        ? 'Not connected'
        : 'Could not be read'
  return (
    <div className="dd-bar">
      <span className="seg dd-seg" role="group" aria-label="Environment">
        {ENVIRONMENTS.map((e) => (
          <Link key={e} href={hrefFor({ env: e })} className={e === env ? 'on' : ''} aria-current={e === env ? 'page' : undefined}>
            {ENV_LABEL[e]}
          </Link>
        ))}
      </span>
      <span className="dd-read">{read}</span>
      {result.state !== 'not_connected' ? (
        <form action={rereadCatalog}>
          <input type="hidden" name="env" value={env} />
          <button type="submit" className="btn">
            Re-read now
          </button>
        </form>
      ) : null}
      <Link href={hrefFor({ edit: !edit })} className={edit ? 'btn btn-primary dd-edit' : 'btn dd-edit'}>
        {edit ? 'Done editing' : 'Edit'}
      </Link>
    </div>
  )
}

export function ConnectionNote({ result }: { result: CatalogResult }) {
  if (result.state === 'ok') return null
  if (result.state === 'not_connected') {
    return (
      <div className="dd-note dd-note-info">
        ClickHouse {ENV_LABEL[result.env]} is not connected yet. Dataset intent for {ENV_LABEL[result.env]} is shown below; structure
        and loaded status fill in once <code>CLICKHOUSE_{result.env.toUpperCase()}_URL</code>, <code>_USER</code> and{' '}
        <code>_PASSWORD</code> are set. See deploy/AZURE.md.
      </div>
    )
  }
  return <div className="dd-note dd-note-bad">{result.message} Notes and datasets are still shown; loaded status is unknown until it can be read.</div>
}

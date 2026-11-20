/**
 * The Impact Deck's own window (Scott, 20 November 2026): opened from Client
 * Evaluation, it starts the deck, shows how far along it is, and downloads the
 * PowerPoint when it is done.
 */
import { DeckRunner } from './runner'

export const metadata = { title: 'Impact Deck' }
export const dynamic = 'force-dynamic'

export default async function DeckPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  return <DeckRunner scope={one(sp.scope)} title={one(sp.title)} />
}

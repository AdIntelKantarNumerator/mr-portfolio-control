'use client'
/**
 * A small spinner inside a Link that shows while its page is being read
 * (Scott, 17 November 2026: clicking a category "can take a while and there
 * is no indication anything is happening"). Must sit inside a <Link>.
 */
import { useLinkStatus } from 'next/link'

export function LinkPending() {
  const { pending } = useLinkStatus()
  return <span aria-hidden className={`mor-spin ${pending ? 'on' : ''}`} />
}

/**
 * Deployment settings that genuinely vary between installs.
 *
 * Branding is NOT here — it lives in src/lib/brand.ts as plain constants,
 * because a name that changes roughly never is not worth a configuration
 * mechanism that can silently fail. What remains are values a running
 * deployment legitimately tunes.
 */
import { cache } from 'react'
import { db } from '@/db/client'
import { settings as settingsTable } from '@/db/schema'

export interface PortfolioSettings {
  horizonStart: string | null
  horizonEnd: string | null
  staleDays: number
}

const DEFAULTS: PortfolioSettings = {
  horizonStart: null,
  horizonEnd: null,
  staleDays: 21,
}

export const getSettings = cache(async (): Promise<PortfolioSettings> => {
  let rows: { key: string; value: string }[] = []
  try {
    rows = await db.select().from(settingsTable)
  } catch {
    // Before the first migration there is no settings table. The app should
    // still render — an install that 500s on its own landing page is a bad
    // first impression of an otherwise working tool.
    return DEFAULTS
  }

  const get = (key: string) => rows.find((r) => r.key === key)?.value?.trim() || ''
  const stale = Number(get('assessment.staleDays'))

  return {
    horizonStart: get('portfolio.horizonStart') || null,
    horizonEnd: get('portfolio.horizonEnd') || null,
    staleDays: Number.isFinite(stale) && stale > 0 ? stale : DEFAULTS.staleDays,
  }
})

import { NextResponse } from 'next/server'
import { configuredSheets, syncSheet } from '@/lib/sources/sheets'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const sources = configuredSheets()
  if (sources.length === 0) {
    return NextResponse.json(
      {
        error: 'No sheets configured',
        hint: 'Set SHEETS_SOURCES to a JSON array of {id,label,url,mapping}. See .env.example.',
      },
      { status: 503 },
    )
  }

  const results = []
  for (const source of sources) {
    results.push({ source: source.label, ...(await syncSheet(source)) })
  }
  const failed = results.some((r) => r.status === 'failed')
  return NextResponse.json({ results }, { status: failed ? 502 : 200 })
}

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  return NextResponse.json({
    configured: configuredSheets().map((s) => ({ id: s.id, label: s.label })),
  })
}

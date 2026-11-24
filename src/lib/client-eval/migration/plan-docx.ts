/**
 * A Migration Plan as a Word document (Scott, 23 November 2026), for client
 * support to edit and pass on. Word rather than PDF: it is a working document.
 */
import { Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { PLATFORM_LABEL } from '../types'
import { ACCOUNT_TYPE_LABEL, ENTITY_TYPE, SET_LABEL } from './catalog'
import type { MigrationPlan } from './types'

const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => new Paragraph({ text, heading: level })
const p = (text: string, opts: { bold?: boolean; italics?: boolean; color?: string } = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })] })
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } })

function table(head: string[], rows: string[][]): Table {
  const cell = (t: string, isHead: boolean) =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: t, bold: isHead, size: 18 })] })],
      shading: isHead ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8EDF5' } : undefined,
    })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: head.map((t) => cell(t, true)) }), ...rows.map((r) => new TableRow({ children: r.map((t) => cell(t, false)) }))],
  })
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const MAX_USERS = 400
const MAX_ITEMS_DOC = 25

export async function planDocx(plan: MigrationPlan): Promise<Buffer> {
  const out: Array<Paragraph | Table> = []
  out.push(new Paragraph({ text: `${plan.client}: Migration Plan to Insights Studio`, heading: HeadingLevel.TITLE }))
  out.push(p(`Built ${day(plan.built)}${plan.depth === 'light' ? ' (light plan: advertisers not yet followed into Insights Studio)' : ''}.`, { italics: true, color: '666666' }))

  out.push(h('Summary', HeadingLevel.HEADING_1))
  for (const s of plan.summary) out.push(bullet(s))
  out.push(p(`Review: ${plan.review.verdict === 'ok' ? 'no issues found' : plan.review.verdict === 'problem' ? 'problems to resolve' : 'points to check'}.`, { bold: true }))
  for (const i of plan.review.issues) out.push(bullet(i))

  out.push(h('Organization and accounts', HeadingLevel.HEADING_1))
  out.push(p(`Organization: ${plan.organization.name}. ${plan.organization.why}`))
  for (const a of plan.accounts) {
    out.push(h(`${a.name} (${ACCOUNT_TYPE_LABEL[a.type.value]})`, HeadingLevel.HEADING_2))
    out.push(p(a.why))
    out.push(p(`Type: ${a.type.why}. Users to create: ${a.seats}.`))
    out.push(p('Replaces', { bold: true }))
    for (const f of a.from) out.push(bullet(`${PLATFORM_LABEL[f.platform]}: ${f.name} (${f.activeUsers} active users)`))
    out.push(p('Packages', { bold: true }))
    out.push(table(['Package', 'Why'], a.packages.map((x) => [`${x.name}${x.kind === 'add_on' ? ' (add-on)' : ''}`, x.why])))
    out.push(p('Contract', { bold: true }))
    out.push(bullet(`History: ${a.contract.lookbackYears.value} complete years plus the current year. ${a.contract.lookbackYears.why}`))
    out.push(bullet(`Preliminary data: ${a.contract.includePreliminary.value ? 'yes' : 'no'}. ${a.contract.includePreliminary.why}`))
    out.push(p('Coverage', { bold: true }))
    out.push(bullet(`Countries: ${a.coverage.countries.map((c) => `${c.name} (${c.why})`).join('; ')}`))
    const kept = a.coverage.media.filter((m) => m.status === 'kept').map((m) => m.name)
    const added = a.coverage.media.filter((m) => m.status === 'added').map((m) => m.name)
    const premium = a.coverage.media.filter((m) => m.status === 'premium').map((m) => m.name)
    if (kept.length) out.push(bullet(`Media they keep: ${kept.join(', ')}`))
    if (added.length) out.push(bullet(`Media added: ${added.join(', ')}`))
    if (premium.length) out.push(bullet(`Premium media kept: ${premium.join(', ')}`))
    for (const w of a.coverage.withheld) out.push(bullet(`Not included: ${w.name}. ${w.why}`))
    if (a.coverage.widened.length) {
      out.push(p('Restrictions lifted (kept as workspaces)', { bold: true }))
      for (const w of a.coverage.widened) out.push(bullet(w))
    }
  }

  out.push(h('Impact', HeadingLevel.HEADING_1))
  if (plan.impact.gains.length) {
    out.push(p('What they gain', { bold: true }))
    for (const g of plan.impact.gains) out.push(bullet(g))
  }
  if (plan.impact.losses.length) {
    out.push(p('What they lose', { bold: true }))
    for (const g of plan.impact.losses) out.push(bullet(g))
  }
  if (plan.impact.notInV1.length) {
    out.push(p('Not in Insights Studio V1', { bold: true }))
    for (const g of plan.impact.notInV1) out.push(bullet(g))
  }
  out.push(p('Media by platform', { bold: true }))
  out.push(
    table(
      ['Platform', 'Today', 'Kept', 'Dropped', 'Added'],
      plan.impact.media.map((m) => [PLATFORM_LABEL[m.platform], m.change.mapping.map((x) => x.from).join(', ') || 'All', m.change.kept.join(', '), m.change.dropped.join(', ') || 'None', m.change.added.join(', ')]),
    ),
  )

  const created = plan.users.filter((u) => u.create.value)
  const notCreated = plan.users.filter((u) => !u.create.value)
  out.push(h(`Users (${created.length} to create)`, HeadingLevel.HEADING_1))
  const accountName = new Map(plan.accounts.map((a) => [a.key, a.name]))
  out.push(
    table(
      ['Name', 'Email', 'Account', 'Role', 'Last login', 'Replaces'],
      created.slice(0, MAX_USERS).map((u) => [u.name, u.email ?? '', accountName.get(u.account ?? '') ?? '', u.role.value, u.lastSeen ?? 'None on record', [...new Set(u.logins.map((l) => PLATFORM_LABEL[l.platform]))].join(', ')]),
    ),
  )
  if (created.length > MAX_USERS) out.push(p(`And ${created.length - MAX_USERS} more.`, { italics: true }))
  if (notCreated.length) {
    out.push(p(`Not created (${notCreated.length})`, { bold: true }))
    out.push(table(['Name', 'Email', 'Why'], notCreated.slice(0, MAX_USERS).map((u) => [u.name, u.email ?? '', u.create.why])))
  }

  out.push(h(`Workspaces (${plan.workspaces.length})`, HeadingLevel.HEADING_1))
  const userName = new Map(plan.users.map((u) => [u.key, u.name]))
  for (const w of plan.workspaces) {
    out.push(h(w.name, HeadingLevel.HEADING_2))
    out.push(p(`${accountName.get(w.account) ?? ''} · ${w.source}. ${w.why}`))
    out.push(p(`For: ${w.users.map((k) => userName.get(k) ?? k).slice(0, 30).join(', ')}${w.users.length > 30 ? ` and ${w.users.length - 30} more` : ''}`))
    for (const s of w.sets) {
      out.push(p(`${SET_LABEL[s.set]} (${s.items.length + s.more})`, { bold: true }))
      out.push(
        table(
          ['Today', 'Type', 'In Insights Studio'],
          s.items.slice(0, MAX_ITEMS_DOC).map((i) => [`${i.name} (${PLATFORM_LABEL[i.legacy.platform]}, ${i.legacy.list})`, ENTITY_TYPE[i.entityType] ?? String(i.entityType), i.gpc ? `${i.gpc.name} (#${i.gpc.id})${i.gpc.guess ? ' - best guess by name' : ''}` : 'Not matched yet']),
        ),
      )
      if (s.items.length + s.more > MAX_ITEMS_DOC) out.push(p(`And ${s.items.length + s.more - MAX_ITEMS_DOC} more.`, { italics: true }))
    }
  }

  out.push(h('Checklist', HeadingLevel.HEADING_1))
  for (const c of plan.checklist) out.push(bullet(c))
  if (plan.notes.length) {
    out.push(h('Notes', HeadingLevel.HEADING_2))
    for (const n of plan.notes) out.push(bullet(n))
  }

  const doc = new Document({
    creator: 'MR Portfolio Control',
    title: `${plan.client}: Migration Plan`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children: out }],
  })
  return Packer.toBuffer(doc)
}

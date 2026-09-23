/**
 * Process reference data — the project lifecycle, its templates, the discovery
 * question bank, and a starting scoring model.
 *
 * This is SEPARATE from any portfolio content on purpose. It describes how the
 * organisation runs projects, not which projects exist, so it belongs in an
 * otherwise empty system: install the tool, load your process, then let Linear
 * and your own data entry fill in the work.
 *
 *   npm run seed:process      # safe to re-run; replaces process data only
 *
 * Everything here is editable in the database afterwards. The gates and items
 * below were transcribed from MediaRadar's program references site; if your
 * process differs, change this file (or edit the rows) and re-run.
 */
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { connect, warnIfServerRunning } from './_connect'

async function main() {
  const { db, close, embedded } = await connect()
  const s = await import('../src/db/schema')
  const id = () => randomUUID()

  // Process data only. Portfolio content is left untouched, so this can be
  // re-run against a live system to pick up a process change.
  await db.execute(sql`
    TRUNCATE TABLE project_readiness, readiness_items, lifecycle_gates,
      discovery_topics, templates, scores, scoring_criteria, scoring_models
    RESTART IDENTITY CASCADE
  `)

  // ---- lifecycle gates ---------------------------------------------------
  // Transcribed from the program team's own internal process site. The wording
  // and the template links are theirs verbatim: the point of this feature is to
  // make the documented process checkable, and a paraphrase would quietly turn
  // it into a different process.
  const gateRows = [
    { key: 'pre-approval', name: 'Pre-Approval (Business Case & Decomposition)',
      phase: 'pre_approval', sortOrder: 1,
      description: "Define the project's value and get initial prioritization approval." },
    { key: 'core-documentation', name: 'Core Documentation & Tracking',
      phase: 'discovery', sortOrder: 2,
      description: 'After approval, the team defines the project in detail.' },
    { key: 'team-alignment', name: 'Team Alignment & Communication',
      phase: 'alignment', sortOrder: 3,
      description: 'Secure cross-functional alignment and make the work visible.' },
    { key: 'ongoing-tracking', name: 'Ongoing Tracking & Updates',
      phase: 'ongoing', sortOrder: 4,
      description: 'Keep documentation current through the lifecycle.' },
  ].map((g) => ({ ...g, id: id() }))
  await db.insert(s.lifecycleGates).values(gateRows)
  const gate = (k: string) => gateRows.find((g) => g.key === k)!.id

  const itemSpecs: {
    gate: string
    key: string
    label: string
    ownerRole: string
    required?: boolean
    description: string
    templateUrl?: string
  }[] = [
    { gate: 'pre-approval', key: 'product-brief',
      label: 'Product Brief: Business Case & Value Proposition', ownerRole: 'Product',
      description: 'A living document, continuously updated as details are known. These details are essential for Go-To-Market strategy and external communications, and are needed in order to kick off GTM activities.',
      templateUrl: 'https://docs.google.com/document/d/1QHem3pDopaN-r9NvQIsFbBouviGH6Txt9pECRZ6iWHQ/edit?tab=t.a7w0rldxunpa#heading=h.dt9c4ue8fhyj' },
    { gate: 'pre-approval', key: 'quarterly-prioritization',
      label: 'Prioritization approved at Quarterly Planning', ownerRole: 'Program',
      description: "Align on and approve the project's priority during the Quarterly Planning Sessions.",
      templateUrl: 'https://docs.google.com/document/d/1AuIwResENfhlp1GL8dYu3tLax5BhKWUoZ7-5ffDEcBM/edit?tab=t.9enchglmy815#heading=h.6r4b45t8xpzj' },

    { gate: 'core-documentation', key: 'product-dev-charter',
      label: 'Product Dev Charter', ownerRole: 'Product',
      description: 'Defines project goals, iterations and the Architectural Flow. Initiated by Product but completed cross-functionally for alignment.',
      templateUrl: 'https://docs.google.com/document/d/1NZ2Eu5887AKe1FKHlEFsCIGcYilrMg1HuegfZIIB7cs/edit?tab=t.0#heading=h.5x0d5h95i329' },
    { gate: 'core-documentation', key: 'project-folder',
      label: 'Centralized project folder', ownerRole: 'Program',
      description: 'One folder holding every document related to the project.',
      templateUrl: 'https://drive.google.com/drive/folders/1NujCCdPIYbDS0Jk7WfUkb6cTg3lzdHHO' },
    { gate: 'core-documentation', key: 'jira-initiative',
      label: 'Jira Initiative created', ownerRole: 'Program',
      description: 'An Initiative in MediaRadar - Unified Platform Program (MUPP) tracking all associated work.',
      templateUrl: 'https://mediaradar.atlassian.net/jira/software/c/projects/MUPP/boards/83' },
    { gate: 'core-documentation', key: 'project-plan',
      label: 'Project plan / tracker started', ownerRole: 'Program',
      description: 'Drives the project and holds the team accountable to delivery.',
      templateUrl: 'https://docs.google.com/spreadsheets/d/1EpnrSGwmQlEPEy7Eg4s9nad2qmDBGDH_kJ-Jk8ozOcw/edit?gid=570899029#gid=570899029' },

    { gate: 'team-alignment', key: 'kickoff-meeting',
      label: 'Cross-functional kick-off held', ownerRole: 'Program',
      description: 'Review the charter, highlight goals, identify required delivery teams, confirm alignment.' },
    { gate: 'team-alignment', key: 'raci',
      label: 'Roles & responsibilities documented (RACI)', ownerRole: 'Program',
      description: 'Identify and document key owners, doers and stakeholders. Update the base template to the level of detail your project actually needs.',
      templateUrl: 'https://docs.google.com/spreadsheets/d/16MkKO-Buhi1TqhMrN2E4uxetYr_Fap_WNOf4gJ-iep4/edit?gid=800826233#gid=800826233' },
    { gate: 'team-alignment', key: 'meeting-cadence',
      label: 'Meeting cadence established', ownerRole: 'Program',
      description: 'A regular schedule for progress and alignment, with attendees and engagement model named.' },
    { gate: 'team-alignment', key: 'slack-channel',
      label: 'Slack channel created', ownerRole: 'Program',
      description: 'Team communication in the open. Link the folders and pages from the channel. If meetings happen offline with a smaller group, update the broader team in the channel.' },
    { gate: 'team-alignment', key: 'program-review-slide',
      label: 'Program Review slide added, with a named presenter', ownerRole: 'Program',
      description: 'Visibility at the program level. Determine ownership for updating AND presenting — an unowned slide goes stale.',
      templateUrl: 'https://docs.google.com/presentation/d/1I0Mkia2QH5K5xj7E1SR1BgRBiqjZC5HQzm_r-sN2xA4/edit#slide=id.g32633dada68_0_12' },

    { gate: 'ongoing-tracking', key: 'brief-current',
      label: 'Product Brief & Charter kept current', ownerRole: 'Product',
      description: 'Updated as more information is known.' },
    { gate: 'ongoing-tracking', key: 'early-transparency',
      label: 'Commercial, Product Marketing, Support and CS engaged early', ownerRole: 'Product',
      description: 'Bring them in as early as possible to ensure transparency.' },
    { gate: 'ongoing-tracking', key: 'retrospective',
      label: 'Retrospective held', ownerRole: 'Program', required: false,
      description: "'Inspect and adapt'. Retros let a team look back and change how it works.",
      templateUrl: 'https://docs.google.com/spreadsheets/d/1_y5TD4t_xaj0hoIdIpls-UktMmAT6quSuqFUAtH1Rto/edit?gid=730810162#gid=730810162' },
  ]

  const itemRows = itemSpecs.map((i, ix) => ({
    id: id(), gateId: gate(i.gate), key: i.key, label: i.label, description: i.description,
    templateUrl: i.templateUrl ?? null, ownerRole: i.ownerRole, required: i.required ?? true,
    sortOrder: ix,
  }))
  await db.insert(s.readinessItems).values(itemRows)

  // ---- template library --------------------------------------------------
  await db.insert(s.templates).values(
    [
      { key: 'project-tracker', name: 'Project Tracker', kind: 'sheet',
        url: 'https://docs.google.com/spreadsheets/d/1EpnrSGwmQlEPEy7Eg4s9nad2qmDBGDH_kJ-Jk8ozOcw/edit?gid=570899029#gid=570899029',
        description: 'Gantt-style project plan with key milestones and dates.' },
      { key: 'raci', name: 'RACI', kind: 'sheet',
        url: 'https://docs.google.com/spreadsheets/d/16MkKO-Buhi1TqhMrN2E4uxetYr_Fap_WNOf4gJ-iep4/edit?gid=800826233#gid=800826233',
        description: 'Clarity on roles and responsibilities at kick-off.' },
      { key: 'retrospectives', name: 'Retrospectives', kind: 'sheet',
        url: 'https://docs.google.com/spreadsheets/d/1_y5TD4t_xaj0hoIdIpls-UktMmAT6quSuqFUAtH1Rto/edit?gid=730810162#gid=730810162',
        description: 'Inspect and adapt — look back and change how the team works.' },
      { key: 'project-charter', name: 'Project Charter', kind: 'doc',
        url: 'https://docs.google.com/document/d/1NZ2Eu5887AKe1FKHlEFsCIGcYilrMg1HuegfZIIB7cs/edit?tab=t.0#heading=h.5x0d5h95i329',
        description: 'Filled out at the start of a project to align the cross-functional team.' },
      { key: 'product-brief', name: 'Product Brief', kind: 'doc',
        url: 'https://docs.google.com/document/d/1QHem3pDopaN-r9NvQIsFbBouviGH6Txt9pECRZ6iWHQ/edit?tab=t.a7w0rldxunpa#heading=h.dt9c4ue8fhyj',
        description: 'Business case and value proposition. A living document.' },
      { key: 'quarterly-planning', name: 'Quarterly Planning Framework', kind: 'doc',
        url: 'https://docs.google.com/document/d/1AuIwResENfhlp1GL8dYu3tLax5BhKWUoZ7-5ffDEcBM/edit?tab=t.9enchglmy815#heading=h.6r4b45t8xpzj',
        description: 'How project priority is agreed each quarter.' },
    ].map((t, ix) => ({ ...t, id: id(), sortOrder: ix })),
  )

  // ---- discovery question bank -------------------------------------------
  // Prompts, not fields. The value is forcing "how far back are we going for
  // history?" to be answered before a date is committed, rather than in month
  // three when the answer is expensive.
  const discovery: Record<string, string[]> = {
    ingestion: [
      'Auto-chafing and filtering rules',
      'Expected file type and frequency of receipt',
      'Expected metadata fields',
      'What quality checks run against a subset of the data',
      'Can we get sample data, and what can we reasonably use it for to progress',
      'What initial estimates can we gather on volumes',
      'What is needed from ML fingerprinting, MFS, cross-media deduplication',
      'What data structure do we want to present — what does the application need',
      'What do we need from Infrastructure to manage the new volumes and workflows',
      'Where should QA be involved to ease testing',
    ],
    spend_methodology: [
      'How will we enable the start of spend methodology — do we need classified sample data to build or analyze spend',
      'Do we have baselines or reference points from the marketplace to guide spend',
      'Who are the SMEs for the market and/or media type to review spend',
    ],
    classification: [
      'How will this be managed — manually, classification engine, automation',
      'How far back are we going for history, and are historicals a must for initial go-live',
      'How soon can we start enabling action against historicals',
      'Do we need to hire and train new people',
      'What would onboarding look like',
    ],
    user_experience: [
      'How will the data show up for clients',
      'Does our data feed work with current feature functionality',
      'Do we need any new feature functionality',
      'Do we need new media types set up',
      'Are we enabling any offline or custom deliverables',
      'What should be included in testing plans — incorporate data through the UI, full end-to-end',
    ],
    launch: [
      'What other launches does this need to watch out for or be combined with',
      'What is our support model, and when do we pull in Support in preparation for launch',
      'How will success be measured — product, process, iterations',
      'Who needs to be trained — C&D, commercial, sales, support',
      'Does this need in-depth UAT, and who will do it',
    ],
    gtm: [
      'How much time do we need for client outreach',
      'What visuals and data does Marketing need to prepare materials, and by when',
      'What marketing materials should be planned for',
      'Pricing',
      'CRM and contract set-up',
    ],
  }
  await db.insert(s.discoveryTopics).values(
    Object.entries(discovery).flatMap(([workstream, questions]) =>
      questions.map((question, ix) => ({ id: id(), workstream, question, sortOrder: ix })),
    ),
  )

  // ---- scoring model -----------------------------------------------------
  const modelId = id()
  await db.insert(s.scoringModels).values({
    id: modelId, key: 'default', name: 'Portfolio scoring',
    description:
      'A starting point, not a prescription. Effort is a cost criterion, so a cheap request with moderate value can outrank an expensive one with high value — which is the whole point of scoring rather than voting. Adjust the weights on the prioritization screen until the model ranks things the way the room actually would.',
    active: true, capacityUnits: null, capacityLabel: 'engineer-weeks',
  })
  const criteria = [
    { key: 'revenue', label: 'Revenue impact', weight: 3, direction: 'benefit', sortOrder: 1,
      helpText: 'Direct new or retained ARR. 1 = negligible, 5 = material to the number.' },
    { key: 'strategic', label: 'Strategic fit', weight: 2.5, direction: 'benefit', sortOrder: 2,
      helpText: 'How squarely this sits inside a board theme.' },
    { key: 'client', label: 'Client commitment', weight: 2, direction: 'benefit', sortOrder: 3,
      helpText: '5 = already promised to a named client with a date.' },
    { key: 'risk', label: 'Risk if we do nothing', weight: 2, direction: 'benefit', sortOrder: 4,
      helpText: 'Compliance exposure, churn risk, or a foundation that keeps rotting.' },
    { key: 'confidence', label: 'Confidence', weight: 1.5, direction: 'benefit', sortOrder: 5,
      helpText: 'How well we understand the problem and the solution.' },
    { key: 'effort', label: 'Effort', weight: 2.5, direction: 'cost', sortOrder: 6,
      helpText: 'Engineering weeks. Higher pushes the request down the list.' },
    { key: 'contention', label: 'Bottleneck contention', weight: 2, direction: 'cost', sortOrder: 7,
      helpText: 'Does it need a person who is already the single point on other work? 5 = only one named individual can do it.' },
  ].map((c) => ({ ...c, id: id(), modelId, scaleMin: 1, scaleMax: 5 }))
  await db.insert(s.scoringCriteria).values(criteria)


  console.log(
    `Process reference loaded: ${gateRows.length} lifecycle gates, ${itemRows.length} readiness ` +
      `items, templates and the discovery question bank, plus a starting scoring model.\n` +
      `No portfolio content was touched.`,
  )
  await warnIfServerRunning(embedded)
  await close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

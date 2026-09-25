/**
 * The portfolio's shared vocabulary.
 *
 * Every enumerated value in the schema is a plain text column; this file is the
 * single place those vocabularies are defined, validated and labelled. Adding a
 * status means editing one array here — not writing a migration.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const RAG = ['green', 'amber', 'red', 'unknown'] as const
export type Rag = (typeof RAG)[number]

export const CONFIDENCE = ['low', 'medium', 'high'] as const
export type Confidence = (typeof CONFIDENCE)[number]

export const INITIATIVE_STATUS = ['planned', 'active', 'paused', 'completed', 'canceled'] as const
export type InitiativeStatus = (typeof INITIATIVE_STATUS)[number]

export const PROJECT_STATUS = [
  'backlog',
  'planned',
  'in_progress',
  'paused',
  'completed',
  'canceled',
] as const
export type ProjectStatus = (typeof PROJECT_STATUS)[number]

/**
 * The states that mean the work is over.
 *
 * "Withdrawn" and "closed" are what people say out loud; canceled and
 * completed are what the database has always called them, and inventing a
 * second vocabulary for the same two states would mean explaining the
 * difference between "canceled" and "withdrawn" forever.
 *
 * Defined once because four screens and an agent all have to agree on it. The
 * day these two lists disagree, a project is hidden from the page and still
 * matched by Yaara, or the reverse — and either way somebody's work vanishes
 * from a list that claims to be complete.
 */
export const ENDED_PROJECT_STATUS = ['completed', 'canceled'] as const
export const ENDED_INITIATIVE_STATUS = ['completed', 'canceled'] as const

export function isEnded(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'canceled'
}

/** What reopening puts it back to: the earliest state that means "live". */
export function reopenedStatus(kind: 'project' | 'initiative'): string {
  return kind === 'project' ? 'planned' : 'active'
}

export const PRIORITY = ['urgent', 'high', 'medium', 'low', 'no_priority'] as const
export type Priority = (typeof PRIORITY)[number]

export const MILESTONE_STATUS = ['pending', 'done', 'missed', 'moved'] as const

export const DEPENDENCY_KIND = ['blocks', 'informs', 'shares_resource', 'related'] as const
export type DependencyKind = (typeof DEPENDENCY_KIND)[number]

export const DEPENDENCY_STATUS = ['open', 'at_risk', 'resolved', 'accepted_risk'] as const
export type DependencyStatus = (typeof DEPENDENCY_STATUS)[number]

export const CRITICALITY = ['normal', 'high', 'critical'] as const
export type Criticality = (typeof CRITICALITY)[number]

export const ALLOCATION_MODE = ['primary', 'borrowed', 'competing', 'frozen', 'undefined'] as const
export type AllocationMode = (typeof ALLOCATION_MODE)[number]

export const DECISION_STATUS = ['open', 'watch', 'decided', 'dropped'] as const
export type DecisionStatus = (typeof DECISION_STATUS)[number]

export const DECISION_CATEGORY = ['strategic', 'delivery', 'risk'] as const

/**
 * A register entry is either something somebody has to choose, or something
 * stopping somebody working. Same table, same page, different question.
 */
export const DECISION_KIND = ['decision', 'blocker'] as const
export type DecisionKind = (typeof DECISION_KIND)[number]

/** What happened to a register entry, and when. */
export const DECISION_EVENT_KIND = [
  'raised',
  'discussed',
  'updated',
  'resolved',
  'reopened',
] as const
export type DecisionEventKind = (typeof DECISION_EVENT_KIND)[number]

export const DOCUMENT_ORIGIN = ['google_drive', 'upload', 'slack'] as const

export const INTAKE_STATUS = [
  'new',
  'triage',
  'scoring',
  'ranked',
  'approved',
  'rejected',
  'deferred',
  'converted',
] as const
export type IntakeStatus = (typeof INTAKE_STATUS)[number]

export const TSHIRT = ['xs', 's', 'm', 'l', 'xl'] as const
export type Tshirt = (typeof TSHIRT)[number]

/** Rough engineer-weeks per t-shirt size, used for the capacity cut line. */
export const TSHIRT_WEEKS: Record<Tshirt, number> = { xs: 1, s: 3, m: 8, l: 20, xl: 45 }

export const ENTITY_TYPE = [
  'initiative',
  'project',
  'milestone',
  'app_area',
  'theme',
  'external',
] as const
export type EntityType = (typeof ENTITY_TYPE)[number]

export const SOURCE_SYSTEM = ['linear', 'sheets', 'jira', 'slack', 'manual'] as const
export type SourceSystem = (typeof SOURCE_SYSTEM)[number]

// ---------------------------------------------------------------------------
// Labels — the UI never hardcodes a human-readable string for these
// ---------------------------------------------------------------------------

export const LABELS = {
  briefItemKind: {
    decision: 'Decided',
    open_issue: 'Open issue',
    risk: 'Risk',
    change: 'Change',
  },
  sourceKind: {
    slack_channel: 'Slack channel',
    meeting_series: 'Meeting series',
    document: 'Document',
    // Code hosts. Same table on purpose: "which things out there are this
    // project" is one question, and answering it in two places is how the two
    // answers drift. Adding a host here is a vocabulary change, not a
    // migration — the column is text.
    github_repo: 'GitHub repository',
    azure_repo: 'Azure DevOps repository',
  },
  decisionKind: { decision: 'Decision', blocker: 'Blocker' },
  decisionEventKind: {
    raised: 'Raised',
    discussed: 'Discussed again',
    updated: 'Updated',
    resolved: 'Resolved',
    reopened: 'Reopened',
  },
  rag: { green: 'On track', amber: 'At risk', red: 'In trouble', unknown: 'Needs input' },
  projectStatus: {
    backlog: 'Backlog',
    planned: 'Planned',
    in_progress: 'In progress',
    paused: 'Paused',
    completed: 'Completed',
    canceled: 'Canceled',
  },
  initiativeStatus: {
    planned: 'Planned',
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    canceled: 'Canceled',
  },
  priority: {
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    no_priority: 'None',
  },
  allocationMode: {
    primary: 'Primary',
    borrowed: 'Borrowed',
    competing: 'Competes',
    frozen: 'Frozen',
    undefined: 'Undefined',
  },
  dependencyKind: {
    blocks: 'Blocks',
    informs: 'Informs',
    shares_resource: 'Shares people',
    related: 'Related',
  },
  dependencyStatus: {
    open: 'Open',
    at_risk: 'At risk',
    resolved: 'Resolved',
    accepted_risk: 'Accepted risk',
  },
  decisionStatus: { open: 'Open', watch: 'Watch / risk', decided: 'Decided', dropped: 'Dropped' },
  intakeStatus: {
    new: 'New',
    triage: 'Triage',
    scoring: 'Scoring',
    ranked: 'Ranked',
    approved: 'Approved',
    rejected: 'Rejected',
    deferred: 'Deferred',
    converted: 'Converted',
  },
  tshirt: { xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL' },
  sourceSystem: {
    linear: 'Linear',
    sheets: 'Sheets',
    jira: 'Jira',
    slack: 'Slack',
    manual: 'Manual',
  },
} as const

export function label<K extends keyof typeof LABELS>(
  group: K,
  key: string | null | undefined,
  fallback = '—',
): string {
  if (!key) return fallback
  return (LABELS[group] as Record<string, string>)[key] ?? key
}

/**
 * What a status is called, which depends on what the row is.
 *
 * One vocabulary in the database and two on screen. A blocker that has been
 * cleared is "Resolved"; calling it "Decided" is the kind of small wrongness
 * that makes people stop reading a page carefully.
 */
export function statusLabel(kind: string, status: string): string {
  if (kind === 'blocker' && status === 'decided') return 'Resolved'
  return label('decisionStatus', status)
}

// ---------------------------------------------------------------------------
// Health resolution — the rule the whole portfolio view depends on
// ---------------------------------------------------------------------------

export type HealthOrigin = 'assessed' | 'source' | 'none'

export interface ResolvedHealth {
  rag: Rag
  origin: HealthOrigin
  rationale?: string | null
  evidence?: string | null
  asOf?: Date | null
  confidence?: Confidence | null
  /** True when the source reports a health that disagrees with the assessment. */
  conflict: boolean
}

const SOURCE_HEALTH_TO_RAG: Record<string, Rag> = {
  onTrack: 'green',
  on_track: 'green',
  atRisk: 'amber',
  at_risk: 'amber',
  offTrack: 'red',
  off_track: 'red',
}

/**
 * A human assessment always wins over the tracker's health field.
 *
 * This is not a stylistic preference. Trackers leave health unset far more
 * often than they set it honestly, so "no assessment and no source value"
 * must read as `unknown` — an explicit request for input — rather than
 * silently as green. A portfolio that shows green for "nobody has looked" is
 * worse than no portfolio at all.
 */
export function resolveHealth(input: {
  sourceHealth?: string | null
  assessment?: {
    rag: string
    rationale?: string | null
    evidence?: string | null
    asOf?: Date | string | null
    confidence?: string | null
  } | null
}): ResolvedHealth {
  const sourceRag = input.sourceHealth ? SOURCE_HEALTH_TO_RAG[input.sourceHealth] : undefined

  if (input.assessment) {
    const rag = (RAG as readonly string[]).includes(input.assessment.rag)
      ? (input.assessment.rag as Rag)
      : 'unknown'
    return {
      rag,
      origin: 'assessed',
      rationale: input.assessment.rationale,
      evidence: input.assessment.evidence,
      asOf: input.assessment.asOf ? new Date(input.assessment.asOf) : null,
      confidence: (input.assessment.confidence as Confidence) ?? 'medium',
      conflict: Boolean(sourceRag && sourceRag !== rag),
    }
  }

  if (sourceRag) return { rag: sourceRag, origin: 'source', conflict: false }
  return { rag: 'unknown', origin: 'none', conflict: false }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface CriterionInput {
  id: string
  key: string
  weight: number
  direction: string
  scaleMin: number
  scaleMax: number
}

/**
 * Weighted score, normalised to 0..100.
 *
 * Benefit criteria contribute `weight * normalised`. Cost criteria contribute
 * `weight * (1 - normalised)`, so "effort: 5" pushes a request down without
 * needing a separate divide step that makes the arithmetic hard to argue with
 * in a room. Unscored criteria are excluded from both numerator and
 * denominator, so a half-scored request is not silently penalised — it is
 * reported as partially scored instead.
 */
export function computeScore(
  criteria: CriterionInput[],
  values: Record<string, number | undefined>,
): { score: number | null; scored: number; total: number } {
  let num = 0
  let den = 0
  let scored = 0

  for (const c of criteria) {
    const raw = values[c.id]
    if (raw === undefined || raw === null || Number.isNaN(raw)) continue
    scored += 1
    const span = c.scaleMax - c.scaleMin || 1
    const norm = Math.min(1, Math.max(0, (raw - c.scaleMin) / span))
    const contribution = c.direction === 'cost' ? 1 - norm : norm
    num += c.weight * contribution
    den += c.weight
  }

  return { score: den ? Math.round((num / den) * 1000) / 10 : null, scored, total: criteria.length }
}

// ---------------------------------------------------------------------------
// Validation schemas used by the API routes
// ---------------------------------------------------------------------------

const optionalDate = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v) => (v === undefined || v === null || v === '' ? null : new Date(v)))

export const assessmentInput = z.object({
  entityType: z.enum(ENTITY_TYPE),
  entityId: z.string().min(1),
  rag: z.enum(RAG),
  confidence: z.enum(CONFIDENCE).default('medium'),
  rationale: z.string().min(1, 'An assessment without a rationale is just a colour.'),
  evidence: z.string().optional().nullable(),
  asOf: optionalDate,
  assessorId: z.string().optional().nullable(),
})

export const overrideInput = z.object({
  entityType: z.enum(ENTITY_TYPE),
  entityId: z.string().min(1),
  field: z.string().min(1),
  value: z.unknown(),
  reason: z.string().optional().nullable(),
  pinned: z.boolean().default(false),
  authorId: z.string().optional().nullable(),
})

export const dependencyInput = z.object({
  fromType: z.enum(ENTITY_TYPE),
  fromId: z.string().min(1),
  fromLabel: z.string().optional().nullable(),
  toType: z.enum(ENTITY_TYPE),
  toId: z.string().min(1),
  toLabel: z.string().optional().nullable(),
  kind: z.enum(DEPENDENCY_KIND).default('blocks'),
  status: z.enum(DEPENDENCY_STATUS).default('open'),
  criticality: z.enum(CRITICALITY).default('normal'),
  description: z.string().optional().nullable(),
  dueDate: optionalDate,
  ownerId: z.string().optional().nullable(),
})

export const intakeInput = z.object({
  title: z.string().min(3),
  problem: z.string().min(10, 'Describe the problem in a sentence or two.'),
  outcome: z.string().optional().nullable(),
  requesterName: z.string().min(1),
  requesterEmail: z.string().email().optional().or(z.literal('')).nullable(),
  sponsor: z.string().optional().nullable(),
  stakeholders: z.string().optional().nullable(),
  themeId: z.string().optional().nullable(),
  appAreaId: z.string().optional().nullable(),
  proposedInitiativeId: z.string().optional().nullable(),
  desiredDate: optionalDate,
  hardDate: z.boolean().default(false),
  hardDateReason: z.string().optional().nullable(),
  tshirt: z.enum(TSHIRT).optional().nullable(),
  businessCase: z.string().optional().nullable(),
  source: z.enum(['web', 'slack', 'sheets', 'email']).default('web'),
})

export const decisionInput = z.object({
  ref: z.string().optional(),
  kind: z.enum(DECISION_KIND).default('decision'),
  category: z.enum(DECISION_CATEGORY).default('delivery'),
  title: z.string().min(3),
  body: z.string().min(1),
  status: z.enum(DECISION_STATUS).default('open'),
  contested: z.boolean().default(false),
  ownerId: z.string().optional().nullable(),
  ownerText: z.string().optional().nullable(),
  raisedById: z.string().optional().nullable(),
  raisedByText: z.string().optional().nullable(),
  dueBy: z.string().optional().nullable(),
  nextAction: z.string().optional().nullable(),
  evidence: z.string().optional().nullable(),
  history: z.string().optional().nullable(),
  leadVisible: z.boolean().default(true),
  entityType: z.enum(ENTITY_TYPE).optional().nullable(),
  entityId: z.string().optional().nullable(),
})

export const allocationInput = z.object({
  teamId: z.string().min(1),
  initiativeId: z.string().min(1),
  mode: z.enum(ALLOCATION_MODE),
  note: z.string().optional().nullable(),
  share: z.number().min(0).max(1).optional().nullable(),
})

// ---------------------------------------------------------------------------
// Conversation sources and briefs
// ---------------------------------------------------------------------------

export const SOURCE_KIND = [
  'slack_channel',
  'meeting_series',
  'document',
  'github_repo',
  'azure_repo',
] as const
export type SourceKind = (typeof SOURCE_KIND)[number]

/**
 * The kinds that are a code repository.
 *
 * Grouped because the agent asks "which repos belong to this?" rather than
 * "which GitHub repos", and because the answer should not change shape the day
 * a team moves between hosts.
 *
 * Bitbucket was here and is gone: it is not used going forward, and a kind
 * nobody can select is a menu entry that only ever produces support questions.
 * The column is text, so removing it needs no migration.
 */
export const REPO_SOURCE_KIND = ['github_repo', 'azure_repo'] as const
export function isRepoKind(kind: string): boolean {
  return (REPO_SOURCE_KIND as readonly string[]).includes(kind)
}

export const TRANSCRIPT_KIND = ['slack', 'meeting', 'document'] as const
export type TranscriptKind = (typeof TRANSCRIPT_KIND)[number]

/**
 * The only categories a bullet may have.
 *
 * Deliberately short and deliberately about consequence. A summary that is
 * free to say anything says "the team discussed the timeline", which is a
 * sentence with no reader. These four force the model to answer the questions
 * a portfolio review actually asks.
 */
export const BRIEF_ITEM_KIND = ['decision', 'open_issue', 'risk', 'change'] as const
export type BriefItemKind = (typeof BRIEF_ITEM_KIND)[number]

export interface BriefItem {
  kind: BriefItemKind
  text: string
  /** Transcript ids this bullet was drawn from. Never empty. */
  sourceTranscriptIds: string[]
}

export const conversationSourceInput = z.object({
  kind: z.enum(SOURCE_KIND),
  entityType: z.enum(ENTITY_TYPE),
  entityId: z.string().min(1),
  label: z.string().min(1).max(120),
  externalId: z.string().max(200).optional().nullable(),
  url: z.string().max(500).optional().nullable(),
  ingestEnabled: z.boolean().default(false),
  notes: z.string().max(1000).optional().nullable(),
})

export const transcriptInput = z.object({
  entityType: z.enum(ENTITY_TYPE),
  entityId: z.string().min(1),
  kind: z.enum(TRANSCRIPT_KIND),
  title: z.string().min(1).max(200),
  occurredAt: optionalDate,
  url: z.string().max(500).optional().nullable(),
  body: z.string().min(20, 'Too short to summarise usefully.'),
  sourceId: z.string().optional().nullable(),
})

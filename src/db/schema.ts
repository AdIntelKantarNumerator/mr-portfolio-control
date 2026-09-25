/**
 * Portfolio Control Room — database schema (PostgreSQL dialect).
 *
 * The prototype runs this against PGlite (embedded Postgres, no install); the
 * deployed version runs the identical DDL against a real Postgres. There is no
 * dialect switch and no second schema: `DATABASE_URL` decides which driver
 * connects, and nothing in this file changes.
 *
 * Enumerated values are plain `text` columns validated in `src/lib/domain.ts`
 * rather than Postgres enums, because adding a value to a Postgres enum needs a
 * migration and these vocabularies (health, allocation mode, request status)
 * get edited by the program team, not by engineers.
 */
import { randomUUID } from 'node:crypto'
import { relations } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID())

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

// ---------------------------------------------------------------------------
// Org
// ---------------------------------------------------------------------------

export const teams = pgTable('teams', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  /** delivery | program | shared_pool | vendor */
  kind: text('kind').notNull().default('delivery'),
  notes: text('notes'),
  /** Headcount, when anyone has actually counted. Optional on purpose. */
  headcount: doublePrecision('headcount'),
  archived: boolean('archived').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const people = pgTable(
  'people',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').unique(),
    /** Free text: "Data Platform lead", "Program", "Dev — sole 360". */
    role: text('role'),
    teamId: text('team_id').references(() => teams.id, { onDelete: 'set null' }),
    active: boolean('active').notNull().default(true),
    /**
     * Hand-set single-point-of-failure flag. The people view also computes a
     * load count from actual assignments; this lets a human override it when
     * the count understates reality.
     */
    bottleneck: boolean('bottleneck').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('people_team_idx').on(t.teamId)],
)

// ---------------------------------------------------------------------------
// Two independent taxonomies over the same work
// ---------------------------------------------------------------------------

/** The executive narrative spine — e.g. Coverage / Experiences / Table stakes. */
export const themes = pgTable('themes', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  /** Hex, drives the theme card header. */
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** The application axis — how delivery owners think about the same work. */
export const appAreas = pgTable('app_areas', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  /** Free text so it can be filled in before Person records exist. */
  owner: text('owner'),
  devs: text('devs'),
  /** e.g. "All 360 work is frozen except Ratings". */
  note: text('note'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------

export const initiatives = pgTable(
  'initiatives',
  {
    id: id(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),

    // --- source-owned (written by sync, overridden via field_overrides) ---
    /** planned | active | paused | completed | canceled */
    status: text('status').notNull().default('planned'),
    startDate: timestamp('start_date', { withTimezone: true }),
    targetDate: timestamp('target_date', { withTimezone: true }),
    /** Whatever the source reports. Frequently empty — see `assessments`. */
    sourceHealth: text('source_health'),

    ownerId: text('owner_id').references(() => people.id, { onDelete: 'set null' }),
    sponsorId: text('sponsor_id').references(() => people.id, { onDelete: 'set null' }),
    themeId: text('theme_id').references(() => themes.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),

    /** Nobody owns this yet — drives the "needs owner" gap flag. */
    ownerGap: boolean('owner_gap').notNull().default(false),
    notes: text('notes'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('initiatives_theme_idx').on(t.themeId), index('initiatives_owner_idx').on(t.ownerId)],
)

export const projects = pgTable(
  'projects',
  {
    id: id(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),

    // --- source-owned ---
    /** backlog | planned | in_progress | paused | completed | canceled */
    status: text('status').notNull().default('backlog'),
    /** no_priority | urgent | high | medium | low */
    priority: text('priority'),
    /** 0..1 */
    progress: doublePrecision('progress').notNull().default(0),
    startDate: timestamp('start_date', { withTimezone: true }),
    targetDate: timestamp('target_date', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** onTrack | atRisk | offTrack — usually null in practice. */
    sourceHealth: text('source_health'),

    initiativeId: text('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
    appAreaId: text('app_area_id').references(() => appAreas.id, { onDelete: 'set null' }),
    leadId: text('lead_id').references(() => people.id, { onDelete: 'set null' }),
    teamId: text('team_id').references(() => teams.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('projects_initiative_idx').on(t.initiativeId),
    index('projects_app_area_idx').on(t.appAreaId),
    index('projects_lead_idx').on(t.leadId),
    index('projects_team_idx').on(t.teamId),
  ],
)

export const milestones = pgTable(
  'milestones',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    targetDate: timestamp('target_date', { withTimezone: true }),
    actualDate: timestamp('actual_date', { withTimezone: true }),
    /** pending | done | missed | moved */
    status: text('status').notNull().default('pending'),
    /** The date is contested or externally committed — renders red. */
    contested: boolean('contested').notNull().default(false),
    /** Lift onto the portfolio-level calendar strip. */
    portfolioLevel: boolean('portfolio_level').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('milestones_project_idx').on(t.projectId), index('milestones_target_idx').on(t.targetDate)],
)

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Endpoints are (type, id) pairs rather than foreign keys so a dependency can
 * point at something outside the portfolio — a vendor data feed, another org's
 * deliverable — using `fromLabel` / `toLabel` with type `external`. Those
 * external endpoints are usually the ones that actually slip.
 */
export const dependencies = pgTable(
  'dependencies',
  {
    id: id(),
    /** initiative | project | milestone | external */
    fromType: text('from_type').notNull(),
    fromId: text('from_id').notNull(),
    toType: text('to_type').notNull(),
    toId: text('to_id').notNull(),
    fromLabel: text('from_label'),
    toLabel: text('to_label'),

    /** blocks | informs | shares_resource | related */
    kind: text('kind').notNull().default('blocks'),
    /** open | at_risk | resolved | accepted_risk */
    status: text('status').notNull().default('open'),
    /** normal | high | critical */
    criticality: text('criticality').notNull().default('normal'),
    description: text('description'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    ownerId: text('owner_id').references(() => people.id, { onDelete: 'set null' }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('dependencies_from_idx').on(t.fromType, t.fromId),
    index('dependencies_to_idx').on(t.toType, t.toId),
    index('dependencies_status_idx').on(t.status),
  ],
)

// ---------------------------------------------------------------------------
// The assessment layer — what the program manager knows that the tracker doesn't
// ---------------------------------------------------------------------------

/**
 * A dated, sourced, human judgement of health, kept deliberately separate from
 * `sourceHealth`. Trackers leave health empty or stale far more often than they
 * fill it honestly, and a portfolio view that silently blends the two teaches
 * people to distrust the whole screen.
 */
export const assessments = pgTable(
  'assessments',
  {
    id: id(),
    /** initiative | project | milestone | app_area | theme */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),

    /** green | amber | red | unknown */
    rag: text('rag').notNull(),
    /** low | medium | high */
    confidence: text('confidence').notNull().default('medium'),
    rationale: text('rationale').notNull(),
    /** Where the judgement came from, e.g. a named meeting or review document. */
    evidence: text('evidence'),
    asOf: timestamp('as_of', { withTimezone: true }).notNull().defaultNow(),
    assessorId: text('assessor_id').references(() => people.id, { onDelete: 'set null' }),

    /**
     * Who wrote this: 'human' or an agent name such as 'yaara'.
     *
     * The app's whole claim is that what it says can be checked, and a
     * machine-written judgement that looks like a person's breaks that claim
     * silently. So the writer is recorded at the point of writing, every read
     * carries it, and the UI says so. Defaulting to 'human' is correct for
     * every row that existed before agents did.
     */
    authoredBy: text('authored_by').notNull().default('human'),
    /** Set when a person has read a machine-written assessment and stands behind it. */
    reviewedBy: text('reviewed_by').references(() => people.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    /** Superseded assessments are kept, not deleted — the history is the point. */
    current: boolean('current').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('assessments_entity_idx').on(t.entityType, t.entityId, t.current)],
)

/**
 * A manual value that wins over the synced value for one field.
 *
 * This is the mechanism that makes "read from Linear AND type things in here"
 * safe: sync writes source columns, humans write overrides, and every read
 * merges the two. Without it the next sync silently eats the correction and
 * people stop trusting their own edits.
 */
export const fieldOverrides = pgTable(
  'field_overrides',
  {
    id: id(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    field: text('field').notNull(),
    /** JSON-encoded so any scalar shape round-trips unambiguously. */
    value: text('value').notNull(),
    reason: text('reason'),
    authorId: text('author_id').references(() => people.id, { onDelete: 'set null' }),
    /**
     * Pinned overrides survive a change at the source (a board-locked date).
     * Unpinned ones yield when the source value itself changes, implementing
     * "most recent dated source wins, pinned facts override recency".
     */
    pinned: boolean('pinned').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('field_overrides_unique').on(t.entityType, t.entityId, t.field),
    index('field_overrides_entity_idx').on(t.entityType, t.entityId),
  ],
)

export const statusUpdates = pgTable(
  'status_updates',
  {
    id: id(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    body: text('body').notNull(),
    rag: text('rag'),
    weekOf: timestamp('week_of', { withTimezone: true }),
    authorId: text('author_id').references(() => people.id, { onDelete: 'set null' }),
    /** manual | linear | slack | sheets */
    source: text('source').notNull().default('manual'),
    createdAt: createdAt(),
  },
  (t) => [index('status_updates_entity_idx').on(t.entityType, t.entityId)],
)

/**
 * The open-questions register. In a program review this is usually the highest
 * value screen on the wall, and no upstream tool holds it — it lives in
 * meeting notes until someone builds it somewhere.
 */
export const decisions = pgTable(
  'decisions',
  {
    id: id(),
    /** Human-facing handle used in conversation: "D1", "G4", "S2", "B3". */
    ref: text('ref').notNull().unique(),
    /**
     * decision | blocker
     *
     * One table rather than two, because they are the same object seen from
     * different ends: both are open, owned, attached to a piece of work, and
     * both close. Splitting them would have meant two pages, two queries and
     * two answers to "what is stuck", which is the one question this screen
     * exists to answer.
     *
     * What a blocker has that a decision does not is who RAISED it — a
     * decision's interesting party is whoever owes the answer, a blocker's is
     * whoever hit the wall. Hence the fields below rather than a second table.
     */
    kind: text('kind').notNull().default('decision'),
    /** strategic | delivery | risk */
    category: text('category').notNull().default('delivery'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** open | watch | decided | dropped */
    status: text('status').notNull().default('open'),
    /** Two named parties actively disagree — worth flagging on its own. */
    contested: boolean('contested').notNull().default(false),
    /** Who owes the resolution. Unset is a real and common answer. */
    ownerId: text('owner_id').references(() => people.id, { onDelete: 'set null' }),
    /** For owners who aren't Person records (execs, vendors, "Rick / SLT"). */
    ownerText: text('owner_text'),
    /**
     * Who raised it. Separate from the owner on purpose: the person who hits a
     * wall is usually not the person who can clear it, and conflating them is
     * how a blocker ends up assigned to whoever happened to mention it.
     */
    raisedById: text('raised_by_id').references(() => people.id, { onDelete: 'set null' }),
    raisedByText: text('raised_by_text'),
    /** Free text on purpose: "Next Leads", "~7/10", "This week". */
    dueBy: text('due_by'),
    nextAction: text('next_action'),
    evidence: text('evidence'),

    // When and where it was raised, and when and where it was resolved.
    //
    // Denormalised from `decisionEvents` so the register can be sorted and
    // filtered on them without a join, and so the answer survives the event
    // rows being pruned. The event log is the record; these are the handles.
    raisedAt: timestamp('raised_at', { withTimezone: true }),
    /** The meeting or document title, kept as text so it outlives the source row. */
    raisedAtMeeting: text('raised_at_meeting'),
    raisedDocumentId: text('raised_document_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedAtMeeting: text('resolved_at_meeting'),
    resolvedDocumentId: text('resolved_document_id'),
    /**
     * Who closed it. Set when a person closes it on the page — the signed-in
     * user, not a name they typed, because the one thing worth being certain
     * of about a closure is who is standing behind it.
     *
     * Null when it was closed from a document: there the closure belongs to
     * the meeting, and `resolvedAtMeeting` is the answer.
     */
    resolvedById: text('resolved_by_id').references(() => people.id, { onDelete: 'set null' }),

    /**
     * The story so far, in prose.
     *
     * The same blocker comes up in three weekly meetings, and the useful record
     * is one live item rather than three near-identical rows. The events below
     * are the audit trail; this is the paragraph a person actually reads.
     */
    history: text('history'),

    /**
     * Who wrote this. Null means a person typed it.
     *
     * An agent-written row says so on the screen, in the same way an agent
     * assessment does. A register nobody can tell apart from a machine's
     * reading of a transcript is a register nobody should act on.
     */
    authoredBy: text('authored_by'),
    reviewedBy: text('reviewed_by').references(() => people.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    /** Include in the leadership-level view as well as the full view. */
    leadVisible: boolean('lead_visible').notNull().default(true),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('decisions_status_idx').on(t.status),
    index('decisions_kind_idx').on(t.kind),
    index('decisions_entity_idx').on(t.entityType, t.entityId),
  ],
)

/**
 * A document somebody shared, and the one thing worth keeping about it here:
 * that it exists, what it was called, and when.
 *
 * Deliberately NOT the text. `transcripts` holds bodies for conversations a
 * person explicitly attached and is the most sensitive table in this database;
 * this one records documents an agent read in passing, and copying every
 * meeting transcript into the portfolio to support a date on a blocker would
 * be a much larger privacy decision than the feature needs. The body stays in
 * Drive, where its sharing already governs who can read it, and every record
 * here links back to it.
 */
export const sourceDocuments = pgTable(
  'source_documents',
  {
    id: id(),
    /** google_drive | upload | slack */
    origin: text('origin').notNull().default('google_drive'),
    /** The Drive file id. Unique, so re-reading a document does not duplicate it. */
    externalId: text('external_id').notNull(),
    /** The meeting name, with Meet's " - Transcript" suffix already stripped. */
    title: text('title').notNull(),
    url: text('url'),
    /** When the meeting happened, not when it was read. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    /**
     * The document's own modified time when it was last read.
     *
     * An edited document is new information; the same document read twice is
     * not. Comparing this is what stops every pass re-extracting everything.
     */
    revision: text('revision'),
    readAt: timestamp('read_at', { withTimezone: true }),
    readBy: text('read_by'),
    /**
     * What was found in this document and deliberately NOT recorded, and why.
     *
     * Almost always: something was decided or blocked, but the document never
     * names a piece of work this portfolio tracks, so filing it anywhere would
     * have been a guess. Dropping it silently makes "I put a blocker in that
     * meeting and it never appeared" unanswerable, which is how people stop
     * believing the register covers what they think it covers.
     */
    notRecorded: text('not_recorded'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('source_documents_external_unique').on(t.origin, t.externalId)],
)

/**
 * Every time a decision or blocker was raised, discussed, or resolved.
 *
 * This is what makes "when did this first come up, and how long were we stuck
 * on it" answerable. One row per mention rather than one row per blocker,
 * because merging mentions into a single item is what keeps the register
 * readable and losing them is what makes it unaccountable.
 *
 * `meeting` is denormalised text rather than only a document id: the answer to
 * "which meeting was that raised at" must survive the document being deleted,
 * unshared, or never having been a document at all.
 */
export const decisionEvents = pgTable(
  'decision_events',
  {
    id: id(),
    decisionId: text('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    /** raised | discussed | updated | resolved | reopened */
    kind: text('kind').notNull(),
    /** When it was said, not when it was recorded. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    /** The meeting or document it was said in. */
    meeting: text('meeting'),
    documentId: text('document_id').references(() => sourceDocuments.id, { onDelete: 'set null' }),
    url: text('url'),
    /** Who said it, as named in the document. Free text: this is not a roster. */
    actor: text('actor'),
    /** What was said, in a sentence or two. The citation for everything above. */
    note: text('note'),
    recordedBy: text('recorded_by'),
    createdAt: createdAt(),
  },
  (t) => [index('decision_events_decision_idx').on(t.decisionId)],
)

/**
 * What else is being talked about.
 *
 * Decisions and blockers are the things somebody has to act on; a great deal of
 * what gets discussed is neither, and disappears entirely once the document
 * scrolls out of the window an agent reads. One rolling row per theme per
 * entity keeps it: the summary is rewritten as it develops rather than appended
 * to forever, and the counters say whether it is a recurring drumbeat or was
 * mentioned once in March.
 */
export const entityThemes = pgTable(
  'entity_themes',
  {
    id: id(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** A short label: "vendor contract", "on-call load", "schema migration". */
    theme: text('theme').notNull(),
    /** Rewritten as it develops, not appended to. */
    summary: text('summary').notNull(),
    mentions: integer('mentions').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** The most recent meeting it came up in, for "where did you get that". */
    lastMeeting: text('last_meeting'),
    lastDocumentId: text('last_document_id').references(() => sourceDocuments.id, {
      onDelete: 'set null',
    }),
    authoredBy: text('authored_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('entity_themes_entity_idx').on(t.entityType, t.entityId),
    uniqueIndex('entity_themes_unique').on(t.entityType, t.entityId, t.theme),
  ],
)

// ---------------------------------------------------------------------------
// Contention — who competes for whom
// ---------------------------------------------------------------------------

export const allocations = pgTable(
  'allocations',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    initiativeId: text('initiative_id')
      .notNull()
      .references(() => initiatives.id, { onDelete: 'cascade' }),
    /** primary | borrowed | competing | frozen | undefined */
    mode: text('mode').notNull().default('primary'),
    note: text('note'),
    /** Rough share of the team, 0..1, when anyone has actually sized it. */
    share: doublePrecision('share'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('allocations_unique').on(t.teamId, t.initiativeId)],
)

// ---------------------------------------------------------------------------
// Intake and prioritization
// ---------------------------------------------------------------------------

export const intakeRequests = pgTable(
  'intake_requests',
  {
    id: id(),
    ref: text('ref').notNull().unique(),
    title: text('title').notNull(),
    problem: text('problem').notNull(),
    outcome: text('outcome'),

    requesterName: text('requester_name').notNull(),
    requesterEmail: text('requester_email'),
    sponsor: text('sponsor'),
    stakeholders: text('stakeholders'),

    themeId: text('theme_id').references(() => themes.id, { onDelete: 'set null' }),
    appAreaId: text('app_area_id').references(() => appAreas.id, { onDelete: 'set null' }),
    /** Where the requester thinks it belongs; the program team can re-route. */
    proposedInitiativeId: text('proposed_initiative_id').references(() => initiatives.id, {
      onDelete: 'set null',
    }),

    desiredDate: timestamp('desired_date', { withTimezone: true }),
    hardDate: boolean('hard_date').notNull().default(false),
    /** A hard date without a reason is a preference wearing a costume. */
    hardDateReason: text('hard_date_reason'),
    /** xs | s | m | l | xl */
    tshirt: text('tshirt'),
    businessCase: text('business_case'),

    /** new | triage | scoring | ranked | approved | rejected | deferred | converted */
    status: text('status').notNull().default('new'),
    decisionNote: text('decision_note'),
    convertedProjectId: text('converted_project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),

    /** web | slack | sheets | email */
    source: text('source').notNull().default('web'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('intake_status_idx').on(t.status)],
)

export const scoringModels = pgTable('scoring_models', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(false),
  /** Capacity available this cycle — drives the cut line on the ranked list. */
  capacityUnits: doublePrecision('capacity_units'),
  capacityLabel: text('capacity_label').default('engineer-weeks'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const scoringCriteria = pgTable(
  'scoring_criteria',
  {
    id: id(),
    modelId: text('model_id')
      .notNull()
      .references(() => scoringModels.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    helpText: text('help_text'),
    weight: doublePrecision('weight').notNull().default(1),
    /** benefit = higher is better; cost = higher is worse (divides the score). */
    direction: text('direction').notNull().default('benefit'),
    scaleMin: doublePrecision('scale_min').notNull().default(1),
    scaleMax: doublePrecision('scale_max').notNull().default(5),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('scoring_criteria_unique').on(t.modelId, t.key)],
)

export const scores = pgTable(
  'scores',
  {
    id: id(),
    modelId: text('model_id')
      .notNull()
      .references(() => scoringModels.id, { onDelete: 'cascade' }),
    criterionId: text('criterion_id')
      .notNull()
      .references(() => scoringCriteria.id, { onDelete: 'cascade' }),
    requestId: text('request_id')
      .notNull()
      .references(() => intakeRequests.id, { onDelete: 'cascade' }),
    value: doublePrecision('value').notNull(),
    note: text('note'),
    scorerId: text('scorer_id').references(() => people.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('scores_unique').on(t.criterionId, t.requestId, t.scorerId),
    index('scores_request_idx').on(t.requestId),
  ],
)

// ---------------------------------------------------------------------------
// Provenance and sync
// ---------------------------------------------------------------------------

/**
 * One row per (external system, external id) mapped onto a local record.
 * Keeping provenance out of the entity tables means a single project can be
 * backed by a Linear project AND a row in a Google Sheet without either source
 * needing a special column.
 */
export const sourceRecords = pgTable(
  'source_records',
  {
    id: id(),
    /** linear | sheets | jira | slack | manual */
    system: text('system').notNull(),
    externalId: text('external_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    url: text('url'),
    /** JSON-encoded raw payload from the last sync, for diffing and debugging. */
    raw: text('raw'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('source_records_unique').on(t.system, t.externalId),
    index('source_records_entity_idx').on(t.entityType, t.entityId),
  ],
)

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: id(),
    system: text('system').notNull(),
    /** manual | schedule | webhook */
    trigger: text('trigger').notNull().default('manual'),
    /** running | success | partial | failed */
    status: text('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** JSON-encoded counters: {"projects":{"created":2,"updated":11}} */
    stats: text('stats'),
    error: text('error'),
    /** High-water mark handed to the next incremental sync. */
    cursor: timestamp('cursor', { withTimezone: true }),
  },
  (t) => [index('sync_runs_system_idx').on(t.system, t.startedAt)],
)

/**
 * Append-only "what changed" log. Every sync and every meaningful hand edit
 * writes here, because in a program review the delta is the story — people
 * want to know what moved since the last time they looked, not the current
 * state they can already see.
 */
export const changelogEntries = pgTable(
  'changelog_entries',
  {
    id: id(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** "system", "linear-webhook", or a person's name. */
    actor: text('actor').notNull().default('system'),
    /** change | sync | note | decision */
    kind: text('kind').notNull().default('change'),
    summary: text('summary').notNull(),
    detail: text('detail'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
  },
  (t) => [index('changelog_at_idx').on(t.at)],
)

// ---------------------------------------------------------------------------
// Lifecycle gates — the documented kick-off process, made checkable
// ---------------------------------------------------------------------------

/**
 * A phase of the documented project lifecycle (pre-approval, core
 * documentation, team alignment, ongoing). Kept as data rather than a
 * hard-coded list so the program team can change its own process without a
 * deploy — which is the difference between a process the tool enforces and a
 * process the tool merely documented once.
 */
export const lifecycleGates = pgTable('lifecycle_gates', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  /** pre_approval | discovery | alignment | ongoing */
  phase: text('phase').notNull().default('discovery'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
})

/** One checkable obligation inside a gate, usually with a template behind it. */
export const readinessItems = pgTable(
  'readiness_items',
  {
    id: id(),
    gateId: text('gate_id')
      .notNull()
      .references(() => lifecycleGates.id, { onDelete: 'cascade' }),
    key: text('key').notNull().unique(),
    label: text('label').notNull(),
    description: text('description'),
    /** Link to the canonical template or system this item is satisfied in. */
    templateUrl: text('template_url'),
    /** Who is accountable by default: Product, Program, Engineering, GTM. */
    ownerRole: text('owner_role'),
    /** Optional items still appear, but do not count against readiness. */
    required: boolean('required').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('readiness_items_gate_idx').on(t.gateId)],
)

export const projectReadiness = pgTable(
  'project_readiness',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => readinessItems.id, { onDelete: 'cascade' }),
    /** not_started | in_progress | done | na */
    status: text('status').notNull().default('not_started'),
    /** Where the completed artifact actually lives for THIS project. */
    link: text('link'),
    note: text('note'),
    updatedById: text('updated_by_id').references(() => people.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('project_readiness_unique').on(t.projectId, t.itemId),
    index('project_readiness_project_idx').on(t.projectId),
  ],
)

/**
 * The discovery question bank from the generic data project flow.
 *
 * These are prompts, not fields: the value is in making a team answer "how far
 * back are we going for history?" before committing to a date, rather than
 * discovering the answer in month three.
 */
export const discoveryTopics = pgTable(
  'discovery_topics',
  {
    id: id(),
    /** ingestion | spend_methodology | classification | user_experience | launch | gtm */
    workstream: text('workstream').notNull(),
    question: text('question').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('discovery_topics_workstream_idx').on(t.workstream)],
)

/** The standard template library, so links live in one place. */
export const templates = pgTable('templates', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  url: text('url').notNull(),
  /** doc | sheet | slides | board | folder */
  kind: text('kind').notNull().default('doc'),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const lifecycleGatesRelations = relations(lifecycleGates, ({ many }) => ({
  items: many(readinessItems),
}))

export const readinessItemsRelations = relations(readinessItems, ({ one, many }) => ({
  gate: one(lifecycleGates, { fields: [readinessItems.gateId], references: [lifecycleGates.id] }),
  progress: many(projectReadiness),
}))

export const projectReadinessRelations = relations(projectReadiness, ({ one }) => ({
  project: one(projects, { fields: [projectReadiness.projectId], references: [projects.id] }),
  item: one(readinessItems, { fields: [projectReadiness.itemId], references: [readinessItems.id] }),
}))

/** Settings a human can edit in the UI without a redeploy. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
})

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(people),
  projects: many(projects),
  allocations: many(allocations),
}))

export const peopleRelations = relations(people, ({ one, many }) => ({
  team: one(teams, { fields: [people.teamId], references: [teams.id] }),
  ledProjects: many(projects),
}))

export const themesRelations = relations(themes, ({ many }) => ({
  initiatives: many(initiatives),
}))

export const appAreasRelations = relations(appAreas, ({ many }) => ({
  projects: many(projects),
}))

export const initiativesRelations = relations(initiatives, ({ one, many }) => ({
  owner: one(people, { fields: [initiatives.ownerId], references: [people.id], relationName: 'owner' }),
  sponsor: one(people, {
    fields: [initiatives.sponsorId],
    references: [people.id],
    relationName: 'sponsor',
  }),
  theme: one(themes, { fields: [initiatives.themeId], references: [themes.id] }),
  projects: many(projects),
  allocations: many(allocations),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  initiative: one(initiatives, { fields: [projects.initiativeId], references: [initiatives.id] }),
  appArea: one(appAreas, { fields: [projects.appAreaId], references: [appAreas.id] }),
  lead: one(people, { fields: [projects.leadId], references: [people.id] }),
  team: one(teams, { fields: [projects.teamId], references: [teams.id] }),
  milestones: many(milestones),
}))

export const milestonesRelations = relations(milestones, ({ one }) => ({
  project: one(projects, { fields: [milestones.projectId], references: [projects.id] }),
}))

export const allocationsRelations = relations(allocations, ({ one }) => ({
  team: one(teams, { fields: [allocations.teamId], references: [teams.id] }),
  initiative: one(initiatives, { fields: [allocations.initiativeId], references: [initiatives.id] }),
}))

export const intakeRequestsRelations = relations(intakeRequests, ({ one, many }) => ({
  theme: one(themes, { fields: [intakeRequests.themeId], references: [themes.id] }),
  appArea: one(appAreas, { fields: [intakeRequests.appAreaId], references: [appAreas.id] }),
  proposedInitiative: one(initiatives, {
    fields: [intakeRequests.proposedInitiativeId],
    references: [initiatives.id],
  }),
  convertedProject: one(projects, {
    fields: [intakeRequests.convertedProjectId],
    references: [projects.id],
  }),
  scores: many(scores),
}))

export const scoringModelsRelations = relations(scoringModels, ({ many }) => ({
  criteria: many(scoringCriteria),
  scores: many(scores),
}))

export const scoringCriteriaRelations = relations(scoringCriteria, ({ one, many }) => ({
  model: one(scoringModels, { fields: [scoringCriteria.modelId], references: [scoringModels.id] }),
  scores: many(scores),
}))

export const scoresRelations = relations(scores, ({ one }) => ({
  model: one(scoringModels, { fields: [scores.modelId], references: [scoringModels.id] }),
  criterion: one(scoringCriteria, { fields: [scores.criterionId], references: [scoringCriteria.id] }),
  request: one(intakeRequests, { fields: [scores.requestId], references: [intakeRequests.id] }),
  scorer: one(people, { fields: [scores.scorerId], references: [people.id] }),
}))

export const assessmentsRelations = relations(assessments, ({ one }) => ({
  assessor: one(people, { fields: [assessments.assessorId], references: [people.id] }),
}))

export const decisionsRelations = relations(decisions, ({ one, many }) => ({
  owner: one(people, { fields: [decisions.ownerId], references: [people.id] }),
  raisedBy: one(people, { fields: [decisions.raisedById], references: [people.id] }),
  events: many(decisionEvents),
}))

export const decisionEventsRelations = relations(decisionEvents, ({ one }) => ({
  decision: one(decisions, { fields: [decisionEvents.decisionId], references: [decisions.id] }),
  document: one(sourceDocuments, {
    fields: [decisionEvents.documentId],
    references: [sourceDocuments.id],
  }),
}))

export const entityThemesRelations = relations(entityThemes, ({ one }) => ({
  lastDocument: one(sourceDocuments, {
    fields: [entityThemes.lastDocumentId],
    references: [sourceDocuments.id],
  }),
}))

export const dependenciesRelations = relations(dependencies, ({ one }) => ({
  owner: one(people, { fields: [dependencies.ownerId], references: [people.id] }),
}))

// ---------------------------------------------------------------------------
// Conversation sources, transcripts and briefs
//
// A third layer alongside the tracker sync and human assessment: what was said.
// It is kept deliberately separate from both, because a summary is neither a
// fact from a system of record nor a judgement someone is accountable for —
// it is a machine's reading of a conversation, and the screens say so.
// ---------------------------------------------------------------------------

/**
 * A conversation source someone has deliberately attached to an initiative or
 * project: a Slack channel, a recurring meeting, or a one-off document.
 *
 * Nothing is ingested until a person creates one of these AND turns
 * `ingestEnabled` on. Off by default is the whole point: a transcript can carry
 * compensation, performance and legal content, and this app is readable by
 * anyone with a company account.
 */
export const conversationSources = pgTable(
  'conversation_sources',
  {
    id: id(),
    /** slack_channel | meeting_series | document */
    kind: text('kind').notNull(),
    /** What it is attached to. */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** Human label: "#360-migration", "Weekly delivery review". */
    label: text('label').notNull(),
    /**
     * The handle the adapter uses. For Slack, the channel id (C…). For a
     * meeting series, the Google Calendar event id — NOT the meet.google.com
     * link, which identifies a room and grants nothing.
     */
    externalId: text('external_id'),
    /** The URL a person would click to see the original. */
    url: text('url'),
    /** Explicit opt-in. Nothing is fetched or summarised while this is false. */
    ingestEnabled: boolean('ingest_enabled').notNull().default(false),
    /** Who attached it, and who therefore owns that decision. */
    addedBy: text('added_by'),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    lastIngestedAt: timestamp('last_ingested_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('conversation_sources_entity_idx').on(t.entityType, t.entityId),
    uniqueIndex('conversation_sources_external_unique').on(t.kind, t.externalId),
  ],
)

/**
 * One ingested conversation: a meeting transcript, a window of channel
 * messages, or an uploaded document.
 *
 * The full text is kept because a bullet without its source is a rumour. It is
 * also the reason this table is the most sensitive one in the database.
 */
export const transcripts = pgTable(
  'transcripts',
  {
    id: id(),
    sourceId: text('source_id').references(() => conversationSources.id, {
      onDelete: 'set null',
    }),
    /** Denormalised so an upload with no standing source still attaches. */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** slack | meeting | document */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** When the conversation happened, not when it was ingested. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    url: text('url'),
    body: text('body').notNull(),
    /** Hash of the body, so the same transcript is never ingested twice. */
    fingerprint: text('fingerprint').notNull(),
    ingestedBy: text('ingested_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('transcripts_entity_idx').on(t.entityType, t.entityId),
    uniqueIndex('transcripts_fingerprint_unique').on(t.fingerprint),
  ],
)

/**
 * A generated brief for one entity: a handful of bullets, each carrying the
 * transcript ids it came from.
 *
 * Briefs are never edited in place. A new one supersedes the last, so what the
 * page showed last Tuesday is still recoverable — which matters the first time
 * someone disputes a bullet.
 */
export const briefs = pgTable(
  'briefs',
  {
    id: id(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** JSON: [{ kind, text, sourceTranscriptIds: [] }] */
    items: text('items').notNull(),
    /** Which model produced it, so an odd bullet can be traced to a change. */
    model: text('model').notNull(),
    /** How many transcripts went in, for the "based on" line. */
    transcriptCount: integer('transcript_count').notNull().default(0),
    /** Newest covered conversation, so staleness is about the source not the run. */
    coversThrough: timestamp('covers_through', { withTimezone: true }),
    generatedBy: text('generated_by'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('briefs_entity_idx').on(t.entityType, t.entityId)],
)

export const conversationSourcesRelations = relations(conversationSources, ({ many }) => ({
  transcripts: many(transcripts),
}))

export const transcriptsRelations = relations(transcripts, ({ one }) => ({
  source: one(conversationSources, {
    fields: [transcripts.sourceId],
    references: [conversationSources.id],
  }),
}))

/**
 * What an agent observed, and what it read to observe it.
 *
 * Kept apart from `briefs` on purpose. A brief summarises conversations a
 * person chose to attach; this is an agent's continuous reading of Linear,
 * GitHub, Slack and meeting notes, with two audiences and a wider vocabulary of
 * kinds. Merging them would mean one table where half the rows have meanings
 * the other half cannot express.
 *
 * `evidence` is the row's reason for existing. A bullet cites evidence ids, and
 * those ids resolve against this JSON — so a claim made by a machine three
 * weeks ago still points at what it was reading, even though the agent keeps no
 * database of its own.
 */
export const agentObservations = pgTable(
  'agent_observations',
  {
    id: id(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** Which agent. There is exactly one today; there will not always be. */
    agent: text('agent').notNull().default('yaara'),

    /** JSON: [{ kind, audience, text, citations: [evidenceId] }] */
    items: text('items').notNull(),
    /** JSON: [{ id, source, title, url, occurredAt }] — what the bullets cite. */
    evidence: text('evidence').notNull(),

    /**
     * JSON: [{ text, at, source }] — what actually HAPPENED lately, as
     * distinct from `items`, which is what it means.
     *
     * The bullets above are an assessment: "delivery is slipping because the
     * loader is blocked". These are the events underneath: "PR #412 merged",
     * "Priya raised the SMTP blocker on Tuesday". A front page asking "what is
     * moving" wants the second, and deriving it from the first is guessing at
     * a summary's inputs from its output.
     */
    recent: text('recent'),

    /**
     * How much happened, and over what window.
     *
     * Counted, not judged. "How active is this" is a number of things that
     * occurred in a period, and asking a model to score it would produce an
     * opinion where arithmetic was available. The window widens when a quiet
     * piece of work has nothing in the last day, so the front page can say
     * "nothing for nine days" instead of showing an empty card.
     */
    activityScore: doublePrecision('activity_score'),
    activityWindowHours: integer('activity_window_hours'),

    /** The model, and which provider served it — the residency answer, recorded. */
    model: text('model').notNull(),
    servedBy: text('served_by'),

    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Only the newest observation per entity is shown; the rest are history. */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('agent_observations_entity_idx').on(t.entityType, t.entityId, t.supersededAt)],
)

/**
 * Every date this system has ever seen for a thing, as it saw it.
 *
 * "What did we originally commit to, and where is it now?" is unanswerable
 * unless somebody wrote the first answer down. Nothing did. Sync overwrites
 * `target_date` in place, so the day a date moves, the old one stops existing
 * — and no amount of later cleverness reconstructs it.
 *
 * So this is append-only and deliberately dumb: one row each time an observed
 * date differs from the last one recorded for that field. The earliest row is
 * the original commitment, the latest is where it stands, and the rows between
 * are the movement — which is usually the more interesting story, because three
 * small slips read very differently from one big one.
 *
 * Cheap to keep: a project whose date never moves has exactly one row forever.
 */
export const dateObservations = pgTable(
  'date_observations',
  {
    id: id(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** target_date | start_date — which date moved. */
    field: text('field').notNull(),
    /** Null is a real observation: a date was removed. */
    value: timestamp('value', { withTimezone: true }),
    /** linear | manual | agent — who noticed. */
    source: text('source').notNull().default('linear'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('date_observations_entity_idx').on(t.entityType, t.entityId, t.field, t.observedAt)],
)

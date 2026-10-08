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
  primaryKey,
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

    /**
     * The objective this initiative rolls up to, if any.
     *
     * Nullable and expected to be null sometimes: an initiative with no objective
     * is a reportable state the home page names, not a gap to be filled.
     */
    objectiveId: text('objective_id').references(() => objectives.id, { onDelete: 'set null' }),

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

    /**
     * The three names on a program review slide: Owner, Dev, Program.
     *
     * Owner is `leadId`, which is a real Person. These two are free text
     * because what the deck actually carries is "Scott & Sadiya" and "Spencer"
     * — a pairing and a first name, neither of which a foreign key models
     * without inventing precision nobody asked for.
     */
    devLead: text('dev_lead'),
    programLead: text('program_lead'),

    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('projects_objective_idx').on(t.initiativeId),
    index('projects_app_area_idx').on(t.appAreaId),
    index('projects_lead_idx').on(t.leadId),
    index('projects_team_idx').on(t.teamId),
  ],
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
    /** objective | initiative | milestone | external */
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
    /** objective | initiative | milestone | app_area | theme */
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
    // Following it through (migration 0027, lib/importance.ts, lib/item-activity.ts).
    /** JSON array of the factor keys Yaara tagged it with. */
    importanceFactors: text('importance_factors'),
    /** JSON [{factor, why, quote, source, url}]: the "why is this important" popup. */
    importanceReasons: text('importance_reasons'),
    /** 0-100, from the factors, the mentions and the adjustment. Null until scored. */
    importanceScore: integer('importance_score'),
    /** What people added or took away by hand, kept apart so a re-score does not undo it. */
    importanceAdjust: integer('importance_adjust').notNull().default(0),
    /** How many places it has been raised or referred to. */
    mentions: integer('mentions').notNull().default(1),
    /**
     * The last real update: evidence, a reply, a status change, an edit, a
     * score change. Not a nudge, and not the first automatic score. Open and
     * untouched for seven days is "inactive".
     */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    /** When its owner was last reminded. Not activity. */
    nudgedAt: timestamp('nudged_at', { withTimezone: true }),
    /** The ref of the item this was a duplicate of, when it was merged. */
    mergedInto: text('merged_into'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('decisions_status_idx').on(t.status),
    index('decisions_kind_idx').on(t.kind),
    index('decisions_entity_idx').on(t.entityType, t.entityId),
  ],
)

// ---------------------------------------------------------------------------
// Program review — the plan as people present it
//
// Everything above is what systems know: what a tracker holds, what an agent
// read, what somebody assessed. This is different. It is the plan as a team
// states it to a room every other week — objectives, what is done and what is
// next, and when each version lands.
//
// It lives here because it was living in a slide deck, which meant the only
// copy of "what are we actually trying to do on this initiative" was a file
// somebody rebuilt by hand every fortnight. Moving it here does not remove the
// deck; it makes the deck a rendering of something that can also be read,
// queried, and kept current between meetings.
// ---------------------------------------------------------------------------

/**
 * One row of a program review table: an objective and where it has got to.
 *
 * An initiative has a handful. "Logo Rec Tech", "Sports Dashboard MVP", "Data
 * Updates" are milestones of the Sports initiative — each with its own status
 * and its own date, which is exactly why an initiative's single RAG cannot say
 * what the deck says.
 */
/**
 * An objective — a grouping of initiatives, and the level leadership reads.
 *
 * Deliberately few: five to ten active is the working rule, because the home
 * page shows one card each and twenty cards is a list rather than a summary.
 * Nothing enforces the number; the page makes exceeding it feel wrong.
 *
 * An initiative belongs to one objective or none. "None" is a real and reportable
 * state, not a gap — some work genuinely does not sit under a programme, and
 * the home page names those rather than hiding them.
 */
export const objectives = pgTable('objectives', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  /** active | paused | completed | canceled */
  status: text('status').notNull().default('active'),
  ownerId: text('owner_id').references(() => people.id, { onDelete: 'set null' }),
  startDate: timestamp('start_date', { withTimezone: true }),
  targetDate: timestamp('target_date', { withTimezone: true }),
  sortOrder: integer('sort_order').notNull().default(0),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * A commitment somebody made out loud, usually in a meeting.
 *
 * Distinct from a blocker (something in the way) and a decision (something
 * settled): an action item is a person, a thing and a date. Yaara reads them
 * out of meeting notes and summarises each to one line, because "Priya to
 * circle back on the backfill window question raised earlier" is three words
 * of content in eighteen.
 */
export const actionItems = pgTable(
  'action_items',
  {
    id: id(),
    /** A1, A2 — human-quotable, like the register's refs. */
    ref: text('ref'),
    text: text('text').notNull(),
    ownerId: text('owner_id').references(() => people.id, { onDelete: 'set null' }),
    /** The name as the note gave it, when it matches nobody in the portfolio. */
    ownerName: text('owner_name'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    /** open | done | dropped */
    status: text('status').notNull().default('open'),
    /** meeting | slack | document */
    sourceKind: text('source_kind'),
    sourceTitle: text('source_title'),
    sourceUrl: text('source_url'),
    raisedAt: timestamp('raised_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    authoredBy: text('authored_by'),
    // Following it through (migration 0027, lib/importance.ts, lib/item-activity.ts).
    /** JSON array of the factor keys Yaara tagged it with. */
    importanceFactors: text('importance_factors'),
    /** JSON [{factor, why, quote, source, url}]: the "why is this important" popup. */
    importanceReasons: text('importance_reasons'),
    /** 0-100, from the factors, the mentions and the adjustment. Null until scored. */
    importanceScore: integer('importance_score'),
    /** What people added or took away by hand, kept apart so a re-score does not undo it. */
    importanceAdjust: integer('importance_adjust').notNull().default(0),
    /** How many places it has been raised or referred to. */
    mentions: integer('mentions').notNull().default(1),
    /**
     * The last real update: evidence, a reply, a status change, an edit, a
     * score change. Not a nudge, and not the first automatic score. Open and
     * untouched for seven days is "inactive".
     */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    /** When its owner was last reminded. Not activity. */
    nudgedAt: timestamp('nudged_at', { withTimezone: true }),
    /** The ref of the item this was a duplicate of, when it was merged. */
    mergedInto: text('merged_into'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('action_items_status_idx').on(t.status, t.dueDate)],
)

/**
 * An action item's history: raised, updated, done, merged, re-owned,
 * re-scored, nudged. Blockers and decisions have had decision_events all
 * along; action items had only Activity, so "what has happened on this" had no
 * answer on the item itself (migration 0027).
 */
export const actionItemEvents = pgTable(
  'action_item_events',
  {
    id: id(),
    actionItemId: text('action_item_id')
      .notNull()
      .references(() => actionItems.id, { onDelete: 'cascade' }),
    /** raised | updated | changed | done | dropped | reopened | merged | owner | importance | nudged */
    kind: text('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor'),
    note: text('note'),
    sourceTitle: text('source_title'),
    sourceUrl: text('source_url'),
    recordedBy: text('recorded_by'),
    /** JSON [{field, from, to}]: what this entry changed. See lib/item-changes.ts. */
    changes: text('changes'),
    createdAt: createdAt(),
  },
  (t) => [index('action_item_events_item_idx').on(t.actionItemId)],
)

/**
 * What an action item is about — at every level it is about.
 *
 * Its own table rather than a column, because one commitment routinely matters
 * to a project, the initiative above it and the objective above that, and
 * forcing a single choice makes it disappear from two of the three places
 * somebody would look. No rows at all is meaningful: an action nobody could
 * place is something to show a person, not something to drop.
 */
export const actionItemLinks = pgTable(
  'action_item_links',
  {
    id: id(),
    actionItemId: text('action_item_id')
      .notNull()
      .references(() => actionItems.id, { onDelete: 'cascade' }),
    /** objective | initiative | project */
    level: text('level').notNull(),
    entityId: text('entity_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('action_item_links_unique').on(t.actionItemId, t.level, t.entityId),
    index('action_item_links_entity_idx').on(t.level, t.entityId),
  ],
)

export const milestones = pgTable(
  'milestones',
  {
    id: id(),
    /**
     * objective | initiative | project.
     *
     * One table for all three levels, because a milestone is the same thing
     * at each — a named, dated deliverable somebody is accountable for. Three
     * tables would mean three copies of the status vocabulary, the items and
     * the calendar bands, drifting apart within a month.
     */
    level: text('level').notNull().default('project'),
    /** The objective, initiative or project this hangs off. */
    entityId: text('entity_id').notNull(),
    /** The Objective column: "Logo Rec Tech", "Hybrid Capture w/ Automation". */
    name: text('name').notNull(),
    /** The Details column: one sentence on what it actually is. */
    details: text('details'),
    /** planning | on_track | at_risk | blocked | complete — the deck's legend. */
    status: text('status').notNull().default('planning'),
    /**
     * Free text, and deliberately: the deck says "9/30", "Q3/Q4", "Jan 2027"
     * and "TBD/Sep". Forcing those into a date column would either lose the
     * meaning or invent a precision the team does not have.
     */
    targetLabel: text('target_label'),
    /** The Key Dependencies column, where a slide has one. */
    dependencies: text('dependencies'),

    /**
     * A real date alongside the label, because they answer different
     * questions: the label is what the room reads off a slide ("Q3/Q4"), the
     * date is what a timeline sorts by and a health assessment counts days
     * against. Neither is derivable from the other.
     */
    targetDate: timestamp('target_date', { withTimezone: true }),
    actualDate: timestamp('actual_date', { withTimezone: true }),
    /** The date is contested or externally committed — renders red. */
    contested: boolean('contested').notNull().default(false),

    sortOrder: integer('sort_order').notNull().default(0),
    /** Set when an agent read this off a deck rather than a person typing it. */
    authoredBy: text('authored_by'),

    /**
     * What the agent changed here since a person last touched it, and why.
     * One line per judgement call. Printed on the slide beside the row it
     * changed, so nobody is surprised by their own status in a meeting.
     * Cleared when a person edits the row.
     */
    agentNote: text('agent_note'),
    agentNoteAt: timestamp('agent_note_at', { withTimezone: true }),

    /**
     * Who last edited this by hand, and which fields they set.
     *
     * Linear and the deck reader write the whole row on every run. That is
     * right until somebody corrects a date here — then the correction lives
     * until the next sync and silently reverts, and the person concludes the
     * app does not save.
     *
     * `editedFields` is a comma-separated list of column names. A sync skips
     * exactly those and keeps updating the rest, so correcting a date does
     * not also freeze the name. See MILESTONE_FIELDS and mergeFromSource in
     * lib/milestones.ts, which is the only place the rule is written down.
     */
    editedBy: text('edited_by'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    editedFields: text('edited_fields'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('milestones_entity_idx').on(t.level, t.entityId)],
)

/**
 * The bullets under a Status Update, and which of the three lists they are in.
 *
 * Completed / In Progress / To Do is the structure every one of these slides
 * uses, and it is the part most worth keeping current between meetings: it is
 * the only place that says what is happening RIGHT NOW rather than what was
 * planned.
 */
export const milestoneItems = pgTable(
  'milestone_items',
  {
    id: id(),
    milestoneId: text('milestone_id')
      .notNull()
      .references(() => milestones.id, { onDelete: 'cascade' }),
    /** completed | in_progress | to_do */
    state: text('state').notNull().default('in_progress'),
    text: text('text').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** An agent may propose these from what it observed; a person confirms. */
    authoredBy: text('authored_by'),
    createdAt: createdAt(),
  },
  (t) => [index('milestone_items_idx').on(t.milestoneId)],
)

/**
 * A band on the release calendar: this project is in this phase, from this
 * month to that one.
 *
 * Months as 'YYYY-MM' strings rather than dates, because a band is a statement
 * about calendar months and a timestamp would imply a day nobody chose. The
 * label is kept separately from the phase: their decks say "Development",
 * "Development/Release", "Primary Capture" and "Secondary Capture" in the same
 * column, and only some of those are phases.
 */
export const milestonePhases = pgTable(
  'milestone_phases',
  {
    id: id(),
    milestoneId: text('milestone_id')
      .notNull()
      .references(() => milestones.id, { onDelete: 'cascade' }),
    /** discovery | development | testing | uat | alpha_beta | ga | release | tbd */
    phase: text('phase').notNull().default('development'),
    /** What the band actually reads, when it is not just the phase name. */
    label: text('label'),
    /** 'YYYY-MM', inclusive at both ends. */
    fromPeriod: text('from_period').notNull(),
    toPeriod: text('to_period').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('milestone_phases_idx').on(t.milestoneId)],
)

/**
 * No relation to a parent here, deliberately: a milestone points at an
 * objective, an initiative or a project through (level, entityId), and Drizzle
 * cannot express a foreign key that changes table by row. Callers join on the
 * level themselves — see milestonesFor() in lib/portfolio.
 */
export const milestonesRelations = relations(milestones, ({ many }) => ({
  items: many(milestoneItems),
  phases: many(milestonePhases),
}))

export const milestoneItemsRelations = relations(milestoneItems, ({ one }) => ({
  project: one(milestones, {
    fields: [milestoneItems.milestoneId],
    references: [milestones.id],
  }),
}))

export const milestonePhasesRelations = relations(milestonePhases, ({ one }) => ({
  project: one(milestones, {
    fields: [milestonePhases.milestoneId],
    references: [milestones.id],
  }),
}))

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
    /** raised | discussed | updated | changed | resolved | reopened */
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
    /** JSON [{field, from, to}]: what this entry changed. See lib/item-changes.ts. */
    changes: text('changes'),
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
    /**
     * Who corrected this by hand, and which fields they touched.
     *
     * A topic is attached to a piece of work by guessing from the text, and
     * some of those guesses are wrong. An edit records who fixed it — so a
     * reader knows the line has a person behind it rather than a document —
     * and which fields, so the next sync leaves those alone instead of
     * rewriting the correction. Comma-separated, like milestones.editedFields.
     */
    editedBy: text('edited_by'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    editedFields: text('edited_fields'),
    /**
     * Settled, as far as anybody knows. Hidden from the Discussions page by
     * default, never deleted. A mention dated after this clears it and sets
     * `reopenedAt`: something that comes up again was not settled. See
     * drizzle/0020_theme_resolved.sql.
     */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
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
 * Keeping provenance out of the entity tables means a single initiative can be
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
 * A phase of the documented initiative lifecycle (pre-approval, core
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
    /** Where the completed artifact actually lives for THIS initiative. */
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
 * The discovery question bank from the generic data initiative flow.
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
    project: text('project').notNull(),
    question: text('question').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('discovery_topics_project_idx').on(t.project)],
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
  ledInitiatives: many(projects),
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
  objective: one(initiatives, { fields: [projects.initiativeId], references: [initiatives.id] }),
  appArea: one(appAreas, { fields: [projects.appAreaId], references: [appAreas.id] }),
  lead: one(people, { fields: [projects.leadId], references: [people.id] }),
  team: one(teams, { fields: [projects.teamId], references: [teams.id] }),
  milestones: many(milestones),
}))

export const allocationsRelations = relations(allocations, ({ one }) => ({
  team: one(teams, { fields: [allocations.teamId], references: [teams.id] }),
  objective: one(initiatives, { fields: [allocations.initiativeId], references: [initiatives.id] }),
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
 * A conversation source someone has deliberately attached to an objective or
 * initiative: a Slack channel, a recurring meeting, or a one-off document.
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

    /**
     * The one sentence the home page leads with.
     *
     * Held here rather than derived from `items`, because a person can edit
     * it. The moment somebody rewrites it, it stops being a summary of her
     * bullets and becomes their statement — so `verdictBy` carries whoever
     * last wrote it, and the card shows that name instead of hers.
     */
    verdict: text('verdict'),
    verdictBy: text('verdict_by'),
    verdictAt: timestamp('verdict_at', { withTimezone: true }),

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
 * Cheap to keep: an initiative whose date never moves has exactly one row forever.
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

/**
 * Yaara proposing which initiatives belong together.
 *
 * The grouping tier is the only one with no source outside this app, so
 * somebody has to decide it. She can read what the work actually is — shared
 * people, shared repos, the same names appearing in the same meetings — and
 * say "these five look like one thing". That is a proposal, and it stays a
 * proposal: accepting it creates the objective and moves the initiatives,
 * dismissing it records that the answer was no, and a dismissed suggestion is
 * not offered again.
 *
 * `initiativeIds` is a comma-separated list. Reading it whole is the only access
 * pattern, and this schema has no jsonb anywhere for portability reasons that
 * apply here too.
 */
export const groupingSuggestions = pgTable(
  'grouping_suggestions',
  {
    id: id(),
    /** What she would call the objective. A person can rename it on accept. */
    name: text('name').notNull(),
    rationale: text('rationale'),
    /** Comma-separated initiative ids. */
    initiativeIds: text('initiative_ids').notNull(),
    agent: text('agent').notNull().default('yaara'),
    model: text('model'),
    /** What she read to think so, as a JSON array of {source,title,url}. */
    evidence: text('evidence'),
    /** pending | accepted | dismissed */
    status: text('status').notNull().default('pending'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Set on accept, so the suggestion points at what it became. */
    objectiveId: text('objective_id'),
    createdAt: createdAt(),
  },
  (t) => [index('grouping_suggestions_status_idx').on(t.status, t.createdAt)],
)

/**
 * How one reader has arranged the home board, under the Custom sort.
 *
 * A view preference, not a portfolio fact. The three tables all carry a
 * `sortOrder` column and this deliberately does not write it: that column
 * means "the order these read in" for everybody, and an arrangement one
 * person dragged for their own Monday is not that.
 *
 * `orderedIds` is comma-separated, read whole and written whole. See
 * drizzle/0015_card_order.sql for why the list lives in one row rather than
 * one row per card, and why nothing here references `people.id`.
 */
/**
 * No longer read or written, since 2 October 2026: the board order is shared
 * again, in each entity's sort_order (app/order-actions.ts). Migration 0025
 * copied the newest arrangement at each level from here into sort_order.
 * Kept rather than dropped, so nobody's saved arrangement is destroyed by a
 * deploy.
 */
export const cardOrders = pgTable(
  'card_orders',
  {
    /** `people.id`, or 'local' when auth is switched off for development. */
    personId: text('person_id').notNull(),
    /** objective | initiative | project. Each board is arranged separately. */
    level: text('level').notNull(),
    /** Comma-separated entity ids, first to last. */
    orderedIds: text('ordered_ids').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ name: 'card_orders_person_level_pk', columns: [t.personId, t.level] })],
)

/**
 * Somebody saying an update is on the wrong piece of work.
 *
 * Yaara's third way of attributing evidence — the entity's name appeared in
 * the text — is a guess, and a wrong guess used to be permanent: the next pass
 * made it again and there was nowhere to say otherwise. A row here is one
 * correction, which she reads and turns into a standing routing rule.
 *
 * `source`, `location` and `author` are copied in rather than referenced
 * because they are what the rule will match on and the evidence row they came
 * from is replaced every pass. See drizzle/0016_routing_corrections.sql for
 * that, and for why a null destination is a real answer rather than a missing
 * one.
 */
export const routingCorrections = pgTable(
  'routing_corrections',
  {
    id: id(),
    /** Where it was wrongly attached. */
    wrongEntityType: text('wrong_entity_type').notNull(),
    wrongEntityId: text('wrong_entity_id').notNull(),
    /** Where it belongs. Both null together means "nothing". */
    rightEntityType: text('right_entity_type'),
    rightEntityId: text('right_entity_id'),
    /** The coordinates a rule matches on: which system, where in it, who. */
    source: text('source').notNull(),
    location: text('location'),
    author: text('author'),
    /** What prompted it. Not a foreign key — the observation is replaced hourly. */
    evidenceId: text('evidence_id'),
    evidenceTitle: text('evidence_title'),
    note: text('note'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    /** When Yaara turned it into a rule, and which rule she made. */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ruleId: text('rule_id'),
  },
  (t) => [index('routing_corrections_pending_idx').on(t.consumedAt, t.createdAt)],
)

// ---------------------------------------------------------------------------
// Reference: Workflow Assessment — the component and workflow map
// ---------------------------------------------------------------------------

/**
 * The columns of the grouped view: Collect, Ingest, Classify and so on, plus
 * the lanes people work in.
 *
 * Keyed by a readable slug rather than a uuid because the seed, the tests and
 * a person reading the database all refer to groups by name.
 *
 * Where a group sits left to right is NOT stored. It is computed from the
 * links between the components inside it (lib/workflow-map.ts), because a
 * stored column position is wrong the first time somebody adds a connection,
 * and nobody remembers to fix it.
 */
export const workflowGroups = pgTable('workflow_groups', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  /** software | human */
  kind: text('kind').notNull().default('software'),
  /** Order within a column when two groups land in the same one. */
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * One box on the map: a piece of software, a human workflow, or a rule set
 * somebody owns.
 *
 * `description` is the field that matters most and the one most likely to be
 * left empty. It is what the assessment chat will match a request against — a
 * component nobody described is a component no question will ever land on —
 * so the page shows a missing description as a gap, not as blank space.
 */
export const workflowComponents = pgTable(
  'workflow_components',
  {
    id: id(),
    name: text('name').notNull(),
    /** software | human | rule */
    kind: text('kind').notNull().default('software'),
    groupKey: text('group_key')
      .notNull()
      .references(() => workflowGroups.key, { onUpdate: 'cascade' }),
    /** Free text, like app_areas.owner: a team or a person, before either has a row. */
    owner: text('owner'),
    /** What it handles, in a few sentences. */
    description: text('description'),
    /** The one-line detail under the name: the rules it enforces, the tables it owns. */
    detail: text('detail'),
    /** Comma-separated words people use for it. Matched as well as the name. */
    aliases: text('aliases'),
    /** True when the box is a ClickHouse database or table rather than a service. */
    isData: boolean('is_data').notNull().default(false),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('workflow_components_group_idx').on(t.groupKey)],
)

/**
 * One arrow: `from` feeds `to`.
 *
 * Direction is the whole meaning. A change to `from` can reach `to`; a change
 * to `to` cannot reach `from`. The impact walk follows these and nothing else,
 * so a link drawn the wrong way round is a wrong answer, not a cosmetic one.
 */
export const workflowLinks = pgTable(
  'workflow_links',
  {
    id: id(),
    fromId: text('from_id')
      .notNull()
      .references(() => workflowComponents.id, { onDelete: 'cascade' }),
    toId: text('to_id')
      .notNull()
      .references(() => workflowComponents.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdBy: text('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('workflow_links_pair_unique').on(t.fromId, t.toId)],
)

/**
 * One question asked of the map, and the answer it got.
 *
 * Kept, not thrown away, for two reasons. People come back to an answer — "what
 * did it say about the automotive rules?" — and the next person asking much
 * the same thing should see it. And an answer is only as good as the map was
 * when it was given: `relied` records exactly which components (with their
 * edit time) and which connections the answer stood on, so the page can say
 * "the map has changed since this answer" and name what changed, instead of
 * leaving an old answer looking current.
 */
export const workflowAssessments = pgTable(
  'workflow_assessments',
  {
    id: id(),
    question: text('question').notNull(),
    askedBy: text('asked_by'),
    askedAt: timestamp('asked_at', { withTimezone: true }).notNull().defaultNow(),
    /** model | keywords — whether a language model matched and explained, or the keyword fallback did. */
    method: text('method').notNull(),
    /** The model that answered, when one did. */
    model: text('model'),
    /** JSON: the answer as shown — summary, tiers with reasons, a suggestion when nothing matched. */
    answer: text('answer').notNull(),
    /** JSON: what the answer relied on — components with their updatedAt, and the connections walked. */
    relied: text('relied').notNull(),
  },
  (t) => [index('workflow_assessments_asked_idx').on(t.askedAt)],
)

// ---------------------------------------------------------------------------
// Reference: Data Dictionary — what people know about ClickHouse
// ---------------------------------------------------------------------------
//
// Structure is never stored here. Engines, columns, types and row counts are
// read live from ClickHouse's system tables (lib/dictionary.ts), because a
// copy of them is wrong the next time a loader runs. What is stored is the
// part only a person can supply: what a thing means, whether it should be
// loaded, and what will produce a wrong number.
//
// Tables and columns are referred to as "database.table" text rather than by
// foreign key for the same reason: the thing they describe lives in another
// system, and a note about a table that was dropped is worth keeping and
// showing as drift rather than cascading away.

/**
 * A named thing a client or a loader team talks about — Sports Sponsorship,
 * Television — and the ClickHouse tables it is made of.
 *
 * Its loaded status is computed from those tables. Its intent, per
 * environment, is stated by a person. The gap between the two is what the
 * screen exists to show.
 */
export const dictionaryDatasets = pgTable('dictionary_datasets', {
  id: id(),
  name: text('name').notNull(),
  owner: text('owner'),
  description: text('description'),
  /** loaded | awaiting_feed | by_design | planned | undecided */
  intentDev: text('intent_dev').notNull().default('undecided'),
  intentProd: text('intent_prod').notNull().default('undecided'),
  /** The Blocker, Decision or Initiative that explains the status, in words. */
  explainedBy: text('explained_by'),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedBy: text('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const dictionaryDatasetTables = pgTable(
  'dictionary_dataset_tables',
  {
    datasetId: text('dataset_id')
      .notNull()
      .references(() => dictionaryDatasets.id, { onDelete: 'cascade' }),
    /** "database.table" */
    tableRef: text('table_ref').notNull(),
  },
  (t) => [primaryKey({ name: 'dictionary_dataset_tables_pk', columns: [t.datasetId, t.tableRef] })],
)

/**
 * Whether a ClickHouse database is part of what clients consume.
 *
 * Every database on the instance shows up; this says which ones count. A
 * database with no row here is "unreviewed", which the screen shows as a
 * question rather than assuming either way.
 */
export const dictionaryDatabases = pgTable('dictionary_databases', {
  name: text('name').primaryKey(),
  /** contract | internal | transition | superseded | excluded | unreviewed */
  status: text('status').notNull().default('unreviewed'),
  description: text('description'),
  updatedBy: text('updated_by'),
  updatedAt: updatedAt(),
})

/** What people know about one table. */
export const dictionaryTables = pgTable('dictionary_tables', {
  /** "database.table" */
  tableRef: text('table_ref').primaryKey(),
  description: text('description'),
  owner: text('owner'),
  /** What will produce a wrong number if you do not know it. */
  watchOut: text('watch_out'),
  /**
   * Why an empty table is empty: by_design | awaiting_feed | undecided.
   *
   * The GPC serving model's sharpest open question. An empty table that will
   * fill when a feed lands and one that never will look identical in the
   * schema and mean opposite things to whoever is building on it.
   */
  emptyReason: text('empty_reason'),
  /** Hidden from the dictionary: a backup, a scratch table, a mistake. */
  excluded: boolean('excluded').notNull().default(false),
  updatedBy: text('updated_by'),
  updatedAt: updatedAt(),
})

/** What people know about one column. */
export const dictionaryColumns = pgTable(
  'dictionary_columns',
  {
    tableRef: text('table_ref').notNull(),
    columnName: text('column_name').notNull(),
    description: text('description'),
    meaning: text('meaning'),
    watchOut: text('watch_out'),
    source: text('source'),
    /**
     * Set when a machine wrote the notes and no person has touched them since
     * ("seed", later "yaara"). Cleared on the first human save, at which point
     * `updatedBy` names the person and the cell stops saying "draft".
     */
    draftedBy: text('drafted_by'),
    updatedBy: text('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ name: 'dictionary_columns_pk', columns: [t.tableRef, t.columnName] })],
)

/**
 * Questions asked of Yaara in the portfolio's chat, while she answers them.
 *
 * A relay, not a record. Open WebUI keeps the conversation; Yaara keeps what
 * she was told to remember; the portfolio keeps what she concluded. This
 * table only carries a question from the chat screen to her and her answer
 * back, because she cannot be reached directly (lib/yaara-chat.ts explains
 * why). Rows are deleted two days after they are asked, so it never becomes
 * a second copy of anyone's conversations.
 */
export const yaaraChats = pgTable(
  'yaara_chats',
  {
    id: id(),
    askedAt: timestamp('asked_at', { withTimezone: true }).notNull().defaultNow(),
    askedByEmail: text('asked_by_email').notNull(),
    askedByName: text('asked_by_name'),
    /** Open WebUI's id for the conversation, so a run of questions can be told apart from separate ones. */
    chatId: text('chat_id'),
    /** Where it was asked: 'open-webui' (the full chat) or 'sidebar' (the panel inside the portfolio). */
    surface: text('surface').notNull().default('open-webui'),
    /** JSON {path, title}: the portfolio page the person had open, for a sidebar question. */
    page: text('page'),
    /** JSON: the conversation as she should see it, [{role, content}], last turn the question. */
    messages: text('messages').notNull(),
    /** queued | working | answered | failed | abandoned */
    status: text('status').notNull().default('queued'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** JSON: what she said she was doing, in order, shown while the person waits. */
    progress: text('progress').notNull().default('[]'),
    reply: text('reply'),
    model: text('model'),
    servedBy: text('served_by'),
    error: text('error'),
  },
  (t) => [index('yaara_chats_status_idx').on(t.status, t.askedAt)],
)

/**
 * "Reassess now" requests from the home page, waiting for Yaara to collect
 * them (GET /api/agent/reassess). She cannot be called, so the card leaves one
 * here and waits. See src/lib/reassess-rules.ts. Kept for two days.
 */
export const reassessRequests = pgTable(
  'reassess_requests',
  {
    id: id(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** queued | working | done | failed */
    status: text('status').notNull().default('queued'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** What she had to say when she finished, if anything. */
    note: text('note'),
    error: text('error'),
  },
  (t) => [
    index('reassess_requests_status_idx').on(t.status, t.requestedAt),
    index('reassess_requests_entity_idx').on(t.entityType, t.entityId),
  ],
)

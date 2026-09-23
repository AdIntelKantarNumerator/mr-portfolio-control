/**
 * OPTIONAL demo portfolio.
 *
 * Loads a worked example so the screens can be explored with something in
 * them. It is NOT part of setting the tool up — a fresh install is empty by
 * design, and fills through Linear sync plus data entry.
 *
 *   npm run seed:demo        # load the example portfolio
 *   npm run db:reset         # back to empty (process reference only)
 *
 * The content is transcribed from MediaRadar's 7/7 Portfolio Control Room
 * export. It is a months-old snapshot and several dates have since passed;
 * that is deliberate, because it exercises the staleness and overdue handling
 * that a freshly-invented dataset would not. Nothing here is fabricated:
 * readiness statuses, prioritization scores, progress percentages and most
 * headcounts are left empty because they were not knowable from the source.
 */
import { randomUUID } from 'node:crypto'
import { connect, warnIfServerRunning } from './_connect'


async function main() {
  const { db, close, embedded } = await connect()
  const s = await import('../src/db/schema')
  const { sql } = await import('drizzle-orm')

  // ---- clean slate -------------------------------------------------------
  // Truncate rather than drop so migrations stay authoritative.
  // Portfolio content only — the process reference (gates, templates, scoring
  // model) is loaded separately and must survive a demo reload.
  await db.execute(sql`
    TRUNCATE TABLE
      scores, intake_requests, allocations, decisions, dependencies, assessments,
      field_overrides, status_updates, source_records, sync_runs, changelog_entries,
      project_readiness, milestones, projects, initiatives, app_areas, themes,
      people, teams
    RESTART IDENTITY CASCADE
  `)

  const id = () => randomUUID()
  const d = (iso: string) => new Date(`${iso}T12:00:00Z`)

  // ---- teams -------------------------------------------------------------
  // Headcount is set only where the source control room actually stated one
  // ("Shared 360 BAU pool (5-6 ppl)", "Creative Intel devs (Reinhard/Shashank)").
  // Everywhere else it is null, which the contention view renders as
  // "headcount unknown" — an honest prompt rather than an invented number.
  const teamRows = [
    { key: 'data-platform', name: 'Data Platform & Analytics', kind: 'delivery', headcount: null },
    { key: 'platform', name: 'Platform team', kind: 'delivery', headcount: null },
    { key: 'contacts-agencies', name: 'Contacts / Agencies (+News)', kind: 'delivery', headcount: null },
    { key: 'explore-reviews', name: 'Explore & Reviews', kind: 'delivery', headcount: null },
    { key: 'dashboards-opps', name: 'Dashboards & Opportunities', kind: 'delivery', headcount: null },
    { key: 'creative-intel-devs', name: 'Creative Intel devs', kind: 'delivery', headcount: 2 },
    { key: 'bau-360', name: 'Shared 360 BAU pool', kind: 'shared_pool', headcount: 6 },
    { key: 'middleware', name: 'Middleware / VideoAmp', kind: 'delivery', headcount: null },
    { key: 'program', name: 'Program management', kind: 'program', headcount: null },
  ].map((t) => ({ ...t, id: id() }))
  await db.insert(s.teams).values(teamRows)
  const team = (k: string) => teamRows.find((t) => t.key === k)!.id

  // ---- people ------------------------------------------------------------
  const personRows = [
    { name: 'Remy Pham', role: 'Data Platform lead', teamId: team('data-platform'), bottleneck: true },
    { name: 'Mukesh Kumar', role: 'Dev — Ratings / GPC', teamId: team('middleware'), bottleneck: true },
    { name: 'Nick Cavuoto', role: 'Dev lead — Insight Studio', teamId: team('platform'), bottleneck: true },
    { name: 'Irina', role: 'Dev — sole 360 developer', teamId: team('bau-360'), bottleneck: true },
    { name: 'Anthony', role: 'Dev — Globalization', teamId: team('data-platform'), bottleneck: true },
    { name: 'Sadiya Zackria', role: 'Engineering lead', teamId: team('platform') },
    { name: 'Yael', role: 'Program management', teamId: team('program'), bottleneck: true },
    { name: 'Ashley', role: 'Program management', teamId: team('program') },
    { name: 'Spencer', role: 'Program management', teamId: team('program') },
    { name: 'Jackie Messier', role: 'Owner / Program', teamId: team('program') },
    { name: 'Ed Burciu', role: 'Owner — Creative Intel', teamId: team('creative-intel-devs') },
    { name: 'Gray Wheatley', role: 'Owner — Sports', teamId: team('dashboards-opps') },
    { name: 'Milena Dedovic', role: 'Owner — Market Intel', teamId: team('program') },
    { name: 'Morgan Lawrence', role: 'Quality engineering', teamId: team('platform') },
    { name: 'Shane Homan', role: 'Dev — Sports', teamId: team('dashboards-opps') },
    { name: 'Tom Kinney', role: 'Dev — Shared Services', teamId: team('data-platform') },
    { name: 'Muhammad Imran', role: 'Dev — EWS & TWS', teamId: team('data-platform') },
    { name: 'Scott Bernberg', role: 'Engineering leadership', teamId: team('program') },
  ].map((p) => ({ ...p, id: id() }))
  await db.insert(s.people).values(personRows)
  const who = (n: string) => personRows.find((p) => p.name.startsWith(n))?.id ?? null

  // ---- themes (the board narrative spine) --------------------------------
  const themeRows = [
    { key: 'coverage', name: 'Coverage', color: '#4a6fa5', sortOrder: 1,
      description: 'New data and markets the product does not cover today.' },
    { key: 'experiences', name: 'Experiences', color: '#2f4b7c', sortOrder: 2,
      description: 'What customers actually touch — Insight Studio, Pub Intel, Creative Intel, Sports.' },
    { key: 'table-stakes', name: 'Table stakes', color: '#5a53a8', sortOrder: 3,
      description: 'Foundations everything else depends on. Invisible until they slip.' },
  ].map((t) => ({ ...t, id: id() }))
  await db.insert(s.themes).values(themeRows)
  const theme = (k: string) => themeRows.find((t) => t.key === k)!.id

  // ---- application areas (the delivery-owner axis) -----------------------
  const areaRows = [
    { key: '360', name: '360', owner: 'Jay / Brad', devs: 'Irina', sortOrder: 1,
      note: 'All 360 work is frozen except Ratings so the team can build Insight Studio.' },
    { key: 'creative-intel', name: 'Creative Intel', owner: 'Ed Burciu', sortOrder: 2 },
    { key: 'sports', name: 'Sports', owner: 'Gray Wheatley', sortOrder: 3 },
    { key: 'insights-studio', name: 'Insights Studio', owner: 'Milena / Jackie / Vince / Ed',
      devs: 'Nick Cavuoto', sortOrder: 4,
      note: 'Phase 1 launch ~Sept (taxonomy-agnostic, VX1); Phase 2 = GPC when ready.' },
    { key: 'overarching', name: 'Overarching', owner: 'Sponsor: Rick · Program: Jackie / Yael', sortOrder: 5 },
  ].map((a) => ({ ...a, id: id() }))
  await db.insert(s.appAreas).values(areaRows)
  const area = (k: string) => areaRows.find((a) => a.key === k)!.id

  // ---- initiatives -------------------------------------------------------
  const initRows = [
    { key: 'insights-studio', name: 'Insights Studio', themeId: theme('experiences'),
      status: 'active', ownerId: null, ownerGap: true, targetDate: d('2026-09-30'), sortOrder: 1 },
    { key: 'pub-intel', name: 'Pub Intel', themeId: theme('experiences'), status: 'active',
      ownerId: who('Jackie'), targetDate: d('2026-11-20'), sortOrder: 2 },
    { key: 'creative-intel', name: 'Creative Intel', themeId: theme('experiences'), status: 'active',
      ownerId: who('Ed'), sortOrder: 3 },
    { key: 'sports', name: 'Sports', themeId: theme('experiences'), status: 'active',
      ownerId: who('Gray'), sortOrder: 4 },
    { key: 'globalization', name: 'Globalization', themeId: theme('table-stakes'), status: 'active',
      ownerId: null, ownerGap: true, targetDate: d('2026-10-05'), sortOrder: 5 },
    { key: 'taxonomy', name: 'Taxonomy (Taste, GPC)', themeId: theme('table-stakes'),
      status: 'active', ownerId: null, ownerGap: true, sortOrder: 6 },
    { key: 'bau', name: 'BAU', themeId: theme('table-stakes'), status: 'active',
      ownerId: who('Sadiya'), sortOrder: 7 },
    { key: 'retail-media', name: 'Retail Media', themeId: theme('coverage'), status: 'planned',
      ownerId: null, ownerGap: true, sortOrder: 8,
      notes: 'Strategic initiative, no delivery projects yet. IA into Pub Intel ~Sept; MVP-plus is post-board.' },
    { key: 'market-intel', name: 'Market Intel', themeId: theme('coverage'), status: 'planned',
      ownerId: who('Milena'), sortOrder: 9, notes: 'Strategic initiative; no delivery projects yet.' },
    { key: 'political', name: 'Political', themeId: theme('coverage'), status: 'planned',
      ownerId: null, ownerGap: true, sortOrder: 10,
      notes: 'Strategic initiative; no delivery projects yet. Legal/CCPA review is an open strategic item.' },
    { key: 'data-platform-other', name: 'Data Platform — other', themeId: theme('table-stakes'),
      status: 'active', ownerId: who('Remy'), sortOrder: 11,
      notes: 'Work not tied to a strategic initiative but competing for the same people.' },
  ].map((i) => ({ ...i, id: id() }))
  await db.insert(s.initiatives).values(initRows)
  const init = (k: string) => initRows.find((i) => i.key === k)!.id

  // ---- projects ----------------------------------------------------------
  // Every field below is traceable to the 7/7 control room export. Where the
  // export showed no date, no priority and no percentage, none is invented:
  // `progress` stays 0 except where the work was stated as done, because a
  // made-up completion bar is the single most quietly misleading thing a
  // portfolio screen can show. Linear supplies these on first sync.
  const projectRows = [
    { key: 'is-board-demo', name: 'Insight Studio — Board Demo', initiativeId: init('insights-studio'),
      appAreaId: area('insights-studio'), leadId: who('Nick'), teamId: team('platform'),
      status: 'completed', progress: 1, startDate: d('2026-06-22'),
      targetDate: d('2026-07-17'), completedAt: d('2026-07-17') },
    { key: 'is-client-launch', name: 'Insight Studio — Client Launch (MVP)',
      initiativeId: init('insights-studio'), appAreaId: area('insights-studio'), leadId: who('Nick'),
      teamId: team('platform'), status: 'backlog', progress: 0,
      targetDate: d('2026-09-30') },
    { key: 'is-quality', name: 'Insight Studio — Quality Engineering',
      initiativeId: init('insights-studio'), appAreaId: area('insights-studio'),
      leadId: who('Morgan'), teamId: team('platform'), status: 'in_progress', progress: 0,
      startDate: d('2026-06-16') },
    { key: 'mr-migrations', name: 'MR Migrations', initiativeId: init('pub-intel'),
      appAreaId: area('overarching'), leadId: who('Remy'), teamId: team('data-platform'),
      status: 'in_progress', progress: 0, startDate: d('2026-06-24'),
      targetDate: d('2026-09-01') },
    { key: 'ce-integration', name: 'TV & Digital CE Integration', initiativeId: init('pub-intel'),
      appAreaId: area('overarching'), teamId: team('data-platform'),
      status: 'backlog', progress: 0, startDate: d('2026-06-01'),
      targetDate: d('2026-07-23') },
    { key: 'publisher-intel', name: 'Publisher Intel', initiativeId: init('pub-intel'),
      appAreaId: area('insights-studio'), teamId: team('explore-reviews'),
      status: 'backlog', progress: 0 },
    { key: 'gpc', name: 'Global Product Catalog (GPC)', initiativeId: init('globalization'),
      appAreaId: area('overarching'), leadId: who('Remy'), teamId: team('data-platform'),
      status: 'in_progress', priority: 'high', progress: 0, startDate: d('2026-06-01'),
      targetDate: d('2026-10-05') },
    { key: 'creative-central', name: 'Creative Central (Avo Toast)',
      initiativeId: init('globalization'), appAreaId: area('overarching'), leadId: who('Remy'),
      teamId: team('data-platform'), status: 'in_progress', priority: 'high', progress: 0,
      startDate: d('2026-06-10'), targetDate: d('2026-10-05') },
    { key: 'videoamp-ratings', name: 'VideoAmp TV Ratings', initiativeId: init('bau'),
      appAreaId: area('360'), leadId: who('Mukesh'), teamId: team('middleware'),
      status: 'in_progress', priority: 'high', progress: 0, startDate: d('2026-06-20'),
      targetDate: d('2026-09-30') },
    { key: 'nielsen-broadcast', name: "Nielsen Nat'l Broadcast (Live+7) restore",
      initiativeId: init('bau'), appAreaId: area('360'), leadId: who('Mukesh'),
      teamId: team('middleware'), status: 'in_progress', progress: 0 },
    { key: 'sports-cannes', name: 'Sports Dashboard — Cannes demo', initiativeId: init('sports'),
      appAreaId: area('sports'), leadId: who('Nick'), teamId: team('dashboards-opps'),
      status: 'completed', progress: 1, completedAt: d('2026-06-25') },
    { key: 'sports-client-launch', name: 'Sports Dashboard — Client Launch',
      initiativeId: init('sports'), appAreaId: area('sports'), leadId: who('Shane'),
      teamId: team('dashboards-opps'), status: 'backlog', progress: 0 },
    { key: 'logo-recognition', name: 'Logo Recognition', initiativeId: init('data-platform-other'),
      appAreaId: area('sports'), leadId: who('Remy'), teamId: team('data-platform'),
      status: 'backlog', progress: 0 },
    { key: 'nsfw-classifier', name: 'NSFW Classifier', initiativeId: init('data-platform-other'),
      appAreaId: area('overarching'), leadId: who('Remy'), teamId: team('data-platform'),
      status: 'backlog', progress: 0 },
    { key: 'junk-ad-classifier', name: 'Junk Ad Classifier', initiativeId: init('data-platform-other'),
      appAreaId: area('overarching'), leadId: who('Remy'), teamId: team('data-platform'),
      status: 'backlog', progress: 0 },
    { key: 'ews-tws', name: 'EWS & TWS', initiativeId: init('data-platform-other'),
      appAreaId: area('overarching'), leadId: who('Muhammad'), teamId: team('data-platform'),
      status: 'backlog', progress: 0 },
    { key: 'winbox', name: 'Winbox', initiativeId: init('data-platform-other'),
      appAreaId: area('overarching'), teamId: team('data-platform'), status: 'in_progress',
      progress: 0, startDate: d('2026-07-02') },
    { key: 'shared-services', name: 'Shared Services', initiativeId: init('data-platform-other'),
      appAreaId: area('overarching'), leadId: who('Tom'), teamId: team('data-platform'),
      status: 'backlog', progress: 0, targetDate: d('2026-07-31') },
    { key: '360-ctv', name: '360 CTV', initiativeId: init('bau'), appAreaId: area('360'),
      leadId: who('Irina'), teamId: team('bau-360'), status: 'paused', progress: 0 },
    { key: '360-social', name: '360 Social formats', initiativeId: init('bau'),
      appAreaId: area('360'), leadId: who('Irina'), teamId: team('bau-360'), status: 'paused',
      progress: 0 },
    { key: 'ci-message-elements', name: 'Message Elements 2.0', initiativeId: init('creative-intel'),
      appAreaId: area('creative-intel'), teamId: team('creative-intel-devs'), status: 'in_progress',
      progress: 0 },
    { key: 'retail-media-ia', name: 'Retail Media — IA into Pub Intel',
      initiativeId: init('retail-media'), appAreaId: area('insights-studio'),
      teamId: team('dashboards-opps'), status: 'planned', progress: 0,
      description: 'Stated as landing around September; no dates recorded in the source.' },
  ].map((p, ix) => ({ ...p, id: id(), sortOrder: ix }))
  await db.insert(s.projects).values(projectRows)
  const proj = (k: string) => projectRows.find((p) => p.key === k)!.id

  // ---- milestones --------------------------------------------------------
  await db.insert(s.milestones).values([
    { id: id(), projectId: proj('is-board-demo'), name: 'IS Board Demo', targetDate: d('2026-07-17'),
      actualDate: d('2026-07-17'), status: 'done', portfolioLevel: true },
    { id: id(), projectId: proj('ce-integration'), name: 'Classification Engine go-live',
      targetDate: d('2026-07-23'), actualDate: d('2026-07-24'), status: 'done', portfolioLevel: true,
      description: 'Digital / TROI / print; TV and sports followed on 7/24.' },
    { id: id(), projectId: proj('mr-migrations'), name: 'MR Migrations first release',
      targetDate: d('2026-09-01'), status: 'done', contested: true, portfolioLevel: true,
      description: "Early gate, not the finish. Matt's 'everyone off MR by Sept' was flagged not feasible." },
    { id: id(), projectId: proj('is-client-launch'), name: 'IS Client Launch MVP live',
      targetDate: d('2026-09-30'), status: 'pending', portfolioLevel: true, contested: true },
    { id: id(), projectId: proj('videoamp-ratings'), name: 'VideoAmp Ratings live',
      targetDate: d('2026-09-30'), status: 'pending', portfolioLevel: true },
    { id: id(), projectId: proj('creative-central'), name: 'Creative Central ready',
      targetDate: d('2026-09-05'), status: 'done', description: 'Globalization work-back gate.' },
    { id: id(), projectId: proj('gpc'), name: 'GPC + Creative Central GA',
      targetDate: d('2026-10-05'), status: 'pending', contested: true, portfolioLevel: true,
      description: 'All CTV categories, not Tier 1. Flagged possible but high risk.' },
    { id: id(), projectId: proj('mr-migrations'), name: 'Migration spend across all 5 data sets',
      targetDate: d('2026-11-20'), status: 'pending', contested: true, portfolioLevel: true,
      description: 'Digital / Print / Retail / Native / Podcast. At risk.' },
    { id: id(), projectId: proj('mr-migrations'), name: 'MR Classic app retired',
      targetDate: d('2026-12-31'), status: 'pending', contested: true, portfolioLevel: true },
    { id: id(), projectId: proj('360-ctv'), name: '360 decommission (realistic)',
      targetDate: d('2027-06-30'), status: 'pending', contested: true, portfolioLevel: true },
  ])

  // ---- assessments — the layer Linear does not hold ----------------------
  // The assessments came from the 7/7 control room, so that is their date.
  // Back-dating them honestly is also the correct demo: they are now well past
  // the 21-day staleness threshold, and the app says so on every screen.
  const asOf = d('2026-07-07')
  const assess = (
    entityType: string,
    entityId: string,
    rag: string,
    rationale: string,
    evidence: string,
    confidence = 'medium',
  ) => ({
    id: id(), entityType, entityId, rag, rationale, evidence, confidence,
    asOf, assessorId: who('Yael'), current: true,
  })

  await db.insert(s.assessments).values([
    assess('initiative', init('globalization'), 'red',
      'GA on 10/5 requires all CTV categories, and Anthony is still a single point on the critical path.',
      'Program Review — Global critical path', 'high'),
    assess('initiative', init('taxonomy'), 'red',
      'GPC is go-forward but nothing is built against it and there is no dedicated capacity.',
      'CE / GPC deck', 'high'),
    assess('initiative', init('insights-studio'), 'amber',
      'Board demo landed, but the 9/30 MVP and the data dependency are both unresolved.',
      'Jul 6 Leads call + Linear', 'medium'),
    assess('initiative', init('pub-intel'), 'amber',
      'CE landed 7/23 so the gate cleared, but migration spend by ~11/20 is the real commitment and it is tight.',
      'CE / Migration deck', 'medium'),
    assess('initiative', init('creative-intel'), 'amber',
      'Fold-in is TBD and the team perceives itself blocked on taxonomy.',
      'Jul 6 Leads call'),
    assess('initiative', init('sports'), 'green',
      'Cannes demo delivered; client launch sits in backlog with a named lead.',
      'Linear'),
    assess('initiative', init('bau'), 'amber',
      'Frozen except Ratings. Every expansion request competes with the 9/30 Ratings date.',
      'Jul 6 Leads call'),
    assess('initiative', init('retail-media'), 'amber',
      'Active as a migration data set; the broader own-media-group MVP-plus is unprioritised.',
      'CE / Migration deck'),
    assess('initiative', init('market-intel'), 'green',
      'Strategic initiative with an owner and no delivery commitment yet — nothing to be off track about.',
      'Linear'),
    assess('initiative', init('political'), 'green',
      'Strategic only; legal/CCPA review is the open item.', 'Strat Plan → Board'),
    assess('initiative', init('data-platform-other'), 'green',
      'Dedup, classifiers and SSO are steady; the risk is that they hide Remy’s real load.',
      'Linear + Program Review'),
    assess('project', proj('gpc'), 'red',
      'BiS data feed has no firm ETA and VX-Central ingestion was the ~7/10 trip-wire.',
      'Program Review — Global critical path', 'high'),
    assess('project', proj('creative-central'), 'red',
      'Shares the 10/5 GA and the same single-threaded people as GPC.',
      'Program Review', 'high'),
    assess('project', proj('is-client-launch'), 'amber',
      'Nine days out with the taxonomy dependency still contested.',
      'Jul 6 Leads call', 'high'),
    assess('project', proj('mr-migrations'), 'amber',
      '9/1 first release landed; the ~11/20 spend date across all five data sets is the exposure.',
      'CE / Migration deck'),
    assess('project', proj('videoamp-ratings'), 'amber',
      'On track for 9/30 but Mukesh is also carrying the Nielsen restore and GPC pipeline work.',
      'Linear + Program Review'),
  ])

  // ---- allocations (the contention matrix) -------------------------------
  const alloc = (t: string, i: string, mode: string, note?: string) => ({
    id: id(), teamId: team(t), initiativeId: init(i), mode, note: note ?? null,
  })
  await db.insert(s.allocations).values([
    alloc('platform', 'insights-studio', 'primary', 'Core build'),
    alloc('platform', 'pub-intel', 'primary'),
    alloc('platform', 'bau', 'frozen'),
    alloc('contacts-agencies', 'insights-studio', 'primary'),
    alloc('contacts-agencies', 'bau', 'frozen'),
    alloc('explore-reviews', 'insights-studio', 'primary'),
    alloc('explore-reviews', 'pub-intel', 'primary', 'Pub Intel explore'),
    alloc('explore-reviews', 'bau', 'frozen'),
    alloc('dashboards-opps', 'insights-studio', 'primary'),
    alloc('dashboards-opps', 'pub-intel', 'primary'),
    alloc('dashboards-opps', 'bau', 'frozen'),
    alloc('dashboards-opps', 'retail-media', 'borrowed', 'IA sub-media'),
    alloc('creative-intel-devs', 'insights-studio', 'borrowed', '2 devs, fixed sprint'),
    alloc('creative-intel-devs', 'creative-intel', 'primary'),
    alloc('creative-intel-devs', 'retail-media', 'competing', 'MVP-plus'),
    alloc('bau-360', 'insights-studio', 'competing', 'Same people'),
    alloc('bau-360', 'pub-intel', 'competing'),
    alloc('bau-360', 'bau', 'frozen', 'Except Ratings'),
    alloc('bau-360', 'retail-media', 'competing', 'MVP-plus'),
    alloc('data-platform', 'insights-studio', 'primary', 'Feeds the app'),
    alloc('data-platform', 'pub-intel', 'primary', 'CE → migration'),
    alloc('data-platform', 'globalization', 'primary', 'GPC + CC 10/5'),
    alloc('data-platform', 'retail-media', 'primary', 'Data feed'),
    alloc('data-platform', 'data-platform-other', 'primary'),
    alloc('middleware', 'creative-intel', 'competing', 'AI chatbot'),
    alloc('middleware', 'bau', 'competing', 'Ratings 9/30'),
  ])

  // ---- dependencies ------------------------------------------------------
  const dep = (
    fromType: string, fromId: string, toType: string, toId: string,
    o: Partial<{ status: string; criticality: string; description: string; fromLabel: string; dueDate: Date; kind: string }> = {},
  ) => ({
    id: id(), fromType, fromId, toType, toId, kind: o.kind ?? 'blocks',
    status: o.status ?? 'open', criticality: o.criticality ?? 'normal',
    description: o.description ?? null, fromLabel: o.fromLabel ?? null, toLabel: null,
    dueDate: o.dueDate ?? null, ownerId: null,
  })
  await db.insert(s.dependencies).values([
    dep('external', 'bis-feed', 'project', proj('gpc'), {
      fromLabel: 'BiS data feed', status: 'at_risk', criticality: 'critical',
      description: 'No firm ETA. VX-Central ingestion was the ~7/10 trip-wire and it gates the 10/5 GA.',
      dueDate: d('2026-07-10'),
    }),
    dep('project', proj('ce-integration'), 'project', proj('mr-migrations'), {
      status: 'resolved', criticality: 'high',
      description: 'CE go-live on 7/23 was the gate for migration work. Cleared 7/24.',
    }),
    dep('project', proj('ce-integration'), 'project', proj('gpc'), {
      status: 'resolved', criticality: 'high',
    }),
    dep('project', proj('mr-migrations'), 'project', proj('is-client-launch'), {
      status: 'open', criticality: 'critical',
      description: 'Migration data has to be flowing before the MVP can launch against it.',
      dueDate: d('2026-09-30'),
    }),
    dep('project', proj('publisher-intel'), 'project', proj('is-client-launch'), {
      status: 'open', criticality: 'high', description: 'Pub Intel data ready.',
    }),
    dep('project', proj('retail-media-ia'), 'project', proj('is-client-launch'), {
      status: 'open', criticality: 'normal', description: 'Retail Media IA lands inside Pub Intel.',
    }),
    dep('project', proj('gpc'), 'project', proj('creative-central'), {
      status: 'at_risk', criticality: 'critical',
      description: 'Both share the 10/5 GA date and the same people.', dueDate: d('2026-10-05'),
    }),
    dep('project', proj('gpc'), 'initiative', init('creative-intel'), {
      kind: 'informs', status: 'open', criticality: 'high',
      description: 'Taxonomy dependency — contested. Jay and David want it first; program says build on minimal data now.',
    }),
    dep('external', 'anthony-capacity', 'project', proj('gpc'), {
      fromLabel: 'Anthony — single point of failure', status: 'at_risk', criticality: 'critical',
      kind: 'shares_resource',
      description: 'Schema, Product Central equivalent, HiTL/feed screens and CC all route through one person.',
    }),
    dep('external', 'reference-data', 'project', proj('gpc'), {
      fromLabel: 'Reference-data seeding (C&D / ML)', status: 'open', criticality: 'high',
      description: 'Brands, advertisers, subsidiaries, parents and categories must be populated for GPC.',
      dueDate: d('2026-10-05'),
    }),
  ])

  // ---- decisions ---------------------------------------------------------
  const dec = (
    ref: string, category: string, title: string, body: string,
    o: Partial<{ status: string; contested: boolean; ownerText: string; dueBy: string; nextAction: string; evidence: string; entityType: string; entityId: string }> = {},
  ) => ({
    id: id(), ref, category, title, body, status: o.status ?? 'open',
    contested: o.contested ?? false, ownerId: null, ownerText: o.ownerText ?? null,
    dueBy: o.dueBy ?? null, nextAction: o.nextAction ?? null, evidence: o.evidence ?? null,
    leadVisible: true, entityType: o.entityType ?? null, entityId: o.entityId ?? null,
  })
  await db.insert(s.decisions).values([
    dec('S2', 'strategic', 'Eric end-to-end reorg — get clarity',
      'Is it happening, what shape, and does it move timelines we are about to show the board? The biggest undefined swing variable.',
      { ownerText: 'Yael + Eric', dueBy: 'Overdue', nextAction: 'Pin the reorg shape before the deck locks.', evidence: 'Strat Plan → Board, item 2' }),
    dec('D1', 'delivery', "What is the real 'September' commitment — and is it feasible?",
      "Three different dates hide under 'September': IS Phase 1 launch, MR Migrations 9/1 gate, and migration spend ~11/20 with MR Classic retired at year end. The GPC deck flags 'everyone off MR by Sept' as not feasible.",
      { contested: true, ownerText: 'Yael → Tejas / Matt / David', dueBy: 'This week',
        nextAction: 'Pin what September actually commits and reset expectations against the 11/20 spend date.',
        evidence: 'CE / Migration deck + Linear + Jul 6 call', entityType: 'initiative', entityId: init('pub-intel') }),
    dec('D2', 'delivery', 'Kill the taxonomy / 5–10-year-history dependency',
      'Jay and David say they need new taxonomy plus years of history before building in IS. Program says build on minimal data now. Tejas already said do not delay migration for taxonomy.',
      { contested: true, ownerText: 'Product (Jay/David) + Yael', dueBy: 'Next Leads',
        nextAction: 'Explicit decision: features start on minimal data; document required vs preferred history.',
        evidence: 'Jul 6 Leads call' }),
    dec('D3', 'delivery', 'Define the 360 → Insight Studio plan beyond MVP',
      'The MVP is Pub Intel only. There is no plan for what else in 360 carries forward or gets abandoned, and no program owner on the IS initiative.',
      { ownerText: 'Eric (+ Yael)', dueBy: 'This quarter',
        nextAction: 'Add a 360→IS workstream and assign a program owner.',
        evidence: 'Jul 6 call + Linear owner gap', entityType: 'initiative', entityId: init('insights-studio') }),
    dec('D5', 'delivery', 'Agree the estimation model',
      'Eric wants top-down quarterly bets from the four leads rather than bottoms-up rollups. Sizing in Linear is currently empty.',
      { ownerText: 'Eric + 4 leads + Yael', dueBy: 'Next Leads',
        nextAction: 'Leads make a dated quarter-level bet per initiative; PMs track sprint fit.',
        evidence: 'Jul 6 Leads call' }),
    dec('D6', 'delivery', 'Set a WIP limit and priority order across the shared pool',
      'Everything cannot be priority for the same people. Without a WIP cap and a ranked list, new requests displace September.',
      { ownerText: 'Tejas / Matt — Yael to force', dueBy: 'This week',
        nextAction: 'Ranked list out of this tool → leadership makes the WIP call.',
        evidence: 'Jul 6 Leads call' }),
    dec('D10', 'delivery', 'Insight Studio: VX1 / taxonomy-agnostic vs GPC at launch',
      'Can IS launch taxonomy-agnostic on VX1 now and migrate to GPC later? It unblocks the September launch without waiting on GPC.',
      { ownerText: 'Eric / Matt', dueBy: 'Before Sept launch',
        nextAction: 'Confirm VX1-now / GPC-later so IS Phase 1 is not gated on GPC.',
        evidence: 'CE / GPC deck' }),
    dec('D11', 'delivery', 'Dedicate capacity to a focused GPC project',
      'GPC is go-forward but nothing is built against it and there is no dedicated capacity — a named critical blocker.',
      { ownerText: 'Rick / SLT', dueBy: 'ASAP',
        nextAction: 'Allocate dedicated GPC capacity; decide the MDM funnel point.',
        evidence: 'CE / GPC deck', entityType: 'project', entityId: proj('gpc') }),
    dec('D8', 'delivery', 'Sept MVP stack: SQL Server, not Clickhouse',
      'September MVP runs on the existing 360 backbone. Clickhouse comes later; GPC and Global are on the new stack.',
      { status: 'decided', ownerText: 'Eric / Scott / Sadiya', dueBy: 'Closed',
        nextAction: 'Hold the line so it does not reopen.', evidence: 'Jul 6 Leads call' }),
    dec('D9', 'delivery', "Historicals: launch without full backfill?",
      'Leaning toward launching without full historical backfill so the timeline holds.',
      { status: 'watch', ownerText: 'Product (+ David)', dueBy: 'Before launch',
        nextAction: 'Confirm explicitly to set client-partner expectations.', evidence: 'Jul 6 Leads call' }),
    dec('G1', 'risk', 'BiS full data flowing',
      'No firm ETA; the May sample slipped. VX-Central ingestion was at risk past ~7/10 and it gates the 10/5 GA.',
      { status: 'watch', ownerText: 'BiS (Assaf / Adi) — David H to escalate', dueBy: 'Overdue',
        nextAction: 'Escalate and set a fallback.', evidence: 'Program Review — Global critical path' }),
    dec('G2', 'risk', 'CE: all CTV categories ready by GA',
      'The 10/5 bar is all categories, not Tier 1. Assessed as possible but high risk.',
      { status: 'watch', ownerText: 'Classification Engine team', dueBy: 'Weekly until 10/5',
        nextAction: 'Weekly category-readiness check; Tier-1 fallback if slipping.',
        evidence: 'Program Review — Global critical path' }),
    dec('G3', 'risk', 'Reference-data seeding — C&D / ML',
      'Brands, advertisers, subsidiaries, parents and categories must be populated for GPC.',
      { ownerText: 'C&D / ML', dueBy: 'For 10/5',
        nextAction: 'Confirm ownership and a seeding date on the critical path.',
        evidence: 'Program Review — Global critical path' }),
    dec('G4', 'risk', "Anthony's team capacity (single point)",
      'Schema, Product Central equivalent, HiTL/feed screens and CC all sit with one person.',
      { status: 'watch', ownerText: 'David H / Eric', dueBy: 'Ongoing',
        nextAction: 'Add a backup or de-scope; do not let one person gate 10/5.',
        evidence: 'Program Review — Global critical path' }),
  ])

  // ---- intake ------------------------------------------------------------
  const requests = [
    { ref: 'REQ-001', title: 'LinkedIn & Pinterest coverage',
      problem: 'Neither platform is covered. Mostly data-platform / BiS ETL work with little 360 involvement, but it needs new BiS data and could affect Global.',
      outcome: 'Both platforms reporting spend alongside existing social.',
      requesterName: 'Jay', sponsor: 'Brad', themeId: theme('coverage'), appAreaId: area('360'),
      tshirt: 'l', status: 'scoring', source: 'web',
      businessCase: 'Repeated client asks in renewals; competitor parity.' },
    { ref: 'REQ-002', title: 'Retail Media MVP-plus (own media group)',
      problem: 'Retail is live as a migration data set, but the broader own-media-group experience is unprioritised and keeps coming up in deals.',
      outcome: 'Retail Media as a first-class media group rather than a migration artifact.',
      requesterName: 'Milena', sponsor: 'Rick', themeId: theme('coverage'),
      appAreaId: area('insights-studio'), tshirt: 'xl', status: 'scoring', source: 'web',
      desiredDate: d('2027-03-31'),
      businessCase: 'Named in the board narrative under Coverage; post-board commitment.' },
    { ref: 'REQ-003', title: 'Agentic chatbot in Creative Intel',
      problem: 'Jay is driving an AI assistant inside CI. It needs middleware capacity, which collides directly with Ratings.',
      outcome: 'Natural-language querying over creative data.',
      requesterName: 'Jay', sponsor: 'Ed Burciu', themeId: theme('experiences'),
      appAreaId: area('creative-intel'), tshirt: 'l', status: 'triage', source: 'slack',
      businessCase: 'Differentiator in competitive deals; exec visibility.' },
    { ref: 'REQ-004', title: 'Digital media spend methodology rework',
      problem: "Gregory's team owns the methodology and the detail is not visible to the program. Unclear whether it touches the plan team at all.",
      requesterName: 'Gregory', themeId: theme('table-stakes'), appAreaId: area('360'),
      tshirt: 'm', status: 'new', source: 'web' },
    { ref: 'REQ-005', title: 'Social formats & locally observed',
      problem: 'Data is already in house; this is ETL and UI work. A Q2-plus candidate that keeps resurfacing in prioritisation discussions.',
      outcome: 'Locally observed social formats reportable in 360 and IS.',
      requesterName: 'Ashley', themeId: theme('coverage'), appAreaId: area('360'),
      tshirt: 'm', status: 'scoring', source: 'web' },
    { ref: 'REQ-006', title: 'Political advertising — legal and CCPA review',
      problem: 'Political is in the board narrative under Coverage but the legal and CCPA review is an open strategic item and nothing can start until it closes.',
      outcome: 'A written legal position that lets delivery scope the work.',
      requesterName: 'Jackie Messier', sponsor: 'Rick', themeId: theme('coverage'),
      tshirt: 's', status: 'triage', source: 'web', desiredDate: d('2026-11-01'),
      hardDate: true, hardDateReason: 'Named in the board deck for FY27 planning.' },
    { ref: 'REQ-007', title: 'Lightweight GPC visualisation for Jay',
      problem: 'Jay needs a way to see catalogue coverage this quarter. A real product is not realistic before Q1 2027.',
      outcome: 'A read-only view, ideally inside Insight Studio.',
      requesterName: 'Jay', themeId: theme('table-stakes'), appAreaId: area('insights-studio'),
      tshirt: 's', status: 'ranked', source: 'slack' },
    { ref: 'REQ-008', title: 'Simulcast coverage for Total Event Coverage',
      problem: 'Total Event Coverage means linear plus simulcast plus streaming. Simulcast is the missing leg and it is early enough that nobody owns it.',
      requesterName: 'Gray Wheatley', themeId: theme('coverage'), appAreaId: area('sports'),
      tshirt: 'l', status: 'new', source: 'web' },
  ]

  const requestRows = requests.map((r) => ({
    id: id(), ref: r.ref, title: r.title, problem: r.problem, outcome: r.outcome ?? null,
    requesterName: r.requesterName, requesterEmail: null, sponsor: r.sponsor ?? null,
    stakeholders: null, themeId: r.themeId ?? null, appAreaId: r.appAreaId ?? null,
    proposedInitiativeId: null, desiredDate: r.desiredDate ?? null,
    hardDate: r.hardDate ?? false, hardDateReason: r.hardDateReason ?? null,
    tshirt: r.tshirt ?? null, businessCase: r.businessCase ?? null, status: r.status,
    decisionNote: null, convertedProjectId: null, source: r.source,
  }))
  await db.insert(s.intakeRequests).values(requestRows)

  // No seeded scores. The 1-5 values behind a ranked backlog are a judgement
  // the room makes together; inventing them would put a defensible-looking
  // number next to work nobody has actually assessed. The criteria and weights
  // are seeded, so the first scoring session has a model to argue with.

  // ---- settings and changelog -------------------------------------------
  // The demo only pins the timeline horizon, so the example portfolio renders
  // over the window it was written for. Branding and thresholds belong to the
  // deployment (scripts/init.ts), not to a sample dataset.
  for (const [key, value] of [
    ['portfolio.horizonStart', '2026-07-01'],
    ['portfolio.horizonEnd', '2027-12-31'],
  ] as const) {
    await db
      .insert(s.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: s.settings.key, set: { value } })
  }

  // The changelog reproduces the source control room's own entries, plus one
  // line recording how this database was populated. No invented events.
  await db.insert(s.changelogEntries).values([
    { id: id(), at: new Date(), actor: 'seed', kind: 'note',
      summary: 'Seeded from the 7/7 Portfolio Control Room export and the program references site',
      detail:
        'Delivery layer (initiatives, projects, dates, leads), health assessments, decisions, ' +
        'dependencies and the contention matrix are transcribed from the static control room, ' +
        'which was itself pulled from Linear on 7/7 — so they are a snapshot of a snapshot. ' +
        'Lifecycle gates, readiness items, templates and the discovery question bank are ' +
        'verbatim from the program references site. Nothing else is populated: per-project ' +
        'readiness, prioritization scores, progress percentages and most headcounts are ' +
        'deliberately empty rather than guessed. Run the Linear sync to take over the ' +
        'delivery layer.' },
    { id: id(), at: d('2026-07-07'), actor: 'Yael', kind: 'change',
      summary: 'Added the By-Application view and reframed the September commitment',
      detail:
        "Matt's 'everyone off MR by Sept' flagged as not feasible. Real dates: IS Phase 1 " +
        'launch ~Sept (VX1), migration spend ~11/20, MR Classic retired end of year; ' +
        'Creative Central ready 9/5, GA 10/5. Added decisions D10 and D11.' },
    { id: id(), at: d('2026-07-07'), actor: 'Yael', kind: 'change',
      summary: 'Connected the delivery layer to Linear and reconciled against the program review',
      detail:
        'Corrected September to two dated projects — MR Migrations 9/1 and IS Client Launch ' +
        '9/30. Replaced the earlier ~Jul 31 guess with CE go-live 7/23. Surfaced Remy Pham as ' +
        'the biggest hidden bottleneck. Flagged the no-owner initiatives. Dropped the capacity ' +
        'spreadsheets as a source of truth.' },
    { id: id(), at: d('2026-07-06'), actor: 'Yael', kind: 'note',
      summary: 'First build of the Control Room, synthesized from the Jul 6 Leads call' },
  ])

  console.log(
    `Demo portfolio loaded: ${teamRows.length} teams, ${personRows.length} people, ` +
      `${initRows.length} initiatives, ${projectRows.length} projects, ${requests.length} intake requests.` +
      '\nNo readiness statuses, scores, progress percentages or invented headcounts — ' +
      'those were not knowable from the source and are left empty.\n' +
      'Run `npm run db:reset` to return to an empty system.',
  )
  await warnIfServerRunning(embedded)
  await close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

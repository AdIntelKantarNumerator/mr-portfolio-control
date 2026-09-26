/**
 * Prove the hierarchy rotation keeps everything.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/check-rotation.ts
 *
 * Migration 0011 renames four tables and rewrites a stored discriminator in
 * twelve others. Every one of those is a way to silently lose or mis-file real
 * rows, and the failure would not show up as an error — it would show up as a
 * blocker attached to the wrong thing, weeks later.
 *
 * So this seeds a database at migration 0010, runs 0011, and checks that every
 * row is where it should be afterwards. It expects an EMPTY database and it
 * migrates in two halves, so point it at a scratch one.
 */
import { Pool } from 'pg'
import { sslOption } from './_connect.js'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required — point it at a scratch database.')

// TLS comes from the shared helper, not a second copy of the rule. The last
// time this decision was made twice, one copy defaulted to no encryption and
// Azure answered "no pg_hba.conf entry ... no encryption", which reads like a
// firewall problem and is not one.
const pool = new Pool({ connectionString: url, ssl: sslOption(url) })
const db = drizzle(pool)

let failures = 0
function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures++
}

/** A migrations folder containing only the migrations up to `upTo`. */
function folderUpTo(upTo: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'))
  cpSync('drizzle', dir, { recursive: true })
  const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number }[]
  }
  journal.entries = journal.entries.filter((e) => e.idx <= upTo)
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(journal))
  return dir
}

async function q<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await pool.query(sql)).rows as T[]
}

async function main() {
  // --- half one: the world as it was ---
  const before = folderUpTo(10)
  await migrate(db, { migrationsFolder: before })
  rmSync(before, { recursive: true, force: true })
  console.log('seeded at migration 0010\n')

  await pool.query(`
    -- Seeded in the OLD vocabulary on purpose: this is the world as it stands
    -- at migration 0010, before the rotation. The assertions below are written
    -- in the new one.
    INSERT INTO people (id, name) VALUES ('p-priya','Priya Raman'), ('p-dan','Dan Okoro');
    INSERT INTO initiatives (id, key, name, status, sort_order)
      VALUES ('i-360','I-1','360 Data','active',1), ('i-gpc','I-2','GPC','active',2);
    INSERT INTO projects (id, key, name, status, initiative_id, sort_order)
      VALUES ('pr-videoamp','P-1','VideoAmp Integration','in_progress','i-360',1),
             ('pr-taxonomy','P-2','Taxonomy','in_progress','i-gpc',2),
             ('pr-orphan','P-3','Export API','in_progress',NULL,3);
    INSERT INTO milestones (id, project_id, name, status, sort_order)
      VALUES ('m-old','pr-videoamp','Schema signed off','done',1),
             ('m-old2','pr-taxonomy','Trees merged','missed',2);
    INSERT INTO workstreams (id, project_id, name, status, sort_order)
      VALUES ('w-ingest','pr-videoamp','Ratings Ingest','at_risk',1);
    INSERT INTO workstream_items (id, workstream_id, state, text, sort_order)
      VALUES ('wi-1','w-ingest','completed','Nielsen daily pull live',1);
    INSERT INTO workstream_phases (id, workstream_id, phase, from_period, to_period)
      VALUES ('wp-1','w-ingest','development','2026-08','2026-10');
    INSERT INTO decisions (id, ref, kind, title, body, entity_type, entity_id)
      VALUES ('d-1','B12','blocker','SMTP relay','...','project','pr-videoamp'),
             ('d-2','D7','decision','National only','...','initiative','i-360');
    INSERT INTO agent_observations (id, entity_type, entity_id, items, evidence, model)
      VALUES ('o-1','project','pr-videoamp','[]','[]','claude'),
             ('o-2','initiative','i-360','[]','[]','claude');
    INSERT INTO field_overrides (id, entity_type, entity_id, field, value)
      VALUES ('f-1','project','pr-videoamp','name','"Renamed"');
  `)

  // --- half two: the rotation ---
  await migrate(db, { migrationsFolder: 'drizzle' })
  console.log('ran migration 0011\n')

  const ws = await q<{ id: string; name: string; project_id: string | null }>(
    `SELECT id, name, project_id FROM workstreams ORDER BY id`)
  check('yesterday\u2019s projects are today\u2019s workstreams', ws.length === 3, `${ws.length} rows`)
  check('a workstream kept its id and name',
    ws.some((r) => r.id === 'pr-videoamp' && r.name === 'VideoAmp Integration'))
  check('its parent moved from initiative_id to project_id',
    ws.find((r) => r.id === 'pr-videoamp')?.project_id === 'i-360')

  const pj = await q<{ id: string; name: string; initiative_id: string | null }>(
    `SELECT id, name, initiative_id FROM projects ORDER BY id`)
  check('yesterday\u2019s initiatives are today\u2019s projects', pj.length === 2, `${pj.length} rows`)
  check('and they start with no initiative above them', pj.every((r) => r.initiative_id === null))

  const inits = await q(`SELECT * FROM initiatives`)
  check('the new initiative layer exists and is empty', inits.length === 0)

  const ms = await q<{ id: string; level: string; entity_id: string; name: string; status: string }>(
    `SELECT id, level, entity_id, name, status FROM milestones ORDER BY id`)
  check('both kinds of milestone are in one table', ms.length === 3, `${ms.length} rows`)
  check('the program review row survived',
    ms.some((m) => m.id === 'w-ingest' && m.name === 'Ratings Ingest' && m.entity_id === 'pr-videoamp'))
  check('a granular milestone was merged in', ms.some((m) => m.id === 'm-old'))
  check('and its status was mapped onto the deck vocabulary',
    ms.find((m) => m.id === 'm-old')?.status === 'complete' &&
    ms.find((m) => m.id === 'm-old2')?.status === 'at_risk')
  check('every migrated milestone sits at workstream level', ms.every((m) => m.level === 'workstream'))

  const kids = await q(`SELECT milestone_id FROM milestone_items`)
  check('milestone items followed their parent', kids.length === 1)
  const phases = await q(`SELECT milestone_id FROM milestone_phases`)
  check('milestone phases followed too', phases.length === 1)

  // The discriminator rewrite — the part with the ordering trap.
  const dec = await q<{ id: string; entity_type: string }>(`SELECT id, entity_type FROM decisions ORDER BY id`)
  check('a decision on a project now reads workstream',
    dec.find((d) => d.id === 'd-1')?.entity_type === 'workstream')
  check('a decision on an initiative now reads project',
    dec.find((d) => d.id === 'd-2')?.entity_type === 'project')
  check('nothing collapsed to a single value',
    new Set(dec.map((d) => d.entity_type)).size === 2,
    'if both read workstream, the CASE was applied as two sequential updates')

  const obs = await q<{ id: string; entity_type: string }>(`SELECT id, entity_type FROM agent_observations ORDER BY id`)
  check('observations were rewritten the same way',
    obs.find((o) => o.id === 'o-1')?.entity_type === 'workstream' &&
    obs.find((o) => o.id === 'o-2')?.entity_type === 'project')

  const ov = await q<{ entity_type: string }>(`SELECT entity_type FROM field_overrides`)
  check('so were field overrides', ov[0]?.entity_type === 'workstream')

  const cols = await q<{ table_name: string }>(`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='entity_type' ORDER BY table_name`)
  const missed: string[] = []
  for (const t of cols) {
    const rows = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${t.table_name}" WHERE entity_type = 'initiative'`)
    if (Number(rows[0]!.n) > 0) missed.push(t.table_name)
  }
  check('no table still says "initiative" about the old meaning', missed.length === 0, missed.join(', '))

  const ai = await q(`SELECT * FROM action_items`)
  const al = await q(`SELECT * FROM action_item_links`)
  check('action items and their links exist', Array.isArray(ai) && Array.isArray(al))

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed')
  if (failures) process.exitCode = 1
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

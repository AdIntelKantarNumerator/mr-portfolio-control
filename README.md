# MR Portfolio Control

A program-management tool for MediaRadar Product & Tech. It reads the delivery
layer from Linear (and optionally Google Sheets), lets the program team enter
the things no tracker holds, and renders initiative timelines, dependency
chains, contention, intake and prioritization off one model.

## Run it

```bash
npm install
npm run setup     # migrate, load the process reference, initialise settings
npm run dev
```

Open http://localhost:3000. **The portfolio starts empty — that is the
intended state.** No database to install, no credentials needed to get this
far.

No portfolio data is compiled into this app — every initiative, project,
person, decision and dependency comes from the database. The name in the
header is the one exception: it is three constants in `src/lib/brand.ts`,
because a name that changes roughly never is not worth a configuration
mechanism that can silently fail.

```ts
export const BRAND_NAME = 'MR Portfolio Control'
export const BRAND_ORG = 'Program Management · MediaRadar Product & Tech'
export const BRAND_TAGLINE = "Yael's Always Right"
```

### Filling it

Three independent things, in the order they usually happen:

| Command | What it loads | When |
|---|---|---|
| `npm run setup` | Schema, lifecycle gates, templates, discovery questions, a starting scoring model | Once, at install |
| `npm run sync:linear` | Initiatives, projects, milestones, dates, leads | Whenever; then on a schedule |
| *(the app itself)* | Assessments, decisions, dependencies, contention, intake, readiness | Continuously, by the program team |

`npm run seed:process` reloads only the process reference — safe to re-run on
a live system when your process changes. It is transcribed from MediaRadar's
program references site; edit `scripts/seed-process.ts` (or the rows) if yours
differs.

### Optional: an example portfolio

```bash
npm run seed:demo      # load a worked example
npm run db:reset       # back to empty
```

This loads a months-old snapshot transcribed from a real control room export.
It exists so the screens can be explored with something in them, and because
its stale dates exercise the overdue and staleness handling that freshly
invented data would not. Nothing in it is fabricated: readiness statuses,
prioritization scores, progress percentages and most headcounts are left empty
because they were not knowable from the source, and the screens say so rather
than rendering a confident zero.

### One caveat about the embedded database

PGlite runs *inside* the process that opens it. A running server holds its own
instance, so a CLI script's writes are on disk but invisible until you restart
the server — and two processes writing the same directory at once can corrupt
it. **Stop the server before running a sync or seed, then start it again.**
The scripts detect a running server and tell you.

None of this applies to a real Postgres, which is one more reason to move to
one as soon as more than one person is using the tool.

```bash
npm test          # 36 tests over the rules that would otherwise fail silently
npm run typecheck
npm run build
```

## The idea

Every portfolio tool in this space fails the same way: it mirrors the tracker,
so it shows you what the tracker already showed you, and the things that
actually sink a program — nobody owns this, two people disagree about that, one
engineer is on the critical path of four dated commitments — live in meeting
notes and somebody's head.

So this app is built around a hard split:

| Layer | Owner | Written by |
|---|---|---|
| Projects, initiatives, milestones, dates, leads | Linear / Sheets | sync only |
| Health assessments, decisions, dependencies, contention, intake, readiness | the program team | this app only |
| Field overrides | the program team | this app, merged over the sync at read time |

Two rules fall out of that, and they are the reason the tool is trustworthy:

**A human assessment always beats the tracker's health field, and an item
nobody has assessed reads as "needs input", never as green.** In a real
workspace the health field is empty far more often than it is honest. A
portfolio that renders green for "nobody looked" is worse than no portfolio.
When the source and the assessment disagree, both are shown and the conflict is
flagged rather than silently resolved.

**A correction typed here is never eaten by the next sync.** Sync writes only
source columns; people write only `field_overrides`; every read merges the two
and reports which fields were touched, by whom, and why. Pinned overrides (a
board-locked date) survive a source change; unpinned ones yield when the source
value itself moves — the most-recent-dated-source-wins rule, in code.

## Screens

| Route | What it answers |
|---|---|
| `/` | What is on fire, who is over-committed, what nobody has answered for |
| `/roadmap` | Initiative lanes, project bars coloured by assessed health, milestone diamonds, dated commitments |
| `/dependencies` | What has to be true first — layered graph, critical chain, cross-team matrix, manual entry |
| `/initiatives` | Drill-down per initiative with assessment reasoning |
| `/initiatives/<id>` | Everything about one initiative on one page: readiness, dependencies, decisions, people, prioritization, conversations — and the channels and meetings feeding it, editable in place |
| `/projects/<id>` | The same for one project: readiness item by item, milestones, dependencies split by direction, decisions, the lead's load, conversations |
| `/sources` | Conversation sources, transcripts, and the briefs generated from them |
| `/applications` | The same work by application, with the "who owes me an update" list |
| `/contention` | Named people spread across the portfolio; teams × initiatives |
| `/decisions` | The open-questions register, with contested items flagged |
| `/intake` | Request form, triage queue, approve-to-project |
| `/prioritization` | Weighted scoring with a capacity cut line |
| `/readiness` | The documented kick-off process, made checkable per project |
| `/templates` | The standard template library and the discovery question bank |
| `/changes` | Append-only log of every sync and hand edit |

The **Full / Lead** toggle in the header hides operational detail for a
leadership audience without maintaining a second set of screens.

## Connecting Linear

1. Create a read-only personal API key in Linear → Settings → Security &
   access. Put it in `.env` as `LINEAR_API_KEY`. Never commit it.
2. Check what your workspace exposes — the available fields differ by plan and
   API version, so the sync introspects rather than hard-coding a query:

   ```bash
   npm run sync:linear -- --probe
   ```

3. Backfill, then go incremental:

   ```bash
   npm run sync:linear            # full
   npm run sync:linear -- --since # only what changed since the last good run
   ```

4. For live updates, add a webhook in Linear → Settings → API → Webhooks
   pointing at `https://<your-host>/api/webhooks/linear`, subscribed to
   Projects, Initiatives and Project milestones. Put the signing secret in
   `LINEAR_WEBHOOK_SECRET`.

   The receiver verifies the HMAC against the raw body in constant time,
   rejects payloads older than 60s, and returns 200 on a handling error so
   Linear does not retry something that will fail identically every time — the
   scheduled sync is the backstop that repairs whatever a webhook missed.

5. Schedule reconciliation (cron, GitHub Actions, whatever you already run):

   ```bash
   curl -XPOST -H "Authorization: Bearer $SYNC_TOKEN" \
     https://<your-host>/api/sync/linear?since=1
   ```

Matching to existing records is by external id via the `source_records` table,
so a project can be backed by a Linear project *and* a row in a spreadsheet
without either source needing a special column.

## Other sources

**Google Sheets** — set `SHEETS_SOURCES` to a JSON array of
`{id, label, url, mapping}` (see `.env.example`) and POST `/api/sync/sheets`.
It uses the CSV export endpoint rather than the Sheets API, so wiring up a
tracker is a matter of sharing a link, not filing a Workspace admin ticket.
Initiatives are matched by name, never created, so a typo in a spreadsheet
cannot fork the portfolio's structure.

**Slack** — a slash command at `/api/slack/intake` files requests where the
conversation happens:

```
/portfolio-request Add LinkedIn coverage | Clients keep asking and we have no data | Brad
```

`POST /api/digest` posts a weekly summary through an incoming webhook; `GET`
the same route previews it without posting.

**Jira** — MUPP work lives in Jira today. There is no adapter yet; the
`source_records` design means adding one is a new file in `src/lib/sources/`
with the same shape as `linear.ts`, not a schema change.

## Google sign-in

Anyone with a Workspace account in an allowed domain can sign in; everyone who
signs in sees and edits everything. Their name is attached to every assessment,
decision and readiness edit, so the changelog says who rather than "manual".

### Setting it up

In Google Cloud Console, in the project you use for internal tools:

1. **APIs & Services -> OAuth consent screen** -> choose **Internal**. That
   alone restricts sign-in to your Workspace; the domain check below is the
   second lock.
2. **Credentials -> Create credentials -> OAuth client ID -> Web application.**
3. Add the redirect URI: `<APP_URL>/api/auth/callback` - exactly, including the
   scheme and port. `http://localhost:3000/api/auth/callback` for local tests.
4. Copy the client ID and secret into `.env`.

```bash
GOOGLE_CLIENT_ID=<from step 2>
GOOGLE_CLIENT_SECRET=<from step 2>
AUTH_ALLOWED_DOMAINS=mediaradar.com
AUTH_SECRET=<openssl rand -hex 32>
APP_URL=https://<where the app is served>
```

`AUTH_SECRET` signs the session cookie. Changing it signs everyone out, which
is also how you force that deliberately.

### How it behaves

| Situation | Result |
|---|---|
| `npm run dev`, no Google config | No sign-in. Zero-config local evaluation. |
| Production, no Google config | Every request gets 503 with an explanation. It will not serve unauthenticated. |
| Production behind an IAP that already authenticates | Set `AUTH_ALLOW_ANONYMOUS=true` |
| Signed in, wrong domain | Refused at the callback, with a message naming the reason |

Webhook, Slack and sync endpoints are deliberately exempt from the session
gate. Each carries its own, stronger authentication - an HMAC signature or the
`SYNC_TOKEN` bearer - and a browser session would be the wrong check for a
machine caller.


### If your Workspace has more than one domain

A Google Cloud Organization is named after the **Workspace account's primary
domain**, which is not necessarily the domain people use for email. A renamed
company typically keeps the original as primary and adds the new one as a
secondary, so the organisation shows up under the old name. That is normal and
it is the same Workspace — one organisation, all the users.

Two consequences:

- **List every domain** in `AUTH_ALLOWED_DOMAINS`, not just the current one.
  Some accounts may still sit under the old domain, and leaving it out locks
  those people out with no pattern anyone can see from the outside.
- **Leave `AUTH_GOOGLE_HD` unset.** It pre-filters Google's account chooser to a
  single domain, which breaks sign-in for everyone on the others. It is a
  convenience hint, never a security control.

To confirm which domains exist: Google Admin console → **Account → Domains →
Manage domains**. The one marked *primary* is what names the Cloud
Organization; every domain listed belongs to the same Workspace and is covered
by the **Internal** audience setting.

### Every route, and how it authenticates

Exposed to the internet, the app is its own security boundary. Nothing is open
except one health probe.

| Route | Caller | Authentication | Anonymous gets |
|---|---|---|---|
| All pages | A person | Google session cookie | 307 to `/signin` |
| `/signin`, `/api/auth/*` | A person signing in | The flow itself; PKCE + signed state + nonce | 200 (it must be reachable) |
| `/api/scores`, `/api/scoring-model` | The app's own UI | Google session cookie | 307 to `/signin` |
| `/api/webhooks/linear` | Linear | HMAC over the raw body, 60s replay window | 401 |
| `/api/slack/intake` | Slack | Slack v0 signature, 5 min replay window | 401 |
| `/api/sync/*`, `/api/digest` | Your scheduler | `SYNC_TOKEN` bearer | 401 |
| `/api/health` | Load balancer | **None, deliberately** | `{"ok":true}` |

`/api/health` is the one genuinely open endpoint, and it exists because Azure
App Service restarts an instance whose health check returns 401. It returns a
constant — no version, no uptime, no configuration state, no database check —
so it reveals nothing beyond "this process is serving HTTP".

The machine endpoints cannot use the Google session: Linear and Slack have no
browser and no Google account. Each authenticates its caller by a means
appropriate to that caller, and every one of them fails closed when its secret
is unset in production.

**Before exposing it publicly, confirm all four are set:** `AUTH_SECRET`,
`GOOGLE_CLIENT_SECRET`, `SYNC_TOKEN`, and `LINEAR_WEBHOOK_SECRET` (plus
`SLACK_SIGNING_SECRET` if you wire up Slack). Missing values fail closed rather
than open, but a webhook that 503s because its secret was never set looks like
a broken integration, not a security control.

### Why not Auth.js / NextAuth

The requirement is one provider, one allowed domain, no roles and no
credentials, which is most of what an auth library exists to handle. Auth.js
v5 is still beta and its peer dependencies do not yet list Next.js 16, so
installing it needs `--legacy-peer-deps` - a poor foundation for a tool another
team maintains.

What is here instead is the standard authorization-code flow with PKCE, using
`jose` for token verification: a signed state parameter, a nonce bound to the
ID token, ID token signature verification against Google's JWKS, issuer and
audience checks, the domain check, and a signed httpOnly session cookie. The
genuinely dangerous parts of authentication - storing passwords, resetting
them, linking identities - do not exist here, because Google is the identity
provider. `tests/auth.test.ts` covers the rules whose failure would be silent.

## Going to production

The prototype runs PGlite — real Postgres, compiled to WASM, stored in
`./.data`. Production is the same schema against a real server:

```bash
DATABASE_URL="postgresql://user:pass@host:5432/pcr" npm run db:migrate
```

There is no dialect switch and no second schema, because the prototype was
never on SQLite. `docker-compose.yml` brings up the app against Postgres if you
want that shape locally.

Before you expose it internally:

- **Set `SYNC_TOKEN`.** Without it the sync and digest endpoints refuse to run
  in production, but they are open in development.
- **Configure Google sign-in** (see above). Without it the app refuses to
  serve in production rather than failing open.
- **Back up the database.** The assessment, decision and dependency layers
  exist nowhere else — everything else can be re-synced from Linear, but those
  cannot.

Open items — cleanup, gaps and decisions still outstanding — are tracked in
[`BACKLOG.md`](BACKLOG.md).

### Deploying to Azure

**[`deploy/AZURE.md`](deploy/AZURE.md) is the full walkthrough**, and
`deploy/azure-up.ps1` creates the whole deployment in one run. The rest of this
section is the reasoning behind it.

The app is a standard containerised Next.js server, so nothing about Azure is
special — but three settings catch people out.

**Where it runs.** Build the image with the included `Dockerfile` and run it on
App Service (Web App for Containers) or Container Apps. For App Service, set
`WEBSITES_PORT=3000` so the platform probes the port the container listens on;
without it you get a container-start failure that says nothing useful.

**The database.** Azure Database for PostgreSQL, Flexible Server. Its
certificate comes from a public CA that Node already trusts, so:

```bash
DATABASE_URL=postgresql://user:pass@yourserver.postgres.database.azure.com:5432/pcr
DATABASE_SSL=require
```

Allow the app's outbound IP in the server's firewall rules, or put both on the
same VNet. Then run the migration once, from anywhere that can reach it:

```bash
DATABASE_URL=... DATABASE_SSL=require npm run db:migrate
DATABASE_URL=... DATABASE_SSL=require npm run seed:process
```

**The URLs must agree.** `APP_URL` has to be the real public hostname, and the
redirect URI registered in Google must be exactly `<APP_URL>/api/auth/callback`.
If you use a custom domain, register both it and the `*.azurewebsites.net`
hostname — one OAuth client can hold several redirect URIs, and having both
means the app keeps working while DNS is still propagating.

Set every environment variable as an App Service **Application setting**
(Container Apps: an environment variable or secret reference). `AUTH_SECRET`,
`GOOGLE_CLIENT_SECRET` and `LINEAR_API_KEY` belong in Key Vault with a
reference, not typed into the portal as plain text.

Deploying to Azure changes nothing about Google sign-in. The Google Cloud
project exists only to hold the OAuth client registration; no code or data
runs there.

## Layout

```
src/
  db/schema.ts          all tables; no Postgres enums, so vocabularies are editable
  db/client.ts          driver selection — PGlite or node-postgres
  lib/domain.ts         vocabularies, labels, health resolution, scoring
  lib/merge.ts          override merge rules (pure, tested)
  lib/overrides.ts      the database side of the same
  lib/portfolio.ts      the read model every screen uses
  lib/timeline.ts       timeline geometry
  lib/graph.ts          dependency layering, cycle breaking, critical chain
  lib/readiness.ts      lifecycle gates read model
  lib/sources/          linear, sheets, slack — I/O split from pure logic
  app/                  one directory per screen
tests/logic.test.ts     the rules that would otherwise fail silently
```

The pure/I-O split in `lib/` is deliberate: the merge rules, CSV parsing,
signature verification and Linear value mapping have no database imports, so
they are directly testable and the test run needs no fixtures.

## Known gaps

- **No roles.** Everyone who signs in can edit everything, which is what
  "anyone internal" means. A read-only role is a contained change if leadership
  ends up viewing it widely and you want to prevent accidental edits.
- **No Jira adapter yet**, though MUPP is where the Unified Platform Program
  work actually lives.
- **The seed is a stale snapshot, and says so.** Once Linear sync runs, the
  delivery layer is matched by external id; seeded projects that do not exist
  in Linear stay as manual records rather than being reconciled automatically.
  Nothing in the seed is invented — see "What the seed data actually is" above.
- **Scoring is single-scorer.** The schema supports per-person scores
  (`scores.scorerId`), but the UI writes one set. Multi-scorer averaging with
  visible disagreement is the natural next step, and disagreement between
  scorers is usually the most interesting thing in the room.

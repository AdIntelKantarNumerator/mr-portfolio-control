# Backlog

Open items from getting this deployed. Kept in the repo rather than a chat
thread or a head, because the ones that matter are the ones still outstanding
in three months.

Ordered by what it costs to leave undone, not by effort.

---

## Security and hygiene

- [ ] **Delete `.azure-deployment.txt`** once the database password and
      `SYNC_TOKEN` are in a password manager. It is gitignored, but it is
      plaintext on a laptop.
- [ ] **Remove the laptop's database firewall rule.** Only needed while running
      migrations from a workstation; the app reaches Postgres through the
      allow-Azure-services rule.
      `az postgres flexible-server firewall-rule delete -g rg-mr-portfolio-control -s mr-portfolio-control-pg --rule-name admin-laptop --yes`
- [ ] **Move secrets into Key Vault references.** App settings are readable by
      anyone with Contributor on the resource group. `AUTH_SECRET`,
      `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`, `SYNC_TOKEN`, `LINEAR_API_KEY`.
      Steps in `deploy/AZURE.md`.
- [ ] **Stop using the registry admin credential.** Give the web app a managed
      identity, grant it `AcrPull`, then `az acr update --admin-enabled false`.
      Commands in `deploy/AZURE.md`.

The database password was rotated after being pasted into a chat. Nothing else
has been exposed; the Linear key and Google secret were pushed from `.env`
without ever being displayed.

## Source control

- [ ] **Get this into GitHub.** It exists as one local repo with a single
      "Initial commit from Create Next App" — every change since is uncommitted
      on one laptop, which is the single largest risk to the work so far.

      Checked already: `.env` and `.azure-deployment.txt` are gitignored and
      appear nowhere in the history, so the existing history is safe to push
      as-is.

      Worth deciding at the same time:
      - Private repo under the MediaRadar org, not a personal account.
      - Whether deploys should run from GitHub Actions rather than a laptop.
        `deploy/azure-up.ps1` would become a workflow; the only secret it needs
        is an Azure credential.

## Where this actually lives

- [ ] **Decide the permanent home.** It is on `MediaRadar-VXC-Dev-01`, a dev
      subscription. The assessments, decisions and dependency links people
      enter exist nowhere else and cannot be re-synced — unlike everything from
      Linear. Dev subscriptions get cleaned up.
- [ ] **Set a budget alert** on `rg-mr-portfolio-control`. ~$35/month is easy
      to forget about.
- [ ] **Raise Postgres backup retention** from the default 7 days once this is
      the system of record for decisions. `--backup-retention 35`.
- [ ] Optional: a real hostname instead of `*.azurewebsites.net`. Requires
      updating `APP_URL` and adding the matching redirect URI in Google.

## Conversation briefs — what is built and what is not

Built: attaching Slack channels, meeting series and documents to initiatives
and projects; pasting or uploading transcripts; generating briefs with
Anthropic; bullets categorised as decision / open issue / risk / change, each
citing the transcripts it came from; per-source opt-in, off by default.

- [ ] **Choose a summariser provider.** Azure OpenAI (in-tenant), Gemini or
      Anthropic — all three are implemented behind one interface, chosen by
      environment variable. Azure is the shortest path here: the subscription
      already exists, nothing leaves the tenant, and no third-party data review
      is needed. The feature is inert until one is configured, so this decides
      itself whenever someone wants briefs, not before.
- [ ] **Automatic Slack ingestion.** The linking model is built; fetching
      channel history needs a Slack app with `channels:history` and a bot
      token, which needs workspace approval. Until then, paste.
- [ ] **Automatic meeting ingestion.** Needs Google Workspace admin: a service
      account with domain-wide delegation, or OAuth per organiser. See the note
      in the README on why a Meet link is not a usable handle.
- [ ] **Roles.** Briefs make the missing read-only role matter more than it did:
      a summary of a leadership conversation is readable by everyone with a
      company account the moment it is generated.
- [ ] **Cost ceiling.** Nothing caps how often briefs are regenerated. Worth a
      per-day limit before this is open to the whole team.

## Gaps in the tool


- [ ] **No way to add a decision.** The decisions register renders but has no
      entry form — the only tab of the four data-entry areas without one.
      Dependencies, intake and readiness all have forms.
- [ ] **No Linear webhook.** Needs a Linear admin. Without it the portfolio is
      current as of the last scheduled sync rather than to the minute. The
      hourly pull covers most of the gap; the webhook is a two-minute job for
      whoever has admin.
- [ ] **No Jira adapter.** MUPP lives in Jira and is invisible to this tool.
- [ ] **Scoring is single-scorer.** No way to capture two people's scores on the
      same criterion and see the spread, which is usually where the real
      disagreement is.
- [ ] **No read-only role.** Anyone who can sign in can edit anything.

## Process, not code

- [ ] **Who owns the weekly assessment pass?** Still unanswered from the user
      guide. Whether it sits with program management or each project lead
      changes what the tool needs to make easy. Until someone owns it, the
      health data goes stale and the tool degrades into a Linear mirror.
- [ ] **Watch for `partial` sync runs.** A `partial` status means specific
      projects failed to map and the warnings name them — that is the sync
      reporting something about the workspace, not a fault to ignore.
      `GET /api/sync/linear` with the sync token.

## Possible later

- [ ] Run migrations from the container at startup, so deploying a schema
      change does not require a workstation with database access.
- [ ] Per-viewer saved filters, if people start asking for the same views.

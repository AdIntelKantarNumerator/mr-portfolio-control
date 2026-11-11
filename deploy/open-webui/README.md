# Ask Yaara

The portfolio's home page has an **Ask Yaara** button. It opens a chat panel
on the right of the portfolio (`src/components/yaara-panel.tsx`), signed in
as whoever is signed in to the portfolio, which stays open across pages and
tells Yaara which page you are on. **Open Full Chat** at the top of the panel
opens [Open WebUI](https://github.com/open-webui/open-webui) in its own window,
with its own Google sign-in, for long conversations and chat history; this
folder is about that window. In both, Yaara is the only model. She answers with the
same agent and tools she uses in Slack, and two more made for this chat: one
reads the rest of the portfolio (intake, prioritization, dependencies,
readiness, teams, activity, the workflow map, the data dictionary), and one
asks the workflow map what a change would affect.

## How it fits together

Why the panel is not Open WebUI in a frame: Open WebUI lives on its own
address, `azurewebsites.net` is a public suffix so the browser treats the two
as unrelated sites, a framed copy would get its own partitioned sign-in, and
Google's sign-in page refuses to load in a frame at all. So the panel asks
through the portfolio itself (`POST /api/ask-yaara`) over the same relay:

```
 panel      ─► portfolio /api/ask-yaara                (portfolio sign-in)
 person ─► Open WebUI ─► portfolio /api/yaara/v1/chat/completions
                              │  queues the question (yaara_chats)
                              ▼
                         /api/agent/chat ◄── Yaara collects it, outbound,
                              │              answers, posts progress and reply
                              ▼
          streamed back: her progress as a collapsible "working" line,
          then her answer
```

Yaara is never called. She is deliberately unreachable from outside her
cluster, which is also why her Slack chat runs over Socket Mode, and the seam
between the two repositories is that she calls the portfolio and it never
calls her. So the portfolio holds each question until she collects it, over a
request she keeps open for that. `src/lib/yaara-chat.ts` has the longer
version.

Who is asking is checked twice. `YAARA_CHAT_TOKEN` proves the request came
from our Open WebUI. A short-lived token Open WebUI signs for each request
proves who the person is, and the portfolio checks it with
`YAARA_CHAT_USER_SECRET` and lets in only `AUTH_ALLOWED_DOMAINS`, the same rule
as signing in to the portfolio.

What a person may have her **do** follows Slack's rule. People on Yaara's
`YAARA_WEB_TRUSTED_EMAILS` count as asking her directly; everyone else's
requests are treated as her own objectives. It is empty by default.

## The files here

| File | What it is |
|---|---|
| `settings.env` | Every Open WebUI setting that is not a secret, with why. Pinned to 0.11.4. |
| `yaara-model.json` | Her description, suggested questions and switched-off capabilities. |
| `model-metadata.mjs` | Turns that into the two Open WebUI settings that carry it. |
| `configure-model.mjs` | One-off: saves her model entry so Open WebUI shows her picture. |
| `chat-up.ps1` | Deploys it all to Azure. |
| `run-local.sh` | Runs Open WebUI locally against the local portfolio. |

## Deploying to Azure

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\open-webui\chat-up.ps1
```

It creates or updates, without printing a secret:

- three generated secrets in `kv-mr-portfolio-web`, and two copied there from
  the portfolio (its Google client secret, and a connection string to a new
  `openwebui` database on the same Postgres server)
- a web app `mr-portfolio-chat` on **its own B1 plan**, running
  `ghcr.io/open-webui/open-webui:v0.11.4-slim`. Open WebUI uses about 700 MB,
  measured on 1 October 2026, and the portfolio's plan has 1.75 GB for
  everything on it. Its own plan costs one more B1. `-Plan
  mr-portfolio-control-plan` shares the portfolio's instead.
- `YAARA_CHAT_TOKEN`, `YAARA_CHAT_USER_SECRET` and `YAARA_CHAT_URL` on the
  portfolio, which makes the button appear

Then, by hand:

1. Add `https://mr-portfolio-chat.azurewebsites.net/oauth/google/callback` to
   the portfolio's Google OAuth client, beside the portfolio's own.
2. Deploy Yaara: her web chat worker ships with her and starts when
   `PORTFOLIO_URL` and `PORTFOLIO_TOKEN` are set, which they are.
3. Sign in to the chat **first as whoever should administer it**. The first
   account becomes the Open WebUI admin.
4. Give her her picture: create an API key in Settings, Account, then
   ```powershell
   $env:OPEN_WEBUI_URL = 'https://mr-portfolio-chat.azurewebsites.net'
   $env:OPEN_WEBUI_TOKEN = '<the key>'
   node deploy\open-webui\configure-model.mjs
   ```
   Or by hand in Workspace, Models, Yaara: upload `public/brand/yaara-128.png`.

## Running it locally

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv open-webui==0.11.4
deploy/open-webui/run-local.sh .venv/Scripts/open-webui.exe
```

It reads `YAARA_CHAT_TOKEN`, `YAARA_CHAT_USER_SECRET` and `WEBUI_SECRET_KEY`
from `../.yaara-chat-local.env`, outside the repository, and the portfolio dev
server must be started with the same two `YAARA_CHAT_*` values. Locally there
is no Google sign-in: Open WebUI runs as one automatic user, and the portfolio
still receives a signed token for that user. Yaara needs `PORTFOLIO_URL` set to
`http://localhost:3000` to collect the questions.

## Branding

The window's title is "Yaara (Open WebUI)". Open WebUI adds the suffix itself,
and its licence forbids removing or altering its branding for deployments
above 50 users in any 30 days without an enterprise licence. So the
model is Yaara, with her name, picture and description, and the Open WebUI
name stays where Open WebUI puts it.

## Report Builder (prototype)

The relay lists a second model, **Report Builder** (`report-builder`), for
setting up custom advertising reports and data extracts by conversation.
Questions to it are answered by the portfolio itself
(`src/lib/report-builder/`), not queued for Yaara: a model with tools runs the
skill (`skill.ts`) over a report engine on sample data (`engine.js`; real
advertiser and media names, illustrative figures, nothing read from
ClickHouse). Saved reports are kept per person in `report_builder_users`, and
each chat's report in progress in `report_builder_chats`.

Who may use it: people with **Prototypes** ticked in Admin, Roles & access. It
is its own checkbox, not a role and not implied by Admin. The same flag shows
the **Prototypes** section in the left nav, whose **Report Builder** page opens
this chat with the model chosen (`/?model=report-builder`). Open WebUI fetches
the model list once for everyone, so others can see Report Builder in the model
picker; if they ask it something, it tells them it is not switched on for them.

To turn it on in Azure:

1. Give Report Builder a model that can call tools. The intended one is
   Claude through the portfolio's existing OpenRouter key, on the US Bedrock
   and Azure hosts already on the verified list (the same route Yaara uses for
   her advanced model). Its own settings, so the everyday and advanced models
   do not move:

   ```powershell
   az webapp config appsettings set -g rg-mr-portfolio-control -n mr-portfolio-control --settings `
     REPORT_BUILDER_MODEL=anthropic/claude-sonnet-5.5 `
     REPORT_BUILDER_PROVIDERS=amazon-bedrock/us-east-1,azure/us
   ```

   `anthropic/claude-haiku-5.5` is the cheaper choice (about a twentieth of
   the price) and follows the interview less reliably. An Anthropic key of its
   own (`ANTHROPIC_API_KEY`) also works and takes precedence;
   `REPORT_BUILDER_PROVIDER` forces one or the other. With no model that can
   run it, Report Builder is not listed.
2. Deploy the portfolio. Migration `0042_prototypes` runs on start.
3. Run `configure-model.mjs` again (as in "Deploying to Azure", step 4). It now
   also saves Report Builder's own name, description and starter questions
   from `report-builder-model.json`; without that entry Open WebUI would show
   Yaara's.
4. Tick **Prototypes** for each person in Admin.

The spreadsheet link in an answer points at
`/prototypes/report-builder/export` on the portfolio, which recomputes the
report for whoever opens it, so it needs their portfolio sign-in too.

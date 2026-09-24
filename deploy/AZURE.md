# Deploying to Azure

The result is a public HTTPS site at `https://<name>.azurewebsites.net` that
shows nothing to anyone who has not signed in with a Google Workspace account
on an allowed domain. No VPN, no IP allow-list — the authentication *is* the
boundary, which is why it is worth being precise about it.

Two paths below. The script does the same thing as the manual steps; use the
manual list if you want to see each piece appear, or if your account is
restricted to a resource group someone else created.

---

## Before you start

| | |
|---|---|
| Azure CLI | `winget install Microsoft.AzureCLI`, then `az upgrade` and `az login` |
| Permission | Contributor on the subscription, or on an existing resource group |
| Docker | **Not needed.** The image is built inside Azure |
| Google | The OAuth client you already tested with locally |

Pick a name first — it has to be unique across all of Azure and it becomes
the hostname: `mr-portfolio-control` → `https://mr-portfolio-control.azurewebsites.net`.

Roughly $33–38/month at list price: B1 app plan ~$13, B1ms Postgres ~$12,
32 GB of database storage ~$4, Basic registry ~$5. An enterprise agreement
discounts that. Everything scales up later without redeploying.

---

## The short path

From the repository root, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\azure-up.ps1 -App mr-portfolio-control
```

The `-ExecutionPolicy Bypass` is there because Windows refuses to run script
files by default, and a file that arrived inside a downloaded zip stays blocked
even after you relax the policy. This form sidesteps both without changing
anything on the machine.

It asks for the Google client ID and secret, then creates the resource group,
the container registry, Postgres, the app plan and the web app — about
10 minutes, most of it the first image build. Everything it generates
(`AUTH_SECRET`, `SYNC_TOKEN`, the database password) is written to
`.azure-deployment.txt`, which is gitignored.

Then finish with [step 4](#4-tell-google-about-the-new-address) and
[step 5](#5-create-the-schema) below — those two cannot be scripted, because
one happens in Google's console and the other needs the database to exist.

Re-running the script later rebuilds the image and redeploys. It reuses the
existing secrets, so nobody is signed out.

---

## The manual path

### 1. Resource group, registry, image

```powershell
$rg   = 'rg-mr-portfolio-control'
$app  = 'mr-portfolio-control'
$acr  = 'mrportfoliocontrolacr'     # letters and digits only
$loc  = 'eastus'

az group create -n $rg -l $loc
az acr create -g $rg -n $acr --sku Basic --admin-enabled true
az acr build -r $acr -t mr-portfolio-control:latest .
```

`az acr build` uploads this folder and builds the Dockerfile in Azure.
`.dockerignore` keeps `.env` and the local `.data` database out of the upload —
worth knowing, because without it your local Google client secret would be
baked into the image.

### 2. Database

```powershell
az postgres flexible-server create `
  -g $rg -n "$app-pg" -l $loc `
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 `
  --admin-user pcradmin --admin-password '<a long random password>' `
  --public-access 0.0.0.0 --yes

az postgres flexible-server db create -g $rg -s "$app-pg" -d pcr
```

The database is a separate step on purpose. `flexible-server create` used to take
`--database-name`, but recent CLI versions reserve that flag for elastic
clusters and reject it on an ordinary server.

`--public-access 0.0.0.0` reads alarmingly but means *allow Azure services
only* — it is how App Service reaches the database without a VNet. Nothing on
the open internet can connect.

To run the migrations from your laptop you also need your own address through:

```powershell
$ip = (Invoke-RestMethod 'https://api.ipify.org?format=json').ip
az postgres flexible-server firewall-rule create `
  -g $rg -s "$app-pg" --rule-name admin-laptop --start-ip-address $ip --end-ip-address $ip
```

Note `-s` for the server here, where the create command above takes `-n`. The
`postgres flexible-server` command group is inconsistent about this and has
changed across CLI versions; if one spelling is rejected, try the other.

### 3. Web app

```powershell
az appservice plan create -g $rg -n "$app-plan" --is-linux --sku B1

$server = az acr show -n $acr --query loginServer -o tsv
$user   = az acr credential show -n $acr --query username -o tsv
$pass   = az acr credential show -n $acr --query 'passwords[0].value' -o tsv

az webapp create -g $rg -p "$app-plan" -n $app `
  --container-image-name "$server/mr-portfolio-control:latest"

az webapp config appsettings set -g $rg -n $app --settings `
  "DOCKER_REGISTRY_SERVER_URL=https://$server" `
  "DOCKER_REGISTRY_SERVER_USERNAME=$user" `
  "DOCKER_REGISTRY_SERVER_PASSWORD=$pass"

az webapp config container set -g $rg -n $app `
  --container-image-name "$server/mr-portfolio-control:latest"
```

If either `--container-image-name` is rejected, your CLI is older than the
rename: use `--deployment-container-image-name` on `webapp create` and
`--docker-custom-image-name` on `webapp config container set`.

Avoid the `--linux-fx-version "DOCKER|<image>"` form you will find in older
guides. It works, but the value contains a pipe, and `az` on Windows is a
`.cmd` file that PowerShell runs through `cmd.exe` — which reads that pipe as a
pipe and mangles the command.

Then the settings. `WEBSITES_PORT` is the one people forget: without it App
Service probes port 80, gets nothing, and reports a container that failed to
start.

```powershell
az webapp config appsettings set -g $rg -n $app --settings `
  WEBSITES_PORT=3000 `
  WEBSITES_CONTAINER_START_TIME_LIMIT=600 `
  "DATABASE_URL=postgresql://pcradmin:<password>@$app-pg.postgres.database.azure.com:5432/pcr" `
  DATABASE_SSL=require `
  "APP_URL=https://$app.azurewebsites.net" `
  "AUTH_SECRET=<64 random characters>" `
  "AUTH_ALLOWED_DOMAINS=mediaradar.com,magazineradar.com" `
  "GOOGLE_CLIENT_ID=<from Google>" `
  "GOOGLE_CLIENT_SECRET=<from Google>" `
  "SYNC_TOKEN=<48 random characters>"

az webapp update -g $rg -n $app --https-only true
az webapp config set -g $rg -n $app --always-on true --min-tls-version 1.2 --ftps-state Disabled
```

In the portal, set **Monitoring → Health check** to `/api/health`. That is the
only path that answers without a session; any other path returns 401 and would
put the app in a restart loop.

### 4. Tell Google about the new address

Google Cloud Console → **APIs & Services → Credentials** → your OAuth client →
**Authorised redirect URIs** → Add:

```
https://mr-portfolio-control.azurewebsites.net/api/auth/callback
```

Keep `http://localhost:3000/api/auth/callback` in the list too, so local work
still runs. Save. It usually takes effect immediately, occasionally a few
minutes.

The redirect URI has to match `APP_URL` exactly — scheme, host, path, no
trailing slash. A mismatch shows up as Google's `redirect_uri_mismatch` screen
before the app is ever reached.

### 5. Create the schema

The container has no migration runner in it, so run this from your laptop
against the Azure database:

```powershell
$env:DATABASE_URL = 'postgresql://pcradmin:<password>@mr-portfolio-control-pg.postgres.database.azure.com:5432/pcr'
$env:DATABASE_SSL = 'require'

npm.cmd run db:migrate      # tables
npm.cmd run seed:process    # lifecycle gates, templates, scoring model
npm.cmd run init            # settings defaults
```

Then close that PowerShell window, or the connection string stays in the
session's environment.

`seed:process` loads process scaffolding only — no projects, no people, no
scores. The portfolio starts empty and fills from Linear sync and data entry,
which is the point.

### 6. Open it

<https://mr-portfolio-control.azurewebsites.net>

You should land on the sign-in page. Sign in with your work Google account and
you are in.

---

## Shipping a schema change to a running deployment

Different from a first deploy in one way that matters: **migrate before you
deploy, not after.** The new code queries tables the old database does not have,
so deploying first gives you a working-looking app with 500s on whichever pages
touch the new tables. Migrating first is harmless — the old code simply ignores
tables it does not know about.

### 1. Check the new code is actually on disk

Sounds unnecessary; is not. Half an hour has been lost to building the old code
twice because an unzip went somewhere unexpected.

```powershell
cd <repo>
Select-String -Path .\src\db\schema.ts -Pattern 'agent_observations' -Quiet   # expect True
Get-ChildItem .\drizzle\*.sql | Select-Object -Last 3                          # expect the new ones
```

```powershell
npm install
npm run typecheck
```

`npm install` first: a missing `node_modules/.bin` is what produces
`'tsx' is not recognized`, which looks like a broken script and is not.

### 2. Let this machine reach the database

Needed only while migrating, and only if the rule was removed.

```powershell
$ip = (Invoke-RestMethod https://api.ipify.org?format=json).ip
az postgres flexible-server firewall-rule create -g rg-mr-portfolio-control `
  -s mr-portfolio-control-pg --rule-name admin-laptop `
  --start-ip-address $ip --end-ip-address $ip
```

If `--rule-name` is rejected, the CLI is older: use `-n admin-laptop`. If `-s` is
rejected, use `--name` for the server and `-n` for the rule — the two flags
swapped meanings between versions.

### 3. Migrate

Two variables, not one. `DATABASE_SSL` is what turns TLS on; without it the
scripts connect unencrypted and Azure refuses with `no pg_hba.conf entry for
host ... no encryption`, which reads like a firewall problem and is not — a real
firewall block times out instead of answering.

**`-AsSecureString` is not optional.** A plain `Read-Host` echoes what you type,
so the password ends up on screen, in the scrollback, and in any screenshot of
that window.

```powershell
$sec = Read-Host "DATABASE_URL" -AsSecureString
$env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$env:DATABASE_SSL = 'require'

npm.cmd run db:migrate
```

`npm.cmd` rather than `npm`: the execution policy on a managed Windows machine
blocks npm's PowerShell shim, and the `.cmd` entry point skips it.

**Read the last line before continuing.** It says which database it touched:

- `Migrated Postgres at postgresql://...@mr-portfolio-control-pg...` — correct.
- `Migrated embedded Postgres (PGlite) at ./.data/pcr` — it migrated the local
  prototype database and Azure is untouched. `$env:DATABASE_URL` was not set in
  *this* shell. This failure is silent and looks like success.

Confirm the tables landed:

```powershell
az postgres flexible-server execute -n mr-portfolio-control-pg -d pcr `
  -u pcradmin -q "\dt" --output table
```

### 4. Build and deploy

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\azure-up.ps1 `
  -App mr-portfolio-control -ResourceGroup rg-mr-portfolio-control
```

Idempotent: it re-uses everything that exists, builds the image in ACR and
restarts the web app. It does not need any new settings for this change — the
agent endpoints authenticate with the `SYNC_TOKEN` that is already there.

### 5. Check it, then tidy up

Open any initiative. The Yaara card should be present and say she has not
published anything yet — that is the correct state before she is running, and it
proves the new table is readable.

```powershell
Remove-Item env:DATABASE_URL, env:DATABASE_SSL -ErrorAction SilentlyContinue
az postgres flexible-server firewall-rule delete -g rg-mr-portfolio-control `
  -s mr-portfolio-control-pg --rule-name admin-laptop --yes
```

Then commit and push, so the deployed image and the repository agree.

## When it does not work

`az webapp log tail -g $rg -n $app` streams the container's stdout, which is
where the app explains itself.

| What you see | What it is |
|---|---|
| "Application Error" / blank page | Container never started. Check `WEBSITES_PORT=3000` |
| Google's `redirect_uri_mismatch` | `APP_URL` and the registered redirect URI differ |
| "That account is outside the organisation" | The log line names the domain Google actually sent — add it to `AUTH_ALLOWED_DOMAINS` |
| 503 on every page | Auth is not configured; the app refuses to serve unauthenticated in production rather than falling open |
| Timeouts on every page that reads data | Database unreachable. Confirm the Azure-services firewall rule and `DATABASE_SSL=require` |
| `The location is restricted from performing this operation` on the database | The subscription may not create *that resource type* in *that region* — unrelated to whether the region works generally. The script probes alternatives and names one; re-run with `-PgLocation <region>`. Postgres does not have to sit in the same region as everything else |
| `UnicodeEncodeError: 'charmap' codec can't encode character` during `az acr build` | The CLI crashed *printing* the log, not building. Next.js emits a character the Windows console code page has no room for. `$env:PYTHONIOENCODING = 'utf-8'` before the build fixes it; the script sets it already |

The domain-mismatch line in the log is deliberate: the browser is told only
that the account is outside the organisation, because echoing valid domains
back to anonymous visitors tells a prober what to aim at. Whoever is setting it
up gets the detail in the log instead.

---

## Afterwards

**Redeploy after a code change**

```powershell
.\deploy\azure-up.ps1 -App mr-portfolio-control
```

or by hand: `az acr build -r $acr -t mr-portfolio-control:latest .` then
`az webapp restart -g $rg -n $app`.

**Linear webhook** — Linear → Settings → API → Webhooks, pointed at
`https://<host>/api/webhooks/linear`, subscribed to Projects, Initiatives and
Project milestones. Put the signing secret in `LINEAR_WEBHOOK_SECRET` and the
personal API key in `LINEAR_API_KEY` (both as app settings), then restart.
Requests with a bad signature are rejected, which is what keeps that endpoint
safe to leave open.

**Scheduled sync** — created for you as a Consumption Logic App named
`<app>-sync`, calling:

```
POST https://<host>/api/sync/linear
Authorization: Bearer <SYNC_TOKEN>
```

The endpoint answers 202 straight away and runs the sync in the background,
because a first backfill can outlast App Service's ~230-second request ceiling
— a synchronous sync gets cut off mid-write and reported as a 502 that tells
you nothing. The outcome goes to `sync_runs`; `GET /api/sync/linear` (same
bearer token) reports the latest run. Only one sync runs at a time: a second
request while one is in flight gets 409 rather than racing it.

Hourly by default; `-SyncIntervalHours 4` to slow it down, `-NoSyncSchedule`
to skip it. It is created *disabled* until `LINEAR_API_KEY` is set on the app,
so it does not fail on a timer against an app that cannot sync — set the key
and re-run the script to enable it.

This is the pull half of the Linear integration and needs no Linear admin.
The webhook above is the push half and does. With only the pull, the portfolio
is current as of the last run rather than to the minute, which for planning
conversations is usually close enough. Every run is recorded in `sync_runs`,
so staleness is visible rather than assumed.

**A real hostname** — `az webapp config hostname add`, then
`az webapp config ssl create` for a free managed certificate. Change `APP_URL`
to the new address and add the matching redirect URI in Google, or sign-in
breaks the moment people start using the new name.

**Secrets in Key Vault** — app settings are readable by anyone with
Contributor on the resource group. To narrow that, create a vault, store
`AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`, `SYNC_TOKEN` and
`LINEAR_API_KEY` in it, give the web app a managed identity, grant it
**Key Vault Secrets User**, and replace each setting's value with
`@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/<name>/)`.
The app reads them exactly as before. Worth doing once the deployment is real;
not worth blocking the first deploy on.

**Registry credentials** — the script uses the registry's admin user, which is
simple and works everywhere. To remove that credential entirely, switch the
web app to pull with its managed identity:

```powershell
az webapp identity assign -g $rg -n $app
$principal = az webapp identity show -g $rg -n $app --query principalId -o tsv
$acrId     = az acr show -n $acr --query id -o tsv
az role assignment create --assignee $principal --role AcrPull --scope $acrId
az resource update --ids "$(az webapp show -g $rg -n $app --query id -o tsv)/config/web" `
  --set properties.acrUseManagedIdentityCreds=true
az acr update -n $acr --admin-enabled false
```

**Backups** — Postgres Flexible Server keeps 7 days of automatic backups by
default. `az postgres flexible-server update --backup-retention 35` if this
becomes the system of record for decisions, which over time it will.

**Tearing it all down** — `az group delete -n $rg --yes` removes every
resource above and stops all charges.

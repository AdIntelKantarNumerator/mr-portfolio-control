<#
  Creates the whole Azure deployment from nothing, in one run.

  What it makes:
    resource group - container registry - Postgres Flexible Server
                   - Linux App Service plan - Web App for Containers

  It is safe to run more than once: every step is create-if-absent, and the
  generated secrets are only generated on the first run (after that they are
  read back from the app's own settings, so re-running does not sign everyone
  out or break the Linear webhook).

  Run it from the repository root:

      powershell -ExecutionPolicy Bypass -File .\deploy\azure-up.ps1 -App mr-portfolio-control

  Prerequisites:
    - Azure CLI 2.60 or newer   (winget install Microsoft.AzureCLI; az upgrade)
    - az login                  (an account that can create resources)
    - Contributor on the subscription, or on a resource group you pass in

  You do NOT need Docker installed. The image is built by Azure Container
  Registry from the source in this folder.

  Written for Windows PowerShell 5.1, which is what ships with Windows, so it
  avoids anything that only parses on PowerShell 7.
#>

[CmdletBinding()]
param(
  # Must be globally unique: it becomes https://<App>.azurewebsites.net
  [Parameter(Mandatory = $true)][string]$App,

  [string]$ResourceGroup = "rg-$App",
  [string]$Location      = 'eastus',

  # Postgres can live in a different region from everything else. Subscriptions
  # are often restricted per resource type — a region that happily takes a
  # resource group and a registry can still refuse a database server — and
  # policy sometimes allows only a specific list. Latency between two US
  # regions is a few milliseconds, which this app will never notice.
  [string]$PgLocation    = '',

  # Registry names allow letters and digits only.
  [string]$Registry      = ($App -replace '[^a-zA-Z0-9]', '') + 'acr',
  [string]$PgServer      = "$App-pg",
  [string]$PgDatabase    = 'pcr',
  [string]$PgAdmin       = 'pcradmin',

  [string]$AllowedDomains = 'mediaradar.com,magazineradar.com',

  # This machine's public IP, for the database firewall rule that lets the
  # migrations run from here. Looked up automatically when not given; pass it
  # when the lookup is blocked, or when you are behind a VPN whose exit address
  # differs from what a lookup service reports.
  [string]$MyIp = '',

  # B1 is the smallest plan with Always On. P0v3 if it feels slow.
  [string]$PlanSku      = 'B1',
  [string]$PgSku        = 'Standard_B1ms',
  [string]$ImageTag     = (Get-Date -Format 'yyyyMMdd-HHmm'),

  # How often the scheduled Linear sync runs, in hours.
  [ValidateRange(1, 24)][int]$SyncIntervalHours = 1,

  # Skip creating the scheduled sync entirely.
  [switch]$NoSyncSchedule,

  # Reuse the image already in the registry instead of building again. For
  # picking up after a run that failed somewhere past the build — it saves the
  # several minutes a rebuild costs when the code has not changed.
  [switch]$SkipBuild
)

# Deliberately NOT 'Stop'. Windows PowerShell turns anything a native command
# writes to stderr into an error record, and the Azure CLI writes ordinary
# progress and deprecation notices there — with 'Stop' the script dies on a
# warning. Every az call below is checked by its exit code instead, which is
# the only signal that actually means failure.
$ErrorActionPreference = 'Continue'

# The Azure CLI is a Python program, and on Windows it writes its output
# through the console's legacy code page (cp1252). The Next.js build prints a
# triangle character, which cp1252 cannot represent, so the CLI dies with a
# UnicodeEncodeError while PRINTING a build that is otherwise succeeding.
# Telling Python to use UTF-8 removes the failure at its source.
$env:PYTHONIOENCODING = 'utf-8'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$image = 'mr-portfolio-control'
$plan  = "$App-plan"

function Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Note($text) { Write-Host "    $text" -ForegroundColor DarkGray }

# Rewrites a command line for display with the secrets taken out. An error
# message gets pasted into chat, a ticket or a screen share far more often than
# anyone intends, and a failed command is exactly when that happens.
function Hide-Secrets($parts) {
  $flagsWithSecretValue = '^--(admin-password|container-registry-password|docker-registry-server-password)$'
  $secretSettings = '^(DATABASE_URL|AUTH_SECRET|SYNC_TOKEN|GOOGLE_CLIENT_SECRET|DOCKER_REGISTRY_SERVER_PASSWORD|LINEAR_API_KEY|LINEAR_WEBHOOK_SECRET|syncToken)='
  $safe = @()
  $maskNext = $false
  foreach ($part in $parts) {
    $text = [string]$part
    if ($maskNext) { $safe += '***'; $maskNext = $false; continue }
    if ($text -match $flagsWithSecretValue) { $safe += $text; $maskNext = $true; continue }
    if ($text -match $secretSettings) { $safe += (($text -split '=', 2)[0] + '=***'); continue }
    $safe += $text
  }
  return ($safe -join ' ')
}

# Runs az and stops the script if it fails, showing what az actually said.
function Invoke-Az {
  $output = & az @args 2>&1
  if ($LASTEXITCODE -ne 0) {
    $call = Hide-Secrets $args
    $said = ($output | Out-String).Trim()
    throw "Azure CLI failed:`n  az $call`n`n$said"
  }
  return $output
}

# Runs az and reports success as a boolean. For "does this already exist?"
# checks, where a failure is an answer rather than a problem.
function Test-Az {
  & az @args 2>&1 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

# Alphanumeric only: these end up inside a connection-string URL, and a '/' or
# '@' in a password there produces a connection error that looks like a wrong
# password rather than a quoting problem.
function New-Secret([int]$Length = 48) {
  $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  $chars = 1..$Length | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] }
  return (-join $chars)
}

function Get-ExistingSetting([string]$Name) {
  # No '| [0]' on the end of the query, tempting though it is: az is a .cmd
  # file on Windows, so PowerShell runs it through cmd.exe, and an unquoted
  # pipe character in an argument is read as a pipe by cmd rather than passed
  # through. The filter already yields at most one row.
  $query = "[?name=='$Name'].value"
  $raw = & az webapp config appsettings list -g $ResourceGroup -n $App --query $query -o tsv 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  $value = ($raw | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($value)) { return $null }
  return $value
}

# ---------------------------------------------------------------------------
Step 'Checking prerequisites'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI not found. Install it with:  winget install Microsoft.AzureCLI"
}
if (-not (Test-Path './Dockerfile')) {
  throw "Run this from the repository root (the folder that contains Dockerfile)."
}
if (-not (Test-Az account show -o none)) {
  throw "Not signed in to Azure. Run:  az login"
}

$subscription = (Invoke-Az account show --query name -o tsv | Out-String).Trim()
Note "Subscription: $subscription"

# ---------------------------------------------------------------------------
Step "Resource group $ResourceGroup"
Invoke-Az group create -n $ResourceGroup -l $Location -o none | Out-Null

# ---------------------------------------------------------------------------
Step "Container registry $Registry"
if (Test-Az acr show -n $Registry -g $ResourceGroup -o none) {
  Note 'Already exists.'
} else {
  Invoke-Az acr create -g $ResourceGroup -n $Registry --sku Basic --admin-enabled true -o none | Out-Null
}

if ($SkipBuild) {
  Step 'Skipping the image build (-SkipBuild)'
  $ImageTag = 'latest'
  if (-not (Test-Az acr repository show -n $Registry --image "$image`:latest" -o none)) {
    throw "-SkipBuild was given but $image`:latest is not in the registry $Registry. Run without it."
  }
  Note "Using $image`:latest"
} else {

Step 'Building the image in Azure (several minutes the first time)'
# Built remotely from the current folder, so no local Docker is needed and the
# build does not depend on what is installed on this laptop. .dockerignore
# keeps .env and the local .data database out of the upload.
#
# Not run through Invoke-Az: this one streams a long build log, and capturing
# it means staring at a blank terminal for five minutes.
& az acr build -r $Registry -t "$image`:$ImageTag" -t "$image`:latest" .

if ($LASTEXITCODE -ne 0) {
  # A non-zero exit here does not always mean the build failed. The CLI can die
  # while printing the log (see the encoding note at the top) after the image
  # has already been built and pushed. So ask the registry what it has rather
  # than trusting the exit code.
  Note 'The build command exited with an error. Asking the registry whether the image arrived anyway...'
  Start-Sleep -Seconds 10
  $tags = & az acr repository show-tags -n $Registry --repository $image -o tsv 2>$null
  $found = ($LASTEXITCODE -eq 0) -and (($tags | Out-String) -split "`r?`n" | Where-Object { $_.Trim() -eq $ImageTag })
  if ($found) {
    Note "Image $image`:$ImageTag is in the registry. The failure was in the log output, not the build."
  } else {
    throw "The image was not built. Run this to see what the build did:`n  az acr task list-runs -r $Registry -o table`n  az acr task logs -r $Registry --run-id <id>"
  }
}

}

# ---------------------------------------------------------------------------
Step "PostgreSQL server $PgServer"
if (-not $PgLocation) { $PgLocation = $Location }

$pgPassword = $null
if (Test-Az postgres flexible-server show -g $ResourceGroup -n $PgServer -o none) {
  Note 'Already exists; keeping its current password.'
} else {
  # A provider the subscription has never used is not registered, and the
  # errors that follow do not say so. Registering is free and idempotent.
  $providerState = (& az provider show -n Microsoft.DBforPostgreSQL --query registrationState -o tsv 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -eq 0 -and $providerState -and $providerState -ne 'Registered') {
    Note "Microsoft.DBforPostgreSQL is $providerState in this subscription. Registering (a minute or two)..."
    & az provider register -n Microsoft.DBforPostgreSQL --wait -o none 2>$null | Out-Null
  }

  $pgPassword = New-Secret 40
  # No --database-name here. Recent CLI versions repurposed that flag for
  # elastic clusters and reject it on an ordinary server; the database is
  # created as its own step below, which works on every version.
  Note "Creating in $PgLocation. This takes several minutes."
  $created = & az postgres flexible-server create `
    -g $ResourceGroup -n $PgServer -l $PgLocation `
    --tier Burstable --sku-name $PgSku --storage-size 32 --version 16 `
    --admin-user $PgAdmin --admin-password $pgPassword `
    --public-access 0.0.0.0 `
    --yes -o none 2>&1

  if ($LASTEXITCODE -ne 0) {
    $said = ($created | Out-String)
    # "The location is restricted" means this subscription may not create THIS
    # resource type in THIS region — a separate thing from whether the region
    # works at all, which is why the resource group and registry went in fine.
    # Rather than leave you guessing, ask Azure which regions will take it.
    if ($said -match 'location is restricted|not available in location|LocationNotAvailable|RegionIsOfferRestricted') {
      Write-Host ''
      Write-Host "  $PgLocation will not accept a PostgreSQL flexible server on this subscription." -ForegroundColor Yellow
      Write-Host '  Checking which regions will...' -ForegroundColor Yellow
      $usable = @()
      foreach ($candidate in @('eastus2', 'centralus', 'westus2', 'westus3', 'southcentralus', 'northcentralus', 'eastus')) {
        if ($candidate -eq $PgLocation) { continue }
        if (Test-Az postgres flexible-server list-skus -l $candidate -o none) { $usable += $candidate }
      }
      Write-Host ''
      if ($usable.Count -gt 0) {
        Write-Host "  These answered: $($usable -join ', ')" -ForegroundColor Green
        Write-Host '  Re-run with one of them, for example:' -ForegroundColor Green
        Write-Host "     powershell -ExecutionPolicy Bypass -File .\deploy\azure-up.ps1 -App $App -SkipBuild -PgLocation $($usable[0])"
      } else {
        Write-Host '  None of the regions tried answered, which usually means an Azure Policy on the' -ForegroundColor Yellow
        Write-Host '  subscription limits where resources may go. Whoever administers the subscription'
        Write-Host '  can tell you the allowed list; pass it as -PgLocation.'
      }
      Write-Host ''
      Write-Host '  Note that a probe only shows what the region offers - a policy can still refuse it.'
      throw "PostgreSQL could not be created in $PgLocation."
    }
    throw "Azure CLI failed:`n  az postgres flexible-server create ... -l $PgLocation`n`n$($said.Trim())"
  }
  Note 'Created. Public access is on, but the firewall allows Azure services only.'
}

Step "Database $PgDatabase"
# Asking for the list and matching, rather than `db show`, because the flag
# that names a database differs between CLI versions (-d in some, -n in
# others). A list needs neither.
$databases = & az postgres flexible-server db list -g $ResourceGroup -s $PgServer --query '[].name' -o tsv 2>$null
$exists = ($LASTEXITCODE -eq 0) -and
          (($databases | Out-String) -split "`r?`n" | Where-Object { $_.Trim() -eq $PgDatabase })

if ($exists) {
  Note 'Already exists.'
} else {
  if (-not (Test-Az postgres flexible-server db create -g $ResourceGroup -s $PgServer -n $PgDatabase -o none)) {
    Invoke-Az postgres flexible-server db create -g $ResourceGroup -s $PgServer -d $PgDatabase -o none | Out-Null
  }
  Note 'Created.'
}

Step 'Allowing this machine through the database firewall'
# Needed to run the migrations from here. Delete the rule afterwards if you
# would rather the database were reachable only from Azure.
$myIp = $MyIp
if (-not $myIp) {
  try {
    $myIp = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 15).ip
  } catch {
    Note 'Could not look up this machine public IP address. Pass it with -MyIp to add the rule.'
  }
}
if ($myIp) {
  # Which flag names the server here differs by CLI version: -n in some, -s in
  # others. Try both rather than guess.
  $ruleOutput = & az postgres flexible-server firewall-rule create `
    -g $ResourceGroup -s $PgServer --rule-name 'admin-laptop' `
    --start-ip-address $myIp --end-ip-address $myIp -o none 2>&1
  if ($LASTEXITCODE -ne 0 -and (($ruleOutput | Out-String) -match 'unrecognized arguments|not recognized')) {
    $ruleOutput = & az postgres flexible-server firewall-rule create `
      -g $ResourceGroup -n $PgServer --rule-name 'admin-laptop' `
      --start-ip-address $myIp --end-ip-address $myIp -o none 2>&1
  }
  if ($LASTEXITCODE -eq 0) {
    Note "Allowed $myIp"
  } else {
    # Say what went wrong. A swallowed reason here means finding out only when
    # the migrations time out twenty minutes later.
    Note "Could not add a firewall rule for $myIp. Azure said:"
    foreach ($line in (($ruleOutput | Out-String) -split "`r?`n")) {
      if ($line.Trim()) { Note "  $($line.Trim())" }
    }
    Note 'Add it under the database > Networking blade, or re-run this command by hand, before the migrations.'
  }
} else {
  Note 'Add your IP under the database Networking blade before running the migrations.'
}

# ---------------------------------------------------------------------------
Step "App Service plan $plan"
if (Test-Az appservice plan show -g $ResourceGroup -n $plan -o none) {
  Note 'Already exists.'
} else {
  Invoke-Az appservice plan create -g $ResourceGroup -n $plan --is-linux --sku $PlanSku -o none | Out-Null
}

$acrServer   = (Invoke-Az acr show -n $Registry --query loginServer -o tsv | Out-String).Trim()
$acrUser     = (Invoke-Az acr credential show -n $Registry --query username -o tsv | Out-String).Trim()
$acrPassword = (Invoke-Az acr credential show -n $Registry --query 'passwords[0].value' -o tsv | Out-String).Trim()
$imageRef    = "$acrServer/$image`:$ImageTag"

Step "Web app $App"
if (Test-Az webapp show -g $ResourceGroup -n $App -o none) {
  Note 'Already exists.'
} else {
  # The flag for the container image was renamed between CLI versions, so try
  # the current name and fall back rather than failing on a rename.
  if (-not (Test-Az webapp create -g $ResourceGroup -p $plan -n $App --container-image-name $imageRef -o none)) {
    Invoke-Az webapp create -g $ResourceGroup -p $plan -n $App --deployment-container-image-name $imageRef -o none | Out-Null
  }
}

# Registry address and credentials, and which image to run. These settings are
# how App Service has always been told about a private registry, and unlike the
# create-time flags they have not been renamed.
Invoke-Az webapp config appsettings set -g $ResourceGroup -n $App --settings `
  "DOCKER_REGISTRY_SERVER_URL=https://$acrServer" `
  "DOCKER_REGISTRY_SERVER_USERNAME=$acrUser" `
  "DOCKER_REGISTRY_SERVER_PASSWORD=$acrPassword" -o none | Out-Null

# Which image to run. The obvious way to set this is
# `--linux-fx-version "DOCKER|<image>"`, but that value contains a pipe, and on
# Windows az is a .cmd file invoked through cmd.exe, which would read the pipe
# as a pipe. `webapp config container set` takes the bare image reference
# instead. Its flag was renamed between CLI versions, so try both.
if (-not (Test-Az webapp config container set -g $ResourceGroup -n $App --container-image-name $imageRef -o none)) {
  Invoke-Az webapp config container set -g $ResourceGroup -n $App --docker-custom-image-name $imageRef -o none | Out-Null
}

# ---------------------------------------------------------------------------
Step 'Secrets'

# Reading these back rather than regenerating is what makes the script safe to
# re-run: a new AUTH_SECRET would sign everyone out, and a new SYNC_TOKEN would
# silently break the scheduled sync.
$authSecret = Get-ExistingSetting 'AUTH_SECRET'
if ($authSecret) { Note 'Reusing the existing AUTH_SECRET.' }
else { $authSecret = New-Secret 64; Note 'Generated a new AUTH_SECRET.' }

$syncToken = Get-ExistingSetting 'SYNC_TOKEN'
if ($syncToken) { Note 'Reusing the existing SYNC_TOKEN.' }
else { $syncToken = New-Secret 48; Note 'Generated a new SYNC_TOKEN.' }

$googleId     = Get-ExistingSetting 'GOOGLE_CLIENT_ID'
$googleSecret = Get-ExistingSetting 'GOOGLE_CLIENT_SECRET'
if (-not $googleId -or -not $googleSecret) {
  Write-Host ''
  Write-Host '  Google OAuth client - use the SAME client you tested with locally.' -ForegroundColor Yellow
  $googleId = (Read-Host '  GOOGLE_CLIENT_ID').Trim()
  $secure = Read-Host '  GOOGLE_CLIENT_SECRET' -AsSecureString
  $googleSecret = [System.Net.NetworkCredential]::new('', $secure).Password
}

if ($pgPassword) {
  $pgHost = "$PgServer.postgres.database.azure.com"
  $databaseUrl = "postgresql://$PgAdmin`:$pgPassword@$pgHost`:5432/$PgDatabase"
} else {
  $databaseUrl = Get-ExistingSetting 'DATABASE_URL'
  if ($databaseUrl) {
    Note 'Reusing the existing DATABASE_URL.'
  } else {
    # The server exists but nothing recorded its password — which is what a run
    # that died between creating the server and writing the app settings leaves
    # behind. The password was generated in memory and is gone, so set a new
    # one. Safe here precisely because no DATABASE_URL was ever stored: nothing
    # in this deployment can be holding the old one.
    Note 'The server exists but no DATABASE_URL was ever recorded. Setting a fresh admin password.'
    $pgPassword = New-Secret 40
    Invoke-Az postgres flexible-server update `
      -g $ResourceGroup -n $PgServer --admin-password $pgPassword -o none | Out-Null
    $pgHost = "$PgServer.postgres.database.azure.com"
    $databaseUrl = "postgresql://$PgAdmin`:$pgPassword@$pgHost`:5432/$PgDatabase"
  }
}

$appUrl = "https://$App.azurewebsites.net"

# ---------------------------------------------------------------------------
Step 'Application settings'
Invoke-Az webapp config appsettings set -g $ResourceGroup -n $App --settings `
  'WEBSITES_PORT=3000' `
  'WEBSITES_CONTAINER_START_TIME_LIMIT=600' `
  "DATABASE_URL=$databaseUrl" `
  'DATABASE_SSL=require' `
  "APP_URL=$appUrl" `
  "AUTH_SECRET=$authSecret" `
  "AUTH_ALLOWED_DOMAINS=$AllowedDomains" `
  "GOOGLE_CLIENT_ID=$googleId" `
  "GOOGLE_CLIENT_SECRET=$googleSecret" `
  "SYNC_TOKEN=$syncToken" -o none | Out-Null

Step 'Hardening'
Invoke-Az webapp update -g $ResourceGroup -n $App --https-only true -o none | Out-Null
Invoke-Az webapp config set -g $ResourceGroup -n $App `
  --always-on true --min-tls-version 1.2 --ftps-state Disabled -o none | Out-Null

# Health check restarts an instance that stops answering. /api/health is the
# only endpoint that responds without a session; pointing it anywhere else
# returns 401 and puts the app into a restart loop.
if (-not (Test-Az webapp update -g $ResourceGroup -n $App --set siteConfig.healthCheckPath=/api/health -o none)) {
  Note 'Could not set the health-check path here - set it in the portal under Monitoring > Health check.'
}

# Without this, `az webapp log tail` shows platform events and none of the
# container's own stdout — which is where the app explains why a sign-in failed.
if (-not (Test-Az webapp log config -g $ResourceGroup -n $App --docker-container-logging filesystem -o none)) {
  Note 'Could not enable container logging - turn it on under Monitoring > App Service logs.'
}

Invoke-Az webapp restart -g $ResourceGroup -n $App -o none | Out-Null

# ---------------------------------------------------------------------------
if (-not $NoSyncSchedule) {
  $logicApp = "$App-sync"
  Step "Scheduled Linear sync ($logicApp)"

  # Created disabled until there is a Linear key to sync with, so it does not
  # spend the next month failing every hour against an app that cannot answer.
  $linearKey = Get-ExistingSetting 'LINEAR_API_KEY'
  $state = if ($linearKey) { 'Enabled' } else { 'Disabled' }

  $providerState = (& az provider show -n Microsoft.Logic --query registrationState -o tsv 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -eq 0 -and $providerState -and $providerState -ne 'Registered') {
    Note "Microsoft.Logic is $providerState. Registering..."
    & az provider register -n Microsoft.Logic --wait -o none 2>$null | Out-Null
  }

  $template = Join-Path $PSScriptRoot 'sync-schedule.json'
  $deployed = & az deployment group create `
    -g $ResourceGroup --name 'pcr-sync-schedule' `
    --template-file $template `
    --parameters "name=$logicApp" "location=$Location" `
    "syncUrl=$appUrl/api/sync/linear" "syncToken=$syncToken" `
    "intervalHours=$SyncIntervalHours" "state=$state" -o none 2>&1

  if ($LASTEXITCODE -eq 0) {
    if ($state -eq 'Enabled') {
      Note "Runs every $SyncIntervalHours hour(s)."
    } else {
      Note 'Created but DISABLED: no LINEAR_API_KEY is set on the app yet.'
      Note 'Set it, then re-run this script (or enable the Logic App in the portal).'
    }
  } else {
    Note 'Could not create the scheduled sync. Everything else is deployed; this is the only part missing.'
    foreach ($line in (($deployed | Out-String) -split "`r?`n")) {
      if ($line.Trim()) { Note "  $($line.Trim())" }
    }
  }
}

# ---------------------------------------------------------------------------
# Written to a gitignored file rather than printed, so the connection string
# does not sit in the terminal scrollback or on a screen share.
$outFile = Join-Path (Get-Location) '.azure-deployment.txt'
$created = Get-Date -Format 'yyyy-MM-dd HH:mm'
$report = @"
Deployment: $App
Created:    $created

URL                $appUrl
Redirect URI       $appUrl/api/auth/callback
Resource group     $ResourceGroup
Image              $imageRef

DATABASE_URL       $databaseUrl
SYNC_TOKEN         $syncToken

Scheduled sync:    Logic App $App-sync (every $SyncIntervalHours h)
Log stream:        az webapp log tail -g $ResourceGroup -n $App
Redeploy:          .\deploy\azure-up.ps1 -App $App
Delete everything: az group delete -n $ResourceGroup --yes
"@
Set-Content -Path $outFile -Value $report -Encoding UTF8

Step 'Two things left to do by hand'
Write-Host ''
Write-Host '  1. Add this redirect URI to the SAME Google OAuth client you used locally:' -ForegroundColor Yellow
Write-Host "       $appUrl/api/auth/callback"
Write-Host '     Keep http://localhost:3000/api/auth/callback too, so local work still runs.'
Write-Host ''
Write-Host '  2. Create the database schema. The connection string is in .azure-deployment.txt:' -ForegroundColor Yellow
Write-Host '       $env:DATABASE_URL = ''<the DATABASE_URL line>'''
Write-Host '       $env:DATABASE_SSL = ''require'''
Write-Host '       npm.cmd run db:migrate'
Write-Host '       npm.cmd run seed:process'
Write-Host '       npm.cmd run init'
Write-Host ''
Write-Host "  Then open $appUrl" -ForegroundColor Green
Write-Host ''
Write-Host '  Connection string and sync token written to .azure-deployment.txt' -ForegroundColor Green
Note 'That file is gitignored. Keep it off email and chat, and delete it once the values are in your password manager.'
Write-Host ''

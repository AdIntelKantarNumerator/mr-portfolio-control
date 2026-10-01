<#
  Deploys "Ask Yaara": Open WebUI on App Service, pointed at the portfolio.

      powershell -ExecutionPolicy Bypass -File .\deploy\open-webui\chat-up.ps1

  What it makes or updates, every step create-if-absent:

    - three generated secrets in the web app's vault (kv-mr-portfolio-web):
        YAARA-CHAT-TOKEN         Open WebUI -> portfolio, the bearer token
        YAARA-CHAT-USER-SECRET   signs who is asking, verified by the portfolio
        OPEN-WEBUI-SECRET-KEY    Open WebUI's own session key
      and two copied in: OPEN-WEBUI-DATABASE-URL and OPEN-WEBUI-GOOGLE-CLIENT-SECRET
    - a database "openwebui" on the portfolio's Postgres server
    - its own App Service plan (B1) and web app running the pinned image
    - the web app's settings: settings.env, Yaara's profile, the Key Vault references
    - three settings on the portfolio: YAARA_CHAT_TOKEN, YAARA_CHAT_USER_SECRET
      (Key Vault references to the same secrets) and YAARA_CHAT_URL, which shows
      the "Ask Yaara" button on the home page

  No secret is printed or put on a command line: generated values go to the
  vault through a temporary file that is deleted at once, and app settings are
  sent as a JSON file, which also keeps cmd.exe from eating the closing
  parenthesis of a Key Vault reference (deploy/AZURE.md has that story).

  Its own plan because Open WebUI uses about 700 MB, measured 1 October 2026,
  and the portfolio's B1 plan has 1.75 GB for everything on it. Sharing would
  work until the day the chat starved the portfolio. Pass -Plan
  mr-portfolio-control-plan to share anyway.

  Written for Windows PowerShell 5.1.
#>

[CmdletBinding()]
param(
  [string]$App           = 'mr-portfolio-chat',
  [string]$ResourceGroup = 'rg-mr-portfolio-control',
  [string]$Plan          = 'mr-portfolio-chat-plan',
  [string]$PlanSku       = 'B1',
  [string]$PortfolioApp  = 'mr-portfolio-control',
  [string]$Vault         = 'kv-mr-portfolio-web',
  [string]$PgServer      = 'mr-portfolio-control-pg',
  [string]$ChatDatabase  = 'openwebui',
  # Pinned: settings.env was checked against this version's setting names.
  [string]$Image         = 'ghcr.io/open-webui/open-webui:v0.11.4-slim'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here '..\..')

function Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Note($text) { Write-Host "    $text" -ForegroundColor DarkGray }

function Invoke-Az {
  $out = & az @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "az $($args[0..2] -join ' ') failed: $($out | Out-String)" }
  return $out
}
function Test-Az { & az @args 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) }

function Write-NoBom([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false))
}

function New-Secret {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
}

function Set-VaultSecretIfMissing([string]$Name, [scriptblock]$Value) {
  if (Test-Az keyvault secret show --vault-name $Vault --name $Name) { Note "$Name already in $Vault"; return }
  $tmp = [IO.Path]::GetTempFileName()
  try {
    Write-NoBom $tmp (& $Value)
    Invoke-Az keyvault secret set --vault-name $Vault --name $Name --file $tmp --encoding utf-8 --output none | Out-Null
    Note "$Name stored in $Vault"
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

function Get-PortfolioSetting([string]$Name) {
  $v = Invoke-Az webapp config appsettings list -g $ResourceGroup -n $PortfolioApp --query "[?name=='$Name'].value | [0]" -o tsv
  return ("$v").Trim()
}

function Ref([string]$Name) { "@Microsoft.KeyVault(SecretUri=https://$Vault.vault.azure.net/secrets/$Name/)" }

function Set-Settings([string]$Target, [hashtable]$Settings) {
  $list = foreach ($k in $Settings.Keys) { @{ name = $k; value = [string]$Settings[$k]; slotSetting = $false } }
  $tmp = [IO.Path]::GetTempFileName()
  try {
    Write-NoBom $tmp (ConvertTo-Json -InputObject @($list) -Depth 4 -Compress)
    Invoke-Az webapp config appsettings set -g $ResourceGroup -n $Target --settings "@$tmp" --output none | Out-Null
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

$chatUrl = "https://$App.azurewebsites.net"
$portfolioUrl = "https://$PortfolioApp.azurewebsites.net"

Step 'Secrets'
Set-VaultSecretIfMissing 'YAARA-CHAT-TOKEN' { New-Secret }
Set-VaultSecretIfMissing 'YAARA-CHAT-USER-SECRET' { New-Secret }
Set-VaultSecretIfMissing 'OPEN-WEBUI-SECRET-KEY' { New-Secret }
Set-VaultSecretIfMissing 'OPEN-WEBUI-GOOGLE-CLIENT-SECRET' {
  $s = Get-PortfolioSetting 'GOOGLE_CLIENT_SECRET'
  if (-not $s) { throw 'The portfolio has no GOOGLE_CLIENT_SECRET to share.' }
  $s
}
Set-VaultSecretIfMissing 'OPEN-WEBUI-DATABASE-URL' {
  $u = Get-PortfolioSetting 'DATABASE_URL'
  # Same server and user as the portfolio, its own database.
  if ($u -notmatch '^(postgres(?:ql)?://[^/]+)/[^?]+') { throw 'Could not read the portfolio DATABASE_URL.' }
  "$($Matches[1])/$ChatDatabase`?sslmode=require"
}

Step "Database $ChatDatabase on $PgServer"
if (Test-Az postgres flexible-server db show -g $ResourceGroup --server-name $PgServer --name $ChatDatabase) { Note 'exists' }
else { Invoke-Az postgres flexible-server db create -g $ResourceGroup --server-name $PgServer --name $ChatDatabase --output none | Out-Null; Note 'created' }

Step "Plan $Plan and web app $App"
if (-not (Test-Az appservice plan show -g $ResourceGroup -n $Plan)) {
  Invoke-Az appservice plan create -g $ResourceGroup -n $Plan --is-linux --sku $PlanSku --output none | Out-Null
  Note "plan created ($PlanSku)"
}
if (-not (Test-Az webapp show -g $ResourceGroup -n $App)) {
  Invoke-Az webapp create -g $ResourceGroup -p $Plan -n $App --container-image-name $Image --output none | Out-Null
  Note 'web app created'
} else {
  Invoke-Az webapp config container set -g $ResourceGroup -n $App --container-image-name $Image --output none | Out-Null
  Note "image set to $Image"
}
Invoke-Az webapp config set -g $ResourceGroup -n $App --always-on true --http20-enabled true --min-tls-version 1.2 --ftps-state Disabled --output none | Out-Null
Invoke-Az webapp update -g $ResourceGroup -n $App --https-only true --output none | Out-Null

Step 'Let it read the vault'
Invoke-Az webapp identity assign -g $ResourceGroup -n $App --output none | Out-Null
$principal = ("$(Invoke-Az webapp identity show -g $ResourceGroup -n $App --query principalId -o tsv)").Trim()
Invoke-Az keyvault set-policy --name $Vault --object-id $principal --secret-permissions get --output none | Out-Null
Note 'get on secrets, nothing else'

Step 'Settings'
$settings = @{}
foreach ($line in Get-Content (Join-Path $here 'settings.env')) {
  if ($line -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim() }
}
$meta = & node (Join-Path $here 'model-metadata.mjs') --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'model-metadata.mjs failed' }
$settings['DEFAULT_MODEL_METADATA'] = $meta.DEFAULT_MODEL_METADATA
$settings['DEFAULT_PROMPT_SUGGESTIONS'] = $meta.DEFAULT_PROMPT_SUGGESTIONS

$allowed = Get-PortfolioSetting 'AUTH_ALLOWED_DOMAINS'
if (-not $allowed) { throw 'The portfolio has no AUTH_ALLOWED_DOMAINS; the chat will not open to every Google account.' }
$googleId = Get-PortfolioSetting 'GOOGLE_CLIENT_ID'
if (-not $googleId) { throw 'The portfolio has no GOOGLE_CLIENT_ID to share.' }

$settings += @{
  WEBSITES_PORT                         = '8080'
  WEBSITES_ENABLE_APP_SERVICE_STORAGE   = 'true'
  WEBSITES_CONTAINER_START_TIME_LIMIT   = '600'
  DATA_DIR                              = '/home/open-webui'
  WEBUI_URL                             = $chatUrl
  CORS_ALLOW_ORIGIN                     = $chatUrl
  OPENAI_API_BASE_URL                   = "$portfolioUrl/api/yaara/v1"
  OPENAI_API_KEY                        = (Ref 'YAARA-CHAT-TOKEN')
  FORWARD_USER_INFO_HEADER_JWT_SECRET   = (Ref 'YAARA-CHAT-USER-SECRET')
  WEBUI_SECRET_KEY                      = (Ref 'OPEN-WEBUI-SECRET-KEY')
  DATABASE_URL                          = (Ref 'OPEN-WEBUI-DATABASE-URL')
  GOOGLE_CLIENT_ID                      = $googleId
  GOOGLE_CLIENT_SECRET                  = (Ref 'OPEN-WEBUI-GOOGLE-CLIENT-SECRET')
  GOOGLE_REDIRECT_URI                   = "$chatUrl/oauth/google/callback"
  OAUTH_ALLOWED_DOMAINS                 = $allowed
}
Set-Settings $App $settings
Note "$($settings.Count) settings on $App"

Set-Settings $PortfolioApp @{
  YAARA_CHAT_TOKEN       = (Ref 'YAARA-CHAT-TOKEN')
  YAARA_CHAT_USER_SECRET = (Ref 'YAARA-CHAT-USER-SECRET')
  YAARA_CHAT_URL         = $chatUrl
}
Note "YAARA_CHAT_TOKEN, YAARA_CHAT_USER_SECRET and YAARA_CHAT_URL on $PortfolioApp"

Step 'Restart both'
Invoke-Az webapp restart -g $ResourceGroup -n $PortfolioApp --output none | Out-Null
Invoke-Az webapp restart -g $ResourceGroup -n $App --output none | Out-Null

Step 'Left to do by hand'
Write-Host @"

  1. Add this redirect URI to the portfolio's Google OAuth client:
       $chatUrl/oauth/google/callback

  2. Deploy Yaara (her web chat worker ships with her), then sign in at
       $chatUrl
     FIRST, as whoever should administer it: the first account becomes the
     Open WebUI admin.

  3. Give her her picture, with an admin token from Settings, Account:
       `$env:OPEN_WEBUI_URL = '$chatUrl'
       `$env:OPEN_WEBUI_TOKEN = '<token>'   # or Read-Host -AsSecureString
       node deploy\open-webui\configure-model.mjs

  The first start takes a few minutes: Open WebUI builds its database.
"@

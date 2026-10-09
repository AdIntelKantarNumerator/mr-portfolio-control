<#
.SYNOPSIS
  Let this machine in: add its current public IP to the database firewall,
  both key vaults and the AKS API server's allowed ranges.

.DESCRIPTION
  Since 9 October 2026 those three are closed to the internet except for the
  web apps and the machine that deploys. That machine is a laptop on a home
  connection whose address changes, so this is run first by both deploy
  scripts, and by hand before using kubectl or reaching the database after
  the address has changed:

      powershell -ExecutionPolicy Bypass -File .\deploy\allow-my-ip.ps1

  It can never lock you out: every rule it changes is changed through Azure's
  management API, which the rules themselves do not restrict.

  Idempotent and quiet when nothing has changed. Old addresses are replaced,
  not accumulated: the database rule and the cluster's range hold only the
  current one, and each vault drops the previous address this script added.
#>
[CmdletBinding()]
param(
  [string]$ResourceGroup = 'rg-mr-portfolio-control',
  [string]$PgServer      = 'mr-portfolio-control-pg',
  [string]$Cluster       = 'mr-portfolio-aks',
  [string[]]$Vaults      = @('kv-mr-portfolio-control', 'kv-mr-portfolio-web'),
  [string]$MyIp          = ''
)

$ErrorActionPreference = 'Stop'
function Note([string]$m) { Write-Host "    $m" }
function Az { & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed" } }

if (-not $MyIp) { $MyIp = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 15).ip }
if ($MyIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "Could not tell this machine's public IP (got '$MyIp'). Pass -MyIp." }
Write-Host "=== Allowing $MyIp"

# Database: one rule, kept on the current address.
$pg = (& az postgres flexible-server firewall-rule show -g $ResourceGroup -s $PgServer -n 'admin-laptop' --query startIpAddress -o tsv 2>$null | Out-String).Trim()
if ($pg -eq $MyIp) { Note 'database: already allowed' }
else {
  Az postgres flexible-server firewall-rule create -g $ResourceGroup -s $PgServer -n 'admin-laptop' --start-ip-address $MyIp --end-ip-address $MyIp -o none
  Note "database: allowed (was $(if ($pg) { $pg } else { 'none' }))"
}

# Key vaults: add this address, drop the one this script added before.
foreach ($v in $Vaults) {
  $ips = @(& az keyvault network-rule list -n $v --query 'ipRules[].value' -o tsv 2>$null)
  if ($ips -contains "$MyIp/32" -or $ips -contains $MyIp) { Note "${v}: already allowed"; continue }
  Az keyvault network-rule add -n $v --ip-address "$MyIp/32" -o none
  $tag = (& az keyvault show -n $v --query 'tags.deployerIp' -o tsv 2>$null | Out-String).Trim()
  if ($tag -and $tag -ne $MyIp -and ($ips -contains "$tag/32")) {
    Az keyvault network-rule remove -n $v --ip-address "$tag/32" -o none
  }
  Az keyvault update -n $v --set "tags.deployerIp=$MyIp" -o none
  Note "${v}: allowed"
}

# AKS API server: only this address (the cluster's own outbound address is
# allowed by AKS automatically). An update takes a minute or two.
$ranges = (& az aks show -g $ResourceGroup -n $Cluster --query 'apiServerAccessProfile.authorizedIpRanges' -o tsv 2>$null | Out-String).Trim()
if ($ranges -split '\s+' -contains "$MyIp/32") { Note 'cluster API: already allowed' }
else {
  Note 'cluster API: updating (a minute or two)...'
  Az aks update -g $ResourceGroup -n $Cluster --api-server-authorized-ip-ranges "$MyIp/32" -o none
  Note 'cluster API: allowed'
}

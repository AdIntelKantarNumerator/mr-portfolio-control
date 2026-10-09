<#
.SYNOPSIS
  Let this machine in: add its current public IP to the database firewall,
  both key vaults and the AKS API server's allowed ranges.

.DESCRIPTION
  Since 9 October 2026 the database and the cluster API are closed to the
  internet except for the web apps and the people who deploy. Their machines'
  addresses change (home connections, VPN), so both deploy scripts run this
  first, and it is the one command to run by hand before kubectl or the
  database after an address changes:

      powershell -ExecutionPolicy Bypass -File .\deploy\allow-my-ip.ps1

  It ADDS this machine's address and never removes anyone else's: several
  people deploy, and replacing the list would lock out whoever ran it last.
  It cannot lock you out either - every rule here is changed through Azure's
  management API, which the rules themselves do not restrict. Old addresses
  accumulate; prune them in the portal now and then.

  Pass -Range to allow a whole range at once (a VPN's exit block), e.g.
  -Range 203.0.113.0/27.
#>
[CmdletBinding()]
param(
  [string]$ResourceGroup = 'rg-mr-portfolio-control',
  [string]$PgServer      = 'mr-portfolio-control-pg',
  [string]$Cluster       = 'mr-portfolio-aks',
  [string[]]$Vaults      = @('kv-mr-portfolio-control', 'kv-mr-portfolio-web'),
  [string]$MyIp          = '',
  [string]$Range         = ''
)

$ErrorActionPreference = 'Stop'
function Note([string]$m) { Write-Host "    $m" }
# Not named "Az": PowerShell names ignore case, so a function called Az that
# runs `az` calls itself until the stack overflows.
function Invoke-AzOrThrow { & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed" } }

if ($Range) {
  if ($Range -notmatch '^(\d{1,3}(\.\d{1,3}){3})/(\d{1,2})$') { throw "-Range must look like 203.0.113.0/27 (got '$Range')." }
  $cidr = $Range
  $first = $Matches[1]
  $size = [math]::Pow(2, 32 - [int]$Matches[3])
  $o = $first.Split('.') | ForEach-Object { [int]$_ }
  $n = (($o[0] * 16777216) + ($o[1] * 65536) + ($o[2] * 256) + $o[3]) + $size - 1
  $last = '{0}.{1}.{2}.{3}' -f [math]::Floor($n / 16777216), ([math]::Floor($n / 65536) % 256), ([math]::Floor($n / 256) % 256), ($n % 256)
} else {
  if (-not $MyIp) { $MyIp = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 15).ip }
  if ($MyIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "Could not tell this machine's public IP (got '$MyIp'). Pass -MyIp." }
  $cidr = "$MyIp/32"; $first = $MyIp; $last = $MyIp
}
Write-Host "=== Allowing $cidr"

# Database: one rule per address or range.
$ruleName = 'deployer-' + ($cidr -replace '[./]', '-')
$have = @(& az postgres flexible-server firewall-rule list -g $ResourceGroup -s $PgServer --query "[?startIpAddress=='$first' && endIpAddress=='$last'].name" -o tsv 2>$null)
if ($have.Count -and $have[0]) { Note 'database: already allowed' }
else {
  Invoke-AzOrThrow postgres flexible-server firewall-rule create -g $ResourceGroup -s $PgServer -n $ruleName --start-ip-address $first --end-ip-address $last -o none
  Note 'database: allowed'
}

# Key vaults: add the address.
foreach ($v in $Vaults) {
  $ips = @(& az keyvault network-rule list -n $v --query 'ipRules[].value' -o tsv 2>$null)
  if ($ips -contains $cidr -or ($cidr.EndsWith('/32') -and $ips -contains $first)) { Note "${v}: already allowed"; continue }
  Invoke-AzOrThrow keyvault network-rule add -n $v --ip-address $cidr -o none
  Note "${v}: allowed"
}

# AKS API server: the current list plus this address (the cluster's own
# outbound address is allowed by AKS automatically). An update takes a minute
# or two.
$ranges = @((& az aks show -g $ResourceGroup -n $Cluster --query 'apiServerAccessProfile.authorizedIpRanges' -o tsv 2>$null | Out-String).Trim() -split '\s+' | Where-Object { $_ })
if ($ranges -contains $cidr) { Note 'cluster API: already allowed' }
else {
  Note 'cluster API: updating (a minute or two)...'
  Invoke-AzOrThrow aks update -g $ResourceGroup -n $Cluster --api-server-authorized-ip-ranges ((@($ranges) + $cidr | Select-Object -Unique) -join ',') -o none
  Note 'cluster API: allowed'
}

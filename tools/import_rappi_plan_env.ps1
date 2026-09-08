param(
  [string]$PlanPath = (Join-Path $PSScriptRoot '..\..\PLAN_INTEGRACION_ENKRATO_RAPPI.md'),
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\.env'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Normalize-Line([string]$Line) {
  return (($Line -replace '\\', '') -replace '[`*]', '').Trim()
}

function Value-After-Label([string[]]$Lines, [string]$Label, [int]$StartAt = 0) {
  for ($i = $StartAt; $i -lt $Lines.Count; $i++) {
    $current = Normalize-Line $Lines[$i]
    if ($current -cne $Label) { continue }

    for ($j = $i + 1; $j -lt [Math]::Min($i + 10, $Lines.Count); $j++) {
      $candidate = Normalize-Line $Lines[$j]
      if ($candidate -and $candidate -notmatch '^[-#\[]' -and $candidate -ne '```') {
        return $candidate
      }
    }
  }
  return ''
}

function Inline-Value([string[]]$Lines, [string]$Label, [int]$StartAt = 0) {
  for ($i = $StartAt; $i -lt $Lines.Count; $i++) {
    $current = Normalize-Line $Lines[$i]
    if ($current -match ('^' + [regex]::Escape($Label) + '\s*:\s*(.+)$')) {
      return $Matches[1].Trim()
    }
  }
  return ''
}

function Inline-Value-Prefix([string[]]$Lines, [string]$Prefix, [int]$StartAt = 0) {
  for ($i = $StartAt; $i -lt $Lines.Count; $i++) {
    $current = Normalize-Line $Lines[$i]
    if ($current -match ('^' + [regex]::Escape($Prefix) + '[^:]*:\s*(.+)$')) {
      return $Matches[1].Trim()
    }
  }
  return ''
}

function Env-Value([string]$Value) {
  $escaped = $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", '')
  return '"' + $escaped + '"'
}

$resolvedPlan = (Resolve-Path -LiteralPath $PlanPath).Path
$resolvedOutputDirectory = (Resolve-Path -LiteralPath (Split-Path -Parent $OutputPath)).Path
$resolvedOutput = Join-Path $resolvedOutputDirectory (Split-Path -Leaf $OutputPath)

if ((Test-Path -LiteralPath $resolvedOutput) -and -not $Force) {
  throw "El archivo $resolvedOutput ya existe. Usa -Force solo si deseas regenerarlo desde el plan."
}

$lines = Get-Content -LiteralPath $resolvedPlan -Encoding utf8
$devSection = 0
$portalSection = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
  $normalized = Normalize-Line $lines[$i]
  if ($normalized -match 'CONFIGURACIÓN DEL AMBIENTE DEV') { $devSection = $i }
  if ($normalized -match '^Credenciales de https://login-integrations-manager\.rappi\.com/login') { $portalSection = $i }
}

$values = [ordered]@{
  RAPPI_ENVIRONMENT = 'DEV'
  RAPPI_DEV_CLIENT_ID = Value-After-Label $lines 'ClientId' $devSection
  RAPPI_DEV_CLIENT_SECRET = Value-After-Label $lines 'ClientSecret' $devSection
  RAPPI_DEV_OPERATIONAL_BASE_URL = 'https://api.dev.rappi.com'
  RAPPI_DEV_ORDERS_BASE_URL = 'https://microservices.dev.rappi.com'
  RAPPI_DEV_STORE_ID = Value-After-Label $lines 'StoreId' $devSection
  RAPPI_DEV_STORE_NAME = Value-After-Label $lines 'StoreName' $devSection
  RAPPI_INTEGRATIONS_MANAGER_USER = Inline-Value $lines 'Usuario' $portalSection
  RAPPI_INTEGRATIONS_MANAGER_PASSWORD = Inline-Value-Prefix $lines 'Contrase' $portalSection
}

$invalid = @()
if ($values.RAPPI_DEV_CLIENT_ID.Length -lt 16) { $invalid += 'RAPPI_DEV_CLIENT_ID' }
if ($values.RAPPI_DEV_CLIENT_SECRET.Length -lt 32) { $invalid += 'RAPPI_DEV_CLIENT_SECRET' }
if (-not $values.RAPPI_DEV_STORE_ID) { $invalid += 'RAPPI_DEV_STORE_ID' }
if ($values.RAPPI_INTEGRATIONS_MANAGER_USER -notmatch '@') { $invalid += 'RAPPI_INTEGRATIONS_MANAGER_USER' }
if ($values.RAPPI_INTEGRATIONS_MANAGER_PASSWORD.Length -lt 8) { $invalid += 'RAPPI_INTEGRATIONS_MANAGER_PASSWORD' }
if ($invalid.Count) { throw ('El plan no contiene valores validos para: ' + ($invalid -join ', ')) }

$content = @(
  '# Generado localmente desde PLAN_INTEGRACION_ENKRATO_RAPPI.md.'
  '# Contiene secretos: no versionar, imprimir ni adjuntar.'
)
foreach ($entry in $values.GetEnumerator()) {
  $content += ($entry.Key + '=' + (Env-Value ([string]$entry.Value)))
}

$temporary = $resolvedOutput + '.tmp.' + [guid]::NewGuid().ToString('N')
try {
  [IO.File]::WriteAllLines($temporary, $content, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $resolvedOutput -Force
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}

Write-Output ("Archivo seguro generado: {0}" -f $resolvedOutput)
foreach ($entry in $values.GetEnumerator()) {
  Write-Output ("{0}: presente, longitud {1}" -f $entry.Key, ([string]$entry.Value).Length)
}

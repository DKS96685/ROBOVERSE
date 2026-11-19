param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath
)

$ErrorActionPreference = 'Stop'
if (-not $env:DATABASE_URL) {
  throw 'Set DATABASE_URL in the current shell before creating a backup.'
}
if (Test-Path -LiteralPath $BackupPath) {
  throw 'The requested backup path already exists; choose a new path.'
}

& pg_dump --dbname=$env:DATABASE_URL --format=custom --no-owner --no-acl --file=$BackupPath
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE."
}

& pg_restore --list $BackupPath | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Backup verification failed with exit code $LASTEXITCODE."
}

Write-Output "Database backup verified: $BackupPath"

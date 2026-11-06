# 개발용 Postgres 기동 + server/.env 생성(없을 때만) + 마이그레이션.
# POSTGRES_PORT 지정 시 compose 호스트 포트와 DATABASE_URL 포트에 반영.
# 마이그레이션은 sqlx-cli 사용. 앱 빌드 자체가 마이그레이션된 DB 요구(sqlx 매크로) → 앱 바이너리로는 빈 DB 마이그레이션 불가.
$ErrorActionPreference = 'Stop'

cargo sqlx --version *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'sqlx-cli 필요: cargo install sqlx-cli --version 0.8.6 --locked --no-default-features --features postgres,rustls'
}

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root 'server/.env'

docker compose -f (Join-Path $root 'compose/docker-compose.dev.yml') up -d --wait
if ($LASTEXITCODE -ne 0) { throw "docker compose 실패 ($LASTEXITCODE)" }

if (-not (Test-Path $envFile)) {
    $bytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $key = [System.Convert]::ToHexString($bytes).ToLowerInvariant()

    $lines = Get-Content (Join-Path $root 'server/.env.example') | ForEach-Object {
        if ($_ -match '^SECRET_KEY=') { "SECRET_KEY=$key" }
        elseif ($env:POSTGRES_PORT -and $_ -match '^DATABASE_URL=') {
            $_ -replace '^(DATABASE_URL=.*@[^:/]+):\d+/', "`$1:$($env:POSTGRES_PORT)/"
        }
        else { $_ }
    }
    # BOM 없는 UTF-8, LF
    [System.IO.File]::WriteAllText($envFile, ($lines -join "`n") + "`n")
    Write-Host 'server/.env 생성'
}

Push-Location (Join-Path $root 'server')
try {
    cargo sqlx migrate run
    if ($LASTEXITCODE -ne 0) { throw "cargo sqlx migrate run 실패 ($LASTEXITCODE)" }
}
finally { Pop-Location }

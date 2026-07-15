<#
.SYNOPSIS
  Batch-update version across package.json, tauri.conf.json, and Cargo.toml.

.EXAMPLE
  .\scripts\set-version.ps1 0.2.0
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version
)

$root = Split-Path -Parent $PSScriptRoot

$files = @(
    @{ Path = "$root\package.json";             Pattern = '("version"\s*:\s*")[^"]+(")'          },
    @{ Path = "$root\src-tauri\tauri.conf.json"; Pattern = '("version"\s*:\s*")[^"]+(")'          },
    @{ Path = "$root\src-tauri\Cargo.toml";      Pattern = '(?m)(^version\s*=\s*")[^"]+(")'       }
)

foreach ($f in $files) {
    $path = $f.Path
    if (-not (Test-Path $path)) {
        Write-Warning "Not found: $path"
        continue
    }
    $content = Get-Content $path -Raw -Encoding UTF8
    $updated = $content -replace $f.Pattern, "`${1}$Version`${2}"
    if ($content -eq $updated) {
        Write-Host "[skip] $path  (already $Version)" -ForegroundColor DarkGray
    } else {
        Set-Content $path $updated -NoNewline -Encoding UTF8
        Write-Host "[done] $path -> $Version" -ForegroundColor Green
    }
}

Write-Host "`nVersion set to $Version" -ForegroundColor Cyan

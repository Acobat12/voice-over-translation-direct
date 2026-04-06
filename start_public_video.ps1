param(
    [int]$Port = 8000,
    [string]$VideoFile = ""
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:ScriptRoot = if ($PSScriptRoot) {
    $PSScriptRoot
}
elseif ($PSCommandPath) {
    Split-Path -Parent $PSCommandPath
}
elseif ($MyInvocation.MyCommand.Path) {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}
else {
    (Get-Location).Path
}

function Write-Info([string]$Message) {
    Write-Host "[public-video] $Message"
}

function Get-LocalToolsRoot {
    $tools = Join-Path $script:ScriptRoot ".tools"
    if (-not (Test-Path -LiteralPath $tools)) {
        New-Item -ItemType Directory -Path $tools -Force | Out-Null
    }
    return $tools
}

function Get-ArchInfo {
    $isArm64 = ($env:PROCESSOR_ARCHITECTURE -match "ARM64") -or ($env:PROCESSOR_ARCHITEW6432 -match "ARM64")
    if ($isArm64) {
        return @{
            Cloudflared = "arm64"
            Caddy       = "arm64"
        }
    }

    return @{
        Cloudflared = "amd64"
        Caddy       = "amd64"
    }
}

function Invoke-DownloadFile {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$OutFile
    )

    Write-Info "Downloading: $Url"
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

function Install-FfmpegPortable {
    $toolsRoot = Get-LocalToolsRoot
    $dstDir = Join-Path $toolsRoot "ffmpeg"
    $dstExe = Join-Path $dstDir "ffmpeg.exe"
    $zipPath = Join-Path $env:TEMP ("ffmpeg_{0}.zip" -f ([guid]::NewGuid().ToString("N")))
    $extractDir = Join-Path $env:TEMP ("ffmpeg_extract_{0}" -f ([guid]::NewGuid().ToString("N")))

    if (-not (Test-Path -LiteralPath $dstDir)) {
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }

    $ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

    try {
        Invoke-DownloadFile -Url $ffmpegUrl -OutFile $zipPath
        New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
        Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

        $foundExe = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter "ffmpeg.exe" -ErrorAction Stop |
            Select-Object -First 1

        if (-not $foundExe) {
            throw "ffmpeg.exe not found in extracted archive."
        }

        if (Test-Path -LiteralPath $dstExe) {
            Remove-Item -LiteralPath $dstExe -Force -ErrorAction SilentlyContinue
        }

        Copy-Item -LiteralPath $foundExe.FullName -Destination $dstExe -Force

        if (-not (Test-Path -LiteralPath $dstExe)) {
            throw "ffmpeg copy failed."
        }

        Write-Info "ffmpeg installed to: $dstExe"
        return $dstExe
    }
    finally {
        if (Test-Path -LiteralPath $zipPath) {
            Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
        }

        if (Test-Path -LiteralPath $extractDir) {
            Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-CommandPathIfExists([string]$Name) {
    $toolsRoot = Get-LocalToolsRoot

    switch ($Name) {
        "cloudflared" {
            $portable = Join-Path $toolsRoot "cloudflared\cloudflared.exe"
            if (Test-Path -LiteralPath $portable) { return $portable }
        }
        "caddy" {
            $portable = Join-Path $toolsRoot "caddy\caddy.exe"
            if (Test-Path -LiteralPath $portable) { return $portable }
        }
        "ffmpeg" {
            $portable = Join-Path $toolsRoot "ffmpeg\ffmpeg.exe"
            if (Test-Path -LiteralPath $portable) { return $portable }
        }
    }

    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source)) {
        return $cmd.Source
    }

    if ($Name -eq "cloudflared") {
        $knownCandidates = @(
            (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\cloudflared.exe')
        )

        foreach ($candidate in $knownCandidates) {
            if ($candidate -and (Test-Path -LiteralPath $candidate)) {
                return $candidate
            }
        }

        $wingetPackagesRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
        if (Test-Path -LiteralPath $wingetPackagesRoot) {
            $pkg = Get-ChildItem -LiteralPath $wingetPackagesRoot -Directory -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.Name -like 'Cloudflare.cloudflared_*' -and
                    $_.Name -notlike '*.disabled*'
                } |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1

            if ($pkg) {
                $exe = Join-Path $pkg.FullName 'cloudflared.exe'
                if (Test-Path -LiteralPath $exe) {
                    return $exe
                }
            }
        }
    }

    return $null
}

function Install-CloudflaredPortable {
    $toolsRoot = Get-LocalToolsRoot
    $dstDir = Join-Path $toolsRoot "cloudflared"
    $dstExe = Join-Path $dstDir "cloudflared.exe"

    if (-not (Test-Path -LiteralPath $dstDir)) {
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }

    $arch = (Get-ArchInfo).Cloudflared
    $apiUrl = "https://api.github.com/repos/cloudflare/cloudflared/releases/latest"

    Write-Info "Fetching latest cloudflared release metadata..."
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "public-video-script" }

    $assetPattern = if ($arch -eq "arm64") {
        '^cloudflared-windows-arm64\.exe$'
    } else {
        '^cloudflared-windows-amd64\.exe$'
    }

    $asset = $release.assets | Where-Object { $_.name -match $assetPattern } | Select-Object -First 1
    if (-not $asset) {
        throw "Could not find matching cloudflared asset for architecture: $arch"
    }

    Invoke-DownloadFile -Url $asset.browser_download_url -OutFile $dstExe

    if (-not (Test-Path -LiteralPath $dstExe)) {
        throw "cloudflared download failed."
    }

    Write-Info "cloudflared installed to: $dstExe"
    return $dstExe
}

function Install-CaddyPortable {
    $toolsRoot = Get-LocalToolsRoot
    $dstDir = Join-Path $toolsRoot "caddy"
    $dstExe = Join-Path $dstDir "caddy.exe"
    $zipPath = Join-Path $env:TEMP ("caddy_{0}.zip" -f ([guid]::NewGuid().ToString("N")))

    if (-not (Test-Path -LiteralPath $dstDir)) {
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }

    $arch = (Get-ArchInfo).Caddy
    $apiUrl = "https://api.github.com/repos/caddyserver/caddy/releases/latest"

    Write-Info "Fetching latest Caddy release metadata..."
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "public-video-script" }

    $assetPattern = if ($arch -eq "arm64") {
        '^caddy_.*_windows_arm64\.zip$'
    } else {
        '^caddy_.*_windows_amd64\.zip$'
    }

    $asset = $release.assets | Where-Object { $_.name -match $assetPattern } | Select-Object -First 1
    if (-not $asset) {
        throw "Could not find matching Caddy asset for architecture: $arch"
    }

    try {
        Invoke-DownloadFile -Url $asset.browser_download_url -OutFile $zipPath

        if (Test-Path -LiteralPath $dstExe) {
            Remove-Item -LiteralPath $dstExe -Force -ErrorAction SilentlyContinue
        }

        Expand-Archive -LiteralPath $zipPath -DestinationPath $dstDir -Force

        $foundExe = Get-ChildItem -LiteralPath $dstDir -Recurse -Filter "caddy.exe" -ErrorAction Stop |
            Select-Object -First 1

        if (-not $foundExe) {
            throw "caddy.exe not found in extracted archive."
        }

        if ($foundExe.FullName -ne $dstExe) {
            Copy-Item -LiteralPath $foundExe.FullName -Destination $dstExe -Force
        }

        Write-Info "Caddy installed to: $dstExe"
        return $dstExe
    }
    finally {
        if (Test-Path -LiteralPath $zipPath) {
            Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Ensure-Command([string]$Name) {
    $existing = Get-CommandPathIfExists $Name
    if ($existing) {
        Write-Info "$Name found: $existing"
        return $existing
    }

    Write-Info "$Name not found. Installing..."

    switch ($Name) {
        "cloudflared" { return Install-CloudflaredPortable }
        "caddy"       { return Install-CaddyPortable }
        "ffmpeg"      { return Install-FfmpegPortable }
        default       { throw "Unsupported dependency: $Name" }
    }
}

function Encode-UrlPath([string]$Path) {
    $normalized = $Path -replace '\\', '/'
    $segments = $normalized -split '/'
    $encodedSegments = foreach ($segment in $segments) {
        [System.Uri]::EscapeDataString($segment)
    }
    return ($encodedSegments -join '/')
}

function New-Slug([string]$Text) {
    $slug = $Text.ToLowerInvariant()
    $slug = [regex]::Replace($slug, '[^a-z0-9]+', '-')
    $slug = $slug.Trim('-')
    if (-not $slug) { $slug = 'video' }
    return $slug
}

function Get-VideoFiles([string]$Root) {
    $extensions = @(".mp4", ".mkv", ".mov", ".avi", ".m4v", ".webm")
    return Get-ChildItem -LiteralPath $Root -File -ErrorAction SilentlyContinue |
        Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } |
        Sort-Object Name
}

function Convert-VideoToMp4 {
    param(
        [Parameter(Mandatory = $true)][string]$FfmpegPath,
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $parent = Split-Path -Parent $OutputPath
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    Write-Info "Converting to cached MP4: $(Split-Path -Leaf $InputPath)"

    $arguments = @(
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-i', $InputPath,
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-movflags', '+faststart',
        $OutputPath
    )

    & $FfmpegPath @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "ffmpeg failed while converting: $InputPath"
    }
}

function Get-MediaEntries([string]$Root, [string]$FfmpegPath) {
    $cacheDir = Join-Path $Root ".public-video-cache"
    if (-not (Test-Path -LiteralPath $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }

    $entries = @()
    $usedSlugs = @{}

    foreach ($file in (Get-VideoFiles $Root)) {
        $ext = $file.Extension.ToLowerInvariant()
        $baseSlug = New-Slug $file.BaseName
        $slug = $baseSlug

        $n = 2
        while ($usedSlugs.ContainsKey($slug)) {
            $slug = "$baseSlug-$n"
            $n++
        }
        $usedSlugs[$slug] = $true

        if ($ext -eq ".mp4") {
            $entries += [pscustomobject]@{
                title     = $file.BaseName
                fileName  = $file.Name
                src       = "/" + (Encode-UrlPath $file.Name)
                slug      = $slug
                fullPath  = $file.FullName
                extension = $ext
                mode      = "direct"
            }
            continue
        }

        $cachedName = "$baseSlug.mp4"
        $cachedPath = Join-Path $cacheDir $cachedName

        $needConvert = $true

        if (Test-Path -LiteralPath $cachedPath) {
            $cachedItem = Get-Item -LiteralPath $cachedPath -ErrorAction SilentlyContinue

            if ($cachedItem -and $cachedItem.Length -gt 0) {
                if ($cachedItem.LastWriteTimeUtc -ge $file.LastWriteTimeUtc) {
                    $needConvert = $false
                    Write-Info "Using cached MP4: $cachedName"
                }
            }
        }

        if ($needConvert) {
            Write-Info "Converting to cached MP4: $($file.Name)"

            & $FfmpegPath `
                -y `
                -i $file.FullName `
                -map 0:v:0? `
                -map 0:a:0? `
                -c:v libx264 `
                -preset veryfast `
                -crf 23 `
                -pix_fmt yuv420p `
                -c:a aac `
                -b:a 160k `
                -movflags +faststart `
                $cachedPath

            if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $cachedPath)) {
                throw "FFmpeg conversion failed for: $($file.FullName)"
            }
        }

        $entries += [pscustomobject]@{
            title     = $file.BaseName
            fileName  = $file.Name
            src       = "/.public-video-cache/" + (Encode-UrlPath $cachedName)
            slug      = $baseSlug
            fullPath  = $file.FullName
            extension = $ext
            mode      = "cached"
        }
    }

    return $entries
}
function Ensure-PlaylistJson([string]$Root, [object[]]$Entries) {
    $playlistPath = Join-Path $Root "playlist.json"

    $items = foreach ($entry in $Entries) {
        [pscustomobject]@{
            title = $entry.title
            src   = $entry.src
        }
    }

    $json = $items | ConvertTo-Json -Depth 4
    Set-Content -LiteralPath $playlistPath -Value $json -Encoding UTF8
    return $playlistPath
}

function Ensure-PlayerHtml([string]$Root) {
    $playerPath = Join-Path $Root "player.html"

    $content = @'
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Local Video Player</title>
  <style>
    :root {
      --bg: #0b0d12;
      --panel: rgba(255,255,255,0.06);
      --panel-strong: rgba(255,255,255,0.08);
      --panel-border: rgba(255,255,255,0.10);
      --text: #f5f7fb;
      --muted: #9aa6bd;
      --accent: #6ea8fe;
      --accent-2: rgba(110,168,254,0.18);
      --success: #72e29a;
      --shadow: 0 18px 50px rgba(0,0,0,.42);
      --radius: 20px;
      --radius-sm: 14px;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      width: 100%;
      min-height: 100%;
      background:
        radial-gradient(circle at top, rgba(110,168,254,0.14), transparent 30%),
        linear-gradient(180deg, #111827 0%, var(--bg) 48%, #07090d 100%);
      color: var(--text);
      font-family: Inter, Segoe UI, Roboto, Arial, sans-serif;
    }

    body {
      padding: 18px;
      box-sizing: border-box;
      min-height: 100dvh;
      overflow: hidden;
    }

    .app {
      width: 100%;
      height: calc(100dvh - 36px);
      display: grid;
      grid-template-columns: minmax(0, 1fr) 390px;
      gap: 12px;
      min-height: 0;
    }

    .main {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 14px;
    }

    .panel {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(14px);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 12px 16px;
      min-width: 0;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .brand-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 18px rgba(110,168,254,.85);
      flex: 0 0 auto;
    }

    .brand-copy { min-width: 0; }

    .title {
      font-size: 15px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .subtitle {
      margin-top: 2px;
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .badges {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .pill {
      padding: 7px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .3px;
      border: 1px solid rgba(110,168,254,.22);
      background: rgba(110,168,254,.10);
      color: #dce9ff;
      white-space: nowrap;
    }

    .player-shell {
      min-width: 0;
      min-height: 0;
      padding: 14px;
      display: flex;
      place-items: center;
      overflow: hidden;
    }

    .video-wrap {
      position: relative;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      max-width: 100%;
      max-height: 100%;
      border-radius: var(--radius);
      overflow: hidden;
      background: #000;
      border: 1px solid var(--panel-border);
    }

    video {
      width: 100%;
      height: 100%;
      display: block;
      background: #000;
      object-fit: contain;
      object-position: center center;
    }

    .overlay {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: linear-gradient(180deg, rgba(11,13,18,0.72), rgba(11,13,18,0.88));
      text-align: center;
    }

    .overlay.visible { display: flex; }

    .overlay-card {
      width: min(560px, 100%);
      padding: 24px;
      border-radius: 18px;
      border: 1px solid var(--panel-border);
      background: rgba(255,255,255,.06);
      backdrop-filter: blur(10px);
    }

    .overlay-title {
      margin: 0 0 8px;
      font-size: 20px;
      font-weight: 800;
    }

    .overlay-text {
      margin: 0;
      color: var(--muted);
      line-height: 1.55;
      font-size: 14px;
    }

    .overlay-text.error { color: #ffd6d6; }

    .controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      min-width: 0;
    }

    .controls-left,
    .controls-right {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex-wrap: wrap;
    }

    .btn {
      appearance: none;
      border: 1px solid var(--panel-border);
      background: var(--panel-strong);
      color: var(--text);
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: .18s ease;
    }

    .btn:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: rgba(110,168,254,.35);
      background: rgba(255,255,255,.10);
    }

    .btn:disabled { opacity: .45; cursor: not-allowed; }

    .btn.primary {
      background: var(--accent-2);
      border-color: rgba(110,168,254,.28);
      color: #e6f0ff;
    }

    .meta {
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 420px;
    }

    .check {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--muted);
      user-select: none;
    }

    .check input { accent-color: var(--accent); }

    .sidebar {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 14px;
      padding: 14px;
    }

    .sidebar-title { font-size: 16px; font-weight: 800; }
    .sidebar-subtitle { font-size: 12px; color: var(--muted); margin-top: 4px; }

    .next-card {
      padding: 14px;
      border-radius: 16px;
      border: 1px solid var(--panel-border);
      background: rgba(255,255,255,.04);
    }

    .next-label {
      font-size: 11px;
      letter-spacing: .4px;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 8px;
    }

    .next-title { font-size: 14px; font-weight: 700; line-height: 1.4; }
    .next-empty { font-size: 13px; color: var(--muted); }

    .playlist {
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      display: grid;
      gap: 10px;
      padding-right: 2px;
    }

    .playlist-item {
      width: 100%;
      text-align: left;
      cursor: pointer;
      border: 1px solid var(--panel-border);
      background: rgba(255,255,255,.035);
      color: var(--text);
      border-radius: 14px;
      padding: 12px;
      transition: .18s ease;
    }

    .playlist-item:hover {
      transform: translateY(-1px);
      background: rgba(255,255,255,.065);
      border-color: rgba(110,168,254,.28);
    }

    .playlist-item.active {
      border-color: rgba(110,168,254,.45);
      background: rgba(110,168,254,.14);
      box-shadow: inset 0 0 0 1px rgba(110,168,254,.15);
    }

    .playlist-top {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      margin-bottom: 6px;
    }

    .playlist-index {
      font-size: 11px;
      color: var(--muted);
      font-weight: 700;
      letter-spacing: .3px;
    }

    .playlist-state {
      font-size: 11px;
      color: var(--success);
      font-weight: 800;
      letter-spacing: .3px;
      text-transform: uppercase;
    }

    .playlist-name {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.4;
      word-break: break-word;
    }

    .playlist-src {
      margin-top: 6px;
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .empty {
      padding: 16px;
      border-radius: 14px;
      border: 1px dashed var(--panel-border);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }

    @media (max-width: 1100px) {
      body { overflow: auto; }
      .app {
        height: auto;
        min-height: calc(100dvh - 36px);
        grid-template-columns: 1fr;
      }
      .main { min-height: auto; }
      .player-shell { min-height: unset; overflow: visible; }
      .video-wrap {
        width: 100% !important;
        height: auto !important;
        aspect-ratio: 16 / 9;
        max-height: none;
      }
      .sidebar {
        min-height: unset;
        overflow: visible;
        grid-template-rows: auto auto auto;
      }
      .playlist { max-height: 360px; }
    }

    @media (max-width: 720px) {
      body { padding: 12px; }
      .topbar,
      .controls {
        flex-direction: column;
        align-items: stretch;
      }
      .badges,
      .controls-right {
        justify-content: flex-start;
      }
      .meta { max-width: none; }
    }
  </style>
</head>
<body>
  <div class="app">
    <section class="main">
      <div class="panel topbar">
        <div class="brand">
          <div class="brand-dot"></div>
          <div class="brand-copy">
            <div class="title" id="videoTitle">Local Video Player</div>
            <div class="subtitle" id="videoSubtitle">Waiting for source...</div>
          </div>
        </div>

        <div class="badges">
          <div class="pill" id="playlistBadge">Playlist: --</div>
          <div class="pill">STATIC MP4 DELIVERY</div>
        </div>
      </div>

      <div class="panel player-shell">
        <div class="video-wrap">
          <video id="video" controls preload="metadata" playsinline></video>

          <div class="overlay visible" id="overlay">
            <div class="overlay-card">
              <h1 class="overlay-title" id="overlayTitle">Loading video</h1>
              <p class="overlay-text" id="overlayText">Preparing the player...</p>
            </div>
          </div>
        </div>
      </div>

      <div class="panel controls">
        <div class="controls-left">
          <button class="btn" id="prevBtn" type="button">&larr; Previous</button>
          <button class="btn primary" id="nextBtn" type="button">Next &rarr;</button>
          <label class="check">
            <input type="checkbox" id="autoplayNext" checked />
            Auto play next
          </label>
        </div>

        <div class="controls-right">
          <div class="meta" id="metaInfo">No playlist loaded</div>
        </div>
      </div>
    </section>

    <aside class="panel sidebar">
      <div>
        <div class="sidebar-title">Queue</div>
        <div class="sidebar-subtitle" id="queueSubtitle">Waiting for playlist...</div>
      </div>

      <div class="next-card">
        <div class="next-label">Up next</div>
        <div class="next-title" id="upNextTitle">Nothing queued</div>
        <div class="next-empty" id="upNextMeta"></div>
      </div>

      <div class="playlist" id="playlist"></div>
    </aside>
  </div>

  <script>
    const params = new URLSearchParams(window.location.search);
    const rawSrc = params.get("src");
    const playlistUrl = params.get("list") || "/playlist.json";

    const video = document.getElementById("video");
    const overlay = document.getElementById("overlay");
    const overlayTitle = document.getElementById("overlayTitle");
    const overlayText = document.getElementById("overlayText");
    const videoTitle = document.getElementById("videoTitle");
    const videoSubtitle = document.getElementById("videoSubtitle");
    const playlistEl = document.getElementById("playlist");
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    const autoplayNext = document.getElementById("autoplayNext");
    const metaInfo = document.getElementById("metaInfo");
    const playlistBadge = document.getElementById("playlistBadge");
    const queueSubtitle = document.getElementById("queueSubtitle");
    const upNextTitle = document.getElementById("upNextTitle");
    const upNextMeta = document.getElementById("upNextMeta");
    const playerShell = document.querySelector(".player-shell");
    const videoWrap = document.querySelector(".video-wrap");

    let playlist = [];
    let currentIndex = -1;

    function showOverlay(title, text, isError = false) {
      overlay.classList.add("visible");
      overlayTitle.textContent = title;
      overlayText.textContent = text;
      overlayText.className = isError ? "overlay-text error" : "overlay-text";
    }

    function hideOverlay() {
      overlay.classList.remove("visible");
    }

    function decodePath(v) {
      try { return decodeURIComponent(v); } catch { return v; }
    }

    function getCleanPath(path) {
      return String(path || "").split("?")[0].split("#")[0];
    }

    function getFileName(path) {
      const clean = getCleanPath(path);
      const parts = clean.split("/");
      return parts[parts.length - 1] || "video.mp4";
    }

    function isMp4File(path) {
      return /\.mp4(?:$|[?#])/i.test(String(path || ""));
    }

    function normalizeItem(item, index) {
      if (typeof item === "string") {
        return {
          title: getFileName(item),
          src: item,
          index
        };
      }

      return {
        title: item.title || getFileName(item.src || ""),
        src: item.src || "",
        index
      };
    }

    function samePath(a, b) {
      const left = getCleanPath(decodePath(a)).toLowerCase();
      const right = getCleanPath(decodePath(b)).toLowerCase();
      return left === right;
    }

    function getVideoAspect() {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        return video.videoWidth / video.videoHeight;
      }
      return 16 / 9;
    }

    function fitPlayer() {
      if (!playerShell || !videoWrap) return;

      if (window.innerWidth <= 1100) {
        videoWrap.style.width = "100%";
        videoWrap.style.height = "auto";
        videoWrap.style.aspectRatio = "16 / 9";
        return;
      }

      const shellRect = playerShell.getBoundingClientRect();
      const shellStyle = getComputedStyle(playerShell);

      const padX =
        parseFloat(shellStyle.paddingLeft || "0") +
        parseFloat(shellStyle.paddingRight || "0");

      const padY =
        parseFloat(shellStyle.paddingTop || "0") +
        parseFloat(shellStyle.paddingBottom || "0");

      const availableWidth = Math.max(0, shellRect.width - padX);
      const availableHeight = Math.max(0, shellRect.height - padY);

      if (!availableWidth || !availableHeight) return;

      const aspect = getVideoAspect();
      let width = availableWidth;
      let height = width / aspect;

      if (height > availableHeight) {
        height = availableHeight;
        width = height * aspect;
      }

      videoWrap.style.aspectRatio = "auto";
      videoWrap.style.width = Math.floor(width) + "px";
      videoWrap.style.height = Math.floor(height) + "px";
    }

    async function navigateToIndex(index, autoPlay = false) {
      if (index < 0 || index >= playlist.length) return;

      currentIndex = index;
      const item = playlist[index];

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("src", item.src);
      nextUrl.searchParams.set("list", playlistUrl);
      history.replaceState(null, "", nextUrl.toString());

      renderPlaylist();
      setVideoMeta(item.src);
      updateNavButtons();
      updateUpNext();

      await loadVideoSource(item.src, autoPlay);
    }

    function updateNavButtons() {
      prevBtn.disabled = currentIndex <= 0;
      nextBtn.disabled = currentIndex < 0 || currentIndex >= playlist.length - 1;
    }

    function updateUpNext() {
      if (currentIndex >= 0 && currentIndex < playlist.length - 1) {
        const nextItem = playlist[currentIndex + 1];
        upNextTitle.textContent = nextItem.title;
        upNextMeta.textContent = nextItem.src;
      } else {
        upNextTitle.textContent = "End of playlist";
        upNextMeta.textContent = "No next video available.";
      }
    }

    function renderPlaylist() {
      playlistEl.innerHTML = "";

      if (!playlist.length) {
        playlistEl.innerHTML = '<div class="empty">playlist.json is empty or unavailable.</div>';
        queueSubtitle.textContent = "Single video mode";
        playlistBadge.textContent = "Playlist: 0 items";
        updateNavButtons();
        updateUpNext();
        return;
      }

      queueSubtitle.textContent = playlist.length + " video(s)";
      playlistBadge.textContent = "Playlist: " + playlist.length + " items";

      playlist.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "playlist-item" + (index === currentIndex ? " active" : "");
        button.innerHTML = `
          <div class="playlist-top">
            <div class="playlist-index">#${String(index + 1).padStart(2, "0")}</div>
            ${index === currentIndex ? '<div class="playlist-state">Now playing</div>' : ""}
          </div>
          <div class="playlist-name"></div>
          <div class="playlist-src"></div>
        `;
        button.querySelector(".playlist-name").textContent = item.title;
        button.querySelector(".playlist-src").textContent = item.src;
        button.addEventListener("click", () => navigateToIndex(index, true));
        playlistEl.appendChild(button);
      });

      updateNavButtons();
      updateUpNext();
    }

    function setVideoMeta(src) {
      const fileName = getFileName(src);
      videoTitle.textContent = fileName;
      videoSubtitle.textContent = src;

      if (currentIndex >= 0 && playlist[currentIndex]) {
        metaInfo.textContent = "Playing " + (currentIndex + 1) + " of " + playlist.length + " | " + playlist[currentIndex].title;
      } else {
        metaInfo.textContent = "Single video mode • " + fileName;
      }
    }

    async function loadVideoSource(src, autoPlay = false) {
      const decodedSrc = decodePath(src);

      if (!decodedSrc) {
        showOverlay("No video source", "Add a source via ?src=/path/to/video.mp4", true);
        return;
      }

      if (!isMp4File(decodedSrc)) {
        showOverlay("Unsupported source", "Expected a direct .mp4 file", true);
        return;
      }

      setVideoMeta(decodedSrc);
      showOverlay("Loading video", "Fetching MP4 file...");

      video.pause();
      video.preload = "auto";
      video.src = decodedSrc;
      video.load();

      if (autoPlay) {
        try {
          await video.play();
          hideOverlay();
        } catch {
          showOverlay(
            "Ready to play",
            "Autoplay was blocked. Press Play to continue.",
            false
          );
        }
      }
    }

    function attachVideoEvents() {
      video.addEventListener("loadedmetadata", () => {
        const duration = Math.round(video.duration || 0);
        const prefix = currentIndex >= 0
          ? ("Playing " + (currentIndex + 1) + " of " + playlist.length + " | ")
          : "";
        videoSubtitle.textContent =
          prefix + getFileName(video.currentSrc || video.src) + " | " + duration + " sec";
        fitPlayer();
      });

      video.addEventListener("canplay", () => {
        hideOverlay();
        fitPlayer();
      });

      video.addEventListener("waiting", () => {
        showOverlay("Buffering", "Please wait...");
      });

      video.addEventListener("playing", () => {
        hideOverlay();
      });

      video.addEventListener("ended", async () => {
        if (!autoplayNext.checked) return;
        if (currentIndex >= 0 && currentIndex < playlist.length - 1) {
          await navigateToIndex(currentIndex + 1, true);
        }
      });

      video.addEventListener("error", () => {
        const mediaError = video.error;
        let message = "The file could not be loaded.";

        if (mediaError) {
          switch (mediaError.code) {
            case MediaError.MEDIA_ERR_ABORTED:
              message = "Playback was aborted.";
              break;
            case MediaError.MEDIA_ERR_NETWORK:
              message = "A network error occurred while loading the video.";
              break;
            case MediaError.MEDIA_ERR_DECODE:
              message = "The video file is corrupted or cannot be decoded.";
              break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
              message = "This video source is not supported.";
              break;
          }
        }

        showOverlay("Playback error", message, true);
      });
    }

    async function tryLoadPlaylist() {
      try {
        const res = await fetch(playlistUrl, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);

        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("playlist must be an array");

        playlist = data
          .map(normalizeItem)
          .filter(x => x.src && isMp4File(x.src));

        if (!playlist.length) {
          currentIndex = -1;
          renderPlaylist();
          return;
        }

        const decodedSrc = decodePath(rawSrc || "");
        currentIndex = playlist.findIndex(x => samePath(x.src, decodedSrc));

        if (currentIndex < 0 && decodedSrc && isMp4File(decodedSrc)) {
          playlist.unshift(normalizeItem({ src: decodedSrc, title: getFileName(decodedSrc) }, 0));
          currentIndex = 0;
        }

        renderPlaylist();
      } catch {
        playlist = [];
        currentIndex = -1;
        renderPlaylist();
      }
    }

    prevBtn.addEventListener("click", async () => {
      if (currentIndex > 0) {
        await navigateToIndex(currentIndex - 1, false);
      }
    });

    nextBtn.addEventListener("click", async () => {
      if (currentIndex >= 0 && currentIndex < playlist.length - 1) {
        await navigateToIndex(currentIndex + 1, true);
      }
    });

    document.addEventListener("keydown", async (e) => {
      if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;

      if (e.key === "ArrowRight" && !nextBtn.disabled) {
        await navigateToIndex(currentIndex + 1, true);
      }

      if (e.key === "ArrowLeft" && !prevBtn.disabled) {
        await navigateToIndex(currentIndex - 1, false);
      }
    });

    window.addEventListener("resize", fitPlayer);

    if (typeof ResizeObserver !== "undefined" && playerShell) {
      const ro = new ResizeObserver(() => fitPlayer());
      ro.observe(playerShell);
    }

    (async function init() {
      attachVideoEvents();
      await tryLoadPlaylist();

      if (!rawSrc) {
        if (playlist.length > 0) {
          currentIndex = 0;
          renderPlaylist();
          updateNavButtons();
          updateUpNext();

          const firstItem = playlist[0];
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set("src", firstItem.src);
          nextUrl.searchParams.set("list", playlistUrl);
          history.replaceState(null, "", nextUrl.toString());

          await loadVideoSource(firstItem.src, false);
          return;
        }

        showOverlay("No videos found", "playlist.json is empty or no supported videos were found.", true);
        renderPlaylist();
        return;
      }

      if (currentIndex >= 0 && playlist[currentIndex]) {
        await loadVideoSource(playlist[currentIndex].src, false);
      } else {
        await loadVideoSource(rawSrc, false);
      }
    })();
  </script>
</body>
</html>
'@

    Set-Content -LiteralPath $playerPath -Value $content -Encoding UTF8
    return $playerPath
}

function Test-PortBindable([int]$PortNumber) {
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $PortNumber)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($listener) {
            try { $listener.Stop() } catch {}
        }
    }
}

function Get-FreeTcpPort([int]$PreferredPort = 8000, [int]$MaxAttempts = 50) {
    if ((Test-PortBindable $PreferredPort)) {
        return $PreferredPort
    }

    for ($candidate = $PreferredPort + 1; $candidate -lt ($PreferredPort + $MaxAttempts); $candidate++) {
        if (Test-PortBindable $candidate) {
            return $candidate
        }
    }

    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally {
        $listener.Stop()
    }
}

function Get-TryCloudflareIPv4([string]$HostName, [int]$Attempts = 5, [int]$DelaySeconds = 1) {
    for ($i = 0; $i -lt $Attempts; $i++) {
        try {
            $records = Resolve-DnsName $HostName -Server 1.1.1.1 -Type A -ErrorAction Stop
            $ip = $records |
                Where-Object { $_.Type -eq 'A' -and $_.IPAddress } |
                Select-Object -ExpandProperty IPAddress -First 1

            if ($ip) {
                return $ip
            }
        } catch {
        }

        Start-Sleep -Seconds $DelaySeconds
    }

    return $null
}

function Get-ChromiumBrowserPath {
    $candidates = @(
        "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

function Test-TcpPortOpen([string]$HostName, [int]$PortNumber, [int]$TimeoutMs = 1500) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $PortNumber, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if (-not $ok) {
            return $false
        }

        $client.EndConnect($async)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

function Open-TunnelUrl([string]$PublicUrl) {
    try {
        $uri = [uri]$PublicUrl
        $hostName = $uri.Host
    } catch {
        Write-Info "Invalid URL: $PublicUrl"
        return $false
    }

    $browser = Get-ChromiumBrowserPath
    if (-not $browser) {
        Write-Info "Chrome/Edge not found. Open this manually:"
        Write-Info $PublicUrl
        return $false
    }

    $ip = Get-TryCloudflareIPv4 $hostName -Attempts 5 -DelaySeconds 1

    if ($ip) {
        $resolverArg = "--host-resolver-rules=`"MAP $hostName $ip`""
        Write-Info "Opening via browser resolver override: $hostName -> $ip"

        Start-Process `
            -FilePath $browser `
            -ArgumentList @($resolverArg, "--new-window", $PublicUrl)

        return $true
    }

    Write-Info "Fast DNS resolve failed, opening normally:"
    Write-Info $PublicUrl

    try {
        Start-Process `
            -FilePath $browser `
            -ArgumentList @("--new-window", $PublicUrl)
        return $true
    } catch {
        Write-Info "Could not open automatically. Open this manually:"
        Write-Info $PublicUrl
        return $false
    }
}

$root = $script:ScriptRoot
Set-Location $root

$cloudflared = Ensure-Command "cloudflared"
$caddy = Ensure-Command "caddy"
$ffmpeg = Ensure-Command "ffmpeg"

$playerPath = Ensure-PlayerHtml $root
$mediaEntries = Get-MediaEntries -Root $root -FfmpegPath $ffmpeg
$playlistPath = Ensure-PlaylistJson $root $mediaEntries

Write-Info "Generated player: $playerPath"
Write-Info "Generated playlist: $playlistPath"

if (-not (Test-Path -LiteralPath $playerPath)) {
    throw "player.html was not created: $playerPath"
}

if (-not (Test-Path -LiteralPath $playlistPath)) {
    throw "playlist.json was not created: $playlistPath"
}

if (-not $mediaEntries -or $mediaEntries.Count -eq 0) {
    throw "No supported video files were found in: $root"
}

$selectedEntry = $null
if ($VideoFile) {
    $videoFullPath = Join-Path $root $VideoFile
    if (-not (Test-Path -LiteralPath $videoFullPath)) {
        throw "Video file not found: $videoFullPath"
    }

    $videoName = [System.IO.Path]::GetFileName($videoFullPath)
    $selectedEntry = $mediaEntries | Where-Object { $_.fileName -eq $videoName } | Select-Object -First 1
    if (-not $selectedEntry) {
        throw "Selected video is not in the generated playlist: $videoName"
    }
}

Write-Info "Serving folder: $root"
Write-Info "Using cloudflared: $cloudflared"
Write-Info "Using caddy: $caddy"
Write-Info "Using ffmpeg: $ffmpeg"

try {
    $existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($existing) {
        foreach ($conn in $existing) {
            try {
                Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            } catch {}
        }
        Start-Sleep -Seconds 1
    }
} catch {}

$requestedPort = $Port
$Port = Get-FreeTcpPort -PreferredPort $Port
if ($Port -ne $requestedPort) {
    Write-Info "Requested port $requestedPort is unavailable. Using port $Port instead."
}

$localUrl = "http://127.0.0.1:$Port/"
Write-Info "Local server: $localUrl"

$serverProc = $null
$cfProc = $null
$stdoutFile = $null
$stderrFile = $null
$caddyStdoutFile = $null
$caddyStderrFile = $null

try {
    $caddyStdoutFile = Join-Path $env:TEMP ("caddy_stdout_{0}.log" -f ([guid]::NewGuid().ToString("N")))
    $caddyStderrFile = Join-Path $env:TEMP ("caddy_stderr_{0}.log" -f ([guid]::NewGuid().ToString("N")))

    Write-Info "Launching Caddy in background..."
    $serverProc = Start-Process `
        -FilePath $caddy `
        -ArgumentList @("file-server", "--listen", "127.0.0.1:$Port", "--root", ".") `
        -WorkingDirectory $root `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $caddyStdoutFile `
        -RedirectStandardError $caddyStderrFile

    $serverReady = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500

        if ($serverProc.HasExited) {
            $caddyOut = if (Test-Path -LiteralPath $caddyStdoutFile) { Get-Content -LiteralPath $caddyStdoutFile -Raw -ErrorAction SilentlyContinue } else { '' }
            $caddyErr = if (Test-Path -LiteralPath $caddyStderrFile) { Get-Content -LiteralPath $caddyStderrFile -Raw -ErrorAction SilentlyContinue } else { '' }
            throw "Caddy exited early.`nSTDOUT:`n$caddyOut`nSTDERR:`n$caddyErr"
        }

        if (Test-TcpPortOpen -HostName "127.0.0.1" -PortNumber $Port) {
            $serverReady = $true
            break
        }
    }

    if (-not $serverReady) {
        $caddyOut = if (Test-Path -LiteralPath $caddyStdoutFile) { Get-Content -LiteralPath $caddyStdoutFile -Raw -ErrorAction SilentlyContinue } else { '' }
        $caddyErr = if (Test-Path -LiteralPath $caddyStderrFile) { Get-Content -LiteralPath $caddyStderrFile -Raw -ErrorAction SilentlyContinue } else { '' }
        throw "Local server did not start on http://127.0.0.1:$Port/`nCaddy STDOUT:`n$caddyOut`nCaddy STDERR:`n$caddyErr"
    }

    $stdoutFile = Join-Path $env:TEMP ("cloudflared_stdout_{0}.log" -f ([guid]::NewGuid().ToString("N")))
    $stderrFile = Join-Path $env:TEMP ("cloudflared_stderr_{0}.log" -f ([guid]::NewGuid().ToString("N")))

    Write-Info "Launching cloudflared in background..."
    $cfProc = Start-Process `
        -FilePath $cloudflared `
        -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port/", "--no-autoupdate") `
        -WorkingDirectory $root `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutFile `
        -RedirectStandardError $stderrFile

    $publicUrl = $null
    $outText = ''
    $errText = ''

    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 1

        if (Test-Path -LiteralPath $stdoutFile) {
            $outText = Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue
        }

        if (Test-Path -LiteralPath $stderrFile) {
            $errText = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue
        }

        $combined = $outText + "`n" + $errText

        $match = [regex]::Match(
            $combined,
            'https://[a-z0-9-]+\.trycloudflare\.com',
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )

        if ($match.Success) {
            $publicUrl = $match.Value.TrimEnd('/')
            break
        }

        if ($cfProc.HasExited) {
            break
        }
    }

    if (-not $publicUrl) {
        Write-Info "Could not parse public URL automatically."
        Write-Info "STDOUT log: $stdoutFile"
        Write-Info "STDERR log: $stderrFile"
    }
    else {
        if ($selectedEntry) {
            $encodedVideo = [System.Uri]::EscapeDataString($selectedEntry.src)
            $targetUrl = "$publicUrl/player.html?src=$encodedVideo&list=/playlist.json"
        }
        else {
            $targetUrl = "$publicUrl/player.html?list=/playlist.json"
        }

        Write-Info "Public URL: $targetUrl"

        try {
            Set-Clipboard -Value $targetUrl
            Write-Info "Public URL copied to clipboard."
        } catch {
            Write-Info "Could not copy URL to clipboard."
        }

        [void](Open-TunnelUrl $targetUrl)
    }

    Write-Info "Press Ctrl+C to stop everything."

    while ($true) {
        Start-Sleep -Seconds 2

        if ($serverProc -and $serverProc.HasExited) {
            throw "Local server exited unexpectedly."
        }

        if ($cfProc -and $cfProc.HasExited) {
            throw "cloudflared exited unexpectedly."
        }
    }
}
finally {
    if ($cfProc -and -not $cfProc.HasExited) {
        try { Stop-Process -Id $cfProc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }

    if ($serverProc -and -not $serverProc.HasExited) {
        try { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }

    foreach ($file in @($stdoutFile, $stderrFile, $caddyStdoutFile, $caddyStderrFile)) {
        if ($file -and (Test-Path -LiteralPath $file)) {
            try { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
}

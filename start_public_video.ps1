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

function Get-CommandPathIfExists([string]$Name) {
    $toolsRoot = Get-LocalToolsRoot

    switch ($Name) {
        "cloudflared" {
            $portable = Join-Path $toolsRoot "cloudflared\cloudflared.exe"
            if (Test-Path -LiteralPath $portable) {
                return $portable
            }
        }
        "caddy" {
            $portable = Join-Path $toolsRoot "caddy\caddy.exe"
            if (Test-Path -LiteralPath $portable) {
                return $portable
            }
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
                Where-Object { $_.Name -like 'Cloudflare.cloudflared_*' } |
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
        default       { throw "Unsupported dependency: $Name" }
    }
}

function Ensure-PlayerHtml([string]$Root) {
    $playerPath = Join-Path $Root "player.html"

    $content = @'
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Video Player</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #111;
      overflow: hidden;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    video {
      width: 100%;
      height: 100%;
      background: #000;
    }
  </style>
</head>
<body>
  <video id="video" controls preload="none" playsinline></video>

  <script>
    const params = new URLSearchParams(location.search);
    const src = params.get("src");
    const video = document.getElementById("video");

    if (src) {
      video.src = src;
    } else {
      document.body.innerHTML = "<div style='color:#fff;font:16px sans-serif'>No video src specified</div>";
    }
  </script>
</body>
</html>
'@

    Set-Content -LiteralPath $playerPath -Value $content -Encoding UTF8
    return $playerPath
}

function Encode-UrlPath([string]$Path) {
    $normalized = $Path -replace '\\', '/'
    $segments = $normalized -split '/'
    $encodedSegments = foreach ($segment in $segments) {
        [System.Uri]::EscapeDataString($segment)
    }
    return ($encodedSegments -join '/')
}

function Escape-Html([string]$Text) {
    if ($null -eq $Text) { return "" }
    return [System.Net.WebUtility]::HtmlEncode($Text)
}

function Get-VideoFiles([string]$Root) {
    $extensions = @(".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v")
    return Get-ChildItem -LiteralPath $Root -File -ErrorAction SilentlyContinue |
        Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } |
        Sort-Object Name
}

function Ensure-IndexHtml([string]$Root) {
    $indexPath = Join-Path $Root "index.html"
    $videoFiles = Get-VideoFiles $Root

    $itemsBuilder = New-Object System.Text.StringBuilder

    foreach ($file in $videoFiles) {
        $encoded = Encode-UrlPath $file.Name
        $safeName = Escape-Html $file.Name
        $sizeMb = [math]::Round($file.Length / 1MB, 2)

        [void]$itemsBuilder.AppendLine('<a class="card" href="/player.html?src=/' + $encoded + '">')
        [void]$itemsBuilder.AppendLine('  <div class="title">' + $safeName + '</div>')
        [void]$itemsBuilder.AppendLine('  <div class="meta">' + $sizeMb + ' MB</div>')
        [void]$itemsBuilder.AppendLine('</a>')
    }

    if ($itemsBuilder.Length -eq 0) {
        [void]$itemsBuilder.AppendLine('<div class="empty">No video files were found in this folder.</div>')
    }

    $safeRoot = Escape-Html $Root
    $itemsHtml = $itemsBuilder.ToString()

    $content = @"
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Video Folder</title>
  <style>
    :root {
      color-scheme: dark;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #111;
      color: #fff;
      font: 16px/1.4 Arial, sans-serif;
    }
    .wrap {
      max-width: 960px;
      margin: 0 auto;
      padding: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
    }
    .sub {
      margin: 0 0 24px;
      color: #aaa;
      word-break: break-all;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 14px;
    }
    .card {
      display: block;
      text-decoration: none;
      color: #fff;
      background: #1b1b1b;
      border: 1px solid #2a2a2a;
      border-radius: 14px;
      padding: 16px;
      transition: transform .12s ease, border-color .12s ease, background .12s ease;
    }
    .card:hover {
      transform: translateY(-1px);
      border-color: #4a4a4a;
      background: #202020;
    }
    .title {
      font-weight: 700;
      word-break: break-word;
      margin-bottom: 8px;
    }
    .meta {
      color: #9aa0a6;
      font-size: 14px;
    }
    .empty {
      color: #bbb;
      background: #1b1b1b;
      border: 1px solid #2a2a2a;
      border-radius: 14px;
      padding: 16px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Videos in folder</h1>
    <div class="sub">$safeRoot</div>
    <div class="grid">
$itemsHtml
    </div>
  </div>
</body>
</html>
"@

    Set-Content -LiteralPath $indexPath -Value $content -Encoding UTF8
    return $indexPath
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

$playerPath = Ensure-PlayerHtml $root
$indexPath  = Ensure-IndexHtml $root

Write-Info "Generated player: $playerPath"
Write-Info "Generated index: $indexPath"

if (-not (Test-Path -LiteralPath $playerPath)) {
    throw "player.html was not created: $playerPath"
}

if (-not (Test-Path -LiteralPath $indexPath)) {
    throw "index.html was not created: $indexPath"
}

if ($VideoFile) {
    $videoFullPath = Join-Path $root $VideoFile
    if (-not (Test-Path -LiteralPath $videoFullPath)) {
        throw "Video file not found: $videoFullPath"
    }
}

Write-Info "Serving folder: $root"
Write-Info "Using cloudflared: $cloudflared"
Write-Info "Using caddy: $caddy"

$localUrl = "http://127.0.0.1:$Port/"
$localIndexUrl = $localUrl
Write-Info "Local server: $localUrl"

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
        -ArgumentList @("file-server", "--listen", ":$Port", "--root", ".", "--browse") `
        -WorkingDirectory $root `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $caddyStdoutFile `
        -RedirectStandardError $caddyStderrFile


    $serverReady = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500

        if ($serverProc.HasExited) {
            $caddyOut = ""
            $caddyErr = ""

            if (Test-Path -LiteralPath $caddyStdoutFile) {
                $caddyOut = Get-Content -LiteralPath $caddyStdoutFile -Raw -ErrorAction SilentlyContinue
            }

            if (Test-Path -LiteralPath $caddyStderrFile) {
                $caddyErr = Get-Content -LiteralPath $caddyStderrFile -Raw -ErrorAction SilentlyContinue
            }

            throw "Caddy exited early.`nSTDOUT:`n$caddyOut`nSTDERR:`n$caddyErr"
        }

        if (Test-TcpPortOpen -HostName "127.0.0.1" -PortNumber $Port) {
            $serverReady = $true
            break
        }
    }

    if (-not $serverReady) {
        $caddyOut = ""
        $caddyErr = ""

        if (Test-Path -LiteralPath $caddyStdoutFile) {
            $caddyOut = Get-Content -LiteralPath $caddyStdoutFile -Raw -ErrorAction SilentlyContinue
        }

        if (Test-Path -LiteralPath $caddyStderrFile) {
            $caddyErr = Get-Content -LiteralPath $caddyStderrFile -Raw -ErrorAction SilentlyContinue
        }

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
    } else {
        if ($VideoFile) {
            $encodedPath = Encode-UrlPath $VideoFile
            $targetUrl = "$publicUrl/player.html?src=/$encodedPath"
        } else {
            $targetUrl = "$publicUrl/index.html"
        }

        Write-Info "Public URL: $targetUrl"

        try {
            Set-Clipboard -Value $targetUrl
            Write-Info "Public URL copied to clipboard."
        } catch {
            Write-Info "Could not copy URL to clipboard."
        }

        $hostName = ([uri]$targetUrl).Host
        Open-TunnelUrl $targetUrl
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
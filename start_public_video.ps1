param(
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Info([string]$Message) {
    Write-Host "[public-video] $Message"
}

function Require-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source)) {
        return $cmd.Source
    }

    if ($Name -eq "python") {
        $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
        if ($pyLauncher -and $pyLauncher.Source -and (Test-Path -LiteralPath $pyLauncher.Source)) {
            return $pyLauncher.Source
        }
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

    throw "$Name not found."
}

function Get-TryCloudflareIPv4([string]$HostName, [int]$Attempts = 18, [int]$DelaySeconds = 2) {
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
            # retry
        }

        Start-Sleep -Seconds $DelaySeconds
    }

    return $null
}

function Get-ChromiumBrowserPath {
    $candidates = @(
        "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

function Open-TunnelUrl([string]$PublicUrl) {
    try {
        $uri = [uri]$PublicUrl
        $hostName = $uri.Host
    } catch {
        Write-Info "Invalid URL: $PublicUrl"
        return $false
    }

    $ip = Get-TryCloudflareIPv4 $hostName
    if (-not $ip) {
        Write-Info "Could not resolve $hostName even via 1.1.1.1"
        return $false
    }

    $browser = Get-ChromiumBrowserPath
    if (-not $browser) {
        Write-Info "Edge/Chrome not found. Open this manually:"
        Write-Info $PublicUrl
        return $false
    }

    Write-Info "Opening via browser resolver override: $hostName -> $ip"

    Start-Process `
        -FilePath $browser `
        -ArgumentList @("--host-resolver-rules=MAP $hostName $ip", $PublicUrl)

    return $true
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$python = Require-Command "python"
$cloudflared = Require-Command "cloudflared"

Write-Info "Serving folder: $root"
Write-Info "Using python: $python"
Write-Info "Using cloudflared: $cloudflared"

$localUrl = "http://127.0.0.1:$Port/"
Write-Info "Local server: $localUrl"

# Если порт занят — останавливаем старый процесс
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

$pyProc = $null
$cfProc = $null
$stdoutFile = $null
$stderrFile = $null

try {
    $pythonArgs = @("-m", "http.server", $Port.ToString(), "--bind", "127.0.0.1")

    if ([System.IO.Path]::GetFileNameWithoutExtension($python).ToLowerInvariant() -eq "py") {
        $pythonArgs = @("-3", "-m", "http.server", $Port.ToString(), "--bind", "127.0.0.1")
    }

    Write-Info "Launching Python in background..."
    $pyProc = Start-Process `
        -FilePath $python `
        -ArgumentList $pythonArgs `
        -WorkingDirectory $root `
        -PassThru `
        -WindowStyle Hidden

    $serverReady = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        try {
            Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
            $serverReady = $true
            break
        } catch {}
    }

    if (-not $serverReady) {
        throw "Local Python server did not start on $localUrl"
    }

    $stdoutFile = Join-Path $env:TEMP ("cloudflared_stdout_{0}.log" -f ([guid]::NewGuid().ToString("N")))
    $stderrFile = Join-Path $env:TEMP ("cloudflared_stderr_{0}.log" -f ([guid]::NewGuid().ToString("N")))

    Write-Info "Launching cloudflared in background..."
    $cfProc = Start-Process `
        -FilePath $cloudflared `
        -ArgumentList @("tunnel", "--url", $localUrl, "--no-autoupdate") `
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
        Write-Info "Public URL: $publicUrl/"
        try {
            Set-Clipboard -Value ($publicUrl + "/")
            Write-Info "Public URL copied to clipboard."
        } catch {
            Write-Info "Could not copy URL to clipboard."
        }

        [void](Open-TunnelUrl ($publicUrl + "/"))
    }

    Write-Info "Press Ctrl+C to stop everything."

    while ($true) {
        Start-Sleep -Seconds 2

        if ($pyProc -and $pyProc.HasExited) {
            throw "Python server exited unexpectedly."
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

    if ($pyProc -and -not $pyProc.HasExited) {
        try { Stop-Process -Id $pyProc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }

    foreach ($file in @($stdoutFile, $stderrFile)) {
        if ($file -and (Test-Path -LiteralPath $file)) {
            try { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
}
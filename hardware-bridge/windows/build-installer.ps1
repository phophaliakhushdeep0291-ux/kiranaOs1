param(
  [string]$Configuration = "Release",
  [string]$Version = "1.4.0"
)

$ErrorActionPreference = "Stop"
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $PSScriptRoot "stage"
$dist = Join-Path $bridgeRoot "dist"
$winswUrl = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
$winswSha256 = "05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA"

if (-not $env:KIRANA_CODE_SIGN_PFX -or -not $env:KIRANA_CODE_SIGN_PASSWORD) {
  throw "Release signing requires KIRANA_CODE_SIGN_PFX and KIRANA_CODE_SIGN_PASSWORD. Unsigned retail installers are intentionally not produced."
}
if (-not $env:KIRANA_FRONTEND_ORIGINS) { throw "KIRANA_FRONTEND_ORIGINS must explicitly list the HTTPS KiranaOS frontend origins." }
$iscc = (Get-Command ISCC.exe -ErrorAction Stop).Source
$signtool = (Get-Command signtool.exe -ErrorAction Stop).Source
$dotnet = (Get-Command dotnet.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$packageVersion = (Get-Content -Raw (Join-Path $bridgeRoot "package.json") | ConvertFrom-Json).version
if ($Version -ne $packageVersion) { throw "Installer version $Version must match hardware-bridge package version $packageVersion." }
$serverSource = Get-Content -Raw (Join-Path $bridgeRoot "src\server.mjs")
if (-not $serverSource.Contains("const VERSION = `"$Version`";")) { throw "Installer version $Version must match the bridge health version." }

if (Test-Path -LiteralPath $stage) {
  $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
  $resolvedWindows = (Resolve-Path -LiteralPath $PSScriptRoot).Path
  if (-not $resolvedStage.StartsWith($resolvedWindows, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe stage path" }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $stage "runtime"), (Join-Path $stage "app"), (Join-Path $stage "setup"), $dist | Out-Null
$allowedOrigins = @($env:KIRANA_FRONTEND_ORIGINS.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($allowedOrigins.Count -eq 0) { throw "KIRANA_FRONTEND_ORIGINS must contain at least one frontend origin." }
foreach ($origin in $allowedOrigins) {
  $uri = [Uri]$origin
  $loopback = $uri.Host -in @("127.0.0.1", "localhost", "::1")
  if (($uri.Scheme -ne "https") -and -not ($uri.Scheme -eq "http" -and $loopback)) { throw "Every frontend origin must be HTTPS or a loopback development origin: $origin" }
  if ($uri.AbsolutePath -ne "/" -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) { throw "Frontend origins cannot contain paths, credentials, queries, or fragments: $origin" }
}
$defaults = @{ version = 1; token = ""; allowedOrigins = $allowedOrigins; printer = @{ transport = "windows"; name = ""; host = ""; port = 9100 }; scale = @{ executable = ""; args = @() }; customerDisplay = @{ executable = ""; args = @(); width = 20 }; pairing = $null; updateManifestUrl = "https://updates.kiranaos.in/hardware-bridge/stable.json" } | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $stage "bridge-defaults.json"), $defaults, [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath $node -Destination (Join-Path $stage "runtime\node.exe")
Copy-Item -LiteralPath (Join-Path $bridgeRoot "src") -Destination (Join-Path $stage "app\src") -Recurse
Copy-Item -LiteralPath (Join-Path $bridgeRoot "scripts") -Destination (Join-Path $stage "app\scripts") -Recurse
Copy-Item -LiteralPath (Join-Path $bridgeRoot "package.json") -Destination (Join-Path $stage "app\package.json")

$winsw = Join-Path $stage "KiranaOSHardwareBridge.exe"
Invoke-WebRequest -Uri $winswUrl -OutFile $winsw
$actualWinswSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $winsw).Hash
if (-not [String]::Equals($actualWinswSha256, $winswSha256, [StringComparison]::OrdinalIgnoreCase)) {
  Remove-Item -LiteralPath $winsw -Force
  throw "WinSW v2.12.0 SHA-256 verification failed."
}
& $dotnet publish (Join-Path $PSScriptRoot "setup-app\KiranaOS.HardwareBridge.Setup.csproj") -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -p:Version=$Version -o (Join-Path $stage "setup")
if ($LASTEXITCODE -ne 0) { throw "Setup application build failed" }

$signArguments = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", "http://timestamp.digicert.com", "/f", $env:KIRANA_CODE_SIGN_PFX, "/p", $env:KIRANA_CODE_SIGN_PASSWORD)
& $signtool @signArguments $winsw
if ($LASTEXITCODE -ne 0) { throw "Service wrapper signing failed" }

$signCommand = '"' + $signtool + '" sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /f "' + $env:KIRANA_CODE_SIGN_PFX + '" /p "' + $env:KIRANA_CODE_SIGN_PASSWORD + '" $f'
$policyOrigins = ($allowedOrigins -join ",")
if ($policyOrigins.Contains('"')) { throw "Frontend origins cannot contain quotes." }
& $iscc "/DStageDir=$stage" "/DAppVersion=$Version" "/DFrontendOrigins=$policyOrigins" "/Srelease-sign=$signCommand" (Join-Path $PSScriptRoot "installer.iss")
if ($LASTEXITCODE -ne 0) { throw "Installer build failed" }

$installer = Get-ChildItem -LiteralPath $dist -Filter "KiranaOS-Hardware-Bridge-$Version-x64.exe" | Select-Object -First 1
if (-not $installer) { throw "Installer output was not created" }
& $signtool verify /pa /all $installer.FullName
if ($LASTEXITCODE -ne 0) { throw "Installer signature verification failed" }
Write-Host "Signed installer: $($installer.FullName)"

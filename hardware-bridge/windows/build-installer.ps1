param(
  [string]$Configuration = "Release",
  [string]$Version = "1.1.0"
)

$ErrorActionPreference = "Stop"
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $PSScriptRoot "stage"
$dist = Join-Path $bridgeRoot "dist"
$winswUrl = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"

if (-not $env:KIRANA_CODE_SIGN_PFX -or -not $env:KIRANA_CODE_SIGN_PASSWORD) {
  throw "Release signing requires KIRANA_CODE_SIGN_PFX and KIRANA_CODE_SIGN_PASSWORD. Unsigned retail installers are intentionally not produced."
}
$iscc = (Get-Command ISCC.exe -ErrorAction Stop).Source
$signtool = (Get-Command signtool.exe -ErrorAction Stop).Source
$dotnet = (Get-Command dotnet.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source

if (Test-Path -LiteralPath $stage) {
  $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
  $resolvedWindows = (Resolve-Path -LiteralPath $PSScriptRoot).Path
  if (-not $resolvedStage.StartsWith($resolvedWindows, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe stage path" }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $stage "runtime"), (Join-Path $stage "app"), (Join-Path $stage "setup"), $dist | Out-Null
Copy-Item -LiteralPath $node -Destination (Join-Path $stage "runtime\node.exe")
Copy-Item -LiteralPath (Join-Path $bridgeRoot "src") -Destination (Join-Path $stage "app\src") -Recurse
Copy-Item -LiteralPath (Join-Path $bridgeRoot "scripts") -Destination (Join-Path $stage "app\scripts") -Recurse
Copy-Item -LiteralPath (Join-Path $bridgeRoot "package.json") -Destination (Join-Path $stage "app\package.json")

$winsw = Join-Path $stage "KiranaOSHardwareBridge.exe"
Invoke-WebRequest -Uri $winswUrl -OutFile $winsw
& $dotnet publish (Join-Path $PSScriptRoot "setup-app\KiranaOS.HardwareBridge.Setup.csproj") -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -p:Version=$Version -o (Join-Path $stage "setup")
if ($LASTEXITCODE -ne 0) { throw "Setup application build failed" }

$signArguments = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", "http://timestamp.digicert.com", "/f", $env:KIRANA_CODE_SIGN_PFX, "/p", $env:KIRANA_CODE_SIGN_PASSWORD)
& $signtool @signArguments $winsw
if ($LASTEXITCODE -ne 0) { throw "Service wrapper signing failed" }

$signCommand = '"' + $signtool + '" sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /f "' + $env:KIRANA_CODE_SIGN_PFX + '" /p "' + $env:KIRANA_CODE_SIGN_PASSWORD + '" $f'
& $iscc "/DStageDir=$stage" "/DAppVersion=$Version" "/Srelease-sign=$signCommand" (Join-Path $PSScriptRoot "installer.iss")
if ($LASTEXITCODE -ne 0) { throw "Installer build failed" }

$installer = Get-ChildItem -LiteralPath $dist -Filter "KiranaOS-Hardware-Bridge-$Version-x64.exe" | Select-Object -First 1
if (-not $installer) { throw "Installer output was not created" }
& $signtool verify /pa /all $installer.FullName
if ($LASTEXITCODE -ne 0) { throw "Installer signature verification failed" }
Write-Host "Signed installer: $($installer.FullName)"

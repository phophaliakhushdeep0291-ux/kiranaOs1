#ifndef StageDir
  #define StageDir "stage"
#endif
#ifndef AppVersion
  #define AppVersion "1.3.0"
#endif
; Comma-separated HTTPS frontend origins, supplied by build-installer.ps1. The
; same list that becomes the bridge's origin allowlist also becomes the browser
; policy allowlist, so the two can never drift apart.
#ifndef FrontendOrigins
  #define FrontendOrigins ""
#endif

[Setup]
AppId={{4FD9641F-A12C-4C62-B5E8-F3AC9780CB34}
AppName=KiranaOS Hardware Bridge
AppVersion={#AppVersion}
AppPublisher=KiranaOS
DefaultDirName={autopf}\KiranaOS Hardware Bridge
DefaultGroupName=KiranaOS
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
OutputDir=..\dist
OutputBaseFilename=KiranaOS-Hardware-Bridge-{#AppVersion}-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=KiranaOS Hardware Bridge
VersionInfoVersion={#AppVersion}
SignedUninstaller=yes
SignTool=release-sign

[Dirs]
Name: "{commonappdata}\KiranaOS\HardwareBridge"; Permissions: admins-full system-full
Name: "{commonappdata}\KiranaOS\HardwareBridge\logs"; Permissions: admins-full system-full

[Files]
Source: "{#StageDir}\KiranaOSHardwareBridge.exe"; DestDir: "{app}"; Flags: ignoreversion signonce
Source: "KiranaOSHardwareBridge.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\runtime\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "{#StageDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\setup\KiranaOS.HardwareBridge.Setup.exe"; DestDir: "{app}"; Flags: ignoreversion signonce
Source: "{#StageDir}\setup\*"; DestDir: "{app}"; Excludes: "KiranaOS.HardwareBridge.Setup.exe"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\bridge-defaults.json"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Hardware Bridge Setup"; Filename: "{app}\KiranaOS.HardwareBridge.Setup.exe"
Name: "{commondesktop}\Hardware Bridge Setup"; Filename: "{app}\KiranaOS.HardwareBridge.Setup.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a Hardware Bridge Setup shortcut"; Flags: checkedonce
Name: "browserpolicy"; Description: "Allow KiranaOS in the browser to reach this counter's printer (required by recent Chrome and Edge)"

[Run]
Filename: "{sys}\icacls.exe"; Parameters: """{commonappdata}\KiranaOS\HardwareBridge"" /inheritance:r /grant:r ""*S-1-5-18:(OI)(CI)F"" ""*S-1-5-32-544:(OI)(CI)F"""; Flags: runhidden waituntilterminated
Filename: "{app}\KiranaOSHardwareBridge.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; Check: ShouldInstallService
Filename: "{app}\KiranaOSHardwareBridge.exe"; Parameters: "refresh"; Flags: runhidden waituntilterminated; Check: ShouldRefreshService
Filename: "{app}\KiranaOSHardwareBridge.exe"; Parameters: "start"; Flags: runhidden waituntilterminated; Check: ShouldRefreshService
Filename: "{app}\KiranaOS.HardwareBridge.Setup.exe"; Description: "Choose printer and pair KiranaOS"; Flags: postinstall waituntilterminated skipifsilent

[UninstallRun]
Filename: "{app}\KiranaOSHardwareBridge.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated skipifdoesntexist
Filename: "{app}\KiranaOSHardwareBridge.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated skipifdoesntexist

[Code]
const
  { Loopback, not "local network": Chrome governs 127.0.0.1 with the
    loopback_network content setting, and granting local_network alone leaves the
    request hanging while navigator.permissions still reports "granted"
    (measured on 151.0.7922.77). The bridge is loopback-only by design, so this
    also grants strictly less than the local-network policy would. The Edge key
    mirrors Chrome's but has not been verified against Edge itself. }
  ChromePolicyKey = 'SOFTWARE\Policies\Google\Chrome\LoopbackNetworkAllowedForUrls';
  EdgePolicyKey = 'SOFTWARE\Policies\Microsoft\Edge\LoopbackNetworkAllowedForUrls';

var
  ServiceExistedBeforeInstall: Boolean;
  PolicySkipped: Boolean;

function ShouldInstallService: Boolean;
begin
  Result := not ServiceExistedBeforeInstall;
end;

{ Splits the compile-time origin list. Inno has no list type, so the caller
  passes an index and gets one origin back; '' means the list is exhausted. }
function OriginAt(Index: Integer): String;
var
  Remaining: String;
  Separator: Integer;
  Current: Integer;
begin
  Remaining := '{#FrontendOrigins}';
  Current := 0;
  Result := '';
  while Length(Remaining) > 0 do
  begin
    Separator := Pos(',', Remaining);
    if Separator > 0 then
    begin
      Result := Trim(Copy(Remaining, 1, Separator - 1));
      Remaining := Copy(Remaining, Separator + 1, Length(Remaining));
    end
    else
    begin
      Result := Trim(Remaining);
      Remaining := '';
    end;
    if Result <> '' then
    begin
      if Current = Index then Exit;
      Current := Current + 1;
    end;
  end;
  Result := '';
end;

{ True when the key holds entries this installer did not write. A shop under
  MDM or group policy may already be managed, and silently overwriting a
  centrally-set allowlist would be a worse failure than not printing. }
function PolicyKeyHasForeignValues(const SubKey: String): Boolean;
var
  Names: TArrayOfString;
  Existing: String;
  Index: Integer;
  Position: Integer;
  Matched: Boolean;
begin
  Result := False;
  if not RegGetValueNames(HKEY_LOCAL_MACHINE, SubKey, Names) then Exit;
  for Index := 0 to GetArrayLength(Names) - 1 do
  begin
    if not RegQueryStringValue(HKEY_LOCAL_MACHINE, SubKey, Names[Index], Existing) then Continue;
    Matched := False;
    Position := 0;
    while OriginAt(Position) <> '' do
    begin
      if CompareText(OriginAt(Position), Existing) = 0 then
      begin
        Matched := True;
        Break;
      end;
      Position := Position + 1;
    end;
    if not Matched then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

procedure ApplyLocalNetworkAccessPolicy(const SubKey: String);
var
  Index: Integer;
  Origin: String;
begin
  if PolicyKeyHasForeignValues(SubKey) then
  begin
    PolicySkipped := True;
    Exit;
  end;
  { Chrome stores list policies as numbered string values under the policy key. }
  RegDeleteKeyIncludingSubkeys(HKEY_LOCAL_MACHINE, SubKey);
  Index := 0;
  Origin := OriginAt(Index);
  while Origin <> '' do
  begin
    RegWriteStringValue(HKEY_LOCAL_MACHINE, SubKey, IntToStr(Index + 1), Origin);
    Index := Index + 1;
    Origin := OriginAt(Index);
  end;
end;

procedure RemoveLocalNetworkAccessPolicy(const SubKey: String);
begin
  { Only withdraw an allowlist that matches ours, so an uninstall never strips
    a policy the shop's administrator set. }
  if not PolicyKeyHasForeignValues(SubKey) then
    RegDeleteKeyIncludingSubkeys(HKEY_LOCAL_MACHINE, SubKey);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep <> ssPostInstall then Exit;
  if not WizardIsTaskSelected('browserpolicy') then Exit;
  if OriginAt(0) = '' then Exit;
  PolicySkipped := False;
  ApplyLocalNetworkAccessPolicy(ChromePolicyKey);
  ApplyLocalNetworkAccessPolicy(EdgePolicyKey);
  if PolicySkipped then
    MsgBox('This computer already has a managed browser policy for local network access, so Setup left it untouched.'#13#10#13#10
      + 'Ask whoever manages these computers to add the KiranaOS address to LoopbackNetworkAllowedForUrls, or printing from the browser will not reach this counter.',
      mbInformation, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep <> usUninstall then Exit;
  RemoveLocalNetworkAccessPolicy(ChromePolicyKey);
  RemoveLocalNetworkAccessPolicy(EdgePolicyKey);
end;

function ShouldRefreshService: Boolean;
begin
  Result := ServiceExistedBeforeInstall;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  WrapperPath: String;
begin
  Result := '';
  ServiceExistedBeforeInstall := RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\KiranaOSHardwareBridge');
  WrapperPath := ExpandConstant('{app}\KiranaOSHardwareBridge.exe');
  if ServiceExistedBeforeInstall and FileExists(WrapperPath) then
  begin
    if (not Exec(WrapperPath, 'stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
      Result := 'The existing KiranaOS Hardware Bridge service could not be stopped. Close Setup and try again.';
  end;
end;

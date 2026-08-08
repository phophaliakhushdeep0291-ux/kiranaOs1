#ifndef StageDir
  #define StageDir "stage"
#endif
#ifndef AppVersion
  #define AppVersion "1.1.0"
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

[Icons]
Name: "{group}\Hardware Bridge Setup"; Filename: "{app}\KiranaOS.HardwareBridge.Setup.exe"
Name: "{commondesktop}\Hardware Bridge Setup"; Filename: "{app}\KiranaOS.HardwareBridge.Setup.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a Hardware Bridge Setup shortcut"; Flags: checkedonce

[Run]
Filename: "{app}\KiranaOSHardwareBridge.exe"; Parameters: "install"; Flags: runhidden waituntilterminated
Filename: "{app}\KiranaOS.HardwareBridge.Setup.exe"; Description: "Choose printer and pair KiranaOS"; Flags: postinstall waituntilterminated skipifsilent

[UninstallRun]
Filename: "{app}\KiranaOSHardwareBridge.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated skipifdoesntexist
Filename: "{app}\KiranaOSHardwareBridge.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated skipifdoesntexist

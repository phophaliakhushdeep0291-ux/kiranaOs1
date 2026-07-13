param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$PayloadPath
)

$source = @"
using System;
using System.Runtime.InteropServices;
public static class KiranaRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool StartDocPrinter(IntPtr handle, int level, DOCINFO info);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      var info = new DOCINFO { pDocName="KiranaOS Receipt", pDataType="RAW" };
      if (!StartDocPrinter(handle, 1, info)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      try { StartPagePrinter(handle); int written; if (!WritePrinter(handle, data, data.Length, out written) || written != data.Length) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); EndPagePrinter(handle); }
      finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}
"@

Add-Type -TypeDefinition $source -Language CSharp
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $PayloadPath))
[KiranaRawPrinter]::Send($PrinterName, $bytes)

# CDPlayer's audio-CD reader for Windows (see src/main/win-cd.js). Windows only offers an audio CD as .cda shortcuts,
# so this reads the drive itself through Windows' CD calls: the table of contents, raw audio sectors, and eject.
# Requests are JSON lines on stdin; each answer is a JSON header line on stdout followed by exactly "bytes" bytes.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.IO; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class CdIo {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sa, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DeviceIoControl(SafeFileHandle h, uint code, byte[] inBuf, int inLen, byte[] outBuf, int outLen, out int returned, IntPtr overlapped);
  const int SECTOR = 2352, CHUNK = 20;
  static SafeFileHandle Open(string drive) {
    var h = CreateFile(@"\\.\" + drive, 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h.IsInvalid) throw new IOException("open " + drive + ": error " + Marshal.GetLastWin32Error());
    return h;
  }
  public static byte[] Toc(string drive) {
    using (var h = Open(drive)) {
      var o = new byte[804]; int r;
      if (!DeviceIoControl(h, 0x24000, null, 0, o, o.Length, out r, IntPtr.Zero)) throw new IOException("toc: error " + Marshal.GetLastWin32Error());
      return o;
    }
  }
  static bool RawRead(SafeFileHandle h, long lba, int count, byte[] into, int at) {
    var info = new byte[16];
    BitConverter.GetBytes(lba * 2048).CopyTo(info, 0);
    BitConverter.GetBytes(count).CopyTo(info, 8);
    BitConverter.GetBytes(2).CopyTo(info, 12); // CDDA
    var o = new byte[count * SECTOR]; int r;
    if (!DeviceIoControl(h, 0x2403E, info, 16, o, o.Length, out r, IntPtr.Zero) || r < o.Length) return false;
    Buffer.BlockCopy(o, 0, into, at, o.Length);
    return true;
  }
  // A chunk that won't read is read a sector at a time, each tried twice; a sector that still won't is silence.
  public static byte[] Read(string drive, long lba, int count) {
    var all = new byte[count * SECTOR];
    using (var h = Open(drive)) {
      for (int done = 0; done < count; done += CHUNK) {
        int n = Math.Min(CHUNK, count - done);
        if (RawRead(h, lba + done, n, all, done * SECTOR)) continue;
        for (int s = 0; s < n; s++)
          if (!RawRead(h, lba + done + s, 1, all, (done + s) * SECTOR)) RawRead(h, lba + done + s, 1, all, (done + s) * SECTOR);
      }
    }
    return all;
  }
  public static void Eject(string drive) {
    using (var h = Open(drive)) {
      int r;
      if (!DeviceIoControl(h, 0x2D4808, null, 0, null, 0, out r, IntPtr.Zero)) throw new IOException("eject: error " + Marshal.GetLastWin32Error());
    }
  }
}
'@

$out = [Console]::OpenStandardOutput()
function Send($header, [byte[]]$payload) {
  if ($null -eq $payload) { $payload = [byte[]]::new(0) }
  $header.bytes = $payload.Length
  $line = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $header -Compress -Depth 3) + "`n")
  $out.Write($line, 0, $line.Length)
  if ($payload.Length) { $out.Write($payload, 0, $payload.Length) }
  $out.Flush()
}
# CD drives with a disc whose table of contents reads (an empty drive answers error 21 and is left out), one per
# line of output — collected with @() by the caller, so the list stays flat.
function Get-Drives {
  foreach ($d in [IO.DriveInfo]::GetDrives()) {
    if ($d.DriveType -ne 'CDRom') { continue }
    $name = $d.Name.TrimEnd('\')
    try { [void][CdIo]::Toc($name); $name } catch { }
  }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  $req = $null
  try {
    $req = ConvertFrom-Json $line
    switch ($req.op) {
      'drives' { Send ([ordered]@{ id = $req.id; ok = $true; drives = @(Get-Drives) }) $null }
      'toc' { Send ([ordered]@{ id = $req.id; ok = $true }) ([CdIo]::Toc($req.drive)) }
      'read' { Send ([ordered]@{ id = $req.id; ok = $true }) ([CdIo]::Read($req.drive, [long]$req.lba, [int]$req.count)) }
      'eject' { [CdIo]::Eject($req.drive); Send ([ordered]@{ id = $req.id; ok = $true }) $null }
      default { Send ([ordered]@{ id = $req.id; ok = $false; error = 'unknown op' }) $null }
    }
  } catch {
    Send ([ordered]@{ id = $(if ($req) { $req.id } else { 0 }); ok = $false; error = "$($_.Exception.Message)" }) $null
  }
}

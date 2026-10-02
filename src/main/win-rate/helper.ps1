# CDPlayer's output-rate helper for Windows (see src/main/output-rate.js). Windows plays everything at an output's
# "default format" (Sound settings → the device → Advanced); this lists the outputs with their rates and changes that
# format's sample rate — through IPolicyConfig, the interface the Sound control panel itself uses. No admin rights.
#   helper.ps1 list                    → [{ name, id, rate, rates, enumerator, isDefault }]
#   helper.ps1 set <id|default> <hz>   → { rate }
param([string]$Command, [string]$Id, [int]$Rate)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public int pid; public PropertyKey(string g, int p) { fmtid = new Guid(g); pid = p; } }
[StructLayout(LayoutKind.Explicit)] public struct PropVariant {
  [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointer; [FieldOffset(8)] public uint blobSize; [FieldOffset(16)] public IntPtr blobData;
}
[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { void GetCount(out int c); void GetAt(int i, out PropertyKey k); [PreserveSig] int GetValue(ref PropertyKey k, out PropVariant v); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  void OpenPropertyStore(int access, out IPropertyStore store);
  void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection { void GetCount(out int c); void Item(int i, out IMMDevice d); }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  void EnumAudioEndpoints(int flow, int state, out IMMDeviceCollection c);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
  void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice d);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient {
  [PreserveSig] int Initialize(); [PreserveSig] int GetBufferSize(); [PreserveSig] int GetStreamLatency(); [PreserveSig] int GetCurrentPadding();
  [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
}
[ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int useDefault, out IntPtr format);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
}
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class PolicyConfigClient {}

public static class RateIo {
  static readonly int[] Rates = { 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 };
  static PropertyKey FriendlyName = new PropertyKey("a45c254e-df1c-4efd-8020-67d146a850e0", 14);
  static PropertyKey EnumeratorName = new PropertyKey("a45c254e-df1c-4efd-8020-67d146a850e0", 24);
  static PropertyKey DeviceFormat = new PropertyKey("f19f064d-082c-4e27-bc73-6882a1bb8e4c", 0);

  static IMMDeviceEnumerator Enumerator() { return (IMMDeviceEnumerator)new MMDeviceEnumerator(); }
  static string Text(IPropertyStore s, PropertyKey k) { PropVariant v; return s.GetValue(ref k, out v) == 0 && v.vt == 31 ? Marshal.PtrToStringUni(v.pointer) : ""; }
  // The device format: a WAVEFORMATEX(TENSIBLE), as bytes. Rate at offset 4, bytes a second at 8, block align at 12.
  static byte[] Format(IPropertyStore s) {
    PropertyKey k = DeviceFormat; PropVariant v;
    if (s.GetValue(ref k, out v) != 0 || v.vt != 65 || v.blobSize < 18) return null;
    var b = new byte[v.blobSize]; Marshal.Copy(v.blobData, b, 0, b.Length); return b;
  }
  static byte[] WithRate(byte[] f, int rate) {
    var b = (byte[])f.Clone(); int align = BitConverter.ToUInt16(b, 12);
    BitConverter.GetBytes(rate).CopyTo(b, 4); BitConverter.GetBytes(rate * align).CopyTo(b, 8); return b;
  }
  static IntPtr Alloc(byte[] b) { var p = Marshal.AllocCoTaskMem(b.Length); Marshal.Copy(b, 0, p, b.Length); return p; }
  static byte[] Read(IntPtr p) { int size = 18 + BitConverter.ToUInt16(Bytes(p, 18), 16); var b = Bytes(p, size); return b; }
  static byte[] Bytes(IntPtr p, int n) { var b = new byte[n]; Marshal.Copy(p, b, 0, n); return b; }

  static List<int> Supported(IMMDevice d, byte[] f) {
    var list = new List<int>();
    Guid iid = typeof(IAudioClient).GUID; object o;
    if (f == null || d.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return list;
    var client = (IAudioClient)o;
    foreach (int r in Rates) {
      IntPtr p = Alloc(WithRate(f, r)), closest;
      try { if (client.IsFormatSupported(1, p, out closest) == 0) list.Add(r); } finally { Marshal.FreeCoTaskMem(p); }
    }
    return list;
  }

  public static List<Dictionary<string, object>> List() {
    var e = Enumerator(); IMMDeviceCollection c; IMMDevice def; string defId = "";
    if (e.GetDefaultAudioEndpoint(0, 1, out def) == 0) def.GetId(out defId);
    e.EnumAudioEndpoints(0, 1, out c); int n; c.GetCount(out n);
    var outList = new List<Dictionary<string, object>>();
    for (int i = 0; i < n; i++) {
      IMMDevice d; c.Item(i, out d); string id; d.GetId(out id); IPropertyStore s; d.OpenPropertyStore(0, out s);
      var f = Format(s);
      outList.Add(new Dictionary<string, object> {
        { "name", Text(s, FriendlyName) }, { "id", id }, { "rate", f == null ? 0 : BitConverter.ToInt32(f, 4) },
        { "rates", Supported(d, f).ToArray() }, { "enumerator", Text(s, EnumeratorName) }, { "isDefault", id == defId },
      });
    }
    return outList;
  }

  public static int Set(string id, int rate) {
    var e = Enumerator(); IMMDevice d;
    if (id == "default") { if (e.GetDefaultAudioEndpoint(0, 1, out d) != 0) throw new Exception("no default output"); d.GetId(out id); } else e.GetDevice(id, out d);
    IPropertyStore s; d.OpenPropertyStore(0, out s);
    var f = Format(s); if (f == null) throw new Exception("no device format");
    var policy = (IPolicyConfig)new PolicyConfigClient();
    IntPtr mixPtr; byte[] mix = policy.GetMixFormat(id, out mixPtr) == 0 ? Read(mixPtr) : f;
    IntPtr pf = Alloc(WithRate(f, rate)), pm = Alloc(WithRate(mix, rate));
    try { int hr = policy.SetDeviceFormat(id, pf, pm); if (hr != 0) throw new Exception("SetDeviceFormat: 0x" + hr.ToString("X8")); }
    finally { Marshal.FreeCoTaskMem(pf); Marshal.FreeCoTaskMem(pm); }
    e.GetDevice(id, out d); d.OpenPropertyStore(0, out s); f = Format(s);
    return f == null ? 0 : BitConverter.ToInt32(f, 4);
  }
}
'@

switch ($Command) {
  'list' { ConvertTo-Json -Compress -Depth 4 -InputObject @([RateIo]::List()) }
  'set' { ConvertTo-Json -Compress -InputObject @{ rate = [RateIo]::Set($Id, $Rate) } }
  default { [Console]::Error.WriteLine('usage: helper.ps1 list | set <id|default> <hz>'); exit 1 }
}

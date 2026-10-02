// CDPlayer's output-rate helper for macOS (see src/main/output-rate.js).
//   mac-rate list                  → [{ name, uid, rate, rates, transport, isDefault }] for every output device
//   mac-rate set <uid|default> <hz> → { rate } once the device reports the new rate (2 s at most)
import CoreAudio
import Foundation

func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: 0) // the main element (kAudioObjectPropertyElementMain, which needs macOS 12 to name)
}

func array<T>(_ object: AudioObjectID, _ addr: AudioObjectPropertyAddress, _: T.Type) -> [T] {
  var a = addr
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(object, &a, 0, nil, &size) == noErr, size > 0 else { return [] }
  let count = Int(size) / MemoryLayout<T>.stride
  let buffer = UnsafeMutablePointer<T>.allocate(capacity: count)
  defer { buffer.deallocate() }
  guard AudioObjectGetPropertyData(object, &a, 0, nil, &size, buffer) == noErr else { return [] }
  return Array(UnsafeBufferPointer(start: buffer, count: count))
}

func value<T>(_ object: AudioObjectID, _ addr: AudioObjectPropertyAddress, _ initial: T) -> T? {
  var a = addr
  var v = initial
  var size = UInt32(MemoryLayout<T>.size)
  return AudioObjectGetPropertyData(object, &a, 0, nil, &size, &v) == noErr ? v : nil
}

func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
  var a = address(selector)
  var v: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(object, &a, 0, nil, &size, &v) == noErr, let s = v else { return nil }
  return s.takeRetainedValue() as String
}

func fourCC(_ code: UInt32) -> String {
  let bytes = [24, 16, 8, 0].map { UInt8((code >> UInt32($0)) & 0xFF) }
  return String(bytes: bytes, encoding: .ascii) ?? ""
}

let system = AudioObjectID(kAudioObjectSystemObject)
let standardRates: [Double] = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000]

func outputs() -> [AudioObjectID] {
  array(system, address(kAudioHardwarePropertyDevices), AudioObjectID.self).filter {
    !array($0, address(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput), AudioStreamID.self).isEmpty
  }
}

func rate(_ device: AudioObjectID) -> Double { value(device, address(kAudioDevicePropertyNominalSampleRate), Float64(0)) ?? 0 }

func rates(_ device: AudioObjectID) -> [Double] {
  var found = Set<Double>()
  for r in array(device, address(kAudioDevicePropertyAvailableNominalSampleRates), AudioValueRange.self) {
    if r.mMinimum == r.mMaximum { found.insert(r.mMinimum) }
    else { for s in standardRates where s >= r.mMinimum && s <= r.mMaximum { found.insert(s) } }
  }
  return found.sorted()
}

func defaultOutput() -> AudioObjectID { value(system, address(kAudioHardwarePropertyDefaultOutputDevice), AudioObjectID(0)) ?? 0 }

func printJSON(_ object: Any) {
  let data = try! JSONSerialization.data(withJSONObject: object, options: [])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "list":
  let def = defaultOutput()
  printJSON(outputs().map { d -> [String: Any] in
    [
      "name": string(d, kAudioObjectPropertyName) ?? "",
      "uid": string(d, kAudioDevicePropertyDeviceUID) ?? "",
      "rate": rate(d),
      "rates": rates(d),
      "transport": fourCC(value(d, address(kAudioDevicePropertyTransportType), UInt32(0)) ?? 0),
      "isDefault": d == def,
    ]
  })
case "set":
  guard args.count == 4, let hz = Double(args[3]) else { fail("usage: mac-rate set <uid|default> <hz>") }
  let device = args[2] == "default" ? defaultOutput() : (outputs().first { string($0, kAudioDevicePropertyDeviceUID) == args[2] } ?? 0)
  if device == 0 { fail("no such device") }
  var a = address(kAudioDevicePropertyNominalSampleRate)
  var r = Float64(hz)
  let status = AudioObjectSetPropertyData(device, &a, 0, nil, UInt32(MemoryLayout<Float64>.size), &r)
  if status != noErr { fail("set: \(status)") }
  let deadline = Date().addingTimeInterval(2)
  while rate(device) != hz && Date() < deadline { usleep(50_000) }
  printJSON(["rate": rate(device)])
default:
  fail("usage: mac-rate list | mac-rate set <uid|default> <hz>")
}

'use strict';
/**
 * Settings → QUALITY's other half: the output device's sample rate, switched to the song's on macOS (mac-rate, a small
 * CoreAudio helper) and Windows (win-rate/helper.ps1, the device's default format) — so a 96 kHz song reaches the
 * headphones at 96 kHz instead of being resampled to whatever the system was set to. Before its first change to a
 * device, the rate it had is written to output-rate.json; restore() puts every one back (on quit, on switching to
 * HIGH, and at startup if CDPlayer didn't get to quit). Bluetooth outputs are never touched: their codec decides.
 */
const fs = require('fs');

const family = (r) => (r % 11025 === 0 ? 44100 : 48000);

/** The rate a device that plays `supported` should be set to for a song at `wanted`; null if nothing's known. */
function deviceRate(wanted, supported) {
  const rates = [...new Set(supported || [])].filter((r) => r > 0).sort((a, b) => a - b);
  if (!rates.length) return null;
  if (rates.includes(wanted)) return wanted;
  const multiple = rates.find((r) => r > wanted && r % wanted === 0);
  if (multiple) return multiple;
  const kin = rates.filter((r) => r < wanted && family(r) === family(wanted));
  if (kin.length) return kin[kin.length - 1];
  const above = rates.find((r) => r > wanted);
  if (above) return above;
  return rates[rates.length - 1];
}

const asList = (json) => (Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : []);
const rateList = (rates) => asList(rates).map(Number).filter((r) => r > 0);

/** mac-rate's `list`: [{ name, uid, rate, rates, transport, isDefault }] → devices. */
function parseMacList(json) {
  return asList(json).filter((d) => d && d.uid).map((d) => ({
    id: String(d.uid), name: String(d.name || ''), rate: Number(d.rate) || null, rates: rateList(d.rates),
    bluetooth: d.transport === 'blue' || d.transport === 'blea', isDefault: !!d.isDefault,
  }));
}
/** win-rate's `list`: [{ name, id, rate, rates, enumerator, isDefault }] (or one lone object) → devices. */
function parseWinList(json) {
  return asList(json).filter((d) => d && d.id).map((d) => ({
    id: String(d.id), name: String(d.name || ''), rate: Number(d.rate) || null, rates: rateList(d.rates),
    bluetooth: /^BTH/i.test(String(d.enumerator || '')), isDefault: !!d.isDefault,
  }));
}

/** The device Settings → OUTPUT means ({ id, label } from Chromium, or null for the default): found by its name. A chosen
 *  device that isn't found is null — the default isn't what the user hears then, so it must not be switched. */
function findDevice(devices, device) {
  if (!device || !device.label) return devices.find((d) => d.isDefault) || null;
  const label = device.label.replace(/^Default - /, '');
  const bare = label.replace(/\s*\([^)]*\)\s*$/, '');
  return devices.find((d) => d.name === label) || devices.find((d) => d.name === bare) || null;
}

const LIST_TTL = 10000; // a run of songs reuses one list: each helper call is a process (PowerShell on Windows)

function createOutputRate({ platform, run, file, log = (msg) => console.warn(msg), now = Date.now }) {
  const parse = platform === 'darwin' ? parseMacList : platform === 'win32' ? parseWinList : null;
  let warned = false, busy = Promise.resolve(), cache = null, closing = false, inflight = 0;
  const fail = (e) => { if (!warned) { warned = true; log(`output rate: ${e && e.message ? e.message : e}`); } return null; };
  const readOriginals = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
  const writeOriginals = (o) => { if (Object.keys(o).length) fs.writeFileSync(file, JSON.stringify(o)); else fs.rmSync(file, { force: true }); };
  const serial = (fn) => {
    inflight++;
    const job = busy.then(fn, fn).finally(() => { inflight--; });
    busy = job.catch(() => {});
    return job;
  };

  async function list() {
    if (!parse) return [];
    try {
      const devices = parse(await run(['list']));
      cache = { at: now(), devices };
      return devices;
    } catch (e) { cache = null; return fail(e); }
  }
  /** list(), or the last one when it's under 10 s old (set() keeps its rates up to date). */
  async function cachedList() {
    return cache && now() - cache.at < LIST_TTL ? cache.devices : list();
  }
  async function current(device) {
    const devices = await list();
    const d = devices && findDevice(devices, device);
    return d ? d.rate : null;
  }
  async function setNow(device, hz) {
    if (!parse || closing) return null;
    const devices = await cachedList();
    const d = devices && findDevice(devices, device);
    if (!d) return null;
    if (d.bluetooth) return { rate: d.rate, switched: false, bluetooth: true };
    const target = deviceRate(hz, d.rates.length ? d.rates : [d.rate]);
    if (!target) return null;
    if (target === d.rate) return { rate: target, switched: true, bluetooth: false };
    const originals = readOriginals();
    if (!(d.id in originals)) { originals[d.id] = d.rate; writeOriginals(originals); }
    try {
      const res = await run(['set', d.id, String(target)]);
      const rate = Number(res && res.rate) || null;
      if (rate) d.rate = rate; // the cached device now has the new rate: the next song needn't ask again
      else cache = null;
      return { rate: rate || d.rate, switched: rate === target, bluetooth: false };
    } catch (e) { cache = null; return fail(e); }
  }
  function set(device, hz) {
    return serial(() => setNow(device, hz));
  }
  /** `final` is the quit's restore: after it nothing switches the device again (a song ending in the still-alive window). */
  function restore({ final = false } = {}) {
    if (final) closing = true;
    return serial(restoreNow);
  }
  /** True when there's a rate to put back (or a switch in progress), so quit has something to wait for. */
  function pending() {
    return !!parse && (inflight > 0 || Object.keys(readOriginals()).length > 0);
  }
  async function restoreNow() {
    if (!parse) return;
    cache = null;
    const originals = readOriginals();
    if (!Object.keys(originals).length) return; // never switched: don't start the helper at all
    const devices = await list();
    if (!devices) return; // list failed, keep everything untouched
    for (const [id, rate] of Object.entries(originals)) {
      const device = devices.find((d) => d.id === id);
      if (!device) {
        // unplugged: forget it
        delete originals[id];
        continue;
      }
      try {
        await run(['set', id, String(rate)]);
        delete originals[id]; // success: forget it
      } catch (e) {
        fail(e); // failure: keep it in the file
      }
    }
    writeOriginals(originals);
    cache = null;
  }
  return { list, current, set, restore, pending };
}

module.exports = { createOutputRate, deviceRate, findDevice, parseMacList, parseWinList };

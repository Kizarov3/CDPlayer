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

/** The device Settings → OUTPUT means ({ id, label } from Chromium, or null): found by its name, else the default. */
function findDevice(devices, device) {
  const fallback = devices.find((d) => d.isDefault) || null;
  if (!device || !device.label) return fallback;
  const label = device.label.replace(/^Default - /, '');
  const bare = label.replace(/\s*\([^)]*\)\s*$/, '');
  return devices.find((d) => d.name === label) || devices.find((d) => d.name === bare) || fallback;
}

function createOutputRate({ platform, run, file, log = (msg) => console.warn(msg) }) {
  const parse = platform === 'darwin' ? parseMacList : platform === 'win32' ? parseWinList : null;
  let warned = false, busy = Promise.resolve();
  const fail = (e) => { if (!warned) { warned = true; log(`output rate: ${e && e.message ? e.message : e}`); } return null; };
  const readOriginals = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
  const writeOriginals = (o) => { if (Object.keys(o).length) fs.writeFileSync(file, JSON.stringify(o)); else fs.rmSync(file, { force: true }); };

  async function list() {
    if (!parse) return [];
    try { return parse(await run(['list'])); } catch (e) { return fail(e); }
  }
  async function current(device) {
    const devices = await list();
    const d = devices && findDevice(devices, device);
    return d ? d.rate : null;
  }
  async function set(device, hz) {
    if (!parse) return null;
    await busy; // a restore still running (the one at startup) mustn't undo this
    const devices = await list();
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
      return { rate: rate || d.rate, switched: rate === target, bluetooth: false };
    } catch (e) { return fail(e); }
  }
  function restore() {
    const job = busy.then(restoreNow);
    busy = job.catch(() => {});
    return job;
  }
  async function restoreNow() {
    if (!parse) return;
    const originals = readOriginals();
    for (const [id, rate] of Object.entries(originals)) {
      try { await run(['set', id, String(rate)]); } catch (e) { fail(e); } // unplugged: nothing to put back
      delete originals[id];
    }
    writeOriginals(originals);
  }
  return { list, current, set, restore };
}

module.exports = { createOutputRate, deviceRate, findDevice, parseMacList, parseWinList };

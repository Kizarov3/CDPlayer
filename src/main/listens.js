'use strict';
/**
 * Every play, with when: the log THE YEAR ON THE SHELF and ON THIS DAY are read from. plays.txt keeps only how many
 * times each song was played and its first and last play — not which days — so from 2.21 each play is written down
 * here as it happens. What came before is filled in as far as it's known: each song's first and last play (both real
 * plays, at their real times) when the log is begun, and the listens IMPORT PLAYS brings in, each at its time.
 * Kept in listens.txt: "since <ms>" (when the log was begun: before it, only what was filled in), then "ms<TAB>path"
 * per play, oldest first. The oldest go once there are more than LIMIT (years of listening).
 */
const LIMIT = 150000;
const DAY = 86400e3;

const empty = (since = null) => ({ since, list: [] });

/** listens.txt's text → { since (ms or null), list: [[at, path]] oldest first }. */
function parse(text) {
  const log = empty();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('since ')) { const s = Number(line.slice(6)); if (s > 0) log.since = s; continue; }
    const tab = line.indexOf('\t'), at = Number(line.slice(0, tab)), p = line.slice(tab + 1);
    if (tab > 0 && at > 0 && p) log.list.push([at, p]);
  }
  log.list.sort((a, b) => a[0] - b[0]);
  return log;
}
const lineOf = ([at, p]) => `${at}\t${p}\n`;
const format = (log) => `${log.since ? `since ${log.since}\n` : ''}${log.list.map(lineOf).join('')}`;
const safe = (p) => typeof p === 'string' && p && !/[\r\n]/.test(p);

/** The log begun now, from each song's first and last play (`first`, `last`: Maps path → ms). */
function seed(first, last, now = Date.now()) {
  const log = empty(now);
  return merge(log, [...first, ...last].map(([p, at]) => [at, p]));
}

/** Plays added where they belong in time — one already there (the same song at the same moment) is not added twice. */
function merge(log, entries) {
  const have = new Set(log.list.map(([at, p]) => `${at}\t${p}`));
  for (const [at, p] of entries) {
    const key = `${at}\t${p}`;
    if (!(at > 0) || !safe(p) || have.has(key)) continue;
    have.add(key); log.list.push([at, p]);
  }
  log.list.sort((a, b) => a[0] - b[0]);
  return trim(log);
}

/** One play, now (the newest: at the end). → whether the log has grown past its limit and wants writing anew. */
function add(log, at, p) {
  if (!safe(p)) return false;
  log.list.push([at, p]);
  return log.list.length > LIMIT * 1.05;
}
function trim(log, limit = LIMIT) {
  if (log.list.length > limit) log.list.splice(0, log.list.length - limit);
  return log;
}

/** Songs moved (relocate.js: Map old path → new), their plays with them. */
function move(log, moves) {
  log.list = log.list.map(([at, p]) => [at, moves.get(p) || p]);
  return log;
}

/**
 * The songs played on this day of the year in a year before: Map path → how many years ago (the most recent such
 * year). The day as it was where it was played (local time).
 */
function onThisDay(log, now = Date.now()) {
  const today = new Date(now), out = new Map();
  for (const [at, p] of log.list) {
    const d = new Date(at);
    if (d.getMonth() !== today.getMonth() || d.getDate() !== today.getDate()) continue;
    const years = today.getFullYear() - d.getFullYear();
    if (years >= 1 && (!out.has(p) || years < out.get(p))) out.set(p, years);
  }
  return out;
}

module.exports = { LIMIT, DAY, empty, parse, format, lineOf, seed, merge, add, trim, move, onThisDay };

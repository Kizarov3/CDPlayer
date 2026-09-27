# Karaoke Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Karaoke Mode lights each word exactly when it is sung (holding long notes, pausing in gaps, following what is heard), and looks like Apple Music's karaoke view.

**Architecture:** Unison's word-timed TTML becomes an *extended enhanced LRC* string (word ends, `v1:` singer prefixes, `[bg:` backing-vocal lines) so every existing consumer keeps working with one lyrics string. `lyrics.js` parses the extensions and computes word progress from real begin/end times (or a syllable-weighted estimate for line-only lyrics). The renderer follows a *heard* position (playback position minus output latency, plus a user offset). `karaoke.js` + CSS render the Apple look.

**Tech Stack:** Electron 44, plain ES modules in the renderer, CommonJS in main, `node --test` (`npm test`).

**Spec:** `docs/superpowers/specs/2026-09-27-karaoke-accuracy-design.md`

## Global Constraints

- No new dependencies; nothing to install.
- Plain LRC and enhanced LRC *without* the new additions parse exactly as today: `parseLrc` adds `end`, `agent`, `bg` keys (and a word's `end`) **only when the lyrics carry them** (existing tests use `deepStrictEqual`).
- Lyrics inside a file always win over online lyrics (unchanged `app.js` behaviour).
- Tests never touch a real `~/.cdplayer` (`CDPLAYER_HOME` temp dir, as in every existing test file).
- Commit messages: plain sentences in the repo's style; **no AI attribution / Co-Authored-By lines** (user rule).
- The Animations setting off (`anim.enabled === false`): karaoke shows the fill only — no lift, glow, blur, overshoot, breathing dots.
- Settings line order is fixed; Lyrics Offset is the **14th** line of `settings.txt`, in milliseconds, −500…+500, step 50, default 0.

## Review Focus

1. A song whose lyrics come back from lrclib only (line timing) must still fill smoothly word by word — never freeze on a line or jump. (Task 3 test: syllable-weighted spread; Task 6 manual check.)
2. A repeated chorus (one LRC line with several `[mm:ss]` stamps) with word ends and a `[bg:` line: every repeat gets its own shifted word ends and backing vocals. (Task 2 test.)
3. Lyrics saved into a file by "Save found art & lyrics" earlier (plain enhanced LRC, no ends) keep working exactly as before. (Task 2 regression tests: the existing tests stay green untouched.)
4. The lyrics panel and plain-text display must not show `v1:` prefixes or raw `[bg: <00:…>` markup. (Task 2 test on `formatLyricsForDisplay`; Task 2 test that `text` has no prefix.)
5. Pausing/seeking back while in karaoke: words already filled must un-fill correctly (progress is a pure function of position — Task 3 test with a position before a word's start).

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `src/main/ttml.js` | TTML → extended enhanced LRC (word begin/end, line end, singers, backing vocals) | 1 |
| `src/renderer/js/lyrics.js` | Parse extended LRC; `lineState`; `lineWords` (timed or estimated); `wordProgress`; `heardPosition` | 2, 3, 5 |
| `src/main/online.js` | `findLyrics`: Unison word-timed first | 4 |
| `src/renderer/js/audio.js` | `engine.outputLatency` | 5 |
| `src/main/store.js` | settings line 14 `lyricsOffset` | 5 |
| `src/renderer/js/app.js`, `panels.js`, `booklet.js`, `karaoke.js` | follow `app.lyricsPosition()`; Settings row | 5 |
| `src/renderer/js/karaoke.js`, `src/renderer/styles.css` | Apple-style rendering | 6 |
| `test/metadata-sources.test.js`, `test/lyrics.test.mjs`, `test/state.test.js` | tests | 1–5 |

---

### Task 1: TTML keeps word ends, line ends, singers and backing vocals

**Files:**
- Modify: `src/main/ttml.js` (replace `ttmlLines` and `ttmlToLrc`; keep `parseTime`, `decodeEntities`, `attr`, `stamp`, `ttmlDuration`)
- Test: `test/metadata-sources.test.js`

**Interfaces:**
- Produces: `ttmlToLrc(xml, { words = true } = {}) → string` in extended enhanced LRC:
  - line: `[mm:ss.xx]` + (`vN:` when the document has more than one distinct `ttm:agent`) + words
  - word: `<begin>text` ; after a word whose `end` is known, `<end>` is written **only** when the next word starts more than 0.02 s later, or it is the last word (then it is the line end: `p end` if present, else the last word's end)
  - backing vocals (`ttm:role="x-bg"`): a following line `[bg: <begin>text <begin>text<end>]`
  - `words: false`: `[mm:ss.xx]text` only, as today.

- [ ] **Step 1: Write the failing tests** — in `test/metadata-sources.test.js`, replace the test `'TTML becomes enhanced LRC: …'` with:

```js
test('TTML becomes enhanced LRC: a stamp per word, syllables joined, the line end kept, the head left out', () => {
  assert.strictEqual(ttmlToLrc(TTML),
    "[00:08.84]<00:08.84>Now <00:09.15>he's <00:10.00>es<00:10.20>press<00:10.40>o<00:12.34>\n" +
    '[01:02.50]<01:02.50>Rock <01:03.00>& roll<01:05.00>\n[bg: <01:04.00>(ooh)]');
  assert.strictEqual(ttmlToLrc(TTML, { words: false }), "[00:08.84]Now he's espresso\n[01:02.50]Rock & roll");
  assert.strictEqual(ttmlDuration(TTML), 185.5);
});

// Unison's real shape (Espresso, In the End): every word and line has an end; singers v1/v2; backing vocals.
const TIMED = `<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body dur="3:00"><div>
<p begin="8.835" end="12.339" ttm:agent="v1"><span begin="8.835" end="9.155">Now</span> <span begin="9.155" end="9.587">he's</span> <span begin="10.056" end="10.328">thinkin'</span></p>
<p begin="16.712" end="19.112" ttm:agent="v2"><span begin="16.712" end="17.016">It</span> <span begin="17.016" end="17.600">starts</span><span ttm:role="x-bg"><span begin="18.0" end="18.3">(oh</span> <span begin="18.3" end="18.9">no)</span></span></p>
</div></body></tt>`;

test('TTML with word ends: gaps between words and the line end are stamped, singers prefixed, backing vocals on a [bg: line', () => {
  assert.strictEqual(ttmlToLrc(TIMED),
    "[00:08.84]v1:<00:08.84>Now <00:09.15>he's <00:09.59> <00:10.06>thinkin'<00:12.34>\n" + // 9.155 rounds down in floating point, as in the test above
    '[00:16.71]v2:<00:16.71>It <00:17.02>starts<00:19.11>\n[bg: <00:18.00>(oh <00:18.30>no)<00:18.90>]');
});

test('one singer: no singer prefixes', () => {
  const solo = TIMED.replace(/ttm:agent="v2"/, 'ttm:agent="v1"');
  assert.ok(!/v1:|v2:/.test(ttmlToLrc(solo)));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/metadata-sources.test.js`
Expected: the three tests above FAIL (no line-end stamps, no prefixes, no `[bg:` line).

- [ ] **Step 3: Implement** — replace `ttmlLines` and `ttmlToLrc` in `src/main/ttml.js` with:

```js
/**
 * The lines of a TTML document: [{ time, end, agent, text, words: [{ time, end, text }], bg: [{ time, end, text }] }]
 * in document order. `text` is the whole line; a word's text keeps the space after it. Syllables in spans with no
 * space between them are words of their own (joined back up when shown). Untimed documents have `words` empty.
 */
function ttmlLines(xml) {
  const lines = [];
  let line = null, target = null, word = null, bgDepth = 0, depth = 0;
  const TOKEN = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|([^<]+)/g;
  const spans = []; // per open span: { word, bg }
  for (let m = TOKEN.exec(String(xml || '')); m; m = TOKEN.exec(xml)) {
    const [, closing, tag, attrs, selfClosing, raw] = m;
    if (raw !== undefined) {
      if (!line) continue;
      const text = decodeEntities(raw);
      if (!bgDepth) line.text += text;
      if (word) word.text += text;
      else if (target && target.length && text) target[target.length - 1].text += text.replace(/\s+/g, ' ');
      continue;
    }
    if (!tag) continue;
    const name = tag.replace(/^.*:/, '');
    if (name === 'p') {
      if (closing) {
        if (line) {
          line.text = line.text.replace(/\s+/g, ' ').trim();
          for (const list of [line.words, line.bg]) if (list.length) list[list.length - 1].text = list[list.length - 1].text.trimEnd();
          if (line.text) lines.push(line);
        }
        line = null; target = null; word = null; bgDepth = 0; depth = 0; spans.length = 0;
      } else if (!selfClosing) {
        const end = parseTime(attr(attrs, 'end'));
        line = { time: parseTime(attr(attrs, 'begin')), end, agent: attr(attrs, 'agent') || null, text: '', words: [], bg: [] };
        target = line.words;
      }
    } else if (line && name === 'span' && !selfClosing) {
      if (closing) {
        const open = spans.pop();
        if (open && open.word) word = null;
        if (open && open.bg) { bgDepth--; if (!bgDepth) target = line.words; }
      } else {
        const bg = attr(attrs, 'role') === 'x-bg';
        if (bg) { bgDepth++; target = line.bg; spans.push({ bg: true }); continue; }
        const begin = parseTime(attr(attrs, 'begin'));
        if (begin === null) { spans.push({}); continue; }
        word = { time: begin, end: parseTime(attr(attrs, 'end')), text: '' };
        target.push(word);
        spans.push({ word: true });
      }
    } else if (line && name === 'br' && !bgDepth) line.text += ' ';
  }
  return lines;
}

const stamp = (seconds, [open, close] = '[]') => {
  const cs = Math.round(Math.max(0, seconds) * 100);
  return `${open}${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}${close}`;
};
const GAP = 0.02; // a word that ends more than this before the next one starts leaves a pause

// Words as enhanced LRC: "<begin>word " — plus "<end>" after a word when a pause follows it, and at the end.
function wordsLrc(words, lineEnd) {
  let out = '';
  words.forEach((w, i) => {
    out += stamp(w.time, '<>') + w.text;
    const next = words[i + 1];
    if (next) {
      if (w.end !== null && next.time - w.end > GAP) out = `${out.replace(/\s+$/, '')} ${stamp(w.end, '<>')} `;
    } else {
      const end = lineEnd !== undefined && lineEnd !== null ? lineEnd : w.end;
      if (end !== null && end !== undefined) out += stamp(end, '<>');
    }
  });
  return out;
}

/**
 * LRC for a TTML document: extended enhanced LRC where the words are timed and `words` is on (a stamp before every
 * word, one after a word a pause follows and at the line's end, "v1:"/"v2:" when more than one singer, backing
 * vocals on a "[bg: …]" line after their line); line-synced when `words` is off or nothing is word-timed; plain text
 * when it has no timings at all; '' when it has no lyrics.
 */
function ttmlToLrc(xml, { words = true } = {}) {
  const lines = ttmlLines(xml);
  const timed = lines.some((l) => l.time !== null);
  const wordTimed = words && timed && lines.some((l) => l.words.length);
  const singers = new Set(lines.map((l) => l.agent).filter(Boolean));
  return lines.map((l) => {
    if (!timed) return l.text;
    if (!wordTimed || !l.words.length) return `${stamp(l.time || 0)}${l.text}`;
    const who = singers.size > 1 && l.agent ? `${l.agent}:` : '';
    const main = `${stamp(l.time || 0)}${who}${wordsLrc(l.words, l.end)}`;
    return l.bg.length ? `${main}\n[bg: ${wordsLrc(l.bg, null)}]` : main;
  }).join('\n');
}
```

Update the file's header comment to: *"…turned into LRC for the lyrics view — extended enhanced LRC when the words are timed: a stamp before each word, one after a word followed by a pause and at the line's end, "v1:" singer prefixes in a duet, and background vocals (ttm:role="x-bg") on a "[bg: …]" line after the line they're sung under."*

- [ ] **Step 4: Run the tests**

Run: `node --test test/metadata-sources.test.js`
Expected: all PASS. (The Unison lookup tests compare against `ttmlToLrc(TTML)` so they follow automatically.)

- [ ] **Step 5: Commit**

```bash
git add src/main/ttml.js test/metadata-sources.test.js
git commit -m "Lyrics from Unison keep when each word ends, who sings it, and the backing vocals"
```

---

### Task 2: `parseLrc` reads word ends, line ends, singers and backing vocals

**Files:**
- Modify: `src/renderer/js/lyrics.js` (`wordsOf`, `parseLrc`, `formatLyricsForDisplay`; add `lineState`)
- Test: `test/lyrics.test.mjs`

**Interfaces:**
- Consumes: the text format from Task 1.
- Produces:
  - `parseLrc(raw) → [{ time, text, words?, end?, agent?, bg? }]` — `words: [{ time, text, end? }]`, `bg: [{ time, text, end? }]`, `agent: 'v1' | 'v2' | 'v3' | …`. Keys absent when not in the lyrics.
  - `lineState(lines, position) → { index, singing }` — `index` as `currentLineIndex`; `singing` false once past the line's `end` (+0.15 s) until the next line starts. `currentLineIndex` is unchanged (the lyrics panel and booklet keep highlighting the last line through breaks).
  - `formatLyricsForDisplay` drops `vN:` prefixes and shows a `[bg: …]` line as its words only.

- [ ] **Step 1: Write the failing tests** — append to `test/lyrics.test.mjs` (and add `lineState` to its import):

```js
test('word ends: a stamp with no word after it ends the word before; one at the end ends the line', () => {
  const [line] = parseLrc("[00:08.84]<00:08.84>Now <00:09.16>he's <00:09.59> <00:10.06>thinkin'<00:12.34>");
  assert.strictEqual(line.text, "Now he's thinkin'");
  assert.deepStrictEqual(line.words, [
    { time: 8.84, text: 'Now ' }, { time: 9.16, end: 9.59, text: "he's " }, { time: 10.06, end: 12.34, text: "thinkin'" },
  ]);
  assert.strictEqual(line.end, 12.34);
});

test('singers and backing vocals, shifted with a repeated line', () => {
  const lines = parseLrc('[00:16.71][01:16.71]v2:<00:16.71>It <00:17.02>starts<00:19.11>\n[bg: <00:18.00>(oh <00:18.30>no)<00:18.90>]');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].agent, 'v2');
  assert.strictEqual(lines[0].text, 'It starts');
  assert.deepStrictEqual(lines[0].bg, [{ time: 18, text: '(oh ' }, { time: 18.3, end: 18.9, text: 'no)' }]);
  const r = (x) => Math.round(x * 100) / 100; // shifted times are sums of decimals
  assert.deepStrictEqual(lines[1].bg.map((w) => r(w.time)), [78, 78.3]);
  assert.strictEqual(r(lines[1].end), 79.11);
});

test('the lyrics as text: no singer prefixes, backing vocals as their words', () => {
  assert.strictEqual(formatLyricsForDisplay('[00:16.71]v2:<00:16.71>It <00:17.02>starts\n[bg: <00:18.00>(oh <00:18.30>no)]'), 'It starts\n(oh no)');
});

test('line state: singing until the line ends, then not until the next line', () => {
  const lines = parseLrc('[00:01.00]<00:01.00>a<00:02.00>\n[00:09.00]b');
  assert.deepStrictEqual(lineState(lines, 1.5), { index: 0, singing: true });
  assert.deepStrictEqual(lineState(lines, 4), { index: 0, singing: false });
  assert.deepStrictEqual(lineState(lines, 9.5), { index: 1, singing: true });
  assert.deepStrictEqual(lineState(lines, 0.5), { index: -1, singing: false });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/lyrics.test.mjs`
Expected: the four new tests FAIL (`lineState` is not exported; no `end`/`agent`/`bg`); the existing tests PASS.

- [ ] **Step 3: Implement** — in `src/renderer/js/lyrics.js`, replace `wordsOf`, `parseLrc` and `formatLyricsForDisplay`, and add `lineState`:

```js
const AGENT = /^v(\d{1,2}):/;
const BG_LINE = /^\[bg:(.*)\]\s*$/;

// A line's words from its enhanced-LRC stamps: { words: [{ time, text, end? }], end } — a stamp with no word after it
// ends the word before it (a pause follows), and the last one also ends the line (`end`, else null). Text before
// the first stamp is sung at the line's own time. → words [] when the line has no word stamps.
function wordsOf(body, lineTime) {
  const stamps = [...body.matchAll(WORD_STAMP)];
  if (!stamps.length) return { words: [], end: null };
  const words = [];
  let end = null;
  const lead = body.slice(0, stamps[0].index);
  if (lead.trim()) words.push({ time: lineTime, text: lead.replace(/^\s+/, '') });
  stamps.forEach((m, i) => {
    const last = i + 1 === stamps.length;
    const text = body.slice(m.index + m[0].length, last ? body.length : stamps[i + 1].index);
    const time = seconds(m[1], m[2], m[3]);
    if (text.trim()) { words.push({ time, text }); return; }
    const prev = words[words.length - 1];
    if (prev && prev.end === undefined && time > prev.time) prev.end = time;
    if (prev && text && !/\s$/.test(prev.text)) prev.text += text;
    if (last) end = time;
  });
  if (words.length) words[words.length - 1].text = words[words.length - 1].text.trimEnd();
  return { words, end };
}
const shifted = (w, by) => (w.end === undefined ? { time: w.time + by, text: w.text } : { time: w.time + by, end: w.end + by, text: w.text });

/**
 * Returns [{time (seconds), text}] sorted by time, or [] when the lyrics aren't timed. A line with word stamps also
 * has `words` ([{time, text, end?}]); one whose last stamp ends it has `end`; a duet line has its singer (`agent`,
 * "v1"…), and a "[bg: …]" line after it gives it backing vocals (`bg`, timed like words). A line stamped more than
 * once (a repeated chorus) has all of these shifted to each time.
 */
export function parseLrc(raw) {
  const out = [];
  let previous = []; // what the last timed line became (one per stamp), for a [bg: line after it
  for (const rawLine of String(raw).split(/\r\n|\r|\n/)) {
    const bg = BG_LINE.exec(rawLine.trim());
    if (bg) {
      if (previous.length) {
        const { words } = wordsOf(bg[1], previous[0].time);
        if (words.length) for (const line of previous) line.bg = words.map((w) => shifted(w, line.time - previous[0].time));
      }
      continue;
    }
    let rest = rawLine;
    const stamps = [];
    for (let m = STAMP.exec(rest); m; m = STAMP.exec(rest)) {
      stamps.push(seconds(m[1], m[2], m[3]));
      rest = rest.slice(m[0].length);
    }
    if (!stamps.length) continue; // header tags like [ti:...] or untimed text
    const who = AGENT.exec(rest.trimStart());
    if (who) rest = rest.trimStart().slice(who[0].length);
    const text = rest.replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim();
    const { words, end } = wordsOf(rest, stamps[0]);
    previous = stamps.map((time) => {
      const by = time - stamps[0];
      const line = { time, text };
      if (words.length) line.words = words.map((w) => shifted(w, by));
      if (end !== null) line.end = end + by;
      if (who) line.agent = `v${parseInt(who[1], 10)}`;
      out.push(line);
      return line;
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Plain-text display of lyrics: timestamps (line and word), singer prefixes and LRC header tags stripped. */
export function formatLyricsForDisplay(raw) {
  return String(raw).split(/\r\n|\r|\n/)
    .map((l) => {
      const bg = BG_LINE.exec(l.trim());
      if (bg) return bg[1].replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim();
      return l.replace(/^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*/, '').replace(AGENT, '').replace(WORD_STAMP, '');
    })
    .filter((l) => !/^\[(ti|ar|al|by|offset|length|re|ve):[^\]]*\]\s*$/.test(l))
    .join('\n').trim();
}

/**
 * The line at `position` and whether it is being sung: { index (as currentLineIndex), singing } — not singing before
 * the first line, or once past a line's end until the next one starts.
 */
export function lineState(lines, position) {
  const index = currentLineIndex(lines, position);
  if (index < 0) return { index, singing: false };
  const end = lines[index].end;
  return { index, singing: end === undefined || position < end + 0.15 };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/lyrics.test.mjs`
Expected: all PASS, including every pre-existing test unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/lyrics.js test/lyrics.test.mjs
git commit -m "Lyrics: read when words and lines end, who sings, and the backing vocals"
```

---

### Task 3: Word progress from real begin/end times, and a sung-length estimate for line-only lyrics

**Files:**
- Modify: `src/renderer/js/lyrics.js` (`wordProgress`; add `lineWords`, `syllables`)
- Test: `test/lyrics.test.mjs`

**Interfaces:**
- Consumes: `parseLrc` lines from Task 2.
- Produces:
  - `lineWords(line, end) → [{ time, end?, text }]` — the line's own words, or, for a line without word stamps, its text split into words (`/\S+\s*/g`) sharing `min(end, line.end ?? end) - line.time` capped at `max(1.5, syllables × 0.4)` seconds, each word's share ∝ its syllables; estimated words all have `end`.
  - `wordProgress(line, end, position) → number[]` — one 0…1 per `lineWords(line, end)` word: a word with `end` fills from `time` to `end` (full after); one without fills until the next word starts (last word: until `end`, at most 1.2 s).
  - `syllables(word) → integer ≥ 1`.

- [ ] **Step 1: Write the failing tests** — in `test/lyrics.test.mjs` import `lineWords, syllables`; replace the test `'word progress: …'` with:

```js
test('word progress: sung words full, the current one partly, the rest empty', () => {
  const [line] = parseLrc('[00:10.00]<00:10.00>One <00:11.00>two <00:12.00>three');
  assert.deepStrictEqual(wordProgress(line, 20, 11.5), [1, 0.5, 0]);
  // The last word lasts until the next line, but no longer than 1.2 seconds.
  assert.deepStrictEqual(wordProgress(line, 30, 12.6), [1, 1, 0.5]);
  // Before a word starts it is empty again (seeking back un-fills it).
  assert.deepStrictEqual(wordProgress(line, 20, 10.5), [0.5, 0, 0]);
});

test('a word with an end fills over its own length and holds through the pause after it', () => {
  const [line] = parseLrc("[00:08.00]<00:08.00>he's <00:09.00> <00:10.00>thinkin'<00:14.00>");
  assert.deepStrictEqual(wordProgress(line, 20, 8.5), [0.5, 0]);
  assert.deepStrictEqual(wordProgress(line, 20, 9.5), [1, 0]); // the pause: nothing moves
  assert.deepStrictEqual(wordProgress(line, 20, 12), [1, 0.5]); // a long held note fills slowly
});

test('syllables, roughly', () => {
  assert.deepStrictEqual(['I', 'line', 'Whole', 'criticize', 'Rhythms', 'Группа', '夜空'].map(syllables), [1, 1, 1, 3, 1, 2, 2]);
});

test('line-only lyrics: the line is shared among its words by how long they take to sing', () => {
  const [plain] = parseLrc('[00:10.00]Whole line');
  const words = lineWords(plain, 12);
  assert.deepStrictEqual(words.map((w) => w.text), ['Whole ', 'line']);
  assert.deepStrictEqual(words.map((w) => [w.time, w.end]), [[10, 10.75], [10.75, 11.5]]);
  const round = (xs) => xs.map((x) => Math.round(x * 100) / 100);
  assert.deepStrictEqual(round(wordProgress(plain, 12, 11)), [1, 0.33]);
  const [long] = parseLrc('[00:00.00]To criticize is critical');
  const w = lineWords(long, 30);
  assert.ok(w[1].end - w[1].time > w[0].end - w[0].time, 'criticize takes longer than to');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/lyrics.test.mjs`
Expected: FAIL — `lineWords`/`syllables` not exported; the held-note test fails.

- [ ] **Step 3: Implement** — replace `wordProgress` in `src/renderer/js/lyrics.js` and add:

```js
const VOWELS = /[aeiouyäöüàáâãåæèéêëìíîïòóôõøùúûýÿаеёиоуыэюяіїє]+/gi;
/** Roughly how many syllables a word has (vowel groups; a silent final e dropped; one per letter where there are no vowels, as in CJK). */
export function syllables(word) {
  const w = String(word).toLowerCase().replace(/[^\p{L}]/gu, '');
  if (!w) return 1;
  const groups = w.match(VOWELS);
  if (!groups) return w.length;
  let n = groups.length;
  if (n > 1 && /[^aeiouy]e$/.test(w)) n--; // "whole", "line"
  return Math.max(1, n);
}

/**
 * The words of `line`, timed: its own (enhanced LRC), or — for a line timed as a whole — its text split into words
 * that share the line's time by how many syllables each has. The line lasts until its own end or `end` (the next
 * line), and no longer than it would take to sing (0.4 s a syllable, at least 1.5 s).
 */
export function lineWords(line, end) {
  if (line.words && line.words.length) return line.words;
  const parts = String(line.text || '').match(/\S+\s*/g) || [line.text || ''];
  const weights = parts.map(syllables);
  const total = weights.reduce((s, n) => s + n, 0);
  const until = line.end !== undefined ? Math.min(end, line.end) : end;
  const length = Math.max(0, Math.min(until - line.time, Math.max(1.5, total * 0.4)));
  let at = line.time;
  return parts.map((text, i) => {
    const time = at;
    at += (length * weights[i]) / total;
    return { time, end: at, text };
  });
}

/**
 * How far through each word of `line` the singer is at `position`: [0…1] per word of lineWords(line, end). A word
 * with an end fills over its own length and stays full through a pause after it; one without lasts until the next
 * starts — the last until `end` (the next line), at most 1.2 s.
 */
export function wordProgress(line, end, position) {
  const words = lineWords(line, end);
  return words.map((w, i) => {
    const stop = w.end !== undefined ? w.end : i + 1 < words.length ? words[i + 1].time : Math.min(end, w.time + 1.2);
    if (position <= w.time) return 0;
    if (stop <= w.time || position >= stop) return 1;
    return (position - w.time) / (stop - w.time);
  });
}
```

(`syllables('Rhythms')`: letters "rhythms" → vowel groups `y` → 1. `'Группа'` → `у`, `а` → 2. `'夜空'` → no vowels → 2 letters.)

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/lyrics.js test/lyrics.test.mjs
git commit -m "Karaoke fills each word over its own time, and shares a line-timed line by syllables"
```

---

### Task 4: Word-timed lyrics first

**Files:**
- Modify: `src/main/online.js` (`findLyrics`)
- Test: `test/metadata-sources.test.js`

**Interfaces:**
- Produces: `findLyrics({ title, artist, album, duration, guessed })` → `{ lyrics, name, source }` or null — Unison first when its lyrics are word-timed; otherwise the old order, with a line-timed Unison answer used where Unison used to be (after the lrclib searches, before the free-text search) without asking Unison again.

- [ ] **Step 1: Write the failing tests** — in `test/metadata-sources.test.js` replace `'lrclib still comes first'` with:

```js
test('word-timed Unison lyrics come before lrclib, which only times lines', async () => {
  answer([[/lrclib\.net\/api\/get/, { trackName: 'Espresso', artistName: 'Sabrina Carpenter', duration: 186, syncedLyrics: '[00:01.00]From lrclib' }],
    unison({ song: 'Espresso', artist: 'Sabrina Carpenter', format: 'ttml', lyrics: TTML })]);
  const found = await findLyrics({ artist: 'Sabrina Carpenter', title: 'Espresso', duration: 186 });
  assert.strictEqual(found.source, 'Unison');
  assert.strictEqual(found.lyrics, ttmlToLrc(TTML));
  assert.ok(!asked.some((u) => /lrclib/.test(u)), 'lrclib not asked');
});

test('Unison with line timing only: lrclib still comes first, and Unison is not asked twice', async () => {
  answer([[/lrclib\.net\/api\/get/, { trackName: 'Espresso', artistName: 'Sabrina Carpenter', duration: 175, syncedLyrics: '[00:01.00]From lrclib' }],
    unison({ song: 'Espresso', artist: 'Sabrina Carpenter', format: 'lrc', lyrics: '[00:01.00]From Unison' })]);
  const found = await findLyrics({ artist: 'Sabrina Carpenter', title: 'Espresso', duration: 175 });
  assert.strictEqual(found.lyrics, '[00:01.00]From lrclib');
  answer([...NO_STORE_HITS, unison({ song: 'Espresso', artist: 'Sabrina Carpenter', format: 'lrc', lyrics: '[00:01.00]From Unison' })]);
  const fallback = await findLyrics({ artist: 'Sabrina Carpenter', title: 'Espresso', duration: 175 });
  assert.strictEqual(fallback.lyrics, '[00:01.00]From Unison');
  assert.strictEqual(asked.filter((u) => /unison/.test(u)).length, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/metadata-sources.test.js`
Expected: the first new test FAILS (source is lrclib.net); the second FAILS on the Unison request count (2).

- [ ] **Step 3: Implement** — in `src/main/online.js` change `findLyrics` to:

```js
const wordTimed = (lrc) => /<\d{1,3}:\d{2}/.test(lrc);

/**
 * Lyrics for { title, artist, album, duration, guessed }: Unison's first when they time every word (only Unison
 * does — Karaoke fills them word by word). Otherwise lrclib.net's exact entry for the name as given (with album and
 * length), then a search for every guess from nameVariants(), then Unison's line-timed lyrics, then a free-text
 * lrclib search. Only entries that are this song count. → { lyrics, name, source } (name = the guess that found
 * them) or null.
 */
async function findLyrics({ title, artist, album, duration, guessed }) {
  const variants = nameVariants({ artist, title, guessed });
  if (!variants.length) return null;
  const first = variants[0];
  let unisonLines = null;
  for (const v of variants.filter((x) => x.artist)) {
    const lyrics = await unisonLyrics({ ...v, album: v.artist === artist ? album : null, duration });
    if (lyrics && wordTimed(lyrics)) return { lyrics, name: v, source: 'Unison' };
    if (lyrics && !unisonLines) unisonLines = { lyrics, name: v, source: 'Unison' };
  }
  if (first.artist) {
    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(first.title)}&artist_name=${encodeURIComponent(first.artist)}`;
    if (album) url += `&album_name=${encodeURIComponent(album)}`;
    if (duration > 0) url += `&duration=${Math.round(duration)}`;
    try {
      const lyrics = pickLrclib(await fetchJson(url), { ...first, duration });
      if (lyrics) return { lyrics, name: first, source: 'lrclib.net' };
    } catch { /* 404 = no exact match; search below */ }
  }
  for (const v of variants) {
    try {
      let url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(v.title)}`;
      if (v.artist) url += `&artist_name=${encodeURIComponent(v.artist)}`;
      const lyrics = pickLrclib(await fetchJson(url), { ...v, duration });
      if (lyrics) return { lyrics, name: v, source: 'lrclib.net' };
    } catch { /* try the next guess */ }
  }
  if (unisonLines) return unisonLines;
  try {
    const lyrics = pickLrclib(await fetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(searchText(first))}`), { ...first, duration });
    if (lyrics) return { lyrics, name: first, source: 'lrclib.net' };
  } catch { /* nothing */ }
  return null;
}
```

Also update the module's header comment: "lyrics lookup (Unison when word-timed → lrclib.net → Unison)".

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all PASS (the existing Unison tests — "when lrclib has none", "another recording length" — still pass).

- [ ] **Step 5: Commit**

```bash
git add src/main/online.js test/metadata-sources.test.js
git commit -m "Lyrics: word-timed Unison lyrics before lrclib's line-timed ones"
```

---

### Task 5: Follow what's heard, plus a Lyrics Offset setting

**Files:**
- Modify: `src/renderer/js/lyrics.js` (add `heardPosition`), `src/renderer/js/audio.js` (`outputLatency` getter), `src/main/store.js` (line 14), `src/renderer/js/app.js` (state, `setLyricsOffset`, settings load/save, `app.lyricsPosition`, karaoke tick), `src/renderer/js/panels.js` (Settings row; lyrics panel sync), `src/renderer/js/booklet.js` (highlight), `src/renderer/js/karaoke.js` (rebuild)
- Test: `test/lyrics.test.mjs`, `test/state.test.js`

**Interfaces:**
- Produces:
  - `heardPosition(position, latencySeconds, offsetMs) → seconds` = `position − latency − offsetMs/1000` (positive offset = lyrics later), never below 0.
  - `engine.outputLatency` (seconds): `ctx.outputLatency || ctx.baseLatency || 0`.
  - settings `lyricsOffset` (ms, −500…500, multiple of 50) as the 14th line; `DEFAULT_SETTINGS.lyricsOffset = 0`.
  - `app.lyricsPosition() → seconds` used by karaoke, the lyrics panel and the booklet; `app.setLyricsOffset(ms)`.

- [ ] **Step 1: Write the failing tests**

In `test/lyrics.test.mjs` (import `heardPosition`):

```js
test('the heard position: behind by the output latency, moved by the lyrics offset', () => {
  assert.strictEqual(heardPosition(10, 0.2, 0), 9.8);
  assert.strictEqual(heardPosition(10, 0.2, 300), 9.5); // + = lyrics later
  assert.strictEqual(heardPosition(10, 0, -250), 10.25);
  assert.strictEqual(heardPosition(0.1, 0.2, 0), 0);
});
```

In `test/state.test.js`, add `lyricsOffset: 0` to the expected object of `'reads a settings.txt written by the Java version'`, and append:

```js
test('lyrics offset is the 14th settings line, in steps of 50 ms within ±500', () => {
  store.writeSettings({ ...store.DEFAULT_SETTINGS, lyricsOffset: -150 });
  assert.strictEqual(fs.readFileSync(path.join(home, 'settings.txt'), 'utf8').split('\n')[13], '-150');
  assert.strictEqual(store.readSettings().lyricsOffset, -150);
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n0\n0\n1\nRED\n0,0,0,0,0,0,0,0,0,0\n1\n0\n\n1\n1\n0\n0\n9000\n');
  assert.strictEqual(store.readSettings().lyricsOffset, 500);
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n0\n0\n1\nRED\n0,0,0,0,0,0,0,0,0,0\n1\n0\n\n1\n1\n0\n0\n130\n');
  assert.strictEqual(store.readSettings().lyricsOffset, 150);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `heardPosition` missing; `lyricsOffset` missing from settings.

- [ ] **Step 3: Implement**

`src/renderer/js/lyrics.js` — add:

```js
/**
 * Where the song is for the ears: `position` less the audio output's latency (large over Bluetooth), and moved by the
 * user's lyrics offset (ms; + shows the lyrics later). Never before 0.
 */
export function heardPosition(position, latencySeconds, offsetMs) {
  return Math.max(0, Math.round((position - (latencySeconds || 0) - (offsetMs || 0) / 1000) * 1e6) / 1e6);
}
```

`src/renderer/js/audio.js` — beside `get position()`:

```js
  /** How long sound takes from here to the speakers (seconds): the output's latency, re-read as the device changes. */
  get outputLatency() { return (this.ctx && (this.ctx.outputLatency || this.ctx.baseLatency)) || 0; }
```

`src/main/store.js` — in the settings comment add "…, saving found art & lyrics into files and the lyrics offset (ms)"; `DEFAULT_SETTINGS` gets `lyricsOffset: 0`; in `readSettings` after `saveFound`:

```js
  if (l.length >= 14 && l[13].trim()) s.lyricsOffset = Math.max(-500, Math.min(500, Math.round(int(l[13], 0) / 50) * 50));
```

and in `writeSettings` append `s.lyricsOffset || 0` after `s.saveFound ? 1 : 0` in the joined list.

`src/renderer/js/app.js`:
- import `heardPosition` from `./lyrics.js` (extend the existing import line).
- `state`: add `lyricsOffset: 0,` next to `saveFound`.
- next to `setSaveFound`: `function setLyricsOffset(ms) { state.lyricsOffset = ms; saveSettingsSoon(); }` and `const lyricsPosition = () => heardPosition(engine.position, engine.outputLatency, state.lyricsOffset);`
- the settings snapshot (the `return { volume: …, saveFound: state.saveFound }` at ~line 969): add `lyricsOffset: state.lyricsOffset`.
- where settings are applied (~line 1247, after `state.saveFound = !!s.saveFound;`): `state.lyricsOffset = s.lyricsOffset || 0;`
- the frame loop (~line 1164): `if (isKaraokeOpen()) updateKaraoke(lyricsPosition());`
- the `app` object: add `lyricsPosition, setLyricsOffset,`.

`src/renderer/js/panels.js`:
- `updateLyricsSync`: `app.currentLineIndex(lyricsView.lines, app.lyricsPosition())`.
- Settings: after the `sleep` slider definitions add

```js
  const offsetText = (ms) => (ms ? `${ms > 0 ? '+' : '−'}${Math.abs(ms)} MS` : '0 MS');
  const offsetValue = el('span', { class: 'row-value' }, offsetText(s.lyricsOffset));
  const lyricsOffset = new Slider({ min: -10, max: 10, value: Math.round(s.lyricsOffset / 50), onInput: (v) => { offsetValue.textContent = offsetText(v * 50); app.setLyricsOffset(v * 50); } });
  lyricsOffset.canvas.title = 'Move the lyrics later (+) or earlier (−) for a song timed a little off';
```

  and in the PLAYBACK section after `sliderRow('SLEEP TIMER', sleep, sleepValue),`:

```js
    sliderRow('LYRICS OFFSET', lyricsOffset, offsetValue),
    hint('Karaoke and the lyrics already follow what you hear, Bluetooth included. Move them if a song’s lyrics are timed a little off.'),
```

`src/renderer/js/booklet.js` — in `startLyricsHighlight`: `currentLineIndex(lines, app.lyricsPosition())`.

`src/renderer/js/karaoke.js` — in `rebuild()`: `updateKaraoke(app.lyricsPosition(), true);`

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/lyrics.js src/renderer/js/audio.js src/main/store.js src/renderer/js/app.js src/renderer/js/panels.js src/renderer/js/booklet.js src/renderer/js/karaoke.js test/lyrics.test.mjs test/state.test.js
git commit -m "Lyrics follow what you hear, Bluetooth delay included, with a Lyrics Offset setting"
```

---

### Task 6: The Apple Music karaoke look

**Files:**
- Modify: `src/renderer/js/karaoke.js` (rebuild + per-frame update), `src/renderer/styles.css` (`/* ---- Karaoke Mode */` block)
- Test: manual, in a separate test copy (see Step 4)

**Interfaces:**
- Consumes: `parseLrc`, `lineState`, `lineWords`, `wordProgress` (Tasks 2–3), `app.lyricsPosition()` (Task 5), `anim.enabled`.

- [ ] **Step 1: Replace `rebuild` and `updateKaraoke` in `src/renderer/js/karaoke.js`** (imports: `import { parseLrc, lineState, lineWords, wordProgress } from './lyrics.js';`). Update the header comment to mention the lift/glow, backing vocals, duets and the breathing dots.

```js
const HELD = 1; // seconds: a word sung longer than this glows
const REST = 3; // seconds: a break longer than this between lines shows the breathing dots

// Where line i stops: its own end, else when the next line starts (at most 6 s on).
const endOf = (lines, i) => (lines[i].end !== undefined ? lines[i].end : i + 1 < lines.length ? lines[i + 1].time : lines[i].time + 6);

function rebuild() {
  const { app } = view;
  const d = app.state.details;
  view.lyrics = app.state.lyrics;
  view.lines = parseLrc(view.lyrics);
  const duet = new Set(view.lines.map((l) => l.agent).filter(Boolean)).size > 1;
  view.words = []; view.bgWords = []; view.timed = [];
  // (An empty timed line is an instrumental break: shown as a note.)
  view.nodes = view.lines.map((line, i) => {
    const timed = lineWords(line, endOf(view.lines, i));
    view.timed.push(timed);
    const words = timed.map((w) => {
      const span = el('span', { class: `k-word${w.end !== undefined && w.end - w.time > HELD ? ' held' : ''}` }, w.text);
      return span;
    });
    view.words.push(words);
    const bg = line.bg ? line.bg.map((w) => el('span', { class: 'k-word' }, w.text)) : [];
    view.bgWords.push(bg);
    const cls = ['k-line', line.text ? '' : 'gap', duet && line.agent ? `k-${line.agent}` : ''].filter(Boolean).join(' ');
    return el('div', { class: cls, onClick: () => app.seekTo(line.time) },
      line.text ? el('div', { class: 'k-main' }, words) : '♪',
      bg.length ? el('div', { class: 'k-bg' }, bg) : null,
      el('div', { class: 'k-dots' }, el('i'), el('i'), el('i')));
  });
  view.current = -2;
  $('karaoke-lines').replaceChildren(...view.nodes);
  $('karaoke').classList.toggle('calm', !anim.enabled);
  $('karaoke-title').textContent = d ? [d.title, d.artist].filter(Boolean).join(' · ') : '';
  updateKaraoke(app.lyricsPosition(), true);
}

const fill = (spans, progress) => progress.forEach((p, i) => {
  const s = spans[i];
  if (!s) return;
  s.style.setProperty('--p', p.toFixed(3));
  s.classList.toggle('singing', p > 0 && p < 1);
});

/** Every frame while open: the current line centered, its words (and backing vocals) filled up to `position`. */
export function updateKaraoke(position, force = false) {
  if (!view) return;
  const { lines, nodes, words, bgWords } = view;
  const { index, singing } = lineState(lines, position);
  if (index !== view.current || force) {
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('sung', i < index);
      nodes[i].classList.toggle('current', i === index);
      nodes[i].style.setProperty('--d', String(Math.min(4, Math.abs(i - Math.max(0, index)))));
      if (i !== index) { fill(words[i], words[i].map(() => (i < index ? 1 : 0))); fill(bgWords[i], bgWords[i].map(() => (i < index ? 1 : 0))); }
    }
    view.current = index;
    const box = $('karaoke-lines'), target = nodes[Math.max(0, index)];
    if (target) {
      // Keep the current line a little above the middle, with the next ones coming up beneath it.
      const offset = box.parentElement.clientHeight * 0.42 - (target.offsetTop + target.offsetHeight / 2);
      box.style.transition = force || !anim.enabled ? 'none' : '';
      box.style.transform = `translateY(${offset}px)`;
    }
  }
  if (index >= 0) {
    const end = endOf(lines, index);
    fill(words[index], wordProgress(lines[index], end, position));
    if (lines[index].bg) fill(bgWords[index], wordProgress({ time: lines[index].bg[0].time, text: '', words: lines[index].bg }, end, position));
    // A long break after the line: it settles, and the dots breathe until the next one.
    const next = index + 1 < lines.length ? lines[index + 1].time : Infinity;
    nodes[index].classList.toggle('resting', !singing && next - position > 0.6 && next - (lines[index].end ?? next) > REST);
  }
}
```

Keep `openKaraoke`, `closeKaraoke`, `refreshKaraoke`, `canKaraoke`, `isKaraokeOpen` as they are.

- [ ] **Step 2: Replace the Karaoke block in `src/renderer/styles.css`** (from `.k-line {` through the `.k-line.current .k-word { … }` rule) with:

```css
.k-line {
  max-width: 900px; margin: 0 auto; padding: 10px 0; text-align: center;
  font-size: 26px; line-height: 1.25; color: rgba(var(--text), .28); cursor: pointer;
  transition: font-size 260ms ease, color 260ms ease, filter 400ms ease, opacity 400ms ease;
  filter: blur(calc(var(--d, 0) * .55px)); opacity: calc(1 - var(--d, 0) * .12);
}
.k-line:hover { color: rgba(var(--text), .55); filter: none; }
.k-line.gap { font-size: 20px; }
.k-line.sung { color: rgba(var(--text), .42); }
.k-line.current { font-size: 44px; color: rgba(var(--text), .38); filter: none; opacity: 1; }
/* Duets: the first singer on the left, the second on the right, both together in the middle. */
.k-line.k-v1 { text-align: left; }
.k-line.k-v2 { text-align: right; }
.k-bg { font-size: .56em; margin-top: 4px; opacity: .75; }
/* The fill: each word painted in the accent up to --p (0…1) of its width, with a soft edge, the rest in unsung grey.
   A word lifts a little while it's sung, and one held long glows. */
.k-line.current .k-word {
  --p: 0;
  display: inline-block; white-space: pre;
  background: linear-gradient(to right, rgb(var(--accent)) calc(var(--p) * 110% - 10%), rgba(var(--text), .38) calc(var(--p) * 110%));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  transition: transform 260ms cubic-bezier(.3, 1.4, .5, 1), text-shadow 300ms ease;
}
.k-line.current .k-word.singing { transform: translateY(-3px); }
.k-line.current .k-word.held.singing { text-shadow: 0 0 calc(var(--p) * 18px) rgba(var(--accent), calc(var(--p) * .8)); }
/* A long break: three dots breathing where the next line will come. */
.k-dots { display: none; justify-content: center; gap: 10px; padding-top: 14px; }
.k-line.current.resting .k-dots { display: flex; }
.k-line.current.resting .k-main { opacity: .5; }
.k-dots i { width: 9px; height: 9px; border-radius: 50%; background: rgb(var(--accent)); animation: k-breathe 1.6s ease-in-out infinite; }
.k-dots i:nth-child(2) { animation-delay: .2s; } .k-dots i:nth-child(3) { animation-delay: .4s; }
@keyframes k-breathe { 0%, 100% { transform: scale(.6); opacity: .35; } 50% { transform: scale(1); opacity: 1; } }
#karaoke-lines { transition: transform 520ms cubic-bezier(.3, 1.25, .45, 1); }
/* Animations off: the fill only. */
#karaoke.calm .k-line { filter: none; opacity: 1; transition: none; }
#karaoke.calm .k-word { transform: none !important; text-shadow: none !important; transition: none; }
#karaoke.calm .k-dots i { animation: none; opacity: .8; transform: none; }
#karaoke.calm #karaoke-lines { transition: none; }
```

Also delete the old `#karaoke-lines { … transition: transform 420ms … }` declaration's `transition` (the rule above replaces it; keep `position/left/right/top`).

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: all PASS (no unit tests cover rendering; nothing else may break).

- [ ] **Step 4: Check it in the running app — a separate test copy, never the user's window**

```bash
H=$(mktemp -d /tmp/cdp-karaoke-XXXX); echo "$HOME/Music" > $H/lastpath.txt; touch $H/onboarded
CDPLAYER_HOME=$H npx electron . --remote-debugging-port=9334   # in the background
```

Tell the user a test window will appear and not to click in it. Drive it over the DevTools protocol (a small `WebSocket` script: `Runtime.evaluate`, `Page.captureScreenshot`), and after any renderer change **restart the test copy** (a page reload serves cached modules). Check and screenshot:
1. A Unison song (e.g. drop an MP3/M4A of "Espresso" or "In the End" into the queue via `app.addToQueue([path])`, or use any local song whose lyrics source shows "Unison"): a held word glows; a pause between words stays unfilled; after a line's end the dots breathe in a break > 3 s.
2. "In the End" (if available): v1 lines left, v2 right, v3 centered. Espresso: backing vocals under their line, filling on their own.
3. An lrclib-only song (e.g. Limp Bizkit "Pollution"): words fill one after another, longer words taking longer.
4. Settings → LYRICS OFFSET to +500: the fill runs visibly later; back to 0.
5. Settings → Animations off: fill only, no blur/lift/glow/dots animation.
6. No errors (`window.addEventListener('error', …)` collected) in any of the above.

Close the test copy and delete `$H` afterwards.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/karaoke.js src/renderer/styles.css
git commit -m "Karaoke looks like Apple Music's: soft fill, words that lift and glow, backing vocals, duets and a breathing pause"
```

---

## Self-review notes

- Spec §1 → Task 4; §2 → Tasks 1–2; §3 → Tasks 2–3 (with one deliberate refinement: the spec's "currentLineIndex uses a line's end" is implemented as the new `lineState`, so the lyrics panel and booklet keep highlighting the last line through breaks and karaoke doesn't scroll to the top in a gap); §4 → Task 5; §5 → Task 6; Out of scope respected; Testing → each task.
- Types: `lineWords`/`wordProgress`/`lineState`/`heardPosition`/`app.lyricsPosition`/`engine.outputLatency`/`lyricsOffset` are named identically in every task that uses them.

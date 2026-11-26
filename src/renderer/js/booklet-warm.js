// What a booklet shows that has to be looked up — the album's story, its scans, its songs' words — asked for before it's
// opened (as the disc goes in, or its case is opened on the shelf), so it's there when it is. No DOM here.

const WORDS_AT_ONCE = 4;
const AGAIN_MS = 2500; // the lyrics' sites turn some of an album's songs away when asked all together: those once more
const MISSED_MS = 30 * 60e3; // …and found by neither, left alone a while: album() is called at each song of it

/**
 * Answers to `ask(query)`, the last `max` of them kept: asked for once while it's on its way, and again only if it
 * couldn't be had (`keep(answer)` false, or it failed — null then). peek: the answer if it's here, else undefined.
 */
export function memo(max, ask, keep = () => true) {
  const kept = new Map(), going = new Map();
  const keyOf = (q) => JSON.stringify(q);
  const use = (key) => { const v = kept.get(key); kept.delete(key); kept.set(key, v); return v; };
  return {
    peek: (q) => { const key = keyOf(q); return kept.has(key) ? kept.get(key) : undefined; },
    get(q) {
      const key = keyOf(q);
      if (kept.has(key)) return Promise.resolve(use(key));
      if (!going.has(key)) {
        going.set(key, Promise.resolve().then(() => ask(q)).catch(() => undefined).then((r) => {
          going.delete(key);
          if (r !== undefined && keep(r)) { kept.set(key, r); while (kept.size > max) kept.delete(kept.keys().next().value); }
          return r === undefined ? null : r;
        }));
      }
      return going.get(key);
    },
  };
}

export function createWarm(cdp, { again = AGAIN_MS, clock = Date.now } = {}) {
  const failed = Symbol('failed');
  // A lookup that fails isn't "there's none": kept apart from it.
  const asking = (fn, missing) => async (q) => { const r = await Promise.resolve().then(() => fn(q)).catch(() => failed); return r === failed || missing(r) ? undefined : r; };
  const story = memo(30, asking((q) => cdp.albumStory(q), (r) => r === undefined || !!(r && r.unavailable)));
  const scans = memo(3, asking((q) => (cdp.bookletScans ? cdp.bookletScans(q) : []), (r) => !r));
  const words = memo(400, asking((q) => cdp.bookletLyrics(q), (r) => !r || !r.lyrics));
  let turn = 0;
  const missedAt = new Map();
  const lately = (q) => clock() - (missedAt.get(JSON.stringify(q)) ?? -Infinity) < MISSED_MS;
  return {
    story, scans, words,
    /** Gets ready what's given: { story, scans: the album asked for; songs: the ones whose words are wanted }. */
    async album({ story: s, scans: sc, songs = [] }) {
      const mine = ++turn;
      const all = async (list) => {
        let next = 0;
        const worker = async () => { while (next < list.length && mine === turn) await words.get(list[next++]); };
        await Promise.all(Array.from({ length: WORDS_AT_ONCE }, worker));
      };
      const everyWord = async () => {
        await all(songs.filter((q) => !lately(q)));
        const missed = songs.filter((q) => words.peek(q) === undefined && !lately(q));
        if (!missed.length || mine !== turn) return;
        await new Promise((r) => setTimeout(r, again));
        await all(missed);
        if (mine !== turn) return;
        for (const [k, at] of missedAt) if (clock() - at >= MISSED_MS) missedAt.delete(k);
        for (const q of missed) if (words.peek(q) === undefined) missedAt.set(JSON.stringify(q), clock());
      };
      await Promise.all([s && story.get(s), sc && scans.get(sc), everyWord()]);
    },
  };
}

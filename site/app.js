// CDPlayer's site: the download for this visitor's system, the theme pill, the looks, and the releases as a tracklist.
// releases.json is written by scripts/build-site.mjs at deploy time; without it (a local preview) GitHub's API is asked.
(() => {
  'use strict';
  const REPO = 'Kizarov3/CDPlayer';
  const $ = (s, el = document) => el.querySelector(s);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } },
  };

  /* ---------- The language: English as written, or Russian from ru.js (the head's script picked it). ---------- */
  const root = document.documentElement;
  const RU = window.CDP_RU;
  const ru = root.lang === 'ru' && !!RU;
  /** `en` in this page's language, with {name}s from `vars` (a Russian entry may be a function of them). */
  const t = (en, vars = {}) => {
    let s = (ru && RU.text[en]) || en;
    if (typeof s === 'function') s = s(vars);
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  };
  if (ru) {
    document.querySelectorAll('[data-i18n]').forEach((el) => { const h = RU.html[el.dataset.i18n]; if (h) el.innerHTML = h; });
    for (const [attr, key] of [['alt', 'i18nAlt'], ['title', 'i18nTitle'], ['aria-label', 'i18nLabel']]) {
      document.querySelectorAll(`[data-${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}]`).forEach((el) => {
        const h = RU.html[el.dataset[key]]; if (h) el.setAttribute(attr, h);
      });
    }
    document.title = RU.html['doc-title'];
    const lang = $('#lang');
    lang.textContent = 'EN'; lang.lang = 'en';
  }
  root.classList.remove('i18n-wait');
  // The other language: the page again in it (where it was, and with the release it had open in the address).
  $('#lang').addEventListener('click', () => { store.set('cdp-lang', ru ? 'en' : 'ru'); location.reload(); });

  /* ---------- Themes: the pill cycles through the player's built-in ones. ---------- */
  const THEMES = ['RED', 'BLUE', 'SUNSET', 'FOREST', 'GALAXY', 'OCEAN', 'MATRIX', 'AUTUMN', 'SNOW', 'WHITE'];
  const showTheme = () => { $('#theme-name').textContent = root.dataset.theme || 'RED'; };
  $('#theme').addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(root.dataset.theme) + 1) % THEMES.length];
    root.dataset.theme = next;
    store.set('cdp-theme', next);
    showTheme();
  });
  showTheme();

  /* ---------- The disc's shine follows the mouse, as DISC SHINE does in the player. ---------- */
  const shine = $('#shine');
  const caseEl = $('#case');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.addEventListener('pointermove', (e) => {
      const r = caseEl.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      shine.style.setProperty('--shine', `${Math.atan2(dy, dx) * 180 / Math.PI + 90}deg`);
      const near = Math.max(0, 1 - Math.hypot(dx, dy) / 900);
      $('#disc').style.transform = `rotateX(${(-dy / r.height) * 8 * near}deg) rotateY(${(dx / r.width) * 8 * near}deg)`;
    }, { passive: true });
  }

  /* ---------- Seven-segment digits for the deck's display. ---------- */
  const H = (y) => `M2.6,${y} l1,-1 h4.8 l1,1 l-1,1 h-4.8 z`;
  const V = (x, y) => `M${x},${y} l1,1 v5.4 l-1,1 l-1,-1 v-5.4 z`;
  const SEGS = { a: H(1.2), b: V(10.4, 1.6), c: V(10.4, 10.4), d: H(18.8), e: V(1.6, 10.4), f: V(1.6, 1.6), g: H(10) };
  const DIGITS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };
  function seg(el, text, cells) {
    const chars = [];
    for (const ch of String(text)) {
      if (ch === '.') { if (chars.length) chars[chars.length - 1].dot = true; continue; }
      chars.push({ ch, dot: false });
    }
    while (cells && chars.length < cells) chars.unshift({ ch: ' ', dot: false }); // the unlit 8s before, as on the deck
    const w = 12, h = 20, gap = 2.2;
    let x = 0, paths = '';
    for (const { ch, dot } of chars) {
      const lit = DIGITS[ch] ?? '';
      for (const [k, d] of Object.entries(SEGS)) paths += `<path transform="translate(${x} 0) skewX(-6)" class="${lit.includes(k) ? 'on' : 'off'}" d="${d}"/>`;
      if (dot) { paths += `<circle cx="${x + w + 0.2}" cy="19" r="1.15" class="on"/>`; x += 2.4; }
      x += w + gap;
    }
    el.innerHTML = `<svg viewBox="-1 0 ${x + 1} ${h}" role="img" aria-label="${text}">${paths}</svg>`;
  }
  seg($('#seg-version'), '-.--.-', 0);
  seg($('#seg-size'), '---', 3);

  /* ---------- Which system this is. ---------- */
  const OS = {
    mac: { name: 'macOS', file: /-mac\.dmg$/i, note: 'Apple Silicon and Intel' },
    win: { name: 'Windows', file: /-windows\.exe$/i, note: 'Windows 10 and 11, nothing to install' },
    linux: { name: 'Linux', file: /-linux\.AppImage$/i, note: 'AppImage, any distribution' },
  };
  function detectOS() {
    const ua = navigator.userAgent;
    const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    if (/iPhone|iPad|iPod|Android/i.test(ua) || (/Mac/.test(p) && navigator.maxTouchPoints > 1)) return 'mobile';
    if (/Win/i.test(p) || /Windows/i.test(ua)) return 'win';
    if (/Mac/i.test(p) || /Mac OS X/i.test(ua)) return 'mac';
    if (/Linux|X11|CrOS/i.test(p + ua)) return 'linux';
    return 'unknown';
  }
  const os = detectOS();
  const mb = (bytes) => Math.round(bytes / 1048576);
  const DATE = ru
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDate = (iso) => DATE.format(new Date(iso)).replace(/ г\.$/, '');

  function showDownload(latest) {
    const version = latest.tag_name.replace(/^v/, '');
    seg($('#seg-version'), version, 0);
    const assetFor = (k) => latest.assets.find((a) => OS[k].file.test(a.name));
    const main = OS[os] && assetFor(os);
    const key = $('#dl-key'), btn = $('#dl-main'), meta = $('#dl-meta');
    document.querySelectorAll('.deck-status [data-os]').forEach((s) => s.classList.toggle('lit', os in OS ? s.dataset.os === os : true));
    if (main) {
      key.href = btn.href = main.browser_download_url;
      btn.textContent = t('DOWNLOAD FOR {os}', { os: OS[os].name.toUpperCase() });
      meta.innerHTML = `<code>${esc(main.name)}</code> · ${t('{mb} MB', { mb: mb(main.size) })} · ${t(OS[os].note)}<br>${t('Version {version}, released {date}', { version: esc(version), date: fmtDate(latest.published_at) })}`;
      seg($('#seg-size'), String(mb(main.size)), 3);
    } else {
      key.href = btn.href = `#others`;
      btn.textContent = t(os === 'mobile' ? 'FOR YOUR COMPUTER' : 'DOWNLOAD');
      meta.textContent = t(os === 'mobile'
        ? 'CDPlayer runs on macOS, Windows and Linux. Version {version}, {date}.'
        : 'Version {version}, {date}. Pick your system:', { version, date: fmtDate(latest.published_at) });
      const sizes = Object.keys(OS).map((k) => assetFor(k)).filter(Boolean).map((a) => mb(a.size));
      if (sizes.length) seg($('#seg-size'), String(Math.max(...sizes)), 3);
      $('#deck-size-label').textContent = t('UP TO · MB');
    }
    const others = Object.keys(OS).filter((k) => k !== os).map((k) => {
      const a = assetFor(k);
      return a ? `<a class="pill" href="${esc(a.browser_download_url)}">${OS[k].name.toUpperCase()} <small>${t('{mb} MB', { mb: mb(a.size) })}</small></a>` : '';
    }).join('');
    $('#others').innerHTML = `<span>${main ? t('Other systems:') : ''}</span>${others}<a class="pill" href="#releases">${t('ALL VERSIONS')}</a>`;
  }

  /* ---------- First-launch tabs, opened at this system. ---------- */
  function pickTab(k) {
    document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === k)));
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== k; });
  }
  document.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => pickTab(t.dataset.tab)));
  pickTab(os in OS ? os : 'mac');
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#' + b.dataset.copy).textContent); b.textContent = t('COPIED'); }
    catch { b.textContent = t('SELECT IT'); }
    setTimeout(() => { b.textContent = t('COPY'); }, 1600);
  }));

  /* ---------- The looks. ---------- */
  const LOOKS = [
    ['CLASSIC', 'main-changer.jpg', '<b>CLASSIC</b> in the CD changer: the disc in its case, the deck\'s glowing display, five discs in the carousel.'],
    ['ALBUM', 'look-album.jpg', '<b>ALBUM</b>: an album\'s page, the cover in its jewel case and the disc sliding out of it.'],
    ['HI-FI', 'look-hi-fi.jpg', '<b>HI-FI</b>: a CD player\'s brushed-metal front, a lit display with level meters, metal keys.'],
    ['LYRICS', 'look-lyrics.jpg', '<b>LYRICS</b>: the words down the side as they\'re sung. Click a line to play from it.'],
    ['VISUALIZER', 'look-visualizer.jpg', '<b>VISUALIZER</b>: the music drawn across the window.'],
    ['CD VIEW', 'cd-view.jpg', '<b>CD VIEW</b>: just the disc, big, and the album\'s name over it.'],
    ['SNOW', 'main-snow.jpg', 'Eleven themes with scenes of their own: <b>SNOW</b>\'s flakes falling behind the player.'],
  ];
  const img = $('#look-img'), cap = $('#look-cap');
  const tabs = $('#look-tabs');
  tabs.innerHTML = LOOKS.map(([name], i) => `<button class="pill" role="tab" data-look="${i}">${name}</button>`).join('');
  function pickLook(i) {
    const [name, file, text] = LOOKS[i];
    tabs.querySelectorAll('[data-look]').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.look === i)));
    cap.innerHTML = ru ? t(`look-${name}`) : text;
    img.alt = t("CDPlayer's {name} look", { name });
    if (img.getAttribute('src') === `shots/${file}`) return;
    img.classList.add('fading');
    const next = new Image();
    next.onload = next.onerror = () => { img.src = next.src; img.classList.remove('fading'); };
    next.src = `shots/${file}`;
  }
  tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-look]'); if (b) pickLook(+b.dataset.look); });
  pickLook(0);
  LOOKS.slice(1).forEach(([, f]) => { const p = new Image(); p.loading = 'lazy'; setTimeout(() => { p.src = `shots/${f}`; }, 2500); });

  /* ---------- Release notes: the small Markdown the notes are written in. ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function inline(s) {
    const codes = [];
    s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }
  function markdown(md) {
    const out = [];
    let list = 0; // open <ul> depth
    const close = (to = 0) => { while (list > to) { out.push('</ul>'); list--; } };
    let skipping = false; // the notes' own Download table: the files are the pills under the notes
    let folded = false; // the Changelog, folded under its key: "What's new" is what most read
    const unfold = () => { if (folded) { close(); out.push('</details>'); folded = false; } };
    for (const raw of md.replace(/\r/g, '').split('\n')) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if ((m = line.match(/^#{1,6}\s+(.*)/))) {
        close();
        unfold();
        skipping = /^downloads?$/i.test(m[1].trim());
        if (/^changelog$/i.test(m[1].trim())) {
          out.push(`<details class="changelog"><summary class="pill">${t('FULL CHANGELOG')}</summary>`);
          folded = true;
        } else if (!skipping) out.push(`<h3>${inline(m[1])}</h3>`);
        continue;
      }
      if (skipping || /^\s*\|/.test(line)) continue; // (tables aren't drawn)
      if (!line.trim()) { close(); continue; }
      if ((m = line.match(/^\*\*([^*]+)\*\*:?$/))) { close(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
      if ((m = line.match(/^(\s*)[-*+]\s+(.*)/))) {
        const depth = Math.floor(m[1].length / 2) + 1;
        if (depth > list) { while (list < depth) { out.push('<ul>'); list++; } } else close(depth);
        out.push(`<li>${inline(m[2])}</li>`);
        continue;
      }
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
    close();
    unfold();
    return out.join('');
  }
  /** A release's name for the tracklist: the first of its "What's new" in bold, or its first line. */
  function titleOf(r) {
    const body = (r.body || '').replace(/\r/g, '');
    const m = body.match(/^\s*[-*]\s+\*\*(.+?)\*\*/m);
    let title = m ? m[1] : (body.split('\n').find((l) => l.trim() && !/^#/.test(l)) || '');
    title = title.replace(/[*`#]/g, '').replace(/^\s*[-*]\s+/, '').trim().replace(/[.:]$/, '');
    if (r.name && !/^v?\d+(\.\d+)+$/.test(r.name.trim()) && !title) title = r.name;
    return title || t('Fixes and small changes');
  }

  function showReleases(releases) {
    const list = $('#tracklist');
    const total = releases.length;
    $('#rel-note').textContent = t('{n} RELEASES', { n: total });
    const SHOWN = 10;
    list.innerHTML = releases.map((r, i) => {
      const ver = r.tag_name.replace(/^v/, '');
      return `<li class="track${i === 0 ? ' latest' : ''}"${i >= SHOWN ? ' hidden' : ''} data-i="${i}" id="v${esc(ver)}">
        <button type="button" aria-expanded="false"><span class="no">${total - i}.</span><span class="ver">${esc(ver)}</span><span class="title">${esc(titleOf(r))}${i === 0 ? `<span class="badge">${t('LATEST')}</span>` : ''}</span><span class="date">${fmtDate(r.published_at)}</span></button>
      </li>`;
    }).join('');
    const toggle = (li, open) => {
      const r = releases[+li.dataset.i];
      const btn = li.querySelector('button');
      let notes = li.querySelector('.notes');
      if (open === undefined) open = !li.classList.contains('open');
      li.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open && !notes) {
        notes = document.createElement('div');
        notes.className = 'notes';
        const files = r.assets.filter((a) => /\.(dmg|exe|AppImage)$/i.test(a.name))
          .map((a) => `<a class="pill" href="${esc(a.browser_download_url)}">${esc(a.name)} <small>${t('{mb} MB', { mb: mb(a.size) })}</small></a>`).join('');
        notes.innerHTML = (r.body ? markdown(r.body) : `<p>${t('No notes for this one.')}</p>`) +
          `<div class="rel-files">${files}<a class="pill" href="${esc(r.html_url)}">${t('ON GITHUB')}</a></div>`;
        li.appendChild(notes);
      }
      if (notes) notes.hidden = !open;
    };
    list.addEventListener('click', (e) => { const li = e.target.closest('.track'); if (li && e.target.closest('button')) toggle(li); });
    const hashed = location.hash.startsWith('#v') && document.getElementById(location.hash.slice(1));
    if (hashed) { hashed.hidden = false; toggle(hashed, true); hashed.scrollIntoView(); }
    else toggle(list.firstElementChild, true);
    const more = $('#rel-more');
    if (total > SHOWN) {
      more.hidden = false;
      more.textContent = t('SHOW ALL {n}', { n: total });
      more.addEventListener('click', () => { list.querySelectorAll('.track[hidden]').forEach((li) => { li.hidden = false; }); more.hidden = true; });
    }
  }

  /* ---------- Load. ---------- */
  async function load() {
    try {
      const res = await fetch('releases.json', { cache: 'no-cache' });
      if (res.ok) return await res.json();
    } catch { /* a local preview: ask GitHub */ }
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`);
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    return (await res.json()).filter((r) => !r.draft && !r.prerelease);
  }
  load().then((releases) => {
    if (!releases.length) throw new Error('no releases');
    showDownload(releases[0]);
    showReleases(releases);
  }).catch(() => {
    const link = (html, href) => html.replace('<a>', `<a href="${href}">`);
    $('#tracklist').innerHTML = `<li class="loading">${link(t("The releases couldn't be loaded here. They're all on <a>GitHub</a>."), `https://github.com/${REPO}/releases`)}</li>`;
    $('#dl-meta').innerHTML = link(t("Pick your system's file on the <a>latest release</a>."), `https://github.com/${REPO}/releases/latest`);
  });
})();

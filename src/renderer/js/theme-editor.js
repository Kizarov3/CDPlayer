// The theme editor (Settings → THEME → + NEW THEME, or EDIT on one of yours): six colors, a scene, and a picture behind
// the player — the player itself recolored as you go. The panel is opened and closed by panels.js.
import { el, pill, Slider } from './widgets.js';
import { t } from './i18n.js';
import { THEMES, SCENES, contrast, hex, fromHex, startFrom, deriveAutoTheme, typedName } from './theme.js';

const COLOR_ROWS = [[t('BACKGROUND'), 'bg'], [t('CARDS'), 'card'], [t('ACCENT'), 'accent'], [t('ACCENT 2'), 'accent2'], [t('TEXT'), 'text'], [t('MUTED'), 'muted']];
const SCENE_NAMES = { BARS: t('BARS'), SNOW: t('SNOW|scene'), GALAXY: t('GALAXY|scene'), OCEAN: t('OCEAN|scene'), MATRIX: t('MATRIX|scene'), AUTUMN: t('AUTUMN|scene') };
const MAX_SIDE = 1920, MAX_BYTES = 1024 * 1024, QUALITIES = [0.85, 0.75, 0.65, 0.55];

const asDataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
const loadImage = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

/** A picture for a theme: at most 1920 px and 1 MB, as a JPEG data URL. Throws 'unreadable' or 'too big'. */
export async function shrinkImage(blob) {
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch { throw new Error('unreadable'); }
  const s = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * s)), Math.max(1, Math.round(bitmap.height * s)));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of QUALITIES) {
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    if (out.size <= MAX_BYTES) return asDataUrl(out);
  }
  throw new Error('too big');
}

/** The editor's contents. ctx: { draft (the theme being made), editing (the theme of yours being changed, or null), saved }. */
export function buildThemeEditor(app, ctx, ui) {
  const d = ctx.draft, preview = () => app.previewTheme(d);
  const swatchOf = (theme) => `linear-gradient(135deg, rgb(${theme.accent}), rgb(${theme.accent2}))`;

  const startButton = pill(t('START FROM…'), () => ui.menu(startButton, [
    ...THEMES.filter((theme) => !theme.user && theme.name !== 'AUTO').map((theme) => ({ label: theme.name, swatch: swatchOf(theme), pick: () => { startFrom(d, theme); ui.refresh(); preview(); } })),
    { label: t('THIS ALBUM'), pick: () => { startFrom(d, deriveAutoTheme(app.state.cover)); ui.refresh(); preview(); } },
  ]), t('Take the colors and scene of a theme, or the colors of the album playing'));

  const warning = el('span', { class: 'theme-warning' });
  const checkContrast = () => { warning.textContent = contrast(d.text, d.bg) < 4.5 ? t('HARD TO READ') : ''; };
  checkContrast();
  const colorRow = ([label, key]) => {
    const code = el('span', { class: 'row-value' }, hex(d[key]).toUpperCase());
    const well = el('input', { type: 'color', class: 'color-well', value: hex(d[key]), title: t('Pick a color'),
      onInput: (e) => { d[key] = fromHex(e.target.value); code.textContent = e.target.value.toUpperCase(); checkContrast(); preview(); } });
    return ui.row(label, el('div', { class: 'row-pills' }, key === 'text' ? warning : null, code, well));
  };

  const sceneButton = pill(SCENE_NAMES[d.scene], () => ui.menu(sceneButton, SCENES.map((s) => ({
    label: SCENE_NAMES[s], current: s === d.scene, pick: () => { d.scene = s; sceneButton.textContent = SCENE_NAMES[s]; preview(); },
  }))), t('The visualizer, and what falls behind the player'));

  const useImage = async (blob) => {
    try { d.image = await shrinkImage(blob); ctx.problem = null; } catch (err) { ctx.problem = err.message === 'too big' ? t('IMAGE TOO BIG') : t("CAN'T READ THAT IMAGE"); ui.refresh(); return; }
    ui.refresh(); preview();
  };
  const picker = el('input', { type: 'file', accept: 'image/*', hidden: true, onChange: (e) => { if (e.target.files[0]) useImage(e.target.files[0]); e.target.value = ''; } });
  let imageRows;
  if (d.image) {
    const blurValue = el('span', { class: 'row-value' }, `${d.blur}PX`), dimValue = el('span', { class: 'row-value' }, `${d.dim}%`);
    const blur = new Slider({ min: 0, max: 40, value: d.blur, onInput: (v) => { d.blur = v; blurValue.textContent = `${v}PX`; preview(); } });
    const dim = new Slider({ min: 0, max: 90, value: d.dim, onInput: (v) => { d.dim = v; dimValue.textContent = `${v}%`; preview(); } });
    imageRows = [
      ui.row(t('IMAGE'), el('div', { class: 'row-pills' },
        pill(t('COLORS FROM IMAGE'), async () => {
          try { startFrom(d, deriveAutoTheme(await loadImage(d.image)), { keepScene: true }); } catch { ctx.problem = t("CAN'T READ THAT IMAGE"); ui.refresh(); return; }
          ui.refresh(); preview();
        }, t('Colors to go with the picture')),
        pill(t('CHANGE…'), () => picker.click()), pill(t('REMOVE'), () => { d.image = null; ui.refresh(); preview(); }))),
      ui.sliderRow(t('BLUR'), blur, blurValue), ui.sliderRow(t('DIM'), dim, dimValue),
    ];
  } else {
    imageRows = [ui.row(t('IMAGE'), pill(t('CHOOSE…'), () => picker.click(), t('A picture behind the player'))),
      ui.hint(t('Or drop a picture here. It’s kept inside the theme, so it travels with it.'))];
  }

  const name = el('input', { class: 'theme-name', value: d.name, maxlength: 16, spellcheck: 'false',
    onInput: (e) => { const f = e.target, cut = f.value.length - typedName(f.value).length, at = f.selectionStart - cut; f.value = typedName(f.value); f.setSelectionRange(at, at); d.name = f.value; } });
  const save = async () => {
    if (!d.name.trim()) { name.focus(); return; }
    if (await app.saveTheme(d, ctx.editing ? ctx.editing.name : null)) { ctx.saved = true; ui.close(); }
  };

  const body = el('div', { class: 'scroll settings-body',
    onDragover: (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) useImage(f); } },
  ui.row(t('START FROM'), startButton), ui.gap(10),
  ...COLOR_ROWS.map(colorRow), ui.gap(10),
  ui.row(t('SCENE'), sceneButton), ...imageRows, ui.gap(10),
  ctx.problem ? el('div', { class: 'theme-warning theme-problem' }, ctx.problem) : null, // said here: the status line is under the panel
  ui.row(t('NAME'), name), picker);
  return [ui.title(ctx.editing ? t('EDIT {theme}', { theme: ctx.editing.name }) : t('NEW THEME')), ui.gap(14), body,
    el('div', { class: 'close-row split' }, pill(t('CANCEL'), ui.close), el('button', { class: 'pill on', onClick: save }, t('SAVE')))];
}

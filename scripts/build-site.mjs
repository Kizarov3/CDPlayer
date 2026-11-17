// Builds the website into dist-site/: the pages in site/, the screenshots from docs/screenshots (as shots/), the
// app's icon, and releases.json (every published release, from GitHub's API) so the page needn't ask GitHub itself.
// GITHUB_TOKEN, when set (CI), lifts the API's rate limit. Preview: node scripts/build-site.mjs && npx serve dist-site
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-site');
const REPO = 'Kizarov3/CDPlayer';

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(path.join(ROOT, 'site'), OUT, { recursive: true });
await cp(path.join(ROOT, 'docs/screenshots'), path.join(OUT, 'shots'), { recursive: true });
await cp(path.join(ROOT, 'src/renderer/icon.png'), path.join(OUT, 'icon.png'));

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'cdplayer-site-build' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const releases = [];
for (let page = 1; ; page++) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers });
  if (!res.ok) throw new Error(`GitHub releases: ${res.status} ${await res.text()}`);
  const batch = await res.json();
  releases.push(...batch);
  if (batch.length < 100) break;
}
const slim = releases
  .filter((r) => !r.draft && !r.prerelease)
  .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
  .map((r) => ({
    tag_name: r.tag_name,
    name: r.name,
    published_at: r.published_at,
    html_url: r.html_url,
    body: r.body,
    assets: r.assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url })),
  }));
if (!slim.length) throw new Error('No published releases');
await writeFile(path.join(OUT, 'releases.json'), JSON.stringify(slim));
await writeFile(path.join(OUT, '.nojekyll'), '');
console.log(`dist-site: ${slim.length} releases, latest ${slim[0].tag_name}`);

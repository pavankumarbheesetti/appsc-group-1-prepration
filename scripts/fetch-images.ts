/**
 * Fetch a free lead image from Wikipedia/Wikimedia Commons for every timeline
 * event or person that has a `wiki` title and no `images` yet.
 *
 *   npm run fetch:images            # all banks under content/timeline/
 *   npm run fetch:images -- --dry   # report only, write nothing
 *
 * Only public-domain, CC0 and CC BY / BY-SA files are accepted; the credit,
 * licence and file page are stored with the image so the app can show them.
 * Thumbnails (320px) go to src/assets/timeline/<id>.<ext> and are inlined at build.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TIMELINE_DIR = resolve(here, '../content/timeline');
const ASSET_DIR = resolve(here, '../src/assets/timeline');
const API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'APPSC-Group1-Prep/0.1 (offline personal study app; contact: local user)';
const DRY = process.argv.includes('--dry');
const FREE = /^(public domain|pd\b|pd-|cc0|cc by(-sa)?( \d(\.\d)?)?)/i;

interface ImageRef { src: string; alt: string; caption?: string; credit?: string; license?: string; sourceUrl?: string }
interface Item { id: string; wiki?: string; images?: ImageRef[]; title?: string; name?: string }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped MediaWiki JSON
async function getJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    await sleep(4000 * (attempt + 1));
  }
  throw new Error(`request failed: ${url}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped MediaWiki JSON
async function api(params: Record<string, string>): Promise<any> {
  return getJson(`${API}?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`);
}

const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function leadImage(title: string): Promise<ImageRef & { thumb: string } | null> {
  const page = await api({ action: 'query', prop: 'pageimages|pageprops', piprop: 'name', ppprop: 'wikibase_item', titles: title, redirects: '1' });
  const p0 = page?.query?.pages?.[0];
  const first = p0?.pageimage ? await fileInfo(API, p0.pageimage as string) : null;
  if (first) return first;
  // Fallback: the Wikidata "image" (P18) claim, which is always a Commons file.
  const qid: string | undefined = p0?.pageprops?.wikibase_item;
  if (!qid) return null;
  const wd = await getJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetclaims', entity: qid, property: 'P18', format: 'json' })}`);
  const name: string | undefined = wd?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return name ? fileInfo(COMMONS_API, name) : null;
}

async function fileInfo(endpoint: string, name: string): Promise<ImageRef & { thumb: string } | null> {
  const info = await getJson(`${endpoint}?${new URLSearchParams({
    action: 'query', titles: `File:${name}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '320',
    format: 'json', formatversion: '2', origin: '*',
  })}`);
  const ii = info?.query?.pages?.[0]?.imageinfo?.[0];
  if (!ii?.thumburl) return null;
  const meta = ii.extmetadata ?? {};
  const license = stripHtml(meta.LicenseShortName?.value ?? '');
  if (meta.NonFree?.value === 'true' || !FREE.test(license)) return null;
  const artist = stripHtml(meta.Artist?.value ?? '') || 'Unknown author';
  return {
    src: '', alt: '', thumb: ii.thumburl,
    credit: `${artist.slice(0, 120)} / Wikimedia Commons`,
    license,
    sourceUrl: ii.descriptionurl,
  };
}

async function main(): Promise<void> {
  mkdirSync(ASSET_DIR, { recursive: true });
  const files = readdirSync(TIMELINE_DIR).filter((f) => /^(events|people)[-.].*json$/.test(f));
  let added = 0;
  let skipped = 0;
  for (const file of files) {
    const path = join(TIMELINE_DIR, file);
    const bank = JSON.parse(readFileSync(path, 'utf8'));
    const items: Item[] = bank.events ?? bank.people ?? [];
    let changed = false;
    for (const item of items) {
      if (!item.wiki || item.images?.length) continue;
      const found = await leadImage(item.wiki).catch((e: unknown) => {
        console.warn(`  ! ${item.id}: ${String(e)}`);
        return null;
      });
      await sleep(1500);
      if (!found) {
        skipped += 1;
        console.log(`  - ${item.id}: no free image for "${item.wiki}"`);
        continue;
      }
      const ext = (found.thumb.split('?')[0]!.match(/\.(jpe?g|png)$/i)?.[1] ?? 'jpg').toLowerCase();
      const key = `tl-img-${item.id}`;
      if (!DRY) {
        const res = await fetch(found.thumb, { headers: { 'User-Agent': UA } });
        if (!res.ok) { skipped += 1; continue; }
        writeFileSync(join(ASSET_DIR, `${key}.${ext === 'jpeg' ? 'jpg' : ext}`), Buffer.from(await res.arrayBuffer()));
      }
      const label = item.name ?? item.title ?? item.wiki;
      item.images = [{ src: key, alt: label, credit: found.credit, license: found.license, sourceUrl: found.sourceUrl }];
      changed = true;
      added += 1;
      console.log(`  + ${item.id}: ${found.license}`);
    }
    if (changed && !DRY) writeFileSync(path, `${JSON.stringify(bank, null, 2)}\n`);
  }
  console.log(`\nimages added: ${added}, skipped: ${skipped}${DRY ? ' (dry run)' : ''}`);
}

void main();

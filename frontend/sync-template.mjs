import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const built = resolve(here, '../nexgen_msp/public/frontend/index.html');
const target = resolve(here, '../nexgen_msp/www/msp.html');

// The page Frappe serves is the built one, verbatim. Anything added to index.html —
// a favicon, a meta tag, a font — therefore reaches production without touching this file.
const html = readFileSync(built, 'utf8');

const asset = html.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/);

if (!asset) {
  console.error('sync-template: the built index.html carries no bundle — did the build run?');
  process.exit(1);
}

if (!html.includes('frappe.session.csrf_token')) {
  console.error('sync-template: index.html no longer injects the CSRF token');
  process.exit(1);
}

writeFileSync(target, html);

console.log(`sync-template: msp.html now points at ${asset[1]}`);

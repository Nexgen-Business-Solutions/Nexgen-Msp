import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const built = resolve(here, '../nexgen_msp/public/frontend/index.html');
const target = resolve(here, '../nexgen_msp/www/msp.html');

const html = readFileSync(built, 'utf8');

const script = html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/);
const style = html.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);

if (!script || !style) {
  console.error('sync-template: could not find the built asset tags');
  process.exit(1);
}

const asset = (path) => `/assets/nexgen_msp/frontend${path.replace(/^\.?\//, '/')}`;

writeFileSync(
  target,
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/assets/nexgen_msp/frontend/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nexgen MSP</title>
    <meta name="csrf-token" content="{{ frappe.session.csrf_token }}" />
    <script type="module" crossorigin src="${asset(script[1])}"></script>
    <link rel="stylesheet" crossorigin href="${asset(style[1])}">
  </head>
  <body>
    <div id="root"></div>
    <script>window.csrf_token = '{{ frappe.session.csrf_token }}';</script>
  </body>
</html>
`
);

console.log(`sync-template: msp.html now points at ${asset(script[1])}`);

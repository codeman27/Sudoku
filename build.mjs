// Build the production site into dist/: content-hashed immutable assets plus
// no-cache shell files (index.html, sw.js, manifest.webmanifest).
import fs from 'node:fs';

const ASSETS = ['css/style.css', 'js/sudoku.js', 'js/storage.js', 'js/app.js', 'icons/icon-192.png', 'icons/icon-512.png'];
const SHELL = ['index.html', 'manifest.webmanifest', 'sw.js'];

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/assets', { recursive: true });

import { createHash } from 'node:crypto';
const map = {};
for (const path of ASSETS) {
  const data = fs.readFileSync(path);
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 10);
  const dir = path.split('/').slice(0, -1).join('/');
  const base = path.split('/').pop();
  const ext = base.includes('.') ? '.' + base.split('.').pop() : '';
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const dest = `assets/${dir}/${stem}-${hash}${ext}`;
  map[path] = dest;
  fs.mkdirSync(`dist/assets/${dir}`, { recursive: true });
  fs.writeFileSync(`dist/${dest}`, data);
}

for (const path of SHELL) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [from, to] of Object.entries(map)) text = text.split(from).join(to);
  fs.writeFileSync(`dist/${path}`, text);
}

console.log(JSON.stringify(map, null, 2));

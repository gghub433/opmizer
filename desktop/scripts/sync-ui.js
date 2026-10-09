'use strict';
/** Copies ../ui -> renderer/ (cleaned first). The renderer folder is generated and git-ignored. */
const fs = require('node:fs');
const path = require('node:path');

const src = path.resolve(__dirname, '..', '..', 'ui');
const dst = path.resolve(__dirname, '..', 'renderer');

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.warn('[sync-ui] warning: ' + path.join(src, 'index.html') + ' does not exist yet');
}
if (!fs.existsSync(src)) {
  console.error('[sync-ui] no UI folder at ' + src);
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
let files = 0;
(function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue; // editor/OS junk
    const a = path.join(from, ent.name);
    const b = path.join(to, ent.name);
    if (ent.isDirectory()) copy(a, b);
    else if (ent.isFile()) { fs.copyFileSync(a, b); files++; }
  }
})(src, dst);
console.log('[sync-ui] ' + files + ' files: ' + src + ' -> ' + dst);

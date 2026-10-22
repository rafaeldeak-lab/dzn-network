import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILDING_ASSETS } from './preview/building-assets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'preview');
const manifest = readFileSync(join(root, 'ASSET_SHA256.txt'), 'utf8').trim().split(/\r?\n/);
const recorded = new Map();
for (const line of manifest) {
  const match = /^([a-f0-9]{64}) (assets\/[\w./-]+)$/.exec(line);
  if (!match || recorded.has(match[2])) throw new Error(`Invalid or duplicate asset manifest entry: ${line}`);
  recorded.set(match[2], match[1]);
  const bytes = readFileSync(join(root, ...match[2].split('/')));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== match[1]) throw new Error(`Asset checksum mismatch: ${match[2]}`);
}

let pairs = 0;
for (const [key, definition] of Object.entries(BUILDING_ASSETS)) {
  if (definition.levels.length !== 5) throw new Error(`${key} does not have five levels`);
  for (const [index, level] of definition.levels.entries()) {
    for (const [format, signature] of [['glb', 'glTF'], ['png', '\x89PNG']]) {
      const path = level[format];
      if (!recorded.has(path)) throw new Error(`Unrecorded ${key} level ${index + 1} ${format}: ${path}`);
      const bytes = readFileSync(join(root, ...path.split('/')));
      if (bytes.toString('latin1', 0, 4) !== signature) throw new Error(`Invalid ${format} signature: ${path}`);
    }
    pairs += 1;
  }
}
if (pairs !== 20 || recorded.size !== 44) throw new Error(`Expected 20 building pairs and 44 assets, got ${pairs} and ${recorded.size}`);
console.log(`Stronghold preview assets verified: ${pairs} level pairs, ${recorded.size} checksums.`);

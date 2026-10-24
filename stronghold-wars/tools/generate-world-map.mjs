// Original DZN Stronghold world texture. The land geometry comes from the
// ISC-licensed world-atlas package already used by the DZN operational globe.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../preview/assets/world');
const atlas = JSON.parse(await readFile(path.resolve(here, '../../node_modules/world-atlas/land-50m.json'), 'utf8'));
const land = feature(atlas, atlas.objects.land);
const width = 1600;
const height = 800;
const projection = geoEquirectangular().fitExtent([[10, 35], [width - 10, height - 35]], land);
const landPath = geoPath(projection)(land);
const meridians = Array.from({ length: 13 }, (_, i) => `<path d="M${i * width / 12} 0V${height}"/>`).join('');
const parallels = Array.from({ length: 7 }, (_, i) => `<path d="M0 ${i * height / 6}H${width}"/>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="sea" x2="0" y2="1"><stop stop-color="#071b20"/><stop offset=".54" stop-color="#11312d"/><stop offset="1" stop-color="#071b20"/></linearGradient>
<pattern id="scan" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0H8" stroke="#9d6ed0" stroke-opacity=".06"/></pattern></defs>
<rect width="${width}" height="${height}" fill="url(#sea)"/>
<g fill="none" stroke="#78c9aa" stroke-opacity=".12" stroke-width="1">${meridians}${parallels}</g>
<path d="${landPath}" fill="#37544c" stroke="#76a88e" stroke-width="1.25" stroke-opacity=".72"/>
<path d="${landPath}" fill="url(#scan)"/>
<rect width="${width}" height="${height}" fill="none" stroke="#a47acb" stroke-opacity=".25" stroke-width="12"/>
</svg>`;
await mkdir(root, { recursive: true });
const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(path.join(root, 'stronghold-world.png'), bytes);
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  asset: 'assets/world/stronghold-world.png',
  dimensions: [width, height],
  sha256: createHash('sha256').update(bytes).digest('hex'),
  provenance: 'Original DZN palette and grid over world-atlas 50m Natural Earth land geometry (ISC license); no paid provider or third-party game art.'
}, null, 2)}\n`);
console.log(`Created Stronghold world texture (${width}x${height}, ${bytes.length} bytes).`);

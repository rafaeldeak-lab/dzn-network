import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

// Mechanical extraction of the owner's final transparent five-level sheets.
// A narrow transparent seam keeps weapons and packs attached to their unit.
const sheets = {
  assault: 'DZN Warden assault progression-2.png',
  recon: 'DZN Ghost five-stage scout progression-5.png',
  engineer: 'DZN Fixer five-stage lineup, fully framed-6.png',
  sentinel: 'DZN Sentinel five-stage formation-7.png',
  medic: 'DZN Lifeline Medic Upgrade Lineup-4.png',
};
const sourceDir = process.argv[2] ? resolve(process.argv[2]) : join(dirname(fileURLToPath(import.meta.url)), '..', 'source-art', 'squads');
const preview = join(dirname(fileURLToPath(import.meta.url)), '..', 'preview');
const outputDir = join(preview, 'assets', 'portraits', 'squads-final');
await mkdir(outputDir, { recursive: true });

function seam(data, width, height, boundary) {
  const centre = Math.round(width * boundary / 5);
  const left = centre - 105;
  const right = centre + 105;
  const span = right - left + 1;
  const predecessors = new Int16Array(span * height);
  let previous = new Float64Array(span);
  let next = new Float64Array(span);
  for (let y = 0; y < height; y++) {
    for (let index = 0; index < span; index++) {
      const x = left + index;
      const alpha = data[(y * width + x) * 4 + 3];
      const pixelCost = alpha <= 16 ? 0 : 40 + alpha / 4;
      const centreCost = Math.abs(x - centre) * 0.025;
      let best = Infinity;
      let parent = index;
      for (let shift = -3; shift <= 3; shift++) {
        const candidate = index + shift;
        if (candidate < 0 || candidate >= span) continue;
        const cost = previous[candidate] + Math.abs(shift) * 0.22;
        if (cost < best) { best = cost; parent = candidate; }
      }
      next[index] = best + pixelCost + centreCost;
      predecessors[y * span + index] = parent;
    }
    [previous, next] = [next, previous];
    next.fill(0);
  }
  let index = 0;
  for (let candidate = 1; candidate < span; candidate++) if (previous[candidate] < previous[index]) index = candidate;
  const result = new Int16Array(height);
  for (let y = height - 1; y >= 0; y--) {
    result[y] = left + index;
    index = predecessors[y * span + index];
  }
  return result;
}

const manifest = { schema: 1, source: 'Owner-supplied final DZN progression sheets', outputSize: [768, 768], assets: {} };
for (const [role, filename] of Object.entries(sheets)) {
  const source = await readFile(join(sourceDir, filename));
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width !== 1983 || height !== 793 || info.channels !== 4) throw new Error(`Unexpected final sheet geometry: ${filename}`);
  const seams = [null, ...[1, 2, 3, 4].map(boundary => seam(data, width, height, boundary)), null];
  for (let level = 1; level <= 5; level++) {
    const pixels = Buffer.alloc(data.length);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    let opaque = 0;
    for (let y = 0; y < height; y++) {
      const from = level === 1 ? 0 : seams[level - 1][y] + 1;
      const to = level === 5 ? width - 1 : seams[level][y];
      for (let x = from; x <= to; x++) {
        const offset = (y * width + x) * 4;
        data.copy(pixels, offset, offset, offset + 4);
        if (data[offset + 3] > 16) {
          opaque++;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    if (opaque < 25000) throw new Error(`Level ${level} of ${role} appears empty or badly separated`);
    const margin = 8;
    const left = Math.max(0, minX - margin);
    const top = Math.max(0, minY - margin);
    const cropWidth = Math.min(width, maxX + margin + 1) - left;
    const cropHeight = Math.min(height, maxY + margin + 1) - top;
    const output = await sharp(pixels, { raw: { width, height, channels: 4 } })
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize(720, 720, { fit: 'contain', background: '#00000000', kernel: 'lanczos3' })
      .extend({ top: 24, right: 24, bottom: 24, left: 24, background: '#00000000' })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    const name = `${role}_l0${level}`;
    const file = `assets/portraits/squads-final/${name}.png`;
    await writeFile(join(outputDir, `${name}.png`), output);
    manifest.assets[name] = { file, source: filename, sourceSha256, sha256: createHash('sha256').update(output).digest('hex'), bytes: output.length, bbox: [minX, minY, maxX, maxY], opaquePixels: opaque };
    console.log(`${name}: ${output.length} bytes, source bbox ${minX},${minY}–${maxX},${maxY}`);
  }
}
await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

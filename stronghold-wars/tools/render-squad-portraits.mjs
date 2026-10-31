// Render the project-owned squad GLBs into transparent close-up PNGs using local Chromium.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SQUAD_ROLES } from '../preview/squad-assets.js';

const preview = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../preview');
const output = path.join(preview, 'assets/portraits/squads');
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"https://esm.sh/three@0.184.0","three/":"https://esm.sh/three@0.184.0/"}}</script>');
    return;
  }
  const assetName = pathname.match(/^\/assets\/models\/squads\/([a-z]+)_l0[1-5]\.glb$/)?.[1];
  if (!assetName || !SQUAD_ROLES[assetName]) {
    response.writeHead(404); response.end(); return;
  }
  try {
    const bytes = await readFile(path.join(preview, ...pathname.slice(1).split('/')));
    response.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': bytes.length });
    response.end(bytes);
  } catch {
    response.writeHead(404); response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.38, 1.38, 1.38, -1.38, 0.1, 20);
    camera.position.set(2.7, 2.42, 4.6);
    camera.lookAt(0, 1.12, 0);
    scene.add(new THREE.HemisphereLight(0xe9f8ec, 0x243b34, 3.1));
    const key = new THREE.DirectionalLight(0xffffff, 4.0); key.position.set(-3, 7, 6); scene.add(key);
    const rim = new THREE.DirectionalLight(0xb87aff, 2.1); rim.position.set(3, 4, -5); scene.add(rim);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(400, 400);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setClearColor(0x000000, 0);
    document.body.appendChild(renderer.domElement);
    const loader = new GLTFLoader();
    window.captureSquadPortrait = async name => {
      const halfFrame = name.startsWith('recon') ? 1.72 : 1.38;
      camera.left = -halfFrame; camera.right = halfFrame; camera.top = halfFrame; camera.bottom = -halfFrame;
      camera.position.set(2.7, name.startsWith('recon') ? 2.55 : 2.42, 4.6);
      camera.lookAt(0, name.startsWith('recon') ? 1.28 : 1.12, 0);
      camera.updateProjectionMatrix();
      const result = await loader.loadAsync(`/assets/models/squads/${name}.glb`);
      scene.add(result.scene);
      renderer.render(scene, camera);
      const image = renderer.domElement.toDataURL('image/png');
      scene.remove(result.scene);
      return image;
    };
  });
  const manifest = {
    schemaVersion: 1,
    provenance: 'Local Chromium render of original DZN Stronghold Wars squad GLBs; no paid provider or external art.',
    dimensions: [400, 400], assets: {},
  };
  for (const role of Object.keys(SQUAD_ROLES)) for (let tier = 1; tier <= 5; tier++) {
    const name = `${role}_l0${tier}`;
    const dataUrl = await page.evaluate(name => window.captureSquadPortrait(name), name);
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    await writeFile(path.join(output, `${name}.png`), bytes);
    manifest.assets[name] = { file: `assets/portraits/squads/${name}.png`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Rendered ${Object.keys(manifest.assets).length} DZN squad portraits in ${output}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

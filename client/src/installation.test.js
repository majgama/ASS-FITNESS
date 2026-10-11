import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const publicUrl = new URL('../public/', import.meta.url);

test('manifest uses standalone root launch and real square PNG icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', publicUrl), 'utf8'));
  assert.equal(manifest.name, 'Athlon Coach');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    const image = await readFile(new URL(icon.src.slice(1), publicUrl));
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(image.readUInt32BE(16), size);
    assert.equal(image.readUInt32BE(20), size);
    assert.match(icon.purpose, /maskable/);
  }
  const appleIcon = await readFile(new URL('icones/app-180.png', publicUrl));
  assert.equal(appleIcon.readUInt32BE(16), 180);
  assert.equal(appleIcon.readUInt32BE(20), 180);
  const html = await readFile(new URL('../index.html', publicUrl), 'utf8');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180"/);
});

test('service worker activates and fetches from network without storing authenticated responses', async () => {
  const handlers = new Map();
  const requests = [];
  let skipped = false;
  let claimed = false;
  const response = { status: 200 };
  vm.runInNewContext(await readFile(new URL('sw.js', publicUrl), 'utf8'), {
    self: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } }
    },
    fetch: async (request) => { requests.push(request); return response; }
  });
  handlers.get('install')();
  let activation;
  handlers.get('activate')({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.equal(skipped, true);
  assert.equal(claimed, true);
  const request = { url: 'https://example.test/api/students', headers: { Authorization: 'test-only' } };
  let fetched;
  handlers.get('fetch')({ request, respondWith: (promise) => { fetched = promise; } });
  assert.equal(await fetched, response);
  assert.deepEqual(requests, [request]);
});

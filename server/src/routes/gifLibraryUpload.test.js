import assert from 'node:assert/strict';
import { before, after, mock, test } from 'node:test';
import express from 'express';
import { errorHandler } from '../middleware/errorHandler.js';

const uploads = new Map();
const validGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
let server, baseUrl;
before(async () => {
  mock.module('../middleware/auth.js', { namedExports: {
    authRequired: (req, res, next) => {
      const role = req.headers['x-test-role'];
      if (!role) return res.sendStatus(401);
      req.user = { id: '11111111-1111-4111-8111-111111111111', role }; next();
    },
    requireRoles: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403)
  } });
  mock.module('../db/pool.js', { namedExports: { query: async (sql, params = []) => {
    if (sql.includes('INSERT INTO gif_library_uploads')) {
      const [id, name_pt, gender, environment, muscle_group_pt, file_data, size_bytes] = params;
      uploads.set(id, { id, name_pt, gender, environment, muscle_group_pt, file_data, size_bytes });
      return { rows: [] };
    }
    if (sql.includes('SELECT file_data FROM gif_library_uploads')) return { rows: uploads.has(params[0]) ? [uploads.get(params[0])] : [] };
    if (sql.includes('FROM gif_library_uploads')) return { rows: [...uploads.values()] };
    return { rows: [] };
  } } });
  const { gifLibraryRouter } = await import('./gifLibrary.js');
  const app = express(); app.use('/gifs', gifLibraryRouter); app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/gifs`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); mock.restoreAll(); });
function send({ bytes = validGif, name = 'test.gif', mime = 'image/gif', role = 'admin', omitFile = false, omitName = false } = {}) {
  const body = new FormData();
  if (!omitName) body.set('name', 'Animação exclusiva enviada');
  body.set('gender', 'FEMININO'); body.set('environment', 'ACADEMIA'); body.set('muscleGroup', 'Quadril');
  if (!omitFile) body.set('gif', new Blob([bytes], { type: mime }), name);
  return fetch(`${baseUrl}/upload`, { method: 'POST', headers: role ? { 'x-test-role': role } : {}, body });
}
test('admin upload persists bytes and joins searchable/filterable library and file delivery', async () => {
  const response = await send(); assert.equal(response.status, 201);
  const { id } = await response.json(); assert.deepEqual(uploads.get(id).file_data, validGif);
  const headers = { 'x-test-role': 'personal' };
  const result = await (await fetch(`${baseUrl}?search=exclusiva&muscleGroups=Quadril&genders=FEMININO`, { headers })).json();
  assert.ok(result.items.some(item => item.id === id && item.name === 'Animação exclusiva enviada'));
  const filters = await (await fetch(`${baseUrl}/filters?genders=FEMININO&environments=ACADEMIA`, { headers })).json();
  assert.ok(filters.muscleGroups.includes('Quadril'));
  const file = await fetch(`${baseUrl}/file/${id}`, { headers }); assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/gif'); assert.deepEqual(Buffer.from(await file.arrayBuffer()), validGif);
});
test('upload requires admin role before accepting files', async () => {
  const count = uploads.size;
  for (const role of ['student', 'personal', null]) assert.equal((await send({ role })).status, role ? 403 : 401);
  assert.equal(uploads.size, count);
});
test('10 MB boundary is accepted and larger files are rejected without storing data', async () => {
  const bytes = Buffer.alloc(10 * 1024 * 1024); validGif.copy(bytes); bytes[bytes.length - 1] = 0x3b;
  assert.equal((await send({ bytes })).status, 201);
  const count = uploads.size;
  const response = await send({ bytes: Buffer.alloc(10 * 1024 * 1024 + 1) });
  assert.equal(response.status, 400); assert.match((await response.json()).error.message, /10 MB/);
  assert.equal(uploads.size, count);
});
test('invalid formats, forged GIF content and missing fields are rejected', async () => {
  const count = uploads.size;
  for (const options of [{ name: 'test.png', mime: 'image/png' }, { bytes: Buffer.from('not a gif') }, { omitFile: true }, { omitName: true }]) {
    assert.equal((await send(options)).status, 400);
  }
  assert.equal(uploads.size, count);
});

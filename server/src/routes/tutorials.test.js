import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { extractYoutubeVideoId } from '../utils/youtube.js';

const tutorialId = '11111111-1111-4111-8111-111111111111';
const queries = [];
const roles = new Map(['admin', 'personal', 'student'].map((role) => [hashToken(`test-${role}`), role]));
let tutorialExists = true;
let server;
let baseUrl;

async function query(sql, params = []) {
  queries.push({ sql, params });
  if (sql.includes('FROM sessions s')) {
    const role = roles.get(params[0]);
    return { rowCount: role ? 1 : 0, rows: role ? [{ id: `${role}-id`, role, name: 'Test' }] : [] };
  }
  if (sql.startsWith('SELECT') && sql.includes('FROM tutorials')) {
    return { rowCount: 1, rows: [{ id: tutorialId, title: 'Como criar treinos', description: null, youtubeVideoId: 'dQw4w9WgXcQ' }] };
  }
  if (sql.includes('INSERT INTO tutorials')) {
    return { rowCount: 1, rows: [{ id: tutorialId, title: params[0], description: params[1], youtubeVideoId: params[2] }] };
  }
  if (sql.includes('UPDATE tutorials')) {
    const rows = tutorialExists ? [{ id: params[0], title: params[1], description: params[2], youtubeVideoId: params[3] }] : [];
    return { rowCount: rows.length, rows };
  }
  if (sql.includes('DELETE FROM tutorials')) {
    return { rowCount: tutorialExists ? 1 : 0, rows: [] };
  }
  return { rowCount: 0, rows: [] };
}

before(async () => {
  mock.module('../db/pool.js', { namedExports: { query, withTransaction: async (callback) => callback({ query }) } });
  const { tutorialsRouter } = await import('./tutorials.js');
  const app = express();
  app.use(express.json());
  app.use('/tutorials', tutorialsRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

function request(path, role, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}) };
  if (role) headers.Authorization = `Bearer test-${role}`;
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

const validBody = JSON.stringify({ title: 'Como criar treinos', description: 'Passo a passo', youtube: 'https://youtu.be/dQw4w9WgXcQ' });

test('YouTube links, embeds and iframe snippets resolve to a safe video ID', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(extractYoutubeVideoId(`https://www.youtube.com/watch?v=${id}&t=10s`), id);
  assert.equal(extractYoutubeVideoId(`https://youtu.be/${id}?si=abc`), id);
  assert.equal(extractYoutubeVideoId(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(extractYoutubeVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(extractYoutubeVideoId(`www.youtube.com/watch?v=${id}`), id);
  assert.equal(extractYoutubeVideoId(id), id);
  assert.equal(extractYoutubeVideoId(`<iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/${id}?si=x&amp;start=5" title="YouTube video player" allowfullscreen></iframe>`), id);
  assert.equal(extractYoutubeVideoId(`https://evil.example/watch?v=${id}`), null);
  assert.equal(extractYoutubeVideoId(`<iframe src="https://evil.example/embed/${id}"></iframe>`), null);
  assert.equal(extractYoutubeVideoId('<script>alert(1)</script>'), null);
  assert.equal(extractYoutubeVideoId('javascript:alert(1)'), null);
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/watch?v=short'), null);
  assert.equal(extractYoutubeVideoId(''), null);
});

test('admins and personals can list tutorials; students and anonymous users cannot', async () => {
  assert.equal((await request('/tutorials', 'admin')).status, 200);
  const personal = await request('/tutorials', 'personal');
  assert.equal(personal.status, 200);
  assert.equal((await personal.json()).tutorials[0].youtubeVideoId, 'dQw4w9WgXcQ');
  assert.equal((await request('/tutorials', 'student')).status, 403);
  assert.equal((await request('/tutorials')).status, 401);
});

test('only admins can create tutorials and only the video ID is stored', async () => {
  queries.length = 0;
  const created = await request('/tutorials', 'admin', { method: 'POST', body: validBody });
  assert.equal(created.status, 201);
  const insert = queries.find(({ sql }) => sql.includes('INSERT INTO tutorials'));
  assert.deepEqual(insert.params, ['Como criar treinos', 'Passo a passo', 'dQw4w9WgXcQ', 'admin-id']);

  queries.length = 0;
  for (const role of ['personal', 'student']) {
    assert.equal((await request('/tutorials', role, { method: 'POST', body: validBody })).status, 403);
  }
  assert.ok(!queries.some(({ sql }) => sql.includes('INSERT INTO tutorials')));
});

test('invalid tutorial data is rejected before writing', async () => {
  queries.length = 0;
  const invalid = [
    { title: 'A', youtube: 'https://youtu.be/dQw4w9WgXcQ' },
    { title: 'Tutorial', youtube: '' },
    { title: 'Tutorial', youtube: 'https://vimeo.com/123' },
    { title: 'Tutorial', youtube: '<script>alert(1)</script>' }
  ];
  for (const body of invalid) {
    assert.equal((await request('/tutorials', 'admin', { method: 'POST', body: JSON.stringify(body) })).status, 400);
  }
  assert.ok(!queries.some(({ sql }) => sql.includes('INSERT INTO tutorials')));
});

test('only admins can edit or delete tutorials, with clear not found and invalid ID errors', async () => {
  assert.equal((await request(`/tutorials/${tutorialId}`, 'admin', { method: 'PUT', body: validBody })).status, 200);
  assert.equal((await request(`/tutorials/${tutorialId}`, 'personal', { method: 'PUT', body: validBody })).status, 403);
  assert.equal((await request(`/tutorials/${tutorialId}`, 'personal', { method: 'DELETE' })).status, 403);
  assert.equal((await request('/tutorials/not-a-uuid', 'admin', { method: 'DELETE' })).status, 400);
  assert.equal((await request(`/tutorials/${tutorialId}`, 'admin', { method: 'DELETE' })).status, 204);

  tutorialExists = false;
  try {
    assert.equal((await request(`/tutorials/${tutorialId}`, 'admin', { method: 'PUT', body: validBody })).status, 404);
    assert.equal((await request(`/tutorials/${tutorialId}`, 'admin', { method: 'DELETE' })).status, 404);
  } finally {
    tutorialExists = true;
  }
});

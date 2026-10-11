import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';

const studentId = '11111111-1111-4111-8111-111111111111';
const trainerId = '22222222-2222-4222-8222-222222222222';
let calls;
let whatsapp;
let linked;
let server;
let baseUrl;

async function query(sql, params = []) {
  calls.push({ sql, params });
  if (sql.includes('FROM sessions s')) {
    const role = ['student', 'personal', 'admin'].find((value) => hashToken(value) === params[0]);
    return { rowCount: role ? 1 : 0, rows: role ? [{
      id: role === 'student' ? studentId : trainerId, role, name: 'Teste', whatsapp
    }] : [] };
  }
  if (sql.includes('FROM trainer_students ts') && sql.includes('"profilePhotoPath"')) {
    return { rowCount: linked ? 1 : 0, rows: linked ? [{
      id: trainerId, name: 'Personal teste', profilePhotoPath: 'profiles/photo', whatsapp, relationshipType: 'primary'
    }] : [] };
  }
  if (sql.includes('UPDATE personal_profiles')) {
    if (params[2]) whatsapp = params[3];
  }
  if (sql.includes('SELECT u.*, pp.specialty')) return { rowCount: 1, rows: [{
    id: trainerId, name: 'Personal teste', role: 'personal', whatsapp
  }] };
  return { rowCount: 0, rows: [] };
}

before(async () => {
  mock.module('../db/pool.js', {
    namedExports: {
      query,
      withTransaction: async (callback) => callback({ query })
    }
  });
  const { studentsRouter } = await import('./students.js');
  const { profileRouter } = await import('./profile.js');
  const app = express();
  app.use(express.json());
  app.use('/students', studentsRouter);
  app.use('/profile', profileRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  calls = [];
  whatsapp = '5511999999999';
  linked = true;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

function request(path, role = 'student', body) {
  return fetch(`${baseUrl}${path}`, {
    method: body ? 'PATCH' : 'GET',
    headers: { Authorization: `Bearer ${role}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

test('student sees linked trainer contact using authenticated identity, not query input', async () => {
  const response = await request(`/students/me/trainers?studentId=${trainerId}`);
  assert.equal(response.status, 200);
  const { trainers } = await response.json();
  assert.equal(trainers[0].whatsapp, whatsapp);
  assert.equal(trainers[0].profilePhotoPath, 'profiles/photo');
  assert.ok(!('email' in trainers[0]));
  const select = calls.find(({ sql }) => sql.includes('"profilePhotoPath"'));
  assert.deepEqual(select.params, [studentId]);
  assert.match(select.sql, /relationship_type = 'primary'/);
});

test('no trainer or removed link returns empty section data', async () => {
  linked = false;
  assert.deepEqual((await (await request('/students/me/trainers')).json()).trainers, []);
});

test('trainer contact endpoint rejects other roles and unauthenticated callers', async () => {
  assert.equal((await request('/students/me/trainers', 'personal')).status, 403);
  assert.equal((await request('/students/me/trainers', 'admin')).status, 403);
  assert.equal((await fetch(`${baseUrl}/students/me/trainers`)).status, 401);
});

test('personal can save a formatted number and get normalized contact back', async () => {
  const response = await request('/profile/me', 'personal', { whatsapp: '+55 (11) 99999-9999' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.whatsapp, '5511999999999');
  const update = calls.find(({ sql }) => sql.includes('UPDATE personal_profiles'));
  assert.equal(update.params[0], trainerId);
  assert.equal(update.params[2], true);
});

test('empty number clears contact, omitted number preserves it', async () => {
  await request('/profile/me', 'personal', { name: 'Personal teste' });
  assert.equal(whatsapp, '5511999999999');
  const response = await request('/profile/me', 'personal', { whatsapp: '' });
  assert.equal((await response.json()).user.whatsapp, null);
});

test('invalid numbers fail explicitly before profile updates', async () => {
  for (const value of ['abc', '123', '+5511999999999999999', '0000000000']) {
    assert.equal((await request('/profile/me', 'personal', { whatsapp: value })).status, 400);
  }
  assert.ok(!calls.some(({ sql }) => sql.includes('UPDATE')));
});

test('student cannot update any trainer contact through their profile', async () => {
  const response = await request('/profile/me', 'student', { whatsapp: '5511888888888' });
  assert.equal(response.status, 200);
  assert.ok(!calls.some(({ sql }) => sql.includes('UPDATE personal_profiles')));
});

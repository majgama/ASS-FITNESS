import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';

const studentId = '11111111-1111-4111-8111-111111111111';
const trainerId = '22222222-2222-4222-8222-222222222222';
let calls;
let whatsapp;
let cpfLastFour;
let claims;
let linked;
let server;
let baseUrl;

async function query(sql, params = []) {
  calls.push({ sql, params });
  if (sql.includes('FROM sessions s')) {
    const role = ['student', 'personal', 'admin'].find((value) => hashToken(value) === params[0]);
    return { rowCount: role ? 1 : 0, rows: role ? [{
      id: role === 'student' ? studentId : trainerId, role, name: 'Teste', whatsapp, cpf_last_four: cpfLastFour
    }] : [] };
  }
  if (sql.includes('FROM trainer_students ts') && sql.includes('"profilePhotoPath"')) {
    return { rowCount: linked ? 1 : 0, rows: linked ? [{
      id: trainerId, name: 'Personal teste', profilePhotoPath: 'profiles/photo', whatsapp, relationshipType: 'primary'
    }] : [] };
  }
  if (sql.includes('UPDATE personal_profiles')) {
    if (sql.includes('cpf_last_four')) { whatsapp = params[2]; cpfLastFour = params[1]; }
  }
  if (sql.includes('SELECT cpf_last_four, whatsapp FROM personal_profiles')) return { rowCount: 1, rows: [{ cpf_last_four: cpfLastFour, whatsapp }] };
  if (sql.includes('FROM anti_abuse_key')) return { rowCount: 1, rows: [{ fingerprint: hashToken(params[0]) }] };
  if (sql.includes('INSERT INTO personal_identity_claims')) {
    claims.set(`${params[0]}:${params[1]}`, params[2]);
    return { rowCount: 1, rows: [{ fingerprint: params[1] }] };
  }
  if (sql.includes('SELECT 1 FROM personal_identity_claims')) {
    const found = claims.get(`cpf:${params[0]}`) === params[1];
    return { rowCount: found ? 1 : 0, rows: found ? [{}] : [] };
  }
  if (sql.includes('regexp_replace(whatsapp') && params[1] === '5511222222222') return { rowCount: 1, rows: [{}] };
  if (sql.includes('SELECT u.*, pp.specialty')) return { rowCount: 1, rows: [{
    id: trainerId, name: 'Personal teste', role: 'personal', whatsapp, cpf_last_four: cpfLastFour, invite_code: 'PT-test'
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
  cpfLastFour = null;
  claims = new Map();
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
  const update = calls.find(({ sql }) => sql.includes('UPDATE personal_profiles SET cpf_last_four'));
  assert.equal(update.params[0], trainerId);
  assert.equal(update.params[2], '5511999999999');
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

test('existing personal completes identity through profile without changing student links', async () => {
  const response = await request('/profile/me', 'personal', { cpf: '529.982.247-25', whatsapp: '+55 (11) 99999-9999' });
  assert.equal(response.status, 200);
  const { user } = await response.json();
  assert.equal(user.canShareInvite, true);
  assert.equal(user.cpfLastFour, '4725');
  assert.equal(user.inviteCode, 'PT-test');
  assert.ok(!('cpf' in user));
  assert.ok(!calls.some(({ sql }) => sql.includes('UPDATE trainer_students') || sql.includes('DELETE FROM trainer_students')));
  assert.equal((await request('/profile/me', 'personal', { cpf: '11144477735', whatsapp })).status, 400);
});

test('CPF invalidity and duplicate WhatsApp surface actionable errors', async () => {
  assert.equal((await request('/profile/me', 'personal', { cpf: '11111111111', whatsapp })).status, 400);
  const response = await request('/profile/me', 'personal', { whatsapp: '+55 11 22222-2222' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'IDENTITY_ALREADY_USED');
});

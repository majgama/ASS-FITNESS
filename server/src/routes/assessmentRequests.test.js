import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';

const studentId = '11111111-1111-4111-8111-111111111111';
const trainerId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const assessmentId = '44444444-4444-4444-8444-444444444444';
const adminId = '66666666-6666-4666-8666-666666666666';
const users = new Map([
  [hashToken('student'), { id: studentId, role: 'student' }],
  [hashToken('personal'), { id: trainerId, role: 'personal' }],
  [hashToken('admin'), { id: adminId, role: 'admin' }],
  [hashToken('another-student'), { id: '55555555-5555-4555-8555-555555555555', role: 'student' }]
]);
let linked;
let pending;
let failPhotos;
let orphaned;
let requesterId;
let requesterRole;
let calls;
let server;
let baseUrl;

async function query(sql, params = []) {
  calls.push({ sql, params });
  if (sql.includes('FROM sessions s')) {
    const user = users.get(params[0]);
    return { rowCount: user ? 1 : 0, rows: user ? [user] : [] };
  }
  if (sql.startsWith('SELECT 1 FROM trainer_students WHERE')) return { rowCount: linked ? 1 : 0, rows: [] };
  if (sql.includes("FROM users WHERE id = $1 AND role = 'student'")) return { rowCount: 1, rows: [{ id: studentId }] };
  if (sql.includes('DELETE FROM assessment_requests') && orphaned) {
    pending = false;
    orphaned = false;
  }
  if (sql.includes('INSERT INTO assessment_requests')) {
    if (!pending) {
      requesterId = params[1];
      requesterRole = requesterId === adminId ? 'admin' : 'personal';
      pending = true;
    }
    return { rowCount: 1, rows: [{ id: requestId, requested_by: requesterId }] };
  }
  if (sql.includes('FOR UPDATE OF ar')) {
    const allowed = pending && params[1] === studentId;
    return { rowCount: allowed ? 1 : 0, rows: allowed ? [{ id: requestId, requested_by: requesterId, requester_role: requesterRole }] : [] };
  }
  if (sql.includes('SELECT ar.id, ar.created_at')) {
    const visible = pending && (requesterRole === 'admin' || linked) && !orphaned;
    return { rowCount: visible ? 1 : 0, rows: visible ? [{ id: requestId, requested_by_name: 'Personal' }] : [] };
  }
  if (sql.includes('INSERT INTO assessments')) return { rowCount: 1, rows: [{ id: assessmentId, student_id: params[0] }] };
  if (sql.includes('INSERT INTO assessment_photos') && failPhotos) throw new Error('Photo database failure');
  if (sql.includes('UPDATE assessment_requests')) pending = false;
  return { rowCount: 0, rows: [] };
}

before(async () => {
  mock.module('../db/pool.js', {
    namedExports: {
      query,
      withTransaction: async (callback) => {
        await query('BEGIN');
        try {
          const result = await callback({ query });
          await query('COMMIT');
          return result;
        } catch (error) {
          await query('ROLLBACK');
          throw error;
        }
      }
    }
  });
  const { assessmentsRouter } = await import('./assessments.js');
  const app = express();
  app.use(express.json());
  app.use('/assessments', assessmentsRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/assessments`;
});

beforeEach(() => {
  linked = true;
  pending = true;
  failPhotos = false;
  orphaned = false;
  requesterId = trainerId;
  requesterRole = 'personal';
  calls = [];
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

function request(path, role, body = {}, method = 'POST') {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${role}`, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    ...(method === 'GET' ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) })
  });
}

test('only linked trainer can release an assessment, using one pending request per student', async () => {
  assert.equal((await request(`/students/${studentId}/requests`, 'student')).status, 403);
  linked = false;
  assert.equal((await request(`/students/${studentId}/requests`, 'personal')).status, 403);
  linked = true;
  assert.equal((await request(`/students/${studentId}/requests`, 'personal')).status, 201);
  const repeated = await request(`/students/${studentId}/requests`, 'admin');
  assert.equal(repeated.status, 201);
  assert.equal((await repeated.json()).request.requested_by, trainerId);
  assert.match(calls.find(({ sql }) => sql.includes('INSERT INTO assessment_requests')).sql, /ON CONFLICT/);
});

test('student submits measurements under their own identity and preserves requesting trainer', async () => {
  const response = await request(`/requests/${requestId}/submit`, 'student', { studentId: trainerId, weightKg: 70, waistCm: 80 });
  assert.equal(response.status, 201);
  const inserted = calls.find(({ sql }) => sql.includes('INSERT INTO assessments'));
  assert.equal(inserted.params[0], studentId);
  assert.equal(inserted.params[1], trainerId);
  assert.equal(inserted.params[3], 70);
  assert.ok(calls.some(({ sql }) => sql.includes('UPDATE assessment_requests')));
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  assert.equal((await request(`/requests/${requestId}/submit`, 'student')).status, 404);
  const listed = await request(`/students/${studentId}/requests`, 'student', {}, 'GET');
  assert.deepEqual((await listed.json()).requests, []);
});

test('unrelated students, completed requests and removed trainer links cannot submit', async () => {
  assert.equal((await request(`/requests/${requestId}/submit`, 'another-student')).status, 404);
  pending = false;
  assert.equal((await request(`/requests/${requestId}/submit`, 'student')).status, 404);
  pending = true;
  linked = false;
  assert.equal((await request(`/requests/${requestId}/submit`, 'student')).status, 403);
  assert.ok(!calls.some(({ sql }) => sql.includes('INSERT INTO assessments')));
});

test('photo failures roll back assessment and do not complete request', async () => {
  failPhotos = true;
  const form = new FormData();
  form.set('weightKg', '70');
  form.set('front', new Blob(['image'], { type: 'image/png' }), 'front.png');
  assert.equal((await request(`/requests/${requestId}/submit`, 'student', form)).status, 500);
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.ok(!calls.some(({ sql }) => sql.includes('UPDATE assessment_requests')));
});

test('students cannot read another students pending requests or create unsolicited assessments', async () => {
  assert.equal((await request(`/students/${trainerId}/requests`, 'student', {}, 'GET')).status, 403);
  assert.equal((await request('/', 'student', { studentId })).status, 403);
});

test('student sees pending request, but no longer sees a removed trainers request', async () => {
  const visible = await request(`/students/${studentId}/requests`, 'student', {}, 'GET');
  assert.equal((await visible.json()).requests[0].id, requestId);
  linked = false;
  const hidden = await request(`/students/${studentId}/requests`, 'student', {}, 'GET');
  assert.deepEqual((await hidden.json()).requests, []);
});

test('new release replaces an orphaned pending request', async () => {
  orphaned = true;
  requesterId = '77777777-7777-4777-8777-777777777777';
  const response = await request(`/students/${studentId}/requests`, 'personal');
  assert.equal(response.status, 201);
  assert.equal((await response.json()).request.requested_by, trainerId);
  const cleanup = calls.findIndex(({ sql }) => sql.includes('DELETE FROM assessment_requests'));
  const insert = calls.findIndex(({ sql }) => sql.includes('INSERT INTO assessment_requests'));
  assert.ok(cleanup > -1 && cleanup < insert);
});

test('admin release can be answered without a trainer link', async () => {
  pending = false;
  linked = false;
  assert.equal((await request(`/students/${studentId}/requests`, 'admin')).status, 201);
  assert.equal((await request(`/requests/${requestId}/submit`, 'student')).status, 201);
  assert.equal(calls.find(({ sql }) => sql.includes('INSERT INTO assessments')).params[1], null);
});

test('invalid identifiers return standard validation errors before database changes', async () => {
  assert.equal((await request('/students/invalid/requests', 'personal')).status, 400);
  assert.equal((await request('/students/invalid/requests', 'student', {}, 'GET')).status, 400);
  assert.equal((await request('/requests/invalid/submit', 'student')).status, 400);
  assert.ok(!calls.some(({ sql }) => sql === 'BEGIN'));
});

test('trainer can still register assessments directly with photos', async () => {
  const form = new FormData();
  form.set('studentId', studentId);
  form.set('weightKg', '72');
  form.set('front', new Blob(['image'], { type: 'image/png' }), 'front.png');
  assert.equal((await request('/', 'personal', form)).status, 201);
  const assessment = calls.find(({ sql }) => sql.includes('INSERT INTO assessments'));
  const photo = calls.find(({ sql }) => sql.includes('INSERT INTO assessment_photos'));
  assert.equal(assessment.params[0], studentId);
  assert.equal(assessment.params[1], trainerId);
  assert.equal(photo.params[0], assessmentId);
  assert.equal(photo.params[1], 'front');
  assert.equal(photo.params[3], 'image/png');
  assert.ok(!calls.some(({ sql }) => sql.includes('UPDATE assessment_requests')));
});

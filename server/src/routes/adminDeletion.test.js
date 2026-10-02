import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';

const studentId = '11111111-1111-4111-8111-111111111111';
const personalId = '22222222-2222-4222-8222-222222222222';
const modelId = '33333333-3333-4333-8333-333333333333';
const queries = [];
const roles = new Map(['admin', 'personal', 'student'].map((role) => [hashToken(`test-${role}`), role]));
let failDelete = false;
let modelVisibility = 'public';
let modelOwner = studentId;
let server;
let baseUrl;

async function query(sql, params = []) {
  queries.push({ sql, params });
  if (sql.includes('FROM sessions s')) {
    const role = roles.get(params[0]);
    return { rowCount: role ? 1 : 0, rows: role ? [{ id: personalId, role, name: 'Test' }] : [] };
  }
  if (sql.includes('SELECT id FROM users WHERE id = $1 AND role = $2')) {
    const role = params[0] === studentId ? 'student' : params[0] === personalId ? 'personal' : 'admin';
    const found = role === params[1];
    return { rowCount: found ? 1 : 0, rows: found ? [{ id: params[0] }] : [] };
  }
  if (sql.startsWith('DELETE FROM users') && failDelete) throw new Error('Database failure');
  if (sql.includes('SELECT * FROM exercises') || sql.includes('FROM daily_workouts dw') || sql.includes('SELECT * FROM weekly_plans')) {
    return { rowCount: 1, rows: [{ id: modelId, visibility: modelVisibility, owner_id: modelVisibility === 'private' ? modelOwner : null, exercises: [] }] };
  }
  if (sql.includes('FROM weekly_plan_days')) return { rowCount: 0, rows: [] };
  return { rowCount: 1, rows: [{ id: params[0] }] };
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
  const [{ adminRouter }, { studentsRouter }, { exercisesRouter }, { workoutsRouter }] = await Promise.all([
    import('./admin.js'), import('./students.js'), import('./exercises.js'), import('./workouts.js')
  ]);
  const app = express();
  app.use('/admin', adminRouter);
  app.use('/students', studentsRouter);
  app.use('/exercises', exercisesRouter);
  app.use('/workouts', workoutsRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

function remove(path, role) {
  return fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: role ? { Authorization: `Bearer test-${role}` } : {}
  });
}

test('only admin can delete student or personal accounts', async () => {
  for (const path of [`/students/${studentId}`, `/admin/personals/${personalId}`]) {
    for (const role of [undefined, 'student', 'personal']) {
      queries.length = 0;
      const response = await remove(path, role);
      assert.equal(response.status, role ? 403 : 401);
      assert.ok(!queries.some(({ sql }) => sql.startsWith('DELETE')));
    }
  }
});

test('admin deletes the requested account in a transaction, without deleting linked students', async () => {
  for (const [path, id, role] of [
    [`/students/${studentId}`, studentId, 'student'],
    [`/admin/personals/${personalId}`, personalId, 'personal']
  ]) {
    queries.length = 0;
    const response = await remove(path, 'admin');
    assert.equal(response.status, 204);
    const deletes = queries.filter(({ sql }) => sql.startsWith('DELETE'));
    assert.equal(deletes.length, 2);
    assert.match(deletes[0].sql, /e.owner_id = \$1/);
    assert.deepEqual(deletes[0].params, [id]);
    assert.deepEqual(deletes[1].params, [id, role]);
    assert.match(deletes[1].sql, /id = \$1 AND role = \$2/);
    assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
  }
});

test('wrong account role and malformed IDs are rejected without deletion', async () => {
  for (const [path, status] of [
    [`/students/${personalId}`, 404],
    [`/admin/personals/${studentId}`, 404],
    [`/students/${modelId}`, 404],
    ['/admin/personals/not-a-uuid', 400]
  ]) {
    queries.length = 0;
    assert.equal((await remove(path, 'admin')).status, status);
    assert.ok(!queries.some(({ sql }) => sql.startsWith('DELETE')));
  }
});

test('account deletion rolls back on database failure', async () => {
  failDelete = true;
  const log = mock.method(console, 'error', () => {});
  try {
    queries.length = 0;
    assert.equal((await remove(`/admin/personals/${personalId}`, 'admin')).status, 500);
    assert.ok(queries.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(!queries.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(log.mock.callCount(), 1);
  } finally {
    failDelete = false;
    log.mock.restore();
  }
});

test('admin can delete public and other owners private exercises, daily workouts and weekly plans', async () => {
  try {
    for (const visibility of ['public', 'private']) {
      modelVisibility = visibility;
      for (const path of [`/exercises/${modelId}`, `/workouts/daily/${modelId}`, `/workouts/weekly/${modelId}`]) {
        assert.equal((await remove(path, 'admin')).status, 204);
        assert.equal((await remove(path, 'personal')).status, 403);
        assert.equal((await remove(path, 'student')).status, 403);
      }
    }
  } finally {
    modelVisibility = 'public';
  }
});

test('personal retains permission to delete their own private workout models', async () => {
  modelVisibility = 'private';
  modelOwner = personalId;
  try {
    for (const path of [`/exercises/${modelId}`, `/workouts/daily/${modelId}`, `/workouts/weekly/${modelId}`]) {
      assert.equal((await remove(path, 'personal')).status, 204);
    }
  } finally {
    modelVisibility = 'public';
    modelOwner = studentId;
  }
});

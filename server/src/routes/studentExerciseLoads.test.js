import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';

const studentId = '11111111-1111-4111-8111-111111111111';
const secondStudentId = '33333333-3333-4333-8333-333333333333';
const exerciseId = '22222222-2222-4222-8222-222222222222';
let calls;
let loads;
let included;
let failSave;
let server;
let baseUrl;
const snapshot = { days: [1, 3].map((dayOfWeek) => ({
  dayOfWeek, dailyWorkout: { exercises: [{ id: `relation-${dayOfWeek}`, exerciseId }] }
})) };

async function query(sql, params = []) {
  calls.push({ sql, params });
  if (sql.includes('FROM sessions s')) {
    const token = ['student', 'second-student', 'personal', 'admin'].find((value) => params[0] === hashToken(value));
    const role = token === 'second-student' ? 'student' : token;
    return { rowCount: role ? 1 : 0, rows: role ? [{ id: token === 'second-student' ? secondStudentId : studentId, role }] : [] };
  }
  if (sql.includes('FROM student_weekly_plans')) return {
    rowCount: included ? 1 : 0, rows: included ? [{ id: 'plan', plan_snapshot: snapshot }] : []
  };
  if (sql.includes('INSERT INTO student_exercise_loads')) {
    if (failSave) throw new Error('Load database failure');
    const row = { exerciseId: params[1], load: params[2] };
    loads.set(params[0], [row]);
    return { rowCount: 1, rows: [row] };
  }
  if (sql.includes('FROM student_exercise_loads')) {
    const rows = loads.get(params[0]) || [];
    return { rowCount: rows.length, rows };
  }
  return { rowCount: 0, rows: [] };
}

before(async () => {
  mock.module('../db/pool.js', { namedExports: {
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
  } });
  const { workoutsRouter } = await import('./workouts.js');
  const app = express();
  app.use(express.json());
  app.use('/workouts', workoutsRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/workouts`;
});
beforeEach(() => { calls = []; loads = new Map(); included = true; failSave = false; });
after(async () => { await new Promise((resolve) => server.close(resolve)); mock.restoreAll(); });

function save(load, role = 'student', id = exerciseId) {
  return fetch(`${baseUrl}/student/exercises/${id}/load`, {
    method: 'PUT', headers: { Authorization: `Bearer ${role}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ load, studentId: 'another-student' })
  });
}

test('student saves one personal load for exercise appearing on multiple days and retrieves it', async () => {
  assert.equal((await save(' 20 kg ')).status, 200);
  assert.equal((await save('25 kg')).status, 200);
  const result = await fetch(`${baseUrl}/student/current`, { headers: { Authorization: 'Bearer student' } });
  const data = await result.json();
  assert.deepEqual(data.exerciseLoads, [{ exerciseId, load: '25 kg' }]);
  assert.deepEqual(data.currentPlan.plan_snapshot, snapshot);
  const writes = calls.filter(({ sql }) => sql.includes('INSERT INTO student_exercise_loads'));
  assert.ok(writes.every(({ params }) => params[0] === studentId));
  assert.match(writes[0].sql, /ON CONFLICT \(student_id, exercise_id\)/);
  assert.ok(!calls.some(({ sql }) => sql.includes('UPDATE student_weekly_plans')));
});

test('only students may save their exercise load', async () => {
  assert.equal((await save('20 kg', 'personal')).status, 403);
  assert.equal((await save('20 kg', 'admin')).status, 403);
  assert.equal((await save('20 kg', 'invalid')).status, 401);
});

test('loads are isolated between students sharing the same exercise', async () => {
  assert.equal((await save('20 kg')).status, 200);
  assert.equal((await save('8 kg', 'second-student')).status, 200);
  for (const [token, load] of [['student', '20 kg'], ['second-student', '8 kg']]) {
    const response = await fetch(`${baseUrl}/student/current`, { headers: { Authorization: `Bearer ${token}` } });
    assert.deepEqual((await response.json()).exerciseLoads, [{ exerciseId, load }]);
  }
});

test('exercise must appear in own latest active snapshot', async () => {
  assert.equal((await save('20 kg', 'student', studentId)).status, 404);
  included = false;
  assert.equal((await save('20 kg')).status, 404);
  assert.ok(!calls.some(({ sql }) => sql.includes('INSERT INTO student_exercise_loads')));
});

test('invalid and empty loads are rejected', async () => {
  for (const value of ['', '   ', 'x'.repeat(101), null]) assert.equal((await save(value)).status, 400);
  assert.equal((await save('20 kg', 'student', 'invalid')).status, 400);
  assert.ok(!calls.some(({ sql }) => sql === 'BEGIN'));
});

test('database failure rolls back and surfaces an error', async () => {
  failSave = true;
  assert.equal((await save('20 kg')).status, 500);
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(loads.size, 0);
});

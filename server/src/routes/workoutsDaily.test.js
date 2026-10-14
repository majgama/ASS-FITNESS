import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';

const workoutId = '11111111-1111-4111-8111-111111111111';
const exerciseId = '22222222-2222-4222-8222-222222222222';
const relationId = '33333333-3333-4333-8333-333333333333';
const personalId = '44444444-4444-4444-8444-444444444444';
const queries = [];
const roles = new Map(['admin', 'personal', 'student'].map((role) => [hashToken(`test-${role}`), role]));
let visibility = 'private';
let ownerId = personalId;
let workoutExists = true;
let relationExists = true;
let exerciseVisibility = 'public';
let exerciseOwnerId = null;
let server;
let baseUrl;

async function query(sql, params = []) {
  queries.push({ sql, params });
  if (sql.includes('FROM sessions s')) {
    const role = roles.get(params[0]);
    return { rowCount: role ? 1 : 0, rows: role ? [{ id: role === 'admin' ? 'admin-id' : personalId, role, name: 'Test' }] : [] };
  }
  if (sql.includes('FROM daily_workouts dw')) {
    const rows = workoutExists ? [{
      id: workoutId,
      name: 'Treino de teste',
      visibility,
      owner_id: ownerId,
      exercises: [{
        id: relationId,
        exerciseId,
        exerciseName: 'Agachamento',
        position: 1,
        sets: '4',
        repetitions: '10',
        load: null,
        restSeconds: 60,
        notes: null,
        gifPath: 'agachamento.gif',
        gifLibraryPath: 'library-gif-id'
      }]
    }] : [];
    return { rowCount: rows.length, rows };
  }
  if (sql.includes('SELECT * FROM exercises WHERE id = $1')) {
    return { rowCount: 1, rows: [{ id: params[0], visibility: exerciseVisibility, owner_id: exerciseOwnerId }] };
  }
  if (sql.includes('INSERT INTO daily_workout_exercises')) {
    return { rowCount: 1, rows: [{ id: relationId, daily_workout_id: params[0], exercise_id: params[1] }] };
  }
  if (sql.startsWith('UPDATE daily_workouts')) {
    return { rowCount: 1, rows: [{
      id: workoutId,
      name: params[1] || 'Treino de teste',
      description: params[2] ? params[3] : null,
      visibility,
      owner_id: ownerId
    }] };
  }
  if (sql.startsWith('UPDATE daily_workout_exercises')) {
    const rows = relationExists ? [{ id: relationId, position: params[2], sets: params[4], repetitions: params[6], load: params[8], rest_seconds: params[10], notes: params[12] }] : [];
    return { rowCount: rows.length, rows };
  }
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
  const { workoutsRouter } = await import('./workouts.js');
  const app = express();
  app.use(express.json());
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

function request(path, role, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer test-${role}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
}

test('daily workouts endpoint returns linked exercises and prescription fields for cards', async () => {
  const response = await request('/workouts/daily', 'personal');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.dailyWorkouts[0].exercises, [{
    id: relationId,
    exerciseId,
    exerciseName: 'Agachamento',
    position: 1,
    sets: '4',
    repetitions: '10',
    load: null,
    restSeconds: 60,
    notes: null,
    gifPath: 'agachamento.gif',
    gifLibraryPath: 'library-gif-id'
  }]);
  const listQuery = queries.find(({ sql }) => sql.includes('FROM daily_workouts dw'));
  assert.match(listQuery.sql, /json_agg/);
  assert.match(listQuery.sql, /LEFT JOIN daily_workout_exercises/);
  assert.match(listQuery.sql, /dw\.visibility = 'public' OR dw\.owner_id = \$1/);
  assert.match(listQuery.sql, /'gifPath', e\.gif_path/);
  assert.match(listQuery.sql, /'gifLibraryPath', e\.gif_library_path/);
});

test('admin can read private workouts while other roles cannot', async () => {
  visibility = 'private';
  ownerId = 'another-personal';
  try {
    assert.equal((await request('/workouts/daily', 'admin')).status, 200);
    assert.equal((await request('/workouts/daily', 'personal')).status, 200);
    assert.equal((await request('/workouts/daily', 'student')).status, 403);
    assert.match(queries.filter(({ sql }) => sql.includes('FROM daily_workouts dw')).at(-1).sql, /dw\.visibility = 'public' OR dw\.owner_id = \$1/);
    assert.equal(queries.filter(({ sql }) => sql.includes('FROM daily_workouts dw')).at(-2).sql.includes("WHERE true"), true);
  } finally {
    visibility = 'private';
    ownerId = personalId;
  }
});

test('workout name and description editing respects public and private ownership', async () => {
  const scenarios = [
    { role: 'admin', visibility: 'public', ownerId: null, status: 200 },
    { role: 'personal', visibility: 'public', ownerId: personalId, status: 403 },
    { role: 'personal', visibility: 'private', ownerId: personalId, status: 200 },
    { role: 'personal', visibility: 'private', ownerId: 'other-personal', status: 403 },
    { role: 'student', visibility: 'private', ownerId: personalId, status: 403 }
  ];
  try {
    for (const scenario of scenarios) {
      queries.length = 0;
      visibility = scenario.visibility;
      ownerId = scenario.ownerId;
      const response = await request(`/workouts/daily/${workoutId}`, scenario.role, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Treino atualizado', description: 'Nova descrição' })
      });
      assert.equal(response.status, scenario.status);
      const update = queries.find(({ sql }) => sql.startsWith('UPDATE daily_workouts'));
      if (scenario.status === 200) {
        assert.deepEqual(update.params, [workoutId, 'Treino atualizado', true, 'Nova descrição', null, null]);
        const body = await response.json();
        assert.equal(body.dailyWorkout.name, 'Treino atualizado');
        assert.equal(body.dailyWorkout.description, 'Nova descrição');
      } else {
        assert.equal(update, undefined);
      }
    }
  } finally {
    visibility = 'private';
    ownerId = personalId;
    queries.length = 0;
  }
});

test('authorized owner can update exercise prescription in a workout', async () => {
  const response = await request(`/workouts/daily/${workoutId}/exercises/${relationId}`, 'personal', {
    method: 'PATCH',
    body: JSON.stringify({ position: 2, sets: '3', repetitions: '12', load: '20 kg', restSeconds: 90, notes: 'Controlar a descida' })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.workoutExercise.sets, '3');
  assert.equal(body.workoutExercise.repetitions, '12');
  const update = queries.find(({ sql }) => sql.startsWith('UPDATE daily_workout_exercises'));
  assert.deepEqual(update.params, [workoutId, relationId, 2, true, '3', true, '12', true, '20 kg', true, 90, true, 'Controlar a descida']);
});

test('only admins can update public workout exercise prescriptions', async () => {
  queries.length = 0;
  visibility = 'public';
  ownerId = null;
  try {
    const response = await request(`/workouts/daily/${workoutId}/exercises/${relationId}`, 'personal', {
      method: 'PATCH',
      body: JSON.stringify({ sets: '3' })
    });
    assert.equal(response.status, 403);
    assert.ok(queries.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(!queries.some(({ sql }) => sql.startsWith('UPDATE daily_workout_exercises')));
  } finally {
    visibility = 'private';
    ownerId = personalId;
  }
});

test('missing workout and exercise relation return clear errors and scope updates to both IDs', async () => {
  queries.length = 0;
  workoutExists = false;
  try {
    const missingWorkout = await request(`/workouts/daily/${workoutId}/exercises/${relationId}`, 'admin', {
      method: 'PATCH',
      body: JSON.stringify({ sets: '3' })
    });
    assert.equal(missingWorkout.status, 404);
  } finally {
    workoutExists = true;
  }

  relationExists = false;
  try {
    const missingRelation = await request(`/workouts/daily/${workoutId}/exercises/${relationId}`, 'personal', {
      method: 'PATCH',
      body: JSON.stringify({ sets: '3' })
    });
    assert.equal(missingRelation.status, 404);
    const relationUpdate = queries.find(({ sql }) => sql.startsWith('UPDATE daily_workout_exercises'));
    assert.ok(relationUpdate);
    assert.match(relationUpdate.sql, /WHERE daily_workout_id = \$1 AND id = \$2/);
    assert.deepEqual(relationUpdate.params.slice(0, 2), [workoutId, relationId]);
  } finally {
    relationExists = true;
  }
});

async function addExercise(role, scenario) {
  queries.length = 0;
  visibility = scenario.workoutVisibility;
  ownerId = scenario.workoutOwnerId;
  exerciseVisibility = scenario.exerciseVisibility;
  exerciseOwnerId = scenario.exerciseOwnerId;
  try {
    const response = await request(`/workouts/daily/${workoutId}/exercises`, role, {
      method: 'POST',
      body: JSON.stringify({ exerciseId, position: 1 })
    });
    return { status: response.status, inserted: queries.some(({ sql }) => sql.includes('INSERT INTO daily_workout_exercises')) };
  } finally {
    visibility = 'private';
    ownerId = personalId;
    exerciseVisibility = 'public';
    exerciseOwnerId = null;
  }
}

test('only admins can add exercises to public workouts and only public exercises are accepted', async () => {
  const publicExercise = { workoutVisibility: 'public', workoutOwnerId: null, exerciseVisibility: 'public', exerciseOwnerId: null };
  assert.deepEqual(await addExercise('admin', publicExercise), { status: 201, inserted: true });
  assert.deepEqual(await addExercise('personal', publicExercise), { status: 403, inserted: false });
  assert.deepEqual(await addExercise('student', publicExercise), { status: 403, inserted: false });
  assert.deepEqual(await addExercise('admin', { ...publicExercise, exerciseVisibility: 'private', exerciseOwnerId: 'admin-id' }), { status: 403, inserted: false });
});

test('personals add public or own exercises only to their own workouts', async () => {
  const ownWorkout = { workoutVisibility: 'private', workoutOwnerId: personalId, exerciseVisibility: 'public', exerciseOwnerId: null };
  assert.deepEqual(await addExercise('personal', ownWorkout), { status: 201, inserted: true });
  assert.deepEqual(await addExercise('personal', { ...ownWorkout, exerciseVisibility: 'private', exerciseOwnerId: personalId }), { status: 201, inserted: true });
  assert.deepEqual(await addExercise('personal', { ...ownWorkout, workoutOwnerId: 'another-personal' }), { status: 403, inserted: false });
  assert.deepEqual(await addExercise('personal', { ...ownWorkout, exerciseVisibility: 'private', exerciseOwnerId: 'another-personal' }), { status: 403, inserted: false });
});

test('adding an exercise without authentication or with invalid IDs is rejected', async () => {
  const anonymous = await fetch(`${baseUrl}/workouts/daily/${workoutId}/exercises`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exerciseId })
  });
  assert.equal(anonymous.status, 401);
  queries.length = 0;
  const invalid = await request(`/workouts/daily/${workoutId}/exercises`, 'admin', {
    method: 'POST',
    body: JSON.stringify({ exerciseId: 'not-a-uuid' })
  });
  assert.equal(invalid.status, 400);
  assert.ok(!queries.some(({ sql }) => sql.includes('INSERT INTO daily_workout_exercises')));
});

test('invalid prescription fields are rejected before transaction', async () => {
  queries.length = 0;
  const response = await request(`/workouts/daily/${workoutId}/exercises/${relationId}`, 'personal', {
    method: 'PATCH',
    body: JSON.stringify({ restSeconds: -1 })
  });
  assert.equal(response.status, 400);
  assert.ok(!queries.some(({ sql }) => sql === 'BEGIN'));
});

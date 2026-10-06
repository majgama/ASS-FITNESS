import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import pg from 'pg';
import { errorHandler } from '../middleware/errorHandler.js';
import { hashToken } from '../utils/tokens.js';

// Explicit opt-in: integration tests use real transactions in a disposable schema.
const testDatabaseUrl = process.env.WORKOUT_IMPORT_TEST_DATABASE_URL;
const schema = `weekly_import_test_${randomUUID().replaceAll('-', '')}`;
let bootstrap;
let pool;
let server;
let baseUrl;
const userIds = new Map();
const exerciseIds = new Map();

function payload() {
  return {
    name: 'Plano importado', description: 'Plano completo com cardio.',
    days: [
      {
        dayOfWeek: 1, name: 'Treino A', description: 'Musculacao e cardio.', instructions: 'Aquecer antes.',
        exercises: [
          { exerciseName: ' SUPINO   RETO ', sets: '4', repetitions: '8-12', load: '20 kg', restSeconds: 90, notes: 'Controlar a descida.' },
          { exerciseName: 'agachamento', sets: '3', repetitions: '10', restSeconds: 0 }
        ],
        cardio: [
          { exerciseName: 'Caminhada na esteira', duration: '20 minutos', intensity: 'leve a moderada', notes: 'Sem inclinacao.' },
          { exerciseName: 'Caminhada na esteira', duration: '5 minutos', notes: 'Desaquecer.' }
        ]
      },
      { dayOfWeek: 4, name: 'Treino B', cardio: [{ exerciseName: 'BICICLETA ERGOMETRICA', duration: '15 minutos' }] },
      { dayOfWeek: 0, isRest: true, instructions: 'Descanso.' }
    ]
  };
}

async function request(path = '/weekly/import', role = 'admin', body = payload()) {
  return fetch(`${baseUrl}/workouts${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer test-${role}` } : {}) },
    body: JSON.stringify(body)
  });
}

async function counts() {
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM exercises) AS exercises,
    (SELECT count(*)::int FROM daily_workouts) AS workouts,
    (SELECT count(*)::int FROM daily_workout_exercises) AS relations,
    (SELECT count(*)::int FROM weekly_plans) AS plans,
    (SELECT count(*)::int FROM weekly_plan_days) AS days`);
  return result.rows[0];
}

describe('weekly JSON import with PostgreSQL', { skip: !testDatabaseUrl }, () => {
  before(async () => {
    const url = new URL(testDatabaseUrl);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Use an explicit local PostgreSQL test database.');
    bootstrap = new pg.Pool({ connectionString: testDatabaseUrl });
    await bootstrap.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.DATABASE_SSL = 'false';
    ({ pool } = await import('../db/pool.js'));
    await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    for (const role of ['admin', 'personal', 'student']) {
      const user = await pool.query(
        'INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, $1, $3) RETURNING id',
        [role, `${role}@test.local`, 'unused-test-hash']
      );
      userIds.set(role, user.rows[0].id);
      await pool.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [user.rows[0].id, hashToken(`test-${role}`)]);
    }
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
    if (pool) await pool.end();
    if (bootstrap) {
      try { await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
      finally { await bootstrap.end(); }
    }
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE weekly_plans, daily_workouts, exercises CASCADE');
    exerciseIds.clear();
    for (const name of ['Supino reto', 'Agachamento', 'Caminhada na esteira', 'Bicicleta ergométrica']) {
      const exercise = await pool.query(
        `INSERT INTO exercises (name, muscle_group, visibility, youtube_url, video_path, gif_path, gif_library_path, audio_path)
         VALUES ($1, 'Teste', 'public', 'https://www.youtube.com/watch?v=test', 'video.mp4', 'exercise.gif', 'library/original.gif', 'audio.mp3') RETURNING id`,
        [name]
      );
      exerciseIds.set(name, exercise.rows[0].id);
    }
    await pool.query("INSERT INTO exercises (name, visibility, owner_id) VALUES ('Exercicio privado', 'private', $1)", [userIds.get('personal')]);
  });

  test('admin imports public plan and workouts with seven days, default rest and instructions', async () => {
    const response = await request();
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.success, true);
    const plan = body.weeklyPlan;
    assert.equal(plan.visibility, 'public');
    assert.equal(plan.owner_id, null);
    assert.equal(plan.created_by, userIds.get('admin'));
    assert.deepEqual(plan.days.map((day) => day.dayOfWeek), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(plan.days[0].instructions, 'Descanso.');
    assert.equal(plan.days[1].instructions, 'Aquecer antes.');
    for (const day of plan.days) {
      if ([1, 4].includes(day.dayOfWeek)) {
        assert.equal(day.isRest, false);
        assert.equal(day.dailyWorkout.visibility, 'public');
        assert.equal(day.dailyWorkout.owner_id, null);
        assert.equal(day.dailyWorkout.created_by, userIds.get('admin'));
      } else {
        assert.equal(day.isRest, true);
        assert.equal(day.dailyWorkout, null);
      }
    }
    assert.deepEqual(await counts(), { exercises: 5, workouts: 2, relations: 5, plans: 1, days: 7 });
  });

  test('reuses correct public UUIDs and all original media without inserting exercises or media copies', async () => {
    const original = (await pool.query('SELECT * FROM exercises ORDER BY id')).rows;
    const response = await request();
    const plan = (await response.json()).weeklyPlan;
    const items = plan.days[1].dailyWorkout.exercises;
    assert.equal(items[0].exerciseId, exerciseIds.get('Supino reto'));
    assert.equal(items[1].exerciseId, exerciseIds.get('Agachamento'));
    assert.equal(plan.days[4].dailyWorkout.exercises[0].exerciseId, exerciseIds.get('Bicicleta ergométrica'));
    for (const item of items) {
      assert.equal(item.youtubeUrl, 'https://www.youtube.com/watch?v=test');
      assert.equal(item.videoPath, 'video.mp4');
      assert.equal(item.gifPath, 'exercise.gif');
      assert.equal(item.gifLibraryPath, 'library/original.gif');
      assert.equal(item.audioPath, 'audio.mp3');
    }
    assert.deepEqual((await pool.query('SELECT * FROM exercises ORDER BY id')).rows, original);
    const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'daily_workout_exercises'", [schema])).rows;
    assert.ok(!columns.some(({ column_name }) => /gif|video|youtube|audio/.test(column_name)));
  });

  test('preserves prescription and order, appends cardio, and supports repeated exercise references', async () => {
    const response = await request();
    const items = (await response.json()).weeklyPlan.days[1].dailyWorkout.exercises;
    assert.deepEqual(items.map((item) => item.position), [1, 2, 3, 4]);
    assert.equal(items[0].sets, '4');
    assert.equal(items[0].repetitions, '8-12');
    assert.equal(items[0].load, '20 kg');
    assert.equal(items[0].restSeconds, 90);
    assert.equal(items[1].restSeconds, 0);
    assert.equal(items[2].exerciseId, exerciseIds.get('Caminhada na esteira'));
    assert.equal(items[3].exerciseId, items[2].exerciseId);
    assert.equal(items[2].sets, '1');
    assert.equal(items[2].repetitions, '20 minutos');
    assert.equal(items[2].load, null);
    assert.equal(items[2].restSeconds, null);
    assert.equal(items[2].notes, 'Cardio em intensidade leve a moderada. Sem inclinacao.');
    assert.equal(items[3].notes, 'Desaquecer.');
  });

  test('requires authentication and rejects personal and student on both endpoints without writes', async () => {
    const initial = await counts();
    for (const path of ['/weekly/import', '/weekly/import/validate']) {
      for (const [role, status] of [[null, 401], ['personal', 403], ['student', 403]]) {
        assert.equal((await request(path, role)).status, status);
      }
    }
    assert.deepEqual(await counts(), initial);
  });

  test('dry run returns matches without writing anything', async () => {
    const initial = await counts();
    const response = await request('/weekly/import/validate');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.valid, true);
    assert.deepEqual(body.missingExercises, []);
    assert.deepEqual(body.ambiguousExercises, []);
    assert.equal(body.matchedExercises.length, 4);
    assert.equal(body.matchedExercises[0].exerciseId, exerciseIds.get('Supino reto'));
    assert.deepEqual(await counts(), initial);
  });

  test('collects missing strength/cardio names, excludes private exercises and aborts without partial data', async () => {
    const initial = await counts();
    const data = payload();
    data.days[0].exercises.push({ exerciseName: 'Exercicio privado' }, { exerciseName: 'Nao cadastrado' });
    data.days[1].cardio.push({ exerciseName: 'Cardio inexistente', duration: '5 minutos' });
    const validation = await request('/weekly/import/validate', 'admin', data);
    const dryRun = await validation.json();
    assert.equal(dryRun.valid, false);
    assert.deepEqual(dryRun.missingExercises, ['Exercicio privado', 'Nao cadastrado', 'Cardio inexistente']);
    const response = await request('/weekly/import', 'admin', data);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'EXERCISES_NOT_FOUND');
    assert.deepEqual(body.error.details.missingExercises, dryRun.missingExercises);
    assert.deepEqual(await counts(), initial);
  });

  test('rejects ambiguous public names rather than choosing an arbitrary media record', async () => {
    await pool.query("INSERT INTO exercises (name, visibility) VALUES (' SUPINO  RETO ', 'public')");
    const initial = await counts();
    const validation = await request('/weekly/import/validate');
    const dryRun = await validation.json();
    assert.equal(dryRun.valid, false);
    assert.deepEqual(dryRun.ambiguousExercises, ['SUPINO   RETO']);
    const response = await request();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'EXERCISES_AMBIGUOUS');
    assert.deepEqual(await counts(), initial);
  });

  test('prefers accent-preserving matches and rejects ambiguous accent fallback', async () => {
    const inserted = await pool.query("INSERT INTO exercises (name, visibility) VALUES ('Bicicleta ergometrica', 'public') RETURNING id");
    const data = payload();
    data.days[1].cardio[0].exerciseName = 'Bicicleta ergométrica'.normalize('NFD');
    const response = await request('/weekly/import/validate', 'admin', data);
    assert.equal((await response.json()).matchedExercises.at(-1).exerciseId, exerciseIds.get('Bicicleta ergométrica'));
    data.days[1].cardio[0].exerciseName = 'Bicicleta ergometrica';
    assert.equal((await (await request('/weekly/import/validate', 'admin', data)).json()).matchedExercises.at(-1).exerciseId, inserted.rows[0].id);
    data.days[1].cardio[0].exerciseName = 'Biciclêta ergometrica';
    const validation = await (await request('/weekly/import/validate', 'admin', data)).json();
    assert.equal(validation.valid, false);
    assert.deepEqual(validation.ambiguousExercises, ['Biciclêta ergometrica']);
  });

  test('validates duplicate/invalid days, malformed prescriptions, rest conflicts and active-day requirements before writing', async () => {
    const initial = await counts();
    const invalid = [
      (data) => data.days.push({ ...data.days[0] }),
      (data) => { data.days[0].dayOfWeek = 7; },
      (data) => { data.days[0].dayOfWeek = '1'; },
      (data) => { data.days[0].isRest = 'false'; },
      (data) => { data.days[0].isRest = true; },
      (data) => { delete data.days[0].name; },
      (data) => { data.days[0].exercises = []; data.days[0].cardio = []; },
      (data) => { data.days[0].exercises[0].exerciseName = '  '; },
      (data) => { data.days[0].exercises[0].sets = 4; },
      (data) => { data.days[0].exercises[0].restSeconds = -1; },
      (data) => { data.days[0].exercises[0].restSeconds = 2147483648; },
      (data) => { data.days[0].cardio[0].duration = ''; },
      (data) => { data.days = []; }
    ];
    for (const change of invalid) {
      const data = payload();
      change(data);
      for (const path of ['/weekly/import', '/weekly/import/validate']) {
        const response = await request(path, 'admin', data);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, 'BAD_REQUEST');
      }
    }
    assert.deepEqual(await counts(), initial);
  });

  test('rolls back every workout, relation, plan and day after a PostgreSQL error late in the import', async () => {
    const initial = await counts();
    await pool.query(`CREATE FUNCTION fail_import_day() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.day_of_week = 3 THEN RAISE EXCEPTION 'Forced test failure' USING ERRCODE = '23505'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_import_day BEFORE INSERT ON weekly_plan_days FOR EACH ROW EXECUTE FUNCTION fail_import_day()`);
    try {
      const response = await request();
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, 'CONFLICT');
      assert.deepEqual(await counts(), initial);
    } finally {
      await pool.query('DROP TRIGGER fail_import_day ON weekly_plan_days; DROP FUNCTION fail_import_day()');
    }
    assert.equal((await request()).status, 201, 'Connection remains usable after rollback');
  });

  test('rolls back an already-created daily workout when an exercise insertion fails', async () => {
    const initial = await counts();
    await pool.query(`CREATE FUNCTION fail_import_exercise() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.position = 2 THEN RAISE EXCEPTION 'Forced test failure' USING ERRCODE = '23505'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_import_exercise BEFORE INSERT ON daily_workout_exercises FOR EACH ROW EXECUTE FUNCTION fail_import_exercise()`);
    try {
      assert.equal((await request()).status, 409);
      assert.deepEqual(await counts(), initial);
    } finally {
      await pool.query('DROP TRIGGER fail_import_exercise ON daily_workout_exercises; DROP FUNCTION fail_import_exercise()');
    }
  });

  test('existing daily creation, exercise linking and weekly creation endpoints still work', async () => {
    const dailyResponse = await request('/daily', 'personal', { name: 'Treino particular', visibility: 'private' });
    assert.equal(dailyResponse.status, 201);
    const daily = (await dailyResponse.json()).dailyWorkout;
    assert.equal(daily.owner_id, userIds.get('personal'));
    const relationResponse = await request(`/daily/${daily.id}/exercises`, 'personal', { exerciseId: exerciseIds.get('Supino reto'), sets: '3', position: 1 });
    assert.equal(relationResponse.status, 201);
    const weeklyResponse = await request('/weekly', 'personal', { name: 'Plano particular', days: [{ dayOfWeek: 1, dailyWorkoutId: daily.id }] });
    assert.equal(weeklyResponse.status, 201);
    const plan = (await weeklyResponse.json()).weeklyPlan;
    assert.equal(plan.visibility, 'private');
    assert.equal(plan.days[1].dailyWorkout.exercises[0].exerciseId, exerciseIds.get('Supino reto'));
    assert.equal(plan.days.length, 7);
  });
});

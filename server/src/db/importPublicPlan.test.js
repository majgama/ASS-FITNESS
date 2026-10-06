import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { importPublicPlan, normalizePublicPlan } from './importPublicPlan.js';

const input = JSON.parse(await readFile(new URL('../data/intermediate-five-day-plan.json', import.meta.url), 'utf8'));

function database({ duplicateExercise = false, corrupt = false, missingExercises = false } = {}) {
  const calls = [];
  const exercises = new Map([['existing-exercise', { name: 'Supino maquina', gif_path: 'existing.gif' }]]);
  if (!missingExercises) {
    const names = new Set(input.days.flatMap((day) => [...(day.exercises || []), ...(day.cardio || [])].map((item) => item.exerciseName)));
    for (const name of names) {
      if (name !== 'Supino maquina') exercises.set(name, { name });
    }
  }
  const workouts = new Map();
  const plans = new Map();
  const days = [];
  let counter = 0;
  const id = () => `new-${++counter}`;
  return {
    calls, exercises, workouts, plans, days,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('SELECT id FROM weekly_plans')) {
        const rows = [...plans].filter(([, plan]) => plan.name.toLowerCase() === params[0].toLowerCase()).map(([id]) => ({ id }));
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith('SELECT id, name FROM exercises')) {
        const rows = [...exercises].map(([id, exercise]) => ({ id, name: exercise.name }));
        if (duplicateExercise && rows.length) rows.push({ id: 'duplicate' });
        if (duplicateExercise) rows.at(-1).name = 'Supino maquina';
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith('SELECT id FROM users')) return { rows: [{ id: 'admin' }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO exercises')) {
        const newId = id();
        exercises.set(newId, { name: params[0] });
        return { rowCount: 1, rows: [{ id: newId }] };
      }
      if (sql.startsWith('INSERT INTO weekly_plans')) {
        const newId = id();
        plans.set(newId, { name: params[0], description: params[1] });
        return { rowCount: 1, rows: [{ id: newId }] };
      }
      if (sql.startsWith('INSERT INTO daily_workouts')) {
        const newId = id();
        workouts.set(newId, { name: params[0], description: params[1], exercises: [] });
        return { rowCount: 1, rows: [{ id: newId }] };
      }
      if (sql.startsWith('INSERT INTO daily_workout_exercises')) {
        workouts.get(params[0]).exercises.push({
          exerciseName: exercises.get(params[1]).name,
          position: params[2],
          sets: params[3],
          repetitions: params[4],
          load: params[5],
          restSeconds: params[6],
          notes: params[7]
        });
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('INSERT INTO weekly_plan_days')) {
        days.push({
          planId: params[0], dayOfWeek: params[1], isRest: params[2],
          workoutId: params[3], instructions: params[4]
        });
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('SELECT wp.name')) {
        const plan = plans.get(params[0]);
        const actual = {
          ...plan,
          days: days.filter((day) => day.planId === params[0]).sort((a, b) => a.dayOfWeek - b.dayOfWeek)
            .map((day) => ({
              dayOfWeek: day.dayOfWeek, isRest: day.isRest, instructions: day.instructions,
              workout: day.workoutId ? workouts.get(day.workoutId) : null
            }))
        };
        if (corrupt) actual.description = 'unexpected';
        return { rowCount: 1, rows: [actual] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

test('supplied plan preserves every prescription and all five cardio sessions', () => {
  const plan = normalizePublicPlan(input);
  assert.equal(plan.days.length, 7);
  assert.deepEqual(plan.days.filter((day) => day.isRest).map((day) => day.dayOfWeek), [0, 6]);
  const active = plan.days.filter((day) => day.workout);
  assert.equal(active.length, 5);
  assert.equal(active.reduce((total, day) => total + day.workout.exercises.length, 0), 26);
  for (const day of active) {
    const source = input.days.find((item) => item.dayOfWeek === day.dayOfWeek);
    assert.equal(day.workout.name, source.name);
    assert.equal(day.workout.description, source.description);
    assert.deepEqual(day.workout.exercises.slice(0, -1), source.exercises.map((exercise, index) => ({
      ...exercise, position: index + 1
    })));
    const cardio = day.workout.exercises.at(-1);
    assert.equal(cardio.exerciseName, source.cardio[0].exerciseName);
    assert.equal(cardio.repetitions, source.cardio[0].duration);
    assert.equal(cardio.restSeconds, null);
    assert.equal(cardio.notes, `Cardio em intensidade ${source.cardio[0].intensity}. ${source.cardio[0].notes}`);
  }
});

test('preview reports missing exercises without writing or taking write locks', async () => {
  const client = database({ missingExercises: true });
  const result = await importPublicPlan(client, input);
  assert.equal(result.status, 'preview');
  assert.equal(result.matchedExercises.length, 1);
  assert.equal(result.valid, false);
  assert.equal(result.missingExercises.length, 10);
  assert.equal(result.exerciseLinks, 26);
  assert.equal(client.calls.every(({ sql }) => sql.startsWith('SELECT id')), true);
});

test('import verifies complete content and reruns without duplicating or modifying existing media', async () => {
  const client = database();
  client.exercises.get('existing-exercise').name = 'Supino máquina';
  const result = await importPublicPlan(client, input, { write: true });
  assert.equal(result.status, 'created');
  assert.equal(client.plans.size, 1);
  assert.equal(client.workouts.size, 5);
  assert.equal(client.exercises.size, 11);
  assert.equal(client.days.length, 7);
  assert.equal(client.exercises.get('existing-exercise').gif_path, 'existing.gif');
  assert.equal([...client.workouts.values()][0].exercises[0].exerciseName, 'Supino máquina');
  const insertCount = client.calls.filter(({ sql }) => sql.startsWith('INSERT')).length;
  const rerun = await importPublicPlan(client, input, { write: true });
  assert.deepEqual(rerun, { status: 'already-exists', planId: result.planId });
  assert.equal(client.calls.filter(({ sql }) => sql.startsWith('INSERT')).length, insertCount);
});

test('missing or ambiguous exercise names fail before any insert', async () => {
  const client = database({ duplicateExercise: true });
  await assert.rejects(importPublicPlan(client, input, { write: true }), /Mais de um exercicio/);
  assert.equal(client.calls.some(({ sql }) => sql.startsWith('INSERT')), false);
  const missing = database({ missingExercises: true });
  await assert.rejects(importPublicPlan(missing, input, { write: true }), /nao encontrados/);
  assert.equal(missing.calls.some(({ sql }) => sql.startsWith('INSERT')), false);
});

test('mismatched existing plans are rejected without overwriting and final verification rejects corruption', async () => {
  const client = database();
  await importPublicPlan(client, input, { write: true });
  const insertCount = client.calls.filter(({ sql }) => sql.startsWith('INSERT')).length;
  await assert.rejects(importPublicPlan(client, { ...input, description: 'changed' }, { write: true }), /difere/);
  assert.equal(client.calls.filter(({ sql }) => sql.startsWith('INSERT')).length, insertCount);
  await assert.rejects(importPublicPlan(database({ corrupt: true }), input, { write: true }), /difere/);
});

test('invalid or duplicate days are rejected before querying', async () => {
  const client = database();
  await assert.rejects(importPublicPlan(client, { ...input, days: [] }));
  const invalid = structuredClone(input);
  invalid.days[0].dayOfWeek = invalid.days[1].dayOfWeek;
  await assert.rejects(importPublicPlan(client, invalid), /duplicado/);
  assert.equal(client.calls.length, 0);
});

test('CLI refuses an implicit database and unknown flags', () => {
  const script = new URL('../../scripts/importIntermediatePlan.js', import.meta.url);
  for (const args of [[], ['--force']]) {
    const result = spawnSync(process.execPath, [fileURLToPath(script), ...args], {
      env: { ...process.env, DATABASE_URL: '', DOTENV_CONFIG_PATH: '' }, encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, args.length ? /Uso:/ : /Configure DATABASE_URL/);
  }
});

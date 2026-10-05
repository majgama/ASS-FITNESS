import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';

const personalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourcePlanId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sourceWorkoutIds = [
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
];
const sourceExerciseId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const sessions = new Map([
  [hashToken('copy-personal'), { id: personalId, role: 'personal', name: 'Personal' }],
  [hashToken('copy-admin'), { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', role: 'admin', name: 'Admin' }]
]);
let plans;
let workouts;
let exercises;
let workoutRelations;
let planDays;
let nextId;
let snapshot;
let server;
let baseUrl;

function newId() {
  nextId += 1;
  return `10000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
}

function clone(value) {
  return structuredClone(value);
}

async function query(sql, params = []) {
  if (sql.includes('FROM sessions s')) {
    const session = sessions.get(params[0]);
    return { rowCount: session ? 1 : 0, rows: session ? [session] : [] };
  }
  if (sql === 'BEGIN') {
    snapshot = clone({ plans, workouts, exercises, workoutRelations, planDays, nextId });
    return { rowCount: 0, rows: [] };
  }
  if (sql === 'COMMIT') {
    snapshot = null;
    return { rowCount: 0, rows: [] };
  }
  if (sql === 'ROLLBACK') {
    ({ plans, workouts, exercises, workoutRelations, planDays, nextId } = snapshot);
    snapshot = null;
    return { rowCount: 0, rows: [] };
  }
  if (sql.startsWith('SELECT * FROM weekly_plans WHERE id')) {
    const row = plans.get(params[0]);
    return { rowCount: row ? 1 : 0, rows: row ? [clone(row)] : [] };
  }
  if (sql.startsWith('SELECT * FROM weekly_plan_days')) {
    const rows = planDays.filter((day) => day.weekly_plan_id === params[0]).sort((a, b) => a.day_of_week - b.day_of_week);
    return { rowCount: rows.length, rows: clone(rows) };
  }
  if (sql.includes('SELECT wpd.*') && sql.includes('FROM weekly_plan_days')) {
    const rows = planDays
      .filter((day) => day.weekly_plan_id === params[0])
      .sort((a, b) => a.day_of_week - b.day_of_week)
      .map((day) => ({
        ...clone(day),
        daily_workout_name: day.daily_workout_id ? workouts.get(day.daily_workout_id)?.name : null
      }));
    return { rowCount: rows.length, rows };
  }
  if (sql.startsWith('SELECT * FROM exercises WHERE id')) {
    const row = exercises.get(params[0]);
    return { rowCount: row ? 1 : 0, rows: row ? [clone(row)] : [] };
  }
  if (sql.includes('SELECT dwe.*, e.id AS source_exercise_id')) {
    const rows = (workoutRelations.get(params[0]) || []).map((relation) => ({
      ...clone(relation),
      source_exercise_id: relation.exercise_id
    }));
    return { rowCount: rows.length, rows };
  }
  if (sql.includes('FROM daily_workouts dw') && sql.includes('WHERE dw.id = $1')) {
    const workout = workouts.get(params[0]);
    if (!workout) return { rowCount: 0, rows: [] };
    const linkedExercises = (workoutRelations.get(workout.id) || []).map((relation) => {
      const exercise = exercises.get(relation.exercise_id);
      return {
        id: relation.id,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        muscleGroup: exercise.muscle_group,
        position: relation.position,
        sets: relation.sets,
        repetitions: relation.repetitions,
        load: relation.load,
        restSeconds: relation.rest_seconds,
        notes: relation.notes,
        youtubeUrl: exercise.youtube_url,
        videoPath: exercise.video_path,
        gifPath: exercise.gif_path,
        gifLibraryPath: exercise.gif_library_path,
        audioPath: exercise.audio_path
      };
    });
    return { rowCount: 1, rows: [{ ...clone(workout), exercises: linkedExercises }] };
  }
  if (sql.startsWith('INSERT INTO exercises')) {
    const source = exercises.get(params[0]);
    if (!source) return { rowCount: 0, rows: [] };
    const id = newId();
    exercises.set(id, { ...clone(source), id, visibility: 'private', owner_id: params[1], created_by: params[1] });
    return { rowCount: 1, rows: [{ id }] };
  }
  if (sql.startsWith('INSERT INTO daily_workouts')) {
    const id = newId();
    workouts.set(id, {
      id,
      name: params[0],
      description: params[1],
      visibility: 'private',
      owner_id: params[2],
      created_by: params[2]
    });
    workoutRelations.set(id, []);
    return { rowCount: 1, rows: [{ id }] };
  }
  if (sql.startsWith('INSERT INTO daily_workout_exercises')) {
    const relation = {
      id: newId(),
      daily_workout_id: params[0],
      exercise_id: params[1],
      position: params[2],
      sets: params[3],
      repetitions: params[4],
      load: params[5],
      rest_seconds: params[6],
      notes: params[7]
    };
    workoutRelations.get(params[0]).push(relation);
    return { rowCount: 1, rows: [relation] };
  }
  if (sql.startsWith('INSERT INTO weekly_plans')) {
    const id = newId();
    plans.set(id, {
      id,
      name: params[0],
      description: params[1],
      start_date: params[2],
      visibility: 'private',
      owner_id: params[3],
      created_by: params[3]
    });
    return { rowCount: 1, rows: [{ id }] };
  }
  if (sql.startsWith('INSERT INTO weekly_plan_days')) {
    planDays.push({
      weekly_plan_id: params[0],
      day_of_week: params[1],
      is_rest: params[2],
      daily_workout_id: params[3],
      instructions: params[4]
    });
    return { rowCount: 1, rows: [] };
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

beforeEach(() => {
  nextId = 0;
  plans = new Map([[sourcePlanId, {
    id: sourcePlanId,
    name: 'Plano público',
    description: 'Plano de referência',
    start_date: '2026-10-05',
    visibility: 'public',
    owner_id: null
  }]]);
  workouts = new Map(sourceWorkoutIds.map((id, index) => [id, {
    id,
    name: `Treino público ${index + 1}`,
    description: `Descrição ${index + 1}`,
    visibility: 'public',
    owner_id: null
  }]));
  exercises = new Map([[sourceExerciseId, {
    id: sourceExerciseId,
    name: 'Agachamento',
    muscle_group: 'Pernas',
    default_sets: '3',
    default_repetitions: '10',
    default_load: null,
    default_rest_seconds: '60',
    observations: 'Manter postura',
    youtube_url: null,
    video_path: null,
    video_mime: null,
    video_size_bytes: null,
    video_duration_seconds: null,
    gif_path: 'uploads/squat.gif',
    gif_mime: 'image/gif',
    gif_size_bytes: 2000,
    audio_path: null,
    audio_mime: null,
    audio_size_bytes: null,
    audio_duration_seconds: null,
    visibility: 'public',
    owner_id: null,
    created_by: null,
    gif_library_path: 'squat-library-id'
  }]]);
  workoutRelations = new Map([
    [sourceWorkoutIds[0], [{
      id: newId(),
      daily_workout_id: sourceWorkoutIds[0],
      exercise_id: sourceExerciseId,
      position: 1,
      sets: '4',
      repetitions: '8-10',
      load: '20 kg',
      rest_seconds: 90,
      notes: 'Controle o movimento'
    }]],
    [sourceWorkoutIds[1], [{
      id: newId(),
      daily_workout_id: sourceWorkoutIds[1],
      exercise_id: sourceExerciseId,
      position: 2,
      sets: '3',
      repetitions: '12',
      load: null,
      rest_seconds: 60,
      notes: null
    }]]
  ]);
  planDays = [
    { weekly_plan_id: sourcePlanId, day_of_week: 0, is_rest: false, daily_workout_id: sourceWorkoutIds[0], instructions: 'Dia A' },
    { weekly_plan_id: sourcePlanId, day_of_week: 1, is_rest: false, daily_workout_id: sourceWorkoutIds[0], instructions: 'Repetir A' },
    { weekly_plan_id: sourcePlanId, day_of_week: 2, is_rest: false, daily_workout_id: sourceWorkoutIds[1], instructions: 'Dia B' },
    { weekly_plan_id: sourcePlanId, day_of_week: 3, is_rest: true, daily_workout_id: null, instructions: null }
  ];
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

function request(path, token = 'copy-personal') {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
}

test('personal can save a public daily workout as a private copy with independent exercises', async () => {
  const response = await request(`/workouts/daily/${sourceWorkoutIds[0]}/copy`);
  assert.equal(response.status, 201);
  const { dailyWorkout } = await response.json();
  assert.equal(dailyWorkout.visibility, 'private');
  assert.equal(dailyWorkout.owner_id, personalId);
  assert.equal(dailyWorkout.exercises.length, 1);
  assert.notEqual(dailyWorkout.exercises[0].exerciseId, sourceExerciseId);
  assert.equal(dailyWorkout.exercises[0].sets, '4');
  const copiedExercise = exercises.get(dailyWorkout.exercises[0].exerciseId);
  assert.equal(copiedExercise.gif_path, 'uploads/squat.gif');
  assert.equal(copiedExercise.gif_library_path, 'squat-library-id');
  assert.equal(copiedExercise.owner_id, personalId);
  assert.equal(exercises.get(sourceExerciseId).visibility, 'public');
});

test('personal can copy a public plan with deduplicated workout and exercise dependencies', async () => {
  const response = await request(`/workouts/weekly/${sourcePlanId}/copy`);
  assert.equal(response.status, 201);
  const { weeklyPlan } = await response.json();
  assert.equal(weeklyPlan.visibility, 'private');
  assert.equal(weeklyPlan.owner_id, personalId);
  assert.equal(weeklyPlan.days.length, 4);
  assert.equal(weeklyPlan.days[0].dailyWorkout.id, weeklyPlan.days[1].dailyWorkout.id);
  assert.notEqual(weeklyPlan.days[0].dailyWorkout.id, sourceWorkoutIds[0]);
  assert.equal(weeklyPlan.days[0].dailyWorkout.exercises[0].sets, '4');
  assert.equal(weeklyPlan.days[1].instructions, 'Repetir A');
  assert.equal(weeklyPlan.days[3].isRest, true);
  assert.notEqual(
    weeklyPlan.days[0].dailyWorkout.exercises[0].exerciseId,
    sourceExerciseId
  );
  assert.equal(
    weeklyPlan.days[0].dailyWorkout.exercises[0].exerciseId,
    weeklyPlan.days[2].dailyWorkout.exercises[0].exerciseId
  );
  assert.equal([...workouts.values()].filter((workout) => workout.owner_id === personalId).length, 2);
  assert.equal([...exercises.values()].filter((exercise) => exercise.owner_id === personalId).length, 1);
  assert.equal(plans.get(sourcePlanId).visibility, 'public');
});

test('only personal accounts can copy public models and private models cannot be copied', async () => {
  assert.equal((await request(`/workouts/daily/${sourceWorkoutIds[0]}/copy`, 'copy-admin')).status, 403);
  workouts.get(sourceWorkoutIds[0]).visibility = 'private';
  workouts.get(sourceWorkoutIds[0]).owner_id = personalId;
  assert.equal((await request(`/workouts/daily/${sourceWorkoutIds[0]}/copy`)).status, 403);
  plans.get(sourcePlanId).visibility = 'private';
  plans.get(sourcePlanId).owner_id = personalId;
  assert.equal((await request(`/workouts/weekly/${sourcePlanId}/copy`)).status, 403);
});

test('copying a public plan includes private exercises exposed through public workouts', async () => {
  exercises.get(sourceExerciseId).visibility = 'private';
  exercises.get(sourceExerciseId).owner_id = '99999999-9999-4999-8999-999999999999';

  const response = await request(`/workouts/weekly/${sourcePlanId}/copy`);
  assert.equal(response.status, 201);
  const { weeklyPlan } = await response.json();
  const copiedExerciseId = weeklyPlan.days[0].dailyWorkout.exercises[0].exerciseId;
  const copiedExercise = exercises.get(copiedExerciseId);
  assert.notEqual(copiedExerciseId, sourceExerciseId);
  assert.equal(copiedExercise.visibility, 'private');
  assert.equal(copiedExercise.owner_id, personalId);
  assert.equal(exercises.get(sourceExerciseId).owner_id, '99999999-9999-4999-8999-999999999999');
  assert.equal([...workouts.values()].filter((workout) => workout.owner_id === personalId).length, 2);
  assert.equal([...exercises.values()].filter((exercise) => exercise.owner_id === personalId).length, 1);
});

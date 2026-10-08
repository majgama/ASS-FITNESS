import { isDeepStrictEqual } from 'node:util';
import {
  createImportedWeeklyPlan,
  importedDayExercises,
  resolveImportedExercises,
  weeklyImportSchema
} from '../services/weeklyPlanImportService.js';

export function normalizePublicPlan(input) {
  const plan = weeklyImportSchema.parse(input);
  const days = new Map(plan.days.map((day) => [day.dayOfWeek, day]));
  return {
    name: plan.name,
    description: plan.description || null,
    days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
      const day = days.get(dayOfWeek);
      return {
        dayOfWeek,
        isRest: !day || day.isRest,
        instructions: day?.instructions || null,
        workout: !day || day.isRest ? null : {
          name: day.name,
          description: day.description || null,
          exercises: importedDayExercises(day).map((exercise, index) => ({
            exerciseName: exercise.exerciseName,
            sets: exercise.sets || null,
            repetitions: exercise.repetitions || null,
            load: exercise.load || null,
            restSeconds: exercise.restSeconds ?? null,
            notes: exercise.notes || null,
            position: index + 1
          }))
        }
      };
    })
  };
}

async function verifyPlan(client, planId, expected) {
  const result = await client.query(
    `SELECT wp.name, wp.description,
       (SELECT json_agg(json_build_object(
         'dayOfWeek', wpd.day_of_week, 'isRest', wpd.is_rest, 'instructions', wpd.instructions,
         'workout', CASE WHEN dw.id IS NULL THEN NULL ELSE json_build_object(
           'name', dw.name, 'description', dw.description,
           'exercises', COALESCE((
             SELECT json_agg(json_build_object(
               'exerciseName', e.name, 'sets', dwe.sets, 'repetitions', dwe.repetitions,
               'load', dwe.load, 'restSeconds', dwe.rest_seconds, 'notes', dwe.notes,
               'position', dwe.position
             ) ORDER BY dwe.position)
             FROM daily_workout_exercises dwe
             JOIN exercises e ON e.id = dwe.exercise_id
             WHERE dwe.daily_workout_id = dw.id
           ), '[]'::json)
         ) END
       ) ORDER BY wpd.day_of_week)
       FROM weekly_plan_days wpd
       LEFT JOIN daily_workouts dw ON dw.id = wpd.daily_workout_id
       WHERE wpd.weekly_plan_id = wp.id) AS days
     FROM weekly_plans wp WHERE wp.id = $1`,
    [planId]
  );
  const actual = result.rows[0];
  // Names are matched case-insensitively when reusing exercises; preserve their existing spelling.
  const canonical = (plan) => ({
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      workout: day.workout ? {
        ...day.workout,
        exercises: day.workout.exercises.map((exercise) => ({
          ...exercise, exerciseName: exercise.exerciseName.toLowerCase()
        }))
      } : null
    }))
  });
  if (!actual || !actual.days || !isDeepStrictEqual(canonical(actual), canonical(expected))) {
    throw new Error('O plano salvo difere do arquivo de importacao. Nenhum modelo existente sera sobrescrito.');
  }
}

export async function importPublicPlan(client, input, { write = false, createMissingExercises = false } = {}) {
  const payload = weeklyImportSchema.parse(input);
  const plan = normalizePublicPlan(input);
  const resolution = await resolveImportedExercises(client, payload, write);
  const matchedNames = new Map(resolution.matchedExercises.map((exercise) => [exercise.exerciseName, exercise.matchedName]));
  for (const day of plan.days) {
    for (const exercise of day.workout?.exercises || []) {
      exercise.exerciseName = matchedNames.get(exercise.exerciseName) || exercise.exerciseName;
    }
  }
  const existing = await client.query(
    "SELECT id FROM weekly_plans WHERE lower(name) = lower($1) AND visibility = 'public'",
    [plan.name]
  );
  if (existing.rowCount > 1) throw new Error('Ha mais de um plano publico com este nome. Resolva a ambiguidade antes de importar.');
  if (existing.rowCount === 1) {
    await verifyPlan(client, existing.rows[0].id, plan);
    return { status: 'already-exists', planId: existing.rows[0].id };
  }

  const summary = {
    workouts: plan.days.filter((day) => day.workout).length,
    days: plan.days.length,
    exerciseLinks: plan.days.reduce((total, day) => total + (day.workout?.exercises.length || 0), 0),
    valid: resolution.ambiguousExercises.length === 0
      && (createMissingExercises || resolution.missingExercises.length === 0),
    exercisesToCreate: createMissingExercises ? resolution.missingExercises : [],
    ...resolution
  };
  if (!write) return { status: 'preview', ...summary };

  const admin = await client.query("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1");
  if (admin.rowCount === 0) throw new Error('Nenhum administrador cadastrado para registrar a importacao.');
  const planId = await createImportedWeeklyPlan(client, payload, admin.rows[0].id, { createMissingExercises });
  await verifyPlan(client, planId, plan);
  return { status: 'created', planId, ...summary };
}

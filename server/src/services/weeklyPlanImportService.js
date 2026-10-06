import { z } from 'zod';
import { AppError } from '../utils/errors.js';

const importText = z.string().trim().optional().nullable();
const importedExerciseSchema = z.object({
  exerciseName: z.string().trim().min(1),
  sets: importText,
  repetitions: importText,
  load: importText,
  restSeconds: z.number().int().min(0).max(2147483647).optional().nullable(),
  notes: importText
});
const importedCardioSchema = z.object({
  exerciseName: z.string().trim().min(1),
  duration: z.string().trim().min(1),
  intensity: importText,
  notes: importText
});
export const weeklyImportSchema = z.object({
  name: z.string().trim().min(2),
  description: importText,
  days: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    isRest: z.boolean().default(false),
    name: z.string().trim().min(2).optional(),
    description: importText,
    instructions: importText,
    exercises: z.array(importedExerciseSchema).default([]),
    cardio: z.array(importedCardioSchema).default([])
  }).superRefine((day, ctx) => {
    const itemCount = day.exercises.length + day.cardio.length;
    if (day.isRest && itemCount > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['isRest'], message: 'Dia de descanso nao pode conter exercicios ou cardio.' });
    }
    if (!day.isRest && !day.name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Informe o nome do treino diario.' });
    }
    if (!day.isRest && itemCount === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['exercises'], message: 'Dia ativo deve conter exercicios ou cardio.' });
    }
  })).min(1).max(7)
}).superRefine((payload, ctx) => {
  const seen = new Set();
  payload.days.forEach((day, index) => {
    if (seen.has(day.dayOfWeek)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['days', index, 'dayOfWeek'], message: 'Dia da semana duplicado.' });
    }
    seen.add(day.dayOfWeek);
  });
});

function normalizeExerciseName(name) {
  return name.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function unaccentExerciseName(name) {
  return normalizeExerciseName(name).normalize('NFD').replace(/\p{M}/gu, '');
}

export async function resolveImportedExercises(client, payload, lock = false) {
  const names = [...new Set(payload.days.flatMap((day) =>
    [...day.exercises, ...day.cardio].map((exercise) => exercise.exerciseName)
  ))];
  const matchedExercises = [];
  const missingExercises = [];
  const ambiguousExercises = [];
  if (names.length === 0) return { matchedExercises, missingExercises, ambiguousExercises };

  // Share locks keep names, visibility and original media stable until import commits.
  const result = await client.query(
    `SELECT id, name FROM exercises WHERE visibility = 'public' ORDER BY id${lock ? ' FOR SHARE' : ''}`
  );
  const exact = new Map();
  const unaccented = new Map();
  for (const exercise of result.rows) {
    for (const [index, key] of [[exact, normalizeExerciseName(exercise.name)], [unaccented, unaccentExerciseName(exercise.name)]]) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(exercise);
    }
  }
  for (const exerciseName of names) {
    const candidates = exact.get(normalizeExerciseName(exerciseName)) || unaccented.get(unaccentExerciseName(exerciseName)) || [];
    if (candidates.length === 0) missingExercises.push(exerciseName);
    else if (candidates.length > 1) ambiguousExercises.push(exerciseName);
    else matchedExercises.push({ exerciseName, exerciseId: candidates[0].id, matchedName: candidates[0].name });
  }
  return { matchedExercises, missingExercises, ambiguousExercises };
}

export function importedDayExercises(day) {
  return [...day.exercises, ...day.cardio.map((cardio) => ({
    exerciseName: cardio.exerciseName,
    sets: '1',
    repetitions: cardio.duration,
    notes: [cardio.intensity ? `Cardio em intensidade ${cardio.intensity}.` : null, cardio.notes].filter(Boolean).join(' ') || null
  }))];
}

export async function createImportedWeeklyPlan(client, payload, adminId) {
  const resolution = await resolveImportedExercises(client, payload, true);
  if (resolution.missingExercises.length > 0) {
    throw new AppError('Exercicios publicos nao encontrados.', 400, 'EXERCISES_NOT_FOUND', resolution);
  }
  if (resolution.ambiguousExercises.length > 0) {
    throw new AppError('Mais de um exercicio publico corresponde ao nome informado.', 409, 'EXERCISES_AMBIGUOUS', resolution);
  }
  const exerciseIds = new Map(resolution.matchedExercises.map((exercise) => [exercise.exerciseName, exercise.exerciseId]));
  const workoutIds = new Map();
  for (const day of payload.days) {
    if (day.isRest) continue;
    const workout = await client.query(
      `INSERT INTO daily_workouts (name, description, visibility, owner_id, created_by)
       VALUES ($1, $2, 'public', NULL, $3)
       RETURNING id`,
      [day.name, day.description || null, adminId]
    );
    const workoutId = workout.rows[0].id;
    workoutIds.set(day.dayOfWeek, workoutId);
    for (const [index, item] of importedDayExercises(day).entries()) {
      await client.query(
        `INSERT INTO daily_workout_exercises
           (daily_workout_id, exercise_id, position, sets, repetitions, load, rest_seconds, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [workoutId, exerciseIds.get(item.exerciseName), index + 1, item.sets || null, item.repetitions || null,
          item.load || null, item.restSeconds ?? null, item.notes || null]
      );
    }
  }
  const created = await client.query(
    `INSERT INTO weekly_plans (name, description, visibility, owner_id, created_by)
     VALUES ($1, $2, 'public', NULL, $3)
     RETURNING id`,
    [payload.name, payload.description || null, adminId]
  );
  const planId = created.rows[0].id;
  const daysByIndex = new Map(payload.days.map((day) => [day.dayOfWeek, day]));
  for (const dayOfWeek of [0, 1, 2, 3, 4, 5, 6]) {
    await client.query(
      `INSERT INTO weekly_plan_days (weekly_plan_id, day_of_week, is_rest, daily_workout_id, instructions)
       VALUES ($1, $2, $3, $4, $5)`,
      [planId, dayOfWeek, !workoutIds.has(dayOfWeek), workoutIds.get(dayOfWeek) || null,
        daysByIndex.get(dayOfWeek)?.instructions || null]
    );
  }
  return planId;
}

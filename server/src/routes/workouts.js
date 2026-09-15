import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { assertExerciseAccess, assertStudentAccess } from '../services/accessService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound } from '../utils/errors.js';
import { parseBody } from '../utils/validators.js';

export const workoutsRouter = Router();

workoutsRouter.use(authRequired);

const weekdays = [0, 1, 2, 3, 4, 5, 6];

function editableModel(user, model) {
  if (user.role === 'admin') return true;
  return model.visibility === 'private' && model.owner_id === user.id;
}

function modelVisibility(user, requestedVisibility) {
  if (requestedVisibility === 'public') {
    if (user.role !== 'admin') throw forbidden('Apenas administrador pode criar modelo publico.');
    return { visibility: 'public', ownerId: null };
  }
  return { visibility: 'private', ownerId: user.id };
}

async function fetchDailyWorkout(client, id) {
  const result = await client.query(
    `SELECT dw.*,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', dwe.id,
                  'exerciseId', e.id,
                  'exerciseName', e.name,
                  'muscleGroup', e.muscle_group,
                  'position', dwe.position,
                  'sets', dwe.sets,
                  'repetitions', dwe.repetitions,
                  'load', dwe.load,
                  'restSeconds', dwe.rest_seconds,
                  'notes', dwe.notes,
                  'youtubeUrl', e.youtube_url,
                  'videoPath', e.video_path,
                  'gifPath', e.gif_path,
                  'audioPath', e.audio_path
                )
                ORDER BY dwe.position
              ) FILTER (WHERE dwe.id IS NOT NULL),
              '[]'
            ) AS exercises
     FROM daily_workouts dw
     LEFT JOIN daily_workout_exercises dwe ON dwe.daily_workout_id = dw.id
     LEFT JOIN exercises e ON e.id = dwe.exercise_id
     WHERE dw.id = $1
     GROUP BY dw.id`,
    [id]
  );

  if (result.rowCount === 0) throw notFound('Treino diario nao encontrado.');
  return result.rows[0];
}

async function fetchWeeklyPlan(client, id) {
  const planResult = await client.query('SELECT * FROM weekly_plans WHERE id = $1', [id]);
  if (planResult.rowCount === 0) throw notFound('Plano semanal nao encontrado.');

  const daysResult = await client.query(
    `SELECT wpd.*, dw.name AS daily_workout_name
     FROM weekly_plan_days wpd
     LEFT JOIN daily_workouts dw ON dw.id = wpd.daily_workout_id
     WHERE wpd.weekly_plan_id = $1
     ORDER BY wpd.day_of_week`,
    [id]
  );

  const days = [];
  for (const row of daysResult.rows) {
    const dailyWorkout = row.daily_workout_id ? await fetchDailyWorkout(client, row.daily_workout_id) : null;
    days.push({
      id: row.id,
      dayOfWeek: row.day_of_week,
      isRest: row.is_rest,
      instructions: row.instructions,
      dailyWorkout
    });
  }

  return { ...planResult.rows[0], days };
}

function assertPlanVisible(user, plan) {
  if (plan.visibility === 'public' || user.role === 'admin' || plan.owner_id === user.id) return;
  throw forbidden('Voce nao tem acesso a este plano.');
}

function assertWorkoutVisible(user, workout) {
  if (workout.visibility === 'public' || user.role === 'admin' || workout.owner_id === user.id) return;
  throw forbidden('Voce nao tem acesso a este treino.');
}

workoutsRouter.get('/daily', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const params = [];
  let where = "visibility = 'public'";
  if (req.user.role === 'admin') {
    where = 'true';
  } else {
    params.push(req.user.id);
    where = `(visibility = 'public' OR owner_id = $1)`;
  }

  const result = await query(
    `SELECT * FROM daily_workouts WHERE ${where} ORDER BY created_at DESC`,
    params
  );
  res.json({ dailyWorkouts: result.rows });
}));

const dailyWorkoutSchema = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().optional().nullable(),
  visibility: z.enum(['public', 'private']).default('private')
});

workoutsRouter.post('/daily', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(dailyWorkoutSchema, req.body);
  const { visibility, ownerId } = modelVisibility(req.user, payload.visibility);
  const result = await query(
    `INSERT INTO daily_workouts (name, description, visibility, owner_id, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [payload.name, payload.description || null, visibility, ownerId, req.user.id]
  );
  res.status(201).json({ dailyWorkout: result.rows[0] });
}));

const workoutExerciseSchema = z.object({
  exerciseId: z.string().uuid(),
  position: z.coerce.number().int().default(0),
  sets: z.string().trim().optional().nullable(),
  repetitions: z.string().trim().optional().nullable(),
  load: z.string().trim().optional().nullable(),
  restSeconds: z.coerce.number().int().nonnegative().optional().nullable(),
  notes: z.string().trim().optional().nullable()
});

workoutsRouter.post('/daily/:id/exercises', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(workoutExerciseSchema, req.body);

  const result = await withTransaction(async (client) => {
    const workout = await fetchDailyWorkout(client, req.params.id);
    if (!editableModel(req.user, workout)) throw forbidden('Voce nao pode editar este treino.');
    await assertExerciseAccess(client, req.user, payload.exerciseId);

    const inserted = await client.query(
      `INSERT INTO daily_workout_exercises
        (daily_workout_id, exercise_id, position, sets, repetitions, load, rest_seconds, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.params.id,
        payload.exerciseId,
        payload.position,
        payload.sets || null,
        payload.repetitions || null,
        payload.load || null,
        payload.restSeconds || null,
        payload.notes || null
      ]
    );
    return inserted.rows[0];
  });

  res.status(201).json({ workoutExercise: result });
}));

workoutsRouter.get('/weekly', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const params = [];
  let where = "wp.visibility = 'public'";
  if (req.user.role === 'admin') {
    where = 'true';
  } else {
    params.push(req.user.id);
    where = `(wp.visibility = 'public' OR wp.owner_id = $1)`;
  }

  const result = await query(
    `SELECT wp.*,
            COALESCE(
              json_agg(
                json_build_object(
                  'dayOfWeek', wpd.day_of_week,
                  'isRest', wpd.is_rest,
                  'dailyWorkoutId', wpd.daily_workout_id,
                  'dailyWorkoutName', dw.name,
                  'instructions', wpd.instructions
                )
                ORDER BY wpd.day_of_week
              ) FILTER (WHERE wpd.id IS NOT NULL),
              '[]'
            ) AS days
     FROM weekly_plans wp
     LEFT JOIN weekly_plan_days wpd ON wpd.weekly_plan_id = wp.id
     LEFT JOIN daily_workouts dw ON dw.id = wpd.daily_workout_id
     WHERE ${where}
     GROUP BY wp.id
     ORDER BY wp.created_at DESC`,
    params
  );
  res.json({ weeklyPlans: result.rows });
}));

const weeklyPlanSchema = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().optional().nullable(),
  startDate: z.string().optional().nullable(),
  visibility: z.enum(['public', 'private']).default('private'),
  days: z.array(z.object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    isRest: z.coerce.boolean().default(false),
    dailyWorkoutId: z.string().uuid().optional().nullable(),
    instructions: z.string().trim().optional().nullable()
  })).optional().default([])
});

workoutsRouter.post('/weekly', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(weeklyPlanSchema, req.body);
  const { visibility, ownerId } = modelVisibility(req.user, payload.visibility);

  const plan = await withTransaction(async (client) => {
    const created = await client.query(
      `INSERT INTO weekly_plans (name, description, start_date, visibility, owner_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [payload.name, payload.description || null, payload.startDate || null, visibility, ownerId, req.user.id]
    );

    const daysByIndex = new Map(payload.days.map((day) => [Number(day.dayOfWeek), day]));
    for (const dayOfWeek of weekdays) {
      const day = daysByIndex.get(dayOfWeek) || { dayOfWeek, isRest: true };
      if (day.dailyWorkoutId) {
        const workout = await fetchDailyWorkout(client, day.dailyWorkoutId);
        assertWorkoutVisible(req.user, workout);
      }
      await client.query(
        `INSERT INTO weekly_plan_days (weekly_plan_id, day_of_week, is_rest, daily_workout_id, instructions)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          created.rows[0].id,
          dayOfWeek,
          Boolean(day.isRest),
          day.isRest ? null : day.dailyWorkoutId || null,
          day.instructions || null
        ]
      );
    }

    return fetchWeeklyPlan(client, created.rows[0].id);
  });

  res.status(201).json({ weeklyPlan: plan });
}));

workoutsRouter.get('/weekly/:id', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const plan = await fetchWeeklyPlan({ query }, req.params.id);
  assertPlanVisible(req.user, plan);
  res.json({ weeklyPlan: plan });
}));

workoutsRouter.put('/weekly/:id/days', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(weeklyPlanSchema.pick({ days: true }), req.body);

  await withTransaction(async (client) => {
    const plan = await fetchWeeklyPlan(client, req.params.id);
    if (!editableModel(req.user, plan)) throw forbidden('Voce nao pode editar este plano.');

    await client.query('DELETE FROM weekly_plan_days WHERE weekly_plan_id = $1', [req.params.id]);
    const daysByIndex = new Map(payload.days.map((day) => [Number(day.dayOfWeek), day]));
    for (const dayOfWeek of weekdays) {
      const day = daysByIndex.get(dayOfWeek) || { dayOfWeek, isRest: true };
      if (day.dailyWorkoutId) {
        const workout = await fetchDailyWorkout(client, day.dailyWorkoutId);
        assertWorkoutVisible(req.user, workout);
      }
      await client.query(
        `INSERT INTO weekly_plan_days (weekly_plan_id, day_of_week, is_rest, daily_workout_id, instructions)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, dayOfWeek, Boolean(day.isRest), day.isRest ? null : day.dailyWorkoutId || null, day.instructions || null]
      );
    }
  });

  res.status(204).send();
}));

const applyPlanSchema = z.object({
  studentId: z.string().uuid(),
  startDate: z.string().optional().nullable()
});

workoutsRouter.post('/weekly/:id/apply', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(applyPlanSchema, req.body);

  const applied = await withTransaction(async (client) => {
    await assertStudentAccess(client, req.user, payload.studentId);
    const plan = await fetchWeeklyPlan(client, req.params.id);
    assertPlanVisible(req.user, plan);

    await client.query(
      `UPDATE student_weekly_plans
       SET status = 'completed', completed_at = now()
       WHERE student_id = $1 AND status = 'active'`,
      [payload.studentId]
    );

    const result = await client.query(
      `INSERT INTO student_weekly_plans
        (student_id, weekly_plan_id, plan_snapshot, applied_by, start_date)
       VALUES ($1, $2, $3, $4, COALESCE($5, current_date))
       RETURNING *`,
      [payload.studentId, req.params.id, JSON.stringify(plan), req.user.id, payload.startDate || plan.start_date || null]
    );
    return result.rows[0];
  });

  res.status(201).json({ studentWeeklyPlan: applied });
}));

workoutsRouter.get('/students/:studentId/history', asyncHandler(async (req, res) => {
  await withTransaction(async (client) => assertStudentAccess(client, req.user, req.params.studentId));
  const result = await query(
    `SELECT id, weekly_plan_id, plan_snapshot, applied_by, status, start_date, completed_at, created_at
     FROM student_weekly_plans
     WHERE student_id = $1
     ORDER BY created_at DESC`,
    [req.params.studentId]
  );
  res.json({ plans: result.rows });
}));

workoutsRouter.get('/student/current', requireRoles('student'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, weekly_plan_id, plan_snapshot, applied_by, status, start_date, completed_at, created_at
     FROM student_weekly_plans
     WHERE student_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [req.user.id]
  );
  res.json({ currentPlan: result.rows[0] || null });
}));

workoutsRouter.post('/students/:studentId/complete', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    await assertStudentAccess(client, req.user, req.params.studentId);
    const result = await client.query(
      `UPDATE student_weekly_plans
       SET status = 'completed', completed_at = now()
       WHERE student_id = $1 AND status = 'active'
       RETURNING id`,
      [req.params.studentId]
    );

    if (result.rowCount === 0) throw notFound('Plano ativo nao encontrado para este aluno.');

    await client.query(
      `INSERT INTO workout_feedback (student_weekly_plan_id, student_id, is_plan_completed, message)
       VALUES ($1, $2, true, 'Plano concluido pelo personal')`,
      [result.rows[0].id, req.params.studentId]
    );
  });

  res.status(204).send();
}));

const dailyCompleteSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6)
});

workoutsRouter.post('/student/current/daily-complete', requireRoles('student'), asyncHandler(async (req, res) => {
  const payload = parseBody(dailyCompleteSchema, req.body);
  const current = await query(
    `SELECT id FROM student_weekly_plans
     WHERE student_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [req.user.id]
  );
  if (current.rowCount === 0) throw notFound('Plano ativo nao encontrado.');

  await query(
    `INSERT INTO workout_feedback (student_weekly_plan_id, student_id, day_of_week, message, is_plan_completed)
     VALUES ($1, $2, $3, 'Treino do dia concluido', false)`,
    [current.rows[0].id, req.user.id, payload.dayOfWeek]
  );

  res.status(204).send();
}));

const feedbackSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6).optional().nullable(),
  message: z.string().trim().min(2),
  difficulty: z.string().trim().optional().nullable()
});

workoutsRouter.post('/student/current/feedback', requireRoles('student'), asyncHandler(async (req, res) => {
  const payload = parseBody(feedbackSchema, req.body);
  const current = await query(
    `SELECT id FROM student_weekly_plans
     WHERE student_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [req.user.id]
  );
  if (current.rowCount === 0) throw notFound('Plano ativo nao encontrado.');

  const result = await query(
    `INSERT INTO workout_feedback (student_weekly_plan_id, student_id, day_of_week, message, difficulty)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [current.rows[0].id, req.user.id, payload.dayOfWeek ?? null, payload.message, payload.difficulty || null]
  );
  res.status(201).json({ feedback: result.rows[0] });
}));

import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { query, withTransaction } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import {
  assertStudentAccess,
  assertTrainerCanAddActiveStudent,
  assertTrainerOwnsStudent,
  getTrainerCapacity
} from '../services/accessService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { emailSchema, parseBody, relationshipTypes, studentStatuses } from '../utils/validators.js';

export const studentsRouter = Router();

studentsRouter.use(authRequired);

function temporaryPassword() {
  return `Fit@${crypto.randomBytes(5).toString('hex')}`;
}

async function addWorkoutProgress(students) {
  return Promise.all(students.map(async (student) => {
    const result = await query(
      `SELECT swp.id,
              COALESCE((
                SELECT COUNT(*)
                FROM jsonb_array_elements(swp.plan_snapshot->'days') AS day
                WHERE COALESCE((day->>'isRest')::boolean, false) = false
              ), 0)::int AS planned_days,
              COALESCE((
                SELECT COUNT(DISTINCT wf.day_of_week)
                FROM workout_feedback wf
                WHERE wf.student_weekly_plan_id = swp.id
                  AND wf.day_of_week IS NOT NULL
              ), 0)::int AS completed_days
       FROM student_weekly_plans swp
       WHERE swp.student_id = $1 AND swp.status = 'active'
       ORDER BY swp.created_at DESC
       LIMIT 1`,
      [student.id]
    );

    const activePlan = result.rows[0];
    const plannedDays = activePlan?.planned_days || 0;
    const completedDays = Math.min(activePlan?.completed_days || 0, plannedDays);
    return {
      ...student,
      workoutProgress: {
        hasActivePlan: Boolean(activePlan),
        completedDays,
        plannedDays,
        percentage: plannedDays ? Math.round((completedDays / plannedDays) * 100) : 0
      }
    };
  }));
}

async function fetchStudentsForUser(user, status) {
  const params = [];
  let where = "u.role = 'student'";

  if (user.role === 'personal') {
    params.push(user.id);
    where += ` AND EXISTS (
      SELECT 1 FROM trainer_students own
      WHERE own.student_id = u.id AND own.trainer_id = $${params.length}
    )`;
  }

  if (user.role === 'student') {
    params.push(user.id);
    where += ` AND u.id = $${params.length}`;
  }

  if (status && ['active', 'inactive'].includes(status)) {
    params.push(status);
    where += ` AND sp.status = $${params.length}`;
  }

  const result = await query(
    `SELECT u.id, u.name, u.email, u.date_of_birth, u.profile_photo_path,
            sp.objective, sp.start_date, sp.restrictions, sp.next_assessment_date,
            sp.status, sp.inactive_reason,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', t.id,
                  'name', t.name,
                  'email', t.email,
                  'relationshipType', ts.relationship_type
                )
              ) FILTER (WHERE t.id IS NOT NULL),
              '[]'
            ) AS trainers
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN trainer_students ts ON ts.student_id = u.id
     LEFT JOIN users t ON t.id = ts.trainer_id
     WHERE ${where}
     GROUP BY u.id, sp.user_id
     ORDER BY u.name`,
    params
  );

  return addWorkoutProgress(result.rows);
}

studentsRouter.get('/', asyncHandler(async (req, res) => {
  const students = await fetchStudentsForUser(req.user, req.query.status);
  let capacity = null;
  if (req.user.role === 'personal') {
    capacity = await getTrainerCapacity({ query }, req.user.id);
  }
  res.json({ students, capacity });
}));

const createStudentSchema = z.object({
  name: z.string().trim().min(2),
  email: emailSchema,
  password: z.string().min(8).optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  objective: z.string().trim().optional().nullable(),
  startDate: z.string().optional().nullable(),
  restrictions: z.string().trim().optional().nullable(),
  nextAssessmentDate: z.string().optional().nullable(),
  status: z.enum(studentStatuses).default('active'),
  trainerId: z.string().uuid().optional().nullable(),
  relationshipType: z.enum(relationshipTypes).default('primary')
});

studentsRouter.post('/', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(createStudentSchema, req.body);
  const generatedPassword = payload.password ? null : temporaryPassword();
  const password = payload.password || generatedPassword;
  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);

  const created = await withTransaction(async (client) => {
    const existing = await client.query('SELECT id FROM users WHERE lower(email) = lower($1)', [payload.email]);
    if (existing.rowCount > 0) throw badRequest('Ja existe usuario cadastrado com este e-mail.');

    const trainerId = req.user.role === 'personal' ? req.user.id : payload.trainerId;
    if (payload.status === 'active' && trainerId) {
      await assertTrainerCanAddActiveStudent(client, trainerId);
    }

    const user = await client.query(
      `INSERT INTO users (name, email, date_of_birth, role, password_hash)
       VALUES ($1, lower($2), $3, 'student', $4)
       RETURNING id, name, email, date_of_birth, profile_photo_path, role`,
      [payload.name, payload.email, payload.dateOfBirth || null, passwordHash]
    );

    await client.query(
      `INSERT INTO student_profiles
        (user_id, objective, start_date, restrictions, next_assessment_date, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        user.rows[0].id,
        payload.objective || null,
        payload.startDate || null,
        payload.restrictions || null,
        payload.nextAssessmentDate || null,
        payload.status
      ]
    );

    if (trainerId) {
      await client.query(
        `INSERT INTO trainer_students (trainer_id, student_id, relationship_type, created_by)
         VALUES ($1, $2, $3, $4)`,
        [trainerId, user.rows[0].id, payload.relationshipType, req.user.id]
      );
    }

    return user.rows[0];
  });

  res.status(201).json({ student: created, temporaryPassword: generatedPassword });
}));

const updateStatusSchema = z.object({
  status: z.enum(studentStatuses),
  inactiveReason: z.string().trim().optional().nullable()
});

studentsRouter.patch('/:id/status', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(updateStatusSchema, req.body);

  await withTransaction(async (client) => {
    const student = await client.query('SELECT user_id, status FROM student_profiles WHERE user_id = $1', [req.params.id]);
    if (student.rowCount === 0) throw notFound('Aluno nao encontrado.');

    if (req.user.role === 'personal') {
      await assertTrainerOwnsStudent(client, req.user.id, req.params.id);
      if (student.rows[0].status !== 'active' && payload.status === 'active') {
        await assertTrainerCanAddActiveStudent(client, req.user.id);
      }
    }

    if (req.user.role === 'admin' && student.rows[0].status !== 'active' && payload.status === 'active') {
      const trainers = await client.query('SELECT trainer_id FROM trainer_students WHERE student_id = $1', [req.params.id]);
      for (const trainer of trainers.rows) {
        await assertTrainerCanAddActiveStudent(client, trainer.trainer_id);
      }
    }

    await client.query(
      `UPDATE student_profiles
       SET status = $2,
           inactive_reason = CASE WHEN $2 = 'inactive' THEN $3 ELSE NULL END
       WHERE user_id = $1`,
      [req.params.id, payload.status, payload.inactiveReason || null]
    );
  });

  res.status(204).send();
}));

const updateStudentSchema = z.object({
  name: z.string().trim().min(2).optional(),
  objective: z.string().trim().optional().nullable(),
  startDate: z.string().optional().nullable(),
  restrictions: z.string().trim().optional().nullable(),
  nextAssessmentDate: z.string().optional().nullable()
});

studentsRouter.patch('/:id', requireRoles('admin', 'personal', 'student'), asyncHandler(async (req, res) => {
  const payload = parseBody(updateStudentSchema, req.body);
  await withTransaction(async (client) => {
    await assertStudentAccess(client, req.user, req.params.id);
    if (req.user.role === 'student' && req.user.id !== req.params.id) throw forbidden();

    await client.query(
      `UPDATE users SET name = COALESCE($2, name) WHERE id = $1`,
      [req.params.id, payload.name]
    );
    await client.query(
      `UPDATE student_profiles
       SET objective = COALESCE($2, objective),
           start_date = COALESCE($3, start_date),
           restrictions = COALESCE($4, restrictions),
           next_assessment_date = COALESCE($5, next_assessment_date)
       WHERE user_id = $1`,
      [
        req.params.id,
        payload.objective || null,
        payload.startDate || null,
        payload.restrictions || null,
        payload.nextAssessmentDate || null
      ]
    );
  });

  res.status(204).send();
}));

const billingSchema = z.object({
  dueDate: z.string().optional().nullable(),
  monthlyAmount: z.coerce.number().nonnegative().optional().nullable(),
  status: z.enum(['pending', 'paid', 'overdue']).optional()
});

studentsRouter.get('/:id/billing', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  await withTransaction(async (client) => assertStudentAccess(client, req.user, req.params.id));
  const [billing, payments] = await Promise.all([
    query('SELECT student_id, due_date, monthly_amount, status, updated_at FROM student_billing WHERE student_id = $1', [req.params.id]),
    query(
      `SELECT id, amount, due_date, paid_at, status, note, created_at
       FROM student_payment_history
       WHERE student_id = $1
       ORDER BY created_at DESC`,
      [req.params.id]
    )
  ]);
  res.json({ billing: billing.rows[0] || null, payments: payments.rows });
}));

studentsRouter.patch('/:id/billing', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(billingSchema, req.body);
  await withTransaction(async (client) => {
    await assertStudentAccess(client, req.user, req.params.id);
    await client.query(
      `INSERT INTO student_billing (student_id, due_date, monthly_amount, status)
       VALUES ($1, $2, $3, COALESCE($4, 'pending'))
       ON CONFLICT (student_id) DO UPDATE SET
         due_date = COALESCE($2, student_billing.due_date),
         monthly_amount = COALESCE($3, student_billing.monthly_amount),
         status = COALESCE($4, student_billing.status),
         updated_at = now()`,
      [req.params.id, payload.dueDate || null, payload.monthlyAmount ?? null, payload.status || null]
    );
  });
  res.status(204).send();
}));

const paymentSchema = z.object({
  amount: z.coerce.number().nonnegative().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  paidAt: z.string().optional().nullable(),
  status: z.enum(['pending', 'paid', 'overdue']).default('paid'),
  note: z.string().trim().optional().nullable()
});

studentsRouter.post('/:id/payments', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(paymentSchema, req.body);
  await withTransaction(async (client) => {
    await assertStudentAccess(client, req.user, req.params.id);
    await client.query(
      `INSERT INTO student_payment_history (student_id, amount, due_date, paid_at, status, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.params.id, payload.amount ?? null, payload.dueDate || null, payload.paidAt || null, payload.status, payload.note || null]
    );
  });
  res.status(201).send();
}));

const linkSchema = z.object({
  trainerId: z.string().uuid(),
  relationshipType: z.enum(relationshipTypes).default('secondary')
});

studentsRouter.post('/:id/trainers', requireRoles('admin'), asyncHandler(async (req, res) => {
  const payload = parseBody(linkSchema, req.body);

  await withTransaction(async (client) => {
    const trainer = await client.query("SELECT id FROM users WHERE id = $1 AND role = 'personal'", [payload.trainerId]);
    if (trainer.rowCount === 0) throw notFound('Personal nao encontrado.');
    const student = await client.query("SELECT sp.status FROM users u JOIN student_profiles sp ON sp.user_id = u.id WHERE u.id = $1", [req.params.id]);
    if (student.rowCount === 0) throw notFound('Aluno nao encontrado.');
    if (student.rows[0].status === 'active') {
      await assertTrainerCanAddActiveStudent(client, payload.trainerId);
    }

    await client.query(
      `INSERT INTO trainer_students (trainer_id, student_id, relationship_type, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (trainer_id, student_id)
       DO UPDATE SET relationship_type = EXCLUDED.relationship_type`,
      [payload.trainerId, req.params.id, payload.relationshipType, req.user.id]
    );
  });

  res.status(204).send();
}));

studentsRouter.delete('/:id/trainers/:trainerId', requireRoles('admin'), asyncHandler(async (req, res) => {
  const deleted = await query(
    'DELETE FROM trainer_students WHERE student_id = $1 AND trainer_id = $2',
    [req.params.id, req.params.trainerId]
  );
  if (deleted.rowCount === 0) throw notFound('Vinculo nao encontrado.');
  res.status(204).send();
}));

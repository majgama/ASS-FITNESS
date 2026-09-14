import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { assertStudentAccess } from '../services/accessService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound } from '../utils/errors.js';
import { parseBody } from '../utils/validators.js';

export const dietsRouter = Router();

dietsRouter.use(authRequired);

function canUseDiet(user, diet) {
  if (user.role === 'admin') return true;
  return diet.owner_id === user.id;
}

dietsRouter.get('/', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const params = [];
  let where = 'true';
  if (req.user.role === 'personal') {
    params.push(req.user.id);
    where = 'owner_id = $1';
  }

  const result = await query(
    `SELECT dp.*, u.name AS owner_name
     FROM diet_plans dp
     LEFT JOIN users u ON u.id = dp.owner_id
     WHERE ${where}
     ORDER BY dp.created_at DESC`,
    params
  );
  res.json({ diets: result.rows });
}));

const dietSchema = z.object({
  name: z.string().trim().min(2),
  planDate: z.string().optional().nullable(),
  generalGuidelines: z.string().trim().optional().nullable()
});

dietsRouter.post('/', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(dietSchema, req.body);
  const result = await query(
    `INSERT INTO diet_plans (name, plan_date, general_guidelines, owner_id, created_by)
     VALUES ($1, COALESCE($2, current_date), $3, $4, $5)
     RETURNING *`,
    [
      payload.name,
      payload.planDate || null,
      payload.generalGuidelines || null,
      req.user.role === 'personal' ? req.user.id : null,
      req.user.id
    ]
  );
  res.status(201).json({ diet: result.rows[0] });
}));

const applyDietSchema = z.object({
  studentId: z.string().uuid()
});

dietsRouter.post('/:id/apply', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const payload = parseBody(applyDietSchema, req.body);
  const applied = await withTransaction(async (client) => {
    await assertStudentAccess(client, req.user, payload.studentId);
    const diet = await client.query('SELECT * FROM diet_plans WHERE id = $1', [req.params.id]);
    if (diet.rowCount === 0) throw notFound('Plano de dieta nao encontrado.');
    if (!canUseDiet(req.user, diet.rows[0])) throw forbidden('Voce nao pode aplicar esta dieta.');

    const result = await client.query(
      `INSERT INTO student_diet_plans (student_id, diet_plan_id, diet_snapshot, applied_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [payload.studentId, req.params.id, JSON.stringify(diet.rows[0]), req.user.id]
    );
    return result.rows[0];
  });

  res.status(201).json({ studentDiet: applied });
}));

dietsRouter.get('/students/:studentId', asyncHandler(async (req, res) => {
  await withTransaction(async (client) => assertStudentAccess(client, req.user, req.params.studentId));
  const result = await query(
    `SELECT id, diet_plan_id, diet_snapshot, applied_by, applied_at
     FROM student_diet_plans
     WHERE student_id = $1
     ORDER BY applied_at DESC`,
    [req.params.studentId]
  );
  res.json({ diets: result.rows });
}));

dietsRouter.get('/student/current', requireRoles('student'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, diet_plan_id, diet_snapshot, applied_by, applied_at
     FROM student_diet_plans
     WHERE student_id = $1
     ORDER BY applied_at DESC
     LIMIT 1`,
    [req.user.id]
  );
  res.json({ currentDiet: result.rows[0] || null });
}));

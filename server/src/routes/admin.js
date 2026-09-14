import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const adminRouter = Router();

adminRouter.use(authRequired, requireRoles('admin'));

adminRouter.get('/metrics', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
      (SELECT COUNT(*)::int FROM users WHERE role = 'personal') AS personals,
      (SELECT COUNT(*)::int FROM users WHERE role = 'student') AS students,
      (SELECT COUNT(*)::int FROM student_profiles WHERE status = 'active') AS active_students,
      (SELECT COUNT(*)::int FROM exercises WHERE visibility = 'public') AS public_exercises,
      (SELECT COUNT(*)::int FROM weekly_plans WHERE visibility = 'public') AS public_weekly_plans`
  );
  res.json({ metrics: result.rows[0] });
}));

adminRouter.get('/personals', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.name, u.email, u.date_of_birth, u.profile_photo_path, u.cref,
            pp.specialty, pp.invite_code,
            tb.free_student_limit, tb.paid_student_limit, tb.status AS billing_status,
            COUNT(DISTINCT ts.student_id)::int AS students_count
     FROM users u
     JOIN personal_profiles pp ON pp.user_id = u.id
     LEFT JOIN trainer_billing tb ON tb.trainer_id = u.id
     LEFT JOIN trainer_students ts ON ts.trainer_id = u.id
     WHERE u.role = 'personal'
     GROUP BY u.id, pp.user_id, tb.trainer_id
     ORDER BY u.name`
  );
  res.json({ personals: result.rows });
}));

adminRouter.get('/students', asyncHandler(async (req, res) => {
  const status = req.query.status;
  const params = [];
  let where = "u.role = 'student'";
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

  res.json({ students: result.rows });
}));

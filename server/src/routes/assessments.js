import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { assessmentPhotosUpload } from '../middleware/upload.js';
import { assertStudentAccess } from '../services/accessService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { idSchema, optionalNumber, parseBody } from '../utils/validators.js';
import { forbidden, notFound } from '../utils/errors.js';

export const assessmentsRouter = Router();

assessmentsRouter.use(authRequired);

const nullableNumber = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.coerce.number().optional().nullable()
);

const assessmentSchema = z.object({
  studentId: z.string().uuid(),
  assessmentDate: z.string().optional().nullable(),
  weightKg: nullableNumber,
  heightCm: nullableNumber,
  chestCm: nullableNumber,
  waistCm: nullableNumber,
  abdomenCm: nullableNumber,
  hipCm: nullableNumber,
  rightArmCm: nullableNumber,
  leftArmCm: nullableNumber,
  rightThighCm: nullableNumber,
  leftThighCm: nullableNumber,
  rightCalfCm: nullableNumber,
  leftCalfCm: nullableNumber,
  bodyGoal: z.string().trim().optional().nullable(),
  observations: z.string().trim().optional().nullable()
});

async function insertAssessment(client, payload, trainerId, uploadedFiles) {
    const result = await client.query(
      `INSERT INTO assessments (
        student_id, trainer_id, assessment_date, weight_kg, height_cm, chest_cm,
        waist_cm, abdomen_cm, hip_cm, right_arm_cm, left_arm_cm, right_thigh_cm,
        left_thigh_cm, right_calf_cm, left_calf_cm, body_goal, observations
      )
      VALUES (
        $1, $2, COALESCE($3, current_date), $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17
      )
      RETURNING *`,
      [
        payload.studentId,
        trainerId,
        payload.assessmentDate || null,
        optionalNumber(payload.weightKg),
        optionalNumber(payload.heightCm),
        optionalNumber(payload.chestCm),
        optionalNumber(payload.waistCm),
        optionalNumber(payload.abdomenCm),
        optionalNumber(payload.hipCm),
        optionalNumber(payload.rightArmCm),
        optionalNumber(payload.leftArmCm),
        optionalNumber(payload.rightThighCm),
        optionalNumber(payload.leftThighCm),
        optionalNumber(payload.rightCalfCm),
        optionalNumber(payload.leftCalfCm),
        payload.bodyGoal || null,
        payload.observations || null
      ]
    );

    const files = [
      ['front', uploadedFiles?.front?.[0]],
      ['side', uploadedFiles?.side?.[0]],
      ['back', uploadedFiles?.back?.[0]]
    ];

    for (const [angle, file] of files) {
      if (!file) continue;
      await client.query(
        `INSERT INTO assessment_photos (assessment_id, angle, file_path, mime_type, size_bytes, file_data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          result.rows[0].id,
          angle,
          `assessments/${randomUUID()}`,
          file.mimetype,
          file.size,
          file.buffer
        ]
      );
    }

    return result.rows[0];
}

assessmentsRouter.post('/', requireRoles('admin', 'personal'), assessmentPhotosUpload, asyncHandler(async (req, res) => {
  const payload = parseBody(assessmentSchema, req.body);
  const assessment = await withTransaction(async (client) => {
    await assertStudentAccess(client, req.user, payload.studentId);
    return insertAssessment(client, payload, req.user.role === 'personal' ? req.user.id : null, req.files);
  });

  res.status(201).json({ assessment });
}));

assessmentsRouter.post('/students/:studentId/requests', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const studentId = parseBody(idSchema, req.params.studentId);
  const request = await withTransaction(async (client) => {
    await assertStudentAccess(client, req.user, studentId);
    const student = await client.query("SELECT id FROM users WHERE id = $1 AND role = 'student'", [studentId]);
    if (!student.rowCount) throw notFound('Aluno nao encontrado.');
    await client.query(
      `DELETE FROM assessment_requests ar
       WHERE ar.student_id = $1 AND ar.completed_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM users u WHERE u.id = ar.requested_by
         AND (u.role = 'admin' OR (u.role = 'personal' AND EXISTS (
           SELECT 1 FROM trainer_students ts WHERE ts.student_id = ar.student_id AND ts.trainer_id = u.id
         )))
       )`,
      [studentId]
    );
    const result = await client.query(
      `INSERT INTO assessment_requests (student_id, requested_by) VALUES ($1, $2)
       ON CONFLICT (student_id) WHERE completed_at IS NULL
       DO UPDATE SET student_id = EXCLUDED.student_id RETURNING *`,
      [studentId, req.user.id]
    );
    return result.rows[0];
  });
  res.status(201).json({ request });
}));

assessmentsRouter.get('/students/:studentId/requests', asyncHandler(async (req, res) => {
  const studentId = parseBody(idSchema, req.params.studentId);
  const requests = await withTransaction(async (client) => {
    await assertStudentAccess(client, req.user, studentId);
    const result = await client.query(
      `SELECT ar.id, ar.created_at, u.name AS requested_by_name
       FROM assessment_requests ar JOIN users u ON u.id = ar.requested_by
       WHERE ar.student_id = $1 AND ar.completed_at IS NULL
         AND (u.role = 'admin' OR (u.role = 'personal' AND EXISTS (
           SELECT 1 FROM trainer_students ts WHERE ts.student_id = ar.student_id AND ts.trainer_id = ar.requested_by
         )))
       ORDER BY ar.created_at`,
      [studentId]
    );
    return result.rows;
  });
  res.json({ requests });
}));

assessmentsRouter.post('/requests/:id/submit', requireRoles('student'), assessmentPhotosUpload, asyncHandler(async (req, res) => {
  const requestId = parseBody(idSchema, req.params.id);
  const payload = parseBody(assessmentSchema, { ...req.body, studentId: req.user.id });
  const assessment = await withTransaction(async (client) => {
    const pending = await client.query(
      `SELECT ar.*, u.role AS requester_role FROM assessment_requests ar
       JOIN users u ON u.id = ar.requested_by
       WHERE ar.id = $1 AND ar.student_id = $2 AND ar.completed_at IS NULL
       FOR UPDATE OF ar`,
      [requestId, req.user.id]
    );
    if (!pending.rowCount) throw notFound('Avaliacao pendente nao encontrada ou ja enviada.');
    const request = pending.rows[0];
    if (request.requester_role !== 'admin') {
      if (request.requester_role !== 'personal') throw forbidden('Solicitante invalido.');
      await assertStudentAccess(client, { id: request.requested_by, role: 'personal' }, req.user.id);
    }
    const created = await insertAssessment(client, payload, request.requester_role === 'personal' ? request.requested_by : null, req.files);
    await client.query(
      'UPDATE assessment_requests SET assessment_id = $2, completed_at = now() WHERE id = $1',
      [requestId, created.id]
    );
    return created;
  });
  res.status(201).json({ assessment });
}));

assessmentsRouter.get('/students/:studentId', asyncHandler(async (req, res) => {
  await withTransaction(async (client) => assertStudentAccess(client, req.user, req.params.studentId));
  const result = await query(
    `SELECT a.*,
            COALESCE(
              json_agg(
                json_build_object(
                  'angle', ap.angle,
                  'path', ap.file_path,
                  'mimeType', ap.mime_type
                )
              ) FILTER (WHERE ap.id IS NOT NULL),
              '[]'
            ) AS photos
     FROM assessments a
     LEFT JOIN assessment_photos ap ON ap.assessment_id = a.id
     WHERE a.student_id = $1
     GROUP BY a.id
     ORDER BY a.assessment_date DESC, a.created_at DESC`,
    [req.params.studentId]
  );
  res.json({ assessments: result.rows });
}));

assessmentsRouter.get('/students/:studentId/progress', asyncHandler(async (req, res) => {
  await withTransaction(async (client) => assertStudentAccess(client, req.user, req.params.studentId));
  const result = await query(
    `SELECT assessment_date, weight_kg, waist_cm, abdomen_cm, hip_cm
     FROM assessments
     WHERE student_id = $1
     ORDER BY assessment_date`,
    [req.params.studentId]
  );
  res.json({ progress: result.rows });
}));

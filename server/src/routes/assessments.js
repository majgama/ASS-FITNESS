import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { assessmentPhotosUpload, relativeUploadPath } from '../middleware/upload.js';
import { assertStudentAccess } from '../services/accessService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { optionalNumber, parseBody } from '../utils/validators.js';

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

assessmentsRouter.post('/', requireRoles('admin', 'personal'), assessmentPhotosUpload, asyncHandler(async (req, res) => {
  const payload = parseBody(assessmentSchema, req.body);
  const assessment = await withTransaction(async (client) => {
    await assertStudentAccess(client, req.user, payload.studentId);
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
        req.user.role === 'personal' ? req.user.id : null,
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
      ['front', req.files?.front?.[0]],
      ['side', req.files?.side?.[0]],
      ['back', req.files?.back?.[0]]
    ];

    for (const [angle, file] of files) {
      if (!file) continue;
      await client.query(
        `INSERT INTO assessment_photos (assessment_id, angle, file_path, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5)`,
        [result.rows[0].id, angle, relativeUploadPath('assessments', file), file.mimetype, file.size]
      );
    }

    return result.rows[0];
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

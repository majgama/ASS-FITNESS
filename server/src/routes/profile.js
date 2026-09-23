import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { authRequired, toUser } from '../middleware/auth.js';
import { profilePhotoUpload } from '../middleware/upload.js';
import { changePassword } from '../services/authService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parseBody, passwordSchema } from '../utils/validators.js';

export const profileRouter = Router();

profileRouter.use(authRequired);

const profileSchema = z.object({
  name: z.string().trim().min(2).optional(),
  dateOfBirth: z.string().optional().nullable(),
  cref: z.string().trim().optional().nullable(),
  specialty: z.string().trim().optional().nullable(),
  objective: z.string().trim().optional().nullable(),
  restrictions: z.string().trim().optional().nullable(),
  nextAssessmentDate: z.string().optional().nullable()
});
import { randomUUID } from 'node:crypto';

profileRouter.patch('/me', profilePhotoUpload, asyncHandler(async (req, res) => {
  const payload = parseBody(profileSchema, req.body);
  const photoPath = req.file ? `profiles/${randomUUID()}` : null;

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users
       SET name = COALESCE($2, name),
           date_of_birth = COALESCE($3, date_of_birth),
           cref = COALESCE($4, cref),
           profile_photo_path = COALESCE($5, profile_photo_path),
           profile_photo_data = COALESCE($6, profile_photo_data),
           profile_photo_mime = COALESCE($7, profile_photo_mime)
       WHERE id = $1`,
      [
        req.user.id,
        payload.name,
        payload.dateOfBirth || null,
        payload.cref || null,
        photoPath,
        req.file?.buffer || null,
        req.file?.mimetype || null
      ]
    );

    if (req.user.role === 'personal') {
      await client.query(
        `UPDATE personal_profiles SET specialty = COALESCE($2, specialty) WHERE user_id = $1`,
        [req.user.id, payload.specialty || null]
      );
    }

    if (req.user.role === 'student') {
      await client.query(
        `UPDATE student_profiles
         SET objective = COALESCE($2, objective),
             restrictions = COALESCE($3, restrictions),
             next_assessment_date = COALESCE($4, next_assessment_date)
         WHERE user_id = $1`,
        [req.user.id, payload.objective || null, payload.restrictions || null, payload.nextAssessmentDate || null]
      );
    }
  });

  const updated = await query(
    `SELECT u.*, pp.specialty, pp.invite_code, sp.objective, sp.start_date, sp.restrictions,
            sp.next_assessment_date, sp.status AS student_status, sp.inactive_reason
     FROM users u
     LEFT JOIN personal_profiles pp ON pp.user_id = u.id
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     WHERE u.id = $1`,
    [req.user.id]
  );

  res.json({ user: toUser(updated.rows[0]) });
}));

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema
});

profileRouter.post('/me/password', asyncHandler(async (req, res) => {
  const payload = parseBody(passwordChangeSchema, req.body);
  await changePassword({
    userId: req.user.id,
    sessionId: req.session.id,
    currentPassword: payload.currentPassword,
    newPassword: payload.newPassword
  });
  res.status(204).send();
}));

import fs from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { exerciseMediaUpload, relativeUploadPath } from '../middleware/upload.js';
import { assertExerciseAccess } from '../services/accessService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { optionalNumber, parseBody } from '../utils/validators.js';

export const exercisesRouter = Router();

exercisesRouter.use(authRequired);

function validateYoutubeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowed = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
    if (!allowed.includes(url.hostname.toLowerCase())) {
      throw badRequest('Link do YouTube deve usar dominio youtube.com ou youtu.be.');
    }
    return url.toString();
  } catch (error) {
    if (error.statusCode) throw error;
    throw badRequest('Link do YouTube invalido.');
  }
}

async function cleanupUploads(files) {
  const allFiles = Object.values(files || {}).flat();
  await Promise.all(allFiles.map((file) => fs.unlink(file.path).catch(() => null)));
}

function validateExerciseMedia(req) {
  const video = req.files?.video?.[0];
  const gif = req.files?.gif?.[0];
  const audio = req.files?.audio?.[0];
  const youtubeUrl = req.body.youtubeUrl?.trim();
  const videoDuration = optionalNumber(req.body.videoDurationSeconds);
  const audioDuration = optionalNumber(req.body.audioDurationSeconds);

  if ([youtubeUrl, video, gif].filter(Boolean).length > 1) {
    throw badRequest('Escolha apenas uma midia: GIF, YouTube ou video.');
  }

  if (video && video.size > 8 * 1024 * 1024) throw badRequest('Videos devem ter ate 8 MB.');
  if (gif && gif.size > 8 * 1024 * 1024) throw badRequest('GIFs devem ter ate 8 MB.');
  if (audio && audio.size > 3 * 1024 * 1024) throw badRequest('Audios devem ter ate 3 MB.');
  if (video && videoDuration !== null && videoDuration > 5) throw badRequest('Videos devem ter ate 5 segundos.');
  if (audio && audioDuration !== null && audioDuration > 60) throw badRequest('Audios devem ter ate 60 segundos.');

  return { video, gif, audio, videoDuration, audioDuration };
}

function visibilityFor(user, requestedVisibility) {
  if (user.role === 'admin' && requestedVisibility === 'public') {
    return { visibility: 'public', ownerId: null };
  }

  if (requestedVisibility === 'public' && user.role !== 'admin') {
    throw forbidden('Apenas administrador pode criar exercicio publico.');
  }

  return { visibility: 'private', ownerId: user.id };
}

exercisesRouter.get('/', asyncHandler(async (req, res) => {
  const params = [];
  let where = "e.visibility = 'public'";

  if (req.user.role === 'admin') {
    where = 'true';
  } else if (req.user.role === 'personal') {
    params.push(req.user.id);
    where = `(e.visibility = 'public' OR e.owner_id = $${params.length})`;
  } else if (req.user.role === 'student') {
    params.push(req.user.id);
    where = `(e.visibility = 'public' OR EXISTS (
      SELECT 1 FROM trainer_students ts
      WHERE ts.student_id = $${params.length} AND ts.trainer_id = e.owner_id
    ))`;
  }

  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    where += ` AND (e.name ILIKE $${params.length} OR e.muscle_group ILIKE $${params.length})`;
  }

  const result = await query(
    `SELECT e.*, u.name AS owner_name
     FROM exercises e
     LEFT JOIN users u ON u.id = e.owner_id
     WHERE ${where}
     ORDER BY e.created_at DESC`,
    params
  );
  res.json({ exercises: result.rows });
}));

const exerciseSchema = z.object({
  name: z.string().trim().min(2),
  muscleGroup: z.string().trim().optional().nullable(),
  defaultSets: z.string().trim().optional().nullable(),
  defaultRepetitions: z.string().trim().optional().nullable(),
  defaultLoad: z.string().trim().optional().nullable(),
  defaultRestSeconds: z.coerce.number().int().nonnegative().optional().nullable(),
  observations: z.string().trim().optional().nullable(),
  youtubeUrl: z.string().trim().optional().nullable(),
  visibility: z.enum(['public', 'private']).default('private'),
  videoDurationSeconds: z.coerce.number().optional().nullable(),
  audioDurationSeconds: z.coerce.number().optional().nullable()
});

exercisesRouter.post('/', requireRoles('admin', 'personal'), exerciseMediaUpload, asyncHandler(async (req, res) => {
  try {
    const payload = parseBody(exerciseSchema, req.body);
    const media = validateExerciseMedia(req);
    const youtubeUrl = validateYoutubeUrl(payload.youtubeUrl);
    const { visibility, ownerId } = visibilityFor(req.user, payload.visibility);

    const result = await query(
      `INSERT INTO exercises (
        name, muscle_group, default_sets, default_repetitions, default_load,
        default_rest_seconds, observations, youtube_url,
        video_path, video_mime, video_size_bytes, video_duration_seconds,
        gif_path, gif_mime, gif_size_bytes,
        audio_path, audio_mime, audio_size_bytes, audio_duration_seconds,
        visibility, owner_id, created_by
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22
      )
      RETURNING *`,
      [
        payload.name,
        payload.muscleGroup || null,
        payload.defaultSets || null,
        payload.defaultRepetitions || null,
        payload.defaultLoad || null,
        payload.defaultRestSeconds || null,
        payload.observations || null,
        youtubeUrl,
        relativeUploadPath('exercises', media.video),
        media.video?.mimetype || null,
        media.video?.size || null,
        media.videoDuration,
        relativeUploadPath('exercises', media.gif),
        media.gif?.mimetype || null,
        media.gif?.size || null,
        relativeUploadPath('exercises', media.audio),
        media.audio?.mimetype || null,
        media.audio?.size || null,
        media.audioDuration,
        visibility,
        ownerId,
        req.user.id
      ]
    );

    res.status(201).json({ exercise: result.rows[0] });
  } catch (error) {
    await cleanupUploads(req.files);
    throw error;
  }
}));

exercisesRouter.get('/:id', asyncHandler(async (req, res) => {
  const exercise = await assertExerciseAccess({ query }, req.user, req.params.id);
  res.json({ exercise });
}));

exercisesRouter.delete('/:id', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const exercise = await assertExerciseAccess({ query }, req.user, req.params.id);
  if (exercise.visibility === 'public' && req.user.role !== 'admin') {
    throw forbidden('Apenas administrador pode remover exercicio publico.');
  }

  const deleted = await query('DELETE FROM exercises WHERE id = $1 RETURNING *', [req.params.id]);
  if (deleted.rowCount === 0) throw notFound('Exercicio nao encontrado.');
  res.status(204).send();
}));

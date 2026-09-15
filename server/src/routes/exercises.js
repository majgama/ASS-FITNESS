import fs from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
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

const updateExerciseSchema = z.object({
  name: z.string().trim().min(2).optional(),
  muscleGroup: z.string().trim().optional().nullable(),
  defaultSets: z.string().trim().optional().nullable(),
  defaultRepetitions: z.string().trim().optional().nullable(),
  defaultLoad: z.string().trim().optional().nullable(),
  defaultRestSeconds: z.coerce.number().int().nonnegative().optional().nullable(),
  observations: z.string().trim().optional().nullable(),
  youtubeUrl: z.string().trim().optional().nullable(),
  visibility: z.enum(['public', 'private']).optional(),
  removeMedia: z.coerce.boolean().optional(),
  videoDurationSeconds: z.coerce.number().optional().nullable(),
  audioDurationSeconds: z.coerce.number().optional().nullable()
});

exercisesRouter.patch('/:id', requireRoles('admin', 'personal'), exerciseMediaUpload, asyncHandler(async (req, res) => {
  try {
    const existing = await assertExerciseAccess({ query }, req.user, req.params.id);
    if (existing.visibility === 'public' && req.user.role !== 'admin') {
      throw forbidden('Apenas administrador pode editar exercicio publico.');
    }
    if (existing.visibility === 'private' && req.user.role !== 'admin' && existing.owner_id !== req.user.id) {
      throw forbidden('Voce nao pode editar este exercicio.');
    }

    const payload = parseBody(updateExerciseSchema, req.body);
    const media = validateExerciseMedia(req);
    const youtubeUrl = payload.youtubeUrl !== undefined ? validateYoutubeUrl(payload.youtubeUrl) : undefined;
    let visibility = undefined;
    let ownerId = undefined;
    if (payload.visibility) {
      const v = visibilityFor(req.user, payload.visibility);
      visibility = v.visibility;
      ownerId = v.ownerId;
    }

    let videoPath = media.video ? relativeUploadPath('exercises', media.video) : undefined;
    let videoMime = media.video ? media.video.mimetype : undefined;
    let videoSize = media.video ? media.video.size : undefined;
    let videoDuration = media.videoDuration !== null ? media.videoDuration : undefined;

    let gifPath = media.gif ? relativeUploadPath('exercises', media.gif) : undefined;
    let gifMime = media.gif ? media.gif.mimetype : undefined;
    let gifSize = media.gif ? media.gif.size : undefined;

    let audioPath = media.audio ? relativeUploadPath('exercises', media.audio) : undefined;
    let audioMime = media.audio ? media.audio.mimetype : undefined;
    let audioSize = media.audio ? media.audio.size : undefined;
    let audioDuration = media.audioDuration !== null ? media.audioDuration : undefined;

    if (payload.removeMedia) {
      videoPath = null;
      videoMime = null;
      videoSize = null;
      videoDuration = null;
      gifPath = null;
      gifMime = null;
      gifSize = null;
      if (youtubeUrl === undefined) {
        // clear youtube as well if removing media and no new youtube specified
      }
    }

    const result = await query(
      `UPDATE exercises
       SET name = COALESCE($2, name),
           muscle_group = CASE WHEN $3::boolean THEN $4 ELSE muscle_group END,
           default_sets = CASE WHEN $5::boolean THEN $6 ELSE default_sets END,
           default_repetitions = CASE WHEN $7::boolean THEN $8 ELSE default_repetitions END,
           default_load = CASE WHEN $9::boolean THEN $10 ELSE default_load END,
           default_rest_seconds = CASE WHEN $11::boolean THEN $12 ELSE default_rest_seconds END,
           observations = CASE WHEN $13::boolean THEN $14 ELSE observations END,
           youtube_url = CASE WHEN $15::boolean THEN $16 ELSE youtube_url END,
           video_path = CASE WHEN $17::boolean THEN $18 ELSE video_path END,
           video_mime = CASE WHEN $17::boolean THEN $19 ELSE video_mime END,
           video_size_bytes = CASE WHEN $17::boolean THEN $20 ELSE video_size_bytes END,
           video_duration_seconds = CASE WHEN $17::boolean THEN $21 ELSE video_duration_seconds END,
           gif_path = CASE WHEN $22::boolean THEN $23 ELSE gif_path END,
           gif_mime = CASE WHEN $22::boolean THEN $24 ELSE gif_mime END,
           gif_size_bytes = CASE WHEN $22::boolean THEN $25 ELSE gif_size_bytes END,
           audio_path = CASE WHEN $26::boolean THEN $27 ELSE audio_path END,
           audio_mime = CASE WHEN $26::boolean THEN $28 ELSE audio_mime END,
           audio_size_bytes = CASE WHEN $26::boolean THEN $29 ELSE audio_size_bytes END,
           audio_duration_seconds = CASE WHEN $26::boolean THEN $30 ELSE audio_duration_seconds END,
           visibility = COALESCE($31, visibility),
           owner_id = CASE WHEN $31 IS NOT NULL THEN $32 ELSE owner_id END
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        payload.name || null,
        payload.muscleGroup !== undefined,
        payload.muscleGroup || null,
        payload.defaultSets !== undefined,
        payload.defaultSets || null,
        payload.defaultRepetitions !== undefined,
        payload.defaultRepetitions || null,
        payload.defaultLoad !== undefined,
        payload.defaultLoad || null,
        payload.defaultRestSeconds !== undefined,
        payload.defaultRestSeconds ?? null,
        payload.observations !== undefined,
        payload.observations || null,
        youtubeUrl !== undefined || payload.removeMedia,
        youtubeUrl || null,
        videoPath !== undefined || payload.removeMedia,
        videoPath || null,
        videoMime || null,
        videoSize || null,
        videoDuration ?? null,
        gifPath !== undefined || payload.removeMedia,
        gifPath || null,
        gifMime || null,
        gifSize || null,
        audioPath !== undefined,
        audioPath || null,
        audioMime || null,
        audioSize || null,
        audioDuration ?? null,
        visibility || null,
        ownerId || null
      ]
    );

    res.json({ exercise: result.rows[0] });
  } catch (error) {
    await cleanupUploads(req.files);
    throw error;
  }
}));

exercisesRouter.delete('/:id', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const exercise = await assertExerciseAccess({ query }, req.user, req.params.id);
  if (exercise.visibility === 'public' && req.user.role !== 'admin') {
    throw forbidden('Apenas administrador pode remover exercicio publico.');
  }
  if (exercise.visibility === 'private' && req.user.role !== 'admin' && exercise.owner_id !== req.user.id) {
    throw forbidden('Voce nao pode remover este exercicio.');
  }

  await withTransaction(async (client) => {
    await client.query('DELETE FROM daily_workout_exercises WHERE exercise_id = $1', [req.params.id]);
    const deleted = await client.query('DELETE FROM exercises WHERE id = $1 RETURNING *', [req.params.id]);
    if (deleted.rowCount === 0) throw notFound('Exercicio nao encontrado.');
  });
  res.status(204).send();
}));

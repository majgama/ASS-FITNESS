import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/errors.js';
import { idSchema, parseBody } from '../utils/validators.js';
import { extractYoutubeVideoId } from '../utils/youtube.js';

export const tutorialsRouter = Router();

tutorialsRouter.use(authRequired);

const tutorialSchema = z.object({
  title: z.string().trim().min(2, 'Informe um titulo com pelo menos 2 caracteres.').max(150),
  description: z.string().trim().max(3000).optional().nullable(),
  youtube: z.string().trim().min(1, 'Informe o link ou o frame do YouTube.').max(2000)
});

function youtubeVideoId(value) {
  const videoId = extractYoutubeVideoId(value);
  if (!videoId) throw badRequest('Informe um link ou frame valido do YouTube.');
  return videoId;
}

const tutorialColumns = 'id, title, description, youtube_video_id AS "youtubeVideoId", created_at AS "createdAt", updated_at AS "updatedAt"';

tutorialsRouter.get('/', requireRoles('admin', 'personal'), asyncHandler(async (req, res) => {
  const result = await query(`SELECT ${tutorialColumns} FROM tutorials ORDER BY created_at DESC, id`);
  res.json({ tutorials: result.rows });
}));

tutorialsRouter.post('/', requireRoles('admin'), asyncHandler(async (req, res) => {
  const payload = parseBody(tutorialSchema, req.body);
  const videoId = youtubeVideoId(payload.youtube);
  const result = await query(
    `INSERT INTO tutorials (title, description, youtube_video_id, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING ${tutorialColumns}`,
    [payload.title, payload.description || null, videoId, req.user.id]
  );
  res.status(201).json({ tutorial: result.rows[0] });
}));

tutorialsRouter.put('/:id', requireRoles('admin'), asyncHandler(async (req, res) => {
  const id = parseBody(idSchema, req.params.id);
  const payload = parseBody(tutorialSchema, req.body);
  const videoId = youtubeVideoId(payload.youtube);
  const result = await query(
    `UPDATE tutorials
     SET title = $2, description = $3, youtube_video_id = $4
     WHERE id = $1
     RETURNING ${tutorialColumns}`,
    [id, payload.title, payload.description || null, videoId]
  );
  if (result.rowCount === 0) throw notFound('Tutorial nao encontrado.');
  res.json({ tutorial: result.rows[0] });
}));

tutorialsRouter.delete('/:id', requireRoles('admin'), asyncHandler(async (req, res) => {
  const id = parseBody(idSchema, req.params.id);
  const result = await query('DELETE FROM tutorials WHERE id = $1', [id]);
  if (result.rowCount === 0) throw notFound('Tutorial nao encontrado.');
  res.status(204).send();
}));

import path from 'node:path';
import { Router } from 'express';
import { env } from '../config/env.js';
import { query, withTransaction } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';
import { assertExerciseAccess, assertStudentAccess } from '../services/accessService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound } from '../utils/errors.js';

export const filesRouter = Router();

filesRouter.use(authRequired);

function filePath(category, filename) {
  const resolved = path.resolve(env.uploadDir, category, filename);
  const base = path.resolve(env.uploadDir, category);
  if (!resolved.startsWith(base)) {
    throw forbidden('Caminho de arquivo invalido.');
  }
  return resolved;
}

async function canAccessProfile(user, relativePath) {
  const owner = await query('SELECT id, role FROM users WHERE profile_photo_path = $1', [relativePath]);
  if (owner.rowCount === 0) throw notFound('Arquivo nao encontrado.');

  const target = owner.rows[0];
  if (user.role === 'admin' || user.id === target.id) return true;

  if (user.role === 'personal' && target.role === 'student') {
    const linked = await query(
      'SELECT 1 FROM trainer_students WHERE trainer_id = $1 AND student_id = $2',
      [user.id, target.id]
    );
    if (linked.rowCount > 0) return true;
  }

  if (user.role === 'student' && target.role === 'personal') {
    const linked = await query(
      'SELECT 1 FROM trainer_students WHERE trainer_id = $1 AND student_id = $2',
      [target.id, user.id]
    );
    if (linked.rowCount > 0) return true;
  }

  throw forbidden('Voce nao tem acesso a este arquivo.');
}

async function canAccessAssessment(user, relativePath) {
  const result = await query(
    `SELECT a.student_id
     FROM assessment_photos ap
     JOIN assessments a ON a.id = ap.assessment_id
     WHERE ap.file_path = $1`,
    [relativePath]
  );
  if (result.rowCount === 0) throw notFound('Arquivo nao encontrado.');
  await withTransaction(async (client) => assertStudentAccess(client, user, result.rows[0].student_id));
}

async function canAccessExercise(user, relativePath) {
  const result = await query(
    `SELECT id FROM exercises
     WHERE video_path = $1 OR gif_path = $1 OR audio_path = $1`,
    [relativePath]
  );
  if (result.rowCount === 0) throw notFound('Arquivo nao encontrado.');
  await assertExerciseAccess({ query }, user, result.rows[0].id);
}

filesRouter.get('/:category/:filename', asyncHandler(async (req, res) => {
  const { category, filename } = req.params;
  const allowed = ['profiles', 'assessments', 'exercises'];
  if (!allowed.includes(category)) throw notFound('Arquivo nao encontrado.');

  const relativePath = `${category}/${filename}`;
  if (category === 'profiles') await canAccessProfile(req.user, relativePath);
  if (category === 'assessments') await canAccessAssessment(req.user, relativePath);
  if (category === 'exercises') await canAccessExercise(req.user, relativePath);

  res.sendFile(filePath(category, filename));
}));

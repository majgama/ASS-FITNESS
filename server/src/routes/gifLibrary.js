import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound } from '../utils/errors.js';
import { parseBody } from '../utils/validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const catalogPath = path.resolve(__dirname, '..', 'data', 'gif-catalog.json');

let catalog = [];
try {
  catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
} catch {
  catalog = [];
}
const catalogById = new Map(catalog.map((item) => [item.id, item]));

export const gifLibraryRouter = Router();

gifLibraryRouter.use(authRequired);

async function getOverridesById(ids) {
  if (ids.length === 0) return new Map();
  const result = await query(
    `SELECT gif_id, name_pt, muscle_group_pt, hidden FROM gif_library_overrides WHERE gif_id = ANY($1)`,
    [ids]
  );
  return new Map(result.rows.map((row) => [row.gif_id, row]));
}

async function getFavoriteIds(userId) {
  const result = await query('SELECT gif_id FROM gif_library_favorites WHERE user_id = $1', [userId]);
  return new Set(result.rows.map((row) => row.gif_id));
}

async function getTranslationUpdatesById(ids) {
  if (ids.length === 0) return new Map();
  const result = await query(
    'SELECT gif_id, translated_at FROM gif_library_translation_updates WHERE gif_id = ANY($1)',
    [ids]
  );
  return new Map(result.rows.map((row) => [row.gif_id, row.translated_at]));
}

function applyOverride(item, override) {
  return {
    id: item.id,
    relativePath: item.relativePath,
    gender: item.gender,
    environment: item.environment,
    categoryPath: item.categoryPath,
    name: override?.name_pt || item.namePt || item.nameEn,
    muscleGroup: override?.muscle_group_pt || item.muscleGroupPt || null,
    hidden: override?.hidden || false
  };
}

gifLibraryRouter.get('/filters', asyncHandler(async (req, res) => {
  const { gender, environment, categoryPath } = req.query;
  const parentSegments = categoryPath ? String(categoryPath).split('/').filter(Boolean) : [];

  let scoped = catalog;
  if (gender) scoped = scoped.filter((item) => item.gender === gender);
  if (environment) scoped = scoped.filter((item) => item.environment === environment);
  if (parentSegments.length > 0) {
    scoped = scoped.filter((item) => parentSegments.every((seg, idx) => item.categoryPath[idx] === seg));
  }

  const genders = [...new Set(catalog.map((item) => item.gender))].filter(Boolean).sort();
  const environments = [...new Set(
    catalog.filter((item) => !gender || item.gender === gender).map((item) => item.environment)
  )].filter(Boolean).sort();
  const nextLevel = [...new Set(scoped.map((item) => item.categoryPath[parentSegments.length]))]
    .filter(Boolean)
    .sort();

  res.json({ genders, environments, categoryOptions: nextLevel });
}));

const listQuerySchema = z.object({
  gender: z.string().optional(),
  environment: z.string().optional(),
  categoryPath: z.string().optional(),
  search: z.string().optional(),
  favoritesOnly: z.preprocess((v) => v === 'true' || v === true || v === '1', z.boolean()).optional(),
  translationStatus: z.enum(['updated', 'pending']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30)
});

gifLibraryRouter.get('/', asyncHandler(async (req, res) => {
  const filters = parseBody(listQuerySchema, req.query);
  const parentSegments = filters.categoryPath ? filters.categoryPath.split('/').filter(Boolean) : [];

  let scoped = catalog;
  if (filters.gender) scoped = scoped.filter((item) => item.gender === filters.gender);
  if (filters.environment) scoped = scoped.filter((item) => item.environment === filters.environment);
  if (parentSegments.length > 0) {
    scoped = scoped.filter((item) => parentSegments.every((seg, idx) => item.categoryPath[idx] === seg));
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    scoped = scoped.filter((item) =>
      item.namePt.toLowerCase().includes(q) ||
      item.nameEn.toLowerCase().includes(q) ||
      (item.muscleGroupPt || '').toLowerCase().includes(q)
    );
  }

  const ids = scoped.map((item) => item.id);
  const [overrides, favoriteIds, translationUpdates] = await Promise.all([
    getOverridesById(ids),
    getFavoriteIds(req.user.id),
    getTranslationUpdatesById(ids)
  ]);

  let mapped = scoped.map((item) => ({
    ...applyOverride(item, overrides.get(item.id)),
    translatedAt: translationUpdates.get(item.id) || null
  }));
  if (req.user.role !== 'admin') mapped = mapped.filter((item) => !item.hidden);
  if (filters.favoritesOnly) mapped = mapped.filter((item) => favoriteIds.has(item.id));
  if (filters.translationStatus === 'updated') mapped = mapped.filter((item) => item.translatedAt);
  if (filters.translationStatus === 'pending') mapped = mapped.filter((item) => !item.translatedAt);

  mapped = mapped.map((item) => ({ ...item, isFavorite: favoriteIds.has(item.id) }));
  mapped.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const total = mapped.length;
  const start = (filters.page - 1) * filters.pageSize;
  const items = mapped.slice(start, start + filters.pageSize);

  res.json({ items, total, page: filters.page, pageSize: filters.pageSize });
}));

gifLibraryRouter.get('/file/:id', asyncHandler(async (req, res) => {
  const item = catalogById.get(req.params.id);
  if (!item) throw notFound('Animacao nao encontrada.');

  if (env.gifLibraryPublicUrl) {
    const baseUrl = env.gifLibraryPublicUrl.replace(/\/+$/, '');
    const remoteUrl = `${baseUrl}/${item.relativePath.split('/').map(encodeURIComponent).join('/')}`;
    const remote = await fetch(remoteUrl);
    if (!remote.ok || !remote.body) throw notFound('Arquivo nao encontrado.');
    res.status(remote.status);
    const contentType = remote.headers.get('content-type') || 'image/gif';
    res.setHeader('Content-Type', contentType);
    const contentLength = remote.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    for await (const chunk of remote.body) res.write(chunk);
    res.end();
    return;
  }

  const resolved = path.resolve(env.gifLibraryDir, item.relativePath);
  const base = path.resolve(env.gifLibraryDir);
  if (!resolved.startsWith(base)) throw forbidden('Caminho invalido.');
  if (!fs.existsSync(resolved)) throw notFound('Arquivo nao encontrado.');

  res.sendFile(resolved);
}));

gifLibraryRouter.post('/:id/favorite', asyncHandler(async (req, res) => {
  const item = catalogById.get(req.params.id);
  if (!item) throw notFound('Animacao nao encontrada.');

  const existing = await query(
    'SELECT 1 FROM gif_library_favorites WHERE user_id = $1 AND gif_id = $2',
    [req.user.id, req.params.id]
  );

  if (existing.rowCount > 0) {
    await query('DELETE FROM gif_library_favorites WHERE user_id = $1 AND gif_id = $2', [req.user.id, req.params.id]);
    res.json({ isFavorite: false });
    return;
  }

  await query(
    'INSERT INTO gif_library_favorites (user_id, gif_id) VALUES ($1, $2)',
    [req.user.id, req.params.id]
  );
  res.json({ isFavorite: true });
}));

const overrideSchema = z.object({
  name: z.string().trim().min(2).optional(),
  muscleGroup: z.string().trim().optional().nullable()
});

gifLibraryRouter.patch('/:id', requireRoles('admin'), asyncHandler(async (req, res) => {
  const item = catalogById.get(req.params.id);
  if (!item) throw notFound('Animacao nao encontrada.');
  const payload = parseBody(overrideSchema, req.body);

  const result = await query(
    `INSERT INTO gif_library_overrides (gif_id, name_pt, muscle_group_pt, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (gif_id) DO UPDATE SET
       name_pt = COALESCE($2, gif_library_overrides.name_pt),
       muscle_group_pt = CASE WHEN $3::boolean THEN $5 ELSE gif_library_overrides.muscle_group_pt END,
       updated_by = $4,
       updated_at = now()
     RETURNING *`,
    [req.params.id, payload.name || null, payload.muscleGroup !== undefined, req.user.id, payload.muscleGroup || null]
  );

  res.json({ override: applyOverride(item, result.rows[0]) });
}));

gifLibraryRouter.delete('/:id', requireRoles('admin'), asyncHandler(async (req, res) => {
  const item = catalogById.get(req.params.id);
  if (!item) throw notFound('Animacao nao encontrada.');

  await query(
    `INSERT INTO gif_library_overrides (gif_id, hidden, updated_by)
     VALUES ($1, true, $2)
     ON CONFLICT (gif_id) DO UPDATE SET hidden = true, updated_by = $2, updated_at = now()`,
    [req.params.id, req.user.id]
  );

  res.status(204).send();
}));

gifLibraryRouter.post('/:id/restore', requireRoles('admin'), asyncHandler(async (req, res) => {
  const item = catalogById.get(req.params.id);
  if (!item) throw notFound('Animacao nao encontrada.');

  await query('UPDATE gif_library_overrides SET hidden = false, updated_by = $2, updated_at = now() WHERE gif_id = $1', [req.params.id, req.user.id]);
  res.status(204).send();
}));

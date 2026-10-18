import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
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


export const gifLibraryRouter = Router();

gifLibraryRouter.use(authRequired);

const uploadGif = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, fieldSize: 1000 },
  fileFilter: (req, file, callback) => callback(
    file.mimetype === 'image/gif' && path.extname(file.originalname).toLowerCase() === '.gif'
      ? null : badRequest('Selecione um arquivo GIF válido.'), true
  )
}).single('gif');
const uploadSchema = z.object({
  name: z.string().trim().min(2).max(200),
  gender: z.enum(['FEMININO', 'MASCULINO']),
  environment: z.enum(['ACADEMIA', 'FUNCIONAL']),
  muscleGroup: z.string().trim().min(2).max(100)
});

gifLibraryRouter.post('/upload', requireRoles('admin'), (req, res, next) => {
  uploadGif(req, res, (error) => {
    if (error?.code === 'LIMIT_FILE_SIZE') return next(badRequest('O GIF deve ter no máximo 10 MB.'));
    if (error instanceof multer.MulterError) return next(badRequest('Envie somente um GIF com os dados do exercício.'));
    next(error);
  });
}, asyncHandler(async (req, res) => {
  const payload = parseBody(uploadSchema, req.body);
  const file = req.file;
  if (!file) throw badRequest('Selecione um arquivo GIF.');
  const header = file.buffer.subarray(0, 6).toString('ascii');
  if (file.size < 14 || !['GIF87a', 'GIF89a'].includes(header) ||
      !file.buffer.readUInt16LE(6) || !file.buffer.readUInt16LE(8) || file.buffer.at(-1) !== 0x3b) {
    throw badRequest('O arquivo enviado não é um GIF válido.');
  }
  const id = randomUUID();
  await query(
    `INSERT INTO gif_library_uploads (id, name_pt, gender, environment, muscle_group_pt, file_data, size_bytes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, payload.name, payload.gender, payload.environment, payload.muscleGroup, file.buffer, file.size, req.user.id]
  );
  res.status(201).json({ id, message: 'GIF adicionado à biblioteca.' });
}));

gifLibraryRouter.use(asyncHandler(async (req, res, next) => {
  const result = await query('SELECT id, name_pt, gender, environment, muscle_group_pt FROM gif_library_uploads');
  const uploaded = result.rows.map((row) => ({
    id: row.id, namePt: row.name_pt, nameEn: '', gender: row.gender, environment: row.environment,
    muscleGroupPt: row.muscle_group_pt, categoryPath: [row.muscle_group_pt], relativePath: row.id, uploaded: true
  }));
  req.gifCatalog = [...catalog, ...uploaded];
  req.gifCatalogById = new Map(req.gifCatalog.map((item) => [item.id, item]));
  next();
}));

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
    muscleGroup: override?.muscle_group_pt && !['true', 'false'].includes(override.muscle_group_pt)
      ? override.muscle_group_pt : item.muscleGroupPt || null,
    hidden: override?.hidden || false
  };
}

const multipleValues = z.preprocess(
  (value) => value === undefined ? [] : Array.isArray(value) ? value : [value],
  z.array(z.string().min(1)).max(100)
);
const filterQuerySchema = z.object({
  gender: z.string().optional(),
  environment: z.string().optional(),
  categoryPath: z.string().optional(),
  muscleGroup: z.string().optional(),
  genders: multipleValues,
  environments: multipleValues,
  categories: multipleValues,
  subcategories: multipleValues,
  muscleGroups: multipleValues
});

function normalizeCategory(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function filterCatalog(filters, excluded = '', source = catalog) {
  const parentSegments = filters.categoryPath ? filters.categoryPath.split('/').filter(Boolean) : [];
  return source.filter((item) => {
    if (excluded !== 'genders' && (filters.gender && item.gender !== filters.gender ||
      filters.genders.length && !filters.genders.includes(item.gender))) return false;
    if (excluded !== 'environments' && (filters.environment && item.environment !== filters.environment ||
      filters.environments.length && !filters.environments.includes(item.environment))) return false;
    if (excluded !== 'categories' && filters.categories.length &&
      !filters.categories.includes(normalizeCategory(item.categoryPath[0] || ''))) return false;
    if (excluded !== 'subcategories' && filters.subcategories.length &&
      !item.categoryPath.slice(1).some((value) => filters.subcategories.includes(value))) return false;
    if (parentSegments.length && !parentSegments.every((segment, index) => item.categoryPath[index] === segment)) return false;
    if (excluded !== 'muscleGroups' && (filters.muscleGroup && item.muscleGroupPt !== filters.muscleGroup ||
      filters.muscleGroups.length && !filters.muscleGroups.includes(item.muscleGroupPt))) return false;
    return true;
  });
}

gifLibraryRouter.get('/filters', asyncHandler(async (req, res) => {
  const catalog = req.gifCatalog;
  const filters = parseBody(filterQuerySchema, req.query);
  const parentSegments = filters.categoryPath ? filters.categoryPath.split('/').filter(Boolean) : [];
  const overrides = await getOverridesById(catalog.map((item) => item.id));
  const effectiveCatalog = catalog.map((item) => ({
    ...item, muscleGroupPt: applyOverride(item, overrides.get(item.id)).muscleGroup
  }));
  const scoped = filterCatalog(filters, 'muscleGroups', effectiveCatalog);
  const muscleGroups = [...new Set(scoped.map((item) => item.muscleGroupPt))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const genders = [...new Set(catalog.map((item) => item.gender))].filter(Boolean).sort();
  const environments = [...new Set(catalog.map((item) => item.environment))].filter(Boolean).sort();
  const categories = [...new Set(filterCatalog(filters, 'categories', effectiveCatalog).map((item) => normalizeCategory(item.categoryPath[0] || '')))]
    .filter(Boolean).sort();
  const subcategories = [...new Set(filterCatalog(filters, 'subcategories', effectiveCatalog).flatMap((item) => item.categoryPath.slice(1)))]
    .filter(Boolean).sort();
  const nextLevel = [...new Set(filterCatalog(filters, '', effectiveCatalog).map((item) => item.categoryPath[parentSegments.length]))]
    .filter(Boolean)
    .sort();
  res.json({ genders, environments, categories, subcategories, categoryOptions: nextLevel, muscleGroups });
}));

const listQuerySchema = filterQuerySchema.extend({
  search: z.string().optional(),
  favoritesOnly: z.preprocess((v) => v === 'true' || v === true || v === '1', z.boolean()).optional(),
  translationStatus: z.enum(['updated', 'pending']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30)
});

gifLibraryRouter.get('/', asyncHandler(async (req, res) => {
  const filters = parseBody(listQuerySchema, req.query);
  const scoped = filterCatalog(filters, 'muscleGroups', req.gifCatalog);

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
  if (filters.muscleGroup) mapped = mapped.filter((item) => item.muscleGroup === filters.muscleGroup);
  if (filters.muscleGroups.length) mapped = mapped.filter((item) => filters.muscleGroups.includes(item.muscleGroup));
  if (filters.search) {
    const q = filters.search.trim().toLowerCase();
    mapped = mapped.filter((item) =>
      item.name.toLowerCase().includes(q) ||
      (req.gifCatalogById.get(item.id).nameEn || '').toLowerCase().includes(q) ||
      (item.muscleGroup || '').toLowerCase().includes(q)
    );
  }
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
  const item = req.gifCatalogById.get(req.params.id);
  if (!item) throw notFound('Animacao nao encontrada.');

  if (item.uploaded) {
    const result = await query('SELECT file_data FROM gif_library_uploads WHERE id = $1', [item.id]);
    if (!result.rows[0]?.file_data) throw notFound('Arquivo não encontrado.');
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(result.rows[0].file_data);
    return;
  }

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
  const item = req.gifCatalogById.get(req.params.id);
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
  const item = req.gifCatalogById.get(req.params.id);
  if (!item) throw notFound('Animacao nao encontrada.');
  const payload = parseBody(overrideSchema, req.body);

  const result = await query(
    `INSERT INTO gif_library_overrides (gif_id, name_pt, muscle_group_pt, updated_by)
     VALUES ($1, $2, $5, $4)
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
  const item = req.gifCatalogById.get(req.params.id);
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
  const item = req.gifCatalogById.get(req.params.id);
  if (!item) throw notFound('Animacao nao encontrada.');

  await query('UPDATE gif_library_overrides SET hidden = false, updated_by = $2, updated_at = now() WHERE gif_id = $1', [req.params.id, req.user.id]);
  res.status(204).send();
}));

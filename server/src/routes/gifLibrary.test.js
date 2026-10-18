import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, mock, test } from 'node:test';
import express from 'express';
import { errorHandler } from '../middleware/errorHandler.js';

const catalog = JSON.parse(readFileSync(new URL('../data/gif-catalog.json', import.meta.url), 'utf8'));
const item = catalog[0];
const overrides = new Map();
let server;
let baseUrl;

before(async () => {
  mock.module('../middleware/auth.js', { namedExports: {
    authRequired: (req, res, next) => { req.user = { id: 'admin', role: 'admin' }; next(); },
    requireRoles: () => (req, res, next) => next()
  } });
  mock.module('../db/pool.js', { namedExports: { query: async (sql, params) => {
    if (sql.includes('INSERT INTO gif_library_overrides')) {
      // Resolve the actual INSERT placeholders to catch accidental boolean storage.
      const values = sql.match(/VALUES \(([^)]+)\)/)[1].split(',').map((value) => params[Number(value.trim().slice(1)) - 1]);
      const previous = overrides.get(params[0]);
      const row = previous ? {
        ...previous, name_pt: params[1] ?? previous.name_pt,
        muscle_group_pt: params[2] ? params[4] : previous.muscle_group_pt
      } : { gif_id: values[0], name_pt: values[1], muscle_group_pt: values[2] };
      overrides.set(params[0], row);
      return { rows: [row] };
    }
    if (sql.includes('FROM gif_library_overrides')) return { rows: [...overrides.values()].filter((row) => params[0].includes(row.gif_id)) };
    return { rows: [] };
  } } });
  const { gifLibraryRouter } = await import('./gifLibrary.js');
  const app = express();
  app.use(express.json());
  app.use('/gifs', gifLibraryRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/gifs`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});
async function patch(body) {
  const response = await fetch(`${baseUrl}/${item.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function list(params) {
  const response = await fetch(`${baseUrl}?${new URLSearchParams(params)}`);
  assert.equal(response.status, 200);
  return response.json();
}

test('renaming makes new words searchable before pagination and keeps the muscle group', async () => {
  overrides.clear();
  const result = await patch({ name: 'Movimento exclusivo revisado', muscleGroup: item.muscleGroupPt });
  assert.equal(result.override.muscleGroup, item.muscleGroupPt);
  assert.equal(overrides.get(item.id).muscle_group_pt, item.muscleGroupPt);
  const found = await list({ search: 'exclusivo revisado', pageSize: '1' });
  assert.equal(found.total, 1);
  assert.equal(found.items[0].id, item.id);
  await patch({ name: 'Movimento exclusivo atualizado' });
  assert.equal(overrides.get(item.id).muscle_group_pt, item.muscleGroupPt);
});

test('a first name-only edit does not store a boolean as the muscle group', async () => {
  overrides.clear();
  const result = await patch({ name: 'Nome sem mudar grupo' });
  assert.equal(overrides.get(item.id).muscle_group_pt, null);
  assert.equal(result.override.muscleGroup, item.muscleGroupPt);
});

test('edited muscle groups are searchable and available in filters', async () => {
  overrides.clear();
  await patch({ muscleGroup: 'Grupo personalizado exclusivo' });
  for (const params of [{ muscleGroup: 'Grupo personalizado exclusivo' }, { search: 'personalizado exclusivo' }]) {
    const found = await list(params);
    assert.equal(found.total, 1);
    assert.equal(found.items[0].id, item.id);
  }
  const filters = await (await fetch(`${baseUrl}/filters`)).json();
  assert.ok(filters.muscleGroups.includes('Grupo personalizado exclusivo'));
});

test('legacy boolean strings fall back to the catalog group in display and filtering', async () => {
  overrides.clear();
  overrides.set(item.id, { gif_id: item.id, muscle_group_pt: 'true' });
  const found = await list({ muscleGroup: item.muscleGroupPt, pageSize: '200' });
  assert.ok(found.total > 0);
  const search = await list({ search: item.nameEn, pageSize: '200' });
  assert.equal(search.items.find((row) => row.id === item.id).muscleGroup, item.muscleGroupPt);
  const filters = await (await fetch(`${baseUrl}/filters`)).json();
  assert.ok(!filters.muscleGroups.includes('true'));
});

test('search matches separated words in any order and requires every term before pagination', async () => {
  overrides.clear();
  await patch({ name: 'Elevacao exclusiva com barra revisada', muscleGroup: 'Grupo muscular personalizado' });
  for (const search of ['exclusiva revisada', 'revisada exclusiva', '  REVISADA   exclusiva  ', 'barra personalizado']) {
    const found = await list({ search, pageSize: '1' });
    assert.equal(found.total, 1);
    assert.equal(found.items[0].id, item.id);
  }
  const absent = await list({ search: 'exclusiva palavrainexistente' });
  assert.equal(absent.total, 0);
});

test('search ignores accents and accepts blank or single-word queries', async () => {
  overrides.clear();
  await patch({ name: 'Eleva\u00e7\u00e3o exclusiva com bra\u00e7os estendidos' });
  for (const search of ['elevacao bracos', 'BRA\u00c7OS ELEVA\u00c7\u00c3O', 'exclusiva']) {
    const found = await list({ search });
    assert.ok(found.items.some((row) => row.id === item.id));
  }
  const blank = await list({ search: '   ' });
  const all = await list({});
  assert.equal(blank.total, all.total);
});

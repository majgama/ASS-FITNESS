import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';

const catalog = JSON.parse(await readFile(new URL('../data/gif-catalog.json', import.meta.url), 'utf8'));
const token = 'gif-filter-test';
let server;
let baseUrl;
const normalizedCategory = (item) => (item.categoryPath[0] || '').replace(/\s+/g, ' ').trim();

before(async () => {
  mock.module('../db/pool.js', {
    namedExports: {
      query: async (sql, params) => {
        if (sql.includes('FROM sessions s') && params[0] === hashToken(token)) {
          return { rowCount: 1, rows: [{ id: '11111111-1111-4111-8111-111111111111', role: 'admin' }] };
        }
        return { rowCount: 0, rows: [] };
      }
    }
  });
  const { gifLibraryRouter } = await import('./gifLibrary.js');
  const app = express();
  app.use('/gif-library', gifLibraryRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/gif-library`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

async function request(filters = {}, endpoint = '') {
  const params = new URLSearchParams();
  for (const [key, values] of Object.entries(filters)) {
    for (const value of Array.isArray(values) ? values : [values]) params.append(key, value);
  }
  return fetch(`${baseUrl}${endpoint}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
}

test('multiple categories are combined with OR, including both cable folder spellings', async () => {
  const categories = ['EXERCÍCIOS NO CABO OU POLIA', 'EXERCÍCIOS COM HALTERES'];
  const response = await request({ categories, pageSize: 200 });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, catalog.filter((item) => categories.includes(normalizedCategory(item))).length);
  assert.ok(data.items.every((item) => categories.includes(normalizedCategory(item))));
  const cable = await (await request({ categories: categories[0] })).json();
  assert.equal(cable.total, catalog.filter((item) => normalizedCategory(item) === categories[0]).length);
  assert.ok(catalog.some((item) => item.categoryPath[0] === 'EXERCÍCIOS NO CABO  OU POLIA'));
});

test('genders, environments, categories and muscle groups intersect across groups', async () => {
  const filters = {
    genders: ['FEMININO', 'MASCULINO'],
    environments: 'ACADEMIA',
    categories: ['EXERCÍCIOS COM BARRAS', 'EXERCÍCIOS COM HALTERES'],
    muscleGroups: ['Biceps', 'Costas'],
    pageSize: 200
  };
  const data = await (await request(filters)).json();
  const expected = catalog.filter((item) => filters.genders.includes(item.gender) &&
    item.environment === filters.environments && filters.categories.includes(normalizedCategory(item)) &&
    filters.muscleGroups.includes(item.muscleGroupPt));
  assert.ok(expected.length > 0);
  assert.equal(data.total, expected.length);
  assert.deepEqual(new Set(data.items.map((item) => item.id)), new Set(expected.map((item) => item.id)));
});

test('filter options keep sibling categories available and collapse whitespace duplicates', async () => {
  const response = await request({ genders: 'MASCULINO', environments: 'ACADEMIA', categories: 'EXERCÍCIOS COM BARRAS' }, '/filters');
  const data = await response.json();
  assert.ok(data.categories.includes('EXERCÍCIOS COM HALTERES'));
  assert.ok(data.categories.includes('EXERCÍCIOS NO CABO OU POLIA'));
  assert.ok(!data.categories.includes('EXERCÍCIOS NO CABO  OU POLIA'));
  assert.ok(data.subcategories.includes('BICEPS'));
  assert.deepEqual(data.genders, ['FEMININO', 'MASCULINO']);
  assert.ok(data.environments.includes('FUNCIONAL'));
});

test('nested category buttons support multiple details', async () => {
  const subcategories = ['JOELHO', 'QUADRIL'];
  const data = await (await request({ categories: 'MOBILIDADE', subcategories, pageSize: 200 })).json();
  const expected = catalog.filter((item) => normalizedCategory(item) === 'MOBILIDADE' &&
    item.categoryPath.slice(1).some((value) => subcategories.includes(value)));
  assert.ok(expected.length > 0);
  assert.equal(data.total, expected.length);
});

test('legacy single-value hierarchical filters remain supported', async () => {
  const data = await (await request({
    gender: 'FEMININO', environment: 'ACADEMIA',
    categoryPath: 'EXERCÍCIOS COM BARRAS/BICEPS'
  })).json();
  assert.equal(data.total, catalog.filter((item) => item.gender === 'FEMININO' &&
    item.environment === 'ACADEMIA' && item.categoryPath.join('/') === 'EXERCÍCIOS COM BARRAS/BICEPS').length);
});

test('pagination, favorites and pending status respect multiple filters', async () => {
  const filters = { categories: ['EXERCÍCIOS COM BARRAS', 'EXERCÍCIOS COM HALTERES'], pageSize: 5 };
  const first = await (await request(filters)).json();
  const second = await (await request({ ...filters, page: 2 })).json();
  assert.equal(first.items.length, 5);
  assert.equal(second.items.length, 5);
  assert.equal(first.total, second.total);
  assert.ok(!first.items.some((item) => second.items.some((other) => item.id === other.id)));
  const favorites = await (await request({ ...filters, favoritesOnly: 'true' })).json();
  assert.equal(favorites.total, 0);
  const pending = await (await request({ ...filters, translationStatus: 'pending' })).json();
  assert.equal(pending.total, first.total);
});

test('empty selections mean all items and excessive repeated filters are rejected', async () => {
  const all = await (await request()).json();
  assert.equal(all.total, catalog.length);
  assert.equal((await request({ categories: Array(101).fill('CARDIO') })).status, 400);
});

import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';

const users = ['student', 'personal', 'admin'];
let calls = [];
let server;
let baseUrl;
const notification = { id: 'feedback:one', type: 'feedback', title: 'Dúvida', read: false };

before(async () => {
  mock.module('../db/pool.js', { namedExports: {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM sessions s')) {
        const role = users.find((value) => hashToken(value) === params[0]);
        return { rowCount: role ? 1 : 0, rows: role ? [{ id: `${role}-id`, role }] : [] };
      }
      if (sql.includes('WITH visible_students')) return { rowCount: 1, rows: [notification] };
      return { rowCount: 0, rows: [] };
    }
  } });
  const { notificationsRouter } = await import('./notifications.js');
  const app = express();
  app.use(express.json());
  app.use('/notifications', notificationsRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/notifications`;
});
beforeEach(() => { calls = []; });
after(async () => { await new Promise((resolve) => server.close(resolve)); mock.restoreAll(); });

function request(role, body) {
  return fetch(`${baseUrl}${body ? '/read' : ''}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${role}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

test('notification list requires authentication', async () => {
  assert.equal((await request('invalid')).status, 401);
  assert.ok(!calls.some(({ sql }) => sql.includes('WITH visible_students')));
});

test('student, personal and admin scope notifications to their authenticated identity and role', async () => {
  for (const role of users) {
    const response = await request(role);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).notifications, [notification]);
    const read = calls.filter(({ sql }) => sql.includes('WITH visible_students')).at(-1);
    assert.deepEqual(read.params, [`${role}-id`, role]);
    assert.match(read.sql, /u\.id = \$1/);
    assert.match(read.sql, /ts\.student_id = u\.id AND ts\.trainer_id = \$1/);
    assert.match(read.sql, /\$2 <> 'student'/);
    assert.match(read.sql, /ar\.completed_at IS NULL/);
    assert.match(read.sql, /ts\.trainer_id = ar\.requested_by/);
    assert.match(read.sql, /b\.status IN \('pending', 'overdue'\)/);
    assert.match(read.sql, /p\.status IN \('pending', 'overdue'\)/);
    assert.match(read.sql, /nr\.user_id = \$1/);
  }
});

test('marking read persists only for the authenticated user, not a supplied user ID', async () => {
  const response = await request('personal', { ids: ['feedback:one', 'assessment:two'], userId: 'other-user' });
  assert.equal(response.status, 204);
  const write = calls.find(({ sql }) => sql.includes('INSERT INTO notification_reads'));
  assert.deepEqual(write.params, ['personal-id', ['feedback:one', 'assessment:two']]);
  assert.match(write.sql, /ON CONFLICT DO NOTHING/);
});

test('invalid or excessive read IDs are rejected before writing', async () => {
  for (const ids of [[null], [''], ['x'.repeat(201)], Array(501).fill('test')]) {
    assert.equal((await request('student', { ids })).status, 400);
  }
  assert.ok(!calls.some(({ sql }) => sql.includes('INSERT INTO notification_reads')));
  assert.equal((await request('invalid', { ids: ['test'] })).status, 401);
});

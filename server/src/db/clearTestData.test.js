import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mock, test } from 'node:test';
import { clearTestData, countTestData } from './clearTestData.js';

const empty = { plans: 0, workouts: 0, exercises: 0, applied_plans: 0, students: 0 };
const populated = { plans: 2, workouts: 3, exercises: 11, applied_plans: 1, students: 2 };

function fakeClient({ after = empty, unchanged = true, failOnDelete = false } = {}) {
  const queries = [];
  let counted = false;
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql.includes('AS applied_plans')) {
        const rows = [counted ? after : populated];
        counted = true;
        return { rows };
      }
      if (sql.includes('AS unchanged')) return { rows: [{ unchanged }] };
      if (failOnDelete && sql === 'DELETE FROM daily_workouts') throw new Error('Database failure');
      return { rows: [] };
    }
  };
}

test('preview only reads counts', async () => {
  const client = fakeClient();
  assert.deepEqual(await countTestData(client), populated);
  assert.equal(client.queries.length, 1);
  assert.match(client.queries[0], /^\s*SELECT/);
});

test('cleanup locks data and deletes students and models in dependency order', async () => {
  const client = fakeClient();
  assert.deepEqual(await clearTestData(client), { before: populated, after: empty });
  assert.match(client.queries[0], /LOCK TABLE/);
  assert.deepEqual(client.queries.filter((sql) => sql.startsWith('DELETE')), [
    'DELETE FROM weekly_plans',
    'DELETE FROM daily_workouts',
    'DELETE FROM exercises',
    "DELETE FROM users WHERE role = 'student'"
  ]);
  assert.ok(client.queries.some((sql) => sql.includes('preserved_staff') && sql.includes('EXCEPT')));
});

test('cleanup rejects changes to admin or personal accounts', async () => {
  await assert.rejects(clearTestData(fakeClient({ unchanged: false })), /contas de administradores\/personais/);
});

test('cleanup rejects any remaining test data', async () => {
  for (const key of Object.keys(empty)) {
    await assert.rejects(clearTestData(fakeClient({ after: { ...empty, [key]: 1 } })), /dados de teste restantes/);
  }
});

test('database errors propagate to the transaction wrapper', async () => {
  const client = fakeClient({ failOnDelete: true });
  await assert.rejects(clearTestData(client), /Database failure/);
  assert.ok(!client.queries.includes('DELETE FROM exercises'));
});

test('CLI refuses an implicit database and unknown confirmation flags', () => {
  const script = fileURLToPath(new URL('../../scripts/clearTestData.js', import.meta.url));
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const missing = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Configure DATABASE_URL explicitamente/);
  const invalid = spawnSync(process.execPath, [script, '--force'], { env, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Uso:/);
});

test('repeated startup does not seed workout models', async () => {
  const queries = [];
  mock.module('./pool.js', {
    namedExports: {
      pool: {
        async query(sql) {
          queries.push(sql);
          return { rowCount: 1, rows: [{ id: 'existing-admin' }] };
        }
      }
    }
  });
  const { initializeDatabase } = await import('./initialize.js');
  await initializeDatabase();
  await initializeDatabase();
  const insertedModels = queries.filter((sql) => /INSERT INTO (exercises|daily_workouts|weekly_plans|daily_workout_exercises|weekly_plan_days)\b/.test(sql));
  assert.deepEqual(insertedModels, []);
  mock.restoreAll();
});

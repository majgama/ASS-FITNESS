import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertExerciseFileAccess } from './accessService.js';

test('existing exercise media keeps the original exercise permissions', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      return sql.includes('SELECT *')
        ? { rowCount: 1, rows: [{ id: 'exercise', visibility: 'private', owner_id: 'owner' }] }
        : { rowCount: 1, rows: [{ id: 'exercise' }] };
    }
  };
  await assert.rejects(
    assertExerciseFileAccess(client, { id: 'stranger', role: 'personal' }, 'exercises/video.mp4'),
    (error) => error.statusCode === 403
  );
  assert.equal(queries.length, 2);
});

test('deleted exercise media is accessible only through an authorized applied snapshot', async () => {
  for (const role of ['admin', 'personal', 'student']) {
    const queries = [];
    const client = {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rowCount: sql.includes('student_weekly_plans') ? 1 : 0, rows: [] };
      }
    };
    await assertExerciseFileAccess(client, { id: 'viewer', role }, 'exercises/video.mp4');
    const snapshot = queries[1];
    assert.deepEqual(snapshot.params.slice(3), [role, 'viewer']);
    assert.deepEqual(snapshot.params.slice(0, 3).map(JSON.parse), [
      { days: [{ dailyWorkout: { exercises: [{ videoPath: 'exercises/video.mp4' }] } }] },
      { days: [{ dailyWorkout: { exercises: [{ gifPath: 'exercises/video.mp4' }] } }] },
      { days: [{ dailyWorkout: { exercises: [{ audioPath: 'exercises/video.mp4' }] } }] }
    ]);
    assert.match(snapshot.sql, /swp.student_id = \$5/);
    assert.match(snapshot.sql, /ts.trainer_id = \$5 AND ts.student_id = swp.student_id/);
  }
});

test('media with no exercise or authorized snapshot returns not found', async () => {
  const client = { query: async () => ({ rowCount: 0, rows: [] }) };
  await assert.rejects(
    assertExerciseFileAccess(client, { id: 'stranger', role: 'student' }, 'exercises/video.mp4'),
    (error) => error.statusCode === 404
  );
});

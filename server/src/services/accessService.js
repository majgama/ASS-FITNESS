import { env } from '../config/env.js';
import { forbidden, notFound, paymentRequired } from '../utils/errors.js';

export async function assertStudentAccess(client, user, studentId) {
  if (user.role === 'admin') return true;

  if (user.role === 'student' && user.id === studentId) return true;

  if (user.role === 'personal') {
    const result = await client.query(
      'SELECT 1 FROM trainer_students WHERE trainer_id = $1 AND student_id = $2',
      [user.id, studentId]
    );
    if (result.rowCount > 0) return true;
  }

  throw forbidden('Voce nao tem acesso a este aluno.');
}

export async function assertTrainerOwnsStudent(client, trainerId, studentId) {
  const result = await client.query(
    'SELECT 1 FROM trainer_students WHERE trainer_id = $1 AND student_id = $2',
    [trainerId, studentId]
  );

  if (result.rowCount === 0) {
    throw forbidden('Aluno nao vinculado a este personal.');
  }
}

export async function getTrainerCapacity(client, trainerId) {
  const billing = await client.query(
    `SELECT free_student_limit, paid_student_limit, status, access_until
     FROM trainer_billing
     WHERE trainer_id = $1`,
    [trainerId]
  );

  const activeCount = await client.query(
    `SELECT COUNT(DISTINCT ts.student_id)::int AS total
     FROM trainer_students ts
     JOIN student_profiles sp ON sp.user_id = ts.student_id
     WHERE ts.trainer_id = $1
       AND sp.status = 'active'`,
    [trainerId]
  );

  const row = billing.rows[0] || {
    free_student_limit: env.maxFreeStudents,
    paid_student_limit: 0,
    status: 'free',
    access_until: null
  };

  const paidActive = row.status === 'active' && (!row.access_until || new Date(row.access_until) > new Date());
  const allowed = Number(row.free_student_limit) + (paidActive ? Number(row.paid_student_limit) : 0);

  return {
    activeStudents: activeCount.rows[0]?.total || 0,
    allowedStudents: allowed,
    freeStudentLimit: Number(row.free_student_limit),
    paidActive,
    status: row.status
  };
}

export async function assertTrainerCanAddActiveStudent(client, trainerId) {
  const capacity = await getTrainerCapacity(client, trainerId);
  if (capacity.activeStudents >= capacity.allowedStudents) {
    throw paymentRequired('Limite de alunos gratis atingido. Libere mais alunos pelo pagamento.', capacity);
  }
  return capacity;
}

export async function assertExerciseAccess(client, user, exerciseId) {
  const result = await client.query('SELECT * FROM exercises WHERE id = $1', [exerciseId]);
  if (result.rowCount === 0) {
    throw notFound('Exercicio nao encontrado.');
  }

  const exercise = result.rows[0];
  if (exercise.visibility === 'public' || user.role === 'admin' || exercise.owner_id === user.id) {
    return exercise;
  }

  if (user.role === 'student' && exercise.owner_id) {
    const linked = await client.query(
      'SELECT 1 FROM trainer_students WHERE trainer_id = $1 AND student_id = $2',
      [exercise.owner_id, user.id]
    );
    if (linked.rowCount > 0) return exercise;
  }

  throw forbidden('Voce nao tem acesso a este exercicio.');
}

export async function assertExerciseFileAccess(client, user, relativePath) {
  const result = await client.query(
    `SELECT id FROM exercises
     WHERE video_path = $1 OR gif_path = $1 OR audio_path = $1`,
    [relativePath]
  );
  if (result.rowCount > 0) {
    await assertExerciseAccess(client, user, result.rows[0].id);
    return;
  }

  const snapshots = await client.query(
    `SELECT 1 FROM student_weekly_plans swp
     WHERE (swp.plan_snapshot @> $1::jsonb
         OR swp.plan_snapshot @> $2::jsonb
         OR swp.plan_snapshot @> $3::jsonb)
       AND (
         $4 = 'admin'
         OR ($4 = 'student' AND swp.student_id = $5)
         OR ($4 = 'personal' AND EXISTS (
           SELECT 1 FROM trainer_students ts
           WHERE ts.trainer_id = $5 AND ts.student_id = swp.student_id
         ))
       )
     LIMIT 1`,
    [
      ...['videoPath', 'gifPath', 'audioPath'].map((key) => JSON.stringify({
        days: [{ dailyWorkout: { exercises: [{ [key]: relativePath }] } }]
      })),
      user.role,
      user.id
    ]
  );
  if (snapshots.rowCount === 0) throw notFound('Arquivo nao encontrado.');
}

export async function assertOwnedModelAccess(client, user, table, modelId) {
  const allowedTables = new Set(['daily_workouts', 'weekly_plans', 'diet_plans']);
  if (!allowedTables.has(table)) throw new Error('Invalid table');

  const result = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [modelId]);
  if (result.rowCount === 0) throw notFound('Modelo nao encontrado.');

  const model = result.rows[0];
  if (model.visibility === 'public' || user.role === 'admin' || model.owner_id === user.id) {
    return model;
  }

  throw forbidden('Voce nao tem acesso a este modelo.');
}

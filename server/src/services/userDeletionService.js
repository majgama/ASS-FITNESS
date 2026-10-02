import { forbidden, notFound } from '../utils/errors.js';

export async function deleteManagedUser(client, actor, userId, role) {
  if (actor.role !== 'admin') throw forbidden('Apenas administrador pode excluir usuarios.');
  if (!['student', 'personal'].includes(role)) throw new Error('Invalid deletion role');

  const target = await client.query(
    'SELECT id FROM users WHERE id = $1 AND role = $2 FOR UPDATE',
    [userId, role]
  );
  if (target.rowCount === 0) throw notFound(role === 'student' ? 'Aluno nao encontrado.' : 'Personal nao encontrado.');

  await client.query(
    `DELETE FROM daily_workout_exercises dwe
     USING exercises e
     WHERE dwe.exercise_id = e.id AND e.owner_id = $1`,
    [userId]
  );
  const deleted = await client.query(
    'DELETE FROM users WHERE id = $1 AND role = $2 RETURNING id',
    [userId, role]
  );
  if (deleted.rowCount === 0) throw notFound('Usuario nao encontrado.');
}

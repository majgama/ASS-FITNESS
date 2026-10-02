export async function countTestData(client) {
  const result = await client.query(
    `SELECT
       (SELECT count(*)::int FROM weekly_plans) AS plans,
       (SELECT count(*)::int FROM daily_workouts) AS workouts,
       (SELECT count(*)::int FROM exercises) AS exercises,
       (SELECT count(*)::int FROM student_weekly_plans) AS applied_plans,
       (SELECT count(*)::int FROM users WHERE role = 'student') AS students`
  );
  return result.rows[0];
}

export async function clearTestData(client) {
  await client.query(
    `LOCK TABLE weekly_plans, weekly_plan_days, daily_workouts,
       daily_workout_exercises, exercises, student_weekly_plans, users
     IN ACCESS EXCLUSIVE MODE`
  );
  const before = await countTestData(client);
  await client.query(
    `CREATE TEMP TABLE preserved_staff ON COMMIT DROP AS
     SELECT * FROM users WHERE role <> 'student'`
  );

  await client.query('DELETE FROM weekly_plans');
  await client.query('DELETE FROM daily_workouts');
  await client.query('DELETE FROM exercises');
  await client.query("DELETE FROM users WHERE role = 'student'");

  const preserved = await client.query(
    `SELECT NOT EXISTS (
       (SELECT * FROM preserved_staff
        EXCEPT
        SELECT * FROM users WHERE role <> 'student')
       UNION ALL
       (SELECT * FROM users WHERE role <> 'student'
        EXCEPT
        SELECT * FROM preserved_staff)
     ) AS unchanged`
  );
  const after = await countTestData(client);
  if (!preserved.rows[0].unchanged || Object.values(after).some((count) => count !== 0)) {
    throw new Error('Limpeza cancelada: dados de teste restantes ou contas de administradores/personais alteradas.');
  }
  return { before, after };
}

const exercises = [
  { name: 'Leg press 45 graus', muscleGroup: 'Pernas' },
  { name: 'Supino maquina', muscleGroup: 'Peitoral' },
  { name: 'Puxada frontal', muscleGroup: 'Costas' },
  { name: 'Cadeira extensora', muscleGroup: 'Quadriceps' },
  { name: 'Mesa flexora', muscleGroup: 'Posteriores' },
  { name: 'Remada baixa', muscleGroup: 'Costas' },
  { name: 'Desenvolvimento maquina', muscleGroup: 'Ombros' },
  { name: 'Elevacao pelvica', muscleGroup: 'Gluteos' },
  { name: 'Prancha', muscleGroup: 'Core' },
  { name: 'Caminhada na esteira', muscleGroup: 'Cardio' },
  { name: 'Bicicleta ergometrica', muscleGroup: 'Cardio' }
];

const workouts = [
  {
    name: 'Iniciante A - Base',
    description: 'Movimentos globais, carga leve a moderada e tecnica controlada.',
    items: [
      ['Leg press 45 graus', '2', '8-12', 90, 'Descer com controle, sem retirar a lombar do apoio.'],
      ['Supino maquina', '2', '8-12', 90, 'Ajustar o banco e manter os pes apoiados.'],
      ['Puxada frontal', '2', '8-12', 90, 'Puxar em direcao ao peito, sem balancar o tronco.'],
      ['Elevacao pelvica', '2', '10-12', 75, 'Pausar um segundo no topo do movimento.'],
      ['Prancha', '2', '20-30 segundos', 60, 'Manter coluna neutra e respiracao continua.']
    ]
  },
  {
    name: 'Iniciante B - Controle',
    description: 'Complemento da sessao A com enfase em estabilidade e cadeia posterior.',
    items: [
      ['Cadeira extensora', '2', '10-12', 75, 'Executar sem impulso e sem travar os joelhos.'],
      ['Mesa flexora', '2', '10-12', 75, 'Controlar a volta do peso.'],
      ['Remada baixa', '2', '8-12', 90, 'Iniciar o movimento pelas escapulas.'],
      ['Desenvolvimento maquina', '2', '8-12', 90, 'Manter punhos alinhados e lombar apoiada.'],
      ['Prancha', '2', '20-30 segundos', 60, 'Interromper se perder o alinhamento corporal.']
    ]
  },
  {
    name: 'Iniciante C - Condicionamento',
    description: 'Atividade aerobia leve a moderada para construir consistencia sem excesso de fadiga.',
    items: [
      ['Caminhada na esteira', '1', '20-30 minutos', 0, 'Ritmo que permita conversar em frases curtas.'],
      ['Bicicleta ergometrica', '1', '10-15 minutos', 0, 'Resistencia leve; manter cadencia confortavel.'],
      ['Prancha', '2', '20-30 segundos', 60, 'Priorizar estabilidade, nao duracao.']
    ]
  }
];

const weeklyDays = [
  { dayOfWeek: 0, isRest: true, instructions: 'Descanso completo.' },
  { dayOfWeek: 1, workout: 'Iniciante A - Base' },
  { dayOfWeek: 2, workout: 'Iniciante B - Controle' },
  { dayOfWeek: 3, isRest: true, instructions: 'Descanso e recuperacao.' },
  { dayOfWeek: 4, workout: 'Iniciante A - Base' },
  { dayOfWeek: 5, workout: 'Iniciante B - Controle' },
  { dayOfWeek: 6, workout: 'Iniciante C - Condicionamento' }
];

export async function seedBeginnerPlan(client) {
  const exerciseIds = new Map();
  for (const exercise of exercises) {
    const existing = await client.query(
      "SELECT id FROM exercises WHERE lower(name) = lower($1) AND visibility = 'public' LIMIT 1",
      [exercise.name]
    );
    const result = existing.rowCount > 0 ? existing : await client.query(
      `INSERT INTO exercises (name, muscle_group, visibility)
       VALUES ($1, $2, 'public')
       RETURNING id`,
      [exercise.name, exercise.muscleGroup]
    );
    exerciseIds.set(exercise.name, result.rows[0].id);
  }

  const workoutIds = new Map();
  for (const workout of workouts) {
    const existing = await client.query(
      "SELECT id FROM daily_workouts WHERE name = $1 AND visibility = 'public' LIMIT 1",
      [workout.name]
    );
    const result = existing.rowCount > 0 ? existing : await client.query(
      `INSERT INTO daily_workouts (name, description, visibility)
       VALUES ($1, $2, 'public')
       RETURNING id`,
      [workout.name, workout.description]
    );
    const workoutId = result.rows[0].id;
    workoutIds.set(workout.name, workoutId);

    for (const [position, item] of workout.items.entries()) {
      const [exerciseName, sets, repetitions, restSeconds, notes] = item;
      await client.query(
        `INSERT INTO daily_workout_exercises
          (daily_workout_id, exercise_id, position, sets, repetitions, rest_seconds, notes)
         SELECT $1, $2, $3, $4, $5, $6, $7
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_workout_exercises
           WHERE daily_workout_id = $1 AND exercise_id = $2
         )`,
        [workoutId, exerciseIds.get(exerciseName), position + 1, sets, repetitions, restSeconds, notes]
      );
    }
  }

  const existingPlan = await client.query(
    "SELECT id FROM weekly_plans WHERE name = 'Plano Semanal Iniciante' AND visibility = 'public' LIMIT 1"
  );
  const plan = existingPlan.rowCount > 0 ? existingPlan : await client.query(
    `INSERT INTO weekly_plans (name, description, visibility)
     VALUES ('Plano Semanal Iniciante', $1, 'public')
     RETURNING id`,
    ['Quatro sessoes de musculacao, condicionamento leve no sabado e descanso na quarta e no domingo.']
  );
  const planId = plan.rows[0].id;

  for (const day of weeklyDays) {
    const workoutId = day.workout ? workoutIds.get(day.workout) : null;
    await client.query(
      `INSERT INTO weekly_plan_days (weekly_plan_id, day_of_week, is_rest, daily_workout_id, instructions)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (weekly_plan_id, day_of_week) DO NOTHING`,
      [planId, day.dayOfWeek, Boolean(day.isRest), day.isRest ? null : workoutId, day.instructions || null]
    );
  }
}
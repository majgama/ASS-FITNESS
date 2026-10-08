import { readFile } from 'node:fs/promises';
import { pool, withTransaction } from '../src/db/pool.js';
import { importPublicPlan } from '../src/db/importPublicPlan.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== '--confirm-import')) {
    throw new Error('Uso: npm run db:import-intermediate-plan -- [--confirm-import]');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('Configure DATABASE_URL explicitamente antes de consultar ou importar o plano.');
  }
  const input = JSON.parse(await readFile(new URL('../src/data/intermediate-five-day-plan.json', import.meta.url), 'utf8'));
  const database = await pool.query('SELECT current_database() AS name');
  console.log(`Banco: ${database.rows[0].name}`);
  const write = args.includes('--confirm-import');
  const result = await withTransaction((client) => importPublicPlan(client, input, {
    write,
    createMissingExercises: true
  }));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'already-exists') {
    console.log('Plano identico ja existe; nenhum dado foi duplicado.');
  } else if (write) {
    console.log('Plano publico, treinos e prescricoes gravados e verificados.');
  } else {
    console.log('Somente consulta; nenhum dado foi alterado. Os exercicios em missingExercises serao criados como publicos, sem midia.');
    console.log('Revise os nomes antes de confirmar. Nomes ambiguos bloqueiam a importacao.');
    console.log('Para criar exercicios ausentes e importar tudo: npm run db:import-intermediate-plan -- --confirm-import');
  }
}

main()
  .catch((error) => {
    console.error('Falha na importacao do plano:', error.message);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  })
  .finally(() => pool.end());

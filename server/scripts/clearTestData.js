import { pool, withTransaction } from '../src/db/pool.js';
import { clearTestData, countTestData } from '../src/db/clearTestData.js';

const confirmation = '--confirm-delete-all-test-data';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== confirmation) || args.length > 1) {
    throw new Error(`Uso: npm run db:clear-test-data -- [${confirmation}]`);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('Configure DATABASE_URL explicitamente antes de consultar ou limpar o banco.');
  }

  const database = await pool.query('SELECT current_database() AS name');
  console.log(`Banco: ${database.rows[0].name}`);
  if (!args.includes(confirmation)) {
    console.table([await countTestData(pool)]);
    console.log('Somente consulta; nenhum dado foi apagado.');
    console.log(`Apos conferir o banco e fazer backup, execute com ${confirmation}.`);
    return;
  }

  const { before, after } = await withTransaction(clearTestData);
  console.table([{ etapa: 'Antes', ...before }, { etapa: 'Depois', ...after }]);
  console.log('Alunos e modelos removidos. Contas de administradores/personais e arquivos de midia preservados.');
}

main()
  .catch((error) => {
    console.error('Falha na limpeza dos dados de teste:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

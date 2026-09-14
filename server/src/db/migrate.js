import { pool } from './pool.js';
import { initializeDatabase } from './initialize.js';

initializeDatabase()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

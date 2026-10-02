import { pool, withTransaction } from './pool.js';
import { initializeDatabase } from './initialize.js';
import { seedBeginnerPlan } from './seedBeginnerPlan.js';

initializeDatabase()
  .then(() => withTransaction(seedBeginnerPlan))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

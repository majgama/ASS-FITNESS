import bcrypt from 'bcrypt';
import { env } from '../config/env.js';
import { pool } from './pool.js';

async function seed() {
  const passwordHash = await bcrypt.hash(env.seedAdminPassword, env.bcryptRounds);
  const existing = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [env.seedAdminEmail]);

  if (existing.rowCount > 0) {
    console.log(`Admin already exists: ${env.seedAdminEmail}`);
    return;
  }

  await pool.query(
    `INSERT INTO users (name, email, role, password_hash)
     VALUES ($1, lower($2), 'admin', $3)`,
    [env.seedAdminName, env.seedAdminEmail, passwordHash]
  );

  console.log(`Admin created: ${env.seedAdminEmail}`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

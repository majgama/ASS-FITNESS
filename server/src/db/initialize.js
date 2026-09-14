import bcrypt from 'bcrypt';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { pool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function initializeDatabase() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('Database schema applied.');

  const passwordHash = await bcrypt.hash(env.seedAdminPassword, env.bcryptRounds);
  const existing = await pool.query(
    'SELECT id FROM users WHERE lower(email) = lower($1)',
    [env.seedAdminEmail]
  );

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

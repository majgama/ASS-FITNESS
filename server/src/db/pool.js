import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

function normalizeDatabaseUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    url.searchParams.delete('sslmode');
    url.searchParams.delete('sslrootcert');
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

export const pool = new Pool({
  connectionString: normalizeDatabaseUrl(env.databaseUrl),
  ssl: env.databaseSsl ? { rejectUnauthorized: false } : false
});

export const query = (text, params = []) => pool.query(text, params);

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

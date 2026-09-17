import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ quiet: true });

const toBoolean = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toNumber(process.env.PORT, 3333),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ass_fitness',
  databaseSsl: toBoolean(process.env.DATABASE_SSL, false),
  sessionDays: toNumber(process.env.SESSION_DAYS, 30),
  bcryptRounds: toNumber(process.env.BCRYPT_ROUNDS, 12),
  maxFreeStudents: toNumber(process.env.MAX_FREE_STUDENTS, 3),
  hotmartPaidStudentLimit: toNumber(process.env.HOTMART_PAID_STUDENT_LIMIT, 9999),
  hotmartHottok: process.env.HOTMART_HOTTOK || '',
  hotmartProductId: process.env.HOTMART_PRODUCT_ID || '',
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.resolve(process.cwd(), 'src', 'uploads'),
  gifLibraryDir: process.env.GIF_LIBRARY_DIR
    ? path.resolve(process.env.GIF_LIBRARY_DIR)
    : path.resolve(process.cwd(), '..', 'gif'),
  seedAdminName: process.env.SEED_ADMIN_NAME || 'Administrador',
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@assfitness.local',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345'
};

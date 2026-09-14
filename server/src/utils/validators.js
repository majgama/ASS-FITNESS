import { z } from 'zod';
import { badRequest } from './errors.js';

export const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.');
export const idSchema = z.string().uuid();

export function parseBody(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw badRequest('Dados invalidos.', parsed.error.flatten());
  }
  return parsed.data;
}

export const userRoles = ['admin', 'personal', 'student'];
export const relationshipTypes = ['primary', 'secondary'];
export const studentStatuses = ['active', 'inactive'];

export function optionalDate(value) {
  if (!value) return null;
  return value;
}

export function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

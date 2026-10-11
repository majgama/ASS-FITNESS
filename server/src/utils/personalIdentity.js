import { z } from 'zod';

export function isValidCpf(value) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  for (const length of [9, 10]) {
    const sum = [...value.slice(0, length)].reduce((total, digit, index) =>
      total + Number(digit) * (length + 1 - index), 0);
    const check = (sum * 10 % 11) % 10;
    if (check !== Number(value[length])) return false;
  }
  return true;
}

export const cpfSchema = z.string().trim()
  .regex(/^[0-9.\-\s]+$/, 'Informe um CPF valido.')
  .transform((value) => value.replace(/\D/g, ''))
  .refine(isValidCpf, 'Informe um CPF valido.');

export const whatsappSchema = z.string().trim()
  .regex(/^(?:|\+?[1-9][0-9 ()-]{7,24})$/, 'Informe o WhatsApp com codigo do pais e DDD.')
  .transform((value) => value.replace(/\D/g, ''))
  .refine((value) => !value || (value.length >= 8 && value.length <= 15), 'O WhatsApp deve ter de 8 a 15 digitos.');

export const requiredWhatsappSchema = whatsappSchema.refine(Boolean, 'Informe seu WhatsApp para liberar o link de divulgacao.');

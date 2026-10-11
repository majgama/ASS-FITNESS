import { AppError, badRequest, forbidden, notFound } from '../utils/errors.js';
import { cpfSchema, requiredWhatsappSchema } from '../utils/personalIdentity.js';
import { parseBody } from '../utils/validators.js';

export async function identityFingerprint(client, kind, value) {
  const result = await client.query(
    `SELECT encode(hmac($1, secret, 'sha256'), 'hex') AS fingerprint
     FROM anti_abuse_key WHERE id = 1`,
    [`${kind}:${value}`]
  );
  if (!result.rows[0]?.fingerprint) throw new Error('Anti-abuse key is missing.');
  return result.rows[0].fingerprint;
}

async function claimIdentity(client, trainerId, kind, value) {
  const fingerprint = await identityFingerprint(client, kind, value);
  const result = await client.query(
    `INSERT INTO personal_identity_claims (kind, fingerprint, trainer_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (kind, fingerprint) DO UPDATE SET last_used_at = now()
     WHERE personal_identity_claims.trainer_id = EXCLUDED.trainer_id
     RETURNING fingerprint`,
    [kind, fingerprint, trainerId]
  );
  if (!result.rowCount) {
    throw new AppError(
      `${kind === 'cpf' ? 'CPF' : 'WhatsApp'} ja utilizado por outra conta. Entre em contato com o suporte.`,
      409, 'IDENTITY_ALREADY_USED'
    );
  }
  return fingerprint;
}

export async function savePersonalIdentity(client, trainerId, { cpf, whatsapp }) {
  const profile = await client.query(
    'SELECT cpf_last_four, whatsapp FROM personal_profiles WHERE user_id = $1 FOR UPDATE',
    [trainerId]
  );
  if (!profile.rowCount) throw notFound('Perfil de personal nao encontrado.');
  const current = profile.rows[0];
  let cpfLastFour = current.cpf_last_four;
  if (cpf !== undefined) {
    const normalized = parseBody(cpfSchema, cpf);
    if (cpfLastFour) {
      const fingerprint = await identityFingerprint(client, 'cpf', normalized);
      const own = await client.query(
        `SELECT 1 FROM personal_identity_claims
         WHERE kind = 'cpf' AND fingerprint = $1 AND trainer_id = $2`,
        [fingerprint, trainerId]
      );
      if (!own.rowCount) throw badRequest('O CPF vinculado nao pode ser alterado. Entre em contato com o suporte.');
    }
    await claimIdentity(client, trainerId, 'cpf', normalized);
    cpfLastFour = normalized.slice(-4);
  }
  const providedNumber = whatsapp === undefined ? current.whatsapp : whatsapp;
  const number = providedNumber ? parseBody(requiredWhatsappSchema, providedNumber) : null;
  if (number) {
    // Existing profiles may predate the identity registry.
    const duplicate = await client.query(
      `SELECT 1 FROM personal_profiles
       WHERE user_id <> $1 AND regexp_replace(whatsapp, '[^0-9]', '', 'g') = $2 LIMIT 1`,
      [trainerId, number]
    );
    if (duplicate.rowCount) throw new AppError('WhatsApp ja utilizado por outra conta. Entre em contato com o suporte.', 409, 'IDENTITY_ALREADY_USED');
    await claimIdentity(client, trainerId, 'whatsapp', number);
  }
  if (cpf !== undefined && !number) throw badRequest('Informe seu WhatsApp junto com o CPF.');
  await client.query(
    'UPDATE personal_profiles SET cpf_last_four = $2, whatsapp = $3 WHERE user_id = $1',
    [trainerId, cpfLastFour || null, number || null]
  );
}

export async function assertPersonalInviteEnabled(client, trainerId) {
  const result = await client.query(
    'SELECT cpf_last_four, whatsapp FROM personal_profiles WHERE user_id = $1 FOR SHARE',
    [trainerId]
  );
  if (!result.rowCount) throw notFound('Perfil de personal nao encontrado.');
  if (!result.rows[0].cpf_last_four || !result.rows[0].whatsapp) {
    throw new AppError('Preencha CPF e WhatsApp no Perfil para liberar seu link de divulgacao.', 403, 'PERSONAL_IDENTITY_REQUIRED');
  }
}

export async function limitPersonalRegistrations(client, ipAddress) {
  if (!ipAddress) throw forbidden('Nao foi possivel identificar a origem do cadastro.');
  const fingerprint = await identityFingerprint(client, 'registration-ip', ipAddress);
  await client.query('DELETE FROM registration_attempts WHERE expires_at <= now()');
  const result = await client.query(
    `INSERT INTO registration_attempts (fingerprint, attempts, expires_at)
     VALUES ($1, 1, now() + interval '10 minutes')
     ON CONFLICT (fingerprint) DO UPDATE SET
       attempts = CASE WHEN registration_attempts.expires_at <= now() THEN 1 ELSE registration_attempts.attempts + 1 END,
       expires_at = CASE WHEN registration_attempts.expires_at <= now() THEN now() + interval '10 minutes' ELSE registration_attempts.expires_at END
     RETURNING attempts, GREATEST(1, ceil(extract(epoch FROM expires_at - now())))::int AS retry_after`,
    [fingerprint]
  );
  const row = result.rows[0];
  if (row.attempts > 5) {
    throw new AppError('Muitas tentativas de cadastro. Aguarde alguns minutos e tente novamente.', 429, 'REGISTRATION_RATE_LIMIT', { retryAfter: row.retry_after });
  }
}

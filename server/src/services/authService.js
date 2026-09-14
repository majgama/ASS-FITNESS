import bcrypt from 'bcrypt';
import { env } from '../config/env.js';
import { query, withTransaction } from '../db/pool.js';
import { badRequest, forbidden, notFound, unauthorized } from '../utils/errors.js';
import { addDays, createInviteCode, createToken, hashToken } from '../utils/tokens.js';
import { toUser } from '../middleware/auth.js';

export function sanitizeUser(row) {
  return toUser(row);
}

async function uniquePersonalInviteCode(client) {
  for (let i = 0; i < 10; i += 1) {
    const code = createInviteCode('PT');
    const exists = await client.query('SELECT 1 FROM personal_profiles WHERE invite_code = $1', [code]);
    if (exists.rowCount === 0) return code;
  }
  throw badRequest('Nao foi possivel gerar codigo de convite.');
}

export async function registerUser(payload) {
  return withTransaction(async (client) => {
    const role = payload.role || 'personal';
    if (!['personal', 'student'].includes(role)) {
      throw forbidden('Cadastro publico permitido apenas para personal ou aluno convidado.');
    }

    const passwordHash = await bcrypt.hash(payload.password, env.bcryptRounds);
    let trainerIdFromInvite = null;

    if (role === 'student') {
      if (!payload.inviteCode) {
        throw badRequest('Convite obrigatorio para cadastro de aluno.');
      }

      const invite = await client.query(
        `SELECT * FROM invitations
         WHERE upper(code) = upper($1)
           AND lower(email) = lower($2)
           AND accepted_at IS NULL
           AND expires_at > now()`,
        [payload.inviteCode, payload.email]
      );

      if (invite.rowCount === 0) {
        throw badRequest('Convite invalido ou expirado.');
      }

      trainerIdFromInvite = invite.rows[0].trainer_id;
    }

    const user = await client.query(
      `INSERT INTO users (name, email, date_of_birth, role, password_hash, cref)
       VALUES ($1, lower($2), $3, $4, $5, $6)
       RETURNING id, name, email, date_of_birth, profile_photo_path, role, cref`,
      [payload.name, payload.email, payload.dateOfBirth || null, role, passwordHash, payload.cref || null]
    );

    const created = user.rows[0];

    if (role === 'personal') {
      const inviteCode = await uniquePersonalInviteCode(client);
      await client.query(
        `INSERT INTO personal_profiles (user_id, specialty, invite_code)
         VALUES ($1, $2, $3)`,
        [created.id, payload.specialty || null, inviteCode]
      );
      await client.query(
        `INSERT INTO trainer_billing (trainer_id, free_student_limit)
         VALUES ($1, $2)`,
        [created.id, env.maxFreeStudents]
      );
    }

    if (role === 'student') {
      await client.query(
        `INSERT INTO student_profiles (user_id, objective, start_date, restrictions, next_assessment_date)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          created.id,
          payload.objective || null,
          payload.startDate || null,
          payload.restrictions || null,
          payload.nextAssessmentDate || null
        ]
      );
      await client.query(
        `INSERT INTO trainer_students (trainer_id, student_id, relationship_type, created_by)
         VALUES ($1, $2, 'primary', $1)`,
        [trainerIdFromInvite, created.id]
      );
      await client.query('UPDATE invitations SET accepted_at = now() WHERE upper(code) = upper($1)', [payload.inviteCode]);
    }

    const hydrated = await client.query(
      `SELECT u.*, pp.specialty, pp.invite_code, sp.objective, sp.start_date, sp.restrictions,
              sp.next_assessment_date, sp.status AS student_status, sp.inactive_reason
       FROM users u
       LEFT JOIN personal_profiles pp ON pp.user_id = u.id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.id = $1`,
      [created.id]
    );

    return sanitizeUser(hydrated.rows[0]);
  });
}

export async function loginUser({ email, password, userAgent, ipAddress }) {
  const userResult = await query(
    `SELECT u.*, pp.specialty, pp.invite_code, sp.objective, sp.start_date, sp.restrictions,
            sp.next_assessment_date, sp.status AS student_status, sp.inactive_reason
     FROM users u
     LEFT JOIN personal_profiles pp ON pp.user_id = u.id
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     WHERE lower(u.email) = lower($1)`,
    [email]
  );

  if (userResult.rowCount === 0) {
    throw unauthorized('E-mail ou senha invalidos.');
  }

  const userRow = userResult.rows[0];
  const valid = await bcrypt.compare(password, userRow.password_hash);
  if (!valid) {
    throw unauthorized('E-mail ou senha invalidos.');
  }

  const token = createToken();
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [userRow.id, hashToken(token), addDays(env.sessionDays), userAgent || null, ipAddress || null]
  );

  return {
    token,
    user: sanitizeUser(userRow)
  };
}

export async function logoutSession(sessionId) {
  await query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
}

export async function changePassword({ userId, sessionId, currentPassword, newPassword }) {
  const result = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (result.rowCount === 0) throw notFound('Usuario nao encontrado.');

  const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
  if (!valid) throw unauthorized('Senha atual invalida.');

  const passwordHash = await bcrypt.hash(newPassword, env.bcryptRounds);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users
       SET password_hash = $1, password_changed_at = now()
       WHERE id = $2`,
      [passwordHash, userId]
    );
    await client.query(
      `UPDATE sessions
       SET revoked_at = now()
       WHERE user_id = $1
         AND id <> $2
         AND revoked_at IS NULL`,
      [userId, sessionId]
    );
  });
}

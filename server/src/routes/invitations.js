import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/errors.js';
import { resolveInvitation } from '../services/invitationService.js';
import { assertPersonalInviteEnabled } from '../services/personalIdentityService.js';
import { addDays, createInviteCode } from '../utils/tokens.js';
import { emailSchema, parseBody } from '../utils/validators.js';

export const invitationsRouter = Router();

invitationsRouter.get('/:code', asyncHandler(async (req, res) => {
  const invitation = await resolveInvitation({ query }, req.params.code);
  if (!invitation) throw notFound('Convite nao encontrado.');
  res.json({
    invitation: {
      code: invitation.code,
      email: invitation.email,
      trainerName: invitation.trainerName,
      expiresAt: invitation.expiresAt,
      accepted: invitation.accepted,
      valid: invitation.valid,
      permanent: invitation.permanent
    }
  });
}));

invitationsRouter.use(authRequired);

invitationsRouter.get('/', requireRoles('personal'), asyncHandler(async (req, res) => {
  await assertPersonalInviteEnabled({ query }, req.user.id);
  const result = await query(
    `SELECT id, email, code, expires_at, accepted_at, created_at
     FROM invitations
     WHERE trainer_id = $1
     ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ invitations: result.rows });
}));

invitationsRouter.get('/me/code', requireRoles('personal'), asyncHandler(async (req, res) => {
  await assertPersonalInviteEnabled({ query }, req.user.id);
  const result = await query('SELECT invite_code FROM personal_profiles WHERE user_id = $1', [req.user.id]);
  const inviteCode = result.rows[0]?.invite_code;
  if (!inviteCode) throw notFound('Link de divulgacao nao encontrado.');
  res.json({
    inviteCode,
    inviteLink: `${env.appUrl.replace(/\/+$/, '')}/register/${encodeURIComponent(inviteCode)}`
  });
}));

const createInvitationSchema = z.object({
  email: emailSchema
});

invitationsRouter.post('/', requireRoles('personal'), asyncHandler(async (req, res) => {
  await assertPersonalInviteEnabled({ query }, req.user.id);
  const payload = parseBody(createInvitationSchema, req.body);
  const existingUser = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [payload.email]);
  if (existingUser.rowCount > 0) {
    throw badRequest('Ja existe usuario cadastrado com este e-mail.');
  }

  const code = createInviteCode('ALU');
  const result = await query(
    `INSERT INTO invitations (trainer_id, email, code, expires_at)
     VALUES ($1, lower($2), $3, $4)
     RETURNING id, email, code, expires_at, created_at`,
    [req.user.id, payload.email, code, addDays(14)]
  );

  res.status(201).json({
    invitation: result.rows[0],
    inviteLink: `${env.appUrl}/register/${code}`
  });
}));

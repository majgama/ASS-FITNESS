import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest } from '../utils/errors.js';
import { addDays, createInviteCode } from '../utils/tokens.js';
import { emailSchema, parseBody } from '../utils/validators.js';

export const invitationsRouter = Router();

invitationsRouter.get('/:code', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT i.code, i.email, i.expires_at, i.accepted_at, u.name AS trainer_name
     FROM invitations i
     JOIN users u ON u.id = i.trainer_id
     WHERE upper(i.code) = upper($1)`,
    [req.params.code]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Convite nao encontrado.' } });
    return;
  }

  const invitation = result.rows[0];
  res.json({
    invitation: {
      code: invitation.code,
      email: invitation.email,
      trainerName: invitation.trainer_name,
      expiresAt: invitation.expires_at,
      accepted: Boolean(invitation.accepted_at),
      valid: !invitation.accepted_at && new Date(invitation.expires_at) > new Date()
    }
  });
}));

invitationsRouter.use(authRequired);

invitationsRouter.get('/', requireRoles('personal'), asyncHandler(async (req, res) => {
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
  const result = await query('SELECT invite_code FROM personal_profiles WHERE user_id = $1', [req.user.id]);
  const inviteCode = result.rows[0]?.invite_code;
  res.json({
    inviteCode,
    inviteLink: `${env.appUrl}/register/${inviteCode}`
  });
}));

const createInvitationSchema = z.object({
  email: emailSchema
});

invitationsRouter.post('/', requireRoles('personal'), asyncHandler(async (req, res) => {
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

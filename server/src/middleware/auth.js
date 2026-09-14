import { query } from '../db/pool.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { hashToken } from '../utils/tokens.js';

export async function authRequired(req, res, next) {
  try {
    const authorization = req.headers.authorization || (req.query.access_token ? `Bearer ${req.query.access_token}` : '');
    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw unauthorized();
    }

    const tokenHash = hashToken(token);
    const result = await query(
      `SELECT
        s.id AS session_id,
        s.expires_at,
        u.id,
        u.name,
        u.email,
        u.date_of_birth,
        u.profile_photo_path,
        u.role,
        u.cref,
        pp.specialty,
        pp.invite_code,
        sp.objective,
        sp.start_date,
        sp.restrictions,
        sp.next_assessment_date,
        sp.status AS student_status,
        sp.inactive_reason
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN personal_profiles pp ON pp.user_id = u.id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()`,
      [tokenHash]
    );

    if (result.rowCount === 0) {
      throw unauthorized('Sessao invalida ou expirada.');
    }

    req.session = {
      id: result.rows[0].session_id,
      expiresAt: result.rows[0].expires_at,
      tokenHash
    };

    req.user = toUser(result.rows[0]);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(forbidden());
      return;
    }

    next();
  };
}

export function toUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    dateOfBirth: row.date_of_birth,
    profilePhotoPath: row.profile_photo_path,
    role: row.role,
    cref: row.cref,
    specialty: row.specialty,
    inviteCode: row.invite_code,
    objective: row.objective,
    startDate: row.start_date,
    restrictions: row.restrictions,
    nextAssessmentDate: row.next_assessment_date,
    studentStatus: row.student_status,
    inactiveReason: row.inactive_reason
  };
}

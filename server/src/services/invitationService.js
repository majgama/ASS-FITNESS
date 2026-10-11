export async function resolveInvitation(client, code, { lock = false } = {}) {
  const personal = await client.query(
    `SELECT pp.invite_code, pp.cpf_last_four, pp.whatsapp, u.id AS trainer_id, u.name AS trainer_name
     FROM personal_profiles pp JOIN users u ON u.id = pp.user_id
     WHERE upper(pp.invite_code) = upper($1) AND u.role = 'personal'`,
    [code]
  );
  if (personal.rowCount) {
    const row = personal.rows[0];
    return {
      code: row.invite_code,
      trainerId: row.trainer_id,
      trainerName: row.trainer_name,
      email: null,
      expiresAt: null,
      accepted: false,
      valid: Boolean(row.cpf_last_four && row.whatsapp),
      permanent: true
    };
  }

  const result = await client.query(
    `SELECT i.*, pp.cpf_last_four, pp.whatsapp, u.name AS trainer_name
     FROM invitations i JOIN users u ON u.id = i.trainer_id
     JOIN personal_profiles pp ON pp.user_id = u.id
     WHERE upper(i.code) = upper($1) AND u.role = 'personal'
     ${lock ? 'FOR UPDATE OF i' : ''}`,
    [code]
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    code: row.code,
    trainerId: row.trainer_id,
    trainerName: row.trainer_name,
    email: row.email,
    expiresAt: row.expires_at,
    accepted: Boolean(row.accepted_at),
    valid: Boolean(row.cpf_last_four && row.whatsapp) && !row.accepted_at && new Date(row.expires_at) > new Date(),
    permanent: false
  };
}

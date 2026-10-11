import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { beforeEach, test } from 'node:test';
import { cpfSchema, requiredWhatsappSchema } from '../utils/personalIdentity.js';
import { assertPersonalInviteEnabled, limitPersonalRegistrations, savePersonalIdentity } from './personalIdentityService.js';
import { toUser } from '../middleware/auth.js';

const trainer = 'trainer-a';
const cpf = '52998224725';
const phone = '5511999999999';
let profiles;
let claims;
let attempts;
let clock;
let calls;
let missingKey;
const fingerprint = (value) => createHmac('sha256', 'test-only-identity-key').update(value).digest('hex');

const client = { async query(sql, params = []) {
  calls.push({ sql, params });
  if (sql.includes('FROM anti_abuse_key')) return { rowCount: missingKey ? 0 : 1, rows: missingKey ? [] : [{ fingerprint: fingerprint(params[0]) }] };
  if (sql.includes('SELECT cpf_last_four, whatsapp')) {
    const row = profiles.get(params[0]);
    return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
  }
  if (sql.includes('regexp_replace(whatsapp')) {
    const exists = [...profiles].some(([id, row]) => id !== params[0] && row.whatsapp?.replace(/\D/g, '') === params[1]);
    return { rowCount: exists ? 1 : 0, rows: exists ? [{}] : [] };
  }
  if (sql.includes('INSERT INTO personal_identity_claims')) {
    const key = `${params[0]}:${params[1]}`;
    const exists = claims.has(key);
    const allowed = !exists || claims.get(key) === params[2];
    if (allowed) claims.set(key, params[2]);
    return { rowCount: allowed ? 1 : 0, rows: allowed ? [{ fingerprint: params[1] }] : [] };
  }
  if (sql.includes('SELECT 1 FROM personal_identity_claims')) {
    const exists = claims.get(`cpf:${params[0]}`) === params[1];
    return { rowCount: exists ? 1 : 0, rows: exists ? [{}] : [] };
  }
  if (sql.includes('UPDATE personal_profiles')) {
    profiles.set(params[0], { cpf_last_four: params[1], whatsapp: params[2] });
    return { rowCount: 1, rows: [] };
  }
  if (sql.includes('DELETE FROM registration_attempts')) {
    for (const [key, value] of attempts) if (value.expiresAt <= clock) attempts.delete(key);
    return { rowCount: 0, rows: [] };
  }
  if (sql.includes('INSERT INTO registration_attempts')) {
    const old = attempts.get(params[0]);
    const value = old ? { ...old, count: old.count + 1 } : { count: 1, expiresAt: clock + 600000 };
    attempts.set(params[0], value);
    return { rowCount: 1, rows: [{ attempts: value.count, retry_after: Math.ceil((value.expiresAt - clock) / 1000) }] };
  }
  throw new Error(`Unexpected query: ${sql}`);
} };

async function transaction(callback) {
  const oldProfiles = structuredClone(profiles);
  const oldClaims = new Map(claims);
  try { return await callback(); } catch (error) {
    profiles = oldProfiles;
    claims = oldClaims;
    throw error;
  }
}

beforeEach(() => {
  profiles = new Map([[trainer, { cpf_last_four: null, whatsapp: null }]]);
  claims = new Map();
  attempts = new Map();
  clock = 0;
  calls = [];
  missingKey = false;
});

test('CPF validates check digits, rejects repeated digits, invalid length and letters', () => {
  assert.equal(cpfSchema.parse('529.982.247-25'), cpf);
  for (const value of ['11111111111', '00000000000', '52998224724', '123', 'abc52998224725', '', undefined]) {
    assert.equal(cpfSchema.safeParse(value).success, false);
  }
  assert.equal(requiredWhatsappSchema.parse('+55 (11) 99999-9999'), phone);
  assert.equal(requiredWhatsappSchema.safeParse('').success, false);
});

test('personal links require both data, stored claims never contain the complete CPF', async () => {
  await assert.rejects(assertPersonalInviteEnabled(client, trainer), (error) => error.code === 'PERSONAL_IDENTITY_REQUIRED');
  await savePersonalIdentity(client, trainer, { cpf: '529.982.247-25', whatsapp: '+55 (11) 99999-9999' });
  await assertPersonalInviteEnabled(client, trainer);
  assert.deepEqual(profiles.get(trainer), { cpf_last_four: '4725', whatsapp: phone });
  assert.equal(claims.size, 2);
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO personal_identity_claims'));
  assert.equal(insert.params[1], fingerprint(`cpf:${cpf}`));
  assert.ok(!insert.params.includes(cpf));
  await savePersonalIdentity(client, trainer, { whatsapp: '' });
  await assert.rejects(assertPersonalInviteEnabled(client, trainer), (error) => error.code === 'PERSONAL_IDENTITY_REQUIRED');
});

test('formatting does not bypass uniqueness and failed update rolls back both identities', async () => {
  await savePersonalIdentity(client, trainer, { cpf, whatsapp: phone });
  profiles.set('trainer-b', { cpf_last_four: null, whatsapp: null });
  await assert.rejects(transaction(() => savePersonalIdentity(client, 'trainer-b', { cpf: '529.982.247-25', whatsapp: '5511888888888' })), (error) => error.code === 'IDENTITY_ALREADY_USED');
  await assert.rejects(transaction(() => savePersonalIdentity(client, 'trainer-b', { cpf: '11144477735', whatsapp: '+55 (11) 99999-9999' })), (error) => error.code === 'IDENTITY_ALREADY_USED');
  assert.equal(claims.size, 2);
  assert.equal(profiles.get('trainer-b').cpf_last_four, null);
});

test('existing duplicate WhatsApp prevents claiming without changing other profiles', async () => {
  profiles.set('legacy', { cpf_last_four: null, whatsapp: '+55 (11) 99999-9999' });
  await assert.rejects(transaction(() => savePersonalIdentity(client, trainer, { cpf, whatsapp: phone })), (error) => error.code === 'IDENTITY_ALREADY_USED');
  assert.equal(claims.size, 0);
  assert.equal(profiles.get('legacy').whatsapp, '+55 (11) 99999-9999');
});

test('deleting and recreating an account cannot reclaim CPF or previously used numbers', async () => {
  await savePersonalIdentity(client, trainer, { cpf, whatsapp: phone });
  await savePersonalIdentity(client, trainer, { whatsapp: '5511888888888' });
  profiles.delete(trainer);
  for (const key of claims.keys()) claims.set(key, null);
  profiles.set('new-account', { cpf_last_four: null, whatsapp: null });
  await assert.rejects(transaction(() => savePersonalIdentity(client, 'new-account', { cpf, whatsapp: '5511777777777' })), (error) => error.code === 'IDENTITY_ALREADY_USED');
  for (const whatsapp of [phone, '5511888888888']) {
    await assert.rejects(transaction(() => savePersonalIdentity(client, 'new-account', { cpf: '11144477735', whatsapp })), (error) => error.code === 'IDENTITY_ALREADY_USED');
  }
});

test('same personal can keep identity but cannot replace CPF', async () => {
  await savePersonalIdentity(client, trainer, { cpf, whatsapp: phone });
  await savePersonalIdentity(client, trainer, { cpf: '529.982.247-25', whatsapp: phone });
  await assert.rejects(savePersonalIdentity(client, trainer, { cpf: '11144477735', whatsapp: phone }), /nao pode ser alterado/);
});

test('rate limit allows five attempts, rejects sixth, isolates origins and expires after ten minutes', async () => {
  for (let i = 0; i < 5; i++) await limitPersonalRegistrations(client, '192.0.2.1');
  await assert.rejects(limitPersonalRegistrations(client, '192.0.2.1'), (error) =>
    error.statusCode === 429 && error.details.retryAfter === 600);
  await limitPersonalRegistrations(client, '192.0.2.2');
  clock = 600000;
  await limitPersonalRegistrations(client, '192.0.2.1');
  assert.equal(attempts.size, 1);
  assert.equal([...attempts.values()][0].count, 1);
  assert.ok(calls.filter(({ sql }) => sql.includes('INSERT INTO registration_attempts')).every(({ params }) => !params.includes('192.0.2.1')));
});

test('missing anti-abuse key fails explicitly rather than granting access', async () => {
  missingKey = true;
  await assert.rejects(savePersonalIdentity(client, trainer, { cpf, whatsapp: phone }), /key is missing/);
});

test('authenticated profile exposes only masked CPF data and hides code when incomplete', () => {
  assert.equal(toUser({ role: 'personal', invite_code: 'PT-test' }).inviteCode, null);
  const user = toUser({ role: 'personal', cpf_last_four: '4725', whatsapp: phone, invite_code: 'PT-test' });
  assert.equal(user.hasCpf, true);
  assert.equal(user.canShareInvite, true);
  assert.equal(user.inviteCode, 'PT-test');
  assert.equal(user.cpfLastFour, '4725');
  assert.ok(!('cpf' in user));
});

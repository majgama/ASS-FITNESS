import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import { hashToken } from '../utils/tokens.js';
import { errorHandler } from '../middleware/errorHandler.js';

const trainerId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const invitationId = '33333333-3333-4333-8333-333333333333';
const personalCode = 'PT-PERMANENT';
let trainerExists;
let legacyAccepted;
let legacyExpired;
let profileExists;
let failRelationship;
let calls;
let users;
let server;
let baseUrl;
let registerUser;

async function query(sql, params = []) {
  calls.push({ sql, params });
  if (sql.includes('FROM sessions s')) {
    const role = ['personal', 'student', 'admin'].find((value) => hashToken(value) === params[0]);
    return { rowCount: role ? 1 : 0, rows: role ? [{ id: trainerId, role, name: 'Personal teste' }] : [] };
  }
  if (sql.includes('SELECT invite_code FROM personal_profiles')) {
    return { rowCount: profileExists ? 1 : 0, rows: profileExists ? [{ invite_code: personalCode }] : [] };
  }
  if (sql.includes('FROM personal_profiles pp JOIN users')) {
    const found = trainerExists && String(params[0]).toUpperCase() === personalCode;
    return { rowCount: found ? 1 : 0, rows: found ? [{ invite_code: personalCode, trainer_id: trainerId, trainer_name: 'Personal teste' }] : [] };
  }
  if (sql.includes('FROM invitations i JOIN users')) {
    const found = trainerExists && params[0] === 'ALU-OLD';
    return { rowCount: found ? 1 : 0, rows: found ? [{
      id: invitationId, code: 'ALU-OLD', trainer_id: trainerId, trainer_name: 'Personal teste',
      email: 'old@example.test', accepted_at: legacyAccepted ? new Date() : null,
      expires_at: new Date(Date.now() + (legacyExpired ? -1 : 1) * 86400000)
    }] : [] };
  }
  if (sql.includes('INSERT INTO users')) {
    if (users.some((user) => user.email === params[1].toLowerCase())) {
      const error = new Error('Duplicate email');
      error.code = '23505';
      throw error;
    }
    const user = { id: studentId, name: params[0], email: params[1].toLowerCase(), role: params[3] };
    users.push(user);
    return { rowCount: 1, rows: [user] };
  }
  if (sql.includes('INSERT INTO trainer_students') && failRelationship) throw new Error('Relationship insert failed');
  if (sql.startsWith('UPDATE invitations')) legacyAccepted = true;
  if (sql.includes('SELECT u.*, pp.specialty')) return { rowCount: 1, rows: [users.at(-1)] };
  return { rowCount: 0, rows: [] };
}

before(async () => {
  mock.module('../db/pool.js', {
    namedExports: {
      query,
      withTransaction: async (callback) => {
        const previousUsers = [...users];
        const previousAccepted = legacyAccepted;
        await query('BEGIN');
        try {
          const result = await callback({ query });
          await query('COMMIT');
          return result;
        } catch (error) {
          users = previousUsers;
          legacyAccepted = previousAccepted;
          await query('ROLLBACK');
          throw error;
        }
      }
    }
  });
  ({ registerUser } = await import('../services/authService.js'));
  const { invitationsRouter } = await import('./invitations.js');
  const { authRouter } = await import('./auth.js');
  const app = express();
  app.use(express.json());
  app.use('/invitations', invitationsRouter);
  app.use('/auth', authRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  trainerExists = true;
  legacyAccepted = false;
  legacyExpired = false;
  profileExists = true;
  failRelationship = false;
  calls = [];
  users = [];
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

const payload = (email, inviteCode = personalCode) => ({
  name: 'Aluno teste', email, password: 'password-test-123', role: 'student', inviteCode
});

test('public permanent link identifies trainer without email, expiration or acceptance', async () => {
  const response = await fetch(`${baseUrl}/invitations/${personalCode.toLowerCase()}`);
  assert.equal(response.status, 200);
  const { invitation } = await response.json();
  assert.deepEqual(invitation, {
    code: personalCode, email: null, trainerName: 'Personal teste',
    expiresAt: null, accepted: false, valid: true, permanent: true
  });
  assert.ok(!calls.some(({ sql }) => sql.startsWith('UPDATE')));
});

test('personal retrieves the same stored share link repeatedly, without creating invitations', async () => {
  const get = () => fetch(`${baseUrl}/invitations/me/code`, { headers: { Authorization: 'Bearer personal' } });
  const first = await (await get()).json();
  const second = await (await get()).json();
  assert.deepEqual(first, second);
  assert.equal(first.inviteCode, personalCode);
  assert.ok(first.inviteLink.endsWith(`/register/${personalCode}`));
  assert.ok(!calls.some(({ sql }) => sql.includes('INSERT')));
  assert.equal((await fetch(`${baseUrl}/invitations/me/code`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/invitations/me/code`, { headers: { Authorization: 'Bearer student' } })).status, 403);
});

test('missing profile returns an explicit error rather than a broken link', async () => {
  profileExists = false;
  assert.equal((await fetch(`${baseUrl}/invitations/me/code`, { headers: { Authorization: 'Bearer personal' } })).status, 404);
});

test('multiple students register with their own emails through the same permanent code', async () => {
  for (const email of ['first@example.test', 'second@example.test']) {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(email, personalCode.toLowerCase()))
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).user.role, 'student');
  }
  const relationships = calls.filter(({ sql }) => sql.includes('INSERT INTO trainer_students'));
  assert.equal(relationships.length, 2);
  assert.ok(relationships.every(({ params }) => params[0] === trainerId && params[1] === studentId));
  assert.ok(!calls.some(({ sql }) => sql.startsWith('UPDATE invitations')));
  assert.equal(users.length, 2);
});

test('deleted trainers and unknown codes cannot create student accounts', async () => {
  trainerExists = false;
  assert.equal((await fetch(`${baseUrl}/invitations/${personalCode}`)).status, 404);
  await assert.rejects(registerUser(payload('student@example.test')), /Convite invalido/);
  await assert.rejects(registerUser(payload('student@example.test', 'unknown')), /Convite invalido/);
  await assert.rejects(registerUser(payload('student@example.test', null)), /Convite obrigatorio/);
  assert.equal(users.length, 0);
});

test('legacy invitations still bind the email, expire, and are consumed once under a row lock', async () => {
  await assert.rejects(registerUser(payload('different@example.test', 'ALU-OLD')), /Convite invalido/);
  legacyExpired = true;
  await assert.rejects(registerUser(payload('old@example.test', 'ALU-OLD')), /Convite invalido/);
  legacyExpired = false;
  await registerUser(payload('old@example.test', 'ALU-OLD'));
  assert.equal(legacyAccepted, true);
  await assert.rejects(registerUser(payload('old@example.test', 'ALU-OLD')), /Convite invalido/);
  assert.ok(calls.some(({ sql }) => sql.includes('FOR UPDATE OF i')));
  assert.equal(calls.find(({ sql }) => sql.startsWith('UPDATE invitations')).params[0], invitationId);
});

test('failed trainer relationship rolls back account creation without consuming the permanent link', async () => {
  failRelationship = true;
  await assert.rejects(registerUser(payload('student@example.test')), /Relationship insert failed/);
  assert.equal(users.length, 0);
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
  failRelationship = false;
  await registerUser(payload('student@example.test'));
  assert.equal(users.length, 1);
});

test('duplicate student email returns conflict without consuming the share link', async () => {
  await registerUser(payload('student@example.test'));
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload('student@example.test'))
  });
  assert.equal(response.status, 409);
  assert.equal(users.length, 1);
  assert.ok(!calls.some(({ sql }) => sql.startsWith('UPDATE invitations')));
});

test('public legacy invitation response retains email and validity', async () => {
  const first = await (await fetch(`${baseUrl}/invitations/ALU-OLD`)).json();
  assert.equal(first.invitation.email, 'old@example.test');
  assert.equal(first.invitation.permanent, false);
  assert.equal(first.invitation.valid, true);
  legacyAccepted = true;
  const accepted = await (await fetch(`${baseUrl}/invitations/ALU-OLD`)).json();
  assert.equal(accepted.invitation.valid, false);
});

test('personal public registration still creates a stored permanent code and billing profile', async () => {
  const personal = await registerUser({ name: 'Personal novo', email: 'personal@example.test', password: 'password-test-123', role: 'personal' });
  assert.equal(personal.role, 'personal');
  assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO personal_profiles')));
  assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO trainer_billing')));
  assert.ok(!calls.some(({ sql }) => sql.includes('INSERT INTO trainer_students')));
});

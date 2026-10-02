import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canManageWorkoutModel, isWorkoutModelInView } from './pageHelpers.js';

const admin = { id: 'admin', role: 'admin' };
const personal = { id: 'personal', role: 'personal' };
const models = [
  { visibility: 'public', owner_id: null },
  { visibility: 'private', owner_id: 'personal' },
  { visibility: 'private', owner_id: 'other-personal' },
  { visibility: 'private', owner_id: 'admin' }
];

test('admin can manage public models and private models of any owner', () => {
  assert.ok(models.every((model) => canManageWorkoutModel(admin, model)));
  assert.deepEqual(models.filter((model) => isWorkoutModelInView(admin, model, 'mine')), models.slice(1));
  assert.deepEqual(models.filter((model) => isWorkoutModelInView(admin, model, 'public')), models.slice(0, 1));
});

test('personal sees and manages only their private models, while public models remain read-only', () => {
  assert.deepEqual(models.filter((model) => canManageWorkoutModel(personal, model)), [models[1]]);
  assert.deepEqual(models.filter((model) => isWorkoutModelInView(personal, model, 'mine')), [models[1]]);
  assert.deepEqual(models.filter((model) => isWorkoutModelInView(personal, model, 'public')), [models[0]]);
  assert.ok(!canManageWorkoutModel({ id: 'personal', role: 'student' }, models[1]));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uniqueExerciseList, canManageWorkoutModel, isWorkoutModelInView } from './pageHelpers.js';

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

test('exercise lists collapse matching image, sets, repetitions and description without mutating records', () => {
  const base = { id: 'first', name: 'Name A', gif_library_path: 'gif-1', default_sets: 3, default_repetitions: '10-12', observations: 'Control movement' };
  const duplicate = { ...base, id: 'second', name: 'Name B' };
  const variants = [
    { ...base, id: 'image', gif_library_path: 'gif-2' },
    { ...base, id: 'sets', default_sets: 4 },
    { ...base, id: 'reps', default_repetitions: '15' },
    { ...base, id: 'notes', observations: 'Different instruction' }
  ];
  const rows = [base, duplicate, ...variants];
  assert.deepEqual(uniqueExerciseList(rows), [base, ...variants]);
  assert.equal(rows.length, 6);
  assert.equal(rows[1], duplicate);
});

test('exercise lists preserve missing images and distinguish uploaded and catalog images', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c', gif_path: 'same' }, { id: 'd', gif_library_path: 'same' }, { id: 'e', gif_path: 'same' }];
  assert.deepEqual(uniqueExerciseList(rows).map(x => x.id), ['a', 'b', 'c', 'd']);
});

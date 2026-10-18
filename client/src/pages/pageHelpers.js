export const weekDays = [
  'Domingo',
  'Segunda',
  'Terca',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sabado'
];

export function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value));
}

export function roleLabel(role) {
  return {
    admin: 'Administrador',
    personal: 'Personal trainer',
    student: 'Aluno'
  }[role] || role;
}

export function firstName(name = '') {
  return name.split(' ')[0] || name;
}

export function emptyForm(event) {
  const form = new FormData(event.currentTarget);
  return Object.fromEntries(form.entries());
}

export function normalizeSnapshot(snapshot) {
  if (!snapshot) return null;
  return typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
}

export function canManageWorkoutModel(user, model) {
  return user.role === 'admin' || (user.role === 'personal' && model.visibility === 'private' && model.owner_id === user.id);
}

export function isWorkoutModelInView(user, model, view) {
  if (view === 'public') return model.visibility === 'public';
  return model.visibility === 'private' && (user.role === 'admin' || model.owner_id === user.id);
}

// Keep source records intact; only collapse identical image/prescription entries in lists.
export function uniqueExerciseList(exercises) {
  const seen = new Set();
  const value = (input) => String(input ?? '').trim();
  return exercises.filter((exercise) => {
    const image = exercise.gif_library_path
      ? ['library', exercise.gif_library_path]
      : exercise.gif_path ? ['gif', exercise.gif_path] : null;
    if (!image) return true;
    const key = JSON.stringify([image, value(exercise.default_sets), value(exercise.default_repetitions), value(exercise.observations)]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

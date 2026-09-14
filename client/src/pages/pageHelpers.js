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

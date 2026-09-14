export function StatusBadge({ value }) {
  const normalized = String(value || '').toLowerCase();
  const label = {
    active: 'Ativo',
    inactive: 'Inativo',
    completed: 'Concluido',
    public: 'Publico',
    private: 'Particular',
    free: 'Gratis',
    canceled: 'Cancelado',
    refunded: 'Reembolsado',
    chargeback: 'Chargeback'
  }[normalized] || value;

  return <span className={`badge badge-${normalized}`}>{label}</span>;
}

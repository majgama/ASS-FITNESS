export function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="stat-card">
      <div>
        <span>{label}</span>
        <strong>{value ?? 0}</strong>
      </div>
      {Icon ? <Icon size={22} /> : null}
    </div>
  );
}

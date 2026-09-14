import { useEffect, useState } from 'react';
import { Shield, Users } from 'lucide-react';
import { api } from '../api/client.js';
import { StatCard } from '../components/StatCard.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function Admin() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState({});
  const [personals, setPersonals] = useState([]);
  const [students, setStudents] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user.role !== 'admin') return;
    Promise.all([
      api('/admin/metrics'),
      api('/admin/personals'),
      api('/admin/students')
    ])
      .then(([metricData, personalData, studentData]) => {
        setMetrics(metricData.metrics);
        setPersonals(personalData.personals);
        setStudents(studentData.students);
      })
      .catch((err) => setError(err.message));
  }, [user.role]);

  if (user.role !== 'admin') {
    return <section className="page"><div className="panel empty-state">Acesso administrativo restrito</div></section>;
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span>Administracao</span>
          <h1>Controle da plataforma</h1>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="stats-grid">
        <StatCard label="Personais" value={metrics.personals} icon={Shield} />
        <StatCard label="Alunos" value={metrics.students} icon={Users} />
        <StatCard label="Alunos ativos" value={metrics.active_students} icon={Users} />
        <StatCard label="Exercicios publicos" value={metrics.public_exercises} icon={Shield} />
      </div>

      <div className="two-column wide-left">
        <section className="panel">
          <div className="section-title"><h2>Personais</h2></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>CREF</th>
                  <th>Alunos</th>
                  <th>Cobranca</th>
                </tr>
              </thead>
              <tbody>
                {personals.map((personal) => (
                  <tr key={personal.id}>
                    <td>{personal.name}</td>
                    <td>{personal.email}</td>
                    <td>{personal.cref || '-'}</td>
                    <td>{personal.students_count}</td>
                    <td><StatusBadge value={personal.billing_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="section-title"><h2>Alunos</h2></div>
          <div className="list-stack">
            {students.slice(0, 12).map((student) => (
              <article className="list-item" key={student.id}>
                <div>
                  <strong>{student.name}</strong>
                  <span>{(student.trainers || []).map((trainer) => trainer.name).join(', ') || 'Sem personal'}</span>
                </div>
                <StatusBadge value={student.status} />
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

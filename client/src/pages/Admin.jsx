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
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState('');

  async function load() {
    const [metricData, personalData, studentData] = await Promise.all([
      api('/admin/metrics'),
      api('/admin/personals'),
      api('/admin/students')
    ]);
    setMetrics(metricData.metrics);
    setPersonals(personalData.personals);
    setStudents(studentData.students);
  }

  useEffect(() => {
    if (user.role !== 'admin') return;
    load().catch((err) => setError(err.message));
  }, [user.role]);

  async function deleteUser(target, role) {
    const personal = role === 'personal';
    const warning = personal
      ? 'Os modelos privados de exercícios, treinos, planos e dietas deste personal serão apagados. Os alunos e seus treinos aplicados serão mantidos, sem o vínculo com este personal. Exercícios privados também serão removidos dos modelos que os utilizam.'
      : 'A conta, os treinos aplicados, as avaliações, os pagamentos e o histórico deste aluno serão apagados.';
    if (!window.confirm(`Excluir permanentemente ${personal ? 'o personal' : 'o aluno'} "${target.name}"? ${warning} Esta ação não pode ser desfeita.`)) return;
    setError('');
    setNotice('');
    setDeletingId(target.id);
    try {
      await api(personal ? `/admin/personals/${target.id}` : `/students/${target.id}`, { method: 'DELETE' });
      setNotice(`${personal ? 'Personal' : 'Aluno'} "${target.name}" excluído.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId('');
    }
  }

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
      {notice ? <div className="alert alert-success">{notice}</div> : null}

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
                  <th>Ações</th>
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
                    <td className="table-actions">
                      <button type="button" disabled={Boolean(deletingId)} onClick={() => deleteUser(personal, 'personal')}>
                        {deletingId === personal.id ? 'Excluindo...' : 'Excluir personal'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="section-title"><h2>Alunos</h2></div>
          <div className="list-stack">
            {students.map((student) => (
              <article className="list-item" key={student.id}>
                <div>
                  <strong>{student.name}</strong>
                  <span>{(student.trainers || []).map((trainer) => trainer.name).join(', ') || 'Sem personal'}</span>
                </div>
                <div className="actions table-actions">
                  <StatusBadge value={student.status} />
                  <button type="button" disabled={Boolean(deletingId)} onClick={() => deleteUser(student, 'student')}>
                    {deletingId === student.id ? 'Excluindo...' : 'Excluir aluno'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

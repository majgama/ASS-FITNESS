import { useEffect, useState } from 'react';
import { Activity, Apple, Dumbbell, Users } from 'lucide-react';
import { api } from '../api/client.js';
import { StatCard } from '../components/StatCard.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { firstName, formatDate } from './pageHelpers.js';

export function Dashboard() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, metrics: {}, students: [], capacity: null, error: '' });

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        if (user.role === 'admin') {
          const [metrics, students] = await Promise.all([
            api('/admin/metrics'),
            api('/students?status=active')
          ]);
          if (alive) setState({ loading: false, metrics: metrics.metrics, students: students.students, capacity: null, error: '' });
        } else {
          const students = await api('/students?status=active');
          if (alive) setState({ loading: false, metrics: {}, students: students.students, capacity: students.capacity, error: '' });
        }
      } catch (error) {
        if (alive) setState((current) => ({ ...current, loading: false, error: error.message }));
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [user.role]);

  const activeStudents = user.role === 'admin' ? state.metrics.active_students : state.students.length;
  const freeLabel = state.capacity ? `${state.capacity.activeStudents}/${state.capacity.allowedStudents}` : state.metrics.personals;

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span>Dashboard</span>
          <h1>Ola, {firstName(user.name)}</h1>
        </div>
      </div>

      {state.error ? <div className="alert alert-error">{state.error}</div> : null}

      <div className="stats-grid">
        <StatCard label="Alunos ativos" value={activeStudents} icon={Users} />
        <StatCard label={user.role === 'admin' ? 'Personais' : 'Limite atual'} value={freeLabel} icon={Activity} />
        <StatCard label="Exercicios publicos" value={state.metrics.public_exercises || 0} icon={Dumbbell} />
        <StatCard label="Planos publicos" value={state.metrics.public_weekly_plans || 0} icon={Apple} />
      </div>

      {state.capacity && state.capacity.activeStudents >= state.capacity.freeStudentLimit && !state.capacity.paidActive ? (
        <div className="alert alert-warning">
          Limite gratis atingido. A liberacao de novos alunos acontece pela Hotmart.
        </div>
      ) : null}

      <section className="panel">
        <div className="section-title">
          <h2>Alunos recentes</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Objetivo</th>
                <th>Inicio</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.students.slice(0, 8).map((student) => (
                <tr key={student.id}>
                  <td>{student.name}</td>
                  <td>{student.objective || '-'}</td>
                  <td>{formatDate(student.start_date)}</td>
                  <td><StatusBadge value={student.status} /></td>
                </tr>
              ))}
              {!state.loading && state.students.length === 0 ? (
                <tr>
                  <td colSpan="4" className="empty-cell">Nenhum aluno ativo</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ClipboardList, Dumbbell, FileText, Save, Utensils, WalletCards } from 'lucide-react';
import { api, fileUrl } from '../api/client.js';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { formatDate, normalizeSnapshot } from './pageHelpers.js';

function planName(plan) {
  return normalizeSnapshot(plan?.plan_snapshot)?.name || 'Treino sem nome';
}

export function StudentManagement() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, student: null, plans: [], diets: [], assessments: [], billing: null, payments: [], error: '' });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [studentsData, plansData, dietsData, assessmentsData, billingData] = await Promise.all([
          api('/students?status=all'),
          api(`/workouts/students/${studentId}/history`),
          api(`/diets/students/${studentId}`),
          api(`/assessments/students/${studentId}`),
          api(`/students/${studentId}/billing`)
        ]);
        const student = studentsData.students.find((item) => item.id === studentId) || null;
        if (active) {
          setState({
            loading: false,
            student,
            plans: plansData.plans,
            diets: dietsData.diets,
            assessments: assessmentsData.assessments,
            billing: billingData.billing,
            payments: billingData.payments,
            error: student ? '' : 'Aluno não encontrado.'
          });
        }
      } catch (error) {
        if (active) setState((current) => ({ ...current, loading: false, error: error.message }));
      }
    }
    load();
    return () => { active = false; };
  }, [studentId, refreshKey]);

  async function saveBilling(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/students/${studentId}/billing`, {
      method: 'PATCH',
      body: {
        dueDate: form.get('dueDate') || null,
        monthlyAmount: form.get('monthlyAmount') || null,
        status: form.get('status')
      }
    });
    setRefreshKey((current) => current + 1);
  }

  async function addPayment(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await api(`/students/${studentId}/payments`, {
      method: 'POST',
      body: {
        amount: form.get('amount') || null,
        dueDate: form.get('dueDate') || null,
        paidAt: form.get('paidAt') || null,
        status: form.get('status'),
        note: form.get('note') || null
      }
    });
    formElement.reset();
    setRefreshKey((current) => current + 1);
  }

  const activePlan = useMemo(() => state.plans.find((plan) => plan.status === 'active'), [state.plans]);
  const archivedPlans = useMemo(() => state.plans.filter((plan) => plan.status !== 'active'), [state.plans]);
  const currentDiet = useMemo(() => normalizeSnapshot(state.diets[0]?.diet_snapshot), [state.diets]);
  const progress = state.student?.workoutProgress || {};

  if (state.loading) return <section className="page"><div className="empty-state">Carregando aluno...</div></section>;
  if (state.error || !state.student) return <section className="page"><div className="alert alert-error">{state.error || 'Aluno não encontrado.'}</div></section>;

  const { student } = state;
  return (
    <section className="page student-management-page">
      <button type="button" className="back-link" onClick={() => navigate('/alunos')}><ArrowLeft size={17} />Alunos</button>

      <header className="student-management-header">
        <div className="student-management-profile">
          <div className="student-management-avatar">
            {student.profile_photo_path ? <img src={fileUrl(student.profile_photo_path)} alt={student.name} /> : student.name.slice(0, 2)}
          </div>
          <div>
            <span>Gestão do aluno</span>
            <h1>{student.name}</h1>
            <div className="student-management-meta"><StatusBadge value={student.status} /><small>Início: {formatDate(student.start_date)}</small></div>
          </div>
        </div>
        <div className="student-management-actions">
          <Link className="secondary-button" to="/avaliacoes" state={{ studentId }}><ClipboardList size={16} />Nova avaliação</Link>
          <Link className="primary-button" to="/treinos" state={{ studentId }}><Dumbbell size={16} />Montar treino</Link>
        </div>
      </header>

      <div className="student-management-overview">
        <section className="management-card progress-card">
          <span>Evolução do treino</span>
          <strong>{progress.percentage || 0}%</strong>
          <div className="progress-track"><i style={{ width: `${progress.percentage || 0}%` }} /></div>
          <small>{progress.hasActivePlan ? `${progress.completedDays}/${progress.plannedDays} atividades realizadas` : 'Nenhum treino ativo'}</small>
        </section>
        <section className="management-card">
          <span>Objetivo</span>
          <strong>{student.objective || 'Não informado'}</strong>
          <small>{student.restrictions || 'Sem restrições registradas'}</small>
        </section>
        <section className="management-card">
          <span>Próxima avaliação</span>
          <strong>{formatDate(student.next_assessment_date)}</strong>
          <small>{state.assessments.length} avaliação(ões) registrada(s)</small>
        </section>
      </div>

      <div className="student-management-grid">
        <section className="management-panel">
          <div className="management-panel-title"><Dumbbell size={18} /><h2>Treino ativo</h2></div>
          {activePlan ? <div className="management-record"><strong>{planName(activePlan)}</strong><span>Iniciado em {formatDate(activePlan.start_date)}</span></div> : <p className="muted">Nenhum treino ativo.</p>}
          <Link to="/treinos" state={{ studentId }}>Montar ou aplicar treino</Link>
        </section>

        <section className="management-panel">
          <div className="management-panel-title"><Utensils size={18} /><h2>Dietas</h2></div>
          {currentDiet ? <div className="management-record"><strong>{currentDiet.name}</strong><span>Aplicada em {formatDate(state.diets[0]?.applied_at)}</span></div> : <p className="muted">Nenhuma dieta aplicada.</p>}
          <Link to="/dietas" state={{ studentId }}>Montar ou aplicar dieta</Link>
        </section>

        <section className="management-panel">
          <div className="management-panel-title"><FileText size={18} /><h2>Avaliações</h2></div>
          {state.assessments.slice(0, 3).map((assessment) => <div className="management-record" key={assessment.id}><strong>{formatDate(assessment.assessment_date)}</strong><span>{assessment.body_goal || 'Avaliação corporal'}</span></div>)}
          {state.assessments.length === 0 ? <p className="muted">Nenhuma avaliação registrada.</p> : null}
          <Link to="/avaliacoes" state={{ studentId }}>Lista e nova avaliação</Link>
        </section>

        <section className="management-panel">
          <div className="management-panel-title"><CalendarDays size={18} /><h2>Treinos arquivados</h2></div>
          {archivedPlans.slice(0, 3).map((plan) => <div className="management-record" key={plan.id}><strong>{planName(plan)}</strong><span>Concluído em {formatDate(plan.completed_at)}</span></div>)}
          {archivedPlans.length === 0 ? <p className="muted">Nenhum treino arquivado.</p> : null}
        </section>

        <section className="management-panel management-panel-wide">
          <div className="management-panel-title"><WalletCards size={18} /><h2>Mensalidades</h2></div>
          <div className="billing-grid">
            <form className="billing-form" onSubmit={saveBilling}>
              <label>Próximo vencimento<input name="dueDate" type="date" defaultValue={state.billing?.due_date?.slice(0, 10) || ''} /></label>
              <label>Valor mensal<input name="monthlyAmount" type="number" min="0" step="0.01" defaultValue={state.billing?.monthly_amount || ''} /></label>
              <label>Status<select name="status" defaultValue={state.billing?.status || 'pending'}><option value="pending">Pendente</option><option value="paid">Pago</option><option value="overdue">Vencido</option></select></label>
              <button className="secondary-button" type="submit"><Save size={15} />Salvar vencimento</button>
            </form>
            <form className="billing-form" onSubmit={addPayment}>
              <label>Valor<input name="amount" type="number" min="0" step="0.01" /></label>
              <label>Vencimento<input name="dueDate" type="date" /></label>
              <label>Pagamento<input name="paidAt" type="date" /></label>
              <label>Status<select name="status" defaultValue="paid"><option value="paid">Pago</option><option value="pending">Pendente</option><option value="overdue">Vencido</option></select></label>
              <label className="wide">Observação<input name="note" /></label>
              <button className="primary-button" type="submit"><Save size={15} />Registrar mensalidade</button>
            </form>
          </div>
          <div className="payment-history">
            {state.payments.map((payment) => <div className="management-record" key={payment.id}><strong>R$ {Number(payment.amount || 0).toFixed(2)}</strong><span>{payment.status === 'paid' ? `Pago em ${formatDate(payment.paid_at)}` : `Vencimento: ${formatDate(payment.due_date)}`} {payment.note ? `· ${payment.note}` : ''}</span></div>)}
            {state.payments.length === 0 ? <p className="muted">Nenhuma mensalidade registrada.</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
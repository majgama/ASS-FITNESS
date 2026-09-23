import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Copy, Plus, UserPlus } from 'lucide-react';
import { api, fileUrl } from '../api/client.js';
import { Modal } from '../components/Modal.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate } from './pageHelpers.js';
import { useNavigate } from 'react-router-dom';

export function Students() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [capacity, setCapacity] = useState(null);
  const [personals, setPersonals] = useState([]);
  const [filter, setFilter] = useState('active');
  const [modal, setModal] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const canManage = user.role === 'admin' || user.role === 'personal';

  async function load() {
    setError('');
    const query = filter === 'all' ? '' : `?status=${filter}`;
    try {
      const data = await api(`/students${query}`);
      setStudents(data.students);
      setCapacity(data.capacity || null);
      if (user.role === 'admin') {
        const adminData = await api('/admin/personals');
        setPersonals(adminData.personals);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [filter]);

  const activeLimitText = useMemo(() => {
    if (!capacity) return '';
    return `${capacity.activeStudents}/${capacity.allowedStudents}`;
  }, [capacity]);

  async function createStudent(event) {
    event.preventDefault();
    setError('');
    setTemporaryPassword('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await api('/students', {
        method: 'POST',
        body: {
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password') || null,
          objective: form.get('objective') || null,
          startDate: form.get('startDate') || null,
          restrictions: form.get('restrictions') || null,
          nextAssessmentDate: form.get('nextAssessmentDate') || null,
          status: form.get('status'),
          trainerId: form.get('trainerId') || null,
          relationshipType: form.get('relationshipType') || 'primary'
        }
      });
      setTemporaryPassword(data.temporaryPassword || '');
      setNotice('Aluno cadastrado.');
      setModal('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateStatus(student, nextStatus) {
    const inactiveReason = nextStatus === 'inactive' ? window.prompt('Motivo da inativacao') || '' : null;
    await api(`/students/${student.id}/status`, {
      method: 'PATCH',
      body: { status: nextStatus, inactiveReason }
    });
    await load();
  }

  async function createInvite(event) {
    event.preventDefault();
    setError('');
    setInviteLink('');
    try {
      const data = await api('/invitations', { method: 'POST', body: { email: inviteEmail } });
      setInviteLink(data.inviteLink);
      setNotice('Convite gerado.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteLink);
    setNotice('Link copiado.');
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span>Alunos</span>
          <h1>Gestao de alunos</h1>
        </div>
        {canManage ? (
          <div className="actions">
            {user.role === 'personal' ? (
              <button className="secondary-button fit-button" type="button" onClick={() => setModal('invite')}>
                <UserPlus size={18} />
                Convite
              </button>
            ) : null}
            <button className="primary-button fit-button" type="button" onClick={() => setModal('student')}>
              <Plus size={18} />
              Aluno
            </button>
          </div>
        ) : null}
      </div>

      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}
      {temporaryPassword ? <div className="alert">Senha temporaria: {temporaryPassword}</div> : null}
      {capacity ? <div className="alert">Alunos ativos no plano atual: {activeLimitText}</div> : null}

      <div className="segmented">
        {[
          ['active', 'Ativos'],
          ['inactive', 'Inativos'],
          ['all', 'Todos']
        ].map(([value, label]) => (
          <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>

      {user.role === 'personal' ? (
        <section className="student-roster" aria-label="Lista de alunos">
          {students.map((student) => {
            const progress = student.workoutProgress || {};
            return (
              <button className="student-roster-item" type="button" key={student.id} onClick={() => navigate(`/alunos/${student.id}`)}>
                <div className="student-roster-avatar">
                  {student.profile_photo_path ? <img src={fileUrl(student.profile_photo_path)} alt="" /> : student.name.slice(0, 2)}
                </div>
                <div className="student-roster-name">
                  <strong>{student.name.split(' ')[0]}</strong>
                  <StatusBadge value={student.status} />
                </div>
                <div className="student-roster-progress">
                  <span>Evolução</span>
                  <strong>{progress.percentage || 0}%</strong>
                  <i><b style={{ width: `${progress.percentage || 0}%` }} /></i>
                  <small>{progress.hasActivePlan ? `${progress.completedDays}/${progress.plannedDays} atividades` : 'Sem treino ativo'}</small>
                </div>
                <ChevronRight className="student-roster-chevron" size={20} />
              </button>
            );
          })}
          {students.length === 0 ? <div className="empty-state">Nenhum aluno encontrado</div> : null}
        </section>
      ) : (
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Objetivo</th>
                <th>Proxima avaliacao</th>
                <th>Personais</th>
                <th>Status</th>
                {canManage ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td>{student.name}</td>
                  <td>{student.email}</td>
                  <td>{student.objective || '-'}</td>
                  <td>{formatDate(student.next_assessment_date)}</td>
                  <td>{(student.trainers || []).map((trainer) => trainer.name).join(', ') || '-'}</td>
                  <td><StatusBadge value={student.status} /></td>
                  {canManage ? (
                    <td className="table-actions">
                      {student.status === 'active' ? (
                        <button type="button" onClick={() => updateStatus(student, 'inactive')}>Inativar</button>
                      ) : (
                        <button type="button" onClick={() => updateStatus(student, 'active')}>Ativar</button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
              {students.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="empty-cell">Nenhum aluno encontrado</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      )}

      <Modal title="Cadastrar aluno" open={modal === 'student'} onClose={() => setModal('')}>
        <form className="form-stack" onSubmit={createStudent}>
          <div className="form-grid">
            <label>Nome<input name="name" required /></label>
            <label>E-mail<input name="email" type="email" required /></label>
            <label>Senha<input name="password" type="password" minLength="8" /></label>
            <label>Objetivo<input name="objective" /></label>
            <label>Data de inicio<input name="startDate" type="date" /></label>
            <label>Proxima avaliacao<input name="nextAssessmentDate" type="date" /></label>
            <label>Status
              <select name="status" defaultValue="active">
                <option value="active">Ativo</option>
                <option value="inactive">Inativo</option>
              </select>
            </label>
            <label>Vinculo
              <select name="relationshipType" defaultValue="primary">
                <option value="primary">Primario</option>
                <option value="secondary">Secundario</option>
              </select>
            </label>
            {user.role === 'admin' ? (
              <label>Personal
                <select name="trainerId">
                  <option value="">Sem vinculo</option>
                  {personals.map((personal) => (
                    <option key={personal.id} value={personal.id}>{personal.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="wide">Restricoes<textarea name="restrictions" rows="3" /></label>
          </div>
          <button className="primary-button" type="submit">Salvar</button>
        </form>
      </Modal>

      <Modal title="Gerar convite" open={modal === 'invite'} onClose={() => setModal('')}>
        <form className="form-stack" onSubmit={createInvite}>
          <label>E-mail do aluno<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required /></label>
          <button className="primary-button" type="submit">Gerar</button>
          {inviteLink ? (
            <div className="copy-line">
              <input value={inviteLink} readOnly />
              <button className="icon-button solid" type="button" onClick={copyInvite} aria-label="Copiar convite">
                <Copy size={18} />
              </button>
            </div>
          ) : null}
        </form>
      </Modal>
    </section>
  );
}

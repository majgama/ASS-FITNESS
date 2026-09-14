import { useEffect, useMemo, useState } from 'react';
import { Apple, Save } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate, normalizeSnapshot } from './pageHelpers.js';

export function Diets() {
  const { user } = useAuth();
  const [diets, setDiets] = useState([]);
  const [students, setStudents] = useState([]);
  const [studentHistory, setStudentHistory] = useState([]);
  const [currentDiet, setCurrentDiet] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      if (user.role === 'student') {
        const [current, history] = await Promise.all([
          api('/diets/student/current'),
          api(`/diets/students/${user.id}`)
        ]);
        setCurrentDiet(current.currentDiet);
        setStudentHistory(history.diets);
        return;
      }

      const [dietData, studentData] = await Promise.all([
        api('/diets'),
        api('/students?status=active')
      ]);
      setDiets(dietData.diets);
      setStudents(studentData.students);
      setSelectedStudent((current) => current || studentData.students[0]?.id || '');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [user.role]);

  useEffect(() => {
    if (!selectedStudent || user.role === 'student') return;
    api(`/diets/students/${selectedStudent}`)
      .then((data) => setStudentHistory(data.diets))
      .catch((err) => setError(err.message));
  }, [selectedStudent, user.role]);

  async function createDiet(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api('/diets', {
        method: 'POST',
        body: {
          name: form.get('name'),
          planDate: form.get('planDate') || null,
          generalGuidelines: form.get('generalGuidelines') || null
        }
      });
      formElement.reset();
      setNotice('Dieta criada.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function applyDiet(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/diets/${form.get('dietId')}/apply`, {
        method: 'POST',
        body: { studentId: form.get('studentId') }
      });
      setNotice('Dieta aplicada.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const currentDietData = useMemo(
    () => normalizeSnapshot(currentDiet?.diet_snapshot || studentHistory[0]?.diet_snapshot),
    [currentDiet, studentHistory]
  );

  if (user.role === 'student') {
    return (
      <section className="page">
        <div className="page-heading">
          <div>
            <span>Dieta</span>
            <h1>{currentDietData?.name || 'Plano alimentar'}</h1>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="panel">
          <p className="diet-text">{currentDietData?.general_guidelines || 'Sem dieta aplicada'}</p>
        </section>
        <section className="panel">
          <div className="section-title"><h2>Historico</h2></div>
          <div className="list-stack">
            {studentHistory.map((item) => {
              const snapshot = normalizeSnapshot(item.diet_snapshot);
              return (
                <article className="list-item" key={item.id}>
                  <div>
                    <strong>{snapshot?.name}</strong>
                    <span>{formatDate(item.applied_at)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span>Dietas</span>
          <h1>Planos simples</h1>
        </div>
      </div>

      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="two-column">
        <section className="panel">
          <div className="section-title">
            <h2>Nova dieta</h2>
          </div>
          <form className="form-stack" onSubmit={createDiet}>
            <label>Nome<input name="name" required /></label>
            <label>Data<input name="planDate" type="date" /></label>
            <label>Orientacoes gerais<textarea name="generalGuidelines" rows="8" /></label>
            <button className="primary-button fit-button" type="submit"><Apple size={18} />Criar</button>
          </form>
        </section>

        <section className="panel">
          <div className="section-title">
            <h2>Aplicar dieta</h2>
          </div>
          <form className="form-stack" onSubmit={applyDiet}>
            <label>Dieta
              <select name="dietId" required>
                <option value="">Selecione</option>
                {diets.map((diet) => <option key={diet.id} value={diet.id}>{diet.name}</option>)}
              </select>
            </label>
            <label>Aluno
              <select name="studentId" value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)} required>
                <option value="">Selecione</option>
                {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
              </select>
            </label>
            <button className="primary-button fit-button" type="submit"><Save size={18} />Aplicar</button>
          </form>

          <div className="section-title soft-title">
            <h2>Historico</h2>
          </div>
          <div className="list-stack">
            {studentHistory.map((item) => {
              const snapshot = normalizeSnapshot(item.diet_snapshot);
              return (
                <article className="list-item" key={item.id}>
                  <div>
                    <strong>{snapshot?.name}</strong>
                    <span>{formatDate(item.applied_at)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { api, fileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate } from './pageHelpers.js';

const measurementFields = [
  ['weightKg', 'Peso'],
  ['heightCm', 'Altura'],
  ['chestCm', 'Torax/busto'],
  ['waistCm', 'Cintura'],
  ['abdomenCm', 'Abdomen'],
  ['hipCm', 'Quadril'],
  ['rightArmCm', 'Braco direito'],
  ['leftArmCm', 'Braco esquerdo'],
  ['rightThighCm', 'Coxa direita'],
  ['leftThighCm', 'Coxa esquerda'],
  ['rightCalfCm', 'Panturrilha direita'],
  ['leftCalfCm', 'Panturrilha esquerda']
];

function chartPoints(values, width, height, padding, min, max) {
  if (values.length === 1) {
    return `${width / 2},${height / 2}`;
  }

  const span = Math.max(1, max - min);
  return values.map((item, index) => {
    const x = padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((item.value - min) / span) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');
}

function EvolutionChart({ data }) {
  const width = 680;
  const height = 260;
  const padding = 34;
  const series = [
    { key: 'weight', label: 'Peso', color: '#2563eb' },
    { key: 'waist', label: 'Cintura', color: '#16a34a' }
  ];
  const allValues = data.flatMap((item) => series.map((serie) => Number(item[serie.key] || 0)).filter(Boolean));
  const min = allValues.length ? Math.min(...allValues) : 0;
  const max = allValues.length ? Math.max(...allValues) : 1;

  if (data.length === 0) {
    return <div className="empty-state">Sem dados para o grafico</div>;
  }

  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafico de evolucao">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="chart-axis" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="chart-axis" />
        {series.map((serie) => {
          const values = data.map((item) => ({ date: item.date, value: Number(item[serie.key] || 0) })).filter((item) => item.value);
          if (values.length === 0) return null;
          return (
            <polyline
              key={serie.key}
              points={chartPoints(values, width, height, padding, min, max)}
              fill="none"
              stroke={serie.color}
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        {data.map((item, index) => {
          const x = data.length === 1 ? width / 2 : padding + (index / (data.length - 1)) * (width - padding * 2);
          return (
            <text key={item.date} x={x} y={height - 8} textAnchor="middle" className="chart-label">
              {item.date}
            </text>
          );
        })}
      </svg>
      <div className="chart-legend">
        {series.map((serie) => (
          <span key={serie.key}><i style={{ background: serie.color }} />{serie.label}</span>
        ))}
      </div>
    </div>
  );
}

export function Assessments() {
  const { user } = useAuth();
  const location = useLocation();
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(user.role === 'student' ? user.id : location.state?.studentId || '');
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadVersion = useRef(0);
  const [assessments, setAssessments] = useState([]);
  const [progress, setProgress] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function loadStudents() {
    if (user.role === 'student') return;
    const data = await api('/students?status=active');
    setStudents(data.students);
    setSelectedStudent((current) => current || data.students[0]?.id || '');
  }

  async function loadAssessments(studentId) {
    const version = ++loadVersion.current;
    if (!studentId) return;
    setLoading(true);
    try {
      const [assessmentData, progressData, requestData] = await Promise.all([
        api(`/assessments/students/${studentId}`),
        api(`/assessments/students/${studentId}/progress`),
        api(`/assessments/students/${studentId}/requests`)
      ]);
      if (version !== loadVersion.current) return;
      setRequests(requestData.requests);
      setAssessments(assessmentData.assessments);
      setProgress(progressData.progress.map((item) => ({
        ...item,
        date: formatDate(item.assessment_date),
        weight: Number(item.weight_kg || 0),
        waist: Number(item.waist_cm || 0)
      })));
    } catch (err) {
      if (version === loadVersion.current) setError(err.message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadStudents().catch((err) => setError(err.message));
  }, [user.role]);

  useEffect(() => {
    loadAssessments(selectedStudent);
    return () => { loadVersion.current += 1; };
  }, [selectedStudent]);

  async function createAssessment(event) {
    event.preventDefault();
    if (busy || loading || !selectedStudent || (user.role === 'student' && !requests.length)) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set('studentId', selectedStudent);
    setError('');
    setBusy(true);
    try {
      const path = user.role === 'student' ? `/assessments/requests/${requests[0].id}/submit` : '/assessments';
      await api(path, { method: 'POST', body: form });
      formElement.reset();
      setNotice('Avaliacao registrada.');
      await loadAssessments(selectedStudent);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function releaseAssessment() {
    if (busy || loading || !selectedStudent || requests.length) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/assessments/students/${selectedStudent}/requests`, { method: 'POST' });
      await loadAssessments(selectedStudent);
      setNotice('Avaliacao liberada no portal do aluno para preenchimento.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const latestPhotos = useMemo(() => assessments[0]?.photos || [], [assessments]);

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span>Avaliacoes</span>
          <h1>Evolucao fisica</h1>
        </div>
      </div>

      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {user.role !== 'student' ? (
        <section className="panel compact-panel">
          <label>Aluno
            <select value={selectedStudent} disabled={busy} onChange={(event) => {
              loadVersion.current += 1;
              setLoading(Boolean(event.target.value));
              setRequests([]);
              setAssessments([]);
              setProgress([]);
              setNotice('');
              setError('');
              setSelectedStudent(event.target.value);
            }}>
              <option value="">Selecione</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
            </select>
          </label>
          <button type="button" className="primary-button fit-button" disabled={!selectedStudent || busy || loading || requests.length > 0} onClick={releaseAssessment}>
            {requests.length > 0 ? 'Aguardando preenchimento do aluno' : 'Liberar avaliação para o aluno'}
          </button>
        </section>
      ) : null}

      {user.role === 'student' && requests.length > 0 ? (
        <div className="alert alert-success">Avaliação pendente liberada por {requests[0].requested_by_name}. Preencha o formulário abaixo e envie os dados ao seu personal.</div>
      ) : null}

      <div className="two-column wide-left">
        <section className="panel">
          <div className="section-title"><h2>Historico</h2></div>
          <EvolutionChart data={progress} />

          <div className="list-stack">
            {assessments.map((assessment) => (
              <article className="list-item" key={assessment.id}>
                <div>
                  <strong>{formatDate(assessment.assessment_date)}</strong>
                  <span>{assessment.body_goal || 'Objetivo corporal'}</span>
                </div>
                <span>{assessment.weight_kg || '-'} kg</span>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-title"><h2>Fotos</h2></div>
          <div className="photo-grid">
            {latestPhotos.map((photo) => (
              <a key={photo.angle} href={fileUrl(photo.path)} target="_blank" rel="noreferrer">
                <img src={fileUrl(photo.path)} alt={photo.angle} />
              </a>
            ))}
            {latestPhotos.length === 0 ? <div className="empty-state">Sem fotos</div> : null}
          </div>
        </section>
      </div>

      {user.role !== 'student' || requests.length > 0 ? (
        <section className="panel">
          <div className="section-title"><h2>{user.role === 'student' ? 'Preencher minha avaliação' : 'Registrar avaliacao'}</h2></div>
          <form className="form-stack" onSubmit={createAssessment}>
            <div className="form-grid">
              <label>Data<input name="assessmentDate" type="date" /></label>
              {measurementFields.map(([name, label]) => (
                <label key={name}>{label}<input name={name} type="number" step="0.01" /></label>
              ))}
              <label>Objetivo corporal<input name="bodyGoal" /></label>
              <label>Foto frente<input name="front" type="file" accept="image/*" /></label>
              <label>Foto lado<input name="side" type="file" accept="image/*" /></label>
              <label>Foto costas<input name="back" type="file" accept="image/*" /></label>
              <label className="wide">Observacoes<textarea name="observations" rows="3" /></label>
            </div>
            <button className="primary-button fit-button" type="submit" disabled={!selectedStudent || busy || loading}>
              <Save size={18} />
              {user.role === 'student' ? 'Enviar avaliação' : 'Salvar'}
            </button>
          </form>
        </section>
      ) : null}
    </section>
  );
}

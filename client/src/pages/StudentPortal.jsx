import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardList, Dumbbell, FileText, Repeat, Send, Timer, Volume2 } from 'lucide-react';
import { api, fileUrl, gifLibraryFileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate, normalizeSnapshot, weekDays } from './pageHelpers.js';

function youtubeEmbedUrl(value) {
  try {
    const url = new URL(value);
    const videoId = url.hostname === 'youtu.be'
      ? url.pathname.slice(1)
      : url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop();
    return videoId ? `https://www.youtube.com/embed/${videoId}` : value;
  } catch {
    return value;
  }
}

const dayTabsOrder = [
  { index: 1, label: 'SEG' },
  { index: 2, label: 'TER' },
  { index: 3, label: 'QUA' },
  { index: 4, label: 'QUI' },
  { index: 5, label: 'SEX' },
  { index: 6, label: 'SÁB' },
  { index: 0, label: 'DOM' }
];

export function StudentPortal() {
  const { user } = useAuth();
  const [currentPlan, setCurrentPlan] = useState(null);
  const [diet, setDiet] = useState(null);
  const [assessments, setAssessments] = useState([]);
  const [activeDay, setActiveDay] = useState(new Date().getDay());
  const [completedDays, setCompletedDays] = useState({});
  const [dailyLoading, setDailyLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const [workoutData, dietData, assessmentData] = await Promise.all([
        api('/workouts/student/current'),
        api('/diets/student/current'),
        api(`/assessments/students/${user.id}`)
      ]);
      setCurrentPlan(workoutData.currentPlan);
      setDiet(dietData.currentDiet);
      setAssessments(assessmentData.assessments);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const plan = useMemo(() => normalizeSnapshot(currentPlan?.plan_snapshot), [currentPlan]);
  const days = plan?.days || [];
  const selectedDay = days.find((day) => Number(day.dayOfWeek) === Number(activeDay));

  async function handleDailyComplete() {
    setError('');
    setDailyLoading(true);
    try {
      await api('/workouts/student/current/daily-complete', {
        method: 'POST',
        body: { dayOfWeek: activeDay }
      });
      setCompletedDays((prev) => ({ ...prev, [activeDay]: true }));
      setNotice(`Treino de ${weekDays[activeDay]} marcado como concluído! Parabéns pelo foco.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setDailyLoading(false);
    }
  }

  async function sendFeedback(event) {
    event.preventDefault();
    try {
      await api('/workouts/student/current/feedback', {
        method: 'POST',
        body: { dayOfWeek: activeDay, message, difficulty }
      });
      setMessage('');
      setDifficulty('');
      setNotice('Mensagem enviada com sucesso para o seu personal.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="page student-workout-page">
      <div className="student-header">
        <span className="student-tagline">Disciplina hoje. Resultados reais.</span>
        <div className="page-heading">
          <div>
            <h1>Meu treino</h1>
            <p className="student-subtitle">Acompanhe seus treinos e evolua todos os dias.</p>
          </div>
        </div>
      </div>

      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {!currentPlan ? (
        <section className="panel empty-state">Nenhum plano ativo no momento. Aguarde seu personal trainer disponibilizar seu treino.</section>
      ) : (
        <>
          <div className="day-tabs">
            {dayTabsOrder.map(({ index, label }) => (
              <button
                key={index}
                type="button"
                className={activeDay === index ? 'active' : ''}
                onClick={() => setActiveDay(index)}
              >
                {label}
              </button>
            ))}
          </div>

          <section className="panel workout-day student-workout-panel">
            <div className="student-workout-hero">
              <div>
                <h2>{selectedDay?.dailyWorkout?.name || `${weekDays[activeDay]} — Treino do dia`}</h2>
                <p>{selectedDay?.dailyWorkout?.description || selectedDay?.instructions || 'Fortalecimento, estética e performance.'}</p>
              </div>
              <button
                type="button"
                className={`daily-check-box-btn ${completedDays[activeDay] ? 'checked' : ''}`}
                onClick={handleDailyComplete}
                disabled={dailyLoading}
              >
                <span className={`custom-check-box ${completedDays[activeDay] ? 'active' : ''}`}>
                  {completedDays[activeDay] ? <Check size={14} /> : null}
                </span>
                <span className="check-text">
                  <strong>Treino do dia realizado</strong>
                  <small>Marque quando concluir todos os exercícios.</small>
                </span>
              </button>
            </div>

            {selectedDay?.isRest ? (
              <div className="rest-day">Dia de descanso programado. Recupere suas energias!</div>
            ) : (
              <div className="exercise-list student-exercise-grid">
                {(selectedDay?.dailyWorkout?.exercises || []).map((item) => (
                  <article className="student-card-exercise" key={item.id}>
                    <div className="student-card-top">
                      <strong>{item.exerciseName}</strong>
                      <span className="student-muscle-pill">{item.muscleGroup || 'Geral'}</span>
                    </div>

                    <div className="student-card-media">
                      {item.gifLibraryPath ? <img className="exercise-media exercise-media-large" src={gifLibraryFileUrl(item.gifLibraryPath)} alt={`Demonstração de ${item.exerciseName}`} /> : null}
                      {!item.gifLibraryPath && item.gifPath ? <img className="exercise-media exercise-media-large" src={fileUrl(item.gifPath)} alt={`Demonstração de ${item.exerciseName}`} /> : null}
                      {item.videoPath ? <video className="exercise-media exercise-media-large" src={fileUrl(item.videoPath)} controls muted loop playsInline /> : null}
                      {item.youtubeUrl ? <iframe
                        className="exercise-media exercise-media-large"
                        src={youtubeEmbedUrl(item.youtubeUrl)}
                        title={`Demonstração de ${item.exerciseName}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      /> : null}
                    </div>

                    <div className="student-specs-grid">
                      <div className="spec-item">
                        <ClipboardList size={16} className="spec-icon" />
                        <div>
                          <small>Séries</small>
                          <strong>{item.sets ? `${item.sets} séries` : '-'}</strong>
                        </div>
                      </div>
                      <div className="spec-item">
                        <Repeat size={16} className="spec-icon" />
                        <div>
                          <small>Repetições</small>
                          <strong>{item.repetitions ? `${item.repetitions} reps` : '-'}</strong>
                        </div>
                      </div>
                      <div className="spec-item">
                        <Dumbbell size={16} className="spec-icon" />
                        <div>
                          <small>Carga</small>
                          <strong>{item.load || 'Carga livre'}</strong>
                        </div>
                      </div>
                      <div className="spec-item">
                        <Timer size={16} className="spec-icon" />
                        <div>
                          <small>Intervalo</small>
                          <strong>{item.restSeconds ? `${item.restSeconds}s` : 'Livre'}</strong>
                        </div>
                      </div>
                    </div>

                    <div className="student-notes-box">
                      <FileText size={16} className="spec-icon" />
                      <div>
                        <small>Orientação</small>
                        <p>{item.notes || 'Mantenha a postura correta e controle o movimento durante toda a execução.'}</p>
                      </div>
                    </div>

                    {item.audioPath ? (
                      <div className="student-audio-row">
                        <Volume2 size={16} className="spec-icon" />
                        <audio src={fileUrl(item.audioPath)} controls preload="none" />
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="daily-finish-action-row">
            <button
              type="button"
              className="primary-button daily-finish-btn"
              onClick={handleDailyComplete}
              disabled={dailyLoading}
            >
              <Check size={20} />
              {completedDays[activeDay] ? 'TREINO DO DIA CONCLUÍDO ✓' : 'TREINO DO DIA CONCLUÍDO'}
            </button>
          </div>

          <section className="panel student-feedback-panel">
            <div className="section-title">
              <h2>Dúvida ou dificuldade</h2>
            </div>
            <form className="inline-form student-feedback-form" onSubmit={sendFeedback}>
              <input value={difficulty} onChange={(event) => setDifficulty(event.target.value)} placeholder="Dificuldade (opcional)" />
              <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Envie sua dúvida ou comentário para o personal" required />
              <button className="icon-button solid" type="submit" aria-label="Enviar">
                <Send size={18} />
              </button>
            </form>
          </section>
        </>
      )}

      <div className="two-column">
        <section className="panel student-subpanel">
          <div className="section-title">
            <h2>Dieta atual</h2>
          </div>
          <p className="muted">{normalizeSnapshot(diet?.diet_snapshot)?.general_guidelines || 'Sem dieta aplicada'}</p>
        </section>
        <section className="panel student-subpanel">
          <div className="section-title">
            <h2>Última avaliação</h2>
          </div>
          <p className="muted">
            {assessments[0] ? `${formatDate(assessments[0].assessment_date)} - ${assessments[0].weight_kg || '-'} kg` : 'Sem avaliação cadastrada'}
          </p>
        </section>
      </div>
    </section>
  );
}
    </section>
  );
}

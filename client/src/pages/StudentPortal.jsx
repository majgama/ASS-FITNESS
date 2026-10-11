import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardList, Dumbbell, FileText, Repeat, Send, Timer, Volume2 } from 'lucide-react';
import { api, fileUrl, gifLibraryFileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Link } from 'react-router-dom';
import { Modal } from '../components/Modal.jsx';
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
  const [assessmentRequests, setAssessmentRequests] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [activeDay, setActiveDay] = useState(new Date().getDay());
  const [completedDays, setCompletedDays] = useState({});
  const [dailyLoading, setDailyLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [exerciseLoads, setExerciseLoads] = useState({});
  const [editingLoad, setEditingLoad] = useState(null);
  const [loadValue, setLoadValue] = useState('');
  const [savingLoad, setSavingLoad] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [restTimers, setRestTimers] = useState({});
  const [timerNow, setTimerNow] = useState(Date.now());

  async function load() {
    setError('');
    try {
      const [workoutData, dietData, assessmentData, requestData] = await Promise.all([
        api('/workouts/student/current'),
        api('/diets/student/current'),
        api(`/assessments/students/${user.id}`),
        api(`/assessments/students/${user.id}/requests`)
      ]);
      setAssessmentRequests(requestData.requests);
      setCurrentPlan(workoutData.currentPlan);
      setExerciseLoads(Object.fromEntries(workoutData.exerciseLoads.map((item) => [item.exerciseId, item.load])));
      setDiet(dietData.currentDiet);
      setAssessments(assessmentData.assessments);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let alive = true;
    api('/students/me/trainers').then((data) => {
      if (alive) setTrainers(data.trainers);
    }).catch((err) => {
      if (alive) setError(err.message);
    });
    return () => { alive = false; };
  }, [user.id]);

  const hasRunningTimer = Object.values(restTimers).some((timer) => timer.startedAt !== null);
  useEffect(() => {
    if (!hasRunningTimer) return;
    function tick() {
      const now = Date.now();
      setTimerNow(now);
      setRestTimers((current) => Object.fromEntries(Object.entries(current).map(([key, timer]) => [
        key,
        timer.startedAt !== null && now - timer.startedAt >= 600000
          ? { startedAt: null, elapsed: 600 }
          : timer
      ])));
    }
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [hasRunningTimer]);

  function toggleRestTimer(key) {
    const now = Date.now();
    setTimerNow(now);
    setRestTimers((current) => {
      const timer = current[key];
      return {
        ...current,
        [key]: timer?.startedAt != null
          ? { startedAt: null, elapsed: Math.min(600, Math.floor((now - timer.startedAt) / 1000)) }
          : { startedAt: now, elapsed: 0 }
      };
    });
  }

  function restElapsed(key) {
    const timer = restTimers[key];
    const seconds = timer?.startedAt != null
      ? Math.min(600, Math.max(0, Math.floor((timerNow - timer.startedAt) / 1000)))
      : timer?.elapsed || 0;
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  async function saveLoad(event) {
    event.preventDefault();
    if (savingLoad) return;
    setSavingLoad(true);
    setLoadError('');
    try {
      const data = await api(`/workouts/student/exercises/${editingLoad.exerciseId}/load`, {
        method: 'PUT', body: { load: loadValue }
      });
      setExerciseLoads((current) => ({ ...current, [data.exerciseLoad.exerciseId]: data.exerciseLoad.load }));
      setEditingLoad(null);
      setNotice('Carga salva para este exercício em todos os dias.');
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setSavingLoad(false);
    }
  }

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
      {trainers.length > 0 ? (
        <section className="student-trainers" aria-label="Seus personais">
          {trainers.map((trainer) => (
            <article className="student-trainer-card" key={trainer.id}>
              <div className="avatar">
                {trainer.profilePhotoPath ? <img src={fileUrl(trainer.profilePhotoPath)} alt={`Foto de ${trainer.name}`} /> : trainer.name.slice(0, 2)}
              </div>
              <div className="student-trainer-name">
                <span>Seu personal</span>
                <div className="student-trainer-contact-row">
                  <strong>{trainer.name}</strong>
                  {trainer.whatsapp ? (
                    <a className="secondary-button fit-button trainer-whatsapp" href={`https://wa.me/${trainer.whatsapp}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp de ${trainer.name}`} title={`WhatsApp de ${trainer.name}`}>
                      <img src="/icones/whatssap_icone.png" alt="" />
                    </a>
                  ) : null}
                </div>
                {!trainer.whatsapp ? <span className="trainer-contact-unavailable">WhatsApp não informado</span> : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}
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

      {assessmentRequests.length > 0 ? (
        <section className="panel">
          <h2>Avaliação pendente</h2>
          <p>{assessmentRequests[0].requested_by_name} liberou uma avaliação para você preencher suas medidas e enviar fotos.</p>
          <Link to="/avaliacoes" className="primary-button fit-button">
            <ClipboardList size={18} />Preencher avaliação
          </Link>
        </section>
      ) : null}

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
                        referrerPolicy="strict-origin-when-cross-origin"
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
                          <strong>{exerciseLoads[item.exerciseId] ?? (item.load || 'Carga livre')}</strong>
                          {item.exerciseId ? (
                            <button type="button" className="secondary-button student-exercise-action" onClick={() => {
                              setEditingLoad(item);
                              setLoadValue(exerciseLoads[item.exerciseId] ?? item.load ?? '');
                              setLoadError('');
                            }}>{exerciseLoads[item.exerciseId] ? 'Editar carga' : 'Inserir carga'}</button>
                          ) : null}
                        </div>
                      </div>
                      <div className="spec-item">
                        <Timer size={16} className="spec-icon" />
                        <div>
                          <small>Intervalo</small>
                          <strong>{item.restSeconds ? `${item.restSeconds}s` : 'Livre'}</strong>
                          <output className="student-rest-time" role="timer" aria-live="off" aria-label={`Tempo de intervalo de ${item.exerciseName}`}>{restElapsed(item.id)}</output>
                          <button type="button" className="secondary-button student-exercise-action" onClick={() => toggleRestTimer(item.id)}>
                            {restTimers[item.id]?.startedAt != null ? 'Parar intervalo' : 'Iniciar intervalo'}
                          </button>
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
      <Modal title={`Carga: ${editingLoad?.exerciseName || ''}`} open={Boolean(editingLoad)} onClose={() => { if (!savingLoad) setEditingLoad(null); }}>
        <form className="form-stack" onSubmit={saveLoad}>
          <p>A carga será usada neste exercício em todos os dias dos seus treinos, sem alterar o modelo do personal.</p>
          {loadError ? <div className="alert alert-error">{loadError}</div> : null}
          <label>Carga<input value={loadValue} onChange={(event) => setLoadValue(event.target.value)} placeholder="Ex.: 20 kg" maxLength={100} required disabled={savingLoad} /></label>
          <button className="primary-button" type="submit" disabled={savingLoad || !loadValue.trim()}>{savingLoad ? 'Salvando...' : 'Salvar carga'}</button>
        </form>
      </Modal>
    </section>
  );
}

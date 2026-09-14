import { useEffect, useMemo, useState } from 'react';
import { Check, Send } from 'lucide-react';
import { api, fileUrl } from '../api/client.js';
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

export function StudentPortal() {
  const { user } = useAuth();
  const [currentPlan, setCurrentPlan] = useState(null);
  const [diet, setDiet] = useState(null);
  const [assessments, setAssessments] = useState([]);
  const [activeDay, setActiveDay] = useState(new Date().getDay());
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

  async function completePlan() {
    await api('/workouts/student/current/complete', { method: 'POST' });
    setNotice('Plano concluido.');
    await load();
  }

  async function sendFeedback(event) {
    event.preventDefault();
    await api('/workouts/student/current/feedback', {
      method: 'POST',
      body: { dayOfWeek: activeDay, message, difficulty }
    });
    setMessage('');
    setDifficulty('');
    setNotice('Mensagem enviada.');
  }

  return (
    <section className="page student-workout-page">
      <div className="page-heading">
        <div>
          <span>Meu treino</span>
          <h1>{plan?.name || 'Plano semanal'}</h1>
        </div>
        {currentPlan ? (
          <button className="primary-button fit-button" type="button" onClick={completePlan}>
            <Check size={18} />
            Concluir plano
          </button>
        ) : null}
      </div>

      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {!currentPlan ? (
        <section className="panel empty-state">Nenhum plano ativo</section>
      ) : (
        <>
          <div className="day-tabs">
            {weekDays.map((day, index) => (
              <button
                key={day}
                type="button"
                className={activeDay === index ? 'active' : ''}
                onClick={() => setActiveDay(index)}
              >
                {day.slice(0, 3)}
              </button>
            ))}
          </div>

          <section className="panel workout-day student-workout-panel">
            <div className="section-title">
              <h2>{weekDays[activeDay]}</h2>
              <span>{formatDate(currentPlan.start_date)}</span>
            </div>

            {selectedDay?.isRest ? (
              <div className="rest-day">Descanso</div>
            ) : (
              <div className="exercise-list student-exercise-grid">
                {(selectedDay?.dailyWorkout?.exercises || []).map((item) => (
                  <article className="exercise-row" key={item.id}>
                    {item.gifPath ? <img className="exercise-media exercise-media-large" src={fileUrl(item.gifPath)} alt={`Demonstração de ${item.exerciseName}`} /> : null}
                    {item.videoPath ? <video className="exercise-media exercise-media-large" src={fileUrl(item.videoPath)} controls muted loop playsInline /> : null}
                    {item.youtubeUrl ? <iframe
                      className="exercise-media exercise-media-large"
                      src={youtubeEmbedUrl(item.youtubeUrl)}
                      title={`Demonstração de ${item.exerciseName}`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    /> : null}
                    <div>
                      <strong>{item.exerciseName}</strong>
                      <span>{item.muscleGroup || 'Geral'}</span>
                    </div>
                    <div className="exercise-meta">
                      <span>{item.sets || '-'} series</span>
                      <span>{item.repetitions || '-'} reps</span>
                      <span>{item.load || 'Carga livre'}</span>
                      <span>{item.restSeconds || 0}s</span>
                    </div>
                    {item.notes ? <p>{item.notes}</p> : null}
                    <div className="media-links">
                      {item.youtubeUrl ? <a href={item.youtubeUrl} target="_blank" rel="noreferrer">YouTube</a> : null}
                      {item.videoPath ? <a href={fileUrl(item.videoPath)} target="_blank" rel="noreferrer">Video</a> : null}
                      {item.gifPath ? <a href={fileUrl(item.gifPath)} target="_blank" rel="noreferrer">GIF</a> : null}
                      {item.audioPath ? <a href={fileUrl(item.audioPath)} target="_blank" rel="noreferrer">Audio</a> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="section-title">
              <h2>Duvida ou dificuldade</h2>
            </div>
            <form className="inline-form" onSubmit={sendFeedback}>
              <input value={difficulty} onChange={(event) => setDifficulty(event.target.value)} placeholder="Dificuldade" />
              <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Mensagem" required />
              <button className="icon-button solid" type="submit" aria-label="Enviar">
                <Send size={18} />
              </button>
            </form>
          </section>
        </>
      )}

      <div className="two-column">
        <section className="panel">
          <div className="section-title">
            <h2>Dieta atual</h2>
          </div>
          <p className="muted">{normalizeSnapshot(diet?.diet_snapshot)?.general_guidelines || 'Sem dieta aplicada'}</p>
        </section>
        <section className="panel">
          <div className="section-title">
            <h2>Ultima avaliacao</h2>
          </div>
          <p className="muted">
            {assessments[0] ? `${formatDate(assessments[0].assessment_date)} - ${assessments[0].weight_kg || '-'} kg` : 'Sem avaliacao'}
          </p>
        </section>
      </div>
    </section>
  );
}

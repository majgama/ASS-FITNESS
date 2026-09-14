import { useEffect, useMemo, useState } from 'react';
import { Dumbbell, Plus, Save } from 'lucide-react';
import { api, fileUrl } from '../api/client.js';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { weekDays } from './pageHelpers.js';

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

export function Workouts() {
  const { user } = useAuth();
  const [tab, setTab] = useState('exercises');
  const [exercises, setExercises] = useState([]);
  const [dailyWorkouts, setDailyWorkouts] = useState([]);
  const [weeklyPlans, setWeeklyPlans] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedDailyWorkout, setSelectedDailyWorkout] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mediaType, setMediaType] = useState('none');

  const canCreatePublic = user.role === 'admin';

  async function load() {
    setError('');
    try {
      const [exerciseData, dailyData, weeklyData, studentData] = await Promise.all([
        api('/exercises'),
        api('/workouts/daily'),
        api('/workouts/weekly'),
        api('/students?status=active')
      ]);
      setExercises(exerciseData.exercises);
      setDailyWorkouts(dailyData.dailyWorkouts);
      setWeeklyPlans(weeklyData.weeklyPlans);
      setStudents(studentData.students);
      setSelectedDailyWorkout((current) => current || dailyData.dailyWorkouts[0]?.id || '');
      setSelectedPlan((current) => current || weeklyData.weeklyPlans[0]?.id || '');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (user.role === 'student') return;
    load();
  }, [user.role]);

  const tabs = useMemo(() => [
    ['exercises', 'Exercicios'],
    ['daily', 'Treinos diarios'],
    ['weekly', 'Planos semanais'],
    ['apply', 'Aplicar']
  ], []);

  async function createExercise(event) {
    event.preventDefault();
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.delete('youtubeUrl');
    form.delete('video');
    form.delete('gif');
    if (mediaType === 'youtube') form.set('youtubeUrl', formElement.elements.youtubeUrl.value);
    if (mediaType === 'video') form.set('video', formElement.elements.video.files[0]);
    if (mediaType === 'gif') form.set('gif', formElement.elements.gif.files[0]);
    try {
      await api('/exercises', { method: 'POST', body: form });
      formElement.reset();
      setMediaType('none');
      setNotice('Exercicio criado.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createDailyWorkout(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api('/workouts/daily', {
        method: 'POST',
        body: {
          name: form.get('name'),
          description: form.get('description') || null,
          visibility: form.get('visibility') || 'private'
        }
      });
      formElement.reset();
      setNotice('Treino diario criado.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addExerciseToWorkout(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!selectedDailyWorkout) return;
    try {
      await api(`/workouts/daily/${selectedDailyWorkout}/exercises`, {
        method: 'POST',
        body: {
          exerciseId: form.get('exerciseId'),
          position: Number(form.get('position') || 0),
          sets: form.get('sets') || null,
          repetitions: form.get('repetitions') || null,
          load: form.get('load') || null,
          restSeconds: Number(form.get('restSeconds') || 0),
          notes: form.get('notes') || null
        }
      });
      formElement.reset();
      setNotice('Exercicio adicionado.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function createWeeklyPlan(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const days = weekDays.map((_, dayOfWeek) => {
      const isRest = form.get(`rest-${dayOfWeek}`) === 'on';
      return {
        dayOfWeek,
        isRest,
        dailyWorkoutId: isRest ? null : form.get(`daily-${dayOfWeek}`) || null,
        instructions: form.get(`instructions-${dayOfWeek}`) || null
      };
    });

    try {
      await api('/workouts/weekly', {
        method: 'POST',
        body: {
          name: form.get('name'),
          description: form.get('description') || null,
          startDate: form.get('startDate') || null,
          visibility: form.get('visibility') || 'private',
          days
        }
      });
      formElement.reset();
      setNotice('Plano semanal criado.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function applyPlan(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/workouts/weekly/${form.get('weeklyPlanId')}/apply`, {
        method: 'POST',
        body: {
          studentId: form.get('studentId'),
          startDate: form.get('startDate') || null
        }
      });
      setNotice('Plano aplicado ao aluno.');
    } catch (err) {
      setError(err.message);
    }
  }

  if (user.role === 'student') {
    return <section className="page"><div className="panel empty-state">Area disponivel no portal do aluno</div></section>;
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span>Treinos</span>
          <h1>Biblioteca e planos</h1>
        </div>
      </div>

      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="segmented">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'exercises' ? (
        <div className="two-column wide-left">
          <section className="panel">
            <div className="section-title">
              <h2>Novo exercicio</h2>
            </div>
            <form className="form-stack" onSubmit={createExercise}>
              <div className="form-grid">
                <label>Nome<input name="name" required /></label>
                <label>Grupo muscular<input name="muscleGroup" /></label>
                <label>Series<input name="defaultSets" /></label>
                <label>Repeticoes<input name="defaultRepetitions" /></label>
                <label>Carga<input name="defaultLoad" /></label>
                <label>Descanso em segundos<input name="defaultRestSeconds" type="number" min="0" /></label>
                <label className="wide">Mídia demonstrativa
                  <select value={mediaType} onChange={(event) => setMediaType(event.target.value)}>
                    <option value="none">Sem mídia</option>
                    <option value="gif">GIF</option>
                    <option value="youtube">YouTube</option>
                    <option value="video">Vídeo</option>
                  </select>
                </label>
                {mediaType === 'youtube' ? <label>Link YouTube<input name="youtubeUrl" required /></label> : null}
                {mediaType === 'video' ? <>
                  <label>Vídeo até 5s<input name="video" type="file" accept="video/mp4,video/webm,video/quicktime" required /></label>
                  <label>Duração vídeo<input name="videoDurationSeconds" type="number" step="0.1" min="0" /></label>
                </> : null}
                {mediaType === 'gif' ? <label>GIF<input name="gif" type="file" accept="image/gif" required /></label> : null}
                <label>Audio ate 60s<input name="audio" type="file" accept="audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/mp4,video/mp4" /></label>
                <label>Duracao audio<input name="audioDurationSeconds" type="number" step="0.1" min="0" /></label>
                <label>Visibilidade
                  <select name="visibility" defaultValue="private" disabled={!canCreatePublic}>
                    <option value="private">Particular</option>
                    <option value="public">Publico</option>
                  </select>
                </label>
                <label className="wide">Observacoes<textarea name="observations" rows="3" /></label>
              </div>
              <button className="primary-button fit-button" type="submit">
                <Plus size={18} />
                Criar
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="section-title">
              <h2>Exercicios</h2>
            </div>
            <div className="list-stack">
              {exercises.map((exercise) => (
                <article className="list-item" key={exercise.id}>
                  {exercise.gif_path ? <img className="exercise-media" src={fileUrl(exercise.gif_path)} alt={`Demonstração de ${exercise.name}`} /> : null}
                  {exercise.video_path ? <video className="exercise-media" src={fileUrl(exercise.video_path)} controls muted loop playsInline /> : null}
                  {exercise.youtube_url ? <iframe
                    className="exercise-media"
                    src={youtubeEmbedUrl(exercise.youtube_url)}
                    title={`Demonstração de ${exercise.name}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  /> : null}
                  <div>
                    <strong>{exercise.name}</strong>
                    <span>{exercise.muscle_group || 'Geral'}</span>
                  </div>
                  <StatusBadge value={exercise.visibility} />
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'daily' ? (
        <div className="two-column">
          <section className="panel">
            <div className="section-title">
              <h2>Novo treino diario</h2>
            </div>
            <form className="form-stack" onSubmit={createDailyWorkout}>
              <label>Nome<input name="name" required /></label>
              <label>Descricao<textarea name="description" rows="3" /></label>
              <label>Visibilidade
                <select name="visibility" defaultValue="private" disabled={!canCreatePublic}>
                  <option value="private">Particular</option>
                  <option value="public">Publico</option>
                </select>
              </label>
              <button className="primary-button fit-button" type="submit"><Save size={18} />Salvar</button>
            </form>
          </section>

          <section className="panel">
            <div className="section-title">
              <h2>Adicionar exercicio</h2>
            </div>
            <form className="form-stack" onSubmit={addExerciseToWorkout}>
              <label>Treino diario
                <select value={selectedDailyWorkout} onChange={(event) => setSelectedDailyWorkout(event.target.value)}>
                  {dailyWorkouts.map((workout) => <option key={workout.id} value={workout.id}>{workout.name}</option>)}
                </select>
              </label>
              <div className="form-grid">
                <label>Exercicio
                  <select name="exerciseId" required>
                    <option value="">Selecione</option>
                    {exercises.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
                  </select>
                </label>
                <label>Posicao<input name="position" type="number" min="0" defaultValue="0" /></label>
                <label>Series<input name="sets" /></label>
                <label>Repeticoes<input name="repetitions" /></label>
                <label>Carga<input name="load" /></label>
                <label>Descanso<input name="restSeconds" type="number" min="0" /></label>
                <label className="wide">Observacoes<textarea name="notes" rows="3" /></label>
              </div>
              <button className="primary-button fit-button" type="submit"><Dumbbell size={18} />Adicionar</button>
            </form>
          </section>
        </div>
      ) : null}

      {tab === 'weekly' ? (
        <section className="panel">
          <div className="section-title">
            <h2>Novo plano semanal</h2>
          </div>
          <form className="form-stack" onSubmit={createWeeklyPlan}>
            <div className="form-grid">
              <label>Nome<input name="name" required /></label>
              <label>Data de inicio<input name="startDate" type="date" /></label>
              <label>Visibilidade
                <select name="visibility" defaultValue="private" disabled={!canCreatePublic}>
                  <option value="private">Particular</option>
                  <option value="public">Publico</option>
                </select>
              </label>
              <label className="wide">Descricao<textarea name="description" rows="2" /></label>
            </div>
            <div className="week-grid">
              {weekDays.map((day, index) => (
                <fieldset key={day} className="day-config">
                  <legend>{day}</legend>
                  <label className="check-line">
                    <input type="checkbox" name={`rest-${index}`} />
                    Descanso
                  </label>
                  <select name={`daily-${index}`} defaultValue="">
                    <option value="">Treino</option>
                    {dailyWorkouts.map((workout) => <option key={workout.id} value={workout.id}>{workout.name}</option>)}
                  </select>
                  <textarea name={`instructions-${index}`} rows="2" placeholder="Instrucoes" />
                </fieldset>
              ))}
            </div>
            <button className="primary-button fit-button" type="submit"><Save size={18} />Salvar plano</button>
          </form>
        </section>
      ) : null}

      {tab === 'apply' ? (
        <section className="panel">
          <div className="section-title">
            <h2>Aplicar plano</h2>
          </div>
          <form className="form-grid" onSubmit={applyPlan}>
            <label>Plano semanal
              <select name="weeklyPlanId" value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value)} required>
                {weeklyPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select>
            </label>
            <label>Aluno
              <select name="studentId" required>
                <option value="">Selecione</option>
                {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
              </select>
            </label>
            <label>Inicio<input name="startDate" type="date" /></label>
            <button className="primary-button fit-button" type="submit"><Save size={18} />Aplicar</button>
          </form>
        </section>
      ) : null}
    </section>
  );
}

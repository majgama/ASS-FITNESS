import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  Dumbbell,
  FileText,
  Pencil,
  Plus,
  Repeat,
  Save,
  Search,
  Timer,
  Trash2,
  X
} from 'lucide-react';
import { api, fileUrl, gifLibraryFileUrl } from '../api/client.js';
import { GifLibraryPicker } from '../components/GifLibraryPicker.jsx';
import { Modal } from '../components/Modal.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { weekDays } from './pageHelpers.js';

const mediaChoices = [
  { value: 'library', label: 'Banco de GIFs', icon: '/icones/banco_gif.jpeg' },
  { value: 'gif', label: 'Enviar GIF', icon: '/icones/enviar_gif.jpeg' },
  { value: 'video', label: 'Enviar vídeo', icon: '/icones/envia_videos.jpeg' },
  { value: 'youtube', label: 'Link do YouTube', icon: '/icones/link_youtube.jpeg' },
  { value: 'favorites', label: 'Favoritos', icon: '/icones/favoritos.jpeg' },
  { value: 'none', label: 'Sem mídia', icon: null }
];

function MediaChoiceGrid({ value, favoritesOnly, onChoose }) {
  return (
    <div className="media-choice-grid" aria-label="Escolha a mídia demonstrativa">
      {mediaChoices.map((choice) => {
        const active = choice.value === 'favorites'
          ? value === 'library' && favoritesOnly
          : value === choice.value && !favoritesOnly;
        return (
          <button
            key={choice.value}
            type="button"
            className={`media-choice ${active ? 'active' : ''}`}
            onClick={() => onChoose(choice.value)}
            aria-label={choice.label}
            title={choice.label}
          >
            {choice.icon ? <img src={choice.icon} alt="" /> : <X size={28} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function youtubeEmbedUrl(value) {
  if (!value) return '';
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
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryFavoritesOnly, setLibraryFavoritesOnly] = useState(false);
  const [selectedLibraryGif, setSelectedLibraryGif] = useState(null);
  const createFormRef = useRef(null);

  // Search terms
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [dailySearch, setDailySearch] = useState('');
  const [weeklySearch, setWeeklySearch] = useState('');

  // Modals state
  const [editingExercise, setEditingExercise] = useState(null);
  const [editExerciseMediaType, setEditExerciseMediaType] = useState('none');
  const [editLibraryPickerOpen, setEditLibraryPickerOpen] = useState(false);
  const [editLibraryFavoritesOnly, setEditLibraryFavoritesOnly] = useState(false);
  const [editSelectedLibraryGif, setEditSelectedLibraryGif] = useState(null);
  const editFormRef = useRef(null);
  const [editingDaily, setEditingDaily] = useState(null);
  const [editingWeekly, setEditingWeekly] = useState(null);

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
    ['exercises', 'Exercícios'],
    ['daily', 'Treinos diários'],
    ['weekly', 'Planos semanais'],
    ['apply', 'Aplicar ao aluno']
  ], []);

  // Filtered lists
  const filteredExercises = useMemo(() => {
    const q = exerciseSearch.toLowerCase().trim();
    if (!q) return exercises;
    return exercises.filter((e) =>
      e.name?.toLowerCase().includes(q) ||
      e.muscle_group?.toLowerCase().includes(q) ||
      e.observations?.toLowerCase().includes(q)
    );
  }, [exercises, exerciseSearch]);

  const filteredDailyWorkouts = useMemo(() => {
    const q = dailySearch.toLowerCase().trim();
    if (!q) return dailyWorkouts;
    return dailyWorkouts.filter((d) =>
      d.name?.toLowerCase().includes(q) ||
      d.description?.toLowerCase().includes(q)
    );
  }, [dailyWorkouts, dailySearch]);

  const filteredWeeklyPlans = useMemo(() => {
    const q = weeklySearch.toLowerCase().trim();
    if (!q) return weeklyPlans;
    return weeklyPlans.filter((p) =>
      p.name?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
  }, [weeklyPlans, weeklySearch]);

  // Exercise Handlers
  async function createExercise(event) {
    event.preventDefault();
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.delete('youtubeUrl');
    form.delete('video');
    form.delete('gif');
    if (mediaType === 'youtube') form.set('youtubeUrl', formElement.elements.youtubeUrl.value);
    if (mediaType === 'video' && formElement.elements.video?.files?.[0]) form.set('video', formElement.elements.video.files[0]);
    if (mediaType === 'gif' && formElement.elements.gif?.files?.[0]) form.set('gif', formElement.elements.gif.files[0]);
    if (mediaType === 'library') {
      if (!selectedLibraryGif) {
        setError('Escolha uma animação da biblioteca ou selecione outro tipo de mídia.');
        return;
      }
      form.set('gifLibraryPath', selectedLibraryGif.id);
    }
    try {
      await api('/exercises', { method: 'POST', body: form });
      formElement.reset();
      setMediaType('none');
      setLibraryFavoritesOnly(false);
      setSelectedLibraryGif(null);
      setLibraryPickerOpen(false);
      setNotice('Exercício criado com sucesso.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLibrarySelect(item) {
    setSelectedLibraryGif(item);
    setLibraryPickerOpen(false);
    if (createFormRef.current) {
      createFormRef.current.elements.name.value = item.name;
      if (item.muscleGroup) createFormRef.current.elements.muscleGroup.value = item.muscleGroup;
    }
  }

  function chooseCreateMedia(choice) {
    const favorites = choice === 'favorites';
    const nextType = favorites ? 'library' : choice;
    setMediaType(nextType);
    setLibraryFavoritesOnly(favorites);
    if (nextType !== 'library') setSelectedLibraryGif(null);
    setLibraryPickerOpen(nextType === 'library');
  }

  function handleEditLibrarySelect(item) {
    setEditSelectedLibraryGif(item);
    setEditLibraryPickerOpen(false);
    if (editFormRef.current) {
      editFormRef.current.elements.name.value = item.name;
      if (item.muscleGroup) editFormRef.current.elements.muscleGroup.value = item.muscleGroup;
    }
  }

  function chooseEditMedia(choice) {
    const favorites = choice === 'favorites';
    const nextType = favorites ? 'library' : choice;
    setEditExerciseMediaType(nextType);
    setEditLibraryFavoritesOnly(favorites);
    setEditLibraryPickerOpen(nextType === 'library');
  }

  function openEditExercise(exercise) {
    setEditingExercise(exercise);
    setEditSelectedLibraryGif(null);
    setEditLibraryPickerOpen(false);
    setEditLibraryFavoritesOnly(false);
    if (exercise.gif_library_path) setEditExerciseMediaType('library');
    else if (exercise.gif_path) setEditExerciseMediaType('gif');
    else if (exercise.video_path) setEditExerciseMediaType('video');
    else if (exercise.youtube_url) setEditExerciseMediaType('youtube');
    else setEditExerciseMediaType('none');
  }

  async function updateExercise(event) {
    event.preventDefault();
    if (!editingExercise) return;
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.delete('youtubeUrl');
    form.delete('video');
    form.delete('gif');
    if (editExerciseMediaType === 'youtube') form.set('youtubeUrl', formElement.elements.youtubeUrl.value);
    if (editExerciseMediaType === 'video' && formElement.elements.video?.files?.[0]) form.set('video', formElement.elements.video.files[0]);
    if (editExerciseMediaType === 'gif' && formElement.elements.gif?.files?.[0]) form.set('gif', formElement.elements.gif.files[0]);
    if (editExerciseMediaType === 'library' && editSelectedLibraryGif) form.set('gifLibraryPath', editSelectedLibraryGif.id);
    if (editExerciseMediaType === 'none') form.set('removeMedia', 'true');

    try {
      await api(`/exercises/${editingExercise.id}`, { method: 'PATCH', body: form });
      setEditingExercise(null);
      setNotice('Exercício atualizado com sucesso.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteExercise(id, name) {
    if (!window.confirm(`Deseja realmente excluir o exercício "${name}"?`)) return;
    setError('');
    try {
      await api(`/exercises/${id}`, { method: 'DELETE' });
      setNotice(`Exercício "${name}" excluído.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  // Daily Workout Handlers
  async function createDailyWorkout(event) {
    event.preventDefault();
    setError('');
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
      setNotice('Treino diário criado com sucesso.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateDailyWorkout(event) {
    event.preventDefault();
    if (!editingDaily) return;
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api(`/workouts/daily/${editingDaily.id}`, {
        method: 'PATCH',
        body: {
          name: form.get('name'),
          description: form.get('description') || null,
          visibility: form.get('visibility') || 'private'
        }
      });
      setEditingDaily(null);
      setNotice('Treino diário atualizado com sucesso.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteDailyWorkout(id, name) {
    if (!window.confirm(`Deseja realmente excluir o treino diário "${name}"?`)) return;
    setError('');
    try {
      await api(`/workouts/daily/${id}`, { method: 'DELETE' });
      if (selectedDailyWorkout === id) setSelectedDailyWorkout('');
      setNotice(`Treino diário "${name}" excluído.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addExerciseToWorkout(event) {
    event.preventDefault();
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!selectedDailyWorkout) {
      setError('Selecione um treino diário primeiro.');
      return;
    }
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
      setNotice('Exercício adicionado ao treino diário.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeExerciseFromDaily(workoutId, relId, exName) {
    if (!window.confirm(`Remover "${exName}" deste treino?`)) return;
    setError('');
    try {
      await api(`/workouts/daily/${workoutId}/exercises/${relId}`, { method: 'DELETE' });
      setNotice(`Exercício removido do treino.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  // Weekly Plan Handlers
  async function createWeeklyPlan(event) {
    event.preventDefault();
    setError('');
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
      setNotice('Plano semanal criado com sucesso.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function openEditWeekly(plan) {
    setEditingWeekly(plan);
  }

  async function updateWeeklyPlan(event) {
    event.preventDefault();
    if (!editingWeekly) return;
    setError('');
    const form = new FormData(event.currentTarget);
    const days = weekDays.map((_, dayOfWeek) => {
      const isRest = form.get(`edit-rest-${dayOfWeek}`) === 'on';
      return {
        dayOfWeek,
        isRest,
        dailyWorkoutId: isRest ? null : form.get(`edit-daily-${dayOfWeek}`) || null,
        instructions: form.get(`edit-instructions-${dayOfWeek}`) || null
      };
    });

    try {
      await api(`/workouts/weekly/${editingWeekly.id}`, {
        method: 'PUT',
        body: {
          name: form.get('name'),
          description: form.get('description') || null,
          startDate: form.get('startDate') || null,
          visibility: form.get('visibility') || 'private',
          days
        }
      });
      setEditingWeekly(null);
      setNotice('Plano semanal atualizado com sucesso.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteWeeklyPlan(id, name) {
    if (!window.confirm(`Deseja realmente excluir o plano semanal "${name}"?`)) return;
    setError('');
    try {
      await api(`/workouts/weekly/${id}`, { method: 'DELETE' });
      if (selectedPlan === id) setSelectedPlan('');
      setNotice(`Plano semanal "${name}" excluído.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function applyPlan(event) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api(`/workouts/weekly/${form.get('weeklyPlanId')}/apply`, {
        method: 'POST',
        body: {
          studentId: form.get('studentId'),
          startDate: form.get('startDate') || null
        }
      });
      setNotice('Plano semanal aplicado com sucesso ao aluno!');
    } catch (err) {
      setError(err.message);
    }
  }

  if (user.role === 'student') {
    return <section className="page"><div className="panel empty-state">Área disponível no portal do aluno</div></section>;
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span>Gestão de Treinos</span>
          <h1>Biblioteca e Planos</h1>
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

      {/* ===================== ABA 1: EXERCÍCIOS ===================== */}
      {tab === 'exercises' ? (
        <div className="two-column wide-left">
          <section className="panel">
            <div className="section-title">
              <h2>Novo Exercício</h2>
            </div>
            <form className="form-stack" onSubmit={createExercise} ref={createFormRef}>
              <div className="form-grid">
                <div className="wide media-choice-field">
                  <MediaChoiceGrid value={mediaType} favoritesOnly={libraryFavoritesOnly} onChoose={chooseCreateMedia} />
                </div>

                {libraryPickerOpen ? (
                  <div className="wide gif-picker-overlay workout-gif-picker-overlay">
                    <GifLibraryPicker
                      onSelect={handleLibrarySelect}
                      onClose={() => setLibraryPickerOpen(false)}
                      initialFavoritesOnly={libraryFavoritesOnly}
                    />
                  </div>
                ) : null}

                <label>Nome do Exercício<input name="name" placeholder="Ex: Supino reto" required /></label>
                <label>Grupo Muscular<input name="muscleGroup" placeholder="Ex: Peitoral" /></label>
                <label>Séries padrão<input name="defaultSets" placeholder="Ex: 4" /></label>
                <label>Repetições padrão<input name="defaultRepetitions" placeholder="Ex: 10 a 12" /></label>
                <label>Carga sugerida<input name="defaultLoad" placeholder="Ex: 20kg cada lado" /></label>
                <label>Descanso (segundos)<input name="defaultRestSeconds" type="number" min="0" placeholder="Ex: 60" /></label>

                {mediaType === 'library' && selectedLibraryGif ? (
                  <div className="wide gif-selected-preview">
                    <img src={gifLibraryFileUrl(selectedLibraryGif.id)} alt={selectedLibraryGif.name} />
                    <div>
                      <strong>{selectedLibraryGif.name}</strong>
                      <span>{selectedLibraryGif.muscleGroup || 'Geral'}</span>
                    </div>
                    <button type="button" className="secondary-button" onClick={() => setLibraryPickerOpen(true)}>Trocar</button>
                  </div>
                ) : null}

                {mediaType === 'youtube' ? (
                  <label className="wide">Link do YouTube
                    <input name="youtubeUrl" placeholder="https://www.youtube.com/watch?v=..." required />
                  </label>
                ) : null}

                {mediaType === 'video' ? (
                  <>
                    <label>Arquivo de Vídeo
                      <input name="video" type="file" accept="video/mp4,video/webm,video/quicktime" required />
                    </label>
                    <label>Duração do vídeo (s)
                      <input name="videoDurationSeconds" type="number" step="0.1" min="0" placeholder="Ex: 4" />
                    </label>
                  </>
                ) : null}

                {mediaType === 'gif' ? (
                  <label className="wide">Arquivo GIF
                    <input name="gif" type="file" accept="image/gif" required />
                  </label>
                ) : null}

                <label>Áudio explicativo (opcional)
                  <input name="audio" type="file" accept="audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/mp4,video/mp4" />
                </label>
                <label>Duração do áudio (s)
                  <input name="audioDurationSeconds" type="number" step="0.1" min="0" placeholder="Ex: 30" />
                </label>

                <label className="wide">Visibilidade
                  <select name="visibility" defaultValue="private" disabled={!canCreatePublic}>
                    <option value="private">Particular (somente meus alunos)</option>
                    <option value="public">Público (disponível para todos os personais)</option>
                  </select>
                </label>

                <label className="wide">Instruções / Observações
                  <textarea name="observations" rows="3" placeholder="Postura, cadência, pico de contração..." />
                </label>
              </div>

              <button className="primary-button fit-button" type="submit">
                <Plus size={18} />
                Cadastrar Exercício
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="section-title">
              <h2>Exercícios Cadastrados ({filteredExercises.length})</h2>
            </div>

            <div className="search-bar">
              <Search size={18} className="search-icon" />
              <input
                value={exerciseSearch}
                onChange={(e) => setExerciseSearch(e.target.value)}
                placeholder="Buscar exercício por nome ou grupo muscular..."
              />
              {exerciseSearch ? (
                <button type="button" className="clear-search-btn" onClick={() => setExerciseSearch('')}>
                  <X size={16} />
                </button>
              ) : null}
            </div>

            {filteredExercises.length === 0 ? (
              <div className="empty-state">Nenhum exercício encontrado.</div>
            ) : (
              <div className="list-stack manage-list-stack">
                {filteredExercises.map((exercise) => (
                  <article className="list-item manage-card" key={exercise.id}>
                    {exercise.gif_library_path ? <img className="exercise-media" src={gifLibraryFileUrl(exercise.gif_library_path)} alt={exercise.name} /> : null}
                    {!exercise.gif_library_path && exercise.gif_path ? <img className="exercise-media" src={fileUrl(exercise.gif_path)} alt={exercise.name} /> : null}
                    {exercise.video_path ? <video className="exercise-media" src={fileUrl(exercise.video_path)} controls muted playsInline /> : null}
                    {exercise.youtube_url ? (
                      <iframe
                        className="exercise-media"
                        src={youtubeEmbedUrl(exercise.youtube_url)}
                        title={exercise.name}
                        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                      />
                    ) : null}

                    <div className="manage-card-body">
                      <div className="manage-card-title-row">
                        <strong>{exercise.name}</strong>
                        <StatusBadge value={exercise.visibility} />
                      </div>
                      <span className="manage-muscle">{exercise.muscle_group || 'Geral'}</span>
                      <div className="manage-specs-mini">
                        {exercise.default_sets ? <span>{exercise.default_sets} séries</span> : null}
                        {exercise.default_repetitions ? <span>{exercise.default_repetitions} reps</span> : null}
                        {exercise.default_load ? <span>{exercise.default_load}</span> : null}
                        {exercise.default_rest_seconds ? <span>{exercise.default_rest_seconds}s descanso</span> : null}
                      </div>
                      {exercise.observations ? <p className="manage-desc">{exercise.observations}</p> : null}
                    </div>

                    <div className="card-actions">
                      <button
                        type="button"
                        className="action-btn btn-edit"
                        title="Editar exercício"
                        onClick={() => openEditExercise(exercise)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        className="action-btn btn-delete"
                        title="Excluir exercício"
                        onClick={() => deleteExercise(exercise.id, exercise.name)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* ===================== ABA 2: TREINOS DIÁRIOS ===================== */}
      {tab === 'daily' ? (
        <div className="two-column">
          <div className="form-stack">
            <section className="panel">
              <div className="section-title">
                <h2>Novo Treino Diário</h2>
              </div>
              <form className="form-stack" onSubmit={createDailyWorkout}>
                <label>Nome do Treino<input name="name" placeholder="Ex: Treino A - Peito e Tríceps" required /></label>
                <label>Descrição<textarea name="description" rows="2" placeholder="Foco em hipertrofia, aquecimento prévio..." /></label>
                <label>Visibilidade
                  <select name="visibility" defaultValue="private" disabled={!canCreatePublic}>
                    <option value="private">Particular (somente meus alunos)</option>
                    <option value="public">Público</option>
                  </select>
                </label>
                <button className="primary-button fit-button" type="submit"><Save size={18} />Criar Treino Diário</button>
              </form>
            </section>

            <section className="panel">
              <div className="section-title">
                <h2>Adicionar Exercício ao Treino</h2>
              </div>
              <form className="form-stack" onSubmit={addExerciseToWorkout}>
                <label>Treino Diário de Destino
                  <select value={selectedDailyWorkout} onChange={(event) => setSelectedDailyWorkout(event.target.value)} required>
                    <option value="">Selecione o treino</option>
                    {dailyWorkouts.map((workout) => <option key={workout.id} value={workout.id}>{workout.name}</option>)}
                  </select>
                </label>

                <div className="form-grid">
                  <label className="wide">Exercício
                    <select name="exerciseId" required>
                      <option value="">Selecione o exercício</option>
                      {exercises.map((exercise) => (
                        <option key={exercise.id} value={exercise.id}>
                          {exercise.name} ({exercise.muscle_group || 'Geral'})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>Posição / Ordem<input name="position" type="number" min="0" defaultValue="0" /></label>
                  <label>Séries<input name="sets" placeholder="Ex: 4" /></label>
                  <label>Repetições<input name="repetitions" placeholder="Ex: 10-12" /></label>
                  <label>Carga<input name="load" placeholder="Ex: 25kg" /></label>
                  <label>Descanso (s)<input name="restSeconds" type="number" min="0" defaultValue="60" /></label>
                  <label className="wide">Observações para este treino
                    <textarea name="notes" rows="2" placeholder="Executar até a falha na última série..." />
                  </label>
                </div>
                <button className="primary-button fit-button" type="submit"><Plus size={18} />Adicionar Exercício</button>
              </form>
            </section>
          </div>

          <section className="panel">
            <div className="section-title">
              <h2>Treinos Diários Cadastrados ({filteredDailyWorkouts.length})</h2>
            </div>

            <div className="search-bar">
              <Search size={18} className="search-icon" />
              <input
                value={dailySearch}
                onChange={(e) => setDailySearch(e.target.value)}
                placeholder="Buscar treino diário por nome..."
              />
              {dailySearch ? (
                <button type="button" className="clear-search-btn" onClick={() => setDailySearch('')}>
                  <X size={16} />
                </button>
              ) : null}
            </div>

            {filteredDailyWorkouts.length === 0 ? (
              <div className="empty-state">Nenhum treino diário encontrado.</div>
            ) : (
              <div className="list-stack">
                {filteredDailyWorkouts.map((workout) => (
                  <article className="panel sub-panel-manage" key={workout.id}>
                    <div className="manage-header-row">
                      <div>
                        <strong>{workout.name}</strong>
                        {workout.description ? <p className="manage-desc">{workout.description}</p> : null}
                      </div>
                      <div className="manage-badge-and-actions">
                        <StatusBadge value={workout.visibility} />
                        <div className="card-actions">
                          <button
                            type="button"
                            className="action-btn btn-edit"
                            title="Editar treino diário"
                            onClick={() => setEditingDaily(workout)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            className="action-btn btn-delete"
                            title="Excluir treino diário"
                            onClick={() => deleteDailyWorkout(workout.id, workout.name)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="manage-subexercises-list">
                      <small className="manage-sublabel">
                        Exercícios ({workout.exercises?.length || 0}):
                      </small>
                      {(!workout.exercises || workout.exercises.length === 0) ? (
                        <span className="muted-small">Nenhum exercício vinculado ainda. Use o formulário ao lado para adicionar.</span>
                      ) : (
                        <div className="subexercises-tags">
                          {workout.exercises.map((item) => (
                            <div className="exercise-tag-pill" key={item.id}>
                              <span>{item.exerciseName} ({item.sets || '4'}x{item.repetitions || '12'})</span>
                              <button
                                type="button"
                                className="tag-remove-btn"
                                title="Remover exercício do treino"
                                onClick={() => removeExerciseFromDaily(workout.id, item.id, item.exerciseName)}
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* ===================== ABA 3: PLANOS SEMANAIS ===================== */}
      {tab === 'weekly' ? (
        <div className="form-stack">
          <section className="panel">
            <div className="section-title">
              <h2>Novo Plano Semanal</h2>
            </div>
            <form className="form-stack" onSubmit={createWeeklyPlan}>
              <div className="form-grid">
                <label>Nome do Plano<input name="name" placeholder="Ex: Plano Hipertrofia Intermediário" required /></label>
                <label>Data de Início sugerida<input name="startDate" type="date" /></label>
                <label className="wide">Visibilidade
                  <select name="visibility" defaultValue="private" disabled={!canCreatePublic}>
                    <option value="private">Particular (meus alunos)</option>
                    <option value="public">Público</option>
                  </select>
                </label>
                <label className="wide">Descrição do Plano
                  <textarea name="description" rows="2" placeholder="Frequência semanal, orientações de progressão de carga..." />
                </label>
              </div>

              <div className="section-title soft-title">
                <h2>Grade Semanal (Domingo a Sábado)</h2>
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
                      <option value="">Treino...</option>
                      {dailyWorkouts.map((workout) => (
                        <option key={workout.id} value={workout.id}>{workout.name}</option>
                      ))}
                    </select>
                    <textarea name={`instructions-${index}`} rows="2" placeholder="Instruções do dia..." />
                  </fieldset>
                ))}
              </div>

              <button className="primary-button fit-button" type="submit">
                <Save size={18} />
                Salvar Plano Semanal
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="section-title">
              <h2>Planos Semanais Cadastrados ({filteredWeeklyPlans.length})</h2>
            </div>

            <div className="search-bar">
              <Search size={18} className="search-icon" />
              <input
                value={weeklySearch}
                onChange={(e) => setWeeklySearch(e.target.value)}
                placeholder="Buscar plano semanal por nome..."
              />
              {weeklySearch ? (
                <button type="button" className="clear-search-btn" onClick={() => setWeeklySearch('')}>
                  <X size={16} />
                </button>
              ) : null}
            </div>

            {filteredWeeklyPlans.length === 0 ? (
              <div className="empty-state">Nenhum plano semanal cadastrado.</div>
            ) : (
              <div className="list-stack">
                {filteredWeeklyPlans.map((plan) => (
                  <article className="panel sub-panel-manage" key={plan.id}>
                    <div className="manage-header-row">
                      <div>
                        <strong>{plan.name}</strong>
                        {plan.description ? <p className="manage-desc">{plan.description}</p> : null}
                      </div>
                      <div className="manage-badge-and-actions">
                        <StatusBadge value={plan.visibility} />
                        <div className="card-actions">
                          <button
                            type="button"
                            className="action-btn btn-edit"
                            title="Editar plano semanal"
                            onClick={() => openEditWeekly(plan)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            className="action-btn btn-delete"
                            title="Excluir plano semanal"
                            onClick={() => deleteWeeklyPlan(plan.id, plan.name)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="plan-days-summary">
                      {weekDays.map((dayName, idx) => {
                        const dayObj = plan.days?.find((d) => Number(d.dayOfWeek) === idx);
                        const isRest = dayObj?.isRest;
                        const workoutName = dayObj?.dailyWorkoutName;
                        return (
                          <div className={`plan-day-chip ${isRest ? 'chip-rest' : workoutName ? 'chip-workout' : 'chip-empty'}`} key={dayName}>
                            <strong>{dayName.slice(0, 3)}</strong>
                            <span>{isRest ? 'Descanso' : workoutName || '-'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* ===================== ABA 4: APLICAR PLANO ===================== */}
      {tab === 'apply' ? (
        <section className="panel">
          <div className="section-title">
            <h2>Aplicar Plano ao Aluno</h2>
          </div>
          <form className="form-grid" onSubmit={applyPlan}>
            <label>Plano Semanal
              <select name="weeklyPlanId" value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value)} required>
                <option value="">Selecione o plano</option>
                {weeklyPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select>
            </label>
            <label>Aluno
              <select name="studentId" required>
                <option value="">Selecione o aluno</option>
                {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
              </select>
            </label>
            <label>Data de Início<input name="startDate" type="date" defaultValue={new Date().toISOString().split('T')[0]} /></label>
            <button className="primary-button fit-button" type="submit"><Save size={18} />Aplicar Plano ao Aluno</button>
          </form>
        </section>
      ) : null}

      {/* ===================== MODAL EDITAR EXERCÍCIO ===================== */}
      <Modal title={`Editar Exercício: ${editingExercise?.name || ''}`} open={Boolean(editingExercise)} onClose={() => setEditingExercise(null)}>
        {editingExercise ? (
          <form className="form-stack" onSubmit={updateExercise} ref={editFormRef}>
            <div className="form-grid">
              <label>Nome do Exercício<input name="name" defaultValue={editingExercise.name} required /></label>
              <label>Grupo Muscular<input name="muscleGroup" defaultValue={editingExercise.muscle_group || ''} /></label>
              <label>Séries<input name="defaultSets" defaultValue={editingExercise.default_sets || ''} /></label>
              <label>Repetições<input name="defaultRepetitions" defaultValue={editingExercise.default_repetitions || ''} /></label>
              <label>Carga<input name="defaultLoad" defaultValue={editingExercise.default_load || ''} /></label>
              <label>Descanso (segundos)<input name="defaultRestSeconds" type="number" min="0" defaultValue={editingExercise.default_rest_seconds ?? ''} /></label>

              <div className="wide media-choice-field">
                <span>Mídia demonstrativa</span>
                <MediaChoiceGrid value={editExerciseMediaType} favoritesOnly={editLibraryFavoritesOnly} onChoose={chooseEditMedia} />
              </div>

              {editExerciseMediaType === 'library' ? (
                <div className="wide gif-selected-preview">
                  {editSelectedLibraryGif || editingExercise.gif_library_path ? (
                    <img
                      src={gifLibraryFileUrl(editSelectedLibraryGif?.id || editingExercise.gif_library_path)}
                      alt={editSelectedLibraryGif?.name || editingExercise.name}
                    />
                  ) : null}
                  <div>
                    <strong>{editSelectedLibraryGif?.name || (editingExercise.gif_library_path ? 'Animação atual' : 'Nenhuma selecionada')}</strong>
                  </div>
                  <button type="button" className="secondary-button" onClick={() => setEditLibraryPickerOpen(true)}>
                    {editingExercise.gif_library_path || editSelectedLibraryGif ? 'Trocar' : 'Selecionar'}
                  </button>
                </div>
              ) : null}

              {editExerciseMediaType === 'youtube' ? (
                <label className="wide">Link do YouTube
                  <input name="youtubeUrl" defaultValue={editingExercise.youtube_url || ''} placeholder="https://www.youtube.com/watch?v=..." required />
                </label>
              ) : null}

              {editExerciseMediaType === 'video' ? (
                <>
                  <label>Arquivo de Vídeo (deixe vazio para manter atual)
                    <input name="video" type="file" accept="video/mp4,video/webm,video/quicktime" />
                  </label>
                  <label>Duração do vídeo (s)
                    <input name="videoDurationSeconds" type="number" step="0.1" min="0" defaultValue={editingExercise.video_duration_seconds ?? ''} />
                  </label>
                </>
              ) : null}

              {editExerciseMediaType === 'gif' ? (
                <label className="wide">Arquivo GIF (deixe vazio para manter atual)
                  <input name="gif" type="file" accept="image/gif" />
                </label>
              ) : null}

              <label className="wide">Visibilidade
                <select name="visibility" defaultValue={editingExercise.visibility} disabled={!canCreatePublic}>
                  <option value="private">Particular</option>
                  <option value="public">Público</option>
                </select>
              </label>

              <label className="wide">Instruções / Observações
                <textarea name="observations" rows="3" defaultValue={editingExercise.observations || ''} />
              </label>
            </div>

            {editLibraryPickerOpen ? (
              <div className="gif-picker-overlay">
                <GifLibraryPicker
                  onSelect={handleEditLibrarySelect}
                  onClose={() => setEditLibraryPickerOpen(false)}
                  initialFavoritesOnly={editLibraryFavoritesOnly}
                />
              </div>
            ) : null}

            <div className="actions modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingExercise(null)}>Cancelar</button>
              <button type="submit" className="primary-button"><Save size={16} />Salvar Alterações</button>
            </div>
          </form>
        ) : null}
      </Modal>

      {/* ===================== MODAL EDITAR TREINO DIÁRIO ===================== */}
      <Modal title={`Editar Treino: ${editingDaily?.name || ''}`} open={Boolean(editingDaily)} onClose={() => setEditingDaily(null)}>
        {editingDaily ? (
          <form className="form-stack" onSubmit={updateDailyWorkout}>
            <label>Nome do Treino<input name="name" defaultValue={editingDaily.name} required /></label>
            <label>Descrição<textarea name="description" rows="3" defaultValue={editingDaily.description || ''} /></label>
            <label>Visibilidade
              <select name="visibility" defaultValue={editingDaily.visibility} disabled={!canCreatePublic}>
                <option value="private">Particular</option>
                <option value="public">Público</option>
              </select>
            </label>
            <div className="actions modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingDaily(null)}>Cancelar</button>
              <button type="submit" className="primary-button"><Save size={16} />Salvar Alterações</button>
            </div>
          </form>
        ) : null}
      </Modal>

      {/* ===================== MODAL EDITAR PLANO SEMANAL ===================== */}
      <Modal title={`Editar Plano: ${editingWeekly?.name || ''}`} open={Boolean(editingWeekly)} onClose={() => setEditingWeekly(null)}>
        {editingWeekly ? (
          <form className="form-stack" onSubmit={updateWeeklyPlan}>
            <div className="form-grid">
              <label>Nome do Plano<input name="name" defaultValue={editingWeekly.name} required /></label>
              <label>Data de Início sugerida<input name="startDate" type="date" defaultValue={editingWeekly.start_date || ''} /></label>
              <label className="wide">Visibilidade
                <select name="visibility" defaultValue={editingWeekly.visibility} disabled={!canCreatePublic}>
                  <option value="private">Particular</option>
                  <option value="public">Público</option>
                </select>
              </label>
              <label className="wide">Descrição
                <textarea name="description" rows="2" defaultValue={editingWeekly.description || ''} />
              </label>
            </div>

            <div className="section-title soft-title">
              <h2>Grade Semanal</h2>
            </div>

            <div className="week-grid">
              {weekDays.map((day, index) => {
                const existingDay = editingWeekly.days?.find((d) => Number(d.dayOfWeek) === index);
                return (
                  <fieldset key={day} className="day-config">
                    <legend>{day}</legend>
                    <label className="check-line">
                      <input type="checkbox" name={`edit-rest-${index}`} defaultChecked={Boolean(existingDay?.isRest)} />
                      Descanso
                    </label>
                    <select name={`edit-daily-${index}`} defaultValue={existingDay?.dailyWorkoutId || ''}>
                      <option value="">Treino...</option>
                      {dailyWorkouts.map((workout) => (
                        <option key={workout.id} value={workout.id}>{workout.name}</option>
                      ))}
                    </select>
                    <textarea name={`edit-instructions-${index}`} rows="2" defaultValue={existingDay?.instructions || ''} placeholder="Instruções..." />
                  </fieldset>
                );
              })}
            </div>

            <div className="actions modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingWeekly(null)}>Cancelar</button>
              <button type="submit" className="primary-button"><Save size={16} />Salvar Alterações</button>
            </div>
          </form>
        ) : null}
      </Modal>
    </section>
  );
}

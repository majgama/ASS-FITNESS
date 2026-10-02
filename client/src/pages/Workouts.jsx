import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Calendar,
  Check,
  Dumbbell,
  FileText,
  ArrowLeft,
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
  { value: 'library', label: 'Banco de GIFs', icon: '/icones/banco_gif2.PNG' },
  { value: 'gif', label: 'Enviar GIF', icon: '/icones/enviar_gif2.PNG' },
  { value: 'video', label: 'Enviar vídeo', icon: '/icones/envia_videos2.PNG' },
  { value: 'youtube', label: 'Link do YouTube', icon: '/icones/link_youtube.PNG' },
  { value: 'favorites', label: 'Favoritos', icon: '/icones/favotitos2.PNG' },
  { value: 'none', label: 'Sem mídia', icon: null }
];

const workoutModalities = [
  { tab: 'weekly', path: '/treinos/planos', image: '/icones/icone_planos.PNG', title: 'Planos semanais' },
  { tab: 'daily', path: '/treinos/diarios', image: '/icones/icone_treino.PNG', title: 'Treinos diários' },
  { tab: 'exercises', path: '/treinos/exercicios', image: '/icones/icone_exercicios.PNG', title: 'Exercícios' }
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

function ManagementViewSelector({ value, onChange, publicLabel, mineLabel, createLabel }) {
  return (
    <div className="segmented management-view-selector">
      <button type="button" className={value === 'public' ? 'active' : ''} onClick={() => onChange('public')}>{publicLabel}</button>
      <button type="button" className={value === 'mine' ? 'active' : ''} onClick={() => onChange('mine')}>{mineLabel}</button>
      <button type="button" className={value === 'create' ? 'active' : ''} onClick={() => onChange('create')}>{createLabel}</button>
    </div>
  );
}

function WorkoutModalityNav({ activeTab }) {
  const navigate = useNavigate();
  return (
    <div className="workout-modality-grid">
      {workoutModalities.map((modality) => (
        <button
          key={modality.path}
          type="button"
          className={`workout-modality-card ${activeTab === modality.tab ? 'active' : ''}`}
          onClick={() => navigate(modality.path)}
          aria-label={modality.title}
          title={modality.title}
        >
          <img src={modality.image} alt="" />
        </button>
      ))}
    </div>
  );
}

export function WorkoutsHome() {
  const { user } = useAuth();

  if (user.role === 'student') {
    return <section className="page"><div className="panel empty-state">Área disponível no portal do aluno</div></section>;
  }

  return (
    <section className="page workouts-home-page">
      <div className="page-heading">
        <div>
          <span>Gestão de Treinos</span>
          <h1>Treinos</h1>
        </div>
      </div>
      <WorkoutModalityNav />
    </section>
  );
}

export function Workouts({ initialTab = 'exercises' }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState(initialTab);
  const [exerciseView, setExerciseView] = useState('public');
  const [dailyView, setDailyView] = useState('public');
  const [weeklyView, setWeeklyView] = useState('public');
  const [dailyExerciseView, setDailyExerciseView] = useState('public');
  const [selectedExerciseForDaily, setSelectedExerciseForDaily] = useState('');
  const [exercises, setExercises] = useState([]);
  const [dailyWorkouts, setDailyWorkouts] = useState([]);
  const [weeklyPlans, setWeeklyPlans] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedDailyWorkout, setSelectedDailyWorkout] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mediaType, setMediaType] = useState('none');
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
  const [exerciseForPlan, setExerciseForPlan] = useState(null);

  const canCreatePublic = user.role === 'admin';

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

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

  useEffect(() => {
    const planId = location.state?.selectedPlanId;
    if (!planId) return;

    setSelectedPlan(planId);
    navigate('/treinos/aplicar', { replace: true, state: null });
  }, [location.state, navigate]);

  useEffect(() => {
    const selectedGif = location.state?.selectedLibraryGif;
    if (!selectedGif) return;

    setTab('exercises');
    setExerciseView('create');
    setMediaType('library');
    setLibraryFavoritesOnly(false);
    setSelectedLibraryGif(selectedGif);
    requestAnimationFrame(() => {
      const form = createFormRef.current;
      if (!form) return;
      form.elements.name.value = selectedGif.name;
      if (selectedGif.muscleGroup) form.elements.muscleGroup.value = selectedGif.muscleGroup;
      if (user.role === 'admin') {
        form.elements.defaultSets.value = '3';
        form.elements.defaultRepetitions.value = '10 a 12';
        form.elements.defaultRestSeconds.value = '90';
        form.elements.visibility.value = 'public';
      }
    });
    navigate('/treinos/exercicios', { replace: true, state: null });
  }, [location.state, navigate, user.role]);

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

  const visibleExercises = useMemo(() => filteredExercises.filter((exercise) => (
    exerciseView === 'public' ? exercise.visibility === 'public' : exercise.owner_id === user.id
  )), [exerciseView, filteredExercises, user.id]);

  const visibleDailyWorkouts = useMemo(() => filteredDailyWorkouts.filter((workout) => (
    dailyView === 'public' ? workout.visibility === 'public' : workout.owner_id === user.id
  )), [dailyView, filteredDailyWorkouts, user.id]);

  const visibleWeeklyPlans = useMemo(() => filteredWeeklyPlans.filter((plan) => (
    weeklyView === 'public' ? plan.visibility === 'public' : plan.owner_id === user.id
  )), [filteredWeeklyPlans, user.id, weeklyView]);

  const availableDailyExercises = useMemo(() => exercises.filter((exercise) => (
    dailyExerciseView === 'public' ? exercise.visibility === 'public' : exercise.owner_id === user.id
  )), [dailyExerciseView, exercises, user.id]);

  const editableWeeklyPlans = useMemo(() => weeklyPlans.filter((plan) => (
    user.role === 'admin' || plan.owner_id === user.id
  )), [user.id, user.role, weeklyPlans]);

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
      setNotice('Exercício criado com sucesso.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function chooseCreateMedia(choice) {
    const favorites = choice === 'favorites';
    const nextType = favorites ? 'library' : choice;
    if (nextType === 'library') {
      navigate('/treinos/biblioteca-gifs', { state: { favoritesOnly: favorites } });
      return;
    }
    setMediaType(nextType);
    setLibraryFavoritesOnly(favorites);
    setSelectedLibraryGif(null);
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

  async function addExerciseToPlanWorkout(plan, day) {
    if (!exerciseForPlan || !day.dailyWorkoutId) return;
    setError('');
    const restSeconds = Number(exerciseForPlan.default_rest_seconds);
    try {
      await api(`/workouts/daily/${day.dailyWorkoutId}/exercises`, {
        method: 'POST',
        body: {
          exerciseId: exerciseForPlan.id,
          position: 0,
          sets: exerciseForPlan.default_sets || null,
          repetitions: exerciseForPlan.default_repetitions || null,
          load: exerciseForPlan.default_load || null,
          restSeconds: Number.isFinite(restSeconds) ? restSeconds : null,
          notes: exerciseForPlan.observations || null
        }
      });
      setExerciseForPlan(null);
      setNotice(`${exerciseForPlan.name} foi adicionado ao treino ${day.dailyWorkoutName}.`);
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
    if (!form.get('exerciseId')) {
      setError('Selecione um exercício para adicionar ao treino.');
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
      setSelectedExerciseForDaily('');
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

      <WorkoutModalityNav activeTab={tab} />

      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {!initialTab ? <div className="segmented">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div> : null}

      {/* ===================== ABA 1: EXERCÍCIOS ===================== */}
      {tab === 'exercises' ? (
        <>
          <ManagementViewSelector value={exerciseView} onChange={setExerciseView} publicLabel="Exercícios públicos" mineLabel="Meus exercícios" createLabel="Novo exercício" />
          <div className="two-column wide-left workout-view-content">
          <section className="panel" hidden={exerciseView !== 'create'}>
            <div className="section-title">
              <h2>Novo Exercício</h2>
            </div>
            <form className="form-stack" onSubmit={createExercise} ref={createFormRef}>
              <div className="form-grid">
                <div className="wide media-choice-field">
                  <MediaChoiceGrid value={mediaType} favoritesOnly={libraryFavoritesOnly} onChoose={chooseCreateMedia} />
                </div>

                <label>Nome do Exercício<input name="name" placeholder="Ex: Supino reto" required /></label>
                <label>Grupo Muscular<input name="muscleGroup" placeholder="Ex: Peitoral" /></label>
                <label>Séries padrão<input name="defaultSets" placeholder="Ex: 4" /></label>
                <label>Repetições padrão<input name="defaultRepetitions" placeholder="Ex: 10 a 12" /></label>
                <label>Carga sugerida<input name="defaultLoad" placeholder="Ex: 20kg cada lado" /></label>
                <label>Descanso<input name="defaultRestSeconds" placeholder="Ex: 90 ou caminhada ativa por 2 min" /></label>

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
                  <select name="visibility" defaultValue={canCreatePublic ? 'public' : 'private'} disabled={!canCreatePublic}>
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

          <section className="panel" hidden={exerciseView === 'create'}>
            <div className="section-title">
              <h2>{exerciseView === 'public' ? 'Exercícios Públicos' : 'Meus Exercícios'} ({visibleExercises.length})</h2>
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

            {visibleExercises.length === 0 ? (
              <div className="empty-state">Nenhum exercício encontrado.</div>
            ) : (
              <div className="list-stack manage-list-stack">
                {visibleExercises.map((exercise) => {
                  const hasMedia = Boolean(exercise.gif_library_path || exercise.gif_path || exercise.video_path || exercise.youtube_url);
                  const canManageExercise = user.role === 'admin' || (exercise.visibility === 'private' && exercise.owner_id === user.id);
                  return (
                  <article className="list-item manage-card manage-exercise-card" key={exercise.id}>
                    <div className="manage-card-body">
                      <div className="manage-card-top">
                        <strong>{exercise.name}</strong>
                        <span className="manage-muscle">{exercise.muscle_group || 'Geral'}</span>
                        {!hasMedia ? <StatusBadge value={exercise.visibility} /> : null}
                        {!hasMedia ? (
                          <div className="card-actions">
                            <button type="button" className="action-btn" title="Adicionar a um treino" onClick={() => setExerciseForPlan(exercise)}><Plus size={16} /></button>
                            {canManageExercise ? <>
                            <button type="button" className="action-btn btn-edit" title="Editar exercício" onClick={() => openEditExercise(exercise)}><Pencil size={16} /></button>
                            <button type="button" className="action-btn btn-delete" title="Excluir exercício" onClick={() => deleteExercise(exercise.id, exercise.name)}><Trash2 size={16} /></button>
                            </> : null}
                          </div>
                        ) : null}
                      </div>

                      {hasMedia ? (
                        <div className="manage-card-media">
                          {exercise.gif_library_path ? <img className="exercise-media" src={gifLibraryFileUrl(exercise.gif_library_path)} alt={exercise.name} /> : null}
                          {!exercise.gif_library_path && exercise.gif_path ? <img className="exercise-media" src={fileUrl(exercise.gif_path)} alt={exercise.name} /> : null}
                          {exercise.video_path ? <video className="exercise-media" src={fileUrl(exercise.video_path)} controls muted playsInline /> : null}
                          {exercise.youtube_url ? <iframe className="exercise-media" src={youtubeEmbedUrl(exercise.youtube_url)} title={exercise.name} referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" /> : null}
                          <div className="manage-media-actions">
                            <button type="button" className="action-btn" title="Adicionar a um treino" onClick={() => setExerciseForPlan(exercise)}><Plus size={16} /></button>
                            {canManageExercise ? <>
                            <button type="button" className="action-btn btn-edit" title="Editar exercício" onClick={() => openEditExercise(exercise)}><Pencil size={16} /></button>
                            <button type="button" className="action-btn btn-delete" title="Excluir exercício" onClick={() => deleteExercise(exercise.id, exercise.name)}><Trash2 size={16} /></button>
                            </> : null}
                          </div>
                          <div className="manage-media-visibility"><StatusBadge value={exercise.visibility} /></div>
                        </div>
                      ) : null}

                      <div className="manage-specs-mini">
                        {exercise.default_sets ? <div className="spec-item"><Dumbbell size={16} className="spec-icon" /><div><small>Séries</small><strong>{exercise.default_sets} séries</strong></div></div> : null}
                        {exercise.default_repetitions ? <div className="spec-item"><Repeat size={16} className="spec-icon" /><div><small>Repetições</small><strong>{exercise.default_repetitions} reps</strong></div></div> : null}
                        {exercise.default_load ? <div className="spec-item"><Dumbbell size={16} className="spec-icon" /><div><small>Carga</small><strong>{exercise.default_load}</strong></div></div> : null}
                        {exercise.default_rest_seconds ? <div className="spec-item"><Timer size={16} className="spec-icon" /><div><small>Intervalo</small><strong>{exercise.default_rest_seconds}</strong></div></div> : null}
                      </div>
                      {exercise.observations ? <div className="manage-notes-box"><FileText size={16} className="spec-icon" /><div><small>Orientação</small><p>{exercise.observations}</p></div></div> : null}
                    </div>
                  </article>
                  );
                })}
              </div>
            )}
          </section>
          </div>
        </>
      ) : null}

      {/* ===================== ABA 2: TREINOS DIÁRIOS ===================== */}
      {tab === 'daily' ? (
        <>
          <ManagementViewSelector value={dailyView} onChange={setDailyView} publicLabel="Treinos públicos" mineLabel="Meus treinos" createLabel="Novo treino" />
          {dailyView !== 'create' ? (
            <button type="button" className="secondary-button plan-back-button plan-back-button-top" onClick={() => navigate('/treinos')}>
              <ArrowLeft size={16} />
              Voltar
            </button>
          ) : null}
          <div className={`two-column workout-view-content ${dailyView !== 'create' ? 'workout-list-only' : ''}`}>
          <div className="form-stack" hidden={dailyView !== 'create'}>
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
                  <div className="wide daily-exercise-picker">
                    <span>Exercício</span>
                    <ManagementViewSelector
                      value={dailyExerciseView}
                      onChange={(view) => {
                        if (view === 'create') {
                          setTab('exercises');
                          setExerciseView('create');
                          return;
                        }
                        setDailyExerciseView(view);
                        setSelectedExerciseForDaily('');
                      }}
                      publicLabel="Exercícios públicos"
                      mineLabel="Meus exercícios"
                      createLabel="Novo exercício"
                    />
                    <input name="exerciseId" type="hidden" value={selectedExerciseForDaily} readOnly />
                    <div className="daily-exercise-choice-grid">
                      {availableDailyExercises.map((exercise) => (
                        <button
                          key={exercise.id}
                          type="button"
                          className={`daily-exercise-choice ${selectedExerciseForDaily === exercise.id ? 'active' : ''}`}
                          onClick={() => setSelectedExerciseForDaily(exercise.id)}
                        >
                          <strong>{exercise.name}</strong>
                          <span>{exercise.muscle_group || 'Geral'}</span>
                        </button>
                      ))}
                    </div>
                    {availableDailyExercises.length === 0 ? <small className="muted-small">Nenhum exercício disponível nesta lista.</small> : null}
                  </div>
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

          <section className="panel" hidden={dailyView === 'create'}>
            <div className="section-title">
              <h2>{dailyView === 'public' ? 'Treinos Públicos' : 'Meus Treinos'} ({visibleDailyWorkouts.length})</h2>
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

            {visibleDailyWorkouts.length === 0 ? (
              <div className="empty-state">Nenhum treino diário encontrado.</div>
            ) : (
              <div className="list-stack">
                {visibleDailyWorkouts.map((workout) => (
                  <article className="panel sub-panel-manage manage-card manage-daily-card" key={workout.id}>
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
        </>
      ) : null}

      {/* ===================== ABA 3: PLANOS SEMANAIS ===================== */}
      {tab === 'weekly' ? (
        <>
          <ManagementViewSelector value={weeklyView} onChange={setWeeklyView} publicLabel="Planos públicos" mineLabel="Meus planos" createLabel="Criar plano" />
          {weeklyView !== 'create' ? (
            <button type="button" className="secondary-button plan-back-button plan-back-button-top" onClick={() => navigate('/treinos')}>
              <ArrowLeft size={16} />
              Voltar
            </button>
          ) : null}
          <div className="form-stack workout-view-content">
          <section className="panel" hidden={weeklyView !== 'create'}>
            <div className="section-title">
              <h2>Novo Plano Semanal</h2>
            </div>
            <form className="form-stack" onSubmit={createWeeklyPlan}>
              <div className="form-grid">
                <label>Nome do Plano<input name="name" placeholder="Ex: Plano Hipertrofia Intermediário" required /></label>
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
                    <legend>Dia: {day}</legend>
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

          <section className="panel" hidden={weeklyView === 'create'}>
            <div className="section-title">
              <h2>{weeklyView === 'public' ? 'Planos Públicos' : 'Meus Planos'} ({visibleWeeklyPlans.length})</h2>
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

            {visibleWeeklyPlans.length === 0 ? (
              <div className="empty-state">Nenhum plano semanal cadastrado.</div>
            ) : (
              <div className="list-stack">
                {visibleWeeklyPlans.map((plan) => (
                  <article className="panel sub-panel-manage manage-card manage-weekly-card" key={plan.id}>
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
                            <strong>{dayName}</strong>
                            <span>{isRest ? 'Descanso' : workoutName || '-'}</span>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="primary-button plan-apply-button"
                      onClick={() => navigate('/treinos/aplicar', { state: { selectedPlanId: plan.id } })}
                    >
                      <Calendar size={17} />
                      Aplicar plano ao aluno
                    </button>
                  </article>
                ))}
              </div>
            )}
            <button type="button" className="secondary-button plan-back-button" onClick={() => navigate('/treinos')}>
              <ArrowLeft size={16} />
              Voltar
            </button>
          </section>
          </div>
        </>
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

      <Modal title={`Adicionar ${exerciseForPlan?.name || 'exercício'} a um plano`} open={Boolean(exerciseForPlan)} onClose={() => setExerciseForPlan(null)}>
        {editableWeeklyPlans.length === 0 ? (
          <div className="empty-state">Nenhum plano próprio disponível. Crie um plano e vincule um treino diário para adicionar exercícios.</div>
        ) : (
          <div className="plan-target-list">
            {editableWeeklyPlans.map((plan) => {
              const planDays = (plan.days || []).filter((day) => day.dailyWorkoutId);
              return (
                <article className="plan-target-card" key={plan.id}>
                  <strong>{plan.name}</strong>
                  {planDays.length === 0 ? <span className="muted-small">Este plano não possui treinos vinculados.</span> : (
                    <div className="plan-target-days">
                      {planDays.map((day) => (
                        <button key={`${plan.id}-${day.dayOfWeek}`} type="button" onClick={() => addExerciseToPlanWorkout(plan, day)}>
                          <small>{weekDays[Number(day.dayOfWeek)]}</small>
                          <strong>{day.dailyWorkoutName}</strong>
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Modal>

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
              <label>Descanso<input name="defaultRestSeconds" defaultValue={editingExercise.default_rest_seconds ?? ''} /></label>

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

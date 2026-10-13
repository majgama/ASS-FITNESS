import { useEffect, useState } from 'react';
import { Pencil, PlayCircle, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const emptyDraft = { title: '', description: '', youtube: '' };

function embedUrl(videoId) {
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
}

function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function Tutorials() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [tutorials, setTutorials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const data = await api('/tutorials');
      setTutorials(data.tutorials);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user.role === 'student') return;
    load();
  }, [user.role]);

  if (user.role === 'student') {
    return <section className="page"><div className="panel empty-state">Tutoriais disponíveis apenas para personais e administradores.</div></section>;
  }

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function startEdit(tutorial) {
    setEditingId(tutorial.id);
    setDraft({ title: tutorial.title, description: tutorial.description || '', youtube: watchUrl(tutorial.youtubeVideoId) });
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId('');
    setDraft(emptyDraft);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const body = { title: draft.title, description: draft.description || null, youtube: draft.youtube };
      if (editingId) {
        await api(`/tutorials/${editingId}`, { method: 'PUT', body });
        setNotice('Tutorial atualizado.');
      } else {
        await api('/tutorials', { method: 'POST', body });
        setNotice('Tutorial adicionado.');
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(tutorial) {
    if (!window.confirm(`Excluir o tutorial "${tutorial.title}"?`)) return;
    setError('');
    setNotice('');
    try {
      await api(`/tutorials/${tutorial.id}`, { method: 'DELETE' });
      if (editingId === tutorial.id) cancelEdit();
      setNotice('Tutorial excluído.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const term = search.trim().toLowerCase();
  const visibleTutorials = term
    ? tutorials.filter((tutorial) => tutorial.title.toLowerCase().includes(term) || tutorial.description?.toLowerCase().includes(term))
    : tutorials;

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span>Central de ajuda</span>
          <h1>Tutoriais</h1>
        </div>
      </div>

      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {isAdmin ? (
        <section className="panel">
          <div className="section-title">
            <h2>{editingId ? 'Editar tutorial' : 'Adicionar tutorial'}</h2>
          </div>
          <form className="form-stack" onSubmit={submit}>
            <label>Título
              <input value={draft.title} onChange={(e) => updateDraft('title', e.target.value)} required minLength={2} maxLength={150} placeholder="Ex.: Como montar um plano semanal" />
            </label>
            <label>Descrição
              <textarea rows="3" value={draft.description} onChange={(e) => updateDraft('description', e.target.value)} maxLength={3000} placeholder="Explique o que o personal vai aprender neste vídeo." />
            </label>
            <label>Link ou frame do YouTube
              <textarea rows="2" value={draft.youtube} onChange={(e) => updateDraft('youtube', e.target.value)} required maxLength={2000} placeholder='https://www.youtube.com/watch?v=... ou <iframe src="https://www.youtube.com/embed/..."></iframe>' />
              <small className="muted-small">Cole o link do vídeo ou o código de incorporação (Compartilhar &gt; Incorporar) do YouTube.</small>
            </label>
            <div className="tutorial-form-actions">
              <button className="primary-button fit-button" type="submit" disabled={saving}>
                {editingId ? <Save size={18} /> : <Plus size={18} />}
                {editingId ? 'Salvar alterações' : 'Adicionar tutorial'}
              </button>
              {editingId ? <button type="button" className="secondary-button fit-button" onClick={cancelEdit}>Cancelar</button> : null}
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-title">
          <h2>Vídeos ({visibleTutorials.length})</h2>
        </div>
        <div className="search-bar">
          <Search size={18} className="search-icon" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar tutorial..." aria-label="Buscar tutorial" />
          {search ? (
            <button type="button" className="clear-search-btn" onClick={() => setSearch('')} aria-label="Limpar busca"><X size={16} /></button>
          ) : null}
        </div>

        {loading ? (
          <div className="empty-state">Carregando tutoriais...</div>
        ) : visibleTutorials.length === 0 ? (
          <div className="empty-state">
            <PlayCircle size={28} aria-hidden="true" />
            <p>{tutorials.length === 0 ? (isAdmin ? 'Nenhum tutorial cadastrado. Use o formulário acima para adicionar o primeiro.' : 'Nenhum tutorial disponível ainda.') : 'Nenhum tutorial encontrado.'}</p>
          </div>
        ) : (
          <div className="tutorial-grid">
            {visibleTutorials.map((tutorial) => (
              <article className="tutorial-card" key={tutorial.id}>
                <div className="tutorial-frame">
                  <iframe
                    src={embedUrl(tutorial.youtubeVideoId)}
                    title={tutorial.title}
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <div className="tutorial-body">
                  <h3>{tutorial.title}</h3>
                  {tutorial.description ? <p>{tutorial.description}</p> : null}
                  {isAdmin ? (
                    <div className="card-actions">
                      <button type="button" className="action-btn btn-edit" title="Editar tutorial" aria-label={`Editar ${tutorial.title}`} onClick={() => startEdit(tutorial)}><Pencil size={16} /></button>
                      <button type="button" className="action-btn btn-delete" title="Excluir tutorial" aria-label={`Excluir ${tutorial.title}`} onClick={() => remove(tutorial)}><Trash2 size={16} /></button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

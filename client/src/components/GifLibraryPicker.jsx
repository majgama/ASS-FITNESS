import { useEffect, useMemo, useState } from 'react';
import { Heart, Pencil, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { api, gifLibraryFileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export function GifLibraryPicker({ onSelect, onClose }) {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';

  const [gender, setGender] = useState('');
  const [environment, setEnvironment] = useState('');
  const [categorySegments, setCategorySegments] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ genders: [], environments: [], categoryOptions: [] });
  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [editingItem, setEditingItem] = useState(null);

  const categoryPath = useMemo(() => categorySegments.join('/'), [categorySegments]);

  async function loadFilters() {
    const params = new URLSearchParams();
    if (gender) params.set('gender', gender);
    if (environment) params.set('environment', environment);
    if (categoryPath) params.set('categoryPath', categoryPath);
    try {
      const data = await api(`/gif-library/filters?${params.toString()}`);
      setFilterOptions(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadItems(nextPage = 1) {
    const params = new URLSearchParams();
    if (gender) params.set('gender', gender);
    if (environment) params.set('environment', environment);
    if (categoryPath) params.set('categoryPath', categoryPath);
    if (search) params.set('search', search);
    if (favoritesOnly) params.set('favoritesOnly', 'true');
    params.set('page', String(nextPage));
    params.set('pageSize', '24');
    try {
      const data = await api(`/gif-library?${params.toString()}`);
      setItems(data.items);
      setTotal(data.total);
      setPage(data.page);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { loadFilters(); }, [gender, environment, categoryPath]);
  useEffect(() => { loadItems(1); }, [gender, environment, categoryPath, search, favoritesOnly]);

  function selectGender(value) {
    setGender(value);
    setEnvironment('');
    setCategorySegments([]);
  }

  function selectEnvironment(value) {
    setEnvironment(value);
    setCategorySegments([]);
  }

  function selectCategoryLevel(index, value) {
    const next = categorySegments.slice(0, index);
    if (value) next.push(value);
    setCategorySegments(next);
  }

  function pickNextCategory(value) {
    if (!value) return;
    setCategorySegments((current) => [...current, value]);
  }

  async function toggleFavorite(item) {
    try {
      const data = await api(`/gif-library/${item.id}/favorite`, { method: 'POST' });
      setItems((current) => current.map((it) => (it.id === item.id ? { ...it, isFavorite: data.isFavorite } : it)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editingItem) return;
    const form = new FormData(event.currentTarget);
    try {
      await api(`/gif-library/${editingItem.id}`, {
        method: 'PATCH',
        body: {
          name: form.get('name'),
          muscleGroup: form.get('muscleGroup') || null
        }
      });
      setEditingItem(null);
      await loadItems(page);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeItem(item) {
    if (!window.confirm(`Remover "${item.name}" da biblioteca de animações?`)) return;
    try {
      await api(`/gif-library/${item.id}`, { method: 'DELETE' });
      await loadItems(page);
    } catch (err) {
      setError(err.message);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 24));

  return (
    <div className="gif-picker">
      <div className="gif-picker-header">
        <strong>Biblioteca de animações</strong>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar biblioteca">
          <X size={16} />
        </button>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="gif-picker-filters">
        <select value={gender} onChange={(event) => selectGender(event.target.value)}>
          <option value="">Gênero</option>
          {filterOptions.genders.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={environment} onChange={(event) => selectEnvironment(event.target.value)} disabled={!gender}>
          <option value="">Ambiente</option>
          {filterOptions.environments.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        {categorySegments.length > 0 ? (
          <div className="gif-breadcrumb">
            {categorySegments.map((segment, index) => (
              <button
                key={`${segment}-${index}`}
                type="button"
                className="breadcrumb-chip"
                onClick={() => selectCategoryLevel(index, null)}
                title="Remover a partir deste nível"
              >
                {segment} <X size={11} />
              </button>
            ))}
          </div>
        ) : null}
        {environment && filterOptions.categoryOptions.length > 0 ? (
          <select value="" onChange={(event) => pickNextCategory(event.target.value)}>
            <option value="">Categoria...</option>
            {filterOptions.categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : null}
      </div>

      <div className="gif-picker-toolbar">
        <div className="search-bar">
          <Search size={16} className="search-icon" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar animação..." />
          {search ? (
            <button type="button" className="clear-search-btn" onClick={() => setSearch('')}>
              <X size={14} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className={`favorites-toggle ${favoritesOnly ? 'active' : ''}`}
          onClick={() => setFavoritesOnly((current) => !current)}
        >
          <Star size={16} />
          Favoritos
        </button>
      </div>

      <div className="gif-picker-grid">
        {items.length === 0 ? <div className="empty-state">Nenhuma animação encontrada.</div> : null}
        {items.map((item) => (
          <article className="gif-picker-card" key={item.id}>
            <img src={gifLibraryFileUrl(item.id)} alt={item.name} loading="lazy" />
            <div className="gif-picker-card-body">
              <strong>{item.name}</strong>
              {item.muscleGroup ? <span>{item.muscleGroup}</span> : null}
            </div>
            <div className="gif-picker-card-actions">
              <button type="button" className="action-btn" title="Adicionar" onClick={() => onSelect(item)}>
                <Plus size={15} />
              </button>
              <button
                type="button"
                className={`action-btn ${item.isFavorite ? 'btn-favorite-active' : ''}`}
                title="Favoritar"
                onClick={() => toggleFavorite(item)}
              >
                <Heart size={15} fill={item.isFavorite ? 'currentColor' : 'none'} />
              </button>
              {isAdmin ? (
                <>
                  <button type="button" className="action-btn btn-edit" title="Editar" onClick={() => setEditingItem(item)}>
                    <Pencil size={15} />
                  </button>
                  <button type="button" className="action-btn btn-delete" title="Excluir" onClick={() => removeItem(item)}>
                    <Trash2 size={15} />
                  </button>
                </>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {total > 24 ? (
        <div className="gif-picker-pagination">
          <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => loadItems(page - 1)}>Anterior</button>
          <span>{page} / {totalPages}</span>
          <button type="button" className="secondary-button" disabled={page >= totalPages} onClick={() => loadItems(page + 1)}>Próxima</button>
        </div>
      ) : null}

      {editingItem ? (
        <div className="gif-edit-overlay">
          <form className="form-stack" onSubmit={saveEdit}>
            <label>Nome<input name="name" defaultValue={editingItem.name} required /></label>
            <label>Grupo muscular<input name="muscleGroup" defaultValue={editingItem.muscleGroup || ''} /></label>
            <div className="actions modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingItem(null)}>Cancelar</button>
              <button type="submit" className="primary-button">Salvar</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

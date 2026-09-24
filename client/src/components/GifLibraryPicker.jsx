import { useEffect, useMemo, useState } from 'react';
import { FileDown, Heart, ListFilter, Pencil, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { api, gifLibraryFileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export function GifLibraryPicker({ onSelect, onClose, pageSize = 24, managementMode = false }) {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';

  const [gender, setGender] = useState('');
  const [environment, setEnvironment] = useState('');
  const [categorySegments, setCategorySegments] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ genders: [], environments: [], categoryOptions: [] });
  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [translationStatus, setTranslationStatus] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [exporting, setExporting] = useState(false);

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

  function buildItemsParams(nextPage = 1, requestedPageSize = pageSize) {
    const params = new URLSearchParams();
    if (gender) params.set('gender', gender);
    if (environment) params.set('environment', environment);
    if (categoryPath) params.set('categoryPath', categoryPath);
    if (search) params.set('search', search);
    if (favoritesOnly) params.set('favoritesOnly', 'true');
    if (translationStatus) params.set('translationStatus', translationStatus);
    params.set('page', String(nextPage));
    params.set('pageSize', String(requestedPageSize));
    return params;
  }

  async function loadItems(nextPage = 1) {
    const params = buildItemsParams(nextPage);
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
  useEffect(() => { loadItems(1); }, [gender, environment, categoryPath, search, favoritesOnly, translationStatus]);

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

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatTranslationStatus(item) {
    return item.translatedAt
      ? `Atualizado em ${item.translatedAt.slice(0, 10).split('-').reverse().join('/')}`
      : 'Pendente';
  }

  async function exportFilteredResults() {
    const exportWindow = window.open('', '_blank');
    if (!exportWindow) {
      setError('Não foi possível abrir a janela de impressão. Libere pop-ups e tente novamente.');
      return;
    }

    exportWindow.opener = null;
    exportWindow.document.write('<!doctype html><title>Gerando PDF...</title><p>Preparando resultados...</p>');
    exportWindow.document.close();
    setExporting(true);
    setError('');

    try {
      const exportedItems = [];
      const exportPageSize = 200;
      let exportPage = 1;
      let exportTotal = 0;

      do {
        const params = buildItemsParams(exportPage, exportPageSize);
        const data = await api(`/gif-library?${params.toString()}`);
        exportedItems.push(...data.items);
        exportTotal = data.total;
        exportPage += 1;
      } while (exportedItems.length < exportTotal);

      const activeFilters = [
        gender && `Gênero: ${gender}`,
        environment && `Ambiente: ${environment}`,
        categoryPath && `Categoria: ${categorySegments.join(' / ')}`,
        search && `Busca: ${search}`,
        favoritesOnly && 'Favoritos',
        translationStatus === 'pending' && 'Pendentes'
      ].filter(Boolean).join(' | ') || 'Todos os exercícios';

      const rows = exportedItems.map((item) => `
        <tr>
          <td class="preview"><img src="${escapeHtml(gifLibraryFileUrl(item.id))}" alt="${escapeHtml(item.name)}"></td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.muscleGroup || '-')}</td>
          <td>${escapeHtml(item.gender)}</td>
          <td>${escapeHtml(item.environment)}</td>
          <td>${escapeHtml(item.categoryPath.join(' / '))}</td>
          <td>${escapeHtml(formatTranslationStatus(item))}</td>
          <td class="id">${escapeHtml(item.id)}</td>
        </tr>
      `).join('');

      exportWindow.document.open();
      exportWindow.document.write(`<!doctype html>
        <html lang="pt-BR">
          <head>
            <meta charset="utf-8">
            <title>Nomes dos exercícios</title>
            <style>
              @page { size: A4 landscape; margin: 12mm; }
              * { box-sizing: border-box; }
              body { color: #17191c; font-family: Arial, sans-serif; font-size: 9pt; margin: 0; }
              h1 { font-size: 18pt; margin: 0 0 4px; }
              .summary { color: #5d5a54; margin: 0 0 16px; }
              table { border-collapse: collapse; width: 100%; }
              th { background: #eee0bd; text-align: left; }
              th, td { border: 1px solid #cfc8bb; padding: 6px; vertical-align: top; }
              tr { break-inside: avoid; }
              .preview { padding: 3px; width: 1.8cm; }
              .preview img { display: block; height: 1.5cm; max-width: 1.5cm; object-fit: contain; }
              .id { color: #5d5a54; font-family: monospace; font-size: 7pt; }
            </style>
          </head>
          <body>
            <h1>Nomes dos exercícios</h1>
            <p class="summary">${escapeHtml(activeFilters)} | ${exportedItems.length} resultado(s) | Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
            <table>
              <thead><tr><th>Imagem</th><th>Nome</th><th>Grupo muscular</th><th>Gênero</th><th>Ambiente</th><th>Categoria</th><th>Status</th><th>ID</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </body>
        </html>`);
      exportWindow.document.close();
      await Promise.all([...exportWindow.document.images].map((image) => new Promise((resolve) => {
        if (image.complete) {
          resolve();
          return;
        }
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      })));
      exportWindow.focus();
      exportWindow.print();
    } catch (err) {
      exportWindow.close();
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={`gif-picker ${managementMode ? 'gif-picker-management' : ''}`}>
      {!managementMode ? (
        <div className="gif-picker-header">
          <strong>Biblioteca de animações</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar biblioteca">
            <X size={16} />
          </button>
        </div>
      ) : null}

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
        {managementMode ? (
          <>
            <button
              type="button"
              className={`favorites-toggle ${translationStatus === 'pending' ? 'active' : ''}`}
              onClick={() => setTranslationStatus((current) => current === 'pending' ? '' : 'pending')}
            >
              <ListFilter size={16} />
              Pendentes
            </button>
            <button type="button" className="favorites-toggle" onClick={exportFilteredResults} disabled={exporting}>
              <FileDown size={16} />
              {exporting ? 'Gerando PDF...' : 'Gerar PDF'}
            </button>
          </>
        ) : null}
      </div>

      <div className="gif-picker-grid">
        {items.length === 0 ? <div className="empty-state">Nenhuma animação encontrada.</div> : null}
        {items.map((item) => (
          <article className="gif-picker-card" key={item.id}>
            <img src={gifLibraryFileUrl(item.id)} alt={item.name} loading="lazy" />
            <div className="gif-picker-card-body">
              <strong>{item.name}</strong>
              {item.muscleGroup ? <span>{item.muscleGroup}</span> : null}
              {managementMode ? (
                <span className={`gif-translation-status ${item.translatedAt ? 'updated' : 'pending'}`}>
                  {formatTranslationStatus(item)}
                </span>
              ) : null}
            </div>
            <div className="gif-picker-card-actions">
              {onSelect ? (
                <button type="button" className="action-btn" title="Adicionar" onClick={() => onSelect(item)}>
                  <Plus size={15} />
                </button>
              ) : null}
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

      {total > pageSize ? (
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

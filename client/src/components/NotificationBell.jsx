import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

export function NotificationBell({ user }) {
  const navigate = useNavigate();
  const container = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await api('/notifications');
        if (active) {
          setItems(data.notifications);
          setError('');
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 60000);
    window.addEventListener('focus', load);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('focus', load);
    };
  }, [user.id]);

  useEffect(() => {
    if (!open) return;
    function close(event) {
      if (event.type === 'keydown' && event.key === 'Escape') {
        setOpen(false);
        container.current?.querySelector('button')?.focus();
      } else if (event.type === 'pointerdown' && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  async function markRead(ids) {
    setSaving(true);
    try {
      for (let i = 0; i < ids.length; i += 500) {
        await api('/notifications/read', { method: 'POST', body: { ids: ids.slice(i, i + 500) } });
      }
      setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, read: true } : item));
      setError('');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function visit(item) {
    if (!item.read && !await markRead([item.id])) return;
    setOpen(false);
    if (item.type === 'assessment') navigate('/avaliacoes', { state: { studentId: item.studentId } });
    else if (user.role !== 'student') navigate(`/alunos/${item.studentId}`);
    else navigate('/');
  }

  const unread = items.filter((item) => !item.read);
  return (
    <div className="notification-bell" ref={container}>
      <button type="button" className="icon-button popup-close-button" aria-label={`Notificações: ${unread.length} não lidas${error ? ', erro ao atualizar' : ''}`} aria-expanded={open} aria-controls="notification-panel" onClick={() => setOpen((current) => !current)}>
        <Bell size={20} />
        {unread.length > 0 || error ? <span className="notification-count">{error ? '!' : unread.length > 99 ? '99+' : unread.length}</span> : null}
      </button>
      {open ? (
        <section className="notification-panel" id="notification-panel" aria-label="Notificações">
          <div className="notification-heading">
            <h2>Notificações</h2>
            <button type="button" className="icon-button popup-close-button" aria-label="Fechar notificações" onClick={() => setOpen(false)}><X size={18} /></button>
          </div>
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          {loading ? <p>Carregando notificações...</p> : items.length === 0 && !error ? <p>Nenhuma notificação no momento.</p> : null}
          {unread.length > 0 ? <button type="button" className="secondary-button" disabled={saving} onClick={() => markRead(unread.map((item) => item.id))}>Marcar todas como lidas</button> : null}
          <div className="notification-list">
            {items.map((item) => (
              <button type="button" className={`notification-item${item.read ? '' : ' unread'}`} key={item.id} disabled={saving} onClick={() => visit(item)}>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
                <small>{new Date(item.createdAt).toLocaleString('pt-BR')}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

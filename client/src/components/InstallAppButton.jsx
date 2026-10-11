import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Smartphone } from 'lucide-react';
import { Modal } from './Modal.jsx';

let installPrompt = null;
let installationError = '';
const listeners = new Set();
function notify() { listeners.forEach((listener) => listener()); }

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  notify();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  notify();
});

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch((error) => {
    console.error('App installation setup failed.', error);
    installationError = 'Não foi possível preparar a instalação. Recarregue a página e tente novamente.';
    notify();
  });
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function InstallAppButton({ onOpen }) {
  const prompt = useSyncExternalStore(subscribe, () => installPrompt);
  const setupError = useSyncExternalStore(subscribe, () => installationError);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [installed, setInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const update = () => setInstalled(media.matches || navigator.standalone === true);
    const complete = () => { setInstalled(true); setOpen(false); };
    media.addEventListener('change', update);
    window.addEventListener('appinstalled', complete);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('appinstalled', complete);
    };
  }, []);

  async function install() {
    if (busy) return;
    onOpen();
    setError('');
    if (!prompt) {
      setOpen(true);
      return;
    }
    setBusy(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setOpen(false);
    } catch (err) {
      console.error('App installation failed.', err);
      setError('Não foi possível abrir a instalação. Use as instruções abaixo ou tente novamente.');
      setOpen(true);
    } finally {
      if (installPrompt === prompt) installPrompt = null;
      notify();
      setBusy(false);
    }
  }

  if (installed) return null;

  return (
    <>
      <button className="install-app-button" type="button" onClick={install} disabled={busy}>
        <Smartphone size={18} />
        <span>{busy ? 'Abrindo instalação...' : 'Adicionar à tela inicial'}</span>
      </button>
      {createPortal(<Modal title="Adicionar à tela inicial" open={open} onClose={() => setOpen(false)}>
        <div className="form-stack install-app-help">
          <img className="install-app-icon" src="/icones/app-192.png" alt="Ícone Athlon Coach" />
          {error || setupError ? <div className="alert alert-error">{error || setupError}</div> : null}
          <p>Tenha um ícone do Athlon Coach na tela inicial para abrir a plataforma rapidamente.</p>
          <p><strong>Android (Chrome):</strong> abra o menu de três pontos e escolha <strong>Adicionar à tela inicial</strong> ou <strong>Instalar aplicativo</strong>.</p>
          <p><strong>iPhone/iPad (Safari):</strong> toque em <strong>Compartilhar</strong>, depois em <strong>Adicionar à Tela de Início</strong> e confirme em <strong>Adicionar</strong>.</p>
          <p className="muted">Se estiver no navegador do WhatsApp ou Instagram, abra o link no Chrome ou Safari. No computador, use a opção de instalar no menu do navegador. A disponibilidade depende do navegador; a plataforma precisa de internet e HTTPS.</p>
        </div>
      </Modal>, document.body)}
    </>
  );
}

import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from '../api/client.js';

const MAX_GIF_SIZE = 10 * 1024 * 1024;

export function GifLibraryUpload({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    api('/gif-library/filters').then((data) => setGroups(data.muscleGroups)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function selectFile(event) {
    const selected = event.target.files?.[0];
    setError(''); setSuccess(''); setFile(null);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.gif') || (selected.type && selected.type !== 'image/gif')) {
      setError('Selecione um arquivo GIF.'); event.target.value = ''; return;
    }
    if (selected.size > MAX_GIF_SIZE) {
      setError('O GIF deve ter no máximo 10 MB.'); event.target.value = ''; return;
    }
    setFile(selected);
  }

  async function submit(event) {
    event.preventDefault();
    if (uploading) return;
    setError(''); setSuccess('');
    if (!file) { setError('Selecione um arquivo GIF de até 10 MB.'); return; }
    const form = event.currentTarget;
    const body = new FormData(form);
    body.set('gif', file);
    setUploading(true);
    try {
      await api('/gif-library/upload', { method: 'POST', body });
      setSuccess('GIF adicionado à biblioteca com sucesso.');
      onUploaded({ gender: body.get('gender'), environment: body.get('environment') });
      form.reset(); setFile(null);
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  }

  return (
    <section className="panel">
      <h2>Enviar GIF para a biblioteca</h2>
      <p>Cadastre a animação e os dados do exercício. Limite de 10 MB por GIF.</p>
      {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
      {success ? <div className="alert alert-success" role="status">{success}</div> : null}
      <form className="form-stack" onSubmit={submit}>
        <fieldset className="gif-upload-fields" disabled={uploading}>
          <div className="form-grid">
            <label>Nome do exercício<input name="name" required minLength={2} maxLength={200} placeholder="Ex.: Agachamento com halteres" /></label>
            <label>Grupo muscular<input name="muscleGroup" list="gif-upload-muscle-groups" required minLength={2} maxLength={100} placeholder="Ex.: Quadril" /></label>
            <datalist id="gif-upload-muscle-groups">{groups.map((group) => <option key={group} value={group} />)}</datalist>
            <label>Gênero<select name="gender" defaultValue="FEMININO"><option value="FEMININO">Feminino</option><option value="MASCULINO">Masculino</option></select></label>
            <label>Ambiente<select name="environment" defaultValue="ACADEMIA"><option value="ACADEMIA">Academia</option><option value="FUNCIONAL">Funcional</option></select></label>
            <label>Arquivo GIF — até 10 MB<input name="gif" type="file" accept="image/gif,.gif" required onChange={selectFile} /></label>
          </div>
          {preview ? <div className="gif-upload-preview"><img src={preview} alt="Prévia do GIF selecionado" /><span>{file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MB</span></div> : null}
          <div className="actions"><button className="primary-button" type="submit" disabled={uploading || !file}><Upload size={16} />{uploading ? 'Enviando...' : 'Enviar GIF'}</button></div>
        </fieldset>
      </form>
    </section>
  );
}

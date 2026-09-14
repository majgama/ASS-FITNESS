import { useState } from 'react';
import { Save } from 'lucide-react';
import { api, fileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { roleLabel } from './pageHelpers.js';

export function Profile() {
  const { user, updateUser } = useAuth();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function updateProfile(event) {
    event.preventDefault();
    setNotice('');
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await api('/profile/me', { method: 'PATCH', body: form });
      updateUser(data.user);
      setNotice('Perfil atualizado.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function updatePassword(event) {
    event.preventDefault();
    setNotice('');
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api('/profile/me/password', {
        method: 'POST',
        body: {
          currentPassword: form.get('currentPassword'),
          newPassword: form.get('newPassword')
        }
      });
      event.currentTarget.reset();
      setNotice('Senha alterada.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span>Perfil</span>
          <h1>{user.name}</h1>
        </div>
      </div>

      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="two-column">
        <section className="panel">
          <div className="profile-summary">
            <div className="avatar">
              {user.profilePhotoPath ? <img src={fileUrl(user.profilePhotoPath)} alt={user.name} /> : user.name?.slice(0, 2)}
            </div>
            <div>
              <strong>{roleLabel(user.role)}</strong>
              <span>{user.email}</span>
              {user.inviteCode ? <span>Codigo: {user.inviteCode}</span> : null}
            </div>
          </div>

          <form className="form-stack" onSubmit={updateProfile}>
            <label>Nome<input name="name" defaultValue={user.name} required /></label>
            <label>Data de nascimento<input name="dateOfBirth" type="date" defaultValue={user.dateOfBirth?.slice(0, 10) || ''} /></label>
            <label>Foto<input name="photo" type="file" accept="image/*" /></label>
            {user.role === 'personal' ? (
              <>
                <label>CREF<input name="cref" defaultValue={user.cref || ''} /></label>
                <label>Especialidade<input name="specialty" defaultValue={user.specialty || ''} /></label>
              </>
            ) : null}
            {user.role === 'student' ? (
              <>
                <label>Objetivo<input name="objective" defaultValue={user.objective || ''} /></label>
                <label>Proxima avaliacao<input name="nextAssessmentDate" type="date" defaultValue={user.nextAssessmentDate?.slice(0, 10) || ''} /></label>
                <label>Restricoes<textarea name="restrictions" defaultValue={user.restrictions || ''} rows="3" /></label>
              </>
            ) : null}
            <button className="primary-button fit-button" type="submit"><Save size={18} />Salvar</button>
          </form>
        </section>

        <section className="panel">
          <div className="section-title"><h2>Senha</h2></div>
          <form className="form-stack" onSubmit={updatePassword}>
            <label>Senha atual<input name="currentPassword" type="password" required /></label>
            <label>Nova senha<input name="newPassword" type="password" minLength="8" required /></label>
            <button className="secondary-button" type="submit">Alterar senha</button>
          </form>
        </section>
      </div>
    </section>
  );
}

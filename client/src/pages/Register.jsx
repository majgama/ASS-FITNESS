import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export function Register() {
  const { inviteCode } = useParams();
  const navigate = useNavigate();
  const { register } = useAuth();
  const [invitation, setInvitation] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(inviteCode));
  const isStudent = Boolean(inviteCode);

  useEffect(() => {
    if (!inviteCode) return;
    let alive = true;
    api(`/invitations/${inviteCode}`)
      .then((data) => {
        if (alive) setInvitation(data.invitation);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [inviteCode]);

  const fixedEmail = useMemo(() => invitation?.email || '', [invitation]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await register({
        name: form.get('name'),
        email: fixedEmail || form.get('email'),
        password: form.get('password'),
        role: isStudent ? 'student' : 'personal',
        inviteCode,
        dateOfBirth: form.get('dateOfBirth') || null,
        cref: form.get('cref') || null,
        specialty: form.get('specialty') || null,
        objective: form.get('objective') || null,
        restrictions: form.get('restrictions') || null
      });
      navigate('/login');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel auth-panel-wide auth-register-panel">
        <div className="auth-visual auth-visual-register">
          <img src="/logo/athlon-shield-black.svg" alt="Athlon Coach" />
          <p>PESSOAS REAIS.<br />OBJETIVOS REAIS.<br />RESULTADOS REAIS.</p>
        </div>
        <form className="form-stack auth-form-panel" onSubmit={handleSubmit}>
          <img className="auth-logo" src="/logo/athlon-horizontal.svg" alt="Athlon Coach" />
          <h1>{isStudent ? 'Cadastro de aluno' : 'Cadastro de personal'}</h1>
          <p className="auth-subtitle">Preencha seus dados e faca parte da sua nova forma de evoluir.</p>
          {loading ? <div className="alert">Carregando convite...</div> : null}
          {invitation ? <div className="alert">Personal: {invitation.trainerName}</div> : null}
          {error ? <div className="alert alert-error">{error}</div> : null}

          <div className="form-grid">
            <label>
              Nome
              <input name="name" required minLength="2" />
            </label>
            <label>
              E-mail
              <input name="email" type="email" required disabled={isStudent} defaultValue={fixedEmail} />
            </label>
            <label>
              Senha
              <input name="password" type="password" required minLength="8" />
            </label>
            <label>
              Data de nascimento
              <input name="dateOfBirth" type="date" />
            </label>
            {!isStudent ? (
              <>
                <label>
                  CREF
                  <input name="cref" />
                </label>
                <label>
                  Especialidade
                  <input name="specialty" />
                </label>
              </>
            ) : (
              <>
                <label>
                  Objetivo
                  <input name="objective" />
                </label>
                <label>
                  Restricoes
                  <input name="restrictions" />
                </label>
              </>
            )}
          </div>

          <button className="primary-button" type="submit">Cadastrar</button>
          <Link className="text-link" to="/login">Voltar para login</Link>
        </form>
      </section>
    </main>
  );
}

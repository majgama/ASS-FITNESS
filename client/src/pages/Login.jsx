import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      await login(form.get('email'), form.get('password'));
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel auth-login-panel">
        <div className="auth-visual auth-visual-login">
          <img src="/logo/athlon-shield.png" alt="Athlon Coach" />
          <p>DISCIPLINA<br />GERA RESULTADOS<br />REAIS.</p>
          <span>Mais que treino.<br />Evolucao.</span>
        </div>
        <div className="auth-form-panel">
          <img className="auth-logo" src="/logo/athlon-horizontal.png" alt="Athlon Coach" />

          <form className="form-stack" onSubmit={handleSubmit}>
          <h1>Entrar</h1>
          <p className="auth-subtitle">Acesse sua conta e continue evoluindo.</p>
          {error ? <div className="alert alert-error">{error}</div> : null}
          <label>
            E-mail
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <label>
            Senha
            <input type="password" name="password" required autoComplete="current-password" />
          </label>
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
          <Link className="text-link" to="/register">Criar conta de personal</Link>
          </form>
        </div>
      </section>
    </main>
  );
}

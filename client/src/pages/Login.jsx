import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dumbbell } from 'lucide-react';
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
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="brand-mark">
            <Dumbbell size={24} />
          </div>
          <div>
            <strong>ASS Fitness</strong>
            <span>Gestao fitness</span>
          </div>
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <h1>Entrar</h1>
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
      </section>
    </main>
  );
}

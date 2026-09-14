import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity,
  Apple,
  BarChart3,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  User,
  Users,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const navByRole = {
  admin: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/alunos', label: 'Alunos', icon: Users },
    { to: '/treinos', label: 'Treinos', icon: Dumbbell },
    { to: '/dietas', label: 'Dietas', icon: Apple },
    { to: '/avaliacoes', label: 'Avaliacoes', icon: BarChart3 },
    { to: '/administracao', label: 'Administracao', icon: Shield },
    { to: '/perfil', label: 'Perfil', icon: User }
  ],
  personal: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/alunos', label: 'Alunos', icon: Users },
    { to: '/treinos', label: 'Treinos', icon: Dumbbell },
    { to: '/dietas', label: 'Dietas', icon: Apple },
    { to: '/avaliacoes', label: 'Avaliacoes', icon: BarChart3 },
    { to: '/perfil', label: 'Perfil', icon: User }
  ],
  student: [
    { to: '/', label: 'Meu treino', icon: Activity },
    { to: '/avaliacoes', label: 'Avaliacoes', icon: BarChart3 },
    { to: '/dietas', label: 'Dieta', icon: Apple },
    { to: '/perfil', label: 'Perfil', icon: User }
  ]
};

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigation = navByRole[user?.role] || [];

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className={`app-shell app-shell-${user?.role || 'guest'}`}>
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <img className="brand-logo" src="/logo/athlon-horizontal.png" alt="Athlon Coach" />
          <div>
            <span>{user?.role === 'student' ? 'Aluno' : user?.role === 'admin' ? 'Admin' : 'Personal trainer'}</span>
          </div>
          <button className="icon-button only-mobile" type="button" onClick={() => setMenuOpen(false)} aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>

        <nav className="nav-list">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} onClick={() => setMenuOpen(false)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <button className="logout-button" type="button" onClick={handleLogout}>
          <LogOut size={18} />
          <span>Sair</span>
        </button>
      </aside>

      <main className="shell-main">
        <header className="topbar">
          <button className="icon-button only-mobile" type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu">
            <Menu size={20} />
          </button>
          <div className="topbar-user">
            <span>Organize. Evolua. Transforme.</span>
            <strong>{user?.name}</strong>
          </div>
        </header>
        <Outlet />
        {user?.role === 'student' ? (
          <nav className="mobile-bottom-nav" aria-label="Navegação principal">
            {navigation.slice(0, 4).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        ) : null}
      </main>
    </div>
  );
}

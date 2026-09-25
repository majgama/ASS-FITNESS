import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.jsx';
import { Loading } from './components/Loading.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { Admin } from './pages/Admin.jsx';
import { Assessments } from './pages/Assessments.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Diets } from './pages/Diets.jsx';
import { GifLibraryAdmin } from './pages/GifLibraryAdmin.jsx';
import { GifLibrarySelection } from './pages/GifLibrarySelection.jsx';
import { Login } from './pages/Login.jsx';
import { Profile } from './pages/Profile.jsx';
import { Register } from './pages/Register.jsx';
import { StudentPortal } from './pages/StudentPortal.jsx';
import { StudentManagement } from './pages/StudentManagement.jsx';
import { Students } from './pages/Students.jsx';
import { Workouts } from './pages/Workouts.jsx';

function ProtectedRoute() {
  const { isAuthenticated, booting } = useAuth();
  if (booting) return <Loading label="Abrindo app" />;
  return isAuthenticated ? <AppShell /> : <Navigate to="/login" replace />;
}

function HomeByRole() {
  const { user } = useAuth();
  if (user?.role === 'student') return <StudentPortal />;
  if (user?.role === 'personal') return <Navigate to="/alunos" replace />;
  return <Dashboard />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register/:inviteCode?" element={<Register />} />
      <Route element={<ProtectedRoute />}>
        <Route index element={<HomeByRole />} />
        <Route path="/alunos" element={<Students />} />
        <Route path="/alunos/:studentId" element={<StudentManagement />} />
        <Route path="/treinos" element={<Workouts />} />
        <Route path="/treinos/biblioteca-gifs" element={<GifLibrarySelection />} />
        <Route path="/dietas" element={<Diets />} />
        <Route path="/avaliacoes" element={<Assessments />} />
        <Route path="/administracao" element={<Admin />} />
        <Route path="/administracao/animacoes" element={<GifLibraryAdmin />} />
        <Route path="/perfil" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

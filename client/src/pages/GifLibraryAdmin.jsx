import { Navigate } from 'react-router-dom';
import { GifLibraryPicker } from '../components/GifLibraryPicker.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function GifLibraryAdmin() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <section className="page gif-library-admin-page">
      <div className="page-heading">
        <div>
          <span>Administração</span>
          <h1>Nomes dos exercícios</h1>
        </div>
      </div>
      <GifLibraryPicker managementMode pageSize={200} />
    </section>
  );
}
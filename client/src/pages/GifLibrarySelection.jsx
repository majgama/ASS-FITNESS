import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { GifLibraryPicker } from '../components/GifLibraryPicker.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function GifLibrarySelection() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (user?.role === 'student') return <Navigate to="/" replace />;

  function selectGif(item) {
    navigate('/treinos', {
      replace: true,
      state: { selectedLibraryGif: item }
    });
  }

  return (
    <section className="page gif-library-selection-page">
      <div className="page-heading">
        <div>
          <span>Gestão de treinos</span>
          <h1>Biblioteca de animações</h1>
        </div>
      </div>
      <GifLibraryPicker
        onSelect={selectGif}
        onClose={() => navigate('/treinos')}
        initialFavoritesOnly={Boolean(location.state?.favoritesOnly)}
        initialGender="MASCULINO"
        initialEnvironment="ACADEMIA"
        pageSize={20}
        fullPage
        showMuscleGroups
      />
    </section>
  );
}
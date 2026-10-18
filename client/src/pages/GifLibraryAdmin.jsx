import { useState } from 'react';
import { GifLibraryUpload } from '../components/GifLibraryUpload.jsx';
import { Navigate } from 'react-router-dom';
import { GifLibraryPicker } from '../components/GifLibraryPicker.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function GifLibraryAdmin() {
  const { user } = useAuth();
  const [library, setLibrary] = useState({ version: 0, gender: 'FEMININO', environment: 'ACADEMIA' });
  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <section className="page gif-library-admin-page">
      <div className="page-heading">
        <div>
          <span>Administração</span>
          <h1>Nomes dos exercícios</h1>
        </div>
      </div>
      <GifLibraryUpload onUploaded={(scope) => setLibrary((current) => ({ ...scope, version: current.version + 1 }))} />
      <GifLibraryPicker key={library.version} managementMode pageSize={200} initialGender={library.gender} initialEnvironment={library.environment} />
    </section>
  );
}
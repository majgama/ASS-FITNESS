import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, getAuthToken, setAuthToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let alive = true;
    async function loadMe() {
      if (!getAuthToken()) {
        setBooting(false);
        return;
      }

      try {
        const data = await api('/auth/me');
        if (alive) setUser(data.user);
      } catch (error) {
        setAuthToken(null);
      } finally {
        if (alive) setBooting(false);
      }
    }
    loadMe();
    return () => {
      alive = false;
    };
  }, []);

  async function login(email, password) {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    setAuthToken(data.token);
    setUser(data.user);
    return data.user;
  }

  async function register(payload) {
    return api('/auth/register', { method: 'POST', body: payload });
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setAuthToken(null);
      setUser(null);
    }
  }

  function updateUser(nextUser) {
    setUser(nextUser);
  }

  const value = useMemo(() => ({
    user,
    booting,
    isAuthenticated: Boolean(user),
    login,
    register,
    logout,
    updateUser
  }), [user, booting]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, jobsMasterAuth, timesheetAuth, shearersAuth } from '../firebase-config';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async (email, password) => {
    // Sign in to primary auth first
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // Sign in to all other Firebase projects in parallel
    await Promise.allSettled([
      signInWithEmailAndPassword(jobsMasterAuth, email, password),
      signInWithEmailAndPassword(timesheetAuth, email, password),
      signInWithEmailAndPassword(shearersAuth, email, password),
    ]);
    return cred;
  };

  const logout = async () => {
    await Promise.allSettled([
      signOut(auth),
      signOut(jobsMasterAuth),
      signOut(timesheetAuth),
      signOut(shearersAuth),
    ]);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

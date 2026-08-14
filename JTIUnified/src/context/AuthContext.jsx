import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { recordFailure, recordSuccess } from '../utils/dataHealth';
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

    // The other three projects, in parallel. allSettled is right — failing to
    // reach the Shearers project must not stop you using the rest of the
    // dashboard — but it USED to swallow the result entirely. Firebase Auth is
    // per project, so a sign-in that did not take means that project's data
    // comes back empty, which looked exactly like having no data.
    const others = [
      ['jobs and packets', jobsMasterAuth],
      ['timesheets', timesheetAuth],
      ['Shearers downtime', shearersAuth],
    ];
    const results = await Promise.allSettled(
      others.map(([, a]) => signInWithEmailAndPassword(a, email, password)));

    results.forEach((r, i) => {
      const [name] = others[i];
      if (r.status === 'rejected') recordFailure(`sign-in to ${name}`, r.reason);
      else recordSuccess(`sign-in to ${name}`);
    });

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

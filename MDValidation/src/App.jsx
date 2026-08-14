import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import LoginScreen from './LoginScreen';
import Chooser from './Chooser';
import FormShell from './FormShell';
import { FORMS } from './defs';

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [type, setType] = useState(null);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); }), []);

  if (authLoading) return <div className="splash">Loading…</div>;
  if (!user) return <LoginScreen />;
  if (!type) return <Chooser user={user} onPick={setType} />;
  return <FormShell user={user} def={FORMS[type]} onHome={() => setType(null)} />;
}

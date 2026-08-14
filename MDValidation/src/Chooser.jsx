import { signOut } from 'firebase/auth';
import { auth } from './firebase';
import { FORM_LIST } from './defs';

export default function Chooser({ user, onPick }) {
  return (
    <div className="chooser">
      <header className="topbar">
        <div className="title">JTI Validation Forms</div>
        <div className="actions">
          <button className="btn ghost" onClick={() => signOut(auth)} title={user.email}>Logout</button>
        </div>
      </header>
      <div className="choosebody">
        <h2>Choose a validation type</h2>
        <div className="choosergrid">
          {FORM_LIST.map((f) => (
            <button
              key={f.key}
              className={`choosecard ${f.comingSoon ? 'soon' : ''}`}
              disabled={f.comingSoon}
              onClick={() => !f.comingSoon && onPick(f.key)}
            >
              <div className="ccicon">{f.icon}</div>
              <div className="cctitle">{f.short}</div>
              <div className="ccsub">{f.comingSoon ? 'Coming soon' : 'Validation Form'}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

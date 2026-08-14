// Shared presentational form components (module scope = stable identity, keeps input focus).

export function Bar({ children }) {
  return <div className="bar">{children}</div>;
}

export function Text({ label, value, onChange, w }) {
  return (
    <label className="fld" style={w ? { flex: `1 1 ${w}` } : undefined}>
      <span>{label}</span>
      <input type="text" value={value || ''} onChange={onChange} />
    </label>
  );
}

export function Check({ label, checked, onClick }) {
  return (
    <button type="button" className={`chk ${checked ? 'on' : ''}`} onClick={onClick}>
      <span className="box">{checked ? '✓' : ''}</span>{label}
    </button>
  );
}

export function YesNo({ label, value, onPick }) {
  return (
    <div className="checks">
      <span className="inlbl">{label}:</span>
      <Check label="Yes" checked={value === 'Yes'} onClick={() => onPick(value === 'Yes' ? '' : 'Yes')} />
      <Check label="No" checked={value === 'No'} onClick={() => onPick(value === 'No' ? '' : 'No')} />
    </div>
  );
}

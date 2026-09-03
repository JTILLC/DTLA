import React, { useCallback, useEffect, useMemo, useState } from 'react';
import spec from './data/rcuFields.json';
import MappedScreen, { mappedRows } from './components/MappedScreen';
import PhotoScreen from './components/PhotoScreen';
import ImportExports from './components/ImportExports';
import SignIn, { readerHint } from './components/SignIn';
import Compare from './components/Compare';
import {
  emptyCenterline, mappedSection, photoSection, settingsTable, gaps, copyFrom,
} from './utils/centerline';
import { loadImage, renderScreen } from './utils/overlay';
import { buildCenterlinePdf, buildSettingsListPdf, centerlineFileName } from './utils/pdf';
import { toCsv, toText, listFileName, downloadText } from './utils/settingsList';
import {
  listCenterlines, saveCenterline, deleteCenterline, readDraft, writeDraft,
} from './utils/storage';
import { readerAvailable } from './utils/scan';
import { watchAuth, getIdToken, readerPermission } from './config/firebase';

const HEADER_FIELDS = [
  ['customer', 'Customer'], ['plant', 'Plant'], ['machine', 'Machine'],
  ['line', 'Line'], ['product', 'Product'], ['presetNo', 'Preset no.'],
  ['engineer', 'Set by'], ['date', 'Date'],
];

/** One row of the export menu. Hoisted: a component declared inside a render
 *  is a new type on every keystroke, which remounts it and loses focus. */
function ExportChoice({ title, detail, onClick, disabled }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="w-full text-left px-3 py-2 rounded"
      style={{ opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
        background: 'transparent', border: 'none', color: 'var(--text)' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>{detail}</span>
    </button>
  );
}

export default function App() {
  // The draft is seeded before anything renders, so a reload never lands on an
  // empty sheet with work sitting in storage.
  const [centerline, setCenterline] = useState(() => readDraft() || emptyCenterline());
  const [library, setLibrary] = useState(() => listCenterlines());
  const [healthy, setHealthy] = useState(false);
  const [user, setUser] = useState(null);
  const [permission, setPermission] = useState(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [busy, setBusy] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!writeDraft(centerline)) setStorageWarning(true);
  }, [centerline]);

  useEffect(() => { readerAvailable().then(setHealthy); }, []);

  // The claim check runs on the token, not on the email: an account can exist
  // and still not be provisioned for the reader, and finding that out here is
  // far better than finding it out as a 403 with a photo already taken.
  useEffect(() => watchAuth((next) => {
    setUser(next);
    if (!next) { setPermission(null); return; }
    readerPermission().then(setPermission);
  }), []);

  // The reader needs all three: the route configured, somebody signed in, and
  // that somebody allowed to spend a call.
  const readerReady = healthy && !!user && permission?.allowed === true;
  const hint = readerHint({ healthy, user, permission });

  const patch = (changes) => setCenterline((c) => ({ ...c, ...changes }));

  const setSection = (index, section) =>
    setCenterline((c) => ({
      ...c, sections: c.sections.map((s, i) => (i === index ? section : s)),
    }));

  const removeSection = (index) =>
    setCenterline((c) => ({ ...c, sections: c.sections.filter((_, i) => i !== index) }));

  const addMapped = (slug) =>
    setCenterline((c) => (c.sections.some((s) => s.slug === slug)
      ? c
      : { ...c, sections: [...c.sections, mappedSection(slug)] }));

  const addPhoto = () =>
    setCenterline((c) => ({ ...c, sections: [...c.sections, photoSection('', '', [])] }));

  /** Place one imported value, adding its screen to the document if needed. */
  const placeImported = useCallback((slug, key, value) => {
    setCenterline((c) => {
      const sections = [...c.sections];
      let index = sections.findIndex((s) => s.kind === 'mapped' && s.slug === slug);
      if (index === -1) {
        sections.push(mappedSection(slug, {}, 'imported'));
        index = sections.length - 1;
      }
      const section = sections[index];
      sections[index] = {
        ...section,
        values: { ...section.values, [key]: value },
        source: 'imported',
      };
      return { ...c, sections };
    });
  }, []);

  /** Add a whole imported block; a re-import of the same block replaces it. */
  const addImportedBlock = useCallback((section) => {
    setCenterline((c) => {
      const index = c.sections.findIndex((s) => s.kind === 'photo' && !s.image
        && s.source === 'imported' && s.title === section.title);
      const sections = [...c.sections];
      if (index === -1) sections.push(section);
      else sections[index] = section;
      return { ...c, sections };
    });
  }, []);

  const rows = useMemo(() => settingsTable(centerline, spec), [centerline]);
  const gapList = useMemo(() => gaps(centerline, spec), [centerline]);

  const unusedScreens = Object.entries(spec.screens)
    .filter(([slug]) => !centerline.sections.some((s) => s.slug === slug));

  const exportPdf = async () => {
    setBusy('Building the document…');
    try {
      const pages = [];
      for (const section of centerline.sections) {
        if (section.kind === 'mapped') {
          const screen = spec.screens[section.slug];
          if (!screen) continue;
          const img = await loadImage(
            `${import.meta.env.BASE_URL}screens/${section.slug}.jpg`,
          );
          const { canvas } = renderScreen(img, screen.fields, section.values);
          pages.push({
            title: screen.title,
            manual: screen.manual,
            image: canvas.toDataURL('image/jpeg', 0.92),
            imageWidth: canvas.width,
            imageHeight: canvas.height,
            rows: mappedRows(screen, section.values),
          });
        } else if (section.image || section.fields?.length) {
          // A photographed screen, or a plain list (an imported block, or one
          // typed in with no photo to hand).
          pages.push({
            title: section.title || (section.image ? 'Photographed screen' : 'Settings'),
            manual: '',
            image: section.image || '',
            imageWidth: 1024,
            imageHeight: 768,
            rows: (section.fields || [])
              .filter((f) => f.label && f.value)
              .map((f) => ({ label: f.label, value: f.value })),
          });
        }
      }
      const doc = buildCenterlinePdf(centerline, pages, rows, gapList);
      doc.save(centerlineFileName(centerline));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('centerline pdf failed', err);
      setBusy('');
      alert('Could not build the document. Nothing was lost — try again.');
      return;
    }
    setBusy('');
  };

  // The plain list, in the three shapes it is actually wanted in: a page to
  // hand over, a spreadsheet to compare against next month's, and text to paste
  // into an email. All three come off the same rows as the full document, so
  // they cannot drift from it.
  const exportListPdf = () => {
    setExportOpen(false);
    const doc = buildSettingsListPdf(centerline, rows);
    doc.save(listFileName(centerline, 'pdf'));
  };

  const exportCsv = () => {
    setExportOpen(false);
    downloadText(toCsv(centerline, rows), listFileName(centerline, 'csv'));
  };

  const copyList = async () => {
    setExportOpen(false);
    try {
      await navigator.clipboard.writeText(toText(centerline, rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access needs a secure context and can be refused outright;
      // falling back to a file beats a button that silently does nothing.
      downloadText(toText(centerline, rows), listFileName(centerline, 'txt'), 'text/plain');
    }
  };

  const save = () => {
    if (saveCenterline(centerline)) setLibrary(listCenterlines());
    else setStorageWarning(true);
  };

  return (
    <div className="min-h-full">
      {/* Never conditional. A page of RCU screens showing values is
          indistinguishable from a capture of a running machine, so what this
          document is has to be stated everywhere it appears. */}
      <div className="spec-mark px-4 py-1.5 text-[11px] font-semibold uppercase">
        Centerline — target settings · not a record of current running values
      </div>

      <header
        className="px-4 py-3 flex flex-wrap items-center gap-2 justify-between"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}
      >
        <h1 className="font-semibold">CCW Centerline</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SignIn user={user} permission={permission} open={signInOpen} onOpen={setSignInOpen} />
          <button type="button" className="btn" onClick={() => setShowLibrary((v) => !v)}>
            Saved ({library.length})
          </button>
          <button type="button" className="btn" onClick={() => setShowCompare((v) => !v)}>
            Compare
          </button>
          <button type="button" className="btn" onClick={save}>Save</button>
          <button
            type="button" className="btn"
            onClick={() => setCenterline(emptyCenterline())}
          >
            New
          </button>
          <div className="relative">
            <button
              type="button" className="btn btn-primary"
              onClick={() => setExportOpen((v) => !v)}
              disabled={!!busy || !centerline.sections.length}
            >
              {busy || (copied ? 'Copied' : 'Export ▾')}
            </button>
            {exportOpen && (
              <div
                className="card absolute right-0 mt-1 z-10 p-1"
                style={{ width: '19rem', boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}
              >
                <ExportChoice
                  title="Full centerline (PDF)"
                  detail="Every screen as the operator sees it, then all settings."
                  onClick={() => { setExportOpen(false); exportPdf(); }}
                />
                <ExportChoice
                  title="Settings list (PDF)"
                  detail="Just the setting and its value, no screens."
                  onClick={exportListPdf}
                  disabled={!rows.length}
                />
                <ExportChoice
                  title="Settings list (CSV)"
                  detail="Opens in Excel. For comparing against a later one."
                  onClick={exportCsv}
                  disabled={!rows.length}
                />
                <ExportChoice
                  title="Copy as text"
                  detail="For pasting into an email."
                  onClick={copyList}
                  disabled={!rows.length}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="p-4 max-w-6xl mx-auto">
        {storageWarning && (
          <p
            className="card p-3 mb-4 text-sm"
            style={{ borderColor: 'var(--warn)', background: 'var(--warn-bg)', color: 'var(--warn)' }}
          >
            This device is out of storage, so the centerline is not being saved
            automatically. Export the PDF before you close the tab.
          </p>
        )}

        {showCompare && (
          <Compare
            library={library}
            current={centerline}
            onClose={() => setShowCompare(false)}
          />
        )}

        {showLibrary && (
          <section className="card p-4 mb-4">
            <h3 className="font-semibold mb-2">Saved centerlines</h3>
            {!library.length && (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nothing saved yet.</p>
            )}
            {library.map((item) => (
              <div key={item.id} className="flex items-center gap-2 py-1 text-sm">
                <span className="grow">
                  {[item.customer, item.product, item.date].filter(Boolean).join(' · ') || 'Untitled'}
                </span>
                <button type="button" className="btn" onClick={() => setCenterline(item)}>Open</button>
                <button
                  type="button" className="btn"
                  onClick={() => setCenterline(copyFrom(item))}
                  title="Start a new centerline from this one"
                >
                  Copy
                </button>
                <button
                  type="button" className="btn"
                  onClick={() => { deleteCenterline(item.id); setLibrary(listCenterlines()); }}
                >
                  Delete
                </button>
              </div>
            ))}
          </section>
        )}

        <section className="card p-4 mb-4">
          <h3 className="font-semibold mb-3">This centerline</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {HEADER_FIELDS.map(([key, label]) => (
              <div key={key}>
                <label className="field-label" htmlFor={`h-${key}`}>{label}</label>
                <input
                  id={`h-${key}`} className="field"
                  type={key === 'date' ? 'date' : 'text'}
                  value={centerline[key] || ''}
                  onChange={(e) => patch({ [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <label className="field-label" htmlFor="h-notes">Notes</label>
            <textarea
              id="h-notes" className="field" rows={2} value={centerline.notes || ''}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </div>
        </section>

        <ImportExports spec={spec} onPlace={placeImported} onAddBlock={addImportedBlock} />

        {centerline.sections.map((section, index) => (
          section.kind === 'mapped' ? (
            <MappedScreen
              key={`${section.slug}-${index}`}
              slug={section.slug}
              screen={spec.screens[section.slug]}
              values={section.values}
              onChange={(values) => setSection(index, { ...section, values })}
              onRemove={() => removeSection(index)}
            />
          ) : (
            <PhotoScreen
              key={`photo-${index}`}
              section={section}
              onChange={(next) => setSection(index, next)}
              onRemove={() => removeSection(index)}
              readerReady={readerReady}
              readerHint={hint}
              getIdToken={getIdToken}
            />
          )
        ))}

        <section className="card p-4">
          <h3 className="font-semibold mb-2">Add a screen</h3>
          <div className="flex flex-wrap gap-2">
            {unusedScreens.map(([slug, screen]) => (
              <button key={slug} type="button" className="btn" onClick={() => addMapped(slug)}>
                {screen.title}
              </button>
            ))}
            <button type="button" className="btn btn-primary" onClick={addPhoto}>
              Photograph a screen
            </button>
          </div>
          <p className="text-xs mt-3" style={{ color: 'var(--text-subtle)' }}>
            The named screens use stored artwork from a 14-head unit. For any other
            RCU — including every newer one — photograph the screen instead, and the
            document uses the customer’s own machine.
          </p>
        </section>

        {gapList.length > 0 && (
          <section className="card p-4 mt-4" style={{ borderColor: 'var(--warn)' }}>
            <h3 className="font-semibold mb-1" style={{ color: 'var(--warn)' }}>
              Not recorded yet
            </h3>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              These print on the front page of the document, so a blank is never read
              as “set it to nothing”.
            </p>
            {gapList.map((gap) => (
              <p key={gap.screen} className="text-sm">
                <strong>{gap.screen}:</strong> {gap.missing.join(', ')}
              </p>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

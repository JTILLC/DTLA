import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, orderBy, query, runTransaction,
} from 'firebase/firestore';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import {
  Boxes, Cpu, Tag, Users, Plus, Search, Trash2, Pencil, Copy, LogOut, Moon, Sun, AlertTriangle,
} from 'lucide-react';

import { auth, db, storage } from './config/firebase';
import { ToastProvider, useToast } from './components/Toast';
import LoginScreen from './components/LoginScreen';
import PartFormModal from './components/PartFormModal';
import BoardFormModal, { BOARD_STATUSES } from './components/BoardFormModal';
import ImageLightbox from './components/ImageLightbox';

const TABS = [
  { key: 'parts',      label: 'Parts',      icon: Boxes },
  { key: 'boards',     label: 'Boards',     icon: Cpu },
  { key: 'categories', label: 'Categories', icon: Tag },
  { key: 'customers',  label: 'Customers',  icon: Users },
];

function AppShell() {
  const toast = useToast();

  // --- Auth ---
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // --- Theme ---
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('jti-inventory-theme');
    return saved ? saved === 'dark' : true;
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('jti-inventory-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // --- UI state ---
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('jti-inventory-tab') || 'parts');
  useEffect(() => { localStorage.setItem('jti-inventory-tab', activeTab); }, [activeTab]);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingPart, setEditingPart] = useState(null);   // null → closed, {} → add, {id,…} → edit
  const [editingBoard, setEditingBoard] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState(null);

  // --- Firestore collections (per-user) ---
  const userRoot = user ? `user_files/${user.uid}` : null;

  const [parts, setParts] = useState([]);
  const [boards, setBoards] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [partsLoaded, setPartsLoaded] = useState(false);
  const [boardsLoaded, setBoardsLoaded] = useState(false);

  useEffect(() => {
    if (!userRoot) { setParts([]); setPartsLoaded(false); return; }
    const q = query(collection(db, `${userRoot}/parts`), orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      setParts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPartsLoaded(true);
    });
    return () => unsub();
  }, [userRoot]);

  useEffect(() => {
    if (!userRoot) { setBoards([]); setBoardsLoaded(false); return; }
    const q = query(collection(db, `${userRoot}/boards`), orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      setBoards(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setBoardsLoaded(true);
    });
    return () => unsub();
  }, [userRoot]);

  useEffect(() => {
    if (!userRoot) { setCategories([]); return; }
    const q = query(collection(db, `${userRoot}/categories`), orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [userRoot]);

  useEffect(() => {
    if (!userRoot) { setCustomers([]); return; }
    const q = query(collection(db, `${userRoot}/inventory_customers`), orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [userRoot]);

  // --- CRUD helpers ---
  const createCategory = async (name) => {
    if (!userRoot) return;
    const exists = categories.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (exists) return;
    await addDoc(collection(db, `${userRoot}/categories`), { name, createdAt: serverTimestamp() });
  };

  const createCustomer = async (name) => {
    if (!userRoot) return;
    const exists = customers.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (exists) return;
    await addDoc(collection(db, `${userRoot}/inventory_customers`), { name, createdAt: serverTimestamp() });
  };

  const deleteCustomer = async (cust) => {
    if (!userRoot) return;
    const used = [...parts, ...boards].some(i => (i.customers || []).includes(cust.name));
    if (used) {
      const ok = confirm(`"${cust.name}" is tagged on some parts/boards. Delete the customer anyway? (items keep their tag but it'll become invalid)`);
      if (!ok) return;
    } else {
      if (!confirm(`Delete customer "${cust.name}"?`)) return;
    }
    await deleteDoc(doc(db, `${userRoot}/inventory_customers`, cust.id));
    toast.success(`Deleted customer "${cust.name}".`);
  };

  const renameCustomer = async (cust, newName) => {
    if (!userRoot || !newName.trim() || newName === cust.name) return;
    const trimmed = newName.trim();
    await updateDoc(doc(db, `${userRoot}/inventory_customers`, cust.id), { name: trimmed });
    // Relabel the customer name in all parts/boards that reference it
    const affectedParts = parts.filter(p => (p.customers || []).includes(cust.name));
    const affectedBoards = boards.filter(b => (b.customers || []).includes(cust.name));
    await Promise.all([
      ...affectedParts.map(p => updateDoc(doc(db, `${userRoot}/parts`, p.id), {
        customers: p.customers.map(n => n === cust.name ? trimmed : n),
        updatedAt: serverTimestamp(),
      })),
      ...affectedBoards.map(b => updateDoc(doc(db, `${userRoot}/boards`, b.id), {
        customers: b.customers.map(n => n === cust.name ? trimmed : n),
        updatedAt: serverTimestamp(),
      })),
    ]);
    toast.success(`Renamed to "${trimmed}".`);
  };

  const savePart = async (data) => {
    if (!userRoot) return;
    const { id, ...rest } = data;
    const payload = { ...rest, updatedAt: serverTimestamp() };
    if (id) {
      await updateDoc(doc(db, `${userRoot}/parts`, id), payload);
      toast.success(`Saved "${data.name}".`);
    } else {
      await addDoc(collection(db, `${userRoot}/parts`), { ...payload, createdAt: serverTimestamp() });
      toast.success(`Added "${data.name}".`);
    }
  };

  // useCallback so memoized PartRow/BoardRow don't re-render on every keystroke
  const deletePart = useCallback(async (part) => {
    if (!userRoot) return;
    if (!confirm(`Delete "${part.name}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, `${userRoot}/parts`, part.id));
    if (part.photoPath) {
      deleteObject(storageRef(storage, part.photoPath)).catch(() => {});
    }
    toast.success(`Deleted "${part.name}".`);
  }, [userRoot]);

  // Open the Add form pre-filled with this item's data as a starting point for
  // a second copy. Id cleared so Save creates a new doc; qty + customers reset
  // so the user re-enters for the new customer. Photo refs cleared so the two
  // rows don't share a Storage file (delete of one could wipe the other).
  const duplicatePart = useCallback((part) => {
    const { id, createdAt, updatedAt, photoUrl, photoPath, ...rest } = part;
    setEditingPart({
      ...rest,
      name: `${part.name} (copy)`,
      qty: 0,
      customers: [],
      photoUrl: null,
      photoPath: null,
    });
  }, []);

  const duplicateBoard = useCallback((b) => {
    const { id, createdAt, updatedAt, photoUrl, photoPath, ...rest } = b;
    setEditingBoard({
      ...rest,
      name: `${b.name} (copy)`,
      // serial is used as Board Number here — preserved so the duplicate
      // carries the same identifier. Reassign manually if needed.
      customers: [],
      photoUrl: null,
      photoPath: null,
    });
  }, []);

  const adjustPartQty = useCallback(async (part, delta) => {
    if (!userRoot) return;
    const partRef = doc(db, `${userRoot}/parts`, part.id);
    // Transaction so rapid +/- taps don't lose updates (read current server value, not stale prop)
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(partRef);
      if (!snap.exists()) return;
      const nextQty = Math.max(0, (Number(snap.data().qty) || 0) + delta);
      tx.update(partRef, { qty: nextQty, updatedAt: serverTimestamp() });
    });
  }, [userRoot]);

  const saveBoard = async (data) => {
    if (!userRoot) return;
    const { id, ...rest } = data;
    const payload = { ...rest, updatedAt: serverTimestamp() };
    if (id) {
      await updateDoc(doc(db, `${userRoot}/boards`, id), payload);
      toast.success(`Saved "${data.name}".`);
    } else {
      await addDoc(collection(db, `${userRoot}/boards`), { ...payload, createdAt: serverTimestamp() });
      toast.success(`Added "${data.name}".`);
    }
  };

  const deleteBoard = useCallback(async (b) => {
    if (!userRoot) return;
    if (!confirm(`Delete "${b.name}"?`)) return;
    await deleteDoc(doc(db, `${userRoot}/boards`, b.id));
    if (b.photoPath) {
      deleteObject(storageRef(storage, b.photoPath)).catch(() => {});
    }
    toast.success(`Deleted "${b.name}".`);
  }, [userRoot]);

  const adjustBoardQty = useCallback(async (b, delta) => {
    if (!userRoot) return;
    const boardRef = doc(db, `${userRoot}/boards`, b.id);
    // Transaction so rapid +/- taps don't lose updates (read current server value, not stale prop)
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(boardRef);
      if (!snap.exists()) return;
      const nextQty = Math.max(0, (Number(snap.data().qty) || 0) + delta);
      tx.update(boardRef, { qty: nextQty, updatedAt: serverTimestamp() });
    });
  }, [userRoot]);

  const deleteCategory = async (cat) => {
    if (!userRoot) return;
    const used = parts.some(p => p.category === cat.name);
    if (used) {
      const ok = confirm(`"${cat.name}" is used by some parts. Delete the category anyway? (parts will become Uncategorized)`);
      if (!ok) return;
    }
    await deleteDoc(doc(db, `${userRoot}/categories`, cat.id));
    toast.success(`Deleted category "${cat.name}".`);
  };

  const renameCategory = async (cat, newName) => {
    if (!userRoot || !newName.trim() || newName === cat.name) return;
    await updateDoc(doc(db, `${userRoot}/categories`, cat.id), { name: newName.trim() });
    // Best-effort relabel of parts using the old name (client-side; fine for typical volume)
    const affected = parts.filter(p => p.category === cat.name);
    await Promise.all(affected.map(p =>
      updateDoc(doc(db, `${userRoot}/parts`, p.id), { category: newName.trim(), updatedAt: serverTimestamp() })
    ));
    toast.success(`Renamed to "${newName}".`);
  };

  // --- Filtering ---
  const term = searchTerm.trim().toLowerCase();

  const filteredParts = useMemo(() => {
    return parts.filter(p => {
      if (categoryFilter && (p.category || '') !== categoryFilter) return false;
      if (customerFilter && !(p.customers || []).includes(customerFilter)) return false;
      if (!term) return true;
      return [p.name, p.sku, p.location, p.notes, p.category, ...(p.customers || [])]
        .filter(Boolean)
        .some(s => String(s).toLowerCase().includes(term));
    });
  }, [parts, categoryFilter, customerFilter, term]);

  const filteredBoards = useMemo(() => {
    return boards.filter(b => {
      if (statusFilter && (b.status || '') !== statusFilter) return false;
      if (customerFilter && !(b.customers || []).includes(customerFilter)) return false;
      if (!term) return true;
      return [b.name, b.model, b.revision, b.serial, b.location, b.notes, ...(b.customers || [])]
        .filter(Boolean)
        .some(s => String(s).toLowerCase().includes(term));
    });
  }, [boards, statusFilter, customerFilter, term]);

  const lowStockCount = useMemo(
    () => parts.filter(p => (Number(p.minQty) || 0) > 0 && (Number(p.qty) || 0) <= Number(p.minQty)).length,
    [parts]
  );

  if (!authReady) {
    return <div className="login-wrap"><div style={{ color: 'var(--text-secondary)' }}>Loading…</div></div>;
  }
  if (!user) return <LoginScreen />;

  return (
    <div className="app-shell">
      <header className="control-bar">
        <div className="toolbar-row">
          <span className="app-brand">JTI Inventory</span>

          <div className="toolbar-search" style={{ position: 'relative' }}>
            <Search size={14} style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-secondary)', pointerEvents: 'none',
            }} />
            <input
              type="search"
              className="form-control form-control-sm"
              placeholder={`Search ${activeTab}…`}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ paddingLeft: 28 }}
            />
          </div>

          {activeTab === 'parts' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setEditingPart({})}
              title="Add part"
            >
              <Plus size={14} />
              <span className="btn-label">Add part</span>
            </button>
          )}
          {activeTab === 'boards' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setEditingBoard({})}
              title="Add board"
            >
              <Plus size={14} />
              <span className="btn-label">Add board</span>
            </button>
          )}

          <div className="ms-auto d-flex align-items-center gap-2">
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setIsDark(!isDark)}
              title={isDark ? 'Switch to light' : 'Switch to dark'}
              aria-label="Toggle theme"
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={() => signOut(auth)}
              title="Sign out"
            >
              <LogOut size={14} />
              <span className="btn-label">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <div className="app-container">
        <ul className="nav nav-tabs mb-3" role="tablist">
          {TABS.map(t => {
            const Icon = t.icon;
            const count =
              t.key === 'parts' ? parts.length :
              t.key === 'boards' ? boards.length :
              t.key === 'categories' ? categories.length :
              customers.length;
            return (
              <li className="nav-item" key={t.key} role="presentation">
                <button
                  className={`nav-link ${activeTab === t.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(t.key)}
                  type="button"
                >
                  <Icon size={14} style={{ marginRight: 4, verticalAlign: '-2px' }} />
                  {t.label} <span className="text-muted">({count})</span>
                </button>
              </li>
            );
          })}
        </ul>

        {lowStockCount > 0 && activeTab === 'parts' && (
          <div style={{
            padding: '8px 12px', marginBottom: 10,
            background: 'var(--brand-soft)',
            color: 'var(--brand)',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.85rem',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertTriangle size={14} />
            {lowStockCount} part{lowStockCount === 1 ? ' is' : 's are'} at or below min stock.
          </div>
        )}

        {activeTab === 'parts' && (
          <PartsTab
            loading={!partsLoaded}
            parts={filteredParts}
            categories={categories}
            categoryFilter={categoryFilter}
            onCategoryFilter={setCategoryFilter}
            customers={customers}
            customerFilter={customerFilter}
            onCustomerFilter={setCustomerFilter}
            onEdit={setEditingPart}
            onDelete={deletePart}
            onDuplicate={duplicatePart}
            onAdjust={adjustPartQty}
            onOpenPhoto={setLightboxSrc}
          />
        )}
        {activeTab === 'boards' && (
          <BoardsTab
            loading={!boardsLoaded}
            boards={filteredBoards}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            customers={customers}
            customerFilter={customerFilter}
            onCustomerFilter={setCustomerFilter}
            onEdit={setEditingBoard}
            onDelete={deleteBoard}
            onDuplicate={duplicateBoard}
            onAdjust={adjustBoardQty}
            onOpenPhoto={setLightboxSrc}
          />
        )}
        {activeTab === 'categories' && (
          <CategoriesTab
            categories={categories}
            parts={parts}
            onRename={renameCategory}
            onDelete={deleteCategory}
            onCreate={createCategory}
          />
        )}
        {activeTab === 'customers' && (
          <CustomersTab
            customers={customers}
            parts={parts}
            boards={boards}
            onRename={renameCustomer}
            onDelete={deleteCustomer}
            onCreate={createCustomer}
          />
        )}
      </div>

      <PartFormModal
        open={editingPart !== null}
        initial={editingPart || {}}
        categories={categories}
        onCreateCategory={createCategory}
        customers={customers}
        onCreateCustomer={createCustomer}
        onClose={() => setEditingPart(null)}
        onSave={savePart}
        uploadPath={userRoot ? `${userRoot}/inventory-photos` : ''}
        onOpenPhoto={setLightboxSrc}
        onError={(msg) => toast.error(`Upload failed: ${msg}`)}
      />
      <BoardFormModal
        open={editingBoard !== null}
        initial={editingBoard || {}}
        customers={customers}
        onCreateCustomer={createCustomer}
        onClose={() => setEditingBoard(null)}
        onSave={saveBoard}
        uploadPath={userRoot ? `${userRoot}/inventory-photos` : ''}
        onOpenPhoto={setLightboxSrc}
        onError={(msg) => toast.error(`Upload failed: ${msg}`)}
      />

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}

// -------------------- Tabs --------------------

function PartsTab({ loading, parts, categories, categoryFilter, onCategoryFilter, customers, customerFilter, onCustomerFilter, onEdit, onDelete, onDuplicate, onAdjust, onOpenPhoto }) {
  return (
    <>
      <FilterPillRow
        label="Category"
        items={categories}
        value={categoryFilter}
        onChange={onCategoryFilter}
      />
      <FilterPillRow
        label="Customer"
        items={customers}
        value={customerFilter}
        onChange={onCustomerFilter}
      />

      {loading && parts.length === 0 ? (
        <div className="empty-state">Loading parts…</div>
      ) : parts.length === 0 ? (
        <div className="empty-state">
          No parts yet. Tap <strong>Add part</strong> to get started.
        </div>
      ) : (
        <div className="inv-list">
          {parts.map(p => <PartRow key={p.id} part={p} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} onAdjust={onAdjust} onOpenPhoto={onOpenPhoto} />)}
        </div>
      )}
    </>
  );
}

function FilterPillRow({ label, items, value, onChange }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="d-flex align-items-center gap-2 mb-2" style={{ flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{label}:</span>
      <button
        className={`pill ${!value ? 'pill-primary' : 'pill-muted'}`}
        onClick={() => onChange('')}
        style={{ cursor: 'pointer', border: 'none' }}
      >
        All
      </button>
      {items.map(it => (
        <button
          key={it.id}
          className={`pill ${value === it.name ? 'pill-primary' : 'pill-muted'}`}
          onClick={() => onChange(it.name)}
          style={{ cursor: 'pointer', border: 'none' }}
        >
          {it.name}
        </button>
      ))}
    </div>
  );
}

const PartRow = React.memo(function PartRow({ part, onEdit, onDelete, onDuplicate, onAdjust, onOpenPhoto }) {
  const low = (Number(part.minQty) || 0) > 0 && (Number(part.qty) || 0) <= Number(part.minQty);
  return (
    <div className="inv-row">
      {part.photoUrl && (
        <img
          src={part.photoUrl}
          alt={part.name}
          onClick={() => onOpenPhoto?.(part.photoUrl)}
          onError={(e) => {
            console.error('Thumbnail failed to load:', part.photoUrl);
            // Swap the img for a visible "broken photo" marker so you know
            // there's a photo attached that the browser couldn't decode.
            const placeholder = document.createElement('div');
            placeholder.className = 'inv-row-thumb inv-row-thumb--broken';
            placeholder.textContent = 'Bad photo';
            placeholder.title = 'Re-upload this photo (original was HEIC or corrupted)';
            e.currentTarget.replaceWith(placeholder);
          }}
          className="inv-row-thumb"
          loading="lazy"
        />
      )}
      <button
        type="button"
        className="inv-row-main inv-row-open"
        onClick={() => onEdit(part)}
        title="View / edit details"
      >
        <div className="inv-row-title">
          {part.name}
          {low && <span className="pill pill-warning">Low</span>}
          {part.category && <span className="pill pill-muted">{part.category}</span>}
          {(part.customers || []).map(c => (
            <span key={c} className="pill pill-primary">{c}</span>
          ))}
        </div>
        <div className="inv-row-meta">
          {part.sku && <span>SKU {part.sku}</span>}
          {part.location && <span>· {part.location}</span>}
          {part.minQty > 0 && <span>· Min {part.minQty}</span>}
          {part.cost != null && part.cost !== '' && <span>· ${Number(part.cost).toFixed(2)}</span>}
        </div>
      </button>
      <div className="inv-row-actions">
        <div className="qty-adjust" role="group" aria-label={`Adjust ${part.name} quantity`}>
          <button onClick={() => onAdjust(part, -1)} disabled={(Number(part.qty) || 0) <= 0} aria-label="Decrease">−</button>
          <span className="qty-value">{Number(part.qty) || 0}</span>
          <button onClick={() => onAdjust(part, +1)} aria-label="Increase">+</button>
        </div>
        <button className="icon-btn" onClick={() => onEdit(part)} title="Edit"><Pencil size={16} /></button>
        <button className="icon-btn" onClick={() => onDuplicate(part)} title="Duplicate (for another customer)"><Copy size={16} /></button>
        <button className="icon-btn danger" onClick={() => onDelete(part)} title="Delete"><Trash2 size={16} /></button>
      </div>
    </div>
  );
});

function BoardsTab({ loading, boards, statusFilter, onStatusFilter, customers, customerFilter, onCustomerFilter, onEdit, onDelete, onDuplicate, onAdjust, onOpenPhoto }) {
  return (
    <>
      <div className="d-flex align-items-center gap-2 mb-2" style={{ flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Status:</span>
        <button
          className={`pill ${!statusFilter ? 'pill-primary' : 'pill-muted'}`}
          onClick={() => onStatusFilter('')}
          style={{ cursor: 'pointer', border: 'none' }}
        >
          All
        </button>
        {BOARD_STATUSES.map(s => (
          <button
            key={s.key}
            className={`pill ${statusFilter === s.key ? 'pill-primary' : 'pill-muted'}`}
            onClick={() => onStatusFilter(s.key)}
            style={{ cursor: 'pointer', border: 'none' }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <FilterPillRow
        label="Customer"
        items={customers}
        value={customerFilter}
        onChange={onCustomerFilter}
      />

      {loading && boards.length === 0 ? (
        <div className="empty-state">Loading boards…</div>
      ) : boards.length === 0 ? (
        <div className="empty-state">
          No boards yet. Tap <strong>Add board</strong> to get started.
        </div>
      ) : (
        <div className="inv-list">
          {boards.map(b => <BoardRow key={b.id} board={b} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} onAdjust={onAdjust} onOpenPhoto={onOpenPhoto} />)}
        </div>
      )}
    </>
  );
}

const BoardRow = React.memo(function BoardRow({ board, onEdit, onDelete, onDuplicate, onAdjust, onOpenPhoto }) {
  const statusLabel = BOARD_STATUSES.find(s => s.key === board.status)?.label || 'Unknown';
  const statusClass =
    board.status === 'dead' ? 'pill-danger' :
    board.status === 'repaired' || board.status === 'used' ? 'pill-warning' :
    board.status === 'new' ? 'pill-success' :
    'pill-muted';
  return (
    <div className="inv-row">
      {board.photoUrl && (
        <img
          src={board.photoUrl}
          alt={board.name}
          onClick={() => onOpenPhoto?.(board.photoUrl)}
          onError={(e) => {
            console.error('Thumbnail failed to load:', board.photoUrl, e);
            e.currentTarget.style.display = 'none';
          }}
          className="inv-row-thumb"
          loading="lazy"
        />
      )}
      <button
        type="button"
        className="inv-row-main inv-row-open"
        onClick={() => onEdit(board)}
        title="View / edit details"
      >
        <div className="inv-row-title">
          {board.name}
          <span className={`pill ${statusClass}`}>{statusLabel}</span>
          {(board.customers || []).map(c => (
            <span key={c} className="pill pill-primary">{c}</span>
          ))}
        </div>
        <div className="inv-row-meta">
          {board.model && <span>Model {board.model}</span>}
          {board.revision && <span>· Rev {board.revision}</span>}
          {board.serial && <span>· S/N {board.serial}</span>}
          {board.location && <span>· {board.location}</span>}
        </div>
      </button>
      <div className="inv-row-actions">
        <div className="qty-adjust" role="group" aria-label={`Adjust ${board.name} quantity`}>
          <button onClick={() => onAdjust(board, -1)} disabled={(Number(board.qty) || 0) <= 0} aria-label="Decrease">−</button>
          <span className="qty-value">{Number(board.qty) || 0}</span>
          <button onClick={() => onAdjust(board, +1)} aria-label="Increase">+</button>
        </div>
        <button className="icon-btn" onClick={() => onEdit(board)} title="Edit"><Pencil size={16} /></button>
        <button className="icon-btn" onClick={() => onDuplicate(board)} title="Duplicate (for another customer)"><Copy size={16} /></button>
        <button className="icon-btn danger" onClick={() => onDelete(board)} title="Delete"><Trash2 size={16} /></button>
      </div>
    </div>
  );
});

function CategoriesTab({ categories, parts, onRename, onDelete, onCreate }) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await onCreate(newName.trim());
    setNewName('');
  };

  return (
    <>
      <form onSubmit={handleCreate} className="d-flex gap-2 mb-3" style={{ maxWidth: 420 }}>
        <input
          className="form-control form-control-sm"
          placeholder="New category name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!newName.trim()}>
          <Plus size={14} /> Create
        </button>
      </form>

      {categories.length === 0 ? (
        <div className="empty-state">
          No categories yet. Add one above — or create one while adding a part.
        </div>
      ) : (
        <div className="inv-list">
          {categories.map(c => {
            const count = parts.filter(p => p.category === c.name).length;
            const isEditing = editingId === c.id;
            return (
              <div key={c.id} className="inv-row">
                <div className="inv-row-main">
                  {isEditing ? (
                    <input
                      autoFocus
                      className="form-control form-control-sm"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { onRename(c, editValue); setEditingId(null); }
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => { if (editValue.trim() && editValue !== c.name) onRename(c, editValue); setEditingId(null); }}
                      style={{ maxWidth: 280 }}
                    />
                  ) : (
                    <>
                      <div className="inv-row-title">{c.name}</div>
                      <div className="inv-row-meta">
                        <span>{count} {count === 1 ? 'part' : 'parts'}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="inv-row-actions">
                  <button
                    className="icon-btn"
                    onClick={() => { setEditingId(c.id); setEditValue(c.name); }}
                    title="Rename"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => onDelete(c)}
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function CustomersTab({ customers, parts, boards, onRename, onDelete, onCreate }) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await onCreate(newName.trim());
    setNewName('');
  };

  return (
    <>
      <form onSubmit={handleCreate} className="d-flex gap-2 mb-3" style={{ maxWidth: 420 }}>
        <input
          className="form-control form-control-sm"
          placeholder="New customer name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!newName.trim()}>
          <Plus size={14} /> Create
        </button>
      </form>

      {customers.length === 0 ? (
        <div className="empty-state">
          No customers yet. Add one above — or create one while adding a part or board.
        </div>
      ) : (
        <div className="inv-list">
          {customers.map(c => {
            const partCount  = parts.filter(p => (p.customers || []).includes(c.name)).length;
            const boardCount = boards.filter(b => (b.customers || []).includes(c.name)).length;
            const isEditing = editingId === c.id;
            return (
              <div key={c.id} className="inv-row">
                <div className="inv-row-main">
                  {isEditing ? (
                    <input
                      autoFocus
                      className="form-control form-control-sm"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { onRename(c, editValue); setEditingId(null); }
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => { if (editValue.trim() && editValue !== c.name) onRename(c, editValue); setEditingId(null); }}
                      style={{ maxWidth: 280 }}
                    />
                  ) : (
                    <>
                      <div className="inv-row-title">{c.name}</div>
                      <div className="inv-row-meta">
                        <span>{partCount} {partCount === 1 ? 'part' : 'parts'}</span>
                        <span>· {boardCount} {boardCount === 1 ? 'board' : 'boards'}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="inv-row-actions">
                  <button
                    className="icon-btn"
                    onClick={() => { setEditingId(c.id); setEditValue(c.name); }}
                    title="Rename"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => onDelete(c)}
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}

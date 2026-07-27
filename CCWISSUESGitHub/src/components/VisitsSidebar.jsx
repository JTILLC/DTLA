import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, FileText, Trash2, Pencil, Copy, Clock } from 'lucide-react';

/**
 * Persistent sidebar listing all visits for the active customer.
 * Click to switch visits (same behavior as "Load" in the Past Visits tab).
 * Double-click / pencil to inline rename. Trash to delete.
 *
 * Props:
 * - visits: array of visit objects {id, name, date, serviceReportUrl}
 * - currentVisitId: id of the active visit
 * - customerName: optional, shown at the top
 * - onSelect: (visitId) => void
 * - onNewVisit: () => void
 * - onCopyVisit: (visitId) => void   // new visit from this one (clean slate)
 * - onRename: (visitId, newName) => Promise|void
 * - onDelete: (visitId) => void
 * - collapsed: boolean
 * - onToggle: () => void
 */
function VisitsSidebar({
  visits = [],
  currentVisitId,
  customerName,
  onSelect,
  onNewVisit,
  onCopyVisit,
  onRename,
  onEditDate,
  onDelete,
  collapsed = false,
  onToggle,
}) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEdit = (visit) => {
    setEditingId(visit.id);
    setEditValue(visit.name || '');
  };

  const commitEdit = async () => {
    if (!editingId) return;
    const id = editingId;
    const trimmed = editValue.trim();
    setEditingId(null);
    if (onRename && trimmed) {
      await onRename(id, trimmed);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  if (collapsed) {
    return (
      <aside className="visits-sidebar visits-sidebar--collapsed" aria-label="Visits">
        <button
          className="btn btn-sm btn-outline-secondary visits-sidebar-toggle"
          onClick={onToggle}
          title="Show visits"
          aria-label="Show visits"
        >
          <ChevronRight size={14} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="visits-sidebar" aria-label="Visits">
      <div className="visits-sidebar-header">
        <div className="visits-sidebar-title">
          <span className="visits-sidebar-label">Visits</span>
          {customerName && (
            <span className="visits-sidebar-customer" title={customerName}>
              {customerName}
            </span>
          )}
        </div>
        <div className="visits-sidebar-header-actions">
          {onNewVisit && (
            <button
              className="btn btn-sm btn-primary"
              onClick={onNewVisit}
              title="New visit"
            >
              <Plus size={14} /> New
            </button>
          )}
          {onToggle && (
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={onToggle}
              title="Collapse visits"
              aria-label="Collapse visits"
            >
              <ChevronLeft size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="visits-sidebar-list" role="list">
        {visits.length === 0 && (
          <div className="visits-sidebar-empty">
            No visits yet. Click <strong>+ New</strong> to create one.
          </div>
        )}
        {visits.map((v) => {
          const isActive = v.id === currentVisitId;
          const isEditing = editingId === v.id;
          return (
            <div
              key={v.id}
              role="listitem"
              className={`visits-sidebar-item ${isActive ? 'is-active' : ''}`}
              onClick={() => !isEditing && onSelect && onSelect(v.id)}
              onDoubleClick={() => onRename && startEdit(v)}
              title={v.name || 'Unnamed visit'}
            >
              <div className="visits-sidebar-item-main">
                {isEditing ? (
                  <input
                    ref={inputRef}
                    className="form-control form-control-sm visits-sidebar-rename"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div className="visits-sidebar-item-name">
                    {v.name || <span className="text-muted">Unnamed visit</span>}
                    {v.serviceReportUrl && (
                      <span className="badge bg-success ms-1" title="Service report attached">
                        <FileText size={10} />
                      </span>
                    )}
                  </div>
                )}
                <div className="visits-sidebar-item-date">
                  {v.date ? new Date(v.date).toLocaleDateString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric',
                  }) : ''}
                  {v.globalData?.serviceReportNumber && (
                    <span className="badge bg-secondary ms-2" title="Service report number">SR {v.globalData.serviceReportNumber}</span>
                  )}
                </div>
              </div>

              {!isEditing && (
                <div className="visits-sidebar-item-actions" onClick={(e) => e.stopPropagation()}>
                  {onCopyVisit && (
                    <button
                      className="btn btn-sm visits-sidebar-icon-btn"
                      onClick={() => onCopyVisit(v.id)}
                      title="New visit from this one (clean slate)"
                      aria-label="New visit from this one"
                    >
                      <Copy size={13} />
                    </button>
                  )}
                  {onRename && (
                    <button
                      className="btn btn-sm visits-sidebar-icon-btn"
                      onClick={() => startEdit(v)}
                      title="Rename"
                      aria-label="Rename visit"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {onEditDate && (
                    <button
                      className="btn btn-sm visits-sidebar-icon-btn"
                      onClick={() => onEditDate(v)}
                      title="Edit date"
                      aria-label="Edit visit date"
                    >
                      <Clock size={13} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      className="btn btn-sm visits-sidebar-icon-btn visits-sidebar-icon-btn--danger"
                      onClick={() => onDelete(v.id)}
                      title="Delete"
                      aria-label="Delete visit"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default VisitsSidebar;

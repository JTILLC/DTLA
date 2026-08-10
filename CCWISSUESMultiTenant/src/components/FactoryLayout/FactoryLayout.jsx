import { useState, useEffect, useCallback, useRef } from 'react';
import FactoryCanvas from '@shared/components/FactoryLayout/FactoryCanvas.jsx';
import LayoutToolbar from '@shared/components/FactoryLayout/LayoutToolbar.jsx';
import LineBoxPalette from '@shared/components/FactoryLayout/LineBoxPalette.jsx';
import { loadLayout, saveLayout, isEmptyLayout, DEFAULT_LAYOUT } from '@shared/components/FactoryLayout/LayoutStorage.js';
import { WORKSPACE_UID } from '../../config/constants';
import { useToast } from '@shared/components/Toast.jsx';
import { useDialog } from '@shared/components/DialogSystem.jsx';

const FactoryLayout = ({
  lines,
  currentCustomer,
  currentVisitId,
  user,
  onNavigateToLine,
  readOnly = false,
  // Recorded against the layout so the screen can say where it came from.
  author = 'Plant',
}) => {
  const toast = useToast();
  const dialog = useDialog();
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [activeTool, setActiveTool] = useState('select');
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Starts in Navigate whenever there is already a floor to look at — see the
  // load effect. A plant opening a layout JTI plotted for them is there to use
  // it, and landing in Edit mode means the first stray drag moves a machine.
  const [isEditMode, setIsEditMode] = useState(false);
  // The revision this screen is working from, so a save can tell whether the
  // stored copy has moved on underneath it.
  const baseRevRef = useRef(null);

  const saveTimeoutRef = useRef(null);

  // Load layout when the customer changes
  useEffect(() => {
    if (!user || !currentCustomer) {
      setLayout(DEFAULT_LAYOUT);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    loadLayout(WORKSPACE_UID, currentCustomer.id)
      .then((loaded) => {
        setLayout(loaded);
        baseRevRef.current = loaded.rev ?? null;
        // Nothing drawn yet → Edit, because there is nothing to look at and
        // drawing is the only useful thing to do. Otherwise → Navigate.
        setIsEditMode(!readOnly && isEmptyLayout(loaded));
      })
      .finally(() => setIsLoading(false));
    // Deliberately not keyed on the open log: the floor does not change
    // because somebody opened a different one.
  }, [user, currentCustomer, readOnly]);

  // Auto-save layout with debounce
  const saveLayoutDebounced = useCallback((newLayout) => {
    if (!user || !currentCustomer || readOnly) return; // view-only JTI visit — never persist

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);

      const res = await saveLayout(WORKSPACE_UID, currentCustomer.id, newLayout, {
        author,
        baseRev: baseRevRef.current,
      });

      if (res?.conflict) {
        // Somebody else saved while this screen was open. Both versions still
        // exist at this point; which one survives is the person's call, not
        // ours, and the question names who they are up against.
        const whose = res.theirs?.updatedBy || 'Someone else';
        const keepMine = await dialog.confirm(
          `${whose} changed this layout while you had it open.\n\n`
          + 'Keep your version and replace theirs, or discard your changes and load theirs?',
          { title: 'Layout changed elsewhere', confirmText: 'Keep mine', cancelText: 'Load theirs', variant: 'warning' },
        );
        if (keepMine) {
          const forced = await saveLayout(WORKSPACE_UID, currentCustomer.id, newLayout, { author, force: true });
          baseRevRef.current = forced?.rev ?? null;
          toast.success('Your layout is saved.');
        } else {
          setLayout(res.theirs);
          baseRevRef.current = res.theirs?.rev ?? null;
          toast.info(`Loaded ${whose}'s layout.`);
        }
      } else if (res?.ok) {
        baseRevRef.current = res.rev ?? null;
      } else {
        toast.error('Could not save the layout — it may not have reached the cloud.');
      }

      setIsSaving(false);
    }, 500);
  }, [user, currentCustomer, readOnly, author, dialog, toast]);

  // Update layout and trigger auto-save
  const handleUpdateLayout = useCallback((newLayout) => {
    setLayout(newLayout);
    saveLayoutDebounced(newLayout);
  }, [saveLayoutDebounced]);

  // Handle click on line box to navigate (in navigate mode)
  const handleLineClick = useCallback((lineId) => {
    if (!isEditMode && onNavigateToLine) {
      onNavigateToLine(lineId);
    }
  }, [isEditMode, onNavigateToLine]);

  // Handle double-click on line box to navigate (in edit mode)
  const handleLineDoubleClick = useCallback((lineId) => {
    if (onNavigateToLine) {
      onNavigateToLine(lineId);
    }
  }, [onNavigateToLine]);

  // Zoom controls
  const handleZoomIn = () => setZoom(prev => Math.min(2, prev + 0.25));
  const handleZoomOut = () => setZoom(prev => Math.max(0.25, prev - 0.25));
  const handleResetZoom = () => setZoom(1);

  // Delete selected item
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;

    let newLayout = { ...layout };

    if (selectedId.startsWith('box_')) {
      newLayout.lineBoxes = layout.lineBoxes.filter(b => b.id !== selectedId);
    } else if (selectedId.startsWith('wall_')) {
      newLayout.walls = layout.walls.filter(w => w.id !== selectedId);
    } else if (selectedId.startsWith('label_')) {
      newLayout.labels = layout.labels.filter(l => l.id !== selectedId);
    }

    setSelectedId(null);
    handleUpdateLayout(newLayout);
  }, [selectedId, layout, handleUpdateLayout]);

  // Reset canvas - clear all items
  const handleResetCanvas = useCallback(async () => {
    const confirmed = await dialog.confirm('Are you sure you want to clear the entire canvas? This will remove all lines, walls, and labels.', {
      title: 'Clear Canvas',
      confirmText: 'Clear',
      variant: 'danger'
    });
    if (confirmed) {
      const newLayout = {
        ...layout,
        lineBoxes: [],
        walls: [],
        labels: []
      };
      setSelectedId(null);
      handleUpdateLayout(newLayout);
    }
  }, [layout, handleUpdateLayout, dialog]);

  // The "Save for this visit" / "Use default" pair that stood here is gone:
  // there is one layout per plant now, so there is no second place to put
  // one and nothing to switch between.

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key.toLowerCase()) {
        case 'v':
          setActiveTool('select');
          break;
        case 'w':
          setActiveTool('wall');
          break;
        case 'r':
          setActiveTool('rectangle');
          break;
        case 't':
          setActiveTool('label');
          break;
        case 'e':
          setIsEditMode(true);
          break;
        case 'n':
          setIsEditMode(false);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Get placed line IDs
  const placedLineIds = layout.lineBoxes.map(box => box.lineId);

  if (!currentCustomer) {
    return (
      <div className="factory-layout-empty">
        <p>Select a customer to view their factory layout.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="factory-layout-loading">
        <p>Loading layout...</p>
      </div>
    );
  }

  return (
    <div className="factory-layout">
      <LayoutToolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
        onDeleteSelected={handleDeleteSelected}
        onResetCanvas={handleResetCanvas}
        hasSelection={!!selectedId}
        isEditMode={isEditMode}
        setIsEditMode={setIsEditMode}
      />

      {/* Where this floor plan came from.
          A plant that has had its layout plotted for it should be told so,
          rather than left to wonder whether somebody on their shift drew it —
          and told, in the same breath, that changing it is theirs to do. */}
      {!isEmptyLayout(layout) && (
        <div className="layout-provenance">
          {layout.updatedBy === 'JTI' ? (
            <>
              <strong>Plotted by JTI</strong>
              {layout.updatedAt && ` · ${new Date(layout.updatedAt).toLocaleDateString()}`}
              {' — '}
              {isEditMode
                ? 'you are editing it. Switch to Navigate to just use it.'
                : 'switch to Edit if anything on your floor has moved.'}
            </>
          ) : (
            <>
              <strong>Your plant&rsquo;s layout</strong>
              {/* An older layout carries no author — it predates recording one —
                  so it says when, and does not invent a who. */}
              {layout.updatedBy
                ? ` · last changed by ${layout.updatedBy}`
                : ' · last changed'}
              {layout.updatedAt && ` ${new Date(layout.updatedAt).toLocaleDateString()}`}
            </>
          )}
        </div>
      )}

      <div className="factory-layout-content">
        {isEditMode && (
          <LineBoxPalette
            lines={lines}
            placedLineIds={placedLineIds}
          />
        )}

        <FactoryCanvas
          layout={layout}
          lines={lines}
          activeTool={activeTool}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          onUpdateLayout={handleUpdateLayout}
          onLineClick={handleLineClick}
          onLineDoubleClick={handleLineDoubleClick}
          zoom={zoom}
          isEditMode={isEditMode}
        />
      </div>

      {isSaving && (
        <div className="factory-layout-saving">
          Saving...
        </div>
      )}

      {dialog.DialogComponent}
    </div>
  );
};

export default FactoryLayout;

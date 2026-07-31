import { useState, useEffect, useCallback, useRef } from 'react';
import FactoryCanvas from '@shared/components/FactoryLayout/FactoryCanvas.jsx';
import LayoutToolbar from '@shared/components/FactoryLayout/LayoutToolbar.jsx';
import LineBoxPalette from '@shared/components/FactoryLayout/LineBoxPalette.jsx';
import { loadLayout, saveDefaultLayout, saveVisitLayout, deleteVisitLayout, DEFAULT_LAYOUT } from '@shared/components/FactoryLayout/LayoutStorage.js';
import { WORKSPACE_UID } from '../../config/constants';
import { useToast } from '@shared/components/Toast.jsx';
import { useDialog } from '@shared/components/DialogSystem.jsx';

const FactoryLayout = ({
  lines,
  currentCustomer,
  currentVisitId,
  user,
  onNavigateToLine,
  readOnly = false
}) => {
  const toast = useToast();
  const dialog = useDialog();
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [activeTool, setActiveTool] = useState('select');
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(!readOnly);
  const [hasVisitLayout, setHasVisitLayout] = useState(false);
  const saveTimeoutRef = useRef(null);

  // Load layout when customer or visit changes
  useEffect(() => {
    if (!user || !currentCustomer) {
      setLayout(DEFAULT_LAYOUT);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    loadLayout(WORKSPACE_UID, currentCustomer.id, currentVisitId)
      .then((loaded) => {
        setLayout(loaded);
        setHasVisitLayout(loaded._isVisitSpecific || false);
      })
      .finally(() => setIsLoading(false));
  }, [user, currentCustomer, currentVisitId]);

  // Auto-save layout with debounce
  const saveLayoutDebounced = useCallback((newLayout) => {
    if (!user || !currentCustomer || readOnly) return; // view-only JTI visit — never persist

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);

      // Save to visit-specific or default based on current state
      if (newLayout._isVisitSpecific && currentVisitId) {
        await saveVisitLayout(WORKSPACE_UID, currentCustomer.id, currentVisitId, newLayout);
      } else {
        await saveDefaultLayout(WORKSPACE_UID, currentCustomer.id, newLayout);
      }

      setIsSaving(false);
    }, 500);
  }, [user, currentCustomer, currentVisitId, readOnly]);

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

  // Save current layout as visit-specific
  const handleSaveAsVisitLayout = useCallback(async () => {
    if (!currentVisitId) {
      toast.error('No active visit. Please make sure you have a current visit selected.');
      return;
    }

    const confirmed = await dialog.confirm('Save this layout for the current visit only? This will create a separate layout that only applies to this visit.', {
      title: 'Save Visit Layout',
      confirmText: 'Save'
    });
    if (confirmed) {
      const visitLayout = {
        ...layout,
        _isVisitSpecific: true,
        _visitId: currentVisitId
      };

      setIsSaving(true);
      await saveVisitLayout(WORKSPACE_UID, currentCustomer.id, currentVisitId, visitLayout);
      setLayout(visitLayout);
      setHasVisitLayout(true);
      setIsSaving(false);
    }
  }, [layout, currentVisitId, user, currentCustomer, dialog, toast]);

  // Revert to default layout (delete visit-specific)
  const handleUseDefaultLayout = useCallback(async () => {
    const confirmed = await dialog.confirm('Switch back to the default customer layout? This will delete the visit-specific layout.', {
      title: 'Use Default Layout',
      confirmText: 'Switch',
      variant: 'warning'
    });
    if (confirmed) {
      setIsSaving(true);
      await deleteVisitLayout(WORKSPACE_UID, currentCustomer.id, currentVisitId);

      // Reload default layout
      const defaultLayout = await loadLayout(WORKSPACE_UID, currentCustomer.id, null);
      setLayout(defaultLayout);
      setHasVisitLayout(false);
      setIsSaving(false);
    }
  }, [user, currentCustomer, currentVisitId, dialog]);

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
        hasVisitLayout={hasVisitLayout}
        onSaveAsVisitLayout={handleSaveAsVisitLayout}
        onUseDefaultLayout={handleUseDefaultLayout}
      />

      {hasVisitLayout && (
        <div className="layout-scope-indicator">
          Using visit-specific layout
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

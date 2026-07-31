import { MousePointer, Square, Minus, Type, Trash2, ZoomIn, ZoomOut, RotateCcw, RefreshCw, Edit3, Navigation, Save } from 'lucide-react';

const LayoutToolbar = ({
  activeTool,
  setActiveTool,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onDeleteSelected,
  onResetCanvas,
  hasSelection,
  isEditMode,
  setIsEditMode,
  layoutScope,
  onSaveAsVisitLayout,
  onUseDefaultLayout,
  hasVisitLayout
}) => {
  const tools = [
    { id: 'select', icon: MousePointer, label: 'Select', shortcut: 'V' },
    { id: 'wall', icon: Minus, label: 'Wall', shortcut: 'W' },
    { id: 'rectangle', icon: Square, label: 'Area', shortcut: 'R' },
    { id: 'label', icon: Type, label: 'Label', shortcut: 'T' }
  ];

  return (
    <div className="layout-toolbar">
      {/* Mode Toggle */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${isEditMode ? 'active' : ''}`}
          onClick={() => setIsEditMode(true)}
          title="Edit Mode - Arrange lines"
        >
          <Edit3 size={18} />
          <span className="toolbar-label">Edit</span>
        </button>
        <button
          className={`toolbar-btn ${!isEditMode ? 'active' : ''}`}
          onClick={() => setIsEditMode(false)}
          title="Navigate Mode - Click lines to go to them"
          style={!isEditMode ? { backgroundColor: '#28a745', borderColor: '#28a745' } : {}}
        >
          <Navigation size={18} />
          <span className="toolbar-label">Navigate</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Edit Tools - only show in edit mode */}
      {isEditMode && (
        <>
          <div className="toolbar-group">
            {tools.map(tool => (
              <button
                key={tool.id}
                className={`toolbar-btn ${activeTool === tool.id ? 'active' : ''}`}
                onClick={() => setActiveTool(tool.id)}
                title={`${tool.label} (${tool.shortcut})`}
              >
                <tool.icon size={18} />
                <span className="toolbar-label">{tool.label}</span>
              </button>
            ))}
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <button
              className="toolbar-btn"
              onClick={onZoomOut}
              title="Zoom Out"
            >
              <ZoomOut size={18} />
            </button>
            <span className="zoom-level">{Math.round(zoom * 100)}%</span>
            <button
              className="toolbar-btn"
              onClick={onZoomIn}
              title="Zoom In"
            >
              <ZoomIn size={18} />
            </button>
            <button
              className="toolbar-btn"
              onClick={onResetZoom}
              title="Reset Zoom"
            >
              <RotateCcw size={18} />
            </button>
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-group">
            <button
              className="toolbar-btn danger"
              onClick={onDeleteSelected}
              disabled={!hasSelection}
              title="Delete Selected (Del)"
            >
              <Trash2 size={18} />
              <span className="toolbar-label">Delete</span>
            </button>
            <button
              className="toolbar-btn danger"
              onClick={onResetCanvas}
              title="Reset Canvas - Clear All"
            >
              <RefreshCw size={18} />
              <span className="toolbar-label">Reset</span>
            </button>
          </div>

          <div className="toolbar-divider" />

          {/* Layout Scope */}
          <div className="toolbar-group">
            {hasVisitLayout ? (
              <button
                className="toolbar-btn"
                onClick={onUseDefaultLayout}
                title="Switch to default customer layout"
              >
                <Save size={18} />
                <span className="toolbar-label">Use Default</span>
              </button>
            ) : (
              <button
                className="toolbar-btn"
                onClick={onSaveAsVisitLayout}
                title="Save this layout for current visit only"
              >
                <Save size={18} />
                <span className="toolbar-label">Save for Visit</span>
              </button>
            )}
          </div>
        </>
      )}

      {!isEditMode && (
        <div className="toolbar-hint" style={{ color: '#28a745' }}>
          <span>Click on a line to navigate to it</span>
        </div>
      )}
    </div>
  );
};

export default LayoutToolbar;

import React, { useState, useEffect, useRef } from 'react';
import { getImage } from '../utils/imageStorage';

const InteractiveDiagramViewer = ({ diagram, globalOrderList, setGlobalOrderList, darkMode, isMobile, onNavigateToDiagram }) => {
  const [hoveredPart, setHoveredPart] = useState(null);
  const orderList = globalOrderList;
  const setOrderList = setGlobalOrderList;
  const [hotspots, setHotspots] = useState(diagram.hotspots || {});
  const [hotspotsVisible, setHotspotsVisible] = useState(true);
  const [showOnlyOrdered, setShowOnlyOrdered] = useState(false);
  const [showPartsReference, setShowPartsReference] = useState(true);
  const imageContainerRef = useRef(null);
  const [pdfData, setPdfData] = useState(diagram.pdfData || null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [rotation, setRotation] = useState(0); // Image rotation in degrees (0, 90, 180, 270)
  const [zoom, setZoom] = useState(1);          // Diagram zoom (1 = fit width)
  const [pan, setPan] = useState({ x: 0, y: 0 }); // Pan offset in screen px (only when zoomed)
  const pointersRef = useRef(new Map());          // Active pointers for pinch/pan
  const panStartRef = useRef(null);
  const pinchStartRef = useRef(null);
  const panMovedRef = useRef(false);              // True if the last gesture panned (suppresses stray hotspot taps)

  const partsData = diagram.partsData || {};

  // Update hotspots when diagram changes
  useEffect(() => {
    setHotspots(diagram.hotspots || {});
    setRotation(0); // Reset rotation when switching diagrams
    setZoom(1);     // Reset zoom/pan when switching diagrams
    setPan({ x: 0, y: 0 });
  }, [diagram.id]);

  // No longer auto-show hotspots - user can control visibility even with ordered items

  // Load image from IndexedDB when diagram changes
  useEffect(() => {
    const loadImageFromDB = async () => {
      if (diagram.hasImage && !diagram.pdfData) {
        setLoadingImage(true);
        try {
          const imageData = await getImage(diagram.id);
          setPdfData(imageData);
        } catch (error) {
          console.error('Failed to load image from IndexedDB:', error);
          setPdfData(null);
        }
        setLoadingImage(false);
      } else {
        setPdfData(diagram.pdfData);
        setLoadingImage(false);
      }
    };
    loadImageFromDB();
  }, [diagram.id, diagram.hasImage, diagram.pdfData]);

  const handleHotspotClick = (hotspotId, e) => {
    e.stopPropagation();
    // Ignore the click that ends a pan-drag so panning never accidentally adds a part
    if (panMovedRef.current) { panMovedRef.current = false; return; }
    const hotspot = hotspots[hotspotId];
    const partNumber = hotspot.partNumber;

    // Add to order list or increment quantity
    setOrderList(prev => {
      const newList = { ...prev };
      const orderKey = `${diagram.id}-${partNumber}`;

      const partInfo = partsData[partNumber] || {
        partCode: '',
        partName: `Part ${partNumber}`,
        qty: '1'
      };

      // Use part's qty as initial order quantity
      const initialQty = parseInt(partInfo.qty) || 1;

      if (newList[orderKey]) {
        newList[orderKey].orderQty += 1;
      } else {
        newList[orderKey] = {
          ...partInfo,
          partNumber: partNumber,
          orderQty: initialQty,
          diagramId: diagram.id,
          diagramName: diagram.name,
          diagramNumber: diagram.number || ''
        };
      }
      return newList;
    });
  };

  const removeFromOrder = (orderKey) => {
    setOrderList(prev => {
      const newList = { ...prev };
      delete newList[orderKey];
      return newList;
    });
  };

  // Handle diagram rotation
  const handleRotate = (direction) => {
    let newRotation;
    if (direction === 'left') {
      newRotation = (rotation - 90 + 360) % 360;
    } else if (direction === 'right') {
      newRotation = (rotation + 90) % 360;
    } else if (direction === 'flip') {
      newRotation = (rotation + 180) % 360;
    }
    setRotation(newRotation);
  };

  // ---- Zoom & pan: pinch on touch, wheel on desktop, drag to pan when zoomed ----
  const ZOOM_MIN = 1, ZOOM_MAX = 5;
  const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const applyZoom = (next) => {
    const z = clampZoom(next);
    setZoom(z);
    if (z === 1) setPan({ x: 0, y: 0 }); // recenter when fully zoomed out
  };
  const zoomIn = () => applyZoom(zoom * 1.25);
  const zoomOut = () => applyZoom(zoom / 1.25);
  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handlePointerDown = (e) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchStartRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      panStartRef.current = null;
    } else if (pointersRef.current.size === 1 && zoom > 1) {
      panMovedRef.current = false;
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };

  const handlePointerMove = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      applyZoom(pinchStartRef.current.zoom * (dist / (pinchStartRef.current.dist || 1)));
      panMovedRef.current = true;
    } else if (panStartRef.current && zoom > 1) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) panMovedRef.current = true;
      setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
    }
  };

  const endPointer = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;
    if (pointersRef.current.size === 0) panStartRef.current = null;
  };

  // Wheel zoom (non-passive so we can preventDefault the page scroll over the diagram)
  useEffect(() => {
    const el = imageContainerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      applyZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);

  const updateOrderQty = (orderKey, qty) => {
    if (qty === '') {
      setOrderList(prev => ({
        ...prev,
        [orderKey]: {
          ...prev[orderKey],
          orderQty: ''
        }
      }));
      return;
    }

    const newQty = parseInt(qty) || 0;
    if (newQty <= 0) {
      removeFromOrder(orderKey);
    } else {
      setOrderList(prev => ({
        ...prev,
        [orderKey]: {
          ...prev[orderKey],
          orderQty: newQty
        }
      }));
    }
  };

  const handleQuantityBlur = (orderKey, qty) => {
    const newQty = parseInt(qty) || 0;
    if (newQty <= 0) {
      removeFromOrder(orderKey);
    } else {
      setOrderList(prev => ({
        ...prev,
        [orderKey]: {
          ...prev[orderKey],
          orderQty: newQty
        }
      }));
    }
  };

  const addPartToOrderByNumber = (partNumber) => {
    const orderKey = `${diagram.id}-${partNumber}`;

    const partInfo = partsData[partNumber] || {
      partCode: '',
      partName: `Part ${partNumber}`,
      qty: '1'
    };

    // Use part's qty as initial order quantity
    const initialQty = parseInt(partInfo.qty) || 1;

    setOrderList(prev => {
      const newList = { ...prev };
      if (newList[orderKey]) {
        newList[orderKey].orderQty += 1;
      } else {
        newList[orderKey] = {
          ...partInfo,
          partNumber: partNumber,
          orderQty: initialQty,
          diagramId: diagram.id,
          diagramName: diagram.name,
          diagramNumber: diagram.number || ''
        };
      }
      return newList;
    });
  };

  const renderHotspot = (hotspotId) => {
    const hotspot = hotspots[hotspotId];
    if (!hotspot) return null;

    const partNumber = hotspot.partNumber;
    const position = { x: hotspot.x, y: hotspot.y };
    const orderKey = `${diagram.id}-${partNumber}`;
    const isInOrder = orderList[orderKey];
    const isHovered = hoveredPart === partNumber;

    // Determine if we should show a small indicator when hotspots are hidden
    const showSmallIndicator = !hotspotsVisible && isInOrder;

    // Larger hotspots for better touch targets on mobile
    // Show small indicator (12px) when hotspots are hidden but part is ordered
    const hotspotSize = showSmallIndicator ? '12px' : (isMobile ? '44px' : '28px');

    const shouldBeVisible = hotspotsVisible && (!showOnlyOrdered || isInOrder);

    return (
      <div
        key={hotspotId}
        className="part-hotspot"
        style={{
          position: 'absolute',
          left: `${position.x}%`,
          top: `${position.y}%`,
          transform: 'translate(-50%, -50%)',
          width: hotspotSize,
          height: hotspotSize,
          borderRadius: '50%',
          backgroundColor: isInOrder ? 'rgba(76, 175, 80, 0.8)' : (isHovered ? 'rgba(255, 200, 0, 0.7)' : 'rgba(33, 150, 243, 0.6)'),
          border: showSmallIndicator ? '2px solid #2e7d32' : (isInOrder ? '2px solid #2e7d32' : (isHovered ? '2px solid #ff6b00' : '2px solid #1976d2')),
          cursor: 'pointer',
          zIndex: isHovered ? 1000 : (isInOrder ? 500 : 100),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: isMobile ? '13px' : '10px',
          fontWeight: 'bold',
          color: '#fff',
          boxShadow: isHovered ? '0 2px 8px rgba(0,0,0,0.3)' : (showSmallIndicator ? '0 1px 2px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.2)'),
          userSelect: 'none',
          opacity: (shouldBeVisible || showSmallIndicator) ? 1 : 0,
          pointerEvents: (shouldBeVisible || showSmallIndicator) ? 'auto' : 'none',
          transition: 'opacity 0.3s ease, all 0.2s ease'
        }}
        onMouseEnter={() => !isMobile && setHoveredPart(partNumber)}
        onMouseLeave={() => !isMobile && setHoveredPart(null)}
        onTouchStart={(e) => {
          e.stopPropagation();
          setHoveredPart(partNumber);
        }}
        onTouchEnd={() => setTimeout(() => setHoveredPart(null), 2000)}
        onClick={(e) => handleHotspotClick(hotspotId, e)}
        title={`Click to add Part #${partNumber} to order`}
      >
        {/* Only show number when not in small indicator mode */}
        {!showSmallIndicator && partNumber}
      </div>
    );
  };

  const renderTooltip = (partNumber) => {
    if (!partNumber) return null;

    const part = partsData[partNumber] || {
      partCode: 'N/A',
      partName: `Part ${partNumber}`,
      qty: '1'
    };

    const hotspotId = Object.keys(hotspots).find(id => hotspots[id].partNumber === partNumber);
    if (!hotspotId) return null;

    const hotspot = hotspots[hotspotId];
    const position = { x: hotspot.x, y: hotspot.y };

    if (!position) return null;

    let tooltipX = position.x + 3;
    let tooltipY = position.y - 10;

    if (tooltipX > 70) {
      tooltipX = position.x - 30;
    }

    return (
      <div
        className="part-tooltip"
        style={{
          position: 'absolute',
          left: `${tooltipX}%`,
          top: `${tooltipY}%`,
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          color: 'white',
          padding: '10px 14px',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          zIndex: 2000,
          minWidth: '260px',
          maxWidth: '350px',
          pointerEvents: 'none',
          border: '2px solid #ff6b00',
          fontSize: '11px',
        }}
      >
        <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '6px', color: '#ffc107' }}>
          Part #{partNumber}
        </div>
        <div style={{ marginBottom: '3px' }}>
          <span style={{ color: '#aaa' }}>Code:</span> {part.partCode}
        </div>
        <div style={{ marginBottom: '3px' }}>
          <span style={{ color: '#aaa' }}>Name:</span> {part.partName}
        </div>
        <div style={{ marginBottom: '3px' }}>
          <span style={{ color: '#aaa' }}>Qty:</span> {part.qty}
        </div>
        <div style={{ fontSize: '10px', marginTop: '6px', color: '#4caf50', fontStyle: 'italic' }}>
          Click to add to order list
        </div>
      </div>
    );
  };

  return (
    <div style={{
      padding: isMobile ? '4px' : '20px',
      backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
      minHeight: '100vh'
    }}>
      <div style={{ maxWidth: '100%', margin: '0 auto' }}>
        <h1 style={{
          textAlign: 'center',
          marginBottom: isMobile ? '8px' : '20px',
          fontSize: isMobile ? '18px' : '32px',
          color: darkMode ? '#fff' : '#333'
        }}>
          {diagram.customer && diagram.customer !== 'General' ? `${diagram.customer} - ${diagram.folder || 'General'}` : (diagram.folder || 'General')}
        </h1>
        <h2 style={{
          textAlign: 'center',
          marginBottom: isMobile ? '8px' : '12px',
          fontSize: isMobile ? '14px' : '20px',
          color: darkMode ? '#aaa' : '#666',
          fontWeight: 'normal'
        }}>
          {diagram.name}
        </h2>

        <div style={{
          marginBottom: isMobile ? '8px' : '16px',
          padding: isMobile ? '8px' : '12px',
          backgroundColor: darkMode ? '#2a2a2a' : '#fff',
          borderRadius: '8px',
          boxShadow: darkMode ? '0 2px 4px rgba(0,0,0,0.5)' : '0 2px 4px rgba(0,0,0,0.1)',
          border: darkMode ? '1px solid #444' : 'none',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'flex-start',
          gap: isMobile ? '8px' : '12px'
        }}>
          <p style={{
            margin: 0,
            fontSize: isMobile ? '13px' : '14px',
            color: darkMode ? '#ccc' : '#666'
          }}>
            <strong>Instructions:</strong> {isMobile ? 'Tap circles to add to order.' : 'Click on any numbered circle on the diagram to add it to your parts order list below.'}
          </p>
          <div style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            justifyContent: isMobile ? 'stretch' : 'flex-end'
          }}>
            <button
              onClick={() => {
                setHotspotsVisible(!hotspotsVisible);
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: hotspotsVisible ? '#2196f3' : '#9e9e9e',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
            >
              {hotspotsVisible ? 'Hide Hotspots' : 'Show Hotspots'}
            </button>
            <button
              onClick={() => setShowOnlyOrdered(!showOnlyOrdered)}
              disabled={!hotspotsVisible && !showOnlyOrdered}
              style={{
                padding: '8px 16px',
                backgroundColor: showOnlyOrdered ? '#4caf50' : '#673ab7',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: (!hotspotsVisible && !showOnlyOrdered) ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: '13px',
                opacity: (!hotspotsVisible && !showOnlyOrdered) ? 0.5 : 1
              }}
            >
              {showOnlyOrdered ? 'Ordered Only' : 'Show Ordered Only'}
            </button>
            <button
              onClick={() => handleRotate('left')}
              style={{
                padding: '8px 16px',
                backgroundColor: '#607d8b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Rotate diagram 90° counter-clockwise"
            >
              ↶ Rotate Left
            </button>
            <button
              onClick={() => handleRotate('right')}
              style={{
                padding: '8px 16px',
                backgroundColor: '#607d8b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Rotate diagram 90° clockwise"
            >
              ↷ Rotate Right
            </button>
            <button
              onClick={() => handleRotate('flip')}
              style={{
                padding: '8px 16px',
                backgroundColor: '#607d8b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Flip diagram 180°"
            >
              ⤾ Flip 180°
            </button>
            <button
              onClick={zoomOut}
              disabled={zoom <= 1}
              style={{
                padding: '8px 14px',
                backgroundColor: '#455a64',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: zoom <= 1 ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: '13px',
                opacity: zoom <= 1 ? 0.5 : 1
              }}
              title="Zoom out"
            >
              − Zoom
            </button>
            <button
              onClick={zoomIn}
              style={{
                padding: '8px 14px',
                backgroundColor: '#455a64',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Zoom in (or pinch / scroll over the diagram)"
            >
              ＋ Zoom
            </button>
            <button
              onClick={resetZoom}
              disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
              style={{
                padding: '8px 14px',
                backgroundColor: '#607d8b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: (zoom === 1 && pan.x === 0 && pan.y === 0) ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: '13px',
                opacity: (zoom === 1 && pan.x === 0 && pan.y === 0) ? 0.5 : 1
              }}
              title="Reset zoom"
            >
              ⤢ {Math.round(zoom * 100)}%
            </button>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 400px',
          gap: isMobile ? '8px' : '20px',
          marginBottom: isMobile ? '16px' : '40px'
        }}>
          {/* Diagram Image */}
          <div
            ref={imageContainerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            style={{
              position: 'relative',
              backgroundColor: 'white',
              borderRadius: isMobile ? '0' : '8px',
              overflow: 'hidden',
              boxShadow: isMobile ? 'none' : '0 4px 12px rgba(0,0,0,0.15)',
              minHeight: isMobile ? '500px' : 'auto',
              width: '100%',
              touchAction: zoom > 1 ? 'none' : 'auto', // let page scroll when not zoomed
              cursor: zoom > 1 ? 'grab' : 'default'
            }}
          >
            <div style={{
              position: 'relative',
              width: '100%',
              height: '100%'
            }}>
              {loadingImage ? (
                <div style={{
                  padding: '60px',
                  textAlign: 'center',
                  color: '#2196f3',
                  fontSize: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '400px'
                }}>
                  <div style={{
                    width: '50px',
                    height: '50px',
                    border: '5px solid #f3f3f3',
                    borderTop: '5px solid #2196f3',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    marginBottom: '20px'
                  }}></div>
                  <div>Loading diagram image...</div>
                  <style>{`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}</style>
                </div>
              ) : pdfData ? (
                <div style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                  transformOrigin: 'center center',
                  transition: panStartRef.current || pinchStartRef.current ? 'none' : 'transform 0.15s ease',
                  position: 'relative',
                  width: '100%'
                }}>
                  <img
                    src={pdfData}
                    alt="Diagram"
                    style={{
                      width: '100%',
                      height: 'auto',
                      display: 'block'
                    }}
                  />
                  {/* Render all hotspots inside rotating container */}
                  {Object.keys(hotspots).map((hotspotId) => renderHotspot(hotspotId))}
                  {/* Render tooltip for hovered part — suppress when hotspots are hidden */}
                  {hotspotsVisible && hoveredPart && renderTooltip(hoveredPart)}
                </div>
              ) : (
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: '#999',
                  fontSize: '16px'
                }}>
                  No diagram image available
                </div>
              )}
            </div>

            {/* Quick Add Buttons Panel for desktop */}
            {!isMobile && Object.keys(partsData).length > 0 && (
              <div style={{
                position: 'absolute',
                right: '8px',
                top: '8px',
                bottom: '8px',
                width: '60px',
                backgroundColor: darkMode ? 'rgba(42, 42, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                border: darkMode ? '2px solid #555' : '2px solid #ddd',
                padding: '8px',
                overflowY: 'auto',
                zIndex: 1500,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                {Object.keys(partsData)
                  .sort((a, b) => {
                    // "*" always comes first
                    if (a === '*') return -1;
                    if (b === '*') return 1;
                    // Sort numerically if both are numbers
                    const aNum = parseInt(a);
                    const bNum = parseInt(b);
                    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
                    return a.localeCompare(b);
                  })
                  .map((partNumber) => {
                    const orderKey = `${diagram.id}-${partNumber}`;
                    const isInOrder = orderList[orderKey];
                    const hasHotspot = Object.values(hotspots).some(h => h.partNumber === partNumber);
                    return (
                      <button
                        key={partNumber}
                        onClick={(e) => {
                          e.stopPropagation();
                          addPartToOrderByNumber(partNumber);
                        }}
                        onMouseEnter={() => setHoveredPart(partNumber)}
                        onMouseLeave={() => setHoveredPart(null)}
                        style={{
                          width: '100%',
                          minHeight: '36px',
                          padding: '6px',
                          backgroundColor: isInOrder ? '#4caf50' : (hoveredPart === partNumber ? '#ff9800' : '#2196f3'),
                          color: 'white',
                          border: hoveredPart === partNumber ? '2px solid #ff6b00' : (hasHotspot ? '2px solid #ffeb3b' : '2px solid transparent'),
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          fontSize: '12px',
                          boxShadow: hoveredPart === partNumber ? '0 2px 8px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.2)',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: hasHotspot ? 1 : 0.7
                        }}
                        title={`Part #${partNumber}${hasHotspot ? ' (Has hotspot)' : ''}`}
                      >
                        {partNumber}
                      </button>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Mobile Quick Add Buttons */}
          {isMobile && Object.keys(partsData).length > 0 && (
            <div style={{
              backgroundColor: darkMode ? '#2a2a2a' : '#fff',
              borderRadius: '8px',
              padding: '8px',
              boxShadow: darkMode ? '0 2px 4px rgba(0,0,0,0.5)' : '0 2px 4px rgba(0,0,0,0.1)',
              border: darkMode ? '1px solid #444' : 'none',
              overflowX: 'auto'
            }}>
              <div style={{
                display: 'flex',
                gap: '8px',
                padding: '4px 0'
              }}>
                {Object.keys(partsData)
                  .sort((a, b) => {
                    // "*" always comes first
                    if (a === '*') return -1;
                    if (b === '*') return 1;
                    // Sort numerically if both are numbers
                    const aNum = parseInt(a);
                    const bNum = parseInt(b);
                    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
                    return a.localeCompare(b);
                  })
                  .map((partNumber) => {
                    const orderKey = `${diagram.id}-${partNumber}`;
                    const isInOrder = orderList[orderKey];
                    const hasHotspot = Object.values(hotspots).some(h => h.partNumber === partNumber);
                    return (
                      <button
                        key={partNumber}
                        onClick={(e) => {
                          e.stopPropagation();
                          addPartToOrderByNumber(partNumber);
                        }}
                        style={{
                          minWidth: '50px',
                          height: '44px',
                          padding: '8px 12px',
                          backgroundColor: isInOrder ? '#4caf50' : '#2196f3',
                          color: 'white',
                          border: hasHotspot ? '2px solid #ffeb3b' : 'none',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          fontSize: '14px',
                          flexShrink: 0,
                          opacity: hasHotspot ? 1 : 0.7
                        }}
                      >
                        {partNumber}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Order List */}
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            borderRadius: '8px',
            padding: '20px',
            boxShadow: darkMode ? '0 2px 4px rgba(0,0,0,0.5)' : '0 2px 4px rgba(0,0,0,0.1)',
            border: darkMode ? '1px solid #444' : 'none',
            maxHeight: isMobile ? '500px' : '800px',
            overflow: 'auto'
          }}>
            <h2 style={{
              margin: '0 0 16px 0',
              color: darkMode ? '#fff' : '#333',
              fontSize: '18px'
            }}>Parts Order List (All Diagrams)</h2>

            {Object.keys(orderList).length === 0 ? (
              <p style={{
                color: darkMode ? '#888' : '#999',
                fontSize: '14px',
                fontStyle: 'italic'
              }}>
                No parts in order. Click on parts to add them to your order.
              </p>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '16px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#4caf50', color: 'white' }}>
                      <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ddd' }}>Part #</th>
                      <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ddd' }}>Code</th>
                      <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ddd' }}>Part Name</th>
                      <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ddd' }}>From</th>
                      <th style={{ padding: '8px', textAlign: 'center', border: '1px solid #ddd' }}>Qty</th>
                      <th style={{ padding: '8px', textAlign: 'center', border: '1px solid #ddd' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(orderList)
                      .map((orderKey) => {
                        const item = orderList[orderKey];
                        return (
                          <tr key={orderKey} style={{ backgroundColor: darkMode ? '#333' : '#f9f9f9' }}>
                            <td style={{ padding: '8px', border: '1px solid #ddd', fontWeight: 'bold', color: darkMode ? '#fff' : '#000' }} title={item.partName || ''}>
                              {item.partNumber}
                            </td>
                            <td style={{ padding: '8px', border: '1px solid #ddd', fontSize: '11px', color: darkMode ? '#fff' : '#000' }} title={item.partName || ''}>
                              {item.partCode}
                            </td>
                            <td style={{ padding: '8px', border: '1px solid #ddd', fontSize: '11px', color: darkMode ? '#fff' : '#000' }} title={item.partName || ''}>
                              {item.partName || ''}
                            </td>
                            <td style={{ padding: '8px', border: '1px solid #ddd', fontSize: '10px' }}>
                              <span
                                onClick={() => {
                                  if (onNavigateToDiagram && item.diagramId) {
                                    onNavigateToDiagram(item.diagramId);
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                  }
                                }}
                                style={{
                                  cursor: onNavigateToDiagram ? 'pointer' : 'default',
                                  color: onNavigateToDiagram ? (darkMode ? '#64b5f6' : '#1565c0') : (darkMode ? '#aaa' : '#666'),
                                  textDecoration: onNavigateToDiagram ? 'underline' : 'none',
                                  fontStyle: 'italic'
                                }}
                              >
                                {item.diagramNumber ? (
                                  <>
                                    <span style={{ fontWeight: 'bold', fontStyle: 'normal' }}>
                                      {item.diagramNumber}
                                    </span>
                                    {' - '}
                                    {item.diagramName}
                                  </>
                                ) : (
                                  item.diagramName
                                )}
                              </span>
                            </td>
                            <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>
                              <input
                                type="number"
                                min="1"
                                value={item.orderQty}
                                onChange={(e) => updateOrderQty(orderKey, e.target.value)}
                                onBlur={(e) => handleQuantityBlur(orderKey, e.target.value)}
                                style={{
                                  width: '50px',
                                  padding: '4px',
                                  textAlign: 'center',
                                  border: '1px solid #ccc',
                                  borderRadius: '4px',
                                  backgroundColor: darkMode ? '#444' : '#fff',
                                  color: darkMode ? '#fff' : '#000'
                                }}
                              />
                            </td>
                            <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>
                              <button
                                onClick={() => removeFromOrder(orderKey)}
                                style={{
                                  backgroundColor: '#f44336',
                                  color: 'white',
                                  border: 'none',
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '11px'
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>

                {/* Clear All Button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                  <button
                    onClick={() => {
                      if (window.confirm('Are you sure you want to clear all items from your order?')) {
                        setOrderList({});
                      }
                    }}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#f44336',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '13px'
                    }}
                  >
                    🗑️ Clear All
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Complete Parts Reference */}
          {Object.keys(partsData).length > 0 && (
            <div style={{
              backgroundColor: darkMode ? '#2a2a2a' : '#fff',
              borderRadius: '8px',
              padding: '20px',
              boxShadow: darkMode ? '0 2px 4px rgba(0,0,0,0.5)' : '0 2px 4px rgba(0,0,0,0.1)',
              border: darkMode ? '1px solid #444' : 'none',
              marginTop: '20px'
            }}>
              <div
                onClick={() => setShowPartsReference(!showPartsReference)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  marginBottom: showPartsReference ? '16px' : '0'
                }}
              >
                <h2 style={{
                  margin: 0,
                  color: darkMode ? '#fff' : '#333',
                  fontSize: '18px'
                }}>
                  {showPartsReference ? '▼' : '▶'} Complete Parts Reference
                </h2>
                <div style={{
                  fontSize: '13px',
                  color: darkMode ? '#aaa' : '#666'
                }}>
                  {Object.keys(partsData).length} parts
                </div>
              </div>

              {showPartsReference && (
                <>
                  <div style={{
                    marginBottom: '12px',
                    fontSize: '13px',
                    color: darkMode ? '#aaa' : '#666'
                  }}>
                    <strong>Total QTY:</strong> {Object.values(partsData).reduce((sum, part) => sum + parseInt(part.qty || 0), 0)}
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#2196f3', color: 'white' }}>
                          <th style={{
                            padding: '10px',
                            textAlign: 'left',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd'
                          }}>NO</th>
                          <th style={{
                            padding: '10px',
                            textAlign: 'left',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd'
                          }}>Part Code</th>
                          <th style={{
                            padding: '10px',
                            textAlign: 'left',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd'
                          }}>Part Name</th>
                          <th style={{
                            padding: '10px',
                            textAlign: 'left',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd'
                          }}>QTY</th>
                          <th style={{
                            padding: '10px',
                            textAlign: 'left',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd'
                          }}>PMST</th>
                          <th style={{
                            padding: '10px',
                            textAlign: 'center',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd'
                          }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(partsData).sort((a, b) => {
                          // "*" always comes first
                          if (a === '*') return -1;
                          if (b === '*') return 1;
                          // Sort numerically if both are numbers
                          const aNum = parseInt(a);
                          const bNum = parseInt(b);
                          if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
                          return a.localeCompare(b);
                        }).map((partNumber) => {
                          const part = partsData[partNumber];
                          const orderKey = `${diagram.id}-${partNumber}`;
                          const isInOrder = orderList[orderKey];
                          return (
                            <tr
                              key={partNumber}
                              style={{
                                backgroundColor: darkMode
                                  ? (isInOrder ? '#1b5e20' : (partNumber % 2 === 0 ? '#333' : '#3a3a3a'))
                                  : (isInOrder ? '#c8e6c9' : (partNumber % 2 === 0 ? '#f9f9f9' : 'white'))
                              }}
                            >
                              <td style={{
                                padding: '8px',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                fontWeight: isInOrder ? 'bold' : 'normal',
                                color: darkMode ? '#fff' : '#000'
                              }}>{partNumber}</td>
                              <td style={{
                                padding: '8px',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                color: darkMode ? '#fff' : '#000'
                              }}>{part.partCode || ''}</td>
                              <td style={{
                                padding: '8px',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                color: darkMode ? '#fff' : '#000'
                              }}>{part.partName || ''}</td>
                              <td style={{
                                padding: '8px',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                color: darkMode ? '#fff' : '#000'
                              }}>{part.qty || ''}</td>
                              <td style={{
                                padding: '8px',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                color: darkMode ? '#fff' : '#000'
                              }}>{part.pmst || ''}</td>
                              <td style={{
                                padding: '8px',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                textAlign: 'center'
                              }}>
                                {isInOrder ? (
                                  <button
                                    onClick={() => removeFromOrder(orderKey)}
                                    style={{
                                      padding: '6px 12px',
                                      backgroundColor: '#f44336',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontSize: '11px',
                                      fontWeight: 'bold'
                                    }}
                                  >
                                    Remove
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => addPartToOrderByNumber(partNumber)}
                                    style={{
                                      padding: '6px 12px',
                                      backgroundColor: '#2196f3',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontSize: '11px',
                                      fontWeight: 'bold'
                                    }}
                                  >
                                    Add to Order
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InteractiveDiagramViewer;

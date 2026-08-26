import React, { useState, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set up the worker
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const InteractiveDiagram = ({ diagram, onHotspotsUpdate, onPartsDataUpdate, onRotationUpdate, globalOrderList, setGlobalOrderList, allDiagrams, darkMode }) => {
  const [hoveredPart, setHoveredPart] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [pageWidth, setPageWidth] = useState(null); // Will be set after PDF loads
  const [pdfPageInfo, setPdfPageInfo] = useState(null); // Store original PDF dimensions
  const orderList = globalOrderList; // Use global order list instead of local state
  const setOrderList = setGlobalOrderList; // Use global setter
  const [editMode, setEditMode] = useState(false);
  const [hotspots, setHotspots] = useState(diagram.hotspots || {});
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
  const [draggedPart, setDraggedPart] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const [editPartsMode, setEditPartsMode] = useState(false);
  const [editablePartsData, setEditablePartsData] = useState(diagram.partsData || {});
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [hotspotsVisible, setHotspotsVisible] = useState(false); // Hidden by default
  const [showOnlyOrdered, setShowOnlyOrdered] = useState(true); // Show only ordered parts by default
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [flashingMode, setFlashingMode] = useState(false);
  const [flashVisible, setFlashVisible] = useState(true);
  const [rotation, setRotation] = useState(diagram.rotation || 0); // Image rotation in degrees (0, 90, 180, 270)
  // Put the drawing in the order PDF with the ordered balloons ringed in red.
  // A part code means nothing standing at a machine; seeing it circled on the
  // assembly does. Remembered across sessions because whoever wants pictures on
  // an order wants them every time.
  const [includeDiagramImages, setIncludeDiagramImages] = useState(() => {
    const saved = localStorage.getItem('partsOrderIncludeDiagrams');
    return saved === null ? true : saved === 'true';
  });
  const pdfContainerRef = useRef(null);
  const flashIntervalRef = useRef(null);

  // Use ref to track the latest hotspots value to avoid stale closures
  const hotspotsRef = useRef(hotspots);

  const partsData = editPartsMode ? editablePartsData : (diagram.partsData || {});

  // Helper function to round positions to avoid floating point inconsistencies
  const roundPosition = (value) => {
    return Math.round(value * 100) / 100;
  };

  // Update ref whenever hotspots change
  useEffect(() => {
    hotspotsRef.current = hotspots;
  }, [hotspots]);

  // Track window resize for responsive layout and update PDF width
  useEffect(() => {
    const handleResize = () => {
      const wasMobile = isMobile;
      const nowMobile = window.innerWidth <= 768;
      setIsMobile(nowMobile);

      // Only recalculate width if we have PDF page info
      if (pdfPageInfo) {
        const newWidth = calculateOptimalWidth(pdfPageInfo);
        setPageWidth(newWidth);
        // Update container dimensions to maintain aspect ratio
        setContainerDimensions({
          width: newWidth,
          height: pdfPageInfo.height * (newWidth / pdfPageInfo.width)
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobile, pdfPageInfo]);

  // Update hotspots when diagram changes
  useEffect(() => {
    setHotspots(diagram.hotspots || {});
    // Don't clear order list when switching diagrams - it's now global!
    setEditMode(false);
    setEditPartsMode(false);
    setEditablePartsData(diagram.partsData || {});
    setRotation(diagram.rotation || 0); // Reset rotation to saved state
    // Reset PDF page info so it recalculates on load
    setPdfPageInfo(null);
    setPageWidth(null);
  }, [diagram.id]);

  // Auto-show hotspots when items are in the order list (only ordered ones)
  useEffect(() => {
    const hasOrderedItems = Object.keys(orderList).some(key => key.startsWith(`${diagram.id}-`));
    if (hasOrderedItems && !hotspotsVisible) {
      setHotspotsVisible(true);
      setShowOnlyOrdered(true); // Keep filter on to show only ordered items
    } else if (!hasOrderedItems && hotspotsVisible && showOnlyOrdered) {
      // If no ordered items and we're showing only ordered, hide hotspots
      setHotspotsVisible(false);
    }
  }, [orderList, diagram.id]);

  // Handle flashing mode interval
  useEffect(() => {
    if (flashingMode) {
      // Start flashing interval (500ms on, 500ms off)
      flashIntervalRef.current = setInterval(() => {
        setFlashVisible(prev => !prev);
      }, 500);

      // Make sure hotspots are visible when flashing mode starts
      if (!hotspotsVisible) {
        setHotspotsVisible(true);
      }
    } else {
      // Clear interval when flashing mode stops
      if (flashIntervalRef.current) {
        clearInterval(flashIntervalRef.current);
        flashIntervalRef.current = null;
      }
      // Reset to visible when stopping
      setFlashVisible(true);
    }

    // Cleanup on unmount
    return () => {
      if (flashIntervalRef.current) {
        clearInterval(flashIntervalRef.current);
      }
    };
  }, [flashingMode]);

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
  };

  const onPageLoadSuccess = (page) => {
    // Store original PDF page dimensions for consistent scaling
    setPdfPageInfo({ width: page.width, height: page.height });

    // Calculate optimal width for current viewport
    const newWidth = calculateOptimalWidth(page);
    setPageWidth(newWidth);
    setContainerDimensions({ width: newWidth, height: page.height * (newWidth / page.width) });
  };

  // Helper function to calculate consistent PDF width
  const calculateOptimalWidth = (page) => {
    const isMobileView = window.innerWidth <= 768;

    if (isMobileView) {
      // On mobile, use exact full width of container
      if (pdfContainerRef.current) {
        return pdfContainerRef.current.offsetWidth;
      }
      return window.innerWidth - 8;
    } else {
      // On desktop, use container width or calculate from viewport
      if (pdfContainerRef.current) {
        const containerWidth = pdfContainerRef.current.offsetWidth;
        return containerWidth;
      } else {
        // Fallback: account for sidebar width
        const availableWidth = window.innerWidth - 460; // 400px sidebar + 60px padding/gap
        return Math.min(page.width, availableWidth);
      }
    }
  };

  const handlePDFClick = (e) => {
    if (!editMode) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const partNumber = prompt(`Enter part number:`);
    if (!partNumber || !partNumber.trim()) {
      return;
    }

    const xPercent = roundPosition((x / rect.width) * 100);
    const yPercent = roundPosition((y / rect.height) * 100);

    // Create unique ID for this hotspot
    const hotspotId = `${partNumber}-${Date.now()}`;

    const newHotspots = {
      ...hotspots,
      [hotspotId]: { x: xPercent, y: yPercent, partNumber }
    };
    setHotspots(newHotspots);
    if (onHotspotsUpdate) {
      onHotspotsUpdate(newHotspots);
    }
  };

  const removeHotspot = (hotspotId) => {
    const newHotspots = { ...hotspots };
    delete newHotspots[hotspotId];
    setHotspots(newHotspots);
    if (onHotspotsUpdate) {
      onHotspotsUpdate(newHotspots);
    }
  };

  const duplicateHotspot = (hotspotId) => {
    const hotspot = hotspots[hotspotId];
    if (!hotspot) return;

    // Create new hotspot slightly offset from the original
    const newHotspotId = `${hotspot.partNumber}-${Date.now()}`;
    const newHotspots = {
      ...hotspots,
      [newHotspotId]: {
        x: roundPosition(hotspot.x + 2),
        y: roundPosition(hotspot.y + 2),
        partNumber: hotspot.partNumber
      }
    };
    setHotspots(newHotspots);
    if (onHotspotsUpdate) {
      onHotspotsUpdate(newHotspots);
    }
  };

  const exportPositions = () => {
    const exportData = {
      diagramName: diagram?.name || 'diagram',
      diagramId: diagram?.id,
      exportDate: new Date().toISOString(),
      hotspotCount: Object.keys(hotspots).length,
      hotspots: hotspots
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = `hotspots_${diagram?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'diagram'}_${Date.now()}.json`;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);

    alert(`Exported ${Object.keys(hotspots).length} hotspot(s) to ${fileName}`);
  };

  const importPositions = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importData = JSON.parse(event.target.result);

        if (!importData.hotspots || typeof importData.hotspots !== 'object') {
          alert('Invalid hotspot file format. Must contain a "hotspots" object.');
          return;
        }

        const confirm = window.confirm(
          `Import ${importData.hotspotCount || Object.keys(importData.hotspots).length} hotspot(s)?\n\n` +
          `This will replace all current hotspots.`
        );

        if (!confirm) return;

        // Update hotspots
        setHotspots(importData.hotspots);
        if (onHotspotsUpdate) {
          onHotspotsUpdate(importData.hotspots);
        }

        alert(`Successfully imported ${Object.keys(importData.hotspots).length} hotspot(s).`);
      } catch (error) {
        console.error('Import error:', error);
        alert('Failed to import hotspots. Invalid file format.\n\nError: ' + error.message);
      }
    };

    reader.readAsText(file);
    // Reset input so same file can be imported again
    e.target.value = '';
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

    // Call the callback to save rotation to parent
    if (onRotationUpdate) {
      onRotationUpdate(newRotation);
    }
  };

  const autoDetectNumbers = async () => {
    if (!diagram.pdfData) {
      alert('No diagram image available for OCR scanning.');
      return;
    }

    const confirm = window.confirm(
      '🔍 Auto-detect part numbers using Google Vision API?\n\n' +
      'This will:\n' +
      '• Scan the diagram image for numbers\n' +
      '• Create hotspots at detected positions\n' +
      '• Add to existing hotspots (won\'t replace)\n\n' +
      'This uses Google Cloud Vision API and may take 5-10 seconds.\n\n' +
      'Continue?'
    );

    if (!confirm) return;

    setOcrLoading(true);
    setOcrProgress(50);

    try {
      console.log('[Google Vision] Starting OCR...');

      // Google Cloud Vision API key from environment variable
      const API_KEY = import.meta.env.VITE_GOOGLE_VISION_API_KEY;

      if (!API_KEY) {
        throw new Error('Google Vision API key not configured. Please add VITE_GOOGLE_VISION_API_KEY to your .env file.');
      }

      // Prepare image data for Google Vision API
      let imageBase64 = diagram.pdfData;

      // If it's a URL, we need to fetch and convert to base64
      if (imageBase64.startsWith('http')) {
        console.log('[Google Vision] Fetching image from URL...');
        const response = await fetch(imageBase64);
        const blob = await response.blob();
        imageBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      }

      // Remove data URL prefix if present
      const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

      console.log('[Google Vision] Sending request to Google Vision API...');
      setOcrProgress(70);

      // Call Google Vision API
      const visionResponse = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                image: {
                  content: base64Data
                },
                features: [
                  {
                    type: 'TEXT_DETECTION',
                    maxResults: 100
                  }
                ]
              }
            ]
          })
        }
      );

      if (!visionResponse.ok) {
        const errorData = await visionResponse.json();
        console.error('[Google Vision] API Error:', errorData);
        throw new Error(`Google Vision API error: ${errorData.error?.message || visionResponse.statusText}`);
      }

      const visionData = await visionResponse.json();
      console.log('[Google Vision] Response received:', visionData);

      setOcrProgress(90);

      if (!visionData.responses || !visionData.responses[0].textAnnotations) {
        console.error('[Google Vision] No text detected');
        throw new Error('No text detected in image. Try a clearer, higher resolution image.');
      }

      const textAnnotations = visionData.responses[0].textAnnotations;
      console.log(`[Google Vision] Found ${textAnnotations.length} text annotations`);

      // Skip first annotation (it's the full text)
      const words = textAnnotations.slice(1);

      // Get actual image dimensions by loading the image
      const img = new Image();
      const imageLoaded = new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageBase64;
      });

      await imageLoaded;
      const imageWidth = img.naturalWidth;
      const imageHeight = img.naturalHeight;

      console.log('[Google Vision] Actual image dimensions:', imageWidth, 'x', imageHeight);

      // Log all detected text for debugging
      console.log('[Google Vision] All detected text:', words.map(w => w.description).join(', '));

      // Filter and process detected numbers
      const detectedNumbers = [];
      const rejectedNumbers = [];

      words.forEach((word, index) => {
        const text = word.description.trim();
        const number = parseInt(text);

        // Calculate position first for filtering
        const vertices = word.boundingPoly.vertices;
        const avgX = vertices.reduce((sum, v) => sum + (v.x || 0), 0) / vertices.length;
        const avgY = vertices.reduce((sum, v) => sum + (v.y || 0), 0) / vertices.length;
        const centerX = (avgX / imageWidth) * 100;
        const centerY = (avgY / imageHeight) * 100;

        // Get bounding box dimensions to filter tiny text
        const width = Math.abs(vertices[1].x - vertices[0].x);
        const height = Math.abs(vertices[2].y - vertices[0].y);
        const minDimension = Math.min(width, height);

        // Only accept numbers that:
        // 1. Are valid integers 1-999
        // 2. Text matches the parsed number exactly (no extra characters)
        // 3. Are not too small (min 8px) - filters out tiny metadata
        // 4. Are in reasonable area (not extreme edges)
        const isValidNumber = number > 0 && number < 1000 && text === number.toString();
        const isLargeEnough = minDimension >= 8;
        const isInValidArea = centerY >= 2 && centerY <= 92 && centerX >= 2 && centerX <= 98;

        if (isValidNumber && isLargeEnough && isInValidArea) {
          console.log(`[Google Vision] ✓ Valid number ${text} at (${centerX.toFixed(1)}%, ${centerY.toFixed(1)}%) size: ${width}x${height}px`);

          // Check if this number already has a hotspot nearby (within 5%)
          const hasNearbyHotspot = Object.values(hotspots).some(h => {
            const distance = Math.sqrt(
              Math.pow(h.x - centerX, 2) + Math.pow(h.y - centerY, 2)
            );
            return h.partNumber === text && distance < 5;
          });

          if (!hasNearbyHotspot) {
            detectedNumbers.push({
              partNumber: text,
              x: roundPosition(centerX),
              y: roundPosition(centerY),
              confidence: 100
            });
          } else {
            console.log(`[Google Vision] Skipping ${text} - already has nearby hotspot`);
          }
        } else if (isValidNumber) {
          const reason = !isLargeEnough ? 'too small' : 'outside valid area';
          rejectedNumbers.push({ text, reason, x: centerX.toFixed(1), y: centerY.toFixed(1), size: `${width}x${height}px` });
          console.log(`[Google Vision] ✗ Ignoring ${text} at (${centerX.toFixed(1)}%, ${centerY.toFixed(1)}%) - ${reason} (${width}x${height}px)`);
        }
      });

      // Log summary of rejected numbers
      if (rejectedNumbers.length > 0) {
        console.log('[Google Vision] Rejected numbers:', rejectedNumbers);
      }

      console.log(`[OCR] Detected ${detectedNumbers.length} new part numbers`);

      if (detectedNumbers.length === 0) {
        alert('No new part numbers detected.\n\nTry:\n• Higher resolution image (300+ DPI)\n• Better contrast/lighting\n• Clearer, larger numbers');
        setOcrLoading(false);
        return;
      }

      // Show confirmation with preview
      const confirmAdd = window.confirm(
        `✅ Detected ${detectedNumbers.length} part number(s):\n\n` +
        detectedNumbers.slice(0, 20).map(n => `• Part #${n.partNumber} (${Math.round(n.confidence)}% confidence)`).join('\n') +
        (detectedNumbers.length > 20 ? `\n... and ${detectedNumbers.length - 20} more` : '') +
        '\n\nAdd these as hotspots?'
      );

      if (confirmAdd) {
        // Add detected numbers as new hotspots
        const newHotspots = { ...hotspots };
        detectedNumbers.forEach((detected, index) => {
          const hotspotId = `ocr-${Date.now()}-${index}`;
          newHotspots[hotspotId] = {
            partNumber: detected.partNumber,
            x: detected.x,
            y: detected.y
          };
        });

        setHotspots(newHotspots);
        if (onHotspotsUpdate) {
          onHotspotsUpdate(newHotspots);
        }

        // Enable hotspots view
        setHotspotsVisible(true);
        setEditMode(true);

        alert(`✅ Added ${detectedNumbers.length} hotspot(s)!\n\nReview and adjust positions as needed, then save the diagram.`);
      }

    } catch (error) {
      console.error('[OCR] Error:', error);
      console.error('[OCR] Error stack:', error.stack);

      let errorMessage = 'OCR failed. Please try again or add hotspots manually.';

      if (error.message) {
        errorMessage += '\n\nError: ' + error.message;
      }

      if (error.message && error.message.includes('CORS')) {
        errorMessage += '\n\nTip: Make sure the image is from the same domain or properly configured for CORS.';
      } else if (error.message && error.message.includes('data structure')) {
        errorMessage += '\n\nTip: Try using a higher quality image (300+ DPI) with clear, well-spaced numbers.';
      }

      alert(errorMessage);
    } finally {
      setOcrLoading(false);
      setOcrProgress(0);
    }
  };

  const handleHotspotMouseDown = (hotspotId, e) => {
    if (editMode) {
      e.stopPropagation();
      setDraggedPart(hotspotId);
      setHasDragged(false); // Reset drag flag

      const rect = e.currentTarget.parentElement.getBoundingClientRect();
      const hotspotPos = hotspots[hotspotId];
      const hotspotX = (hotspotPos.x / 100) * rect.width;
      const hotspotY = (hotspotPos.y / 100) * rect.height;

      setDragOffset({
        x: e.clientX - rect.left - hotspotX,
        y: e.clientY - rect.top - hotspotY
      });
    }
  };

  const handleMouseMove = (e) => {
    if (draggedPart && editMode) {
      setHasDragged(true); // Mark that we've moved

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left - dragOffset.x;
      const y = e.clientY - rect.top - dragOffset.y;

      const xPercent = (x / rect.width) * 100;
      const yPercent = (y / rect.height) * 100;

      // Keep within bounds and round to consistent precision
      const boundedX = roundPosition(Math.max(0, Math.min(100, xPercent)));
      const boundedY = roundPosition(Math.max(0, Math.min(100, yPercent)));

      const newHotspots = {
        ...hotspots,
        [draggedPart]: {
          x: boundedX,
          y: boundedY,
          partNumber: hotspots[draggedPart].partNumber // Preserve partNumber
        }
      };
      setHotspots(newHotspots);
    }
  };

  const handleMouseUp = () => {
    if (draggedPart && editMode) {
      if (onHotspotsUpdate) {
        // Use ref to get the latest hotspots value (avoid stale closure)
        onHotspotsUpdate(hotspotsRef.current);
      }
      setDraggedPart(null);
    }
  };

  // Touch event handlers for mobile support
  const handleTouchStart = (e) => {
    if (!editMode) return;

    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    const partNumber = prompt(`Enter part number:`);
    if (!partNumber || !partNumber.trim()) {
      return;
    }

    const xPercent = (x / rect.width) * 100;
    const yPercent = (y / rect.height) * 100;

    const hotspotId = `${partNumber}-${Date.now()}`;

    const newHotspots = {
      ...hotspots,
      [hotspotId]: { x: xPercent, y: yPercent, partNumber }
    };
    setHotspots(newHotspots);
    if (onHotspotsUpdate) {
      onHotspotsUpdate(newHotspots);
    }
  };

  const handleHotspotTouchStart = (hotspotId, e) => {
    if (editMode) {
      e.stopPropagation();
      e.preventDefault();

      setDraggedPart(hotspotId);
      setHasDragged(false);

      const touch = e.touches[0];
      const rect = e.currentTarget.parentElement.getBoundingClientRect();
      const hotspotPos = hotspots[hotspotId];
      const hotspotX = (hotspotPos.x / 100) * rect.width;
      const hotspotY = (hotspotPos.y / 100) * rect.height;

      setDragOffset({
        x: touch.clientX - rect.left - hotspotX,
        y: touch.clientY - rect.top - hotspotY
      });
    }
  };

  const handleTouchMove = (e) => {
    // Only prevent default if we're dragging a hotspot in edit mode with a single touch
    if (draggedPart && editMode && e.touches.length === 1) {
      e.preventDefault();
      setHasDragged(true);

      const touch = e.touches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left - dragOffset.x;
      const y = touch.clientY - rect.top - dragOffset.y;

      const xPercent = (x / rect.width) * 100;
      const yPercent = (y / rect.height) * 100;

      const boundedX = roundPosition(Math.max(0, Math.min(100, xPercent)));
      const boundedY = roundPosition(Math.max(0, Math.min(100, yPercent)));

      const newHotspots = {
        ...hotspots,
        [draggedPart]: {
          x: boundedX,
          y: boundedY,
          partNumber: hotspots[draggedPart].partNumber
        }
      };
      setHotspots(newHotspots);
    }
    // Allow default behavior for multi-touch (pinch zoom) or when not dragging
  };

  const handleTouchEnd = () => {
    if (draggedPart && editMode) {
      if (onHotspotsUpdate) {
        onHotspotsUpdate(hotspotsRef.current);
      }
      setDraggedPart(null);
    }
  };

  const handleHotspotClick = (hotspotId, e) => {
    const hotspot = hotspots[hotspotId];
    const partNumber = hotspot.partNumber;

    if (editMode) {
      // Don't delete on click if we just dragged
      if (hasDragged) return;

      e.stopPropagation();

      // If Shift key is pressed, duplicate instead of delete
      if (e.shiftKey) {
        duplicateHotspot(hotspotId);
        return;
      }

      const shouldDelete = window.confirm(`Delete hotspot for Part #${partNumber}?`);
      if (shouldDelete) {
        removeHotspot(hotspotId);
      }
      return;
    }

    // Add to order list or increment quantity
    setOrderList(prev => {
      const newList = { ...prev };
      const orderKey = `${diagram.id}-${partNumber}`; // Unique key per diagram+part

      // Check if part exists in partsData, otherwise create a basic entry
      const partInfo = partsData[partNumber] || {
        partCode: '',
        partName: `Part ${partNumber}`,
        qty: '1',
        pmst: '3'
      };

      if (newList[orderKey]) {
        newList[orderKey].orderQty += 1;
      } else {
        newList[orderKey] = {
          ...partInfo,
          partNumber: partNumber,
          orderQty: 1,
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

  const updateOrderQty = (orderKey, qty) => {
    // Allow empty string temporarily while user is typing
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

  // Handle when user leaves the quantity field
  const handleQuantityBlur = (orderKey, qty) => {
    // If empty or 0 when leaving the field, remove the part
    const newQty = parseInt(qty) || 0;
    if (newQty <= 0) {
      removeFromOrder(orderKey);
    } else {
      // Ensure it's a valid number
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
      qty: '1',
      pmst: '3'
    };

    setOrderList(prev => {
      const newList = { ...prev };
      if (newList[orderKey]) {
        newList[orderKey].orderQty += 1;
      } else {
        newList[orderKey] = {
          ...partInfo,
          partNumber: partNumber,
          orderQty: 1,
          diagramId: diagram.id,
          diagramName: diagram.name,
          diagramNumber: diagram.number || ''
        };
      }
      return newList;
    });
  };

  const manuallyAddPart = () => {
    const partNumber = prompt(`Enter part number:`);
    if (!partNumber || !partNumber.trim()) {
      return;
    }

    const qty = prompt(`Enter quantity for Part #${partNumber}:`, '1');
    const orderQty = parseInt(qty) || 1;
    if (orderQty <= 0) return;

    setOrderList(prev => {
      const newList = { ...prev };
      const orderKey = `${diagram.id}-${partNumber}`;

      // Check if part exists in partsData, otherwise create a basic entry
      const partInfo = partsData[partNumber] || {
        partCode: '',
        partName: `Part ${partNumber}`,
        qty: '1',
        pmst: '3'
      };

      if (newList[orderKey]) {
        newList[orderKey].orderQty += orderQty;
      } else {
        newList[orderKey] = {
          ...partInfo,
          partNumber: partNumber,
          orderQty: orderQty,
          diagramId: diagram.id,
          diagramName: diagram.name,
          diagramNumber: diagram.number || ''
        };
      }
      return newList;
    });
  };

  const savePartsData = () => {
    if (onPartsDataUpdate) {
      onPartsDataUpdate(editablePartsData);
    }
    setEditPartsMode(false);
    alert('Parts data saved successfully!');
  };

  const cancelPartsEdit = () => {
    setEditablePartsData(diagram.partsData);
    setEditPartsMode(false);
  };

  const updatePartField = (partNumber, field, value) => {
    setEditablePartsData(prev => ({
      ...prev,
      [partNumber]: {
        ...prev[partNumber],
        [field]: value
      }
    }));
  };

  const deletePartFromReference = (partNumber) => {
    if (!window.confirm(`Delete Part #${partNumber} from the reference? This cannot be undone.`)) {
      return;
    }
    setEditablePartsData(prev => {
      const newData = { ...prev };
      delete newData[partNumber];
      return newData;
    });
  };

  const addNewPart = () => {
    const partNumber = prompt('Enter new part number:');
    if (!partNumber || editablePartsData[partNumber]) {
      if (partNumber) alert('Part number already exists or is invalid.');
      return;
    }

    setEditablePartsData(prev => ({
      ...prev,
      [partNumber]: {
        partCode: '',
        partName: '',
        qty: '1',
        pmst: '3'
      }
    }));
  };

  // The ordered parts, grouped by the diagram they were picked from.
  //
  // Grouped rather than one picture per line item: an order of eight parts off
  // one assembly is one drawing with eight rings, not eight copies of the same
  // drawing. Hotspot coordinates are PERCENTAGES of the image, so a ring placed
  // at those percentages lands on the balloon at any print size.
  //
  // The stored rotation is deliberately ignored here. Hotspot percentages are
  // recorded against the unrotated image (the viewer rotates the image but not
  // the marker layer), so rotating the print would slide every ring off its
  // balloon — exactly the thing this is meant to prevent.
  const orderDiagramSections = () => {
    const byDiagram = new Map();

    Object.keys(orderList).forEach((orderKey) => {
      const item = orderList[orderKey];
      const id = item.diagramId || diagram.id;
      if (!byDiagram.has(id)) byDiagram.set(id, []);
      byDiagram.get(id).push(item);
    });

    return [...byDiagram.entries()].map(([id, items]) => {
      const source = id === diagram.id ? diagram : ((allDiagrams && allDiagrams[id]) || null);
      const image = typeof source?.pdfData === 'string' &&
        (source.pdfData.startsWith('data:image/') || source.pdfData.startsWith('https://'))
        ? source.pdfData
        : '';

      const wanted = new Set(items.map((i) => String(i.partNumber)));
      // Every hotspot for every ordered part: a part can be balloned more than
      // once on one drawing, and ringing an arbitrary first leaves the rest
      // looking un-ordered.
      const spots = Object.values(source?.hotspots || {})
        .filter((h) => wanted.has(String(h.partNumber)));
      const ringed = new Set(spots.map((h) => String(h.partNumber)));

      return {
        id,
        name: items[0]?.diagramName || source?.name || 'Diagram',
        number: items[0]?.diagramNumber || source?.number || '',
        image,
        spots,
        ringed: [...ringed].sort((a, b) => Number(a) - Number(b)),
        // Ordered but not balloned — say so rather than let a missing ring read
        // as "that part isn't on this drawing".
        unringed: [...wanted].filter((n) => !ringed.has(n)).sort((a, b) => Number(a) - Number(b))
      };
    });
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const renderOrderDiagramsHTML = () => {
    const sections = orderDiagramSections();
    if (sections.length === 0) return '';

    return `
          <div class="diagrams">
            <h2>Diagrams — Ordered Parts Circled</h2>
            ${sections.map((section) => `
              <div class="diagram-block">
                <h3>${escapeHtml(section.number ? `${section.number} — ${section.name}` : section.name)}</h3>
                ${section.image ? `
                  <div class="diagram-wrap">
                    <img src="${escapeHtml(section.image)}" alt="${escapeHtml(section.name)}">
                    ${section.spots.map((h) => `
                      <span class="ring" style="left:${h.x}%; top:${h.y}%"></span>
                    `).join('')}
                  </div>
                ` : `
                  <div class="no-image">No image on file for this diagram.</div>
                `}
                <div class="ring-note">
                  ${section.ringed.length
                    ? `Circled in red: ${section.ringed.map((n) => escapeHtml(n)).join(', ')}`
                    : 'None of the ordered parts are balloned on this drawing.'}
                  ${section.unringed.length
                    ? `<br><em>Not balloned on this drawing: ${section.unringed.map((n) => escapeHtml(n)).join(', ')}</em>`
                    : ''}
                </div>
              </div>
            `).join('')}
          </div>
    `;
  };

  const exportOrderToPDF = () => {
    const printWindow = window.open('', '_blank');
    const orderItems = Object.keys(orderList);
    const diagramsHTML = includeDiagramImages ? renderOrderDiagramsHTML() : '';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Parts Order - ${diagram.name}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * {
            box-sizing: border-box;
          }
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
          }
          .header-bar {
            position: sticky;
            top: 0;
            background-color: #2196f3;
            color: white;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            z-index: 1000;
          }
          .header-bar h2 {
            margin: 0;
            font-size: 18px;
          }
          .header-buttons {
            display: flex;
            gap: 10px;
          }
          .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .btn-close {
            background-color: #f44336;
            color: white;
          }
          .btn-print {
            background-color: #4caf50;
            color: white;
          }
          .content {
            padding: 20px;
            max-width: 1600px;
            margin: 0 auto;
            background-color: white;
            min-height: calc(100vh - 60px);
          }
          h1 {
            color: #333;
            border-bottom: 3px solid #2196f3;
            padding-bottom: 10px;
            margin-top: 0;
          }
          .meta {
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
          }
          th {
            background-color: #2196f3;
            color: white;
            font-weight: bold;
          }
          tr:nth-child(even) {
            background-color: #f9f9f9;
          }
          .summary {
            margin-top: 30px;
            padding: 15px;
            background-color: #f0f0f0;
            border-radius: 5px;
          }
          .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            color: #666;
            font-size: 12px;
          }
          .diagrams {
            margin-top: 36px;
          }
          .diagrams h2 {
            font-size: 18px;
            color: #333;
            border-bottom: 2px solid #2196f3;
            padding-bottom: 8px;
          }
          .diagram-block {
            margin-top: 24px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .diagram-block h3 {
            font-size: 15px;
            color: #333;
            margin: 0 0 8px 0;
          }
          /* Shrink-wraps the rendered image, so the percentage-positioned rings
             move with it at any paper or screen size. */
          .diagram-wrap {
            position: relative;
            display: inline-block;
            width: 100%;
            max-width: 760px;
            line-height: 0;
          }
          .diagram-wrap img {
            width: 100%;
            height: auto;
            display: block;
          }
          .ring {
            position: absolute;
            width: 6%;
            aspect-ratio: 1 / 1;
            transform: translate(-50%, -50%);
            border: 3px solid #ff3b30;
            border-radius: 50%;
            box-shadow: 0 0 0 2px rgba(255,255,255,0.85);
            pointer-events: none;
          }
          .ring-note {
            margin-top: 8px;
            font-size: 12px;
            color: #555;
          }
          .no-image {
            padding: 16px;
            border: 1px dashed #ccc;
            color: #888;
            font-size: 13px;
          }
          @media print {
            @page { margin: 0.5in; }
            .header-bar {
              display: none;
            }
            body {
              background-color: white;
              /* Without this the rings print as grey outlines, or not at all. */
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .content {
              padding: 0;
            }
          }
          @media (max-width: 768px) {
            .content {
              padding: 12px;
            }
            th, td {
              padding: 8px;
              font-size: 12px;
            }
            h1 {
              font-size: 24px;
            }
            .meta {
              font-size: 12px;
            }
          }
        </style>
      </head>
      <body>
        <div class="header-bar">
          <h2>📄 Parts Order Preview</h2>
          <div class="header-buttons">
            <button class="btn btn-print" onclick="window.print()">
              🖨️ Print
            </button>
            <button class="btn btn-close" onclick="window.close()">
              ✕ Close
            </button>
          </div>
        </div>

        <div class="content">
          <h1>Parts Order</h1>
          <div class="meta">
            <strong>Diagram:</strong> ${diagram.name}<br>
            ${diagram.number ? `<strong>Diagram #:</strong> ${diagram.number}<br>` : ''}
            <strong>Date:</strong> ${new Date().toLocaleDateString()}<br>
            <strong>Total Items:</strong> ${orderItems.length}
          </div>

          <table>
            <thead>
              <tr>
                <th>Part #</th>
                <th>Part Code</th>
                <th>Part Name</th>
                <th>Diagram #</th>
                <th>Order Qty</th>
              </tr>
            </thead>
            <tbody>
              ${orderItems.map(orderKey => {
                const item = orderList[orderKey];
                return `
                  <tr>
                    <td><strong>${item.partNumber}</strong></td>
                    <td>${item.partCode}</td>
                    <td>${item.partName}</td>
                    <td>${item.diagramNumber || '-'}</td>
                    <td><strong>${item.orderQty}</strong></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <div class="summary">
            <strong>Order Summary:</strong><br>
            Total line items: ${orderItems.length}<br>
            Total parts ordered: ${orderItems.reduce((sum, orderKey) => sum + orderList[orderKey].orderQty, 0)}
          </div>

          ${diagramsHTML}

          <div class="footer">
            Generated by Interactive Parts Diagram Viewer<br>
            ${new Date().toLocaleString()}
          </div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // Save an order to Firestore as well as downloading it.
  //
  // The download stays — these files get mailed and filed — but a file in
  // somebody's Downloads folder is not a record. Stored here, the dashboard can
  // show it against the plant it was ordered for.
  //
  // Best effort: failing to store an order must never cost somebody the export
  // they actually asked for.
  const storeOrder = async (order) => {
    try {
      const { collection, addDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase/config');
      await addDoc(collection(db, 'parts-orders'), {
        ...order,
        source: 'parts-viewer',
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('Order exported but not saved to Firebase:', error);
    }
  };

  // Export order list to JSON file
  const exportOrderListToJSON = () => {
    if (Object.keys(orderList).length === 0) {
      alert('No items in order list to export.');
      return;
    }

    const exportData = {
      exportDate: new Date().toISOString(),
      orderList: orderList,
      metadata: {
        totalItems: Object.keys(orderList).length,
        totalQuantity: Object.values(orderList).reduce((sum, item) => sum + (parseInt(item.orderQty) || 0), 0),
        diagrams: [...new Set(Object.values(orderList).map(item => item.diagramName))]
      }
    };

    // The diagram on screen knows whose it is, which is more than the customer
    // viewer can say — it stores whatever it was showing.
    const items = Object.entries(orderList).map(([orderKey, item]) => ({ orderKey, ...item }));
    storeOrder({
      customer: diagram?.customer || '',
      orderedAt: exportData.exportDate,
      itemCount: items.length,
      totalQuantity: exportData.metadata.totalQuantity,
      diagrams: exportData.metadata.diagrams,
      items,
    });

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `parts-order-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Import order list from JSON file
  const importOrderListFromJSON = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const importedData = JSON.parse(event.target.result);

          // Validate the imported data structure
          if (!importedData.orderList || typeof importedData.orderList !== 'object') {
            alert('Invalid JSON file format. Missing or invalid orderList.');
            return;
          }

          // Ask user if they want to merge or replace
          const shouldMerge = window.confirm(
            'Do you want to merge with existing order list?\n\n' +
            'OK = Merge (add new items, update quantities)\n' +
            'Cancel = Replace (clear existing and load new)'
          );

          if (shouldMerge) {
            // Merge: add new items and update quantities for existing items
            setOrderList(prev => {
              const merged = { ...prev };
              Object.entries(importedData.orderList).forEach(([key, item]) => {
                if (merged[key]) {
                  // Item exists, add quantities (handle empty strings)
                  const existingQty = parseInt(merged[key].orderQty) || 0;
                  const importedQty = parseInt(item.orderQty) || 0;
                  merged[key].orderQty = existingQty + importedQty;
                } else {
                  // New item, add it
                  merged[key] = item;
                }
              });
              return merged;
            });
            alert(`Successfully merged ${Object.keys(importedData.orderList).length} items into order list.`);
          } else {
            // Replace: completely replace the order list
            setOrderList(importedData.orderList);
            alert(`Successfully imported ${Object.keys(importedData.orderList).length} items. Previous order list was replaced.`);
          }
        } catch (error) {
          alert(`Error importing JSON file: ${error.message}`);
        }
      };
      reader.readAsText(file);
    };

    input.click();
  };

  const renderHotspot = (hotspotId) => {
    const hotspot = hotspots[hotspotId];
    if (!hotspot) return null;

    const partNumber = hotspot.partNumber;
    const position = { x: hotspot.x, y: hotspot.y };
    const orderKey = `${diagram.id}-${partNumber}`;
    const isInOrder = orderList[orderKey];
    const isHovered = hoveredPart === partNumber;

    // Detect if device is touch-enabled
    const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    // Keep size consistent between edit and normal mode to prevent visual shifting
    const hotspotSize = isTouchDevice ? '34px' : '28px';

    // Determine visibility: hide if not in order when "show only ordered" is active, or if hotspots are hidden
    const shouldBeVisible = hotspotsVisible && (!showOnlyOrdered || isInOrder);

    // If flashing mode is active, only show when flashVisible is true
    const finalOpacity = flashingMode ? (flashVisible ? 1 : 0) : (shouldBeVisible ? 1 : 0);

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
          backgroundColor: editMode ? 'rgba(255, 152, 0, 0.8)' : (isInOrder ? 'rgba(76, 175, 80, 0.8)' : (isHovered ? 'rgba(255, 200, 0, 0.7)' : 'rgba(33, 150, 243, 0.6)')),
          border: editMode ? '3px solid #e65100' : (isInOrder ? '2px solid #2e7d32' : (isHovered ? '2px solid #ff6b00' : '2px solid #1976d2')),
          cursor: editMode ? (draggedPart === hotspotId ? 'grabbing' : 'grab') : 'pointer',
          zIndex: draggedPart === hotspotId ? 2000 : (isHovered ? 1000 : (isInOrder ? 500 : 100)),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: isTouchDevice ? '11px' : '10px',
          fontWeight: 'bold',
          color: '#fff',
          boxShadow: isHovered ? '0 2px 8px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.2)',
          userSelect: 'none',
          touchAction: editMode ? 'none' : 'auto', // Allow pinch zoom when not in edit mode
          opacity: finalOpacity,
          pointerEvents: 'auto', // Keep hotspots clickable even when hidden
          transition: draggedPart === hotspotId ? 'none' : (flashingMode ? 'none' : 'opacity 0.3s ease, all 0.2s ease')
        }}
        onMouseEnter={() => !draggedPart && setHoveredPart(partNumber)}
        onMouseLeave={() => setHoveredPart(null)}
        onMouseDown={(e) => handleHotspotMouseDown(hotspotId, e)}
        onTouchStart={(e) => handleHotspotTouchStart(hotspotId, e)}
        onClick={(e) => {
          e.stopPropagation();
          handleHotspotClick(hotspotId, e);
        }}
        title={editMode ? `Drag to move, Shift+Click to duplicate, Click to remove Part #${partNumber}` : `Click to add Part #${partNumber} to order`}
      >
        {partNumber}
      </div>
    );
  };

  const renderTooltip = (partNumber) => {
    if (!partNumber || editMode) return null;

    // Check if part exists in partsData, otherwise create a basic entry
    const part = partsData[partNumber] || {
      partCode: 'N/A',
      partName: `Part ${partNumber}`,
      qty: '1'
    };

    // Find any hotspot with this part number
    const hotspotId = Object.keys(hotspots).find(id => hotspots[id].partNumber === partNumber);
    if (!hotspotId) return null;

    const hotspot = hotspots[hotspotId];
    const position = { x: hotspot.x, y: hotspot.y };

    if (!position) return null;

    // Calculate tooltip position
    let tooltipX = position.x + 3;
    let tooltipY = position.y - 10;

    // If too far right, show on left
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
          gap: isMobile ? '8px' : '12px',
          minHeight: isMobile ? '120px' : '90px',
          overflow: 'hidden'
        }}>
          <p style={{
            margin: 0,
            fontSize: isMobile ? '13px' : '14px',
            color: darkMode ? '#ccc' : '#666'
          }}>
            {editMode ? (
              <strong>EDIT MODE: {isMobile ? 'Tap PDF to place hotspots. Drag to move. Tap to delete.' : 'Click PDF to place new hotspots. Drag hotspots to move. Shift+Click to duplicate. Click to delete.'}</strong>
            ) : (
              <strong>Instructions:</strong>
            )} {!editMode && (isMobile ? 'Tap circles to add to order.' : 'Click on any numbered circle on the diagram to add it to your parts order list below. Hover over circles to see part details.')}
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
                if (!hotspotsVisible && showOnlyOrdered) {
                  setShowOnlyOrdered(false); // Turn off filter when hiding hotspots
                }
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
              title={hotspotsVisible ? 'Hide hotspots to see diagram clearly' : 'Show hotspots'}
            >
              {hotspotsVisible ? '👁️ Hide Hotspots' : '👁️‍🗨️ Show Hotspots'}
            </button>
            <button
              onClick={() => setFlashingMode(!flashingMode)}
              style={{
                padding: '8px 16px',
                backgroundColor: flashingMode ? '#f44336' : '#ff9800',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px',
                animation: flashingMode ? 'pulse 1s infinite' : 'none'
              }}
              title={flashingMode ? 'Stop flashing hotspots' : 'Flash hotspots on/off to see numbers behind them'}
            >
              {flashingMode ? '⏸️ Stop Flash' : '💫 Flash Hotspots'}
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
              onClick={() => {
                setShowOnlyOrdered(!showOnlyOrdered);
                if (!showOnlyOrdered && !hotspotsVisible) {
                  setHotspotsVisible(true); // Auto-enable hotspots when filtering
                }
              }}
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
              title={showOnlyOrdered ? 'Show all hotspots' : 'Show only ordered parts hotspots'}
            >
              {showOnlyOrdered ? '✓ Ordered Only' : '📋 Show Ordered Only'}
            </button>
            <button
              onClick={() => setEditMode(!editMode)}
              style={{
                padding: '8px 16px',
                backgroundColor: editMode ? '#f44336' : '#ff9800',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
            >
              {editMode ? 'Exit Edit Mode' : 'Edit Positions'}
            </button>
            <button
              onClick={exportPositions}
              style={{
                padding: '8px 16px',
                backgroundColor: '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: editMode ? 'pointer' : 'default',
                fontWeight: 'bold',
                fontSize: '13px',
                visibility: editMode ? 'visible' : 'hidden',
                pointerEvents: editMode ? 'auto' : 'none'
              }}
            >
              📥 Export Hotspots
            </button>
            <label
              style={{
                padding: '8px 16px',
                backgroundColor: '#2196f3',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: editMode ? 'pointer' : 'default',
                fontWeight: 'bold',
                fontSize: '13px',
                visibility: editMode ? 'visible' : 'hidden',
                pointerEvents: editMode ? 'auto' : 'none',
                display: editMode ? 'inline-block' : 'none'
              }}
            >
              📤 Import Hotspots
              <input
                type="file"
                accept=".json"
                onChange={importPositions}
                style={{ display: 'none' }}
              />
            </label>
            <button
              onClick={autoDetectNumbers}
              disabled={ocrLoading}
              style={{
                padding: '8px 16px',
                backgroundColor: ocrLoading ? '#666' : '#9c27b0',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: (editMode && !ocrLoading) ? 'pointer' : 'default',
                fontWeight: 'bold',
                fontSize: '13px',
                visibility: editMode ? 'visible' : 'hidden',
                pointerEvents: editMode ? 'auto' : 'none',
                display: editMode ? 'inline-block' : 'none',
                position: 'relative'
              }}
              title="Use OCR to automatically detect part numbers and create hotspots"
            >
              {ocrLoading ? (
                <>
                  🔄 Scanning... {ocrProgress}%
                </>
              ) : (
                '🔍 Auto-detect Numbers'
              )}
            </button>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 400px',
          gap: isMobile ? '8px' : '20px',
          marginBottom: isMobile ? '16px' : '40px'
        }}>
          {/* PDF Diagram */}
          <div
            ref={pdfContainerRef}
            style={{
              position: 'relative',
              backgroundColor: 'white',
              borderRadius: isMobile ? '0' : '8px', // No border radius on mobile for exact positioning
              overflow: isMobile ? 'auto' : 'hidden', // Allow scrolling on mobile if needed
              boxShadow: isMobile ? 'none' : '0 4px 12px rgba(0,0,0,0.15)', // No shadow on mobile
              cursor: editMode ? (draggedPart ? 'grabbing' : 'crosshair') : 'default',
              touchAction: editMode ? 'none' : 'auto', // Allow pinch zoom when not in edit mode
              minHeight: isMobile ? '500px' : 'auto', // Give PDF space on mobile
              width: '100%', // Ensure full width
              padding: 0, // Remove any padding
              margin: 0 // Remove any margin
            }}
            onClick={handlePDFClick}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              margin: 0,
              padding: 0
            }}>
              {/* Check if pdfData is an image or PDF */}
              {(() => {
                console.log('Diagram pdfData type:', typeof diagram.pdfData);
                if (typeof diagram.pdfData === 'string') {
                  console.log('Diagram pdfData preview:', diagram.pdfData.substring(0, 50));
                }
                // Check if it's a base64 image or a Firebase Storage URL
                const isImage = diagram.pdfData && typeof diagram.pdfData === 'string' &&
                  (diagram.pdfData.startsWith('data:image/') || diagram.pdfData.startsWith('https://'));
                console.log('Is image?', isImage);
                return isImage;
              })() ? (
                // Render as image
                <img
                  src={diagram.pdfData}
                  alt="Diagram"
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                    transform: `rotate(${rotation}deg)`,
                    transformOrigin: 'center center'
                  }}
                  onLoad={(e) => {
                    // Set dimensions for hotspot positioning
                    setPdfPageInfo({
                      width: e.target.naturalWidth,
                      height: e.target.naturalHeight
                    });
                  }}
                />
              ) : typeof diagram.pdfData === 'string' ? (
                // Render as PDF
                <div
                  style={{
                    transform: `rotate(${rotation}deg)`,
                    transformOrigin: 'center center',
                    display: 'inline-block',
                    width: '100%'
                  }}
                >
                  <Document
                    file={diagram.pdfData}
                    onLoadSuccess={onDocumentLoadSuccess}
                    loading={<div style={{ padding: '40px', textAlign: 'center' }}>Loading PDF...</div>}
                    error={<div style={{ padding: '40px', textAlign: 'center', color: 'red' }}>Error loading PDF</div>}
                  >
                    {pageWidth ? (
                      <Page
                        pageNumber={1}
                        width={pageWidth}
                        onLoadSuccess={onPageLoadSuccess}
                      />
                    ) : (
                      <Page
                        pageNumber={1}
                        onLoadSuccess={onPageLoadSuccess}
                      />
                    )}
                  </Document>
                </div>
              ) : !diagram.pdfData || diagram.pdfData === null ? (
                // PDF data is missing - trying to load from backup
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: '#2196f3',
                  fontSize: '16px'
                }}>
                  <div style={{ marginBottom: '10px' }}>⏳ Loading diagram...</div>
                  <div style={{ fontSize: '14px', color: '#666' }}>
                    Attempting to load from cloud backup. If this persists, try re-importing the diagram.
                  </div>
                </div>
              ) : (
                // Invalid data format
                <div style={{ padding: '40px', textAlign: 'center', color: 'orange' }}>
                  Diagram data is corrupted or too large. Please re-upload this diagram.
                </div>
              )}

              {/* Render all hotspots */}
              {Object.keys(hotspots).map((hotspotId) => renderHotspot(hotspotId))}

              {/* Render tooltip for hovered part */}
              {hoveredPart && renderTooltip(hoveredPart)}
            </div>

            {/* Quick Add Buttons Panel - overlayed on the right side for desktop, below PDF on mobile */}
            {!isMobile && !editMode && Object.keys(partsData).length > 0 && (
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
                overflowX: 'hidden',
                zIndex: 1500,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                {/* Get part numbers from partsData instead of hotspots */}
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
                    // Check if this part has a hotspot
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
                        title={`Part #${partNumber}${hasHotspot ? ' (Has hotspot)' : ''} - Click to add to order`}
                      >
                        {partNumber}
                      </button>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Mobile Quick Add Buttons Panel - horizontal scroll below PDF */}
          {isMobile && !editMode && Object.keys(partsData).length > 0 && (
            <div style={{
              backgroundColor: darkMode ? '#2a2a2a' : '#fff',
              borderRadius: '8px',
              padding: '8px',
              boxShadow: darkMode ? '0 2px 4px rgba(0,0,0,0.5)' : '0 2px 4px rgba(0,0,0,0.1)',
              border: darkMode ? '1px solid #444' : 'none',
              marginTop: '0',
              marginBottom: '8px',
              overflowX: 'auto',
              overflowY: 'hidden',
              whiteSpace: 'nowrap'
            }}>
              <div style={{
                display: 'flex',
                gap: '8px',
                padding: '4px 0'
              }}>
                {/* Get part numbers from partsData instead of hotspots */}
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
                    // Check if this part has a hotspot
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
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                          transition: 'all 0.2s ease',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{
                margin: 0,
                color: darkMode ? '#fff' : '#333',
                fontSize: '18px'
              }}>Parts Order List</h2>
              <button
                onClick={manuallyAddPart}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#2196f3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '12px'
                }}
                title="Manually add a part by part number"
              >
                + Add Part
              </button>
            </div>

            {/* Import button - always visible */}
            <div style={{ marginBottom: '16px' }}>
              <button
                onClick={importOrderListFromJSON}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#9c27b0',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '13px'
                }}
              >
                📂 Load Order from JSON
              </button>
            </div>

            {Object.keys(orderList).length === 0 ? (
              <p style={{
                color: darkMode ? '#888' : '#999',
                fontSize: '14px',
                fontStyle: 'italic'
              }}>
                No parts selected. Click on parts in the diagram or use the "+ Add Part" button to add parts to your order.
              </p>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '16px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#4caf50', color: 'white' }}>
                      <th style={{
                        padding: '8px',
                        textAlign: 'left',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd'
                      }}>Part #</th>
                      <th style={{
                        padding: '8px',
                        textAlign: 'left',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd'
                      }}>Code</th>
                      <th style={{
                        padding: '8px',
                        textAlign: 'left',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd'
                      }}>From</th>
                      <th style={{
                        padding: '8px',
                        textAlign: 'center',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd'
                      }}>Unit Qty</th>
                      <th style={{
                        padding: '8px',
                        textAlign: 'center',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd'
                      }}>Order Qty</th>
                      <th style={{
                        padding: '8px',
                        textAlign: 'center',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd'
                      }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(orderList).map((orderKey) => {
                      const item = orderList[orderKey];
                      return (
                        <tr key={orderKey} style={{
                          backgroundColor: darkMode ? '#333' : '#f9f9f9'
                        }}>
                          <td style={{
                            padding: '8px',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd',
                            fontWeight: 'bold',
                            color: darkMode ? '#fff' : '#000'
                          }}>{item.partNumber}</td>
                          <td style={{
                            padding: '8px',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd',
                            fontSize: '11px',
                            color: darkMode ? '#fff' : '#000'
                          }}>{item.partCode}</td>
                          <td style={{
                            padding: '8px',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd',
                            fontSize: '10px',
                            color: darkMode ? '#aaa' : '#666',
                            fontStyle: 'italic'
                          }}>
                            {item.diagramNumber ? (
                              <>
                                <span style={{
                                  color: darkMode ? '#4caf50' : '#2e7d32',
                                  fontWeight: 'bold',
                                  fontStyle: 'normal'
                                }}>{item.diagramNumber}</span>
                                {' - '}
                                {item.diagramName}
                              </>
                            ) : (
                              item.diagramName
                            )}
                          </td>
                          <td style={{
                            padding: '8px',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd',
                            textAlign: 'center',
                            color: darkMode ? '#fff' : '#000',
                            fontWeight: 'bold'
                          }}>
                            {item.qty}
                          </td>
                          <td style={{
                            padding: '8px',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd',
                            textAlign: 'center'
                          }}>
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
                                border: darkMode ? '1px solid #555' : '1px solid #ccc',
                                borderRadius: '4px',
                                backgroundColor: darkMode ? '#444' : '#fff',
                                color: darkMode ? '#fff' : '#000'
                              }}
                            />
                          </td>
                          <td style={{
                            padding: '8px',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd',
                            textAlign: 'center'
                          }}>
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

                {/* Detailed Order Summary */}
                <div style={{
                  borderTop: darkMode ? '2px solid #555' : '2px solid #ddd',
                  paddingTop: '16px'
                }}>
                  <h3 style={{
                    fontSize: '16px',
                    marginBottom: '12px',
                    color: darkMode ? '#fff' : '#333'
                  }}>Order Summary</h3>
                  {Object.keys(orderList).map((orderKey) => {
                    const item = orderList[orderKey];
                    return (
                      <div key={orderKey} style={{
                        marginBottom: '12px',
                        padding: '10px',
                        backgroundColor: darkMode ? '#333' : '#f0f0f0',
                        borderRadius: '6px',
                        fontSize: '11px',
                        color: darkMode ? '#fff' : '#000',
                        border: darkMode ? '1px solid #555' : 'none'
                      }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Part #{item.partNumber}</div>
                        <div><strong>Code:</strong> {item.partCode}</div>
                        <div><strong>Name:</strong> {item.partName}</div>
                        <div><strong>From Diagram:</strong> {item.diagramNumber && (
                          <span style={{
                            color: darkMode ? '#4caf50' : '#2e7d32',
                            fontWeight: 'bold'
                          }}>{item.diagramNumber} - </span>
                        )}
                        <span style={{
                          fontStyle: 'italic',
                          color: darkMode ? '#aaa' : '#666'
                        }}>{item.diagramName}</span></div>
                        <div><strong>Order Quantity:</strong> {item.orderQty}</div>
                      </div>
                    );
                  })}

                  {/* Total Items Summary */}
                  <div style={{
                    marginTop: '16px',
                    padding: '12px',
                    backgroundColor: darkMode ? '#2a2a2a' : '#e3f2fd',
                    borderRadius: '6px',
                    border: darkMode ? '1px solid #555' : '1px solid #2196f3',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: darkMode ? '#fff' : '#333'
                  }}>
                    <div>Total Items: {Object.keys(orderList).length}</div>
                  </div>

                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    color: darkMode ? '#ddd' : '#333'
                  }}>
                    <input
                      type="checkbox"
                      checked={includeDiagramImages}
                      onChange={(e) => {
                        setIncludeDiagramImages(e.target.checked);
                        localStorage.setItem('partsOrderIncludeDiagrams', String(e.target.checked));
                      }}
                    />
                    Include diagrams in the PDF, ordered parts circled in red
                  </label>

                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
                    <button
                      onClick={exportOrderToPDF}
                      style={{
                        flex: 1,
                        minWidth: '140px',
                        padding: '10px',
                        backgroundColor: '#4caf50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '13px'
                      }}
                    >
                      📄 Export to PDF
                    </button>
                    <button
                      onClick={exportOrderListToJSON}
                      style={{
                        flex: 1,
                        minWidth: '140px',
                        padding: '10px',
                        backgroundColor: '#2196f3',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '13px'
                      }}
                    >
                      💾 Save as JSON
                    </button>
                    <button
                      onClick={() => setOrderList({})}
                      style={{
                        flex: 1,
                        minWidth: '140px',
                        padding: '10px',
                        backgroundColor: '#ff9800',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '13px'
                      }}
                    >
                      Clear All
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Complete Parts Reference Table */}
        <div style={{
          backgroundColor: darkMode ? '#2a2a2a' : '#fff',
          borderRadius: '8px',
          padding: '20px',
          boxShadow: darkMode ? '0 2px 4px rgba(0,0,0,0.5)' : '0 2px 4px rgba(0,0,0,0.1)',
          border: darkMode ? '1px solid #444' : 'none'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{
                margin: 0,
                color: darkMode ? '#fff' : '#333'
              }}>Complete Parts Reference</h2>
              <div style={{
                marginTop: '8px',
                fontSize: '13px',
                color: darkMode ? '#aaa' : '#666'
              }}>
                <strong>Total Parts in Diagram:</strong> {Object.keys(partsData).length} |{' '}
                <strong>Total QTY:</strong> {Object.values(partsData).reduce((sum, part) => sum + parseInt(part.qty || 0), 0)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {editPartsMode && (
                <>
                  <button
                    onClick={addNewPart}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#4caf50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '12px'
                    }}
                  >
                    + Add New Part
                  </button>
                  <button
                    onClick={savePartsData}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#2196f3',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '12px'
                    }}
                  >
                    Save Changes
                  </button>
                  <button
                    onClick={cancelPartsEdit}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#999',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '12px'
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
              {!editPartsMode && (
                <>
                  <button
                    onClick={() => setEditPartsMode(true)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#ff9800',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '12px'
                    }}
                  >
                    Edit Parts
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm('Fix all part codes by removing spaces?\n\nExample: "000 - 055 - 6933 - 09" → "000-055-6933-09"')) {
                        const updatedParts = {};
                        Object.entries(partsData).forEach(([partNum, partInfo]) => {
                          updatedParts[partNum] = {
                            ...partInfo,
                            partCode: (partInfo.partCode || '').replace(/\s+/g, '')
                          };
                        });
                        onPartsDataUpdate(updatedParts);
                      }
                    }}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#9c27b0',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '12px'
                    }}
                    title="Remove all spaces from part codes"
                  >
                    Fix Part Codes
                  </button>
                </>
              )}
            </div>
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
                  const isHovered = hoveredPart == partNumber;
                  return (
                    <tr
                      key={partNumber}
                      style={{
                        backgroundColor: darkMode
                          ? (isInOrder ? '#1b5e20' : (isHovered ? '#f57f17' : (partNumber % 2 === 0 ? '#333' : '#3a3a3a')))
                          : (isInOrder ? '#c8e6c9' : (isHovered ? '#fff9c4' : (partNumber % 2 === 0 ? '#f9f9f9' : 'white'))),
                        cursor: editPartsMode ? 'default' : 'pointer',
                        transition: 'background-color 0.2s ease',
                      }}
                      onMouseEnter={() => !editPartsMode && setHoveredPart(parseInt(partNumber))}
                      onMouseLeave={() => setHoveredPart(null)}
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
                      }}>
                        {editPartsMode ? (
                          <input
                            type="text"
                            value={part.partCode}
                            onChange={(e) => updatePartField(partNumber, 'partCode', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '4px',
                              border: darkMode ? '1px solid #555' : '1px solid #ccc',
                              borderRadius: '3px',
                              backgroundColor: darkMode ? '#444' : '#fff',
                              color: darkMode ? '#fff' : '#000'
                            }}
                          />
                        ) : (
                          part.partCode
                        )}
                      </td>
                      <td style={{
                        padding: '8px',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd',
                        color: darkMode ? '#fff' : '#000'
                      }}>
                        {editPartsMode ? (
                          <input
                            type="text"
                            value={part.partName}
                            onChange={(e) => updatePartField(partNumber, 'partName', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '4px',
                              border: darkMode ? '1px solid #555' : '1px solid #ccc',
                              borderRadius: '3px',
                              backgroundColor: darkMode ? '#444' : '#fff',
                              color: darkMode ? '#fff' : '#000'
                            }}
                          />
                        ) : (
                          part.partName
                        )}
                      </td>
                      <td style={{
                        padding: '8px',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd',
                        color: darkMode ? '#fff' : '#000'
                      }}>
                        {editPartsMode ? (
                          <input
                            type="text"
                            value={part.qty}
                            onChange={(e) => updatePartField(partNumber, 'qty', e.target.value)}
                            style={{
                              width: '60px',
                              padding: '4px',
                              border: darkMode ? '1px solid #555' : '1px solid #ccc',
                              borderRadius: '3px',
                              backgroundColor: darkMode ? '#444' : '#fff',
                              color: darkMode ? '#fff' : '#000'
                            }}
                          />
                        ) : (
                          part.qty
                        )}
                      </td>
                      <td style={{
                        padding: '8px',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd',
                        color: darkMode ? '#fff' : '#000'
                      }}>
                        {editPartsMode ? (
                          <input
                            type="text"
                            value={part.pmst}
                            onChange={(e) => updatePartField(partNumber, 'pmst', e.target.value)}
                            style={{
                              width: '60px',
                              padding: '4px',
                              border: darkMode ? '1px solid #555' : '1px solid #ccc',
                              borderRadius: '3px',
                              backgroundColor: darkMode ? '#444' : '#fff',
                              color: darkMode ? '#fff' : '#000'
                            }}
                          />
                        ) : (
                          part.pmst
                        )}
                      </td>
                      <td style={{
                        padding: '8px',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd',
                        textAlign: 'center'
                      }}>
                        {editPartsMode ? (
                          <button
                            onClick={() => deletePartFromReference(partNumber)}
                            style={{
                              backgroundColor: '#f44336',
                              color: 'white',
                              border: 'none',
                              padding: '4px 12px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '11px'
                            }}
                          >
                            Delete
                          </button>
                        ) : (
                          <button
                            onClick={() => addPartToOrderByNumber(partNumber)}
                            style={{
                              backgroundColor: isInOrder ? '#4caf50' : '#2196f3',
                              color: 'white',
                              border: 'none',
                              padding: '4px 12px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '11px'
                            }}
                          >
                            {isInOrder ? 'Add More' : 'Add to Order'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InteractiveDiagram;

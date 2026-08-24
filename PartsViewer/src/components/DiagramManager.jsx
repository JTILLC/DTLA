import React, { useState, useEffect, useRef } from 'react';
import InteractiveDiagram from './InteractiveDiagram';
import PdfToCsvConverter from './PdfToCsvConverter';
import { partsData, partPositions } from '../partsData';
import {
  saveDiagram as saveToFirebase,
  loadDiagram as loadFromFirebase,
  loadAllDiagrams,
  syncDiagramsToFirebase,
  deleteDiagram as deleteFromFirebase,
  repairMissingImageReferences,
  loadDiagramImagesForExport
} from '../firebase/diagramService';
import {
  saveDiagramsToIndexedDB,
  loadDiagramsFromIndexedDB,
  loadSingleDiagramFromIndexedDB,
  deleteDiagramFromIndexedDB
} from '../utils/indexedDBStorage';

const DiagramManager = ({ onLogout }) => {
  const [savedDiagrams, setSavedDiagrams] = useState({});
  const [currentDiagramId, setCurrentDiagramId] = useState(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [manifestImporting, setManifestImporting] = useState(false);

  // Parse a single-space-delimited Ishida-style parts list:
  //   "1 000-146-9411-14 MAIN BODY AS :: 1"
  //   = [partNo] [partCode] [partName...] [qty]
  // Returns a partsData object keyed by partNo (the index number), with
  // each entry shaped to match what the rest of PartsViewer expects:
  // { partNo, partCode, partName, qty, pmst }.
  const parseIshidaPartsList = (text) => {
    if (!text) return {};
    const out = {};
    const PN_RE = /(\d{3}-\d{3}-\d{4}-\d{2})/;
    let fallbackIdx = 0;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(PN_RE);
      if (!m) continue;
      const partCode = m[1];
      const start = line.indexOf(partCode);
      const before = line.slice(0, start).trim();
      const after = line.slice(start + partCode.length).trim();
      const indexMatch = before.match(/^(\d+)/);
      const qtyMatch = after.match(/(\d+)\s*$/);
      let name = qtyMatch ? after.slice(0, qtyMatch.index).trim() : after;
      name = name.replace(/(?:::|:)\s*$/g, '').trim();
      // Use the index number as partNo so it lines up with hotspots that
      // store the visible index ("1", "2", …). If no index is on the line
      // (header / summary row), fall back to a unique key prefixed with H.
      const partNo = indexMatch ? indexMatch[1] : `H${++fallbackIdx}`;
      // If the same partNo appears twice (e.g. multiple parts numbered "1"
      // across rows), keep the first and skip the rest.
      if (out[partNo]) continue;
      out[partNo] = {
        partNo,
        partCode,
        partName: name,
        qty: qtyMatch ? qtyMatch[1] : '',
        pmst: '',
      };
    }
    return out;
  };

  // Import a ManualProcessor JSON manifest. Auto-creates one diagram per
  // Draw No, pre-places hotspots from OCR-detected part-number positions,
  // and stores the parts-list raw text for later parsing. Eliminates the
  // manual "unzip → re-upload PDFs → place every hotspot" workflow.
  const importManualManifest = async (file) => {
    setManifestImporting(true);
    try {
      const text = await file.text();
      const manifest = JSON.parse(text);
      if (!manifest || !Array.isArray(manifest.diagrams)) {
        throw new Error('Manifest is missing a "diagrams" array. Generate it from ManualProcessor → Download JSON for PartsViewer.');
      }
      const customer = manifest.customer || 'General';
      const folder = manifest.folder || 'General';
      let createdCount = 0;
      let hotspotCount = 0;
      const incoming = {};
      manifest.diagrams.forEach((d, idx) => {
        const id = `mfst-${Date.now()}-${idx}`;
        const exploded = (d.explodedViews && d.explodedViews[0]) || null;
        const partsListImages = (d.explodedViews || []).slice(1)
          .map((p) => p.imageData)
          .concat((d.partsLists || []).map((p) => p.imageData))
          .filter(Boolean);
        // Parse the parts-list text *during* import using the same parser
        // PartsViewer uses for CSV uploads. That way names + quantities are
        // already filled in by the time the diagram opens — no separate
        // "import parts list" step required.
        const partsListText = (d.partsLists || [])
          .map((p) => p.extractedText || '')
          .filter(Boolean)
          .join('\n');
        let partsData = {};
        if (partsListText.trim()) {
          try {
            partsData = parsePartsCSV(partsListText) || {};
          } catch (err) {
            console.warn('[importManualManifest] parsePartsCSV failed:', err);
            partsData = {};
          }
          // Fallback for Ishida-style single-space-delimited lists, which the
          // generic CSV parser doesn't recognize.
          if (Object.keys(partsData).length < 2) {
            const ish = parseIshidaPartsList(partsListText);
            if (Object.keys(ish).length > Object.keys(partsData).length) {
              console.log(`[importManualManifest] Ishida parser found ${Object.keys(ish).length} parts (CSV parser found ${Object.keys(partsData).length})`);
              partsData = ish;
            }
          }
        }

        // InteractiveDiagram expects:
        //   hotspots:  { '<partNo>-<unique>' : { x, y, partNumber } }   x/y in PERCENT (0..100)
        //   partsData: { '<partNo>'           : { partNo, partCode, partName, qty, pmst } }
        // The hotspot's `partNumber` field holds the index number visible on
        // the diagram ("1", "2", …) — that's the key used to look up parts.
        const hotspots = {};
        (d.hotspots || []).forEach((hs, hi) => {
          const partNo = String(hs.partNumber || '').trim();
          if (!partNo) return;
          const hotspotId = `${partNo}-mfst-${hi}`;
          hotspots[hotspotId] = {
            x: Math.round(hs.x * 10000) / 100, // 0..1 fraction → 0..100 percent, 2 dp
            y: Math.round(hs.y * 10000) / 100,
            partNumber: partNo,
          };
          // Only add a placeholder if the parts-list parse missed this index.
          if (!partsData[partNo]) {
            partsData[partNo] = {
              partNo,
              partCode: '',
              partName: '',
              qty: '',
              pmst: '',
            };
          }
          hotspotCount += 1;
        });
        incoming[id] = {
          id,
          name: d.name || d.drawNo || `Diagram ${idx + 1}`,
          number: d.drawNo || '',
          pdfData: exploded ? exploded.imageData : null,
          partsData,
          partsListImages,
          hotspots,
          partsListRawText: (d.partsLists || []).map((p) => p.extractedText || '').join('\n\n---\n\n'),
          folder,
          customer,
          createdAt: new Date().toISOString(),
          source: 'manual-processor-manifest',
          manifestVersion: manifest.version || 1,
        };
        createdCount += 1;
      });

      setSavedDiagrams((prev) => ({ ...prev, ...incoming }));
      try {
        await saveDiagramsToIndexedDB({ ...savedDiagrams, ...incoming });
      } catch (e) {
        console.warn('[importManualManifest] IndexedDB save failed:', e);
      }
      // Sync to Firebase one at a time (keeps the size error handling local).
      let synced = 0;
      for (const [id, diagram] of Object.entries(incoming)) {
        try {
          await saveToFirebase(id, diagram);
          synced += 1;
        } catch (e) {
          console.warn(`[importManualManifest] Firebase save failed for ${id}:`, e?.message || e);
        }
      }
      const totalParts = Object.values(incoming).reduce(
        (acc, d) => acc + Object.keys(d.partsData || {}).length,
        0,
      );
      const noHotspotsNote = hotspotCount === 0
        ? `\n\n⚠️ No hotspots were pre-placed. The exploded-view PDF pages had no embedded text (likely scanned).\n` +
          `Open each diagram and click "Auto-detect numbers" (Google Vision OCR) to place hotspots automatically.`
        : '';
      alert(
        `Imported manifest: ${createdCount} diagrams, ${totalParts} parts parsed, ${hotspotCount} hotspots pre-placed.\n` +
        `Synced ${synced} of ${createdCount} to Firebase.\n\n` +
        `Customer: ${customer}\nFolder: ${folder}` +
        noHotspotsNote
      );
    } catch (error) {
      console.error('[importManualManifest] Import failed:', error);
      alert(`Failed to import manifest: ${error.message}`);
    } finally {
      setManifestImporting(false);
    }
  };
  const [showPartsReview, setShowPartsReview] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  const [ocrProgress, setOcrProgress] = useState(null);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [collapsedCustomers, setCollapsedCustomers] = useState({});
  const [showFolderManager, setShowFolderManager] = useState(false);
  const [showCustomerManager, setShowCustomerManager] = useState(false);
  const [globalOrderList, setGlobalOrderList] = useState({});
  const [currentView, setCurrentView] = useState('viewer'); // 'viewer' or 'pdf-converter'
  const [importedCsvData, setImportedCsvData] = useState(null);
  const [firebaseEnabled, setFirebaseEnabled] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [showFirebaseManager, setShowFirebaseManager] = useState(false);
  const [firebaseDiagrams, setFirebaseDiagrams] = useState([]);
  const [darkMode, setDarkMode] = useState(true); // Default to dark mode ON
  const [selectedCustomer, setSelectedCustomer] = useState('All Customers');
  const [showDiagramBookForm, setShowDiagramBookForm] = useState(false);
  const [diagramBookText, setDiagramBookText] = useState('');
  const [editingDiagram, setEditingDiagram] = useState(null);
  const [showDiagramSelector, setShowDiagramSelector] = useState(false);
  const [pendingCsvData, setPendingCsvData] = useState(null);
  const [isLoadingHeavy, setIsLoadingHeavy] = useState(false); // Loading overlay for heavy operations
  const [skipLocalStorageSync, setSkipLocalStorageSync] = useState(false); // Prevent localStorage saves during heavy loads
  const [selectedDiagramIds, setSelectedDiagramIds] = useState(new Set()); // For bulk delete
  const [showTocRenamer, setShowTocRenamer] = useState(false); // TOC Quick Rename modal
  const [tocText, setTocText] = useState(''); // Table of contents text
  const [tocEntries, setTocEntries] = useState([]); // Parsed TOC entries
  const [tocMappings, setTocMappings] = useState({}); // Map TOC index to diagram ID
  const [tocSelectedFolder, setTocSelectedFolder] = useState(''); // Folder filter for TOC renaming
  const [showPartsListReview, setShowPartsListReview] = useState(false); // Parts list PDF review modal
  const [partsListData, setPartsListData] = useState(null); // Parsed parts list data
  const [partsListSourceFile, setPartsListSourceFile] = useState(null); // Source file for parts list (to store as image)
  const [tocSelectedCustomer, setTocSelectedCustomer] = useState(''); // Customer filter for TOC renaming
  const [showHelp, setShowHelp] = useState(false); // Help modal
  const [showBulkImageUpload, setShowBulkImageUpload] = useState(false); // Bulk image upload modal
  const [bulkImageFiles, setBulkImageFiles] = useState([]); // Array of {file, matchedDiagramId, confidence}
  const [bulkUploadFolder, setBulkUploadFolder] = useState(''); // Folder filter for bulk upload
  const [bulkUploadCustomer, setBulkUploadCustomer] = useState(''); // Customer for bulk upload
  const [bulkUploadZipMode, setBulkUploadZipMode] = useState(false); // ZIP mode vs individual files
  const [bulkUploadTocText, setBulkUploadTocText] = useState(''); // TOC text for ZIP upload
  const [showPartsDebugModal, setShowPartsDebugModal] = useState(false); // Parts extraction debug modal
  const [partsDebugData, setPartsDebugData] = useState(null); // Data for debugging parts extraction
  const [showStorageDiagnostic, setShowStorageDiagnostic] = useState(false); // Storage diagnostic modal
  const [diagnosticData, setDiagnosticData] = useState(null); // Diagnostic results
  const [fixingStorage, setFixingStorage] = useState(false); // Currently fixing storage issues
  const [showQuickStartWizard, setShowQuickStartWizard] = useState(false); // Quick start wizard
  const [wizardStep, setWizardStep] = useState(1); // Current wizard step
  const [wizardData, setWizardData] = useState({
    customer: '',
    folder: '',
    tocText: '',
    diagramCount: 0,
    createdDiagramIds: []
  }); // Wizard data
  const [showPartsListSource, setShowPartsListSource] = useState(false); // Show parts list source images

  // Ref for scrolling to diagram viewer
  const diagramViewerRef = useRef(null);

  // Convert old format hotspots to new format
  const migrateHotspots = (hotspots) => {
    const migratedHotspots = {};

    Object.keys(hotspots).forEach(key => {
      const hotspot = hotspots[key];

      // Check if it's old format (key is just a number and no partNumber property)
      if (!hotspot.partNumber && !isNaN(key)) {
        // Old format: convert to new format
        const hotspotId = `${key}-${Date.now()}`;
        migratedHotspots[hotspotId] = {
          x: hotspot.x,
          y: hotspot.y,
          partNumber: key
        };
      } else {
        // Already new format
        migratedHotspots[key] = hotspot;
      }
    });

    return migratedHotspots;
  };

  // Load dark mode preference from localStorage
  useEffect(() => {
    const savedDarkMode = localStorage.getItem('darkMode');
    if (savedDarkMode !== null) {
      setDarkMode(savedDarkMode === 'true');
    }
  }, []);

  // Save dark mode preference to localStorage
  useEffect(() => {
    localStorage.setItem('darkMode', darkMode.toString());
  }, [darkMode]);

  // Load global order list from localStorage on mount
  useEffect(() => {
    const savedOrder = localStorage.getItem('globalOrderList');
    if (savedOrder) {
      setGlobalOrderList(JSON.parse(savedOrder));
    }
  }, []);

  // Save global order list to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('globalOrderList', JSON.stringify(globalOrderList));
  }, [globalOrderList]);

  // Reset parts list source display when changing diagrams
  useEffect(() => {
    setShowPartsListSource(false);
  }, [currentDiagramId]);

  // Load saved diagrams from IndexedDB on mount
  useEffect(() => {
    const initializeDiagrams = async () => {
      // Try loading from IndexedDB first
      let diagrams = await loadDiagramsFromIndexedDB();

      // Fallback to localStorage if IndexedDB is empty (migration path)
      if (Object.keys(diagrams).length === 0) {
        const saved = localStorage.getItem('savedDiagrams');
        if (saved) {
          try {
            diagrams = JSON.parse(saved);
            console.log('[Storage] Migrating from localStorage to IndexedDB');
            // Save to IndexedDB and clear localStorage
            await saveDiagramsToIndexedDB(diagrams);
            localStorage.removeItem('savedDiagrams');
          } catch (error) {
            console.error('[Storage] Error migrating from localStorage:', error);
            diagrams = {};
          }
        }
      }

      if (Object.keys(diagrams).length > 0) {
        // Migrate any old format hotspots and add folder/number/customer fields if missing
        const migratedDiagrams = {};
        Object.keys(diagrams).forEach(diagramId => {
          migratedDiagrams[diagramId] = {
            ...diagrams[diagramId],
            hotspots: migrateHotspots(diagrams[diagramId].hotspots || {}),
            folder: diagrams[diagramId].folder || 'General',
            number: diagrams[diagramId].number || '',
            customer: diagrams[diagramId].customer || 'General',
            section: diagrams[diagramId].section || '',
            unitName: diagrams[diagramId].unitName || '',
            partCode: diagrams[diagramId].partCode || '',
            drawNo: diagrams[diagramId].drawNo || ''
          };
        });

        // Collapse all folders on initial load to reduce render overhead
        const allFolders = {};
        Object.values(migratedDiagrams).forEach(diagram => {
          const customer = diagram.customer || 'General';
          const folder = diagram.folder || 'General';
          const folderKey = `${customer}-${folder}`;
          allFolders[folderKey] = true; // All collapsed
        });
        setCollapsedFolders(allFolders);

        setSavedDiagrams(migratedDiagrams);
        // Auto-select first diagram if none selected
        if (!currentDiagramId && Object.keys(migratedDiagrams).length > 0) {
          setCurrentDiagramId(Object.keys(migratedDiagrams)[0]);
        }
      } else {
        // Create default diagram from existing data
        const defaultDiagramId = 'default-wdu-flagstone';
        const defaultDiagram = {
          id: defaultDiagramId,
          name: 'Drive Weigh Unit (4D-33519)',
          number: '4D-33519',
          pdfData: '/SmallWDUFlagstone.pdf',
          partsData: partsData,
          hotspots: migrateHotspots(partPositions),
          folder: 'General',
          createdAt: new Date().toISOString()
        };

        const initialDiagrams = {
          [defaultDiagramId]: defaultDiagram
        };

        setSavedDiagrams(initialDiagrams);
        setCurrentDiagramId(defaultDiagramId);
        await saveDiagramsToIndexedDB(initialDiagrams);
      }
    };

    initializeDiagrams();
  }, []);

  // Save diagrams to IndexedDB whenever they change (unless sync is disabled)
  // IndexedDB has much larger storage limits than localStorage (typically hundreds of MB)
  useEffect(() => {
    if (!skipLocalStorageSync && Object.keys(savedDiagrams).length > 0) {
      // Save asynchronously, don't block UI
      saveDiagramsToIndexedDB(savedDiagrams).catch(error => {
        console.error('[Storage] Error saving diagrams to IndexedDB:', error);
      });
    }
  }, [savedDiagrams, skipLocalStorageSync]);

  // Load PDF on-demand when diagram is selected (for Firebase-loaded diagrams without PDF data)
  // Also clear PDF data from other diagrams to save memory
  useEffect(() => {
    const loadPdfForDiagram = async () => {
      if (!currentDiagramId) {
        console.log('[PDF Loader] No currentDiagramId');
        return;
      }

      const diagram = savedDiagrams[currentDiagramId];
      if (!diagram) {
        console.log('[PDF Loader] No diagram found for ID:', currentDiagramId);
        return;
      }

      console.log('[PDF Loader] Checking diagram:', currentDiagramId, 'Has pdfData:', !!diagram.pdfData);

      // First, clear PDF data from ALL other diagrams to save memory
      // BUT preserve pdfData for diagrams that haven't been saved to Firebase yet
      const clearedDiagrams = {};
      Object.keys(savedDiagrams).forEach(id => {
        if (id !== currentDiagramId) {
          const diagram = savedDiagrams[id];
          // Only clear pdfData if diagram has been saved to Firebase (has pdfStoragePath)
          // OR if pdfData is already an HTTPS URL (already loaded from Firebase)
          const hasFirebaseBackup = diagram.pdfStoragePath ||
                                    (diagram.pdfData && typeof diagram.pdfData === 'string' && diagram.pdfData.startsWith('https://'));

          if (hasFirebaseBackup) {
            // Safe to clear - can be reloaded from Firebase
            const { pdfData, ...diagramWithoutPdf } = savedDiagrams[id];
            clearedDiagrams[id] = diagramWithoutPdf;
          } else {
            // Keep pdfData - not yet backed up to Firebase
            clearedDiagrams[id] = savedDiagrams[id];
          }
        } else {
          clearedDiagrams[id] = savedDiagrams[id];
        }
      });
      console.log('[PDF Loader] Cleared PDF data from', Object.keys(savedDiagrams).length - 1, 'other diagrams');

      // If current diagram doesn't have PDF data, try to load it from IndexedDB first, then Firebase
      if (!diagram.pdfData) {
        console.log('PDF data missing for diagram:', currentDiagramId, 'Attempting to load from IndexedDB...');
        setSyncStatus('Loading PDF...');

        try {
          // Try IndexedDB first (faster, local)
          const indexedDBDiagram = await loadSingleDiagramFromIndexedDB(currentDiagramId);

          if (indexedDBDiagram && indexedDBDiagram.pdfData) {
            console.log('PDF data found in IndexedDB, updating diagram...');
            // Update the diagram with PDF data from IndexedDB
            setSavedDiagrams(prev => ({
              ...clearedDiagrams,
              [currentDiagramId]: {
                ...prev[currentDiagramId],
                pdfData: indexedDBDiagram.pdfData
              }
            }));
            setSyncStatus(null);
          } else {
            // Fall back to Firebase if not in IndexedDB
            console.log('PDF data not in IndexedDB, trying Firebase...');
            setSyncStatus('Loading PDF from cloud...');

            try {
              const fullDiagram = await loadFromFirebase(currentDiagramId);
              console.log('Loaded diagram from Firebase:', fullDiagram);
              if (fullDiagram && fullDiagram.pdfData) {
                console.log('PDF data found in Firebase, updating diagram...');
                // Update the diagram with PDF data
                setSavedDiagrams(prev => ({
                  ...clearedDiagrams,
                  [currentDiagramId]: {
                    ...prev[currentDiagramId],
                    pdfData: fullDiagram.pdfData
                  }
                }));
                setSyncStatus(null);
              } else {
                console.error('No PDF data in loaded diagram');
                // Still clear other diagrams even if load failed
                setSavedDiagrams(clearedDiagrams);
                setSyncStatus('⚠️ PDF not available');
                setTimeout(() => setSyncStatus(null), 3000);
              }
            } catch (error) {
              console.error('Failed to load PDF from Firebase:', error);
              // Still clear other diagrams even if load failed
              setSavedDiagrams(clearedDiagrams);
              setSyncStatus('⚠️ Failed to load PDF');
              setTimeout(() => setSyncStatus(null), 3000);
            }
          }
        } catch (error) {
          console.error('Failed to load PDF from IndexedDB:', error);
          // Still clear other diagrams even if load failed
          setSavedDiagrams(clearedDiagrams);
          setSyncStatus('⚠️ Failed to load PDF');
          setTimeout(() => setSyncStatus(null), 3000);
        }
      } else {
        // Current diagram already has PDF data, just clear others
        setSavedDiagrams(clearedDiagrams);
      }
    };

    loadPdfForDiagram();
  }, [currentDiagramId]);

  // Auto-scroll to diagram viewer when a diagram is selected
  useEffect(() => {
    if (currentDiagramId && diagramViewerRef.current) {
      diagramViewerRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, [currentDiagramId]);

  const handleFileUpload = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);

    const pdfFile = formData.get('pdfFile');
    const partsFile = formData.get('partsFile');
    const diagramName = formData.get('diagramName');
    const diagramNumber = formData.get('diagramNumber');
    let folderName = formData.get('folderSelect');
    let customerName = formData.get('customerSelect');

    // Check if user is creating a new folder
    if (folderName === '__new__') {
      folderName = formData.get('newFolderName');
      if (!folderName || !folderName.trim()) {
        alert('Please provide a name for the new folder');
        return;
      }
    }

    // Check if user is creating a new customer
    if (customerName === '__new__') {
      customerName = formData.get('newCustomerName');
      if (!customerName || !customerName.trim()) {
        alert('Please provide a name for the new customer');
        return;
      }
    }

    // Check required fields
    if (!diagramName || !folderName) {
      alert('Please provide diagram name and folder');
      return;
    }

    // At least one of: pdfFile, partsFile, or importedCsvData must exist
    if (!pdfFile && !partsFile && !importedCsvData) {
      alert('Please provide at least a PDF file or a parts list');
      return;
    }

    try {
      // Read PDF as base64 (if provided)
      let pdfData = null;
      if (pdfFile) {
        pdfData = await fileToBase64(pdfFile);
      }

      let partsData = {};
      let partsListImages = [];

      // Use imported CSV data if available, otherwise parse from file
      if (importedCsvData) {
        // Handle both old format (just partsData) and new format (object with partsData and partsListImages)
        if (importedCsvData.partsData) {
          partsData = importedCsvData.partsData;
          partsListImages = importedCsvData.partsListImages || [];
        } else {
          // Old format - just partsData
          partsData = importedCsvData;
        }
        setImportedCsvData(null); // Clear after use
      } else if (partsFile && partsFile.size > 0) {
        // Read parts file based on type
        let partsText;
        const fileName = partsFile.name.toLowerCase();

        console.log('Processing parts file:', partsFile.name, 'Size:', partsFile.size, 'Type:', partsFile.type);

        if (fileName.endsWith('.pdf')) {
          const result = await extractTextFromPDF(partsFile);

          // If PDF is image-based, use OCR
          if (result.isEmpty) {
            console.log('Image-based PDF detected, running OCR...');
            const ocrResult = await extractTextWithOCR(partsFile);
            partsText = ocrResult.text;
          } else {
            partsText = result.text;
          }
        } else if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
          partsText = await partsFile.text();
        } else {
          throw new Error(`Unsupported parts list format: "${partsFile.name}"\n\nPlease use CSV, TXT, or PDF.\n\nFor DOC/DOCX files, please:\n1. Open in Word/Google Docs\n2. Save As > PDF\n3. Upload the PDF version`);
        }

        partsData = parsePartsCSV(partsText);

        if (Object.keys(partsData).length === 0) {
          console.error('Failed to parse parts. Extracted text was:', partsText);
          throw new Error('No parts data found. Please check your file format.\n\nExpected format:\nPartNo, PartCode, PartName, Qty, PMST\n1, ABC-123, Part Name, 2, 3');
        }
      }
      // If no parts file provided, partsData remains empty {} - which is fine for PDF-only uploads

      // Show review screen instead of immediately creating diagram
      setReviewData({
        diagramName,
        diagramNumber,
        pdfData,
        partsData,
        partsListImages,
        folder: folderName,
        customer: customerName
      });
      setShowUploadForm(false);
      setShowPartsReview(true);

    } catch (error) {
      alert('Error uploading diagram: ' + error.message);
      console.error(error);
    }
  };

  const confirmPartsData = async () => {
    const { diagramName, diagramNumber, pdfData, partsData, partsListImages, folder, customer, isEditing, diagramId } = reviewData;

    if (isEditing) {
      // Update existing diagram
      const updatedDiagram = {
        ...savedDiagrams[diagramId],
        pdfData: pdfData,
        partsData: partsData
      };

      setSavedDiagrams(prev => ({
        ...prev,
        [diagramId]: updatedDiagram
      }));

      // Auto-sync to Firebase
      try {
        setSyncStatus('Saving to Firebase...');
        await saveToFirebase(diagramId, updatedDiagram);
        console.log('[confirmPartsData] Saved updated diagram to Firebase:', diagramId);
        setSyncStatus('✓ Saved to Firebase');
        setTimeout(() => setSyncStatus(null), 2000);
      } catch (error) {
        if (error.isWarning) {
          // Size warning - diagram saved locally with full data, but Firebase has metadata only
          console.warn('[confirmPartsData] Size warning:', error.message);
          setSyncStatus('⚠️ Too large for Firebase (saved locally)');
          setTimeout(() => setSyncStatus(null), 5000);
        } else {
          console.error('[confirmPartsData] Failed to sync to Firebase:', error);
          setSyncStatus('⚠️ Firebase sync failed');
          setTimeout(() => setSyncStatus(null), 3000);
        }
      }

      setEditingDiagram(null);
      setShowPartsReview(false);
      setReviewData(null);

      alert('Diagram updated successfully!');
    } else {
      // Create new diagram
      const newDiagramId = Date.now().toString();

      // Auto-extract diagram number from name if not provided
      let finalDiagramNumber = diagramNumber || '';
      if (!finalDiagramNumber || finalDiagramNumber.trim() === '') {
        const match = diagramName.match(/[A-Z0-9]+-[A-Z0-9]+$/i);
        if (match) {
          finalDiagramNumber = match[0];
          console.log(`Auto-extracted diagram number "${finalDiagramNumber}" from "${diagramName}"`);
        }
      }

      const newDiagram = {
        id: newDiagramId,
        name: diagramName,
        number: finalDiagramNumber,
        pdfData: pdfData,
        partsData: partsData,
        partsListImages: partsListImages || [],
        hotspots: {},
        folder: folder || 'General',
        customer: customer || 'General',
        createdAt: new Date().toISOString()
      };

      setSavedDiagrams(prev => ({
        ...prev,
        [newDiagramId]: newDiagram
      }));

      // Auto-sync to Firebase
      try {
        setSyncStatus('Saving to Firebase...');
        await saveToFirebase(newDiagramId, newDiagram);
        console.log('[confirmPartsData] Saved new diagram to Firebase:', newDiagramId);
        setSyncStatus('✓ Saved to Firebase');
        setTimeout(() => setSyncStatus(null), 2000);
      } catch (error) {
        if (error.isWarning) {
          // Size warning - diagram saved locally with full data, but Firebase has metadata only
          console.warn('[confirmPartsData] Size warning:', error.message);
          setSyncStatus('⚠️ Too large for Firebase (saved locally)');
          setTimeout(() => setSyncStatus(null), 5000);
        } else {
          console.error('[confirmPartsData] Failed to sync to Firebase:', error);
          setSyncStatus('⚠️ Firebase sync failed');
          setTimeout(() => setSyncStatus(null), 3000);
        }
      }

      setCurrentDiagramId(newDiagramId);
      setShowPartsReview(false);
      setReviewData(null);

      const partsCount = Object.keys(partsData).length;
      if (partsCount > 0) {
        alert(`Diagram created successfully!\n${partsCount} parts loaded.`);
      } else {
        alert(`Diagram created successfully!\nNo parts list loaded - you can add parts later.`);
      }
    }
  };

  // Handle editing existing diagram (add/update PDF and parts)
  const handleEditDiagram = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const pdfFile = formData.get('pdfFile');
    const partsFile = formData.get('partsFile');

    // At least one file must be provided
    if (!pdfFile?.size && !partsFile?.size) {
      alert('Please provide at least a PDF or Parts List file');
      return;
    }

    let pdfData = editingDiagram.pdfData;
    let partsData = editingDiagram.partsData || {};

    // Process PDF if provided
    if (pdfFile?.size) {
      try {
        const reader = new FileReader();

        reader.onload = async (event) => {
          try {
            pdfData = event.target.result;

            // Process parts list if provided
            if (partsFile?.size) {
              const text = await partsFile.text();
              const parsed = parsePartsCSV(text);
              partsData = parsed;
            }

            // Show review
            setReviewData({
              diagramId: editingDiagram.id,
              diagramName: editingDiagram.name,
              diagramNumber: editingDiagram.number,
              pdfData,
              partsData,
              folder: editingDiagram.folder,
              customer: editingDiagram.customer,
              isEditing: true
            });
            setShowPartsReview(true);
          } catch (error) {
            console.error('Error processing files:', error);
            alert('Failed to process files: ' + error.message);
          }
        };

        reader.onerror = (error) => {
          console.error('FileReader error:', error);
          alert('Failed to read PDF file. The file may have been moved, deleted, or access was denied.');
        };

        reader.onabort = () => {
          console.error('File read was aborted');
          alert('File read was cancelled.');
        };

        reader.readAsDataURL(pdfFile);
      } catch (error) {
        console.error('Error starting file read:', error);
        alert('Failed to read PDF file: ' + error.message);
      }
    } else if (partsFile?.size) {
      // Only parts list provided
      try {
        const text = await partsFile.text();
        const parsed = parsePartsCSV(text);
        partsData = parsed;

        // Show review
        setReviewData({
          diagramId: editingDiagram.id,
          diagramName: editingDiagram.name,
          diagramNumber: editingDiagram.number,
          pdfData,
          partsData,
          folder: editingDiagram.folder,
          customer: editingDiagram.customer,
          isEditing: true
        });
        setShowPartsReview(true);
      } catch (error) {
        console.error('Error reading parts file:', error);
        alert('Failed to read parts file. The file may have been moved, deleted, or access was denied.');
      }
    }
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      // Validate file before reading
      if (!file || !file.size) {
        reject(new Error('Invalid file or file is empty'));
        return;
      }

      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);

      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        reject(new Error('Failed to read file. The file may have been moved, deleted, or access was denied.'));
      };

      reader.onabort = () => {
        reject(new Error('File read was aborted'));
      };

      try {
        reader.readAsDataURL(file);
      } catch (error) {
        console.error('Error starting file read:', error);
        reject(new Error('Failed to start reading file: ' + error.message));
      }
    });
  };

  const extractTextFromPDF = async (file) => {
    // Validate file before processing
    if (!file || !file.size) {
      throw new Error('Invalid file or file is empty');
    }

    const pdfjs = await import('pdfjs-dist');
    const { getDocument } = pdfjs;

    // Ensure worker is set
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      console.log('Set PDF.js worker source');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const typedArray = new Uint8Array(e.target.result);
          const pdf = await getDocument({
            data: typedArray,
            ignoreEncryption: true
          }).promise;

          console.log('PDF loaded, pages:', pdf.numPages);

          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent({
              includeMarkedContent: true,
              disableNormalization: false
            });

            console.log(`Page ${i} - textContent.items:`, textContent.items.length, 'items');
            if (textContent.items.length > 0) {
              console.log('Sample item:', textContent.items[0]);
            }

            // If no text items found, the PDF might be image-based
            if (textContent.items.length === 0 && i === 1) {
              console.warn('No text items found. This PDF may be image-based (scanned). Please use a CSV or TXT file instead.');
            }

            // Group text items by Y position to reconstruct table rows
            const lines = {};
            textContent.items.forEach((item, idx) => {
              // Check if item has the expected properties
              if (!item.str || !item.transform) {
                console.warn(`Item ${idx} missing str or transform:`, item);
                return;
              }

              const y = Math.round(item.transform[5]); // Y position
              const x = item.transform[4]; // X position

              if (!lines[y]) lines[y] = [];
              lines[y].push({
                x: x,
                text: item.str
              });
            });

            console.log(`Page ${i} - Grouped into ${Object.keys(lines).length} lines`);

            // Sort lines by Y position (top to bottom)
            const sortedY = Object.keys(lines).sort((a, b) => b - a);

            sortedY.forEach(y => {
              // Sort items in each line by X position (left to right)
              const lineItems = lines[y].sort((a, b) => a.x - b.x);
              const lineText = lineItems.map(item => item.text).join(' ');
              if (lineText.trim()) {
                fullText += lineText + '\n';
              }
            });
          }

          // Fix for PDFs with spaces between every character
          // Replace multiple spaces with single space, but preserve intentional spacing
          fullText = fullText.replace(/\s{3,}/g, '  '); // Replace 3+ spaces with 2 spaces (column separator)
          fullText = fullText.replace(/([A-Za-z0-9])\s{1,2}([A-Za-z0-9])/g, '$1$2'); // Remove single/double spaces between alphanumeric chars

          console.log('Extracted PDF text length:', fullText.length);
          console.log('First 1000 chars:', fullText.substring(0, 1000));
          resolve({ text: fullText, isEmpty: fullText.length === 0 });
        } catch (error) {
          console.error('PDF extraction error:', error);
          reject(new Error('Failed to extract text from PDF: ' + error.message));
        }
      };

      reader.onerror = (error) => {
        console.error('FileReader error reading PDF:', error);
        reject(new Error('Failed to read PDF file. The file may have been moved, deleted, or access was denied.'));
      };

      reader.onabort = () => {
        reject(new Error('PDF file read was aborted'));
      };

      try {
        reader.readAsArrayBuffer(file);
      } catch (error) {
        console.error('Error starting PDF file read:', error);
        reject(new Error('Failed to start reading PDF file: ' + error.message));
      }
    });
  };

  const extractTextWithOCR = async (file) => {
    const { createWorker } = await import('tesseract.js');
    const pdfjs = await import('pdfjs-dist');
    const { getDocument } = pdfjs;

    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    }

    return new Promise(async (resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const typedArray = new Uint8Array(e.target.result);
            const pdf = await getDocument({
              data: typedArray,
              ignoreEncryption: true
            }).promise;

            console.log('Running OCR on', pdf.numPages, 'pages...');
            let fullText = '';

            const worker = await createWorker('eng');

            for (let i = 1; i <= pdf.numPages; i++) {
              setOcrProgress(`Processing page ${i} of ${pdf.numPages}...`);

              const page = await pdf.getPage(i);
              const viewport = page.getViewport({ scale: 2.0 });

              const canvas = document.createElement('canvas');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              const ctx = canvas.getContext('2d');

              await page.render({
                canvasContext: ctx,
                viewport: viewport
              }).promise;

              const imageData = canvas.toDataURL('image/png');
              const { data: { text } } = await worker.recognize(imageData);
              fullText += text + '\n';
            }

            await worker.terminate();
            setOcrProgress(null);

            console.log('OCR completed. Extracted text length:', fullText.length);
            resolve({ text: fullText, isEmpty: false });
          } catch (error) {
            setOcrProgress(null);
            reject(error);
          }
        };
        reader.onerror = () => reject(new Error('Failed to read PDF file'));
        reader.readAsArrayBuffer(file);
      } catch (error) {
        setOcrProgress(null);
        reject(error);
      }
    });
  };

  const handleCsvImport = (csvData) => {
    // Convert CSV format to partsData format
    const partsData = {};
    csvData.rows.forEach(row => {
      const partNo = row['NO'];
      if (partNo) {
        partsData[partNo] = {
          partCode: row['PART CODE'] || '',
          partName: row['PART NAME'] || '',
          qty: row['QUANTITY'] || '1',
          pmst: '3' // Default PMST value
        };
      }
    });

    // Extract parts list images if available
    const partsListImages = csvData.partsListImages || [];

    // Check if there are existing diagrams
    const existingDiagrams = Object.keys(savedDiagrams);

    if (existingDiagrams.length === 0) {
      // No existing diagrams, create new
      setImportedCsvData({ partsData, partsListImages });
      setCurrentView('viewer');
      setShowUploadForm(true);
    } else {
      // Show diagram selector modal
      setPendingCsvData({ partsData, partsListImages });
      setShowDiagramSelector(true);
      setCurrentView('viewer');
    }
  };

  const handleSelectDiagramForImport = (diagramId) => {
    if (!pendingCsvData) return;

    const { partsData, partsListImages } = pendingCsvData;

    // Update the existing diagram's parts data and parts list images
    setSavedDiagrams(prev => ({
      ...prev,
      [diagramId]: {
        ...prev[diagramId],
        partsData: {
          ...prev[diagramId].partsData,
          ...partsData // Merge new parts with existing
        },
        partsListImages: partsListImages && partsListImages.length > 0 ? partsListImages : prev[diagramId].partsListImages
      }
    }));

    setCurrentDiagramId(diagramId);
    setShowDiagramSelector(false);
    setPendingCsvData(null);
    alert(`Successfully added ${Object.keys(partsData).length} parts${partsListImages && partsListImages.length > 0 ? ` and ${partsListImages.length} parts list image(s)` : ''} to "${savedDiagrams[diagramId].name}"!`);
  };

  const handleCreateNewDiagramWithImport = () => {
    if (!pendingCsvData) return;

    setImportedCsvData(pendingCsvData);
    setShowDiagramSelector(false);
    setPendingCsvData(null);
    setShowUploadForm(true);
  };

  // Firebase Functions
  const handleSaveToFirebase = async (diagramId) => {
    try {
      setSyncStatus('Saving...');
      let diagram = savedDiagrams[diagramId];

      // If diagram doesn't have pdfData in memory, try to get it from localStorage
      if (!diagram.pdfData) {
        console.log('[handleSaveToFirebase] No pdfData in memory, checking localStorage...');
        const saved = localStorage.getItem('savedDiagrams');
        if (saved) {
          const localDiagrams = JSON.parse(saved);
          if (localDiagrams[diagramId] && localDiagrams[diagramId].pdfData) {
            console.log('[handleSaveToFirebase] Found pdfData in localStorage');
            diagram = {
              ...diagram,
              pdfData: localDiagrams[diagramId].pdfData
            };
          } else {
            console.warn('[handleSaveToFirebase] No pdfData in localStorage either');
            if (!confirm('Warning: This diagram has no image data. Save anyway (metadata only)?')) {
              setSyncStatus(null);
              return;
            }
          }
        }
      }

      await saveToFirebase(diagramId, {
        ...diagram,
        createdAt: diagram.createdAt || Date.now()
      });
      console.log('[handleSaveToFirebase] Manually saved diagram to Firebase:', diagramId);
      setSyncStatus('✓ Saved to Firebase');
      setTimeout(() => setSyncStatus(null), 3000);
      alert('Diagram saved to Firebase successfully!');
    } catch (error) {
      if (error.isWarning) {
        // Size warning - metadata saved, pdfData excluded
        setSyncStatus('⚠️ Too large - metadata only');
        setTimeout(() => setSyncStatus(null), 5000);
        alert(`⚠️ ${error.message}\n\nThe diagram is saved locally with full PDF/image data.\nFirebase has the metadata only (name, parts, hotspots, etc.)`);
      } else {
        setSyncStatus('✗ Save failed');
        console.error('Firebase save error:', error);
        alert('Failed to save to Firebase. Please check your Firebase configuration.\n\nError: ' + error.message);
      }
    }
  };

  const handleLoadFromFirebase = async () => {
    try {
      setIsLoadingHeavy(true); // Show loading overlay
      setSkipLocalStorageSync(true); // Disable localStorage during load
      setSyncStatus('Loading diagrams from Firebase...');
      const diagrams = await loadAllDiagrams();

      if (diagrams.length === 0) {
        alert('No diagrams found in Firebase.');
        setSyncStatus(null);
        setIsLoadingHeavy(false);
        setSkipLocalStorageSync(false);
        return;
      }

      setSyncStatus(`Loading images for ${diagrams.length} diagrams...`);

      // Load images from Firebase Storage and convert to base64 for local IndexedDB
      const { loadDiagramImagesForExport } = await import('../firebase/diagramService');
      const diagramsWithImages = await loadDiagramImagesForExport(diagrams, (current, total) => {
        setSyncStatus(`Loading images: ${current}/${total}...`);
      });

      setSyncStatus(`Processing ${diagramsWithImages.length} diagrams...`);

      // Convert to object with diagram IDs as keys
      const diagramsObj = {};
      diagramsWithImages.forEach(diagram => {
        diagramsObj[diagram.id] = {
          ...diagram,
          // pdfData is now base64, ready for IndexedDB
        };
      });

      // Collapse all folders
      const allFolders = {};
      diagrams.forEach(diagram => {
        const folder = diagram.folder || 'General';
        allFolders[folder] = true; // All collapsed
      });

      setTimeout(() => {
        setCollapsedFolders(allFolders);

        setTimeout(() => {
          // Load all diagrams with images into IndexedDB
          setSavedDiagrams(prev => ({
            ...prev,
            ...diagramsObj
          }));

          setSyncStatus(`✓ Loaded ${diagrams.length} diagrams with images`);

          setTimeout(() => {
            setIsLoadingHeavy(false);
            setSkipLocalStorageSync(false);
            setSyncStatus(null);
          }, 2000);
        }, 300);
      }, 200);

    } catch (error) {
      setIsLoadingHeavy(false); // Clear loading overlay on error
      setSkipLocalStorageSync(false); // Re-enable localStorage sync
      setSyncStatus('✗ Load failed');
      console.error('Firebase load error:', error);
      alert('Failed to load from Firebase. Please check your Firebase configuration.\n\nError: ' + error.message);
    }
  };

  const handleSyncAllToFirebase = async () => {
    if (Object.keys(savedDiagrams).length === 0) {
      alert('No local diagrams to sync.');
      return;
    }

    const confirm = window.confirm(
      `Sync all ${Object.keys(savedDiagrams).length} local diagram(s) to Firebase?\n\nThis will upload all diagrams to your Firebase database.`
    );

    if (!confirm) return;

    try {
      setSyncStatus('Syncing all...');

      // Check localStorage for pdfData if missing in memory
      const saved = localStorage.getItem('savedDiagrams');
      const localDiagrams = saved ? JSON.parse(saved) : {};
      const diagramsToSync = {};

      Object.keys(savedDiagrams).forEach(diagramId => {
        let diagram = savedDiagrams[diagramId];
        // If diagram doesn't have pdfData in memory, try localStorage
        if (!diagram.pdfData && localDiagrams[diagramId]?.pdfData) {
          console.log(`[handleSyncAllToFirebase] Found pdfData in localStorage for ${diagramId}`);
          diagram = {
            ...diagram,
            pdfData: localDiagrams[diagramId].pdfData
          };
        }
        diagramsToSync[diagramId] = diagram;
      });

      await syncDiagramsToFirebase(diagramsToSync);
      setSyncStatus(`✓ Synced ${Object.keys(savedDiagrams).length} diagrams`);
      setTimeout(() => setSyncStatus(null), 3000);
      alert(`Successfully synced ${Object.keys(savedDiagrams).length} diagram(s) to Firebase!`);
    } catch (error) {
      setSyncStatus('✗ Sync failed');
      console.error('Firebase sync error:', error);
      alert('Failed to sync to Firebase. Please check your Firebase configuration.\n\nError: ' + error.message);
    }
  };

  const handleSaveFolderToFirebase = async (customerName, folderName, diagrams) => {
    if (diagrams.length === 0) {
      alert('No diagrams in this folder to save.');
      return;
    }

    try {
      setSyncStatus(`Saving ${customerName} > ${folderName}...`);

      // Convert diagrams array to object format for syncDiagramsToFirebase
      // Check localStorage for pdfData if missing in memory (backup for unsaved diagrams)
      const diagramsToSync = {};
      const saved = localStorage.getItem('savedDiagrams');
      const localDiagrams = saved ? JSON.parse(saved) : {};

      diagrams.forEach(diagram => {
        console.log(`[handleSaveFolderToFirebase] Checking ${diagram.id}:`);
        console.log(`  - Has pdfData: ${!!diagram.pdfData} (type: ${typeof diagram.pdfData})`);
        console.log(`  - Has pdfStoragePath: ${!!diagram.pdfStoragePath} (value: ${diagram.pdfStoragePath})`);

        let diagramToSave = diagram;
        // If diagram doesn't have pdfData in memory, try localStorage
        if (!diagram.pdfData && localDiagrams[diagram.id]?.pdfData) {
          console.log(`[handleSaveFolderToFirebase] Found pdfData in localStorage for ${diagram.id}`);
          diagramToSave = {
            ...diagram,
            pdfData: localDiagrams[diagram.id].pdfData
          };
        }
        diagramsToSync[diagram.id] = diagramToSave;
      });

      await syncDiagramsToFirebase(diagramsToSync);
      setSyncStatus(`✓ Saved ${diagrams.length} diagrams from ${customerName} > ${folderName}`);
      setTimeout(() => setSyncStatus(null), 3000);
      alert(`Successfully saved ${diagrams.length} diagram(s) from "${customerName} > ${folderName}" to Firebase!`);
    } catch (error) {
      setSyncStatus('✗ Save failed');
      console.error('Firebase save error:', error);
      alert('Failed to save folder to Firebase.\n\nError: ' + error.message);
      setTimeout(() => setSyncStatus(null), 3000);
    }
  };

  const handleLoadFolderFromFirebase = async (customerName, folderName) => {
    try {
      setSyncStatus(`Loading ${customerName} > ${folderName}...`);
      const allDiagrams = await loadAllDiagrams();

      // Filter diagrams by customer AND folder
      const folderDiagrams = allDiagrams.filter(diagram =>
        (diagram.customer || 'General') === customerName &&
        (diagram.folder || 'General') === folderName
      );

      if (folderDiagrams.length === 0) {
        alert(`No diagrams found in "${customerName} > ${folderName}" on Firebase.`);
        setSyncStatus(null);
        return;
      }

      // Convert array to object format
      const diagramsObj = {};
      folderDiagrams.forEach(diagram => {
        diagramsObj[diagram.id] = diagram;
      });

      // Collapse the folder to reduce render load
      // Collapse folder first with delay for mobile
      const folderKey = `${customerName}-${folderName}`;
      setTimeout(() => {
        setCollapsedFolders(prev => ({
          ...prev,
          [folderKey]: true
        }));

        // Load diagrams after folder is collapsed
        setTimeout(() => {
          // Merge with existing local diagrams
          setSavedDiagrams(prev => ({
            ...prev,
            ...diagramsObj
          }));

          setSyncStatus(`✓ Loaded ${folderDiagrams.length} from ${customerName} > ${folderName}`);
          setTimeout(() => {
            setSyncStatus(null);
          }, 4000);
        }, 300); // 300ms delay before loading diagrams
      }, 200); // 200ms delay before collapsing folder
    } catch (error) {
      setSyncStatus('✗ Load failed');
      console.error('Firebase load error:', error);
      alert('Failed to load folder from Firebase.\n\nError: ' + error.message);
      setTimeout(() => setSyncStatus(null), 3000);
    }
  };

  const handleOpenFirebaseManager = async () => {
    try {
      setSyncStatus('Loading Firebase files...');
      const diagrams = await loadAllDiagrams();
      setFirebaseDiagrams(diagrams);
      setShowFirebaseManager(true);
      setSyncStatus(null);
    } catch (error) {
      setSyncStatus('✗ Load failed');
      console.error('Firebase load error:', error);
      alert('Failed to load Firebase files. Please check your Firebase configuration.\n\nError: ' + error.message);
      setTimeout(() => setSyncStatus(null), 3000);
    }
  };

  const handleRepairImages = async () => {
    if (!window.confirm('This will scan all diagrams and reconnect them to orphaned images in Firebase Storage.\n\nContinue?')) {
      return;
    }

    try {
      setSyncStatus('Repairing image references...');
      const result = await repairMissingImageReferences();
      setSyncStatus(`✓ Repaired ${result.repaired} of ${result.checked} diagrams`);
      setTimeout(() => setSyncStatus(null), 5000);
      alert(`Repair complete!\n\nChecked: ${result.checked} diagrams\nRepaired: ${result.repaired} diagrams\n\nReload from Firebase to see updated images.`);
    } catch (error) {
      setSyncStatus('✗ Repair failed');
      console.error('Repair error:', error);
      alert('Failed to repair images.\n\nError: ' + error.message);
      setTimeout(() => setSyncStatus(null), 3000);
    }
  };

  const handleDeleteFromFirebase = async (diagramId, diagramName) => {
    const confirm = window.confirm(
      `Delete "${diagramName}" from Firebase?\n\nThis will only delete from cloud storage. Your local copy will remain.`
    );

    if (!confirm) return;

    try {
      await deleteFromFirebase(diagramId);
      // Refresh the list
      const updatedDiagrams = firebaseDiagrams.filter(d => d.id !== diagramId);
      setFirebaseDiagrams(updatedDiagrams);
      alert('Diagram deleted from Firebase successfully!');
    } catch (error) {
      console.error('Firebase delete error:', error);
      alert('Failed to delete from Firebase.\n\nError: ' + error.message);
    }
  };

  const handleExportCustomer = async () => {
    if (selectedCustomer === 'All Customers') {
      alert('Please select a specific customer to export.');
      return;
    }

    // Get all diagrams for the selected customer
    const customerDiagrams = Object.values(savedDiagrams).filter(
      diagram => diagram.customer === selectedCustomer
    );

    if (customerDiagrams.length === 0) {
      alert(`No diagrams found for customer "${selectedCustomer}".`);
      return;
    }

    try {
      // Show loading status
      setSyncStatus(`Loading images for export... 0/${customerDiagrams.length}`);

      // Load all images from Firebase Storage and convert to base64
      const diagramsWithImages = await loadDiagramImagesForExport(
        customerDiagrams,
        (current, total) => {
          setSyncStatus(`Loading images for export... ${current}/${total}`);
        }
      );

      setSyncStatus('Preparing export file...');

      // Create export data
      const exportData = {
        customer: selectedCustomer,
        exportDate: new Date().toISOString(),
        diagramCount: diagramsWithImages.length,
        diagrams: diagramsWithImages
      };

      // Download as JSON
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedCustomer.replace(/[^a-zA-Z0-9]/g, '_')}_diagrams_${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setSyncStatus(`✓ Exported ${diagramsWithImages.length} diagram(s) with images`);
      setTimeout(() => setSyncStatus(null), 3000);

      alert(`Successfully exported ${diagramsWithImages.length} diagram(s) for "${selectedCustomer}" with all images included.`);
    } catch (error) {
      setSyncStatus('✗ Export failed');
      console.error('Export error:', error);
      alert('Failed to export customer data.\n\nError: ' + error.message);
      setTimeout(() => setSyncStatus(null), 3000);
    }
  };

  const handleExportCustomerByName = async (customerName) => {
    // Get all diagrams for the specified customer
    const customerDiagrams = Object.values(savedDiagrams).filter(
      diagram => diagram.customer === customerName
    );

    if (customerDiagrams.length === 0) {
      alert(`No diagrams found for customer "${customerName}".`);
      return;
    }

    try {
      // Show loading status
      setSyncStatus(`Loading images for export... 0/${customerDiagrams.length}`);

      // Load all images from Firebase Storage and convert to base64
      const diagramsWithImages = await loadDiagramImagesForExport(
        customerDiagrams,
        (current, total) => {
          setSyncStatus(`Loading images for export... ${current}/${total}`);
        }
      );

      setSyncStatus('Preparing export file...');

      // Create export data
      const exportData = {
        customer: customerName,
        exportDate: new Date().toISOString(),
        diagramCount: diagramsWithImages.length,
        diagrams: diagramsWithImages
      };

      // Download as JSON
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${customerName.replace(/[^a-zA-Z0-9]/g, '_')}_diagrams_${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setSyncStatus(`✓ Exported ${diagramsWithImages.length} diagram(s) with images`);
      setTimeout(() => setSyncStatus(null), 3000);

      alert(`Successfully exported ${diagramsWithImages.length} diagram(s) for "${customerName}" with all images included.`);
    } catch (error) {
      setSyncStatus('✗ Export failed');
      console.error('Export error:', error);
      alert('Failed to export customer data.\n\nError: ' + error.message);
      setTimeout(() => setSyncStatus(null), 3000);
    }
  };

  const handleImportCustomer = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importData = JSON.parse(event.target.result);

        if (!importData.diagrams || !Array.isArray(importData.diagrams)) {
          alert('Invalid import file format. Must contain diagrams array.');
          return;
        }

        // Ask user for customer name
        const customerName = prompt(
          `Import ${importData.diagramCount || importData.diagrams.length} diagram(s)\n\n` +
          `Enter Customer name:`,
          importData.customer || 'General'
        );

        if (!customerName || !customerName.trim()) {
          alert('Import cancelled - customer name is required.');
          return;
        }

        // Ask user for folder name
        const folderName = prompt(
          `Customer: ${customerName}\n\n` +
          `Enter Folder/Subfolder name:`,
          importData.diagrams[0]?.folder || 'General'
        );

        if (!folderName || !folderName.trim()) {
          alert('Import cancelled - folder name is required.');
          return;
        }

        const confirm = window.confirm(
          `Import ${importData.diagrams.length} diagram(s)?\n\n` +
          `Customer: ${customerName}\n` +
          `Folder: ${folderName}\n\n` +
          `This will add/update diagrams in your local storage.`
        );

        if (!confirm) return;

        console.log(`[Import] Starting import of ${importData.diagrams.length} diagrams to ${customerName} > ${folderName}`);

        // Deep clean function to remove undefined values (but keep empty objects and preserve binary data)
        const deepClean = (obj) => {
          if (obj === null || obj === undefined) return null;
          if (typeof obj !== 'object') return obj;

          if (Array.isArray(obj)) {
            return obj.map(item => deepClean(item)).filter(item => item !== null && item !== undefined);
          }

          const cleaned = {};
          for (const [key, value] of Object.entries(obj)) {
            // Skip undefined values and internal debug fields
            if (value === undefined || key.startsWith('_')) continue;

            // CRITICAL: Preserve pdfData, imageData, and other large string fields without cleaning
            if (key === 'pdfData' || key === 'imageData' || key === 'pdfUrl') {
              if (value) {
                cleaned[key] = value;
                console.log(`[Import] Preserving ${key} (length: ${typeof value === 'string' ? value.length : 'N/A'})`);
              }
              continue;
            }

            if (value === null) {
              cleaned[key] = null;
            } else if (typeof value === 'object') {
              // Clean nested objects but keep empty objects (needed for partsData, hotspots)
              const cleanedValue = deepClean(value);
              // Keep empty objects and arrays
              if (cleanedValue !== null && cleanedValue !== undefined) {
                cleaned[key] = cleanedValue;
              } else if (Array.isArray(value) || Object.keys(value).length === 0) {
                cleaned[key] = value;
              }
            } else {
              cleaned[key] = value;
            }
          }
          return cleaned;
        };

        // Import diagrams
        const newDiagrams = { ...savedDiagrams };
        importData.diagrams.forEach(diagram => {
          // Generate new ID if one doesn't exist
          const diagramId = diagram.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          console.log(`[Import] Processing diagram: ${diagram.name}`);
          console.log(`[Import]   - Has pdfData: ${!!diagram.pdfData}`);
          if (diagram.pdfData) {
            console.log(`[Import]   - pdfData type: ${typeof diagram.pdfData}`);
            console.log(`[Import]   - pdfData length: ${diagram.pdfData.length}`);
            console.log(`[Import]   - pdfData preview: ${diagram.pdfData.substring(0, 50)}`);
          }

          // Clean the diagram before adding
          const cleanDiagram = deepClean({
            ...diagram,
            id: diagramId
          });

          console.log(`[Import]   - After deepClean, has pdfData: ${!!cleanDiagram.pdfData}`);
          if (cleanDiagram.pdfData) {
            console.log(`[Import]   - After deepClean, pdfData length: ${cleanDiagram.pdfData.length}`);
          }

          // Ensure required fields exist with defaults
          newDiagrams[diagramId] = {
            ...cleanDiagram,
            hotspots: cleanDiagram.hotspots || {},
            partsData: cleanDiagram.partsData || {},
            folder: folderName.trim(),
            customer: customerName.trim(),
            name: cleanDiagram.name || 'Untitled',
            number: cleanDiagram.number || '',
            itemNo: cleanDiagram.itemNo || ''
          };

          console.log(`[Import]   - Final diagram has pdfData: ${!!newDiagrams[diagramId].pdfData}`);
        });

        console.log(`[Import] Total diagrams after import: ${Object.keys(newDiagrams).length}`);

        setSavedDiagrams(newDiagrams);
        setSelectedCustomer(customerName.trim());

        alert(`Successfully imported ${importData.diagrams.length} diagram(s) for "${customerName}" in folder "${folderName}".`);
      } catch (error) {
        console.error('Import error:', error);
        alert('Failed to import diagrams. Invalid file format.\n\nError: ' + error.message);
      }
    };
    reader.readAsText(file);

    // Clear the input so the same file can be imported again
    e.target.value = '';
  };

  const handlePartsListPDFUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isPDF = file.type === 'application/pdf';
    const isText = file.type === 'text/plain' || file.name.endsWith('.txt');

    if (!isImage && !isPDF && !isText) {
      alert('Please select a PDF, image, or text file (.pdf, .jpg, .jpeg, .png, .txt)');
      return;
    }

    try {
      let fullText = '';

      if (isText) {
        // Read .txt file directly
        setOcrProgress('Reading text file...');
        fullText = await file.text();
        console.log(`[Parts List Import] Read ${fullText.length} characters from text file`);

      } else if (isImage) {
        // Use OCR for images
        setOcrProgress('Running OCR on image...');

        const imageUrl = URL.createObjectURL(file);

        // Import Tesseract dynamically
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('eng');

        setOcrProgress('Extracting text from image...');
        const { data: { text } } = await worker.recognize(imageUrl);
        await worker.terminate();
        URL.revokeObjectURL(imageUrl);

        fullText = text;
        console.log(`[Parts List Import] OCR extracted ${fullText.length} characters`);

      } else {
        // Use PDF.js for PDFs
        setOcrProgress('Extracting text from PDF...');

        // Load pdf.js library dynamically
        const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        // Read file as array buffer
        const arrayBuffer = await file.arrayBuffer();

        // Load PDF
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, ignoreEncryption: true }).promise;

        // Extract text from first page (assuming parts list is on page 1)
        const page = await pdf.getPage(1);
        const textContent = await page.getTextContent();

        // Combine text items into full text
        fullText = textContent.items.map(item => item.str).join(' ');
      }

      setOcrProgress('Parsing parts list...');

      console.log('[Parts List Import] Extracted text (first 1000 chars):', fullText.substring(0, 1000));
      console.log('[Parts List Import] Total text length:', fullText.length);

      // Parse the extracted text
      const parsed = parsePartsListText(fullText);

      if (parsed.error) {
        setOcrProgress(null);

        // Show extracted text in error for debugging
        const preview = fullText.substring(0, 500);
        alert(`Failed to parse parts list:\n\n${parsed.error}\n\n--- Extracted Text Preview (first 500 chars) ---\n${preview}\n\nCheck browser console for full text.`);
        return;
      }

      // Store the source file for later conversion to image
      setPartsListSourceFile(file);

      // Show review screen
      setPartsListData(parsed);
      setShowPartsListReview(true);
      setOcrProgress(null);

    } catch (error) {
      console.error('Parts list extraction error:', error);
      setOcrProgress(null);
      alert('Failed to extract text from file.\n\nError: ' + error.message);
    }

    e.target.value = '';
  };

  const parsePartsListText = (text, isContinuationPage = false) => {
    try {
      // Extract UNIT NAME and DRAW NO. (only on first page)
      let unitName = '';
      let drawNo = '';

      if (!isContinuationPage) {
        const unitNameMatch = text.match(/UNIT\s+NAME\s+([A-Z0-9\s:]+?)\s+(?:DRAW|NO\.)/i);
        if (unitNameMatch) {
          unitName = unitNameMatch[1].trim();
        }

        const drawNoMatch = text.match(/(?:DRAW|NO\.)\s+NO\.\s+([A-Z0-9-]+)/i);
        if (drawNoMatch) {
          drawNo = drawNoMatch[1].trim();
        }
      }

      // Match both formats: XXX-XXX-XXXX-XX and XXX-XXXX-XX (with optional spaces around dashes)
      const partCodePattern = /\b\d{3}\s*-\s*(?:\d{3}\s*-\s*\d{4}|\d{4})\s*-\s*\d{2}\b/g;
      const partsData = {};

      // Find all part codes in the text
      const partCodeMatches = [...text.matchAll(partCodePattern)];
      console.log(`[Parser] Found ${partCodeMatches.length} part codes in text (formats: XXX-XXX-XXXX-XX or XXX-XXXX-XX)`);

      if (partCodeMatches.length === 0) {
        return { error: 'No parts found in the text. Please check the format.' };
      }

      // Process each part code
      // Format: NO. PART_CODE PART_NAME QTY
      // First part (assembly): ASSEMBLY_NAME PART_CODE (no NO. before it)
      for (let i = 0; i < partCodeMatches.length; i++) {
        const match = partCodeMatches[i];
        const partCode = match[0];
        const codeStartIndex = match.index;
        const codeEndIndex = match.index + partCode.length;

        // Get text BEFORE this part code (for part number)
        const prevMatch = partCodeMatches[i - 1];
        const beforeStartIndex = prevMatch ? (prevMatch.index + prevMatch[0].length) : 0;
        const beforeCode = text.substring(beforeStartIndex, codeStartIndex).trim();

        // Get text AFTER this part code (for part name and quantity)
        const nextMatch = partCodeMatches[i + 1];
        const afterEndIndex = nextMatch ? nextMatch.index : text.length;
        const afterCode = text.substring(codeEndIndex, afterEndIndex).trim();

        let partNumber = '*';
        let qty = '1';
        let partName = '';

        if (i === 0 && !isContinuationPage) {
          // First part (assembly) - name is before the part code, no NO./QTY
          partNumber = '*';
          qty = '1';

          // Extract assembly name from beforeCode, removing header text
          partName = beforeCode
            .replace(/UNIT\s+NAME\s+DRAW\s+NO\.\s+[A-Z0-9-]+/gi, '')
            .replace(/NO\.\s+PART\s+CODE\s+PART\s+NAME\s+QUANT(?:ITY)?/gi, '')
            .trim();

          // Clean up part name
          partName = partName.replace(/::+$/, '').trim();
          partName = partName.replace(/:+$/, '').trim();

          console.log(`[Parser] ✓ Assembly (Part #*): "${partName}" [${partCode}] Qty: ${qty}`);
        } else {
          // Regular part - format is: NO. PART_CODE PART_NAME QTY
          // Part number is in beforeCode, part name and qty are in afterCode

          // Get part number from text before code
          const beforeTokens = beforeCode.split(/\s+/).filter(t => t.length > 0);
          const lastBeforeToken = beforeTokens.length > 0 ? beforeTokens[beforeTokens.length - 1] : null;

          if (!lastBeforeToken || !/^\d+$/.test(lastBeforeToken)) {
            console.log(`[Parser] ✗ Skipping part code ${partCode} - no valid part number before code (got: "${lastBeforeToken}")`);
            continue;
          }

          partNumber = lastBeforeToken;

          // Get part name and quantity from text after code
          const afterTokens = afterCode.split(/\s+/).filter(t => t.length > 0);

          if (afterTokens.length === 0) {
            console.log(`[Parser] ✗ Skipping part code ${partCode} - no data after code`);
            continue;
          }

          // Find the first numeric token from the end working backwards
          // This should be the quantity (second-to-last numeric, as last is next part number)
          let qtyIndex = -1;
          let foundCount = 0;
          for (let j = afterTokens.length - 1; j >= 0; j--) {
            if (/^\d+(\.\d+)?$/.test(afterTokens[j])) {
              foundCount++;
              if (foundCount === 2) {
                // Second numeric token from the end is the quantity
                qtyIndex = j;
                break;
              }
            }
          }

          if (qtyIndex >= 0) {
            qty = afterTokens[qtyIndex];
            partName = afterTokens.slice(0, qtyIndex).join(' ').trim();
          } else {
            // Only one or zero numeric tokens found
            // Look for the first numeric token (might be the only one, which is the qty)
            let firstNumIndex = -1;
            for (let j = 0; j < afterTokens.length; j++) {
              if (/^\d+(\.\d+)?$/.test(afterTokens[j])) {
                firstNumIndex = j;
                break;
              }
            }
            if (firstNumIndex >= 0) {
              qty = afterTokens[firstNumIndex];
              partName = afterTokens.slice(0, firstNumIndex).join(' ').trim();
            } else {
              // No quantity found at all
              partName = afterTokens.join(' ').trim();
              qty = '1';
            }
          }

          // Clean up part name
          partName = partName.replace(/::+$/, '').trim();
          partName = partName.replace(/:+$/, '').trim();

          // Skip if part name is empty or just headers
          if (!partName || /^(NO\.|PART|CODE|NAME|QUANTITY|UNIT|DRAW)$/i.test(partName)) {
            console.log(`[Parser] ✗ Skipping part code ${partCode} - invalid part name: "${partName}"`);
            continue;
          }

          console.log(`[Parser] ✓ Part #${partNumber}: "${partName}" [${partCode}] Qty: ${qty}`);
        }

        partsData[partNumber] = {
          partCode: partCode,
          partName: partName || 'UNNAMED PART',
          qty: qty
        };
      }

      if (Object.keys(partsData).length === 0) {
        return { error: 'No parts found in the text. Please check the format.' };
      }

      console.log(`[Parser] Successfully parsed ${Object.keys(partsData).length} parts`);

      return {
        unitName,
        drawNo,
        partsData
      };

    } catch (error) {
      console.error('Parse error:', error);
      return { error: 'Failed to parse parts list: ' + error.message };
    }
  };

  const handleBulkUploadPartsListImages = async (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    try {
      setOcrProgress(`Processing ${files.length} file(s)...`);

      // Group files by diagram name
      const filesByDiagram = {};

      for (const file of files) {
        // Extract base name from filename
        // Remove extension first
        let baseName = file.name.replace(/\.(pdf|jpg|jpeg|png)$/i, '');
        // Remove -parts, -parts2, -parts3 suffix
        baseName = baseName.replace(/-parts\d*$/i, '');
        // Remove drawing number suffix (e.g., -4D-32819, -4D-44864, etc.)
        baseName = baseName.replace(/-\d+[A-Z]+-\d+$/i, '');

        if (!filesByDiagram[baseName]) {
          filesByDiagram[baseName] = [];
        }
        filesByDiagram[baseName].push(file);
      }

      console.log('[Bulk Parts List Upload] Grouped files by diagram:', Object.keys(filesByDiagram));

      // Match each group to a diagram
      const updatedDiagrams = { ...savedDiagrams };
      let matchedCount = 0;
      let unmatchedFiles = [];

      for (const [baseName, fileGroup] of Object.entries(filesByDiagram)) {
        console.log(`[Bulk Parts List Upload] Looking for diagram matching "${baseName}"`);

        // Normalize function: remove all non-alphanumeric characters for comparison
        const normalize = (str) => {
          if (!str) return '';
          return str.toLowerCase().replace(/[^a-z0-9]/g, '');
        };

        // Find matching diagram using normalized comparison
        const normalizedSearchName = normalize(baseName);

        const matchedDiagram = Object.values(savedDiagrams).find(diagram => {
          const normalizedDiagramName = normalize(diagram.name);
          const normalizedDiagramNumber = normalize(diagram.number);

          const nameMatch = normalizedDiagramName === normalizedSearchName;
          const numberMatch = normalizedDiagramNumber === normalizedSearchName;

          console.log(`  Checking diagram "${diagram.name}": normalized name="${normalizedDiagramName}" number="${normalizedDiagramNumber}" vs search="${normalizedSearchName}" → nameMatch=${nameMatch}, numberMatch=${numberMatch}`);

          return nameMatch || numberMatch;
        });

        if (matchedDiagram) {
          console.log(`[Bulk Parts List Upload] Matched "${baseName}" to diagram "${matchedDiagram.name}"`);

          // Process all files in this group
          const newImages = [];

          for (const file of fileGroup) {
            setOcrProgress(`Converting ${file.name}...`);

            const isImage = file.type.startsWith('image/');
            const isPDF = file.type === 'application/pdf';

            if (isImage) {
              const imageBase64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });

              newImages.push({
                fileName: file.name,
                data: imageBase64
              });
            } else if (isPDF) {
              const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
              pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

              const arrayBuffer = await file.arrayBuffer();
              const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

              for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 2.0 });

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({
                  canvasContext: context,
                  viewport: viewport
                }).promise;

                const imageBase64 = canvas.toDataURL('image/jpeg', 0.9);

                newImages.push({
                  fileName: pdf.numPages > 1 ? `${file.name} - Page ${pageNum}` : file.name,
                  data: imageBase64
                });
              }
            }
          }

          // Replace existing images with new ones (overwrites any incorrect uploads)
          updatedDiagrams[matchedDiagram.id] = {
            ...matchedDiagram,
            partsListImages: newImages
          };

          matchedCount += newImages.length;
          console.log(`[Bulk Parts List Upload] Added ${newImages.length} image(s) to "${matchedDiagram.name}"`);
        } else {
          console.warn(`[Bulk Parts List Upload] No match found for "${baseName}"`);
          unmatchedFiles.push(...fileGroup.map(f => f.name));
        }
      }

      // Update all diagrams at once
      setSavedDiagrams(updatedDiagrams);

      setOcrProgress(null);

      let message = `Successfully added ${matchedCount} parts list image(s) to diagrams.`;
      if (unmatchedFiles.length > 0) {
        message += `\n\nUnmatched files (${unmatchedFiles.length}):\n${unmatchedFiles.join('\n')}`;
      }
      alert(message);

    } catch (error) {
      console.error('Failed to bulk upload parts list images:', error);
      setOcrProgress(null);
      alert('Failed to upload images.\n\nError: ' + error.message);
    }

    e.target.value = '';
  };

  const handleUploadPartsListImages = async (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    if (!currentDiagramId) {
      alert('Please select a diagram first.');
      e.target.value = '';
      return;
    }

    const diagram = savedDiagrams[currentDiagramId];
    if (!diagram) {
      alert('Current diagram not found.');
      e.target.value = '';
      return;
    }

    try {
      setOcrProgress(`Converting ${files.length} file(s)...`);

      const newPartsListImages = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const isImage = file.type.startsWith('image/');
        const isPDF = file.type === 'application/pdf';

        if (!isImage && !isPDF) {
          console.warn(`Skipping unsupported file: ${file.name}`);
          continue;
        }

        if (isImage) {
          // Convert image to base64
          const imageBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          newPartsListImages.push({
            fileName: file.name,
            data: imageBase64
          });

          console.log(`[Parts List Images] ✓ Added image: ${file.name}`);
        } else if (isPDF) {
          // Convert PDF pages to images
          setOcrProgress(`Converting PDF: ${file.name}...`);

          const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
          pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

          // Convert each page to image
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2.0 });

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({
              canvasContext: context,
              viewport: viewport
            }).promise;

            const imageBase64 = canvas.toDataURL('image/jpeg', 0.9);

            newPartsListImages.push({
              fileName: pdf.numPages > 1 ? `${file.name} - Page ${pageNum}` : file.name,
              data: imageBase64
            });

            console.log(`[Parts List Images] ✓ Converted PDF page ${pageNum}/${pdf.numPages}: ${file.name}`);
          }

          console.log(`[Parts List Images] ✓ Added ${pdf.numPages} page(s) from PDF: ${file.name}`);
        }
      }

      if (newPartsListImages.length === 0) {
        alert('No valid image or PDF files found.');
        setOcrProgress(null);
        e.target.value = '';
        return;
      }

      // Update diagram with new images (append to existing)
      const existingPartsListImages = diagram.partsListImages || [];
      const updatedDiagram = {
        ...diagram,
        partsListImages: [...existingPartsListImages, ...newPartsListImages]
      };

      setSavedDiagrams({
        ...savedDiagrams,
        [currentDiagramId]: updatedDiagram
      });

      setOcrProgress(null);
      alert(`Successfully added ${newPartsListImages.length} parts list source image(s) to diagram "${diagram.name}".`);

    } catch (error) {
      console.error('Failed to upload parts list images:', error);
      setOcrProgress(null);
      alert('Failed to upload images.\n\nError: ' + error.message);
    }

    e.target.value = '';
  };

  const handleConfirmPartsListImport = async () => {
    if (!partsListData || !currentDiagramId) {
      alert('No diagram selected or no parts data to import.');
      return;
    }

    const diagram = savedDiagrams[currentDiagramId];
    if (!diagram) {
      alert('Current diagram not found.');
      return;
    }

    // Ask if user wants to update diagram name/number
    let updateMetadata = false;
    if (partsListData.unitName || partsListData.drawNo) {
      let message = 'Update diagram metadata from PDF?\n\n';
      if (partsListData.unitName) {
        message += `Name: "${diagram.name}" → "${partsListData.unitName}"\n`;
      }
      if (partsListData.drawNo) {
        message += `Number: "${diagram.number || '(none)'}" → "${partsListData.drawNo}"\n`;
      }
      updateMetadata = window.confirm(message);
    }

    // Convert source file to base64 image(s) if available
    let newPartsListImages = [];
    if (partsListSourceFile) {
      try {
        setOcrProgress('Saving source image...');

        const isImage = partsListSourceFile.type.startsWith('image/');
        const isPDF = partsListSourceFile.type === 'application/pdf';

        if (isImage) {
          // Convert image to base64
          const imageBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(partsListSourceFile);
          });

          newPartsListImages.push({
            fileName: partsListSourceFile.name,
            data: imageBase64
          });

          console.log(`[Parts List Import] ✓ Captured source image: ${partsListSourceFile.name}`);
        } else if (isPDF) {
          // Convert PDF pages to images
          const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
          pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

          const arrayBuffer = await partsListSourceFile.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

          // Convert each page to image
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2.0 });

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({
              canvasContext: context,
              viewport: viewport
            }).promise;

            const imageBase64 = canvas.toDataURL('image/jpeg', 0.9);

            newPartsListImages.push({
              fileName: `${partsListSourceFile.name} - Page ${pageNum}`,
              data: imageBase64
            });

            console.log(`[Parts List Import] ✓ Captured PDF page ${pageNum} as image`);
          }
        }

        setOcrProgress(null);
      } catch (error) {
        console.error('[Parts List Import] Failed to capture source image:', error);
        setOcrProgress(null);
        // Continue without the image - don't block the import
      }
    }

    // Update diagram with parts data, metadata, and source images
    const existingPartsListImages = diagram.partsListImages || [];
    const updatedDiagram = {
      ...diagram,
      partsData: partsListData.partsData,
      name: updateMetadata && partsListData.unitName ? partsListData.unitName : diagram.name,
      number: updateMetadata && partsListData.drawNo ? partsListData.drawNo : diagram.number,
      partsListImages: [...existingPartsListImages, ...newPartsListImages]
    };

    setSavedDiagrams({
      ...savedDiagrams,
      [currentDiagramId]: updatedDiagram
    });

    setShowPartsListReview(false);
    setPartsListData(null);
    setPartsListSourceFile(null);

    const imageMessage = newPartsListImages.length > 0 ? `\n${newPartsListImages.length} source image(s) added.` : '';
    alert(`Successfully imported ${Object.keys(partsListData.partsData).length} parts to diagram "${updatedDiagram.name}".${imageMessage}`);
  };

  const parsePartsCSV = (csvText) => {
    const lines = csvText.trim().split('\n');
    const partsData = {};

    // Try to detect format type
    const hasPipes = csvText.includes('|');
    const hasCommas = csvText.includes(',');
    const hasMultipleSpaces = csvText.includes('  ');

    const isTableFormat = hasMultipleSpaces && !hasCommas && !hasPipes;
    const isPipeDelimited = hasPipes;

    let startIndex = 0;
    // Find header row and skip it
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('partno') || line.includes('part no') || line.includes('part code') ||
          (line.includes('no') && (line.includes('code') || line.includes('name') || line.includes('quantity')))) {
        startIndex = i + 1;
        break;
      }
    }

    console.log('Total lines to process:', lines.length);
    console.log('Starting from line:', startIndex);

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.length < 5) continue;

      // Skip lines that are just separators, page numbers, headers, or unit names
      if (line.match(/^[-=_]+$/) ||
          line.match(/^\d+[-–]\s*\d+[-–]\d+$/) ||
          line.toLowerCase().includes('unit name') ||
          line.toLowerCase().includes('draw no') ||
          line.toLowerCase().includes('part code') ||
          line.toLowerCase().includes('part name') ||
          line.toLowerCase().includes('quantity')) {
        console.log('Skipping header/separator line:', line);
        continue;
      }

      let fields;
      if (isPipeDelimited) {
        // Split by pipe delimiter
        fields = line.split('|').map(f => f.trim()).filter(f => f);
      } else if (isTableFormat) {
        // Split by multiple spaces (2 or more)
        fields = line.split(/\s{2,}/).map(f => f.trim()).filter(f => f);
      } else {
        // Parse CSV (handle quoted fields and comma delimiters)
        fields = line.match(/(".*?"|[^,\t]+)(?=\s*[,\t]|\s*$)/g) || [];
        fields = fields.map(f => f.replace(/^"|"$/g, '').trim()).filter(f => f);
      }

      if (fields.length >= 2) {
        let partNo, partCode, partName, qty, pmst;

        // Special handling for pipe-delimited OCR format
        if (isPipeDelimited && fields.length >= 2) {
          // Format: "1 000-102-3574-29" | "BASE :WDU: 1"
          const firstField = fields[0].trim();
          const secondField = fields[1].trim();

          // Extract part number and part code from first field
          const firstParts = firstField.split(/\s+/);
          if (firstParts.length >= 2) {
            partNo = firstParts[0];
            partCode = firstParts.slice(1).join(' ');
          } else {
            continue; // Invalid format
          }

          // Extract part name and quantity from second field
          // Quantity is usually the last token
          const secondParts = secondField.split(/\s+/);
          const lastToken = secondParts[secondParts.length - 1];

          if (!isNaN(lastToken) && lastToken.trim() !== '') {
            // Last token is a number (quantity)
            qty = lastToken;
            partName = secondParts.slice(0, -1).join(' ');
          } else {
            // No quantity found, use whole field as part name
            partName = secondField;
            qty = '1';
          }

          pmst = fields[2] || '3';
        }
        // Handle different field counts for non-pipe formats
        else if (fields.length === 3) {
          // partNo, partCode, partName
          [partNo, partCode, partName] = fields;
          qty = '1';
          pmst = '3';
        } else if (fields.length === 4) {
          // partNo, partCode, partName, qty OR partNo, partCode, partName, pmst
          [partNo, partCode, partName, qty] = fields;
          pmst = '3';
        } else if (fields.length >= 5) {
          // partNo, partCode, partName, qty, pmst
          [partNo, partCode, partName, qty, pmst = '3'] = fields;
        } else {
          continue;
        }

        // Skip if partNo is not a number (likely not a data row)
        // Also skip special markers like bullet points
        const cleanPartNo = partNo.replace(/^[●○•]/, '').trim();
        if (isNaN(cleanPartNo) || cleanPartNo === '') {
          console.log('Skipping non-numeric part number:', partNo);
          continue;
        }

        console.log(`Adding part ${cleanPartNo}: ${partCode}`);
        partsData[cleanPartNo] = {
          partCode: partCode || 'N/A',
          partName: partName || 'N/A',
          qty: qty || '1',
          pmst: pmst || '3'
        };
      }
    }

    console.log('Total parts parsed:', Object.keys(partsData).length);
    return partsData;
  };

  const deleteDiagram = async (diagramId) => {
    if (!window.confirm('Are you sure you want to delete this diagram?')) {
      return;
    }

    setSyncStatus('Deleting...');

    // Delete from Firebase
    try {
      console.log(`Attempting to delete diagram ${diagramId} from Firebase...`);
      await deleteFromFirebase(diagramId);
      console.log(`✓ Successfully deleted diagram ${diagramId} from Firebase`);
    } catch (error) {
      console.error('✗ Error deleting from Firebase:', error);
      alert(`Warning: Failed to delete from Firebase.\n\nError: ${error.message}\n\nThe diagram will be removed locally but may still exist in Firebase.`);
      // Continue with local deletion even if Firebase fails
    }

    // Delete from local state
    setSavedDiagrams(prev => {
      const newDiagrams = { ...prev };
      delete newDiagrams[diagramId];
      return newDiagrams;
    });

    if (currentDiagramId === diagramId) {
      const remaining = Object.keys(savedDiagrams).filter(id => id !== diagramId);
      setCurrentDiagramId(remaining.length > 0 ? remaining[0] : null);
    }

    setSyncStatus('✓ Deleted');
    setTimeout(() => setSyncStatus(null), 2000);
  };

  const toggleDiagramSelection = (diagramId) => {
    setSelectedDiagramIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(diagramId)) {
        newSet.delete(diagramId);
      } else {
        newSet.add(diagramId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = (diagrams) => {
    const allIds = diagrams.map(d => d.id);
    const allSelected = allIds.every(id => selectedDiagramIds.has(id));

    if (allSelected) {
      // Deselect all
      setSelectedDiagramIds(prev => {
        const newSet = new Set(prev);
        allIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    } else {
      // Select all
      setSelectedDiagramIds(prev => {
        const newSet = new Set(prev);
        allIds.forEach(id => newSet.add(id));
        return newSet;
      });
    }
  };

  const deleteSelectedDiagrams = async () => {
    if (selectedDiagramIds.size === 0) {
      alert('No diagrams selected');
      return;
    }

    const count = selectedDiagramIds.size;

    if (!window.confirm(`Are you sure you want to delete ${count} diagram(s)?`)) {
      return;
    }

    // Delete from Firebase
    try {
      console.log('Deleting IDs from Firebase:', Array.from(selectedDiagramIds));
      const deletePromises = Array.from(selectedDiagramIds).map(id => {
        console.log('Deleting:', id);
        return deleteFromFirebase(id);
      });
      await Promise.all(deletePromises);
      console.log(`Successfully deleted ${count} diagram(s) from Firebase`);
    } catch (error) {
      console.error('Error deleting from Firebase:', error);
      // Continue with local deletion even if Firebase fails
    }

    // Delete from local state
    setSavedDiagrams(prev => {
      const newDiagrams = { ...prev };
      selectedDiagramIds.forEach(id => delete newDiagrams[id]);
      return newDiagrams;
    });

    // Update Firebase diagrams list
    setFirebaseDiagrams(prev =>
      prev.filter(diagram => !selectedDiagramIds.has(diagram.id))
    );

    // Update current diagram if needed
    if (selectedDiagramIds.has(currentDiagramId)) {
      const remaining = Object.keys(savedDiagrams).filter(id => !selectedDiagramIds.has(id));
      setCurrentDiagramId(remaining.length > 0 ? remaining[0] : null);
    }

    // Clear selection
    setSelectedDiagramIds(new Set());

    alert(`Successfully deleted ${count} diagram(s)`);
  };

  const updateDiagramHotspots = (diagramId, hotspots) => {
    setSavedDiagrams(prev => ({
      ...prev,
      [diagramId]: {
        ...prev[diagramId],
        hotspots: hotspots
      }
    }));
  };

  const updateDiagramPartsData = (diagramId, partsData) => {
    setSavedDiagrams(prev => ({
      ...prev,
      [diagramId]: {
        ...prev[diagramId],
        partsData: partsData
      }
    }));
  };

  const updateDiagramRotation = (diagramId, rotation) => {
    setSavedDiagrams(prev => ({
      ...prev,
      [diagramId]: {
        ...prev[diagramId],
        rotation: rotation
      }
    }));
  };

  const exportDiagram = (diagramId) => {
    const diagram = savedDiagrams[diagramId];
    const dataStr = JSON.stringify(diagram, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${diagram.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importDiagram = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const diagram = JSON.parse(text);

      const diagramId = Date.now().toString();
      setSavedDiagrams(prev => ({
        ...prev,
        [diagramId]: {
          ...diagram,
          id: diagramId,
          folder: diagram.folder || 'General',
          partsData: diagram.partsData || {},
          hotspots: diagram.hotspots || {}
        }
      }));

      setCurrentDiagramId(diagramId);
      alert('Diagram imported successfully!');
    } catch (error) {
      alert('Error importing diagram: ' + error.message);
    }
  };

  // Get all unique folders from diagrams
  const getFolders = () => {
    const folders = new Set();
    Object.values(savedDiagrams).forEach(diagram => {
      folders.add(diagram.folder || 'General');
    });
    return Array.from(folders).sort();
  };

  // Helper function to extract numeric parts from diagram name for sorting
  const extractSortNumber = (diagram) => {
    // Sort by the NAME field (e.g., "10-1 MAIN BODY UNIT" -> 10.001)
    const nameStr = diagram.name || '';

    // Extract pattern like "10-1" or "20-2" from the start of the name
    const match = nameStr.match(/^(\d+)-(\d+)/);
    if (match) {
      // Convert to sortable number: 10-1 becomes 10.001, 10-2 becomes 10.002, etc.
      // This ensures 10-1, 10-2, 10-3, ... then 20-1, 20-2, 20-3
      const major = parseInt(match[1]);
      const minor = parseInt(match[2]);
      return major + (minor / 1000);
    }

    // Try to extract just a single number from the name
    const singleMatch = nameStr.match(/^(\d+)/);
    if (singleMatch) {
      return parseFloat(singleMatch[1]);
    }

    // If no number found at start, return a very high number to put at end
    return 999999;
  };

  // Get diagrams grouped by folder (with optional customer filter)
  const getDiagramsByFolder = (customerFilter = 'All Customers') => {
    // First filter by customer if needed
    const filteredDiagrams = customerFilter === 'All Customers'
      ? savedDiagrams
      : getDiagramsByCustomer(customerFilter);

    // Then group by folder
    const grouped = {};
    Object.values(filteredDiagrams).forEach(diagram => {
      const folder = diagram.folder || 'General';
      if (!grouped[folder]) {
        grouped[folder] = [];
      }
      grouped[folder].push(diagram);
    });

    // Sort each folder's diagrams by createdAt (for arrange functionality)
    Object.keys(grouped).forEach(folder => {
      grouped[folder].sort((a, b) => {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return dateA - dateB;
      });
    });

    return grouped;
  };

  // Get diagrams grouped by customer first, then by folder (machine type)
  // Returns: { customerName: { folderName: [diagrams] } }
  const getDiagramsByCustomerAndFolder = () => {
    const grouped = {};

    Object.values(savedDiagrams).forEach(diagram => {
      const customer = diagram.customer || 'General';
      const folder = diagram.folder || 'General';

      if (!grouped[customer]) {
        grouped[customer] = {};
      }
      if (!grouped[customer][folder]) {
        grouped[customer][folder] = [];
      }

      grouped[customer][folder].push(diagram);
    });

    // Sort each folder's diagrams by createdAt
    Object.keys(grouped).forEach(customer => {
      Object.keys(grouped[customer]).forEach(folder => {
        grouped[customer][folder].sort((a, b) => {
          const dateA = new Date(a.createdAt || 0).getTime();
          const dateB = new Date(b.createdAt || 0).getTime();
          return dateA - dateB;
        });
      });
    });

    // Debug logging for folder structure
    Object.keys(grouped).forEach(customer => {
      const folderNames = Object.keys(grouped[customer]);
      const totalDiagrams = Object.values(grouped[customer]).reduce((sum, diagrams) => sum + diagrams.length, 0);
      console.log(`[Folders] Customer "${customer}": ${folderNames.length} folders (${totalDiagrams} diagrams) - Folders: [${folderNames.join(', ')}]`);
    });

    return grouped;
  };

  // Sort diagrams in a folder by number
  const arrangeDiagramsInFolder = (folderName, diagrams) => {
    console.log('=== ARRANGING DIAGRAMS ===');
    console.log('Folder:', folderName);

    // Show before sorting with details
    console.log('\nBEFORE SORTING:');
    diagrams.forEach((d, i) => {
      console.log(`${i + 1}. ${d.number || d.name} [sortNum: ${extractSortNumber(d)}]`);
    });

    const sortedDiagrams = [...diagrams].sort((a, b) => {
      const numA = extractSortNumber(a);
      const numB = extractSortNumber(b);
      return numA - numB;
    });

    // Show after sorting with details
    console.log('\nAFTER SORTING:');
    sortedDiagrams.forEach((d, i) => {
      console.log(`${i + 1}. ${d.number || d.name} [sortNum: ${extractSortNumber(d)}]`);
    });

    // Update the order by reassigning createdAt timestamps
    const baseTime = Date.now();
    const newDiagrams = {};

    // Create completely new objects to force React to re-render
    Object.keys(savedDiagrams).forEach(id => {
      newDiagrams[id] = { ...savedDiagrams[id] };
    });

    sortedDiagrams.forEach((diagram, index) => {
      newDiagrams[diagram.id] = {
        ...newDiagrams[diagram.id],
        createdAt: new Date(baseTime + index * 1000).toISOString()
      };
    });

    setSavedDiagrams(newDiagrams);

    const orderList = sortedDiagrams.map((d, i) => `${i + 1}. ${d.number || d.name}`).join('\n');
    alert(`Arranged ${diagrams.length} diagrams in "${folderName}":\n\n${orderList}`);
  };

  // Rename a folder
  const renameFolder = (oldName, newName) => {
    if (!newName || !newName.trim()) {
      alert('Please provide a folder name');
      return;
    }

    const trimmedNewName = newName.trim();
    if (trimmedNewName === oldName) return;

    setSavedDiagrams(prev => {
      const updated = {};
      Object.keys(prev).forEach(diagramId => {
        updated[diagramId] = {
          ...prev[diagramId],
          folder: prev[diagramId].folder === oldName ? trimmedNewName : prev[diagramId].folder
        };
      });
      return updated;
    });
  };

  // Delete a folder and all its diagrams
  const deleteFolder = (folderName, diagrams) => {
    if (folderName === 'General') {
      alert('Cannot delete the General folder');
      return;
    }

    if (!window.confirm(
      `Delete folder "${folderName}" and all ${diagrams.length} diagram(s) in it?\n\n` +
      `This will permanently delete:\n${diagrams.map(d => `- ${d.name}`).join('\n')}\n\n` +
      `This action cannot be undone!`
    )) {
      return;
    }

    // Get IDs of diagrams to delete
    const diagramIdsToDelete = new Set(diagrams.map(d => d.id));

    // Remove all diagrams in this folder
    setSavedDiagrams(prev => {
      const updated = {};
      Object.keys(prev).forEach(diagramId => {
        if (!diagramIdsToDelete.has(diagramId)) {
          updated[diagramId] = prev[diagramId];
        }
      });
      return updated;
    });

    // If current diagram was deleted, clear selection
    if (diagramIdsToDelete.has(currentDiagramId)) {
      setCurrentDiagramId(null);
    }

    alert(`Deleted folder "${folderName}" and ${diagrams.length} diagram(s).`);
  };

  // Move diagram to different folder
  const moveDiagramToFolder = (diagramId, newFolder) => {
    setSavedDiagrams(prev => ({
      ...prev,
      [diagramId]: {
        ...prev[diagramId],
        folder: newFolder
      }
    }));
  };

  const renameDiagram = (diagramId, newName) => {
    if (!newName || !newName.trim()) {
      alert('Please provide a diagram name');
      return;
    }

    setSavedDiagrams(prev => ({
      ...prev,
      [diagramId]: {
        ...prev[diagramId],
        name: newName.trim()
      }
    }));
  };

  // Parse Table of Contents
  const handleParseToc = () => {
    if (!tocText.trim()) {
      alert('Please paste the table of contents text');
      return;
    }

    // Parse TOC - format is 4 lines per entry:
    // Line 1: Page number (e.g., "10- 1")
    // Line 2: Unit name (e.g., "MAIN BODY UN 1T::HIGHSPE ED")
    // Line 3: Part code (SKIP - e.g., "000-128-2893-16")
    // Line 4: Draw number (e.g., "4D-38837")
    const lines = tocText.trim().split('\n');
    const parsed = [];

    for (let i = 0; i < lines.length; i += 4) {
      if (i + 3 >= lines.length) {
        // Not enough lines left for a complete entry
        break;
      }

      const pageNumber = lines[i].trim();
      const unitName = lines[i + 1].trim();
      // Skip line i+2 (part code)
      const drawNo = lines[i + 3].trim();

      if (pageNumber && unitName && drawNo) {
        parsed.push({
          index: parsed.length,
          pageNumber,
          unitName,
          drawNo,
          fullName: `${pageNumber} - ${unitName} - ${drawNo}`
        });
      }
    }

    if (parsed.length === 0) {
      alert('Could not parse any entries. Expected format:\nLine 1: Page number\nLine 2: Unit name\nLine 3: Part code (ignored)\nLine 4: Draw number');
      return;
    }

    setTocEntries(parsed);
    setTocMappings({});
    alert(`✓ Parsed ${parsed.length} entries from table of contents`);
  };

  // Auto-map TOC entries to diagrams in order
  const handleAutoMapToc = () => {
    if (tocEntries.length === 0) {
      alert('Please parse the TOC first');
      return;
    }

    if (!tocSelectedCustomer) {
      alert('Please select a customer first');
      return;
    }

    if (!tocSelectedFolder) {
      alert('Please select a folder first');
      return;
    }

    // Get all diagrams for the selected customer and folder, sorted by creation time
    const diagramIds = Object.keys(savedDiagrams)
      .filter(id => {
        const diagram = savedDiagrams[id];
        const customerMatch = diagram.customer === tocSelectedCustomer;
        const folderMatch = diagram.folder === tocSelectedFolder;
        return customerMatch && folderMatch;
      })
      .sort((a, b) => {
        const diagA = savedDiagrams[a];
        const diagB = savedDiagrams[b];

        // Sort by createdAt if available
        if (diagA.createdAt && diagB.createdAt) {
          return new Date(diagA.createdAt) - new Date(diagB.createdAt);
        }

        // Fallback: sort by name
        return (diagA.name || '').localeCompare(diagB.name || '');
      });

    if (diagramIds.length === 0) {
      alert(`No diagrams found in folder "${tocSelectedFolder}"`);
      return;
    }

    // Create mappings: TOC entry index -> diagram ID
    const newMappings = {};
    const maxMappings = Math.min(tocEntries.length, diagramIds.length);

    for (let i = 0; i < maxMappings; i++) {
      newMappings[i] = diagramIds[i];
    }

    setTocMappings(newMappings);

    if (tocEntries.length > diagramIds.length) {
      alert(`✓ Auto-mapped ${maxMappings} entries\n\nWarning: You have ${tocEntries.length} TOC entries but only ${diagramIds.length} diagrams. The remaining ${tocEntries.length - diagramIds.length} entries were not mapped.`);
    } else if (diagramIds.length > tocEntries.length) {
      alert(`✓ Auto-mapped ${maxMappings} entries\n\nNote: You have ${diagramIds.length} diagrams but only ${tocEntries.length} TOC entries. ${diagramIds.length - tocEntries.length} diagram(s) will not be renamed.`);
    } else {
      alert(`✓ Auto-mapped all ${maxMappings} entries to diagrams in order!`);
    }
  };

  // Apply TOC mappings to rename diagrams
  const handleApplyTocRenames = () => {
    const mappingCount = Object.keys(tocMappings).length;

    if (mappingCount === 0) {
      alert('Please assign at least one TOC entry to a diagram');
      return;
    }

    if (!window.confirm(`Rename ${mappingCount} diagram(s)?`)) {
      return;
    }

    // Apply all renames
    Object.entries(tocMappings).forEach(([entryIndex, diagramId]) => {
      const entry = tocEntries[entryIndex];
      if (entry && savedDiagrams[diagramId]) {
        renameDiagram(diagramId, entry.fullName);
      }
    });

    alert(`✓ Successfully renamed ${mappingCount} diagram(s)!`);

    // Clear mappings but keep entries for more renaming
    setTocMappings({});
  };

  // Normalize name for matching (remove special chars, lowercase, trim)
  const normalizeName = (name) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric
      .trim();
  };

  // Handle bulk image file selection
  const handleBulkZipUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      alert('Please select a ZIP file.');
      return;
    }

    // Extract actual customer name (remove __NEW__ prefix if present)
    const actualCustomer = bulkUploadCustomer.replace(/^__NEW__/, '').trim();

    if (!actualCustomer || !bulkUploadFolder) {
      alert('Please enter customer name and folder first.');
      return;
    }

    try {
      setOcrProgress('Extracting ZIP file...');

      // Dynamically import JSZip
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const contents = await zip.loadAsync(file);

      setOcrProgress('Finding images and parts lists...');

      // Extract images from Exploded-Views folder
      const imageFiles = [];
      const partsListFiles = {};

      // Find all files in Exploded-Views and Parts-Lists folders
      console.log('[ZIP Import] Scanning ZIP contents...');
      console.log('[ZIP Import] Total files in ZIP:', Object.keys(contents.files).length);

      for (const [path, file] of Object.entries(contents.files)) {
        if (file.dir) continue;

        // Skip macOS metadata files and __MACOSX folder
        const fileName = path.split('/').pop();
        if (path.includes('__MACOSX') || fileName.startsWith('._')) {
          console.log(`[ZIP Import] Skipping macOS metadata file: ${fileName}`);
          continue;
        }

        if (path.match(/Exploded-Views\/.+\.(jpg|jpeg|png)$/i)) {
          // Remove extension, but keep any -parts suffix in the filename
          // (will deduplicate later if needed)
          const baseName = fileName.replace(/\.(jpg|jpeg|png)$/i, '');
          imageFiles.push({ path, fileName, baseName, zipFile: file });
          console.log(`[ZIP Import]   Image: ${fileName} → baseName: "${baseName}"`);
        } else if (path.match(/Parts-Lists\/.+\.(pdf|txt|jpg|jpeg|png)$/i)) {
          // Match any PDF, TXT, or image in Parts-Lists folder
          const fileName = path.split('/').pop();

          // First remove extension, then remove any -parts, -parts2, -parts3 suffix
          let baseName = fileName.replace(/\.(pdf|txt|jpg|jpeg|png)$/i, '');
          console.log(`[ZIP Import]   Step 1: ${fileName} → after removing extension: "${baseName}"`);
          baseName = baseName.replace(/-parts\d*$/i, '');
          console.log(`[ZIP Import]   Step 2: after removing -parts suffix: "${baseName}"`);

          console.log(`[ZIP Import]   ✓ Parts file: ${fileName} → baseName: "${baseName}"`);

          // Initialize array if this is the first parts file for this diagram
          if (!partsListFiles[baseName]) {
            partsListFiles[baseName] = [];
          }

          partsListFiles[baseName].push({ path, fileName, zipFile: file });
        }
      }

      // Deduplicate images - if there are multiple images for the same diagram
      // (e.g., "diagram.jpg", "diagram-parts.jpg", "diagram-parts2.jpg"),
      // keep only ONE (prefer the one without -parts suffix)
      const uniqueImages = {};
      imageFiles.forEach(imageFile => {
        // Get the true base name by removing any -parts suffix
        const trueBaseName = imageFile.baseName.replace(/-parts\d*$/i, '');

        // If we haven't seen this diagram yet, or if this is the base image (no -parts suffix)
        if (!uniqueImages[trueBaseName] || !imageFile.baseName.match(/-parts\d*$/i)) {
          uniqueImages[trueBaseName] = imageFile;
        }
      });

      // Use deduplicated images
      const deduplicatedImageFiles = Object.values(uniqueImages);

      console.log(`[ZIP Import] Found ${imageFiles.length} image files (${deduplicatedImageFiles.length} unique diagrams) and ${Object.keys(partsListFiles).length} parts list groups`);

      if (imageFiles.length !== deduplicatedImageFiles.length) {
        console.log(`[ZIP Import] Removed ${imageFiles.length - deduplicatedImageFiles.length} duplicate image files`);
      }

      // Log all unique image base names FOR MATCHING
      console.log('[ZIP Import] === Image Files for Matching ===');
      deduplicatedImageFiles.forEach(f => {
        const matchingBaseName = f.baseName.replace(/-parts\d*$/i, '');
        console.log(`  Image: "${f.fileName}" → baseName: "${f.baseName}" → matchKey: "${matchingBaseName}"`);
      });
      console.log('[ZIP Import] === End Image Files ===');

      // Log all parts list base names with counts
      console.log('[ZIP Import] === Parts List Groupings ===');
      Object.keys(partsListFiles).forEach(baseName => {
        const count = partsListFiles[baseName].length;
        const fileNames = partsListFiles[baseName].map(p => p.fileName).join(', ');
        console.log(`  matchKey: "${baseName}" → ${count} page(s)`);
        console.log(`    Files: ${fileNames}`);
      });
      console.log('[ZIP Import] === End Parts List Groupings ===');

      // Update imageFiles to use deduplicated list
      imageFiles.length = 0;
      imageFiles.push(...deduplicatedImageFiles);

      if (imageFiles.length === 0) {
        setOcrProgress(null);
        alert('No images found in Exploded-Views folder.');
        return;
      }

      // Parse TOC if provided
      let tocEntries = [];
      if (bulkUploadTocText.trim()) {
        setOcrProgress('Parsing table of contents...');
        const lines = bulkUploadTocText.trim().split('\n');
        const parsed = [];

        for (let i = 0; i < lines.length; i += 4) {
          if (i + 3 < lines.length) {
            const itemNo = lines[i].trim();
            const name = lines[i + 1].trim();
            const partCode = lines[i + 2].trim();
            const drawingNo = lines[i + 3].trim();

            parsed.push({ itemNo, name, partCode, drawingNo });
          }
        }

        tocEntries = parsed;
        console.log(`[ZIP Import] Parsed ${tocEntries.length} TOC entries`);

        if (tocEntries.length !== imageFiles.length) {
          const continueImport = window.confirm(
            `Warning: You have ${imageFiles.length} images but ${tocEntries.length} TOC entries.\n\n` +
            `${tocEntries.length < imageFiles.length ? 'Some diagrams will use filenames instead of TOC names.' : 'Some TOC entries will be unused.'}\n\n` +
            `Continue with import?`
          );

          if (!continueImport) {
            setOcrProgress(null);
            return;
          }
        }
      }

      setOcrProgress(`Processing ${imageFiles.length} diagrams with parts lists...`);

      // Process each image with its matching parts list
      const newDiagrams = {};
      const failedDiagrams = [];
      let processedCount = 0;

      for (let imageIndex = 0; imageIndex < imageFiles.length; imageIndex++) {
        const imageFile = imageFiles[imageIndex];
        processedCount++;
        setOcrProgress(`Processing ${processedCount}/${imageFiles.length}: ${imageFile.fileName}`);

        try {
          // Extract image as base64 with correct MIME type
          const imageArrayBuffer = await imageFile.zipFile.async('arraybuffer');

          // Determine MIME type from file extension
          const extension = imageFile.fileName.toLowerCase().split('.').pop();
          const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp'
          };
          const mimeType = mimeTypes[extension] || 'image/jpeg';

          // Create blob with correct MIME type
          const imageBlob = new Blob([imageArrayBuffer], { type: mimeType });
          console.log(`[ZIP Import] Image blob size: ${imageBlob.size} bytes, type: ${imageBlob.type}`);

          const imageBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(imageBlob);
          });

          console.log(`[ZIP Import] Extracted image ${imageFile.fileName}`);
          console.log(`  - Base64 length: ${imageBase64?.length || 0}`);
          console.log(`  - Starts with: ${imageBase64?.substring(0, 50)}`);
          console.log(`  - Is data URL: ${imageBase64?.startsWith('data:')}`);
          console.log(`  - Is image data URL: ${imageBase64?.startsWith('data:image/')}`)

          // Match TOC entry by drawing number (not by index!)
          // The drawing number in TOC should match the filename
          let tocEntry = null;
          if (tocEntries.length > 0) {
            // Try to find TOC entry where drawingNo matches the filename
            tocEntry = tocEntries.find(entry => {
              // Check if the image filename contains the drawing number
              const drawingNo = entry.drawingNo?.trim();
              if (drawingNo && imageFile.baseName.includes(drawingNo)) {
                return true;
              }
              // Also try the partCode field
              const partCode = entry.partCode?.trim();
              if (partCode && imageFile.baseName.includes(partCode)) {
                return true;
              }
              return false;
            });

            if (tocEntry) {
              console.log(`[ZIP Import] Matched TOC entry: "${tocEntry.name}" (drawing: ${tocEntry.drawingNo}) → image: "${imageFile.fileName}"`);
            } else {
              console.log(`[ZIP Import] No TOC match found for image: "${imageFile.fileName}"`);
            }
          }

          // Always use filename but strip off the drawing number suffix (e.g., -4D-44864)
          // Pattern: hyphen followed by digits, letter(s), hyphen, digits at the end
          // Example: "10-1-MAIN-BODY-UNIT-4D-44864" → "10-1-MAIN-BODY-UNIT"
          const diagramName = imageFile.baseName.replace(/-\d+[A-Z]+-\d+$/i, '');
          console.log(`[ZIP Import] Diagram name: "${imageFile.baseName}" → "${diagramName}"`);

          // Extract drawing number from filename (e.g., "4D-44864" from "10-1-MAIN-BODY-UNIT-4D-44864")
          const drawingNumberMatch = imageFile.baseName.match(/-(\d+[A-Z]+-\d+)$/i);
          const extractedDrawingNumber = drawingNumberMatch ? drawingNumberMatch[1] : '';

          // Use TOC values if available and not undefined, otherwise use extracted/empty values
          const diagramNumber = (tocEntry?.drawingNo) || extractedDrawingNumber || '';
          const diagramItemNo = (tocEntry?.itemNo) || '';

          // Search for existing diagram with matching name in the same folder/customer
          // Check BOTH savedDiagrams and newDiagrams (to avoid duplicates within this batch)

          // Extract prefix for matching (e.g., "70-1" from "70-1-REMOTE-CONTROL-BOX-UNIT")
          // Match pattern: one or more digits, hyphen, one or more digits/letters
          const prefixMatch = diagramName.match(/^(\d+[-]\d+[A-Z]?)/);
          const diagramPrefix = prefixMatch ? prefixMatch[1] : null;

          const existingInSaved = Object.values(savedDiagrams).find(d => {
            // Must match folder AND customer
            if (d.folder !== bulkUploadFolder || d.customer !== actualCustomer) return false;

            // Try exact match first
            if (d.name === diagramName) return true;

            // Try prefix match if we have a prefix
            if (diagramPrefix && d.name.startsWith(diagramPrefix)) return true;

            return false;
          });

          const existingInNew = Object.values(newDiagrams).find(d => {
            // Must match folder AND customer
            if (d.folder !== bulkUploadFolder || d.customer !== actualCustomer) return false;

            // Try exact match first
            if (d.name === diagramName) return true;

            // Try prefix match if we have a prefix
            if (diagramPrefix && d.name.startsWith(diagramPrefix)) return true;

            return false;
          });

          const existingDiagram = existingInSaved || existingInNew;

          let diagramId, newDiagram;

          if (existingDiagram) {
            // Update existing diagram
            console.log(`[ZIP Import] ✓ Found existing diagram "${diagramName}" (${existingInSaved ? 'in saved' : 'in batch'}) - updating instead of creating new`);
            diagramId = existingDiagram.id;
            newDiagram = {
              ...existingDiagram,
              pdfData: imageBase64,  // Update the exploded view image
              number: diagramNumber || existingDiagram.number,  // Update number if provided
              itemNo: diagramItemNo || existingDiagram.itemNo,  // Update itemNo if provided
              // Keep existing hotspots and partsData - will be updated later if parts list found
            };
          } else {
            // Create new diagram
            console.log(`[ZIP Import] ✗ No existing diagram found for "${diagramName}" (folder: "${bulkUploadFolder}", customer: "${actualCustomer}") - creating new`);
            diagramId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            newDiagram = {
              id: diagramId,
              name: diagramName,
              number: diagramNumber,
              itemNo: diagramItemNo,
              folder: bulkUploadFolder,
              customer: actualCustomer,
              pdfData: imageBase64,
              hotspots: {},
              partsData: {},
              createdAt: new Date().toISOString()
            };
          }

          console.log(`[ZIP Import] Created diagram ${diagramId} "${diagramName}" with pdfData type: ${typeof newDiagram.pdfData}, starts with: ${newDiagram.pdfData?.substring(0, 30)}`);

          // Check if matching parts lists exist (can be multiple pages)
          // Strip any -parts suffix from image baseName to match with parts lists
          const imageBaseName = imageFile.baseName.replace(/-parts\d*$/i, '');
          console.log(`[ZIP Import] ====================================`);
          console.log(`[ZIP Import] MATCHING for image: "${imageFile.fileName}"`);
          console.log(`[ZIP Import]   Image baseName: "${imageFile.baseName}"`);
          console.log(`[ZIP Import]   Match key: "${imageBaseName}"`);

          const matchingPartsLists = partsListFiles[imageBaseName];
          if (matchingPartsLists && matchingPartsLists.length > 0) {
            console.log(`[ZIP Import]   ✓ MATCH FOUND: ${matchingPartsLists.length} parts list page(s)`);
            console.log(`[ZIP Import]   Files: ${matchingPartsLists.map(p => p.fileName).join(', ')}`);

            // Sort parts lists to ensure correct order (base file or -parts first, then -parts2, -parts3, etc.)
            matchingPartsLists.sort((a, b) => {
              const getPageNum = (fileName) => {
                const match = fileName.match(/-parts(\d*)\.(pdf|txt|jpg|jpeg|png)$/i);
                if (!match) return 0; // File without -parts suffix comes first
                return match[1] ? parseInt(match[1]) : 1; // -parts = 1, -parts2 = 2, -parts3 = 3, etc.
              };
              return getPageNum(a.fileName) - getPageNum(b.fileName);
            });

            try {
              const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
              pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

              // Process each parts list PDF (parts, parts2, parts3, etc.)
              const allPartsData = {};
              const pageDetails = []; // Track what was extracted from each page
              let foundUnitName = null;
              let foundDrawNo = null;

              for (let pdfIndex = 0; pdfIndex < matchingPartsLists.length; pdfIndex++) {
                const partsList = matchingPartsLists[pdfIndex];

                // Treat any page after the first as a continuation page (after sorting, first page is index 0)
                const isContinuationPage = pdfIndex > 0;

                console.log(`[ZIP Import] Processing parts list page ${pdfIndex + 1}/${matchingPartsLists.length}: ${partsList.fileName} ${isContinuationPage ? '(continuation page)' : '(first page)'}`);

                try {
                  let fullText = '';

                  // Check if this is a text file, image file, or PDF
                  const isText = partsList.fileName.match(/\.txt$/i);
                  const isImage = partsList.fileName.match(/\.(jpg|jpeg|png)$/i);

                  if (isText) {
                    // Read .txt file directly (from ManualProcessor)
                    fullText = await partsList.zipFile.async('text');
                    console.log(`[ZIP Import] ✓ Reading text file: ${partsList.fileName} (${fullText.length} chars)`);
                  } else if (isImage) {
                    // First, check if there's a .txt file with pre-extracted text (from ManualProcessor)
                    const textFileName = partsList.fileName.replace(/\.(jpg|jpeg|png)$/i, '.txt');
                    const textFilePath = partsList.path.replace(/\.(jpg|jpeg|png)$/i, '.txt');

                    let textFile = null;
                    try {
                      textFile = await zip.file(textFilePath);
                    } catch (e) {
                      // Text file doesn't exist, will use OCR
                    }

                    if (textFile) {
                      // Use pre-extracted text from ManualProcessor
                      fullText = await textFile.async('text');
                      console.log(`[ZIP Import] ✓ Using pre-extracted text from ${textFileName} (${fullText.length} chars) - skipping OCR`);
                    } else {
                      // No text file found, use OCR with Tesseract
                      console.log(`[ZIP Import] No .txt file found, using OCR for image: ${partsList.fileName}`);
                      const imageBlob = await partsList.zipFile.async('blob');
                      const imageUrl = URL.createObjectURL(imageBlob);

                      // Import Tesseract dynamically
                      const { createWorker } = await import('tesseract.js');
                      const worker = await createWorker('eng');
                      const { data: { text } } = await worker.recognize(imageUrl);
                      await worker.terminate();
                      URL.revokeObjectURL(imageUrl);

                      fullText = text;
                      console.log(`[ZIP Import] OCR extracted ${fullText.length} characters from ${partsList.fileName}`);
                    }
                  } else {
                    // For PDFs: extract text using PDF.js
                    const pdfBlob = await partsList.zipFile.async('arraybuffer');

                    const pdf = await pdfjsLib.getDocument({ data: pdfBlob, ignoreEncryption: true }).promise;
                    const page = await pdf.getPage(1);
                    const textContent = await page.getTextContent();

                    // Group text items by Y position to reconstruct table rows
                    const lines = {};
                    textContent.items.forEach((item) => {
                      if (!item.str || !item.transform) return;
                      const y = Math.round(item.transform[5]);
                      const x = item.transform[4];
                      if (!lines[y]) lines[y] = [];
                      lines[y].push({ x, text: item.str });
                    });

                    // Sort lines by Y position (top to bottom)
                    const sortedY = Object.keys(lines).sort((a, b) => b - a);
                    sortedY.forEach(y => {
                      const lineItems = lines[y].sort((a, b) => a.x - b.x);
                      const lineText = lineItems.map(item => item.text).join(' ');
                      if (lineText.trim()) {
                        fullText += lineText + '\n';
                      }
                    });

                    // Clean up excessive spaces
                    fullText = fullText.replace(/\s{3,}/g, '  ');
                  }

                  console.log(`[ZIP Import] Extracted text from ${partsList.fileName} (first 500 chars):`, fullText.substring(0, 500));

                  // Parse parts list (pass flag if it's a continuation page)
                  const parsed = parsePartsListText(fullText, isContinuationPage);

                  if (parsed.partsData) {
                    console.log(`[ZIP Import] Successfully parsed parts from ${partsList.fileName}:`, Object.keys(parsed.partsData).length, 'parts');
                    console.log(`[ZIP Import] Sample parts:`, Object.entries(parsed.partsData).slice(0, 3));
                  } else if (parsed.error) {
                    console.error(`[ZIP Import] Parse error for ${partsList.fileName}:`, parsed.error);
                  }

                  const pageDetail = {
                    fileName: partsList.fileName,
                    pageNumber: pdfIndex + 1,
                    isContinuation: isContinuationPage,
                    success: !parsed.error,
                    error: parsed.error,
                    partsCount: parsed.partsData ? Object.keys(parsed.partsData).length : 0,
                    partsData: parsed.partsData || {},
                    partNumbers: parsed.partsData ? Object.keys(parsed.partsData).sort((a, b) => {
                      // "*" always comes first
                      if (a === '*') return -1;
                      if (b === '*') return 1;
                      // Sort numerically if both are numbers
                      const aNum = parseInt(a);
                      const bNum = parseInt(b);
                      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
                      return a.localeCompare(b);
                    }) : []
                  };
                  pageDetails.push(pageDetail);

                  if (!parsed.error && parsed.partsData) {
                    const pagePartCount = Object.keys(parsed.partsData).length;
                    const pagePartNumbers = Object.keys(parsed.partsData).join(', ');

                    console.log(`[ZIP Import] Page ${pdfIndex + 1} parsed ${pagePartCount} parts: ${pagePartNumbers}`);

                    // Check for duplicate part numbers before merging
                    const duplicates = Object.keys(parsed.partsData).filter(key => allPartsData[key]);
                    if (duplicates.length > 0) {
                      console.warn(`[ZIP Import] ⚠️ Page ${pdfIndex + 1} has duplicate part numbers that will overwrite previous: ${duplicates.join(', ')}`);
                    }

                    // Merge parts data from this page
                    Object.assign(allPartsData, parsed.partsData);

                    // Use the first found unit name and drawing number (only from first page)
                    if (!foundUnitName && parsed.unitName) foundUnitName = parsed.unitName;
                    if (!foundDrawNo && parsed.drawNo) foundDrawNo = parsed.drawNo;

                    console.log(`[ZIP Import] Total parts after page ${pdfIndex + 1}: ${Object.keys(allPartsData).length}`);
                  } else {
                    console.warn(`[ZIP Import] Failed to parse parts list page ${pdfIndex + 1}: ${parsed.error}`);
                  }
                } catch (pdfError) {
                  console.error(`[ZIP Import] Failed to parse parts list page ${pdfIndex + 1} (${partsList.fileName}):`, pdfError);
                  pageDetails.push({
                    fileName: partsList.fileName,
                    pageNumber: pdfIndex + 1,
                    isContinuation: isContinuationPage,
                    success: false,
                    error: pdfError.message,
                    partsCount: 0,
                    partsData: {},
                    partNumbers: []
                  });
                  // Continue with next page
                }
              }

              // Store debug info for this diagram
              if (!newDiagram._partsDebugInfo) {
                newDiagram._partsDebugInfo = {
                  diagramName: diagramName,
                  imageFileName: imageFile.fileName,
                  pageDetails: pageDetails,
                  totalParts: Object.keys(allPartsData).length
                };
              }

              // Apply merged parts data
              if (Object.keys(allPartsData).length > 0) {
                newDiagram.partsData = allPartsData;
                // Only override if we have actual values (not undefined, not null, not empty)
                if (foundUnitName && !tocEntry) newDiagram.name = foundUnitName;
                if (foundDrawNo && foundDrawNo !== 'undefined') newDiagram.number = foundDrawNo;
                console.log(`[ZIP Import] Total merged parts: ${Object.keys(allPartsData).length} from ${matchingPartsLists.length} page(s)`);
              }

              // Also capture the parts list source images
              console.log(`[ZIP Import] Checking for parts list images in ${matchingPartsLists.length} file(s)...`);
              const partsListImages = [];
              for (const partsList of matchingPartsLists) {
                console.log(`[ZIP Import]   Checking file: ${partsList.fileName}`);
                const isImage = partsList.fileName.match(/\.(jpg|jpeg|png)$/i);
                if (isImage) {
                  console.log(`[ZIP Import]   ✓ Found image file: ${partsList.fileName}`);
                  try {
                    const imageBlob = await partsList.zipFile.async('blob');
                    const imageBase64 = await new Promise((resolve) => {
                      const reader = new FileReader();
                      reader.onloadend = () => resolve(reader.result);
                      reader.readAsDataURL(imageBlob);
                    });
                    partsListImages.push({
                      fileName: partsList.fileName,
                      data: imageBase64
                    });
                    console.log(`[ZIP Import]   ✓ Captured parts list source image: ${partsList.fileName} (${imageBase64.length} chars)`);
                  } catch (imgError) {
                    console.error(`[ZIP Import]   ✗ Failed to capture parts list image ${partsList.fileName}:`, imgError);
                  }
                } else {
                  console.log(`[ZIP Import]   - Not an image file (skipping)`);
                }
              }
              if (partsListImages.length > 0) {
                newDiagram.partsListImages = partsListImages;
                console.log(`[ZIP Import] ✓ Stored ${partsListImages.length} parts list source image(s) in diagram`);
              } else {
                console.log(`[ZIP Import] ⚠️ No parts list images found to store`);
              }
            } catch (error) {
              console.error(`[ZIP Import] Failed to process parts lists for ${imageFile.fileName}:`, error);
              // Continue without parts data
            }
          } else {
            console.log(`[ZIP Import]   ✗ NO MATCH FOUND`);
            console.log(`[ZIP Import]   Looking for: "${imageBaseName}"`);
            console.log(`[ZIP Import]   Available parts list keys:`);
            Object.keys(partsListFiles).forEach(key => {
              console.log(`[ZIP Import]     - "${key}"`);
            });
          }

          // Deep clean to remove all undefined values (Firestore doesn't allow undefined)
          const deepClean = (obj) => {
            if (obj === null || obj === undefined) return null;
            if (typeof obj !== 'object') return obj;

            if (Array.isArray(obj)) {
              return obj.map(item => deepClean(item)).filter(item => item !== null && item !== undefined);
            }

            const cleaned = {};
            for (const [key, value] of Object.entries(obj)) {
              // Skip undefined and internal debug fields
              if (value === undefined || key.startsWith('_')) continue;

              if (value === null) {
                cleaned[key] = null;
              } else if (typeof value === 'object') {
                const cleanedValue = deepClean(value);
                // Keep empty objects and arrays (needed for partsData, hotspots)
                if (cleanedValue !== null && cleanedValue !== undefined) {
                  cleaned[key] = cleanedValue;
                } else if (Array.isArray(value) || Object.keys(value).length === 0) {
                  cleaned[key] = value;
                }
              } else {
                cleaned[key] = value;
              }
            }
            return cleaned;
          };

          const cleanedDiagram = deepClean(newDiagram);
          // Ensure required fields exist
          newDiagrams[diagramId] = {
            ...cleanedDiagram,
            hotspots: cleanedDiagram.hotspots || {},
            partsData: cleanedDiagram.partsData || {}
          };
        } catch (diagramError) {
          console.error(`[ZIP Import] Failed to process diagram ${imageFile.fileName}:`, diagramError);
          failedDiagrams.push({
            fileName: imageFile.fileName,
            error: diagramError.message
          });
          // Continue with next diagram
        }
      }

      console.log(`[ZIP Import] Created ${Object.keys(newDiagrams).length} diagrams, adding to savedDiagrams...`);

      // Collect debug info BEFORE diagrams are added (since _partsDebugInfo gets cleaned out)
      const debugInfo = Object.values(newDiagrams)
        .filter(d => d._partsDebugInfo)
        .map(d => d._partsDebugInfo);

      console.log(`[ZIP Import] Collected debug info for ${debugInfo.length} diagrams BEFORE cleaning`);

      // Log a sample diagram to verify pdfData
      const sampleId = Object.keys(newDiagrams)[0];
      if (sampleId) {
        const sample = newDiagrams[sampleId];
        console.log(`[ZIP Import] Sample diagram "${sample.name}":`);
        console.log(`  - ID: ${sampleId}`);
        console.log(`  - pdfData type: ${typeof sample.pdfData}`);
        console.log(`  - pdfData length: ${sample.pdfData?.length || 0}`);
        console.log(`  - pdfData preview: ${sample.pdfData?.substring(0, 100)}`);
        console.log(`  - Parts count: ${Object.keys(sample.partsData || {}).length}`);
      }

      // Add all diagrams
      const mergedDiagrams = { ...savedDiagrams, ...newDiagrams };
      console.log(`[ZIP Import] Total diagrams after merge: ${Object.keys(mergedDiagrams).length}`);
      setSavedDiagrams(mergedDiagrams);

      setOcrProgress(null);
      setShowBulkImageUpload(false);
      setBulkUploadZipMode(false);
      setBulkImageFiles([]);
      setBulkUploadCustomer('');
      setBulkUploadTocText('');

      console.log(`[ZIP Import] Total diagrams created: ${Object.keys(newDiagrams).length}`);
      console.log(`[ZIP Import] Diagrams with debug info: ${debugInfo.length}`);
      console.log(`[ZIP Import] Multi-page diagrams: ${debugInfo.filter(d => d.pageDetails.length > 1).length}`);

      if (debugInfo.length > 0) {
        setPartsDebugData(debugInfo);
        console.log('[ZIP Import] Set partsDebugData with', debugInfo.length, 'diagrams');
      }

      const diagsWithParts = debugInfo.length;
      const multiPageDiagrams = debugInfo.filter(d => d.pageDetails.length > 1);
      const multiPageCount = multiPageDiagrams.length;

      let message = `Successfully imported ${Object.keys(newDiagrams).length} of ${imageFiles.length} diagrams to folder "${bulkUploadFolder}" for customer "${actualCustomer}".`;

      if (diagsWithParts > 0) {
        message += `\n\n${diagsWithParts} diagram(s) with parts lists imported`;

        if (multiPageCount > 0) {
          message += ` (${multiPageCount} multi-page)`;
          message += `\n\nMulti-page parts lists:`;
          multiPageDiagrams.forEach(d => {
            message += `\n• ${d.diagramName}: ${d.pageDetails.length} pages, ${d.totalParts} total parts`;
          });
        }

        message += `\n\nClick "🔍 Review Parts Extraction" button to inspect details.`;
      }

      if (failedDiagrams.length > 0) {
        message += `\n\n⚠️ ${failedDiagrams.length} diagram(s) failed to process:`;
        failedDiagrams.forEach(f => {
          message += `\n• ${f.fileName}: ${f.error}`;
        });
        console.error('[ZIP Import] Failed diagrams:', failedDiagrams);
      }

      alert(message);

    } catch (error) {
      console.error('[ZIP Import] Error:', error);
      setOcrProgress(null);
      alert('Failed to process ZIP file.\n\nError: ' + error.message);
    }

    e.target.value = '';
  };

  const handleBulkImageSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Get diagrams in selected folder
    const diagramsInFolder = Object.values(savedDiagrams).filter(d =>
      d.folder === bulkUploadFolder &&
      (selectedCustomer === 'All Customers' || d.customer === selectedCustomer)
    );

    if (diagramsInFolder.length === 0) {
      alert('No diagrams found in the selected folder');
      return;
    }

    // Match each file to a diagram
    const matches = files.map(file => {
      // Remove file extension and normalize filename
      const fileName = file.name.replace(/\.(jpg|jpeg|png)$/i, '');
      const normalizedFileName = normalizeName(fileName);

      // Try to find best matching diagram
      let bestMatch = null;
      let bestScore = 0;

      diagramsInFolder.forEach(diagram => {
        const normalizedDiagramName = normalizeName(diagram.name);

        // Calculate similarity score (simple string match)
        // Check if diagram name is contained in filename or vice versa
        let score = 0;

        if (normalizedFileName.includes(normalizedDiagramName)) {
          score = normalizedDiagramName.length / normalizedFileName.length;
        } else if (normalizedDiagramName.includes(normalizedFileName)) {
          score = normalizedFileName.length / normalizedDiagramName.length;
        } else {
          // Calculate character overlap
          let overlap = 0;
          const minLength = Math.min(normalizedFileName.length, normalizedDiagramName.length);
          for (let i = 0; i < minLength; i++) {
            if (normalizedFileName[i] === normalizedDiagramName[i]) {
              overlap++;
            }
          }
          score = overlap / Math.max(normalizedFileName.length, normalizedDiagramName.length);
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = diagram;
        }
      });

      return {
        file,
        matchedDiagramId: bestMatch ? bestMatch.id : null,
        matchedDiagramName: bestMatch ? bestMatch.name : null,
        confidence: Math.round(bestScore * 100)
      };
    });

    setBulkImageFiles(matches);
  };

  // Compress image to stay under 1MB
  const compressImage = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const img = new Image();

        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Scale down if too large (max 2000px on longest side)
          const maxDimension = 2000;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = (height / width) * maxDimension;
              width = maxDimension;
            } else {
              width = (width / height) * maxDimension;
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Try different quality levels until under 700KB
          // (Target 700KB for image to leave room for metadata in Firestore's 1MB limit)
          let quality = 0.8;
          let imageData = canvas.toDataURL('image/jpeg', quality);
          let sizeKB = Math.round(imageData.length / 1024);

          while (sizeKB > 700 && quality > 0.3) {
            quality -= 0.1;
            imageData = canvas.toDataURL('image/jpeg', quality);
            sizeKB = Math.round(imageData.length / 1024);
          }

          console.log(`[Image Compression] Final size: ${sizeKB}KB at quality ${quality.toFixed(1)}`);

          if (sizeKB > 700) {
            reject(new Error(`Image too large (${sizeKB}KB) even at lowest quality. Target is 700KB for Firebase compatibility.`));
          } else {
            resolve(imageData);
          }
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  // Re-compress an existing base64 image to reduce size
  const recompressExistingImage = async (base64Data) => {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Scale down if too large (max 2000px on longest side)
        const maxDimension = 2000;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Try different quality levels until under 1MB
        let quality = 0.8;
        let imageData = canvas.toDataURL('image/jpeg', quality);
        let sizeKB = Math.round(imageData.length / 1024);

        while (sizeKB > 1024 && quality > 0.3) {
          quality -= 0.1;
          imageData = canvas.toDataURL('image/jpeg', quality);
          sizeKB = Math.round(imageData.length / 1024);
        }

        if (sizeKB > 1024) {
          reject(new Error(`Image too large (${sizeKB}KB) even at lowest quality`));
        } else {
          resolve(imageData);
        }
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = base64Data;
    });
  };

  // Run storage diagnostic to check localStorage usage and identify issues
  const runStorageDiagnostic = () => {
    try {
      // Calculate total localStorage size
      let totalSize = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          totalSize += localStorage[key].length + key.length;
        }
      }
      const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);

      // Analyze saved diagrams
      const saved = localStorage.getItem('savedDiagrams');
      if (!saved) {
        setDiagnosticData({
          totalSizeMB,
          diagramsCount: 0,
          corruptedDiagrams: [],
          largeDiagrams: [],
          validDiagrams: []
        });
        setShowStorageDiagnostic(true);
        return;
      }

      const diagrams = JSON.parse(saved);
      const corruptedDiagrams = [];
      const largeDiagrams = [];
      const validDiagrams = [];

      Object.keys(diagrams).forEach(diagramId => {
        const diagram = diagrams[diagramId];
        const pdfData = diagram.pdfData;

        if (!pdfData) {
          corruptedDiagrams.push({
            id: diagramId,
            name: diagram.name,
            reason: 'Missing pdfData',
            size: 0
          });
        } else if (typeof pdfData === 'string') {
          const sizeKB = Math.round(pdfData.length / 1024);
          const isImage = pdfData.startsWith('data:image');
          const isPdf = !isImage; // Assume PDF if not image
          const isValid = isImage || isPdf;

          const info = {
            id: diagramId,
            name: diagram.name,
            size: sizeKB,
            type: isImage ? 'image' : isPdf ? 'pdf' : 'unknown',
            isValid
          };

          if (!isValid || sizeKB > 5000) { // Flag if > 5MB
            if (!isValid) {
              corruptedDiagrams.push({ ...info, reason: 'Invalid format' });
            } else {
              largeDiagrams.push(info);
            }
          } else if (sizeKB > 1024) { // Flag if > 1MB but < 5MB
            largeDiagrams.push(info);
          } else {
            validDiagrams.push(info);
          }
        } else {
          corruptedDiagrams.push({
            id: diagramId,
            name: diagram.name,
            reason: 'Invalid pdfData type',
            size: 0
          });
        }
      });

      setDiagnosticData({
        totalSizeMB,
        diagramsCount: Object.keys(diagrams).length,
        corruptedDiagrams,
        largeDiagrams: largeDiagrams.sort((a, b) => b.size - a.size),
        validDiagrams: validDiagrams.sort((a, b) => b.size - a.size)
      });
      setShowStorageDiagnostic(true);
    } catch (error) {
      console.error('Diagnostic error:', error);
      alert(`Error running diagnostic: ${error.message}`);
    }
  };

  // Fix storage issues by re-compressing large images
  const fixStorageIssues = async () => {
    if (!diagnosticData) return;

    const { largeDiagrams } = diagnosticData;
    const imagesToFix = largeDiagrams.filter(d => d.type === 'image');

    if (imagesToFix.length === 0) {
      alert('No images to re-compress. Corrupted diagrams may need to be re-uploaded manually.');
      return;
    }

    if (!window.confirm(`Re-compress ${imagesToFix.length} large image(s)? This will reduce their quality to save space.`)) {
      return;
    }

    setFixingStorage(true);
    setSyncStatus(`Re-compressing images... 0/${imagesToFix.length}`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    const newDiagrams = { ...savedDiagrams };

    for (let i = 0; i < imagesToFix.length; i++) {
      const diagramInfo = imagesToFix[i];
      const diagram = newDiagrams[diagramInfo.id];

      try {
        setSyncStatus(`Re-compressing images... ${i + 1}/${imagesToFix.length}`);

        const compressedData = await recompressExistingImage(diagram.pdfData);
        const newSizeKB = Math.round(compressedData.length / 1024);

        console.log(`Re-compressed ${diagramInfo.name}: ${diagramInfo.size}KB → ${newSizeKB}KB`);

        newDiagrams[diagramInfo.id] = {
          ...diagram,
          pdfData: compressedData
        };

        successCount++;

        // Add delay to prevent UI freezing
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error re-compressing ${diagramInfo.name}:`, error);
        errors.push(`${diagramInfo.name}: ${error.message}`);
        errorCount++;
      }
    }

    // Update saved diagrams
    setSavedDiagrams(newDiagrams);

    setFixingStorage(false);
    setSyncStatus(null);

    if (errors.length > 0) {
      alert(`Re-compression completed with errors:\n\nSuccessful: ${successCount}\nFailed: ${errorCount}\n\nErrors:\n${errors.join('\n')}`);
    } else {
      alert(`✓ Successfully re-compressed ${successCount} image(s)!`);
    }

    // Re-run diagnostic to show new stats
    setTimeout(() => runStorageDiagnostic(), 500);
  };

  // Delete corrupted diagrams
  const deleteCorruptedDiagrams = async () => {
    if (!diagnosticData || diagnosticData.corruptedDiagrams.length === 0) return;

    const count = diagnosticData.corruptedDiagrams.length;
    if (!window.confirm(`Delete ${count} corrupted diagram(s)? This will delete from BOTH localStorage AND Firebase.`)) {
      return;
    }

    setSyncStatus('Deleting corrupted diagrams...');

    // Delete from Firebase
    try {
      console.log('[deleteCorruptedDiagrams] Deleting from Firebase...');
      const deletePromises = diagnosticData.corruptedDiagrams.map(d => {
        console.log('[deleteCorruptedDiagrams] Deleting:', d.id);
        return deleteFromFirebase(d.id);
      });
      await Promise.all(deletePromises);
      console.log('[deleteCorruptedDiagrams] ✓ Deleted all from Firebase');
    } catch (error) {
      console.error('[deleteCorruptedDiagrams] Error deleting from Firebase:', error);
      // Continue with local deletion even if Firebase fails
    }

    // Delete from local state
    const newDiagrams = { ...savedDiagrams };
    diagnosticData.corruptedDiagrams.forEach(d => {
      delete newDiagrams[d.id];
    });

    console.log('[deleteCorruptedDiagrams] Remaining diagrams:', Object.keys(newDiagrams).length);
    setSavedDiagrams(newDiagrams);

    // Wait for state update and localStorage save to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    setSyncStatus(null);
    alert(`✓ Deleted ${count} corrupted diagram(s) from localStorage and Firebase`);

    // Re-run diagnostic after a delay to ensure localStorage is updated
    setTimeout(() => runStorageDiagnostic(), 500);
  };

  // Clean localStorage AND Firebase by removing ALL pdfData (diagrams will load from Firebase on-demand)
  const cleanLocalStorage = async () => {
    if (!window.confirm(
      `Clean BOTH localStorage AND Firebase by removing all PDF/image data?\n\n` +
      `This will:\n` +
      `✓ Keep all diagram names, folders, parts lists, and hotspots\n` +
      `✓ Remove all PDF/image data from localStorage AND Firebase\n` +
      `✓ You'll need to re-upload diagram images using "Update Diagram" or "Bulk Upload"\n\n` +
      `This is SAFE and will fix all corruption issues.\n\n` +
      `Continue?`
    )) {
      return;
    }

    setIsLoadingHeavy(true);
    setSyncStatus('Cleaning localStorage and Firebase...');

    try {
      // Remove pdfData from all diagrams in state
      const cleanedDiagrams = {};
      Object.keys(savedDiagrams).forEach(id => {
        const { pdfData, ...diagramWithoutPdf } = savedDiagrams[id];
        cleanedDiagrams[id] = diagramWithoutPdf;
      });

      // First update local state
      setSavedDiagrams(cleanedDiagrams);

      // Then sync cleaned versions to Firebase (to overwrite corrupted data)
      setSyncStatus('Syncing cleaned diagrams to Firebase...');
      let syncedCount = 0;
      const totalDiagrams = Object.keys(cleanedDiagrams).length;

      for (const diagramId of Object.keys(cleanedDiagrams)) {
        try {
          await saveToFirebase(diagramId, cleanedDiagrams[diagramId]);
          console.log('[cleanLocalStorage] Saved cleaned diagram to Firebase:', diagramId);
          syncedCount++;
          setSyncStatus(`Syncing to Firebase... ${syncedCount}/${totalDiagrams}`);
        } catch (error) {
          console.error(`[cleanLocalStorage] Failed to sync ${diagramId}:`, error);
        }
      }

      setIsLoadingHeavy(false);
      setSyncStatus('✓ Cleanup complete');
      setTimeout(() => setSyncStatus(null), 2000);

      alert(
        `✓ Cleanup complete!\n\n` +
        `${syncedCount} diagram(s) cleaned and synced to Firebase.\n\n` +
        `All diagram metadata (names, folders, parts, hotspots) preserved.\n` +
        `PDF/image data removed.\n\n` +
        `Next steps:\n` +
        `1. Use "Update Diagram" to re-upload individual images\n` +
        `2. OR use "Bulk Image Upload" to upload many images at once`
      );

      // Re-run diagnostic
      setTimeout(() => runStorageDiagnostic(), 500);
    } catch (error) {
      console.error('Cleanup error:', error);
      setIsLoadingHeavy(false);
      setSyncStatus(null);
      alert(`Error during cleanup: ${error.message}`);
    }
  };

  // Apply bulk image uploads
  const handleApplyBulkUpload = async () => {
    const validMatches = bulkImageFiles.filter(m => m.matchedDiagramId !== null);

    if (validMatches.length === 0) {
      alert('No valid matches found. Please check the folder selection.');
      return;
    }

    if (!window.confirm(`Upload ${validMatches.length} parts list image(s) to matched diagrams?`)) {
      return;
    }

    setIsLoadingHeavy(true);
    setSyncStatus(`Compressing and uploading images... 0/${validMatches.length}`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let i = 0; i < validMatches.length; i++) {
      const match = validMatches[i];

      try {
        setSyncStatus(`Compressing and uploading images... ${i + 1}/${validMatches.length}`);

        // Compress image to stay under 1MB
        const compressedImageData = await compressImage(match.file);

        // Update diagram with new parts list image
        const diagram = savedDiagrams[match.matchedDiagramId];
        const existingPartsListImages = diagram.partsListImages || [];

        // Check if this filename already exists in the parts list images
        const existingIndex = existingPartsListImages.findIndex(img => img.fileName === match.file.name);

        let updatedPartsListImages;
        if (existingIndex >= 0) {
          // Replace existing image
          updatedPartsListImages = [...existingPartsListImages];
          updatedPartsListImages[existingIndex] = {
            fileName: match.file.name,
            data: compressedImageData
          };
          console.log(`[bulkUpload] Replaced existing parts list image: ${match.file.name}`);
        } else {
          // Add new image to array
          updatedPartsListImages = [
            ...existingPartsListImages,
            {
              fileName: match.file.name,
              data: compressedImageData
            }
          ];
          console.log(`[bulkUpload] Added new parts list image: ${match.file.name}`);
        }

        const updatedDiagram = {
          ...diagram,
          partsListImages: updatedPartsListImages
        };

        setSavedDiagrams(prev => ({
          ...prev,
          [match.matchedDiagramId]: updatedDiagram
        }));

        // Auto-sync to Firebase
        try {
          await saveToFirebase(match.matchedDiagramId, updatedDiagram);
          console.log('[bulkUpload] Saved diagram to Firebase:', match.matchedDiagramId);
        } catch (error) {
          if (error.isWarning) {
            console.warn('[bulkUpload] Size warning:', error.message);
          } else {
            console.error('[bulkUpload] Failed to sync to Firebase:', error);
          }
        }

        successCount++;

        // Small delay to prevent overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Error uploading image:', error);
        errorCount++;
        errors.push(`${match.file.name}: ${error.message}`);
      }
    }

    setIsLoadingHeavy(false);
    setSyncStatus(null);

    let message = `✓ Bulk parts list upload complete!\n\nSuccess: ${successCount}\nFailed: ${errorCount}`;
    if (errors.length > 0 && errors.length <= 5) {
      message += '\n\nErrors:\n' + errors.join('\n');
    }
    alert(message);

    // Clear bulk upload state
    setShowBulkImageUpload(false);
    setBulkImageFiles([]);
  };

  // Copy diagram to a different folder/customer
  const copyDiagram = (diagramId) => {
    const diagram = savedDiagrams[diagramId];
    if (!diagram) return;

    const folders = getFolders();
    const customers = getCustomers();

    // Ask for target folder
    let targetFolder = prompt(
      `Copy "${diagram.name}" to which folder?\n\nAvailable folders:\n${folders.join('\n')}\n\nOr enter a new folder name:`,
      diagram.folder
    );

    if (!targetFolder || !targetFolder.trim()) return;
    targetFolder = targetFolder.trim();

    // Ask for target customer
    let targetCustomer = prompt(
      `Select customer for the copied diagram:\n\nAvailable customers:\n${customers.join('\n')}\n\nOr enter a new customer name:`,
      diagram.customer || 'General'
    );

    if (!targetCustomer || !targetCustomer.trim()) return;
    targetCustomer = targetCustomer.trim();

    // Create a copy with new ID
    const newDiagramId = Date.now().toString();
    const copiedDiagram = {
      ...diagram,
      id: newDiagramId,
      name: `${diagram.name} (Copy)`,
      folder: targetFolder,
      customer: targetCustomer,
      createdAt: new Date().toISOString()
    };

    setSavedDiagrams(prev => ({
      ...prev,
      [newDiagramId]: copiedDiagram
    }));

    alert(`Diagram copied successfully to folder "${targetFolder}" and customer "${targetCustomer}"!`);
  };

  // Copy diagram data (PDF, parts, hotspots) to another diagram
  const copyDiagramDataTo = (sourceDiagramId, folderDiagrams) => {
    const sourceDiagram = savedDiagrams[sourceDiagramId];
    if (!sourceDiagram) return;

    // Get other diagrams in the same folder
    const otherDiagrams = folderDiagrams.filter(d => d.id !== sourceDiagramId);

    if (otherDiagrams.length === 0) {
      alert('No other diagrams in this folder to copy data to.');
      return;
    }

    // Create a list for the prompt
    const diagramList = otherDiagrams
      .map((d, i) => `${i + 1}. ${d.name}${d.number ? ` (${d.number})` : ''}`)
      .join('\n');

    const selection = prompt(
      `Copy data from "${sourceDiagram.name}" to which diagram?\n\n${diagramList}\n\nEnter the number:`
    );

    if (!selection) return;

    const index = parseInt(selection) - 1;
    if (isNaN(index) || index < 0 || index >= otherDiagrams.length) {
      alert('Invalid selection.');
      return;
    }

    const targetDiagram = otherDiagrams[index];

    // Confirm the copy
    const confirm = window.confirm(
      `Copy data from "${sourceDiagram.name}" to "${targetDiagram.name}"?\n\n` +
      `This will copy:\n` +
      `- PDF diagram\n` +
      `- Parts list (${Object.keys(sourceDiagram.partsData || {}).length} parts)\n` +
      `- Hotspots (${Object.keys(sourceDiagram.hotspots || {}).length} hotspots)\n\n` +
      `Target diagram's existing data will be replaced.`
    );

    if (!confirm) return;

    // Copy the data
    setSavedDiagrams(prev => ({
      ...prev,
      [targetDiagram.id]: {
        ...prev[targetDiagram.id],
        pdfData: sourceDiagram.pdfData,
        partsData: { ...sourceDiagram.partsData },
        hotspots: { ...sourceDiagram.hotspots }
      }
    }));

    alert(`Successfully copied data from "${sourceDiagram.name}" to "${targetDiagram.name}"!`);
  };

  // Get all unique customers from diagrams
  const getCustomers = () => {
    const customers = new Set();
    Object.values(savedDiagrams).forEach(diagram => {
      customers.add(diagram.customer || 'General');
    });
    return Array.from(customers).sort();
  };

  // Get diagrams filtered by customer
  const getDiagramsByCustomer = (customer) => {
    if (customer === 'All Customers') {
      return savedDiagrams;
    }
    const filtered = {};
    Object.keys(savedDiagrams).forEach(diagramId => {
      if (savedDiagrams[diagramId].customer === customer) {
        filtered[diagramId] = savedDiagrams[diagramId];
      }
    });
    return filtered;
  };

  // Customer management functions
  const handleAddCustomer = () => {
    const customerName = prompt('Enter new customer name:');
    if (!customerName || !customerName.trim()) return;

    const trimmedName = customerName.trim();
    const existingCustomers = getCustomers();

    if (existingCustomers.includes(trimmedName)) {
      alert(`Customer "${trimmedName}" already exists!`);
      return;
    }

    // Create a placeholder diagram for this customer so it shows up in the list
    // Or just show a success message - the customer will be created when a diagram is assigned to it
    alert(`Customer "${trimmedName}" will be available when you create a diagram.\n\nTo use it:\n1. Create or edit a diagram\n2. Select "${trimmedName}" from the customer dropdown`);
  };

  const handleRenameCustomer = (oldName) => {
    if (oldName === 'General') {
      alert('Cannot rename the "General" customer');
      return;
    }

    const newName = prompt(`Rename customer "${oldName}" to:`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;

    const trimmedName = newName.trim();
    const existingCustomers = getCustomers();

    if (existingCustomers.includes(trimmedName)) {
      alert(`Customer "${trimmedName}" already exists!`);
      return;
    }

    // Update all diagrams with this customer
    const updatedDiagrams = {};
    Object.keys(savedDiagrams).forEach(id => {
      if (savedDiagrams[id].customer === oldName) {
        updatedDiagrams[id] = {
          ...savedDiagrams[id],
          customer: trimmedName
        };
      } else {
        updatedDiagrams[id] = savedDiagrams[id];
      }
    });

    setSavedDiagrams(updatedDiagrams);

    // Update selected customer if it was the one being renamed
    if (selectedCustomer === oldName) {
      setSelectedCustomer(trimmedName);
    }

    alert(`✓ Renamed "${oldName}" to "${trimmedName}"`);
  };

  const handleDeleteCustomer = (customerName) => {
    if (customerName === 'General') {
      alert('Cannot delete the "General" customer');
      return;
    }

    const diagramsInCustomer = Object.values(savedDiagrams).filter(
      d => d.customer === customerName
    );

    if (!window.confirm(
      `Delete customer "${customerName}"?\n\n` +
      `${diagramsInCustomer.length} diagram(s) will be moved to "General" customer.\n\n` +
      `This cannot be undone.`
    )) {
      return;
    }

    // Move all diagrams to General customer
    const updatedDiagrams = {};
    Object.keys(savedDiagrams).forEach(id => {
      if (savedDiagrams[id].customer === customerName) {
        updatedDiagrams[id] = {
          ...savedDiagrams[id],
          customer: 'General'
        };
      } else {
        updatedDiagrams[id] = savedDiagrams[id];
      }
    });

    setSavedDiagrams(updatedDiagrams);

    alert(`✓ Deleted customer "${customerName}"\n${diagramsInCustomer.length} diagram(s) moved to "General"`);
  };

  const deleteCustomer = (customerName) => {
    if (customerName === 'General') {
      alert('Cannot delete the "General" customer');
      return;
    }

    const diagramsInCustomer = Object.values(savedDiagrams).filter(
      d => d.customer === customerName
    );

    // Delete all diagrams in this customer
    const updatedDiagrams = {};
    Object.keys(savedDiagrams).forEach(id => {
      if (savedDiagrams[id].customer !== customerName) {
        updatedDiagrams[id] = savedDiagrams[id];
      }
    });

    setSavedDiagrams(updatedDiagrams);

    alert(`✓ Deleted customer "${customerName}" and ${diagramsInCustomer.length} diagram(s)`);
  };

  // Create diagrams from book layout text
  const handleCreateDiagramBook = () => {
    if (!diagramBookText.trim()) {
      alert('Please paste the diagram book text');
      return;
    }

    const lines = diagramBookText.trim().split('\n').map(line => line.trim()).filter(line => line);

    if (lines.length === 0 || lines.length % 4 !== 0) {
      alert('Invalid format. Each diagram needs 4 lines:\n1. Section\n2. Unit Name\n3. Part Code\n4. Draw No.');
      return;
    }

    const customerName = prompt('Enter customer name for these diagrams:', 'General');
    if (!customerName) return;

    const folderName = prompt('Enter folder name for these diagrams:', 'General');
    if (!folderName) return;

    const createdDiagrams = [];
    const timestamp = Date.now();

    for (let i = 0; i < lines.length; i += 4) {
      const section = lines[i];
      const unitName = lines[i + 1];
      const partCode = lines[i + 2];
      const drawNo = lines[i + 3];

      const diagramId = `${timestamp}-${i / 4}`;
      const diagramName = `${section} - ${unitName}`;

      const newDiagram = {
        id: diagramId,
        name: diagramName,
        number: drawNo,
        customer: customerName.trim(),
        folder: folderName.trim(),
        section: section,
        unitName: unitName,
        partCode: partCode,
        drawNo: drawNo,
        pdfData: null, // Will be added later
        partsData: {}, // Will be added later
        hotspots: {},
        createdAt: new Date().toISOString()
      };

      createdDiagrams.push({ id: diagramId, diagram: newDiagram });
    }

    // Add all diagrams to state
    setSavedDiagrams(prev => {
      const updated = { ...prev };
      createdDiagrams.forEach(({ id, diagram }) => {
        updated[id] = diagram;
      });
      return updated;
    });

    setShowDiagramBookForm(false);
    setDiagramBookText('');
    alert(`Successfully created ${createdDiagrams.length} diagrams!\nYou can now add PDFs and parts lists to each diagram.`);
  };

  const editDiagramNumber = (diagramId, newNumber) => {
    setSavedDiagrams(prev => ({
      ...prev,
      [diagramId]: {
        ...prev[diagramId],
        number: newNumber ? newNumber.trim() : ''
      }
    }));
  };

  // Extract diagram numbers from diagram names for diagrams missing the number field
  const autoPopulateDiagramNumbers = () => {
    let updatedCount = 0;
    const updates = {};

    Object.values(savedDiagrams).forEach(diagram => {
      // Skip if diagram already has a number
      if (diagram.number && diagram.number.trim() !== '') {
        return;
      }

      // Try to extract diagram number from the name
      // Pattern: "88-1-CONTROL-UNIT-SIG-4D-30690" -> extract "4D-30690"
      // Look for the last segment that matches a pattern like "XD-XXXXX" or similar
      const name = diagram.name;

      // Try to match patterns like "4D-30690" at the end
      // This pattern looks for: letter(s)-digit(s) or digit(s)-letter(s) at the end
      const match = name.match(/[A-Z0-9]+-[A-Z0-9]+$/i);

      if (match) {
        const extractedNumber = match[0];
        updates[diagram.id] = {
          ...diagram,
          number: extractedNumber
        };
        updatedCount++;
        console.log(`Extracted "${extractedNumber}" from "${name}"`);
      }
    });

    if (updatedCount > 0) {
      setSavedDiagrams(prev => ({
        ...prev,
        ...updates
      }));
      alert(`Successfully populated ${updatedCount} diagram number${updatedCount !== 1 ? 's' : ''} from diagram names!`);
    } else {
      alert('No diagram numbers could be extracted. All diagrams either have numbers or their names don\'t match the expected pattern.');
    }
  };

  const currentDiagram = currentDiagramId ? savedDiagrams[currentDiagramId] : null;

  return (
    <div style={{
      padding: '20px',
      backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
      minHeight: '100vh',
      transition: 'background-color 0.3s ease'
    }}>
      <div style={{ maxWidth: '100%', margin: '0 auto', padding: '0 20px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <h1 style={{
            textAlign: 'center',
            margin: 0,
            color: darkMode ? '#fff' : '#333',
            flex: 1
          }}>
            Interactive Parts Manual Editor
          </h1>
          <button
            onClick={() => setDarkMode(!darkMode)}
            style={{
              padding: '10px 20px',
              backgroundColor: darkMode ? '#333' : '#fff',
              color: darkMode ? '#fff' : '#333',
              border: `2px solid ${darkMode ? '#555' : '#ddd'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.3s ease'
            }}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
          {onLogout && (
            <button
              onClick={onLogout}
              style={{
                padding: '10px 20px',
                backgroundColor: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.3s ease'
              }}
              title="Sign Out"
            >
              Sign Out
            </button>
          )}
        </div>

        {/* Navigation Tabs */}
        <div style={{
          display: 'flex',
          gap: '10px',
          marginBottom: '20px',
          justifyContent: 'center'
        }}>
          <button
            onClick={() => setCurrentView('viewer')}
            style={{
              padding: '12px 24px',
              backgroundColor: currentView === 'viewer' ? '#2196f3' : (darkMode ? '#333' : '#e0e0e0'),
              color: currentView === 'viewer' ? 'white' : (darkMode ? '#fff' : '#333'),
              border: darkMode ? '1px solid #555' : 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '14px',
              transition: 'all 0.3s ease'
            }}
          >
            📊 Parts Viewer
          </button>
          <button
            onClick={() => setCurrentView('pdf-converter')}
            style={{
              padding: '12px 24px',
              backgroundColor: currentView === 'pdf-converter' ? '#2196f3' : (darkMode ? '#333' : '#e0e0e0'),
              color: currentView === 'pdf-converter' ? 'white' : (darkMode ? '#fff' : '#333'),
              border: darkMode ? '1px solid #555' : 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '14px',
              transition: 'all 0.3s ease'
            }}
          >
            📄 PDF to CSV Converter
          </button>
        </div>

        {/* Conditional Rendering */}
        {currentView === 'pdf-converter' ? (
          <PdfToCsvConverter onImportToViewer={handleCsvImport} />
        ) : (
          <>

        {/* Diagram Selection Bar */}
        <div style={{
          backgroundColor: darkMode ? '#2a2a2a' : '#fff',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
          boxShadow: darkMode ? '0 2px 4px rgba(0,0,0,0.5)' : '0 2px 4px rgba(0,0,0,0.1)',
          border: darkMode ? '1px solid #444' : 'none',
          transition: 'all 0.3s ease'
        }}>
          <div style={{
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: '16px'
          }}>
            <strong style={{
              color: darkMode ? '#fff' : '#333',
              fontSize: '14px'
            }}>Saved Diagrams (by Customer)</strong>

            <label
              style={{
                padding: '8px 16px',
                backgroundColor: '#2196f3',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Import customer diagrams from JSON"
            >
              📤 Import Customer
              <input
                type="file"
                accept=".json"
                onChange={handleImportCustomer}
                style={{ display: 'none' }}
              />
            </label>

            <button
              onClick={() => {
                setShowBulkImageUpload(true);
                setBulkUploadZipMode(false);
                setBulkUploadFolder('');
                setBulkUploadCustomer(selectedCustomer === 'All Customers' ? '' : selectedCustomer);
                setBulkImageFiles([]);
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#00bcd4',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Bulk upload parts list images with manual diagram selection"
            >
              🖼️ Bulk Add Parts Images
            </button>

            <button
              onClick={() => {
                setShowQuickStartWizard(true);
                setWizardStep(1);
                setWizardData({
                  customer: selectedCustomer === 'All Customers' ? 'General' : selectedCustomer,
                  folder: '',
                  tocText: '',
                  diagramCount: 0,
                  createdDiagramIds: []
                });
              }}
              style={{
                padding: '10px 20px',
                backgroundColor: '#ff9800',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                boxShadow: '0 2px 4px rgba(255,152,0,0.3)'
              }}
              title="Step-by-step wizard to create diagrams quickly"
            >
              🚀 Quick Start Wizard
            </button>

            <button
              onClick={() => setShowCustomerManager(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#9c27b0',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Manage customers"
            >
              👥 Manage Customers
            </button>

            <button
              onClick={() => setShowDiagramBookForm(!showDiagramBookForm)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#3f51b5',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Create multiple diagrams from text"
            >
              {showDiagramBookForm ? 'Cancel Book' : '📖 Create Diagram Book'}
            </button>

            <button
              onClick={() => setShowTocRenamer(!showTocRenamer)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#00897b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Batch create or rename diagrams using table of contents"
            >
              {showTocRenamer ? 'Cancel' : '📋 Batch Create/Rename'}
            </button>

            <button
              onClick={autoPopulateDiagramNumbers}
              style={{
                padding: '8px 16px',
                backgroundColor: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Auto-extract diagram numbers from diagram names"
            >
              # Auto-Populate Numbers
            </button>

            <button
              onClick={() => setShowHelp(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#2196f3',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="View help guide for Parts Viewer"
            >
              📖 Help Guide
            </button>

            <button
              onClick={runStorageDiagnostic}
              style={{
                padding: '8px 16px',
                backgroundColor: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Check localStorage usage and fix corrupted diagrams"
            >
              🔧 Storage Diagnostic
            </button>

            <button
              onClick={() => {
                setShowBulkImageUpload(!showBulkImageUpload);
                setBulkImageFiles([]);
                setBulkUploadFolder('');
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#9c27b0',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Upload multiple images and auto-match to diagrams"
            >
              {showBulkImageUpload ? 'Cancel Bulk Upload' : '🖼️ Bulk Image Upload'}
            </button>

            {partsDebugData && partsDebugData.length > 0 && (
              <button
                onClick={() => setShowPartsDebugModal(true)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#2196f3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '13px'
                }}
                title="Review parts extraction from all parts list PDFs"
              >
                🔍 Review Parts Extraction ({partsDebugData.length})
              </button>
            )}

            <button
              onClick={() => setShowUploadForm(!showUploadForm)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#ff9800',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px',
                marginLeft: 'auto'
              }}
            >
              {showUploadForm ? 'Cancel' : '+ New Diagram'}
            </button>

            <label
              title="Pick a Manual-Manifest-*.json from ManualProcessor → Step 3 → Download JSON for PartsViewer."
              style={{
                padding: '8px 16px',
                backgroundColor: manifestImporting ? '#666' : '#3b82f6',
                color: 'white',
                borderRadius: '6px',
                cursor: manifestImporting ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: '13px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {manifestImporting ? 'Importing…' : '🔗 Import Manifest'}
              <input
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                disabled={manifestImporting}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (f) importManualManifest(f);
                  e.target.value = '';
                }}
              />
            </label>
            <span style={{
              fontSize: '11px',
              color: '#6b7280',
              marginLeft: '4px',
              maxWidth: '260px',
              lineHeight: 1.3
            }}>
              ManualProcessor → Step 3 → <strong>Download JSON for PartsViewer</strong>, then drop it here. Hotspots come pre-placed.
            </span>

            <label style={{
              padding: '8px 16px',
              backgroundColor: '#9c27b0',
              color: 'white',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '13px'
            }}>
              Import
              <input
                type="file"
                accept=".json"
                onChange={importDiagram}
                style={{ display: 'none' }}
              />
            </label>

            <button
              onClick={handleLoadFromFirebase}
              style={{
                padding: '8px 16px',
                backgroundColor: '#ff5722',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Load all diagrams from Firebase"
            >
              ☁️ Load from Firebase
            </button>

            <button
              onClick={handleSyncAllToFirebase}
              style={{
                padding: '8px 16px',
                backgroundColor: '#795548',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Sync all local diagrams to Firebase"
            >
              ☁️ Sync All to Firebase
            </button>

            <button
              onClick={handleOpenFirebaseManager}
              style={{
                padding: '8px 16px',
                backgroundColor: '#673ab7',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="View and manage Firebase files"
            >
              📁 Manage Firebase Files
            </button>

            <button
              onClick={handleRepairImages}
              style={{
                padding: '8px 16px',
                backgroundColor: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px'
              }}
              title="Reconnect diagrams to orphaned images in Firebase Storage"
            >
              🔧 Repair Missing Images
            </button>
          </div>

          {syncStatus && (
            <div style={{
              marginTop: '12px',
              padding: '8px 12px',
              backgroundColor: darkMode
                ? (syncStatus.includes('✓') ? '#1b5e20' : syncStatus.includes('✗') ? '#b71c1c' : '#e65100')
                : (syncStatus.includes('✓') ? '#e8f5e9' : syncStatus.includes('✗') ? '#ffebee' : '#fff3e0'),
              border: `1px solid ${syncStatus.includes('✓') ? '#4caf50' : syncStatus.includes('✗') ? '#f44336' : '#ff9800'}`,
              borderRadius: '4px',
              color: darkMode ? '#fff' : '#333',
              fontSize: '13px',
              fontWeight: 'bold'
            }}>
              {syncStatus}
            </div>
          )}

          {/* Customer > Folder Hierarchy */}
          {Object.keys(savedDiagrams).length > 0 ? (
            Object.entries(getDiagramsByCustomerAndFolder()).map(([customerName, folders]) => {
              const totalDiagrams = Object.values(folders).reduce((sum, diagrams) => sum + diagrams.length, 0);

              return (
                <div key={customerName} style={{
                  marginBottom: '16px',
                  border: darkMode ? '2px solid #555' : '2px solid #ccc',
                  borderRadius: '8px',
                  overflow: 'hidden'
                }}>
                  {/* Customer Header */}
                  <div style={{
                    backgroundColor: darkMode ? '#2a2a2a' : '#e8e8e8',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    borderBottom: collapsedCustomers[customerName] ? 'none' : (darkMode ? '2px solid #555' : '2px solid #ccc'),
                    flexWrap: 'nowrap'
                  }}>
                    <span
                      style={{
                        fontSize: '16px',
                        fontWeight: 'bold',
                        color: darkMode ? '#4fc3f7' : '#1976d2',
                        cursor: 'pointer',
                        flex: 1
                      }}
                      onClick={() => setCollapsedCustomers(prev => ({
                        ...prev,
                        [customerName]: !prev[customerName]
                      }))}
                    >
                      {collapsedCustomers[customerName] ? '▶' : '▼'} {customerName} ({totalDiagrams} diagrams)
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportCustomerByName(customerName);
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#4caf50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        flexShrink: 0
                      }}
                      title={`Export ${customerName}'s diagrams`}
                    >
                      📥 Export
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRenameCustomer(customerName);
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: 'transparent',
                        color: darkMode ? '#aaa' : '#666',
                        border: darkMode ? '1px solid #666' : '1px solid #999',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        flexShrink: 0
                      }}
                      title="Rename customer"
                    >
                      ✎
                    </button>
                    {customerName !== 'General' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete customer "${customerName}" and all ${totalDiagrams} diagrams?`)) {
                            deleteCustomer(customerName);
                          }
                        }}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'transparent',
                          color: '#f44336',
                          border: '1px solid #f44336',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '11px',
                          flexShrink: 0
                        }}
                        title="Delete customer and all diagrams"
                      >
                        ✕
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const folderName = prompt(`Create new folder (machine type) under "${customerName}":`, '');
                        if (folderName && folderName.trim()) {
                          // Check if folder already exists for this customer
                          const existingFolders = Object.keys(folders);
                          if (existingFolders.includes(folderName.trim())) {
                            alert(`Folder "${folderName.trim()}" already exists under this customer.`);
                            return;
                          }
                          // Create a placeholder diagram to establish the folder
                          const newDiagramId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                          const newDiagram = {
                            id: newDiagramId,
                            name: `New Diagram in ${folderName.trim()}`,
                            number: '',
                            customer: customerName,
                            folder: folderName.trim(),
                            partsData: {},
                            hotspots: {},
                            pdfData: null,
                            createdAt: new Date().toISOString()
                          };
                          setSavedDiagrams(prev => ({
                            ...prev,
                            [newDiagramId]: newDiagram
                          }));
                          setCurrentDiagramId(newDiagramId);
                          alert(`✓ Created new folder "${folderName.trim()}" under "${customerName}"\n\nA placeholder diagram was created. You can rename it or add more diagrams to this folder.`);
                        }
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#009688',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        flexShrink: 0
                      }}
                      title="Create new folder under this customer"
                    >
                      + New Folder
                    </button>
                  </div>

                  {/* Folders within Customer */}
                  {!collapsedCustomers[customerName] && Object.entries(folders).map(([folderName, diagrams]) => (
                    <div key={`${customerName}-${folderName}`} style={{
                      marginBottom: '0',
                      borderTop: darkMode ? '1px solid #444' : '1px solid #e0e0e0'
                    }}>
                      {/* Folder Header */}
                      <div style={{
                        backgroundColor: darkMode ? '#333' : '#f5f5f5',
                        padding: '8px 12px 8px 28px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        borderBottom: collapsedFolders[`${customerName}-${folderName}`] ? 'none' : (darkMode ? '1px solid #444' : '1px solid #e0e0e0'),
                        flexWrap: 'nowrap',
                        overflowX: 'visible'
                      }}
                        onClick={() => setCollapsedFolders(prev => ({
                          ...prev,
                          [`${customerName}-${folderName}`]: !prev[`${customerName}-${folderName}`]
                        }))}
                      >
                        <span style={{
                          fontSize: '14px',
                          fontWeight: 'bold',
                          color: darkMode ? '#fff' : '#666',
                          width: 'auto',
                          marginBottom: '0'
                        }}>
                          {collapsedFolders[`${customerName}-${folderName}`] ? '▶' : '▼'} {folderName} ({diagrams.length})
                        </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      arrangeDiagramsInFolder(folderName, diagrams);
                    }}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: '#009688',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      marginLeft: 'auto',
                      flexShrink: 0
                    }}
                    title={`Arrange diagrams in "${folderName}" numerically`}
                  >
                    ⇅
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveFolderToFirebase(customerName, folderName, diagrams);
                    }}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: '#ff5722',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      flexShrink: 0
                    }}
                    title={`Save all diagrams in "${customerName} > ${folderName}" to Firebase`}
                  >
                    ☁️↑
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLoadFolderFromFirebase(customerName, folderName);
                    }}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: '#2196f3',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      flexShrink: 0
                    }}
                    title={`Load diagrams from "${customerName} > ${folderName}" on Firebase`}
                  >
                    ☁️↓
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const newName = prompt(`Rename folder "${folderName}" to:`, folderName);
                      if (newName) {
                        renameFolder(folderName, newName);
                      }
                    }}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: 'transparent',
                      color: darkMode ? '#aaa' : '#666',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      flexShrink: 0
                    }}
                    title="Rename folder"
                  >
                    ✎
                  </button>
                  {folderName !== 'General' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFolder(folderName, diagrams);
                      }}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: 'transparent',
                        color: '#f44336',
                        border: '1px solid #f44336',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        flexShrink: 0
                      }}
                      title="Delete folder and all diagrams in it"
                    >
                      ✕
                    </button>
                  )}
                </div>

                      {/* Folder Contents */}
                      {!collapsedFolders[`${customerName}-${folderName}`] && (
                        <div style={{
                          padding: '12px 12px 12px 40px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          backgroundColor: darkMode ? '#1a1a1a' : '#fafafa'
                        }}>
                    {diagrams.map(diagram => (
                      <div key={diagram.id} style={{
                        display: 'flex',
                        gap: '4px',
                        alignItems: 'center',
                        overflowX: 'visible',
                        overflowY: 'hidden',
                        padding: '0'
                      }}>
                        <button
                          onClick={() => setCurrentDiagramId(diagram.id)}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: currentDiagramId === diagram.id ? '#2196f3' : (darkMode ? '#444' : '#e0e0e0'),
                            color: currentDiagramId === diagram.id ? 'white' : (darkMode ? '#fff' : '#333'),
                            border: darkMode ? '1px solid #555' : 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: currentDiagramId === diagram.id ? 'bold' : 'normal',
                            fontSize: '13px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            minWidth: '200px',
                            maxWidth: '200px',
                            flexShrink: 0
                          }}
                        >
                          {diagram.name}
                        </button>
                        <button
                          onClick={() => {
                            const newName = prompt(`Rename "${diagram.name}" to:`, diagram.name);
                            if (newName) {
                              renameDiagram(diagram.id, newName);
                            }
                          }}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: '#03a9f4',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            flexShrink: 0
                          }}
                          title="Rename diagram"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => {
                            const newNumber = prompt(`Edit diagram number for "${diagram.name}":`, diagram.number || '');
                            if (newNumber !== null) {
                              editDiagramNumber(diagram.id, newNumber);
                            }
                          }}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: '#9c27b0',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            flexShrink: 0
                          }}
                          title="Edit diagram number"
                        >
                          #
                        </button>
                        <button
                          onClick={() => setEditingDiagram(diagram)}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: '#ff9800',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            flexShrink: 0
                          }}
                          title="Add/Edit PDF and Parts"
                        >
                          📝
                        </button>
                        <button
                          onClick={() => {
                            const folders = getFolders();
                            const otherFolders = folders.filter(f => f !== folderName);
                            if (otherFolders.length === 0) {
                              alert('No other folders available. Create a new folder first.');
                              return;
                            }
                            const targetFolder = prompt(
                              `Move "${diagram.name}" to folder:\n\nAvailable folders:\n${otherFolders.join('\n')}`,
                              otherFolders[0]
                            );
                            if (targetFolder && folders.includes(targetFolder)) {
                              moveDiagramToFolder(diagram.id, targetFolder);
                            }
                          }}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: '#9c27b0',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            flexShrink: 0
                          }}
                          title="Move to another folder"
                        >
                          📁
                        </button>
                        <button
                          onClick={() => copyDiagram(diagram.id)}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: '#00bcd4',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            flexShrink: 0
                          }}
                          title="Copy to another folder/customer"
                        >
                          📋
                        </button>
                        <button
                          onClick={() => copyDiagramDataTo(diagram.id, diagrams)}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: '#607d8b',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            flexShrink: 0
                          }}
                          title="Copy this diagram's data to another diagram in this folder"
                        >
                          ➜
                        </button>
                        <button
                          onClick={() => exportDiagram(diagram.id)}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: '#4caf50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            flexShrink: 0
                          }}
                          title="Export diagram"
                        >
                          ⬇
                        </button>
                        <button
                          onClick={() => handleSaveToFirebase(diagram.id)}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: '#ff5722',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            flexShrink: 0
                          }}
                          title="Save to Firebase"
                        >
                          ☁️
                        </button>
                        <button
                          onClick={() => deleteDiagram(diagram.id)}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            flexShrink: 0
                          }}
                          title="Delete diagram"
                        >
                          ✕
                        </button>
                          </div>
                        ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })
          ) : (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              color: darkMode ? '#888' : '#999'
            }}>
              No diagrams yet. Upload your first diagram!
            </div>
          )}
        </div>

        {/* Diagram Book Form */}
        {showDiagramBookForm && (
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            borderRadius: '8px',
            padding: '24px',
            marginBottom: '20px',
            boxShadow: darkMode ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.15)',
            border: darkMode ? '1px solid #444' : 'none'
          }}>
            <h2 style={{
              marginBottom: '16px',
              color: darkMode ? '#fff' : '#333'
            }}>Create Diagram Book Layout</h2>
            <p style={{
              marginBottom: '16px',
              color: darkMode ? '#aaa' : '#666',
              fontSize: '14px'
            }}>
              Paste your diagram list below. Each diagram needs 4 lines in this exact order:
            </p>
            <ol style={{
              marginBottom: '16px',
              color: darkMode ? '#aaa' : '#666',
              fontSize: '13px',
              lineHeight: '1.8'
            }}>
              <li>Section</li>
              <li>Unit Name</li>
              <li>Part Code</li>
              <li>Draw No.</li>
            </ol>
            <div style={{
              backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '12px',
              color: darkMode ? '#888' : '#666',
              fontFamily: 'monospace',
              border: darkMode ? '1px solid #333' : '1px solid #e0e0e0'
            }}>
              Example:<br/>
              CONVEYOR SECTION<br/>
              Belt Drive Unit<br/>
              BDU-2024-001<br/>
              4D-12345<br/>
              FEED SECTION<br/>
              Hopper Assembly<br/>
              HOP-2024-002<br/>
              4D-67890
            </div>
            <textarea
              value={diagramBookText}
              onChange={(e) => setDiagramBookText(e.target.value)}
              placeholder="Paste your diagram list here..."
              style={{
                width: '100%',
                minHeight: '300px',
                padding: '12px',
                border: darkMode ? '1px solid #555' : '1px solid #ccc',
                borderRadius: '6px',
                backgroundColor: darkMode ? '#333' : '#fff',
                color: darkMode ? '#fff' : '#000',
                fontFamily: 'monospace',
                fontSize: '13px',
                resize: 'vertical'
              }}
            />
            <div style={{
              display: 'flex',
              gap: '12px',
              marginTop: '16px'
            }}>
              <button
                onClick={() => {
                  setShowDiagramBookForm(false);
                  setDiagramBookText('');
                }}
                style={{
                  padding: '10px 24px',
                  backgroundColor: darkMode ? '#555' : '#999',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDiagramBook}
                style={{
                  padding: '10px 24px',
                  backgroundColor: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                Create Diagrams
              </button>
            </div>
          </div>
        )}

        {/* TOC Quick Rename Form */}
        {showTocRenamer && (
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            borderRadius: '8px',
            padding: '24px',
            marginBottom: '20px',
            boxShadow: darkMode ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.15)',
            border: darkMode ? '1px solid #444' : 'none'
          }}>
            <h2 style={{
              marginBottom: '16px',
              color: darkMode ? '#fff' : '#333'
            }}>📋 Batch Create/Rename from TOC</h2>
            <p style={{
              marginBottom: '16px',
              color: darkMode ? '#aaa' : '#666',
              fontSize: '14px'
            }}>
              Paste your table of contents, parse it, then assign each entry to a diagram.
            </p>
            <div style={{
              backgroundColor: darkMode ? '#1a3a4a' : '#e3f2fd',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '13px',
              color: darkMode ? '#aaa' : '#666',
              border: darkMode ? '1px solid #2c5f75' : '1px solid #90caf9'
            }}>
              <strong>How it works:</strong><br/>
              1. Select the customer and folder containing the diagrams you want to rename<br/>
              2. Paste the table of contents below<br/>
              3. Click "Parse TOC" to extract all entries<br/>
              4. Click "Auto-Map in Order" to automatically assign TOC entries to diagrams in order<br/>
              5. Review the mappings (you can manually change any dropdown if needed)<br/>
              6. Click "Apply Renames" when done<br/>
              <br/>
              <strong>Expected format (4 lines per entry):</strong><br/>
              Line 1: Page number (e.g., "10- 1")<br/>
              Line 2: Unit name (e.g., "MAIN BODY UNIT::HIGHSPEED")<br/>
              Line 3: Part code (ignored - e.g., "000-128-2893-16")<br/>
              Line 4: Draw number (e.g., "4D-38837")
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                color: darkMode ? '#fff' : '#333',
                fontWeight: 'bold'
              }}>
                Select Customer:
              </label>
              <select
                value={tocSelectedCustomer}
                onChange={(e) => {
                  setTocSelectedCustomer(e.target.value);
                  setTocSelectedFolder(''); // Clear folder when customer changes
                  setTocMappings({}); // Clear mappings when customer changes
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: darkMode ? '1px solid #555' : '1px solid #ccc',
                  borderRadius: '6px',
                  backgroundColor: darkMode ? '#333' : '#fff',
                  color: darkMode ? '#fff' : '#000',
                  fontSize: '14px',
                  marginBottom: '16px'
                }}
              >
                <option value="">-- Select a customer --</option>
                {getCustomers().map(customer => (
                  <option key={customer} value={customer}>
                    {customer}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                color: darkMode ? '#fff' : '#333',
                fontWeight: 'bold'
              }}>
                Select Folder:
              </label>
              <select
                value={tocSelectedFolder}
                onChange={(e) => {
                  setTocSelectedFolder(e.target.value);
                  setTocMappings({}); // Clear mappings when folder changes
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: darkMode ? '1px solid #555' : '1px solid #ccc',
                  borderRadius: '6px',
                  backgroundColor: darkMode ? '#333' : '#fff',
                  color: darkMode ? '#fff' : '#000',
                  fontSize: '14px',
                  marginBottom: '16px'
                }}
              >
                <option value="">-- Select a folder --</option>
                {(() => {
                  const folders = getFolders().filter(folder => {
                    // Only show folders that match the selected TOC customer
                    const diagramsInFolder = Object.values(savedDiagrams).filter(d =>
                      d.folder === folder &&
                      d.customer === tocSelectedCustomer
                    );
                    return diagramsInFolder.length > 0;
                  });
                  return folders.map(folder => (
                    <option key={folder} value={folder}>
                      {folder} ({Object.values(savedDiagrams).filter(d =>
                        d.folder === folder &&
                        d.customer === tocSelectedCustomer
                      ).length} diagrams)
                    </option>
                  ));
                })()}
              </select>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                color: darkMode ? '#fff' : '#333',
                fontWeight: 'bold'
              }}>
                Table of Contents (paste all entries):
              </label>
              <textarea
                value={tocText}
                onChange={(e) => setTocText(e.target.value)}
                placeholder="Paste table of contents here (4 lines per entry)&#10;Example:&#10;10- 1&#10;MAIN BODY UNIT::HIGHSPEED&#10;000-128-2893-16&#10;4D-38837&#10;10- 2&#10;PLATE UNIT:MAIN BODY:&#10;000-055-6933-09&#10;4D-10137"
                style={{
                  width: '100%',
                  minHeight: '150px',
                  padding: '12px',
                  border: darkMode ? '1px solid #555' : '1px solid #ccc',
                  borderRadius: '6px',
                  backgroundColor: darkMode ? '#333' : '#fff',
                  color: darkMode ? '#fff' : '#000',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  resize: 'vertical'
                }}
              />
            </div>
            <div style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '20px',
              flexWrap: 'wrap'
            }}>
              <button
                onClick={handleParseToc}
                style={{
                  padding: '10px 24px',
                  backgroundColor: '#2196f3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                📄 Parse TOC
              </button>
              {tocEntries.length > 0 && (
                <button
                  onClick={handleAutoMapToc}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: '#ff9800',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  🔗 Auto-Map in Order
                </button>
              )}
            </div>

            {/* Parsed Entries List */}
            {tocEntries.length > 0 && (
              <div style={{
                marginTop: '20px',
                padding: '16px',
                backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
                borderRadius: '6px',
                border: darkMode ? '1px solid #333' : '1px solid #e0e0e0'
              }}>
                <h3 style={{
                  marginTop: 0,
                  marginBottom: '16px',
                  color: darkMode ? '#fff' : '#333'
                }}>
                  Parsed Entries ({tocEntries.length})
                </h3>
                <div style={{
                  marginBottom: '16px',
                  fontSize: '12px',
                  color: darkMode ? '#888' : '#666'
                }}>
                  Assign each TOC entry to a diagram. Mapped: {Object.keys(tocMappings).length} / {tocEntries.length}
                </div>
                <div style={{
                  maxHeight: '400px',
                  overflowY: 'auto'
                }}>
                  {tocEntries.map((entry, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '12px',
                        marginBottom: '8px',
                        backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                        borderRadius: '6px',
                        border: tocMappings[idx]
                          ? (darkMode ? '2px solid #4caf50' : '2px solid #4caf50')
                          : (darkMode ? '1px solid #444' : '1px solid #ddd')
                      }}
                    >
                      <div style={{
                        fontWeight: 'bold',
                        marginBottom: '8px',
                        color: darkMode ? '#4fc3f7' : '#0277bd',
                        fontSize: '14px'
                      }}>
                        {entry.fullName}
                      </div>
                      <div style={{
                        fontSize: '12px',
                        color: darkMode ? '#888' : '#666',
                        marginBottom: '8px',
                        fontFamily: 'monospace'
                      }}>
                        Draw No: {entry.drawNo}
                      </div>
                      <select
                        value={tocMappings[idx] || ''}
                        onChange={(e) => {
                          const newMappings = { ...tocMappings };
                          if (e.target.value) {
                            newMappings[idx] = e.target.value;
                          } else {
                            delete newMappings[idx];
                          }
                          setTocMappings(newMappings);
                        }}
                        style={{
                          width: '100%',
                          padding: '8px',
                          border: darkMode ? '1px solid #555' : '1px solid #ccc',
                          borderRadius: '4px',
                          backgroundColor: darkMode ? '#333' : '#fff',
                          color: darkMode ? '#fff' : '#000',
                          fontSize: '13px'
                        }}
                      >
                        <option value="">-- Select diagram to rename --</option>
                        {Object.keys(savedDiagrams)
                          .filter(id => {
                            const diagram = savedDiagrams[id];
                            const customerMatch = selectedCustomer === 'All Customers' || diagram.customer === selectedCustomer;
                            const folderMatch = !tocSelectedFolder || diagram.folder === tocSelectedFolder;
                            return customerMatch && folderMatch;
                          })
                          .sort((a, b) => {
                            const diagA = savedDiagrams[a];
                            const diagB = savedDiagrams[b];
                            if (diagA.createdAt && diagB.createdAt) {
                              return new Date(diagA.createdAt) - new Date(diagB.createdAt);
                            }
                            return (diagA.name || '').localeCompare(diagB.name || '');
                          })
                          .map(diagramId => (
                            <option key={diagramId} value={diagramId}>
                              {savedDiagrams[diagramId].name} ({savedDiagrams[diagramId].folder || 'No folder'})
                            </option>
                          ))}
                      </select>
                    </div>
                  ))}
                </div>

                {/* Apply Renames Button */}
                <div style={{
                  marginTop: '20px',
                  display: 'flex',
                  gap: '12px'
                }}>
                  <button
                    onClick={handleApplyTocRenames}
                    disabled={Object.keys(tocMappings).length === 0}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: Object.keys(tocMappings).length > 0 ? '#4caf50' : '#666',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: Object.keys(tocMappings).length > 0 ? 'pointer' : 'not-allowed',
                      fontWeight: 'bold',
                      fontSize: '14px',
                      flex: 1
                    }}
                  >
                    ✓ Apply Renames ({Object.keys(tocMappings).length})
                  </button>
                  <button
                    onClick={() => setTocMappings({})}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: darkMode ? '#555' : '#999',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '14px'
                    }}
                  >
                    Clear Mappings
                  </button>
                </div>
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: '12px',
              marginTop: '16px'
            }}>
              <button
                onClick={() => {
                  setShowTocRenamer(false);
                  setTocText('');
                  setTocEntries([]);
                  setTocMappings({});
                  setTocSelectedFolder('');
                }}
                style={{
                  padding: '10px 24px',
                  backgroundColor: darkMode ? '#555' : '#999',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Bulk Image Upload Form */}
        {showBulkImageUpload && (
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            borderRadius: '8px',
            padding: '24px',
            marginBottom: '20px',
            boxShadow: darkMode ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.15)',
            border: darkMode ? '1px solid #444' : 'none'
          }}>
            <h2 style={{
              marginBottom: '16px',
              color: darkMode ? '#fff' : '#333'
            }}>🖼️ Bulk Import</h2>

            {/* Mode Selector */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                color: darkMode ? '#fff' : '#333',
                fontWeight: 'bold'
              }}>
                Import Mode:
              </label>
              <div style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '16px'
              }}>
                <button
                  onClick={() => {
                    setBulkUploadZipMode(false);
                    setBulkUploadTocText('');
                  }}
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: !bulkUploadZipMode ? '#2196f3' : (darkMode ? '#333' : '#e0e0e0'),
                    color: !bulkUploadZipMode ? 'white' : (darkMode ? '#aaa' : '#666'),
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    transition: 'all 0.2s'
                  }}
                >
                  📄 Individual Images
                </button>
                <button
                  onClick={() => {
                    setBulkUploadZipMode(true);
                    setBulkImageFiles([]);
                  }}
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: bulkUploadZipMode ? '#2196f3' : (darkMode ? '#333' : '#e0e0e0'),
                    color: bulkUploadZipMode ? 'white' : (darkMode ? '#aaa' : '#666'),
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    transition: 'all 0.2s'
                  }}
                >
                  📦 ZIP with Parts Lists
                </button>
              </div>
            </div>

            {/* Description based on mode */}
            <p style={{
              marginBottom: '16px',
              color: darkMode ? '#aaa' : '#666',
              fontSize: '14px'
            }}>
              {bulkUploadZipMode
                ? 'Upload a ZIP file containing diagram images and parts list PDFs. The system will automatically match and import parts data.'
                : 'Select multiple diagram images and automatically match them to diagrams by name.'
              }
            </p>

            {/* Instructions based on mode */}
            <div style={{
              backgroundColor: darkMode ? '#1a3a4a' : '#e3f2fd',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '13px',
              color: darkMode ? '#aaa' : '#666',
              border: darkMode ? '1px solid #2c5f75' : '1px solid #90caf9'
            }}>
              {bulkUploadZipMode ? (
                <>
                  <strong>How it works:</strong><br/>
                  1. Select the customer and folder where diagrams will be created<br/>
                  2. Upload a ZIP file with this structure:<br/>
                  &nbsp;&nbsp;&nbsp;• Exploded-Views/ (diagram images)<br/>
                  &nbsp;&nbsp;&nbsp;• Parts-Lists/ (parts list PDFs)<br/>
                  3. System automatically matches images with parts lists by filename<br/>
                  4. All diagrams created with images and parts data imported<br/>
                  <br/>
                  <strong>Example:</strong> "10-1-MAIN-BODY.jpg" matches "10-1-MAIN-BODY-parts.pdf"
                </>
              ) : (
                <>
                  <strong>How it works:</strong><br/>
                  1. Select the folder containing the diagrams you want to add images to<br/>
                  2. Click "Choose Files" and select all your diagram images (from Exploded-Views folder)<br/>
                  3. The system will automatically match each image to a diagram by name<br/>
                  4. Review the matches and adjust if needed<br/>
                  5. Click "Upload All" to apply all images at once<br/>
                  <br/>
                  <strong>Note:</strong> Image filenames should match diagram names as closely as possible.
                </>
              )}
            </div>

            {/* Customer Selector (for ZIP mode) */}
            {bulkUploadZipMode && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: darkMode ? '#fff' : '#333',
                  fontWeight: 'bold'
                }}>
                  Select or Create Customer:
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: darkMode ? '#aaa' : '#666',
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="checkbox"
                      checked={bulkUploadCustomer.startsWith('__NEW__')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setBulkUploadCustomer('__NEW__');
                        } else {
                          setBulkUploadCustomer('');
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    Create New Customer
                  </label>
                </div>
                {bulkUploadCustomer.startsWith('__NEW__') ? (
                  <input
                    type="text"
                    value={bulkUploadCustomer.replace('__NEW__', '')}
                    onChange={(e) => setBulkUploadCustomer('__NEW__' + e.target.value)}
                    placeholder="Enter new customer name"
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '6px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000',
                      fontSize: '14px'
                    }}
                  />
                ) : (
                  <select
                    value={bulkUploadCustomer}
                    onChange={(e) => setBulkUploadCustomer(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '6px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000',
                      fontSize: '14px'
                    }}
                  >
                    <option value="">-- Select a customer --</option>
                    {getCustomers().map(customer => (
                      <option key={customer} value={customer}>
                        {customer}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Folder Selector */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                color: darkMode ? '#fff' : '#333',
                fontWeight: 'bold'
              }}>
                {bulkUploadZipMode ? 'Select or Create Folder:' : 'Select Folder:'}
              </label>
              {bulkUploadZipMode ? (
                <input
                  type="text"
                  value={bulkUploadFolder}
                  onChange={(e) => setBulkUploadFolder(e.target.value)}
                  placeholder="Enter folder name (or select existing)"
                  list="existing-folders"
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: darkMode ? '1px solid #555' : '1px solid #ccc',
                    borderRadius: '6px',
                    backgroundColor: darkMode ? '#333' : '#fff',
                    color: darkMode ? '#fff' : '#000',
                    fontSize: '14px'
                  }}
                />
              ) : (
                <select
                  value={bulkUploadFolder}
                  onChange={(e) => {
                    setBulkUploadFolder(e.target.value);
                    setBulkImageFiles([]);
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: darkMode ? '1px solid #555' : '1px solid #ccc',
                    borderRadius: '6px',
                    backgroundColor: darkMode ? '#333' : '#fff',
                    color: darkMode ? '#fff' : '#000',
                    fontSize: '14px'
                  }}
                >
                  <option value="">-- Select a folder --</option>
                  {(() => {
                    const folders = getFolders().filter(folder => {
                      const diagramsInFolder = Object.values(savedDiagrams).filter(d =>
                        d.folder === folder &&
                        (selectedCustomer === 'All Customers' || d.customer === selectedCustomer)
                      );
                      return diagramsInFolder.length > 0;
                    });
                    return folders.map(folder => (
                      <option key={folder} value={folder}>
                        {folder} ({Object.values(savedDiagrams).filter(d =>
                          d.folder === folder &&
                          (selectedCustomer === 'All Customers' || d.customer === selectedCustomer)
                        ).length} diagrams)
                      </option>
                    ));
                  })()}
                </select>
              )}
              {bulkUploadZipMode && (
                <datalist id="existing-folders">
                  {getFolders().map(folder => (
                    <option key={folder} value={folder} />
                  ))}
                </datalist>
              )}
            </div>

            {/* TOC Text Area - ZIP mode */}
            {bulkUploadZipMode && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: darkMode ? '#fff' : '#333',
                  fontWeight: 'bold'
                }}>
                  Table of Contents (Optional):
                </label>
                <div style={{
                  backgroundColor: darkMode ? '#1a3a4a' : '#e3f2fd',
                  padding: '8px',
                  borderRadius: '4px',
                  marginBottom: '8px',
                  fontSize: '12px',
                  color: darkMode ? '#aaa' : '#666',
                  border: darkMode ? '1px solid #2c5f75' : '1px solid #90caf9'
                }}>
                  Paste your table of contents (4 lines per entry) to automatically name diagrams. If not provided, filenames will be used.
                </div>
                <textarea
                  value={bulkUploadTocText}
                  onChange={(e) => setBulkUploadTocText(e.target.value)}
                  placeholder="10- 1&#10;MAIN BODY UNIT::HIGHSPEED&#10;000-128-2893-16&#10;4D-38837&#10;10- 2&#10;PLATE UNIT:MAIN BODY:&#10;000-055-6933-09&#10;4D-10137"
                  rows={8}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: darkMode ? '1px solid #555' : '1px solid #ccc',
                    borderRadius: '6px',
                    backgroundColor: darkMode ? '#333' : '#fff',
                    color: darkMode ? '#fff' : '#000',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>
            )}

            {/* File Input - ZIP mode */}
            {bulkUploadZipMode && bulkUploadCustomer && bulkUploadFolder && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: darkMode ? '#fff' : '#333',
                  fontWeight: 'bold'
                }}>
                  Select ZIP File:
                </label>
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleBulkZipUpload}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: darkMode ? '1px solid #555' : '1px solid #ccc',
                    borderRadius: '6px',
                    backgroundColor: darkMode ? '#333' : '#fff',
                    color: darkMode ? '#fff' : '#000',
                    fontSize: '14px'
                  }}
                />
              </div>
            )}

            {/* File Input - Individual Images mode */}
            {!bulkUploadZipMode && bulkUploadFolder && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: darkMode ? '#fff' : '#333',
                  fontWeight: 'bold'
                }}>
                  Select Image Files:
                </label>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/jpg,image/png"
                  onChange={handleBulkImageSelect}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: darkMode ? '1px solid #555' : '1px solid #ccc',
                    borderRadius: '6px',
                    backgroundColor: darkMode ? '#333' : '#fff',
                    color: darkMode ? '#fff' : '#000',
                    fontSize: '14px'
                  }}
                />
              </div>
            )}

            {/* Show matched files */}
            {bulkImageFiles.length > 0 && (
              <div style={{
                marginTop: '20px',
                padding: '16px',
                backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
                borderRadius: '6px',
                border: darkMode ? '1px solid #333' : '1px solid #e0e0e0'
              }}>
                <h3 style={{
                  marginTop: 0,
                  marginBottom: '16px',
                  color: darkMode ? '#fff' : '#333'
                }}>
                  Matched Files ({bulkImageFiles.filter(m => m.matchedDiagramId).length} / {bulkImageFiles.length})
                </h3>
                <div style={{
                  maxHeight: '400px',
                  overflowY: 'auto'
                }}>
                  {bulkImageFiles.map((match, idx) => {
                    // Get diagrams in selected folder
                    const diagramsInFolder = Object.values(savedDiagrams).filter(d =>
                      d.folder === bulkUploadFolder &&
                      (bulkUploadCustomer ? d.customer === bulkUploadCustomer : true)
                    ).sort((a, b) => a.name.localeCompare(b.name));

                    const showDropdown = !match.matchedDiagramId || match.confidence < 70;

                    return (
                      <div
                        key={idx}
                        style={{
                          padding: '12px',
                          marginBottom: '8px',
                          backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                          borderRadius: '6px',
                          border: match.matchedDiagramId
                            ? (darkMode ? '2px solid #4caf50' : '2px solid #4caf50')
                            : (darkMode ? '2px solid #f44336' : '2px solid #f44336')
                        }}
                      >
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '8px'
                        }}>
                          <div style={{
                            fontWeight: 'bold',
                            color: darkMode ? '#4fc3f7' : '#0277bd',
                            fontSize: '13px',
                            flex: 1,
                            wordBreak: 'break-all'
                          }}>
                            {match.file.name}
                          </div>
                          {match.confidence >= 70 && (
                            <div style={{
                              fontSize: '11px',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              backgroundColor: darkMode ? '#1b5e20' : '#c8e6c9',
                              color: darkMode ? '#81c784' : '#2e7d32',
                              fontWeight: 'bold',
                              marginLeft: '8px'
                            }}>
                              {match.confidence}% match
                            </div>
                          )}
                        </div>

                        {showDropdown ? (
                          <div style={{ marginBottom: '8px' }}>
                            <label style={{
                              display: 'block',
                              fontSize: '12px',
                              color: darkMode ? '#aaa' : '#666',
                              marginBottom: '4px'
                            }}>
                              {match.matchedDiagramId ? 'Low confidence - verify match:' : 'No match found - select diagram:'}
                            </label>
                            <select
                              value={match.matchedDiagramId || ''}
                              onChange={(e) => {
                                const newMatches = [...bulkImageFiles];
                                const selectedDiagram = savedDiagrams[e.target.value];
                                newMatches[idx] = {
                                  ...match,
                                  matchedDiagramId: e.target.value || null,
                                  matchedDiagramName: selectedDiagram ? selectedDiagram.name : null,
                                  confidence: e.target.value ? 100 : 0
                                };
                                setBulkImageFiles(newMatches);
                              }}
                              style={{
                                width: '100%',
                                padding: '8px',
                                border: darkMode ? '1px solid #555' : '1px solid #ccc',
                                borderRadius: '4px',
                                backgroundColor: darkMode ? '#333' : '#fff',
                                color: darkMode ? '#fff' : '#000',
                                fontSize: '12px'
                              }}
                            >
                              <option value="">-- Select diagram --</option>
                              {diagramsInFolder.map(diagram => (
                                <option key={diagram.id} value={diagram.id}>
                                  {diagram.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div style={{
                            marginBottom: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <div style={{
                              fontSize: '12px',
                              color: darkMode ? '#81c784' : '#2e7d32'
                            }}>
                              ✓ Auto-matched to: <strong>{match.matchedDiagramName}</strong>
                            </div>
                            <button
                              onClick={() => {
                                const newMatches = [...bulkImageFiles];
                                newMatches[idx] = {
                                  ...match,
                                  confidence: 0 // Force dropdown to show
                                };
                                setBulkImageFiles(newMatches);
                              }}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                backgroundColor: darkMode ? '#555' : '#e0e0e0',
                                color: darkMode ? '#fff' : '#333',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              Change
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{
                  display: 'flex',
                  gap: '12px',
                  marginTop: '16px'
                }}>
                  <button
                    onClick={handleApplyBulkUpload}
                    disabled={bulkImageFiles.filter(m => m.matchedDiagramId).length === 0}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: bulkImageFiles.filter(m => m.matchedDiagramId).length > 0 ? '#4caf50' : '#666',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: bulkImageFiles.filter(m => m.matchedDiagramId).length > 0 ? 'pointer' : 'not-allowed',
                      fontWeight: 'bold',
                      fontSize: '14px',
                      flex: 1
                    }}
                  >
                    ✓ Upload All ({bulkImageFiles.filter(m => m.matchedDiagramId).length})
                  </button>
                  <button
                    onClick={() => setBulkImageFiles([])}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: darkMode ? '#555' : '#999',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '14px'
                    }}
                  >
                    Clear Files
                  </button>
                </div>
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: '12px',
              marginTop: '16px'
            }}>
              <button
                onClick={() => {
                  setShowBulkImageUpload(false);
                  setBulkImageFiles([]);
                  setBulkUploadFolder('');
                  setBulkUploadCustomer('');
                  setBulkUploadZipMode(false);
                  setBulkUploadTocText('');
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: darkMode ? '#555' : '#999',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Edit Diagram Form */}
        {editingDiagram && (
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            borderRadius: '8px',
            padding: '24px',
            marginBottom: '20px',
            boxShadow: darkMode ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.15)',
            border: darkMode ? '1px solid #444' : 'none'
          }}>
            <h2 style={{
              marginBottom: '16px',
              color: darkMode ? '#fff' : '#333'
            }}>Edit Diagram: {editingDiagram.name}</h2>
            <p style={{
              marginBottom: '16px',
              color: darkMode ? '#aaa' : '#666',
              fontSize: '14px'
            }}>
              Upload new files to add or replace the PDF diagram and parts list.
            </p>
            <form onSubmit={handleEditDiagram}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  color: darkMode ? '#ccc' : '#555'
                }}>
                  Diagram Image/PDF: {editingDiagram.pdfData ? '(Current: Yes)' : '(Current: None)'}
                  <input
                    type="file"
                    name="pdfFile"
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '4px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '4px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000'
                    }}
                  />
                </label>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  color: darkMode ? '#ccc' : '#555'
                }}>
                  Parts List (CSV): {Object.keys(editingDiagram.partsData || {}).length > 0 ? `(Current: ${Object.keys(editingDiagram.partsData).length} parts)` : '(Current: None)'}
                  <input
                    type="file"
                    name="partsFile"
                    accept=".csv"
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '4px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '4px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000'
                    }}
                  />
                </label>
              </div>

              <div style={{
                display: 'flex',
                gap: '12px',
                marginTop: '20px'
              }}>
                <button
                  type="button"
                  onClick={() => setEditingDiagram(null)}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: darkMode ? '#555' : '#999',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '10px 24px',
                    backgroundColor: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  Update Diagram
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Diagram Selector Modal */}
        {showDiagramSelector && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}>
            <div style={{
              backgroundColor: darkMode ? '#2a2a2a' : '#fff',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '800px',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              border: darkMode ? '1px solid #444' : 'none'
            }}>
              <h2 style={{
                marginBottom: '16px',
                color: darkMode ? '#fff' : '#333'
              }}>Select Diagram for Parts Import</h2>
              <p style={{
                marginBottom: '20px',
                color: darkMode ? '#aaa' : '#666',
                fontSize: '14px'
              }}>
                Choose a diagram to add the {pendingCsvData ? Object.keys(pendingCsvData).length : 0} parts to, or create a new diagram.
              </p>

              {/* Folders */}
              {Object.entries(getDiagramsByFolder('All Customers')).map(([folderName, diagrams]) => (
                <div key={folderName} style={{
                  marginBottom: '16px',
                  border: darkMode ? '1px solid #444' : '1px solid #e0e0e0',
                  borderRadius: '6px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    backgroundColor: darkMode ? '#333' : '#f5f5f5',
                    padding: '12px',
                    fontWeight: 'bold',
                    color: darkMode ? '#fff' : '#666'
                  }}>
                    {folderName} ({diagrams.length})
                  </div>
                  <div style={{
                    maxHeight: '200px',
                    overflow: 'auto'
                  }}>
                    {diagrams.map(diagram => (
                      <button
                        key={diagram.id}
                        onClick={() => handleSelectDiagramForImport(diagram.id)}
                        style={{
                          width: '100%',
                          padding: '12px',
                          textAlign: 'left',
                          backgroundColor: 'transparent',
                          border: 'none',
                          borderBottom: darkMode ? '1px solid #333' : '1px solid #e0e0e0',
                          color: darkMode ? '#fff' : '#333',
                          cursor: 'pointer',
                          fontSize: '14px',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = darkMode ? '#404040' : '#f0f0f0'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                      >
                        <div style={{ fontWeight: 'bold' }}>{diagram.name}</div>
                        {diagram.number && (
                          <div style={{ fontSize: '12px', color: darkMode ? '#aaa' : '#666', marginTop: '4px' }}>
                            #{diagram.number} • {Object.keys(diagram.partsData || {}).length} existing parts
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div style={{
                display: 'flex',
                gap: '12px',
                marginTop: '20px',
                paddingTop: '20px',
                borderTop: darkMode ? '1px solid #444' : '1px solid #e0e0e0'
              }}>
                <button
                  onClick={() => {
                    setShowDiagramSelector(false);
                    setPendingCsvData(null);
                  }}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: darkMode ? '#555' : '#999',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateNewDiagramWithImport}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  + Create New Diagram
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload Form */}
        {showUploadForm && (
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            borderRadius: '8px',
            padding: '24px',
            marginBottom: '20px',
            boxShadow: darkMode ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.15)',
            border: darkMode ? '1px solid #444' : 'none'
          }}>
            <h2 style={{
              marginBottom: '16px',
              color: darkMode ? '#fff' : '#333'
            }}>Upload New Diagram</h2>
            <form onSubmit={handleFileUpload}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  color: darkMode ? '#ccc' : '#555'
                }}>
                  Diagram Name:
                  <input
                    type="text"
                    name="diagramName"
                    required
                    placeholder="e.g., Drive Weigh Unit 4D-33519"
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '4px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '4px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000'
                    }}
                  />
                </label>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  color: darkMode ? '#ccc' : '#555'
                }}>
                  Diagram Number (optional):
                  <input
                    type="text"
                    name="diagramNumber"
                    placeholder="e.g., 4D-33519"
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '4px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '4px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000'
                    }}
                  />
                </label>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  color: darkMode ? '#ccc' : '#555'
                }}>
                  Folder:
                  <select
                    name="folderSelect"
                    required
                    defaultValue="General"
                    onChange={(e) => {
                      const newFolderInput = e.target.form.querySelector('input[name="newFolderName"]');
                      if (newFolderInput) {
                        newFolderInput.style.display = e.target.value === '__new__' ? 'block' : 'none';
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '4px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '4px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000'
                    }}
                  >
                    {getFolders().map(folder => (
                      <option key={folder} value={folder}>{folder}</option>
                    ))}
                    <option value="__new__">+ Create New Folder</option>
                  </select>
                  <input
                    type="text"
                    name="newFolderName"
                    placeholder="Enter new folder name"
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '8px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '4px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000',
                      display: 'none'
                    }}
                  />
                </label>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  color: darkMode ? '#ccc' : '#555'
                }}>
                  Customer:
                  <select
                    name="customerSelect"
                    required
                    defaultValue="General"
                    onChange={(e) => {
                      const newCustomerInput = e.target.form.querySelector('input[name="newCustomerName"]');
                      if (newCustomerInput) {
                        newCustomerInput.style.display = e.target.value === '__new__' ? 'block' : 'none';
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '4px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '4px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000'
                    }}
                  >
                    {getCustomers().map(customer => (
                      <option key={customer} value={customer}>{customer}</option>
                    ))}
                    <option value="__new__">+ Create New Customer</option>
                  </select>
                  <input
                    type="text"
                    name="newCustomerName"
                    placeholder="Enter new customer name"
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '8px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '4px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000',
                      display: 'none'
                    }}
                  />
                </label>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  color: darkMode ? '#ccc' : '#555'
                }}>
                  Diagram Image/PDF File (optional - can add later):
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 'normal',
                    color: darkMode ? '#888' : '#666',
                    marginBottom: '4px'
                  }}>
                    Upload a PDF or image file (JPG, PNG) of the diagram/schematic
                  </div>
                  <input
                    type="file"
                    name="pdfFile"
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginTop: '4px',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '4px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000'
                    }}
                  />
                </label>
              </div>

              <div style={{ marginBottom: '16px' }}>
                {importedCsvData ? (
                  <div style={{
                    padding: '16px',
                    backgroundColor: '#e8f5e9',
                    border: '2px solid #4caf50',
                    borderRadius: '6px'
                  }}>
                    <strong style={{ color: '#2e7d32', fontSize: '14px' }}>✓ Parts List Imported from CSV Converter</strong>
                    <p style={{ margin: '8px 0 0 0', color: '#555', fontSize: '13px' }}>
                      {Object.keys(importedCsvData).length} parts ready to use
                    </p>
                    <button
                      type="button"
                      onClick={() => setImportedCsvData(null)}
                      style={{
                        marginTop: '8px',
                        padding: '6px 12px',
                        backgroundColor: '#f44336',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Clear & Upload Different File
                    </button>
                  </div>
                ) : (
                  <>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      fontWeight: 'bold',
                      color: darkMode ? '#ccc' : '#555'
                    }}>
                      Parts List File (optional - can add later):
                      <div style={{
                        fontSize: '12px',
                        fontWeight: 'normal',
                        color: darkMode ? '#888' : '#666',
                        marginBottom: '4px'
                      }}>
                        Upload CSV, TXT, or PDF file containing the parts data (Part #, Code, Name, Qty)
                      </div>
                      <input
                        type="file"
                        name="partsFile"
                        accept=".csv,.txt,.pdf"
                        style={{
                          width: '100%',
                          padding: '8px',
                          marginTop: '4px',
                          border: darkMode ? '1px solid #555' : '1px solid #ccc',
                          borderRadius: '4px',
                          backgroundColor: darkMode ? '#333' : '#fff',
                          color: darkMode ? '#fff' : '#000'
                        }}
                      />
                    </label>
                    <small style={{
                      color: darkMode ? '#999' : '#666',
                      fontSize: '12px',
                      display: 'block',
                      marginBottom: '4px'
                    }}>
                      Accepts CSV, TXT, or PDF files with parts list data
                    </small>
                    <small style={{
                      color: darkMode ? '#888' : '#888',
                      fontSize: '11px',
                      display: 'block'
                    }}>
                      Format: PartNo, PartCode, PartName, Qty, PMST (with header row)
                    </small>
                    <small style={{
                      color: darkMode ? '#888' : '#888',
                      fontSize: '11px',
                      display: 'block',
                      marginTop: '4px'
                    }}>
                      For DOC/DOCX: Save as PDF first
                    </small>
                  </>
                )}
              </div>

              <button
                type="submit"
                style={{
                  padding: '10px 24px',
                  backgroundColor: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                Upload Diagram
              </button>
            </form>
          </div>
        )}

        {/* OCR Progress Indicator */}
        {ocrProgress && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}>
            <div style={{
              backgroundColor: '#fff',
              padding: '30px',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '18px', marginBottom: '16px', color: '#333' }}>
                Running OCR...
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>
                {ocrProgress}
              </div>
              <div style={{ marginTop: '16px', color: '#999', fontSize: '12px' }}>
                This may take a minute...
              </div>
            </div>
          </div>
        )}

        {/* Parts Review Screen */}
        {showPartsReview && reviewData && (
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '8px',
            padding: '24px',
            marginBottom: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}>
            <h2 style={{ marginBottom: '16px', color: '#333' }}>
              Review Extracted Parts - {reviewData.diagramName}
            </h2>
            <p style={{ marginBottom: '20px', color: '#666' }}>
              {Object.keys(reviewData.partsData).length} parts found. Please review and edit as needed before creating the diagram.
            </p>

            <div style={{
              backgroundColor: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '6px',
              padding: '16px',
              marginBottom: '20px',
              fontSize: '13px'
            }}>
              <strong style={{ color: '#856404' }}>💡 Missing parts from OCR?</strong>
              <p style={{ margin: '8px 0 0 0', color: '#856404', lineHeight: '1.6' }}>
                OCR might miss some parts. For best results:
                <br/>
                1. Click "Download CSV" below to get what was extracted
                <br/>
                2. Or share the PDF path in chat (e.g., <code style={{ backgroundColor: '#fff', padding: '2px 6px', borderRadius: '3px' }}>/Users/you/Downloads/parts.pdf</code>) and Claude will create a complete CSV for you
              </p>
            </div>

            <div style={{ maxHeight: '500px', overflow: 'auto', marginBottom: '20px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: '#2196f3', color: 'white', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Part #</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Part Code</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Part Name</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Qty</th>
                    <th style={{ padding: '10px', textAlign: 'center', border: '1px solid #ddd' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(reviewData.partsData).map((partNo) => {
                    const part = reviewData.partsData[partNo];
                    return (
                      <tr key={partNo} style={{ backgroundColor: partNo % 2 === 0 ? '#f9f9f9' : 'white' }}>
                        <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                          <input
                            type="text"
                            value={partNo}
                            disabled
                            style={{ width: '50px', padding: '4px', border: '1px solid #ccc', borderRadius: '3px', backgroundColor: '#f5f5f5' }}
                          />
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                          <input
                            type="text"
                            value={part.partCode}
                            onChange={(e) => {
                              const newPartsData = { ...reviewData.partsData };
                              newPartsData[partNo].partCode = e.target.value;
                              setReviewData({ ...reviewData, partsData: newPartsData });
                            }}
                            style={{ width: '100%', padding: '4px', border: '1px solid #ccc', borderRadius: '3px' }}
                          />
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                          <input
                            type="text"
                            value={part.partName}
                            onChange={(e) => {
                              const newPartsData = { ...reviewData.partsData };
                              newPartsData[partNo].partName = e.target.value;
                              setReviewData({ ...reviewData, partsData: newPartsData });
                            }}
                            style={{ width: '100%', padding: '4px', border: '1px solid #ccc', borderRadius: '3px' }}
                          />
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                          <input
                            type="text"
                            value={part.qty}
                            onChange={(e) => {
                              const newPartsData = { ...reviewData.partsData };
                              newPartsData[partNo].qty = e.target.value;
                              setReviewData({ ...reviewData, partsData: newPartsData });
                            }}
                            style={{ width: '60px', padding: '4px', border: '1px solid #ccc', borderRadius: '3px' }}
                          />
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>
                          <button
                            onClick={() => {
                              const newPartsData = { ...reviewData.partsData };
                              delete newPartsData[partNo];
                              setReviewData({ ...reviewData, partsData: newPartsData });
                            }}
                            style={{
                              padding: '4px 8px',
                              backgroundColor: '#f44336',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '11px'
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between' }}>
              <button
                onClick={() => {
                  // Generate CSV content
                  let csvContent = 'NO,PART CODE,PART NAME,QUANTITY\n';
                  Object.keys(reviewData.partsData).forEach(partNo => {
                    const part = reviewData.partsData[partNo];
                    csvContent += `${partNo},${part.partCode},${part.partName},${part.qty}\n`;
                  });

                  // Create download link
                  const blob = new Blob([csvContent], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `${reviewData.diagramName.replace(/[^a-z0-9]/gi, '_')}_parts.csv`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
                style={{
                  padding: '10px 24px',
                  backgroundColor: '#2196f3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                Download CSV
              </button>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => {
                    setShowPartsReview(false);
                    setReviewData(null);
                    setShowUploadForm(true);
                  }}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: '#999',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmPartsData}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  Create Diagram ({Object.keys(reviewData.partsData).length} parts)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Parts List PDF Review Modal */}
        {showPartsListReview && partsListData && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px'
          }}>
            <div style={{
              backgroundColor: darkMode ? '#2a2a2a' : '#fff',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '1000px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              color: darkMode ? '#fff' : '#333'
            }}>
              <h2 style={{ marginBottom: '16px', color: darkMode ? '#fff' : '#333' }}>
                Review Parts List Import
              </h2>

              {partsListData.unitName && (
                <div style={{ marginBottom: '16px' }}>
                  <strong>Unit Name:</strong> {partsListData.unitName}
                </div>
              )}

              {partsListData.drawNo && (
                <div style={{ marginBottom: '16px' }}>
                  <strong>Drawing #:</strong> {partsListData.drawNo}
                </div>
              )}

              <p style={{ marginBottom: '20px', color: darkMode ? '#aaa' : '#666' }}>
                {Object.keys(partsListData.partsData).length} parts extracted. Review and edit as needed.
              </p>

              <div style={{ maxHeight: '500px', overflow: 'auto', marginBottom: '20px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: '#4caf50', color: 'white', zIndex: 1 }}>
                    <tr>
                      <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Part #</th>
                      <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Part Code</th>
                      <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Part Name</th>
                      <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Qty</th>
                      <th style={{ padding: '10px', textAlign: 'center', border: '1px solid #ddd' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(partsListData.partsData).map((partNo, index) => {
                      const part = partsListData.partsData[partNo];
                      return (
                        <tr key={partNo} style={{ backgroundColor: index % 2 === 0 ? (darkMode ? '#333' : '#f9f9f9') : (darkMode ? '#3a3a3a' : 'white') }}>
                          <td style={{ padding: '8px', border: '1px solid #ddd', color: darkMode ? '#fff' : '#000' }}>
                            <strong>{partNo}</strong>
                          </td>
                          <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                            <input
                              type="text"
                              value={part.partCode}
                              onChange={(e) => {
                                const newPartsData = { ...partsListData.partsData };
                                newPartsData[partNo].partCode = e.target.value;
                                setPartsListData({ ...partsListData, partsData: newPartsData });
                              }}
                              style={{
                                width: '100%',
                                padding: '4px',
                                border: '1px solid #ccc',
                                borderRadius: '3px',
                                backgroundColor: darkMode ? '#444' : '#fff',
                                color: darkMode ? '#fff' : '#000'
                              }}
                            />
                          </td>
                          <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                            <input
                              type="text"
                              value={part.partName}
                              onChange={(e) => {
                                const newPartsData = { ...partsListData.partsData };
                                newPartsData[partNo].partName = e.target.value;
                                setPartsListData({ ...partsListData, partsData: newPartsData });
                              }}
                              style={{
                                width: '100%',
                                padding: '4px',
                                border: '1px solid #ccc',
                                borderRadius: '3px',
                                backgroundColor: darkMode ? '#444' : '#fff',
                                color: darkMode ? '#fff' : '#000'
                              }}
                            />
                          </td>
                          <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                            <input
                              type="text"
                              value={part.qty}
                              onChange={(e) => {
                                const newPartsData = { ...partsListData.partsData };
                                newPartsData[partNo].qty = e.target.value;
                                setPartsListData({ ...partsListData, partsData: newPartsData });
                              }}
                              style={{
                                width: '60px',
                                padding: '4px',
                                border: '1px solid #ccc',
                                borderRadius: '3px',
                                backgroundColor: darkMode ? '#444' : '#fff',
                                color: darkMode ? '#fff' : '#000'
                              }}
                            />
                          </td>
                          <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>
                            <button
                              onClick={() => {
                                const newPartsData = { ...partsListData.partsData };
                                delete newPartsData[partNo];
                                setPartsListData({ ...partsListData, partsData: newPartsData });
                              }}
                              style={{
                                padding: '4px 8px',
                                backgroundColor: '#f44336',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '11px'
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setShowPartsListReview(false);
                    setPartsListData(null);
                  }}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: '#999',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPartsListImport}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  Import to Current Diagram ({Object.keys(partsListData.partsData).length} parts)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Parts Extraction Debug Modal */}
        {showPartsDebugModal && partsDebugData && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '20px',
            overflowY: 'auto'
          }}>
            <div style={{
              backgroundColor: darkMode ? '#2a2a2a' : '#fff',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '1200px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              color: darkMode ? '#fff' : '#000'
            }}>
              <h2 style={{ marginBottom: '16px' }}>🔍 Parts Extraction Debug</h2>

              <p style={{ marginBottom: '20px', color: darkMode ? '#aaa' : '#666' }}>
                This shows how parts were extracted from each parts list PDF.
                For multi-page PDFs, review each page to verify continuation pages are parsed correctly.
              </p>

              {partsDebugData.map((diagram, diagIdx) => (
                <div key={diagIdx} style={{
                  marginBottom: '32px',
                  padding: '16px',
                  backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
                  borderRadius: '8px',
                  border: darkMode ? '1px solid #444' : '1px solid #ddd'
                }}>
                  <h3 style={{ marginTop: 0, marginBottom: '12px', color: darkMode ? '#4fc3f7' : '#0277bd' }}>
                    {diagram.diagramName}
                  </h3>
                  <div style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666', marginBottom: '16px' }}>
                    Image: {diagram.imageFileName} | Total Parts: {diagram.totalParts}
                  </div>

                  {diagram.pageDetails.map((page, pageIdx) => (
                    <div key={pageIdx} style={{
                      marginBottom: '16px',
                      padding: '12px',
                      backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                      borderRadius: '6px',
                      border: page.success
                        ? (darkMode ? '2px solid #4caf50' : '2px solid #4caf50')
                        : (darkMode ? '2px solid #f44336' : '2px solid #f44336')
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '8px'
                      }}>
                        <strong style={{ fontSize: '14px' }}>
                          Page {page.pageNumber}: {page.fileName}
                          {page.isContinuation && ' (Continuation Page)'}
                        </strong>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          backgroundColor: page.success ? '#4caf50' : '#f44336',
                          color: 'white',
                          fontWeight: 'bold'
                        }}>
                          {page.success ? `✓ ${page.partsCount} parts` : '✗ Failed'}
                        </span>
                      </div>

                      {page.error && (
                        <div style={{
                          padding: '8px',
                          backgroundColor: darkMode ? '#3a1a1a' : '#ffebee',
                          color: darkMode ? '#ff5252' : '#c62828',
                          borderRadius: '4px',
                          fontSize: '12px',
                          marginBottom: '8px'
                        }}>
                          Error: {page.error}
                        </div>
                      )}

                      {page.partNumbers.length > 0 && (
                        <div style={{
                          fontSize: '12px',
                          color: darkMode ? '#aaa' : '#666',
                          fontFamily: 'monospace',
                          marginTop: '8px'
                        }}>
                          <strong>Part Numbers:</strong> {page.partNumbers.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}

              <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowPartsDebugModal(false)}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: darkMode ? '#555' : '#999',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Firebase Manager Modal */}
        {showFirebaseManager && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px'
          }}>
            <div style={{
              backgroundColor: darkMode ? '#2a2a2a' : '#fff',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '900px',
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              border: darkMode ? '1px solid #444' : 'none'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px'
              }}>
                <h2 style={{
                  margin: 0,
                  color: darkMode ? '#fff' : '#333'
                }}>
                  Firebase Files Manager
                </h2>
                <button
                  onClick={() => {
                    setShowFirebaseManager(false);
                    setSelectedDiagramIds(new Set()); // Clear selections when closing
                  }}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: darkMode ? '#555' : '#999',
                    color: 'white',
                    border: darkMode ? '1px solid #666' : 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  Close
                </button>
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
                flexWrap: 'wrap',
                gap: '10px'
              }}>
                <p style={{
                  color: darkMode ? '#aaa' : '#666',
                  margin: 0
                }}>
                  {firebaseDiagrams.length} diagram(s) stored in Firebase
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {firebaseDiagrams.length > 0 && (
                    <button
                      onClick={async () => {
                        if (!window.confirm(`DELETE ALL ${firebaseDiagrams.length} diagrams from Firebase?\n\nThis will:\n✓ Delete ALL diagrams from Firebase\n✓ Keep local diagrams unchanged\n\nThis cannot be undone!`)) {
                          return;
                        }
                        try {
                          setSyncStatus('Deleting all from Firebase...');
                          const deletePromises = firebaseDiagrams.map(d => deleteFromFirebase(d.id));
                          await Promise.all(deletePromises);
                          setFirebaseDiagrams([]);
                          setSyncStatus('✓ All deleted from Firebase');
                          setTimeout(() => setSyncStatus(null), 2000);
                          alert(`✓ Successfully deleted all ${deletePromises.length} diagrams from Firebase`);
                        } catch (error) {
                          console.error('Error deleting all from Firebase:', error);
                          setSyncStatus('✗ Delete failed');
                          setTimeout(() => setSyncStatus(null), 3000);
                          alert('Error deleting from Firebase: ' + error.message);
                        }
                      }}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#d32f2f',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: 'bold'
                      }}
                    >
                      🗑️ Delete All from Firebase
                    </button>
                  )}
                  {selectedDiagramIds.size > 0 && (
                    <button
                      onClick={deleteSelectedDiagrams}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#f44336',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: 'bold'
                      }}
                    >
                      Delete Selected ({selectedDiagramIds.size})
                    </button>
                  )}
                </div>
              </div>

              {firebaseDiagrams.length === 0 ? (
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: darkMode ? '#888' : '#999'
                }}>
                  <p>No diagrams found in Firebase</p>
                  <p style={{ fontSize: '13px', marginTop: '10px' }}>
                    Use the "☁️ Save to Firebase" button on individual diagrams or "☁️ Sync All to Firebase" to upload your diagrams.
                  </p>
                </div>
              ) : (
                <div style={{ overflow: 'auto' }}>
                  {/* Group diagrams by folder */}
                  {(() => {
                    const folderGroups = {};
                    firebaseDiagrams.forEach(diagram => {
                      const folderKey = `${diagram.customer || 'Unknown'}-${diagram.folder || 'General'}`;
                      if (!folderGroups[folderKey]) {
                        folderGroups[folderKey] = [];
                      }
                      folderGroups[folderKey].push(diagram);
                    });

                    return Object.entries(folderGroups).map(([folderKey, diagrams]) => (
                      <div key={folderKey} style={{
                        marginBottom: '20px',
                        border: darkMode ? '1px solid #555' : '1px solid #ddd',
                        borderRadius: '8px',
                        overflow: 'hidden'
                      }}>
                        {/* Folder Header */}
                        <div style={{
                          backgroundColor: darkMode ? '#444' : '#f0f0f0',
                          padding: '12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderBottom: darkMode ? '1px solid #555' : '1px solid #ddd'
                        }}>
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <input
                              type="checkbox"
                              checked={diagrams.every(d => selectedDiagramIds.has(d.id))}
                              onChange={() => toggleSelectAll(diagrams)}
                              style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                              title="Select all in this folder"
                            />
                            <strong style={{ fontSize: '15px' }}>
                              📁 {folderKey} ({diagrams.length} diagrams)
                            </strong>
                          </div>
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Delete entire folder "${folderKey}" with ${diagrams.length} diagrams?`)) return;

                              const folderDiagramIds = new Set(diagrams.map(d => d.id));
                              try {
                                const deletePromises = diagrams.map(d => deleteFromFirebase(d.id));
                                await Promise.all(deletePromises);

                                setSavedDiagrams(prev => {
                                  const newDiagrams = { ...prev };
                                  folderDiagramIds.forEach(id => delete newDiagrams[id]);
                                  return newDiagrams;
                                });

                                setFirebaseDiagrams(prev =>
                                  prev.filter(d => !folderDiagramIds.has(d.id))
                                );

                                alert(`Deleted folder "${folderKey}" with ${diagrams.length} diagrams`);
                              } catch (error) {
                                console.error('Error deleting folder:', error);
                                alert('Error deleting folder. Check console for details.');
                              }
                            }}
                            style={{
                              padding: '8px 16px',
                              backgroundColor: '#f44336',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '13px',
                              fontWeight: 'bold'
                            }}
                          >
                            Delete Folder
                          </button>
                        </div>

                        {/* Folder Contents Table */}
                        <table style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: '13px'
                        }}>
                          <thead style={{
                            backgroundColor: '#673ab7',
                            color: 'white'
                          }}>
                            <tr>
                              <th style={{
                                padding: '12px',
                                textAlign: 'center',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                width: '50px'
                              }}>
                                ☑
                              </th>
                              <th style={{
                                padding: '12px',
                                textAlign: 'left',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd'
                              }}>
                                Diagram Name
                              </th>
                              <th style={{
                                padding: '12px',
                                textAlign: 'center',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd'
                              }}>
                                Parts
                              </th>
                              <th style={{
                                padding: '12px',
                                textAlign: 'center',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd'
                              }}>
                                Created
                              </th>
                              <th style={{
                                padding: '12px',
                                textAlign: 'center',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd'
                              }}>
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {diagrams.map((diagram, index) => (
                        <tr key={diagram.id} style={{
                          backgroundColor: darkMode
                            ? (index % 2 === 0 ? '#333' : '#3a3a3a')
                            : (index % 2 === 0 ? '#f9f9f9' : 'white'),
                          color: darkMode ? '#fff' : '#000'
                        }}>
                          <td style={{
                            padding: '10px',
                            border: darkMode ? '1px solid #555' : '1px solid #ddd',
                            textAlign: 'center'
                          }}>
                            <input
                              type="checkbox"
                              checked={selectedDiagramIds.has(diagram.id)}
                              onChange={() => toggleDiagramSelection(diagram.id)}
                              style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                            />
                          </td>
                              <td style={{
                                padding: '10px',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                color: darkMode ? '#fff' : '#000'
                              }}>
                                <strong style={{ color: darkMode ? '#fff' : '#000' }}>{diagram.name}</strong>
                              </td>
                              <td style={{
                                padding: '10px',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                textAlign: 'center',
                                color: darkMode ? '#fff' : '#000'
                              }}>
                                {diagram.partsData ? Object.keys(diagram.partsData).length : 0}
                              </td>
                              <td style={{
                                padding: '10px',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                textAlign: 'center',
                                color: darkMode ? '#fff' : '#000'
                              }}>
                                {diagram.createdAt ? new Date(diagram.createdAt).toLocaleDateString() : 'N/A'}
                              </td>
                              <td style={{
                                padding: '10px',
                                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                                textAlign: 'center'
                              }}>
                                <button
                                  onClick={() => handleDeleteFromFirebase(diagram.id, diagram.name)}
                                  style={{
                                    padding: '6px 12px',
                                    backgroundColor: '#f44336',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: 'bold'
                                  }}
                                >
                                  🗑️ Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
          </div>
        )}

        {/* Current Diagram */}
        {!showPartsReview && currentDiagram ? (
          <div ref={diagramViewerRef}>
            {/* Navigation Controls */}
            {(() => {
              const diagramIds = Object.keys(savedDiagrams);
              const currentIndex = diagramIds.indexOf(currentDiagramId);
              const hasNext = currentIndex < diagramIds.length - 1;
              const hasPrevious = currentIndex > 0;

              return (
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                  borderRadius: '8px 8px 0 0',
                  marginBottom: '-8px',
                  boxShadow: darkMode ? '0 2px 4px rgba(0,0,0,0.5)' : '0 2px 4px rgba(0,0,0,0.1)',
                  border: darkMode ? '1px solid #444' : '1px solid #ddd',
                  borderBottom: 'none'
                }}>
                  <button
                    onClick={() => {
                      if (hasPrevious) {
                        setCurrentDiagramId(diagramIds[currentIndex - 1]);
                      }
                    }}
                    disabled={!hasPrevious}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: hasPrevious ? '#2196f3' : (darkMode ? '#444' : '#ddd'),
                      color: hasPrevious ? 'white' : (darkMode ? '#666' : '#999'),
                      border: 'none',
                      borderRadius: '6px',
                      cursor: hasPrevious ? 'pointer' : 'not-allowed',
                      fontWeight: 'bold',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    ← Previous
                  </button>

                  <div style={{
                    color: darkMode ? '#fff' : '#333',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}>
                    {currentIndex + 1} / {diagramIds.length}
                  </div>

                  <button
                    onClick={() => {
                      if (hasNext) {
                        setCurrentDiagramId(diagramIds[currentIndex + 1]);
                      }
                    }}
                    disabled={!hasNext}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: hasNext ? '#2196f3' : (darkMode ? '#444' : '#ddd'),
                      color: hasNext ? 'white' : (darkMode ? '#666' : '#999'),
                      border: 'none',
                      borderRadius: '6px',
                      cursor: hasNext ? 'pointer' : 'not-allowed',
                      fontWeight: 'bold',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    Next →
                  </button>
                </div>
              );
            })()}

            {/* Parts List PDF Import */}
            <div style={{
              padding: '12px 16px',
              backgroundColor: darkMode ? '#2a2a2a' : '#fff',
              borderLeft: darkMode ? '1px solid #444' : '1px solid #ddd',
              borderRight: darkMode ? '1px solid #444' : '1px solid #ddd',
              display: 'flex',
              gap: '10px',
              justifyContent: 'center',
              flexWrap: 'wrap'
            }}>
              <label style={{
                padding: '10px 20px',
                backgroundColor: '#4caf50',
                color: 'white',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                📄 Import Parts List
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.txt"
                  onChange={handlePartsListPDFUpload}
                  style={{ display: 'none' }}
                />
              </label>

              <label style={{
                padding: '10px 20px',
                backgroundColor: '#00bcd4',
                color: 'white',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                🖼️ Add Parts List Images
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={handleUploadPartsListImages}
                  style={{ display: 'none' }}
                />
              </label>

              <button
                onClick={() => setCurrentView('pdf-converter')}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#ff9800',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                🔄 PDF to CSV Converter
              </button>

              {currentDiagram.partsListImages && currentDiagram.partsListImages.length > 0 && (
                <button
                  onClick={() => setShowPartsListSource(!showPartsListSource)}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: showPartsListSource ? '#9c27b0' : '#673ab7',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  {showPartsListSource ? '👁️ Hide' : '📋 Show'} Source for Parts List
                </button>
              )}
            </div>

            <InteractiveDiagram
              diagram={currentDiagram}
              onHotspotsUpdate={(hotspots) => updateDiagramHotspots(currentDiagram.id, hotspots)}
              onPartsDataUpdate={(partsData) => updateDiagramPartsData(currentDiagram.id, partsData)}
              onRotationUpdate={(rotation) => updateDiagramRotation(currentDiagram.id, rotation)}
              globalOrderList={globalOrderList}
              setGlobalOrderList={setGlobalOrderList}
              allDiagrams={savedDiagrams}
              darkMode={darkMode}
            />

            {/* Parts List Source Images Modal */}
            {showPartsListSource && currentDiagram.partsListImages && currentDiagram.partsListImages.length > 0 && (
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                padding: '20px',
                overflowY: 'auto'
              }}>
                <div style={{
                  backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                  color: darkMode ? '#fff' : '#333',
                  borderRadius: '12px',
                  maxWidth: '90vw',
                  maxHeight: '90vh',
                  overflow: 'auto',
                  padding: '30px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                    position: 'sticky',
                    top: 0,
                    backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                    zIndex: 1,
                    paddingBottom: '10px'
                  }}>
                    <div>
                      <h2 style={{ margin: 0, marginBottom: '5px' }}>📋 Parts List Source Images</h2>
                      <div style={{
                        fontSize: '14px',
                        color: darkMode ? '#aaa' : '#666',
                        fontWeight: 'normal'
                      }}>
                        {currentDiagram.name} ({currentDiagram.partsListImages.length} image{currentDiagram.partsListImages.length !== 1 ? 's' : ''})
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={() => {
                          if (window.confirm(`Clear all ${currentDiagram.partsListImages.length} parts list image(s) from "${currentDiagram.name}"?`)) {
                            setSavedDiagrams(prev => ({
                              ...prev,
                              [currentDiagramId]: {
                                ...prev[currentDiagramId],
                                partsListImages: []
                              }
                            }));
                            setShowPartsListSource(false);
                          }
                        }}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#ff9800',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: 'bold'
                        }}
                      >
                        🗑️ Clear All
                      </button>
                      <button
                        onClick={() => setShowPartsListSource(false)}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#f44336',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: 'bold'
                        }}
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px'
                  }}>
                    {currentDiagram.partsListImages.map((image, index) => (
                      <div key={index} style={{
                        border: darkMode ? '2px solid #444' : '2px solid #ddd',
                        borderRadius: '8px',
                        padding: '15px',
                        backgroundColor: darkMode ? '#1a1a1a' : '#f9f9f9'
                      }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '10px'
                        }}>
                          <div style={{
                            fontWeight: 'bold',
                            color: darkMode ? '#aaa' : '#666'
                          }}>
                            {image.fileName}
                          </div>
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete "${image.fileName}" from parts list?`)) {
                                setSavedDiagrams(prev => ({
                                  ...prev,
                                  [currentDiagramId]: {
                                    ...prev[currentDiagramId],
                                    partsListImages: prev[currentDiagramId].partsListImages.filter((_, i) => i !== index)
                                  }
                                }));
                              }
                            }}
                            style={{
                              padding: '4px 12px',
                              backgroundColor: '#f44336',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '12px'
                            }}
                          >
                            🗑️ Delete
                          </button>
                        </div>
                        <img
                          src={image.data}
                          alt={image.fileName}
                          style={{
                            width: '100%',
                            height: 'auto',
                            borderRadius: '4px',
                            border: darkMode ? '1px solid #555' : '1px solid #ccc'
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            borderRadius: '8px',
            padding: '60px',
            textAlign: 'center',
            boxShadow: darkMode ? '0 2px 4px rgba(0,0,0,0.5)' : '0 2px 4px rgba(0,0,0,0.1)',
            border: darkMode ? '1px solid #444' : 'none'
          }}>
            <h2 style={{
              color: darkMode ? '#aaa' : '#666',
              marginBottom: '16px'
            }}>No Diagrams Yet</h2>
            <p style={{
              color: darkMode ? '#888' : '#999',
              marginBottom: '24px'
            }}>
              Upload a PDF diagram and parts list to get started
            </p>
            <button
              onClick={() => setShowUploadForm(true)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#2196f3',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '16px'
              }}
            >
              Upload Your First Diagram
            </button>
          </div>
        )}
        </>
        )}
      </div>

      {/* Heavy Loading Overlay - prevents rendering during large data loads */}
      {isLoadingHeavy && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: darkMode ? 'rgba(0,0,0,0.95)' : 'rgba(255,255,255,0.95)',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px'
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            border: '4px solid ' + (darkMode ? '#444' : '#ddd'),
            borderTop: '4px solid #2196f3',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <div style={{
            fontSize: '18px',
            color: darkMode ? '#fff' : '#333',
            fontWeight: 'bold'
          }}>
            {syncStatus || 'Loading...'}
          </div>
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px',
          overflowY: 'auto'
        }}>
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            color: darkMode ? '#fff' : '#333',
            borderRadius: '12px',
            maxWidth: '900px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            padding: '30px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>📖 Parts Viewer Help Guide</h2>
              <button
                onClick={() => setShowHelp(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Close
              </button>
            </div>

            <div style={{ lineHeight: '1.6' }}>
              <h3 style={{ color: '#2196f3', marginTop: '20px' }}>🎯 What is Parts Viewer?</h3>
              <p>
                Parts Viewer is an interactive diagram tool that lets you create clickable parts diagrams with hotspots.
                Click on any part in a diagram to see its details, add it to orders, and manage your parts inventory.
              </p>

              <h3 style={{ color: '#2196f3', marginTop: '30px' }}>🚀 Quick Start: The Complete Workflow</h3>

              <h4 style={{ color: '#ff9800', marginTop: '20px' }}>Method 1: Batch Create/Rename (Fastest for Multiple Diagrams)</h4>
              <p>This method is perfect when you have a table of contents from a manual and want to create many diagrams at once.</p>
              <ol>
                <li><strong>Create blank diagrams first:</strong>
                  <ul>
                    <li>Click "📖 Create Diagram Book"</li>
                    <li>Enter each diagram on a new line (e.g., "Diagram 1", "Diagram 2", etc.)</li>
                    <li>Or just enter numbers: "1", "2", "3" - you'll rename them next</li>
                    <li>Click "Create Diagrams" - this creates all diagrams with placeholder names</li>
                  </ul>
                </li>
                <li><strong>Use Batch Create/Rename:</strong>
                  <ul>
                    <li>Click "📋 Batch Create/Rename"</li>
                    <li>Select the folder containing your blank diagrams</li>
                    <li>Paste your table of contents (4 lines per entry):
                      <div style={{
                        backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
                        padding: '12px',
                        borderRadius: '6px',
                        marginTop: '8px',
                        fontFamily: 'monospace',
                        fontSize: '12px'
                      }}>
                        10-1<br/>
                        MAIN BODY UNIT<br/>
                        000-146-9410-11<br/>
                        4D-44864
                      </div>
                    </li>
                    <li>Click "📄 Parse TOC" to extract all entries</li>
                    <li>Click "🔄 Auto-Map in Order" to automatically assign names</li>
                    <li>Click "✓ Apply Renames" when done</li>
                  </ul>
                </li>
                <li><strong>Add images to diagrams:</strong>
                  <ul>
                    <li>Click on a diagram to open it</li>
                    <li>In the upload form, click "Choose File" under "Diagram Image"</li>
                    <li>Select your JPG diagram image</li>
                    <li>The diagram number and folder info is already filled in!</li>
                    <li>Click "Update Diagram"</li>
                  </ul>
                </li>
                <li><strong>Add parts lists (optional):</strong>
                  <ul>
                    <li>Upload a PDF parts list</li>
                    <li>Or use the PDF to CSV Converter to convert PDF parts lists to CSV</li>
                    <li>Import the CSV and click hotspots on the diagram to place parts</li>
                  </ul>
                </li>
              </ol>

              <h4 style={{ color: '#ff9800', marginTop: '30px' }}>Method 2: Create Individual Diagrams</h4>
              <ol>
                <li>Click "+ New Diagram"</li>
                <li>Fill in:
                  <ul>
                    <li>Customer name (e.g., "Shearers")</li>
                    <li>Folder/Equipment (e.g., "CCW-R")</li>
                    <li>Diagram name (e.g., "10-1 MAIN BODY UNIT")</li>
                    <li>Diagram number (e.g., "4D-44864")</li>
                  </ul>
                </li>
                <li>Upload diagram image (JPG file)</li>
                <li>Upload parts list (PDF file) - optional</li>
                <li>Click "Create Diagram"</li>
              </ol>

              <h3 style={{ color: '#2196f3', marginTop: '30px' }}>📋 Working with the ManualProcessor</h3>
              <p>The ManualProcessor and Parts Viewer work together seamlessly!</p>

              <h4 style={{ color: '#4caf50' }}>Workflow:</h4>
              <ol>
                <li><strong>In ManualProcessor:</strong>
                  <ul>
                    <li>Process your parts manual PDF</li>
                    <li>Use "🚀 Auto-Map All Pages in Order" to map pages to TOC entries</li>
                    <li>Mark duplicate diagrams using "🔄 Mark as Duplicate" button</li>
                    <li>Download the ZIP file with organized Exploded-Views and Parts-Lists folders</li>
                  </ul>
                </li>
                <li><strong>In Parts Viewer:</strong>
                  <ul>
                    <li>Use "📖 Create Diagram Book" to create blank diagrams (one for each unique diagram)</li>
                    <li>Use "📋 Batch Create/Rename" with the same TOC text to name all diagrams</li>
                    <li>Extract the ZIP file from ManualProcessor</li>
                    <li>Upload images from the Exploded-Views folder to each diagram</li>
                    <li>Upload parts lists from the Parts-Lists folder (optional)</li>
                  </ul>
                </li>
              </ol>

              <h3 style={{ color: '#2196f3', marginTop: '30px' }}>🔧 Key Features</h3>

              <h4 style={{ marginTop: '15px' }}>📖 Create Diagram Book</h4>
              <p>
                Quickly create multiple diagrams at once. Enter diagram names (one per line) or just numbers,
                then use Batch Create/Rename to give them proper names.
              </p>

              <h4 style={{ marginTop: '15px' }}>📋 Batch Create/Rename from TOC</h4>
              <p>
                Bulk rename diagrams using your table of contents. Perfect for when you have 30+ diagrams to name.
                The system auto-maps TOC entries to diagrams in order within a selected folder.
              </p>

              <h4 style={{ marginTop: '15px' }}># Auto-Populate Numbers</h4>
              <p>
                Automatically extracts diagram numbers from diagram names. If your diagram is named
                "10-1-MAIN-BODY-UNIT-4D-44864", it will extract "4D-44864" as the diagram number.
              </p>

              <h4 style={{ marginTop: '15px' }}>🔍 PDF to CSV Converter</h4>
              <p>
                Switch to "PDF Converter" view to convert PDF parts lists into CSV format. The app can OCR the parts
                list if it's image-based. You can then import the CSV directly into a diagram.
              </p>

              <h4 style={{ marginTop: '15px' }}>📱 Interactive Hotspots</h4>
              <p>
                Click anywhere on a diagram image to place a hotspot. Assign a part number to each hotspot.
                When users click on that spot, they'll see the part details and can add it to their order.
              </p>

              <h4 style={{ marginTop: '15px' }}>🛒 Global Order List</h4>
              <p>
                Parts added from any diagram accumulate in a global order list. You can view, edit quantities,
                and export orders to Excel.
              </p>

              <h3 style={{ color: '#2196f3', marginTop: '30px' }}>💡 Tips & Tricks</h3>
              <ul>
                <li><strong>Use folders to organize:</strong> Group diagrams by customer and equipment model</li>
                <li><strong>Diagram numbers help with orders:</strong> They appear in the order export for easy reference</li>
                <li><strong>Create diagrams first, add details later:</strong> Don't wait to have everything - create the structure first</li>
                <li><strong>TOC format matters:</strong> Make sure your table of contents has exactly 4 lines per entry</li>
                <li><strong>Image size limit:</strong> Keep diagram images under 1MB for best performance</li>
                <li><strong>Firebase sync:</strong> Enable Firebase in Settings to sync diagrams across devices</li>
              </ul>

              <h3 style={{ color: '#2196f3', marginTop: '30px' }}>❓ Common Questions</h3>

              <h4 style={{ marginTop: '15px' }}>Q: Can I edit a diagram after creating it?</h4>
              <p>
                Yes! Click on any diagram to open it, then click the "✏️ Edit" button. You can change the name,
                number, image, parts list, or hotspots.
              </p>

              <h4 style={{ marginTop: '15px' }}>Q: What if I don't have a parts list yet?</h4>
              <p>
                No problem! You can create the diagram with just the image, then add the parts list later when you
                have it. Or you can manually create hotspots and enter part numbers.
              </p>

              <h4 style={{ marginTop: '15px' }}>Q: How do I delete multiple diagrams at once?</h4>
              <p>
                Click the checkbox on each diagram you want to delete, then click the "🗑️ Delete Selected" button
                that appears.
              </p>

              <h4 style={{ marginTop: '15px' }}>Q: Can I use this without the ManualProcessor?</h4>
              <p>
                Absolutely! The ManualProcessor is just a helper tool. You can upload diagrams and parts lists
                directly to Parts Viewer, or create everything manually.
              </p>

              <h4 style={{ marginTop: '15px' }}>Q: What's the difference between the diagram name and number?</h4>
              <p>
                The <strong>name</strong> is descriptive (e.g., "10-1 MAIN BODY UNIT"). The <strong>number</strong> is
                the technical reference (e.g., "4D-44864"). Both appear in orders and help identify parts.
              </p>

              <h4 style={{ marginTop: '15px' }}>Q: How many diagrams can I create?</h4>
              <p>
                There's no hard limit! The app uses localStorage for local storage and Firebase for cloud sync.
                You can easily manage hundreds of diagrams.
              </p>
            </div>

            <div style={{ marginTop: '30px', textAlign: 'center' }}>
              <button
                onClick={() => setShowHelp(false)}
                style={{
                  padding: '12px 30px',
                  backgroundColor: '#2196f3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '16px'
                }}
              >
                Got It!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Storage Diagnostic Modal */}
      {showStorageDiagnostic && diagnosticData && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px',
          overflowY: 'auto'
        }}>
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            color: darkMode ? '#fff' : '#333',
            borderRadius: '12px',
            maxWidth: '1000px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            padding: '30px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>🔧 Storage Diagnostic Report</h2>
              <button
                onClick={() => setShowStorageDiagnostic(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Close
              </button>
            </div>

            <div style={{ lineHeight: '1.6' }}>
              {/* Summary Section */}
              <div style={{
                backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
                padding: '20px',
                borderRadius: '8px',
                marginBottom: '20px'
              }}>
                <h3 style={{ marginTop: 0 }}>📊 Storage Summary</h3>
                <p style={{ fontSize: '16px', margin: '10px 0' }}>
                  <strong>Total localStorage Size:</strong> {diagnosticData.totalSizeMB} MB / ~5-10 MB limit
                </p>
                <p style={{ fontSize: '16px', margin: '10px 0' }}>
                  <strong>Total Diagrams:</strong> {diagnosticData.diagramsCount}
                </p>
                <p style={{ fontSize: '16px', margin: '10px 0', color: diagnosticData.corruptedDiagrams.length > 0 ? '#f44336' : '#4caf50' }}>
                  <strong>Corrupted Diagrams:</strong> {diagnosticData.corruptedDiagrams.length}
                </p>
                <p style={{ fontSize: '16px', margin: '10px 0', color: diagnosticData.largeDiagrams.length > 0 ? '#ff9800' : '#4caf50' }}>
                  <strong>Large Diagrams (&gt;1MB):</strong> {diagnosticData.largeDiagrams.length}
                </p>
                <p style={{ fontSize: '16px', margin: '10px 0', color: '#4caf50' }}>
                  <strong>Valid Diagrams:</strong> {diagnosticData.validDiagrams.length}
                </p>
              </div>

              {/* Corrupted Diagrams */}
              {diagnosticData.corruptedDiagrams.length > 0 && (
                <div style={{ marginBottom: '30px' }}>
                  <h3 style={{ color: '#f44336' }}>⚠️ Corrupted Diagrams ({diagnosticData.corruptedDiagrams.length})</h3>
                  <p>These diagrams have invalid or missing image data and cannot be displayed.</p>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '10px' }}>
                    {diagnosticData.corruptedDiagrams.map(d => (
                      <div key={d.id} style={{
                        backgroundColor: darkMode ? '#3a1a1a' : '#ffebee',
                        padding: '10px',
                        borderRadius: '6px',
                        marginBottom: '8px',
                        border: '1px solid #f44336'
                      }}>
                        <strong>{d.name}</strong><br/>
                        <span style={{ fontSize: '12px', opacity: 0.7 }}>
                          Reason: {d.reason} | Size: {d.size}KB
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={deleteCorruptedDiagrams}
                    disabled={fixingStorage}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#f44336',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: fixingStorage ? 'not-allowed' : 'pointer',
                      fontWeight: 'bold',
                      opacity: fixingStorage ? 0.5 : 1
                    }}
                  >
                    🗑️ Delete All Corrupted Diagrams
                  </button>
                </div>
              )}

              {/* Large Diagrams */}
              {diagnosticData.largeDiagrams.length > 0 && (
                <div style={{ marginBottom: '30px' }}>
                  <h3 style={{ color: '#ff9800' }}>📦 Large Diagrams ({diagnosticData.largeDiagrams.length})</h3>
                  <p>These diagrams are taking up significant storage space and may cause issues.</p>
                  <div style={{ maxHeight: '250px', overflowY: 'auto', marginBottom: '10px' }}>
                    {diagnosticData.largeDiagrams.map(d => (
                      <div key={d.id} style={{
                        backgroundColor: darkMode ? '#3a2a1a' : '#fff3e0',
                        padding: '10px',
                        borderRadius: '6px',
                        marginBottom: '8px',
                        border: '1px solid #ff9800'
                      }}>
                        <strong>{d.name}</strong><br/>
                        <span style={{ fontSize: '12px', opacity: 0.7 }}>
                          Type: {d.type.toUpperCase()} | Size: <span style={{
                            fontWeight: 'bold',
                            color: d.size > 5000 ? '#f44336' : d.size > 2000 ? '#ff9800' : '#4caf50'
                          }}>{d.size}KB</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={fixStorageIssues}
                    disabled={fixingStorage}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#ff9800',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: fixingStorage ? 'not-allowed' : 'pointer',
                      fontWeight: 'bold',
                      opacity: fixingStorage ? 0.5 : 1
                    }}
                  >
                    🔧 Re-compress Large Images
                  </button>
                  <p style={{ fontSize: '12px', marginTop: '8px', opacity: 0.7 }}>
                    Note: This will reduce image quality to save space. PDFs cannot be compressed.
                  </p>
                </div>
              )}

              {/* Valid Diagrams */}
              {diagnosticData.validDiagrams.length > 0 && (
                <div style={{ marginBottom: '30px' }}>
                  <h3 style={{ color: '#4caf50' }}>✅ Valid Diagrams ({diagnosticData.validDiagrams.length})</h3>
                  <details>
                    <summary style={{ cursor: 'pointer', marginBottom: '10px', fontWeight: 'bold' }}>
                      Show details
                    </summary>
                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {diagnosticData.validDiagrams.map(d => (
                        <div key={d.id} style={{
                          backgroundColor: darkMode ? '#1a2a1a' : '#e8f5e9',
                          padding: '8px',
                          borderRadius: '6px',
                          marginBottom: '6px',
                          border: '1px solid #4caf50'
                        }}>
                          <strong style={{ fontSize: '13px' }}>{d.name}</strong>
                          <span style={{ fontSize: '11px', opacity: 0.7, marginLeft: '10px' }}>
                            ({d.type.toUpperCase()}, {d.size}KB)
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {/* Recommendations */}
              <div style={{
                backgroundColor: darkMode ? '#1a1a2a' : '#e3f2fd',
                padding: '20px',
                borderRadius: '8px',
                marginTop: '20px',
                border: '2px solid #2196f3'
              }}>
                <h3 style={{ marginTop: 0, color: '#2196f3' }}>💡 Recommendations</h3>
                <ul style={{ marginBottom: 0 }}>
                  {diagnosticData.corruptedDiagrams.length > 0 && (
                    <li>Delete corrupted diagrams and re-upload them with fresh images</li>
                  )}
                  {diagnosticData.largeDiagrams.length > 0 && (
                    <li>Re-compress large images to reduce storage usage</li>
                  )}
                  {parseFloat(diagnosticData.totalSizeMB) > 5 && (
                    <li style={{ color: '#f44336', fontWeight: 'bold' }}>
                      Warning: localStorage is near or over its limit! Consider enabling Firebase sync to move data to the cloud.
                    </li>
                  )}
                  {parseFloat(diagnosticData.totalSizeMB) < 5 && diagnosticData.corruptedDiagrams.length === 0 && (
                    <li style={{ color: '#4caf50' }}>Your storage looks healthy! No action needed.</li>
                  )}
                </ul>
              </div>
            </div>

            <div style={{ marginTop: '30px', textAlign: 'center' }}>
              <button
                onClick={cleanLocalStorage}
                style={{
                  padding: '12px 30px',
                  backgroundColor: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '16px',
                  marginRight: '10px',
                  marginBottom: '0'
                }}
                title="Remove all PDF/image data from localStorage (diagrams will load from Firebase)"
              >
                🧹 Clean localStorage
              </button>
              <button
                onClick={() => runStorageDiagnostic()}
                style={{
                  padding: '12px 30px',
                  backgroundColor: '#2196f3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '16px',
                  marginRight: '10px',
                  marginBottom: '0'
                }}
              >
                🔄 Refresh Diagnostic
              </button>
              <button
                onClick={() => setShowStorageDiagnostic(false)}
                style={{
                  padding: '12px 30px',
                  backgroundColor: darkMode ? '#444' : '#ccc',
                  color: darkMode ? '#fff' : '#333',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '16px'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Start Wizard Modal */}
      {showQuickStartWizard && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: darkMode ? '#1e1e1e' : '#fff',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '800px',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
          }}>
            {/* Header with progress */}
            <div style={{
              padding: '24px',
              borderBottom: darkMode ? '1px solid #444' : '1px solid #ddd',
              position: 'sticky',
              top: 0,
              backgroundColor: darkMode ? '#1e1e1e' : '#fff',
              zIndex: 1
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, color: darkMode ? '#fff' : '#333' }}>
                  🚀 Quick Start Wizard
                </h2>
                <button
                  onClick={() => setShowQuickStartWizard(false)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#d32f2f',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  ✕ Close
                </button>
              </div>

              {/* Progress bar */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  color: darkMode ? '#aaa' : '#666',
                  fontSize: '13px'
                }}>
                  <span>Step {wizardStep} of 3</span>
                  <span>{Math.round((wizardStep / 3) * 100)}% Complete</span>
                </div>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: darkMode ? '#333' : '#e0e0e0',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${(wizardStep / 3) * 100}%`,
                    height: '100%',
                    backgroundColor: '#ff9800',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>

              {/* Step indicators */}
              <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '16px' }}>
                {['Setup', 'Import', 'Images'].map((label, idx) => (
                  <div key={label} style={{
                    textAlign: 'center',
                    opacity: idx + 1 <= wizardStep ? 1 : 0.4
                  }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: idx + 1 === wizardStep ? '#ff9800' : (idx + 1 < wizardStep ? '#4caf50' : (darkMode ? '#444' : '#ddd')),
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 8px',
                      fontWeight: 'bold',
                      fontSize: '14px'
                    }}>
                      {idx + 1 < wizardStep ? '✓' : idx + 1}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: darkMode ? '#aaa' : '#666',
                      fontWeight: idx + 1 === wizardStep ? 'bold' : 'normal'
                    }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Content */}
            <div style={{ padding: '32px' }}>
              {wizardStep === 1 && (
                <div>
                  <h3 style={{ color: darkMode ? '#fff' : '#333', marginTop: 0 }}>
                    Step 1: Project Setup
                  </h3>
                  <p style={{ color: darkMode ? '#aaa' : '#666', marginBottom: '24px' }}>
                    First, let's organize your diagrams by customer and folder.
                  </p>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: darkMode ? '#fff' : '#333',
                      fontWeight: 'bold'
                    }}>
                      Customer:
                    </label>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <select
                        value={wizardData.customer}
                        onChange={(e) => {
                          if (e.target.value === '__ADD_NEW__') {
                            const newCustomer = prompt('Enter new customer name:');
                            if (newCustomer && newCustomer.trim()) {
                              const trimmedName = newCustomer.trim();
                              const existingCustomers = getCustomers();
                              if (existingCustomers.includes(trimmedName)) {
                                alert(`Customer "${trimmedName}" already exists!`);
                                return;
                              }
                              setWizardData(prev => ({ ...prev, customer: trimmedName }));
                            }
                          } else {
                            setWizardData(prev => ({ ...prev, customer: e.target.value }));
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: '12px',
                          backgroundColor: darkMode ? '#333' : '#fff',
                          color: darkMode ? '#fff' : '#000',
                          border: darkMode ? '1px solid #555' : '1px solid #ccc',
                          borderRadius: '6px',
                          fontSize: '14px'
                        }}
                      >
                        {getCustomers().map(customer => (
                          <option key={customer} value={customer}>{customer}</option>
                        ))}
                        <option value="__ADD_NEW__">➕ Add New Customer...</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ marginBottom: '24px' }}>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: darkMode ? '#fff' : '#333',
                      fontWeight: 'bold'
                    }}>
                      Folder Name:
                    </label>
                    <input
                      type="text"
                      value={wizardData.folder}
                      onChange={(e) => setWizardData(prev => ({ ...prev, folder: e.target.value }))}
                      placeholder="e.g., Main Body Units, Hydraulic Systems"
                      style={{
                        width: '100%',
                        padding: '12px',
                        backgroundColor: darkMode ? '#333' : '#fff',
                        color: darkMode ? '#fff' : '#000',
                        border: darkMode ? '1px solid #555' : '1px solid #ccc',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    />
                  </div>

                  <button
                    onClick={() => {
                      if (!wizardData.folder.trim()) {
                        alert('Please enter a folder name');
                        return;
                      }
                      setWizardStep(2);
                    }}
                    style={{
                      padding: '12px 32px',
                      backgroundColor: '#ff9800',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '16px',
                      width: '100%'
                    }}
                  >
                    Next: Import Diagrams →
                  </button>
                </div>
              )}

              {wizardStep === 2 && (
                <div>
                  <h3 style={{ color: darkMode ? '#fff' : '#333', marginTop: 0 }}>
                    Step 2: Import Diagrams
                  </h3>
                  <p style={{ color: darkMode ? '#aaa' : '#666', marginBottom: '24px' }}>
                    Paste your table of contents below. Each diagram will be created automatically.
                  </p>

                  <div style={{
                    backgroundColor: darkMode ? '#2a2a2a' : '#f5f5f5',
                    padding: '12px',
                    borderRadius: '6px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: darkMode ? '#aaa' : '#666'
                  }}>
                    <strong>Format (4 lines per diagram):</strong><br />
                    Line 1: Section (e.g., "10-1")<br />
                    Line 2: Name (e.g., "MAIN BODY UNIT")<br />
                    Line 3: Part code (skipped)<br />
                    Line 4: Drawing number (e.g., "4D-38837")
                  </div>

                  <textarea
                    value={wizardData.tocText}
                    onChange={(e) => setWizardData(prev => ({ ...prev, tocText: e.target.value }))}
                    placeholder={'10-1\nMAIN BODY UNIT\n000-146-9410-11\n4D-44864\n\n10-2\nPLATE UNIT\n000-055-2083-09\n4D-09794'}
                    style={{
                      width: '100%',
                      minHeight: '300px',
                      padding: '12px',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000',
                      border: darkMode ? '1px solid #555' : '1px solid #ccc',
                      borderRadius: '6px',
                      fontFamily: 'monospace',
                      fontSize: '13px',
                      resize: 'vertical',
                      marginBottom: '16px'
                    }}
                  />

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                      onClick={() => setWizardStep(1)}
                      style={{
                        padding: '12px 24px',
                        backgroundColor: darkMode ? '#444' : '#ddd',
                        color: darkMode ? '#fff' : '#000',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '14px'
                      }}
                    >
                      ← Back
                    </button>
                    <button
                      onClick={async () => {
                        if (!wizardData.tocText.trim()) {
                          alert('Please paste your table of contents');
                          return;
                        }

                        // Parse TOC
                        const lines = wizardData.tocText.trim().split('\n');
                        const createdIds = [];

                        for (let i = 0; i < lines.length; i += 4) {
                          if (i + 3 >= lines.length) break;

                          const section = lines[i].trim();
                          const unitName = lines[i + 1].trim();
                          const drawNo = lines[i + 3].trim();

                          if (section && unitName && drawNo) {
                            const diagramId = Date.now().toString() + '-' + createdIds.length;
                            const fullName = `${section} - ${unitName} - ${drawNo}`;

                            const newDiagram = {
                              id: diagramId,
                              name: fullName,
                              section,
                              unitName,
                              drawNo,
                              number: section,
                              pdfData: null,
                              partsData: {},
                              hotspots: {},
                              folder: wizardData.folder,
                              customer: wizardData.customer,
                              createdAt: new Date().toISOString()
                            };

                            setSavedDiagrams(prev => ({
                              ...prev,
                              [diagramId]: newDiagram
                            }));

                            createdIds.push(diagramId);

                            // Small delay to prevent overwhelming the browser
                            await new Promise(resolve => setTimeout(resolve, 10));
                          }
                        }

                        setWizardData(prev => ({
                          ...prev,
                          diagramCount: createdIds.length,
                          createdDiagramIds: createdIds
                        }));

                        alert(`✓ Created ${createdIds.length} diagram(s)!`);
                        setWizardStep(3);
                      }}
                      style={{
                        padding: '12px 32px',
                        backgroundColor: '#ff9800',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '16px',
                        flex: 1
                      }}
                    >
                      Create Diagrams & Continue →
                    </button>
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div>
                  <h3 style={{ color: darkMode ? '#fff' : '#333', marginTop: 0 }}>
                    Step 3: Upload Images
                  </h3>
                  <p style={{ color: darkMode ? '#aaa' : '#666', marginBottom: '24px' }}>
                    Select all diagram images from your computer. They'll be automatically matched to diagrams by filename.
                  </p>

                  <div style={{
                    backgroundColor: darkMode ? '#2a4a2a' : '#e8f5e9',
                    padding: '16px',
                    borderRadius: '6px',
                    marginBottom: '24px',
                    border: darkMode ? '1px solid #4caf50' : '1px solid #4caf50'
                  }}>
                    <div style={{ fontSize: '18px', marginBottom: '8px' }}>
                      ✓ Success!
                    </div>
                    <div style={{ color: darkMode ? '#aaa' : '#666', fontSize: '14px' }}>
                      Created {wizardData.diagramCount} diagrams in folder "{wizardData.folder}" for customer "{wizardData.customer}"
                    </div>
                  </div>

                  <div style={{
                    backgroundColor: darkMode ? '#2a2a2a' : '#f5f5f5',
                    padding: '12px',
                    borderRadius: '6px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: darkMode ? '#aaa' : '#666'
                  }}>
                    <strong>💡 Tip:</strong> Name your image files similar to the diagram names for automatic matching.<br />
                    Example: "10-1 MAIN BODY UNIT.jpg" will match the diagram named "10-1 - MAIN BODY UNIT - 4D-44864"
                  </div>

                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length === 0) return;

                      setIsLoadingHeavy(true);
                      setSyncStatus(`Processing ${files.length} images...`);

                      const diagramsInFolder = Object.values(savedDiagrams).filter(d =>
                        d.folder === wizardData.folder &&
                        d.customer === wizardData.customer
                      );

                      let successCount = 0;

                      for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        setSyncStatus(`Processing image ${i + 1}/${files.length}...`);

                        try {
                          // Simple matching: check if diagram name contains filename (without extension)
                          const fileName = file.name.replace(/\.(jpg|jpeg|png)$/i, '');
                          const matchedDiagram = diagramsInFolder.find(d =>
                            normalizeName(d.name).includes(normalizeName(fileName)) ||
                            normalizeName(fileName).includes(normalizeName(d.name))
                          );

                          if (matchedDiagram) {
                            const compressedImageData = await compressImage(file);

                            setSavedDiagrams(prev => ({
                              ...prev,
                              [matchedDiagram.id]: {
                                ...prev[matchedDiagram.id],
                                pdfData: compressedImageData
                              }
                            }));

                            // Auto-save to Firebase
                            try {
                              await saveToFirebase(matchedDiagram.id, {
                                ...matchedDiagram,
                                pdfData: compressedImageData
                              });
                            } catch (err) {
                              console.warn('Firebase save failed:', err);
                            }

                            successCount++;
                          }

                          await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (error) {
                          console.error('Error processing image:', error);
                        }
                      }

                      setIsLoadingHeavy(false);
                      setSyncStatus(null);
                      alert(`✓ Successfully uploaded ${successCount} out of ${files.length} images!`);
                    }}
                    style={{
                      padding: '12px',
                      width: '100%',
                      marginBottom: '24px',
                      border: darkMode ? '2px dashed #555' : '2px dashed #ccc',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      backgroundColor: darkMode ? '#333' : '#fff',
                      color: darkMode ? '#fff' : '#000'
                    }}
                  />

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                      onClick={() => setWizardStep(2)}
                      style={{
                        padding: '12px 24px',
                        backgroundColor: darkMode ? '#444' : '#ddd',
                        color: darkMode ? '#fff' : '#000',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '14px'
                      }}
                    >
                      ← Back
                    </button>
                    <button
                      onClick={() => {
                        setShowQuickStartWizard(false);
                        setSelectedCustomer(wizardData.customer);
                        alert(`🎉 All done! Your diagrams are ready.\n\nYou can now:\n• Click on diagrams to view them\n• Add parts data and hotspots\n• Edit diagram details`);
                      }}
                      style={{
                        padding: '12px 32px',
                        backgroundColor: '#4caf50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '16px',
                        flex: 1
                      }}
                    >
                      ✓ Finish
                    </button>
                  </div>

                  <div style={{
                    marginTop: '24px',
                    padding: '16px',
                    backgroundColor: darkMode ? '#2a2a2a' : '#f5f5f5',
                    borderRadius: '6px',
                    fontSize: '13px',
                    color: darkMode ? '#aaa' : '#666'
                  }}>
                    <strong>Next Steps (Optional):</strong>
                    <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                      <li>Click on a diagram to add parts data from CSV</li>
                      <li>Enable "Edit Mode" to create clickable hotspots</li>
                      <li>Use "Save to Firebase" to backup to cloud</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Customer Manager Modal */}
      {showCustomerManager && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            color: darkMode ? '#fff' : '#333',
            borderRadius: '12px',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '80vh',
            overflow: 'auto',
            padding: '30px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>👥 Customer Manager</h2>
              <button
                onClick={() => setShowCustomerManager(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Close
              </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <button
                onClick={handleAddCustomer}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  width: '100%'
                }}
              >
                ➕ Add New Customer
              </button>
            </div>

            <div style={{ lineHeight: '1.6' }}>
              <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Existing Customers</h3>

              {getCustomers().length === 0 ? (
                <div style={{
                  padding: '20px',
                  textAlign: 'center',
                  color: darkMode ? '#888' : '#999',
                  backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
                  borderRadius: '8px'
                }}>
                  No customers yet. Create a diagram to add customers.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {getCustomers().map(customer => {
                    const diagramCount = Object.values(savedDiagrams).filter(
                      d => d.customer === customer
                    ).length;

                    return (
                      <div key={customer} style={{
                        backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
                        padding: '16px',
                        borderRadius: '8px',
                        border: darkMode ? '1px solid #333' : '1px solid #ddd'
                      }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '8px'
                        }}>
                          <div>
                            <strong style={{ fontSize: '16px' }}>{customer}</strong>
                            <div style={{
                              fontSize: '12px',
                              color: darkMode ? '#aaa' : '#666',
                              marginTop: '4px'
                            }}>
                              {diagramCount} diagram{diagramCount !== 1 ? 's' : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => handleRenameCustomer(customer)}
                              disabled={customer === 'General'}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: customer === 'General' ? '#666' : '#2196f3',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: customer === 'General' ? 'not-allowed' : 'pointer',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                opacity: customer === 'General' ? 0.5 : 1
                              }}
                              title={customer === 'General' ? 'Cannot rename General' : 'Rename customer'}
                            >
                              ✏️ Rename
                            </button>
                            <button
                              onClick={() => handleDeleteCustomer(customer)}
                              disabled={customer === 'General'}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: customer === 'General' ? '#666' : '#f44336',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: customer === 'General' ? 'not-allowed' : 'pointer',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                opacity: customer === 'General' ? 0.5 : 1
                              }}
                              title={customer === 'General' ? 'Cannot delete General' : 'Delete customer'}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{
              marginTop: '20px',
              padding: '16px',
              backgroundColor: darkMode ? '#1a1a2a' : '#e3f2fd',
              borderRadius: '8px',
              fontSize: '13px',
              border: '2px solid #2196f3'
            }}>
              <strong>💡 Tips:</strong>
              <ul style={{ marginTop: '8px', marginBottom: 0, paddingLeft: '20px' }}>
                <li>Customers help organize diagrams by client</li>
                <li>Rename customers to update all diagrams at once</li>
                <li>Deleting a customer moves diagrams to "General"</li>
                <li>The "General" customer cannot be renamed or deleted</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiagramManager;

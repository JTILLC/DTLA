import React, { useState, useEffect } from 'react';
import InteractiveDiagram from './InteractiveDiagram';
import PdfToCsvConverter from './PdfToCsvConverter';
import { partsData, partPositions } from '../partsData';
import {
  saveDiagram as saveToFirebase,
  loadDiagram as loadFromFirebase,
  loadAllDiagrams,
  syncDiagramsToFirebase,
  deleteDiagram as deleteFromFirebase
} from '../firebase/diagramService';

const DiagramManager = () => {
  const [savedDiagrams, setSavedDiagrams] = useState({});
  const [currentDiagramId, setCurrentDiagramId] = useState(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [showPartsReview, setShowPartsReview] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  const [ocrProgress, setOcrProgress] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [showFolderManager, setShowFolderManager] = useState(false);
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

  // Track window resize for responsive layout
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  // Load saved diagrams from localStorage on mount
  useEffect(() => {
    const initializeDiagrams = async () => {
      const saved = localStorage.getItem('savedDiagrams');
      if (saved) {
        const diagrams = JSON.parse(saved);

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

        // Collapse all folders on initial load to reduce render overhead on mobile
        const allFolders = {};
        Object.values(migratedDiagrams).forEach(diagram => {
          const folder = diagram.folder || 'General';
          allFolders[folder] = true; // All collapsed
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
        localStorage.setItem('savedDiagrams', JSON.stringify(initialDiagrams));
      }
    };

    initializeDiagrams();
  }, []);

  // Save diagrams to localStorage whenever they change (unless sync is disabled)
  useEffect(() => {
    if (!skipLocalStorageSync && Object.keys(savedDiagrams).length > 0) {
      localStorage.setItem('savedDiagrams', JSON.stringify(savedDiagrams));
    }
  }, [savedDiagrams, skipLocalStorageSync]);

  // Load PDF on-demand when diagram is selected (for Firebase-loaded diagrams without PDF data)
  useEffect(() => {
    const loadPdfForDiagram = async () => {
      if (!currentDiagramId) return;

      const diagram = savedDiagrams[currentDiagramId];
      if (!diagram) return;

      // If diagram doesn't have PDF data, try to load it from Firebase
      if (!diagram.pdfData) {
        console.log('PDF data missing for diagram:', currentDiagramId, 'Attempting to load from Firebase...');
        setSyncStatus('Loading PDF...');
        try {
          const fullDiagram = await loadFromFirebase(currentDiagramId);
          console.log('Loaded diagram from Firebase:', fullDiagram);
          if (fullDiagram && fullDiagram.pdfData) {
            console.log('PDF data found, updating diagram...');
            // Update the diagram with PDF data
            setSavedDiagrams(prev => ({
              ...prev,
              [currentDiagramId]: {
                ...prev[currentDiagramId],
                pdfData: fullDiagram.pdfData
              }
            }));
            setSyncStatus(null);
          } else {
            console.error('No PDF data in loaded diagram');
            setSyncStatus('⚠️ PDF not available');
            setTimeout(() => setSyncStatus(null), 3000);
          }
        } catch (error) {
          console.error('Failed to load PDF from Firebase:', error);
          setSyncStatus('⚠️ Failed to load PDF');
          setTimeout(() => setSyncStatus(null), 3000);
        }
      }
    };

    loadPdfForDiagram();
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

      // Use imported CSV data if available, otherwise parse from file
      if (importedCsvData) {
        partsData = importedCsvData;
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

  const confirmPartsData = () => {
    const { diagramName, diagramNumber, pdfData, partsData, folder, customer, isEditing, diagramId } = reviewData;

    if (isEditing) {
      // Update existing diagram
      setSavedDiagrams(prev => ({
        ...prev,
        [diagramId]: {
          ...prev[diagramId],
          pdfData: pdfData,
          partsData: partsData
        }
      }));

      setEditingDiagram(null);
      setShowPartsReview(false);
      setReviewData(null);

      alert('Diagram updated successfully!');
    } else {
      // Create new diagram
      const newDiagramId = Date.now().toString();
      const newDiagram = {
        id: newDiagramId,
        name: diagramName,
        number: diagramNumber || '',
        pdfData: pdfData,
        partsData: partsData,
        hotspots: {},
        folder: folder || 'General',
        customer: customer || 'General',
        createdAt: new Date().toISOString()
      };

      setSavedDiagrams(prev => ({
        ...prev,
        [newDiagramId]: newDiagram
      }));

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
      const reader = new FileReader();
      reader.onload = async (event) => {
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
      };
      reader.readAsDataURL(pdfFile);
    } else if (partsFile?.size) {
      // Only parts list provided
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
    }
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  };

  const extractTextFromPDF = async (file) => {
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
          const pdf = await getDocument(typedArray).promise;

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
      reader.onerror = () => reject(new Error('Failed to read PDF file'));
      reader.readAsArrayBuffer(file);
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
            const pdf = await getDocument(typedArray).promise;

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

    // Check if there are existing diagrams
    const existingDiagrams = Object.keys(savedDiagrams);

    if (existingDiagrams.length === 0) {
      // No existing diagrams, create new
      setImportedCsvData(partsData);
      setCurrentView('viewer');
      setShowUploadForm(true);
    } else {
      // Show diagram selector modal
      setPendingCsvData(partsData);
      setShowDiagramSelector(true);
      setCurrentView('viewer');
    }
  };

  const handleSelectDiagramForImport = (diagramId) => {
    if (!pendingCsvData) return;

    // Update the existing diagram's parts data
    setSavedDiagrams(prev => ({
      ...prev,
      [diagramId]: {
        ...prev[diagramId],
        partsData: {
          ...prev[diagramId].partsData,
          ...pendingCsvData // Merge new parts with existing
        }
      }
    }));

    setCurrentDiagramId(diagramId);
    setShowDiagramSelector(false);
    setPendingCsvData(null);
    alert(`Successfully added ${Object.keys(pendingCsvData).length} parts to "${savedDiagrams[diagramId].name}"!`);
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
      const diagram = savedDiagrams[diagramId];
      await saveToFirebase(diagramId, {
        ...diagram,
        createdAt: diagram.createdAt || Date.now()
      });
      setSyncStatus('✓ Saved to Firebase');
      setTimeout(() => setSyncStatus(null), 3000);
      alert('Diagram saved to Firebase successfully!');
    } catch (error) {
      setSyncStatus('✗ Save failed');
      console.error('Firebase save error:', error);
      alert('Failed to save to Firebase. Please check your Firebase configuration.\n\nError: ' + error.message);
    }
  };

  const handleLoadFromFirebase = async () => {
    try {
      setIsLoadingHeavy(true); // Show loading overlay
      setSkipLocalStorageSync(true); // Disable localStorage during load to prevent mobile crash
      setSyncStatus('Loading...');
      const diagrams = await loadAllDiagrams();

      if (diagrams.length === 0) {
        alert('No diagrams found in Firebase.');
        setSyncStatus(null);
        setIsLoadingHeavy(false);
        setSkipLocalStorageSync(false);
        return;
      }

      setSyncStatus(`Processing ${diagrams.length} diagrams...`);

      // Strip out PDF data to reduce memory usage (PDFs can be huge)
      // We'll load PDFs on-demand when user selects a diagram
      const diagramsObj = {};
      diagrams.forEach(diagram => {
        diagramsObj[diagram.id] = {
          ...diagram,
          pdfData: null // Remove PDF data for now - too heavy for mobile
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
          // Load all diagrams at once (without PDF data, they're lightweight)
          setSavedDiagrams(prev => ({
            ...prev,
            ...diagramsObj
          }));

          setSyncStatus(`✓ Loaded ${diagrams.length} diagrams (PDFs excluded)`);

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
      await syncDiagramsToFirebase(savedDiagrams);
      setSyncStatus(`✓ Synced ${Object.keys(savedDiagrams).length} diagrams`);
      setTimeout(() => setSyncStatus(null), 3000);
      alert(`Successfully synced ${Object.keys(savedDiagrams).length} diagram(s) to Firebase!`);
    } catch (error) {
      setSyncStatus('✗ Sync failed');
      console.error('Firebase sync error:', error);
      alert('Failed to sync to Firebase. Please check your Firebase configuration.\n\nError: ' + error.message);
    }
  };

  const handleSaveFolderToFirebase = async (folderName, diagrams) => {
    if (diagrams.length === 0) {
      alert('No diagrams in this folder to save.');
      return;
    }

    try {
      setSyncStatus(`Saving ${folderName}...`);

      // Convert diagrams array to object format for syncDiagramsToFirebase
      const diagramsToSync = {};
      diagrams.forEach(diagram => {
        diagramsToSync[diagram.id] = diagram;
      });

      await syncDiagramsToFirebase(diagramsToSync);
      setSyncStatus(`✓ Saved ${diagrams.length} diagrams from ${folderName}`);
      setTimeout(() => setSyncStatus(null), 3000);
      alert(`Successfully saved ${diagrams.length} diagram(s) from "${folderName}" to Firebase!`);
    } catch (error) {
      setSyncStatus('✗ Save failed');
      console.error('Firebase save error:', error);
      alert('Failed to save folder to Firebase.\n\nError: ' + error.message);
      setTimeout(() => setSyncStatus(null), 3000);
    }
  };

  const handleLoadFolderFromFirebase = async (folderName) => {
    try {
      setSyncStatus(`Loading ${folderName}...`);
      const allDiagrams = await loadAllDiagrams();

      // Filter diagrams by folder
      const folderDiagrams = allDiagrams.filter(diagram =>
        (diagram.folder || 'General') === folderName
      );

      if (folderDiagrams.length === 0) {
        alert(`No diagrams found in folder "${folderName}" on Firebase.`);
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
      setTimeout(() => {
        setCollapsedFolders(prev => ({
          ...prev,
          [folderName]: true
        }));

        // Load diagrams after folder is collapsed
        setTimeout(() => {
          // Merge with existing local diagrams
          setSavedDiagrams(prev => ({
            ...prev,
            ...diagramsObj
          }));

          setSyncStatus(`✓ Loaded ${folderDiagrams.length} from ${folderName}`);
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

  const deleteDiagram = (diagramId) => {
    if (!window.confirm('Are you sure you want to delete this diagram?')) {
      return;
    }

    setSavedDiagrams(prev => {
      const newDiagrams = { ...prev };
      delete newDiagrams[diagramId];
      return newDiagrams;
    });

    if (currentDiagramId === diagramId) {
      const remaining = Object.keys(savedDiagrams).filter(id => id !== diagramId);
      setCurrentDiagramId(remaining.length > 0 ? remaining[0] : null);
    }
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

    // Delete from Firebase if enabled
    if (firebaseEnabled) {
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
        alert('Error deleting from Firebase. Check console for details.');
        return;
      }
    } else {
      console.warn('Firebase not enabled - only deleting from local state');
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
          folder: diagram.folder || 'General'
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

    if (!tocSelectedFolder) {
      alert('Please select a folder first');
      return;
    }

    // Get all diagrams for the selected customer and folder, sorted by creation time
    const diagramIds = Object.keys(savedDiagrams)
      .filter(id => {
        const diagram = savedDiagrams[id];
        const customerMatch = selectedCustomer === 'All Customers' || diagram.customer === selectedCustomer;
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

  const currentDiagram = currentDiagramId ? savedDiagrams[currentDiagramId] : null;

  return (
    <div style={{
      padding: isMobile ? '4px' : '20px',
      backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
      minHeight: '100vh',
      transition: 'background-color 0.3s ease'
    }}>
      <div style={{ maxWidth: '100%', margin: '0 auto', padding: isMobile ? '0 4px' : '0 20px' }}>
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
            Interactive Parts Diagram Viewer
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
          padding: isMobile ? '12px' : '16px',
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
              fontSize: isMobile ? '13px' : '14px'
            }}>Saved Diagrams</strong>

            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              style={{
                padding: '8px 12px',
                backgroundColor: darkMode ? '#333' : '#fff',
                color: darkMode ? '#fff' : '#000',
                border: darkMode ? '1px solid #555' : '1px solid #ccc',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              <option value="All Customers">All Customers</option>
              {getCustomers().map(customer => (
                <option key={customer} value={customer}>{customer}</option>
              ))}
            </select>

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
              title="Quick rename diagrams using table of contents"
            >
              {showTocRenamer ? 'Cancel TOC' : '📋 TOC Quick Rename'}
            </button>

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
                marginLeft: isMobile ? '0' : 'auto'
              }}
            >
              {showUploadForm ? 'Cancel' : '+ New Diagram'}
            </button>

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

          {/* Folders */}
          {Object.keys(savedDiagrams).length > 0 ? (
            Object.entries(getDiagramsByFolder(selectedCustomer)).map(([folderName, diagrams]) => (
              <div key={folderName} style={{
                marginBottom: '12px',
                border: darkMode ? '1px solid #444' : '1px solid #e0e0e0',
                borderRadius: '6px',
                overflow: 'hidden'
              }}>
                {/* Folder Header */}
                <div style={{
                  backgroundColor: darkMode ? '#333' : '#f5f5f5',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  borderBottom: collapsedFolders[folderName] ? 'none' : (darkMode ? '1px solid #444' : '1px solid #e0e0e0'),
                  flexWrap: isMobile ? 'wrap' : 'nowrap',
                  overflowX: isMobile ? 'hidden' : 'visible'
                }}
                  onClick={() => setCollapsedFolders(prev => ({
                    ...prev,
                    [folderName]: !prev[folderName]
                  }))}
                >
                  <span style={{
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: darkMode ? '#fff' : '#666',
                    width: isMobile ? '100%' : 'auto',
                    marginBottom: isMobile ? '4px' : '0'
                  }}>
                    {collapsedFolders[folderName] ? '▶' : '▼'} {folderName} ({diagrams.length})
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
                      marginLeft: isMobile ? '0' : 'auto',
                      flexShrink: 0
                    }}
                    title={`Arrange diagrams in "${folderName}" numerically`}
                  >
                    ⇅
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveFolderToFirebase(folderName, diagrams);
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
                    title={`Save all diagrams in "${folderName}" to Firebase`}
                  >
                    ☁️↑
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLoadFolderFromFirebase(folderName);
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
                    title={`Load diagrams from "${folderName}" on Firebase`}
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
                {!collapsedFolders[folderName] && (
                  <div style={{
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    backgroundColor: darkMode ? '#222' : 'transparent'
                  }}>
                    {diagrams.map(diagram => (
                      <div key={diagram.id} style={{
                        display: 'flex',
                        gap: '4px',
                        alignItems: 'center',
                        overflowX: isMobile ? 'auto' : 'visible',
                        overflowY: 'hidden',
                        padding: isMobile ? '4px' : '0'
                      }}>
                        <button
                          onClick={() => setCurrentDiagramId(diagram.id)}
                          style={{
                            padding: isMobile ? '6px 12px' : '8px 16px',
                            backgroundColor: currentDiagramId === diagram.id ? '#2196f3' : (darkMode ? '#444' : '#e0e0e0'),
                            color: currentDiagramId === diagram.id ? 'white' : (darkMode ? '#fff' : '#333'),
                            border: darkMode ? '1px solid #555' : 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: currentDiagramId === diagram.id ? 'bold' : 'normal',
                            fontSize: isMobile ? '12px' : '13px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            minWidth: isMobile ? '180px' : '200px',
                            maxWidth: isMobile ? '180px' : '200px',
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
            ))
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
            }}>📋 TOC Quick Rename</h2>
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
              1. Select the folder containing the diagrams you want to rename<br/>
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
                    // Only show folders that match the selected customer
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
                  PDF Diagram: {editingDiagram.pdfData ? '(Current: Yes)' : '(Current: None)'}
                  <input
                    type="file"
                    name="pdfFile"
                    accept=".pdf"
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
                  Diagram PDF File (optional - can add later):
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 'normal',
                    color: darkMode ? '#888' : '#666',
                    marginBottom: '4px'
                  }}>
                    Upload the PDF diagram/schematic that you want to add hotspots to
                  </div>
                  <input
                    type="file"
                    name="pdfFile"
                    accept=".pdf"
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
                marginBottom: '20px'
              }}>
                <p style={{
                  color: darkMode ? '#aaa' : '#666',
                  margin: 0
                }}>
                  {firebaseDiagrams.length} diagram(s) stored in Firebase
                </p>
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
          <div>
            {/* Navigation Controls */}
            {(() => {
              const diagramIds = Object.keys(savedDiagrams);
              const currentIndex = diagramIds.indexOf(currentDiagramId);
              const hasPrevious = currentIndex > 0;
              const hasNext = currentIndex < diagramIds.length - 1;

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

            <InteractiveDiagram
              diagram={currentDiagram}
              onHotspotsUpdate={(hotspots) => updateDiagramHotspots(currentDiagram.id, hotspots)}
              onPartsDataUpdate={(partsData) => updateDiagramPartsData(currentDiagram.id, partsData)}
              globalOrderList={globalOrderList}
              setGlobalOrderList={setGlobalOrderList}
              allDiagrams={savedDiagrams}
              darkMode={darkMode}
            />
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
    </div>
  );
};

export default DiagramManager;

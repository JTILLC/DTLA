import React, { useState, useEffect, useMemo } from 'react';
import InteractiveDiagramViewer from './InteractiveDiagramViewer';
import ShareModal from './ShareModal';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveImage, getImage, saveImagesBatch, clearAllImages, saveDiagrams, loadDiagrams } from '../utils/imageStorage';
import { getCustomerNames, loadDiagramsByCustomer, loadDiagramImagesForExport } from '../firebase/diagramService';
import { db } from '../firebase/config';

const readLS = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
};
const readLSJSON = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};

const CustomerViewer = ({ onLogout }) => {
  const [diagrams, setDiagrams] = useState({});
  const [initializing, setInitializing] = useState(true); // True until the first IndexedDB load resolves
  const [currentDiagramId, setCurrentDiagramId] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [selectedFolder, setSelectedFolder] = useState(() => readLS('selectedFolder', 'All Folders'));
  const [globalOrderList, setGlobalOrderList] = useState(() => readLSJSON('orderList', {}));
  const [darkMode, setDarkMode] = useState(() => readLS('darkMode', 'true') === 'true');
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [diagramSelectorOpen, setDiagramSelectorOpen] = useState(false);
  const [showPartsListSource, setShowPartsListSource] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState(null);
  const [showCustomerSelector, setShowCustomerSelector] = useState(false);
  const [availableCustomers, setAvailableCustomers] = useState([]);
  const [selectedCustomerToLoad, setSelectedCustomerToLoad] = useState('');
  const [searchQuery, setSearchQuery] = useState(''); // Parts search query
  const [searchResults, setSearchResults] = useState([]); // Parts search results
  const [showSearchResults, setShowSearchResults] = useState(false); // Show search results panel
  const [orderCustomerName, setOrderCustomerName] = useState(() => readLS('orderCustomerName', ''));
  const [orderCompanyName, setOrderCompanyName] = useState(() => readLS('orderCompanyName', ''));
  const [orderAttn, setOrderAttn] = useState(() => readLS('orderAttn', ''));
  const [orderStreet, setOrderStreet] = useState(() => readLS('orderStreet', ''));
  const [orderCityStateZip, setOrderCityStateZip] = useState(() => readLS('orderCityStateZip', ''));
  const [orderModel, setOrderModel] = useState(() => readLS('orderModel', ''));
  const [orderSerial, setOrderSerial] = useState(() => readLS('orderSerial', ''));
  const [orderJob, setOrderJob] = useState(() => readLS('orderJob', ''));
  const [showOrderInfo, setShowOrderInfo] = useState(false); // Show order info input form
  const [showShareModal, setShowShareModal] = useState(false); // Show share modal

  // Ref for scrolling to diagram
  const diagramViewerRef = React.useRef(null);

  // Load diagrams from IndexedDB on mount
  useEffect(() => {
    const initializeDiagrams = async () => {
      try {
        // Load from IndexedDB
        const { diagrams: loadedDiagrams, customerName: loadedName } = await loadDiagrams();

        // Fallback to localStorage if IndexedDB is empty (migration)
        if (Object.keys(loadedDiagrams).length === 0) {
          const saved = localStorage.getItem('customerDiagrams');
          if (saved) {
            try {
              const data = JSON.parse(saved);
              console.log('[Migration] Moving diagrams from localStorage to IndexedDB');
              setDiagrams(data.diagrams || {});
              setCustomerName(data.customerName || '');
              // Save to IndexedDB and clear localStorage
              await saveDiagrams(data.diagrams || {}, data.customerName || '');
              localStorage.removeItem('customerDiagrams');
            } catch (error) {
              console.error('Failed to migrate from localStorage:', error);
            }
          }
        } else {
          setDiagrams(loadedDiagrams);
          setCustomerName(loadedName);
        }
      } catch (error) {
        console.error('Failed to load diagrams:', error);
      } finally {
        setInitializing(false);
      }

    };

    initializeDiagrams();
  }, []);

  // Save diagrams to IndexedDB whenever they change
  useEffect(() => {
    if (Object.keys(diagrams).length > 0) {
      saveDiagrams(diagrams, customerName).catch(error => {
        console.error('[Storage] Error saving diagrams:', error);
      });
    }
  }, [diagrams, customerName]);

  // Save order list
  useEffect(() => {
    localStorage.setItem('orderList', JSON.stringify(globalOrderList));
  }, [globalOrderList]);

  // Save dark mode
  useEffect(() => {
    localStorage.setItem('darkMode', darkMode.toString());
  }, [darkMode]);

  // Save selected folder
  useEffect(() => {
    localStorage.setItem('selectedFolder', selectedFolder);
  }, [selectedFolder]);

  // Save customer name
  useEffect(() => {
    localStorage.setItem('orderCustomerName', orderCustomerName);
  }, [orderCustomerName]);

  // Save order company name
  useEffect(() => {
    localStorage.setItem('orderCompanyName', orderCompanyName);
  }, [orderCompanyName]);

  // Save order address fields
  useEffect(() => {
    localStorage.setItem('orderAttn', orderAttn);
  }, [orderAttn]);

  useEffect(() => {
    localStorage.setItem('orderStreet', orderStreet);
  }, [orderStreet]);

  useEffect(() => {
    localStorage.setItem('orderCityStateZip', orderCityStateZip);
  }, [orderCityStateZip]);

  useEffect(() => {
    localStorage.setItem('orderModel', orderModel);
  }, [orderModel]);

  useEffect(() => {
    localStorage.setItem('orderSerial', orderSerial);
  }, [orderSerial]);

  useEffect(() => {
    localStorage.setItem('orderJob', orderJob);
  }, [orderJob]);

  // Track window resize for mobile responsiveness
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-load from URL parameters
  useEffect(() => {
    const autoLoadFromURL = async () => {
      try {
        // Parse URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const customerParam = urlParams.get('customer');
        const keyParam = urlParams.get('key');

        // Check if both parameters are present
        if (!customerParam || !keyParam) {
          return; // No URL parameters, skip auto-load
        }

        // Validate password
        if (keyParam !== 'JTI2022') {
          alert('Invalid access key in URL. Please contact support for the correct link.');
          return;
        }

        // Check if we already have diagrams loaded for this customer
        if (Object.keys(diagrams).length > 0 && customerName === customerParam) {
          console.log(`[Auto-Load] Already have diagrams for ${customerParam}, skipping`);
          return;
        }

        console.log(`[Auto-Load] Loading diagrams for ${customerParam} from URL parameters...`);
        setDownloadStatus(`Loading diagrams for ${customerParam}...`);

        // Load customer names to verify customer exists
        const availableCustomers = await getCustomerNames();

        // Find matching customer (case-insensitive)
        const matchedCustomer = availableCustomers.find(
          customer => customer.toLowerCase() === customerParam.toLowerCase()
        );

        if (!matchedCustomer) {
          setDownloadStatus(null);
          alert(
            `Customer "${customerParam}" not found.\n\n` +
            `Available customers:\n${availableCustomers.join('\n')}\n\n` +
            `Please contact support for the correct link.`
          );
          return;
        }

        // Load diagrams for this customer
        setDownloadStatus(`Loading diagrams for "${matchedCustomer}" from cloud...`);
        const customerDiagrams = await loadDiagramsByCustomer(matchedCustomer);

        if (customerDiagrams.length === 0) {
          setDownloadStatus(null);
          alert(`No diagrams found for customer "${matchedCustomer}".`);
          return;
        }

        // Load all images from Firebase Storage
        setDownloadStatus(`Loading images... 0/${customerDiagrams.length}`);
        const diagramsWithImages = await loadDiagramImagesForExport(
          customerDiagrams,
          (current, total) => {
            setDownloadStatus(`Loading images... ${current}/${total}`);
          }
        );

        setDownloadStatus('Saving to local storage...');

        // Convert array to object with IDs as keys and merge with existing diagrams
        const newDiagrams = {};
        diagramsWithImages.forEach(diagram => {
          newDiagrams[diagram.id] = diagram;
        });

        // Merge with existing diagrams instead of replacing
        const mergedDiagrams = { ...diagrams, ...newDiagrams };

        // Save to state and IndexedDB
        setDiagrams(mergedDiagrams);

        // Update customer name to show multiple if needed
        const totalCustomers = new Set(Object.values(mergedDiagrams).map(d => d.customer || 'General'));
        const displayName = totalCustomers.size > 1
          ? `Multiple Customers (${totalCustomers.size})`
          : matchedCustomer;
        setCustomerName(displayName);

        await saveDiagrams(mergedDiagrams, displayName);

        setDownloadStatus(`✓ Loaded ${diagramsWithImages.length} diagram(s) for ${matchedCustomer}`);
        setTimeout(() => setDownloadStatus(null), 3000);

        console.log(`[Auto-Load] Successfully loaded ${diagramsWithImages.length} diagrams for ${matchedCustomer}. Total diagrams: ${Object.keys(mergedDiagrams).length}`);
      } catch (error) {
        console.error('[Auto-Load] Error:', error);
        setDownloadStatus('✗ Auto-load failed: ' + error.message);
        setTimeout(() => setDownloadStatus(null), 5000);
        alert('Failed to auto-load diagrams from URL.\n\nError: ' + error.message);
      }
    };

    autoLoadFromURL();
  }, []); // Run once on mount

  const handleImportJSON = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    console.log('[Import] Selected file:', file.name, 'Size:', file.size, 'bytes');

    try {
      // Try using the modern File API text() method instead of FileReader
      // This is more reliable for large files
      console.log('[Import] Reading file using File.text() API...');
      const fileText = await file.text();

      console.log('[Import] File read successfully, parsing JSON...');
      const importData = JSON.parse(fileText);
      console.log('[Import] JSON parsed:', {
        customer: importData.customer,
        diagramCount: importData.diagramCount,
        hasCustomer: !!importData.customer,
        hasDiagrams: !!importData.diagrams,
        isArray: Array.isArray(importData.diagrams)
      });

      if (!importData.customer || !importData.diagrams || !Array.isArray(importData.diagrams)) {
        console.error('[Import] Invalid format:', importData);
        alert('Invalid import file format.\n\nRequired fields:\n- customer (string)\n- diagrams (array)');
        e.target.value = '';
        return;
      }

      // Continue with import process
      try {
        await processImport(importData, e);
      } catch (error) {
        console.error('[Import] Process error:', error);
        alert(`Failed to import diagrams.\n\nError: ${error.message}`);
        e.target.value = '';
      }
    } catch (error) {
      console.error('[Import] File read error:', error);
      alert(
        `Failed to read file.\n\n` +
        `File: ${file.name}\n` +
        `Size: ${(file.size / 1024 / 1024).toFixed(2)} MB\n` +
        `Error: ${error.message || error.name || 'Unknown error'}\n\n` +
        `Try:\n` +
        `1. Close the file if it's open in another program\n` +
        `2. Copy the file to your desktop and try again\n` +
        `3. Make sure the file isn't corrupted`
      );
      e.target.value = '';
    }
  };

  // Separate function to process the import after reading file
  const processImport = async (importData, e) => {
    // Get existing customers and folders
    const existingCustomers = Array.from(new Set(
      Object.values(diagrams).map(d => d.customer || 'General')
    )).sort();

    // Prompt for customer (allow creating new or selecting existing)
    let targetCustomer = prompt(
      `Import ${importData.diagramCount} diagram(s) into which customer?\n\n` +
      `Current customers: ${existingCustomers.join(', ')}\n\n` +
      `Enter customer name (or create new):`,
      importData.customer
    );

    if (!targetCustomer || !targetCustomer.trim()) {
      alert('Import cancelled - no customer specified.');
      e.target.value = '';
      return;
    }
    targetCustomer = targetCustomer.trim();

    // Get existing folders for this customer
    const existingFolders = Array.from(new Set(
      Object.values(diagrams)
        .filter(d => (d.customer || 'General') === targetCustomer)
        .map(d => d.folder || 'General')
    )).sort();

    // Prompt for folder (allow creating new or selecting existing)
    let targetFolder = prompt(
      `Import into which folder (machine type) under "${targetCustomer}"?\n\n` +
      (existingFolders.length > 0
        ? `Existing folders: ${existingFolders.join(', ')}\n\n`
        : 'No existing folders for this customer.\n\n') +
      `Enter folder name (or create new):`,
      importData.diagrams[0]?.folder || 'General'
    );

    if (!targetFolder || !targetFolder.trim()) {
      alert('Import cancelled - no folder specified.');
      e.target.value = '';
      return;
    }
    targetFolder = targetFolder.trim();

    const confirm = window.confirm(
      `Import ${importData.diagramCount} diagram(s)?\n\n` +
      `Customer: ${targetCustomer}\n` +
      `Folder: ${targetFolder}\n\n` +
      `Existing diagrams will be preserved.`
    );

    if (!confirm) {
      e.target.value = '';
      return;
    }

    // Show loading message
    const loadingMsg = document.createElement('div');
    loadingMsg.id = 'import-loading';
    loadingMsg.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#333;color:white;padding:20px;border-radius:8px;z-index:10000;text-align:center;';
    loadingMsg.innerHTML = '<div>Importing diagrams...</div><div id="import-progress" style="margin-top:10px;font-size:14px;">0%</div>';
    document.body.appendChild(loadingMsg);

    try {
      // Prepare images for IndexedDB
      const imagesToSave = [];
      const newDiagramsObj = {};

      importData.diagrams.forEach((diagram, index) => {
        const id = diagram.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Debug: Check if first diagram has hotspots
        if (index === 0) {
          console.log('[Import] First diagram structure:', {
            hasHotspots: !!diagram.hotspots,
            hotspotCount: diagram.hotspots ? Object.keys(diagram.hotspots).length : 0,
            hasPartsData: !!diagram.partsData,
            partsDataCount: diagram.partsData ? Object.keys(diagram.partsData).length : 0,
            keys: Object.keys(diagram)
          });
        }

        // Extract pdfData (image) and store separately
        const { pdfData, ...diagramMetadata } = diagram;

        if (pdfData) {
          imagesToSave.push({ id, imageData: pdfData });
        }

        // Store only metadata with updated customer and folder
        newDiagramsObj[id] = {
          ...diagramMetadata,
          id,
          customer: targetCustomer,
          folder: targetFolder,
          hasImage: !!pdfData
        };

        // Debug: Verify hotspots are preserved
        if (index === 0) {
          console.log('[Import] First diagram after processing:', {
            hasHotspots: !!newDiagramsObj[id].hotspots,
            hotspotCount: newDiagramsObj[id].hotspots ? Object.keys(newDiagramsObj[id].hotspots).length : 0
          });
        }
      });

      // Save NEW images to IndexedDB (don't clear existing ones)
      await saveImagesBatch(imagesToSave, (current, total) => {
        const progressEl = document.getElementById('import-progress');
        if (progressEl) {
          const percent = Math.round((current / total) * 100);
          progressEl.textContent = `${percent}% (${current}/${total} images)`;
        }
      });

      // MERGE with existing diagrams instead of replacing
      setDiagrams(prev => ({
        ...prev,
        ...newDiagramsObj
      }));

      // Update customer name if this is the first import
      if (Object.keys(diagrams).length === 0) {
        setCustomerName(targetCustomer);
      }

      // Select first imported diagram
      const firstId = Object.keys(newDiagramsObj)[0];
      if (firstId) {
        setCurrentDiagramId(firstId);
      }

      // Remove loading message
      document.body.removeChild(loadingMsg);

      alert(
        `Successfully imported ${importData.diagrams.length} diagram(s).\n\n` +
        `Customer: ${targetCustomer}\n` +
        `Folder: ${targetFolder}\n\n` +
        `Images stored in browser IndexedDB.`
      );
    } catch (error) {
      console.error('Import error:', error);
      const loadingEl = document.getElementById('import-loading');
      if (loadingEl) document.body.removeChild(loadingEl);
      throw error; // Re-throw to be caught by handleImportJSON
    } finally {
      e.target.value = '';
    }
  };

  const handleExportJSON = async () => {
    if (Object.keys(diagrams).length === 0) {
      alert('No diagrams to export.');
      return;
    }

    // Show loading message
    const loadingMsg = document.createElement('div');
    loadingMsg.id = 'export-loading';
    loadingMsg.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#333;color:white;padding:20px;border-radius:8px;z-index:10000;text-align:center;';
    loadingMsg.innerHTML = '<div>Preparing export...</div><div id="export-progress" style="margin-top:10px;font-size:14px;">0%</div>';
    document.body.appendChild(loadingMsg);

    try {
      // Load images from IndexedDB and attach to diagrams
      const diagramsArray = Object.values(diagrams);
      const diagramsWithImages = [];

      for (let i = 0; i < diagramsArray.length; i++) {
        const diagram = diagramsArray[i];
        const progressEl = document.getElementById('export-progress');
        if (progressEl) {
          const percent = Math.round(((i + 1) / diagramsArray.length) * 100);
          progressEl.textContent = `${percent}% (${i + 1}/${diagramsArray.length} diagrams)`;
        }

        // Load image from IndexedDB if it exists
        let pdfData = null;
        if (diagram.hasImage) {
          pdfData = await getImage(diagram.id);
        }

        diagramsWithImages.push({
          ...diagram,
          pdfData: pdfData || undefined // Include image data for export
        });
      }

      const exportData = {
        customer: customerName,
        exportDate: new Date().toISOString(),
        diagramCount: diagramsWithImages.length,
        diagrams: diagramsWithImages
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${customerName.replace(/[^a-zA-Z0-9]/g, '_')}_backup_${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);

      // Remove loading message
      document.body.removeChild(loadingMsg);
    } catch (error) {
      console.error('Export error:', error);
      const loadingEl = document.getElementById('export-loading');
      if (loadingEl) document.body.removeChild(loadingEl);
      alert('Failed to export diagrams.\n\nError: ' + error.message);
    }
  };


// Save an order to Firestore as well as downloading it.
//
// The download stays — people mail these files and file them — but a file in
// somebody's Downloads folder is not a record: "what did we order for Flagstone
// in April?" was answerable on exactly one laptop, and only if the file had
// been filed into the right folder afterwards. Stored here, the dashboard can
// show it against the plant.
//
// Best effort on purpose. This runs behind a share link as well as a login, and
// an anonymous viewer cannot write. Failing to store an order must never cost
// somebody the export they actually asked for, so it is logged and dropped.
const storeOrder = async (order) => {
  try {
    const { collection, addDoc } = await import('firebase/firestore');
    await addDoc(collection(db, 'parts-orders'), {
      ...order,
      source: 'parts-viewer',
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Order exported but not saved to Firebase:', error);
  }
};

  // Export order list to JSON
  const handleExportOrder = () => {
    const orderItems = Object.entries(globalOrderList).filter(([_, item]) => item.orderQty > 0);

    if (orderItems.length === 0) {
      alert('No parts in order list to export.');
      return;
    }

    const exportData = {
      customer: customerName,
      exportDate: new Date().toISOString(),
      orderCount: orderItems.length,
      totalQuantity: orderItems.reduce((sum, [_, item]) => sum + item.orderQty, 0),
      orderItems: orderItems.map(([orderKey, item]) => ({
        orderKey,
        ...item
      }))
    };

    // The customer name here is whatever the viewer is showing — often
    // "Multiple Customers (6)". Stored as-is rather than guessed at: the
    // dashboard files an order against a plant when somebody uploads it, and a
    // wrong name in the record would be worse than an honest vague one.
    storeOrder({
      customer: customerName || '',
      orderedAt: exportData.exportDate,
      itemCount: exportData.orderCount,
      totalQuantity: exportData.totalQuantity,
      diagrams: [...new Set(exportData.orderItems.map((i) => i.diagramName).filter(Boolean))],
      items: exportData.orderItems,
    });

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${customerName.replace(/[^a-zA-Z0-9]/g, '_')}_order_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Import order list from JSON
  const handleImportOrder = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const fileText = await file.text();
      const importData = JSON.parse(fileText);

      if (!importData.orderItems || !Array.isArray(importData.orderItems)) {
        alert('Invalid order file format.\n\nRequired field: orderItems (array)');
        e.target.value = '';
        return;
      }

      const confirmMsg = `Import ${importData.orderCount || importData.orderItems.length} order item(s)?\n\n` +
        `Customer: ${importData.customer || 'Unknown'}\n` +
        `Total Quantity: ${importData.totalQuantity || 'N/A'}\n\n` +
        `This will ADD to your current order list.`;

      if (!window.confirm(confirmMsg)) {
        e.target.value = '';
        return;
      }

      // Merge imported orders with existing
      const newOrderList = { ...globalOrderList };
      importData.orderItems.forEach(item => {
        const orderKey = item.orderKey || `imported-${item.partNumber}-${Date.now()}`;
        if (newOrderList[orderKey]) {
          // Add to existing quantity
          newOrderList[orderKey].orderQty += item.orderQty || 1;
        } else {
          // Add new item
          newOrderList[orderKey] = {
            partNumber: item.partNumber,
            partCode: item.partCode || '',
            partName: item.partName || `Part ${item.partNumber}`,
            qty: item.qty || '1',
            orderQty: item.orderQty || 1,
            diagramId: item.diagramId || '',
            diagramName: item.diagramName || 'Imported',
            diagramNumber: item.diagramNumber || ''
          };
        }
      });

      setGlobalOrderList(newOrderList);
      alert(`Successfully imported ${importData.orderItems.length} order item(s).`);
    } catch (error) {
      console.error('Order import error:', error);
      alert('Failed to import order.\n\nError: ' + error.message);
    }

    e.target.value = '';
  };

  const handlePreviewPDF = () => {
    const orderItems = Object.entries(globalOrderList).filter(([_, item]) => item.orderQty > 0);

    if (orderItems.length === 0) {
      alert('No parts in order list. Click parts on diagrams to add them.');
      return;
    }

    const totalItems = orderItems.length;
    const totalQuantity = orderItems.reduce((sum, [_, item]) => sum + item.orderQty, 0);

    // Generate real PDF with jsPDF (no browser print headers)
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    let cursorY = margin;

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(33, 33, 33);
    const headingText = orderCustomerName ? `Parts Order — ${orderCustomerName}` : 'Parts Order';
    doc.text(headingText, margin, cursorY);
    cursorY += 6;
    doc.setDrawColor(33, 150, 243);
    doc.setLineWidth(2);
    doc.line(margin, cursorY, pageWidth - margin, cursorY);
    cursorY += 18;

    // Meta block
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(60, 60, 60);

    const writeLine = (label, value) => {
      if (!value) return;
      doc.setFont('helvetica', 'bold');
      const labelText = `${label}: `;
      doc.text(labelText, margin, cursorY);
      const labelWidth = doc.getTextWidth(labelText);
      doc.setFont('helvetica', 'normal');
      doc.text(String(value), margin + labelWidth, cursorY);
      cursorY += 15;
    };

    writeLine('Customer', orderCustomerName);
    writeLine('Model', orderModel);
    writeLine('Serial', orderSerial);
    writeLine('Job', orderJob);

    if (orderCompanyName || orderAttn || orderStreet || orderCityStateZip) {
      cursorY += 4;
      if (orderCompanyName) writeLine('Company', orderCompanyName);
      if (orderAttn || orderStreet || orderCityStateZip) {
        doc.setFont('helvetica', 'bold');
        doc.text('Ship To:', margin, cursorY);
        cursorY += 15;
        doc.setFont('helvetica', 'normal');
        const shipLines = [orderAttn && `ATTN: ${orderAttn}`, orderStreet, orderCityStateZip].filter(Boolean);
        shipLines.forEach(line => {
          doc.text(line, margin + 16, cursorY);
          cursorY += 14;
        });
      }
    }

    cursorY += 8;
    writeLine('Total Items', String(totalItems));
    cursorY += 6;

    // Parts table
    autoTable(doc, {
      startY: cursorY,
      head: [['Part #', 'Part Code', 'Part Name', 'From Diagram', 'Order Qty']],
      body: orderItems.map(([_, item]) => [
        item.partNumber,
        item.partCode || '',
        item.partName || '',
        item.diagramNumber ? `${item.diagramNumber} - ${item.diagramName}` : (item.diagramName || ''),
        item.orderQty
      ]),
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [33, 150, 243], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 249, 249] },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 50 },
        4: { fontStyle: 'bold', halign: 'center', cellWidth: 60 }
      },
      margin: { left: margin, right: margin }
    });

    // Summary block below table
    const afterTableY = doc.lastAutoTable.finalY + 18;
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, afterTableY, pageWidth - margin * 2, 44, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(33, 33, 33);
    doc.text('Order Summary', margin + 10, afterTableY + 16);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total line items: ${totalItems}`, margin + 10, afterTableY + 30);
    doc.text(`Total parts ordered: ${totalQuantity}`, margin + 180, afterTableY + 30);

    // Open the generated PDF in a new tab
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };


  // Group diagrams by customer, then by folder
  const diagramsByCustomerAndFolder = useMemo(() => {
    const grouped = {};
    Object.values(diagrams).forEach(diagram => {
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

    // Sort each folder's diagrams by name (e.g., 10-1, 10-2, 10-3)
    Object.keys(grouped).forEach(customer => {
      Object.keys(grouped[customer]).forEach(folder => {
        grouped[customer][folder].sort((a, b) => {
          // Extract number prefix (e.g., "10-1", "10-2")
          const getPrefix = (name) => {
            const match = (name || '').match(/^(\d+)[-](\d+)/);
            if (match) {
              return [parseInt(match[1]), parseInt(match[2])];
            }
            return [999, 999];
          };

          const [aMain, aSub] = getPrefix(a.name);
          const [bMain, bSub] = getPrefix(b.name);

          if (aMain !== bMain) return aMain - bMain;
          if (aSub !== bSub) return aSub - bSub;
          return (a.name || '').localeCompare(b.name || '');
        });
      });
    });

    return grouped;
  }, [diagrams]);

  const customersList = useMemo(() => {
    const customers = new Set();
    Object.values(diagrams).forEach(diagram => {
      customers.add(diagram.customer || 'General');
    });
    return Array.from(customers).sort();
  }, [diagrams]);

  const filteredDiagramsByCustomerAndFolder = useMemo(() => {
    const allData = diagramsByCustomerAndFolder;

    if (selectedFolder === 'All Folders') {
      return allData;
    }

    // Filter to show only selected customer or customer+folder
    const filtered = {};
    Object.entries(allData).forEach(([customer, folders]) => {
      if (selectedFolder === customer) {
        // Show all folders for this customer
        filtered[customer] = folders;
      } else if (selectedFolder.startsWith(`${customer} > `)) {
        // Show specific folder within customer
        const folderName = selectedFolder.substring(customer.length + 3);
        if (folders[folderName]) {
          filtered[customer] = { [folderName]: folders[folderName] };
        }
      }
    });

    return filtered;
  }, [diagramsByCustomerAndFolder, selectedFolder]);

  // Delete customer with password protection
  const handleDeleteCustomer = async (customerName) => {
    const password = prompt(`⚠️ DELETE CUSTOMER: ${customerName}\n\nThis will permanently delete ALL diagrams for this customer.\n\nEnter password to confirm:`);

    if (password === null) {
      return; // User cancelled
    }

    if (password !== 'JTI2022') {
      alert('Incorrect password. Deletion cancelled.');
      return;
    }

    // Count diagrams to be deleted
    const diagramsToDelete = Object.values(diagrams).filter(d =>
      (d.customer || 'General') === customerName
    );

    const confirmMessage = `Are you sure you want to delete ${diagramsToDelete.length} diagram(s) for customer "${customerName}"?\n\nThis action cannot be undone.`;
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      // Delete all diagrams for this customer
      const updatedDiagrams = { ...diagrams };
      diagramsToDelete.forEach(diagram => {
        delete updatedDiagrams[diagram.id];
      });

      setDiagrams(updatedDiagrams);

      // Remove every order-list entry for the deleted diagrams.
      // Keys are `${diagram.id}-${partNumber}`, so match by id prefix (single functional update).
      const deletedIds = new Set(diagramsToDelete.map(d => d.id));
      setGlobalOrderList(prev => {
        const next = {};
        Object.entries(prev).forEach(([key, val]) => {
          if (![...deletedIds].some(id => key.startsWith(`${id}-`))) next[key] = val;
        });
        return next;
      });

      // Clear current diagram if it was in this customer
      if (currentDiagram && (currentDiagram.customer || 'General') === customerName) {
        setCurrentDiagramId(null);
      }

      alert(`✓ Successfully deleted ${diagramsToDelete.length} diagram(s) for customer "${customerName}"`);
    } catch (error) {
      console.error('Error deleting customer:', error);
      alert('Failed to delete customer. Error: ' + error.message);
    }
  };

  // Delete folder with password protection
  const handleDeleteFolder = async (customerName, folderName) => {
    const password = prompt(`⚠️ DELETE FOLDER: ${customerName} > ${folderName}\n\nThis will permanently delete ALL diagrams in this folder.\n\nEnter password to confirm:`);

    if (password === null) {
      return; // User cancelled
    }

    if (password !== 'JTI2022') {
      alert('Incorrect password. Deletion cancelled.');
      return;
    }

    // Count diagrams to be deleted
    const diagramsToDelete = Object.values(diagrams).filter(d =>
      (d.customer || 'General') === customerName &&
      (d.folder || 'General') === folderName
    );

    const confirmMessage = `Are you sure you want to delete ${diagramsToDelete.length} diagram(s) from folder "${folderName}"?\n\nThis action cannot be undone.`;
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      // Delete all diagrams in this folder
      const updatedDiagrams = { ...diagrams };
      diagramsToDelete.forEach(diagram => {
        delete updatedDiagrams[diagram.id];
      });

      setDiagrams(updatedDiagrams);

      // Remove every order-list entry for the deleted diagrams.
      // Keys are `${diagram.id}-${partNumber}`, so match by id prefix (single functional update).
      const deletedIds = new Set(diagramsToDelete.map(d => d.id));
      setGlobalOrderList(prev => {
        const next = {};
        Object.entries(prev).forEach(([key, val]) => {
          if (![...deletedIds].some(id => key.startsWith(`${id}-`))) next[key] = val;
        });
        return next;
      });

      // Clear current diagram if it was in this folder
      if (currentDiagram &&
          (currentDiagram.customer || 'General') === customerName &&
          (currentDiagram.folder || 'General') === folderName) {
        setCurrentDiagramId(null);
      }

      alert(`✓ Successfully deleted ${diagramsToDelete.length} diagram(s) from folder "${folderName}"`);
    } catch (error) {
      console.error('Error deleting folder:', error);
      alert('Failed to delete folder. Error: ' + error.message);
    }
  };

  // Load customer diagrams from Firebase into the app
  const handleLoadFromFirebase = async () => {
    try {
      // Get password first
      const password = prompt(`🔐 Password required to load diagrams from Firebase\n\nEnter password:`);

      if (password === null) {
        return; // User cancelled
      }

      if (password !== 'JTI2022') {
        alert('Incorrect password. Load cancelled.');
        return;
      }

      // Load customer names only (not full diagrams)
      setDownloadStatus('Loading customer list from Firebase...');
      const customerList = await getCustomerNames();

      if (!customerList || customerList.length === 0) {
        setDownloadStatus(null);
        alert('No customers found in Firebase.');
        return;
      }

      setDownloadStatus(null);

      // Show customer selector modal
      setAvailableCustomers(customerList.sort());
      setSelectedCustomerToLoad(customerList[0]); // Pre-select first customer
      setShowCustomerSelector(true);
    } catch (error) {
      console.error('Error loading from Firebase:', error);
      setDownloadStatus('✗ Load failed: ' + error.message);
      setTimeout(() => setDownloadStatus(null), 5000);
      alert('Failed to load customer list from Firebase.\n\nError: ' + error.message + '\n\nMake sure Firebase is properly configured and accessible.');
    }
  };

  // Execute the customer diagram load after selection
  const handleConfirmCustomerLoad = async () => {
    if (!selectedCustomerToLoad) {
      alert('Please select a customer.');
      return;
    }

    setShowCustomerSelector(false);

    try {
      const matchedCustomer = selectedCustomerToLoad;

      // Load diagrams for this specific customer only
      setDownloadStatus(`Loading diagrams for "${matchedCustomer}" from Firebase...`);
      const customerDiagrams = await loadDiagramsByCustomer(matchedCustomer);

      if (customerDiagrams.length === 0) {
        setDownloadStatus(null);
        alert(`No diagrams found for customer "${matchedCustomer}" in Firebase.`);
        return;
      }

      // Confirm load with info about existing diagrams
      const existingCount = Object.keys(diagrams).length;
      const confirmMessage = existingCount > 0
        ? `Found ${customerDiagrams.length} diagram(s) for "${matchedCustomer}" in Firebase.\n\n` +
          `You currently have ${existingCount} diagram(s) loaded.\n\n` +
          `Load these diagrams?\n(They will be added to your existing diagrams)`
        : `Found ${customerDiagrams.length} diagram(s) for "${matchedCustomer}" in Firebase.\n\n` +
          `Load these diagrams into the app?`;

      const confirmLoad = confirm(confirmMessage);

      if (!confirmLoad) {
        setDownloadStatus(null);
        return;
      }

      // Load all images from Firebase Storage and convert to base64
      setDownloadStatus(`Loading images from Firebase Storage... 0/${customerDiagrams.length}`);

      const diagramsWithImages = await loadDiagramImagesForExport(
        customerDiagrams,
        (current, total) => {
          setDownloadStatus(`Loading images from Firebase Storage... ${current}/${total}`);
        }
      );

      setDownloadStatus('Saving to local storage...');

      // Convert array to object with IDs as keys and merge with existing diagrams
      const newDiagrams = {};
      diagramsWithImages.forEach(diagram => {
        newDiagrams[diagram.id] = diagram;
      });

      // Merge with existing diagrams instead of replacing
      const mergedDiagrams = { ...diagrams, ...newDiagrams };

      // Save to state and IndexedDB
      setDiagrams(mergedDiagrams);

      // Update customer name to show multiple if needed
      const totalCustomers = new Set(Object.values(mergedDiagrams).map(d => d.customer || 'General'));
      const displayName = totalCustomers.size > 1
        ? `Multiple Customers (${totalCustomers.size})`
        : matchedCustomer;
      setCustomerName(displayName);

      await saveDiagrams(mergedDiagrams, displayName);

      setDownloadStatus(`✓ Loaded ${diagramsWithImages.length} diagram(s)`);
      setTimeout(() => setDownloadStatus(null), 3000);

      alert(`✓ Successfully loaded ${diagramsWithImages.length} diagram(s) for "${matchedCustomer}".\n\nTotal diagrams now: ${Object.keys(mergedDiagrams).length}\n\nYou can now view your diagrams offline!`);
    } catch (error) {
      console.error('Error loading from Firebase:', error);
      setDownloadStatus('✗ Load failed: ' + error.message);
      setTimeout(() => setDownloadStatus(null), 5000);
      alert('Failed to load diagrams from Firebase.\n\nError: ' + error.message + '\n\nMake sure Firebase is properly configured and accessible.');
    }
  };

  // Search parts across all diagrams
  const handlePartsSearch = (query) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const results = [];
    const lowerQuery = query.toLowerCase().trim();

    Object.entries(diagrams).forEach(([diagramId, diagram]) => {
      if (diagram.partsData) {
        Object.entries(diagram.partsData).forEach(([partNum, partInfo]) => {
          const partCode = (partInfo.partCode || '').toLowerCase();
          const partName = (partInfo.partName || '').toLowerCase();

          if (partCode.includes(lowerQuery) || partName.includes(lowerQuery)) {
            results.push({
              diagramId,
              diagramName: diagram.name || 'Unnamed',
              diagramNumber: diagram.number || '',
              customer: diagram.customer || 'Unknown',
              folder: diagram.folder || '',
              partNumber: partNum,
              partCode: partInfo.partCode || '',
              partName: partInfo.partName || '',
              qty: partInfo.qty || ''
            });
          }
        });
      }
    });

    // Sort results: exact matches first, then by part code
    results.sort((a, b) => {
      const aExact = a.partCode.toLowerCase() === lowerQuery || a.partName.toLowerCase() === lowerQuery;
      const bExact = b.partCode.toLowerCase() === lowerQuery || b.partName.toLowerCase() === lowerQuery;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.partCode.localeCompare(b.partCode);
    });

    setSearchResults(results);
    setShowSearchResults(true);
  };

  // Navigate to diagram from search result
  const goToSearchResult = (result) => {
    setCurrentDiagramId(result.diagramId);
    setShowSearchResults(false);
    setSearchQuery('');
    // Scroll to diagram viewer
    setTimeout(() => {
      diagramViewerRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const currentDiagram = currentDiagramId ? diagrams[currentDiagramId] : null;

  const orderCount = Object.values(globalOrderList).reduce((sum, item) => sum + item.orderQty, 0);

  return (
    <div style={{
      backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5',
      minHeight: '100vh',
      color: darkMode ? '#fff' : '#000',
      padding: isMobile ? '8px' : '20px'
    }}>
      {/* Header */}
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        marginBottom: isMobile ? '10px' : '20px'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: isMobile ? '8px' : '10px',
          padding: isMobile ? '12px' : '20px',
          backgroundColor: darkMode ? '#2a2a2a' : '#fff',
          borderRadius: '8px',
          boxShadow: darkMode ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '10px' : '15px' }}>
            <img
              src="/logo.png"
              alt="Logo"
              style={{
                height: isMobile ? '40px' : '50px',
                width: 'auto',
                objectFit: 'contain'
              }}
            />
            <h1 style={{ margin: 0, fontSize: isMobile ? '18px' : '24px' }}>
              {currentDiagram?.customer || customerName || 'Parts Manual Viewer'}
            </h1>
          </div>

          <div style={{
            display: 'flex',
            gap: isMobile ? '6px' : '10px',
            flexWrap: 'wrap',
            alignItems: 'center',
            width: isMobile ? '100%' : 'auto',
            justifyContent: isMobile ? 'space-between' : 'flex-start'
          }}>
            <label style={{
              padding: isMobile ? '8px 12px' : '10px 16px',
              backgroundColor: '#2196f3',
              color: 'white',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: isMobile ? '12px' : '14px',
              flex: isMobile ? '1' : 'none',
              textAlign: 'center'
            }}>
              {isMobile ? '📤' : '📤 Import'}
              <input
                type="file"
                accept=".json"
                onChange={handleImportJSON}
                style={{ display: 'none' }}
              />
            </label>

            <button
              onClick={handleExportJSON}
              disabled={Object.keys(diagrams).length === 0}
              style={{
                padding: isMobile ? '8px 12px' : '10px 16px',
                backgroundColor: Object.keys(diagrams).length === 0 ? '#666' : '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: Object.keys(diagrams).length === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: isMobile ? '12px' : '14px',
                flex: isMobile ? '1' : 'none'
              }}
            >
              {isMobile ? '📥' : '📥 Export'}
            </button>

            <button
              onClick={handleLoadFromFirebase}
              disabled={downloadStatus !== null}
              style={{
                padding: isMobile ? '8px 12px' : '10px 16px',
                backgroundColor: downloadStatus !== null ? '#666' : '#9c27b0',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: downloadStatus !== null ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: isMobile ? '12px' : '14px',
                flex: isMobile ? '1' : 'none'
              }}
              title="Load your diagrams from Firebase (password required)"
            >
              {isMobile ? '☁️' : '☁️ Load from Cloud'}
            </button>

            <button
              onClick={() => setShowShareModal(true)}
              disabled={Object.keys(diagrams).length === 0}
              style={{
                padding: isMobile ? '8px 12px' : '10px 16px',
                backgroundColor: Object.keys(diagrams).length === 0 ? '#666' : '#e91e63',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: Object.keys(diagrams).length === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: isMobile ? '12px' : '14px',
                flex: isMobile ? '1' : 'none'
              }}
              title="Generate a shareable link for this customer"
            >
              {isMobile ? '🔗' : '🔗 Share'}
            </button>

            <button
              onClick={() => setShowOrderInfo(true)}
              style={{
                padding: isMobile ? '8px 12px' : '10px 16px',
                backgroundColor: (orderCompanyName || orderAttn || orderStreet || orderCityStateZip) ? '#4caf50' : '#607d8b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: isMobile ? '12px' : '14px',
                flex: isMobile ? '1' : 'none'
              }}
              title="Set company name and shipping address for PDF"
            >
              {isMobile ? '🏢' : '🏢 Order Info'}
            </button>

            <button
              onClick={handlePreviewPDF}
              disabled={orderCount === 0}
              style={{
                padding: isMobile ? '8px 12px' : '10px 16px',
                backgroundColor: orderCount === 0 ? '#666' : '#ff5722',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: orderCount === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: isMobile ? '12px' : '14px',
                flex: isMobile ? '1' : 'none'
              }}
            >
              {isMobile ? `📄 (${orderCount})` : `📄 Preview Order (${orderCount} parts)`}
            </button>

            <button
              onClick={handleExportOrder}
              disabled={orderCount === 0}
              style={{
                padding: isMobile ? '8px 12px' : '10px 16px',
                backgroundColor: orderCount === 0 ? '#666' : '#009688',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: orderCount === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: isMobile ? '12px' : '14px',
                flex: isMobile ? '1' : 'none'
              }}
              title="Save your order list to a JSON file"
            >
              {isMobile ? '💾' : '💾 Save Order'}
            </button>

            <label style={{
              padding: isMobile ? '8px 12px' : '10px 16px',
              backgroundColor: '#795548',
              color: 'white',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: isMobile ? '12px' : '14px',
              flex: isMobile ? '1' : 'none',
              textAlign: 'center',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Load a previously saved order"
            >
              {isMobile ? '📂' : '📂 Load Order'}
              <input
                type="file"
                accept=".json"
                onChange={handleImportOrder}
                style={{ display: 'none' }}
              />
            </label>

            <button
              onClick={() => setDarkMode(!darkMode)}
              style={{
                padding: isMobile ? '8px 12px' : '10px 16px',
                backgroundColor: darkMode ? '#555' : '#ddd',
                color: darkMode ? '#fff' : '#000',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: isMobile ? '16px' : '14px'
              }}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
            {onLogout && (
              <button
                onClick={onLogout}
                style={{
                  padding: isMobile ? '8px 12px' : '10px 16px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: isMobile ? '12px' : '14px'
                }}
                title="Sign Out"
              >
                {isMobile ? '🚪' : 'Sign Out'}
              </button>
            )}
          </div>
        </div>

        {/* Download Status */}
        {downloadStatus && (
          <div style={{
            marginTop: '10px',
            padding: '10px 20px',
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            borderRadius: '6px',
            textAlign: 'center',
            color: downloadStatus.startsWith('✓') ? '#4caf50' : downloadStatus.startsWith('✗') ? '#f44336' : (darkMode ? '#fff' : '#000'),
            fontWeight: 'bold',
            fontSize: '14px',
            boxShadow: darkMode ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            {downloadStatus}
          </div>
        )}

        {/* Parts Search Bar */}
        {Object.keys(diagrams).length > 0 && (
          <div style={{
            marginTop: '10px',
            padding: isMobile ? '12px' : '16px',
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            borderRadius: '8px',
            boxShadow: darkMode ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.1)',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontSize: '20px' }}>🔍</span>
              <input
                type="text"
                placeholder="Search parts by part number or name..."
                value={searchQuery}
                onChange={(e) => handlePartsSearch(e.target.value)}
                style={{
                  flex: 1,
                  padding: isMobile ? '10px 12px' : '12px 16px',
                  fontSize: isMobile ? '14px' : '16px',
                  borderRadius: '8px',
                  border: darkMode ? '1px solid #555' : '1px solid #ddd',
                  backgroundColor: darkMode ? '#1a1a1a' : '#fff',
                  color: darkMode ? '#fff' : '#333',
                  outline: 'none'
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    setShowSearchResults(false);
                  }}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#666',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: isMobile ? '12px' : '14px'
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Search Results Dropdown */}
            {showSearchResults && searchResults.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                borderRadius: '0 0 8px 8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                border: darkMode ? '1px solid #444' : '1px solid #ddd',
                borderTop: 'none',
                maxHeight: '400px',
                overflowY: 'auto',
                zIndex: 1000
              }}>
                <div style={{
                  padding: '8px 16px',
                  backgroundColor: darkMode ? '#333' : '#f0f0f0',
                  fontWeight: 'bold',
                  color: darkMode ? '#fff' : '#333',
                  borderBottom: darkMode ? '1px solid #444' : '1px solid #ddd',
                  position: 'sticky',
                  top: 0
                }}>
                  Found {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                </div>
                {searchResults.map((result, idx) => (
                  <div
                    key={`${result.diagramId}-${result.partNumber}-${idx}`}
                    onClick={() => goToSearchResult(result)}
                    style={{
                      padding: '12px 16px',
                      borderBottom: darkMode ? '1px solid #333' : '1px solid #eee',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                      backgroundColor: darkMode ? '#2a2a2a' : '#fff'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = darkMode ? '#333' : '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = darkMode ? '#2a2a2a' : '#fff'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 'bold', color: '#2196f3', fontSize: '14px' }}>
                          {result.partCode}
                        </div>
                        <div style={{ color: darkMode ? '#ccc' : '#666', fontSize: '13px', marginTop: '2px' }}>
                          {result.partName}
                        </div>
                        <div style={{ color: darkMode ? '#888' : '#999', fontSize: '12px', marginTop: '4px' }}>
                          Diagram: {result.diagramName} {result.diagramNumber ? `(#${result.diagramNumber})` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: darkMode ? '#888' : '#999', fontSize: '11px' }}>
                          {result.folder}
                        </div>
                        {result.qty && (
                          <div style={{ color: darkMode ? '#aaa' : '#666', fontSize: '12px', marginTop: '2px' }}>
                            Qty: {result.qty}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No Results Message */}
            {showSearchResults && searchResults.length === 0 && searchQuery.trim() && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                borderRadius: '0 0 8px 8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                border: darkMode ? '1px solid #444' : '1px solid #ddd',
                borderTop: 'none',
                padding: '20px',
                textAlign: 'center',
                color: darkMode ? '#888' : '#666',
                zIndex: 1000
              }}>
                No parts found matching "{searchQuery}"
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        display: isMobile ? 'block' : 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '300px 1fr',
        gap: isMobile ? '10px' : '20px'
      }}>
        {/* Diagram Selector */}
        <div style={{ marginBottom: isMobile ? '10px' : '0' }}>
          {/* Mobile: Collapsible header */}
          {isMobile && (
            <button
              onClick={() => setDiagramSelectorOpen(!diagramSelectorOpen)}
              style={{
                width: '100%',
                padding: '14px',
                backgroundColor: darkMode ? '#333' : '#2196f3',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: diagramSelectorOpen ? '10px' : '0',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}
            >
              <span>📋 Select Diagram {currentDiagram ? `(${currentDiagram.name})` : ''}</span>
              <span style={{ fontSize: '20px' }}>{diagramSelectorOpen ? '▼' : '▶'}</span>
            </button>
          )}

          {/* Desktop: Static header */}
          {!isMobile && (
            <h2 style={{
              fontSize: '18px',
              marginBottom: '10px',
              color: darkMode ? '#fff' : '#333'
            }}>
              Diagrams
            </h2>
          )}

          {/* Folder Filter Dropdown */}
          {(!isMobile || diagramSelectorOpen) && Object.keys(diagrams).length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '13px',
                fontWeight: 'bold',
                color: darkMode ? '#ccc' : '#666'
              }}>
                Filter by Folder:
              </label>
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: darkMode ? '#333' : '#fff',
                  color: darkMode ? '#fff' : '#000',
                  border: darkMode ? '1px solid #555' : '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                <option value="All Folders">All Folders</option>
                {Object.entries(diagramsByCustomerAndFolder).map(([customer, folders]) => (
                  <optgroup key={customer} label={customer}>
                    <option value={customer}>All {customer} Manuals</option>
                    {Object.entries(folders).map(([folder, diagrams]) => (
                      <option key={`${customer} > ${folder}`} value={`${customer} > ${folder}`}>
                        {folder} ({diagrams.length})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          {/* Diagram list - always show on desktop, collapsible on mobile */}
          {(!isMobile || diagramSelectorOpen) && (
            initializing ? (
              <div style={{
                padding: '20px',
                backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <p>Loading diagrams…</p>
              </div>
            ) : Object.keys(diagrams).length === 0 ? (
              <div style={{
                padding: '20px',
                backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <p>No diagrams loaded.</p>
                <p style={{ fontSize: '13px', marginTop: '10px' }}>
                  Click "Import Diagrams" to load a parts manual.
                </p>
              </div>
            ) :
              Object.entries(filteredDiagramsByCustomerAndFolder).map(([customerName, folders]) => (
              <div key={customerName} style={{
                marginBottom: '16px',
                border: darkMode ? '1px solid #555' : '1px solid #ddd',
                borderRadius: '8px',
                overflow: 'hidden'
              }}>
                {/* Customer Header */}
                <div
                  style={{
                    backgroundColor: darkMode ? '#2a2a2a' : '#e8f4f8',
                    padding: '10px 14px',
                    fontWeight: 'bold',
                    fontSize: '15px',
                    borderBottom: darkMode ? '1px solid #555' : '1px solid #ddd',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div
                    onClick={() => setCollapsedFolders(prev => ({
                      ...prev,
                      [customerName]: !prev[customerName]
                    }))}
                    style={{
                      cursor: 'pointer',
                      flex: 1
                    }}
                  >
                    {collapsedFolders[customerName] ? '▶' : '▼'} {customerName}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCustomer(customerName);
                    }}
                    style={{
                      padding: '4px 10px',
                      backgroundColor: '#d32f2f',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}
                    title={`Delete customer "${customerName}"`}
                  >
                    🗑️ Delete
                  </button>
                </div>

                {/* Customer Folders */}
                {!collapsedFolders[customerName] && (
                  <div>
                    {Object.entries(folders).map(([folderName, folderDiagrams]) => (
                      <div key={`${customerName}-${folderName}`} style={{
                        borderBottom: darkMode ? '1px solid #444' : '1px solid #e0e0e0'
                      }}>
                        {/* Folder Header */}
                        <div
                          style={{
                            backgroundColor: darkMode ? '#333' : '#f5f5f5',
                            padding: '8px 12px 8px 28px',
                            fontWeight: '500',
                            fontSize: '14px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div
                            onClick={() => setCollapsedFolders(prev => ({
                              ...prev,
                              [`${customerName} > ${folderName}`]: !prev[`${customerName} > ${folderName}`]
                            }))}
                            style={{
                              cursor: 'pointer',
                              flex: 1
                            }}
                          >
                            {collapsedFolders[`${customerName} > ${folderName}`] ? '▶' : '▼'} {folderName} ({folderDiagrams.length})
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFolder(customerName, folderName);
                            }}
                            style={{
                              padding: '3px 8px',
                              backgroundColor: '#d32f2f',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '11px',
                              fontWeight: 'bold'
                            }}
                            title={`Delete folder "${folderName}"`}
                          >
                            🗑️ Delete
                          </button>
                        </div>

                        {/* Folder Items */}
                        {!collapsedFolders[`${customerName} > ${folderName}`] && (
                          <div>
                            {folderDiagrams.map(diagram => (
                              <div
                                key={diagram.id}
                                onClick={() => {
                                  setCurrentDiagramId(diagram.id);
                                  if (isMobile) setDiagramSelectorOpen(false);
                                }}
                                style={{
                                  padding: isMobile ? '14px 12px 14px 44px' : '10px 12px 10px 44px',
                                  cursor: 'pointer',
                                  backgroundColor: currentDiagramId === diagram.id
                                    ? (darkMode ? '#1976d2' : '#e3f2fd')
                                    : 'transparent',
                                  borderBottom: darkMode ? '1px solid #444' : '1px solid #e0e0e0',
                                  fontSize: isMobile ? '15px' : '13px',
                                  color: currentDiagramId === diagram.id
                                    ? (darkMode ? '#fff' : '#1976d2')
                                    : (darkMode ? '#ccc' : '#666')
                                }}
                              >
                                {diagram.name}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              ))
          )}
        </div>

        {/* Diagram Viewer */}
        <div ref={diagramViewerRef}>
          {currentDiagram ? (
            <>
              {/* Navigation Buttons */}
              {(() => {
                // Get diagrams only from the CURRENT diagram's folder
                const currentCustomer = currentDiagram.customer || 'General';
                const currentFolder = currentDiagram.folder || 'General';

                const filteredDiagrams = Object.values(diagrams).filter(d => {
                  return (d.customer || 'General') === currentCustomer &&
                         (d.folder || 'General') === currentFolder;
                });

                // Sort diagrams by name
                const sortedDiagrams = filteredDiagrams.sort((a, b) => {
                  // Extract number prefix (e.g., "10-1", "10-2")
                  const getPrefix = (name) => {
                    const match = name.match(/^(\d+)[-](\d+)/);
                    if (match) {
                      return [parseInt(match[1]), parseInt(match[2])];
                    }
                    return [999, 999];
                  };

                  const [aMain, aSub] = getPrefix(a.name);
                  const [bMain, bSub] = getPrefix(b.name);

                  if (aMain !== bMain) return aMain - bMain;
                  if (aSub !== bSub) return aSub - bSub;
                  return a.name.localeCompare(b.name);
                });

                const currentIndex = sortedDiagrams.findIndex(d => d.id === currentDiagramId);
                const hasPrev = currentIndex > 0;
                const hasNext = currentIndex < sortedDiagrams.length - 1;

                const handlePrev = () => {
                  if (hasPrev) {
                    setCurrentDiagramId(sortedDiagrams[currentIndex - 1].id);
                  }
                };

                const handleNext = () => {
                  if (hasNext) {
                    setCurrentDiagramId(sortedDiagrams[currentIndex + 1].id);
                  }
                };

                return (
                  <div style={{
                    marginBottom: '15px',
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '10px',
                    flexWrap: 'wrap'
                  }}>
                    <button
                      onClick={handlePrev}
                      disabled={!hasPrev}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: hasPrev ? '#2196f3' : '#666',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: hasPrev ? 'pointer' : 'not-allowed',
                        fontWeight: 'bold',
                        fontSize: '14px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      ◀ Previous
                    </button>
                    <span style={{
                      padding: '10px 15px',
                      backgroundColor: darkMode ? '#2a2a2a' : '#f5f5f5',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      display: 'inline-flex',
                      alignItems: 'center'
                    }}>
                      {currentIndex + 1} / {sortedDiagrams.length}
                    </span>
                    <button
                      onClick={handleNext}
                      disabled={!hasNext}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: hasNext ? '#2196f3' : '#666',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: hasNext ? 'pointer' : 'not-allowed',
                        fontWeight: 'bold',
                        fontSize: '14px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      Next ▶
                    </button>
                  </div>
                );
              })()}

              {/* Show Source Button */}
              {currentDiagram.partsListImages && currentDiagram.partsListImages.length > 0 && (
                <div style={{
                  marginBottom: '15px',
                  display: 'flex',
                  justifyContent: 'center'
                }}>
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
                </div>
              )}

              <InteractiveDiagramViewer
                diagram={currentDiagram}
                globalOrderList={globalOrderList}
                setGlobalOrderList={setGlobalOrderList}
                darkMode={darkMode}
                isMobile={isMobile}
                onNavigateToDiagram={setCurrentDiagramId}
              />
            </>
          ) : (
            <div style={{
              padding: '40px',
              backgroundColor: darkMode ? '#2a2a2a' : '#fff',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <p style={{ fontSize: '16px' }}>Select a diagram to view</p>
            </div>
          )}
        </div>
      </div>

      {/* Parts List Source Images Modal */}
      {showPartsListSource && currentDiagram && currentDiagram.partsListImages && currentDiagram.partsListImages.length > 0 && (
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
              <h2 style={{ margin: 0 }}>📋 Parts List Source Images</h2>
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
                    fontWeight: 'bold',
                    marginBottom: '10px',
                    color: darkMode ? '#aaa' : '#666'
                  }}>
                    {image.fileName}
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

      {/* Customer Selector Modal */}
      {showCustomerSelector && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10001,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            color: darkMode ? '#fff' : '#333',
            borderRadius: '12px',
            maxWidth: '500px',
            width: '100%',
            padding: '30px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}>
            <h2 style={{ margin: '0 0 20px 0', fontSize: '24px' }}>☁️ Select Customer</h2>

            <p style={{ marginBottom: '20px', color: darkMode ? '#ccc' : '#666' }}>
              Choose a customer to load their diagrams from Firebase:
            </p>

            <div style={{ marginBottom: '25px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontWeight: 'bold',
                fontSize: '14px'
              }}>
                Customer Name:
              </label>
              <select
                value={selectedCustomerToLoad}
                onChange={(e) => setSelectedCustomerToLoad(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '16px',
                  backgroundColor: darkMode ? '#333' : '#fff',
                  color: darkMode ? '#fff' : '#000',
                  border: darkMode ? '2px solid #555' : '2px solid #ddd',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                {availableCustomers.map(customer => (
                  <option key={customer} value={customer}>
                    {customer}
                  </option>
                ))}
              </select>
            </div>

            <div style={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => setShowCustomerSelector(false)}
                style={{
                  padding: '12px 24px',
                  backgroundColor: darkMode ? '#555' : '#ddd',
                  color: darkMode ? '#fff' : '#333',
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
                onClick={handleConfirmCustomerLoad}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                Load Diagrams
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Info Modal */}
      {showOrderInfo && (
        <div
          onClick={() => setShowOrderInfo(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001,
            padding: '20px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: darkMode ? '#2a2a2a' : '#fff',
              color: darkMode ? '#fff' : '#333',
              borderRadius: '12px',
              maxWidth: '500px',
              width: '100%',
              maxHeight: '85vh',
              overflow: 'auto',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '20px' }}>🏢 Order Information</h2>
              <button
                onClick={() => setShowOrderInfo(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: darkMode ? '#888' : '#666',
                  padding: '0',
                  lineHeight: '1'
                }}
              >
                x
              </button>
            </div>

            {[
              { label: 'Customer Name', value: orderCustomerName, setter: setOrderCustomerName, placeholder: 'Customer name...' },
              { type: 'divider' },
              { label: 'Model', value: orderModel, setter: setOrderModel, placeholder: 'Equipment model...' },
              { label: 'Serial', value: orderSerial, setter: setOrderSerial, placeholder: 'Serial number...' },
              { label: 'Job', value: orderJob, setter: setOrderJob, placeholder: 'Job number or name...' },
              { type: 'divider' },
              { label: 'Company Name', value: orderCompanyName, setter: setOrderCompanyName, placeholder: 'Company name...' },
              { label: 'ATTN', value: orderAttn, setter: setOrderAttn, placeholder: 'Contact name...' },
              { label: 'Street Address', value: orderStreet, setter: setOrderStreet, placeholder: '123 Main Street' },
              { label: 'City, State, ZIP', value: orderCityStateZip, setter: setOrderCityStateZip, placeholder: 'City, ST 12345' },
            ].map((field, i) => field.type === 'divider' ? (
              <hr key={i} style={{ border: 'none', borderTop: darkMode ? '1px solid #444' : '1px solid #ddd', margin: '12px 0' }} />
            ) : (
              <div key={i} style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold', fontSize: '13px' }}>
                  {field.label}:
                </label>
                <input
                  type="text"
                  value={field.value}
                  onChange={(e) => field.setter(e.target.value)}
                  placeholder={field.placeholder}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: '14px',
                    backgroundColor: darkMode ? '#333' : '#fff',
                    color: darkMode ? '#fff' : '#000',
                    border: darkMode ? '1px solid #555' : '1px solid #ddd',
                    borderRadius: '6px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            ))}

            <div style={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => {
                  setOrderCustomerName('');
                  setOrderModel('');
                  setOrderSerial('');
                  setOrderJob('');
                  setOrderCompanyName('');
                  setOrderAttn('');
                  setOrderStreet('');
                  setOrderCityStateZip('');
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                Clear All
              </button>
              <button
                onClick={() => setShowOrderInfo(false)}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        customers={customersList}
        diagrams={diagrams}
        darkMode={darkMode}
        equipmentInfo={{ model: orderModel, serial: orderSerial, job: orderJob }}
      />
    </div>
  );
};

export default CustomerViewer;

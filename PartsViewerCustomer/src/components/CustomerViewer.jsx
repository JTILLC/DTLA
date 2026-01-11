import React, { useState, useEffect } from 'react';
import InteractiveDiagramViewer from './InteractiveDiagramViewer';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveImage, getImage, saveImagesBatch, clearAllImages, saveDiagrams, loadDiagrams } from '../utils/imageStorage';
import { getCustomerNames, loadDiagramsByCustomer, loadDiagramImagesForExport } from '../firebase/diagramService';

const CustomerViewer = () => {
  const [diagrams, setDiagrams] = useState({});
  const [currentDiagramId, setCurrentDiagramId] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('All Folders');
  const [globalOrderList, setGlobalOrderList] = useState({});
  const [darkMode, setDarkMode] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [diagramSelectorOpen, setDiagramSelectorOpen] = useState(false);
  const [showPartsListSource, setShowPartsListSource] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState(null);

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
      }

      // Load other data from localStorage
      const savedOrder = localStorage.getItem('orderList');
      if (savedOrder) {
        setGlobalOrderList(JSON.parse(savedOrder));
      }

      const savedDarkMode = localStorage.getItem('darkMode');
      if (savedDarkMode !== null) {
        setDarkMode(savedDarkMode === 'true');
      }

      const savedFolder = localStorage.getItem('selectedFolder');
      if (savedFolder) {
        setSelectedFolder(savedFolder);
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

    const reader = new FileReader();

    reader.onerror = (error) => {
      console.error('[Import] FileReader error:', error);
      alert(`Failed to read file.\n\nError: ${error.message || 'Unknown error'}\n\nFile: ${file.name}`);
    };

    reader.onload = async (event) => {
      try {
        console.log('[Import] File loaded successfully, parsing JSON...');
        const importData = JSON.parse(event.target.result);
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
          return;
        }

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

          importData.diagrams.forEach(diagram => {
            const id = diagram.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
          alert('Failed to import diagrams.\n\nError: ' + error.message);
        }
      } catch (error) {
        console.error('[Import] Parse error:', error);
        alert(`Failed to import diagrams.\n\nError: ${error.message}\n\nPlease ensure the file is valid JSON.`);
      }
    };

    console.log('[Import] Starting to read file...');
    reader.readAsText(file);
    e.target.value = '';
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

  const handlePreviewPDF = () => {
    const orderItems = Object.entries(globalOrderList).filter(([_, item]) => item.orderQty > 0);

    if (orderItems.length === 0) {
      alert('No parts in order list. Click parts on diagrams to add them.');
      return;
    }

    const printWindow = window.open('', '_blank');
    const totalItems = orderItems.length;
    const totalQuantity = orderItems.reduce((sum, [_, item]) => sum + item.orderQty, 0);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Parts Order - ${customerName}</title>
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
          @media print {
            @page { margin: 0.5in; }
            .header-bar {
              display: none;
            }
            body {
              background-color: white;
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
            <strong>Customer:</strong> ${customerName}<br>
            <strong>Date:</strong> ${new Date().toLocaleDateString()}<br>
            <strong>Total Items:</strong> ${totalItems}
          </div>

          <table>
            <thead>
              <tr>
                <th>Part #</th>
                <th>Part Code</th>
                <th>Part Name</th>
                <th>From Diagram</th>
                <th>Order Qty</th>
              </tr>
            </thead>
            <tbody>
              ${orderItems.map(([orderKey, item]) => {
                return `
                  <tr>
                    <td><strong>${item.partNumber}</strong></td>
                    <td>${item.partCode || ''}</td>
                    <td>${item.partName || ''}</td>
                    <td>${item.diagramNumber ? `<strong>${item.diagramNumber}</strong> - ${item.diagramName}` : item.diagramName}</td>
                    <td><strong>${item.orderQty}</strong></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <div class="summary">
            <strong>Order Summary:</strong><br>
            Total line items: ${totalItems}<br>
            Total parts ordered: ${totalQuantity}
          </div>

          <div class="footer">
            Generated by Interactive Parts Manual (JTI)<br>
            ${new Date().toLocaleString()}
          </div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // Group diagrams by customer, then by folder
  const getDiagramsByCustomerAndFolder = () => {
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

    // Sort each folder's diagrams
    Object.keys(grouped).forEach(customer => {
      Object.keys(grouped[customer]).forEach(folder => {
        grouped[customer][folder].sort((a, b) => {
          const dateA = new Date(a.createdAt || 0).getTime();
          const dateB = new Date(b.createdAt || 0).getTime();
          return dateA - dateB;
        });
      });
    });

    return grouped;
  };

  const getCustomers = () => {
    const customers = new Set();
    Object.values(diagrams).forEach(diagram => {
      customers.add(diagram.customer || 'General');
    });
    return Array.from(customers).sort();
  };

  const getFilteredDiagramsByCustomerAndFolder = () => {
    const allData = getDiagramsByCustomerAndFolder();

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
  };

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

        // Also remove from order list
        if (globalOrderList[diagram.id]) {
          const newOrderList = { ...globalOrderList };
          delete newOrderList[diagram.id];
          setGlobalOrderList(newOrderList);
        }
      });

      setDiagrams(updatedDiagrams);

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

        // Also remove from order list
        if (globalOrderList[diagram.id]) {
          const newOrderList = { ...globalOrderList };
          delete newOrderList[diagram.id];
          setGlobalOrderList(newOrderList);
        }
      });

      setDiagrams(updatedDiagrams);

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
      const availableCustomers = await getCustomerNames();

      if (!availableCustomers || availableCustomers.length === 0) {
        setDownloadStatus(null);
        alert('No customers found in Firebase.');
        return;
      }

      setDownloadStatus(null);

      // Get customer name
      const customerNameInput = prompt(
        `Enter your customer name to load diagrams:\n\n` +
        `Available customers:\n${availableCustomers.join('\n')}`
      );

      if (!customerNameInput || !customerNameInput.trim()) {
        return; // User cancelled
      }

      const requestedCustomer = customerNameInput.trim();

      // Find matching customer (case-insensitive)
      const matchedCustomer = availableCustomers.find(
        customer => customer.toLowerCase() === requestedCustomer.toLowerCase()
      );

      if (!matchedCustomer) {
        alert(
          `No customer found matching "${requestedCustomer}" in Firebase.\n\n` +
          `Available customers:\n${availableCustomers.join('\n')}\n\n` +
          `Note: Customer name is case-insensitive.`
        );
        return;
      }

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
                {Object.entries(getDiagramsByCustomerAndFolder()).map(([customer, folders]) => (
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
            Object.keys(diagrams).length === 0 ? (
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
              Object.entries(getFilteredDiagramsByCustomerAndFolder()).map(([customerName, folders]) => (
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
        <div>
          {currentDiagram ? (
            <>
              {/* Navigation Buttons */}
              {(() => {
                // Get filtered diagrams list sorted by name
                const filteredDiagrams = Object.values(diagrams).filter(d => {
                  if (selectedFolder === 'All Folders') return true;
                  if ((d.customer || 'General') === selectedFolder) return true;
                  return `${d.customer || 'General'} > ${d.folder || 'General'}` === selectedFolder;
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
    </div>
  );
};

export default CustomerViewer;

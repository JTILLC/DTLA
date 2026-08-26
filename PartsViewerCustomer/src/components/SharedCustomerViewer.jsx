import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import InteractiveDiagramViewer from './InteractiveDiagramViewer';
import { getShareByToken } from '../firebase/shareService';
import { loadDiagramsByCustomer } from '../firebase/diagramService';
import { saveImage, getImage } from '../utils/imageStorage';
import { appendOrderDiagramPages } from '../utils/orderDiagramPages';
import { storage } from '../firebase/config';
import { ref, getDownloadURL } from 'firebase/storage';

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

const SharedCustomerViewer = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shareData, setShareData] = useState(null);
  const [diagrams, setDiagrams] = useState({});
  const [currentDiagramId, setCurrentDiagramId] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [sharedFolderName, setSharedFolderName] = useState(null); // If set, only show this folder
  const [selectedFolder, setSelectedFolder] = useState('All Folders');
  const [globalOrderList, setGlobalOrderList] = useState(() => readLSJSON(`sharedOrder_${token}`, {}));
  const [darkMode, setDarkMode] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [diagramSelectorOpen, setDiagramSelectorOpen] = useState(false);
  const [orderCompanyName, setOrderCompanyName] = useState(() => readLS('orderCompanyName', ''));
  const [orderAttn, setOrderAttn] = useState(() => readLS('orderAttn', ''));
  const [orderStreet, setOrderStreet] = useState(() => readLS('orderStreet', ''));
  const [orderCityStateZip, setOrderCityStateZip] = useState(() => readLS('orderCityStateZip', ''));
  const [showOrderInfo, setShowOrderInfo] = useState(false);
  // Put the drawings in the order PDF with the ordered balloons ringed in red.
  const [includeDiagramImages, setIncludeDiagramImages] = useState(
    () => readLS('orderIncludeDiagrams', 'true') === 'true'
  );
  const [downloadProgress, setDownloadProgress] = useState(null);

  const diagramViewerRef = React.useRef(null);

  // Load share data and diagrams
  useEffect(() => {
    const loadShareData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Validate the share token
        const share = await getShareByToken(token);

        if (!share) {
          setError('This share link is invalid or has been revoked.');
          setLoading(false);
          return;
        }

        setShareData(share);
        setCustomerName(share.customerName);
        setSharedFolderName(share.folderName || null);

        // Load diagrams for this customer from Firebase (returns array)
        let customerDiagramsArray = await loadDiagramsByCustomer(share.customerName);

        if (!customerDiagramsArray || customerDiagramsArray.length === 0) {
          setError('No diagrams found for this customer.');
          setLoading(false);
          return;
        }

        // Filter by folder if share is folder-specific
        if (share.folderName) {
          customerDiagramsArray = customerDiagramsArray.filter(
            d => (d.folder || 'Uncategorized') === share.folderName
          );

          if (customerDiagramsArray.length === 0) {
            setError('No diagrams found in this folder.');
            setLoading(false);
            return;
          }
        }

        // Download images from Firebase Storage
        const diagramsWithImages = {};
        const totalDiagrams = customerDiagramsArray.length;
        let loadedCount = 0;

        for (const diagram of customerDiagramsArray) {
          try {
            const id = diagram.id;
            loadedCount++;
            setDownloadProgress(`Loading diagrams... ${loadedCount}/${totalDiagrams}`);

            // Check if image is in IndexedDB first
            const cachedImage = await getImage(id);
            if (cachedImage) {
              diagramsWithImages[id] = { ...diagram, pdfData: cachedImage };
            } else if (diagram.pdfStoragePath) {
              // Get download URL from Firebase Storage
              try {
                const storageRef = ref(storage, diagram.pdfStoragePath);
                const downloadURL = await getDownloadURL(storageRef);

                // Fetch the image
                const response = await fetch(downloadURL);
                const blob = await response.blob();
                const reader = new FileReader();
                const base64 = await new Promise((resolve, reject) => {
                  reader.onload = () => resolve(reader.result);
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                });
                diagramsWithImages[id] = { ...diagram, pdfData: base64 };
                // Cache in IndexedDB
                await saveImage(id, base64);
              } catch (imgErr) {
                console.error(`Failed to load image for ${id}:`, imgErr);
                diagramsWithImages[id] = diagram;
              }
            } else {
              diagramsWithImages[id] = diagram;
            }
          } catch (loopErr) {
            console.error('[Load] Error processing diagram:', loopErr);
          }
        }

        setDiagrams(diagramsWithImages);
        setDownloadProgress(null);
      } catch (err) {
        console.error('Error loading share:', err);
        setError('Failed to load shared content. Please try again.');
      }

      setLoading(false);
    };

    if (token) {
      loadShareData();
    }
  }, [token]);

  // Save order list when it changes (including empty, so clearing persists)
  useEffect(() => {
    if (token) {
      localStorage.setItem(`sharedOrder_${token}`, JSON.stringify(globalOrderList));
    }
  }, [globalOrderList, token]);

  // Save order info
  useEffect(() => {
    localStorage.setItem('orderCompanyName', orderCompanyName);
  }, [orderCompanyName]);

  useEffect(() => {
    localStorage.setItem('orderAttn', orderAttn);
  }, [orderAttn]);

  useEffect(() => {
    localStorage.setItem('orderStreet', orderStreet);
  }, [orderStreet]);

  useEffect(() => {
    localStorage.setItem('orderCityStateZip', orderCityStateZip);
  }, [orderCityStateZip]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Theme colors
  const colors = {
    bg: darkMode ? '#121212' : '#f5f5f5',
    cardBg: darkMode ? '#1e1e1e' : '#ffffff',
    text: darkMode ? '#e0e0e0' : '#333333',
    textSecondary: darkMode ? '#888888' : '#666666',
    border: darkMode ? '#333333' : '#e0e0e0',
    primary: '#2196f3',
    success: '#4caf50',
    accent: '#ff9800'
  };

  // Get unique folders
  const folders = ['All Folders', ...new Set(Object.values(diagrams).map(d => d.folder || 'Uncategorized'))];

  // Filter diagrams by folder
  const filteredDiagrams = Object.entries(diagrams).filter(([id, diagram]) =>
    selectedFolder === 'All Folders' || diagram.folder === selectedFolder
  );

  // Group by folder
  const diagramsByFolder = {};
  filteredDiagrams.forEach(([id, diagram]) => {
    const folder = diagram.folder || 'Uncategorized';
    if (!diagramsByFolder[folder]) {
      diagramsByFolder[folder] = [];
    }
    diagramsByFolder[folder].push({ id, ...diagram });
  });

  // Sort diagrams within each folder by name (e.g., 10-1, 10-2, 10-3)
  Object.keys(diagramsByFolder).forEach(folder => {
    diagramsByFolder[folder].sort((a, b) => {
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

  const currentDiagram = currentDiagramId ? diagrams[currentDiagramId] : null;
  const orderCount = Object.keys(globalOrderList).length;

  const toggleFolder = (folder) => {
    setCollapsedFolders(prev => ({
      ...prev,
      [folder]: !prev[folder]
    }));
  };

  const handleOrderUpdate = (newOrderList) => {
    setGlobalOrderList(newOrderList);
  };

  const handleExportOrder = () => {
    if (orderCount === 0) return;

    const orderEntries = Object.entries(globalOrderList).filter(([_, item]) => item.orderQty > 0);
    const orderData = {
      customer: customerName,
      customerName,
      equipmentInfo: {
        model: shareData?.model || '',
        serial: shareData?.serial || '',
        job: shareData?.job || ''
      },
      companyInfo: {
        companyName: orderCompanyName,
        attn: orderAttn,
        street: orderStreet,
        cityStateZip: orderCityStateZip
      },
      exportDate: new Date().toISOString(),
      orderCount: orderEntries.length,
      totalQuantity: orderEntries.reduce((sum, [_, item]) => sum + item.orderQty, 0),
      orderItems: orderEntries.map(([orderKey, item]) => ({
        orderKey,
        ...item
      }))
    };

    const blob = new Blob([JSON.stringify(orderData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${customerName}_order_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportOrder = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const fileText = await file.text();
      const importData = JSON.parse(fileText);

      // Support both formats: { orderItems: [...] } and { items: [...] }
      const items = importData.orderItems || importData.items;
      if (!items || !Array.isArray(items)) {
        alert('Invalid order file format.');
        e.target.value = '';
        return;
      }

      const confirmMsg = `Import ${items.length} order item(s)?\n\n` +
        `Customer: ${importData.customer || importData.customerName || 'Unknown'}\n\n` +
        `This will ADD to your current order list.`;

      if (!window.confirm(confirmMsg)) {
        e.target.value = '';
        return;
      }

      const newOrderList = { ...globalOrderList };
      items.forEach(item => {
        const orderKey = item.orderKey || `${item.diagramId}-${item.partNumber}`;
        if (newOrderList[orderKey]) {
          newOrderList[orderKey].orderQty += item.orderQty || 1;
        } else {
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
      alert(`Successfully imported ${items.length} order item(s).`);
    } catch (error) {
      console.error('Order import error:', error);
      alert('Failed to import order.\n\nError: ' + error.message);
    }

    e.target.value = '';
  };

  const handlePreviewPDF = async () => {
    const orderItems = Object.entries(globalOrderList).filter(([_, item]) => item.orderQty > 0);

    if (orderItems.length === 0) {
      alert('No parts in order list. Click parts on diagrams to add them.');
      return;
    }

    const totalItems = orderItems.length;
    const totalQuantity = orderItems.reduce((sum, [_, item]) => sum + item.orderQty, 0);

    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    let cursorY = margin;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(33, 33, 33);
    const headingText = customerName ? `Parts Order — ${customerName}` : 'Parts Order';
    doc.text(headingText, margin, cursorY);
    cursorY += 6;
    doc.setDrawColor(33, 150, 243);
    doc.setLineWidth(2);
    doc.line(margin, cursorY, pageWidth - margin, cursorY);
    cursorY += 18;

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

    writeLine('Customer', customerName);
    writeLine('Model', shareData?.model);
    writeLine('Serial', shareData?.serial);
    writeLine('Job', shareData?.job);

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

    // The drawings, one page each, with the ordered balloons ringed in red. A
    // shared link carries its images inline, so no id lookup is needed here.
    if (includeDiagramImages) {
      await appendOrderDiagramPages(doc, { orderEntries: orderItems, diagrams });
    }

    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const clearOrder = () => {
    if (window.confirm('Clear all items from order list?')) {
      setGlobalOrderList({});
      localStorage.removeItem(`sharedOrder_${token}`);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.text
      }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>📦</div>
        <h2>Loading Parts Viewer...</h2>
        {downloadProgress && (
          <p style={{ color: colors.textSecondary }}>{downloadProgress}</p>
        )}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.text,
        padding: '20px',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>❌</div>
        <h2>Unable to Load</h2>
        <p style={{ color: colors.textSecondary, maxWidth: '400px' }}>{error}</p>
        <p style={{ color: colors.textSecondary, marginTop: '20px', fontSize: '14px' }}>
          If you believe this is an error, please contact your supplier.
        </p>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: colors.bg,
      color: colors.text,
      padding: isMobile ? '10px' : '20px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <img
            src="/jti-logo.png"
            alt="Joshua Todd Industries"
            style={{
              height: isMobile ? '60px' : '80px',
              width: 'auto'
            }}
          />
          <div>
            <h1 style={{ margin: 0, fontSize: isMobile ? '18px' : '24px' }}>
              Interactive Parts Manual
            </h1>
            <p style={{ margin: '4px 0 0', color: colors.textSecondary }}>
              {customerName}
              {sharedFolderName && (
                <span style={{ color: colors.primary }}> &gt; {sharedFolderName}</span>
              )}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => setDarkMode(!darkMode)}
            style={{
              padding: '8px 12px',
              backgroundColor: colors.cardBg,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </div>

      {/* Equipment Info Banner */}
      {(shareData?.model || shareData?.serial || shareData?.job) && (
        <div style={{
          display: 'flex',
          gap: isMobile ? '8px' : '24px',
          flexWrap: 'wrap',
          marginBottom: '16px',
          padding: '12px 16px',
          backgroundColor: colors.cardBg,
          borderRadius: '8px',
          border: `1px solid ${colors.border}`,
          fontSize: '14px'
        }}>
          {shareData.model && (
            <div><span style={{ color: colors.textSecondary }}>Model:</span> <strong>{shareData.model}</strong></div>
          )}
          {shareData.serial && (
            <div><span style={{ color: colors.textSecondary }}>Serial:</span> <strong>{shareData.serial}</strong></div>
          )}
          {shareData.job && (
            <div><span style={{ color: colors.textSecondary }}>Job:</span> <strong>{shareData.job}</strong></div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '20px',
        flexWrap: 'wrap'
      }}>
        <button
          onClick={() => setShowOrderInfo(true)}
          style={{
            padding: '10px 16px',
            backgroundColor: orderCompanyName ? colors.success : '#607d8b',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          🏢 Order Info
        </button>

        <button
          onClick={handlePreviewPDF}
          disabled={orderCount === 0}
          style={{
            padding: '10px 16px',
            backgroundColor: orderCount === 0 ? '#666' : '#ff5722',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: orderCount === 0 ? 'not-allowed' : 'pointer',
            fontWeight: 'bold'
          }}
        >
          📄 Preview PDF ({orderCount})
        </button>

        <button
          onClick={handleExportOrder}
          disabled={orderCount === 0}
          style={{
            padding: '10px 16px',
            backgroundColor: orderCount === 0 ? '#666' : '#009688',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: orderCount === 0 ? 'not-allowed' : 'pointer',
            fontWeight: 'bold'
          }}
        >
          💾 Save Order
        </button>

        <label style={{
          padding: '10px 16px',
          backgroundColor: '#795548',
          color: 'white',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: 'bold',
          display: 'inline-flex',
          alignItems: 'center'
        }}
        title="Load a previously saved order"
        >
          📂 Load Order
          <input
            type="file"
            accept=".json"
            onChange={handleImportOrder}
            style={{ display: 'none' }}
          />
        </label>

        {orderCount > 0 && (
          <button
            onClick={clearOrder}
            style={{
              padding: '10px 16px',
              backgroundColor: 'transparent',
              color: '#f44336',
              border: '1px solid #f44336',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            🗑️ Clear Order
          </button>
        )}
      </div>

      {/* Folder Filter */}
      <div style={{ marginBottom: '20px' }}>
        <select
          value={selectedFolder}
          onChange={(e) => setSelectedFolder(e.target.value)}
          style={{
            padding: '10px 16px',
            backgroundColor: colors.cardBg,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            fontSize: '14px',
            minWidth: '200px'
          }}
        >
          {folders.map(folder => (
            <option key={folder} value={folder}>{folder}</option>
          ))}
        </select>
      </div>

      {/* Main Content */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '300px 1fr',
        gap: '20px'
      }}>
        {/* Diagram List */}
        <div style={{
          backgroundColor: colors.cardBg,
          borderRadius: '12px',
          padding: '16px',
          border: `1px solid ${colors.border}`,
          maxHeight: isMobile ? '300px' : 'calc(100vh - 250px)',
          overflow: 'auto'
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>
            Diagrams ({filteredDiagrams.length})
          </h3>

          {Object.entries(diagramsByFolder).map(([folder, diagramList]) => (
            <div key={folder} style={{ marginBottom: '12px' }}>
              <div
                onClick={() => toggleFolder(folder)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: colors.bg,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  marginBottom: '8px'
                }}
              >
                <span style={{ fontWeight: 'bold' }}>{folder}</span>
                <span>{collapsedFolders[folder] ? '▶' : '▼'}</span>
              </div>

              {!collapsedFolders[folder] && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {diagramList.map(diagram => (
                    <div
                      key={diagram.id}
                      onClick={() => {
                        setCurrentDiagramId(diagram.id);
                        if (isMobile) setDiagramSelectorOpen(false);
                      }}
                      style={{
                        padding: '10px 12px',
                        backgroundColor: currentDiagramId === diagram.id ? colors.primary : 'transparent',
                        color: currentDiagramId === diagram.id ? 'white' : colors.text,
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                    >
                      <div style={{ fontWeight: '500' }}>{diagram.name}</div>
                      {diagram.number && (
                        <div style={{
                          fontSize: '12px',
                          opacity: 0.7
                        }}>
                          #{diagram.number}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Diagram Viewer */}
        <div ref={diagramViewerRef}>
          {currentDiagram ? (
            <>
              {/* Navigation Buttons */}
              {(() => {
                // Get all diagrams sorted by name
                const allDiagrams = Object.entries(diagrams).map(([id, d]) => ({ id, ...d }));
                const sortedDiagrams = allDiagrams.sort((a, b) => {
                  const getPrefix = (name) => {
                    const match = (name || '').match(/^(\d+)[-](\d+)/);
                    if (match) return [parseInt(match[1]), parseInt(match[2])];
                    return [999, 999];
                  };
                  const [aMain, aSub] = getPrefix(a.name);
                  const [bMain, bSub] = getPrefix(b.name);
                  if (aMain !== bMain) return aMain - bMain;
                  if (aSub !== bSub) return aSub - bSub;
                  return (a.name || '').localeCompare(b.name || '');
                });

                const currentIndex = sortedDiagrams.findIndex(d => d.id === currentDiagramId);
                const hasPrev = currentIndex > 0;
                const hasNext = currentIndex < sortedDiagrams.length - 1;

                const handlePrev = () => {
                  if (hasPrev) setCurrentDiagramId(sortedDiagrams[currentIndex - 1].id);
                };
                const handleNext = () => {
                  if (hasNext) setCurrentDiagramId(sortedDiagrams[currentIndex + 1].id);
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
                        fontSize: '14px'
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
                        fontSize: '14px'
                      }}
                    >
                      Next ▶
                    </button>
                  </div>
                );
              })()}

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
              backgroundColor: colors.cardBg,
              borderRadius: '12px',
              padding: '40px',
              textAlign: 'center',
              border: `1px solid ${colors.border}`
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>👆</div>
              <p style={{ color: colors.textSecondary }}>
                Select a diagram from the list to view it
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Order Info Modal */}
      {showOrderInfo && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={() => setShowOrderInfo(false)}
        >
          <div
            style={{
              backgroundColor: colors.cardBg,
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '400px',
              width: '90%'
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 20px' }}>Order Information</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                  Company Name
                </label>
                <input
                  type="text"
                  value={orderCompanyName}
                  onChange={(e) => setOrderCompanyName(e.target.value)}
                  placeholder="Your Company Name"
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '6px',
                    color: colors.text
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                  Attention
                </label>
                <input
                  type="text"
                  value={orderAttn}
                  onChange={(e) => setOrderAttn(e.target.value)}
                  placeholder="Contact Name"
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '6px',
                    color: colors.text
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                  Street Address
                </label>
                <input
                  type="text"
                  value={orderStreet}
                  onChange={(e) => setOrderStreet(e.target.value)}
                  placeholder="123 Main St"
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '6px',
                    color: colors.text
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                  City, State ZIP
                </label>
                <input
                  type="text"
                  value={orderCityStateZip}
                  onChange={(e) => setOrderCityStateZip(e.target.value)}
                  placeholder="City, ST 12345"
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '6px',
                    color: colors.text
                  }}
                />
              </div>
            </div>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginTop: '16px',
              fontSize: '14px',
              cursor: 'pointer'
            }}>
              <input
                type="checkbox"
                checked={includeDiagramImages}
                onChange={(e) => {
                  setIncludeDiagramImages(e.target.checked);
                  localStorage.setItem('orderIncludeDiagrams', String(e.target.checked));
                }}
              />
              Include the diagrams in the PDF, with ordered parts circled in red
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button
                onClick={() => setShowOrderInfo(false)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: colors.primary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SharedCustomerViewer;

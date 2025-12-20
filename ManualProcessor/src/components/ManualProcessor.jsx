import { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// Set up PDF.js worker using node_modules version
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const ManualProcessor = ({ darkMode }) => {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [customer, setCustomer] = useState('');
  const [folder, setFolder] = useState('');
  const [password, setPassword] = useState('');
  const [startPage, setStartPage] = useState(1);
  const [imageQuality, setImageQuality] = useState(0.7); // JPEG quality (0.1 to 1.0)
  const [imageScale, setImageScale] = useState(1.5); // Scale factor
  const fileInputRef = useRef(null);

  // New state for TOC and mapping
  const [tocEntries, setTocEntries] = useState([]);
  const [tocText, setTocText] = useState(''); // User-pasted TOC text
  const [pageData, setPageData] = useState([]); // Array of {pageNum, imageData OR pdfData, type: 'exploded'|'parts'}
  const [pageMappings, setPageMappings] = useState({}); // {pageNum: tocEntryIndex}
  const [step, setStep] = useState('upload'); // 'upload' | 'mapping' | 'complete'
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState(null); // Store original PDF for page extraction

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      // Auto-extract customer/folder from filename
      const filename = selectedFile.name.replace('.pdf', '');
      const parts = filename.split(/[-_]/);
      if (parts.length >= 2) {
        setCustomer(parts[0].trim());
        setFolder(parts[1].trim());
      }
    } else {
      alert('Please select a PDF file');
    }
  };

  const parseTocText = (text) => {
    // Parse TOC - format is 4 lines per entry:
    // Line 1: Page number (e.g., "10-1" or "20-1")
    // Line 2: Unit name (e.g., "MAIN BODY UNIT::HIGHSPEED")
    // Line 3: Part code (SKIP - e.g., "000-128-2893-16")
    // Line 4: Draw number (e.g., "4D-38837")
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
    const parsed = [];

    for (let i = 0; i < lines.length; i += 4) {
      if (i + 3 >= lines.length) break;

      const pageNumber = lines[i];
      const unitName = lines[i + 1];
      // Skip line i+2 (part code)
      const drawNo = lines[i + 3];

      if (pageNumber && unitName && drawNo) {
        parsed.push({
          index: parsed.length,
          pageNumber,
          unitName,
          drawNo,
          displayName: `${pageNumber} - ${unitName} - ${drawNo}`
        });
      }
    }

    return parsed;
  };

  const generateZip = async () => {
    if (pageData.length === 0) {
      alert('No pages to export');
      return;
    }

    setProcessing(true);
    setProgress('Generating ZIP file...');

    try {
      const zip = new JSZip();

      // Create folders
      const explodedFolder = zip.folder('Exploded-Views');
      const partsFolder = zip.folder('Parts-Lists');

      // Track TOC entry usage for multi-page diagrams
      const tocUsageCount = {};
      const partsListUsageCount = {};

      // Track the last exploded view's TOC mapping for parts lists
      let lastExplodedTocEntry = null;
      let lastExplodedSuffix = '';

      // Add all pages to ZIP
      for (const page of pageData) {
        const fileExtension = page.isPdf ? 'pdf' : 'jpg';
        let filename = `Page-${page.pageNum}.${fileExtension}`;
        let folder = page.type === 'exploded' ? explodedFolder : partsFolder;

        if (page.type === 'exploded') {
          // For exploded views, use TOC mapping if available
          if (pageMappings[page.pageNum] !== null) {
            const tocEntry = tocEntries[pageMappings[page.pageNum]];
            if (tocEntry) {
              // Track usage for multi-page support
              if (!tocUsageCount[tocEntry.index]) {
                tocUsageCount[tocEntry.index] = 0;
              }
              tocUsageCount[tocEntry.index]++;

              // Create filename with suffix if it's a duplicate
              const suffix = tocUsageCount[tocEntry.index] > 1 ? `-${tocUsageCount[tocEntry.index]}` : '';
              const safeName = `${tocEntry.pageNumber}-${tocEntry.unitName}-${tocEntry.drawNo}`
                .replace(/[^a-zA-Z0-9-]/g, '-')
                .replace(/-+/g, '-');
              filename = `${safeName}${suffix}.${fileExtension}`;

              // Remember this for the next parts list
              lastExplodedTocEntry = tocEntry;
              lastExplodedSuffix = suffix;
            } else {
              lastExplodedTocEntry = null;
              lastExplodedSuffix = '';
            }
          } else {
            lastExplodedTocEntry = null;
            lastExplodedSuffix = '';
          }
        } else {
          // For parts lists, use the same name as the previous exploded view
          if (lastExplodedTocEntry) {
            // Track usage for multi-page parts lists
            const key = `${lastExplodedTocEntry.index}${lastExplodedSuffix}`;
            if (!partsListUsageCount[key]) {
              partsListUsageCount[key] = 0;
            }
            partsListUsageCount[key]++;

            // Create filename: same as exploded view but with -parts suffix
            const partsListSuffix = partsListUsageCount[key] > 1 ? `-parts-${partsListUsageCount[key]}` : '-parts';
            const safeName = `${lastExplodedTocEntry.pageNumber}-${lastExplodedTocEntry.unitName}-${lastExplodedTocEntry.drawNo}`
              .replace(/[^a-zA-Z0-9-]/g, '-')
              .replace(/-+/g, '-');
            filename = `${safeName}${lastExplodedSuffix}${partsListSuffix}.${fileExtension}`;
          }
          // else: keep default Page-X.pdf/jpg if no previous exploded view was mapped
        }

        // Extract base64 data and add to ZIP
        let base64Data;
        if (page.isPdf) {
          // For PDF: extract from data:application/pdf;base64,XXX
          base64Data = page.pdfData.split(',')[1];
        } else {
          // For images: extract from data:image/jpeg;base64,XXX
          base64Data = page.imageData.split(',')[1];
        }
        folder.file(filename, base64Data, { base64: true });

        setProgress(`Adding ${filename} to ZIP...`);
      }

      // Generate ZIP file
      setProgress('Compressing ZIP file...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Download ZIP
      const zipFilename = `Manual-Export-${customer}-${folder}.zip`;
      saveAs(zipBlob, zipFilename);

      setProgress(`✓ Downloaded ${zipFilename}`);
      setStep('complete');

    } catch (error) {
      console.error('Error generating ZIP:', error);
      alert(`Error generating ZIP: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const processPDF = async () => {
    if (!file || !customer || !folder) {
      alert('Please select a PDF file and enter customer/folder information');
      return;
    }

    if (!tocText.trim()) {
      alert('Please paste the table of contents text before processing');
      return;
    }

    setProcessing(true);
    setProgress('Loading PDF...');
    setTocEntries([]);
    setPageData([]);
    setPageMappings({});

    try {
      // Read file as ArrayBuffer
      const fileArrayBuffer = await file.arrayBuffer();
      setPdfArrayBuffer(fileArrayBuffer); // Store for later use

      // Step 1: Parse TOC from pasted text
      setProgress(`Parsing table of contents...`);
      const parsedToc = parseTocText(tocText);

      if (parsedToc.length === 0) {
        alert('Could not parse any entries from the table of contents. Please check the format.');
        setProcessing(false);
        return;
      }

      setTocEntries(parsedToc);
      console.log(`✓ Parsed ${parsedToc.length} entries from TOC`);

      // Step 2: Load PDF with pdf-lib FIRST (before pdf.js to avoid ArrayBuffer detachment)
      setProgress(`Loading PDF for page extraction...`);
      const sourcePdfDoc = await PDFDocument.load(fileArrayBuffer);

      // Step 3: Load PDF with pdf.js for rendering (uses same ArrayBuffer, may detach it)
      setProgress(`Loading PDF for rendering...`);
      const loadingTask = pdfjsLib.getDocument({
        data: fileArrayBuffer,
        password: password || undefined
      });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;

      // Step 4: Render all pages starting from startPage (first exploded view)
      const pages = [];

      for (let pageNum = startPage; pageNum <= numPages; pageNum++) {
        const pageOffset = pageNum - startPage;
        const pageType = pageOffset % 2 === 0 ? 'exploded' : 'parts';

        setProgress(`Processing page ${pageNum} of ${numPages} (${pageType === 'exploded' ? 'Exploded View' : 'Parts List'})...`);

        const page = await pdf.getPage(pageNum);

        let pageDataEntry;

        if (pageType === 'exploded') {
          // For exploded views: convert to JPEG
          const viewport = page.getViewport({ scale: imageScale });

          // Render page to canvas
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise;

          // Convert to JPEG
          let quality = imageQuality;
          let imageData = canvas.toDataURL('image/jpeg', quality);
          let imageSizeKB = Math.round(imageData.length / 1024);

          // Ensure exploded views are under 1MB by reducing quality if needed
          const qualitySteps = [0.6, 0.5, 0.4, 0.3];
          let stepIndex = 0;

          while (imageSizeKB > 1024 && stepIndex < qualitySteps.length) {
            quality = qualitySteps[stepIndex];
            imageData = canvas.toDataURL('image/jpeg', quality);
            imageSizeKB = Math.round(imageData.length / 1024);
            console.log(`Page ${pageNum}: Reduced quality to ${(quality * 100).toFixed(0)}% → ${imageSizeKB} KB`);
            stepIndex++;
          }

          if (imageSizeKB > 1024) {
            console.warn(`⚠️ Page ${pageNum}: Still too large (${imageSizeKB} KB) even at lowest quality`);
          }

          pageDataEntry = {
            pageNum,
            imageData,
            type: pageType,
            sizeKB: imageSizeKB,
            quality: quality
          };
        } else {
          // For parts lists: extract as PDF using pdf-lib (reuse loaded PDF)
          const newPdf = await PDFDocument.create();

          // Copy the specific page (pageNum is 1-indexed, but copyPages uses 0-indexed)
          const [copiedPage] = await newPdf.copyPages(sourcePdfDoc, [pageNum - 1]);
          newPdf.addPage(copiedPage);

          // Save as PDF bytes
          const pdfBytes = await newPdf.save();

          // Convert to base64 for storage (using chunk method to avoid stack overflow)
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < pdfBytes.length; i += chunkSize) {
            const chunk = pdfBytes.slice(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
          }
          const pdfBase64 = btoa(binary);
          const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

          const pdfSizeKB = Math.round(pdfBytes.length / 1024);

          pageDataEntry = {
            pageNum,
            pdfData: pdfDataUrl, // Store as PDF data URL
            type: pageType,
            sizeKB: pdfSizeKB,
            isPdf: true // Flag to indicate this is a PDF
          };
        }

        pages.push(pageDataEntry);
      }

      setPageData(pages);

      // Initialize mappings for exploded views (empty by default)
      const initialMappings = {};
      pages.filter(p => p.type === 'exploded').forEach(p => {
        initialMappings[p.pageNum] = null;
      });
      setPageMappings(initialMappings);

      setProgress(`✓ Extracted ${parsedToc.length} TOC entries and ${pages.length} pages`);
      setStep('mapping');

    } catch (error) {
      console.error('Error processing PDF:', error);
      setProgress(`Error: ${error.message}`);
      alert(`Error processing PDF: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '12px',
    borderRadius: '6px',
    border: darkMode ? '1px solid #555' : '1px solid #ccc',
    backgroundColor: darkMode ? '#333' : '#fff',
    color: darkMode ? '#fff' : '#333',
    fontSize: '16px'
  };

  return (
    <div style={{
      backgroundColor: darkMode ? '#2a2a2a' : '#fff',
      padding: '30px',
      borderRadius: '12px',
      boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.1)'
    }}>
      <h2 style={{ marginTop: 0 }}>Manual Processor - Extract & Organize</h2>

      {/* Step indicator */}
      <div style={{ marginBottom: '30px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
        <div style={{
          padding: '8px 16px',
          borderRadius: '20px',
          backgroundColor: step === 'upload' ? '#2196f3' : (darkMode ? '#444' : '#e0e0e0'),
          color: step === 'upload' ? '#fff' : (darkMode ? '#aaa' : '#666'),
          fontWeight: 'bold'
        }}>
          1. Upload
        </div>
        <div style={{
          padding: '8px 16px',
          borderRadius: '20px',
          backgroundColor: step === 'mapping' ? '#2196f3' : (darkMode ? '#444' : '#e0e0e0'),
          color: step === 'mapping' ? '#fff' : (darkMode ? '#aaa' : '#666'),
          fontWeight: 'bold'
        }}>
          2. Map Pages
        </div>
        <div style={{
          padding: '8px 16px',
          borderRadius: '20px',
          backgroundColor: step === 'complete' ? '#4caf50' : (darkMode ? '#444' : '#e0e0e0'),
          color: step === 'complete' ? '#fff' : (darkMode ? '#aaa' : '#666'),
          fontWeight: 'bold'
        }}>
          3. Download
        </div>
      </div>

      {/* STEP 1: Upload */}
      {step === 'upload' && (
        <>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
              Customer Name:
            </label>
            <input
              type="text"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="e.g., Shearers"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
              Folder/Model:
            </label>
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="e.g., CCW-R"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
              PDF Manual:
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileSelect}
              style={inputStyle}
            />
            {file && (
              <div style={{ marginTop: '10px', color: '#4caf50', fontWeight: 'bold' }}>
                ✓ {file.name}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
              Password (if PDF is protected):
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank if no password"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
              Table of Contents Text:
            </label>
            <textarea
              value={tocText}
              onChange={(e) => setTocText(e.target.value)}
              placeholder="Paste your table of contents text here..."
              style={{
                ...inputStyle,
                minHeight: '200px',
                fontFamily: 'monospace',
                fontSize: '13px',
                resize: 'vertical'
              }}
            />
            <div style={{ marginTop: '8px', fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>
              Paste the TOC in 4-line format: Page Number, Unit Name, Part Code, Draw Number
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
              First Exploded View Page:
            </label>
            <input
              type="number"
              min="1"
              value={startPage}
              onChange={(e) => setStartPage(parseInt(e.target.value) || 1)}
              placeholder="e.g., 4"
              style={inputStyle}
            />
            <div style={{ marginTop: '8px', fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>
              Page number of the first exploded view diagram. Pages will alternate: exploded view, parts list, exploded view, etc.
            </div>
          </div>

          <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: darkMode ? '#2a2a2a' : '#f9f9f9', borderRadius: '8px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '12px', color: darkMode ? '#fff' : '#333' }}>
              Image Settings
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Image Quality: {(imageQuality * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0.3"
                max="1.0"
                step="0.1"
                value={imageQuality}
                onChange={(e) => setImageQuality(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '12px', color: darkMode ? '#aaa' : '#666', marginTop: '4px' }}>
                Exploded views will auto-reduce quality if needed to stay under 1MB
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Image Scale: {imageScale.toFixed(1)}x
              </label>
              <input
                type="range"
                min="1.0"
                max="2.0"
                step="0.1"
                value={imageScale}
                onChange={(e) => setImageScale(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '12px', color: darkMode ? '#aaa' : '#666', marginTop: '4px' }}>
                Lower scale = smaller file size but less detail. Default: 1.5x
              </div>
            </div>
          </div>

          <button
            onClick={processPDF}
            disabled={!file || !customer || !folder || !tocText.trim() || processing}
            style={{
              padding: '15px 30px',
              backgroundColor: processing ? '#666' : '#2196f3',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '18px',
              fontWeight: 'bold',
              cursor: processing ? 'not-allowed' : 'pointer',
              width: '100%'
            }}
          >
            {processing ? '🔄 Processing...' : '📄 Process PDF & Render Pages'}
          </button>

          {progress && (
            <div style={{
              marginTop: '20px',
              padding: '15px',
              backgroundColor: darkMode ? '#333' : '#f0f0f0',
              borderRadius: '8px',
              fontWeight: 'bold',
              textAlign: 'center'
            }}>
              {progress}
            </div>
          )}

          <div style={{
            marginTop: '30px',
            padding: '20px',
            backgroundColor: darkMode ? '#1a3a4a' : '#e3f2fd',
            borderRadius: '8px',
            borderLeft: '4px solid #2196f3'
          }}>
            <h4 style={{ marginTop: 0 }}>📋 How It Works:</h4>
            <ol style={{ margin: 0, paddingLeft: '20px' }}>
              <li>Enter customer name and folder/model</li>
              <li>Upload your parts manual PDF</li>
              <li>Paste the Table of Contents text (from manual or PDF copy/paste)</li>
              <li>Specify the page number of the first exploded view</li>
              <li>Click "Process PDF" to render all pages</li>
              <li>Map each exploded view to the correct TOC entry using dropdowns</li>
              <li>Download a ZIP file with organized folders:
                <ul>
                  <li><strong>Exploded-Views/</strong> - Named diagrams in JPG format (e.g., "10-1-DRIVE-WEIGH-UNIT.jpg")</li>
                  <li><strong>Parts-Lists/</strong> - Parts lists in PDF format with matching names (e.g., "10-1-DRIVE-WEIGH-UNIT-parts.pdf")</li>
                </ul>
              </li>
            </ol>
            <div style={{
              backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
              padding: '12px',
              borderRadius: '6px',
              marginTop: '12px',
              fontSize: '12px',
              color: darkMode ? '#888' : '#666',
              fontFamily: 'monospace',
              border: darkMode ? '1px solid #333' : '1px solid #e0e0e0'
            }}>
              TOC Format (4 lines per entry):<br/>
              10-1<br/>
              MAIN BODY UNIT::HIGHSPEED<br/>
              000-128-2893-16<br/>
              4D-38837
            </div>
          </div>
        </>
      )}

      {/* STEP 2: Mapping */}
      {step === 'mapping' && (
        <>
          <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: darkMode ? '#2a2a2a' : '#f9f9f9', borderRadius: '8px' }}>
            <h3 style={{ marginTop: 0 }}>Table of Contents ({tocEntries.length} entries)</h3>
            <div style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666', marginBottom: '10px' }}>
              Map each exploded view page to its corresponding TOC entry. You can assign the same entry to multiple pages for multi-page diagrams.
            </div>

            {/* Editable TOC Text */}
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '14px' }}>
                Edit Table of Contents:
              </label>
              <textarea
                value={tocText}
                onChange={(e) => setTocText(e.target.value)}
                rows={8}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: darkMode ? '1px solid #555' : '1px solid #ccc',
                  backgroundColor: darkMode ? '#1a1a1a' : '#fff',
                  color: darkMode ? '#fff' : '#333',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  resize: 'vertical'
                }}
                placeholder="Paste or edit table of contents (4 lines per entry)"
              />
              <button
                onClick={() => {
                  const parsed = parseTocText(tocText);
                  if (parsed.length === 0) {
                    alert('Could not parse any entries. Please check the format.');
                    return;
                  }
                  setTocEntries(parsed);
                  // Reset mappings when TOC changes
                  const resetMappings = {};
                  pageData.filter(p => p.type === 'exploded').forEach(p => {
                    resetMappings[p.pageNum] = null;
                  });
                  setPageMappings(resetMappings);
                }}
                style={{
                  marginTop: '8px',
                  padding: '8px 16px',
                  backgroundColor: '#ff9800',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '13px'
                }}
              >
                🔄 Re-parse TOC
              </button>
            </div>

            {/* Parsed TOC Display */}
            <div style={{ marginTop: '15px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '14px' }}>
                Parsed Entries:
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto', fontSize: '13px' }}>
                {tocEntries.map((entry, idx) => (
                  <div key={idx} style={{ padding: '4px 0', borderBottom: darkMode ? '1px solid #444' : '1px solid #eee' }}>
                    {idx + 1}. {entry.displayName}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <h3>Exploded View Pages ({pageData.filter(p => p.type === 'exploded').length})</h3>
          <div style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666', marginBottom: '15px' }}>
            Select the TOC entry for each page. Parts lists will automatically inherit the same name with "-parts" suffix.
          </div>
          <div style={{
            backgroundColor: darkMode ? '#1a3a4a' : '#e3f2fd',
            padding: '10px',
            borderRadius: '6px',
            marginBottom: '15px',
            fontSize: '12px',
            color: darkMode ? '#aaa' : '#666',
            borderLeft: '4px solid #2196f3'
          }}>
            <strong>💡 Tip:</strong> When you map an exploded view, the parts list page that follows it will automatically get the same name with a "-parts" suffix. This keeps them organized and easy to match up.
          </div>

          <div style={{ maxHeight: '600px', overflowY: 'auto', marginBottom: '20px' }}>
            {pageData.filter(p => p.type === 'exploded').map((page, idx) => (
              <div
                key={page.pageNum}
                style={{
                  marginBottom: '20px',
                  padding: '15px',
                  backgroundColor: darkMode ? '#333' : '#f9f9f9',
                  borderRadius: '8px',
                  border: darkMode ? '1px solid #555' : '1px solid #ccc'
                }}
              >
                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                  <div style={{ flex: '0 0 200px' }}>
                    {page.isPdf ? (
                      <>
                        <embed
                          src={page.pdfData}
                          type="application/pdf"
                          style={{
                            width: '100%',
                            height: '280px',
                            border: darkMode ? '2px solid #555' : '2px solid #ccc',
                            borderRadius: '4px'
                          }}
                        />
                        <div style={{ fontSize: '12px', marginTop: '8px', textAlign: 'center', color: darkMode ? '#aaa' : '#666' }}>
                          {page.sizeKB} KB (PDF)
                        </div>
                      </>
                    ) : (
                      <>
                        <img
                          src={page.imageData}
                          alt={`Page ${page.pageNum}`}
                          style={{
                            width: '100%',
                            height: 'auto',
                            border: darkMode ? '2px solid #555' : '2px solid #ccc',
                            borderRadius: '4px'
                          }}
                        />
                        <div style={{ fontSize: '12px', marginTop: '8px', textAlign: 'center', color: darkMode ? '#aaa' : '#666' }}>
                          {page.sizeKB} KB {page.quality < imageQuality && `(reduced to ${(page.quality * 100).toFixed(0)}%)`}
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '10px' }}>
                      Page {page.pageNum}
                    </div>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '14px' }}>
                      Map to TOC Entry:
                    </label>
                    <select
                      value={pageMappings[page.pageNum] === null ? '' : pageMappings[page.pageNum]}
                      onChange={(e) => {
                        const value = e.target.value === '' ? null : parseInt(e.target.value);
                        setPageMappings(prev => ({ ...prev, [page.pageNum]: value }));
                      }}
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '6px',
                        border: darkMode ? '1px solid #555' : '1px solid #ccc',
                        backgroundColor: darkMode ? '#444' : '#fff',
                        color: darkMode ? '#fff' : '#333',
                        fontSize: '14px'
                      }}
                    >
                      <option value="">Unmapped (use "Page-{page.pageNum}.jpg")</option>
                      {tocEntries.map((entry) => (
                        <option key={entry.index} value={entry.index}>
                          {entry.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => {
                setStep('upload');
                setPageData([]);
                setTocEntries([]);
                setPageMappings({});
              }}
              style={{
                padding: '15px 30px',
                backgroundColor: darkMode ? '#444' : '#999',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
                flex: '0 0 auto'
              }}
            >
              ← Back
            </button>
            <button
              onClick={generateZip}
              disabled={processing}
              style={{
                padding: '15px 30px',
                backgroundColor: processing ? '#666' : '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '18px',
                fontWeight: 'bold',
                cursor: processing ? 'not-allowed' : 'pointer',
                flex: 1
              }}
            >
              {processing ? '🔄 Generating ZIP...' : '📦 Generate & Download ZIP'}
            </button>
          </div>

          {progress && (
            <div style={{
              marginTop: '20px',
              padding: '15px',
              backgroundColor: darkMode ? '#333' : '#f0f0f0',
              borderRadius: '8px',
              fontWeight: 'bold',
              textAlign: 'center'
            }}>
              {progress}
            </div>
          )}
        </>
      )}

      {/* STEP 3: Complete */}
      {step === 'complete' && (
        <>
          <div style={{
            padding: '40px',
            backgroundColor: darkMode ? '#1b4d2f' : '#d4edda',
            borderRadius: '12px',
            borderLeft: '6px solid #4caf50',
            textAlign: 'center',
            marginBottom: '20px'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '10px' }}>✅</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px', color: darkMode ? '#90ee90' : '#2e7d32' }}>
              ZIP File Downloaded!
            </div>
            <div style={{ fontSize: '16px', color: darkMode ? '#aaa' : '#666' }}>
              Your manual has been extracted and organized.
            </div>
          </div>

          <div style={{
            padding: '20px',
            backgroundColor: darkMode ? '#333' : '#f9f9f9',
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <h4 style={{ marginTop: 0 }}>📊 Summary:</h4>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li>TOC Entries: {tocEntries.length}</li>
              <li>Exploded Views: {pageData.filter(p => p.type === 'exploded').length} (JPG format)</li>
              <li>Parts Lists: {pageData.filter(p => p.type === 'parts').length} (PDF format)</li>
              <li>Total Pages: {pageData.length}</li>
              <li>Mapped Pages: {Object.values(pageMappings).filter(v => v !== null).length}</li>
            </ul>
          </div>

          <button
            onClick={() => {
              setStep('upload');
              setFile(null);
              setPageData([]);
              setTocEntries([]);
              setTocText('');
              setPageMappings({});
              setProgress('');
            }}
            style={{
              padding: '15px 30px',
              backgroundColor: '#2196f3',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '18px',
              fontWeight: 'bold',
              cursor: 'pointer',
              width: '100%'
            }}
          >
            ↻ Process Another Manual
          </button>
        </>
      )}
    </div>
  );
};

export default ManualProcessor;

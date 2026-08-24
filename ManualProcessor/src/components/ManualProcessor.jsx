import { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
// Tesseract is loaded lazily inside downloadJsonManifest so the initial
// page load isn't slowed down by the ~3 MB OCR worker bundle.

// Set up PDF.js worker using node_modules version
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const ManualProcessor = ({ darkMode }) => {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [customer, setCustomer] = useState('');
  const [preOcrEnabled, setPreOcrEnabled] = useState(true);
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
  const [pageTypes, setPageTypes] = useState({}); // {pageNum: 'exploded'|'parts'} - user can override auto-detection
  const [step, setStep] = useState('upload'); // 'upload' | 'mapping' | 'complete'
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState(null); // Store original PDF for page extraction

  // TOC line order configuration
  const [tocLineOrder, setTocLineOrder] = useState({
    line1: 'pageNumber',
    line2: 'unitName',
    line3: 'partCode',
    line4: 'drawNo'
  });

  // Help modal state
  const [showHelp, setShowHelp] = useState(false);

  // Track duplicate pages
  const [duplicatePages, setDuplicatePages] = useState([]);
  const [showDuplicates, setShowDuplicates] = useState(true);

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
    // Parse TOC using the configured line order
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
    const parsed = [];

    for (let i = 0; i < lines.length; i += 4) {
      if (i + 3 >= lines.length) break;

      // Map lines to fields based on configured order
      const fields = {
        [tocLineOrder.line1]: lines[i],
        [tocLineOrder.line2]: lines[i + 1],
        [tocLineOrder.line3]: lines[i + 2],
        [tocLineOrder.line4]: lines[i + 3]
      };

      const pageNumber = fields.pageNumber;
      const unitName = fields.unitName;
      const drawNo = fields.drawNo;

      if (pageNumber && unitName && drawNo) {
        parsed.push({
          index: parsed.length,
          pageNumber,
          unitName,
          drawNo,
          displayName: `[${drawNo}] ${pageNumber} - ${unitName}`
        });
      }
    }

    return parsed;
  };

  // Function to extract Draw No from text
  const extractDrawNo = (text) => {
    if (!text) return null;

    // Look for "DRAW NO." followed by draw number (e.g., "4D-38837")
    const drawNoMatch = text.match(/DRAW\s+NO\.?\s+([A-Z0-9-]+)/i);
    if (drawNoMatch) {
      return drawNoMatch[1].trim();
    }

    // Fallback: look for pattern like "4D-38837"
    const fallbackMatch = text.match(/\b([A-Z0-9]+(?:-[A-Z0-9]+)+)\b/i);
    if (fallbackMatch) {
      return fallbackMatch[1].trim();
    }

    return null;
  };

  const autoMapSequential = () => {
    console.log('🚀 [AUTO-MAP] Starting auto-map with Draw No matching...');

    // First, extract Draw No from all pages
    const pageDrawNumbers = {};
    pageData.forEach(page => {
      if (page.extractedText) {
        const drawNo = extractDrawNo(page.extractedText);
        if (drawNo) {
          pageDrawNumbers[page.pageNum] = drawNo;
          console.log(`📄 [AUTO-MAP] Page ${page.pageNum} has Draw No: ${drawNo}`);
        }
      }
    });

    console.log(`📊 [AUTO-MAP] Found ${Object.keys(pageDrawNumbers).length} pages with Draw No`);

    // Map all exploded view pages sequentially to TOC entries - use user-defined types
    const explodedPages = pageData
      .filter(p => getPageType(p.pageNum) === 'exploded')
      .sort((a, b) => a.pageNum - b.pageNum);

    console.log(`🎯 [AUTO-MAP] Found ${explodedPages.length} exploded view pages:`, explodedPages.map(p => p.pageNum).join(', '));
    console.log(`📋 [AUTO-MAP] TOC entries available: ${tocEntries.length}`);
    console.log(`🔴 [AUTO-MAP] Pages marked as duplicates: ${duplicatePages.length}`, duplicatePages.length > 0 ? duplicatePages.join(', ') : 'none');
    explodedPages.forEach(p => {
      const drawNo = pageDrawNumbers[p.pageNum];
      console.log(`   Page ${p.pageNum}: Draw No = ${drawNo || 'NOT FOUND'}, Has text = ${!!p.extractedText}`);
    });

    const newMappings = {};
    let tocIndex = 0;

    for (const page of explodedPages) {
      // Skip pages marked as duplicates
      if (duplicatePages.includes(page.pageNum)) {
        newMappings[page.pageNum] = null;
        console.log(`   🔴 Page ${page.pageNum}: Marked as DUPLICATE → mapping = null`);
        continue;
      }

      // Map to next available TOC entry
      if (tocIndex < tocEntries.length) {
        newMappings[page.pageNum] = tocIndex;
        console.log(`   ✅ Page ${page.pageNum}: Mapped to TOC ${tocIndex} (${tocEntries[tocIndex].unitName})`);
        tocIndex++;
      } else {
        newMappings[page.pageNum] = null; // No TOC entry available
        console.log(`   ⚠️ Page ${page.pageNum}: No more TOC entries available → mapping = null`);
      }
    }

    // Now map parts lists by matching to their PRECEDING exploded view
    // The Draw No appears on the parts list page, which follows the exploded view
    const partsPages = pageData.filter(p => getPageType(p.pageNum) === 'parts');
    console.log(`📋 [AUTO-MAP] Found ${partsPages.length} parts list pages:`, partsPages.map(p => p.pageNum).join(', '));

    for (const partsPage of partsPages) {
      const partsDrawNo = pageDrawNumbers[partsPage.pageNum];

      if (partsDrawNo) {
        // Find the exploded view page that comes BEFORE this parts list
        // Skip over duplicates (null mappings) to find the first one with a valid TOC mapping
        const precedingExplodedPages = explodedPages
          .filter(explPage => explPage.pageNum < partsPage.pageNum)
          .sort((a, b) => b.pageNum - a.pageNum); // Sorted closest to farthest

        console.log(`   🔍 [AUTO-MAP] Parts list page ${partsPage.pageNum} (${partsDrawNo}): Looking for preceding exploded view...`);
        console.log(`      Found ${precedingExplodedPages.length} exploded views before this page:`, precedingExplodedPages.map(p => `${p.pageNum}(TOC=${newMappings[p.pageNum]})`).join(', '));

        // Find the first preceding exploded view with a non-null TOC mapping
        const precedingExploded = precedingExplodedPages.find(explPage =>
          newMappings[explPage.pageNum] !== null && newMappings[explPage.pageNum] !== undefined
        );

        if (precedingExploded) {
          // Copy the mapping from the preceding exploded view (skipping duplicates)
          newMappings[partsPage.pageNum] = newMappings[precedingExploded.pageNum];
          console.log(`   ✅ [AUTO-MAP] Parts list page ${partsPage.pageNum} (${partsDrawNo}) → matched to preceding exploded view page ${precedingExploded.pageNum} → TOC ${newMappings[precedingExploded.pageNum]}`);
        } else {
          newMappings[partsPage.pageNum] = null;
          console.log(`   ❌ [AUTO-MAP] Parts list page ${partsPage.pageNum} (${partsDrawNo}) → NO PRECEDING EXPLODED VIEW WITH VALID MAPPING (all are null/duplicate)`);
        }
      } else {
        newMappings[partsPage.pageNum] = null;
        console.log(`   ⚠️ [AUTO-MAP] Parts list page ${partsPage.pageNum} → NO DRAW NO EXTRACTED`);
      }
    }

    setPageMappings(newMappings);

    const mappedCount = Object.values(newMappings).filter(v => v !== null).length;
    const skippedCount = duplicatePages.length;
    const partsListsMapped = partsPages.filter(p => newMappings[p.pageNum] !== null).length;

    const message = `✓ Auto-mapped ${mappedCount} pages to TOC entries (${partsListsMapped} parts lists matched by Draw No)${skippedCount > 0 ? ` (skipped ${skippedCount} duplicate${skippedCount !== 1 ? 's' : ''})` : ''}.`;
    setProgress(message);
  };

  const togglePageType = (pageNum) => {
    const currentType = pageTypes[pageNum] || pageData.find(p => p.pageNum === pageNum)?.type || 'exploded';
    const newType = currentType === 'exploded' ? 'parts' : 'exploded';

    setPageTypes({
      ...pageTypes,
      [pageNum]: newType
    });
  };

  const getPageType = (pageNum) => {
    // User override takes precedence
    if (pageTypes[pageNum]) {
      return pageTypes[pageNum];
    }
    // Fall back to original type from pageData
    return pageData.find(p => p.pageNum === pageNum)?.type || 'exploded';
  };

  const toggleDuplicate = (pageNum) => {
    let newDuplicates;
    if (duplicatePages.includes(pageNum)) {
      // Remove from duplicates
      newDuplicates = duplicatePages.filter(p => p !== pageNum);
    } else {
      // Add to duplicates
      newDuplicates = [...duplicatePages, pageNum];
    }

    setDuplicatePages(newDuplicates);

    // Re-map all pages with the updated duplicates list - use user-defined types
    const explodedPages = pageData
      .filter(p => getPageType(p.pageNum) === 'exploded')
      .sort((a, b) => a.pageNum - b.pageNum);

    const newMappings = {};
    let tocIndex = 0;

    for (const page of explodedPages) {
      // Skip pages marked as duplicates
      if (newDuplicates.includes(page.pageNum)) {
        newMappings[page.pageNum] = null;
        continue;
      }

      // Map to next available TOC entry
      if (tocIndex < tocEntries.length) {
        newMappings[page.pageNum] = tocIndex;
        tocIndex++;
      } else {
        newMappings[page.pageNum] = null; // No TOC entry available
      }
    }

    setPageMappings(newMappings);
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

      // First pass: extract Draw No from all pages
      const pageDrawNumbers = {};
      pageData.forEach(page => {
        if (page.extractedText) {
          const drawNo = extractDrawNo(page.extractedText);
          if (drawNo) {
            pageDrawNumbers[page.pageNum] = drawNo;
            const pageType = getPageType(page.pageNum);
            console.log(`[ZIP Export] Page ${page.pageNum} (${pageType}) has Draw No: ${drawNo}`);
          }
        }
      });

      // Group pages by Draw No
      const drawNoGroups = {};
      Object.entries(pageDrawNumbers).forEach(([pageNum, drawNo]) => {
        if (!drawNoGroups[drawNo]) {
          drawNoGroups[drawNo] = [];
        }
        drawNoGroups[drawNo].push(parseInt(pageNum));
      });

      // Sort page numbers within each group
      Object.keys(drawNoGroups).forEach(drawNo => {
        drawNoGroups[drawNo].sort((a, b) => a - b);
      });

      console.log('[ZIP Export] Pages grouped by Draw No:', drawNoGroups);

      // Determine base name for each Draw No by finding ANY page's TOC mapping
      const drawNoBaseNames = {};
      Object.entries(drawNoGroups).forEach(([drawNo, pageNums]) => {
        // Find ANY page in this group that has a TOC mapping (parts lists have mappings from auto-map)
        const mappedPage = pageNums.find(pageNum =>
          !duplicatePages.includes(pageNum) &&
          pageMappings[pageNum] !== null &&
          pageMappings[pageNum] !== undefined
        );

        if (mappedPage) {
          // Use the page's TOC mapping for the base name
          const tocEntry = tocEntries[pageMappings[mappedPage]];
          if (tocEntry) {
            drawNoBaseNames[drawNo] = `${tocEntry.pageNumber}-${tocEntry.unitName}-${tocEntry.drawNo}`
              .replace(/[^a-zA-Z0-9-]/g, '-')
              .replace(/-+/g, '-');
            console.log(`[ZIP Export] Draw No "${drawNo}" → base name from page ${mappedPage} TOC mapping: "${drawNoBaseNames[drawNo]}"`);
            return;
          }
        }

        // Fallback: if no page has a TOC mapping, just use the Draw No
        drawNoBaseNames[drawNo] = drawNo.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
        console.log(`[ZIP Export] Draw No "${drawNo}" → base name (fallback): "${drawNoBaseNames[drawNo]}"`);
      });

      // Track TOC entry usage for multi-page diagrams
      const tocUsageCount = {};
      const drawNoExplodedCount = {}; // Track exploded view count per Draw No
      const drawNoPartsCount = {}; // Track parts list count per Draw No

      // Add all pages to ZIP
      for (const page of pageData) {
        // Skip pages marked as duplicates
        if (duplicatePages.includes(page.pageNum)) {
          console.log(`[ZIP Export] Skipping page ${page.pageNum} (marked as duplicate)`);
          continue;
        }

        const pageType = getPageType(page.pageNum); // Use user-defined type
        // Parts lists should be .txt files, exploded views are images
        const fileExtension = pageType === 'parts' ? 'txt' : (page.isPdf ? 'pdf' : 'jpg');
        let filename = `Page-${page.pageNum}.${fileExtension}`;
        let folder = pageType === 'exploded' ? explodedFolder : partsFolder;

        // Check if this page has a Draw No
        const drawNo = pageDrawNumbers[page.pageNum];

        // For parts lists: use the page's own TOC mapping (which points to preceding exploded view)
        // For exploded views: use Draw No grouping
        if (pageType === 'parts' && pageMappings[page.pageNum] !== null) {
          // Parts list: use its TOC mapping (auto-mapped to preceding exploded view)
          const tocEntry = tocEntries[pageMappings[page.pageNum]];
          if (tocEntry) {
            const baseName = `${tocEntry.pageNumber}-${tocEntry.unitName}-${tocEntry.drawNo}`
              .replace(/[^a-zA-Z0-9-]/g, '-')
              .replace(/-+/g, '-');

            // Track usage for multi-page parts lists (same exploded view, multiple parts pages)
            if (!tocUsageCount[tocEntry.index]) {
              tocUsageCount[tocEntry.index] = 0;
            }
            tocUsageCount[tocEntry.index]++;

            // First parts list: -parts, subsequent: -parts2, -parts3, etc.
            const suffix = tocUsageCount[tocEntry.index] === 1 ? '-parts' : `-parts${tocUsageCount[tocEntry.index]}`;
            filename = `${baseName}${suffix}.${fileExtension}`;
            console.log(`[ZIP Export] Page ${page.pageNum}, type ${pageType}: ${filename} → Parts-Lists (using TOC ${tocEntry.index})`);
          }
        } else if (drawNo && pageType === 'exploded') {
          // Exploded view with Draw No: use Draw No grouping
          const baseName = drawNoBaseNames[drawNo];

          // Track exploded view count for this Draw No
          if (!drawNoExplodedCount[drawNo]) {
            drawNoExplodedCount[drawNo] = 0;
          }
          drawNoExplodedCount[drawNo]++;

          // First exploded view: no suffix, subsequent: -2, -3, etc.
          const suffix = drawNoExplodedCount[drawNo] === 1 ? '' : `-${drawNoExplodedCount[drawNo]}`;
          filename = `${baseName}${suffix}.${fileExtension}`;
          console.log(`[ZIP Export] Page ${page.pageNum}, Draw No ${drawNo}, type ${pageType}: ${filename} → Exploded-Views`);
        } else if (pageType === 'exploded') {
          // Exploded view without Draw No - use TOC mapping if available
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
            }
          }
        }
        // else: keep default Page-X for pages without Draw No or TOC mapping

        // Add content to ZIP based on page type
        if (pageType === 'parts' && page.extractedText && page.extractedText.length > 0) {
          // For parts lists: save BOTH extracted text as .txt file AND the source image
          const baseFilename = filename.replace(/\.(pdf|txt|jpg|jpeg|png)$/i, '');

          // Save the extracted text
          folder.file(`${baseFilename}.txt`, page.extractedText);
          console.log(`[ZIP Export] Added parts list text: ${baseFilename}.txt (${page.extractedText.length} chars)`);

          // Also save the source image
          let base64Data;
          if (page.isPdf) {
            // For PDF: extract from data:application/pdf;base64,XXX
            base64Data = page.pdfData.split(',')[1];
            folder.file(`${baseFilename}.pdf`, base64Data, { base64: true });
            console.log(`[ZIP Export] Added parts list image: ${baseFilename}.pdf`);
          } else {
            // For images: extract from data:image/jpeg;base64,XXX
            base64Data = page.imageData.split(',')[1];
            folder.file(`${baseFilename}.jpg`, base64Data, { base64: true });
            console.log(`[ZIP Export] Added parts list image: ${baseFilename}.jpg`);
          }
        } else {
          // For exploded views: save image/PDF
          let base64Data;
          if (page.isPdf) {
            // For PDF: extract from data:application/pdf;base64,XXX
            base64Data = page.pdfData.split(',')[1];
          } else {
            // For images: extract from data:image/jpeg;base64,XXX
            base64Data = page.imageData.split(',')[1];
          }
          folder.file(filename, base64Data, { base64: true });
          console.log(`[ZIP Export] Added image/PDF: ${filename}`);
        }

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

  // Export a single JSON manifest containing every diagram + parts list +
  // pre-detected hotspot positions. PartsViewer can import this directly to
  // auto-create diagrams with hotspots already placed at the OCR-detected
  // part-number positions, eliminating the manual click-every-hotspot step.
  // Run Tesseract.js on a single image and return numeric word boxes as
  // viewport-fraction {text, x, y} entries. Configured for sparse text +
  // digits-only so it picks up the part-list-index labels reliably.
  // Tesseract.js v7 nests words inside blocks → paragraphs → lines → words,
  // so we walk that structure rather than relying on the legacy data.words.
  const ocrImageForNumbers = async (worker, imageDataUrl) => {
    const result = await worker.recognize(
      imageDataUrl,
      {},
      { blocks: true, text: true }
    );
    const data = result?.data || {};

    // Image dimensions
    let imgW = data.imageDimensions?.width;
    let imgH = data.imageDimensions?.height;
    if (!imgW || !imgH) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { imgW = img.naturalWidth; imgH = img.naturalHeight; resolve(); };
        img.onerror = resolve;
        img.src = imageDataUrl;
      });
    }
    if (!imgW || !imgH) {
      console.warn('[Tesseract] No image dimensions', data);
      return [];
    }

    // Collect every word from every block/paragraph/line.
    const words = [];
    const pushWord = (w) => { if (w) words.push(w); };
    if (Array.isArray(data.words) && data.words.length > 0) {
      data.words.forEach(pushWord); // legacy path (some builds expose this)
    } else if (Array.isArray(data.blocks)) {
      for (const block of data.blocks) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            for (const w of line.words || []) pushWord(w);
          }
        }
      }
    }

    if (words.length === 0) {
      console.warn('[Tesseract] No words returned. Raw text:', (data.text || '').slice(0, 200));
    }

    const out = [];
    for (const w of words) {
      const raw = (w.text || '').replace(/\s+/g, '').trim();
      if (!/^\d{1,3}$/.test(raw)) continue;
      const bbox = w.bbox;
      if (!bbox) continue;
      const cx = (bbox.x0 + bbox.x1) / 2;
      const cy = (bbox.y0 + bbox.y1) / 2;
      out.push({ text: raw, x: cx / imgW, y: cy / imgH });
    }
    console.log(`[Tesseract] Page yielded ${out.length} numeric labels (${words.length} total words)`);
    return out;
  };

  const downloadJsonManifest = async () => {
    setProcessing(true);
    try {
      // Optional: run Tesseract over each exploded-view image to fill in
      // detectedNumbers when the source PDF has no text layer (scanned PDFs).
      if (preOcrEnabled) {
        const explodedPages = pageData.filter((p) => {
          const t = (pageTypes && pageTypes[p.pageNum]) || p.type;
          return t === 'exploded' && !duplicatePages.includes(p.pageNum);
        });
        const needsOcr = explodedPages.filter((p) =>
          !p.detectedNumbers || p.detectedNumbers.length === 0
        );
        if (needsOcr.length > 0) {
          setProgress(`Loading Tesseract OCR engine…`);
          let Tesseract, worker;
          try {
            Tesseract = await import('tesseract.js');
            worker = await Tesseract.createWorker('eng');
            await worker.setParameters({
              tessedit_char_whitelist: '0123456789',
              tessedit_pageseg_mode: Tesseract.PSM ? Tesseract.PSM.SPARSE_TEXT : '11',
            });
          } catch (loadErr) {
            console.error('[Tesseract] Failed to load:', loadErr);
            alert(`Tesseract OCR failed to start: ${loadErr.message}\nThe manifest will still export, but with empty hotspots.`);
            Tesseract = null;
            worker = null;
          }
          if (worker) {
            let i = 0, totalDetected = 0;
            for (const page of needsOcr) {
              i += 1;
              setProgress(`Tesseract OCR ${i}/${needsOcr.length} (page ${page.pageNum})… ${totalDetected} numbers so far`);
              try {
                const detected = await ocrImageForNumbers(worker, page.imageData);
                page.detectedNumbers = detected;
                totalDetected += detected.length;
              } catch (err) {
                console.warn(`[Tesseract] page ${page.pageNum} failed:`, err);
                page.detectedNumbers = [];
              }
            }
            await worker.terminate();
            setProgress(`Tesseract OCR complete: ${totalDetected} numbers across ${needsOcr.length} pages.`);
            console.log(`[Tesseract] Done. Total labels detected: ${totalDetected} across ${needsOcr.length} pages.`);
          }
        }
      }

      // Filter detectedNumbers to plausible part-list-index tokens (1-3
      // digit integers). Larger numbers / words / serials get dropped here;
      // PartsViewer can re-extract from the parts CSV anyway.
      const isIndexToken = (s) => /^\d{1,3}$/.test(s);

      // Re-derive Draw Numbers per page (same approach generateZip uses —
      // this state isn't kept in React; recompute from extractedText).
      const drawNoByPage = {};
      for (const page of pageData) {
        if (page.extractedText) {
          const drawNo = extractDrawNo(page.extractedText);
          if (drawNo) drawNoByPage[page.pageNum] = drawNo;
        }
      }
      // Draw No text usually only appears on parts-list pages. Propagate it
      // to the immediately-preceding exploded view so both pages of a
      // diagram end up in the same group.
      const sortedPages = [...pageData].sort((a, b) => a.pageNum - b.pageNum);
      for (let i = 0; i < sortedPages.length; i++) {
        const p = sortedPages[i];
        if (drawNoByPage[p.pageNum]) {
          // Walk backwards over preceding exploded pages without a drawNo.
          for (let j = i - 1; j >= 0; j--) {
            const prev = sortedPages[j];
            if (drawNoByPage[prev.pageNum]) break;
            const t = (pageTypes && pageTypes[prev.pageNum]) || prev.type;
            if (t === 'exploded') {
              drawNoByPage[prev.pageNum] = drawNoByPage[p.pageNum];
              break;
            }
          }
        }
      }
      const types = (pageTypes && Object.keys(pageTypes).length > 0) ? pageTypes : null;

      // Group pages by Draw No (one diagram per Draw No, exploded + parts).
      const drawNoGroups = {};
      for (const page of pageData) {
        if (duplicatePages.includes(page.pageNum)) continue;
        const drawNo = drawNoByPage[page.pageNum];
        if (!drawNo) continue;
        if (!drawNoGroups[drawNo]) drawNoGroups[drawNo] = [];
        drawNoGroups[drawNo].push(page);
      }

      const diagrams = Object.entries(drawNoGroups).map(([drawNo, pages]) => {
        // Find the controlling TOC entry (use any page's mapping).
        let tocEntry = null;
        for (const page of pages) {
          const idx = pageMappings[page.pageNum];
          if (idx !== null && idx !== undefined && tocEntries[idx]) {
            tocEntry = tocEntries[idx];
            break;
          }
        }

        const explodedPages = pages.filter((p) => {
          const t = types ? types[p.pageNum] : p.type;
          return t === 'exploded';
        });
        const partsPages = pages.filter((p) => {
          const t = types ? types[p.pageNum] : p.type;
          return t === 'parts';
        });

        // Pre-placed hotspots from the first exploded page's detected numbers.
        const explodedFirst = explodedPages[0];
        const hotspots = ((explodedFirst && explodedFirst.detectedNumbers) || [])
          .filter((n) => isIndexToken(n.text))
          .map((n) => ({
            partNumber: n.text,
            x: n.x,
            y: n.y,
          }));

        return {
          drawNo,
          tocEntry: tocEntry
            ? {
                pageNumber: tocEntry.pageNumber,
                unitName: tocEntry.unitName,
                drawNo: tocEntry.drawNo,
              }
            : null,
          name: tocEntry
            ? `${tocEntry.pageNumber}-${tocEntry.unitName}-${tocEntry.drawNo}`
            : drawNo,
          explodedViews: explodedPages.map((p) => ({
            pageNum: p.pageNum,
            imageData: p.imageData,
            sizeKB: p.sizeKB,
            viewport: p.viewport || null,
            detectedNumbers: (p.detectedNumbers || []).filter((n) =>
              isIndexToken(n.text)
            ),
          })),
          partsLists: partsPages.map((p) => ({
            pageNum: p.pageNum,
            extractedText: p.extractedText || '',
            imageData: p.imageData,
          })),
          hotspots,
        };
      });

      const manifest = {
        version: 1,
        generator: 'ManualProcessor',
        exportedAt: new Date().toISOString(),
        customer,
        folder,
        tocEntries,
        diagramCount: diagrams.length,
        totalHotspots: diagrams.reduce((acc, d) => acc + d.hotspots.length, 0),
        diagrams,
      };

      const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
      const filename = `Manual-Manifest-${customer}-${folder}.json`;
      saveAs(blob, filename);
      setProgress(`✓ Downloaded ${filename} (${diagrams.length} diagrams, ${manifest.totalHotspots} pre-placed hotspots)`);
    } catch (error) {
      console.error('Error generating JSON manifest:', error);
      alert(`Error generating manifest: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  // Auto-detect duplicate images by comparing image data
  const detectDuplicateImages = async (pages) => {
    const duplicates = [];
    const imageHashes = new Map(); // Map of hash -> pageNum

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      // Only check exploded view pages (not parts lists)
      // Use page.type (original detected type) instead of pageTypes override
      if (page.type === 'parts') continue;

      // Get the image data to compare
      let imageData = page.isPdf ? page.pdfData : page.imageData;
      if (!imageData) continue;

      // Simple hash: use first 1000 and last 1000 characters of base64 data
      // This is fast and catches exact duplicates
      const quickHash = imageData.substring(0, 1000) + imageData.substring(imageData.length - 1000);

      if (imageHashes.has(quickHash)) {
        // Found a duplicate!
        const originalPageNum = imageHashes.get(quickHash);
        duplicates.push(page.pageNum);
        console.log(`[Duplicate Detection] Page ${page.pageNum} is a duplicate of page ${originalPageNum}`);
      } else {
        // Store this as the first occurrence
        imageHashes.set(quickHash, page.pageNum);
      }
    }

    return duplicates;
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
      const sourcePdfDoc = await PDFDocument.load(fileArrayBuffer, { ignoreEncryption: true });

      // Step 3: Load PDF with pdf.js for rendering (uses same ArrayBuffer, may detach it)
      setProgress(`Loading PDF for rendering...`);
      const loadingTask = pdfjsLib.getDocument({
        data: fileArrayBuffer,
        password: password || undefined,
        ignoreEncryption: true
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

          // Extract text from the exploded view too: each text item with
          // its center as a percentage of the viewport. We later filter for
          // numeric tokens to use as pre-placed hotspots in PartsViewer.
          let detectedNumbers = [];
          try {
            const textContent = await page.getTextContent();
            for (const item of textContent.items) {
              const raw = (item.str || '').trim();
              if (!raw) continue;
              // Apply viewport transform → canvas coords (top-left origin).
              const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
              const cx = tx[4] + (item.width || 0) / 2;
              const cy = tx[5] - (item.height || 0) / 2;
              const x = cx / viewport.width;
              const y = cy / viewport.height;
              if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
              if (x < 0 || x > 1 || y < 0 || y > 1) continue;
              detectedNumbers.push({ text: raw, x, y });
            }
          } catch (err) {
            console.warn(`[Exploded ${pageNum}] Could not extract text positions:`, err);
          }
          pageDataEntry = {
            pageNum,
            imageData,
            type: pageType,
            sizeKB: imageSizeKB,
            quality: quality,
            detectedNumbers,
            viewport: { width: viewport.width, height: viewport.height },
          };
        } else {
          // For parts lists: render as image AND extract text to preserve OCR
          const viewport = page.getViewport({ scale: imageScale });

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise;

          // Convert to JPEG with quality setting
          const quality = imageQuality;
          const imageDataUrl = canvas.toDataURL('image/jpeg', quality);
          const imageSizeKB = Math.round(imageDataUrl.length * 0.75 / 1024);

          // Extract text content from the PDF to preserve OCR
          // Organize by position to maintain table structure
          let extractedText = '';
          try {
            const textContent = await page.getTextContent();

            // Group text items by row (Y position) with tolerance for slight variations
            const rows = {};
            const Y_TOLERANCE = 5; // pixels

            textContent.items.forEach(item => {
              if (!item.str.trim()) return; // Skip empty items

              const y = Math.round(item.transform[5]); // Y position
              const x = item.transform[4]; // X position

              // Find existing row within tolerance
              let rowY = y;
              for (const existingY of Object.keys(rows)) {
                if (Math.abs(parseInt(existingY) - y) < Y_TOLERANCE) {
                  rowY = parseInt(existingY);
                  break;
                }
              }

              if (!rows[rowY]) {
                rows[rowY] = [];
              }

              rows[rowY].push({
                text: item.str,
                x: x,
                y: y
              });
            });

            // Sort rows by Y position (top to bottom)
            const sortedRows = Object.keys(rows)
              .map(y => parseInt(y))
              .sort((a, b) => b - a); // Descending (PDF coords start at bottom)

            // Build text output, sorting items in each row by X position (left to right)
            const lines = sortedRows.map(y => {
              const rowItems = rows[y].sort((a, b) => a.x - b.x);
              return rowItems.map(item => item.text).join(' ');
            });

            extractedText = lines.join('\n');
            console.log(`[Parts List ${pageNum}] Extracted ${extractedText.length} chars of text (${lines.length} lines) from PDF`);
          } catch (error) {
            console.warn(`[Parts List ${pageNum}] Could not extract text:`, error);
          }

          pageDataEntry = {
            pageNum,
            imageData: imageDataUrl,
            extractedText: extractedText, // Preserve OCR text from original PDF
            type: pageType,
            sizeKB: imageSizeKB,
            quality: quality
          };
        }

        pages.push(pageDataEntry);
      }

      setPageData(pages);

      // Auto-detect duplicate exploded view images
      setProgress('Detecting duplicate exploded views...');
      const detectedDuplicates = await detectDuplicateImages(pages);
      if (detectedDuplicates.length > 0) {
        setDuplicatePages(detectedDuplicates);
        console.log(`[Duplicate Detection] Found ${detectedDuplicates.length} duplicate page(s):`, detectedDuplicates);
      }

      // Initialize mappings for all pages (empty by default)
      const initialMappings = {};
      pages.forEach(p => {
        initialMappings[p.pageNum] = null;
      });
      setPageMappings(initialMappings);

      setProgress(`✓ Extracted ${parsedToc.length} TOC entries and ${pages.length} pages${detectedDuplicates.length > 0 ? ` (${detectedDuplicates.length} duplicates detected)` : ''}`);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Manual Processor - Extract & Organize</h2>
        <button
          onClick={() => setShowHelp(true)}
          style={{
            padding: '10px 20px',
            backgroundColor: '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '14px'
          }}
        >
          📖 Help Guide
        </button>
      </div>

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

          <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: darkMode ? '#2a2a2a' : '#f9f9f9', borderRadius: '8px' }}>
            <label style={{ display: 'block', marginBottom: '12px', fontWeight: 'bold' }}>
              TOC Line Order Configuration:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              {['line1', 'line2', 'line3', 'line4'].map((lineKey, idx) => (
                <div key={lineKey}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 'bold' }}>
                    Line {idx + 1}:
                  </label>
                  <select
                    value={tocLineOrder[lineKey]}
                    onChange={(e) => setTocLineOrder(prev => ({ ...prev, [lineKey]: e.target.value }))}
                    style={{
                      ...inputStyle,
                      padding: '8px',
                      fontSize: '13px'
                    }}
                  >
                    <option value="pageNumber">Page Number</option>
                    <option value="unitName">Unit Name</option>
                    <option value="partCode">Part Code</option>
                    <option value="drawNo">Diagram Number</option>
                  </select>
                </div>
              ))}
            </div>
            <div style={{ marginTop: '10px', fontSize: '12px', color: darkMode ? '#aaa' : '#666' }}>
              Configure which field appears on each line of your TOC entries (4 lines per entry)
            </div>
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
              Paste the TOC in 4-line format (configure order above)
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
                  pageData.forEach(p => {
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

          <h3>All Pages ({pageData.length}) - {pageData.filter(p => getPageType(p.pageNum) === 'exploded').length} Exploded Views, {pageData.filter(p => getPageType(p.pageNum) === 'parts').length} Parts Lists</h3>
          <div style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666', marginBottom: '15px' }}>
            Use the page type button to classify each page. Then map exploded views to TOC entries. Parts lists will automatically inherit the same name with "-parts" suffix.
          </div>

          {/* Auto-Map Button */}
          <div style={{
            backgroundColor: darkMode ? '#2a3a2a' : '#e8f5e9',
            padding: '15px',
            borderRadius: '8px',
            marginBottom: '15px',
            borderLeft: '4px solid #4caf50'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '14px' }}>
              ⚡ Quick Start: Auto-Map All Pages
            </div>
            <div style={{ fontSize: '12px', color: darkMode ? '#aaa' : '#666', marginBottom: '12px' }}>
              Maps all pages sequentially to TOC entries (Page 1→TOC 1, Page 2→TOC 2, etc.). Then use the "Mark as Duplicate" button on each page to manually adjust.
            </div>
            <button
              onClick={autoMapSequential}
              style={{
                padding: '12px 24px',
                backgroundColor: '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                width: '100%'
              }}
            >
              🚀 Auto-Map All Pages in Order
            </button>

            {duplicatePages.length > 0 && (
              <div style={{ marginTop: '12px', padding: '10px', backgroundColor: darkMode ? '#3a2a2a' : '#fff3e0', borderRadius: '6px' }}>
                <div style={{ fontSize: '12px', color: darkMode ? '#ffb74d' : '#e65100', fontWeight: 'bold' }}>
                  {duplicatePages.length} page{duplicatePages.length !== 1 ? 's' : ''} marked as duplicate{duplicatePages.length !== 1 ? 's' : ''}
                </div>
                <div style={{ fontSize: '11px', color: darkMode ? '#aaa' : '#666', marginTop: '4px' }}>
                  These pages are skipped during mapping and won't be included in the ZIP.
                </div>
              </div>
            )}
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
            {pageData
              .map((page, idx) => (
              <div
                key={page.pageNum}
                style={{
                  marginBottom: '20px',
                  padding: '15px',
                  backgroundColor: duplicatePages.includes(page.pageNum)
                    ? (darkMode ? '#3a2a2a' : '#fff3e0')
                    : (darkMode ? '#333' : '#f9f9f9'),
                  borderRadius: '8px',
                  border: duplicatePages.includes(page.pageNum)
                    ? (darkMode ? '2px solid #ff6f00' : '2px solid #ff9800')
                    : (darkMode ? '1px solid #555' : '1px solid #ccc')
                }}
              >
                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                  <div style={{ flex: '0 0 450px' }}>
                    {page.isPdf ? (
                      <>
                        <embed
                          src={page.pdfData}
                          type="application/pdf"
                          style={{
                            width: '100%',
                            height: '630px',
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
                      {duplicatePages.includes(page.pageNum) && (
                        <span style={{
                          marginLeft: '8px',
                          fontSize: '11px',
                          backgroundColor: darkMode ? '#5a3a1a' : '#ffe0b2',
                          color: darkMode ? '#ffb74d' : '#e65100',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontWeight: 'normal'
                        }}>
                          🔄 Duplicate
                        </span>
                      )}
                      {!duplicatePages.includes(page.pageNum) && pageMappings[page.pageNum] !== null && (
                        <span style={{
                          marginLeft: '8px',
                          fontSize: '11px',
                          backgroundColor: darkMode ? '#1a4a2a' : '#c8e6c9',
                          color: darkMode ? '#81c784' : '#2e7d32',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontWeight: 'normal'
                        }}>
                          ✓ Mapped
                        </span>
                      )}
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

                    {/* Page Type Toggle Button */}
                    <button
                      onClick={() => togglePageType(page.pageNum)}
                      style={{
                        marginTop: '12px',
                        padding: '10px 16px',
                        backgroundColor: getPageType(page.pageNum) === 'exploded'
                          ? (darkMode ? '#1a3a5a' : '#2196f3')
                          : (darkMode ? '#3a1a5a' : '#9c27b0'),
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '13px',
                        width: '100%'
                      }}
                    >
                      {getPageType(page.pageNum) === 'exploded' ? '📊 Exploded View (Click to change)' : '📋 Parts List (Click to change)'}
                    </button>

                    {/* Mark as Duplicate Button */}
                    <button
                      onClick={() => toggleDuplicate(page.pageNum)}
                      style={{
                        marginTop: '12px',
                        padding: '10px 16px',
                        backgroundColor: duplicatePages.includes(page.pageNum)
                          ? (darkMode ? '#5a3a1a' : '#ff9800')
                          : (darkMode ? '#444' : '#e0e0e0'),
                        color: duplicatePages.includes(page.pageNum) ? 'white' : (darkMode ? '#fff' : '#333'),
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '13px',
                        width: '100%'
                      }}
                    >
                      {duplicatePages.includes(page.pageNum) ? '✓ Marked as Duplicate (Click to Unmark)' : '🔄 Mark as Duplicate'}
                    </button>

                    {pageMappings[page.pageNum] === null && !duplicatePages.includes(page.pageNum) && (
                      <div style={{
                        marginTop: '8px',
                        padding: '6px',
                        backgroundColor: darkMode ? '#3a2a1a' : '#fff3e0',
                        borderRadius: '4px',
                        fontSize: '11px',
                        color: darkMode ? '#ffb74d' : '#e65100',
                        borderLeft: '3px solid #ff9800'
                      }}>
                        ⚠️ Unmapped - will be named "Page-{page.pageNum}.jpg"
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            background: darkMode ? '#1e3a5f' : '#dbeafe',
            color: darkMode ? '#bfdbfe' : '#1e40af',
            border: `1px solid ${darkMode ? '#3b82f6' : '#93c5fd'}`,
            borderRadius: '8px',
            padding: '12px 14px',
            marginBottom: '12px',
            fontSize: '14px',
            lineHeight: 1.5
          }}>
            <strong>Two ways to export:</strong>
            <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
              <li><strong>📦 ZIP</strong> — separate JPGs + parts-list text files. Use this if you'll hand-place hotspots in PartsViewer.</li>
              <li><strong>🔗 JSON</strong> — recommended. One file. PartsViewer's <em>Import Manifest</em> button auto-creates every diagram with hotspots already placed at the OCR-detected part numbers.</li>
            </ul>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={preOcrEnabled}
                onChange={(e) => setPreOcrEnabled(e.target.checked)}
                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
              />
              <span>
                <strong>Pre-OCR exploded views with Tesseract</strong> — runs locally, free, no API key. Adds ~5–15&nbsp;sec per page during JSON export but ensures hotspots get placed even when the PDF is image-only.
              </span>
            </label>
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
            <button
              onClick={downloadJsonManifest}
              disabled={processing}
              title="One-click manifest for direct PartsViewer import — pre-placed hotspots, no manual upload needed."
              style={{
                padding: '15px 30px',
                backgroundColor: processing ? '#666' : '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '18px',
                fontWeight: 'bold',
                cursor: processing ? 'not-allowed' : 'pointer',
                flex: 1
              }}
            >
              {processing ? '🔄 Working…' : '🔗 Download JSON for PartsViewer'}
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
              <li>Exploded Views: {pageData.filter(p => getPageType(p.pageNum) === 'exploded').length} (JPG format)</li>
              <li>Parts Lists: {pageData.filter(p => getPageType(p.pageNum) === 'parts').length} (JPG format)</li>
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

      {/* Help Modal */}
      {showHelp && (
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
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: darkMode ? '#2a2a2a' : '#fff',
            color: darkMode ? '#fff' : '#333',
            borderRadius: '12px',
            maxWidth: '800px',
            maxHeight: '90vh',
            overflow: 'auto',
            padding: '30px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>📖 Manual Processor Help Guide</h2>
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
              <h3 style={{ color: '#2196f3', marginTop: '20px' }}>🎯 What Does This Tool Do?</h3>
              <p>
                The Manual Processor automatically extracts pages from parts manuals, organizes them by diagram name,
                and creates a downloadable ZIP file with:
              </p>
              <ul>
                <li><strong>Exploded-Views/</strong> - Diagram images (JPG format)</li>
                <li><strong>Parts-Lists/</strong> - Parts list pages (PDF format)</li>
              </ul>
              <p>
                All files are automatically named based on your Table of Contents entries (e.g., "10-1-DRIVE-UNIT-4D-33519.jpg").
              </p>

              <h3 style={{ color: '#2196f3', marginTop: '30px' }}>📋 Step-by-Step Instructions</h3>

              <h4 style={{ color: '#ff9800', marginTop: '20px' }}>Step 1: Upload & Configure</h4>
              <ol>
                <li><strong>Customer Name:</strong> Enter the customer/company name (e.g., "Shearers")</li>
                <li><strong>Folder/Model:</strong> Enter the equipment model or folder name (e.g., "CCW-R")</li>
                <li><strong>PDF Manual:</strong> Select your parts manual PDF file</li>
                <li><strong>Password (optional):</strong> If the PDF is password-protected, enter it here</li>
              </ol>

              <h4 style={{ color: '#ff9800', marginTop: '20px' }}>⚙️ TOC Line Order Configuration</h4>
              <p>
                <strong>This is important!</strong> Your Table of Contents has 4 lines per entry. You need to tell the app
                which line contains which information.
              </p>
              <div style={{
                backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
                padding: '15px',
                borderRadius: '8px',
                marginTop: '10px',
                fontFamily: 'monospace',
                fontSize: '13px'
              }}>
                <strong>Default Order:</strong><br/>
                Line 1: Page Number (e.g., "10-1")<br/>
                Line 2: Unit Name (e.g., "DRIVE WEIGH UNIT")<br/>
                Line 3: Part Code (e.g., "000-128-2893-16")<br/>
                Line 4: Diagram Number (e.g., "4D-33519")
              </div>
              <p style={{ marginTop: '10px' }}>
                <strong>If your TOC format is different,</strong> use the dropdowns to select the correct field for each line.
                The diagram number will appear in [brackets] in the mapping dropdowns.
              </p>

              <h4 style={{ color: '#ff9800', marginTop: '20px' }}>📄 Table of Contents Text</h4>
              <p>
                Copy and paste your Table of Contents text. It should have <strong>4 lines per entry</strong>:
              </p>
              <div style={{
                backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
                padding: '15px',
                borderRadius: '8px',
                marginTop: '10px',
                fontFamily: 'monospace',
                fontSize: '13px'
              }}>
                10-1<br/>
                DRIVE WEIGH UNIT<br/>
                000-128-2893-16<br/>
                4D-33519<br/>
                <br/>
                20-1<br/>
                HOPPER UNIT<br/>
                000-149-3283-04<br/>
                4D-46728
              </div>

              <h4 style={{ color: '#ff9800', marginTop: '20px' }}>📍 First Exploded View Page</h4>
              <p>
                Enter the page number where the first exploded view diagram appears. The tool assumes pages alternate:<br/>
                <strong>Exploded View → Parts List → Exploded View → Parts List...</strong>
              </p>

              <h4 style={{ color: '#ff9800', marginTop: '20px' }}>🖼️ Image Settings (Optional)</h4>
              <ul>
                <li><strong>Image Quality:</strong> 30-100% (higher = better quality but larger files)</li>
                <li><strong>Image Scale:</strong> 1.0-2.0x (higher = higher resolution)</li>
              </ul>
              <p>
                Note: Exploded views are auto-compressed to stay under 1MB for PartsViewer compatibility.
              </p>

              <h4 style={{ color: '#4caf50', marginTop: '20px' }}>Step 2: Map Pages to Diagrams</h4>
              <p>
                After processing, you'll see thumbnails of each exploded view page. Use the dropdown menu below each
                image to select which TOC entry it corresponds to.
              </p>
              <p>
                <strong>Tip:</strong> The diagram number appears in [brackets] at the start of each dropdown option
                to help you match quickly (e.g., <code style={{
                  backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}>[4D-33519] 10-1 - DRIVE WEIGH UNIT</code>).
              </p>

              <h4 style={{ color: '#4caf50', marginTop: '20px' }}>Step 3: Download Output</h4>
              <p>You have two ways to send the manual to PartsViewer:</p>
              <ol style={{ paddingLeft: '20px' }}>
                <li>
                  <strong>📦 Generate &amp; Download ZIP</strong> — the original output with separate folders.
                  Use this if you want to inspect the files yourself or hand them off manually.
                  <ul>
                    <li><code>Exploded-Views/</code> — JPGs named like <code>10-1-DRIVE-WEIGH-UNIT-4D-33519.jpg</code></li>
                    <li><code>Parts-Lists/</code> — text files with the OCR'd parts table</li>
                  </ul>
                </li>
                <li style={{ marginTop: '10px' }}>
                  <strong>🔗 Download JSON for PartsViewer</strong> — the new one-click pipeline.
                  Produces a single <code>Manual-Manifest-{`{customer}`}-{`{folder}`}.json</code> file containing
                  every diagram with hotspot positions <em>already detected</em> from the exploded views.
                  Open PartsViewer, click <strong>🔗 Import Manifest</strong>, pick this file, and every
                  diagram is created with its hotspots pre-placed — no manual clicking.
                </li>
              </ol>
              <p style={{ marginTop: '8px' }}>
                <strong>Recommended:</strong> use the JSON path. It cuts ~1 hour of manual hotspot-placement work per manual.
              </p>

              <h3 style={{ color: '#2196f3', marginTop: '30px' }}>💡 Tips for Best Results</h3>
              <ul>
                <li>Make sure your TOC text is properly formatted (4 lines per entry)</li>
                <li>Configure the TOC line order correctly before processing</li>
                <li>Check the diagram number in [brackets] when mapping pages</li>
                <li>Use "Unmapped" for pages you want to skip</li>
                <li>Higher image scale (1.5-2.0x) gives better quality for detailed diagrams</li>
                <li>Files are auto-named using customer, folder, and TOC info</li>
              </ul>

              <h3 style={{ color: '#2196f3', marginTop: '30px' }}>❓ Common Questions</h3>

              <h4 style={{ marginTop: '15px' }}>Q: What if my TOC format is different?</h4>
              <p>
                Use the "TOC Line Order Configuration" dropdowns to tell the app which line contains which field.
                The app supports any 4-line format.
              </p>

              <h4 style={{ marginTop: '15px' }}>Q: What if pages don't alternate perfectly?</h4>
              <p>
                The app assumes alternating pages. If your manual has a different pattern, you may need to manually
                adjust which pages you map.
              </p>

              <h4 style={{ marginTop: '15px' }}>Q: Can I skip certain pages?</h4>
              <p>
                Yes! Select "Unmapped" in the dropdown to skip a page. It will be saved as "Page-X.jpg" in the ZIP.
              </p>

              <h4 style={{ marginTop: '15px' }}>Q: Why are exploded views JPG but parts lists PDF?</h4>
              <p>
                Exploded views are converted to JPG to reduce file size (required for PartsViewer which has a 1MB limit).
                Parts lists stay as PDF to preserve text quality and searchability.
              </p>

              <h4 style={{ marginTop: '15px' }}>Q: What's the diagram number used for?</h4>
              <p>
                The diagram number (e.g., "4D-33519") appears in [brackets] in the mapping dropdowns to help you
                quickly identify which TOC entry matches each page. It's also included in the final filename.
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
    </div>
  );
};

export default ManualProcessor;

import React, { useState } from 'react';

const PdfToCsvConverter = ({ onImportToViewer }) => {
  const [pdfFile, setPdfFile] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [inputMode, setInputMode] = useState('pdf'); // 'pdf' or 'text'
  const [pastedText, setPastedText] = useState('');

  const extractTextFromPDF = async (file) => {
    const pdfjs = await import('pdfjs-dist');
    const { getDocument } = pdfjs;

    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const typedArray = new Uint8Array(e.target.result);
          const pdf = await getDocument(typedArray).promise;

          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent({
              includeMarkedContent: true,
              disableNormalization: false
            });

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

              // Advanced text reconstruction with better gap detection
              let lineText = '';
              for (let i = 0; i < lineItems.length; i++) {
                const current = lineItems[i];
                const next = lineItems[i + 1];

                lineText += current.text;

                if (next) {
                  // Calculate actual gap between text items
                  const actualGap = next.x - current.x;

                  // Very aggressive joining to fix split characters
                  // If gap is less than 20 pixels, join without space
                  // This will join "C O V E R" into "COVER"
                  if (actualGap < 20) {
                    // Join directly - no space
                  } else if (actualGap < 40) {
                    // Small gap - add single space
                    lineText += ' ';
                  } else {
                    // Large gap - column separator
                    lineText += '  ';
                  }
                }
              }

              if (lineText.trim()) {
                fullText += lineText + '\n';
              }
            });
          }

          // Post-process to remove single-character spacing
          // This handles cases like "C O V E R" -> "COVER"
          const cleanedText = fullText.replace(/\b([A-Z])\s+(?=[A-Z]\b)/g, '$1');

          resolve({ text: cleanedText, isEmpty: cleanedText.length === 0 });
        } catch (error) {
          reject(new Error('Failed to extract text from PDF: ' + error.message));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read PDF file'));
      reader.readAsArrayBuffer(file);
    });
  };

  const parsePartsTable = (text) => {
    const lines = text.trim().split('\n');
    const rows = [];
    const headers = ['NO', 'PART CODE', 'PART NAME', 'QUANTITY'];

    let startIndex = -1;
    let headerFound = false;

    // Find the exact header row containing key header words
    // Be flexible with spacing (e.g., "C ODE" or "CODE")
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i].toUpperCase();
      // Look for line that has most required headers
      // Need at least: NO, PART, NAME, QUANTITY
      // CODE might be split as "C ODE" so make it optional
      const hasNo = line.includes('NO');
      const hasPart = line.includes('PART');
      const hasName = line.includes('NAME');
      const hasQuantity = line.includes('QUANTITY') || line.includes('QTY');
      const hasCode = line.includes('CODE') || (line.includes('C') && line.includes('ODE'));

      if (hasNo && hasPart && hasName && hasQuantity) {
        startIndex = i + 1;
        headerFound = true;
        break;
      }
    }

    if (!headerFound) {
      return { headers, rows: [] };
    }

    // Parse data rows - only lines that look like table data
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line || line.length < 5) continue;

      // Skip separator lines
      if (line.match(/^[-=_]+$/)) continue;

      // Stop if we hit obvious non-table content (page numbers, etc.)
      if (line.match(/^\d+-\s*\d+-\d+$/)) break; // Page numbers like "40- 2-1"
      if (line.match(/^page\s+\d+/i)) break;

      // Check if line starts with a number or bullet - these are table rows
      // Be more flexible - check if line starts with digit or bullet, but allow no space after
      const startsWithRowNumber = line.match(/^(\d+|•)/);
      if (!startsWithRowNumber) continue;

      console.log('Found potential row:', line);

      // Try to parse this line more intelligently
      // Look for the part code pattern first
      const partCodeMatch = line.match(/(\d{3}-\d{3}-\d{4}-\d{2})/);

      let no = '', partCode = '', partName = '', quantity = '';

      if (partCodeMatch) {
        // Found a part code - use it as anchor
        const beforeCode = line.substring(0, partCodeMatch.index).trim();
        const afterCode = line.substring(partCodeMatch.index + partCodeMatch[0].length).trim();

        // Extract NO from before code
        no = beforeCode.match(/^(\d+|•)/)?.[0] || '';

        partCode = partCodeMatch[0];

        // Split what's after the code by multiple spaces
        const afterFields = afterCode.split(/\s{2,}/).map(f => f.trim()).filter(f => f);
        partName = afterFields[0] || '';
        quantity = afterFields[1] || '';
      } else {
        // No part code found - try simpler split
        const fields = line.split(/\s{2,}/).map(f => f.trim()).filter(f => f);
        no = fields[0] || '';
        partName = fields[1] || '';
        quantity = fields[2] || '';
      }

      const row = {
        'NO': no,
        'PART CODE': partCode,
        'PART NAME': partName,
        'QUANTITY': quantity
      };
      rows.push(row);
    }

    return { headers, rows };
  };

  const parsePastedText = (text) => {
    const lines = text.trim().split('\n').map(line => line.trim()).filter(line => line);
    const rows = [];
    const headers = ['NO', 'PART CODE', 'PART NAME', 'QUANTITY'];

    // Process in groups of 4 lines:
    // Line 1: Part number (NO)
    // Line 2: Part code (ANY format - always treat as part code)
    // Line 3: Part name
    // Line 4: Quantity

    for (let i = 0; i < lines.length; i += 4) {
      // Check if we have enough lines for a complete entry
      if (i + 3 >= lines.length) {
        break;
      }

      const no = lines[i].replace(/^[●○•]/, '').trim(); // Remove bullet if present
      const partCode = lines[i + 1].trim(); // Line 2 is ALWAYS the part code
      const partName = lines[i + 2].trim();
      const quantity = lines[i + 3].trim();

      // Validate that we have at least a part code (line 2)
      if (!partCode) continue;

      const row = {
        'NO': no || (rows.length + 1).toString(), // Use sequential numbering if no number provided
        'PART CODE': partCode,
        'PART NAME': partName || 'N/A',
        'QUANTITY': quantity || '1'
      };
      rows.push(row);
    }

    return { headers, rows };
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setPdfFile(file);
    setError(null);
    setIsProcessing(true);

    try {
      const { text } = await extractTextFromPDF(file);
      console.log('Extracted text (first 1000 chars):', text.substring(0, 1000));

      const { headers, rows } = parsePartsTable(text);
      console.log('Parsed rows:', rows.length, rows);

      if (rows.length === 0) {
        throw new Error('No table data found in PDF. Please ensure the PDF contains a properly formatted parts table.');
      }

      setExtractedData({ headers, rows });
    } catch (err) {
      setError(err.message);
      setExtractedData(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadCSV = () => {
    if (!extractedData) return;

    const { headers, rows } = extractedData;

    // Create CSV content
    let csvContent = headers.join(',') + '\n';
    rows.forEach(row => {
      const values = headers.map(header => {
        const value = row[header] || '';
        // Quote values that contain commas
        return value.includes(',') ? `"${value}"` : value;
      });
      csvContent += values.join(',') + '\n';
    });

    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // Use appropriate filename based on input mode
    const filename = pdfFile
      ? pdfFile.name.replace('.pdf', '_parts_list.csv')
      : `parts_list_${new Date().getTime()}.csv`;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleTextPaste = () => {
    if (!pastedText.trim()) {
      setError('Please paste some text first');
      return;
    }

    setError(null);
    setIsProcessing(true);

    try {
      console.log('Processing pasted text...');
      const { headers, rows } = parsePastedText(pastedText);
      console.log('Parsed rows:', rows.length);
      console.log('Sample row:', rows[0]);
      console.log('All rows:', rows);

      if (rows.length === 0) {
        throw new Error('No valid parts data found. Please ensure the text follows the 4-line format:\n\nLine 1: Part Number\nLine 2: Part Code\nLine 3: Part Name\nLine 4: Quantity');
      }

      setExtractedData({ headers, rows });
      console.log('Data set to state:', { headers, rows });
    } catch (err) {
      setError(err.message);
      setExtractedData(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const updateCellValue = (rowIndex, header, newValue) => {
    setExtractedData(prev => {
      const newRows = [...prev.rows];
      newRows[rowIndex] = {
        ...newRows[rowIndex],
        [header]: newValue
      };
      return {
        ...prev,
        rows: newRows
      };
    });
  };

  const addNewRow = () => {
    setExtractedData(prev => {
      const newRowNumber = prev.rows.length + 1;
      const newRow = {
        'NO': newRowNumber.toString(),
        'PART CODE': '',
        'PART NAME': '',
        'QUANTITY': '1'
      };
      return {
        ...prev,
        rows: [...prev.rows, newRow]
      };
    });
  };

  const deleteRow = (rowIndex) => {
    setExtractedData(prev => {
      const newRows = prev.rows.filter((_, index) => index !== rowIndex);
      // Renumber rows
      const renumberedRows = newRows.map((row, index) => ({
        ...row,
        'NO': (index + 1).toString()
      }));
      return {
        ...prev,
        rows: renumberedRows
      };
    });
  };

  const clearAll = () => {
    setPdfFile(null);
    setExtractedData(null);
    setError(null);
    setIsProcessing(false);
    setPastedText('');
    // Reset file input
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) fileInput.value = '';
  };

  return (
    <div style={{ padding: '20px', backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '20px', color: '#333' }}>
          PDF to CSV Converter
        </h1>
        <p style={{ textAlign: 'center', color: '#666', marginBottom: '30px' }}>
          Upload a PDF containing a parts list table, and download it as CSV
        </p>

        {/* Input Mode Toggle */}
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button
              onClick={() => {
                setInputMode('pdf');
                setError(null);
              }}
              style={{
                padding: '12px 24px',
                backgroundColor: inputMode === 'pdf' ? '#2196f3' : '#e0e0e0',
                color: inputMode === 'pdf' ? 'white' : '#333',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                transition: 'all 0.3s ease'
              }}
            >
              Upload PDF
            </button>
            <button
              onClick={() => {
                setInputMode('text');
                setError(null);
              }}
              style={{
                padding: '12px 24px',
                backgroundColor: inputMode === 'text' ? '#2196f3' : '#e0e0e0',
                color: inputMode === 'text' ? 'white' : '#333',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                transition: 'all 0.3s ease'
              }}
            >
              Paste Text
            </button>
          </div>
        </div>

        {/* Upload/Paste Section */}
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '8px',
          padding: '30px',
          marginBottom: '20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}>
          {inputMode === 'pdf' ? (
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                marginBottom: '10px',
                fontWeight: 'bold',
                color: '#555',
                fontSize: '16px'
              }}>
                Select PDF File:
              </label>
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px dashed #2196f3',
                  borderRadius: '8px',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                marginBottom: '10px',
                fontWeight: 'bold',
                color: '#555',
                fontSize: '16px'
              }}>
                Paste Text from PDF:
              </label>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste your parts list text here...&#10;&#10;Expected format (4 lines per part):&#10;1. Part Number (e.g., • or 2)&#10;2. Part Code (e.g., 000-128-2893-16)&#10;3. Part Name (e.g., MAIN BODY UNIT::HIGHSPEED)&#10;4. Quantity (e.g., 1)"
                style={{
                  width: '100%',
                  minHeight: '300px',
                  padding: '12px',
                  border: '2px solid #2196f3',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'monospace',
                  resize: 'vertical'
                }}
              />
              <button
                onClick={handleTextPaste}
                style={{
                  marginTop: '12px',
                  padding: '12px 24px',
                  backgroundColor: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}
              >
                Convert to CSV
              </button>
            </div>
          )}

          {isProcessing && (
            <div style={{
              textAlign: 'center',
              padding: '20px',
              color: '#2196f3',
              fontSize: '16px'
            }}>
              Processing PDF...
            </div>
          )}

          {error && (
            <div style={{
              backgroundColor: '#ffebee',
              border: '1px solid #f44336',
              borderRadius: '6px',
              padding: '15px',
              color: '#c62828',
              marginTop: '15px'
            }}>
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>

        {/* Preview Section */}
        {extractedData && (
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '8px',
            padding: '30px',
            marginBottom: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <h2 style={{ margin: 0, color: '#333' }}>
                Extracted Data ({extractedData.rows.length} rows)
              </h2>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  onClick={addNewRow}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#2196f3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}
                >
                  ➕ Add Row
                </button>
                {onImportToViewer && (
                  <button
                    onClick={() => {
                      if (window.confirm('Upload this parts list to the Parts Viewer?\n\nYou can add it to an existing diagram or create a new one.')) {
                        onImportToViewer(extractedData);
                      }
                    }}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#9c27b0',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '14px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }}
                  >
                    📤 Upload to Parts Viewer
                  </button>
                )}
                <button
                  onClick={downloadCSV}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}
                >
                  📥 Download CSV
                </button>
                <button
                  onClick={clearAll}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}
                >
                  🗑️ Clear
                </button>
              </div>
            </div>

            <div style={{
              maxHeight: '500px',
              overflow: 'auto',
              border: '1px solid #ddd',
              borderRadius: '6px'
            }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px'
              }}>
                <thead style={{
                  position: 'sticky',
                  top: 0,
                  backgroundColor: '#2196f3',
                  color: 'white',
                  zIndex: 1
                }}>
                  <tr>
                    {extractedData.headers.map((header, index) => (
                      <th key={index} style={{
                        padding: '12px',
                        textAlign: 'left',
                        border: '1px solid #ddd',
                        fontWeight: 'bold'
                      }}>
                        {header}
                      </th>
                    ))}
                    <th style={{
                      padding: '12px',
                      textAlign: 'center',
                      border: '1px solid #ddd',
                      fontWeight: 'bold'
                    }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {extractedData.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} style={{
                      backgroundColor: rowIndex % 2 === 0 ? '#f9f9f9' : 'white'
                    }}>
                      {extractedData.headers.map((header, colIndex) => {
                        const columnWidths = {
                          'NO': '60px',
                          'PART CODE': '180px',
                          'PART NAME': '300px',
                          'QUANTITY': '100px'
                        };
                        return (
                          <td key={colIndex} style={{
                            padding: '8px',
                            border: '1px solid #ddd',
                            color: '#333',
                            minWidth: columnWidths[header] || '100px'
                          }}>
                            <input
                              type="text"
                              value={row[header] || ''}
                              onChange={(e) => updateCellValue(rowIndex, header, e.target.value)}
                              style={{
                                width: '100%',
                                padding: '6px',
                                border: '1px solid #ccc',
                                borderRadius: '4px',
                                fontSize: '13px',
                                backgroundColor: 'white',
                                color: '#333'
                              }}
                            />
                          </td>
                        );
                      })}
                      <td style={{
                        padding: '8px',
                        border: '1px solid #ddd',
                        textAlign: 'center'
                      }}>
                        <button
                          onClick={() => deleteRow(rowIndex)}
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
                          title="Delete this row"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '8px',
          padding: '20px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ color: '#333', marginBottom: '15px' }}>How to Use:</h3>

          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ color: '#555', marginBottom: '10px' }}>Option 1: Upload PDF</h4>
            <ol style={{ color: '#666', lineHeight: '1.8' }}>
              <li>Click "Upload PDF" button</li>
              <li>Select a PDF file containing a parts list table</li>
              <li>The tool will automatically extract the table data</li>
              <li>Review and edit the data in the preview table</li>
              <li>Click "Download CSV" to save the data as a CSV file</li>
            </ol>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ color: '#555', marginBottom: '10px' }}>Option 2: Paste Text</h4>
            <ol style={{ color: '#666', lineHeight: '1.8' }}>
              <li>Click "Paste Text" button</li>
              <li>Copy text from your PDF (select all and copy)</li>
              <li>Paste into the text area</li>
              <li>Click "Convert to CSV"</li>
              <li>Review and edit the extracted data</li>
              <li>Click "Download CSV" to save</li>
            </ol>
            <div style={{
              backgroundColor: '#e3f2fd',
              padding: '12px',
              borderRadius: '6px',
              marginTop: '10px',
              fontSize: '13px',
              color: '#1976d2'
            }}>
              <strong>Text Format:</strong> Each part should be on 4 separate lines:
              <br/>1. Part Number (e.g., • or 2)
              <br/>2. Part Code (e.g., 000-128-2893-16)
              <br/>3. Part Name (e.g., MAIN BODY UNIT)
              <br/>4. Quantity (e.g., 1)
            </div>
          </div>

          <div style={{
            backgroundColor: '#fff3cd',
            padding: '16px',
            borderRadius: '6px',
            marginBottom: '20px',
            fontSize: '14px',
            color: '#856404',
            border: '1px solid #ffc107'
          }}>
            <strong>💡 Editing Features:</strong>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px', lineHeight: '1.8' }}>
              <li>Click any cell to edit its value (including part numbers)</li>
              <li>Use "➕ Add Row" to add new parts manually</li>
              <li>Use "✕" button on each row to delete unwanted entries</li>
              <li>All changes are saved in real-time and included in the CSV download</li>
            </ul>
          </div>

          <h3 style={{ color: '#333', marginTop: '20px', marginBottom: '15px' }}>Supported PDF Formats:</h3>
          <ul style={{ color: '#666', lineHeight: '1.8' }}>
            <li>Tables with clear column headers (NO, PART CODE, PART NAME, QUANTITY, etc.)</li>
            <li>Space-separated tables</li>
            <li>Comma-separated tables</li>
            <li>Pipe-delimited tables (|)</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default PdfToCsvConverter;

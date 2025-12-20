import { useState, useRef } from 'react';
import Tesseract from 'tesseract.js';

const BatchOCR = ({ darkMode }) => {
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState([]);
  const [currentFile, setCurrentFile] = useState('');
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    const imageFiles = selectedFiles.filter(file =>
      file.type.startsWith('image/')
    );

    if (imageFiles.length === 0) {
      alert('Please select image files (JPG, PNG, etc.)');
      return;
    }

    setFiles(imageFiles);
    setResults([]);
  };

  const processFiles = async () => {
    if (files.length === 0) {
      alert('Please select files first');
      return;
    }

    setProcessing(true);
    setResults([]);

    const ocrResults = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setCurrentFile(`Processing ${i + 1} of ${files.length}: ${file.name}`);
      setProgress(0);

      try {
        const { data: { text } } = await Tesseract.recognize(
          file,
          'eng',
          {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                setProgress(Math.round(m.progress * 100));
              }
            }
          }
        );

        ocrResults.push({
          filename: file.name,
          success: true,
          text: text.trim(),
          lines: text.trim().split('\n').length
        });

      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        ocrResults.push({
          filename: file.name,
          success: false,
          error: error.message
        });
      }
    }

    setResults(ocrResults);
    setProcessing(false);
    setCurrentFile('');
    setProgress(0);
  };

  const downloadAsText = () => {
    const textContent = results
      .filter(r => r.success)
      .map(r => `=== ${r.filename} ===\n${r.text}\n\n`)
      .join('');

    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ocr-results.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAsCSV = () => {
    const csvContent = [
      ['Filename', 'Text'],
      ...results
        .filter(r => r.success)
        .map(r => [r.filename, `"${r.text.replace(/"/g, '""')}"`])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ocr-results.csv';
    a.click();
    URL.revokeObjectURL(url);
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
      <h2 style={{ marginTop: 0 }}>Batch OCR Processor</h2>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
          Select Image Files (JPG, PNG, etc.):
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          style={inputStyle}
        />
        {files.length > 0 && (
          <div style={{ marginTop: '10px', color: '#4caf50', fontWeight: 'bold' }}>
            ✓ {files.length} file{files.length !== 1 ? 's' : ''} selected
          </div>
        )}
      </div>

      <button
        onClick={processFiles}
        disabled={files.length === 0 || processing}
        style={{
          padding: '15px 30px',
          backgroundColor: processing ? '#666' : '#2196f3',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: processing ? 'not-allowed' : 'pointer',
          width: '100%',
          marginBottom: '20px'
        }}
      >
        {processing ? '🔄 Processing OCR...' : `🔍 Process ${files.length} File${files.length !== 1 ? 's' : ''}`}
      </button>

      {processing && (
        <div style={{
          marginBottom: '20px',
          padding: '15px',
          backgroundColor: darkMode ? '#333' : '#f0f0f0',
          borderRadius: '8px'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '10px' }}>
            {currentFile}
          </div>
          <div style={{
            width: '100%',
            height: '20px',
            backgroundColor: darkMode ? '#444' : '#e0e0e0',
            borderRadius: '10px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              backgroundColor: '#2196f3',
              transition: 'width 0.3s ease'
            }} />
          </div>
          <div style={{ textAlign: 'center', marginTop: '5px', fontSize: '14px' }}>
            {progress}%
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: '30px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px'
          }}>
            <h3 style={{ margin: 0 }}>OCR Results:</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={downloadAsText}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '13px'
                }}
              >
                📄 Download TXT
              </button>
              <button
                onClick={downloadAsCSV}
                style={{
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
                📊 Download CSV
              </button>
            </div>
          </div>

          <div style={{
            backgroundColor: darkMode ? '#333' : '#f9f9f9',
            padding: '20px',
            borderRadius: '8px',
            maxHeight: '600px',
            overflowY: 'auto'
          }}>
            {results.map((result, index) => (
              <div
                key={index}
                style={{
                  padding: '12px',
                  marginBottom: '10px',
                  backgroundColor: result.success
                    ? (darkMode ? '#1b4d2f' : '#d4edda')
                    : (darkMode ? '#4d1b1b' : '#f8d7da'),
                  borderRadius: '6px',
                  borderLeft: result.success ? '4px solid #4caf50' : '4px solid #f44336'
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                  {result.success ? '✓' : '✗'} {result.filename}
                </div>
                {result.success ? (
                  <>
                    <div style={{ fontSize: '12px', color: darkMode ? '#aaa' : '#666', marginBottom: '8px' }}>
                      {result.lines} lines extracted
                    </div>
                    <div style={{
                      fontSize: '13px',
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      backgroundColor: darkMode ? '#2a2a2a' : '#fff',
                      padding: '10px',
                      borderRadius: '4px',
                      maxHeight: '200px',
                      overflowY: 'auto'
                    }}>
                      {result.text || '(No text detected)'}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '14px', color: darkMode ? '#ff8a80' : '#d32f2f' }}>
                    Error: {result.error}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{
            marginTop: '15px',
            padding: '12px',
            backgroundColor: darkMode ? '#444' : '#e0e0e0',
            borderRadius: '6px',
            fontWeight: 'bold',
            textAlign: 'center'
          }}>
            {results.filter(r => r.success).length} successful / {results.length} total files
          </div>
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
          <li>Select multiple image files (JPG, PNG, etc.) containing text</li>
          <li>Click "Process Files" to run OCR on all of them</li>
          <li>Review the extracted text for each file</li>
          <li>Download results as TXT (all text combined) or CSV (filename + text)</li>
        </ol>
        <p style={{ marginTop: '12px', fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>
          <strong>Tip:</strong> For best OCR results, use clear, high-contrast images with readable text. Parts lists work great!
        </p>
      </div>
    </div>
  );
};

export default BatchOCR;

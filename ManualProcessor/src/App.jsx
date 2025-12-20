import { useState } from 'react';
import ManualProcessor from './components/ManualProcessor';
import BatchOCR from './components/BatchOCR';
import './App.css';

function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [currentView, setCurrentView] = useState('processor'); // 'processor' | 'ocr'

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
      color: darkMode ? '#fff' : '#333',
      padding: '20px'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '30px'
        }}>
          <h1 style={{ margin: 0 }}>Parts Manual Auto-Processor</h1>
          <button
            onClick={() => setDarkMode(!darkMode)}
            style={{
              padding: '10px 20px',
              backgroundColor: darkMode ? '#444' : '#ddd',
              color: darkMode ? '#fff' : '#333',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          gap: '10px',
          marginBottom: '20px',
          justifyContent: 'center'
        }}>
          <button
            onClick={() => setCurrentView('processor')}
            style={{
              padding: '12px 24px',
              backgroundColor: currentView === 'processor' ? '#2196f3' : (darkMode ? '#333' : '#e0e0e0'),
              color: currentView === 'processor' ? 'white' : (darkMode ? '#fff' : '#333'),
              border: darkMode ? '1px solid #555' : 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '14px',
              transition: 'all 0.3s ease'
            }}
          >
            📦 PDF Processor
          </button>
          <button
            onClick={() => setCurrentView('ocr')}
            style={{
              padding: '12px 24px',
              backgroundColor: currentView === 'ocr' ? '#2196f3' : (darkMode ? '#333' : '#e0e0e0'),
              color: currentView === 'ocr' ? 'white' : (darkMode ? '#fff' : '#333'),
              border: darkMode ? '1px solid #555' : 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '14px',
              transition: 'all 0.3s ease'
            }}
          >
            🔍 Batch OCR
          </button>
        </div>

        {/* Conditional Rendering */}
        {currentView === 'processor' ? (
          <ManualProcessor darkMode={darkMode} />
        ) : (
          <BatchOCR darkMode={darkMode} />
        )}
      </div>
    </div>
  );
}

export default App;

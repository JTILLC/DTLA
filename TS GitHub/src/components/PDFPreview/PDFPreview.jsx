import React from 'react';

function PDFPreview({ pdfDataUrl }) {
  return (
    <iframe
      src={pdfDataUrl}
      title="PDF Preview"
      style={{ width: '800px', height: '800px', border: 'none' }}
    />
  );
}

export default PDFPreview;
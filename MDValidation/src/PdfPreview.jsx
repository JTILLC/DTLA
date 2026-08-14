import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// Renders every page of the PDF to a scrollable stack of canvases.
// Reliable on mobile (iframe PDF preview only shows page 1 there).
export default function PdfPreview({ bytes }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    let pdf;

    (async () => {
      try {
        pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        const width = container.clientWidth || 600;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const frag = document.createDocumentFragment();

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i); // eslint-disable-line no-await-in-loop
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = ((width - 16) / base.width) * dpr;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'pdfpage';
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; // eslint-disable-line no-await-in-loop
          if (cancelled) return;
          frag.appendChild(canvas);
        }
        container.innerHTML = '';
        container.appendChild(frag);
      } catch (err) {
        console.error('PDF preview render failed:', err);
      }
    })();

    return () => { cancelled = true; if (pdf) pdf.destroy?.(); };
  }, [bytes]);

  return <div className="pdfcanvas" ref={containerRef} />;
}

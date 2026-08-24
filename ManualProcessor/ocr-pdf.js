import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from 'canvas';
import Tesseract from 'tesseract.js';
import fs from 'fs';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node ocr-pdf.js <path-to-pdf>');
  process.exit(1);
}

console.log(`Processing PDF: ${pdfPath}\n`);

// Load PDF
const data = new Uint8Array(fs.readFileSync(pdfPath));
const loadingTask = pdfjsLib.getDocument({ data });
const pdf = await loadingTask.promise;

console.log(`Total pages: ${pdf.numPages}\n`);

let allText = '';

for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
  console.log(`Processing page ${pageNum}/${pdf.numPages}...`);

  const page = await pdf.getPage(pageNum);

  // Try to extract text first
  const textContent = await page.getTextContent();
  const pageText = textContent.items.map(item => item.str).join(' ').trim();

  if (pageText.length > 50) {
    // Page has text, use it
    console.log(`  ✓ Extracted ${pageText.length} characters from text layer`);
    allText += `\n--- Page ${pageNum} ---\n${pageText}\n`;
  } else {
    // Page is image-based, run OCR
    console.log(`  🔍 Running OCR (image-based page)...`);

    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    const { data: { text } } = await Tesseract.recognize(
      canvas.toBuffer(),
      'eng',
      {
        logger: m => {
          if (m.status === 'recognizing text') {
            process.stdout.write(`\r  OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      }
    );

    console.log(`\n  ✓ Extracted ${text.length} characters via OCR`);
    allText += `\n--- Page ${pageNum} (OCR) ---\n${text.trim()}\n`;
  }
}

// Save to file
const outputPath = pdfPath.replace('.pdf', '-extracted.txt');
fs.writeFileSync(outputPath, allText);

console.log(`\n✅ Done! Text saved to: ${outputPath}`);
console.log(`Total characters extracted: ${allText.length}`);

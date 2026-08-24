import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.cjs';
import Tesseract from 'tesseract.js';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node ocr-pdf-simple.js <path-to-pdf>');
  process.exit(1);
}

console.log(`Processing PDF: ${pdfPath}\n`);

// Use pdftoppm to convert PDF to images (part of poppler-utils)
const baseName = pdfPath.replace(/\.pdf$/i, '');
const tempDir = '/tmp/pdf-ocr-' + Date.now();

try {
  // Create temp directory
  fs.mkdirSync(tempDir);

  console.log('Converting PDF to images...');
  await execAsync(`pdftoppm -png "${pdfPath}" "${tempDir}/page"`);

  // Get list of generated images
  const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.png')).sort();

  console.log(`Found ${files.length} pages\n`);

  let allText = '';

  for (let i = 0; i < files.length; i++) {
    const pageNum = i + 1;
    const imagePath = `${tempDir}/${files[i]}`;

    console.log(`Processing page ${pageNum}/${files.length}...`);

    const { data: { text } } = await Tesseract.recognize(
      imagePath,
      'eng',
      {
        logger: m => {
          if (m.status === 'recognizing text') {
            process.stdout.write(`\r  OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      }
    );

    console.log(`\n  ✓ Extracted ${text.length} characters`);
    allText += `\n--- Page ${pageNum} ---\n${text.trim()}\n`;
  }

  // Save to file
  const outputPath = baseName + '-extracted.txt';
  fs.writeFileSync(outputPath, allText);

  // Cleanup
  fs.rmSync(tempDir, { recursive: true });

  console.log(`\n✅ Done! Text saved to: ${outputPath}`);
  console.log(`Total characters extracted: ${allText.length}`);

} catch (error) {
  console.error('Error:', error.message);
  if (error.message.includes('pdftoppm')) {
    console.error('\nPlease install poppler-utils:');
    console.error('  brew install poppler');
  }
  process.exit(1);
}

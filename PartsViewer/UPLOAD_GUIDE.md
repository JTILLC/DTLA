# Parts Viewer Upload Guide

## Overview
The Interactive Parts Diagram Viewer now supports uploading multiple diagrams with their parts lists. Each diagram can be saved, exported, and managed independently.

## How to Upload a New Diagram

1. Click the "+ New Diagram" button in the top bar
2. Fill out the upload form:
   - **Diagram Name**: Give your diagram a descriptive name (e.g., "Drive Weigh Unit 4D-33519")
   - **PDF File**: Select the exploded view PDF diagram
   - **Parts List**: Select your parts list file (CSV, TXT, or PDF format)

3. Click "Upload Diagram"

## Parts List File Formats

The system accepts parts lists in multiple formats:

### CSV/TXT Format (Recommended)

Your parts list file should follow this format:

```csv
PartNo,PartCode,PartName,Qty,PMST
1,000-112-2575-00,LINK:WH:1,1,3
2,000-112-2574-06,LINK:PH:1,1,3
3,000-111-9517-01,SLIT:PH:,1,3
```

### Column Definitions:

- **PartNo**: The reference number shown on the diagram (1, 2, 3, etc.)
- **PartCode**: The manufacturer part code
- **PartName**: Description of the part
- **Qty**: Quantity required
- **PMST**: Part management status (optional, defaults to "3")

### Important Notes:

- The first row should be a header row (automatically detected)
- Fields containing commas should be quoted (e.g., "VALVE, BALL")
- Part numbers should be sequential and match the callouts in your PDF
- The PMST column is optional and will default to "3" if not provided

### PDF Format

If your parts list is in PDF format:
- The system will automatically extract text from the PDF
- Works with both comma-separated and space-separated table formats
- Example formats supported:
  - `1  000-112-2575-00  LINK:WH:1  1  3`
  - `1, 000-112-2575-00, LINK:WH:1, 1, 3`

**Important**: If your PDF is image-based (scanned), text extraction won't work. In this case:
- Convert your PDF to CSV format first
- Or manually type the parts list into a CSV file

### DOC/DOCX Format

For Word documents:
1. Open the document in Word or Google Docs
2. Go to File > Save As
3. Select PDF format
4. Upload the resulting PDF file

The system will extract the text and parse it automatically.

## After Upload

1. **Place Hotspots**: Click "Edit Positions" to manually place clickable hotspots over the part numbers in your PDF
2. **Export Diagram**: Use the ⬇ button to export your diagram configuration as JSON for backup
3. **Import Diagram**: Use the "Import" button to load a previously exported diagram

## Managing Diagrams

- **Switch Diagrams**: Click any diagram name in the top bar to view it
- **Delete Diagram**: Click the ✕ button next to a diagram name
- **Export/Import**: Use the ⬇ and Import buttons to backup and restore diagrams

## Features

- Click parts to add them to your order list
- Hover over parts to see detailed information
- Adjust quantities in the order list
- Export diagram configurations for sharing or backup
- All data is saved in browser localStorage

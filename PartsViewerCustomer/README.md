# Parts Manual Viewer (Customer App)

A standalone web application for customers to view parts manuals and create parts orders.

## Features

- **View Parts Diagrams**: Interactive diagrams with clickable hotspots
- **Parts Ordering**: Click parts to add to order list, export as PDF
- **Import/Export**: JSON backup and restore functionality
- **Dark/Light Mode**: Toggle between dark and light themes
- **No Backend Required**: Fully standalone, runs in browser

## Setup

1. Install dependencies:
```bash
npm install
```

2. Run development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

## Usage

### For Customers

1. **Import Parts Manual**:
   - Click "📤 Import Diagrams" button
   - Select the JSON file provided by your supplier
   - All diagrams will load automatically

2. **View Diagrams**:
   - Select a folder from the sidebar
   - Click on a diagram to view it
   - Interactive hotspots show part information

3. **Create Parts Order**:
   - Click on parts in diagrams to add to order
   - Click again to increase quantity
   - Right-click to decrease/remove
   - Click "📄 Export Order" to download PDF

4. **Backup Your Data**:
   - Click "📥 Export Backup" to save current state
   - Import this file later to restore

### For Suppliers

1. **Export from Main App**:
   - In the main PartsViewer app, select a customer
   - Click "📥 Export Customer"
   - Send the JSON file to your customer

2. **Deploy to Customer**:
   - Build this app: `npm run build`
   - **Option A**: Deploy `dist` folder to web hosting (Netlify, Vercel, GitHub Pages)
   - **Option B**: Zip and send `dist` folder to customer for local use (open `index.html` in browser)

## Data Storage

- All data is stored in browser's localStorage
- No server or database required
- Data persists between sessions
- Export JSON for backup/transfer

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- No Internet Explorer support
- JavaScript must be enabled

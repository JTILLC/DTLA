import React, { useState, useRef } from 'react';

// Determine section name based on line number (must match MainLogger)
const getSectionForLine = (num) => {
  if (num >= 1 && num <= 7) return 'PC Line';
  if (num >= 8 && num <= 10) return 'Pellet Line';
  if (num >= 11 && num <= 16) return 'Extruded';
  if (num >= 17 && num <= 23) return 'Hand Kettle';
  if (num >= 24 && num <= 31) return 'Twin Screw';
  if (num >= 32 && num <= 37) return 'Sheeted 1';
  return 'Sheeted 2';
};

// Static list of lines 1–39
const totalLines = 39;
const lineList = Array.from({ length: totalLines }, (_, i) => ({
  name: `Line ${i + 1}`,
  section: getSectionForLine(i + 1)
}));

export default function Summary({ data, dates, selectedDay, setSelectedDay }) {
  const [filterLine, setFilterLine] = useState('All Lines');
  const [filterIssue, setFilterIssue] = useState('All Issues');
  const [filterHead, setFilterHead] = useState('All Heads');
  const [importedRows, setImportedRows] = useState(null);
  const fileInputRef = useRef();

  const handleDayChange = (e) => setSelectedDay(e.target.value);

  // Build summary rows for the chosen day
  const summaryRowsByDay = lineList.reduce((acc, line) => {
    dates.forEach(day => {
      if (day.date !== selectedDay) return;
      const entry = data[line.name]?.[day.date];
      const heads = Array.isArray(entry?.heads) ? entry.heads : [];
      const offline = heads.filter(h => h.offline === 'Offline');
      if (!offline.length) return;
      const issues = offline.map(h => `Head ${h.head}: ${h.issue} (${h.repaired})`).join('; ');
      acc.push({
        line: line.name,
        section: line.section,
        date: day.date,
        offlineHeads: offline.map(h => h.head).join(', '),
        issues
      });
    });
    return acc;
  }, []);

  // Build summary rows for all days
  const summaryRowsAll = lineList.reduce((acc, line) => {
    dates.forEach(day => {
      const entry = data[line.name]?.[day.date];
      const heads = Array.isArray(entry?.heads) ? entry.heads : [];
      const offline = heads.filter(h => h.offline === 'Offline');
      if (!offline.length) return;
      const issues = offline.map(h => `Head ${h.head}: ${h.issue} (${h.repaired})`).join('; ');
      acc.push({
        line: line.name,
        section: line.section,
        date: day.date,
        offlineHeads: offline.map(h => h.head).join(', '),
        issues
      });
    });
    return acc;
  }, []);

  const baseRows = selectedDay === 'All Days' ? summaryRowsAll : summaryRowsByDay;
  const displayRows = importedRows || baseRows.filter(row => {
    const matchLine = filterLine === 'All Lines' || row.line === filterLine;
    const matchIssue = filterIssue === 'All Issues' || row.issues.includes(filterIssue);
    const matchHead = filterHead === 'All Heads' || row.offlineHeads.split(', ').includes(filterHead);
    return matchLine && matchIssue && matchHead;
  });

  // Export / Import helpers
  const exportJSON = (rows, filename) => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };
  const exportDay = () => exportJSON(summaryRowsByDay, `summary_${selectedDay}.json`);
  const exportAll = () => exportJSON(summaryRowsAll, 'summary_all.json');

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try { setImportedRows(JSON.parse(ev.target.result)); }
      catch { alert('Invalid JSON file.'); }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4">
      {/* Export / Import Controls */}
      <div className="flex gap-2">
        <button onClick={exportDay} className="bg-blue-500 text-white px-4 py-2 rounded">Export Day JSON</button>
        <button onClick={exportAll} className="bg-blue-500 text-white px-4 py-2 rounded">Export All JSON</button>
        <button onClick={() => fileInputRef.current.click()} className="bg-green-500 text-white px-4 py-2 rounded">Import JSON</button>
        <input type="file" accept=".json" ref={fileInputRef} onChange={handleImport} className="hidden" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div>
          <label className="block text-sm font-medium">Filter by Line</label>
          <select value={filterLine} onChange={e => setFilterLine(e.target.value)} className="border rounded p-2">
            <option>All Lines</option>
            {lineList.map(l => <option key={l.name}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Filter by Issue</label>
          <select value={filterIssue} onChange={e => setFilterIssue(e.target.value)} className="border rounded p-2">
            <option>All Issues</option>
            {[...new Set(baseRows.flatMap(r => r.issues.split('; ')))].filter(i => i).map(i => <option key={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Filter by Head</label>
          <select value={filterHead} onChange={e => setFilterHead(e.target.value)} className="border rounded p-2">
            <option>All Heads</option>
            {[...new Set(baseRows.flatMap(r => r.offlineHeads.split(', ')))].filter(h => h).map(h => <option key={h}>{h}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Select Day</label>
          <select value={selectedDay} onChange={handleDayChange} className="border rounded p-2">
            <option value="All Days">All Days</option>
            {dates.map(d => <option key={d.id} value={d.date}>{d.label} ({d.date})</option>)}
          </select>
        </div>
      </div>

      {/* Summary Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border">
          <thead className="bg-gray-200">
            <tr>
              <th className="px-4 py-2 text-left">Line</th>
              <th className="px-4 py-2 text-left">Section</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Offline Heads</th>
              <th className="px-4 py-2 text-left">Issues</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-4 py-2 text-center text-gray-600">No entries to display.</td>
              </tr>
            ) : displayRows.map((row, idx) => (
              <tr key={`${row.line}-${row.date}-${idx}`} className="border-t">
                <td className="px-4 py-2">{row.line}</td>
                <td className="px-4 py-2">{row.section}</td>
                <td className="px-4 py-2">{row.date}</td>
                <td className="px-4 py-2">{row.offlineHeads}</td>
                <td className="px-4 py-2">{row.issues}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

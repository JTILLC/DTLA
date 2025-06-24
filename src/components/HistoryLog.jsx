import React from 'react';
import Papa from 'papaparse';

export default function HistoryLog({
  historyLog,
  setHistoryLog,
  lines,
  selectedLine,
  setSelectedLine,
  selectedHead,
  setSelectedHead
}) {
  // Filtered entries based on selected filters
  const filtered = historyLog.filter(entry => {
    const matchLine = selectedLine === 'All Lines' || entry.line === selectedLine;
    const matchHead = selectedHead === 'All Heads' || entry.head.toString() === selectedHead;
    return matchLine && matchHead;
  });

  // Handlers
  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear all history? This cannot be undone.')) {
      setHistoryLog([]);
    }
  };

  const handleExport = () => {
    if (filtered.length === 0) {
      alert('No history entries to export.');
      return;
    }
    const csv = Papa.unparse(filtered.map(entry => ({
      Timestamp: new Date(entry.timestamp).toLocaleString(),
      Line: entry.line,
      Date: entry.date,
      Head: entry.head,
      Offline: entry.offline,
      Issue: entry.issue,
      Repaired: entry.repaired,
      Notes: entry.notes || 'N/A',
      Change: entry.change
    })));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'history_log.csv';
    link.click();
  };

  const handleDelete = (id) => {
    if (window.confirm('Delete this history entry?')) {
      setHistoryLog(prev => prev.filter(e => e.id !== id));
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-semibold mb-4">History Log</h2>
      <div className="flex flex-wrap gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium mb-1">Filter by Line</label>
          <select
            className="border rounded p-2"
            value={selectedLine}
            onChange={e => setSelectedLine(e.target.value)}
          >
            <option>All Lines</option>
            {lines.map(l => (
              <option key={l.name} value={l.name}>
                {l.section}: {l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Filter by Head</label>
          <select
            className="border rounded p-2"
            value={selectedHead}
            onChange={e => setSelectedHead(e.target.value)}
          >
            <option>All Heads</option>
            {Array.from({ length: 14 }, (_, i) => i + 1).map(head => (
              <option key={head} value={head}>{head}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button
            className="bg-red-500 text-white px-4 py-2 rounded"
            onClick={handleClear}
          >
            Clear History
          </button>
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded"
            onClick={handleExport}
          >
            Export CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border">
          <thead className="bg-gray-200">
            <tr>
              <th className="px-4 py-2">Timestamp</th>
              <th className="px-4 py-2">Line</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Head</th>
              <th className="px-4 py-2">Offline</th>
              <th className="px-4 py-2">Issue</th>
              <th className="px-4 py-2">Repaired</th>
              <th className="px-4 py-2">Notes</th>
              <th className="px-4 py-2">Change</th>
              <th className="px-4 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="10" className="px-4 py-2 text-center text-gray-600">
                  No history entries.
                </td>
              </tr>
            ) : (
              filtered.map(entry => (
                <tr key={entry.id} className="border-t">
                  <td className="px-4 py-2">{new Date(entry.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-2">{entry.line}</td>
                  <td className="px-4 py-2">{entry.date}</td>
                  <td className="px-4 py-2">{entry.head}</td>
                  <td className="px-4 py-2">{entry.offline}</td>
                  <td className="px-4 py-2">{entry.issue}</td>
                  <td className="px-4 py-2">{entry.repaired}</td>
                  <td className="px-4 py-2">{entry.notes || 'N/A'}</td>
                  <td className="px-4 py-2">{entry.change}</td>
                  <td className="px-4 py-2">
                    <button
                      className="bg-red-500 text-white px-2 py-1 rounded"
                      onClick={() => handleDelete(entry.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

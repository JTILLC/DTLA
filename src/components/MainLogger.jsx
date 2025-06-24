import React from 'react';

// Default head structure for each day if none exists
const defaultHeads = Array.from({ length: 14 }, (_, i) => ({
  head: i + 1,
  offline: 'Active',
  issue: 'None',
  repaired: 'N/A',
  notes: ''
}));

// Issue options
const issueTypes = [
  'None', 'Chute', 'Operator', 'Load Cell', 'Detached Head',
  'Stepper Motor Error', 'Hopper Issues', 'Installed Wrong'
];

// Determine section name based on line number
const getSectionForLine = (num) => {
  if (num >= 1 && num <= 7) return 'PC Line';
  if (num >= 8 && num <= 10) return 'Pellet Line';
  if (num >= 11 && num <= 16) return 'Extruded';
  if (num >= 17 && num <= 23) return 'Hand Kettle';
  if (num >= 24 && num <= 31) return 'Twin Screw';
  if (num >= 32 && num <= 37) return 'Sheeted 1';
  return 'Sheeted 2';
};

// Total number of lines
const totalLines = 39;

export default function MainLogger({
  data,
  setData,
  dates,
  setDates,
  currentLine,
  setCurrentLine,
  currentDay,
  setCurrentDay
}) {
  // Build static line list with proper section names
  const lineList = Array.from({ length: totalLines }, (_, i) => {
    const num = i + 1;
    return { name: `Line ${num}`, section: getSectionForLine(num) };
  });

  // Reset all handler
  const handleResetAll = () => {
    if (
      window.confirm(
        '⚠️ This will clear all saved dates, data, and history. Are you sure you want to reset?'
      )
    ) {
      localStorage.removeItem('downtimeLoggerDates');
      localStorage.removeItem('downtimeLoggerData');
      localStorage.removeItem('downtimeLoggerHistory');
      window.location.reload();
    }
  };

  // Determine running status
  const running = data[currentLine]?.running?.[currentDay] === 'Yes';

  // Toggle running state
  const toggleRunning = (e) => {
    const val = e.target.checked ? 'Yes' : 'No';
    setData(prev => {
      const newData = { ...prev };
      const lineData = { ...(newData[currentLine] || {}) };
      lineData.running = { ...(lineData.running || {}), [currentDay]: val };
      newData[currentLine] = lineData;
      return newData;
    });
  };

  // Update a specific date
  const updateDate = (idx, date) => {
    setDates(prev => prev.map((d, i) => i === idx ? { ...d, date } : d));
    setCurrentDay(dates[idx].date);
  };

  // Prev/Next line navigation
  const prevLine = () => {
    const idx = lineList.findIndex(l => l.name === currentLine);
    const prev = idx > 0 ? lineList[idx - 1].name : lineList[lineList.length - 1].name;
    setCurrentLine(prev);
  };
  const nextLine = () => {
    const idx = lineList.findIndex(l => l.name === currentLine);
    const nxt = idx < lineList.length - 1 ? lineList[idx + 1].name : lineList[0].name;
    setCurrentLine(nxt);
  };

  // Retrieve entry and heads
  const entry = data[currentLine]?.[currentDay] || {};
  const heads = Array.isArray(entry.heads) ? entry.heads : defaultHeads;
  const machineNotes = entry.machineNotes || '';

  // Handle head field changes
  const handleHeadChange = (idx, field, value) => {
    setData(prev => {
      const newData = { ...prev };
      const lineData = { ...(newData[currentLine] || {}) };
      const dayData = { heads: [...heads], machineNotes, ...(lineData[currentDay] || {}) };
      let updatedHead = { ...dayData.heads[idx], [field]: value };
      if (field === 'offline' && value === 'Active') {
        updatedHead = { ...updatedHead, issue: 'None', repaired: 'N/A', notes: '' };
      }
      if (field === 'issue' && value === 'None') {
        updatedHead = { ...updatedHead, repaired: 'N/A' };
      }
      dayData.heads[idx] = updatedHead;
      lineData[currentDay] = dayData;
      newData[currentLine] = lineData;
      return newData;
    });
  };

  // Handle machine notes change
  const handleNotesChange = (value) => {
    setData(prev => {
      const newData = { ...prev };
      const lineData = { ...(newData[currentLine] || {}) };
      lineData[currentDay] = { heads: [...heads], machineNotes: value };
      newData[currentLine] = lineData;
      return newData;
    });
  };

  // Row class based on status
  const getRowClass = (h) =>
    h.offline === 'Active' ? 'bg-green-500 text-white' :
    h.offline === 'Offline' && h.repaired === 'Fixed' ? 'bg-orange-500 text-white' :
    'bg-red-500 text-white';

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      {/* Reset Button */}
      <div className="flex justify-end mb-4">
        <button
          onClick={handleResetAll}
          className="bg-red-500 text-white px-4 py-2 rounded"
        >
          Reset All
        </button>
      </div>

      {/* Running Toggle */}
      <div className="flex items-center mb-4">
        <label className="mr-2 font-medium text-gray-800">Machine Running?</label>
        <input type="checkbox" checked={running} onChange={toggleRunning} />
      </div>

      {/* Manage Dates */}
      <div className="bg-gray-100 p-4 rounded mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {dates.map((d, idx) => (
            <input
              key={d.id}
              type="date"
              value={d.date}
              onChange={e => updateDate(idx, e.target.value)}
              className="border rounded p-2 text-gray-800"
            />
          ))}
        </div>
      </div>

      {/* Line/Day Navigation */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={prevLine} className="bg-gray-200 px-3 py-1 rounded">Prev Line</button>
        <select
          value={currentLine}
          onChange={e => setCurrentLine(e.target.value)}
          className="flex-grow border rounded p-2 text-gray-800"
        >
          {lineList.map(l => (
            <option key={l.name} value={l.name}>{l.name} ({l.section})</option>
          ))}
        </select>
        <button onClick={nextLine} className="bg-gray-200 px-3 py-1 rounded">Next Line</button>
        <select
          value={currentDay}
          onChange={e => setCurrentDay(e.target.value)}
          className="border rounded p-2 text-gray-800"
        >
          {dates.map(d => (
            <option key={d.id} value={d.date}>{d.label} ({d.date})</option>
          ))}
        </select>
      </div>

      {/* Head Status Table */}
      <table className="min-w-full bg-white border mb-4">
        <thead className="bg-gray-200 text-gray-800">
          <tr>
            <th className="px-4 py-2">Head</th>
            <th className="px-4 py-2">Offline</th>
            <th className="px-4 py-2">Issue</th>
            <th className="px-4 py-2">Repaired</th>
            <th className="px-4 py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {heads.map((h, idx) => (
            <tr key={h.head} className={getRowClass(h)}>
              <td className="px-4 py-2">{h.head}</td>
              <td className="px-4 py-2">
                <select
                  value={h.offline}
                  onChange={e => handleHeadChange(idx, 'offline', e.target.value)}
                  className="w-full border rounded text-black"
                >
                  <option value="Active">Active</option>
                  <option value="Offline">Offline</option>
                </select>
              </td>
              <td className="px-4 py-2">
                <select
                  value={h.issue}
                  onChange={e => handleHeadChange(idx, 'issue', e.target.value)}
                  disabled={h.offline !== 'Offline'}
                  className="w-full border rounded text-black"
                >
                  {issueTypes.map(it => (<option key={it} value={it}>{it}</option>))}
                </select>
              </td>
              <td className="px-4 py-2">
                <select
                  value={h.repaired}
                  onChange={e => handleHeadChange(idx, 'repaired', e.target.value)}
                  disabled={h.offline !== 'Offline' || h.issue === 'None'}
                  className="w-full border rounded text-black"
                >
                  <option value="N/A">N/A</option>
                  <option value="Fixed">Fixed</option>
                  <option value="Not Fixed">Not Fixed</option>
                </select>
              </td>
              <td className="px-4 py-2">
                <input
                  type="text"
                  value={h.notes}
                  onChange={e => handleHeadChange(idx, 'notes', e.target.value)}
                  disabled={h.offline !== 'Offline'}
                  className="w-full border rounded text-black"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Machine Notes */}
      <div className="mt-4">
        <label className="block mb-2 font-medium text-gray-800">Machine Notes</label>
        <textarea
          rows={4}
          value={machineNotes}
          onChange={e => handleNotesChange(e.target.value)}
          className="w-full border rounded p-2 text-gray-800"
        />
      </div>
    </div>
  );
}

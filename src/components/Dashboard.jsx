import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell
} from 'recharts';

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

// Total number of lines and static list
const totalLines = 39;
const lineList = Array.from({ length: totalLines }, (_, i) => {
  const num = i + 1;
  return { name: `Line ${num}`, section: getSectionForLine(num) };
});

export default function Dashboard({
  data,
  dates,
  selectedDay,
  setSelectedDay,
  onLineClick
}) {
  const [expanded, setExpanded] = useState({});

  const handleDayChange = e => setSelectedDay(e.target.value);

  // Running status per line
  const isRunning = line => data[line.name]?.running?.[selectedDay] === 'Yes';
  const getLineEff = line => {
    const heads = data[line.name]?.[selectedDay]?.heads || [];
    const active = heads.filter(h => h.offline === 'Active').length;
    return heads.length ? ((active / heads.length) * 100).toFixed(2) : '0.00';
  };
  const getLineFixedEff = line => {
    const heads = data[line.name]?.[selectedDay]?.heads || [];
    const fixedCount = heads.filter(h => h.offline === 'Active' || (h.offline === 'Offline' && h.repaired === 'Fixed')).length;
    return heads.length ? ((fixedCount / heads.length) * 100).toFixed(2) : '0.00';
  };

  // Totals
  const totalRunning = lineList.filter(isRunning).length;
  const totalCount = lineList.length;

  // Group by section
  const sections = lineList.reduce((acc, line) => {
    (acc[line.section] = acc[line.section] || []).push(line);
    return acc;
  }, {});

  // Chart data
  const barData = dates.map(d => {
    const down = lineList.reduce((sum, line) => {
      const heads = data[line.name]?.[d.date]?.heads || [];
      return sum + heads.filter(h => h.offline === 'Offline').length;
    }, 0);
    const fixed = lineList.reduce((sum, line) => {
      const heads = data[line.name]?.[d.date]?.heads || [];
      return sum + heads.filter(h => h.offline === 'Offline' && h.repaired === 'Fixed').length;
    }, 0);
    return { day: d.label, down, fixed };
  });

  // Issue distribution
  const allHeads = lineList.flatMap(line => data[line.name]?.[selectedDay]?.heads || []);
  const issues = allHeads.filter(h => h.issue && h.issue !== 'None');
  const counts = {};
  issues.forEach(h => counts[h.issue] = (counts[h.issue] || 0) + 1);
  const COLORS = ['#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#6b7280'];
  const pieData = Object.entries(counts).map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length] }));

  return (
    <div className="space-y-6">
      {/* Grand Total */}
      <div className="bg-white p-4 rounded shadow-md text-lg font-semibold">
        Running Lines: {totalRunning} / {totalCount}
      </div>

      {/* Running Lines Status */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold">Running Lines Status</h3>
          <select value={selectedDay} onChange={handleDayChange} className="border rounded p-2">
            {dates.map(d => <option key={d.id} value={d.date}>{d.label} ({d.date})</option>)}
          </select>
        </div>
        <div className="mb-4 flex gap-6">
          <p>Total Eff: {(totalRunning ? lineList.filter(isRunning).reduce((sum, line) => sum + parseFloat(getLineEff(line)), 0) / totalRunning : 0).toFixed(2)}%</p>
          <p>Fixed Eff: {(totalRunning ? lineList.filter(isRunning).reduce((sum, line) => sum + parseFloat(getLineFixedEff(line)), 0) / totalRunning : 0).toFixed(2)}%</p>
        </div>
        <div className="space-y-4">
          {Object.entries(sections).map(([section, secLines]) => (
            <div key={section}>
              <button
                onClick={() => setExpanded(prev => ({ ...prev, [section]: !prev[section] }))}
                className="w-full text-left font-medium bg-gray-100 p-2 rounded mb-2"
              >
                {section} ({secLines.filter(isRunning).length}/{secLines.length})
              </button>
              {expanded[section] && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                  {secLines.map(line => (
                    <div
                      key={line.name}
                      onClick={() => onLineClick(line.name)}
                      className={`p-4 rounded cursor-pointer ${isRunning(line) ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-800'}`}
                    >
                      <p className="font-semibold">{line.name}</p>
                      <p>Eff: {getLineEff(line)}%</p>
                      <p>Fix Eff: {getLineFixedEff(line)}%</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bar Chart */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h3 className="text-xl font-semibold mb-4">Heads Down & Fixed (All Days)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={barData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="down" name="Down" fill="#ef4444" />
            <Bar dataKey="fixed" name="Fixed" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Pie Chart */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h3 className="text-xl font-semibold mb-4">Issue Distribution</h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {pieData.map((entry, idx) => (
                <Cell key={`cell-${idx}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

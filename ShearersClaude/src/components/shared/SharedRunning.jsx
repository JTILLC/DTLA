// src/components/shared/SharedRunning.jsx
import React, { useState, useMemo } from 'react';

const HEADS_PER_LINE = 14;

const sections = [
  { name: 'PC Line',     lines: Array.from({ length: 7 },  (_, i) => `Line ${i + 1}`) },
  { name: 'Pellet Line', lines: Array.from({ length: 3 },  (_, i) => `Line ${i + 8}`) },
  { name: 'Extruded',    lines: Array.from({ length: 6 },  (_, i) => `Line ${i + 11}`) },
  { name: 'Hand Kettle', lines: Array.from({ length: 7 },  (_, i) => `Line ${i + 17}`) },
  { name: 'Twin Screw',  lines: Array.from({ length: 8 },  (_, i) => `Line ${i + 24}`) },
  { name: 'Sheeted 1',   lines: Array.from({ length: 6 },  (_, i) => `Line ${i + 32}`) },
  { name: 'Sheeted 2',   lines: Array.from({ length: 2 },  (_, i) => `Line ${i + 38}`) },
];

const makeDefaultHeads = () =>
  Array.from({ length: HEADS_PER_LINE }, (_, i) => ({
    head: i + 1, offline: 'Active', issues: [], notes: ''
  }));

export default function SharedRunning({ data = {}, dates = [] }) {
  const [selectedDate, setSelectedDate] = useState(dates[0] || '');
  const [expandedSections, setExpandedSections] = useState([]);

  const toggleSection = (name) =>
    setExpandedSections((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );

  const dayData = data?.[selectedDate] || {};

  const runningLines = useMemo(() => {
    const result = [];
    sections.forEach((section) => {
      section.lines.forEach((line) => {
        const entry = dayData[line];
        if (entry?.running) {
          const heads = entry.heads || makeDefaultHeads();
          const offlineHeads = heads.filter(h => h.offline !== 'Active');
          const fixedHeads = offlineHeads.filter(h => {
            const issues = h.issues || [];
            return issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');
          });
          result.push({
            section: section.name,
            line,
            totalHeads: HEADS_PER_LINE,
            offlineCount: offlineHeads.length,
            fixedCount: fixedHeads.length,
            heads,
            machineNotes: entry.machineNotes || '',
          });
        }
      });
    });
    return result;
  }, [dayData]);

  const sectionStats = useMemo(() => {
    const stats = {};
    sections.forEach((section) => {
      const sectionLines = runningLines.filter(l => l.section === section.name);
      stats[section.name] = {
        runningCount: sectionLines.length,
        totalOffline: sectionLines.reduce((sum, l) => sum + l.offlineCount, 0),
        totalFixed: sectionLines.reduce((sum, l) => sum + l.fixedCount, 0),
      };
    });
    return stats;
  }, [runningLines]);

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
      <h2 className="text-2xl font-semibold text-center mb-4 dark:text-gray-100">Running Lines (Read Only)</h2>

      {/* Date selector */}
      <div className="flex justify-center items-center mb-6 space-x-4">
        <label className="font-medium dark:text-gray-200">Select Date:</label>
        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded"
        >
          {(dates || []).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap justify-center gap-4 mb-6">
        <div className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-4 py-2 rounded-lg">
          <p className="font-bold text-lg">{runningLines.length}</p>
          <p>Lines Running</p>
        </div>
        <div className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-4 py-2 rounded-lg">
          <p className="font-bold text-lg">{runningLines.reduce((sum, l) => sum + l.offlineCount, 0)}</p>
          <p>Heads Offline</p>
        </div>
        <div className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-4 py-2 rounded-lg">
          <p className="font-bold text-lg">{runningLines.reduce((sum, l) => sum + l.fixedCount, 0)}</p>
          <p>Heads Fixed</p>
        </div>
      </div>

      {/* Sections */}
      {sections.map((section) => {
        const stats = sectionStats[section.name];
        const sectionLines = runningLines.filter(l => l.section === section.name);
        if (sectionLines.length === 0) return null;

        return (
          <div key={section.name} className="mb-4 border dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection(section.name)}
              className="w-full flex items-center justify-between bg-gray-100 dark:bg-gray-700 p-3 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <h3 className="text-lg font-semibold dark:text-gray-100">{section.name}</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm text-green-600 dark:text-green-400">{stats.runningCount} running</span>
                <span className="text-sm text-red-600 dark:text-red-400">{stats.totalOffline} offline</span>
                <svg className={`w-5 h-5 transition-transform ${expandedSections.includes(section.name) ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {expandedSections.includes(section.name) && (
              <div className="p-4 space-y-4 bg-white dark:bg-gray-800">
                {sectionLines.map((lineData) => (
                  <div key={lineData.line} className="border dark:border-gray-600 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium dark:text-gray-100">{lineData.line}</h4>
                      <div className="flex gap-2">
                        <span className="px-2 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-xs">
                          {HEADS_PER_LINE - lineData.offlineCount} active
                        </span>
                        {lineData.offlineCount > 0 && (
                          <span className="px-2 py-1 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs">
                            {lineData.offlineCount} offline
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Head status grid */}
                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {lineData.heads.map((h, idx) => {
                        const isActive = h.offline === 'Active';
                        const issues = h.issues || [];
                        const hasWDU = issues.some(iss => iss.type === 'WDU Replacement');
                        const allFixed = issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');

                        let bgColor = 'bg-green-500';
                        if (!isActive) {
                          if (hasWDU) bgColor = 'bg-purple-500';
                          else if (allFixed) bgColor = 'bg-orange-500';
                          else bgColor = 'bg-red-500';
                        }

                        return (
                          <div
                            key={idx}
                            className={`${bgColor} text-white text-center py-1 rounded text-xs font-medium`}
                            title={`Head ${h.head}: ${h.offline}${issues.length > 0 ? ` - ${issues.map(i => i.type).join(', ')}` : ''}`}
                          >
                            {h.head}
                          </div>
                        );
                      })}
                    </div>

                    {lineData.machineNotes && (
                      <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 p-2 rounded">
                        <span className="font-medium">Notes:</span> {lineData.machineNotes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {runningLines.length === 0 && (
        <p className="text-center text-gray-600 dark:text-gray-400 py-8">No lines running on {selectedDate}</p>
      )}
    </div>
  );
}

// src/components/shared/SharedDashboard.jsx
import React, { useMemo, useState, useEffect } from 'react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

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

const issueTypes = [
  'WDU Replacement', 'Chute', 'Operator', 'Load Cell', 'Detached Head',
  'Stepper Motor Error', 'Hopper Issues', 'Installed Wrong', 'Other',
];

const issueColors = {
  'WDU Replacement': '#A855F7', Chute: '#FF6384', Operator: '#36A2EB',
  'Load Cell': '#FFCE56', 'Detached Head': '#4BC0C0', 'Stepper Motor Error': '#9966FF',
  'Hopper Issues': '#FF9F40', 'Installed Wrong': '#4CAF50', Other: '#9CA3AF',
};

const makeDefaultHeads = () =>
  Array.from({ length: HEADS_PER_LINE }, (_, i) => ({
    head: i + 1, offline: 'Active', issue: 'None', repaired: 'Not Fixed', notes: '',
  }));

export default function SharedDashboard({ data = {}, dates = [] }) {
  const [selectedDate, setSelectedDate] = useState(dates.length ? dates[0] : '');
  const [openSections, setOpenSections] = useState([]);

  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const chartTextColor = isDarkMode ? '#f3f4f6' : '#374151';

  const dayObj = (d) => data?.[d] || {};
  const entry = (d, line) => dayObj(d)?.[line] || { heads: makeDefaultHeads(), running: false };

  const toggleSection = (name) =>
    setOpenSections((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );

  const {
    headsDownData,
    perSectionTotals,
    efficiencies,
    totals,
    issueCountsAllDays,
    issueCountsPerDay,
    dailyTotals,
  } = useMemo(() => {
    const targetDates = !dates.length ? [] :
      (selectedDate === 'All Days' ? dates : [selectedDate]);

    const headsDown = {};
    const sectionTotals = {};
    const sectionEff = {};
    const totals = { offline: 0, fixed: 0, notFixed: 0 };
    const dailyTotals = {};

    (dates || []).forEach((d) => {
      dailyTotals[d] = { offline: 0, fixed: 0, notFixed: 0 };
    });

    const countsAll = issueTypes.reduce((acc, k) => (acc[k] = 0, acc), {});
    const countsPerDay = {};
    (dates || []).forEach((d) => {
      countsPerDay[d] = issueTypes.reduce((acc, k) => (acc[k] = 0, acc), {});
    });

    sections.forEach((sec) => {
      sectionTotals[sec.name] = { offline: 0, fixed: 0, notFixed: 0 };
      let totalHeads = 0, activeHeads = 0, fixedHeads = 0;

      sec.lines.forEach((line) => {
        headsDown[line] = headsDown[line] || {};

        (dates || []).forEach((d) => {
          const e = entry(d, line);
          const heads = e.heads?.length ? e.heads : makeDefaultHeads();
          const isTargetDate = targetDates.includes(d);

          if (!e.running) {
            headsDown[line][d] = { offline: 0, fixed: 0, notFixed: 0 };
            return;
          }

          const offline = heads.filter((h) => (h.offline ?? 'Active') !== 'Active').length;
          const fixed = heads.filter((h) => {
            if ((h.offline ?? 'Active') === 'Active') return false;
            const issues = h.issues || [];
            if (issues.length === 0) return (h.repaired ?? 'Not Fixed') === 'Fixed';
            return issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');
          }).length;
          const notFixed = offline - fixed;

          headsDown[line][d] = { offline, fixed, notFixed };

          if (dailyTotals[d]) {
            dailyTotals[d].offline += offline;
            dailyTotals[d].fixed += fixed;
            dailyTotals[d].notFixed += notFixed;
          }

          if (isTargetDate) {
            totals.offline += offline;
            totals.fixed += fixed;
            totals.notFixed += notFixed;
            sectionTotals[sec.name].offline += offline;
            sectionTotals[sec.name].fixed += fixed;
            sectionTotals[sec.name].notFixed += notFixed;
            totalHeads += HEADS_PER_LINE;
            activeHeads += HEADS_PER_LINE - offline;
            fixedHeads += fixed;

            heads.filter((h) => (h.offline ?? 'Active') !== 'Active').forEach((h) => {
              const issues = h.issues || [];
              if (issues.length > 0) {
                issues.forEach(iss => {
                  const k = iss.type || 'None';
                  countsAll[k] = (countsAll[k] || 0) + 1;
                  countsPerDay[d][k] = (countsPerDay[d][k] || 0) + 1;
                });
              } else {
                const k = h.issue || 'None';
                countsAll[k] = (countsAll[k] || 0) + 1;
                countsPerDay[d][k] = (countsPerDay[d][k] || 0) + 1;
              }
            });
          }
        });
      });

      sectionEff[sec.name] = {
        totalEfficiency: totalHeads > 0 ? ((activeHeads / totalHeads) * 100).toFixed(2) : '0.00',
        fixedEfficiency: totalHeads > 0 ? (((activeHeads + fixedHeads) / totalHeads) * 100).toFixed(2) : '0.00',
      };
    });

    return { headsDownData: headsDown, perSectionTotals: sectionTotals, efficiencies: sectionEff, totals, issueCountsAllDays: countsAll, issueCountsPerDay: countsPerDay, dailyTotals };
  }, [data, dates, selectedDate]);

  const pieChartData = selectedDate === 'All Days'
    ? {
        labels: issueTypes.filter((i) => (issueCountsAllDays[i] || 0) > 0),
        datasets: [{
          data: issueTypes.filter((i) => (issueCountsAllDays[i] || 0) > 0).map((i) => issueCountsAllDays[i]),
          backgroundColor: issueTypes.filter((i) => (issueCountsAllDays[i] || 0) > 0).map((i) => issueColors[i]),
        }],
      }
    : {
        labels: issueTypes.filter((i) => (issueCountsPerDay[selectedDate]?.[i] || 0) > 0),
        datasets: [{
          data: issueTypes.filter((i) => (issueCountsPerDay[selectedDate]?.[i] || 0) > 0).map((i) => issueCountsPerDay[selectedDate][i]),
          backgroundColor: issueTypes.filter((i) => (issueCountsPerDay[selectedDate]?.[i] || 0) > 0).map((i) => issueColors[i]),
        }],
      };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
      <h2 className="text-2xl font-semibold text-center mb-4 dark:text-gray-100">Dashboard (Read Only)</h2>

      {/* Global Totals */}
      <div className="flex flex-wrap justify-center gap-4 mb-6 text-center">
        <div className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-4 py-2 rounded-lg shadow">
          <p className="font-bold text-lg">{totals.offline}</p>
          <p>Heads Offline</p>
        </div>
        <div className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-4 py-2 rounded-lg shadow">
          <p className="font-bold text-lg">{totals.fixed}</p>
          <p>Heads Fixed</p>
        </div>
        <div className="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 px-4 py-2 rounded-lg shadow">
          <p className="font-bold text-lg">{totals.notFixed}</p>
          <p>Not Fixed</p>
        </div>
      </div>

      {/* Date selector */}
      <div className="flex justify-center items-center mb-4 space-x-4">
        <label className="font-medium dark:text-gray-200">Select Date:</label>
        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded"
        >
          {dates.length ? <option value="All Days">All Days</option> : null}
          {(dates || []).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Daily Totals Table */}
      {dates.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xl font-semibold mb-3 text-center dark:text-gray-100">Daily Heads Down Totals</h3>
          <div className="overflow-x-auto">
            <table className="w-full table-auto border-collapse">
              <thead>
                <tr className="bg-gray-200 dark:bg-gray-700">
                  <th className="p-3 text-center border dark:border-gray-600 dark:text-gray-100">Date</th>
                  <th className="p-3 text-center border dark:border-gray-600 text-red-700 dark:text-red-300">Total Offline</th>
                  <th className="p-3 text-center border dark:border-gray-600 text-orange-700 dark:text-orange-300">Total Fixed</th>
                  <th className="p-3 text-center border dark:border-gray-600 text-yellow-700 dark:text-yellow-300">Not Fixed</th>
                </tr>
              </thead>
              <tbody>
                {(dates || []).slice().sort((a, b) => new Date(b) - new Date(a)).map((d) => {
                  const dayStats = dailyTotals[d] || { offline: 0, fixed: 0, notFixed: 0 };
                  return (
                    <tr key={d} className={selectedDate === d ? 'bg-blue-50 dark:bg-blue-900/30' : ''}>
                      <td className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">{d}</td>
                      <td className="p-2 text-center border dark:border-gray-600 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 font-bold">{dayStats.offline}</td>
                      <td className="p-2 text-center border dark:border-gray-600 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 font-bold">{dayStats.fixed}</td>
                      <td className="p-2 text-center border dark:border-gray-600 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 font-bold">{dayStats.notFixed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sections */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold mb-2 text-center dark:text-gray-100">Heads Down Summary</h3>
        {sections.map((section) => (
          <div key={section.name} className="mb-4">
            <div
              className="flex flex-wrap items-center justify-between bg-gray-200 dark:bg-gray-700 p-2 cursor-pointer rounded gap-2"
              onClick={() => toggleSection(section.name)}
            >
              <h4 className="text-lg font-medium dark:text-gray-100">{section.name}</h4>
              <div className="flex flex-wrap gap-2">
                <span className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-2 py-1 rounded text-sm">
                  Offline: <b>{perSectionTotals[section.name]?.offline ?? 0}</b>
                </span>
                <span className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-2 py-1 rounded text-sm">
                  Fixed: <b>{perSectionTotals[section.name]?.fixed ?? 0}</b>
                </span>
              </div>
              <svg className={`w-5 h-5 transition-transform ${openSections.includes(section.name) ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {openSections.includes(section.name) && (
              <div className="mt-2 pl-4">
                {section.lines.map((line) => {
                  const lineData = headsDownData[line];
                  if (!lineData) return null;
                  const datesToShow = selectedDate === 'All Days' ? dates : [selectedDate];
                  return (
                    <div key={line} className="mb-2 text-sm dark:text-gray-300">
                      <span className="font-medium">{line}:</span>
                      {datesToShow.map(d => lineData[d] && (
                        <span key={d} className="ml-2">
                          {d}: {lineData[d].offline} offline, {lineData[d].fixed} fixed
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pie Chart */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold mb-2 text-center dark:text-gray-100">Issue Type Distribution</h3>
        {pieChartData.labels?.length ? (
          <div className="max-w-md mx-auto">
            <Pie
              data={pieChartData}
              options={{
                responsive: true,
                plugins: {
                  legend: { position: 'top', labels: { color: chartTextColor } },
                  title: { display: true, text: `Issue Types — ${selectedDate === 'All Days' ? 'All Days' : selectedDate}`, color: chartTextColor },
                },
              }}
            />
          </div>
        ) : (
          <p className="text-center text-gray-600 dark:text-gray-400">No issues to display.</p>
        )}
      </div>
    </div>
  );
}

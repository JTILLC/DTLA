// src/components/Dashboard.jsx
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

// Try to use DatesContext if available; fall back gracefully
let useDatesHook = null;
try {
  useDatesHook = require('../context/DatesContext').useDates;
} catch (_) {
  useDatesHook = null;
}

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
  'None',
  'Chute',
  'Operator',
  'Load Cell',
  'Detached Head',
  'Stepper Motor Error',
  'Hopper Issues',
  'Installed Wrong',
  'Other',
];

const issueColors = {
  None: '#E0E0E0',
  Chute: '#FF6384',
  Operator: '#36A2EB',
  'Load Cell': '#FFCE56',
  'Detached Head': '#4BC0C0',
  'Stepper Motor Error': '#9966FF',
  'Hopper Issues': '#FF9F40',
  'Installed Wrong': '#4CAF50',
  Other: '#9CA3AF',
};

const makeDefaultHeads = () =>
  Array.from({ length: HEADS_PER_LINE }, (_, i) => ({
    head: i + 1,
    offline: 'Active',
    issue: 'None',
    repaired: 'Not Fixed',
    notes: '',
  }));

export default function Dashboard({ data = {}, dates: propDates = [] }) {
  // Robust 5-day window sourcing: Context → props → localStorage → data keys
  let ctxDates;
  try {
    if (useDatesHook) ctxDates = useDatesHook()?.dates;
  } catch {
    ctxDates = undefined;
  }

  let lsDates = [];
  try {
    const raw = localStorage.getItem('downtimeLoggerDates');
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) lsDates = parsed;
  } catch {
    /* ignore */
  }

  const dataDates = Object.keys(data || {})
    .sort((a, b) => new Date(b) - new Date(a))
    .slice(0, 5);

  const dates =
    (Array.isArray(ctxDates) && ctxDates.length ? ctxDates :
    (Array.isArray(propDates) && propDates.length ? propDates :
    (lsDates.length ? lsDates : dataDates)));

  // Default to the latest (first) date in the array, or empty string if no dates
  const [selectedDate, setSelectedDate] = useState(dates.length ? dates[0] : '');

  const dayObj = (d) => data?.[d] || {};
  const entry  = (d, line) => dayObj(d)?.[line] || { heads: makeDefaultHeads(), running: false };

  // ===== Core aggregation (respects selectedDate for totals/sections/main pie) =====
  const {
    headsDownData,
    perSectionTotals,
    efficiencies,
    totals,
    issueCountsAllDays,
    issueCountsPerDay,
  } = useMemo(() => {
    const targetDates = !dates.length ? [] :
      (selectedDate === 'All Days' ? dates : [selectedDate]);

    const headsDown = {};
    const sectionTotals = {};
    const sectionEff = {};
    const totals = { offline: 0, fixed: 0, notFixed: 0 };

    // For pies
    const countsAll = issueTypes.reduce((acc, k) => (acc[k] = 0, acc), {});
    const countsPerDay = {};
    (dates || []).forEach((d) => {
      countsPerDay[d] = issueTypes.reduce((acc, k) => (acc[k] = 0, acc), {});
    });

    sections.forEach((sec) => {
      sectionTotals[sec.name] = { offline: 0, fixed: 0, notFixed: 0 };

      // Efficiency calc restricted to targetDates only
      let totalHeads = 0;
      let activeHeads = 0;
      let fixedHeads = 0;

      sec.lines.forEach((line) => {
        headsDown[line] = headsDown[line] || {};

        targetDates.forEach((d) => {
          const e = entry(d, line);
          const heads = e.heads?.length ? e.heads : makeDefaultHeads();

          if (!e.running) {
            headsDown[line][d] = { offline: 0, fixed: 0, notFixed: 0 };
            return;
          }

          const offline = heads.filter((h) => (h.offline ?? 'Active') !== 'Active').length;
          const fixed = heads.filter(
            (h) => (h.offline ?? 'Active') !== 'Active' && (h.repaired ?? 'Not Fixed') === 'Fixed'
          ).length;
          const notFixed = offline - fixed;

          headsDown[line][d] = { offline, fixed, notFixed };

          // Global + Section totals (restricted to targetDates)
          totals.offline += offline;
          totals.fixed += fixed;
          totals.notFixed += notFixed;

          sectionTotals[sec.name].offline += offline;
          sectionTotals[sec.name].fixed += fixed;
          sectionTotals[sec.name].notFixed += notFixed;

          // Efficiency (restricted to targetDates)
          totalHeads += HEADS_PER_LINE;
          activeHeads += HEADS_PER_LINE - offline;
          fixedHeads += fixed;

          // Issue breakdowns for pies – restricted to targetDates
          heads
            .filter((h) => (h.offline ?? 'Active') !== 'Active')
            .forEach((h) => {
              const k = h.issue || 'None';
              countsAll[k] = (countsAll[k] || 0) + 1;
              countsPerDay[d][k] = (countsPerDay[d][k] || 0) + 1;
            });
        });
      });

      const totalEfficiency =
        totalHeads > 0 ? ((activeHeads / totalHeads) * 100).toFixed(2) : '0.00';
      const fixedEfficiency =
        totalHeads > 0 ? (((activeHeads + fixedHeads) / totalHeads) * 100).toFixed(2) : '0.00';

      sectionEff[sec.name] = { totalEfficiency, fixedEfficiency };
    });

    return {
      headsDownData: headsDown,
      perSectionTotals: sectionTotals,
      efficiencies: sectionEff,
      totals,
      issueCountsAllDays: countsAll,
      issueCountsPerDay: countsPerDay,
    };
  }, [data, dates, selectedDate]);

  // Collapsible sections UI
  const [openSections, setOpenSections] = useState([]);
  const toggleSection = (name) =>
    setOpenSections((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );

  // Main Issue Type pie (selectedDate vs All Days)
  const pieChartData =
    selectedDate === 'All Days'
      ? {
          labels: issueTypes.filter((i) => (issueCountsAllDays[i] || 0) > 0),
          datasets: [
            {
              data: issueTypes
                .filter((i) => (issueCountsAllDays[i] || 0) > 0)
                .map((i) => issueCountsAllDays[i]),
              backgroundColor: issueTypes
                .filter((i) => (issueCountsAllDays[i] || 0) > 0)
                .map((i) => issueColors[i]),
              hoverOffset: 4,
            },
          ],
        }
      : {
          labels: issueTypes.filter(
            (i) => (issueCountsPerDay[selectedDate]?.[i] || 0) > 0
          ),
          datasets: [
            {
              data: issueTypes
                .filter((i) => (issueCountsPerDay[selectedDate]?.[i] || 0) > 0)
                .map((i) => issueCountsPerDay[selectedDate][i]),
              backgroundColor: issueTypes
                .filter((i) => (issueCountsPerDay[selectedDate]?.[i] || 0) > 0)
                .map((i) => issueColors[i]),
              hoverOffset: 4,
            },
          ],
        };

  // ===== Per-day pies at bottom (always for full 5-day window) =====
  const perDayPieCharts = useMemo(() => {
    return (dates || [])
      .map((date) => {
        const counts = issueTypes.reduce((acc, k) => (acc[k] = 0, acc), {});

        sections.forEach((sec) => {
          sec.lines.forEach((line) => {
            const e = entry(date, line);
            if (!e.running) return;
            const heads = e.heads?.length ? e.heads : makeDefaultHeads();
            heads
              .filter((h) => (h.offline ?? 'Active') !== 'Active')
              .forEach((h) => {
                const k = h.issue || 'None';
                counts[k] = (counts[k] || 0) + 1;
              });
          });
        });

        const labels = issueTypes.filter((i) => (counts[i] || 0) > 0);
        if (!labels.length) return null;

        return {
          date,
          data: {
            labels,
            datasets: [
              {
                data: labels.map((i) => counts[i]),
                backgroundColor: labels.map((i) => issueColors[i]),
                hoverOffset: 4,
              },
            ],
          },
        };
      })
      .filter(Boolean);
  }, [data, dates]);

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md md:p-4 sm:p-2">
      <h2 className="text-2xl font-semibold text-center mb-4 sm:text-xl">Dashboard</h2>

      {/* Global Totals (respect selectedDate) */}
      <div className="flex flex-wrap justify-center gap-4 mb-6 text-center">
        <div className="bg-red-100 text-red-700 px-4 py-2 rounded-lg shadow">
          <p className="font-bold text-lg">{totals.offline}</p>
          <p>Heads Offline</p>
        </div>
        <div className="bg-blue-100 text-blue-700 px-4 py-2 rounded-lg shadow">
          <p className="font-bold text-lg">{totals.fixed}</p>
          <p>Heads Fixed</p>
        </div>
        <div className="bg-yellow-100 text-yellow-700 px-4 py-2 rounded-lg shadow">
          <p className="font-bold text-lg">{totals.notFixed}</p>
          <p>Not Fixed</p>
        </div>
      </div>

      {/* Nav */}
      <div className="flex justify-between mb-4">
        <Link
          to="/logger"
          className="px-4 py-2 bg-blue-500 text-white rounded sm:px-2 sm:py-1"
        >
          Back to Logger
        </Link>
        <Link
          to="/summary"
          className="px-4 py-2 bg-blue-500 text-white rounded sm:px-2 sm:py-1"
        >
          View Summary
        </Link>
        <Link
          to="/running"
          className="px-4 py-2 bg-purple-500 text-white rounded sm:px-2 sm:py-1"
        >
          Running
        </Link>
      </div>

      {/* Date selector (5-day window) */}
      <div className="flex justify-center items-center mb-4 space-x-4 sm:flex-col sm:space-x-0 sm:space-y-2">
        <label className="font-medium">Select Date:</label>
        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border p-2 rounded sm:w-full"
        >
          {dates.length ? <option value="All Days">All Days</option> : null}
          {(dates || []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          {!dates.length && <option value="">No dates</option>}
        </select>
      </div>

      {/* Heads Down Summary by Section/Line */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold mb-2 text-center sm:text-lg">
          Heads Down Summary
        </h3>

        {!dates.length ? (
          <p className="text-center text-gray-600 sm:text-sm">
            No dates found. Enter data in Main Logger first.
          </p>
        ) : (
          sections.map((section) => (
            <div key={section.name} className="mb-4">
              <div
                className="flex flex-wrap items-center justify-between bg-gray-200 p-2 cursor-pointer rounded gap-2"
                onClick={() => toggleSection(section.name)}
              >
                <h4 className="text-lg font-medium sm:text-base">
                  {section.name} (Total: {efficiencies[section.name]?.totalEfficiency ?? '0.00'}
                  %, Fixed: {efficiencies[section.name]?.fixedEfficiency ?? '0.00'}%)
                </h4>

                <div className="flex flex-wrap gap-2">
                  <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-sm">
                    Offline: <b>{perSectionTotals[section.name]?.offline ?? 0}</b>
                  </span>
                  <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-sm">
                    Fixed: <b>{perSectionTotals[section.name]?.fixed ?? 0}</b>
                  </span>
                  <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-sm">
                    Not Fixed: <b>{perSectionTotals[section.name]?.notFixed ?? 0}</b>
                  </span>
                </div>

                <svg
                  className={`w-5 h-5 transition-transform ${
                    openSections.includes(section.name) ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>

              {openSections.includes(section.name) && (
                <div className="mt-2 pl-4">
                  {section.lines.map((line) => {
                    const datesToShow =
                      selectedDate === 'All Days'
                        ? (dates || []).filter((d) => headsDownData[line]?.[d])
                        : headsDownData[line]?.[selectedDate]
                        ? [selectedDate]
                        : [];
                    if (!datesToShow.length) return null;

                    return (
                      <div key={line} className="mb-4">
                        <h5 className="text-base font-medium sm:text-sm">{line}</h5>
                        <table className="w-full table-auto border-collapse">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="p-2 text-center border sm:p-1 sm:text-sm">
                                Date
                              </th>
                              <th className="p-2 text-center border sm:p-1 sm:text-sm">
                                Offline Heads
                              </th>
                              <th className="p-2 text-center border sm:p-1 sm:text-sm">
                                Fixed Heads
                              </th>
                              <th className="p-2 text-center border sm:p-1 sm:text-sm">
                                Not Fixed
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {datesToShow
                              .slice()
                              .sort((a, b) => new Date(a) - new Date(b))
                              .map((d) => (
                                <tr key={d}>
                                  <td className="p-2 text-center border sm:p-1 sm:text-sm">
                                    {d}
                                  </td>
                                  <td className="p-2 text-center border sm:p-1 sm:text-sm">
                                    {headsDownData[line][d].offline}
                                  </td>
                                  <td className="p-2 text-center border sm:p-1 sm:text-sm">
                                    {headsDownData[line][d].fixed}
                                  </td>
                                  <td className="p-2 text-center border sm:p-1 sm:text-sm">
                                    {headsDownData[line][d].notFixed}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Main Issue Type Distribution (selectedDate vs All Days) */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold mb-2 text-center sm:text-lg">
          Issue Type Distribution
        </h3>
        {pieChartData.labels?.length ? (
          <div className="max-w-md mx-auto">
            <Pie
              data={pieChartData}
              options={{
                responsive: true,
                plugins: {
                  legend: { position: 'top' },
                  title: {
                    display: true,
                    text: `Issue Types — ${
                      selectedDate === 'All Days' ? 'All Days' : selectedDate
                    }`,
                  },
                },
              }}
            />
          </div>
        ) : (
          <p className="text-center text-gray-600 sm:text-sm">
            No issues to display.
          </p>
        )}
      </div>

      {/* Per-day pies at bottom */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold mb-2 text-center sm:text-lg">
          Issue Type Distribution Per Day
        </h3>
        {perDayPieCharts.length === 0 ? (
          <p className="text-center text-gray-600 sm:text-sm">
            No issues to display for any day.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {perDayPieCharts.map((chart) => (
              <div key={chart.date} className="max-w-md mx-auto">
                <h4 className="text-lg font-medium text-center sm:text-base mb-2">
                  {chart.date}
                </h4>
                <Pie
                  data={chart.data}
                  options={{
                    responsive: true,
                    plugins: {
                      legend: { position: 'top' },
                      title: {
                        display: true,
                        text: `Issue Types — ${chart.date}`,
                      },
                    },
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
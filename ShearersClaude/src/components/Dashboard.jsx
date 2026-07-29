// src/components/Dashboard.jsx
import React, { useMemo, useState, useEffect } from 'react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { useDates } from '../context/DatesContext';
import { HEADS_PER_LINE, ISSUE_TYPES, SECTIONS } from '../constants';
import { sortAsc } from '../utils/stintDays';

ChartJS.register(ArcElement, Tooltip, Legend);

const sections = SECTIONS;
const issueTypes = ISSUE_TYPES;

const issueColors = {
  'WDU Replacement': '#A855F7',
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
  // Use the 5 days from the logger: Context → props → localStorage → data keys
  const ctxDates = useDates()?.dates;

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
    .slice(0, 7); // stints run 5–7 days

  const dates =
    (Array.isArray(ctxDates) && ctxDates.length ? ctxDates :
    (Array.isArray(propDates) && propDates.length ? propDates :
    (lsDates.length ? lsDates : dataDates)));

  // Default to the latest (first) date in the array, or empty string if no dates
  const [selectedDate, setSelectedDate] = useState(dates.length ? dates[0] : '');


  // Dark mode detection for chart colors
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
  const entry  = (d, line) => dayObj(d)?.[line] || { heads: makeDefaultHeads(), running: false };

  // ===== Core aggregation (respects selectedDate for totals/sections/main pie) =====
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

    // Daily totals - track heads down per day across all lines
    const dailyTotals = {};
    (dates || []).forEach((d) => {
      dailyTotals[d] = { offline: 0, fixed: 0, notFixed: 0 };
    });

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

        // Iterate over ALL dates for daily totals, but only add to main totals for targetDates
        (dates || []).forEach((d) => {
          const e = entry(d, line);
          const heads = e.heads?.length ? e.heads : makeDefaultHeads();
          const isTargetDate = targetDates.includes(d);

          if (!e.running) {
            headsDown[line][d] = { offline: 0, fixed: 0, notFixed: 0 };
            return;
          }

          const offline = heads.filter((h) => (h.offline ?? 'Active') !== 'Active').length;

          // Handle new multi-issue format
          const fixed = heads.filter((h) => {
            if ((h.offline ?? 'Active') === 'Active') return false;
            const issues = h.issues || [];
            // If no issues array but has old repaired field, use it
            if (issues.length === 0) {
              return (h.repaired ?? 'Not Fixed') === 'Fixed';
            }
            // All issues must be fixed
            return issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');
          }).length;

          const notFixed = offline - fixed;

          headsDown[line][d] = { offline, fixed, notFixed };

          // Daily totals (always accumulate for all dates)
          if (dailyTotals[d]) {
            dailyTotals[d].offline += offline;
            dailyTotals[d].fixed += fixed;
            dailyTotals[d].notFixed += notFixed;
          }

          // Global + Section totals (restricted to targetDates only)
          if (isTargetDate) {
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
                const issues = h.issues || [];
                // If using new multi-issue format, count each issue
                if (issues.length > 0) {
                  issues.forEach(iss => {
                    const k = iss.type || 'None';
                    countsAll[k] = (countsAll[k] || 0) + 1;
                    countsPerDay[d][k] = (countsPerDay[d][k] || 0) + 1;
                  });
                } else {
                  // Fallback to old single-issue format
                  const k = h.issue || 'None';
                  countsAll[k] = (countsAll[k] || 0) + 1;
                  countsPerDay[d][k] = (countsPerDay[d][k] || 0) + 1;
                }
              });
          }
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
      dailyTotals,
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
                const issues = h.issues || [];
                // If using new multi-issue format, count each issue
                if (issues.length > 0) {
                  issues.forEach(iss => {
                    const k = iss.type || 'None';
                    counts[k] = (counts[k] || 0) + 1;
                  });
                } else {
                  // Fallback to old single-issue format
                  const k = h.issue || 'None';
                  counts[k] = (counts[k] || 0) + 1;
                }
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
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header + date selector */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Heads-down totals, efficiency, and issue breakdown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Date</label>
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="field w-auto py-2"
          >
            {dates.length ? <option value="All Days">All Days</option> : null}
            {sortAsc(dates).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {!dates.length && <option value="">No dates</option>}
          </select>
        </div>
      </div>

      {/* Global Totals KPI tiles (respect selectedDate) */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Heads Offline</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{totals.offline}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Heads Fixed</p>
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400 mt-1">{totals.fixed}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Not Fixed</p>
          <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">{totals.notFixed}</p>
        </div>
      </div>

      {/* Daily Heads Down Totals */}
      {dates.length > 0 && (
        <div className="card p-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">
            Daily Heads Down Totals
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/60">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Total Offline</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Total Fixed</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Not Fixed</th>
                </tr>
              </thead>
              <tbody>
                {sortAsc(dates).map((d) => {
                  const dayStats = dailyTotals[d] || { offline: 0, fixed: 0, notFixed: 0 };
                  return (
                    <tr
                      key={d}
                      className={`border-b border-gray-200/70 dark:border-gray-700 ${selectedDate === d ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''}`}
                    >
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-200 whitespace-nowrap">
                        {d}
                        {selectedDate === d && (
                          <span className="ml-2 text-indigo-600 dark:text-indigo-400 text-xs">(selected)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-bold text-red-600 dark:text-red-400">{dayStats.offline}</td>
                      <td className="px-3 py-2 font-bold text-orange-600 dark:text-orange-400">{dayStats.fixed}</td>
                      <td className="px-3 py-2 font-bold text-yellow-600 dark:text-yellow-400">{dayStats.notFixed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Heads Down Summary by Section/Line */}
      <div className="card p-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">
          Heads Down Summary
        </h3>

        {!dates.length ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-6 text-sm">
            No dates found. Enter data in Main Logger first.
          </p>
        ) : (
          <div className="space-y-3">
            {sections.map((section) => (
              <div
                key={section.name}
                className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                <div
                  className="flex flex-wrap items-center justify-between bg-gray-50 dark:bg-gray-700/60 p-3 cursor-pointer gap-2"
                  onClick={() => toggleSection(section.name)}
                >
                  <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {section.name}{' '}
                    <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                      (Total: {efficiencies[section.name]?.totalEfficiency ?? '0.00'}%, Fixed:{' '}
                      {efficiencies[section.name]?.fixedEfficiency ?? '0.00'}%)
                    </span>
                  </h4>

                  <div className="flex flex-wrap gap-1.5">
                    <span className="pill bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      Offline {perSectionTotals[section.name]?.offline ?? 0}
                    </span>
                    <span className="pill bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                      Fixed {perSectionTotals[section.name]?.fixed ?? 0}
                    </span>
                    <span className="pill bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">
                      Not Fixed {perSectionTotals[section.name]?.notFixed ?? 0}
                    </span>
                  </div>

                  <svg
                    className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${
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
                  <div className="p-3 space-y-4">
                    {section.lines.map((line) => {
                      const datesToShow =
                        selectedDate === 'All Days'
                          ? (dates || []).filter((d) => headsDownData[line]?.[d])
                          : headsDownData[line]?.[selectedDate]
                          ? [selectedDate]
                          : [];
                      if (!datesToShow.length) return null;

                      return (
                        <div key={line}>
                          <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">{line}</h5>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-50 dark:bg-gray-700/60">
                                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Date</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Offline Heads</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Fixed Heads</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Not Fixed</th>
                                </tr>
                              </thead>
                              <tbody>
                                {datesToShow
                                  .slice()
                                  .sort((a, b) => new Date(a) - new Date(b))
                                  .map((d) => (
                                    <tr key={d} className="border-b border-gray-200/70 dark:border-gray-700">
                                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200 whitespace-nowrap">{d}</td>
                                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{headsDownData[line][d].offline}</td>
                                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{headsDownData[line][d].fixed}</td>
                                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{headsDownData[line][d].notFixed}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Issue Type Distribution (selectedDate vs All Days) */}
      <div className="card p-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">
          Issue Type Distribution
        </h3>
        {pieChartData.labels?.length ? (
          <div className="max-w-md mx-auto">
            <Pie
              data={pieChartData}
              options={{
                responsive: true,
                plugins: {
                  legend: {
                    position: 'top',
                    labels: { color: chartTextColor }
                  },
                  title: {
                    display: true,
                    text: `Issue Types — ${
                      selectedDate === 'All Days' ? 'All Days' : selectedDate
                    }`,
                    color: chartTextColor,
                  },
                },
              }}
            />
          </div>
        ) : (
          <p className="text-center text-gray-500 dark:text-gray-400 py-6 text-sm">
            No issues to display.
          </p>
        )}
      </div>

      {/* Per-day pies at bottom */}
      <div className="card p-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">
          Issue Type Distribution Per Day
        </h3>
        {perDayPieCharts.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-6 text-sm">
            No issues to display for any day.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {perDayPieCharts.map((chart) => (
              <div key={chart.date} className="max-w-md mx-auto w-full">
                <h4 className="text-sm font-semibold text-center mb-2 text-gray-700 dark:text-gray-200">
                  {chart.date}
                </h4>
                <Pie
                  data={chart.data}
                  options={{
                    responsive: true,
                    plugins: {
                      legend: {
                        position: 'top',
                        labels: { color: chartTextColor }
                      },
                      title: {
                        display: true,
                        text: `Issue Types — ${chart.date}`,
                        color: chartTextColor,
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
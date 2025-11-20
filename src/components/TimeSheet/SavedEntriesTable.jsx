// src/components/TimeSheet/SavedEntriesTable.jsx
import React from 'react';
import { useTimeSheet } from '../../context/TimeSheetContext';

function SavedEntriesTable({ onEdit, onDelete }) {
  const context = useTimeSheet();
  if (!context) {
    console.error('TimeSheetContext is undefined');
    return <div>Error: Time Sheet context is unavailable. Please try refreshing the page.</div>;
  }
  const { entries } = context;

  // Format date as Day MM/DD/YY using UTC to avoid timezone issues
  const formatDate = (dateString) => {
    try {
      const [year, month, day] = dateString.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day)); // Use UTC
      if (isNaN(date.getTime())) throw new Error('Invalid date');
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = days[date.getUTCDay()];
      const formattedMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
      const formattedDay = String(date.getUTCDate()).padStart(2, '0');
      const yearShort = String(date.getUTCFullYear()).slice(-2);
      return `${dayName} ${formattedMonth}/${formattedDay}/${yearShort}`;
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return 'Invalid Date';
    }
  };

  // Calculate hours for each entry
  const calculateEntryHours = (entry) => {
    try {
      let travelHours = 0;
      let straight = 0;
      let overtime = 0;
      let double = 0;

      // Calculate travel hours
      if (entry.travel?.to?.active) {
        const [startHour, startMinute] = entry.travel.to.start.split(':').map(Number);
        const [endHour, endMinute] = entry.travel.to.end.split(':').map(Number);
        travelHours += (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60;
      }
      if (entry.travel?.home?.active) {
        const [startHour, startMinute] = entry.travel.home.start.split(':').map(Number);
        const [endHour, endMinute] = entry.travel.home.end.split(':').map(Number);
        travelHours += (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60;
      }

      // Calculate work hours
      let workHours = 0;
      if (entry.onsite?.active && !entry.travelOnly) {
        const [startHour, startMinute] = entry.onsite.start.split(':').map(Number);
        const [endHour, endMinute] = entry.onsite.end.split(':').map(Number);
        workHours = (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60;
        if (entry.lunch) {
          workHours -= Number(entry.lunchDuration) || 0;
        }
      }

      // Determine day type
      const [year, month, day] = entry.date.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      const dayOfWeek = date.getUTCDay(); // 0=Sun, 6=Sat

      // Assign work hours to straight, overtime, or double
      if (entry.holiday) {
        double = workHours;
      } else if (dayOfWeek === 0) {
        double = workHours; // Sunday = Double
      } else if (dayOfWeek === 6) {
        overtime = workHours; // Saturday = Overtime
      } else {
        if (workHours <= 8) {
          straight = workHours;
        } else {
          straight = 8;
          overtime = workHours - 8;
        }
      }

      const total = travelHours + workHours;

      return {
        travelHours: travelHours.toFixed(2),
        straight: straight.toFixed(2),
        overtime: overtime.toFixed(2),
        double: double.toFixed(2),
        total: total.toFixed(2),
      };
    } catch (error) {
      console.error('Error calculating hours for entry:', entry, error);
      return {
        travelHours: '0.00',
        straight: '0.00',
        overtime: '0.00',
        double: '0.00',
        total: '0.00',
      };
    }
  };

  return (
    <div className="mb-4">
      <h3 className="text-lg font-semibold mb-2">Saved Entries</h3>
      {entries && entries.length > 0 ? (
        <>
          {/* Desktop Table View - Hidden on Mobile */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border border-gray-300 px-4 py-2 text-left">Date</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Travel To</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">On-site</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Travel Home</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Lunch</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Travel Hrs</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Straight</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Overtime</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Double</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Total Hrs</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const hours = calculateEntryHours(entry);
                  return (
                    <tr key={index} className="even:bg-gray-50">
                      <td className="border border-gray-300 px-4 py-2">{formatDate(entry.date)}</td>
                      <td className="border border-gray-300 px-4 py-2">
                        {entry.travel?.to?.active ? `${entry.travel.to.start}-${entry.travel.to.end}` : 'N/A'}
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        {entry.onsite?.active ? `${entry.onsite.start}-${entry.onsite.end}` : 'N/A'}
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        {entry.travel?.home?.active ? `${entry.travel.home.start}-${entry.travel.home.end}` : 'N/A'}
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        {entry.lunch ? `${entry.lunchDuration} hrs` : 'No'}
                      </td>
                      <td className="border border-gray-300 px-4 py-2">{hours.travelHours}</td>
                      <td className="border border-gray-300 px-4 py-2">{hours.straight}</td>
                      <td className="border border-gray-300 px-4 py-2">{hours.overtime}</td>
                      <td className="border border-gray-300 px-4 py-2">{hours.double}</td>
                      <td className="border border-gray-300 px-4 py-2">{hours.total}</td>
                      <td className="border border-gray-300 px-4 py-2">
                        <button
                          onClick={() => onEdit(index)}
                          className="bg-yellow-500 text-white px-2 py-1 rounded mr-2 hover:bg-yellow-600"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => onDelete(index)}
                          className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View - Shown on Mobile Only */}
          <div className="lg:hidden space-y-4">
            {entries.map((entry, index) => {
              const hours = calculateEntryHours(entry);
              return (
                <div key={index} className="bg-white border border-gray-300 rounded-lg p-4 shadow-sm">
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="font-semibold text-lg text-blue-600">{formatDate(entry.date)}</h4>
                    <span className="text-sm font-medium bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      {hours.total} hrs
                    </span>
                  </div>

                  <div className="space-y-2 mb-3 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="font-medium text-gray-700">Travel To:</span>
                        <p className="text-gray-900">
                          {entry.travel?.to?.active ? `${entry.travel.to.start}-${entry.travel.to.end}` : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">On-site:</span>
                        <p className="text-gray-900">
                          {entry.onsite?.active ? `${entry.onsite.start}-${entry.onsite.end}` : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Travel Home:</span>
                        <p className="text-gray-900">
                          {entry.travel?.home?.active ? `${entry.travel.home.start}-${entry.travel.home.end}` : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Lunch:</span>
                        <p className="text-gray-900">{entry.lunch ? `${entry.lunchDuration} hrs` : 'No'}</p>
                      </div>
                    </div>

                    <div className="border-t pt-2 mt-2">
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div>
                          <p className="text-xs text-gray-600">Travel</p>
                          <p className="font-semibold">{hours.travelHours}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Straight</p>
                          <p className="font-semibold">{hours.straight}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">OT</p>
                          <p className="font-semibold">{hours.overtime}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Double</p>
                          <p className="font-semibold">{hours.double}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t">
                    <button
                      onClick={() => onEdit(index)}
                      className="flex-1 bg-yellow-500 text-white px-3 py-2 rounded hover:bg-yellow-600 transition"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onDelete(index)}
                      className="flex-1 bg-red-500 text-white px-3 py-2 rounded hover:bg-red-600 transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p>No entries saved yet.</p>
      )}
    </div>
  );
}

export default SavedEntriesTable;

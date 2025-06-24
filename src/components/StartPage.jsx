import React, { useState, useEffect } from 'react';

const STORED_KEY = 'downtimeLoggerDates';

export default function StartPage({ dates, setDates, onStart }) {
  const [numDays, setNumDays] = useState(dates.length);
  const [localDates, setLocalDates] = useState(dates);

  // On mount, load saved dates and advance to main logger
  useEffect(() => {
    const stored = localStorage.getItem(STORED_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setDates(parsed);
        onStart();
      } catch {
        localStorage.removeItem(STORED_KEY);
      }
    }
  }, []);

  const handleNumDaysChange = (e) => {
    const n = parseInt(e.target.value, 10) || 1;
    setNumDays(n);
    const newDates = [...localDates];
    if (n > newDates.length) {
      for (let i = newDates.length; i < n; i++) {
        newDates.push({ id: `day${i+1}`, date: '', label: `Day ${i+1}` });
      }
    } else {
      newDates.splice(n);
    }
    setLocalDates(newDates);
  };

  const handleDateChange = (index, value) => {
    const newDates = [...localDates];
    newDates[index] = { ...newDates[index], date: value };
    setLocalDates(newDates);
  };

  const handleStart = () => {
    const finalDates = localDates.map((d, i) => ({
      id: `day${i+1}`,
      date: d.date,
      label: `Day ${i+1}`
    }));
    setDates(finalDates);
    localStorage.setItem(STORED_KEY, JSON.stringify(finalDates));
    onStart();
  };

  const handleResetAll = () => {
    // Clear persisted dates and reload app to initial state
    localStorage.removeItem(STORED_KEY);
    window.location.reload();
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-xl mx-auto mt-10">
      <h2 className="text-2xl font-semibold mb-4">Setup Downtime Logger</h2>
      <div className="mb-4">
        <label className="block mb-1 font-medium text-gray-800">Number of Days:</label>
        <input
          type="number"
          min="1"
          max="10"
          className="w-full border rounded p-2 text-gray-800"
          value={numDays}
          onChange={handleNumDaysChange}
        />
      </div>
      {localDates.map((d, idx) => (
        <div className="mb-4" key={idx}>
          <label className="block mb-1 font-medium text-gray-800">Day {idx+1} Date:</label>
          <input
            type="date"
            className="w-full border rounded p-2 text-gray-800"
            value={d.date}
            onChange={(e) => handleDateChange(idx, e.target.value)}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <button
          onClick={handleStart}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          Start
        </button>
        <button
          onClick={handleResetAll}
          className="bg-red-500 text-white px-4 py-2 rounded"
        >
          Reset All
        </button>
      </div>
    </div>
  );
}

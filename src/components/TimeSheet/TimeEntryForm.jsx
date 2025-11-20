// src/components/TimeSheet/TimeEntryForm.jsx
import React, { useState, useEffect } from 'react';

function TimeEntryForm({ entry, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    date: '',
    travelTo: { active: false, start: '', end: '' },
    onsite: { active: false, start: '', end: '' },
    travelHome: { active: false, start: '', end: '' },
    lunch: false,
    lunchDuration: 0.5,
    holiday: false,
    travelOnly: false,
    serviceWork: '',
  });

  useEffect(() => {
    if (entry) {
      setFormData({
        date: entry.date || '',
        travelTo: entry.travel?.to || { active: false, start: '', end: '' },
        onsite: entry.onsite || { active: false, start: '', end: '' },
        travelHome: entry.travel?.home || { active: false, start: '', end: '' },
        lunch: entry.lunch || false,
        lunchDuration: entry.lunchDuration || 0.5,
        holiday: entry.holiday || false,
        travelOnly: entry.travelOnly || false,
        serviceWork: entry.serviceWork || '',
      });
    } else {
      const today = new Date().toISOString().split('T')[0];
      setFormData(prev => ({ ...prev, date: today }));
    }
  }, [entry]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name.startsWith('travelTo.') || name.startsWith('onsite.') || name.startsWith('travelHome.')) {
      const section = name.split('.')[0];
      const field = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        [section]: {
          ...prev[section],
          [field]: type === 'checkbox' ? checked : value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }));
    }
  };

  const calculateHours = () => {
    let travelHours = 0;
    let workHours = 0;

    if (formData.travelTo.active) {
      const [startH, startM] = formData.travelTo.start.split(':').map(Number);
      const [endH, endM] = formData.travelTo.end.split(':').map(Number);
      travelHours += ((endH * 60 + endM) - (startH * 60 + startM)) / 60;
    }

    if (formData.onsite.active) {
      const [startH, startM] = formData.onsite.start.split(':').map(Number);
      const [endH, endM] = formData.onsite.end.split(':').map(Number);
      let onsiteHours = ((endH * 60 + endM) - (startH * 60 + startM)) / 60;
      if (formData.lunch) onsiteHours -= formData.lunchDuration;
      workHours = onsiteHours;
    }

    if (formData.travelHome.active) {
      const [startH, startM] = formData.travelHome.start.split(':').map(Number);
      const [endH, endM] = formData.travelHome.end.split(':').map(Number);
      travelHours += ((endH * 60 + endM) - (startH * 60 + startM)) / 60;
    }

    return { travelHours, workHours };
  };

  const { travelHours, workHours } = calculateHours();

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);  // FIXED: Pass formData (includes serviceWork)
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700">Date</label>
        <input
          type="date"
          name="date"
          value={formData.date}
          onChange={handleChange}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          required
        />
      </div>

      {/* TRAVEL TO */}
      <div>
        <label className="block text-sm font-medium text-gray-700">Travel To</label>
        <div className="mt-1 space-y-2">
          <label className="flex items-center">
            <input
              type="checkbox"
              name="travelTo.active"
              checked={formData.travelTo.active}
              onChange={handleChange}
              className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <span className="ml-2 text-sm text-gray-700">Active</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              name="travelTo.start"
              value={formData.travelTo.start}
              onChange={handleChange}
              className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={!formData.travelTo.active}
            />
            <input
              type="time"
              name="travelTo.end"
              value={formData.travelTo.end}
              onChange={handleChange}
              className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={!formData.travelTo.active}
            />
          </div>
        </div>
      </div>

      {/* ON-SITE TIMES — BETWEEN TRAVEL TO & HOME */}
      <div>
        <label className="block text-sm font-medium text-gray-700">On-Site Times</label>
        <div className="mt-1 space-y-2">
          <label className="flex items-center">
            <input
              type="checkbox"
              name="onsite.active"
              checked={formData.onsite.active}
              onChange={handleChange}
              className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <span className="ml-2 text-sm text-gray-700">Active</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              name="onsite.start"
              value={formData.onsite.start}
              onChange={handleChange}
              className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={!formData.onsite.active}
            />
            <input
              type="time"
              name="onsite.end"
              value={formData.onsite.end}
              onChange={handleChange}
              className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={!formData.onsite.active}
            />
          </div>
        </div>
      </div>

      {/* TRAVEL HOME */}
      <div>
        <label className="block text-sm font-medium text-gray-700">Travel Home</label>
        <div className="mt-1 space-y-2">
          <label className="flex items-center">
            <input
              type="checkbox"
              name="travelHome.active"
              checked={formData.travelHome.active}
              onChange={handleChange}
              className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <span className="ml-2 text-sm text-gray-700">Active</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              name="travelHome.start"
              value={formData.travelHome.start}
              onChange={handleChange}
              className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={!formData.travelHome.active}
            />
            <input
              type="time"
              name="travelHome.end"
              value={formData.travelHome.end}
              onChange={handleChange}
              className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={!formData.travelHome.active}
            />
          </div>
        </div>
      </div>

      {/* LUNCH & HOLIDAY */}
      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            name="lunch"
            checked={formData.lunch}
            onChange={handleChange}
            className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
          <span className="ml-2 text-sm text-gray-700">Lunch (0.5 hr)</span>
        </label>
        <label className="flex items-center">
          <input
            type="checkbox"
            name="holiday"
            checked={formData.holiday}
            onChange={handleChange}
            className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
          <span className="ml-2 text-sm text-gray-700">Holiday</span>
        </label>
      </div>

      <div className="text-sm text-gray-600">
        Travel Hours: {travelHours.toFixed(2)} | Work Hours: {workHours.toFixed(2)}
      </div>

      <div className="pt-4">
        <button type="submit" className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition">
          Save Entry
        </button>
        <button type="button" onClick={onCancel} className="w-full mt-2 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default TimeEntryForm;
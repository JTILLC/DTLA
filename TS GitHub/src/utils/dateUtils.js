// src/utils/dateUtils.js - Shared date formatting utilities

/**
 * Format a date string to a localized date format
 * @param {string} dateStr - Date string to format
 * @returns {string} - Formatted date string
 */
export const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

/**
 * Format a date string with day of week
 * @param {string} dateStr - Date string to format
 * @returns {string} - Formatted date string with day name
 */
export const formatDateWithDay = (dateStr) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr + 'T00:00:00');
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const formatted = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${dayName}, ${formatted}`;
  } catch {
    return dateStr;
  }
};

/**
 * Format a date for display in forms (YYYY-MM-DD)
 * @param {Date|string} date - Date to format
 * @returns {string} - ISO date string (YYYY-MM-DD)
 */
export const formatDateForInput = (date) => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
};

/**
 * Get the day type (weekday, saturday, sunday) for a date
 * @param {string} dateStr - Date string
 * @returns {string} - Day type
 */
export const getDayType = (dateStr) => {
  if (!dateStr) return 'weekday';
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDay();
  if (day === 0) return 'sunday';
  if (day === 6) return 'saturday';
  return 'weekday';
};

/**
 * Check if a date is a weekend
 * @param {string} dateStr - Date string
 * @returns {boolean}
 */
export const isWeekend = (dateStr) => {
  const dayType = getDayType(dateStr);
  return dayType === 'saturday' || dayType === 'sunday';
};

/**
 * Get date range string from array of dates
 * @param {string[]} dates - Array of date strings
 * @returns {string} - Date range string (e.g., "Jan 1 - Jan 5, 2024")
 */
export const getDateRangeString = (dates) => {
  if (!dates || dates.length === 0) return '';

  const sortedDates = [...dates].sort();
  const startDate = new Date(sortedDates[0] + 'T00:00:00');
  const endDate = new Date(sortedDates[sortedDates.length - 1] + 'T00:00:00');

  const startFormatted = startDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const endFormatted = endDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (sortedDates.length === 1) {
    return endFormatted;
  }

  return `${startFormatted} - ${endFormatted}`;
};

/**
 * Parse time string to hours and minutes
 * @param {string} timeStr - Time string (HH:MM)
 * @returns {{hours: number, minutes: number}}
 */
export const parseTime = (timeStr) => {
  if (!timeStr) return { hours: 0, minutes: 0 };
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours: hours || 0, minutes: minutes || 0 };
};

/**
 * Convert time string to decimal hours
 * @param {string} timeStr - Time string (HH:MM)
 * @returns {number} - Decimal hours
 */
export const timeToDecimal = (timeStr) => {
  const { hours, minutes } = parseTime(timeStr);
  return hours + minutes / 60;
};

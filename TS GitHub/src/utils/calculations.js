// src/utils/calculations.js - Time and charge calculations
import { LABOR_RATES, TRAVEL_RATES, PER_DIEM_RATES, DEFAULTS } from '../config/constants';

/**
 * Calculate time difference in hours
 * @param {string} start - Start time (HH:MM)
 * @param {string} end - End time (HH:MM)
 * @returns {number} - Hours difference
 */
const calculateTimeDifference = (start, end) => {
  if (!start || !end) return 0;
  const startTime = new Date(`1970-01-01T${start}:00`);
  const endTime = new Date(`1970-01-01T${end}:00`);
  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) return 0;
  const hours = (endTime - startTime) / 1000 / 60 / 60;
  return hours >= 0 ? hours : 0;
};

/**
 * Get day info from date string
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {boolean} isHoliday - Whether date is a holiday
 * @returns {Object} - Day type info
 */
const getDayInfo = (dateStr, isHoliday = false) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime())) {
    return { dayOfWeek: -1, isSaturday: false, isSundayOrHoliday: false, isWeekday: false };
  }
  const dayOfWeek = date.getDay();
  const isSaturday = dayOfWeek === 6;
  const isSundayOrHoliday = dayOfWeek === 0 || isHoliday;
  const isWeekday = !isSaturday && !isSundayOrHoliday;
  return { dayOfWeek, isSaturday, isSundayOrHoliday, isWeekday };
};

/**
 * Calculate hours breakdown for a time entry
 * @param {Object} entry - Time entry object
 * @returns {Object} - Entry with calculated hours
 */
export function calculateHours(entry) {
  const travelHours =
    (entry.travel?.to?.active ? calculateTimeDifference(entry.travel.to.start, entry.travel.to.end) : 0) +
    (entry.travel?.home?.active ? calculateTimeDifference(entry.travel.home.start, entry.travel.home.end) : 0);

  const lunchDuration = entry.lunch ? (parseFloat(entry.lunchDuration) || DEFAULTS.LUNCH_DURATION) : 0;

  const onSiteHours = entry.onsite?.active
    ? Math.max(0, calculateTimeDifference(entry.onsite.start, entry.onsite.end) - lunchDuration)
    : 0;

  if (onSiteHours < 0) {
    return { ...entry, travelHours: 0, straight: 0, overtime: 0, double: 0, total: 0 };
  }

  const totalHours = travelHours + onSiteHours;
  const { isSaturday, isSundayOrHoliday, isWeekday } = getDayInfo(entry.date, entry.holiday);

  let straight = 0;
  let overtime = 0;
  let double = 0;

  if (entry.onsite?.active && onSiteHours > 0 && !entry.travelOnly) {
    if (isSundayOrHoliday) {
      double = onSiteHours;
    } else if (isSaturday) {
      overtime = onSiteHours;
    } else if (isWeekday) {
      if (onSiteHours > 8) {
        straight = 8;
        overtime = onSiteHours - 8;
      } else {
        straight = onSiteHours;
      }
    }
  }

  return {
    ...entry,
    travelHours,
    straight,
    overtime,
    double,
    total: totalHours,
  };
}

/**
 * Calculate all charges for entries and travel
 * @param {Array} entries - Array of time entries
 * @param {Object} travelData - Travel expense data
 * @returns {Object} - Calculated charges breakdown
 */
export function calculateCharges(entries, travelData) {
  const processedEntries = entries.map((entry) => calculateHours(entry));

  // Labor calculations
  const straight = {
    hours: processedEntries.reduce((sum, e) => sum + (e.straight || 0), 0),
    charge: processedEntries.reduce((sum, e) => sum + (e.straight || 0), 0) * LABOR_RATES.STRAIGHT,
  };
  const overtime = {
    hours: processedEntries.reduce((sum, e) => sum + (e.overtime || 0), 0),
    charge: processedEntries.reduce((sum, e) => sum + (e.overtime || 0), 0) * LABOR_RATES.OVERTIME,
  };
  const double = {
    hours: processedEntries.reduce((sum, e) => sum + (e.double || 0), 0),
    charge: processedEntries.reduce((sum, e) => sum + (e.double || 0), 0) * LABOR_RATES.DOUBLE,
  };

  const laborSubtotal = straight.charge + overtime.charge + double.charge;

  // Travel time calculations by day type
  const filterByDayType = (entries, predicate) => {
    return entries.filter((e) => {
      const { dayOfWeek } = getDayInfo(e.date, e.holiday);
      return predicate(dayOfWeek, e.holiday);
    });
  };

  const weekdayEntries = filterByDayType(processedEntries, (dow, holiday) => dow >= 1 && dow <= 5 && !holiday);
  const saturdayEntries = filterByDayType(processedEntries, (dow, holiday) => dow === 6 && !holiday);
  const sundayHolidayEntries = filterByDayType(processedEntries, (dow, holiday) => dow === 0 || holiday);

  const weekdayTravel = {
    hours: weekdayEntries.reduce((sum, e) => sum + (e.travelHours || 0), 0),
    charge: weekdayEntries.reduce((sum, e) => sum + (e.travelHours || 0), 0) * TRAVEL_RATES.WEEKDAY,
  };
  const saturdayTravel = {
    hours: saturdayEntries.reduce((sum, e) => sum + (e.travelHours || 0), 0),
    charge: saturdayEntries.reduce((sum, e) => sum + (e.travelHours || 0), 0) * TRAVEL_RATES.SATURDAY,
  };
  const sundayTravel = {
    hours: sundayHolidayEntries.reduce((sum, e) => sum + (e.travelHours || 0), 0),
    charge: sundayHolidayEntries.reduce((sum, e) => sum + (e.travelHours || 0), 0) * TRAVEL_RATES.SUNDAY_HOLIDAY,
  };

  const travelChargesSubtotal = weekdayTravel.charge + saturdayTravel.charge + sundayTravel.charge;

  // Travel expenses
  const mileageRate = Number(travelData?.mileageRate) || DEFAULTS.MILEAGE_RATE;
  const perDiemRate = travelData?.perDiemType === 'local' ? PER_DIEM_RATES.LOCAL : PER_DIEM_RATES.NON_LOCAL;

  const travel = {
    perDiemTotal: Number(travelData?.perDiemDays || 0) * perDiemRate,
    mileageTotal: Number(travelData?.mileage || 0) * mileageRate,
    mileageRate: mileageRate,
    otherTravel: (() => {
      const val = travelData?.otherTravel;
      if (typeof val === 'number') return val;
      if (!val || typeof val !== 'string') return 0;
      return val.split('+').reduce((sum, part) => sum + (parseFloat(part.trim()) || 0), 0);
    })(),
    airTravel: Number(travelData?.airTravel?.cost || 0),
  };
  const travelExpensesSubtotal = travel.perDiemTotal + travel.mileageTotal + travel.otherTravel + travel.airTravel;

  return {
    straight,
    overtime,
    double,
    laborSubtotal,
    weekdayTravel,
    saturdayTravel,
    sundayTravel,
    travelChargesSubtotal,
    travel: {
      perDiemTotal: travel.perDiemTotal,
      mileageTotal: travel.mileageTotal,
      mileageRate: travel.mileageRate, // expose the rate actually used so pages display it (not a hardcoded fallback)
      otherTravel: travel.otherTravel,
      airTravel: travel.airTravel,
      travelExpensesSubtotal,
    },
    processedEntries,
  };
}

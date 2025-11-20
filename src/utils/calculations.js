export function calculateHours(entry) {
  console.log('Calculating hours for entry:', JSON.stringify(entry, null, 2));
  const calculateTimeDifference = (start, end) => {
    if (!start || !end) {
      console.warn('Missing start or end time:', { start, end });
      return 0;
    }
    const startTime = new Date(`1970-01-01T${start}:00`);
    const endTime = new Date(`1970-01-01T${end}:00`);
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      console.error('Invalid time format:', { start, end });
      return 0;
    }
    const hours = (endTime - startTime) / 1000 / 60 / 60;
    return hours >= 0 ? hours : 0; // Ensure non-negative hours
  };

  const travelHours = 
    (entry.travel?.to?.active ? calculateTimeDifference(entry.travel.to.start, entry.travel.to.end) : 0) +
    (entry.travel?.home?.active ? calculateTimeDifference(entry.travel.home.start, entry.travel.home.end) : 0);

  const lunchDuration = entry.lunch ? (Number(entry.lunchDuration) || 0) : 0;
  if (entry.lunch && isNaN(lunchDuration)) {
    console.error('Invalid lunch duration:', entry.lunchDuration);
  }

  const onSiteHours = entry.onsite?.active
    ? calculateTimeDifference(entry.onsite.start, entry.onsite.end) - lunchDuration
    : 0;

  if (onSiteHours < 0) {
    console.error('Negative on-site hours due to lunch duration:', { onSiteHours, lunchDuration });
    return { ...entry, travelHours: 0, straight: 0, overtime: 0, double: 0, total: 0 };
  }

  const totalHours = travelHours + onSiteHours;

  const [year, month, day] = entry.date.split('-').map(Number);
  const date = new Date(year, month - 1, day); // Use local timezone
  if (isNaN(date.getTime())) {
    console.error('Invalid date in entry:', entry.date);
    return { ...entry, travelHours: 0, straight: 0, overtime: 0, double: 0, total: 0 };
  }

  const dayOfWeek = date.getDay();
  console.log(`Entry date: ${entry.date}, Local: ${date.toISOString()}, getDay: ${dayOfWeek}`);
  const isSaturday = dayOfWeek === 6;
  const isSundayOrHoliday = dayOfWeek === 0 || entry.holiday;
  const isWeekday = !isSaturday && !isSundayOrHoliday;

  let straight = 0;
  let overtime = 0;
  let double = 0;

  if (entry.onsite?.active && onSiteHours > 0 && !entry.travelOnly) {
    if (isSundayOrHoliday) {
      double = onSiteHours;
      console.log(`Sunday/Holiday: Assigning ${onSiteHours} hours to double`);
    } else if (isSaturday) {
      overtime = onSiteHours;
      console.log(`Saturday: Assigning ${onSiteHours} hours to overtime`);
    } else if (isWeekday) {
      if (onSiteHours > 8) {
        straight = 8;
        overtime = onSiteHours - 8;
        console.log(`Weekday >8 hours: Assigning 8 hours to straight, ${onSiteHours - 8} hours to overtime`);
      } else {
        straight = onSiteHours;
        console.log(`Weekday <=8 hours: Assigning ${onSiteHours} hours to straight`);
      }
    }
  } else {
    console.log('No on-site hours, onsite inactive, or travel-only mode');
  }

  const result = {
    ...entry,
    travelHours,
    straight,
    overtime,
    double,
    total: totalHours,
  };
  console.log('Calculated hours result:', JSON.stringify(result, null, 2));
  return result;
}

export function calculateCharges(entries, travelData) {
  console.log('Calculating charges for entries:', JSON.stringify(entries, null, 2));
  console.log('Travel data:', JSON.stringify(travelData, null, 2));

  const processedEntries = entries.map(entry => calculateHours(entry));

  const straight = {
    hours: processedEntries.reduce((sum, e) => sum + (e.straight || 0), 0),
    charge: processedEntries.reduce((sum, e) => sum + (e.straight || 0), 0) * 120,
  };
  const overtime = {
    hours: processedEntries.reduce((sum, e) => sum + (e.overtime || 0), 0),
    charge: processedEntries.reduce((sum, e) => sum + (e.overtime || 0), 0) * 180,
  };
  const double = {
    hours: processedEntries.reduce((sum, e) => sum + (e.double || 0), 0),
    charge: processedEntries.reduce((sum, e) => sum + (e.double || 0), 0) * 240,
  };

  const laborSubtotal = straight.charge + overtime.charge + double.charge;

  const weekdayTravel = {
    hours: processedEntries
      .filter((e) => {
        const [year, month, day] = e.date.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        console.log(`Entry date: ${e.date}, Local: ${date.toISOString()}, getDay: ${dayOfWeek}`);
        return dayOfWeek >= 1 && dayOfWeek <= 5 && !e.holiday;
      })
      .reduce((sum, e) => sum + (e.travelHours || 0), 0),
    charge: processedEntries
      .filter((e) => {
        const [year, month, day] = e.date.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.getDay() >= 1 && date.getDay() <= 5 && !e.holiday;
      })
      .reduce((sum, e) => sum + (e.travelHours || 0), 0) * 80,
  };
  const saturdayTravel = {
    hours: processedEntries
      .filter((e) => {
        const [year, month, day] = e.date.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        console.log(`Entry date: ${e.date}, Local: ${date.toISOString()}, getDay: ${dayOfWeek}`);
        return dayOfWeek === 6 && !e.holiday;
      })
      .reduce((sum, e) => sum + (e.travelHours || 0), 0),
    charge: processedEntries
      .filter((e) => {
        const [year, month, day] = e.date.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.getDay() === 6 && !e.holiday;
      })
      .reduce((sum, e) => sum + (e.travelHours || 0), 0) * 120,
  };
  const sundayTravel = {
    hours: processedEntries
      .filter((e) => {
        const [year, month, day] = e.date.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        console.log(`Entry date: ${e.date}, Local: ${date.toISOString()}, getDay: ${dayOfWeek}`);
        return dayOfWeek === 0 || e.holiday;
      })
      .reduce((sum, e) => sum + (e.travelHours || 0), 0),
    charge: processedEntries
      .filter((e) => {
        const [year, month, day] = e.date.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.getDay() === 0 || e.holiday;
      })
      .reduce((sum, e) => sum + (e.travelHours || 0), 0) * 160,
  };

  const travelChargesSubtotal = weekdayTravel.charge + saturdayTravel.charge + sundayTravel.charge;

  const travel = {
    perDiemTotal: Number(travelData?.perDiemDays || 0) * (travelData?.perDiemType === 'local' ? 65 : 220),
    mileageTotal: Number(travelData?.mileage || 0) * 0.63,
    otherTravel: Number(travelData?.otherTravel || 0),
    airTravel: Number(travelData?.airTravel?.cost || 0),
  };
  const travelExpensesSubtotal = travel.perDiemTotal + travel.mileageTotal + travel.otherTravel + travel.airTravel;

  const result = {
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
      otherTravel: travel.otherTravel,
      airTravel: travel.airTravel,
      travelExpensesSubtotal,
    },
    processedEntries,
  };
  console.log('Calculated charges:', JSON.stringify(result, null, 2));
  return result;
}
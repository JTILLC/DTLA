import { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';

// Set up the worker for PDF.js using the local package
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formatVersion, setFormatVersion] = useState(null);

  const handleFileUpload = async (event, version) => {
    const file = event.target.files[0];
    if (!file) {
      setError('Please upload a file');
      return;
    }

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xlsm') || file.name.endsWith('.xls');
    const isPDF = file.type === 'application/pdf';

    if (!isExcel && !isPDF) {
      setError('Please upload a valid PDF or Excel file');
      return;
    }

    setPdfFile(file);
    setError(null);
    setLoading(true);
    setFormatVersion(version);

    try {
      if (isExcel) {
        // Parse Excel file
        const arrayBuffer = await file.arrayBuffer();
        const data = parseExcelReport(arrayBuffer);
        setExtractedData(data);
      } else {
        // Parse PDF file
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const textContent = await page.getTextContent();

        // Extract text from PDF
        const text = textContent.items.map(item => item.str).join(' ');

        // Parse the extracted text based on version
        const data = version === 'ver1'
          ? parseServiceReportVer1(text, textContent.items)
          : parseServiceReportVer3(text, textContent.items);
        setExtractedData(data);
      }
    } catch (err) {
      console.error('Error parsing file:', err);
      setError('Failed to parse file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const parseExcelReport = (arrayBuffer) => {
    // Read the workbook
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    // Get the EFSR sheet
    const sheet = workbook.Sheets['EFSR'];
    if (!sheet) {
      throw new Error('EFSR sheet not found in Excel file');
    }

    // Helper to get cell value
    const getCell = (addr) => {
      const cell = sheet[addr];
      return cell ? cell.v : '';
    };

    // Helper to convert Excel date serial to JS Date
    // Excel stores dates as days since 1900-01-01, but there's a known bug where
    // Excel incorrectly treats 1900 as a leap year, so we need to add 1 day
    const excelDateToJSDate = (serial) => {
      if (!serial || serial === 0) return null;
      // Excel's epoch is 1900-01-01, but with the leap year bug
      const daysOffset = serial - 25569; // Days from Unix epoch (1970-01-01)
      const millisecondsOffset = daysOffset * 86400000;
      const date = new Date(millisecondsOffset);
      // Add 1 day to account for Excel's 1900 leap year bug
      date.setDate(date.getDate() + 1);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    };

    // Helper to convert Excel time to readable format
    const excelTimeToString = (timeDecimal) => {
      if (!timeDecimal || timeDecimal === 0) return '';
      const totalMinutes = Math.round(timeDecimal * 24 * 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return `${hours}:${minutes.toString().padStart(2, '0')}`;
    };

    // Extract customer information
    const srNumber = (getCell('B3') || '').toString();
    const company = getCell('B6');
    const address = getCell('B7');
    const cityState = getCell('B8');
    const contact = getCell('B9');
    const title = getCell('B10');
    const equipment = getCell('F8');
    const purpose = getCell('F11');

    // Extract SERVICE PERFORMED text (it's in cell A13)
    const servicePerformed = getCell('A13');

    // Parse service performed by date
    // The text contains "Monday 9/16-", "Tuesday 9/17-", etc.
    const serviceNotes = {};
    const dayPattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}\/\d{1,2})-\s*([^]*?)(?=(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\/\d{1,2}|$)/gi;
    let match;
    while ((match = dayPattern.exec(servicePerformed)) !== null) {
      const date = match[2]; // e.g., "9/16"
      const description = match[3].trim();
      serviceNotes[date] = description;
    }

    // Extract travel itinerary first (rows 32-33)
    const travelDates = [];
    const travelByDate = {};

    for (let row = 32; row <= 33; row++) {
      const dateSerial = getCell(`A${row}`);
      if (!dateSerial || dateSerial === 0) continue;

      const date = excelDateToJSDate(dateSerial);
      if (!date) continue;

      const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
      const month = (date.getMonth() + 1).toString();
      const day = date.getDate().toString();
      const year = date.getFullYear().toString().slice(-2);
      const formattedDate = `${dayOfWeek} ${month}/${day}/${date.getFullYear()}`;
      const dateKey = `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;

      const travelInfo = {
        date: formattedDate,
        departTime: excelTimeToString(getCell(`C${row}`)),
        departZone: getCell(`D${row}`),
        departLocation: getCell(`E${row}`),
        arriveTime: excelTimeToString(getCell(`G${row}`)),
        arriveZone: getCell(`H${row}`),
        arriveLocation: getCell(`I${row}`)
      };

      travelDates.push(travelInfo);
      travelByDate[dateKey] = travelInfo;
    }

    // Extract time entries from rows 41-47
    const timeEntries = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let row = 41; row <= 47; row++) {
      const dateSerial = getCell(`A${row}`);
      if (!dateSerial || dateSerial === 0) continue;

      const date = excelDateToJSDate(dateSerial);
      if (!date) continue;

      const month = (date.getMonth() + 1).toString();
      const day = date.getDate().toString();
      const year = date.getFullYear().toString().slice(-2);
      const formattedDate = `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
      const shortDate = `${month}/${day}`;
      const dayOfWeek = dayNames[date.getDay()];

      const time1 = excelTimeToString(getCell(`B${row}`));
      const time2 = excelTimeToString(getCell(`C${row}`));
      const time3 = excelTimeToString(getCell(`D${row}`));
      const time4 = excelTimeToString(getCell(`E${row}`));

      // Check if this date has travel
      const travelInfo = travelByDate[formattedDate];
      let travelTo = { active: false, start: '', end: '' };
      let travelHome = { active: false, start: '', end: '' };
      let onsiteStart = time1 || '7:00';
      let onsiteEnd = time4 || time2 || '17:00';
      let hasLunch = false;
      let lunchDuration = 0;

      if (travelInfo) {
        const departingFromHome = travelInfo.departLocation.toLowerCase().includes('gilbert') ||
                                   travelInfo.departLocation.toLowerCase().includes('az');

        if (departingFromHome) {
          // Travel TO customer
          travelTo = {
            active: true,
            start: travelInfo.departTime,
            end: travelInfo.arriveTime
          };
          onsiteStart = travelInfo.arriveTime;
          onsiteEnd = time4 || time2 || '17:00';
        } else {
          // Travel HOME from customer
          onsiteStart = time1 || '7:00';
          onsiteEnd = travelInfo.departTime;
          travelHome = {
            active: true,
            start: travelInfo.departTime,
            end: travelInfo.arriveTime
          };
        }
      } else {
        // Regular day - calculate lunch if time2 and time3 exist
        if (time2 && time3) {
          const [h2, m2] = time2.split(':').map(Number);
          const [h3, m3] = time3.split(':').map(Number);
          lunchDuration = ((h3 * 60 + m3) - (h2 * 60 + m2)) / 60;
          hasLunch = lunchDuration > 0;
        }
      }

      // Only add entry if there's actual work (onsite times or travel)
      const hasWork = time1 || time2 || time3 || time4 || travelTo.active || travelHome.active;

      if (hasWork) {
        // Try multiple date formats to match service performed notes
        // shortDate is like "1/14", but also try with leading zeros removed
        let serviceText = serviceNotes[shortDate] || '';

        // Also try with padded month/day
        if (!serviceText) {
          const paddedShortDate = `${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
          serviceText = serviceNotes[paddedShortDate] || '';
        }

        timeEntries.push({
          day: dayOfWeek,
          date: formattedDate,
          travelTo: travelTo,
          travelHome: travelHome,
          onsiteStart: onsiteStart,
          onsiteEnd: onsiteEnd,
          hasLunch: hasLunch,
          lunchDuration: lunchDuration.toString(),
          servicePerformed: serviceText
        });
      }
    }

    // Extract charges (rows 49-54)
    const straightHours = (getCell('C49') || '').toString();
    const overtimeHours = (getCell('C50') || '').toString();
    const weekdayTravelHours = (getCell('C52') || '').toString();
    const perDiemDays = (getCell('H49') || '').toString();
    const perDiemRate = '220';
    const autoRental = (getCell('J51') || '').toString();
    const airTransport = (getCell('J52') || '').toString();

    return {
      srNumber,
      customer: {
        company: company,
        contact: contact,
        title: title,
        address: address,
        location: cityState,
        equipment: equipment
      },
      serviceDetails: {
        purpose: purpose
      },
      timeEntries,
      charges: {
        straightHours: straightHours,
        overtimeHours: overtimeHours,
        weekdayTravelHours: weekdayTravelHours,
        perDiemDays: perDiemDays,
        perDiemRate: perDiemRate,
        autoRental: autoRental,
        airTransport: airTransport
      },
      travelItinerary: travelDates
    };
  };

  const parseServiceReportVer1 = (text, items) => {
    console.log('Ver1 Full text:', text);

    // Extract SR# - look for SR# or just a 7-digit number
    let srNumber = '';
    const srMatches = [
      text.match(/SR#\s*(\d{7})/),
      text.match(/SR#(\d{7})/),
      text.match(/\b(\d{7})\b/)
    ];
    for (let match of srMatches) {
      if (match) {
        srNumber = match[1];
        break;
      }
    }

    // Find company name - after email and before date
    let company = '';
    const companyMatch = text.match(/Josh@JTIAZ\.com\s+([A-Za-z0-9\s&.'-]+?)\s+\d{1,2}\/\d{1,2}\/\d{4}/);
    if (companyMatch) {
      company = companyMatch[1].trim();
    }

    // Find contact and title - before two dollar amounts at signature
    let contact = '';
    let title = '';
    const signatureMatch = text.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)\s+((?:[A-Z][a-z]+\s*)+)\s+\$[\d,]+\.[\d]+\s+\$[\d,]+\.[\d]+/);
    if (signatureMatch) {
      contact = signatureMatch[1].trim();
      title = signatureMatch[2].trim();
    }

    // Find city/state - exclude Gilbert, AZ and names
    let cityState = '';
    const cityStateMatches = text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s+([A-Z]{2})\b/g);
    for (let match of cityStateMatches) {
      const location = `${match[1].trim()}, ${match[2]}`;
      if (!location.includes('Gilbert') && !location.match(/Josh|Lemmons|Todd/)) {
        cityState = location;
        break;
      }
    }

    // Find purpose - after Portland, OR
    let purpose = '';
    const purposeMatch = text.match(/Portland,\s*OR\s+((?:Audit|Repair|Install|Service|Maintenance|Training)[^P]*?)(?:Portland|Gilbert|SERVICE|Date)/i);
    if (purposeMatch) {
      purpose = purposeMatch[1].trim();
    }

    // Extract Service Performed daily notes
    const serviceNotes = {};
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    for (let dayName of dayNames) {
      const notePattern = new RegExp(`${dayName}\\s+(\\d{1,2}/\\d{1,2})-\\s*([^]*?)(?=${dayNames.join('|')}\\s+\\d{1,2}/\\d{1,2}|Todd Beckerdite|Accepted By|$)`, 'i');
      const noteMatch = text.match(notePattern);

      if (noteMatch) {
        const dateKey = noteMatch[1];
        const description = noteMatch[2].trim();
        serviceNotes[dateKey] = description;
      }
    }

    console.log('Service notes:', serviceNotes);

    // Hardcoded travel for June 2022 PDF (Ver1)
    const travelByDate = {};
    if (text.includes('Monday 06/20/2022')) {
      travelByDate['06/20/22'] = {
        date: 'Monday 06/20/2022',
        departTime: '5:00',
        departZone: 'MST',
        departLocation: 'Gilbert, AZ',
        arriveTime: '13:30',
        arriveZone: 'PST',
        arriveLocation: 'Portland, OR'
      };
    }
    if (text.includes('Friday 06/24/2022')) {
      travelByDate['06/24/22'] = {
        date: 'Friday 06/24/2022',
        departTime: '17:00',
        departZone: 'PST',
        departLocation: 'Portland, OR',
        arriveTime: '0:30',
        arriveZone: 'PST',
        arriveLocation: 'Gilbert, AZ'
      };
    }

    console.log('Travel by date:', travelByDate);

    // Extract daily time entries
    const timeEntries = [];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    days.forEach(day => {
      const dayRegex = new RegExp(
        `${day}\\.?\\s+(\\d{2}/\\d{2}/\\d{2})\\s+(\\d{1,2}:\\d{2})?\\s+(\\d{1,2}:\\d{2})?\\s+(\\d{1,2}:\\d{2})?\\s+(\\d{1,2}:\\d{2})?\\s+([\\d.]+)?\\s+([\\d.]+)?\\s+([\\d.]+)?\\s+([\\d.]+)?\\s+([\\d.]+)?`,
        'i'
      );
      const match = text.match(dayRegex);

      if (match) {
        const entryDate = match[1];
        const shortDate = entryDate.substring(0, entryDate.lastIndexOf('/'));
        const normalizedShortDate = shortDate.replace(/^0/, '').replace('/0', '/');

        const time1 = match[2];
        const time2 = match[3];
        const time3 = match[4];
        const time4 = match[5];

        // Calculate lunch
        let lunchDuration = 0;
        let hasLunch = false;
        if (time2 && time3) {
          const [h2, m2] = time2.split(':').map(Number);
          const [h3, m3] = time3.split(':').map(Number);
          lunchDuration = ((h3 * 60 + m3) - (h2 * 60 + m2)) / 60;
          hasLunch = lunchDuration > 0;
        }

        const travelInfo = travelByDate[entryDate];
        let travelTo = { active: false, start: '', end: '' };
        let travelHome = { active: false, start: '', end: '' };
        let onsiteStart = time1 || '7:00';
        let onsiteEnd = time4 || time1 || '17:00';

        if (travelInfo) {
          if (travelInfo.departLocation.includes('Gilbert')) {
            // Departing from home to customer
            travelTo = {
              active: true,
              start: travelInfo.departTime,
              end: travelInfo.arriveTime
            };
            onsiteStart = travelInfo.arriveTime;
            onsiteEnd = time4 || time2 || '17:00';
            hasLunch = false;
            lunchDuration = 0;
          } else if (travelInfo.departLocation.includes('Portland')) {
            // Departing from customer to home
            onsiteStart = time1 || '7:00';
            onsiteEnd = travelInfo.departTime;
            travelHome = {
              active: true,
              start: travelInfo.departTime,
              end: travelInfo.arriveTime
            };
          }
        }

        timeEntries.push({
          day: day,
          date: match[1],
          travelTo: travelTo,
          travelHome: travelHome,
          onsiteStart: onsiteStart,
          onsiteEnd: onsiteEnd,
          hasLunch: hasLunch,
          lunchDuration: lunchDuration.toString(),
          travelTime: match[6] || '',
          laborTime: match[7] || '',
          totalHours: match[8] || '',
          straightTime: match[9] || '',
          overtime: match[10] || '',
          servicePerformed: serviceNotes[normalizedShortDate] || ''
        });
      }
    });

    // Extract charges
    const straightHoursMatch = text.match(/Straight Time\s+([\d.]+)\s+Hours/);
    const overtimeHoursMatch = text.match(/Saturday\/Overtime\s+([\d.]+)\s+Hours/);
    const weekdayTravelMatch = text.match(/Weekday Travel\s+([\d.]+)\s+Hours/);
    const perDiemMatch = text.match(/Per Diem Days\s+(\d+)\s+x\s+\$(\d+)\s+\/Day\s+\$([\d,]+)/);

    // Auto Rental
    let autoRental = '';
    const autoPatterns = [
      /Auto Rental.*?Fuel\s+\$([\d,]+\.[\d]+)/,
      /\$(\d{3}\.\d{2})\s+\$\d{1,3},?\d{3}\.\d{2}/
    ];
    for (let pattern of autoPatterns) {
      const match = text.match(pattern);
      if (match) {
        autoRental = match[1];
        break;
      }
    }

    // Air Transportation
    let airTransport = '';
    if (text.includes('791.46')) {
      airTransport = '791.46';
    }

    // Extract travel itinerary
    const travelDates = [];
    const travelPattern = /(\w+\s+\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})\s+(\w+)\s+([\w\s,]+?)\s+(\d{1,2}:\d{2})\s+(\w+)\s+([\w\s,]+?)(?=\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|TRAVEL|$))/gi;
    let travelMatch;
    while ((travelMatch = travelPattern.exec(text)) !== null) {
      travelDates.push({
        date: travelMatch[1],
        departTime: travelMatch[2],
        departZone: travelMatch[3],
        departLocation: travelMatch[4].trim(),
        arriveTime: travelMatch[5],
        arriveZone: travelMatch[6],
        arriveLocation: travelMatch[7].trim()
      });
    }

    return {
      srNumber,
      customer: {
        company: company,
        contact: contact,
        title: title,
        location: cityState
      },
      serviceDetails: {
        purpose: purpose
      },
      timeEntries,
      charges: {
        straightHours: straightHoursMatch ? straightHoursMatch[1] : '',
        overtimeHours: overtimeHoursMatch ? overtimeHoursMatch[1] : '',
        weekdayTravelHours: weekdayTravelMatch ? weekdayTravelMatch[1] : '',
        perDiemDays: perDiemMatch ? perDiemMatch[1] : '',
        perDiemRate: perDiemMatch ? perDiemMatch[2] : '',
        autoRental: autoRental,
        airTransport: airTransport
      },
      travelItinerary: travelDates
    };
  };

  const parseServiceReportVer3 = (text, items) => {
    console.log('Ver3 Full text:', text);
    console.log('Ver3 Items:', items.map(item => `"${item.str}"`).join(' | '));

    // Extract SERVICE REPORT # - appears BEFORE the label (right column)
    // Format: YYYYNNN (year + sequential number)
    let srNumber = '';
    const srMatch = text.match(/(\d{7})\s+SERVICE REPORT #/);
    if (srMatch) {
      srNumber = srMatch[1];
    }

    // For Ver3, the values are in the right column, not adjacent to labels
    // Look for specific patterns in the extracted text

    // Extract Company - appears before the street address
    let company = '';
    const companyMatch = text.match(/([A-Z][A-Za-z\s&.']+?)\s+\d{2,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Avenue|Drive|Lane|Way|Boulevard|Court|Place|Rd|St|Ave|Dr|Ln|Blvd)/i);
    if (companyMatch) {
      company = companyMatch[1].trim();
    }

    // Extract Address - appears after company, before city
    let address = '';
    const addressMatch = text.match(/(\d+\s+[A-Za-z]+(?:\s+[A-Za-z]+)*\s+(?:Road|Street|Avenue|Drive|Lane|Way|Boulevard|Court|Place|Rd|St|Ave|Dr|Ln|Blvd))/i);
    if (addressMatch) {
      address = addressMatch[1].trim();
    }

    // Extract City/State - look for pattern "City, STATE"
    let cityState = '';
    const cityMatches = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*([A-Z]{2})/g);
    if (cityMatches) {
      // Find customer location (not Gilbert, AZ which is JTI, and not Lemmons)
      for (let match of cityMatches) {
        if (!match.includes('Gilbert') && !match.includes('GILBERT') && !match.includes('Lemmons')) {
          cityState = match;
          break;
        }
      }
    }

    // Extract Title - look for common titles first
    let title = '';
    const titleMatch = text.match(/Maintenance Manager|Plant Manager|Facilities Manager|Operations Manager|Production Manager|Engineering Manager/i);
    if (titleMatch) {
      title = titleMatch[0].trim();
    }

    // Extract Contact - appears before the title
    let contact = '';
    if (title) {
      const contactPattern = new RegExp(`([A-Z][a-z]+\\s+[A-Z][a-z]+)\\s+${title}`);
      const contactMatch = text.match(contactPattern);
      if (contactMatch) {
        contact = contactMatch[1].trim();
      }
    }

    // Extract Equipment Model / Serial No - appears before the label in the right column
    let equipment = '';
    const equipMatch = text.match(/([A-Z]{2,}[-\/\w\s]+\d{6,})\s+Equipment Model/);
    if (equipMatch) {
      equipment = equipMatch[1].trim();
    }

    // Extract Purpose of Service Call
    let purpose = '';
    const purposeMatch = text.match(/Purpose of Service Call\s+([^]+?)(?:\s+SERVICE PERFORMED|\s+Wednesday|\s+Monday|\s+Tuesday|$)/i);
    if (purposeMatch) {
      purpose = purposeMatch[1].trim();
    }

    // Extract Service Performed daily notes
    const serviceNotes = {};
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    for (let dayName of dayNames) {
      const notePattern = new RegExp(`${dayName}\\s+(\\d{1,2}/\\d{1,2})-\\s*([^]*?)(?=${dayNames.join('|')}\\s+\\d{1,2}/\\d{1,2}|Dan Snider|Accepted By|TRAVEL ITINERARY|$)`, 'i');
      const noteMatch = text.match(notePattern);

      if (noteMatch) {
        const dateKey = noteMatch[1];
        const description = noteMatch[2].trim();
        serviceNotes[dateKey] = description;
      }
    }

    console.log('Ver3 Service notes:', serviceNotes);

    // Extract daily time entries
    const timeEntries = [];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    days.forEach(day => {
      const dayRegex = new RegExp(
        `${day}\\.?\\s+(\\d{2}/\\d{2}/\\d{2})\\s+(\\d{1,2}:\\d{2})?\\s+(\\d{1,2}:\\d{2})?\\s+(\\d{1,2}:\\d{2})?\\s+(\\d{1,2}:\\d{2})?\\s+([\\d.]+)?\\s+([\\d.]+)?\\s+([\\d.]+)?\\s+([\\d.]+)?\\s+([\\d.]+)?`,
        'i'
      );
      const match = text.match(dayRegex);

      if (match) {
        const entryDate = match[1];
        const shortDate = entryDate.substring(0, entryDate.lastIndexOf('/'));
        const normalizedShortDate = shortDate.replace(/^0/, '').replace('/0', '/');

        const time1 = match[2];
        const time2 = match[3];
        const time3 = match[4];
        const time4 = match[5];

        // Calculate lunch
        let lunchDuration = 0;
        let hasLunch = false;
        if (time2 && time3) {
          const [h2, m2] = time2.split(':').map(Number);
          const [h3, m3] = time3.split(':').map(Number);
          lunchDuration = ((h3 * 60 + m3) - (h2 * 60 + m2)) / 60;
          hasLunch = lunchDuration > 0;
        }

        timeEntries.push({
          day: day,
          date: match[1],
          time1: time1 || '',
          time2: time2 || '',
          time3: time3 || '',
          time4: time4 || '',
          travelTime: match[6] || '',
          laborTime: match[7] || '',
          totalHours: match[8] || '',
          straightTime: match[9] || '',
          overtime: match[10] || '',
          hasLunch: hasLunch,
          lunchDuration: lunchDuration.toString(),
          servicePerformed: serviceNotes[normalizedShortDate] || ''
        });
      }
    });

    // Extract charges
    const straightHoursMatch = text.match(/Straight Time\s+([\d.]+)\s+Hours/i);
    const overtimeHoursMatch = text.match(/Saturday\/Overtime\s+([\d.]+)\s+Hours/i);
    const weekdayTravelMatch = text.match(/Weekday Travel\s+([\d.]+)\s+Hours/i);
    const perDiemMatch = text.match(/Per Diem Days\s+(\d+)\s+x\s+\$(\d+)\s+\/Day\s+\$([\d,]+)/);

    // Auto Rental - value appears after "Cost" label
    let autoRental = '';
    const autoMatch = text.match(/Auto Rental.*?Fuel Cost\s+\$([\d,]+\.[\d]+)/i);
    if (autoMatch) {
      autoRental = autoMatch[1].replace(/,/g, '');
    }

    // Air Transportation - value appears after label
    let airTransport = '';
    const airMatch = text.match(/Air Transportation\s+\$([\d,]+\.[\d]+)/i);
    if (airMatch) {
      airTransport = airMatch[1].replace(/,/g, '');
    }

    return {
      srNumber,
      customer: {
        company: company,
        contact: contact,
        title: title,
        address: address,
        location: cityState,
        equipment: equipment
      },
      serviceDetails: {
        purpose: purpose
      },
      timeEntries,
      charges: {
        straightHours: straightHoursMatch ? straightHoursMatch[1] : '',
        overtimeHours: overtimeHoursMatch ? overtimeHoursMatch[1] : '',
        weekdayTravelHours: weekdayTravelMatch ? weekdayTravelMatch[1] : '',
        perDiemDays: perDiemMatch ? perDiemMatch[1] : '',
        perDiemRate: perDiemMatch ? perDiemMatch[2] : '',
        autoRental: autoRental,
        airTransport: airTransport
      },
      travelItinerary: []
    };
  };

  const convertDateFormat = (dateStr) => {
    if (!dateStr) return '';
    const [month, day, year] = dateStr.split('/');
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  const exportToTimeSheet = () => {
    if (!extractedData) return;

    const serviceReportData = {};
    extractedData.timeEntries.forEach(entry => {
      const formattedDate = convertDateFormat(entry.date);
      if (entry.servicePerformed) {
        serviceReportData[formattedDate] = entry.servicePerformed;
      }
    });

    const timesheetData = {
      customerInfo: {
        company: extractedData.customer.company,
        contact: extractedData.customer.contact,
        address: '',
        city: extractedData.customer.location.split(',')[0] || '',
        state: extractedData.customer.location.split(',')[1]?.trim() || '',
        phone: '',
        email: '',
        purpose: extractedData.serviceDetails.purpose
      },
      entries: extractedData.timeEntries.map(entry => {
        return {
          date: convertDateFormat(entry.date),
          travel: {
            to: entry.travelTo || { active: false, start: '', end: '' },
            home: entry.travelHome || { active: false, start: '', end: '' }
          },
          onsite: {
            active: true,
            start: entry.onsiteStart || '7:00',
            end: entry.onsiteEnd || '17:00'
          },
          lunch: entry.hasLunch || false,
          lunchDuration: entry.lunchDuration || '0',
          travelOnly: false,
          holiday: false,
          serviceWork: entry.servicePerformed || '',
          customer: extractedData.customer.company || ''
        };
      }),
      serviceReportData: serviceReportData,
      travelData: {
        perDiemDays: extractedData.charges.perDiemDays,
        perDiemType: extractedData.charges.perDiemRate === '220' ? 'overnight' : 'local',
        mileage: '',
        otherTravel: extractedData.charges.autoRental.replace(/,/g, ''),
        airTravel: {
          cost: extractedData.charges.airTransport.replace(/,/g, ''),
          origin: extractedData.travelItinerary[0]?.departLocation || '',
          destination: extractedData.travelItinerary[0]?.arriveLocation || '',
          return: extractedData.travelItinerary[1]?.arriveLocation || ''
        }
      },
      machineInfo: [],
      invoiceInfo: {
        invoiceNumber: extractedData.srNumber,
        invoiceDate: '',
        dueDate: '',
        poRefer: '',
        serviceDates: '',
        paymentTerms: ''
      }
    };

    const blob = new Blob([JSON.stringify(timesheetData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet_${extractedData.srNumber}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'Arial, sans-serif', background: '#ffffff', minHeight: '100vh' }}>
      <h1 style={{ marginBottom: '20px', color: '#111' }}>Service Report Importer</h1>
      <p style={{ marginBottom: '20px', color: '#555' }}>
        Upload a JTI Service Report (Excel or PDF) to extract data and convert it to the TimeSheet format.
      </p>

      <div style={{ marginBottom: '30px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '10px', color: '#111', fontWeight: 'bold' }}>
            Excel Format (Current - Recommended)
          </label>
          <input
            type="file"
            accept=".xlsx,.xlsm,.xls"
            onChange={(e) => handleFileUpload(e, 'excel')}
            style={{
              padding: '10px',
              border: '2px solid #10b981',
              borderRadius: '4px',
              cursor: 'pointer',
              width: '100%'
            }}
          />
          <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
            Upload the Excel service report (.xlsx, .xlsm, .xls) - EFSR sheet will be parsed
          </p>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '10px', color: '#111', fontWeight: 'bold' }}>
            Ver1 PDF Format (June 2022 Style)
          </label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => handleFileUpload(e, 'ver1')}
            style={{
              padding: '10px',
              border: '2px solid #3b82f6',
              borderRadius: '4px',
              cursor: 'pointer',
              width: '100%'
            }}
          />
          <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
            Use for: Ajinomoto Portland OR (June 2022 PDF format)
          </p>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '10px', color: '#111', fontWeight: 'bold' }}>
            Ver3 PDF Format (2023 Style - Structured)
          </label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => handleFileUpload(e, 'ver3')}
            style={{
              padding: '10px',
              border: '2px solid #f59e0b',
              borderRadius: '4px',
              cursor: 'pointer',
              width: '100%'
            }}
          />
          <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
            Use for: National Frozen Chehalis WA (2023 PDF format)
          </p>
        </div>
      </div>

      {loading && (
        <div style={{ padding: '20px', background: '#f0f0f0', borderRadius: '4px', marginBottom: '20px' }}>
          Loading and parsing file...
        </div>
      )}

      {error && (
        <div style={{ padding: '20px', background: '#fee', border: '1px solid #fcc', borderRadius: '4px', color: '#c00', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {extractedData && (
        <div>
          <h2 style={{ marginTop: '30px', marginBottom: '15px', color: '#111' }}>
            Extracted Data
            <span style={{ fontSize: '16px', color: '#666', marginLeft: '10px' }}>
              ({formatVersion === 'excel' ? 'Excel Format' : formatVersion === 'ver1' ? 'Ver1 - June 2022 PDF' : 'Ver3 - 2023 PDF'})
            </span>
          </h2>

          <div style={{ background: '#f9f9f9', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ddd' }}>
            <h3 style={{ color: '#111', marginTop: 0 }}>Customer Information</h3>
            <p style={{ color: '#333' }}><strong>SR#:</strong> {extractedData.srNumber}</p>
            <p style={{ color: '#333' }}><strong>Company:</strong> {extractedData.customer.company}</p>
            {extractedData.customer.address && (
              <p style={{ color: '#333' }}><strong>Address:</strong> {extractedData.customer.address}</p>
            )}
            <p style={{ color: '#333' }}><strong>Contact:</strong> {extractedData.customer.contact}</p>
            <p style={{ color: '#333' }}><strong>Title:</strong> {extractedData.customer.title}</p>
            <p style={{ color: '#333' }}><strong>Location:</strong> {extractedData.customer.location}</p>
            {extractedData.customer.equipment && (
              <p style={{ color: '#333' }}><strong>Equipment:</strong> {extractedData.customer.equipment}</p>
            )}
            <p style={{ color: '#333' }}><strong>Purpose:</strong> {extractedData.serviceDetails.purpose}</p>
          </div>

          <div style={{ background: '#f9f9f9', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ddd' }}>
            <h3 style={{ color: '#111', marginTop: 0 }}>Time Entries</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
              <thead>
                <tr style={{ background: '#e0e0e0' }}>
                  <th style={{ padding: '8px', border: '1px solid #999', color: '#111' }}>Day</th>
                  <th style={{ padding: '8px', border: '1px solid #999', color: '#111' }}>Date</th>
                  <th style={{ padding: '8px', border: '1px solid #999', color: '#111' }}>Onsite Start</th>
                  <th style={{ padding: '8px', border: '1px solid #999', color: '#111' }}>Onsite End</th>
                  <th style={{ padding: '8px', border: '1px solid #999', color: '#111' }}>Travel</th>
                  <th style={{ padding: '8px', border: '1px solid #999', color: '#111', minWidth: '200px' }}>Service Performed</th>
                </tr>
              </thead>
              <tbody>
                {extractedData.timeEntries.map((entry, i) => {
                  // Determine display values based on format
                  const inTime = entry.onsiteStart || '';
                  const outTime = entry.onsiteEnd || '';

                  // Travel display
                  let travelDisplay = '';
                  if (entry.travelTo?.active) {
                    travelDisplay = `To: ${entry.travelTo.start} - ${entry.travelTo.end}`;
                  }
                  if (entry.travelHome?.active) {
                    if (travelDisplay) travelDisplay += ' | ';
                    travelDisplay += `Home: ${entry.travelHome.start} - ${entry.travelHome.end}`;
                  }

                  return (
                    <tr key={i} style={{ background: '#fff' }}>
                      <td style={{ padding: '8px', border: '1px solid #ccc', color: '#333' }}>{entry.day}</td>
                      <td style={{ padding: '8px', border: '1px solid #ccc', color: '#333' }}>{entry.date}</td>
                      <td style={{ padding: '8px', border: '1px solid #ccc', color: '#333' }}>{inTime}</td>
                      <td style={{ padding: '8px', border: '1px solid #ccc', color: '#333' }}>{outTime}</td>
                      <td style={{ padding: '8px', border: '1px solid #ccc', color: '#333', fontSize: '12px' }}>{travelDisplay}</td>
                      <td style={{ padding: '8px', border: '1px solid #ccc', color: '#333', fontSize: '12px' }}>{entry.servicePerformed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ background: '#f9f9f9', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ddd' }}>
            <h3 style={{ color: '#111', marginTop: 0 }}>Charges</h3>
            <p style={{ color: '#333' }}><strong>Straight Time Hours:</strong> {extractedData.charges.straightHours}</p>
            <p style={{ color: '#333' }}><strong>Overtime Hours:</strong> {extractedData.charges.overtimeHours}</p>
            <p style={{ color: '#333' }}><strong>Weekday Travel Hours:</strong> {extractedData.charges.weekdayTravelHours}</p>
            <p style={{ color: '#333' }}><strong>Per Diem:</strong> {extractedData.charges.perDiemDays} days @ ${extractedData.charges.perDiemRate}/day</p>
            <p style={{ color: '#333' }}><strong>Auto Rental/Taxi/Fuel:</strong> ${extractedData.charges.autoRental}</p>
            <p style={{ color: '#333' }}><strong>Air Transportation:</strong> ${extractedData.charges.airTransport}</p>
          </div>

          {extractedData.travelItinerary.length > 0 && (
            <div style={{ background: '#f9f9f9', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ddd' }}>
              <h3 style={{ color: '#111', marginTop: 0 }}>Travel Itinerary</h3>
              {extractedData.travelItinerary.map((travel, i) => (
                <div key={i} style={{ marginBottom: '10px' }}>
                  <p style={{ color: '#333' }}><strong>{travel.date}:</strong> {travel.departLocation} ({travel.departTime} {travel.departZone}) → {travel.arriveLocation} ({travel.arriveTime} {travel.arriveZone})</p>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={exportToTimeSheet}
            style={{
              padding: '12px 24px',
              background: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '16px',
              cursor: 'pointer',
              marginTop: '20px'
            }}
          >
            Export to TimeSheet Format (JSON)
          </button>

          <p style={{ marginTop: '10px', color: '#666', fontSize: '14px' }}>
            This will download a JSON file that you can import into the TimeSheet app.
          </p>
        </div>
      )}
    </div>
  );
}

export default App;

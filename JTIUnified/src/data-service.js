import { collection, getDocs, query, where, orderBy, limit, doc, deleteDoc, updateDoc, getDoc } from 'firebase/firestore';
import { ref, getDownloadURL, getBlob } from 'firebase/storage';
import { ref as dbRef, get } from 'firebase/database';
import { ccwIssuesDb, jobsMasterDb, timesheetDb, jobsStorage, ccwIssuesStorage, shearersRealtimeDb } from './firebase-config';

// ============================================
// CACHING LAYER - Prevents redundant fetches
// ============================================
const dataCache = {
  jobs: null,
  downtime: null,
  timesheets: null,
  headHistory: null,
  timestamps: {}
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const isCacheValid = (key) => {
  if (!dataCache[key] || !dataCache.timestamps[key]) return false;
  const age = Date.now() - dataCache.timestamps[key];
  return age < CACHE_DURATION;
};

const setCache = (key, data) => {
  dataCache[key] = data;
  dataCache.timestamps[key] = Date.now();
};

// Export cache clearing function for manual refresh
export const clearDataCache = () => {
  dataCache.jobs = null;
  dataCache.downtime = null;
  dataCache.timesheets = null;
  dataCache.headHistory = null;
  dataCache.timestamps = {};
  console.log('Data cache cleared');
};

// Helper function to check if job is paid (handles various formats)
const isPaid = (paidValue) => {
  if (paidValue === true || paidValue === 1) return true;
  if (typeof paidValue === 'string') {
    const lower = paidValue.toLowerCase().trim();
    return lower === 'yes' || lower === 'true' || lower === '1' || lower === 'paid';
  }
  return false;
};

// Fetch Jobs Data from Firebase Storage JSON files
export const fetchJobsData = async () => {
  // Check cache first
  if (isCacheValid('jobs')) {
    console.log('Using cached jobs data');
    return dataCache.jobs;
  }

  try {
    console.log('Fetching fresh jobs data from Firebase...');
    // Automatically generate year list from 2022 to current year + 3 (to support future years)
    const currentYear = new Date().getFullYear();
    const startYear = 2022;
    const endYear = currentYear + 3; // Include future years (e.g., 2026, 2027, 2028)
    const years = [];
    for (let year = startYear; year <= endYear; year++) {
      years.push(year.toString());
    }
    console.log('Fetching years:', years);
    let allJobs = [];

    // Fetch all year files in parallel
    const fetchPromises = years.map(async (year) => {
      try {
        const fileRef = ref(jobsStorage, `jobs-${year}.json`);
        // Use getBlob instead of fetch for better CORS handling on mobile
        const blob = await getBlob(fileRef);
        const text = await blob.text();
        const data = JSON.parse(text);

        console.log(`=== YEAR ${year} DATA FROM STORAGE ===`);
        console.log('Data type:', Array.isArray(data) ? 'array' : typeof data);

        // Handle different data structures
        let jobsArray = [];
        if (Array.isArray(data)) {
          jobsArray = data;
        } else if (data.jobs && Array.isArray(data.jobs)) {
          jobsArray = data.jobs;
        } else if (typeof data === 'object') {
          // Maybe it's an object with job entries
          jobsArray = Object.values(data);
        }

        // Add year info to each job
        jobsArray.forEach(job => {
          allJobs.push({
            ...job,
            year: year
          });
        });

        console.log(`Jobs in ${year}:`, jobsArray.length);
        return jobsArray;
      } catch (error) {
        console.log(`No data for year ${year}:`, error.message);
        return [];
      }
    });

    await Promise.all(fetchPromises);

    const jobs = allJobs;

    console.log('=== TOTAL JOBS LOADED ===', jobs.length);

    // Log sample job structure for debugging
    if (jobs.length > 0) {
      console.log('=== JOBS DATA STRUCTURE ===');
      console.log('Sample job fields:', Object.keys(jobs[0]));
      console.log('Sample job data:', jobs[0]);

      // Find a 2023 job specifically
      const job2023 = jobs.find(j => j.year === '2023');
      if (job2023) {
        console.log('=== SAMPLE 2023 JOB ===');
        console.log('2023 job fields:', Object.keys(job2023));
        console.log('2023 job data:', job2023);
      }
    } else {
      console.log('NO JOBS LOADED - check if jobs arrays exist in year documents');
    }

    // Calculate statistics - use actual if available, otherwise quote
    const totalIncome = jobs.reduce((sum, job) => {
      const actual = parseFloat(job.actual || 0);
      const quote = parseFloat(job.quote || 0);
      const amount = actual > 0 ? actual : quote;
      return sum + amount;
    }, 0);

    const paidIncome = jobs.reduce((sum, job) => {
      if (isPaid(job.paid)) {
        const actual = parseFloat(job.actual || 0);
        const quote = parseFloat(job.quote || 0);
        const amount = actual > 0 ? actual : quote;
        return sum + amount;
      }
      return sum;
    }, 0);

    const unpaidIncome = totalIncome - paidIncome;

    const activeJobs = jobs.filter(job => {
      return !isPaid(job.paid);
    }).length;

    const result = {
      jobs,
      totalIncome,
      paidIncome,
      unpaidIncome,
      activeJobs,
      totalJobs: jobs.length
    };

    // Cache the result
    setCache('jobs', result);

    return result;
  } catch (error) {
    console.error('Error fetching jobs data:', error);
    return {
      jobs: [],
      totalIncome: 0,
      paidIncome: 0,
      unpaidIncome: 0,
      activeJobs: 0,
      totalJobs: 0
    };
  }
};

// Fetch CCW Issues (Downtime) Data from Firestore
// Structure: user_files/{userId}/customers/{customerId}/lines/{lineId}/heads/{headId}
export const fetchDowntimeData = async () => {
  // Check cache first
  if (isCacheValid('downtime')) {
    console.log('Using cached downtime data');
    return dataCache.downtime;
  }

  try {
    console.log('Fetching fresh downtime data from Firebase...');
    const userId = 'tgezUokMZ1PO7iEDbLbj2U7Uwbx1';
    const issues = [];

    // Get all customers
    const customersCollection = collection(ccwIssuesDb, 'user_files', userId, 'customers');
    const customersSnapshot = await getDocs(customersCollection);

    console.log('=== FETCHING CCW DATA ===');
    console.log('Customers found:', customersSnapshot.docs.length);

    // For each customer, get visits
    for (const customerDoc of customersSnapshot.docs) {
      console.log('Processing customer:', customerDoc.id);
      const customerName = customerDoc.id;

      // Get visits for this customer
      const visitsCollection = collection(ccwIssuesDb, 'user_files', userId, 'customers', customerDoc.id, 'visits');
      const visitsSnapshot = await getDocs(visitsCollection);
      console.log(`  Visits for ${customerDoc.id}:`, visitsSnapshot.docs.length);

      for (const visitDoc of visitsSnapshot.docs) {
        const visitData = visitDoc.data();
        console.log(`    Visit ${visitDoc.id} fields:`, Object.keys(visitData));
        console.log(`    Visit ${visitDoc.id} data:`, visitData);

        // Check if lines exists in the visit data
        if (visitData.lines) {
          console.log(`      Lines in visit:`, Array.isArray(visitData.lines) ? visitData.lines.length : typeof visitData.lines);

          // Handle lines - could be array or object
          const linesArray = Array.isArray(visitData.lines) ? visitData.lines : Object.values(visitData.lines);

          for (const line of linesArray) {
            console.log('        Line fields:', Object.keys(line));
            console.log('        Line data:', line);

            // Check if line has heads
            console.log('        Heads field:', line.heads);
            console.log('        Heads type:', typeof line.heads, Array.isArray(line.heads));

            if (line.heads && (Array.isArray(line.heads) ? line.heads.length > 0 : Object.keys(line.heads).length > 0)) {
              const headsArray = Array.isArray(line.heads) ? line.heads : Object.values(line.heads);
              console.log('        Heads count:', headsArray.length);

              for (const head of headsArray) {
                // Debug: show status and fixed values
                if (head.status || head.fixed) {
                  console.log(`          Head: status=${head.status}, fixed=${head.fixed} (type: ${typeof head.fixed})`);
                }

                // Add heads that are offline OR have been fixed (were offline at some point)
                const isOffline = head.status === 'offline' || head.status === 'Offline';
                const isFixed = head.fixed === true || head.fixed === 'Yes' || head.fixed === 'yes' || head.fixed === 'fixed' || head.fixed === 'Fixed';

                if (isOffline || isFixed) {
                  issues.push({
                    id: `${visitDoc.id}-${line.title || line.name || 'line'}-${head.name || head.id || 'head'}`,
                    customer: customerName,
                    line: line.title || line.name || 'Unknown Line',
                    visitId: visitDoc.id,
                    date: visitData.date,
                    headName: head.name || head.id,
                    status: head.status,
                    error: head.error || head.errorMessage || 'No error info',
                    fixed: head.fixed
                  });
                }
              }
            }
          }
        }
      }
    }

    // Log sample issue structure for debugging
    if (issues.length > 0) {
      console.log('=== HEADS DATA FROM FIRESTORE ===');
      console.log('Sample head fields:', Object.keys(issues[0]));
      console.log('Sample head data:', issues[0]);
      console.log('Total heads:', issues.length);
    }

    // Count offline heads (active issues)
    const activeIssues = issues.filter(issue => {
      return issue.status === 'offline' || issue.status === 'Offline';
    }).length;

    // Get recent/offline issues
    const recentIssues = issues
      .filter(issue => issue.status === 'offline' || issue.status === 'Offline')
      .slice(0, 5);

    console.log('Offline heads:', activeIssues);

    const result = {
      issues,
      activeIssues,
      totalIssues: issues.length,
      recentIssues
    };

    // Cache the result
    setCache('downtime', result);

    return result;
  } catch (error) {
    console.error('Error fetching downtime data:', error);
    return {
      issues: [],
      activeIssues: 0,
      totalIssues: 0,
      recentIssues: []
    };
  }
};

// Fetch Timesheet Data
export const fetchTimesheetData = async () => {
  // Check cache first
  if (isCacheValid('timesheets')) {
    console.log('Using cached timesheets data');
    return dataCache.timesheets;
  }

  try {
    console.log('Fetching fresh timesheets data from Firebase...');
    const timesheetsCollection = collection(timesheetDb, 'timesheets');
    const timesheetsSnapshot = await getDocs(timesheetsCollection);
    const timesheets = timesheetsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Log sample timesheet structure for debugging
    if (timesheets.length > 0) {
      console.log('=== TIMESHEETS DATA STRUCTURE ===');
      console.log('Sample timesheet fields:', Object.keys(timesheets[0]));
      console.log('Sample timesheet data:', timesheets[0]);
      console.log('Total timesheets:', timesheets.length);
    }

    // Calculate this week's hours
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
    startOfWeek.setHours(0, 0, 0, 0);

    const hoursThisWeek = timesheets.reduce((sum, timesheet) => {
      const date = timesheet.date?.toDate?.() || new Date(timesheet.date || 0);
      if (date >= startOfWeek) {
        const hours = parseFloat(timesheet.hours || 0);
        return sum + hours;
      }
      return sum;
    }, 0);

    // Calculate total hours
    const totalHours = timesheets.reduce((sum, timesheet) => {
      return sum + parseFloat(timesheet.hours || 0);
    }, 0);

    const result = {
      timesheets,
      hoursThisWeek,
      totalHours,
      totalEntries: timesheets.length
    };

    // Cache the result
    setCache('timesheets', result);

    return result;
  } catch (error) {
    console.error('Error fetching timesheet data:', error);
    return {
      timesheets: [],
      hoursThisWeek: 0,
      totalHours: 0,
      totalEntries: 0
    };
  }
};

// Fetch all activity across all databases
export const fetchRecentActivity = async () => {
  try {
    const activities = [];

    // Get recent jobs - sort by SR number (highest = most recent)
    const jobsData = await fetchJobsData();
    const sortedJobs = [...jobsData.jobs].sort((a, b) => {
      const srA = parseInt(a.sr || 0);
      const srB = parseInt(b.sr || 0);
      return srB - srA;
    });

    sortedJobs.slice(0, 5).forEach(job => {
      const status = isPaid(job.paid) ? 'Paid' : 'Unpaid';
      activities.push({
        type: 'job',
        message: `SR ${job.sr || 'N/A'} - ${job.customer || 'Unknown'} (${status})`,
        time: job.date || 'Recently',
        timestamp: job.date ? new Date(job.date) : new Date(),
        url: 'https://jtidt.netlify.app/'
      });
    });

    // Get recent downtime issues
    const downtimeData = await fetchDowntimeData();
    downtimeData.issues.slice(0, 5).forEach(issue => {
      const fixedStatus = issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? 'Fixed' : 'Offline';
      activities.push({
        type: 'downtime',
        message: `${issue.customer || 'Unknown'} - ${issue.line} (${fixedStatus})`,
        time: issue.date || 'Recently',
        timestamp: issue.date ? new Date(issue.date) : new Date(),
        url: 'https://jti-ccwlog.netlify.app/'
      });
    });

    // Get recent timesheets - sort by timestamp
    const timesheetData = await fetchTimesheetData();
    const sortedTimesheets = [...timesheetData.timesheets].sort((a, b) => {
      const dateA = a.timestamp?.toDate?.() || new Date(a.timestamp || 0);
      const dateB = b.timestamp?.toDate?.() || new Date(b.timestamp || 0);
      return dateB - dateA;
    });

    sortedTimesheets.slice(0, 5).forEach(timesheet => {
      const invoiceNum = timesheet.invoiceInfo?.invoiceNumber || timesheet.visitName || 'N/A';
      activities.push({
        type: 'timesheet',
        message: `${invoiceNum} - ${timesheet.customer || timesheet.visitName || 'Unknown'}`,
        time: formatRelativeTime(timesheet.timestamp?.toDate?.() || new Date(timesheet.timestamp || 0)),
        timestamp: timesheet.timestamp?.toDate?.() || new Date(timesheet.timestamp || 0),
        url: 'https://jti-ts3.netlify.app/'
      });
    });

    // Sort by timestamp (most recent first)
    activities.sort((a, b) => b.timestamp - a.timestamp);

    return activities.slice(0, 10); // Return top 10 most recent
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    return [];
  }
};

// Helper function to format relative time
const formatRelativeTime = (date) => {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
};

// Fetch unique customers list from all databases with source tracking
export const fetchCustomersList = async () => {
  try {
    // Fetch all data in parallel
    const [jobsData, downtimeData, timesheetData] = await Promise.all([
      fetchJobsData(),
      fetchDowntimeData(),
      fetchTimesheetData()
    ]);

    // Track customers and their sources
    const customersMap = new Map();

    // From jobs
    jobsData.jobs.forEach(job => {
      const customer = job.customer || job.customerName;
      if (customer && customer.trim() && customer.toLowerCase() !== 'unknown customer') {
        const name = customer.trim();
        if (!customersMap.has(name)) {
          customersMap.set(name, { name, sources: [] });
        }
        if (!customersMap.get(name).sources.includes('Jobs')) {
          customersMap.get(name).sources.push('Jobs');
        }
      }
    });

    // From issues
    downtimeData.issues.forEach(issue => {
      if (issue.customer && issue.customer.trim() && issue.customer.toLowerCase() !== 'unknown') {
        const name = issue.customer.trim();
        if (!customersMap.has(name)) {
          customersMap.set(name, { name, sources: [] });
        }
        if (!customersMap.get(name).sources.includes('Downtime')) {
          customersMap.get(name).sources.push('Downtime');
        }
      }
    });

    // From timesheets
    timesheetData.timesheets.forEach(timesheet => {
      const customer = timesheet.customer || timesheet.visitName;
      if (customer && customer.trim() && customer.toLowerCase() !== 'unknown') {
        const name = customer.trim();
        if (!customersMap.has(name)) {
          customersMap.set(name, { name, sources: [] });
        }
        if (!customersMap.get(name).sources.includes('Timesheets')) {
          customersMap.get(name).sources.push('Timesheets');
        }
      }
    });

    // Convert to sorted array
    const customers = Array.from(customersMap.values()).sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );

    console.log('=== CUSTOMERS LIST ===');
    console.log('Total unique customers:', customers.length);

    return customers;
  } catch (error) {
    console.error('Error fetching customers list:', error);
    return [];
  }
};

// Fetch all data for a specific customer
export const fetchCustomerData = async (customerName) => {
  if (!customerName) {
    return { jobs: [], issues: [], timesheets: [] };
  }

  try {
    // Fetch all data in parallel
    const [jobsData, downtimeData, timesheetData] = await Promise.all([
      fetchJobsData(),
      fetchDowntimeData(),
      fetchTimesheetData()
    ]);

    const term = customerName.toLowerCase();

    // Filter jobs for this customer
    const customerJobs = jobsData.jobs.filter(job => {
      const jobCustomer = (job.customer || job.customerName || '').toLowerCase();
      return jobCustomer.includes(term) || term.includes(jobCustomer);
    });

    // Filter issues for this customer
    const customerIssues = downtimeData.issues.filter(issue => {
      const issueCustomer = (issue.customer || '').toLowerCase();
      return issueCustomer.includes(term) || term.includes(issueCustomer);
    });

    // Filter timesheets for this customer
    const customerTimesheets = timesheetData.timesheets.filter(timesheet => {
      const tsCustomer = (timesheet.customer || timesheet.visitName || '').toLowerCase();
      return tsCustomer.includes(term) || term.includes(tsCustomer);
    });

    // Sort by date (most recent first)
    const sortByDate = (a, b) => {
      const dateA = a.date?.toDate?.() || new Date(a.date || a.timestamp || 0);
      const dateB = b.date?.toDate?.() || new Date(b.date || b.timestamp || 0);
      return dateB - dateA;
    };

    customerJobs.sort(sortByDate);
    customerIssues.sort((a, b) => {
      const dateA = a.timestamp?.toDate?.() || new Date(a.timestamp || 0);
      const dateB = b.timestamp?.toDate?.() || new Date(b.timestamp || 0);
      return dateB - dateA;
    });
    customerTimesheets.sort(sortByDate);

    // Calculate totals - use actual if available, otherwise quote
    const totalIncome = customerJobs.reduce((sum, job) => {
      const actual = parseFloat(job.actual || 0);
      const quote = parseFloat(job.quote || 0);
      const amount = actual > 0 ? actual : quote;
      return sum + amount;
    }, 0);
    const paidIncome = customerJobs.reduce((sum, job) => {
      if (isPaid(job.paid)) {
        const actual = parseFloat(job.actual || 0);
        const quote = parseFloat(job.quote || 0);
        const amount = actual > 0 ? actual : quote;
        return sum + amount;
      }
      return sum;
    }, 0);

    console.log(`=== CUSTOMER DATA FOR: ${customerName} ===`);
    console.log('Jobs:', customerJobs.length);
    console.log('Issues:', customerIssues.length);
    console.log('Timesheets:', customerTimesheets.length);

    return {
      jobs: customerJobs,
      issues: customerIssues,
      timesheets: customerTimesheets,
      totalJobs: customerJobs.length,
      totalIssues: customerIssues.length,
      totalTimesheets: customerTimesheets.length,
      totalIncome,
      paidIncome,
      unpaidIncome: totalIncome - paidIncome
    };
  } catch (error) {
    console.error('Error fetching customer data:', error);
    return { jobs: [], issues: [], timesheets: [] };
  }
};

// Unified search function - search by customer name or service report number
export const searchUnified = async (searchTerm) => {
  console.log('=== SEARCH STARTED ===');
  console.log('Search term:', searchTerm);

  if (!searchTerm || searchTerm.trim() === '') {
    return {
      jobs: [],
      issues: [],
      timesheets: [],
      headHistory: [],
      totalResults: 0
    };
  }

  const term = searchTerm.trim().toLowerCase();
  const isReportNumber = /^\d{7}$/.test(searchTerm.trim()); // Check if it's a 7-digit number
  console.log('Normalized term:', term);
  console.log('Is report number:', isReportNumber);

  // Generate search variations for patterns like "WH1" -> "WH 1"
  const getSearchVariations = (searchTerm) => {
    const variations = [searchTerm];

    // Pattern: letters followed by numbers (e.g., "WH1" -> "WH 1")
    const withSpace = searchTerm.replace(/([A-Za-z]+)(\d+)/g, '$1 $2');
    if (withSpace !== searchTerm) {
      variations.push(withSpace);
    }

    // Pattern: letters space numbers (e.g., "WH 1" -> "WH1")
    const withoutSpace = searchTerm.replace(/([A-Za-z]+)\s+(\d+)/g, '$1$2');
    if (withoutSpace !== searchTerm) {
      variations.push(withoutSpace);
    }

    return variations;
  };

  const searchVariations = getSearchVariations(term);
  console.log('Search variations:', searchVariations);

  try {
    // Fetch all data in parallel
    const [jobsData, downtimeData, timesheetData, headHistoryResults] = await Promise.all([
      fetchJobsData(),
      fetchDowntimeData(),
      fetchTimesheetData(),
      searchHeadHistory(searchTerm)
    ]);

    // Search jobs - by customer name, customerInfo, or invoice number
    console.log('Total jobs to search:', jobsData.jobs.length);
    if (jobsData.jobs.length > 0) {
      const sampleJob = jobsData.jobs[0];
      console.log('Sample job ALL FIELDS:', Object.keys(sampleJob));
      console.log('Sample job FULL DATA:', sampleJob);
      if (sampleJob.totals) {
        console.log('Sample job TOTALS:', sampleJob.totals);
      }
      if (sampleJob.jobs) {
        console.log('Sample job JOBS array:', sampleJob.jobs);
      }
    }

    // Show some SR numbers to help debug
    if (jobsData.jobs.length > 0) {
      const sampleSRs = jobsData.jobs.slice(0, 5).map(j => j.sr);
      console.log('Sample SR numbers:', sampleSRs);
    }

    console.log('Searching through', jobsData.jobs.length, 'jobs for:', searchTerm.trim());

    // Helper function to find matched fields in an object
    const findMatchedFields = (obj, searchTerm, prefix = '') => {
      const matches = [];

      const searchInValue = (value, key, path) => {
        if (value === null || value === undefined) return;

        if (typeof value === 'string') {
          const valueLower = value.toLowerCase();
          // Check if any variation matches
          if (searchVariations.some(variant => valueLower.includes(variant))) {
            matches.push({ field: path || key, value: value });
          }
        } else if (typeof value === 'number') {
          const numStr = value.toString().toLowerCase();
          // Check if any variation matches
          if (searchVariations.some(variant => numStr.includes(variant))) {
            matches.push({ field: path || key, value: value.toString() });
          }
        } else if (Array.isArray(value)) {
          value.forEach((item, index) => {
            searchInValue(item, `${key}[${index}]`, `${path ? path + '.' : ''}${key}[${index}]`);
          });
        } else if (typeof value === 'object') {
          // Skip Firestore timestamp objects
          if (value.toDate) return;
          Object.entries(value).forEach(([k, v]) => {
            searchInValue(v, k, `${path ? path + '.' : ''}${key}.${k}`);
          });
        }
      };

      Object.entries(obj).forEach(([key, value]) => {
        searchInValue(value, key, key);
      });

      return matches;
    };

    const matchingJobs = jobsData.jobs.filter(job => {
      const fullText = JSON.stringify(job).toLowerCase();
      return searchVariations.some(variant => fullText.includes(variant));
    }).map(job => ({
      ...job,
      matchedFields: findMatchedFields(job, term)
    }));

    // Search issues - search all text fields
    const matchingIssues = downtimeData.issues.filter(issue => {
      const fullText = JSON.stringify(issue).toLowerCase();
      return searchVariations.some(variant => fullText.includes(variant));
    }).map(issue => ({
      ...issue,
      matchedFields: findMatchedFields(issue, term)
    }));

    // Log timesheet fields for debugging
    if (timesheetData.timesheets.length > 0) {
      const sampleTS = timesheetData.timesheets[0];
      console.log('Sample timesheet invoiceInfo:', sampleTS.invoiceInfo);
    }

    // Search timesheets - search all text fields including nested objects
    const matchingTimesheets = timesheetData.timesheets.filter(timesheet => {
      const fullText = JSON.stringify(timesheet).toLowerCase();
      return searchVariations.some(variant => fullText.includes(variant));
    }).map(timesheet => ({
      ...timesheet,
      matchedFields: findMatchedFields(timesheet, term)
    }));

    // Sort results by date (most recent first)
    const sortByDate = (a, b) => {
      const dateA = a.date?.toDate?.() || new Date(a.date || a.timestamp || 0);
      const dateB = b.date?.toDate?.() || new Date(b.date || b.timestamp || 0);
      return dateB - dateA;
    };

    matchingJobs.sort(sortByDate);
    matchingIssues.sort((a, b) => {
      const dateA = a.timestamp?.toDate?.() || new Date(a.timestamp || 0);
      const dateB = b.timestamp?.toDate?.() || new Date(b.timestamp || 0);
      return dateB - dateA;
    });
    matchingTimesheets.sort(sortByDate);

    console.log('=== SEARCH RESULTS ===');
    console.log('Jobs found:', matchingJobs.length);
    console.log('Issues found:', matchingIssues.length);
    console.log('Timesheets found:', matchingTimesheets.length);
    console.log('Head history found:', headHistoryResults.length);
    if (matchingJobs.length > 0) {
      console.log('First matching job:', matchingJobs[0]);
    }
    if (matchingTimesheets.length > 0) {
      console.log('First matching timesheet:', matchingTimesheets[0]);
    }

    return {
      jobs: matchingJobs,
      issues: matchingIssues,
      timesheets: matchingTimesheets,
      headHistory: headHistoryResults,
      totalResults: matchingJobs.length + matchingIssues.length + matchingTimesheets.length + headHistoryResults.length,
      searchTerm: searchTerm.trim()
    };
  } catch (error) {
    console.error('Error searching unified data:', error);
    return {
      jobs: [],
      issues: [],
      timesheets: [],
      headHistory: [],
      totalResults: 0,
      error: error.message
    };
  }
};

// Fetch Calendar Events from Timesheets and Shearers Database
export const fetchCalendarEvents = async () => {
  try {
    const events = [];

    // Fetch timesheet events
    const timesheetsCollection = collection(timesheetDb, 'timesheets');
    const timesheetsSnapshot = await getDocs(timesheetsCollection);

    timesheetsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const customer = data.customer || data.visitName || 'Unknown';
      const visitName = data.visitName || '';
      const entries = data.entries || [];

      // Extract dates from entries
      entries.forEach(entry => {
        if (entry.date) {
          events.push({
            id: doc.id,
            date: entry.date,
            customer: customer,
            visitName: visitName,
            hours: entry.hours || 0,
            serviceWork: data.serviceReportData?.[entry.date] || '',
            timestamp: data.timestamp,
            invoiceNumber: data.invoiceInfo?.invoiceNumber || '',
            type: 'timesheet'
          });
        }
      });

      // If no entries but has timestamp, use that as the date
      if (entries.length === 0 && data.timestamp) {
        const date = data.timestamp?.toDate?.() || new Date(data.timestamp);
        const dateStr = date.toISOString().split('T')[0];
        events.push({
          id: doc.id,
          date: dateStr,
          customer: customer,
          visitName: visitName,
          hours: 0,
          serviceWork: '',
          timestamp: data.timestamp,
          invoiceNumber: data.invoiceInfo?.invoiceNumber || '',
          type: 'timesheet'
        });
      }
    });

    // Fetch onsite events from Shearers database
    const headHistoryData = await fetchHeadHistoryData();
    if (headHistoryData.calendarEvents && headHistoryData.calendarEvents.length > 0) {
      events.push(...headHistoryData.calendarEvents);
      console.log('Added', headHistoryData.calendarEvents.length, 'onsite events from Shearers database');
    }

    // Sort by date descending
    events.sort((a, b) => new Date(b.date) - new Date(a.date));

    console.log('Calendar events loaded:', events.length, '(timesheets + onsite)');
    return events;
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    return [];
  }
};

// Delete a specific entry from a timesheet by date
export const deleteTimesheetEntry = async (docId, entryDate) => {
  try {
    const docRef = doc(timesheetDb, 'timesheets', docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Timesheet not found');
    }

    const data = docSnap.data();
    const entries = data.entries || [];

    // Filter out the entry with the matching date
    const updatedEntries = entries.filter(entry => entry.date !== entryDate);

    // Also remove from serviceReportData if it exists
    const serviceReportData = { ...(data.serviceReportData || {}) };
    delete serviceReportData[entryDate];

    // If no entries left, delete the whole document
    if (updatedEntries.length === 0) {
      await deleteDoc(docRef);
      console.log('Deleted entire timesheet (no entries left):', docId);
    } else {
      // Update the document with remaining entries
      await updateDoc(docRef, {
        entries: updatedEntries,
        serviceReportData: serviceReportData
      });
      console.log('Deleted entry from timesheet:', docId, entryDate);
    }

    return true;
  } catch (error) {
    console.error('Error deleting timesheet entry:', error);
    throw error;
  }
};

// Delete an entire timesheet document
export const deleteTimesheet = async (docId) => {
  try {
    const docRef = doc(timesheetDb, 'timesheets', docId);
    await deleteDoc(docRef);
    console.log('Deleted timesheet:', docId);
    return true;
  } catch (error) {
    console.error('Error deleting timesheet:', error);
    throw error;
  }
};

// Fetch Head History data from Shearers Realtime Database
export const fetchHeadHistoryData = async () => {
  // Check cache first
  if (isCacheValid('headHistory')) {
    console.log('Using cached head history data');
    return dataCache.headHistory;
  }

  try {
    console.log('Fetching fresh head history data from Firebase...');
    const entries = [];
    const calendarEvents = [];

    // Specific paths to query (based on actual database structure)
    const pathsToQuery = [
      'jti-downtime/head-history',
      'jti-downtime/main-logger/data'
    ];

    // Helper to normalize date to YYYY-MM-DD format
    const normalizeDate = (dateVal) => {
      if (!dateVal) return null;

      // If it's already in YYYY-MM-DD format
      if (typeof dateVal === 'string' && dateVal.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return dateVal;
      }

      // Try to parse and convert
      const dateObj = new Date(dateVal);
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toISOString().split('T')[0];
      }

      return null;
    };

    // Helper to extract dates from an object recursively
    const extractDates = (obj, path = '', source = '') => {
      if (!obj || typeof obj !== 'object') return;

      // Check for date field at this level
      if (obj.date || obj.visitDate || obj.timestamp) {
        const dateStr = normalizeDate(obj.date || obj.visitDate || obj.timestamp);
        if (dateStr) {
          const entry = {
            path: path,
            source: source,
            ...obj
          };
          entries.push(entry);

          // Build service work text with all relevant info
          let serviceWorkParts = [];
          if (obj.notes) serviceWorkParts.push(obj.notes);
          if (obj.machineNotes) serviceWorkParts.push(`Machine Notes: ${obj.machineNotes}`);
          if (obj.line) serviceWorkParts.push(`Line: ${obj.line}`);
          if (obj.status) serviceWorkParts.push(`Status: ${obj.status}`);
          if (obj.repairStatus) serviceWorkParts.push(`Repair: ${obj.repairStatus}`);
          if (obj.fixed !== undefined) serviceWorkParts.push(`Fixed: ${obj.fixed}`);
          if (obj.error) serviceWorkParts.push(`Error: ${obj.error}`);
          if (obj.description) serviceWorkParts.push(obj.description);
          if (obj.action) serviceWorkParts.push(`Action: ${obj.action}`);

          calendarEvents.push({
            id: `${source}-${path || Date.now()}`,
            date: dateStr,
            customer: obj.customer || obj.machine || obj.location || 'Shearers',
            visitName: obj.line ? `Line: ${obj.line}` : 'Onsite',
            hours: 0,
            serviceWork: serviceWorkParts.join(' | '),
            status: obj.status,
            repairStatus: obj.repairStatus,
            line: obj.line,
            type: 'onsite'
          });
        }
      }

      // Process arrays
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => {
          extractDates(item, `${path}[${idx}]`, source);
        });
        return;
      }

      // Recursively process nested objects
      for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object') {
          extractDates(obj[key], path ? `${path}/${key}` : key, source);
        }
      }
    };

    // Query each path
    console.log('Querying paths:', pathsToQuery);
    for (const pathName of pathsToQuery) {
      try {
        console.log(`Attempting to fetch: ${pathName}`);
        const pathRef = dbRef(shearersRealtimeDb, pathName);
        const snapshot = await get(pathRef);

        if (snapshot.exists()) {
          const data = snapshot.val();
          console.log(`=== SHEARERS PATH: ${pathName} ===`);
          console.log('Data type:', Array.isArray(data) ? 'array' : typeof data);
          console.log('Sample data:', JSON.stringify(data).substring(0, 500));
          if (typeof data === 'object' && !Array.isArray(data)) {
            console.log('Keys:', Object.keys(data).slice(0, 10));
          }

          extractDates(data, '', pathName);
          console.log(`After processing ${pathName}: ${entries.length} entries, ${calendarEvents.length} events`);
        } else {
          console.log(`Path ${pathName} has no data (snapshot.exists() = false)`);
        }
      } catch (err) {
        console.error(`Error querying ${pathName}:`, err.message, err);
      }
    }

    // Remove duplicate dates (same date from different sources)
    const uniqueEvents = [];
    const seenDates = new Set();
    calendarEvents.forEach(event => {
      const key = `${event.date}-${event.customer}`;
      if (!seenDates.has(key)) {
        seenDates.add(key);
        uniqueEvents.push(event);
      }
    });

    console.log('Head history loaded:', entries.length, 'entries,', uniqueEvents.length, 'unique calendar events');

    const result = { entries, calendarEvents: uniqueEvents };

    // Cache the result
    setCache('headHistory', result);

    return result;
  } catch (error) {
    console.error('Error fetching head history:', error);
    return { entries: [], calendarEvents: [] };
  }
};

// Search Head History for notes and machine notes
export const searchHeadHistory = async (searchTerm) => {
  try {
    console.log('=== SEARCHING HEAD HISTORY ===');
    console.log('Search term:', searchTerm);

    const results = [];
    const term = searchTerm.toLowerCase();
    const seenPaths = new Set(); // Avoid duplicates

    // Specific paths to query (based on actual database structure)
    const pathsToQuery = [
      'jti-downtime/head-history',
      'jti-downtime/main-logger/data'
    ];

    const searchInObject = (obj, path = '', source = '') => {
      if (!obj || typeof obj !== 'object') return;

      // Check for matching fields
      const matchedFields = [];

      // Generate search variations for patterns like "WH1" -> "WH 1"
      const getSearchVariations = (searchTerm) => {
        const variations = [searchTerm];

        // Pattern: letters followed by numbers (e.g., "WH1" -> "WH 1")
        const withSpace = searchTerm.replace(/([A-Za-z]+)(\d+)/g, '$1 $2');
        if (withSpace !== searchTerm) {
          variations.push(withSpace);
        }

        // Pattern: letters space numbers (e.g., "WH 1" -> "WH1")
        const withoutSpace = searchTerm.replace(/([A-Za-z]+)\s+(\d+)/g, '$1$2');
        if (withoutSpace !== searchTerm) {
          variations.push(withoutSpace);
        }

        return variations;
      };

      const searchVariations = getSearchVariations(term);

      // Search all text fields with pattern matching
      const checkField = (fieldName, value) => {
        if (value && typeof value === 'string') {
          const valueLower = value.toLowerCase();
          // Check if any variation matches
          if (searchVariations.some(variant => valueLower.includes(variant))) {
            matchedFields.push({ field: fieldName, value: value });
          }
        }
      };

      checkField('notes', obj.notes);
      checkField('machineNotes', obj.machineNotes);
      checkField('machine', obj.machine);
      checkField('customer', obj.customer);
      checkField('location', obj.location);
      checkField('action', obj.action);
      checkField('description', obj.description);
      checkField('error', obj.error);
      checkField('head', obj.head);
      checkField('line', obj.line);
      checkField('status', obj.status);
      checkField('repairStatus', obj.repairStatus);

      if (matchedFields.length > 0) {
        const uniqueKey = `${source}-${path}`;
        if (!seenPaths.has(uniqueKey)) {
          seenPaths.add(uniqueKey);

          // Log the object to see all available fields
          console.log('Head History entry fields:', Object.keys(obj));
          console.log('Head History entry data:', obj);

          results.push({
            path: path,
            source: source,
            customer: obj.customer || obj.machine || obj.location || 'Shearers',
            date: obj.date || obj.visitDate || obj.timestamp || '',
            status: obj.status || obj.Status,
            repairStatus: obj.repaired || obj.repairStatus || obj.repair_status || obj.RepairStatus,
            line: obj.line || obj.Line,
            error: obj.issue || obj.error || obj.Error || obj.errorMessage,
            fixed: obj.fixed || obj.Fixed || obj.repaired,
            head: obj.head,
            matchedFields: matchedFields,
            data: obj
          });
        }
      }

      // Process arrays
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => {
          searchInObject(item, `${path}[${idx}]`, source);
        });
        return;
      }

      // Recursively search nested objects
      for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object') {
          searchInObject(obj[key], path ? `${path}/${key}` : key, source);
        }
      }
    };

    // Query each path
    for (const pathName of pathsToQuery) {
      try {
        console.log(`Searching path: ${pathName}`);
        const pathRef = dbRef(shearersRealtimeDb, pathName);
        const snapshot = await get(pathRef);

        if (snapshot.exists()) {
          const data = snapshot.val();
          console.log(`Data found in ${pathName}, type:`, Array.isArray(data) ? 'array' : typeof data);
          if (typeof data === 'object' && !Array.isArray(data)) {
            console.log(`Keys in ${pathName}:`, Object.keys(data).slice(0, 10));
          }
          searchInObject(data, '', pathName);
          console.log(`Results after ${pathName}:`, results.length);
        } else {
          console.log(`No data in ${pathName}`);
        }
      } catch (err) {
        console.error(`Error searching ${pathName}:`, err.message);
      }
    }

    console.log('=== HEAD HISTORY SEARCH COMPLETE ===');
    console.log('Total results:', results.length);
    if (results.length > 0) {
      console.log('Sample result object:', results[0]);
      console.log('Sample result data keys:', Object.keys(results[0].data || {}));
      console.log('Sample result FULL DATA:', JSON.stringify(results[0].data, null, 2));
    }
    return results;
  } catch (error) {
    console.error('Error searching head history:', error);
    return [];
  }
};

import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { Activity, AlertTriangle, BarChart3, Building2, Calendar, ClipboardList, HardDriveDownload, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, Clock, DollarSign, Edit2, ExternalLink, FileText, Filter, LogOut, MapPin, Moon, Navigation, Paperclip, Plus, RefreshCw, Search, Settings, ShieldCheck, Sun, Trash2, TrendingUp, Users, Wrench, X, XCircle } from 'lucide-react';
import { fetchJobsData, fetchDowntimeData, fetchTimesheetData, fetchRecentActivity, searchUnified, fetchCustomersList, fetchCustomerData, fetchCalendarEvents, deleteTimesheetEntry, clearDataCache, fetchFactoryLocations, saveFactoryLocations, hasAnyCache, subscribeAllUpdates, fetchServiceReports, fetchCustomerRecords, saveCustomerProfile, setJobCustomer, fetchAllPackets, fetchUnifiedJobs } from './data-service';
import { useAuth } from './context/AuthContext';
import { jobsMasterAuth } from './firebase-config';
const Troubleshoot = lazy(() => import('./components/Troubleshoot/Troubleshoot'));
const FactoryMapView = lazy(() => import('./components/FactoryMapView'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const ServiceReportLookup = lazy(() => import('./components/ServiceReportLookup'));
import StatCard from './components/StatCard';
import AppCard from './components/AppCard';
import ActivityItem from './components/ActivityItem';
import SearchResults from './components/SearchResults';
import CustomerDetailView from './components/CustomerDetailView';
import UpdateBanner from '@shared/components/UpdateBanner.jsx';
import DataHealthBanner from './components/DataHealthBanner';
import { reset as resetHealth, isSignIn } from './utils/dataHealth';
import { expectedPayment, describeTiming } from './utils/expectedPayment';
import { sumIncome, paymentState } from './utils/payments';
import { varianceSummary } from './utils/variance';
import * as ui from './ui/theme';
import useRoute from './ui/useRoute';
import { VIEWS, HOME, CUSTOMER, toSlug, customerFromSlug } from './ui/views';
import CustomerRecordsPanel from './components/CustomerRecordsPanel';
import JobPacketBuilder from './components/JobPacketBuilder';
import JobBoard from './components/JobBoard';
import NewJobPage from './components/NewJobPage';
import BackupPanel from './components/BackupPanel';
import { isPaid, formatRelativeTime, jobAmount, formatCurrency } from './utils/format';


function App() {
  const { logout } = useAuth();
  const [activeView, setActiveView] = useState('dashboard');
  const [stats, setStats] = useState({
    totalIncome: 0,
    currentYearIncome: 0,
    unpaidJobs: 0,
    unpaidJobsList: [],
    overdueJobsList: [],
    currentSR: '',
    currentSRCustomer: ''
  });
  // 0 = hidden, 1 = current year, 2 = total
  const [incomeDisplayMode, setIncomeDisplayMode] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recentActivityData, setRecentActivityData] = useState([]);
  // Initialize search state from localStorage for persistence
  const [searchTerm, setSearchTerm] = useState(() => {
    const saved = localStorage.getItem('jti-unified-search-term');
    return saved || '';
  });
  // Search results are not persisted — the whole result set (full job/timesheet
  // objects) could be large and slow to serialize. The search *term* is
  // persisted below, and the debounced search effect re-runs it on mount.
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      const saved = localStorage.getItem('jti-unified-recent-searches');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [pinnedSearches, setPinnedSearches] = useState(() => {
    try {
      const saved = localStorage.getItem('jti-unified-pinned-searches');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const searchInputRef = useRef(null);

  // `/` focuses search (skip when typing in another input or contenteditable).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pushRecentSearch = useCallback((term) => {
    const t = (term || '').trim();
    if (!t) return;
    setRecentSearches((prev) => {
      const next = [t, ...prev.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8);
      try { localStorage.setItem('jti-unified-recent-searches', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const clearRecentSearches = () => {
    setRecentSearches([]);
    try { localStorage.removeItem('jti-unified-recent-searches'); } catch {}
  };

  const togglePinSearch = (term) => {
    const t = (term || '').trim();
    if (!t) return;
    setPinnedSearches((prev) => {
      const exists = prev.some((p) => p.toLowerCase() === t.toLowerCase());
      const next = exists
        ? prev.filter((p) => p.toLowerCase() !== t.toLowerCase())
        : [t, ...prev].slice(0, 12);
      try { localStorage.setItem('jti-unified-pinned-searches', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const isPinned = (term) => pinnedSearches.some((p) => p.toLowerCase() === (term || '').toLowerCase().trim());
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerData, setCustomerData] = useState(null);
  // Every customer record JTI holds, for linking a name to one by hand.
  const [customerRecords, setCustomerRecords] = useState([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString());
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthlyIncome, setMonthlyIncome] = useState({ paid: [], unpaid: [] });
  const [allJobsData, setAllJobsData] = useState([]);
  // Packets keyed by service report number. The reports window shows the files
  // held against a number, and most of them are uploaded on the packet page.
  const [packetsBySr, setPacketsBySr] = useState(null);
  // Numbers reserved here. For a packet-only row this is the only place its
  // customer was ever written down.
  const [startedJobs, setStartedJobs] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [searchScope, setSearchScope] = useState('all'); // 'all' or 'customer'
  const [showIncomeChart, setShowIncomeChart] = useState(false); // Hidden by default
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null); // For chart filter
  const [monthJobs, setMonthJobs] = useState([]); // Jobs for selected month

  // Calendar state
  // The six views are derived from the URL, not held as six booleans that had
  // to be closed by hand. See src/ui/views.js for why.
  const [route, go] = useRoute();
  const showCalendar = route.view === VIEWS.calendar;
  const showMap = route.view === VIEWS.map;
  const showTroubleshoot = route.view === VIEWS.troubleshoot;
  const showServiceReports = route.view === VIEWS.reports;
  const showRecords = route.view === VIEWS.records;
  const showPacket = route.view === VIEWS.packet;
  const showBoard = route.view === VIEWS.board;
  const showNewJob = route.view === VIEWS.newJob;
  const showBackups = route.view === VIEWS.backups;
  const openView = (v) => go({ view: v });
  const closeView = () => go({ view: HOME });
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Troubleshoot pane state
  const [troubleshootTimesheets, setTroubleshootTimesheets] = useState([]);
  const [troubleshootTimesheetsLoading, setTroubleshootTimesheetsLoading] = useState(false);

  const loadTroubleshootTimesheets = useCallback(async () => {
    setTroubleshootTimesheetsLoading(true);
    try {
      const data = await fetchTimesheetData();
      setTroubleshootTimesheets(data?.timesheets || []);
    } catch (e) {
      console.error('Failed to load timesheets for troubleshoot:', e);
    } finally {
      setTroubleshootTimesheetsLoading(false);
    }
  }, []);

  const toggleTroubleshoot = () => {
    const next = !showTroubleshoot;
    // No sibling flags to close: one view is open because one URL is current.
    go({ view: next ? VIEWS.troubleshoot : HOME });
  };

  // Service Report Lookup state
  // Every customer's record at once, and what each is still missing.
  // PO + invoice + service report + receipts, merged into one PDF.
  const [serviceReports, setServiceReports] = useState({ reports: [], years: [], untaggedVisits: [], untaggedTimesheets: [] });
  const [serviceReportsLoading, setServiceReportsLoading] = useState(false);

  const loadServiceReports = useCallback(async () => {
    setServiceReportsLoading(true);
    try {
      const data = await fetchServiceReports();
      setServiceReports(data);
    } catch (e) {
      console.error('Failed to load service reports:', e);
    } finally {
      setServiceReportsLoading(false);
    }
  }, []);

  const toggleServiceReports = () => {
    const next = !showServiceReports;
    go({ view: next ? VIEWS.reports : HOME });
    if (next) {
      setSearchResults(null);
      setSearchTerm('');
    }
  };

  // Factory Map state
  const [factories, setFactories] = useState([]);
  const [factoriesLoading, setFactoriesLoading] = useState(true);
  const [newFactory, setNewFactory] = useState({ name: '', address: '', lat: '', lng: '', notes: '' });
  const [editingFactory, setEditingFactory] = useState(null);
  const [mapCenter, setMapCenter] = useState([39.8283, -98.5795]);
  const [mapZoom, setMapZoom] = useState(4);
  const [geocoding, setGeocoding] = useState(false);

  // Load factory locations from Firebase - wait for jobsMasterAuth to be ready
  useEffect(() => {
    const loadFactories = async () => {
      setFactoriesLoading(true);
      try {
        // Wait for jobsMasterAuth to be ready (it authenticates in parallel during login)
        if (!jobsMasterAuth.currentUser) {
          await new Promise((resolve) => {
            const unsub = jobsMasterAuth.onAuthStateChanged((u) => { unsub(); resolve(u); });
          });
        }
        const data = await fetchFactoryLocations();
        setFactories(data);
      } catch (error) {
        console.error('Error loading factories:', error);
        const saved = localStorage.getItem('jti-factory-locations');
        if (saved) setFactories(JSON.parse(saved));
      } finally {
        setFactoriesLoading(false);
      }
    };
    loadFactories();
  }, []);

  // Handle search
  const handleSearch = async (term) => {
    if (!term || term.trim() === '') {
      setSearchResults(null);
      return;
    }

    setSearchLoading(true);
    try {
      const results = await searchUnified(term);
      if (results && results.totalResults > 0) pushRecentSearch(term);

      // Filter by selected customer if search scope is 'customer'
      if (searchScope === 'customer' && selectedCustomer) {
        const customerLower = selectedCustomer.toLowerCase();
        const filteredResults = {
          ...results,
          jobs: results.jobs.filter(job =>
            (job.customer || job.customerName || '').toLowerCase().includes(customerLower)
          ),
          issues: results.issues.filter(issue =>
            (issue.customer || '').toLowerCase().includes(customerLower)
          ),
          timesheets: results.timesheets.filter(timesheet =>
            (timesheet.customer || timesheet.visitName || '').toLowerCase().includes(customerLower)
          ),
          parts: (results.parts || []).filter(p =>
            (Array.isArray(p.customers) ? p.customers.join(' ') : '').toLowerCase().includes(customerLower)
          ),
          boards: (results.boards || []).filter(b =>
            (Array.isArray(b.customers) ? b.customers.join(' ') : '').toLowerCase().includes(customerLower)
          ),
          diagrams: (results.diagrams || []).filter(d =>
            (d.customer || '').toLowerCase().includes(customerLower)
          ),
          headHistory: results.headHistory || [],
        };
        filteredResults.totalResults =
          filteredResults.jobs.length + filteredResults.issues.length +
          filteredResults.timesheets.length + filteredResults.parts.length +
          filteredResults.boards.length + filteredResults.diagrams.length;
        setSearchResults(filteredResults);
      } else {
        setSearchResults(results);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  // Debounced search effect
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      handleSearch(searchTerm);
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchTerm, searchScope, selectedCustomer]);

  // Save search state to localStorage for persistence across tab switches
  useEffect(() => {
    if (searchTerm) {
      localStorage.setItem('jti-unified-search-term', searchTerm);
    } else {
      localStorage.removeItem('jti-unified-search-term');
    }
  }, [searchTerm]);

  const clearSearch = () => {
    setSearchTerm('');
    setSearchResults(null);
    localStorage.removeItem('jti-unified-search-term');
  };

  // Load calendar events
  const loadCalendarEvents = async () => {
    setCalendarLoading(true);
    try {
      const events = await fetchCalendarEvents();
      setCalendarEvents(events);
    } catch (error) {
      console.error('Error loading calendar events:', error);
    } finally {
      setCalendarLoading(false);
    }
  };

  // Toggle calendar view
  const toggleCalendar = () => {
    // Refresh every time the calendar is opened, not just the first time. The
    // old `calendarEvents.length === 0` guard meant a visit saved in the
    // timesheet app never appeared until the whole page was reloaded — the
    // calendar looked like it had simply lost the visit.
    go({ view: showCalendar ? HOME : VIEWS.calendar });
    setSearchResults(null);
    setSearchTerm('');
  };

  // Toggle map view
  const toggleMap = () => {
    go({ view: showMap ? HOME : VIEWS.map });
    setSearchResults(null);
    setSearchTerm('');
  };

  // Helper to save factories
  const saveFactories = useCallback((newFactories) => {
    setFactories(newFactories);
    saveFactoryLocations(newFactories);
  }, []);

  // Geocode address to get coordinates
  const geocodeAddress = async (address) => {
    setGeocoding(true);
    try {
      const queries = [
        `${address}, USA`,
        address,
        address.replace(/\./g, '').replace(/,/g, ' '),
      ];
      for (const query of queries) {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=5`,
          { headers: { 'User-Agent': 'JTI-Unified-Dashboard/1.0' } }
        );
        const data = await response.json();
        if (data && data.length > 0) {
          return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), displayName: data[0].display_name };
        }
      }
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    } finally {
      setGeocoding(false);
    }
  };

  const lookupAddress = async () => {
    if (!newFactory.address) { alert('Please enter an address to look up'); return; }
    const result = await geocodeAddress(newFactory.address);
    if (result) {
      setNewFactory({ ...newFactory, lat: result.lat.toFixed(6), lng: result.lng.toFixed(6) });
      alert(`Found: ${result.displayName}\n\nCoordinates: ${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`);
    } else {
      alert('Could not find this address. Try removing abbreviations or adding city and state.');
    }
  };

  const addFactory = async () => {
    if (!newFactory.name || !newFactory.address) { alert('Please enter a factory name and address'); return; }
    let coords = { lat: parseFloat(newFactory.lat), lng: parseFloat(newFactory.lng) };
    if (!coords.lat || !coords.lng || isNaN(coords.lat) || isNaN(coords.lng)) {
      const geocoded = await geocodeAddress(newFactory.address);
      if (geocoded) { coords = geocoded; } else { alert('Could not find coordinates. Please enter them manually.'); return; }
    }
    const factory = { id: Date.now(), name: newFactory.name, address: newFactory.address, lat: coords.lat, lng: coords.lng, notes: newFactory.notes, addedDate: new Date().toISOString() };
    saveFactories([...factories, factory]);
    setNewFactory({ name: '', address: '', lat: '', lng: '', notes: '' });
  };

  const updateFactory = async () => {
    if (!editingFactory) return;
    let coords = { lat: parseFloat(editingFactory.lat), lng: parseFloat(editingFactory.lng) };
    if (!coords.lat || !coords.lng || isNaN(coords.lat) || isNaN(coords.lng)) {
      const geocoded = await geocodeAddress(editingFactory.address);
      if (geocoded) { coords = geocoded; } else { alert('Could not find coordinates.'); return; }
    }
    saveFactories(factories.map(f => f.id === editingFactory.id ? { ...editingFactory, lat: coords.lat, lng: coords.lng } : f));
    setEditingFactory(null);
  };

  const deleteFactory = (id) => {
    if (confirm('Delete this factory location?')) {
      saveFactories(factories.filter(f => f.id !== id));
    }
  };

  // Save part of a customer's record (address, contacts, invoice emails).
  //
  // The record is shared with CCW Issues and Headcount, so this merges rather
  // than replaces, and refreshes what is on screen from what was actually
  // written rather than assuming the write matched the form.
  const handleSaveCustomerProfile = async (customerId, patch) => {
    const saved = await saveCustomerProfile(customerId, patch);
    setCustomerData((prev) => (prev?.record
      ? { ...prev, record: { ...prev.record, profile: { ...prev.record.profile, ...saved } } }
      : prev));
    setCustomerRecords((prev) => prev.map((r) => (
      r.id === customerId ? { ...r, profile: { ...r.profile, ...saved } } : r)));
  };

  // Link the name this app knows a customer by to the record it belongs to.
  //
  // Stored as an alias on the record, so the join is made once by a person and
  // then holds — rather than being re-guessed, differently, on every load.
  const handleLinkCustomer = async (customerId) => {
    const record = customerRecords.find((r) => r.id === customerId);
    const aliases = Array.from(new Set([...(record?.profile?.aliases || []), selectedCustomer]));
    await saveCustomerProfile(customerId, { aliases });
    const [data, records] = await Promise.all([
      fetchCustomerData(selectedCustomer),
      fetchCustomerRecords(),
    ]);
    setCustomerData(data);
    setCustomerRecords(records);
  };

  // File a job against a different customer.
  //
  // For a company with more than one plant whose jobs were filed under the bare
  // company name — only somebody who was there knows which site a given service
  // report belongs to, so it is a decision, not something to infer.
  const handleMoveJob = async (sr, toCustomer) => {
    if (!sr || !toCustomer) return;
    await setJobCustomer(sr, toCustomer);
    const [data, records] = await Promise.all([
      fetchCustomerData(selectedCustomer),
      fetchCustomerRecords(),
    ]);
    setCustomerData(data);
    setCustomerRecords(records);
    setCustomers(await fetchCustomersList());
  };

  // Handle customer selection
  const handleCustomerSelect = async (customer) => {
    // An address, so "look at Flagstone Foods" is a link somebody can send and
    // the back button leaves the customer rather than the whole app.
    go(customer ? { view: CUSTOMER, customerSlug: toSlug(customer) } : { view: HOME });
    setSelectedCustomer(customer);
    setShowCustomerDropdown(false);
    setSearchResults(null); // Clear search results when viewing customer
    setSearchTerm('');

    if (customer) {
      setCustomerLoading(true);
      try {
        const [data, records] = await Promise.all([
          fetchCustomerData(customer),
          fetchCustomerRecords(),
        ]);
        setCustomerData(data);
        setCustomerRecords(records);
      } catch (error) {
        console.error('Error fetching customer data:', error);
      } finally {
        setCustomerLoading(false);
      }
    } else {
      setCustomerData(null);
    }
  };

  const clearCustomerSelection = () => {
    if (route.view === CUSTOMER) go({ view: HOME });
    setSelectedCustomer('');
    setCustomerData(null);
    setSearchScope('all'); // Reset search scope when customer is cleared
  };

  // A view loads what it needs when it OPENS, however it was opened.
  //
  // This lived in the click handlers, so a pasted link or a Back press showed
  // the view with none of its data — /packet arrived with an empty service
  // report picker, which reads as "there are no jobs" rather than "nothing
  // fetched them". Data a view needs belongs to the view, not to the button.
  useEffect(() => {
    const v = route.view;
    if (v === VIEWS.calendar) loadCalendarEvents();
    if (v === VIEWS.troubleshoot && troubleshootTimesheets.length === 0) loadTroubleshootTimesheets();
    if ((v === VIEWS.reports || v === VIEWS.packet) && serviceReports.reports.length === 0) loadServiceReports();
    // Re-read every time the view opens, not once per page load. Uploading an
    // invoice on the packet page and coming straight here showed the packets as
    // they were BEFORE the upload — the file was there, this screen was holding
    // a copy of the list from earlier in the session.
    if (v === VIEWS.reports) {
      fetchAllPackets().then(setPacketsBySr).catch((e) => console.warn('Packets unavailable:', e));
      fetchUnifiedJobs().then(setStartedJobs).catch((e) => console.warn('Reserved numbers unavailable:', e));
    }
    if (v === VIEWS.records || v === VIEWS.packet || v === VIEWS.newJob) {
      fetchCustomerRecords().then(setCustomerRecords).catch((e) => console.warn('Customer records unavailable:', e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.view]);

  // The URL is the instruction, so a pasted link and the Back button both work.
  // Waits for the customer list: on a cold load the slug arrives before the
  // names it has to be matched against, and resolving it early would look like
  // a link to a customer that does not exist.
  useEffect(() => {
    if (route.view !== CUSTOMER || !route.customerSlug || customers.length === 0) return;
    const hit = customerFromSlug(route.customerSlug, customers);
    if (!hit) return;
    const name = hit.name ?? hit;
    if (name === selectedCustomer) return;
    setSelectedCustomer(name);
    setCustomerLoading(true);
    Promise.all([fetchCustomerData(name), fetchCustomerRecords()])
      .then(([data, records]) => { setCustomerData(data); setCustomerRecords(records); })
      .catch((e) => console.error('Could not open the customer from the link:', e))
      .finally(() => setCustomerLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.view, route.customerSlug, customers]);

  // Fetch real data from Firebase. Stale-while-revalidate: if anything is
  // already cached, render whatever we have right now and refresh quietly in
  // the background instead of blanking the dashboard with a spinner.
  const loadData = async () => {
    if (!hasAnyCache()) setLoading(true);
    setLoadError(null);
    // Rebuilt from scratch on every refresh rather than cleared per source: a
    // fetcher only reports when it FAILS, so anything that has recovered simply
    // does not report again and drops off by itself.
    //
    // Sign-in failures are kept. They are recorded once at login and a data
    // refresh does not retry them — clearing them here would hide the one thing
    // that explains why the data is empty.
    resetHealth(isSignIn);
    try {
      // Fetch all data in parallel
      const [jobsData, downtimeData, timesheetData, activityData, customersList] = await Promise.all([
        fetchJobsData(),
        fetchDowntimeData(),
        fetchTimesheetData(),
        fetchRecentActivity(),
        fetchCustomersList()
      ]);

      // Calculate paid income (not quotes) - use actual if available
      const currentYear = new Date().getFullYear().toString();
      const currentYearJobs = jobsData.jobs.filter(job => job.year === currentYear);
      const currentYearPaidIncome = sumIncome(currentYearJobs, { paidOnly: true });

      // Find current/most recent SR (by SR number - highest number is most recent)
      const sortedJobs = [...jobsData.jobs].sort((a, b) => {
        const srA = parseInt(a.sr || 0);
        const srB = parseInt(b.sr || 0);
        return srB - srA;
      });
      const currentJob = sortedJobs[0];

      // Get unpaid jobs for display
      const unpaidJobsList = jobsData.jobs.filter(job => !isPaid(job.paid));

      // Get overdue jobs (unpaid AND expPaid date is past today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Judged by the same function that shows the date on the row, so the
      // list and the label under it cannot disagree.
      //
      // It used to be `new Date(job.expPaid)`, and expPaid is free text: the
      // dashed form parses as UTC midnight — the evening before, in Arizona —
      // while the slashed form parses as local. The same date typed two ways
      // landed on different days, so some jobs were called overdue a day early.
      const overdueJobsList = unpaidJobsList.filter(job => expectedPayment(job, today).overdue);

      // Update stats
      setStats({
        totalIncome: jobsData.paidIncome,
        currentYearIncome: currentYearPaidIncome,
        unpaidJobs: unpaidJobsList.length,
        unpaidJobsList: unpaidJobsList.slice(0, 5), // Keep top 5 for display
        overdueJobsList: overdueJobsList,
        currentSR: currentJob?.sr || currentJob?.invoiceNumber || 'N/A',
        currentSRCustomer: currentJob?.customer || currentJob?.customerName || 'N/A'
      });

      // Update activity feed
      setRecentActivityData(activityData);

      // Update customers list
      setCustomers(customersList);

      // Store all jobs for filtering
      setAllJobsData(jobsData.jobs);

      // Calculate monthly income for chart (current year) - separate paid and unpaid
      const monthlyPaid = Array(12).fill(0);
      const monthlyUnpaid = Array(12).fill(0);

      jobsData.jobs.forEach(job => {
        if (job.year === currentYear && job.invoiceDate) {
          // Parse invoiceDate as local date to avoid timezone issues
          // invoiceDate can be in YYYY-MM-DD or MM/DD/YYYY format
          let date;
          if (job.invoiceDate.includes('-')) {
            // YYYY-MM-DD format - parse as local date
            const [year, month, day] = job.invoiceDate.split('-').map(Number);
            date = new Date(year, month - 1, day);
          } else {
            // MM/DD/YYYY or other format - let Date parse it
            date = new Date(job.invoiceDate);
          }

          if (!isNaN(date.getTime())) {
            const month = date.getMonth();
            // Use actual cost if available, otherwise use quote
            const amount = jobAmount(job);
            if (isPaid(job.paid)) {
              monthlyPaid[month] += amount;
            } else {
              monthlyUnpaid[month] += amount;
            }
          }
        }
      });
      setMonthlyIncome({ paid: monthlyPaid, unpaid: monthlyUnpaid });

      // Set last updated timestamp
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      setLoadError(`Failed to load data: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle manual refresh - clears cache and reloads
  const handleRefresh = async () => {
    clearDataCache();
    await loadData();
  };

  // Handle month click on chart
  const handleMonthClick = (monthIndex) => {
    if (selectedMonth === monthIndex) {
      // Clicking the same month again - deselect
      setSelectedMonth(null);
      setMonthJobs([]);
    } else {
      // Filter jobs for the selected month
      const yearToFilter = yearFilter === 'all' ? new Date().getFullYear().toString() : yearFilter;
      const jobsInMonth = allJobsData.filter(job => {
        if (job.year !== yearToFilter || !job.invoiceDate) return false;

        // Parse date
        let date;
        if (job.invoiceDate.includes('-')) {
          const [year, month, day] = job.invoiceDate.split('-').map(Number);
          date = new Date(year, month - 1, day);
        } else {
          date = new Date(job.invoiceDate);
        }

        return !isNaN(date.getTime()) && date.getMonth() === monthIndex;
      });

      setSelectedMonth(monthIndex);
      setMonthJobs(jobsInMonth);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Real-time updates: when jobs or timesheets change in Firestore, the
  // dashboard quietly refreshes itself without blanking the page.
  useEffect(() => {
    const unsub = subscribeAllUpdates(() => {
      loadData();
      // The calendar is fed by its own fetch, so refreshing the dashboard alone
      // left it stale. Only refetch while it's on screen — no point paying for
      // the read otherwise.
      if (showCalendarRef.current) loadCalendarEvents();
    });
    return unsub;
  }, []);

  // The subscription callback is created once, so it reads the live value
  // through a ref rather than closing over a stale `showCalendar`.
  const showCalendarRef = useRef(showCalendar);
  useEffect(() => { showCalendarRef.current = showCalendar; }, [showCalendar]);

  // Recalculate monthly income when filters change
  useEffect(() => {
    if (allJobsData.length === 0) return;

    const monthlyPaid = Array(12).fill(0);
    const monthlyUnpaid = Array(12).fill(0);
    allJobsData.forEach(job => {
      // Apply year filter
      const yearMatch = yearFilter === 'all' || job.year === yearFilter;

      if (yearMatch && job.invoiceDate) {
        // Parse invoiceDate as local date to avoid timezone issues
        let date;
        if (job.invoiceDate.includes('-')) {
          // YYYY-MM-DD format - parse as local date
          const [year, month, day] = job.invoiceDate.split('-').map(Number);
          date = new Date(year, month - 1, day);
        } else {
          // MM/DD/YYYY or other format - let Date parse it
          date = new Date(job.invoiceDate);
        }

        if (!isNaN(date.getTime())) {
          const month = date.getMonth();
          // Use actual cost if available, otherwise use quote
          const amount = jobAmount(job);
          if (isPaid(job.paid)) {
            monthlyPaid[month] += amount;
          } else {
            monthlyUnpaid[month] += amount;
          }
        }
      }
    });
    setMonthlyIncome({ paid: monthlyPaid, unpaid: monthlyUnpaid });
  }, [yearFilter, statusFilter, allJobsData]);

  const apps = [
    {
      id: 'jobs',
      name: 'Jobs Tracker',
      url: 'https://jti-jobs.pages.dev/',
      icon: <img src="/jtijobs.png" alt="Jobs" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#3b82f6',
      description: 'Manage quotes, invoices, and job tracking'
    },
    {
      id: 'downtime',
      name: 'Shearers DTL',
      url: 'https://jti-shearers.pages.dev/',
      icon: <img src="/shearersdowntime.png" alt="Downtime" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#ef4444',
      description: 'Track equipment downtime events'
    },
    {
      id: 'timesheet',
      name: 'Time Sheet',
      url: 'https://jti-timesheet.pages.dev/',
      icon: <img src="/timesheet.png" alt="TimeSheet" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#10b981',
      description: 'Employee time tracking and payroll'
    },
    {
      id: 'weigher',
      name: 'Weigher Issues',
      url: 'https://jti-issues.pages.dev/',
      icon: <img src="/mdtl.png" alt="Weigher" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#f59e0b',
      description: 'Ishida weigher issue logging'
    },
    {
      id: 'servicequote',
      name: 'Service Quote',
      url: 'https://jti-quotes.pages.dev/',
      icon: <img src="/servicequote.png" alt="Quote" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#8b5cf6',
      description: 'Create and manage service quotes'
    },
    {
      id: 'inventory',
      name: 'JTI Inventory',
      url: 'https://jti-inventory.pages.dev/',
      icon: <img src="/jtiinventory.png" alt="Inventory" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#06b6d4',
      description: 'Parts and circuit board inventory'
    },
    {
      id: 'partsmanual',
      name: 'Parts Manual',
      url: 'https://jti-parts.pages.dev/',
      icon: <img src="/partsmanual.png" alt="Parts Manual" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#ec4899',
      description: 'Interactive parts diagram viewer'
    },
    {
      id: 'mdvalidation',
      name: 'MD Validation',
      url: 'https://jti-validation.pages.dev/',
      icon: <ShieldCheck size={32} />,
      color: '#6366f1',
      description: 'Metal detection validation forms & records'
    }
  ];


  // Dark mode colors
  const colors = darkMode ? {
    bg: '#111827',
    cardBg: '#1f2937',
    text: '#f9fafb',
    textSecondary: '#9ca3af',
    border: '#374151',
    hover: '#374151'
  } : {
    bg: '#f9fafb',
    cardBg: 'white',
    text: '#111827',
    textSecondary: '#6b7280',
    border: '#e5e7eb',
    hover: '#f3f4f6'
  };

  // The six views, as data. Each was an eighteen-line button before, identical
  // but for its colour and label, which is why adding one meant copying one.
  const PANELS = [
    {
      key: 'new-job', label: 'Start a job', Icon: Plus, tone: ui.TONE.ok, active: showNewJob,
      onClick: () => {
        const next = !showNewJob;
        go({ view: next ? VIEWS.newJob : HOME });
        if (next) setSearchResults(null);
      },
    },
    {
      key: 'board', label: 'Open jobs', Icon: ClipboardList, tone: ui.TONE.warn, active: showBoard,
      onClick: () => {
        const next = !showBoard;
        go({ view: next ? VIEWS.board : HOME });
        if (next) setSearchResults(null);
      },
    },
    { key: 'calendar', label: 'Calendar', Icon: Calendar, tone: ui.TONE.brand, active: showCalendar, onClick: toggleCalendar },
    { key: 'map', label: 'Map', Icon: MapPin, tone: ui.TONE.ok, active: showMap, onClick: toggleMap },
    { key: 'troubleshoot', label: 'Troubleshoot', Icon: Wrench, tone: ui.TONE.warn, active: showTroubleshoot, onClick: toggleTroubleshoot },
    { key: 'reports', label: 'Reports', Icon: FileText, tone: ui.TONE.violet, active: showServiceReports, onClick: toggleServiceReports },
    {
      key: 'records', label: 'Records', Icon: Building2, tone: '#0ea5e9', active: showRecords,
      onClick: async () => {
        const next = !showRecords;
        go({ view: next ? VIEWS.records : HOME });
        if (next) setSearchResults(null);
      },
    },
    {
      key: 'backups', label: 'Backups', Icon: HardDriveDownload, tone: ui.TONE.warn, active: showBackups,
      onClick: () => {
        const next = !showBackups;
        go({ view: next ? VIEWS.backups : HOME });
        if (next) setSearchResults(null);
      },
    },
    {
      key: 'packet', label: 'Packet', Icon: Paperclip, tone: ui.TONE.pink, active: showPacket,
      onClick: async () => {
        const next = !showPacket;
        go({ view: next ? VIEWS.packet : HOME });
        if (next) setSearchResults(null);
      },
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: colors.bg, transition: 'background 0.3s' }}>
      {/* A tab left open all day keeps showing yesterday's build, and its
          figures, with nothing to say so. The no-store headers only help
          somebody who reloads. */}
      <UpdateBanner />
      {/* Mobile-friendly styles */}
      <style>{`
        @keyframes jti-spin { to { transform: rotate(360deg); } }
        @media (max-width: 768px) {
          .mobile-header {
            padding: 12px 16px !important;
          }
          .header-container {
            flex-direction: column !important;
            gap: 12px !important;
            align-items: stretch !important;
          }
          .header-controls {
            flex-wrap: wrap !important;
            justify-content: center !important;
            gap: 8px !important;
          }
          .search-input {
            width: 100% !important;
            min-width: 0 !important;
          }
          .search-container {
            width: 100% !important;
            order: -1 !important;
          }
          .customer-dropdown {
            min-width: 0 !important;
            flex: 1 !important;
          }
          .customer-dropdown button {
            min-width: 0 !important;
          }
          .stats-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
          .apps-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
          .main-content {
            padding: 16px !important;
          }
          .header-title {
            font-size: 18px !important;
          }
          .stat-value {
            font-size: 22px !important;
          }
          .hide-on-mobile {
            display: none !important;
          }
        }
        @media (max-width: 480px) {
          .header-controls > button,
          .header-controls > div {
            flex: 1 1 calc(50% - 4px) !important;
            min-width: 0 !important;
          }
          .header-controls > button {
            padding: 8px 12px !important;
            font-size: 12px !important;
          }
        }
        @media (max-width: 768px) {
          .filter-buttons button {
            padding: 4px 8px !important;
            font-size: 11px !important;
          }
          .filter-divider {
            display: none !important;
          }
          .chart-container {
            height: 120px !important;
          }
          .chart-label {
            font-size: 7px !important;
          }
          .chart-value {
            font-size: 7px !important;
          }
        }
      `}</style>
      {/* Header */}
      <header className="mobile-header" style={{
        background: colors.cardBg,
        borderBottom: `1px solid ${colors.border}`,
        padding: '16px 32px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        transition: 'background 0.3s, border-color 0.3s'
      }}>
        <div className="header-container" style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img
              src="/logo.png"
              alt="JTI Logo"
              style={{ height: '40px', width: 'auto' }}
            />
            <h1 className="header-title" style={{ fontSize: '24px', fontWeight: '700', color: colors.text }}>
              Unified Dashboard
            </h1>
          </div>
          <div className="header-controls" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* Search Input */}
            <div className="search-container" style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center'
            }}>
              <Search size={18} style={{
                position: 'absolute',
                left: '12px',
                color: '#9ca3af',
                pointerEvents: 'none'
              }} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder='Search… ( "/" to focus )'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={(e) => { setSearchFocused(true); e.target.style.borderColor = '#3b82f6'; }}
                onBlur={(e) => { setTimeout(() => setSearchFocused(false), 150); e.target.style.borderColor = colors.border; }}
                className="search-input"
                style={{
                  padding: '8px 56px 8px 40px',
                  borderRadius: '8px',
                  border: `1px solid ${colors.border}`,
                  fontSize: '14px',
                  width: '220px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  background: colors.cardBg,
                  color: colors.text
                }}
              />
              {searchLoading && (
                <span
                  title="Searching…"
                  style={{
                    position: 'absolute',
                    right: searchTerm ? '32px' : '10px',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    border: '2px solid #93c5fd',
                    borderTopColor: '#3b82f6',
                    animation: 'jti-spin 0.8s linear infinite',
                    pointerEvents: 'none'
                  }}
                />
              )}
              {searchTerm && (
                <button
                  onClick={clearSearch}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    color: '#9ca3af'
                  }}
                >
                  <X size={16} />
                </button>
              )}
              {searchFocused && !searchTerm && (pinnedSearches.length > 0 || recentSearches.length > 0) && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  background: colors.cardBg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  zIndex: 50,
                  overflow: 'hidden'
                }}>
                  {pinnedSearches.length > 0 && (
                    <>
                      <div style={{ padding: '6px 12px', fontSize: '11px', color: colors.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        ★ Pinned
                      </div>
                      {pinnedSearches.map((q) => (
                        <div key={'pin-' + q} style={{ display: 'flex', alignItems: 'center' }}>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); setSearchTerm(q); }}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'transparent', border: 0, cursor: 'pointer', color: colors.text, fontSize: '13px', textAlign: 'left' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = colors.hover)}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <span style={{ color: '#fbbf24' }}>★</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q}</span>
                          </button>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); togglePinSearch(q); }}
                            title="Unpin"
                            style={{ background: 'transparent', border: 0, color: colors.textSecondary, padding: '6px 10px', cursor: 'pointer', fontSize: '14px' }}
                          >×</button>
                        </div>
                      ))}
                    </>
                  )}
                  {recentSearches.length > 0 && (
                    <>
                      <div style={{
                        padding: '6px 12px', fontSize: '11px', color: colors.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        borderTop: pinnedSearches.length > 0 ? `1px solid ${colors.border}` : 'none'
                      }}>
                        <span>Recent searches</span>
                        <button
                          onMouseDown={(e) => { e.preventDefault(); clearRecentSearches(); }}
                          style={{ background: 'transparent', border: 0, color: '#3b82f6', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                        >Clear</button>
                      </div>
                      {recentSearches.map((q) => (
                        <div key={q} style={{ display: 'flex', alignItems: 'center' }}>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); setSearchTerm(q); }}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'transparent', border: 0, cursor: 'pointer', color: colors.text, fontSize: '13px', textAlign: 'left' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = colors.hover)}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <Search size={12} style={{ color: colors.textSecondary, flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q}</span>
                          </button>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); togglePinSearch(q); }}
                            title={isPinned(q) ? 'Unpin' : 'Pin'}
                            style={{ background: 'transparent', border: 0, color: isPinned(q) ? '#fbbf24' : colors.textSecondary, padding: '6px 10px', cursor: 'pointer', fontSize: '14px' }}
                          >★</button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Search Scope Toggle - shows when customer is selected */}
            {selectedCustomer && (
              <div style={{
                display: 'flex',
                borderRadius: '6px',
                overflow: 'hidden',
                border: `1px solid ${colors.border}`,
                fontSize: '12px'
              }}>
                <button
                  onClick={() => setSearchScope('customer')}
                  style={{
                    padding: '6px 10px',
                    border: 'none',
                    background: searchScope === 'customer' ? '#3b82f6' : colors.cardBg,
                    color: searchScope === 'customer' ? 'white' : colors.textSecondary,
                    cursor: 'pointer',
                    fontWeight: '500',
                    transition: 'all 0.2s'
                  }}
                >
                  This Customer
                </button>
                <button
                  onClick={() => setSearchScope('all')}
                  style={{
                    padding: '6px 10px',
                    border: 'none',
                    borderLeft: `1px solid ${colors.border}`,
                    background: searchScope === 'all' ? '#3b82f6' : colors.cardBg,
                    color: searchScope === 'all' ? 'white' : colors.textSecondary,
                    cursor: 'pointer',
                    fontWeight: '500',
                    transition: 'all 0.2s'
                  }}
                >
                  All
                </button>
              </div>
            )}
            {/* Customer Dropdown */}
            <div className="customer-dropdown" style={{ position: 'relative' }}>
              <button
                onClick={() => setShowCustomerDropdown(!showCustomerDropdown)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  background: selectedCustomer ? '#3b82f6' : 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: selectedCustomer ? 'white' : '#374151',
                  minWidth: '150px',
                  justifyContent: 'space-between',
                  width: '100%'
                }}
              >
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  textAlign: 'left'
                }}>
                  {selectedCustomer || 'Select Customer'}
                </span>
                <ChevronDown size={16} style={{
                  transform: showCustomerDropdown ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s'
                }} />
              </button>
              {showCustomerDropdown && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '4px',
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  zIndex: 200,
                  minWidth: '260px',
                  maxWidth: 'calc(100vw - 32px)',
                }}>
                  {selectedCustomer && (
                    <button
                      onClick={() => handleCustomerSelect('')}
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        border: 'none',
                        background: '#f3f4f6',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '14px',
                        color: '#6b7280',
                        fontStyle: 'italic'
                      }}
                    >
                      Clear selection
                    </button>
                  )}
                  {customers.length === 0 ? (
                    <div style={{
                      padding: '10px 16px',
                      color: '#6b7280',
                      fontSize: '14px'
                    }}>
                      Loading customers...
                    </div>
                  ) : (
                    customers.map((customer, index) => (
                      <button
                        key={index}
                        onClick={() => handleCustomerSelect(customer.name)}
                        style={{
                          width: '100%',
                          padding: '10px 16px',
                          border: 'none',
                          borderTop: index > 0 || selectedCustomer ? '1px solid #f3f4f6' : 'none',
                          background: selectedCustomer === customer.name ? '#eff6ff' : 'white',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '14px',
                          color: '#111827',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                        onMouseEnter={(e) => {
                          if (selectedCustomer !== customer.name) {
                            e.currentTarget.style.background = '#f9fafb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = selectedCustomer === customer.name ? '#eff6ff' : 'white';
                        }}
                      >
                        <span>{customer.name}</span>
                        <span style={{
                          fontSize: '12px',
                          color: '#6b7280',
                          fontStyle: 'italic'
                        }}>
                          ({customer.sources.join(', ')})
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {/* Primary navigation.
                These six were six near-identical eighteen-line buttons sitting
                loose among the utilities, so Calendar and Logout were drawn the
                same and twelve controls sprawled over four rows. They are one
                group now — they are mutually exclusive, which is the tell that
                they were always one control — and the active one is filled, so
                where you are is visible rather than inferred. */}
            <nav
              aria-label="Views"
              style={{
                display: 'flex', gap: '4px', flexWrap: 'wrap', padding: '4px',
                borderRadius: '10px', background: colors.hover,
                border: `1px solid ${colors.border}`,
              }}
            >
              {PANELS.map(({ key, label: text, Icon, tone, active, onClick }) => (
                <button
                  key={key}
                  onClick={onClick}
                  aria-pressed={active}
                  style={ui.btn(colors, {
                    tone, active, size: 'sm',
                    over: { border: '1px solid transparent', background: active ? tone : 'transparent' },
                  })}
                >
                  <Icon size={16} />
                  {text}
                </button>
              ))}
            </nav>
            <button
              onClick={handleRefresh}
              disabled={loading}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: `1px solid ${colors.border}`,
                background: loading ? colors.hover : colors.cardBg,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '14px',
                fontWeight: '500',
                color: colors.text
              }}>
              <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            {lastUpdated && (
              <span className="hide-on-mobile" style={{
                fontSize: '12px',
                color: colors.textSecondary,
                display: 'flex',
                alignItems: 'center'
              }}>
                Updated {formatRelativeTime(lastUpdated)}
              </span>
            )}
            <button className="hide-on-mobile" style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              background: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151'
            }}>
              <Calendar size={16} />
              Today: {new Date().toLocaleDateString()}
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              style={{
                padding: '8px',
                borderRadius: '8px',
                border: `1px solid ${colors.border}`,
                background: colors.cardBg,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {darkMode ? <Sun size={20} style={{ color: '#f59e0b' }} /> : <Moon size={20} style={{ color: '#6b7280' }} />}
            </button>
            <button style={{
              padding: '8px',
              borderRadius: '8px',
              border: `1px solid ${colors.border}`,
              background: colors.cardBg,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}>
              <Settings size={20} style={{ color: colors.textSecondary }} />
            </button>
            <button
              onClick={logout}
              title="Sign Out"
              style={{
                padding: '8px',
                borderRadius: '8px',
                border: '1px solid #ef4444',
                background: colors.cardBg,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <LogOut size={20} style={{ color: '#ef4444' }} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content" style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: '32px'
      }}>
        {/* Anything that failed to load. loadError below is the whole-page
            failure; this is the per-source one that used to be invisible. */}
        <DataHealthBanner colors={colors} />

        {/* Error Display */}
        {loadError && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
            color: '#dc2626'
          }}>
            <strong>Error:</strong> {loadError}
          </div>
        )}

        {/* Debug: Data Load Status (remove after debugging) */}
        {!loading && !loadError && allJobsData.length === 0 && (
          <div style={{
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
            color: '#92400e',
            fontSize: '14px'
          }}>
            <strong>No jobs data loaded.</strong> This is likely a CORS issue with Firebase Storage on mobile.
            Try accessing from a desktop browser or check Firebase Storage CORS configuration.
          </div>
        )}

        {/* Calendar View */}
        {showCalendar && (
          <section>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px'
            }}>
              <h2 style={{
                fontSize: '20px',
                fontWeight: '600',
                color: colors.text,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <Calendar size={24} />
                Work Calendar
              </h2>
              <button
                onClick={closeView}
                style={{
                  padding: '8px 16px',
                  background: colors.cardBg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  color: colors.text,
                  fontSize: '14px'
                }}
              >
                Back to Dashboard
              </button>
            </div>
            <div style={{
              background: colors.cardBg,
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              {calendarLoading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: colors.textSecondary }}>
                  Loading calendar events...
                </div>
              ) : (
                <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>Loading calendar…</div>}>
                  <CalendarView
                    events={calendarEvents}
                    currentMonth={calendarMonth}
                    setCurrentMonth={setCalendarMonth}
                    colors={colors}
                    darkMode={darkMode}
                    onRefresh={loadCalendarEvents}
                  />
                </Suspense>
              )}
            </div>
          </section>
        )}

        {/* Troubleshoot View */}
        {showTroubleshoot && (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', color: colors.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wrench size={24} />
                Troubleshoot
              </h2>
              <button
                onClick={closeView}
                style={{ padding: '8px 16px', background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', color: colors.text, fontSize: '14px' }}
              >
                Back to Dashboard
              </button>
            </div>
            <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>Loading troubleshoot…</div>}>
              <Troubleshoot
                timesheets={troubleshootTimesheets}
                timesheetsLoading={troubleshootTimesheetsLoading}
                darkMode={darkMode}
                colors={colors}
                onRefreshTimesheets={loadTroubleshootTimesheets}
              />
            </Suspense>
          </section>
        )}

        {/* Service Report Lookup View */}
        {showServiceReports && (
          <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>Loading reports…</div>}>
            <ServiceReportLookup
              reports={serviceReports.reports}
              jobs={allJobsData}
              packets={packetsBySr}
              startedJobs={startedJobs}
              years={serviceReports.years}
              untaggedVisits={serviceReports.untaggedVisits}
              untaggedTimesheets={serviceReports.untaggedTimesheets}
              loading={serviceReportsLoading}
              colors={colors}
              onRefresh={async () => {
                await Promise.all([
                  loadServiceReports(),
                  fetchAllPackets().then(setPacketsBySr).catch((e) => console.warn('Packets unavailable:', e)),
                  fetchUnifiedJobs().then(setStartedJobs).catch((e) => console.warn('Reserved numbers unavailable:', e)),
                ]);
              }}
            />
          </Suspense>
        )}

        {/* Factory Map View */}
        {showMap && (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', color: colors.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MapPin size={24} />
                Factory Locations
              </h2>
              <button onClick={closeView} style={{ padding: '8px 16px', background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', color: colors.text, fontSize: '14px' }}>
                Back to Dashboard
              </button>
            </div>

            {/* Add Factory Form */}
            <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: colors.text, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={18} />
                {editingFactory ? 'Edit Factory' : 'Add Factory Location'}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                <input type="text" placeholder="Factory Name *" value={editingFactory ? editingFactory.name : newFactory.name} onChange={(e) => editingFactory ? setEditingFactory({ ...editingFactory, name: e.target.value }) : setNewFactory({ ...newFactory, name: e.target.value })} style={{ padding: '10px 12px', borderRadius: '6px', border: `1px solid ${colors.border}`, background: colors.bg, color: colors.text, fontSize: '14px' }} />
                <input type="text" placeholder="Address *" value={editingFactory ? editingFactory.address : newFactory.address} onChange={(e) => editingFactory ? setEditingFactory({ ...editingFactory, address: e.target.value }) : setNewFactory({ ...newFactory, address: e.target.value })} style={{ padding: '10px 12px', borderRadius: '6px', border: `1px solid ${colors.border}`, background: colors.bg, color: colors.text, fontSize: '14px' }} />
                <input type="text" placeholder="Latitude (auto-filled)" value={editingFactory ? editingFactory.lat : newFactory.lat} onChange={(e) => editingFactory ? setEditingFactory({ ...editingFactory, lat: e.target.value }) : setNewFactory({ ...newFactory, lat: e.target.value })} style={{ padding: '10px 12px', borderRadius: '6px', border: `1px solid ${colors.border}`, background: colors.bg, color: colors.text, fontSize: '14px' }} />
                <input type="text" placeholder="Longitude (auto-filled)" value={editingFactory ? editingFactory.lng : newFactory.lng} onChange={(e) => editingFactory ? setEditingFactory({ ...editingFactory, lng: e.target.value }) : setNewFactory({ ...newFactory, lng: e.target.value })} style={{ padding: '10px 12px', borderRadius: '6px', border: `1px solid ${colors.border}`, background: colors.bg, color: colors.text, fontSize: '14px' }} />
                <input type="text" placeholder="Notes (optional)" value={editingFactory ? editingFactory.notes : newFactory.notes} onChange={(e) => editingFactory ? setEditingFactory({ ...editingFactory, notes: e.target.value }) : setNewFactory({ ...newFactory, notes: e.target.value })} style={{ padding: '10px 12px', borderRadius: '6px', border: `1px solid ${colors.border}`, background: colors.bg, color: colors.text, fontSize: '14px', gridColumn: 'span 2' }} />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                {editingFactory ? (
                  <>
                    <button onClick={updateFactory} disabled={geocoding} style={{ padding: '10px 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: geocoding ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px' }}>{geocoding ? 'Locating...' : 'Update Factory'}</button>
                    <button onClick={() => setEditingFactory(null)} style={{ padding: '10px 20px', background: colors.cardBg, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={lookupAddress} disabled={geocoding} style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: geocoding ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px' }}><Search size={16} />{geocoding ? 'Looking up...' : 'Lookup Address'}</button>
                    <button onClick={addFactory} disabled={geocoding} style={{ padding: '10px 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: geocoding ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px' }}><Plus size={16} />{geocoding ? 'Locating...' : 'Add Factory'}</button>
                  </>
                )}
              </div>
              <p style={{ marginTop: '12px', fontSize: '12px', color: colors.textSecondary }}>
                Tip: Click "Lookup Address" first to verify the location. If not found, try full street names (e.g., "Drive" instead of "Dr").
              </p>
            </div>

            {/* Map */}
            <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: colors.text, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Navigation size={18} />
                Map View ({factoriesLoading ? 'Loading...' : `${factories.length} location${factories.length !== 1 ? 's' : ''}`})
              </h3>
              {factoriesLoading ? (
                <div style={{ height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textSecondary }}>Loading factory locations from Firebase...</div>
              ) : (
                <Suspense fallback={<div style={{ height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textSecondary }}>Loading map…</div>}>
                  <FactoryMapView factories={factories} colors={colors} onEdit={setEditingFactory} onDelete={deleteFactory} mapCenter={mapCenter} mapZoom={mapZoom} />
                </Suspense>
              )}
            </div>

            {/* Factory List */}
            {factories.length > 0 && (
              <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: colors.text, marginBottom: '16px' }}>Factory List</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {factories.map(factory => (
                    <div key={factory.id} style={{ padding: '16px', background: colors.bg, borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ flex: 1, minWidth: '200px' }}>
                        <div style={{ fontWeight: '600', color: colors.text, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <MapPin size={16} style={{ color: '#10b981' }} />
                          {factory.name}
                        </div>
                        <div style={{ fontSize: '13px', color: colors.textSecondary }}>{factory.address}</div>
                        {factory.notes && <div style={{ fontSize: '12px', color: colors.textSecondary, fontStyle: 'italic', marginTop: '4px' }}>{factory.notes}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => { setMapCenter([factory.lat, factory.lng]); setMapZoom(14); }} style={{ padding: '6px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><Navigation size={14} />View</button>
                        <button onClick={() => setEditingFactory(factory)} style={{ padding: '6px 12px', background: colors.cardBg, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '4px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><Edit2 size={14} />Edit</button>
                        <button onClick={() => deleteFactory(factory.id)} style={{ padding: '6px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><Trash2 size={14} />Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Search Results */}
        {(searchResults || searchLoading) && (
          <SearchResults results={searchResults} loading={searchLoading} setSearchTerm={setSearchTerm} colors={colors} />
        )}

        {/* Customer Detail View */}
        {showBackups && !selectedCustomer && !searchResults && (
          <BackupPanel colors={colors} />
        )}

        {showNewJob && !selectedCustomer && !searchResults && (
          <NewJobPage
            colors={colors}
            customerRecords={customerRecords}
            // The number is live the moment it is reserved, so the pickers that
            // read it are refreshed rather than left showing yesterday's list.
            onCreated={() => loadServiceReports()}
            onOpenPacket={(sr) => go({ view: VIEWS.packet, sr })}
          />
        )}

        {showBoard && !selectedCustomer && !searchResults && (
          <JobBoard
            colors={colors}
            // A row opens that job's packet — the board says what needs doing
            // and this is where it gets done.
            onOpen={(sr) => go({ view: VIEWS.packet, sr })}
          />
        )}

        {showPacket && !selectedCustomer && !searchResults && (
          <JobPacketBuilder
            colors={colors}
            serviceReports={serviceReports.reports}
            customerRecords={customerRecords}
            customers={customers}
            jobs={allJobsData}
            initialSr={route.sr || ''}
            onClose={closeView}
            onStartJob={() => go({ view: VIEWS.newJob })}
          />
        )}

        {showRecords && !selectedCustomer && !searchResults && (
          <CustomerRecordsPanel
            customers={customers}
            records={customerRecords}
            colors={colors}
            onOpenCustomer={(name) => handleCustomerSelect(name)}
          />
        )}

        {(selectedCustomer || customerLoading) && !searchResults && (
          <CustomerDetailView
            data={customerData}
            customerName={selectedCustomer}
            loading={customerLoading}
            onClear={clearCustomerSelection}
            setSearchTerm={setSearchTerm}
            colors={colors}
            customerRecords={customerRecords}
            onSaveProfile={handleSaveCustomerProfile}
            onLinkCustomer={handleLinkCustomer}
            onMoveJob={handleMoveJob}
            moveTargets={customers.map((c) => c.name)}
          />
        )}

        {/* Filters and Chart - Hide when searching, viewing customer, or calendar */}
        {/* One condition instead of the negation of every view ever added. Seven
            booleans describe 128 states of which 8 are legal; the URL describes
            the 8. */}
        {!searchResults && !selectedCustomer && route.view === HOME && (
          <div style={{ marginBottom: '24px' }}>
            {/* Quick Filters */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '24px',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: colors.textSecondary, fontSize: '14px' }}>
                <Filter size={16} />
                Year:
              </div>
              {(() => {
                // Generate year list from 2022 to current year + 3 (to support future years)
                const currentYear = new Date().getFullYear();
                const years = ['all'];
                for (let year = currentYear + 3; year >= 2022; year--) {
                  years.push(year.toString());
                }
                return years;
              })().map(year => (
                <button
                  key={year}
                  onClick={() => setYearFilter(year)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${yearFilter === year ? '#3b82f6' : colors.border}`,
                    background: yearFilter === year ? '#3b82f6' : colors.cardBg,
                    color: yearFilter === year ? 'white' : colors.text,
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '500'
                  }}
                >
                  {year === 'all' ? 'All' : year}
                </button>
              ))}
              <div className="filter-divider" style={{ width: '1px', height: '24px', background: colors.border, margin: '0 8px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: colors.textSecondary, fontSize: '14px' }}>
                Status:
              </div>
              {['all', 'paid', 'unpaid'].map(status => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${statusFilter === status ? '#3b82f6' : colors.border}`,
                    background: statusFilter === status ? '#3b82f6' : colors.cardBg,
                    color: statusFilter === status ? 'white' : colors.text,
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '500',
                    textTransform: 'capitalize'
                  }}
                >
                  {status === 'all' ? 'All' : status}
                </button>
              ))}
            </div>

            {/* Income Chart */}
            <div style={{
              background: colors.cardBg,
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3
                onClick={() => setShowIncomeChart(!showIncomeChart)}
                style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: colors.text,
                  marginBottom: showIncomeChart ? '16px' : '0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                <BarChart3 size={20} />
                {yearFilter === 'all' ? 'All Years' : yearFilter} Monthly Income
                <ChevronDown
                  size={18}
                  style={{
                    marginLeft: 'auto',
                    transform: showIncomeChart ? 'rotate(0)' : 'rotate(-90deg)',
                    transition: 'transform 0.2s'
                  }}
                />
              </h3>
              {showIncomeChart && (
              <>
              <div className="chart-container" style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '6px',
                height: '150px',
                paddingTop: '20px'
              }}>
                {monthlyIncome.paid.map((paidAmount, index) => {
                  const unpaidAmount = monthlyIncome.unpaid[index];
                  const totalAmount = paidAmount + unpaidAmount;
                  const allTotals = monthlyIncome.paid.map((p, i) => p + monthlyIncome.unpaid[i]);
                  const maxAmount = Math.max(...allTotals, 1);
                  const totalHeight = maxAmount > 0 ? (totalAmount / maxAmount) * 100 : 0;
                  const paidHeight = maxAmount > 0 ? (paidAmount / maxAmount) * 100 : 0;
                  const unpaidHeight = totalHeight - paidHeight;
                  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  const isCurrentMonth = index === new Date().getMonth();
                  const isSelected = selectedMonth === index;
                  return (
                    <div
                      key={index}
                      onClick={() => handleMonthClick(index)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        height: '100%',
                        justifyContent: 'flex-end',
                        cursor: 'pointer',
                        opacity: isSelected ? 1 : (selectedMonth !== null ? 0.5 : 1),
                        transition: 'opacity 0.2s'
                      }}
                    >
                      {totalAmount > 0 && (
                        <span className="chart-value" style={{
                          fontSize: '9px',
                          color: colors.text,
                          fontWeight: '600',
                          whiteSpace: 'nowrap'
                        }}>
                          ${totalAmount >= 1000 ? `${(totalAmount/1000).toFixed(1)}k` : totalAmount.toFixed(0)}
                        </span>
                      )}
                      {/* Stacked bar container */}
                      <div style={{
                        width: '100%',
                        height: `${totalHeight}%`,
                        minHeight: totalAmount > 0 ? '8px' : '2px',
                        display: 'flex',
                        flexDirection: 'column-reverse',
                        borderRadius: '4px 4px 0 0',
                        overflow: 'hidden',
                        transition: 'height 0.3s'
                      }}>
                        {/* Paid income (bottom, green) */}
                        {paidAmount > 0 && (
                          <div
                            style={{
                              width: '100%',
                              height: `${(paidHeight / totalHeight) * 100}%`,
                              background: isCurrentMonth ? '#3b82f6' : '#10b981',
                              transition: 'height 0.3s'
                            }}
                            title={`${months[index]} Paid: $${paidAmount.toLocaleString()}`}
                          />
                        )}
                        {/* Unpaid income (top, yellow/orange) */}
                        {unpaidAmount > 0 && (
                          <div
                            style={{
                              width: '100%',
                              height: `${(unpaidHeight / totalHeight) * 100}%`,
                              background: '#f59e0b',
                              transition: 'height 0.3s'
                            }}
                            title={`${months[index]} Unpaid: $${unpaidAmount.toLocaleString()}`}
                          />
                        )}
                      </div>
                      <span className="chart-label" style={{
                        fontSize: '9px',
                        color: isSelected ? '#3b82f6' : (isCurrentMonth ? '#3b82f6' : colors.textSecondary),
                        fontWeight: isSelected ? '700' : (isCurrentMonth ? '600' : '400'),
                        padding: '2px 4px',
                        borderRadius: '3px',
                        background: isSelected ? '#dbeafe' : 'transparent'
                      }}>
                        {months[index].slice(0, 3)}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div style={{
                marginTop: '12px',
                display: 'flex',
                gap: '16px',
                fontSize: '11px',
                justifyContent: 'center',
                color: colors.textSecondary
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', background: '#10b981', borderRadius: '2px' }}></div>
                  <span>Paid (Actual)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', background: '#f59e0b', borderRadius: '2px' }}></div>
                  <span>Unpaid (Potential)</span>
                </div>
              </div>
              <div style={{
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: `1px solid ${colors.border}`,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px'
              }}>
                <span style={{ color: colors.textSecondary }}>
                  Total Paid: <strong style={{ color: '#10b981' }}>${monthlyIncome.paid.reduce((a, b) => a + b, 0).toLocaleString()}</strong>
                </span>
                <span style={{ color: colors.textSecondary }}>
                  Total Unpaid: <strong style={{ color: '#f59e0b' }}>${monthlyIncome.unpaid.reduce((a, b) => a + b, 0).toLocaleString()}</strong>
                </span>
              </div>

              {/* Month filter - show jobs for selected month */}
              {selectedMonth !== null && monthJobs.length > 0 && (
                <div style={{
                  marginTop: '16px',
                  paddingTop: '16px',
                  borderTop: `1px solid ${colors.border}`
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: colors.text }}>
                      {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][selectedMonth]} Jobs ({monthJobs.length})
                    </h4>
                    <button
                      onClick={() => { setSelectedMonth(null); setMonthJobs([]); }}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        border: `1px solid ${colors.border}`,
                        borderRadius: '4px',
                        background: colors.cardBg,
                        color: colors.textSecondary,
                        cursor: 'pointer'
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    {monthJobs.map((job, idx) => {
                      const amount = jobAmount(job);
                      const paidStatus = isPaid(job.paid);
                      return (
                        <div
                          key={idx}
                          style={{
                            padding: '8px 12px',
                            background: colors.cardBg,
                            border: `1px solid ${colors.border}`,
                            borderRadius: '6px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '12px'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: '600', color: colors.text }}>
                              {job.customer}
                            </div>
                            <div style={{ color: colors.textSecondary, fontSize: '11px' }}>
                              SR# {job.sr} • {job.invoiceDate}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontWeight: '600', color: colors.text }}>
                              ${amount.toLocaleString()}
                            </span>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: '600',
                              background: paidStatus ? '#d1fae5' : '#fef3c7',
                              color: paidStatus ? '#065f46' : '#92400e'
                            }}>
                              {paidStatus ? 'Paid' : 'Unpaid'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </>
              )}
            </div>
          </div>
        )}

        {/* Stats Grid - Hide when searching, viewing customer, or calendar */}
        {!searchResults && !selectedCustomer && route.view === HOME && <div className="stats-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '24px',
          marginBottom: '32px'
        }}>
          <div
            onClick={() => setIncomeDisplayMode((incomeDisplayMode + 1) % 3)}
            style={{ cursor: 'pointer' }}
          >
            <StatCard
              icon={<DollarSign size={24} />}
              title={incomeDisplayMode === 0 ? "Paid Income" : incomeDisplayMode === 1 ? `${new Date().getFullYear()} Paid` : "Total Paid"}
              value={incomeDisplayMode === 0 ? "Tap to view" : `$${(incomeDisplayMode === 1 ? stats.currentYearIncome : stats.totalIncome).toLocaleString()}`}
              color="#10b981"
              colors={colors}
            />
          </div>
          <div
            onClick={() => setStatusFilter('unpaid')}
            style={{
              background: colors.cardBg,
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '10px',
                background: '#3b82f620',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#3b82f6'
              }}>
                <FileText size={24} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: '14px', color: colors.textSecondary, marginBottom: '4px' }}>Unpaid Jobs</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: colors.text }}>{stats.unpaidJobs}</div>
              {stats.unpaidJobsList && stats.unpaidJobsList.length > 0 && (
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '8px' }}>
                  {stats.unpaidJobsList.map((job, idx) => (
                    <div
                      key={job.sr || idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSearchTerm(String(job.sr || ''));
                      }}
                      style={{ marginBottom: '2px', cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = colors.text)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '')}
                      title="Click to search this job"
                    >
                      <div>{job.sr} - {job.customer || job.customerName || 'Unknown'}</div>
                      {/* What is owed and when it was promised. Without these
                          the list answered "which jobs" and not the question
                          somebody actually opens it with, which is how much is
                          outstanding and when it lands. */}
                      {(() => {
                        const exp = expectedPayment(job, new Date());
                        const pay = paymentState(job, exp.amount || 0);
                        if (!exp.amount && !exp.text) return null;
                        const timing = describeTiming(exp);
                        return (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
                            {/* What is still owed, not what it was worth. A
                                part-paid job showing its full invoice value
                                overstates the outstanding by whatever came in. */}
                            {exp.amount != null && <span>{formatCurrency(pay.outstanding)}</span>}
                            {pay.status === 'partial' && (
                              <span style={{ color: '#f59e0b' }}>part paid</span>
                            )}
                            {exp.text && <span>· {exp.text}</span>}
                            {timing && (
                              <span style={{ color: exp.overdue ? '#ef4444' : undefined, fontWeight: exp.overdue ? 600 : 400 }}>
                                ({timing})
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
              {stats.overdueJobsList && stats.overdueJobsList.length > 0 && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f3f4f6' }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#ef4444',
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <AlertTriangle size={12} />
                    Overdue ({stats.overdueJobsList.length})
                  </div>
                  <div style={{ fontSize: '11px', color: '#ef4444' }}>
                    {stats.overdueJobsList.slice(0, 5).map((job, idx) => (
                      <div key={job.sr || idx} style={{ marginBottom: '2px' }}>
                        {job.sr} - {job.customer || job.customerName || 'Unknown'}
                      </div>
                    ))}
                    {stats.overdueJobsList.length > 5 && <div>+{stats.overdueJobsList.length - 5} more</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Quote against actual. Both figures have been collected for years
              and nothing compared them — which is the only feedback a quote
              ever gets. */}
          {(() => {
            const v = varianceSummary(allJobsData);
            if (!v.counted) return null;
            const over = v.totalDelta > 0;
            return (
              <div style={{
                background: colors.cardBg, borderRadius: '12px', padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ fontSize: '14px', color: colors.textSecondary, marginBottom: '4px' }}>Quote vs actual</div>
                <div style={{ fontSize: '28px', fontWeight: '700', color: colors.text, fontVariantNumeric: 'tabular-nums' }}>
                  {v.medianPct > 0 ? '+' : ''}{v.medianPct.toFixed(1)}%
                </div>
                <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                  {/* Median, not mean: one runaway job should not decide the year. */}
                  typical job, across {v.counted} invoiced
                </div>
                <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '8px' }}>
                  {v.over} over · {v.under} under · {v.on} on quote
                  <div style={{ color: over ? '#059669' : '#ef4444', marginTop: '2px' }}>
                    {over ? '+' : ''}{formatCurrency(v.totalDelta)} against quotes overall
                  </div>
                </div>
                {v.worst.length > 0 && (
                  <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '8px' }}>
                    {v.worst.slice(0, 3).map((w) => (
                      <div
                        key={w.sr}
                        onClick={(e) => { e.stopPropagation(); setSearchTerm(String(w.sr || '')); }}
                        style={{ marginBottom: '2px', cursor: 'pointer' }}
                        title="Click to search this job"
                      >
                        {w.sr} {w.customer} — {w.delta > 0 ? '+' : ''}{formatCurrency(w.delta)} ({w.pct > 0 ? '+' : ''}{w.pct.toFixed(0)}%)
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <div
            onClick={() => {
              if (stats.currentSR && stats.currentSR !== 'N/A') {
                setSearchTerm(stats.currentSR);
              }
            }}
            style={{
              background: colors.cardBg,
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '10px',
                background: '#8b5cf620',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#8b5cf6'
              }}>
                <FileText size={24} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: '14px', color: colors.textSecondary, marginBottom: '4px' }}>Current Service Report</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: colors.text }}>{stats.currentSR}</div>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '4px' }}>{stats.currentSRCustomer}</div>
            </div>
          </div>
        </div>}

        {/* Apps Grid - Hide when searching, viewing customer, or calendar */}
        {!searchResults && !selectedCustomer && route.view === HOME && <section style={{ marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            color: colors.text,
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <BarChart3 size={24} />
            Your Applications
          </h2>
          <div className="apps-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '24px'
          }}>
            {apps.map(app => (
              <AppCard key={app.id} app={app} colors={colors} />
            ))}
          </div>
        </section>}

        {/* Recent Activity - Hide when searching, viewing customer, or calendar */}
        {!searchResults && !selectedCustomer && route.view === HOME && <section>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            color: colors.text,
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Activity size={24} />
            Recent Activity
          </h2>
          <div style={{
            background: colors.cardBg,
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: colors.textSecondary }}>
                Loading activity...
              </div>
            ) : recentActivityData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: colors.textSecondary }}>
                No recent activity found
              </div>
            ) : (
              recentActivityData.map((item, index) => (
                <ActivityItem key={index} item={item} colors={colors} />
              ))
            )}
          </div>
        </section>}

      </main>
    </div>
  );
}

export default App;

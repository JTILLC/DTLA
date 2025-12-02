import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  Clock,
  AlertTriangle,
  FileText,
  TrendingUp,
  Calendar,
  Users,
  Settings,
  ExternalLink,
  Activity,
  BarChart3,
  RefreshCw,
  Search,
  X,
  CheckCircle,
  XCircle,
  ChevronDown,
  Moon,
  Sun,
  Filter,
  ChevronLeft,
  ChevronRight,
  Plus,
  Edit2,
  Trash2
} from 'lucide-react';
import { fetchJobsData, fetchDowntimeData, fetchTimesheetData, fetchRecentActivity, searchUnified, fetchCustomersList, fetchCustomerData, fetchCalendarEvents, deleteTimesheetEntry, clearDataCache } from './data-service';

// Helper function to check if job is paid (handles various formats)
const isPaid = (paidValue) => {
  if (paidValue === true || paidValue === 1) return true;
  if (typeof paidValue === 'string') {
    const lower = paidValue.toLowerCase().trim();
    return lower === 'yes' || lower === 'true' || lower === '1' || lower === 'paid';
  }
  return false;
};

// Helper function to highlight search term in text
const HighlightText = ({ text, searchTerm }) => {
  if (!searchTerm || !text) return <>{text}</>;

  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.toString().split(regex);

  return (
    <>
      {parts.map((part, index) =>
        regex.test(part) ? (
          <mark key={index} style={{
            backgroundColor: '#fef08a',
            padding: '1px 2px',
            borderRadius: '2px',
            fontWeight: '600'
          }}>
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
};

// Helper function to format relative time
const formatRelativeTime = (date) => {
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function App() {
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
  const [searchResults, setSearchResults] = useState(() => {
    const saved = localStorage.getItem('jti-unified-search-results');
    return saved ? JSON.parse(saved) : null;
  });
  const [searchLoading, setSearchLoading] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerData, setCustomerData] = useState(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString());
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthlyIncome, setMonthlyIncome] = useState({ paid: [], unpaid: [] });
  const [allJobsData, setAllJobsData] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [searchScope, setSearchScope] = useState('all'); // 'all' or 'customer'
  const [showIncomeChart, setShowIncomeChart] = useState(false); // Hidden by default
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null); // For chart filter
  const [monthJobs, setMonthJobs] = useState([]); // Jobs for selected month

  // Calendar state
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Handle search
  const handleSearch = async (term) => {
    if (!term || term.trim() === '') {
      setSearchResults(null);
      return;
    }

    setSearchLoading(true);
    try {
      const results = await searchUnified(term);

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
          )
        };
        filteredResults.totalResults = filteredResults.jobs.length + filteredResults.issues.length + filteredResults.timesheets.length;
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

  useEffect(() => {
    if (searchResults) {
      localStorage.setItem('jti-unified-search-results', JSON.stringify(searchResults));
    } else {
      localStorage.removeItem('jti-unified-search-results');
    }
  }, [searchResults]);

  const clearSearch = () => {
    setSearchTerm('');
    setSearchResults(null);
    localStorage.removeItem('jti-unified-search-term');
    localStorage.removeItem('jti-unified-search-results');
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
    if (!showCalendar && calendarEvents.length === 0) {
      loadCalendarEvents();
    }
    setShowCalendar(!showCalendar);
    setSelectedCustomer('');
    setSearchResults(null);
    setSearchTerm('');
  };

  // Handle customer selection
  const handleCustomerSelect = async (customer) => {
    setSelectedCustomer(customer);
    setShowCustomerDropdown(false);
    setSearchResults(null); // Clear search results when viewing customer
    setSearchTerm('');

    if (customer) {
      setCustomerLoading(true);
      try {
        const data = await fetchCustomerData(customer);
        setCustomerData(data);
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
    setSelectedCustomer('');
    setCustomerData(null);
    setSearchScope('all'); // Reset search scope when customer is cleared
  };

  // Fetch real data from Firebase
  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
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
      const currentYearPaidIncome = currentYearJobs.reduce((sum, job) => {
        if (isPaid(job.paid)) {
          const actual = parseFloat(job.actual || 0);
          const quote = parseFloat(job.quote || 0);
          const amount = actual > 0 ? actual : quote;
          return sum + amount;
        }
        return sum;
      }, 0);

      // Find current/most recent SR (by SR number - highest number is most recent)
      const sortedJobs = [...jobsData.jobs].sort((a, b) => {
        const srA = parseInt(a.sr || 0);
        const srB = parseInt(b.sr || 0);
        return srB - srA;
      });
      const currentJob = sortedJobs[0];
      console.log('Total jobs loaded:', jobsData.jobs.length);
      console.log('Current job (highest SR):', currentJob);
      console.log('Unpaid jobs count:', jobsData.jobs.filter(job => !isPaid(job.paid)).length);

      // Get unpaid jobs for display
      const unpaidJobsList = jobsData.jobs.filter(job => !isPaid(job.paid));

      // Get overdue jobs (unpaid AND expPaid date is past today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const overdueJobsList = unpaidJobsList.filter(job => {
        // expPaid is the expected payment date (e.g., "2025-11-15")
        if (!job.expPaid) return false;

        const expPaidDate = new Date(job.expPaid);
        if (isNaN(expPaidDate.getTime())) return false;

        expPaidDate.setHours(0, 0, 0, 0);
        return expPaidDate < today;
      });

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
            const actual = parseFloat(job.actual || 0);
            const quote = parseFloat(job.quote || 0);
            const amount = actual > 0 ? actual : quote;
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
          const actual = parseFloat(job.actual || 0);
          const quote = parseFloat(job.quote || 0);
          const amount = actual > 0 ? actual : quote;
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
      url: 'https://jtidt.netlify.app/',
      icon: <img src="/jtijobs.png" alt="Jobs" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#3b82f6',
      description: 'Manage quotes, invoices, and job tracking'
    },
    {
      id: 'downtime',
      name: 'Shearers DTL',
      url: 'https://shearersjtidowntime.netlify.app/',
      icon: <img src="/shearersdowntime.png" alt="Downtime" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#ef4444',
      description: 'Track equipment downtime events'
    },
    {
      id: 'timesheet',
      name: 'Time Sheet',
      url: 'https://jti-ts3.netlify.app/',
      icon: <img src="/timesheet.png" alt="TimeSheet" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#10b981',
      description: 'Employee time tracking and payroll'
    },
    {
      id: 'weigher',
      name: 'Weigher Issues',
      url: 'https://jti-ccwlog.netlify.app/',
      icon: <img src="/mdtl.png" alt="Weigher" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#f59e0b',
      description: 'Ishida weigher issue logging'
    },
    {
      id: 'servicequote',
      name: 'Service Quote',
      url: 'https://jtiservicequote.netlify.app/',
      icon: <img src="/servicequote.png" alt="Quote" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />,
      color: '#8b5cf6',
      description: 'Create and manage service quotes'
    }
  ];

  const StatCard = ({ icon, title, value, color, trend, onClick }) => (
    <div
      onClick={onClick}
      style={{
        background: colors.cardBg,
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.2s, box-shadow 0.2s'
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        }
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
          background: `${color}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: color
        }}>
          {icon}
        </div>
        {trend && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: trend > 0 ? '#10b981' : '#ef4444',
            fontSize: '14px',
            fontWeight: '500'
          }}>
            <TrendingUp size={16} style={{ transform: trend < 0 ? 'rotate(180deg)' : 'none' }} />
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div>
        <div style={{ fontSize: '14px', color: colors.textSecondary, marginBottom: '4px' }}>{title}</div>
        <div style={{ fontSize: '28px', fontWeight: '700', color: colors.text }}>{value}</div>
      </div>
    </div>
  );

  const AppCard = ({ app }) => (
    <div style={{
      background: colors.cardBg,
      borderRadius: '12px',
      padding: '24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      cursor: 'pointer',
      transition: 'all 0.2s',
      border: '2px solid transparent'
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      e.currentTarget.style.borderColor = app.color;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      e.currentTarget.style.borderColor = 'transparent';
    }}
    onClick={() => window.open(app.url, '_blank')}>
      <div style={{ display: 'flex', alignItems: 'start', gap: '16px' }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '12px',
          background: `${app.color}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: app.color,
          flexShrink: 0
        }}>
          {app.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: colors.text }}>
              {app.name}
            </h3>
            <ExternalLink size={16} style={{ color: colors.textSecondary }} />
          </div>
          <p style={{ fontSize: '14px', color: colors.textSecondary, lineHeight: '1.5' }}>
            {app.description}
          </p>
        </div>
      </div>
    </div>
  );

  const ActivityItem = ({ item, colors }) => {
    const typeColors = {
      job: '#3b82f6',
      downtime: '#ef4444',
      timesheet: '#10b981',
      issue: '#f59e0b'
    };

    return (
      <div
        onClick={() => item.url && window.open(item.url, '_blank')}
        style={{
          display: 'flex',
          gap: '12px',
          borderBottom: `1px solid ${colors?.border || '#f3f4f6'}`,
          cursor: item.url ? 'pointer' : 'default',
          transition: 'background 0.2s',
          margin: '0 -8px',
          padding: '12px 8px',
          borderRadius: '6px'
        }}
        onMouseEnter={(e) => {
          if (item.url) e.currentTarget.style.background = colors?.hover || '#f9fafb';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: typeColors[item.type],
          marginTop: '6px',
          flexShrink: 0
        }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', color: colors?.text || '#111827', marginBottom: '4px' }}>
            {item.message}
          </div>
          <div style={{ fontSize: '12px', color: colors?.textSecondary || '#9ca3af' }}>
            {item.time}
          </div>
        </div>
        {item.url && (
          <ExternalLink size={14} style={{ color: colors?.textSecondary || '#9ca3af', marginTop: '4px' }} />
        )}
      </div>
    );
  };

  // Calendar View Component
  const CalendarView = ({ events, currentMonth, setCurrentMonth, colors, onRefresh }) => {
    const [selectedDay, setSelectedDay] = useState(null);
    const [dayEvents, setDayEvents] = useState([]);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [deleting, setDeleting] = useState(false);

    // Handle delete entry
    const handleDelete = async (event) => {
      setDeleting(true);
      try {
        await deleteTimesheetEntry(event.id, event.date);
        // Remove from local state
        setDayEvents(prev => prev.filter(e => !(e.id === event.id && e.date === event.date)));
        setDeleteConfirm(null);
        // Refresh calendar events
        if (onRefresh) onRefresh();
      } catch (error) {
        alert('Failed to delete entry: ' + error.message);
      }
      setDeleting(false);
    };

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Get days in month
    const getDaysInMonth = (date) => {
      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      const startingDay = firstDay.getDay();
      return { daysInMonth, startingDay };
    };

    // Navigate months
    const prevMonth = () => {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
    };

    const nextMonth = () => {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
    };

    // Get events for a specific date
    const getEventsForDate = (day) => {
      const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return events.filter(event => event.date === dateStr);
    };

    // Handle day click - allow clicking any day
    const handleDayClick = (day) => {
      const evts = getEventsForDate(day);
      setSelectedDay(day);
      setDayEvents(evts);
    };

    const { daysInMonth, startingDay } = getDaysInMonth(currentMonth);

    return (
      <div>
        {/* Calendar Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <button
            onClick={prevMonth}
            style={{
              padding: '8px 12px',
              background: colors.cardBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              cursor: 'pointer',
              color: colors.text
            }}
          >
            <ChevronLeft size={20} />
          </button>
          <h2 style={{ fontSize: '20px', fontWeight: '600', color: colors.text }}>
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </h2>
          <button
            onClick={nextMonth}
            style={{
              padding: '8px 12px',
              background: colors.cardBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              cursor: 'pointer',
              color: colors.text
            }}
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Day Names */}
        <div className="calendar-day-names">
          {dayNames.map(day => (
            <div key={day} className="calendar-day-name" style={{
              color: colors.textSecondary
            }}>
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="calendar-grid">
          {/* Empty cells for days before start of month */}
          {Array.from({ length: startingDay }).map((_, i) => (
            <div key={`empty-${i}`} className="calendar-day-cell" style={{
              background: colors.cardBg,
              opacity: 0.3
            }} />
          ))}

          {/* Days of the month */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dayEvents = getEventsForDate(day);
            const hasEvents = dayEvents.length > 0;
            const isToday = new Date().toDateString() === new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day).toDateString();

            return (
              <div
                key={day}
                onClick={() => handleDayClick(day)}
                className="calendar-day-cell"
                style={{
                  background: hasEvents ? (darkMode ? '#1e3a5f' : '#e0f2fe') : colors.cardBg,
                  border: isToday ? '2px solid #3b82f6' : `1px solid ${colors.border}`
                }}
              >
                <div className="calendar-day-number" style={{
                  fontWeight: isToday ? '700' : '500',
                  color: isToday ? '#3b82f6' : colors.text
                }}>
                  {day}
                </div>
                {hasEvents && (
                  <div style={{ color: colors.textSecondary, overflow: 'hidden' }}>
                    {/* Show unique customer names */}
                    {[...new Set(dayEvents.map(e => e.customer))].slice(0, 2).map((name, i) => (
                      <div key={i} className="calendar-event-preview">
                        {name}
                      </div>
                    ))}
                    {[...new Set(dayEvents.map(e => e.customer))].length > 2 && (
                      <div className="calendar-event-preview">+{[...new Set(dayEvents.map(e => e.customer))].length - 2} more</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Selected Day Events Modal */}
        {selectedDay && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setSelectedDay(null)}
          >
            <div
              style={{
                background: colors.cardBg,
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '500px',
                width: '90%',
                maxHeight: '80vh',
                overflow: 'auto'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px'
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: '600', color: colors.text }}>
                  {monthNames[currentMonth.getMonth()]} {selectedDay}, {currentMonth.getFullYear()}
                </h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      window.open('https://jti-ts3.netlify.app/', '_blank');
                    }}
                    style={{
                      padding: '6px 10px',
                      fontSize: '12px',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Plus size={14} /> Add
                  </button>
                  <button
                    onClick={() => setSelectedDay(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: colors.textSecondary
                    }}
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {dayEvents.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '24px',
                  color: colors.textSecondary
                }}>
                  <p style={{ marginBottom: '12px' }}>No entries for this day</p>
                  <button
                    onClick={() => {
                      window.open('https://jti-ts3.netlify.app/', '_blank');
                    }}
                    style={{
                      padding: '8px 16px',
                      fontSize: '13px',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Plus size={16} /> Add Entry
                  </button>
                </div>
              ) : (
                dayEvents.map((event, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '12px',
                      background: darkMode ? '#374151' : '#f3f4f6',
                      borderRadius: '8px',
                      marginBottom: '8px',
                      borderLeft: `4px solid ${event.type === 'onsite' ? '#f59e0b' : '#10b981'}`
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '4px'
                    }}>
                      <div style={{
                        fontWeight: '600',
                        color: colors.text
                      }}>
                        {event.customer}
                      </div>
                      {event.type === 'onsite' && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {event.status && (
                            <span style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              background: event.status.toLowerCase() === 'offline' ? '#fee2e2' : '#d1fae5',
                              color: event.status.toLowerCase() === 'offline' ? '#991b1b' : '#065f46',
                              borderRadius: '4px',
                              fontWeight: '500'
                            }}>
                              {event.status}
                            </span>
                          )}
                          {event.repairStatus && (
                            <span style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              background: '#dbeafe',
                              color: '#1e40af',
                              borderRadius: '4px',
                              fontWeight: '500'
                            }}>
                              {event.repairStatus}
                            </span>
                          )}
                          {!event.status && !event.repairStatus && (
                            <span style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              background: '#fef3c7',
                              color: '#92400e',
                              borderRadius: '4px',
                              fontWeight: '500'
                            }}>
                              Onsite
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {event.visitName && (
                      <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>
                        {event.visitName}
                      </div>
                    )}
                    {event.hours > 0 && (
                      <div style={{ fontSize: '12px', color: colors.textSecondary }}>
                        {event.hours} hours
                      </div>
                    )}
                    {event.serviceWork && (
                      <div style={{
                        fontSize: '12px',
                        color: colors.textSecondary,
                        marginTop: '8px',
                        padding: '8px',
                        background: darkMode ? '#1f2937' : 'white',
                        borderRadius: '4px'
                      }}>
                        {event.serviceWork}
                      </div>
                    )}
                    {event.type !== 'onsite' && (
                      <div style={{
                        display: 'flex',
                        gap: '8px',
                        marginTop: '8px'
                      }}>
                        <button
                          onClick={() => {
                            if (event.id) {
                              window.open(`https://jti-ts3.netlify.app/?id=${event.id}`, '_blank');
                            }
                          }}
                          style={{
                            padding: '4px 8px',
                            fontSize: '11px',
                            background: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Edit2 size={12} /> Edit
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(event)}
                          style={{
                            padding: '4px 8px',
                            fontSize: '11px',
                            background: '#ef4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    )}
                    {event.type === 'onsite' && (
                      <div style={{
                        marginTop: '8px',
                        fontSize: '11px',
                        color: colors.textSecondary
                      }}>
                        From Shearers Head History
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Delete Confirmation Dialog */}
              {deleteConfirm && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0,0,0,0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1001
                }}>
                  <div style={{
                    background: colors.cardBg,
                    borderRadius: '12px',
                    padding: '24px',
                    maxWidth: '400px',
                    width: '90%'
                  }}>
                    <h4 style={{ fontSize: '16px', fontWeight: '600', color: colors.text, marginBottom: '12px' }}>
                      Delete Entry?
                    </h4>
                    <p style={{ fontSize: '14px', color: colors.textSecondary, marginBottom: '16px' }}>
                      Are you sure you want to delete this entry for <strong>{deleteConfirm.customer}</strong> on {deleteConfirm.date}?
                    </p>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        style={{
                          padding: '8px 16px',
                          fontSize: '13px',
                          background: colors.cardBg,
                          color: colors.text,
                          border: `1px solid ${colors.border}`,
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                        disabled={deleting}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDelete(deleteConfirm)}
                        style={{
                          padding: '8px 16px',
                          fontSize: '13px',
                          background: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          opacity: deleting ? 0.7 : 1
                        }}
                        disabled={deleting}
                      >
                        {deleting ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Search Results Component
  const SearchResults = ({ results, loading }) => {
    const [collapsedSections, setCollapsedSections] = useState({
      jobs: false,
      issues: false,
      timesheets: false,
      headHistory: false
    });

    const toggleSection = (section) => {
      setCollapsedSections(prev => ({
        ...prev,
        [section]: !prev[section]
      }));
    };

    if (loading) {
      return (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '40px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          textAlign: 'center',
          color: '#6b7280'
        }}>
          Searching...
        </div>
      );
    }

    if (!results) return null;

    const formatDate = (date) => {
      if (!date) return 'N/A';
      const d = date?.toDate?.() || new Date(date);
      return d.toLocaleDateString();
    };

    const formatCurrency = (amount) => {
      if (!amount) return 'N/A';
      return `$${parseFloat(amount).toLocaleString()}`;
    };

    return (
      <div style={{ marginBottom: '32px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            color: '#111827',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Search size={24} />
            Search Results for "{results.searchTerm}"
          </h2>
          <span style={{ fontSize: '14px', color: '#6b7280' }}>
            {results.totalResults} result{results.totalResults !== 1 ? 's' : ''} found
          </span>
        </div>

        {results.totalResults === 0 ? (
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '40px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            textAlign: 'center',
            color: '#6b7280'
          }}>
            No results found for "{results.searchTerm}"
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Jobs Results */}
            {results.jobs.length > 0 && (
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleSection('jobs')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#3b82f6',
                    marginBottom: collapsedSections.jobs ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <FileText size={20} />
                  Jobs ({results.jobs.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedSections.jobs ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedSections.jobs && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {results.jobs.map((job, index) => (
                    <div
                      key={job.id || index}
                      onClick={() => {
                        setSelectedCustomer(job.customer || job.customerName);
                        setSearchResults(null);
                        setSearchTerm('');
                      }}
                      style={{
                        padding: '16px',
                        background: '#f9fafb',
                        borderRadius: '8px',
                        borderLeft: '4px solid #3b82f6',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#f9fafb'}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>
                            {job.customer || job.customerName || 'Unknown Customer'}
                          </div>
                          {(job.sr || job.invoiceNumber || job.serviceReportNumber || job.reportNumber) && (
                            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                              SR #: {job.sr || job.invoiceNumber || job.serviceReportNumber || job.reportNumber}
                            </div>
                          )}
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: isPaid(job.paid) ? '#10b981' : '#f59e0b'
                        }}>
                          {isPaid(job.paid) ? <CheckCircle size={16} /> : <Clock size={16} />}
                          <span style={{ fontSize: '12px', fontWeight: '500' }}>
                            {isPaid(job.paid) ? 'Paid' : 'Unpaid'}
                          </span>
                        </div>
                      </div>

                      {/* Matched Fields with Highlighting */}
                      {job.matchedFields && job.matchedFields.length > 0 && (
                        <div style={{
                          background: '#fefce8',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          marginBottom: '8px',
                          fontSize: '12px'
                        }}>
                          <div style={{ fontWeight: '600', color: '#854d0e', marginBottom: '4px' }}>
                            Matches found:
                          </div>
                          {job.matchedFields.slice(0, 5).map((match, i) => (
                            <div key={i} style={{ color: '#713f12', marginBottom: '2px' }}>
                              <span style={{ color: '#a16207' }}>{match.field}: </span>
                              <HighlightText text={match.value} searchTerm={results.searchTerm} />
                            </div>
                          ))}
                          {job.matchedFields.length > 5 && (
                            <div style={{ color: '#a16207', fontStyle: 'italic' }}>
                              +{job.matchedFields.length - 5} more matches
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '8px' }}>
                        Click to view customer details
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Issues Results */}
            {results.issues.length > 0 && (
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleSection('issues')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#ef4444',
                    marginBottom: collapsedSections.issues ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <AlertTriangle size={20} />
                  Issues / Downtime ({results.issues.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedSections.issues ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedSections.issues && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {results.issues.map((issue, index) => (
                    <div
                      key={issue.id || index}
                      onClick={() => {
                        // Open weigher app with deep link
                        if (issue.visitId) {
                          if (confirm(`Open "${issue.customer || 'this issue'}" in Weigher Issues app?`)) {
                            const lineParam = issue.line ? `&line=${encodeURIComponent(issue.line)}` : '';
                            const headParam = issue.headName ? `&head=${encodeURIComponent(issue.headName)}` : '';
                            window.open(`https://jti-ccwlog.netlify.app/?id=${issue.visitId}${lineParam}${headParam}`, '_blank');
                          }
                        } else {
                          // Fallback to customer view if no ID
                          setSelectedCustomer(issue.customer);
                          setSearchResults(null);
                          setSearchTerm('');
                        }
                      }}
                      style={{
                        padding: '16px',
                        background: '#f9fafb',
                        borderRadius: '8px',
                        borderLeft: '4px solid #ef4444',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#f9fafb'}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>
                            {issue.customer || 'Unknown Customer'}
                          </div>
                          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                            {issue.line} • {issue.headName || 'Head'}
                          </div>
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? '#10b981' : '#ef4444',
                          marginLeft: '12px'
                        }}>
                          {issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                          <span style={{ fontSize: '12px', fontWeight: '500' }}>
                            {issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? 'Fixed' : 'Not Fixed'}
                          </span>
                        </div>
                      </div>

                      {/* Matched Fields with Highlighting */}
                      {issue.matchedFields && issue.matchedFields.length > 0 && (
                        <div style={{
                          background: '#fefce8',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          marginBottom: '8px',
                          fontSize: '12px'
                        }}>
                          <div style={{ fontWeight: '600', color: '#854d0e', marginBottom: '4px' }}>
                            Matches found:
                          </div>
                          {issue.matchedFields.slice(0, 5).map((match, i) => (
                            <div key={i} style={{ color: '#713f12', marginBottom: '2px' }}>
                              <span style={{ color: '#a16207' }}>{match.field}: </span>
                              <HighlightText text={match.value} searchTerm={results.searchTerm} />
                            </div>
                          ))}
                          {issue.matchedFields.length > 5 && (
                            <div style={{ color: '#a16207', fontStyle: 'italic' }}>
                              +{issue.matchedFields.length - 5} more matches
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '8px' }}>
                        Click to open in Weigher Issues app
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Timesheets Results */}
            {results.timesheets.length > 0 && (
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleSection('timesheets')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#10b981',
                    marginBottom: collapsedSections.timesheets ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <Clock size={20} />
                  Timesheets ({results.timesheets.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedSections.timesheets ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedSections.timesheets && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {results.timesheets.map((timesheet, index) => (
                    <div
                      key={timesheet.id || index}
                      onClick={() => {
                        // Open timesheet app with deep link
                        if (timesheet.id) {
                          if (confirm(`Open "${timesheet.visitName || 'this visit'}" in Timesheet app?`)) {
                            window.open(`https://jti-ts3.netlify.app/?id=${timesheet.id}`, '_blank');
                          }
                        } else {
                          // Fallback to customer view if no ID
                          setSelectedCustomer(timesheet.customer || timesheet.visitName);
                          setSearchResults(null);
                          setSearchTerm('');
                        }
                      }}
                      style={{
                        padding: '16px',
                        background: '#f9fafb',
                        borderRadius: '8px',
                        borderLeft: '4px solid #10b981',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#f9fafb'}
                    >
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>
                          {timesheet.customer || timesheet.visitName || 'Unknown'}
                        </div>
                        {timesheet.visitName && (
                          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                            Visit: {timesheet.visitName}
                          </div>
                        )}
                      </div>

                      {/* Matched Fields with Highlighting */}
                      {timesheet.matchedFields && timesheet.matchedFields.length > 0 && (
                        <div style={{
                          background: '#fefce8',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          marginBottom: '8px',
                          fontSize: '12px'
                        }}>
                          <div style={{ fontWeight: '600', color: '#854d0e', marginBottom: '4px' }}>
                            Matches found:
                          </div>
                          {timesheet.matchedFields.slice(0, 5).map((match, i) => (
                            <div key={i} style={{ color: '#713f12', marginBottom: '2px' }}>
                              <span style={{ color: '#a16207' }}>{match.field}: </span>
                              <HighlightText text={match.value} searchTerm={results.searchTerm} />
                            </div>
                          ))}
                          {timesheet.matchedFields.length > 5 && (
                            <div style={{ color: '#a16207', fontStyle: 'italic' }}>
                              +{timesheet.matchedFields.length - 5} more matches
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <ExternalLink size={12} />
                        Click to open in Timesheet app
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Head History Results */}
            {results.headHistory && results.headHistory.length > 0 && (
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleSection('headHistory')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#8b5cf6',
                    marginBottom: collapsedSections.headHistory ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <Settings size={20} />
                  Head History ({results.headHistory.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedSections.headHistory ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedSections.headHistory && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {results.headHistory.map((entry, index) => (
                    <div
                      key={entry.path || index}
                      style={{
                        padding: '16px',
                        background: '#f9fafb',
                        borderRadius: '8px',
                        borderLeft: `4px solid ${entry.status?.toLowerCase() === 'offline' ? '#ef4444' : '#8b5cf6'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#f9fafb'}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>
                            {entry.customer}
                          </div>
                          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                            {entry.line ? `Line ${entry.line}` : 'Head History'} {entry.data?.head ? `• ${entry.data.head}` : ''}
                          </div>
                          {entry.date && (
                            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                              Date: {entry.date}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                          {entry.status && (
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              color: entry.status.toLowerCase() === 'offline' ? '#ef4444' : '#10b981'
                            }}>
                              {entry.status.toLowerCase() === 'offline' ? <XCircle size={16} /> : <CheckCircle size={16} />}
                              <span style={{ fontSize: '12px', fontWeight: '500' }}>
                                {entry.status}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Repair Status */}
                      {entry.repairStatus && (
                        <div style={{
                          fontSize: '12px',
                          color: entry.repairStatus.toLowerCase() === 'fixed' ? '#92400e' : '#991b1b',
                          marginBottom: '8px',
                          padding: '4px 8px',
                          background: entry.repairStatus.toLowerCase() === 'fixed' ? '#fef3c7' : '#fee2e2',
                          borderRadius: '4px',
                          display: 'inline-block'
                        }}>
                          Repair: {entry.repairStatus}
                        </div>
                      )}

                      {/* Error */}
                      {entry.error && (
                        <div style={{
                          fontSize: '12px',
                          color: '#dc2626',
                          marginBottom: '8px',
                          padding: '8px',
                          background: '#fee2e2',
                          borderRadius: '4px'
                        }}>
                          <strong>Error:</strong> {entry.error}
                        </div>
                      )}

                      {/* Notes */}
                      {entry.data?.notes && (
                        <div style={{
                          fontSize: '12px',
                          color: '#374151',
                          marginBottom: '8px',
                          padding: '8px',
                          background: 'white',
                          borderRadius: '4px',
                          border: '1px solid #e5e7eb'
                        }}>
                          <strong>Notes:</strong> {entry.data.notes}
                        </div>
                      )}

                      {/* Machine Notes */}
                      {entry.data?.machineNotes && (
                        <div style={{
                          fontSize: '12px',
                          color: '#374151',
                          marginBottom: '8px',
                          padding: '8px',
                          background: 'white',
                          borderRadius: '4px',
                          border: '1px solid #e5e7eb'
                        }}>
                          <strong>Machine Notes:</strong> {entry.data.machineNotes}
                        </div>
                      )}

                      {/* Matched Fields with Highlighting */}
                      {entry.matchedFields && entry.matchedFields.length > 0 && (
                        <div style={{
                          background: '#fefce8',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          fontSize: '12px'
                        }}>
                          <div style={{ fontWeight: '600', color: '#854d0e', marginBottom: '4px' }}>
                            Matches found:
                          </div>
                          {entry.matchedFields.slice(0, 5).map((match, i) => (
                            <div key={i} style={{ color: '#713f12', marginBottom: '2px' }}>
                              <span style={{ color: '#a16207' }}>{match.field}: </span>
                              <HighlightText text={match.value} searchTerm={results.searchTerm} />
                            </div>
                          ))}
                          {entry.matchedFields.length > 5 && (
                            <div style={{ color: '#a16207', fontStyle: 'italic' }}>
                              +{entry.matchedFields.length - 5} more matches
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Customer Detail View Component
  const CustomerDetailView = ({ data, customerName, loading, onClear }) => {
    const [collapsedCustomerSections, setCollapsedCustomerSections] = useState({
      jobs: false,
      issues: false,
      timesheets: false
    });

    const toggleCustomerSection = (section) => {
      setCollapsedCustomerSections(prev => ({
        ...prev,
        [section]: !prev[section]
      }));
    };

    if (loading) {
      return (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '40px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          textAlign: 'center',
          color: '#6b7280'
        }}>
          Loading customer data...
        </div>
      );
    }

    if (!data) return null;

    const formatDate = (date) => {
      if (!date) return 'N/A';
      const d = date?.toDate?.() || new Date(date);
      return d.toLocaleDateString();
    };

    const formatCurrency = (amount) => {
      if (!amount) return 'N/A';
      return `$${parseFloat(amount).toLocaleString()}`;
    };

    return (
      <div style={{ marginBottom: '32px' }}>
        {/* Customer Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: '600',
            color: '#111827',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Users size={28} />
            {customerName}
          </h2>
          <button
            onClick={onClear}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              background: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <X size={16} />
            Clear Selection
          </button>
        </div>

        {/* Customer Summary Stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '16px',
          marginBottom: '24px'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Total Jobs</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#3b82f6' }}>{data.totalJobs}</div>
          </div>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Total Income</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>{formatCurrency(data.totalIncome)}</div>
          </div>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Paid</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>{formatCurrency(data.paidIncome)}</div>
          </div>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Unpaid</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>{formatCurrency(data.unpaidIncome)}</div>
          </div>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Issues</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#ef4444' }}>{data.totalIssues}</div>
          </div>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Timesheets</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#8b5cf6' }}>{data.totalTimesheets}</div>
          </div>
        </div>

        {data.totalJobs === 0 && data.totalIssues === 0 && data.totalTimesheets === 0 ? (
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '40px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            textAlign: 'center',
            color: '#6b7280'
          }}>
            No data found for this customer
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Jobs */}
            {data.jobs.length > 0 && (
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleCustomerSection('jobs')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#3b82f6',
                    marginBottom: collapsedCustomerSections.jobs ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <FileText size={20} />
                  Jobs ({data.jobs.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedCustomerSections.jobs ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedCustomerSections.jobs && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {data.jobs.map((job, index) => (
                    <div key={job.id || index} style={{
                      padding: '16px',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      borderLeft: '4px solid #3b82f6'
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>
                            {job.customer || job.customerName || 'Unknown Customer'}
                          </div>
                          {(job.sr || job.invoiceNumber) && (
                            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                              SR #: {job.sr || job.invoiceNumber}
                            </div>
                          )}
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: isPaid(job.paid) ? '#10b981' : '#f59e0b'
                        }}>
                          {isPaid(job.paid) ? <CheckCircle size={16} /> : <Clock size={16} />}
                          <span style={{ fontSize: '12px', fontWeight: '500' }}>
                            {isPaid(job.paid) ? 'Paid' : 'Unpaid'}
                          </span>
                        </div>
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '8px',
                        fontSize: '13px'
                      }}>
                        {job.quote && (
                          <div>
                            <span style={{ color: '#6b7280' }}>Quote: </span>
                            <span style={{ color: '#111827', fontWeight: '600' }}>{formatCurrency(job.quote)}</span>
                          </div>
                        )}
                        {job.actual && (
                          <div>
                            <span style={{ color: '#6b7280' }}>Actual: </span>
                            <span style={{ color: '#10b981', fontWeight: '600' }}>{formatCurrency(job.actual)}</span>
                          </div>
                        )}
                        {job.date && (
                          <div>
                            <span style={{ color: '#6b7280' }}>Date: </span>
                            <span style={{ color: '#111827' }}>{job.date}</span>
                          </div>
                        )}
                        {job.year && (
                          <div>
                            <span style={{ color: '#6b7280' }}>Year: </span>
                            <span style={{ color: '#111827' }}>{job.year}</span>
                          </div>
                        )}
                        {job.customerInfo && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ color: '#6b7280' }}>Info: </span>
                            <span style={{ color: '#111827' }}>{job.customerInfo}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Issues */}
            {data.issues.length > 0 && (
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleCustomerSection('issues')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#ef4444',
                    marginBottom: collapsedCustomerSections.issues ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <AlertTriangle size={20} />
                  Issues / Downtime ({data.issues.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedCustomerSections.issues ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedCustomerSections.issues && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {data.issues.map((issue, index) => (
                    <div key={issue.id || index} style={{
                      padding: '16px',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      borderLeft: '4px solid #ef4444'
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>
                            {issue.line} • {issue.headName || 'Head'}
                          </div>
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? '#10b981' : '#ef4444',
                          marginLeft: '12px'
                        }}>
                          {issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                          <span style={{ fontSize: '12px', fontWeight: '500' }}>
                            {issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? 'Fixed' : 'Not Fixed'}
                          </span>
                        </div>
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '8px',
                        fontSize: '13px'
                      }}>
                        <div>
                          <span style={{ color: '#6b7280' }}>Date: </span>
                          <span style={{ color: '#111827' }}>{issue.date || 'N/A'}</span>
                        </div>
                        <div>
                          <span style={{ color: '#6b7280' }}>Visit: </span>
                          <span style={{ color: '#111827' }}>{issue.visitId || 'N/A'}</span>
                        </div>
                        {issue.error && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ color: '#6b7280' }}>Error: </span>
                            <span style={{ color: '#ef4444', fontWeight: '500' }}>{issue.error}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Timesheets */}
            {data.timesheets.length > 0 && (
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleCustomerSection('timesheets')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#10b981',
                    marginBottom: collapsedCustomerSections.timesheets ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <Clock size={20} />
                  Timesheets ({data.timesheets.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedCustomerSections.timesheets ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedCustomerSections.timesheets && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {data.timesheets.map((timesheet, index) => (
                    <div key={timesheet.id || index} style={{
                      padding: '16px',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      borderLeft: '4px solid #10b981'
                    }}>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>
                          {timesheet.customer || timesheet.visitName || 'Unknown'}
                        </div>
                        {timesheet.visitName && (
                          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                            Visit: {timesheet.visitName}
                          </div>
                        )}
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '8px',
                        fontSize: '13px'
                      }}>
                        <div>
                          <span style={{ color: '#6b7280' }}>Date: </span>
                          <span style={{ fontWeight: '500', color: '#111827' }}>
                            {formatDate(timesheet.timestamp || timesheet.date)}
                          </span>
                        </div>
                        {timesheet.invoiceInfo?.invoiceNumber && (
                          <div>
                            <span style={{ color: '#6b7280' }}>Invoice #: </span>
                            <span style={{ fontWeight: '500', color: '#111827' }}>
                              {timesheet.invoiceInfo.invoiceNumber}
                            </span>
                          </div>
                        )}
                        {timesheet.invoiceInfo?.amount && (
                          <div>
                            <span style={{ color: '#6b7280' }}>Amount: </span>
                            <span style={{ fontWeight: '500', color: '#111827' }}>
                              {formatCurrency(timesheet.invoiceInfo.amount)}
                            </span>
                          </div>
                        )}
                        {timesheet.serviceReportData && Object.keys(timesheet.serviceReportData).length > 0 && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ color: '#6b7280', fontWeight: '500' }}>Service Report: </span>
                            <div style={{ marginTop: '8px' }}>
                              {Object.entries(timesheet.serviceReportData).map(([date, description]) => (
                                <div key={date} style={{
                                  marginBottom: '8px',
                                  padding: '8px',
                                  background: '#e5e7eb',
                                  borderRadius: '4px'
                                }}>
                                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                                    {date}
                                  </div>
                                  <div style={{ color: '#111827', lineHeight: '1.4' }}>
                                    {description}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

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

  return (
    <div style={{ minHeight: '100vh', background: colors.bg, transition: 'background 0.3s' }}>
      {/* Mobile-friendly styles */}
      <style>{`
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
          <div className="header-controls" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
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
                type="text"
                placeholder="Search customer or report #..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
                style={{
                  padding: '8px 36px 8px 40px',
                  borderRadius: '8px',
                  border: `1px solid ${colors.border}`,
                  fontSize: '14px',
                  width: '280px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  background: colors.cardBg,
                  color: colors.text
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = colors.border}
              />
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
                  minWidth: '180px',
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
                  right: 0,
                  marginTop: '4px',
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  zIndex: 200
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
            {/* Calendar Toggle - prominent position for mobile */}
            <button
              onClick={toggleCalendar}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: `1px solid ${showCalendar ? '#3b82f6' : colors.border}`,
                background: showCalendar ? '#3b82f6' : colors.cardBg,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '14px',
                fontWeight: '500',
                color: showCalendar ? 'white' : colors.text
              }}
            >
              <Calendar size={16} />
              Calendar
            </button>
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
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content" style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: '32px'
      }}>
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
                onClick={() => setShowCalendar(false)}
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
                <CalendarView
                  events={calendarEvents}
                  currentMonth={calendarMonth}
                  setCurrentMonth={setCalendarMonth}
                  colors={colors}
                  onRefresh={loadCalendarEvents}
                />
              )}
            </div>
          </section>
        )}

        {/* Search Results */}
        {(searchResults || searchLoading) && (
          <SearchResults results={searchResults} loading={searchLoading} />
        )}

        {/* Customer Detail View */}
        {(selectedCustomer || customerLoading) && !searchResults && (
          <CustomerDetailView
            data={customerData}
            customerName={selectedCustomer}
            loading={customerLoading}
            onClear={clearCustomerSelection}
          />
        )}

        {/* Filters and Chart - Hide when searching, viewing customer, or calendar */}
        {!searchResults && !selectedCustomer && !showCalendar && (
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
                      const actual = parseFloat(job.actual || 0);
                      const quote = parseFloat(job.quote || 0);
                      const amount = actual > 0 ? actual : quote;
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
        {!searchResults && !selectedCustomer && !showCalendar && <div className="stats-grid" style={{
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
                    <div key={job.sr || idx} style={{ marginBottom: '2px' }}>
                      {job.sr} - {job.customer || job.customerName || 'Unknown'}
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
        {!searchResults && !selectedCustomer && !showCalendar && <section style={{ marginBottom: '32px' }}>
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
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        </section>}

        {/* Recent Activity - Hide when searching, viewing customer, or calendar */}
        {!searchResults && !selectedCustomer && !showCalendar && <section>
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

import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { getFirestore, collection, doc, getDocs, setDoc, deleteDoc, getDoc, collectionGroup } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { app } from './firebaseConfig';
import { matchCustomer } from '@shared/utils/customerMatch.js';
import LoginScreen from './LoginScreen';
import initialData from './data/quoteData.json';

const STORAGE_KEY = 'serviceQuoteData';
const db = getFirestore(app);
const auth = getAuth(app);
const QUOTES_COLLECTION = 'service_quotes';
const CUSTOMERS_COLLECTION = 'service_quotes_customers';

// Customer Management Modal Component (outside App to prevent re-render issues)
function CustomerModal({
  darkMode,
  customers,
  editingCustomer,
  setEditingCustomer,
  isLoading,
  setIsLoading,
  loadCustomers,
  extractCustomersFromQuotes,
  showStatus,
  statusMessage,
  onClose
}) {
  const cardClass = darkMode ? 'bg-slate-800' : 'bg-white';
  const inputClass = darkMode
    ? 'bg-slate-700 border-slate-600 text-gray-100 placeholder-gray-400'
    : 'bg-white border-gray-300 text-gray-900';

  const handleSaveCustomer = async () => {
    if (!editingCustomer.name.trim()) {
      alert('Please enter a customer name');
      return;
    }
    setIsLoading(true);
    try {
      const customerKey = editingCustomer.name.replace(/[.#$[\]/]/g, '_').replace(/\s+/g, '_').toLowerCase();
      await setDoc(doc(db, CUSTOMERS_COLLECTION, customerKey), {
        name: editingCustomer.name.trim(),
        city: editingCustomer.city.trim(),
        state: editingCustomer.state.trim()
      });
      await loadCustomers();
      setEditingCustomer({ name: '', city: '', state: '' });
      showStatus('Customer saved!');
    } catch (error) {
      console.error('Error saving customer:', error);
      showStatus('Error saving customer');
    }
    setIsLoading(false);
  };

  const handleDeleteCustomer = async (customerName) => {
    if (!window.confirm(`Delete customer "${customerName}"?`)) return;
    setIsLoading(true);
    try {
      const customerKey = customerName.replace(/[.#$[\]/]/g, '_').replace(/\s+/g, '_').toLowerCase();
      await deleteDoc(doc(db, CUSTOMERS_COLLECTION, customerKey));
      await loadCustomers();
      showStatus('Customer deleted!');
    } catch (error) {
      console.error('Error deleting customer:', error);
      showStatus('Error deleting');
    }
    setIsLoading(false);
  };

  const handleEditCustomer = (customer) => {
    setEditingCustomer({
      name: customer.name,
      city: customer.city || '',
      state: customer.state || ''
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className={`${cardClass} max-w-lg w-full max-h-[90vh] overflow-auto rounded-lg shadow-2xl`}>
        {/* Header */}
        <div className="sticky top-0 bg-cyan-600 p-4 flex justify-between items-center">
          <h2 className="text-white font-bold text-lg">👥 Manage Customers</h2>
          <button
            onClick={onClose}
            className="text-white hover:bg-cyan-700 px-3 py-1 rounded"
          >
            ✕ Close
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Add/Edit Customer Form */}
          <div className={`p-4 rounded-lg ${darkMode ? 'bg-slate-700' : 'bg-gray-100'}`}>
            <h3 className="font-semibold mb-3">{editingCustomer.name ? '✏️ Edit Customer' : '➕ Add New Customer'}</h3>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Customer Name *"
                value={editingCustomer.name}
                onChange={(e) => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                className={`w-full p-2 rounded border ${inputClass}`}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="City"
                  value={editingCustomer.city}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, city: e.target.value })}
                  className={`w-full p-2 rounded border ${inputClass}`}
                />
                <input
                  type="text"
                  placeholder="State"
                  value={editingCustomer.state}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, state: e.target.value })}
                  className={`w-full p-2 rounded border ${inputClass}`}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveCustomer}
                  disabled={isLoading}
                  className="flex-1 py-2 bg-cyan-600 text-white rounded font-medium hover:bg-cyan-700 disabled:opacity-50"
                >
                  💾 Save Customer
                </button>
                {editingCustomer.name && (
                  <button
                    onClick={() => setEditingCustomer({ name: '', city: '', state: '' })}
                    className="px-4 py-2 bg-gray-500 text-white rounded"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Extract from Quotes */}
          <button
            onClick={extractCustomersFromQuotes}
            disabled={isLoading}
            className="w-full py-2 bg-yellow-500 text-white rounded font-medium hover:bg-yellow-600 disabled:opacity-50"
          >
            🔄 Extract Customers from Existing Quotes
          </button>

          {/* Customer List */}
          <div>
            <h3 className="font-semibold mb-2">📋 Customer List ({customers.length})</h3>
            {customers.length === 0 ? (
              <p className="text-gray-500 italic text-sm">No customers yet. Add one above or extract from quotes.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {customers.map((c, i) => (
                  <div key={i} className={`p-3 rounded flex justify-between items-center ${darkMode ? 'bg-slate-700' : 'bg-gray-100'}`}>
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-sm opacity-70">{c.city}{c.city && c.state ? ', ' : ''}{c.state}</div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleEditCustomer(c)}
                        className="px-2 py-1 bg-blue-500 text-white rounded text-sm"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDeleteCustomer(c.name)}
                        className="px-2 py-1 bg-red-500 text-white rounded text-sm"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {statusMessage && (
          <div className="p-3 text-center bg-green-500 text-white font-medium">{statusMessage}</div>
        )}
      </div>
    </div>
  );
}

// Quote Management Modal Component
function QuoteManagementModal({
  darkMode,
  savedQuotes,
  isLoading,
  setIsLoading,
  loadFromCloud,
  loadSavedQuotes,
  showStatus,
  statusMessage,
  onClose
}) {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [filterCity, setFilterCity] = React.useState('');
  const [filterState, setFilterState] = React.useState('');
  const [sortBy, setSortBy] = React.useState('date-desc');
  const [expandedQuote, setExpandedQuote] = React.useState(null);

  const cardClass = darkMode ? 'bg-slate-800' : 'bg-white';
  const inputClass = darkMode
    ? 'bg-slate-700 border-slate-600 text-gray-100 placeholder-gray-400'
    : 'bg-white border-gray-300 text-gray-900';

  // Get unique cities and states from quotes
  const cities = [...new Set(savedQuotes.map(q => q.city).filter(Boolean))].sort();
  const states = [...new Set(savedQuotes.map(q => q.state).filter(Boolean))].sort();

  // Filter and sort quotes
  const filteredQuotes = savedQuotes
    .filter(q => {
      const matchesSearch = !searchTerm ||
        q.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.quoteNumber?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCity = !filterCity || q.city === filterCity;
      const matchesState = !filterState || q.state === filterState;
      return matchesSearch && matchesCity && matchesState;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return new Date(b.dateOfQuote || 0) - new Date(a.dateOfQuote || 0);
        case 'date-asc':
          return new Date(a.dateOfQuote || 0) - new Date(b.dateOfQuote || 0);
        case 'customer':
          return (a.customerName || '').localeCompare(b.customerName || '');
        case 'quote-num':
          return (a.quoteNumber || '').localeCompare(b.quoteNumber || '');
        default:
          return 0;
      }
    });

  const handleLoadQuote = (quoteId) => {
    loadFromCloud(quoteId);
    onClose();
  };

  const handleDeleteQuote = async (quoteId, quoteName) => {
    if (!window.confirm(`Delete quote "${quoteName}"?`)) return;
    setIsLoading(true);
    try {
      // Handle nested path format: customerId/quotes/quoteDocId
      if (quoteId.includes('/quotes/')) {
        const parts = quoteId.split('/quotes/');
        const customerId = parts[0];
        const quoteDocId = parts[1];
        await deleteDoc(doc(db, QUOTES_COLLECTION, customerId, 'quotes', quoteDocId));
      } else {
        // Fallback for old format
        await deleteDoc(doc(db, QUOTES_COLLECTION, quoteId));
      }
      await loadSavedQuotes();
      showStatus('Quote deleted!');
    } catch (error) {
      console.error('Error deleting quote:', error);
      showStatus('Error deleting quote');
    }
    setIsLoading(false);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterCity('');
    setFilterState('');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className={`${cardClass} max-w-4xl w-full max-h-[90vh] overflow-auto rounded-lg shadow-2xl`}>
        {/* Header */}
        <div className="sticky top-0 bg-cyan-600 p-4 flex justify-between items-center z-10">
          <h2 className="text-white font-bold text-lg">📁 Quote Management</h2>
          <button
            onClick={onClose}
            className="text-white hover:bg-cyan-700 px-3 py-1 rounded"
          >
            ✕ Close
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Search and Filters */}
          <div className={`p-4 rounded-lg ${darkMode ? 'bg-slate-700' : 'bg-gray-100'}`}>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">🔍 Search</label>
                <input
                  type="text"
                  placeholder="Search by customer or quote #..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={`w-full p-2 rounded border ${inputClass}`}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">🏙️ City</label>
                <select
                  value={filterCity}
                  onChange={(e) => setFilterCity(e.target.value)}
                  className={`w-full p-2 rounded border ${inputClass}`}
                >
                  <option value="">All Cities</option>
                  {cities.map(city => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">📍 State</label>
                <select
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  className={`w-full p-2 rounded border ${inputClass}`}
                >
                  <option value="">All States</option>
                  {states.map(state => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-between items-center mt-3">
              <div className="flex gap-2 items-center">
                <label className="text-sm">Sort:</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className={`p-2 rounded border ${inputClass}`}
                >
                  <option value="date-desc">Newest First</option>
                  <option value="date-asc">Oldest First</option>
                  <option value="customer">Customer Name</option>
                  <option value="quote-num">Quote Number</option>
                </select>
              </div>
              <button
                onClick={clearFilters}
                className="px-3 py-1 bg-gray-500 text-white rounded text-sm"
              >
                Clear Filters
              </button>
            </div>
          </div>

          {/* Results Count */}
          <div className="text-sm opacity-70">
            Showing {filteredQuotes.length} of {savedQuotes.length} quotes
          </div>

          {/* Quote List */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredQuotes.length === 0 ? (
              <p className="text-center text-gray-500 italic py-8">No quotes found matching your criteria.</p>
            ) : (
              filteredQuotes.map((q) => (
                <div key={q.id} className={`p-3 rounded-lg ${darkMode ? 'bg-slate-700' : 'bg-gray-100'}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-cyan-500">{q.quoteNumber || 'No Quote #'}</span>
                        <span className="text-sm opacity-70">|</span>
                        <span className="font-medium">{q.customerName || 'Unknown Customer'}</span>
                      </div>
                      <div className="text-sm opacity-70 mt-1">
                        {q.city && q.state ? `${q.city}, ${q.state}` : q.city || q.state || 'No location'}
                        {q.dateOfQuote && ` • ${q.dateOfQuote}`}
                      </div>
                      {expandedQuote === q.id && q.total && (
                        <div className="mt-2 text-sm">
                          <span className="font-medium">Total: </span>
                          <span className="text-cyan-500 font-bold">${parseFloat(q.total).toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 ml-2">
                      <button
                        onClick={() => setExpandedQuote(expandedQuote === q.id ? null : q.id)}
                        className="px-2 py-1 bg-gray-500 text-white rounded text-sm"
                        title="Toggle details"
                      >
                        {expandedQuote === q.id ? '▲' : '▼'}
                      </button>
                      <button
                        onClick={() => handleLoadQuote(q.id)}
                        className="px-3 py-1 bg-cyan-600 text-white rounded text-sm"
                        title="Load this quote"
                      >
                        📂 Load
                      </button>
                      <button
                        onClick={() => handleDeleteQuote(q.id, q.quoteNumber || q.customerName)}
                        className="px-2 py-1 bg-red-500 text-white rounded text-sm"
                        title="Delete this quote"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {statusMessage && (
          <div className="p-3 text-center bg-green-500 text-white font-medium">{statusMessage}</div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  // Dark mode state
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('serviceQuoteDarkMode');
    return saved !== null ? JSON.parse(saved) : true;
  });

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Customer list from Firebase
  const [customers, setCustomers] = useState([]);
  const [savedQuotes, setSavedQuotes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Quote data
  const [data, setData] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const year = today.getFullYear();
    return {
      customerName: '',
      city: '',
      state: '',
      datesValue: '',
      dateOfQuoteValue: `${month}/${day}/${year}`,
      quoteNumberValue: '',
      srNumber: '',
      customerId: '',
      items: initialData.items.map(i => ({ ...i, quantity: '', cost: '' })),
      notes: ''
    };
  });

  // Travel calculator state
  const [milesPerDay, setMilesPerDay] = useState('');
  const [daysOnSite, setDaysOnSite] = useState('');
  const [jobType, setJobType] = useState('local');

  // View mode for services table
  const [viewMode, setViewMode] = useState('table');

  // PDF Preview modal
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  // Customer Management modal
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState({ name: '', city: '', state: '' });

  const { customerName, city, state, datesValue, dateOfQuoteValue, quoteNumberValue, srNumber, items, notes } = data;

  // Persist dark mode
  useEffect(() => {
    localStorage.setItem('serviceQuoteDarkMode', JSON.stringify(darkMode));
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Persist data
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  // Auth handlers
  const handleLogin = (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  };

  const handleLogout = () => {
    signOut(auth);
  };

  // Authenticate and load data on mount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setIsAuthenticated(true);
        loadCustomers();
        loadSavedQuotes();
      } else {
        setIsAuthenticated(false);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const showStatus = (msg) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(''), 2000);
  };

  const loadCustomers = async () => {
    try {
      const customerMap = {};

      // 1) Customers from the dedicated registry (manually added via "Save Customer" / extracted).
      //    Previously these never appeared in the dropdown because only service_quotes was read.
      const customersSnapshot = await getDocs(collection(db, CUSTOMERS_COLLECTION));
      customersSnapshot.forEach((docSnap) => {
        const c = docSnap.data();
        customerMap[docSnap.id] = {
          id: docSnap.id,
          name: c.name || c.customerName || docSnap.id,
          city: c.city || '',
          state: c.state || ''
        };
      });

      // 2) Customers derived from existing quotes (so anyone with a quote still shows up).
      const querySnapshot = await getDocs(collection(db, QUOTES_COLLECTION));
      for (const customerDoc of querySnapshot.docs) {
        const customerId = customerDoc.id;
        const customerData = customerDoc.data();

        // Try to get more details from the first quote
        const quotesSnapshot = await getDocs(collection(db, QUOTES_COLLECTION, customerId, 'quotes'));
        let city = '';
        let state = '';
        let name = customerData.customerName || customerId;

        if (quotesSnapshot.docs.length > 0) {
          const firstQuote = quotesSnapshot.docs[0].data();
          city = firstQuote.customerCity || firstQuote.city || '';
          state = firstQuote.customerState || firstQuote.state || '';
          name = firstQuote.customerName || customerData.customerName || customerId;
        }

        // Merge: keep an existing registry name, but let quote data fill in city/state.
        const existing = customerMap[customerId] || {};
        customerMap[customerId] = {
          id: customerId,
          name: existing.name || name,
          city: city || existing.city || '',
          state: state || existing.state || ''
        };
      }

      // 3) The canonical directory the dashboard publishes into this project.
      //    Each entry carries the cross-app customer id (the CCW record id),
      //    which is what lets a quote be filed under the same plant as its
      //    job, visits and timesheets. Matched by the shared identity rules —
      //    never by substring — and unmatched directory customers are added,
      //    since the directory's spelling is the authoritative one.
      try {
        const dirSnap = await getDocs(collection(db, 'customer_directory'));
        dirSnap.forEach((docSnap) => {
          const d = docSnap.data() || {};
          if (!d.name) return;
          const record = { id: d.id || docSnap.id, name: d.name, profile: { aliases: d.aliases || [] } };
          const hit = Object.values(customerMap).find((c) => matchCustomer(c.name, [record]));
          if (hit) {
            hit.ccwId = record.id;
          } else {
            customerMap[`ccw:${record.id}`] = {
              id: `ccw:${record.id}`,
              name: d.name,
              city: d.defaults?.city || '',
              state: d.defaults?.state || '',
              ccwId: record.id,
            };
          }
        });
      } catch (e) {
        console.warn('Customer directory unavailable:', e);
      }

      const list = Object.values(customerMap);
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCustomers(list);
    } catch (error) {
      console.error('Error loading customers:', error);
    }
  };

  const loadSavedQuotes = async () => {
    try {
      // Get all customer documents first
      console.log('Loading quotes from collection:', QUOTES_COLLECTION);
      const customersSnapshot = await getDocs(collection(db, QUOTES_COLLECTION));
      console.log('Found customer documents:', customersSnapshot.docs.length);
      const quotesList = [];

      // For each customer, get their quotes subcollection
      for (const customerDoc of customersSnapshot.docs) {
        const customerId = customerDoc.id;
        const customerData = customerDoc.data();
        console.log('Processing customer:', customerId, customerData);

        // Get quotes subcollection for this customer
        const quotesSnapshot = await getDocs(collection(db, QUOTES_COLLECTION, customerId, 'quotes'));
        console.log('Found quotes for', customerId, ':', quotesSnapshot.docs.length);

        quotesSnapshot.forEach((quoteDoc) => {
          const quote = quoteDoc.data();
          const quoteId = quoteDoc.id;

          // Calculate total from items array if it exists
          let total = 0;
          if (quote.items && Array.isArray(quote.items)) {
            total = quote.items.reduce((sum, item) => sum + (parseFloat(item.cost) || 0), 0);
          } else if (quote.total) {
            total = parseFloat(quote.total) || 0;
          }

          // Handle different field naming conventions
          quotesList.push({
            id: `${customerId}/quotes/${quoteId}`, // Store full path for loading
            customerId: customerId,
            quoteDocId: quoteId,
            customerName: quote.customerName || customerData.customerName || 'Unknown',
            quoteNumber: quote.quoteNumberValue || quote.quoteNumber || quoteId,
            dateOfQuote: quote.dateOfQuoteValue || quote.dateOfQuote || quote.date || '',
            city: quote.customerCity || quote.city || '',
            state: quote.customerState || quote.state || '',
            total: total
          });
        });
      }

      quotesList.sort((a, b) => new Date(b.dateOfQuote || 0) - new Date(a.dateOfQuote || 0));
      console.log('Loaded quotes from Firestore:', quotesList);
      setSavedQuotes(quotesList);
    } catch (error) {
      console.error('Error loading quotes:', error);
    }
  };

  const extractCustomersFromQuotes = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, QUOTES_COLLECTION));
      const customerMap = {};

      // Extract unique customers from all quotes
      querySnapshot.forEach((docSnap) => {
        const quote = docSnap.data();
        const name = (quote.customerName || quote.customer_name || quote.customer || '').trim();
        if (name && !customerMap[name]) {
          customerMap[name] = {
            name: name,
            city: quote.city || '',
            state: quote.state || ''
          };
        }
      });

      // Save each customer to Firestore
      const customerEntries = Object.values(customerMap);
      for (const customer of customerEntries) {
        const customerKey = customer.name.replace(/[.#$[\]/]/g, '_').replace(/\s+/g, '_').toLowerCase();
        await setDoc(doc(db, CUSTOMERS_COLLECTION, customerKey), customer);
      }

      await loadCustomers();
      showStatus(`Extracted ${customerEntries.length} customers!`);
    } catch (error) {
      console.error('Error extracting customers:', error);
      showStatus('Error extracting customers');
    }
    setIsLoading(false);
  };

  const handleNewQuote = () => {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const year = today.getFullYear();
    setData({
      customerName: '',
      city: '',
      state: '',
      datesValue: '',
      dateOfQuoteValue: `${month}/${day}/${year}`,
      quoteNumberValue: '',
      srNumber: '',
      customerId: '',
      items: initialData.items.map(i => ({ ...i, quantity: '', cost: '' })),
      notes: ''
    });
    showStatus('New quote created');
  };

  const handleSelectCustomer = (e) => {
    const selected = customers.find(c => c.name === e.target.value);
    if (selected) {
      setData(prev => ({
        ...prev,
        customerName: selected.name || '',
        city: selected.city || '',
        state: selected.state || '',
        // The cross-app id rides along invisibly; '' when this customer only
        // exists in this app's own list.
        customerId: selected.ccwId || ''
      }));
    }
  };

  const saveToCloud = async () => {
    if (!quoteNumberValue.trim()) {
      alert('Please enter a Quote # before saving.');
      return;
    }
    if (!customerName.trim()) {
      alert('Please enter a Customer Name before saving.');
      return;
    }
    setIsLoading(true);
    try {
      // Create customer key from customer name
      const customerKey = customerName.replace(/[.#$[\]/]/g, '_').replace(/\s+/g, '_').toLowerCase();
      const quoteKey = quoteNumberValue.replace(/[.#$[\]/]/g, '_');

      // Transform data to use correct field names for Firestore
      const saveData = {
        customerName: customerName,
        customerCity: city,
        customerState: state,
        datesValue: datesValue,
        dateOfQuoteValue: dateOfQuoteValue,
        quoteNumberValue: quoteNumberValue,
        // The cross-app keys: which plant this quote is for (CCW customer id)
        // and, once the job exists, which service report it became. Either may
        // be '' — a quote can precede both — but a filled one is what lets
        // the dashboard show the quote next to the job.
        customerId: data.customerId || '',
        sr: String(srNumber || '').trim(),
        items: items,
        notes: notes,
        lastUpdated: new Date().toISOString()
      };

      // Update customer document
      await setDoc(doc(db, QUOTES_COLLECTION, customerKey), {
        customerName: customerName,
        lastUpdated: new Date().toISOString()
      }, { merge: true });

      // Save quote to subcollection
      await setDoc(doc(db, QUOTES_COLLECTION, customerKey, 'quotes', quoteKey), saveData);
      await loadSavedQuotes();
      showStatus('Saved to cloud!');
    } catch (error) {
      console.error('Error saving:', error);
      showStatus('Error saving');
    }
    setIsLoading(false);
  };

  const loadFromCloud = async (quoteId) => {
    if (!quoteId) return;
    setIsLoading(true);
    try {
      // Handle nested path format: customerId/quotes/quoteDocId
      let docSnap;
      if (quoteId.includes('/quotes/')) {
        const parts = quoteId.split('/quotes/');
        const customerId = parts[0];
        const quoteDocId = parts[1];
        docSnap = await getDoc(doc(db, QUOTES_COLLECTION, customerId, 'quotes', quoteDocId));
      } else {
        // Fallback for old format
        docSnap = await getDoc(doc(db, QUOTES_COLLECTION, quoteId));
      }

      if (docSnap.exists()) {
        const loadedData = docSnap.data();
        console.log('Loaded quote data:', loadedData);

        // Start with all default items (so all fields are visible)
        let mergedItems = initialData.items.map(i => ({ ...i, quantity: '', cost: '' }));

        // If we have loaded items, merge their values into the default items
        if (loadedData.items && Array.isArray(loadedData.items)) {
          loadedData.items.forEach(loadedItem => {
            const idx = mergedItems.findIndex(m => m.service === loadedItem.service);
            if (idx !== -1) {
              // Update existing item with loaded values
              mergedItems[idx] = {
                ...mergedItems[idx],
                quantity: loadedItem.quantity !== undefined ? loadedItem.quantity : '',
                cost: loadedItem.cost !== undefined ? loadedItem.cost : ''
              };
            }
          });
        }

        const loadedItems = mergedItems;

        // Handle various field name formats for city and state
        const loadedCity = loadedData.customerCity || loadedData.city || loadedData.City || '';
        const loadedState = loadedData.customerState || loadedData.state || loadedData.State || '';

        // Convert date from MM-DD-YYYY or YYYY-MM-DD to mm/dd/yyyy
        let dateValue = loadedData.dateOfQuoteValue || loadedData.dateOfQuote || loadedData.date || '';
        if (dateValue && dateValue.includes('-')) {
          const parts = dateValue.split('-');
          if (parts[0].length === 4) {
            // Format is YYYY-MM-DD
            dateValue = `${parts[1]}/${parts[2]}/${parts[0]}`;
          } else {
            // Format is MM-DD-YYYY, just replace dashes with slashes
            dateValue = dateValue.replace(/-/g, '/');
          }
        }

        setData({
          customerName: loadedData.customerName || loadedData.customer_name || loadedData.customer || '',
          city: loadedCity,
          state: loadedState,
          datesValue: loadedData.datesValue || loadedData.dates || loadedData.serviceDates || '',
          dateOfQuoteValue: dateValue,
          quoteNumberValue: loadedData.quoteNumberValue || loadedData.quoteNumber || quoteId.split('/').pop() || '',
          srNumber: loadedData.sr || loadedData.srNumber || '',
          customerId: loadedData.customerId || '',
          items: loadedItems,
          notes: loadedData.notes || ''
        });
        showStatus('Loaded from cloud!');
      } else {
        showStatus('Quote not found');
      }
    } catch (error) {
      console.error('Error loading:', error);
      showStatus('Error loading');
    }
    setIsLoading(false);
  };

  const setTodayDate = () => {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const year = today.getFullYear();
    setData(prev => ({
      ...prev,
      dateOfQuoteValue: `${month}/${day}/${year}`
    }));
  };

  const generateQuoteNumber = () => {
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    const rand = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    const stateCode = state || 'XX';
    setData(prev => ({
      ...prev,
      quoteNumberValue: `JTIQ${month}${day}${year}${rand}${stateCode}`
    }));
  };

  const calculateTravel = () => {
    const miles = parseFloat(milesPerDay) || 0;
    const days = parseFloat(daysOnSite) || 0;
    const isLocal = jobType === 'local';

    // Read the live mileage rate from the Services & Costs row so edits there
    // flow into the Travel Cost Calculator automatically.
    const mileageRow = data.items.find(i => i.service?.includes('Mileage'));
    const mileageRate = parseFloat(mileageRow?.rate) || 0.67;

    const totalMiles = isLocal ? miles * days : miles;
    const mileageCost = totalMiles * mileageRate;
    const perDiemRate = isLocal ? 65 : 220;
    const perDiemCost = perDiemRate * days;

    setData(prev => {
      const newItems = [...prev.items];
      const mileageIdx = newItems.findIndex(i => i.service.includes('Mileage'));
      const perDiemLocalIdx = newItems.findIndex(i => i.service.includes('Per Diem (Local)'));
      const perDiemNonLocalIdx = newItems.findIndex(i => i.service.includes('Per Diem (Non-Local)'));

      if (mileageIdx !== -1) {
        newItems[mileageIdx] = { ...newItems[mileageIdx], quantity: String(totalMiles), cost: String(mileageCost.toFixed(2)) };
      }
      if (isLocal && perDiemLocalIdx !== -1) {
        newItems[perDiemLocalIdx] = { ...newItems[perDiemLocalIdx], quantity: String(days), cost: String(perDiemCost.toFixed(2)) };
      }
      if (!isLocal && perDiemNonLocalIdx !== -1) {
        newItems[perDiemNonLocalIdx] = { ...newItems[perDiemNonLocalIdx], quantity: String(days), cost: String(perDiemCost.toFixed(2)) };
      }

      return { ...prev, items: newItems };
    });
    showStatus('Travel costs calculated!');
  };

  const editQuantity = (index, value) => {
    setData(prev => {
      const updatedItems = [...prev.items];
      const rate = updatedItems[index].rate;
      const qty = value === '' ? '' : Number(value);
      const cost = qty === '' || rate === 'Estimate' ? updatedItems[index].cost : (rate * qty).toFixed(2);
      updatedItems[index] = { ...updatedItems[index], quantity: value, cost };
      return { ...prev, items: updatedItems };
    });
  };

  const editRate = (index, value) => {
    setData(prev => {
      const updatedItems = [...prev.items];
      // Keep the raw string on the input while typing so decimals like "0." work,
      // but store a number once there's a parseable value.
      const parsed = parseFloat(value);
      const newRate = value === '' || isNaN(parsed) ? value : parsed;
      const qty = updatedItems[index].quantity;
      const qtyNum = qty === '' || qty == null ? null : Number(qty);
      const cost =
        qtyNum == null || isNaN(qtyNum) || isNaN(parsed)
          ? updatedItems[index].cost
          : (parsed * qtyNum).toFixed(2);
      updatedItems[index] = { ...updatedItems[index], rate: newRate, cost };
      return { ...prev, items: updatedItems };
    });
  };

  const editCost = (index, value) => {
    setData(prev => {
      const updatedItems = [...prev.items];
      updatedItems[index] = { ...updatedItems[index], cost: value };
      return { ...prev, items: updatedItems };
    });
  };

  const clearAll = () => {
    if (!window.confirm('Clear all data?')) return;
    handleNewQuote();
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ServiceQuote_${quoteNumberValue || 'data'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
          alert('Invalid quote file: expected a quote object.');
          return;
        }
        // Guarantee items is a valid array so the Services table can't crash on a bad file
        const safeData = {
          ...imported,
          items: Array.isArray(imported.items) ? imported.items : initialData.items,
        };
        setData(safeData);
        showStatus('Imported!');
      } catch {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Accumulate in integer cents to avoid floating-point drift (e.g. 0.1 + 0.2), then back to dollars
  const totalCost = (items || []).reduce((sum, i) => sum + Math.round((parseFloat(i.cost) || 0) * 100), 0) / 100;

  const exportPDF = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;

    // Colors
    const primaryBlue = [0, 153, 204]; // Cyan/teal color
    const darkGray = [51, 51, 51];
    const lightGray = [245, 245, 245];

    // Header - Logo centered
    const logoUrl = initialData.logoUrl;
    const imgWidth = 80;
    const imgHeight = 35;
    doc.addImage(logoUrl, 'PNG', (pageWidth - imgWidth) / 2, 25, imgWidth, imgHeight);

    // Title - SERVICE QUOTE in cyan
    doc.setFontSize(28);
    doc.setTextColor(...primaryBlue);
    doc.setFont('helvetica', 'bold');
    doc.text('SERVICE QUOTE', pageWidth / 2, 85, { align: 'center' });

    // FROM/TO Section with rounded rectangle background
    const infoBoxY = 105;
    const infoBoxHeight = 95;

    // Light gray background box
    doc.setFillColor(...lightGray);
    doc.roundedRect(margin, infoBoxY, pageWidth - (margin * 2), infoBoxHeight, 5, 5, 'F');

    // FROM section (left side)
    doc.setFontSize(10);
    doc.setTextColor(...darkGray);
    doc.setFont('helvetica', 'bold');
    doc.text('FROM:', margin + 15, infoBoxY + 20);
    doc.setFont('helvetica', 'normal');
    doc.text('Joshua Todd Industries LLC', margin + 15, infoBoxY + 35);
    doc.text('Gilbert, AZ', margin + 15, infoBoxY + 48);
    doc.text('Email: josh@jtiaz.com', margin + 15, infoBoxY + 61);
    doc.text('Phone: (623) 300-6445', margin + 15, infoBoxY + 74);

    // TO section (right side)
    const rightColX = pageWidth / 2 + 20;
    doc.setFont('helvetica', 'bold');
    doc.text('TO:', rightColX, infoBoxY + 20);
    doc.setFont('helvetica', 'normal');
    const customerLocation = city && state ? `${customerName} (${city}, ${state})` : customerName;
    doc.text(customerLocation, rightColX, infoBoxY + 35);

    doc.setFont('helvetica', 'bold');
    doc.text('Quote #:', rightColX, infoBoxY + 55);
    doc.setFont('helvetica', 'normal');
    doc.text(quoteNumberValue || '', rightColX + 55, infoBoxY + 55);

    doc.setFont('helvetica', 'bold');
    doc.text('Date of Quote:', rightColX, infoBoxY + 68);
    doc.setFont('helvetica', 'normal');
    doc.text(dateOfQuoteValue || '', rightColX + 75, infoBoxY + 68);

    doc.setFont('helvetica', 'bold');
    doc.text('Service Dates:', rightColX, infoBoxY + 81);
    doc.setFont('helvetica', 'normal');
    doc.text(datesValue || 'TBD', rightColX + 75, infoBoxY + 81);

    // Thank you message
    const messageY = infoBoxY + infoBoxHeight + 20;
    doc.setFontSize(10);
    doc.setTextColor(...darkGray);
    doc.text('Thank you for your interest with JTI. This is an estimated quote. Service call will be actual hours worked and expenses accrued.', margin, messageY, { maxWidth: pageWidth - (margin * 2) });

    // Services Table
    const tableData = items
      .filter(i => i.cost && parseFloat(i.cost) > 0)
      .map(i => [
        i.service,
        i.rate === 'Estimate' ? 'Estimate' : i.rate,
        i.rate === 'Estimate' ? '' : (i.unit || ''),
        i.rate === 'Estimate' ? '' : (i.quantity || ''),
        `$${parseFloat(i.cost).toFixed(2)}`
      ]);

    doc.autoTable({
      startY: messageY + 25,
      head: [['Service', 'Rate', 'Unit', 'Qty', 'Cost']],
      body: tableData,
      styles: {
        fontSize: 10,
        cellPadding: 8,
        textColor: darkGray,
        lineColor: [200, 200, 200],
        lineWidth: 0.5
      },
      headStyles: {
        fillColor: primaryBlue,
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 10
      },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 60, halign: 'right' },
        2: { cellWidth: 60, halign: 'center' },
        3: { cellWidth: 40, halign: 'center' },
        4: { cellWidth: 70, halign: 'right', fontStyle: 'bold' }
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      margin: { left: margin, right: margin },
      tableWidth: 'auto'
    });

    let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : messageY + 50;

    // Calculate table dimensions - use page width minus margins as fallback
    const tableStartX = margin;
    const tableWidth = pageWidth - (margin * 2);

    // Total Box - cyan background, flush with table
    doc.setFillColor(...primaryBlue);
    doc.roundedRect(tableStartX, finalY, tableWidth, 35, 3, 3, 'F');

    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL ESTIMATED COST:', tableStartX + 15, finalY + 23);
    doc.text(`$${totalCost.toFixed(2)}`, tableStartX + tableWidth - 15, finalY + 23, { align: 'right' });

    finalY += 50;

    // Notes Section with light gray background
    if (notes) {
      // Calculate actual height needed for notes text
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const notesMaxWidth = tableWidth - 20;
      const splitNotes = doc.splitTextToSize(notes, notesMaxWidth);
      const lineHeight = 12;
      const notesTextHeight = splitNotes.length * lineHeight;
      const notesBoxHeight = Math.max(50, 35 + notesTextHeight);

      doc.setFillColor(...lightGray);
      doc.roundedRect(tableStartX, finalY, tableWidth, notesBoxHeight, 3, 3, 'F');

      doc.setFontSize(11);
      doc.setTextColor(...darkGray);
      doc.setFont('helvetica', 'bold');
      doc.text('NOTES:', tableStartX + 10, finalY + 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(splitNotes, tableStartX + 10, finalY + 32);

      finalY += notesBoxHeight + 15;
    }

    // Terms and conditions - italic, at bottom
    const termsY = pageHeight - 70;
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'italic');
    const terms = "Terms and conditions: Approval of this quote by a Purchase Order constitutes a minimum daily charge while on site of $500 (local, meaning within 2 hour drive of Gilbert, AZ) or $960 (non-local, meaning outside of 2 hour drive of Gilbert, AZ) for diagnostics / troubleshooting.";
    doc.text(terms, margin, termsY, { maxWidth: pageWidth - (margin * 2) });

    // Footer
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'normal');
    doc.text('Generated with Service Quote App', pageWidth / 2, pageHeight - 25, { align: 'center' });

    doc.save(`ServiceQuote_${quoteNumberValue || 'quote'}.pdf`);
  };

  // PDF Preview Component
  const PdfPreview = () => {
    const filteredItems = items.filter(i => i.cost && parseFloat(i.cost) > 0);
    const customerLocation = city && state ? `${customerName} (${city}, ${state})` : customerName;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-auto">
        <div className="bg-white max-w-2xl w-full max-h-[90vh] overflow-auto rounded-lg shadow-2xl">
          {/* Preview Header */}
          <div className="sticky top-0 bg-gray-100 p-3 flex justify-between items-center border-b">
            <span className="font-semibold text-gray-800">PDF Preview</span>
            <div className="flex gap-2">
              <button
                onClick={() => { exportPDF(); setShowPdfPreview(false); }}
                className="px-4 py-1 bg-cyan-600 text-white rounded text-sm font-medium"
              >
                📥 Download PDF
              </button>
              <button
                onClick={() => setShowPdfPreview(false)}
                className="px-4 py-1 bg-gray-500 text-white rounded text-sm"
              >
                ✕ Close
              </button>
            </div>
          </div>

          {/* PDF Content Preview */}
          <div className="p-8 bg-white text-gray-800" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>
            {/* Logo */}
            <div className="text-center mb-2">
              <img src={initialData.logoUrl} alt="JTI Logo" className="h-10 mx-auto" />
            </div>

            {/* Title */}
            <h1 className="text-center text-2xl font-bold mb-4" style={{ color: '#0099CC' }}>
              SERVICE QUOTE
            </h1>

            {/* FROM/TO Section */}
            <div className="bg-gray-100 rounded-lg p-4 mb-4 grid grid-cols-2 gap-4" style={{ backgroundColor: '#f5f5f5' }}>
              <div className="text-sm">
                <div className="font-bold mb-1">FROM:</div>
                <div>Joshua Todd Industries LLC</div>
                <div>Gilbert, AZ</div>
                <div>Email: josh@jtiaz.com</div>
                <div>Phone: (623) 300-6445</div>
              </div>
              <div className="text-sm">
                <div className="font-bold mb-1">TO:</div>
                <div className="mb-2">{customerLocation || 'Customer Name'}</div>
                <div><span className="font-bold">Quote #:</span> {quoteNumberValue || 'N/A'}</div>
                <div><span className="font-bold">Date of Quote:</span> {dateOfQuoteValue || 'N/A'}</div>
                <div><span className="font-bold">Service Dates:</span> {datesValue || 'TBD'}</div>
              </div>
            </div>

            {/* Thank you message */}
            <p className="text-xs text-gray-600 mb-4">
              Thank you for your interest with JTI. This is an estimated quote. Service call will be actual hours worked and expenses accrued.
            </p>

            {/* Services Table */}
            <table className="w-full mb-4 text-sm border-collapse">
              <thead>
                <tr style={{ backgroundColor: '#0099CC', color: 'white' }}>
                  <th className="p-2 text-left font-bold">Service</th>
                  <th className="p-2 text-right font-bold">Rate</th>
                  <th className="p-2 text-center font-bold">Unit</th>
                  <th className="p-2 text-center font-bold">Qty</th>
                  <th className="p-2 text-right font-bold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length > 0 ? filteredItems.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-200">
                    <td className="p-2">{item.service}</td>
                    <td className="p-2 text-right">{item.rate === 'Estimate' ? 'Estimate' : item.rate}</td>
                    <td className="p-2 text-center">{item.rate === 'Estimate' ? '' : (item.unit || '')}</td>
                    <td className="p-2 text-center">{item.rate === 'Estimate' ? '' : (item.quantity || '')}</td>
                    <td className="p-2 text-right font-bold">${parseFloat(item.cost).toFixed(2)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-gray-500 italic">No items with costs entered</td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Total Box */}
            <div className="rounded p-3 mb-4 flex justify-between items-center text-white font-bold" style={{ backgroundColor: '#0099CC' }}>
              <span>TOTAL ESTIMATED COST:</span>
              <span className="text-lg">${totalCost.toFixed(2)}</span>
            </div>

            {/* Notes Section */}
            {notes && (
              <div className="bg-gray-100 rounded p-3 mb-4" style={{ backgroundColor: '#f5f5f5' }}>
                <div className="font-bold text-sm mb-1">NOTES:</div>
                <div className="text-xs whitespace-pre-wrap">{notes}</div>
              </div>
            )}

            {/* Terms */}
            <p className="text-xs text-gray-500 italic mb-4">
              Terms and conditions: Approval of this quote by a Purchase Order constitutes a minimum daily charge while on site of $500 (local, meaning within 2 hour drive of Gilbert, AZ) or $960 (non-local, meaning outside of 2 hour drive of Gilbert, AZ) for diagnostics / troubleshooting.
            </p>

            {/* Footer */}
            <p className="text-center text-xs text-gray-400">
              Generated with Service Quote App
            </p>
          </div>
        </div>
      </div>
    );
  };

  const bgClass = darkMode ? 'bg-slate-900 text-gray-100' : 'bg-gray-100 text-gray-900';
  const cardClass = darkMode ? 'bg-slate-800' : 'bg-white';
  const inputClass = darkMode
    ? 'bg-slate-700 border-slate-600 text-gray-100 placeholder-gray-400'
    : 'bg-white border-gray-300 text-gray-900';
  const tableHeaderClass = darkMode ? 'bg-cyan-700 text-white' : 'bg-cyan-600 text-white';
  const tableRowClass = darkMode ? 'bg-slate-700' : 'bg-gray-50';

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className={`min-h-screen ${bgClass} p-4 transition-colors`}>
      {/* PDF Preview Modal */}
      {showPdfPreview && <PdfPreview />}

      {/* Customer Management Modal */}
      {showCustomerModal && (
        <CustomerModal
          darkMode={darkMode}
          customers={customers}
          editingCustomer={editingCustomer}
          setEditingCustomer={setEditingCustomer}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          loadCustomers={loadCustomers}
          extractCustomersFromQuotes={extractCustomersFromQuotes}
          showStatus={showStatus}
          statusMessage={statusMessage}
          onClose={() => setShowCustomerModal(false)}
        />
      )}

      {/* Quote Management Modal */}
      {showQuoteModal && (
        <QuoteManagementModal
          darkMode={darkMode}
          savedQuotes={savedQuotes}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          loadFromCloud={loadFromCloud}
          loadSavedQuotes={loadSavedQuotes}
          showStatus={showStatus}
          statusMessage={statusMessage}
          onClose={() => setShowQuoteModal(false)}
        />
      )}

      {/* Top Controls */}
      <div className="fixed top-4 right-4 flex gap-2 z-50">
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="px-3 py-1 bg-slate-700 text-white rounded-lg text-sm"
        >
          {darkMode ? '☀️ Light' : '🌙 Dark'}
        </button>
        <button
          onClick={handleLogout}
          className="px-3 py-1 bg-red-700 text-white rounded-lg text-sm"
        >
          Sign Out
        </button>
      </div>

      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <img src={initialData.logoUrl} alt="JTI Logo" className="h-12 mx-auto mb-2" />
          <h1 className="text-3xl font-bold text-cyan-500 italic">SERVICE QUOTE</h1>
        </div>

        {/* Firebase Integration Section */}
        <div className="bg-cyan-600 rounded-xl p-4 mb-6">
          <h2 className="text-white font-semibold mb-3">🔥 Firebase Integration</h2>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              onClick={handleNewQuote}
              className="py-2 bg-white rounded text-gray-800 font-medium hover:bg-gray-100"
            >
              ✨ New Quote
            </button>
            <button
              onClick={saveToCloud}
              disabled={isLoading}
              className="py-2 bg-white rounded text-gray-800 font-medium hover:bg-gray-100"
            >
              💾 Save to Cloud
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setShowCustomerModal(true)}
              className="py-2 bg-white rounded text-gray-800 font-medium hover:bg-gray-100"
            >
              👥 Customers
            </button>
            <button
              onClick={() => setShowQuoteModal(true)}
              className="py-2 bg-white rounded text-gray-800 font-medium hover:bg-gray-100"
            >
              📁 Quotes ({savedQuotes.length})
            </button>
          </div>
          {statusMessage && (
            <div className="mt-2 text-center text-white font-medium">{statusMessage}</div>
          )}
        </div>

        {/* Local Controls */}
        <div className={`${cardClass} rounded-lg p-3 mb-6 flex flex-wrap gap-2`}>
          <button onClick={clearAll} className="px-3 py-1 bg-gray-200 dark:bg-slate-600 rounded text-sm">
            🗑️ Clear All
          </button>
          <button onClick={exportJSON} className="px-3 py-1 bg-gray-200 dark:bg-slate-600 rounded text-sm">
            🔥 Export JSON
          </button>
          <label className="px-3 py-1 bg-gray-200 dark:bg-slate-600 rounded text-sm cursor-pointer">
            📁 Import File
            <input type="file" accept=".json" onChange={importJSON} className="hidden" />
          </label>
          <button onClick={() => setShowPdfPreview(true)} className="px-3 py-1 bg-cyan-600 text-white rounded text-sm">
            👁️ Preview PDF
          </button>
          <button onClick={exportPDF} className="px-3 py-1 bg-gray-200 dark:bg-slate-600 rounded text-sm">
            📄 Export as PDF
          </button>
        </div>

        {/* Quote Information */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3">📋 Quote Information</h2>
          <hr className={`mb-4 ${darkMode ? 'border-slate-600' : 'border-gray-300'}`} />

          <div className="space-y-3">
            <div>
              <label className="block text-sm mb-1">👥 Select Customer:</label>
              <select
                onChange={handleSelectCustomer}
                className={`w-full p-2 rounded border ${inputClass}`}
                value=""
              >
                <option value="">-- Select a customer (or enter manually below) --</option>
                {customers.map((c, i) => (
                  <option key={i} value={c.name}>{c.name}{c.city || c.state ? ` - ${[c.city, c.state].filter(Boolean).join(', ')}` : ''}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <label className="block text-sm mb-1">Customer Name:</label>
                <input
                  value={customerName}
                  onChange={(e) => setData({ ...data, customerName: e.target.value })}
                  className={`w-full p-2 rounded border ${inputClass}`}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">City:</label>
                <input
                  value={city}
                  onChange={(e) => setData({ ...data, city: e.target.value })}
                  className={`w-full p-2 rounded border ${inputClass}`}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">State:</label>
                <input
                  value={state}
                  onChange={(e) => setData({ ...data, state: e.target.value })}
                  className={`w-full p-2 rounded border ${inputClass}`}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm mb-1">Dates:</label>
              <input
                value={datesValue}
                onChange={(e) => setData({ ...data, datesValue: e.target.value })}
                className={`w-full p-2 rounded border ${inputClass}`}
              />
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-sm mb-1">Date of Quote:</label>
                <input
                  type="text"
                  placeholder="mm/dd/yyyy"
                  value={dateOfQuoteValue}
                  onChange={(e) => setData({ ...data, dateOfQuoteValue: e.target.value })}
                  className={`w-full p-2 rounded border ${inputClass}`}
                />
              </div>
              <button onClick={setTodayDate} className="px-3 py-2 bg-slate-600 text-white rounded text-sm">
                📅 Today
              </button>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-sm mb-1">Quote #:</label>
                <input
                  value={quoteNumberValue}
                  onChange={(e) => setData({ ...data, quoteNumberValue: e.target.value })}
                  className={`w-full p-2 rounded border ${inputClass}`}
                />
              </div>
              <button onClick={generateQuoteNumber} className="px-3 py-2 bg-slate-600 text-white rounded text-sm">
                ➕ New
              </button>
            </div>

            <div>
              <label className="block text-sm mb-1">Service Report # (once the job exists):</label>
              <input
                value={srNumber || ''}
                placeholder="2026028"
                onChange={(e) => setData({ ...data, srNumber: e.target.value })}
                className={`w-full p-2 rounded border ${inputClass}`}
              />
              <p className="text-xs mt-1 opacity-70">
                Links this quote to the job&rsquo;s service report / invoice number, so the dashboard shows them together. Leave blank while it&rsquo;s still just a quote.
              </p>
            </div>
          </div>
        </div>

        {/* Message */}
        <p className="mb-6">{initialData.message}</p>

        {/* Travel Cost Calculator */}
        <div className={`${cardClass} rounded-lg p-4 mb-6`}>
          <h2 className="text-lg font-semibold mb-2">🧮 Travel Cost Calculator</h2>
          <p className="text-sm mb-4 opacity-80">
            Calculate mileage and per diem automatically (you can still override the values manually after calculation)
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-sm mb-1">Miles Per Day:</label>
              <input
                type="number"
                value={milesPerDay}
                onChange={(e) => setMilesPerDay(e.target.value)}
                placeholder="e.g., 100"
                className={`w-full p-2 rounded border ${inputClass}`}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Days on Site:</label>
              <input
                type="number"
                value={daysOnSite}
                onChange={(e) => setDaysOnSite(e.target.value)}
                placeholder="e.g., 3"
                className={`w-full p-2 rounded border ${inputClass}`}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Job Type:</label>
              <select
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                className={`w-full p-2 rounded border ${inputClass}`}
              >
                <option value="local">Local ($65/day)</option>
                <option value="nonlocal">Non-Local ($220/day)</option>
              </select>
            </div>
          </div>

          <button
            onClick={calculateTravel}
            className="w-full py-2 bg-white dark:bg-slate-600 border rounded font-medium"
          >
            🧮 Calculate
          </button>

          <p className="text-sm mt-3 opacity-80">
            💡 <strong>Local:</strong> Enter miles per day (e.g., 100 mi/day × 3 days = 300 total miles).
            <strong> Non-Local:</strong> Enter total round trip miles (e.g., 540 miles one time).
          </p>
        </div>

        {/* Services & Costs */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold">🛒 Services & Costs</h2>
            <div className="flex gap-1">
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1 rounded text-sm ${viewMode === 'table' ? 'bg-cyan-600 text-white' : 'bg-slate-600 text-white'}`}
              >
                📊 Table
              </button>
              <button
                onClick={() => setViewMode('card')}
                className={`px-3 py-1 rounded text-sm ${viewMode === 'card' ? 'bg-cyan-600 text-white' : 'bg-slate-600 text-white'}`}
              >
                📇 Card
              </button>
            </div>
          </div>

          {viewMode === 'table' ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={tableHeaderClass}>
                    <th className="p-3 text-left">SERVICE</th>
                    <th className="p-3 text-left">RATE</th>
                    <th className="p-3 text-left">UNIT</th>
                    <th className="p-3 text-left">QTY</th>
                    <th className="p-3 text-left">COST</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const isEstimate = item.rate === 'Estimate';
                    const isMileage = item.service?.includes('Mileage');
                    return (
                      <tr key={idx} className={`${tableRowClass} border-b border-slate-600`}>
                        <td className="p-3">{item.service}</td>
                        <td className="p-3">
                          {isEstimate ? (
                            'Estimate'
                          ) : isMileage ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.rate}
                              onChange={(e) => editRate(idx, e.target.value)}
                              className={`w-20 p-1 rounded border ${inputClass}`}
                              title="Mileage rate — also used by the Travel Cost Calculator"
                            />
                          ) : (
                            item.rate
                          )}
                        </td>
                        <td className="p-3">{item.unit || '—'}</td>
                        <td className="p-3">
                          {isEstimate ? (
                            <span>—</span>
                          ) : (
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => editQuantity(idx, e.target.value)}
                              className={`w-20 p-1 rounded border ${inputClass}`}
                            />
                          )}
                        </td>
                        <td className="p-3">
                          <input
                            type="number"
                            value={item.cost}
                            onChange={(e) => editCost(idx, e.target.value)}
                            className={`w-24 p-1 rounded border ${inputClass}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((item, idx) => {
                const isEstimate = item.rate === 'Estimate';
                const isMileage = item.service?.includes('Mileage');
                return (
                  <div key={idx} className={`${cardClass} p-3 rounded-lg border ${darkMode ? 'border-slate-600' : 'border-gray-300'}`}>
                    <div className="font-medium mb-2">{item.service}</div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        Rate: {isEstimate ? (
                          'Estimate'
                        ) : isMileage ? (
                          <>
                            $<input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.rate}
                              onChange={(e) => editRate(idx, e.target.value)}
                              className={`w-16 p-1 rounded border ${inputClass}`}
                              title="Mileage rate — also used by the Travel Cost Calculator"
                            />
                          </>
                        ) : `$${item.rate}`}
                      </div>
                      <div>Unit: {item.unit || '—'}</div>
                      <div>
                        Qty: {isEstimate ? '—' : (
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => editQuantity(idx, e.target.value)}
                            className={`w-16 p-1 rounded border ${inputClass}`}
                          />
                        )}
                      </div>
                      <div>
                        Cost: $
                        <input
                          type="number"
                          value={item.cost}
                          onChange={(e) => editCost(idx, e.target.value)}
                          className={`w-16 p-1 rounded border ${inputClass}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button onClick={clearAll} className="px-3 py-1 bg-slate-600 text-white rounded text-sm">
            🗑️ Clear All
          </button>
          <button onClick={exportJSON} className="px-3 py-1 bg-slate-600 text-white rounded text-sm">
            🔥 Export JSON
          </button>
          <label className="px-3 py-1 bg-slate-600 text-white rounded text-sm cursor-pointer">
            📁 Import File
            <input type="file" accept=".json" onChange={importJSON} className="hidden" />
          </label>
        </div>

        {/* Total */}
        <div className="text-center text-3xl font-bold text-cyan-500 mb-6">
          💰 Total: ${totalCost.toFixed(2)}
        </div>

        {/* Notes */}
        <div className={`${cardClass} rounded-lg p-4 mb-6`}>
          <h2 className="font-semibold mb-2">📝 NOTES:</h2>
          <textarea
            value={notes}
            onChange={(e) => setData({ ...data, notes: e.target.value })}
            rows={4}
            className={`w-full p-2 rounded border ${inputClass}`}
          />
        </div>

        {/* Export PDF Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setShowPdfPreview(true)}
            className="py-3 bg-cyan-600 text-white rounded-lg font-medium text-lg"
          >
            👁️ Preview PDF
          </button>
          <button
            onClick={exportPDF}
            className="py-3 bg-white dark:bg-slate-700 border rounded-lg font-medium text-lg"
          >
            📄 Export as PDF
          </button>
        </div>
      </div>
    </div>
  );
}

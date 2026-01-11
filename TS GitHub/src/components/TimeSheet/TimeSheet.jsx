// src/components/TimeSheet/TimeSheet.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useTimeSheet } from '../../context/TimeSheetContext';
import { useNavigate } from 'react-router-dom';
import TimeEntryForm from './TimeEntryForm';
import SavedEntriesTable from './SavedEntriesTable';
import ServiceChargesTable from './ServiceChargesTable';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { calculateCharges } from '../../utils/calculations';
import { db } from '../../firebase';
import { collection, getDocs, query, orderBy, where } from 'firebase/firestore';

function TimeSheet() {
  const context = useTimeSheet();
  const navigate = useNavigate();
  if (!context) {
    return (
      <div className="text-red-600 text-center p-4">
        Error: Time Sheet context is unavailable. Please try refreshing.
      </div>
    );
  }

  const {
    resetData, setCustomerInfo, setTravelData,
    entries, setEntries, setServiceReportData,
    setInvoiceInfo, setMachineInfo,
    currentCustomer, customers, addCustomer, switchCustomer,
    saveCurrentCustomer, exportCustomerJSON, importCustomerJSON,
    saveToCloud, loadFromCloud, loadFromHistory, renameVisit, deleteVisit,
    fetchAllCloudFiles, attachToCustomer, deleteCustomer,
    customerForm, setCustomerForm,
    travelForm, setTravelForm,
    invoiceForm, setInvoiceForm,
    machineForms, setMachineForms,
    serviceReportForm, setServiceReportForm,
    tableKey,
    renameCustomer
  } = context;

  const [showTimeEntryForm, setShowTimeEntryForm] = useState(false);
  const [editEntryIndex, setEditEntryIndex] = useState(null);
  const [openSections, setOpenSections] = useState({
    customerInfo: true,
    travelExpenses: true,
    invoiceInfo: true,
    serviceReport: true,
    machineInfo: true,
  });
  const [saveHistory, setSaveHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [allCloudFiles, setAllCloudFiles] = useState([]);
  const [showCloudFiles, setShowCloudFiles] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  // Calculate rollups from entries + travel
  const charges = calculateCharges(entries || [], travelForm || {});
  const isInitialMount = useRef(true);

  useEffect(() => {
    const saved = localStorage.getItem('timesheetData');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setEntries(data.entries || []);
        setCustomerInfo(data.customerInfo || {});
        setTravelData(data.travelData || {});
        setInvoiceInfo(data.invoiceInfo || {});
        setMachineInfo(data.machineInfo || []);
        setServiceReportData(data.serviceReportData || {});
        setCustomerForm(data.customerInfo || {});
        setTravelForm(data.travelData || {});
        setInvoiceForm(data.invoiceInfo || {});
        setMachineForms(
          Array.isArray(data.machineInfo)
            ? data.machineInfo.map(m => ({
                model: m.model || '',
                serial: m.serial || m.serialNumber || '',
                jobNumber: m.jobNumber || ''
              }))
            : []
        );
        setServiceReportForm(data.serviceReportData || {});
      } catch (error) {
        console.error('Failed to load:', error);
      }
    }
    isInitialMount.current = false;
  }, []);

  useEffect(() => {
    if (isInitialMount.current) return;
    const data = {
      entries,
      customerInfo: customerForm,
      travelData: travelForm,
      serviceReportData: serviceReportForm,
      invoiceInfo: invoiceForm,
      machineInfo: machineForms
    };
    localStorage.setItem('timesheetData', JSON.stringify(data));
  }, [entries, customerForm, travelForm, serviceReportForm, invoiceForm, machineForms]);

  const toggleSection = (section) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleAddDaySave = (formData) => {
    const fullEntry = {
      date: formData.date,
      travel: {
        to: formData.travelTo,
        home: formData.travelHome
      },
      onsite: formData.onsite,
      lunch: formData.lunch,
      lunchDuration: formData.lunchDuration,
      holiday: formData.holiday,
      travelOnly: formData.travelOnly,
      serviceWork: formData.serviceWork || '',
      customer: currentCustomer || 'General'
    };

    setEntries(prev => {
      const i = prev.findIndex(e => e.date === fullEntry.date && e.customer === fullEntry.customer);
      if (i >= 0) {
        const updated = [...prev];
        updated[i] = fullEntry;
        return updated;
      }
      return [...prev, fullEntry];
    });

    setServiceReportData(prev => ({
      ...prev,
      [fullEntry.date]: formData.serviceWork || ''
    }));

    setServiceReportForm(prev => ({
      ...prev,
      [fullEntry.date]: formData.serviceWork || ''
    }));

    setShowTimeEntryForm(false);
    setEditEntryIndex(null);
  };

  const handleAddDayClick = () => {
    setEditEntryIndex(null);
    setShowTimeEntryForm(true);
  };

  const handleEdit = (index) => {
    const entry = entries[index];

    // Get the most up-to-date service work from either the form or the entry
    const currentServiceWork = serviceReportForm[entry.date] || entry.serviceWork || '';

    // Update the entry with the current service work before editing
    setEntries(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        serviceWork: currentServiceWork
      };
      return updated;
    });

    setEditEntryIndex(index);
    setShowTimeEntryForm(true);
  };

  const handleDeleteDay = (index) => {
    if (window.confirm('Delete this day?')) {
      setEntries(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handleReset = () => {
    if (window.confirm('Reset all data?')) {
      resetData();
      setCustomerForm({});
      setTravelForm({});
      setInvoiceForm({});
      setMachineForms([]);
      setServiceReportForm({});
      localStorage.removeItem('timesheetData');
    }
  };

  const handleCustomerInputChange = (e) => {
    const { name, value } = e.target;
    setCustomerForm(prev => ({ ...prev, [name]: value }));
    setCustomerInfo(prev => ({ ...prev, [name]: value }));
  };

  const handleTravelInputChange = (e) => {
    const { name, value } = e.target;
    if (name.startsWith('airTravel.')) {
      const field = name.split('.')[1];
      const newValue = field === 'cost' ? parseFloat(value) || 0 : value;
      setTravelForm(prev => ({ ...prev, airTravel: { ...prev.airTravel, [field]: newValue } }));
      setTravelData(prev => ({ ...prev, airTravel: { ...prev.airTravel, [field]: newValue } }));
    } else {
      const numeric = ['perDiemDays', 'mileage', 'otherTravel'].includes(name);
      const newValue = numeric ? (parseFloat(value) || 0) : value;
      setTravelForm(prev => ({ ...prev, [name]: newValue }));
      setTravelData(prev => ({ ...prev, [name]: newValue }));
    }
  };

  const generatePDF = () => {
    const doc = new jsPDF();
    doc.text(`Time Sheet Report - ${currentCustomer || 'General'}`, 10, 10);
    doc.text(`Date: ${entries[0]?.date || 'N/A'}`, 10, 20);
    doc.save(`${currentCustomer || 'report'}.pdf`);
  };

  const fetchSaveHistory = async () => {
    if (!currentCustomer) {
      alert('Select a customer first');
      return;
    }
    try {
      const q = query(
        collection(db, 'timesheets'),
        where('customer', '==', currentCustomer),
        orderBy('timestamp', 'desc')
      );
      const snapshot = await getDocs(q);
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        visitName: doc.data().visitName || `Visit ${new Date(doc.data().timestamp).toLocaleDateString()}`,
        timestamp: doc.data().timestamp
      }));
      setSaveHistory(history);
      setShowHistory(true);
    } catch (error) {
      console.error('Failed to load history:', error);
      alert('Failed to load history');
    }
  };

  const formatDateWithDay = (dateString) => {
    try {
      const [year, month, day] = dateString.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = days[date.getUTCDay()];
      const formattedMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
      const formattedDay = String(date.getUTCDate()).padStart(2, '0');
      return `${dayName} ${formattedMonth}/${formattedDay}/${year}`;
    } catch {
      return dateString;
    }
  };

  const handleViewAllCloudFiles = async () => {
    const files = await fetchAllCloudFiles();
    setAllCloudFiles(files);
    setShowCloudFiles(true);
  };

  // ====================== TOTALS MATH ======================
  // Travel EXPENSES (cash outlays you input here)
  const perDiemRate = (travelForm.perDiemType || 'local') === 'local' ? 65 : 220;
  const perDiemDays = Number(travelForm.perDiemDays) || 0;
  const perDiemAmt = perDiemDays * perDiemRate;

  const mileageRate = 0.67;
  const mileageMiles = Number(travelForm.mileage) || 0;
  const mileageAmt = mileageMiles * mileageRate;

  const otherTravelAmt = Number(travelForm.otherTravel) || 0;
  const airfareAmt = Number(travelForm.airTravel?.cost) || 0;

  // Split as requested
  // - Service Charges: from calculateCharges -> charges.laborSubtotal
  // - Travel Charges:  from calculateCharges -> charges.travelChargesSubtotal
  // - Travel Expenses: from this section (Per Diem + Mileage + Other + Airfare)
  const serviceChargesTotal = Number(charges?.laborSubtotal) || 0;
  const travelChargesSubtotal = Number(charges?.travelChargesSubtotal) || 0;
  const travelExpensesSubtotal = perDiemAmt + mileageAmt + otherTravelAmt + airfareAmt;

  const grandTotal = serviceChargesTotal + travelChargesSubtotal + travelExpensesSubtotal;

  const fmt = (n) =>
    (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ====================== RENDER ======================
  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="flex justify-center items-center gap-4 mb-6 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-center text-blue-600">
          Time Sheet
        </h1>
        <button
          onClick={() => setShowHelp(true)}
          className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition text-lg font-bold"
          title="Help"
        >
          ?
        </button>
      </div>

      {/* CUSTOMER SELECTOR + DELETE */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row justify-center gap-3">
          <select
            className="px-4 py-2 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto sm:max-w-xs"
            value={currentCustomer}
            onChange={(e) => switchCustomer(e.target.value)}
          >
            <option value="">Select Customer</option>
            {customers.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-3">
            <button
              onClick={() => {
                const name = prompt('New Customer Name?');
                if (name) addCustomer(name);
              }}
              className="px-3 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition text-sm sm:text-base"
            >
              New
            </button>
            <button
              onClick={() => {
                if (!currentCustomer) return alert('Select customer first');
                const newName = prompt(`Rename "${currentCustomer}" to?`, currentCustomer);
                if (newName && newName !== currentCustomer) renameCustomer(currentCustomer, newName);
              }}
              className="px-3 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition text-sm sm:text-base"
            >
              Rename
            </button>
            <button
              onClick={() => {
                if (!currentCustomer) return alert('Select customer first');
                if (confirm(`Delete "${currentCustomer}"? All data (local + cloud) will be lost.`)) deleteCustomer(currentCustomer);
              }}
              className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition text-sm sm:text-base"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* NAVIGATION */}
      <div className="mb-8 space-y-3">
        {/* Page Navigation - Full width on mobile */}
        <div className="flex flex-col sm:flex-row justify-center gap-2">
          <button onClick={() => navigate('/')} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition">
            Time Sheet
          </button>
          <button onClick={() => navigate('/service-report')} className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition">
            Service Report
          </button>
          <button onClick={() => navigate('/invoice')} className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition">
            Invoice
          </button>
        </div>

        {/* Actions - Grid on mobile, flex on desktop */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap justify-center gap-2">
          <button onClick={exportCustomerJSON} className="px-3 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition text-sm sm:text-base">
            Export JSON
          </button>
          <label className="px-3 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition cursor-pointer text-center text-sm sm:text-base">
            Import JSON
            <input type="file" onChange={(e) => importCustomerJSON(e.target.files[0])} className="hidden" />
          </label>
          <button onClick={saveCurrentCustomer} className="px-3 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 transition text-sm sm:text-base">
            Save Local
          </button>
          <button onClick={saveToCloud} className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition text-sm sm:text-base">
            Save Cloud
          </button>
          <button onClick={loadFromCloud} className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition text-sm sm:text-base">
            Load Cloud
          </button>
          <button onClick={handleViewAllCloudFiles} className="px-3 py-2 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition text-sm sm:text-base">
            View Files
          </button>
          <button onClick={generatePDF} className="px-3 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition text-sm sm:text-base">
            Export PDF
          </button>
          <button onClick={handleReset} className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition text-sm sm:text-base">
            Reset All
          </button>
        </div>
      </div>

      {/* CUSTOMER INFO */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
        <button
          onClick={() => toggleSection('customerInfo')}
          className="w-full text-left text-xl font-semibold text-blue-600 flex justify-between items-center"
        >
          Customer Information
          <span className="text-sm">{openSections.customerInfo ? '−' : '+'}</span>
        </button>
        {openSections.customerInfo && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {['company', 'contact', 'address', 'phone', 'city', 'email', 'state', 'purpose'].map(f => (
              <div key={f}>
                <label className="block text-sm font-medium text-gray-700 capitalize">
                  {f}
                </label>
                <input
                  type="text"
                  name={f}
                  value={customerForm[f] || ''}
                  onChange={handleCustomerInputChange}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TRAVEL (inputs + breakdown table) */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
        <button
          onClick={() => toggleSection('travelExpenses')}
          className="w-full text-left text-xl font-semibold text-blue-600 flex justify-between items-center"
        >
          Travel
          <span className="text-sm">{openSections.travelExpenses ? '−' : '+'}</span>
        </button>

        {openSections.travelExpenses && (
          <div className="mt-4 space-y-6">
            {/* Inputs */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Per Diem</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Per Diem Type</label>
                  <select
                    name="perDiemType"
                    value={travelForm.perDiemType || 'local'}
                    onChange={handleTravelInputChange}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="local">Local ($65/day)</option>
                    <option value="nonLocal">Non-Local ($220/day)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Per Diem Days</label>
                  <input
                    type="number"
                    name="perDiemDays"
                    value={travelForm.perDiemDays || 0}
                    onChange={handleTravelInputChange}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">Mileage & Other Travel</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Mileage (miles)</label>
                  <input
                    type="number"
                    name="mileage"
                    value={travelForm.mileage || 0}
                    onChange={handleTravelInputChange}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Other Travel (Auto/Taxi $)</label>
                  <input
                    type="number"
                    name="otherTravel"
                    value={travelForm.otherTravel || 0}
                    onChange={handleTravelInputChange}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">Airfare</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Destination</label>
                  <input
                    type="text"
                    name="airTravel.destination"
                    value={travelForm.airTravel?.destination || ''}
                    onChange={handleTravelInputChange}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Origin</label>
                  <input
                    type="text"
                    name="airTravel.origin"
                    value={travelForm.airTravel?.origin || ''}
                    onChange={handleTravelInputChange}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Return Date</label>
                  <input
                    type="text"
                    name="airTravel.return"
                    value={travelForm.airTravel?.return || ''}
                    onChange={handleTravelInputChange}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-gray-700">Airfare Cost ($)</label>
                  <input
                    type="number"
                    name="airTravel.cost"
                    value={travelForm.airTravel?.cost || 0}
                    onChange={handleTravelInputChange}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* ===== Travel Expenses Subtotal ===== */}
            <div className="mt-6 pt-4 border-t border-gray-300">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Travel Expenses Subtotal</h3>
                <p className="text-2xl font-bold text-blue-600">${fmt(travelExpensesSubtotal)}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* INVOICE DETAILS */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
        <button
          onClick={() => toggleSection('invoiceInfo')}
          className="w-full text-left text-xl font-semibold text-blue-600 flex justify-between items-center"
        >
          Invoice Details
          <span className="text-sm">{openSections.invoiceInfo ? '−' : '+'}</span>
        </button>
        {openSections.invoiceInfo && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {['invoiceNumber', 'invoiceDate', 'dueDate', 'poRefer', 'serviceDates', 'paymentTerms'].map(f => (
              <div key={f}>
                <label className="block text-sm font-medium text-gray-700 capitalize">
                  {f.replace(/([A-Z])/g, ' $1').trim()}
                </label>
                <input
                  type="text"
                  name={f}
                  value={invoiceForm[f] || ''}
                  onChange={(e) => {
                    const { name, value } = e.target;
                    setInvoiceForm(prev => ({ ...prev, [name]: value }));
                    setInvoiceInfo(prev => ({ ...prev, [name]: value }));
                  }}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MACHINE INFO */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
        <button
          onClick={() => toggleSection('machineInfo')}
          className="w-full text-left text-xl font-semibold text-blue-600 flex justify-between items-center"
        >
          Machine Information
          <span className="text-sm">{openSections.machineInfo ? '−' : '+'}</span>
        </button>
        {openSections.machineInfo && (
          <div className="mt-4">
            {machineForms.length > 0 ? (
              machineForms.map((machine, i) => (
                <div key={i} className="mb-4 p-4 border rounded bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Model</label>
                      <input
                        type="text"
                        value={machine.model || ''}
                        onChange={(e) => {
                          const updated = [...machineForms];
                          updated[i].model = e.target.value;
                          setMachineForms(updated);
                          setMachineInfo(updated);
                        }}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Serial Number</label>
                      <input
                        type="text"
                        value={machine.serial || ''}
                        onChange={(e) => {
                          const updated = [...machineForms];
                          updated[i].serial = e.target.value;
                          setMachineForms(updated);
                          setMachineInfo(updated);
                        }}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Job Number</label>
                      <input
                        type="text"
                        value={machine.jobNumber || ''}
                        onChange={(e) => {
                          const updated = [...machineForms];
                          updated[i].jobNumber = e.target.value;
                          setMachineForms(updated);
                          setMachineInfo(updated);
                        }}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const updated = machineForms.filter((_, idx) => idx !== i);
                      setMachineForms(updated);
                      setMachineInfo(updated);
                    }}
                    className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                  >
                    Remove Machine
                  </button>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-center">No machines added</p>
            )}
            <button
              onClick={() => {
                const newMachine = { model: '', serial: '', jobNumber: '' };
                setMachineForms(prev => [...prev, newMachine]);
                setMachineInfo(prev => [...prev, newMachine]);
              }}
              className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition"
            >
              Add Machine
            </button>
          </div>
        )}
      </div>

      {/* SERVICE WORK PERFORMED */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
        <button
          onClick={() => toggleSection('serviceReport')}
          className="w-full text-left text-xl font-semibold text-blue-600 flex justify-between items-center"
        >
          Service Worked Performed
          <span className="text-sm">{openSections.serviceReport ? '−' : '+'}</span>
        </button>
        {openSections.serviceReport && (
          <div className="mt-4">
            {entries.length > 0 ? (
              entries.map((entry, i) => (
                <div key={i} className="mb-4 p-4 border rounded bg-gray-50">
                  <p className="font-medium text-sm text-gray-700">
                    {formatDateWithDay(entry.date)} — {entry.customer}
                  </p>
                  <textarea
                    value={serviceReportForm[entry.date] || ''}
                    onChange={(e) => {
                      setServiceReportForm(prev => ({ ...prev, [entry.date]: e.target.value }));
                      setServiceReportData(prev => ({ ...prev, [entry.date]: e.target.value }));
                    }}
                    className="mt-2 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    rows="4"
                    placeholder="Describe work performed..."
                  />
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-center">No entries yet</p>
            )}
          </div>
        )}
      </div>

      {/* DAILY TIME ENTRIES */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold">Daily Time Entries</h3>
          <button onClick={handleAddDayClick} className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition">
            Add Day
          </button>
        </div>
        <SavedEntriesTable
          key={tableKey}
          entries={entries}
          onEdit={handleEdit}
          onDelete={handleDeleteDay}
        />
      </div>

      {/* Charges breakouts (driven by calculateCharges) */}
      <ServiceChargesTable charges={charges} />

      {/* ===== Totals (Service → Travel Charges → Travel Expenses → Grand Total) ===== */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-10">
        <h3 className="text-xl font-semibold mb-4">Totals</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 border rounded">
            <p className="text-sm text-gray-600">Service Charges</p>
            <p className="text-2xl font-bold">${fmt(serviceChargesTotal)}</p>
          </div>
          <div className="p-4 border rounded">
            <p className="text-sm text-gray-600">Travel Charges</p>
            <p className="text-2xl font-bold">${fmt(travelChargesSubtotal)}</p>
          </div>
          <div className="p-4 border rounded">
            <p className="text-sm text-gray-600">Travel Expenses</p>
            <p className="text-2xl font-bold">${fmt(travelExpensesSubtotal)}</p>
          </div>
          <div className="p-4 border rounded bg-blue-50">
            <p className="text-sm text-gray-700">Grand Total</p>
            <p className="text-3xl font-extrabold text-blue-700">${fmt(grandTotal)}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-center gap-4 mt-8">
        <button onClick={handleAddDayClick} className="px-6 py-3 bg-emerald-600 text-white text-lg font-medium rounded-md hover:bg-emerald-700 transition">
          Add Day
        </button>
        <button onClick={handleReset} className="px-6 py-3 bg-red-600 text-white text-lg font-medium rounded-md hover:bg-red-700 transition">
          Reset All
        </button>
      </div>

      {/* HISTORY MODAL */}
      {showHistory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-screen overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Save History for {currentCustomer}</h3>
              <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-gray-700">×</button>
            </div>
            {saveHistory.length > 0 ? (
              <div className="space-y-2">
                {saveHistory.map((save) => (
                  <div key={save.id} className="flex justify-between items-center p-3 border rounded hover:bg-gray-50">
                    <div className="flex-1">
                      <p className="font-medium">{save.visitName}</p>
                      <p className="text-sm text-gray-600">
                        {new Date(save.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => renameVisit(save.id, save.visitName)}
                        className="px-2 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => {
                          loadFromHistory(save.id);
                          setShowHistory(false);
                        }}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => {
                          deleteVisit(save.id);
                          setSaveHistory(prev => prev.filter(s => s.id !== save.id));
                        }}
                        className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center">No saves yet</p>
            )}
          </div>
        </div>
      )}

      {/* CLOUD FILES MODAL */}
      {showCloudFiles && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">All Cloud Files</h3>
              <button onClick={() => setShowCloudFiles(false)} className="text-gray-500 hover:text-gray-700">×</button>
            </div>

            <div className="mb-4">
              <select
                className="px-4 py-2 border border-gray-300 rounded-md bg-white"
                value={selectedCustomer}
                onChange={(e) => setSelectedCustomer(e.target.value)}
              >
                <option value="">All Customers</option>
                {customers.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              {allCloudFiles
                .filter(f => !selectedCustomer || f.customer === selectedCustomer)
                .map(file => (
                  <div key={file.id} className="flex justify-between items-center p-3 border rounded hover:bg-gray-50">
                    <div className="flex-1">
                      <p className="font-medium">{file.visitName}</p>
                      <p className="text-sm text-gray-600">
                        Customer: {file.customer} — {new Date(file.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => renameVisit(file.id, file.visitName)}
                        className="px-2 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => {
                          loadFromHistory(file.id);
                          setShowCloudFiles(false);
                        }}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => {
                          const newCustomer = prompt(`Attach to customer:`, file.customer);
                          if (newCustomer && newCustomer !== file.customer) {
                            attachToCustomer(file.id, newCustomer);
                            file.customer = newCustomer;
                          }
                        }}
                        className="px-3 py-1 bg-violet-600 text-white rounded text-sm hover:bg-violet-700"
                      >
                        Attach
                      </button>
                      <button
                        onClick={() => {
                          deleteVisit(file.id);
                          setAllCloudFiles(prev => prev.filter(s => s.id !== file.id));
                        }}
                        className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
            </div>
            {allCloudFiles.length === 0 && (
              <p className="text-gray-500 text-center">No files in cloud</p>
            )}
          </div>
        </div>
      )}

      {showTimeEntryForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-2xl font-bold">{editEntryIndex !== null ? 'Edit Day' : 'Add Day'}</h3>
                <button
                  onClick={() => setShowTimeEntryForm(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ×
                </button>
              </div>
              <TimeEntryForm
                entry={editEntryIndex !== null ? entries[editEntryIndex] : null}
                onSave={handleAddDaySave}
                onCancel={() => setShowTimeEntryForm(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* HELP MODAL */}
      {showHelp && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-screen overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-blue-600">Help Guide</h3>
                <button
                  onClick={() => setShowHelp(false)}
                  className="text-gray-500 hover:text-gray-700 text-3xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="space-y-6">
                <section>
                  <h4 className="text-lg font-semibold text-gray-800 mb-3">Customer Management</h4>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li><strong>Select Customer:</strong> Choose from existing customers or create a new one</li>
                    <li><strong>New:</strong> Create a new customer profile</li>
                    <li><strong>Rename:</strong> Change the name of the selected customer</li>
                    <li><strong>Delete:</strong> Remove the customer and all associated data (local and cloud)</li>
                  </ul>
                </section>

                <section>
                  <h4 className="text-lg font-semibold text-gray-800 mb-3">Navigation</h4>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li><strong>Time Sheet:</strong> Main page for entering time and expense data</li>
                    <li><strong>Service Report:</strong> Generate and preview a service report PDF</li>
                    <li><strong>Invoice:</strong> Generate and preview an invoice PDF</li>
                  </ul>
                </section>

                <section>
                  <h4 className="text-lg font-semibold text-gray-800 mb-3">Data Management</h4>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li><strong>Export JSON:</strong> Download customer data as a JSON file for backup</li>
                    <li><strong>Import JSON:</strong> Upload a previously exported JSON file to restore data</li>
                    <li><strong>Save Local:</strong> Save current customer data to browser's local storage</li>
                    <li><strong>Save Cloud:</strong> Upload current data to cloud storage (requires authentication)</li>
                    <li><strong>Load Cloud:</strong> Load previously saved data from cloud storage</li>
                    <li><strong>View Files:</strong> Browse all cloud-saved files across all customers</li>
                    <li><strong>Export PDF:</strong> Generate and download a PDF of the current timesheet</li>
                    <li><strong>Reset All:</strong> Clear all data and start fresh (cannot be undone)</li>
                  </ul>
                </section>

                <section>
                  <h4 className="text-lg font-semibold text-gray-800 mb-3">Main Sections</h4>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li><strong>Customer Information:</strong> Enter client details (company, contact, address, etc.)</li>
                    <li><strong>Travel:</strong> Record travel expenses including per diem, mileage, and airfare</li>
                    <li><strong>Invoice Details:</strong> Set invoice number, dates, PO reference, and payment terms</li>
                    <li><strong>Machine Information:</strong> Add equipment details (model, serial number, job number)</li>
                    <li><strong>Service Work Performed:</strong> Describe the work done for each day</li>
                    <li><strong>Daily Time Entries:</strong> Add time entries with travel and work hours</li>
                  </ul>
                </section>

                <section>
                  <h4 className="text-lg font-semibold text-gray-800 mb-3">Time Entry</h4>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li><strong>Add Day:</strong> Create a new time entry with travel times, work hours, and lunch breaks</li>
                    <li><strong>Edit:</strong> Modify an existing time entry</li>
                    <li><strong>Delete:</strong> Remove a time entry</li>
                  </ul>
                </section>

                <section>
                  <h4 className="text-lg font-semibold text-gray-800 mb-3">Charges Calculation</h4>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li><strong>Service Charges:</strong> Calculated based on work hours (Straight: $120/hr, Sat/OT: $180/hr, Sun/Hol: $240/hr)</li>
                    <li><strong>Travel Charges:</strong> Calculated based on travel hours (Weekday: $80/hr, Saturday: $120/hr, Sun/Hol: $160/hr)</li>
                    <li><strong>Travel Expenses:</strong> Sum of per diem, mileage, other travel costs, and airfare</li>
                    <li><strong>Grand Total:</strong> Sum of all charges and expenses</li>
                  </ul>
                </section>
              </div>

              <div className="mt-6 pt-4 border-t">
                <button
                  onClick={() => setShowHelp(false)}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TimeSheet;

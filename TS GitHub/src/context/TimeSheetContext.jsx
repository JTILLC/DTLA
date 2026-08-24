// src/context/TimeSheetContext.jsx
import React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, orderBy, limit, where, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const TimeSheetContext = createContext();

export function TimeSheetProvider({ children }) {
  const [entries, setEntries] = useState([]);
  const [customerInfo, setCustomerInfo] = useState({});
  const [travelData, setTravelData] = useState({});
  const [serviceReportData, setServiceReportData] = useState({});
  const [invoiceInfo, setInvoiceInfo] = useState({});
  const [machineInfo, setMachineInfo] = useState([]);

  const [customerForm, setCustomerForm] = useState({});
  const [travelForm, setTravelForm] = useState({});
  const [invoiceForm, setInvoiceForm] = useState({});
  const [machineForms, setMachineForms] = useState([]);
  const [serviceReportForm, setServiceReportForm] = useState({});

  const [currentCustomer, setCurrentCustomer] = useState('');
  const [customers, setCustomers] = useState([]);
  const [tableKey, setTableKey] = useState(0);
  const [loadedDocId, setLoadedDocId] = useState(null); // Track which cloud document is currently loaded
  const [loadedDocName, setLoadedDocName] = useState(''); // Track the name of the loaded document

  // LOAD CUSTOMERS FROM CLOUD + LOCAL
  useEffect(() => {
    const loadCustomers = async () => {
      try {
        const q = query(
          collection(db, 'timesheets'),
          where('customer', '!=', null),
          limit(1000)
        );
        const snapshot = await getDocs(q);
        const cloudCustomers = [...new Set(snapshot.docs.map(doc => doc.data().customer).filter(c => c))];
        const localCustomers = localStorage.getItem('customers') ? JSON.parse(localStorage.getItem('customers')) : [];
        const allCustomers = [...new Set([...cloudCustomers, ...localCustomers])];
        setCustomers(allCustomers);
        localStorage.setItem('customers', JSON.stringify(allCustomers));
      } catch (error) {
        console.error('Failed to load customers from cloud:', error);
        const local = localStorage.getItem('customers');
        if (local) setCustomers(JSON.parse(local));
      }
    };
    loadCustomers();
  }, []);

  const addCustomer = (name) => {
    if (!name || customers.includes(name)) return;
    setCustomers(prev => [...prev, name]);
    setCurrentCustomer(name);
  };

  const switchCustomer = (name) => {
    setCurrentCustomer(name);
    const key = `customer-${name}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      const data = JSON.parse(saved);
      setEntries(data.entries || []);
      setCustomerInfo(data.customerInfo || {});
      setTravelData(data.travelData || {});
      setServiceReportData(data.serviceReportData || {});
      setInvoiceInfo(data.invoiceInfo || {});
      setMachineInfo(Array.isArray(data.machineInfo) ? data.machineInfo : []);

      const machines = Array.isArray(data.machineInfo) ? data.machineInfo : [];
      setMachineInfo(machines);
      setMachineForms(machines.map(m => ({
        model: m.model || '',
        serial: m.serial || m.serialNumber || '',
        jobNumber: m.jobNumber || ''
      })));

      setCustomerForm(data.customerInfo || {});
      setTravelForm(data.travelData || {});
      setInvoiceForm(data.invoiceInfo || {});
      setServiceReportForm(data.serviceReportData || {});

      setTableKey(prev => prev + 1);
    } else {
      setEntries([]);
      setCustomerInfo({});
      setTravelData({});
      setServiceReportData({});
      setInvoiceInfo({});
      setMachineInfo([]);
      setMachineForms([]);
      setCustomerForm({});
      setTravelForm({});
      setInvoiceForm({});
      setServiceReportForm({});
      setTableKey(prev => prev + 1);
    }
  };

  const saveCurrentCustomer = () => {
    if (!currentCustomer) return;
    const data = {
      entries,
      customerInfo,
      travelData,
      serviceReportData,
      invoiceInfo,
      machineInfo
    };
    localStorage.setItem(`customer-${currentCustomer}`, JSON.stringify(data));
  };

  const exportCustomerJSON = () => {
    if (!currentCustomer) {
      alert('Please select a customer first');
      return;
    }
    const data = {
      entries,
      customerInfo,
      travelData,
      serviceReportData,
      invoiceInfo,
      machineInfo
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${currentCustomer.replace(/[^a-z0-9]/gi, '_')}_timesheet.json`;
    a.click();
  };

  const importCustomerJSON = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const customerName = data.customerInfo?.company?.trim();

        if (!customerName) {
          alert('Invalid JSON: Missing "customerInfo.company" field');
          return;
        }

        const key = `customer-${customerName}`;
        localStorage.setItem(key, JSON.stringify(data));

        if (!customers.includes(customerName)) {
          const updatedCustomers = [...customers, customerName];
          setCustomers(updatedCustomers);
          localStorage.setItem('customers', JSON.stringify(updatedCustomers));
        }

        const machines = Array.isArray(data.machineInfo) ? data.machineInfo : [];
        setMachineInfo(machines);
        setMachineForms(machines.map(m => ({
          model: m.model || '',
          serial: m.serial || m.serialNumber || '',
          jobNumber: m.jobNumber || ''
        })));

        switchCustomer(customerName);
        alert(`Imported: ${customerName}`);
      } catch (error) {
        console.error('Import failed:', error);
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const saveToCloud = async () => {
    if (!currentCustomer) {
      alert('Select a customer first');
      return;
    }

    // If we have a loaded document, ask if user wants to overwrite or create new
    let shouldOverwrite = false;
    let visitName = '';

    if (loadedDocId) {
      const choice = confirm(
        `You loaded "${loadedDocName}" from cloud.\n\n` +
        `Click OK to OVERWRITE this file.\n` +
        `Click Cancel to create a NEW file.`
      );

      if (choice) {
        // Overwrite existing
        shouldOverwrite = true;
        visitName = loadedDocName;
      } else {
        // Create new - ask for name
        const defaultName = `Visit ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        visitName = prompt('Name this NEW visit (e.g., "June 2025 Visit")', defaultName);
        if (!visitName) return;
      }
    } else {
      // No loaded document - create new
      const defaultName = `Visit ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      visitName = prompt('Name this visit (e.g., "June 2025 Visit")', defaultName);
      if (!visitName) return;
    }

    const data = {
      customer: currentCustomer,
      visitName: visitName.trim(),
      entries,
      customerInfo,
      travelData,
      serviceReportData,
      invoiceInfo,
      machineInfo,
      timestamp: new Date().toISOString()
    };

    try {
      if (shouldOverwrite && loadedDocId) {
        // Update existing document
        const docRef = doc(db, 'timesheets', loadedDocId);
        await updateDoc(docRef, data);
        alert(`Updated: "${visitName}"`);
      } else {
        // Create new document
        const newDocRef = await addDoc(collection(db, 'timesheets'), data);
        // Set the new document as loaded
        setLoadedDocId(newDocRef.id);
        setLoadedDocName(visitName.trim());
        alert(`Saved: "${visitName}"`);
      }
    } catch (error) {
      console.error('Cloud save failed:', error);
      alert('Failed to save');
    }
  };

  const loadFromCloud = async () => {
    if (!currentCustomer) {
      alert('Select a customer first');
      return;
    }
    try {
      const q = query(
        collection(db, 'timesheets'),
        where('customer', '==', currentCustomer),
        orderBy('timestamp', 'desc'),
        limit(1)
      );
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        alert('No cloud data found');
        return;
      }
      const loadedDoc = snapshot.docs[0];
      const data = loadedDoc.data();
      setEntries(data.entries || []);
      setCustomerInfo(data.customerInfo || {});
      setTravelData(data.travelData || {});
      setServiceReportData(data.serviceReportData || {});
      setInvoiceInfo(data.invoiceInfo || {});
      setMachineInfo(Array.isArray(data.machineInfo) ? data.machineInfo : []);

      setCustomerForm(data.customerInfo || {});
      setTravelForm(data.travelData || {});
      setInvoiceForm(data.invoiceInfo || {});
      setMachineForms(Array.isArray(data.machineInfo) ? data.machineInfo.map(m => ({
        model: m.model || '',
        serial: m.serial || m.serialNumber || '',
        jobNumber: m.jobNumber || ''
      })) : []);
      setServiceReportForm(data.serviceReportData || {});

      // Track which document was loaded
      setLoadedDocId(loadedDoc.id);
      setLoadedDocName(data.visitName || 'Latest');

      setTableKey(prev => prev + 1);
      alert(`Loaded: ${data.visitName || 'Latest'}`);
    } catch (error) {
      console.error('Cloud load failed:', error);
      alert('Failed to load');
    }
  };

  const loadFromHistory = async (docId, visitName = '') => {
    try {
      const docRef = doc(db, 'timesheets', docId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        alert('Version not found');
        return;
      }

      const data = docSnap.data();
      setEntries(data.entries || []);
      setCustomerInfo(data.customerInfo || {});
      setTravelData(data.travelData || {});
      setServiceReportData(data.serviceReportData || {});
      setInvoiceInfo(data.invoiceInfo || {});
      setMachineInfo(Array.isArray(data.machineInfo) ? data.machineInfo : []);

      setCustomerForm(data.customerInfo || {});
      setTravelForm(data.travelData || {});
      setInvoiceForm(data.invoiceInfo || {});
      setMachineForms(Array.isArray(data.machineInfo) ? data.machineInfo.map(m => ({
        model: m.model || '',
        serial: m.serial || m.serialNumber || '',
        jobNumber: m.jobNumber || ''
      })) : []);
      setServiceReportForm(data.serviceReportData || {});

      // Track which document was loaded so we can overwrite it later
      setLoadedDocId(docId);
      setLoadedDocName(visitName || data.visitName || 'Visit');

      // Update current customer if different
      if (data.customer && data.customer !== currentCustomer) {
        setCurrentCustomer(data.customer);
      }

      setTableKey(prev => prev + 1);
      alert(`Loaded: ${data.visitName || 'Visit'}`);
    } catch (error) {
      console.error('Load failed:', error);
      alert('Failed to load version');
    }
  };

  const renameVisit = async (docId, currentName) => {
    const newName = prompt('Rename visit:', currentName);
    if (!newName || newName === currentName) return;

    try {
      const docRef = doc(db, 'timesheets', docId);
      await updateDoc(docRef, { visitName: newName.trim() });
      alert(`Renamed to: "${newName}"`);
    } catch (error) {
      console.error('Rename failed:', error);
      alert('Failed to rename');
    }
  };

  const deleteVisit = async (docId) => {
    if (!confirm('Delete this visit permanently?')) return;

    try {
      const docRef = doc(db, 'timesheets', docId);
      await deleteDoc(docRef);
      alert('Visit deleted');
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete');
    }
  };

  const fetchAllCloudFiles = async () => {
    try {
      const q = query(collection(db, 'timesheets'), orderBy('timestamp', 'desc'));
      const snapshot = await getDocs(q);
      const files = snapshot.docs.map(doc => ({
        id: doc.id,
        customer: doc.data().customer,
        visitName: doc.data().visitName || 'Unnamed Visit',
        timestamp: doc.data().timestamp,
        data: doc.data()
      }));
      return files;
    } catch (error) {
      console.error('Failed to load all files:', error);
      return [];
    }
  };

  const attachToCustomer = async (fileId, newCustomer) => {
    if (!newCustomer) return;

    try {
      const fileRef = doc(db, 'timesheets', fileId);
      await updateDoc(fileRef, { customer: newCustomer });
      alert(`Attached to "${newCustomer}"`);
    } catch (error) {
      console.error('Attach failed:', error);
      alert('Failed to attach');
    }
  };

  const deleteCustomer = async (name) => {
    if (!confirm(`Delete "${name}"? All data (local + cloud) will be lost.`)) return;

    try {
      localStorage.removeItem(`customer-${name}`);
      setCustomers(prev => prev.filter(c => c !== name));
      localStorage.setItem('customers', JSON.stringify(customers.filter(c => c !== name)));

      const q = query(
        collection(db, 'timesheets'),
        where('customer', '==', name)
      );
      const snapshot = await getDocs(q);
      // v9 modular SDK: doc.ref.delete() does not exist; use deleteDoc and await all
      await Promise.all(snapshot.docs.map(d => deleteDoc(d.ref)));

      if (currentCustomer === name) setCurrentCustomer('');
      alert(`Deleted "${name}"`);
    } catch (error) {
      console.error('Delete customer failed:', error);
      alert('Failed to delete');
    }
  };

  const addEntry = (entry) => {
    setEntries(prev => {
      const newEntry = { ...entry, customer: currentCustomer || 'General' };
      return [...prev, newEntry];
    });
    setTableKey(prev => prev + 1);
  };

  const updateEntry = (index, entry) => {
    setEntries(prev => {
      const updated = [...prev];
      updated[index] = { ...entry, customer: currentCustomer };
      return updated;
    });
    setTableKey(prev => prev + 1);
  };

  const resetData = () => {
    setEntries([]);
    setCustomerInfo({});
    setTravelData({});
    setServiceReportData({});
    setInvoiceInfo({});
    setMachineInfo([]);
    setCustomerForm({});
    setTravelForm({});
    setInvoiceForm({});
    setMachineForms([]);
    setServiceReportForm({});
    // Clear loaded document tracking when resetting
    setLoadedDocId(null);
    setLoadedDocName('');
  };

  // Function to clear loaded document (for creating new)
  const clearLoadedDoc = () => {
    setLoadedDocId(null);
    setLoadedDocName('');
  };

  const importData = (data) => {
    setEntries(data.entries || []);
    setCustomerInfo(data.customerInfo || {});
    setTravelData(data.travelData || {});
    setServiceReportData(data.serviceReportData || {});
    setInvoiceInfo(data.invoiceInfo || {});
    const machines = Array.isArray(data.machineInfo) ? data.machineInfo : [];
    setMachineInfo(machines);
    setMachineForms(machines.map(m => ({
      model: m.model || '',
      serial: m.serial || m.serialNumber || '',
      jobNumber: m.jobNumber || ''
    })));
    setCustomerForm(data.customerInfo || {});
    setTravelForm(data.travelData || {});
    setInvoiceForm(data.invoiceInfo || {});
    setServiceReportForm(data.serviceReportData || {});
  };

  const renameCustomer = async (oldName, newName) => {
    if (!oldName || !newName || oldName === newName || customers.includes(newName)) {
      alert('Invalid rename');
      return;
    }

    if (!confirm(`Rename "${oldName}" to "${newName}"? All data will move.`)) return;

    try {
      const oldKey = `customer-${oldName}`;
      const oldData = localStorage.getItem(oldKey);
      if (!oldData) {
        alert('No data found for old customer');
        return;
      }

      const data = JSON.parse(oldData);
      data.customer = newName;

      const newKey = `customer-${newName}`;
      localStorage.setItem(newKey, JSON.stringify(data));
      localStorage.removeItem(oldKey);

      const updatedCustomers = customers.filter(c => c !== oldName);
      updatedCustomers.push(newName);
      setCustomers(updatedCustomers);
      localStorage.setItem('customers', JSON.stringify(updatedCustomers));

      if (currentCustomer === oldName) setCurrentCustomer(newName);

      const oldQuery = query(
        collection(db, 'timesheets'),
        where('customer', '==', oldName),
        orderBy('timestamp', 'desc')
      );
      const oldSnapshot = await getDocs(oldQuery);
      if (!oldSnapshot.empty) {
        const oldDoc = oldSnapshot.docs[0];
        const oldDocData = oldDoc.data();
        oldDocData.customer = newName;
        oldDocData.timestamp = new Date().toISOString();

        await addDoc(collection(db, 'timesheets'), oldDocData);
        await deleteDoc(oldDoc.ref);
      }

      alert(`Renamed: "${oldName}" to "${newName}"`);
    } catch (error) {
      console.error('Rename failed:', error);
      alert('Rename failed');
    }
  };

  return (
    <TimeSheetContext.Provider
      value={{
        entries,
        setEntries,
        customerInfo,
        setCustomerInfo,
        travelData,
        setTravelData,
        serviceReportData,
        setServiceReportData,
        invoiceInfo,
        setInvoiceInfo,
        machineInfo,
        setMachineInfo,
        addEntry,
        updateEntry,
        resetData,
        importData,
        currentCustomer,
        customers,
        addCustomer,
        switchCustomer,
        saveCurrentCustomer,
        exportCustomerJSON,
        importCustomerJSON,
        saveToCloud,
        loadFromCloud,
        loadFromHistory,
        renameVisit,
        deleteVisit,
        fetchAllCloudFiles,
        attachToCustomer,
        deleteCustomer,
        customerForm,
        setCustomerForm,
        travelForm,
        setTravelForm,
        invoiceForm,
        setInvoiceForm,
        machineForms,
        setMachineForms,
        serviceReportForm,
        setServiceReportForm,
        tableKey,
        renameCustomer,
        loadedDocId,
        loadedDocName,
        clearLoadedDoc
      }}
    >
      {children}
    </TimeSheetContext.Provider>
  );
}

export function useTimeSheet() {
  return useContext(TimeSheetContext);
}
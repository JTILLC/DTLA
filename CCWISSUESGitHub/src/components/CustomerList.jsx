// src/components/CustomerList.jsx
import { useState, useEffect, useRef } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const CustomerList = ({ onSelectCustomer }) => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    address: '',
    cityState: '',
    headCount: '14',
  });
  const fileInputRef = useRef(null);
  const user = firebase.auth().currentUser;

  // ---------- LIVE CUSTOMER LIST ----------
  useEffect(() => {
    if (!user) return;
    const unsub = firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .orderBy('name')
      .onSnapshot((snap) => {
        const list = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data().profile,
        }));
        setCustomers(list);
        setLoading(false);
      });
    return () => unsub();
  }, [user]);

  // ---------- ADD NEW CUSTOMER ----------
  const handleAddCustomer = async (e) => {
    e.preventDefault();
    if (!user || !newCustomer.name.trim()) return;

    const custRef = firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .doc();

    await custRef.set({
      profile: {
        name: newCustomer.name.trim(),
        address: newCustomer.address.trim(),
        cityState: newCustomer.cityState.trim(),
        headCount: parseInt(newCustomer.headCount) || 14,
      },
    });

    setNewCustomer({ name: '', address: '', cityState: '', headCount: '14' });
    setShowAddForm(false);
  };

  // ---------- IMPORT LEGACY JSON ----------
  const handleImportLegacy = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.json')) {
      alert('Please select a valid .json file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const { globalData, lines } = data;
        if (!globalData?.customer) throw new Error('Missing customer name');

        const name = globalData.customer.trim();
        const key = name.toLowerCase().replace(/[^a-z0-9]/g, '_');

        // Create / reuse customer
        const custRef = firebase
          .firestore()
          .collection('user_files')
          .doc(user.uid)
          .collection('customers')
          .doc(key);

        const custSnap = await custRef.get();
        if (!custSnap.exists) {
          await custRef.set({
            profile: {
              name,
              address: globalData.address || '',
              cityState: globalData.cityState || '',
              headCount: parseInt(globalData.headCount) || 14,
            },
          });
        }

        // Save as new visit
        const visitId = `visit_${new Date()
          .toISOString()
          .replace(/[-:.]/g, '')
          .slice(0, 15)}`;
        await custRef.collection('visits').doc(visitId).set({
          date: new Date().toISOString(),
          globalData,
          lines: JSON.parse(JSON.stringify(lines)),
        });

        alert(`Imported "${name}" – new visit created!`);
        onSelectCustomer(key, {
          name,
          address: globalData.address || '',
          cityState: globalData.cityState || '',
          headCount: parseInt(globalData.headCount) || 14,
        });
      } catch (err) {
        console.error(err);
        alert(`Import failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
    fileInputRef.current.value = '';
  };

  // ---------- UI ----------
  if (loading) return <div>Loading customers…</div>;

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Customers</h2>

      {/* IMPORT */}
      <div style={{ marginBottom: '15px' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImportLegacy}
          style={{ display: 'block', marginBottom: '5px' }}
        />
        <small>Upload old <code>IshidaIssueLog*.json</code> files</small>
      </div>

      {/* CUSTOMER LIST (dropdown style) */}
      {customers.length > 0 && (
        <select
          onChange={(e) => {
            const c = customers.find((c) => c.id === e.target.value);
            if (c) onSelectCustomer(c.id, c);
          }}
          style={{ width: '100%', padding: '8px', marginBottom: '15px' }}
        >
          <option value="">-- Select a customer --</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.headCount} heads)
            </option>
          ))}
        </select>
      )}

      {/* LIST VIEW (fallback) */}
      {customers.length === 0 ? (
        <p>No customers yet. Add one or import a JSON.</p>
      ) : (
        <div style={{ marginBottom: '20px' }}>
          {customers.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelectCustomer(c.id, c)}
              style={{
                padding: '12px',
                margin: '6px 0',
                border: '1px solid #ccc',
                borderRadius: '6px',
                background: '#f9f9f9',
                cursor: 'pointer',
              }}
            >
              <strong>{c.name}</strong>
              <div style={{ fontSize: '0.9em', color: '#555' }}>
                {c.address} • {c.cityState}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADD NEW */}
      <button onClick={() => setShowAddForm(!showAddForm)}>
        {showAddForm ? 'Cancel' : 'Add New Customer'}
      </button>

      {showAddForm && (
        <form onSubmit={handleAddCustomer} style={{ marginTop: '15px', padding: '12px', border: '1px solid #ddd', borderRadius: '6px' }}>
          <h3>Add Customer</h3>
          <input
            placeholder="Customer Name *"
            value={newCustomer.name}
            onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
            required
            style={{ display: 'block', width: '100%', margin: '6px 0', padding: '6px' }}
          />
          <input
            placeholder="Address"
            value={newCustomer.address}
            onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
            style={{ display: 'block', width: '100%', margin: '6px 0', padding: '6px' }}
          />
          <input
            placeholder="City, State"
            value={newCustomer.cityState}
            onChange={(e) => setNewCustomer({ ...newCustomer, cityState: e.target.value })}
            style={{ display: 'block', width: '100%', margin: '6px 0', padding: '6px' }}
          />
          <input
            type="number"
            placeholder="Head Count"
            value={newCustomer.headCount}
            onChange={(e) => setNewCustomer({ ...newCustomer, headCount: e.target.value })}
            min="1"
            style={{ display: 'block', width: '100%', margin: '6px 0', padding: '6px' }}
          />
          <button type="submit" style={{ marginTop: '8px' }}>
            Save Customer
          </button>
        </form>
      )}
    </div>
  );
};

export default CustomerList;
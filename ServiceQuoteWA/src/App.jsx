import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import initialData from './data/quoteData.json';

const STORAGE_KEY = 'serviceQuoteData';

export default function App() {
  // Load from localStorage or fallback to initialData
  const [data, setData] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
    return {
      customerName: initialData.customer.name || '',
      datesValue: initialData.dates.value || '',
      dateOfQuoteValue: initialData.dateOfQuote.value || '',
      quoteNumberValue: initialData.quoteNumber.value || '',
      items: initialData.items.map(i => ({ ...i, quantity: '', cost: '' })),
      notes: initialData.notes || ''
    };
  });

  const { customerName, datesValue, dateOfQuoteValue, quoteNumberValue, items, notes } = data;
  const [logoUrl] = useState(initialData.logoUrl);
  const [quoteTitle] = useState(initialData.quoteTitle);
  const [business] = useState(initialData.business);
  const [message] = useState(initialData.message);

  // Persist changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const editQuantity = (index, value) => {
    setData(prev => {
      const updatedItems = [...prev.items];
      const rate = updatedItems[index].rate;
      const qty = value === '' ? '' : Number(value);
      const cost = qty === '' ? '' : (rate * qty).toString();
      updatedItems[index] = { ...updatedItems[index], quantity: value, cost };
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
    const clearedItems = initialData.items.map(i => ({ ...i, quantity: '', cost: '' }));
    const clearedData = {
      customerName: '',
      datesValue: '',
      dateOfQuoteValue: '',
      quoteNumberValue: '',
      items: clearedItems,
      notes: ''
    };
    setData(clearedData);
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleClearAll = () => {
    if (window.confirm("Are you sure you want to clear all data? This action cannot be undone.")) {
      clearAll();
    }
  };

  const exportJSON = () => {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ServiceQuote_${quoteNumberValue || 'data'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target.result);
        // Validate structure
        if (
          typeof importedData.customerName === 'string' &&
          typeof importedData.datesValue === 'string' &&
          typeof importedData.dateOfQuoteValue === 'string' &&
          typeof importedData.quoteNumberValue === 'string' &&
          Array.isArray(importedData.items) &&
          importedData.items.every(
            item =>
              typeof item.service === 'string' &&
              (typeof item.rate === 'number' || item.rate === 'Estimate') &&
              typeof item.unit === 'string' &&
              (typeof item.quantity === 'string' || item.quantity === '') &&
              (typeof item.cost === 'string' || item.cost === '')
          ) &&
          typeof importedData.notes === 'string'
        ) {
          setData(importedData);
        } else {
          alert('Invalid JSON structure. Please ensure the file matches the expected format.');
        }
      } catch (error) {
        alert('Error parsing JSON file. Please ensure it is a valid JSON.');
      }
    };
    reader.readAsText(file);
  };

  const totalCost = items.reduce((sum, i) => sum + (parseFloat(i.cost) || 0), 0);
  const totalCostFormatted = totalCost.toFixed(2);

  const exportPDF = () => {
    const doc = new jsPDF({ unit: 'pt' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    // Header
    const imgWidth = 100;
    const imgHeight = 40;
    const imgX = (pageWidth - imgWidth) / 2;
    doc.addImage(logoUrl, 'PNG', imgX, 40, imgWidth, imgHeight);
    const titleY = 40 + imgHeight + 20;
    doc.setFontSize(22).text(quoteTitle, pageWidth / 2, titleY, { align: 'center' });
    // Business info
    doc.setFontSize(11);
    doc.text(business.name, 40, 130);
    doc.text(business.address, 40, 145);
    doc.text(business.contact, 40, 160);
    // Editable fields
    doc.text('Customer: ' + customerName, 350, 130);
    doc.text('Dates: ' + datesValue, 350, 145);
    doc.text('Date of Quote: ' + dateOfQuoteValue, 350, 160);
    doc.text('Quote #: ' + quoteNumberValue, 350, 175);
    // Message
    doc.text(message, 40, 200, { maxWidth: 520 });
    // Table
    doc.autoTable({
      startY: 240,
      head: [['Service', 'Rate', 'Unit', 'Qty', 'Cost']],
      body: data.items.map(i => [
          i.service,
          i.rate,
          i.unit,
          i.quantity || '',
          i.cost !== '' ? Number(i.cost).toFixed(2) : ''
        ]),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [200, 200, 200] }
    });
    // Total, right-aligned
    const finalY = doc.lastAutoTable.finalY + 20;
    const totalCostFormatted = totalCost.toFixed(2);
    doc.setFontSize(12).text(
      'Total Estimated Cost: $' + totalCostFormatted,
      pageWidth - 40,
      finalY,
      { align: 'right' }
    );
    // Notes
    doc.setFontSize(11);
    doc.text('NOTES:', 40, finalY + 30);
    doc.text(data.notes || '', 40, finalY + 45, { maxWidth: 520 });

    const terms = "Terms and conditions: Approval of this quote by a Purchase Order constitutes a minimum daily charge while on site of $500 (local, meaning within 2 hour drive of Gilbert, AZ) or $960 (non-local, meaning outside of 2 hour drive of Gilbert, AZ) for diagnostics / troubleshooting.";
    doc.setFontSize(11).text(terms, 40, pageHeight - 60, { maxWidth: pageWidth - 80 });

    // Save
    doc.save('ServiceQuote_' + quoteNumberValue + '.pdf');
  };

  return (
    <div className="p-8 font-sans">
      <div className="flex justify-between items-center mb-6">
        <img src={logoUrl} alt="Logo" className="h-12" />
        <h1 className="text-2xl font-bold">{quoteTitle}</h1>
      </div>

      {/* Editable fields */}
      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <label className="block mb-1">Customer:</label>
          <input
            className="w-full border p-1"
            value={customerName}
            onChange={e => setData({ ...data, customerName: e.target.value })}
          />
          <label className="block mt-2 mb-1">Dates:</label>
          <input
            className="w-full border p-1"
            value={datesValue}
            onChange={e => setData({ ...data, datesValue: e.target.value })}
          />
        </div>
        <div>
          <label className="block mb-1">Date of Quote:</label>
          <input
            className="w-full border p-1"
            value={dateOfQuoteValue}
            onChange={e => setData({ ...data, dateOfQuoteValue: e.target.value })}
          />
          <label className="block mt-2 mb-1">Quote #:</label>
          <input
            className="w-full border p-1"
            value={quoteNumberValue}
            onChange={e => setData({ ...data, quoteNumberValue: e.target.value })}
          />
        </div>
      </div>

      <p className="mb-4 text-sm">{message}</p>

      {/* Services Table */}
      <table className="w-full mb-4 border-collapse text-sm">
        <thead className="bg-gray-200">
          <tr>
            <th className="border p-2">Service</th>
            <th className="border p-2">Rate</th>
            <th className="border p-2">Unit</th>
            <th className="border p-2">Qty</th>
            <th className="border p-2">Cost</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => {
            const isEstimate = i.service.includes('Airline') || i.service.includes('Rental Car');
            return (
              <tr key={idx}>
                <td className="border p-2">{i.service}</td>
                <td className="border p-2">{i.rate}</td>
                <td className="border p-2">{i.unit}</td>
                <td className="border p-2">
                  {isEstimate ? (
                    <span className="text-center">—</span>
                  ) : (
                    <input
                      type="number"
                      className="w-full border p-1"
                      value={i.quantity}
                      onChange={e => editQuantity(idx, e.target.value)}
                    />
                  )}
                </td>
                <td className="border p-2">
                  <input
                    type="number"
                    className="w-full border p-1"
                    value={i.cost}
                    onChange={e => editCost(idx, e.target.value)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Total and Controls */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex space-x-2">
          <button
            onClick={handleClearAll}
            className="px-4 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500"
          >
            Clear All
          </button>
          <button
            onClick={exportJSON}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Export as JSON
          </button>
          <input
            type="file"
            accept=".json"
            onChange={importJSON}
            className="px-4 py-2 border rounded-lg"
          />
        </div>
        <div className="text-lg font-semibold">
          Total Estimated Cost: ${totalCostFormatted}
        </div>
      </div>

      {/* Notes */}
      <div className="mb-6">
        <h2 className="font-semibold mb-2">NOTES:</h2>
        <textarea
          className="w-full border p-2 text-sm"
          rows={5}
          value={notes}
          onChange={e => setData({ ...data, notes: e.target.value })}
        />
      </div>

      {/* Export Button */}
      <button
        onClick={exportPDF}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        Export as PDF
      </button>
    </div>
  );
}
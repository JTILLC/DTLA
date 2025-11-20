import React from 'react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTimeSheet } from '../context/TimeSheetContext';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { calculateCharges } from '../utils/calculations';
import PDFPreview from '../components/PDFPreview/PDFPreview';

function InvoicePage() {
  const context = useTimeSheet();
  const navigate = useNavigate();
  if (!context) {
    console.error('TimeSheetContext is undefined');
    return <div>Error: Time Sheet context is unavailable. Please try refreshing the page.</div>;
  }
  const { customerInfo, entries, travelData, invoiceInfo } = context;
  const [pdfDataUrl, setPdfDataUrl] = useState(null);

  const charges = calculateCharges(entries || [], travelData || {});
  console.log('Charges in InvoicePage:', JSON.stringify(charges, null, 2));

  const formatDate = (dateString) => {
    try {
      console.log('Formatting date:', dateString);
      const [year, month, day] = dateString.split('-').map(Number);
      const date = new Date(year, month - 1, day); // Local date, no UTC to avoid offset
      if (isNaN(date.getTime())) throw new Error('Invalid date');
      const formattedMonth = String(date.getMonth() + 1).padStart(2, '0');
      const formattedDay = String(date.getDate()).padStart(2, '0');
      const yearShort = String(date.getFullYear()).slice(-2);
      console.log(`Formatted date: ${formattedMonth}/${formattedDay}/${yearShort}`);
      return `${formattedMonth}/${formattedDay}/${yearShort}`;
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return 'Invalid Date';
    }
  };

  const generatePDF = (preview = false) => {
    try {
      console.log('Starting Invoice PDF generation', { preview });
      console.log('Customer Info:', JSON.stringify(customerInfo, null, 2));
      console.log('Entries:', JSON.stringify(entries, null, 2));
      console.log('Travel Data:', JSON.stringify(travelData, null, 2));
      console.log('Invoice Info:', JSON.stringify(invoiceInfo, null, 2));
      console.log('Charges:', JSON.stringify(charges, null, 2));

      if (!jsPDF || !autoTable) {
        throw new Error('jsPDF or jspdf-autotable is not loaded correctly.');
      }

      const doc = new jsPDF();
      autoTable(doc, {});

      let yOffset = 10;

      // Title and Contact Info
      doc.setFontSize(9);
      doc.text('Joshua Todd Industries, LLC Invoice', 10, yOffset);
      yOffset += 4;
      doc.text('Address: 1329 N Malibu Lane Gilbert, AZ 85234', 10, yOffset);
      yOffset += 4;
      doc.setFontSize(8);
      doc.text(`Invoice Number: ${invoiceInfo?.invoiceNumber || 'N/A'}`, 10, yOffset);
      doc.text(`Due Date: ${invoiceInfo?.dueDate ? formatDate(invoiceInfo.dueDate) : 'N/A'}`, 100, yOffset);
      yOffset += 4;
      doc.text(`Invoice Date: ${invoiceInfo?.invoiceDate ? formatDate(invoiceInfo.invoiceDate) : 'N/A'}`, 10, yOffset);
      doc.text(`PO Refer: ${invoiceInfo?.poRefer || 'N/A'}`, 100, yOffset);
      yOffset += 4;
      doc.text(`Email: josh@jtiaz.com`, 10, yOffset);
      doc.text(`Service Dates: ${invoiceInfo?.serviceDates || 'N/A'}`, 100, yOffset);
      yOffset += 4;
      doc.text(`Phone: (623) 300-6445`, 10, yOffset);
      doc.text(`Payment Terms: ${invoiceInfo?.paymentTerms || 'N/A'}`, 100, yOffset);
      yOffset += 4;

      // Customer Information Table
      doc.setFontSize(9);
      doc.text('Customer Information', 10, yOffset);
      yOffset += 4;
      const customerFields = [
        ['Company', customerInfo?.company || 'N/A', 'Contact', customerInfo?.contact || 'N/A'],
        ['Address', customerInfo?.address || 'N/A', 'Phone', customerInfo?.phone || 'N/A'],
        ['City', customerInfo?.city || 'N/A', 'Email', customerInfo?.email || 'N/A'],
        ['State', customerInfo?.state || 'N/A', 'Purpose', customerInfo?.purpose || 'N/A'],
      ];
      doc.autoTable({
        startY: yOffset,
        head: [['Field', 'Value', 'Field', 'Value']],
        body: customerFields,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [200, 200, 200], fontSize: 8 },
        margin: { left: 10, right: 10 },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 60 },
          2: { cellWidth: 30 },
          3: { cellWidth: 60 },
        },
      });
      yOffset = doc.lastAutoTable.finalY + 4;

      // Charges Tables
      doc.setFontSize(9);
      doc.text('Service Charges', 10, yOffset);
      yOffset += 4;
      console.log('Charges tables margins:', { service: 10, travel: 10, expenses: 10 });
      console.log('Charges tables widths:', { service: 180, travel: 180, expenses: 180 });

      // Service Charges Table
      doc.autoTable({
        startY: yOffset,
        head: [['Category', 'Hours', 'Rate', 'Charge']],
        body: [
          ['Straight', charges.straight?.hours.toFixed(2) || '0.00', '$120', `$${charges.straight?.charge.toFixed(2) || '0.00'}`],
          ['Sat/OT', charges.overtime?.hours.toFixed(2) || '0.00', '$180', `$${charges.overtime?.charge.toFixed(2) || '0.00'}`],
          ['Sun/Hol', charges.double?.hours.toFixed(2) || '0.00', '$240', `$${charges.double?.charge.toFixed(2) || '0.00'}`],
          ['Subtotal', '', '', `$${charges.laborSubtotal?.toFixed(2) || '0.00'}`],
        ],
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [200, 200, 200], fontSize: 8 },
        margin: { left: 10, right: 10 },
        columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 20 }, 2: { cellWidth: 20 }, 3: { cellWidth: 110 } },
        didParseCell: (data) => {
          if (data.column.index === 3 && data.cell.section === 'body') {
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });
      yOffset = doc.lastAutoTable.finalY + 4;

      doc.setFontSize(9);
      doc.text('Travel Charges', 10, yOffset);
      yOffset += 4;
      doc.autoTable({
        startY: yOffset,
        head: [['Category', 'Hours', 'Rate', 'Charge']],
        body: [
          ['Weekday', charges.weekdayTravel?.hours.toFixed(2) || '0.00', '$80', `$${charges.weekdayTravel?.charge.toFixed(2) || '0.00'}`],
          ['Saturday', charges.saturdayTravel?.hours.toFixed(2) || '0.00', '$120', `$${charges.saturdayTravel?.charge.toFixed(2) || '0.00'}`],
          ['Sun/Hol', charges.sundayTravel?.hours.toFixed(2) || '0.00', '$160', `$${charges.sundayTravel?.charge.toFixed(2) || '0.00'}`],
          ['Subtotal', '', '', `$${charges.travelChargesSubtotal?.toFixed(2) || '0.00'}`],
        ],
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [200, 200, 200], fontSize: 8 },
        margin: { left: 10, right: 10 },
        columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 20 }, 2: { cellWidth: 20 }, 3: { cellWidth: 110 } },
        didParseCell: (data) => {
          if (data.column.index === 3 && data.cell.section === 'body') {
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });
      yOffset = doc.lastAutoTable.finalY + 4;

      doc.setFontSize(9);
      doc.text('Travel Expenses', 10, yOffset);
      yOffset += 4;
      doc.autoTable({
        startY: yOffset,
        head: [['Category', 'Amount', 'Details']],
        body: [
          [
            'Per Diem',
            `$${charges.travel?.perDiemTotal.toFixed(2) || '0.00'}`,
            `${travelData?.perDiemType === 'local' ? '$65/day' : '$220/day'}, ${travelData?.perDiemDays || 0} days`,
          ],
          ['Mileage', `$${charges.travel?.mileageTotal.toFixed(2) || '0.00'}`, `${travelData?.mileage || 0} miles at $0.63`],
          ['Auto/Taxi', `$${charges.travel?.otherTravel.toFixed(2) || '0.00'}`, ''],
          [
            'Airfare',
            `$${charges.travel?.airTravel.toFixed(2) || '0.00'}`,
            `To: ${travelData?.airTravel?.destination || 'N/A'}, From: ${travelData?.airTravel?.origin || 'N/A'}, Return: ${travelData?.airTravel?.return || 'N/A'}`,
          ],
          ['Subtotal', `$${charges.travel?.travelExpensesSubtotal.toFixed(2) || '0.00'}`, ''],
        ],
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [200, 200, 200], fontSize: 8 },
        margin: { left: 10, right: 10 },
        columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 40 }, 2: { cellWidth: 110 } },
        didParseCell: (data) => {
          if (data.column.index === 1 && data.cell.section === 'body') {
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });
      yOffset = doc.lastAutoTable.finalY + 4;

      // Total Charges Table
      doc.setFontSize(9);
      doc.text('Total Charges', 10, yOffset);
      yOffset += 4;
      const totalCharges = (charges.laborSubtotal || 0) + (charges.travelChargesSubtotal || 0) + (charges.travel?.travelExpensesSubtotal || 0);
      console.log('Total Charges calculated:', {
        laborSubtotal: charges.laborSubtotal,
        travelChargesSubtotal: charges.travelChargesSubtotal,
        travelExpensesSubtotal: charges.travel?.travelExpensesSubtotal,
        totalCharges
      });
      doc.autoTable({
        startY: yOffset,
        head: [['Category', 'Total']],
        body: [
          ['Service Charges', `$${charges.laborSubtotal?.toFixed(2) || '0.00'}`],
          ['Travel Charges', `$${charges.travelChargesSubtotal?.toFixed(2) || '0.00'}`],
          ['Travel Expenses', `$${charges.travel?.travelExpensesSubtotal.toFixed(2) || '0.00'}`, ''],
          ['Grand Total', `$${totalCharges.toFixed(2)}`],
        ],
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [200, 200, 200], fontSize: 8 },
        margin: { left: 10, right: 10 },
        columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 90 } },
        didParseCell: (data) => {
          if (data.column.index === 1 && data.cell.section === 'body') {
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });
      yOffset = doc.lastAutoTable.finalY + 4;

      // Footer Text
      doc.setFontSize(8);
      doc.text('If not paying by ACH make checks payable to Joshua Todd Industries, LLC', 10, yOffset);
      yOffset += 3;
      doc.text('Any questions or concerns please contact Josh Lemmons at (623) 300-6445', 10, yOffset);
      yOffset += 3;
      doc.text('EMAIL: josh@jtiaz.com', 10, yOffset);
      yOffset += 3;
      doc.setFont('helvetica', 'bold');
      doc.text('THANK YOU FOR YOUR BUSINESS', 10, yOffset);
      doc.setFont('helvetica', 'normal');

      console.log('Final yOffset:', yOffset);

      if (preview) {
        const pdfBlob = doc.output('blob');
        const pdfUrl = URL.createObjectURL(pdfBlob);
        setPdfDataUrl(pdfUrl);
        return pdfUrl;
      } else {
        doc.save(`Invoice_${invoiceInfo?.invoiceNumber || '2025016'}.pdf`);
        console.log('Invoice PDF generated successfully');
      }
    } catch (error) {
      console.error('Error generating Invoice PDF:', error.message, error.stack);
      alert('Failed to generate Invoice PDF. Check the console for details.');
    }
  };

  useEffect(() => {
    const pdfUrl = generatePDF(true);
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [customerInfo, entries, travelData, invoiceInfo]);

  const handleExportPDF = () => {
    generatePDF(false);
  };

  return (
    <div className="mb-12">
      <h2 className="text-2xl font-semibold mb-4">Invoice Preview</h2>
      <div className="flex gap-4 mb-4 flex-wrap">
        <button
          onClick={() => navigate('/')}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Time Sheet
        </button>
        <button
          onClick={() => navigate('/service-report')}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Service Report
        </button>
        <button
          onClick={() => navigate('/invoice')}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Invoice
        </button>
        <button
          onClick={handleExportPDF}
          className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
        >
          Export to PDF
        </button>
      </div>
      <div className="w-[800px] h-[800px] overflow-auto border rounded">
        {pdfDataUrl ? (
          <PDFPreview pdfDataUrl={pdfDataUrl} />
        ) : (
          <p>Generating preview...</p>
        )}
      </div>
    </div>
  );
}

export default InvoicePage;
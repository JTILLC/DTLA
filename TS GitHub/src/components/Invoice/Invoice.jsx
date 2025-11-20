import { useTimeSheet } from '../../context/TimeSheetContext';
  import { useNavigate } from 'react-router-dom';
  import { jsPDF } from 'jspdf';
  import autoTable from 'jspdf-autotable';
  import { calculateCharges } from '../../utils/calculations';

  function Invoice() {
    const { customerInfo, entries, travelData, invoiceInfo } = useTimeSheet();
    const navigate = useNavigate();

    const formatDate = (dateString) => {
      try {
        console.log('Formatting date:', dateString);
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (isNaN(date.getTime())) throw new Error('Invalid date');
        const formattedMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
        const formattedDay = String(date.getUTCDate()).padStart(2, '0');
        const yearShort = String(date.getUTCFullYear()).slice(-2);
        console.log(`Formatted date: ${formattedMonth}/${formattedDay}/${yearShort}`);
        return `${formattedMonth}/${formattedDay}/${yearShort}`;
      } catch (error) {
        console.error('Error formatting date:', dateString, error);
        return 'Invalid';
      }
    };

    const generatePDF = () => {
      try {
        console.log('Starting Invoice PDF generation');
        const doc = new jsPDF();
        let yOffset = 10;

        doc.setFontSize(8);
        doc.text('Joshua Todd Industries, LLC Invoice', 10, yOffset);
        yOffset += 10;
        doc.text('Gilbert, AZ', 10, yOffset);
        yOffset += 5;
        doc.setFontSize(7);
        doc.text('Email: josh@jtiaz.com', 10, yOffset);
        yOffset += 5;
        doc.text('Phone: (623) 300-6445', 10, yOffset);
        yOffset += 5;

        doc.text(`Invoice #: ${invoiceInfo?.invoiceNumber || 'N/A'}`, 10, yOffset);
        yOffset += 5;
        doc.text(`Invoice Date: ${formatDate(invoiceInfo?.invoiceDate) || 'N/A'}`, 10, yOffset);
        yOffset += 5;
        doc.text(`Due Date: ${formatDate(invoiceInfo?.dueDate) || 'N/A'}`, 10, yOffset);
        yOffset += 10;

        doc.text('Bill To:', 10, yOffset);
        yOffset += 5;
        doc.text(customerInfo?.company || 'N/A', 10, yOffset);
        yOffset += 5;
        doc.text(customerInfo?.address || 'N/A', 10, yOffset);
        yOffset += 5;
        doc.text(`${customerInfo?.city || ''}, ${customerInfo?.state || ''}`.trim() || 'N/A', 10, yOffset);
        yOffset += 5;
        doc.text(`Contact: ${customerInfo?.contact || 'N/A'}`, 10, yOffset);
        yOffset += 5;
        doc.text(`Phone: ${customerInfo?.phone || 'N/A'}`, 10, yOffset);
        yOffset += 5;
        doc.text(`Email: ${customerInfo?.email || 'N/A'}`, 10, yOffset);
        yOffset += 10;

        const tableData = [];
        entries.forEach((entry) => {
          const travelTo = entry.travel?.to?.active ? `${entry.travel.to.start}-${entry.travel.to.end}` : 'N/A';
          const travelHome = entry.travel?.home?.active ? `${entry.travel.home.start}-${entry.travel.home.end}` : 'N/A';
          const onSite = entry.onsite?.active ? `${entry.onsite.start}-${entry.onsite.end}` : 'N/A';
          const workHours = entry.onsite?.active
            ? ((new Date(`1970-01-01T${entry.onsite.end}:00Z`) - new Date(`1970-01-01T${entry.onsite.start}:00Z`)) / 1000 / 60 / 60 - (entry.lunch ? Number(entry.lunchDuration) || 0 : 0)).toFixed(2)
            : '0.00';
          const travelHours = (entry.travel?.to?.active ? (new Date(`1970-01-01T${entry.travel.to.end}:00Z`) - new Date(`1970-01-01T${entry.travel.to.start}:00Z`)) / 1000 / 60 / 60 : 0) +
            (entry.travel?.home?.active ? (new Date(`1970-01-01T${entry.travel.home.end}:00Z`) - new Date(`1970-01-01T${entry.travel.home.start}:00Z`)) / 1000 / 60 / 60 : 0);
          const totalHours = (parseFloat(travelHours) + parseFloat(workHours)).toFixed(2);
          tableData.push([formatDate(entry.date), travelTo, travelHome, onSite, workHours, totalHours]);
        });

        autoTable(doc, {
          head: [['Date', 'Travel To', 'Travel Home', 'On-site', 'Work Hrs', 'Total Hrs']],
          body: tableData,
          startY: yOffset,
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [200, 200, 200] },
        });
        yOffset = doc.lastAutoTable.finalY + 10;

        const charges = calculateCharges(entries || [], travelData || {});
        const totalServiceCharge = charges.laborSubtotal || 0;
        const totalTravelCharge = charges.travelChargesSubtotal || 0;
        const totalTravelExpense = charges.travel?.travelExpensesSubtotal || 0;
        const grandTotal = totalServiceCharge + totalTravelCharge + totalTravelExpense;

        doc.text(`Subtotal (Service): $${totalServiceCharge.toFixed(2)}`, 10, yOffset);
        yOffset += 5;
        doc.text(`Subtotal (Travel): $${totalTravelCharge.toFixed(2)}`, 10, yOffset);
        yOffset += 5;
        doc.text(`Subtotal (Expenses): $${totalTravelExpense.toFixed(2)}`, 10, yOffset);
        yOffset += 5;
        doc.text(`Grand Total: $${grandTotal.toFixed(2)}`, 10, yOffset, { bold: true });
        yOffset += 10;

        doc.text('Payment Terms: ' + (invoiceInfo?.paymentTerms || 'N/A'), 10, yOffset);
        yOffset += 5;
        doc.text('PO Reference: ' + (invoiceInfo?.poRefer || 'N/A'), 10, yOffset);

        const pdfBlob = doc.output('blob');
        const pdfUrl = URL.createObjectURL(pdfBlob);
        const pdfPreview = document.getElementById('pdfPreview');
        if (pdfPreview) {
          pdfPreview.src = pdfUrl;
        }
        doc.save('JoshuaToddIndustriesInvoice.pdf');
      } catch (error) {
        console.error('Error generating Invoice PDF:', error);
        alert('Failed to generate Invoice PDF. Check console for details.');
      }
    };

    const handleExportPDF = () => {
      generatePDF();
    };

    return (
      <div className="min-h-screen bg-gray-100 p-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-4 text-center">Invoice</h2>
          <div className="flex gap-2 mb-4 flex-wrap justify-center">
            <button
              onClick={() => navigate('/')}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              Back to Time Sheet
            </button>
            <button
              onClick={handleExportPDF}
              className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
            >
              Export to PDF
            </button>
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-2">PDF Preview</h3>
            <iframe
              id="pdfPreview"
              className="w-full h-[600px] border rounded"
              title="Invoice PDF Preview"
            />
          </div>
        </div>
      </div>
    );
  }

  export default Invoice;
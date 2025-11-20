// src/components/ServiceReport/ServiceReport.jsx
import React from 'react';
import { useTimeSheet } from '../../context/TimeSheetContext';
import { useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function ServiceReport() {
  const { 
    customerInfo, 
    entries, 
    travelData, 
    machineInfo, 
    serviceReportData,
    currentCustomer 
  } = useTimeSheet();
  const navigate = useNavigate();

  const formatDate = (dateString) => {
    try {
      if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        throw new Error('Invalid date format');
      }
      const [year, month, day] = dateString.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      if (isNaN(date.getTime())) throw new Error('Invalid date');
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = days[date.getDay()];
      const formattedMonth = String(date.getMonth() + 1).padStart(2, '0');
      const formattedDay = String(date.getDate()).padStart(2, '0');
      const yearShort = String(date.getFullYear()).slice(-2);
      return `${dayName} ${formattedMonth}/${formattedDay}/${yearShort}`;
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return 'N/A';
    }
  };

  const getReportDate = () => {
    if (entries && entries.length > 0 && entries[0]?.date) {
      return formatDate(entries[0].date);
    }
    return 'N/A';
  };

  const generatePDF = () => {
    try {
      const doc = new jsPDF();
      let yOffset = 10;

      doc.setFontSize(8);
      doc.text('Joshua Todd Industries, LLC Service Report', 10, yOffset);
      yOffset += 3;
      doc.text('Gilbert, AZ', 10, yOffset);
      yOffset += 3;
      doc.setFontSize(7);
      doc.text(`Email: josh@jtiaz.com`, 10, yOffset);
      yOffset += 3;
      doc.text(`Phone: (623) 300-6445`, 10, yOffset);
      yOffset += 3;
      doc.text(`Date: ${getReportDate()}`, 10, yOffset);
      yOffset += 8;

      doc.setFontSize(8);
      doc.text('Customer Information:', 10, yOffset);
      yOffset += 5;
      const customerLines = [
        `${customerInfo.company || 'N/A'}`,
        `${customerInfo.contact || 'N/A'}`,
        `${customerInfo.address || 'N/A'}`,
        `${customerInfo.city || 'N/A'}, ${customerInfo.state || 'N/A'} ${customerInfo.zip || ''}`,
        `Phone: ${customerInfo.phone || 'N/A'}`,
        `Email: ${customerInfo.email || 'N/A'}`
      ];
      customerLines.forEach(line => {
        doc.text(line, 10, yOffset);
        yOffset += 4;
      });
      yOffset += 5;

      // MACHINE INFO — SUPPORT serial OR serialNumber
      if (machineInfo && Array.isArray(machineInfo) && machineInfo.length > 0) {
        doc.text('Machine Information:', 10, yOffset);
        yOffset += 5;
        machineInfo.forEach((machine, i) => {
          doc.text(`Machine ${i + 1}:`, 10, yOffset);
          yOffset += 4;
          doc.text(`  Model: ${machine.model || 'N/A'}`, 12, yOffset);
          yOffset += 4;
          doc.text(`  Serial Number: ${machine.serial || machine.serialNumber || 'N/A'}`, 12, yOffset);
          yOffset += 4;
          doc.text(`  Job Number: ${machine.jobNumber || 'N/A'}`, 12, yOffset);
          yOffset += 6;
        });
      } else {
        doc.text('Machine Information: N/A', 10, yOffset);
        yOffset += 8;
      }

      doc.text('Service Performed:', 10, yOffset);
      yOffset += 5;
      if (entries && entries.length > 0) {
        entries.forEach((entry, i) => {
          const dateStr = formatDate(entry.date);
          const work = serviceReportData[entry.date] || 'No details provided.';
          doc.text(`${dateStr}:`, 10, yOffset);
          yOffset += 4;
          const splitWork = doc.splitTextToSize(work, 170);
          splitWork.forEach(line => {
            doc.text(`  ${line}`, 12, yOffset);
            yOffset += 4;
          });
          yOffset += 3;
        });
      } else {
        doc.text('No service entries.', 10, yOffset);
        yOffset += 8;
      }

      doc.setFontSize(7);
      doc.text('I acknowledge receipt of the services described above and agree to the charges.', 10, yOffset, { maxWidth: 170 });
      yOffset += 8;
      doc.text('Charges are APPROXIMATE unless stamped in lower right.', 10, yOffset);
      yOffset += 5;
      doc.setFont('helvetica', 'bold');
      doc.text('Thank you for your business.', 10, yOffset);
      doc.setFont('helvetica', 'normal');

      const pdfBlob = doc.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const pdfPreview = document.getElementById('pdfPreview');
      if (pdfPreview) {
        pdfPreview.src = pdfUrl;
      }
      doc.save('JoshuaToddIndustriesServiceReport.pdf');
    } catch (error) {
      console.error('Error generating Service Report PDF:', error);
      alert('Failed to generate Service Report PDF. Check console for details.');
    }
  };

  const handleExportPDF = () => {
    generatePDF();
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 text-center">Service Report</h2>
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
            title="Service Report PDF Preview"
          />
        </div>
      </div>
    </div>
  );
}

export default ServiceReport;
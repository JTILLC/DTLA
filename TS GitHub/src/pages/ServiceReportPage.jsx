import React from 'react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTimeSheet } from '../context/TimeSheetContext';
import { jsPDF } from 'jspdf';
import logo from "../assets/logo.png";
import autoTable from 'jspdf-autotable';
import { calculateCharges } from '../utils/calculations';
import PDFPreview from '../components/PDFPreview/PDFPreview';

function ServiceReportPage() {
  const context = useTimeSheet();
  const navigate = useNavigate();

  if (!context) {
    console.error('TimeSheetContext is undefined');
    return (
      <div className="p-4 text-red-600">
        Error: Time Sheet context is unavailable. Please try refreshing the page.
      </div>
    );
  }

  const {
    customerInfo,
    travelData = {},
    entries = [],
    serviceReportData,
    machineInfo,
    invoiceInfo
  } = context;
  const [pdfDataUrl, setPdfDataUrl] = useState(null);

  const charges = calculateCharges(entries, travelData);
  const totalCharges =
    (charges.laborSubtotal || 0) +
    (charges.travelChargesSubtotal || 0) +
    ((charges.travel && charges.travel.travelExpensesSubtotal) || 0);

  const formatDate = (dateString) => {
    if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return 'N/A';
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) return 'N/A';
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return `${days[date.getDay()]} ${String(month).padStart(2,'0')}/${String(day).padStart(2,'0')}/${String(year).slice(-2)}`;
  };

  const getReportDate = () =>
    entries.length && entries[0].date
      ? formatDate(entries[0].date)
      : 'N/A';

  const generatePDF = async (preview = false) => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginX = 10;
      const gap = 10;
      const colW = (pageWidth - marginX * 2 - gap) / 2;
      let y = 10;

      // Load logo as data URI
      const logoDataURI = await new Promise((resolve, reject) => {
        const img = new Image();
        img.src = logo;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = (err) => reject(err);
      });

      // Header
      doc.addImage(logoDataURI, 'PNG', pageWidth - 52.5, 10, 37.5, 11.25);
      doc.setTextColor(0, 0, 255);
      doc.setFontSize(8);
      doc.text('Joshua Todd Industries, LLC Service Report', marginX, y);
      y += 3;
      doc.setFontSize(7);
      doc.text(`Email: josh@jtiaz.com`, marginX, y);
      y += 3;
      doc.text('Phone: (623) 300-6445', marginX, y);
      y += 3;
      doc.text(`Date: ${getReportDate()}`, marginX, y);
      y += 3;
      doc.text(`Service Report Number: ${invoiceInfo?.invoiceNumber || 'N/A'}`, marginX, y);
      y += 5;

      // Customer Information
      doc.setFontSize(7);
      doc.text('Customer Information', marginX, y);
      y += 3;
      doc.autoTable({
        startY: y,
        head: [['Field','Value','Field','Value']],
        body: [
          ['Company', customerInfo.company || 'N/A', 'Contact', customerInfo.contact || 'N/A'],
          ['Address', customerInfo.address || 'N/A', 'Phone', customerInfo.phone || 'N/A'],
          ['City', customerInfo.city || 'N/A', 'Email', customerInfo.email || 'N/A'],
          ['State', customerInfo.state || 'N/A', 'Purpose', customerInfo.purpose || 'N/A']
        ],
        theme: 'grid',
        styles: { fontSize: 6, cellPadding: 1 },
        headStyles: { fillColor: [200, 200, 200], fontSize: 6 },
        margin: { left: marginX, right: marginX }
      });
      y = doc.lastAutoTable.finalY + 5;

      // Machine Information
      doc.text('Machine Information', marginX, y);
      y += 3;
      let machineRows = (Array.isArray(machineInfo) ? machineInfo : (machineInfo ? [machineInfo] : [])).map(m => [
        'Model', m.model || 'N/A',
        // PATCH: read serial from either `serial` or `serialNumber`
        'Serial No.', (m.serial || m.serialNumber || 'N/A'),
        'Job No.', m.jobNumber || 'N/A'
      ]);
      if (!machineRows.length) {
        machineRows = [['Model', 'N/A', 'Serial No.', 'N/A', 'Job No.', 'N/A']];
      }
      doc.autoTable({
        startY: y,
        head: [['Field','Value','Field','Value','Field','Value']],
        body: machineRows,
        theme: 'grid',
        styles: { fontSize: 6, cellPadding: 1 },
        headStyles: { fillColor: [200, 200, 200], fontSize: 6 },
        margin: { left: marginX, right: marginX }
      });
      y = doc.lastAutoTable.finalY + 5;

      // Service Work Details
      doc.text('Service Work Details', marginX, y);
      y += 3;
      const workRows = entries.map(e => [
        formatDate(e.date),
        serviceReportData?.[e.date] || 'No description'
      ]);
      if (workRows.length) {
        doc.autoTable({
          startY: y,
          head: [['Date','Work Performed']],
          body: workRows,
          theme: 'grid',
          styles: { fontSize: 6, cellPadding: 1, overflow: 'linebreak' },
          headStyles: { fillColor: [200, 200, 200], fontSize: 6 },
          margin: { left: marginX, right: marginX },
          columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 'auto' } }
        });
        y = doc.lastAutoTable.finalY + 5;
      }

      // Hours Worked
      doc.text('Hours Worked', marginX, y);
      y += 3;
      doc.setFontSize(6);
      doc.text('(All times are in MST if traveling that day. Return travel is the time zone at the start of day)', marginX, y);
      y += 3;
      doc.setFontSize(7);
      const hoursWorkedRows = entries.map(entry => {
        const travelTo = entry.travel?.to?.active && entry.travel.to.start && entry.travel.to.end
          ? `${entry.travel.to.start}-${entry.travel.to.end}`
          : 'N/A';
        const travelHome = entry.travel?.home?.active && entry.travel.home.start && entry.travel.home.end
          ? `${entry.travel.home.start}-${entry.travel.home.end}`
          : 'N/A';
        const onSite = entry.onsite?.active && entry.onsite.start && entry.onsite.end
          ? `${entry.onsite.start}-${entry.onsite.end}`
          : 'N/A';
        const workHours = entry.onsite?.active && entry.onsite.start && entry.onsite.end
          ? ((new Date(`1970-01-01T${entry.onsite.end}:00Z`) - new Date(`1970-01-01T${entry.onsite.start}:00Z`)) / 3600000)
          : 0;
        const travelHours =
          (entry.travel?.to?.active ? (new Date(`1970-01-01T${entry.travel.to.end}:00Z`) - new Date(`1970-01-01T${entry.travel.to.start}:00Z`)) / 3600000 : 0) +
          (entry.travel?.home?.active ? (new Date(`1970-01-01T${entry.travel.home.end}:00Z`) - new Date(`1970-01-01T${entry.travel.home.start}:00Z`)) / 3600000 : 0);
        return [
          formatDate(entry.date),
          travelTo,
          onSite,
          travelHome,
          entry.lunch ? `${entry.lunchDuration} hrs` : 'No',
          travelHours.toFixed(2),
          workHours.toFixed(2),
          (workHours + travelHours).toFixed(2)
        ];
      });
      if (hoursWorkedRows.length) {
        doc.autoTable({
          head: [['Date','Travel To','On-site','Travel Home','Lunch','Travel Hrs','Work Hrs','Total Hrs']],
          body: hoursWorkedRows,
          startY: y,
          theme: 'grid',
          styles: { fontSize: 6, cellPadding: 1 },
          headStyles: { fillColor: [200, 200, 200], fontSize: 6 },
          margin: { left: marginX, right: marginX },
          columnStyles: {
            0: { cellWidth: 20 }, 1: { cellWidth: 25 }, 2: { cellWidth: 25 }, 3: { cellWidth: 25 },
            4: { cellWidth: 20 }, 5: { cellWidth: 20 }, 6: { cellWidth: 28 }, 7: { cellWidth: 20 }
          }
        });
        y = doc.lastAutoTable.finalY + 5;
      }

      // 2x2 Grid Charges
      const gridY = y;
      doc.setFontSize(7);

      // Service Charges (Top-left)
      doc.text('Service Charges', marginX, gridY);
      doc.autoTable({
        margin: { left: marginX },
        startY: gridY + 3,
        tableWidth: colW,
        head: [['Category','Hours','Rate','Charge']],
        body: [
          ['Straight', (charges.straight?.hours ?? 0).toFixed(2), '$120', `$${(charges.straight?.charge ?? 0).toFixed(2)}`],
          ['Sat/OT', (charges.overtime?.hours ?? 0).toFixed(2), '$180', `$${(charges.overtime?.charge ?? 0).toFixed(2)}`],
          ['Sun/Hol', (charges.double?.hours ?? 0).toFixed(2), '$240', `$${(charges.double?.charge ?? 0).toFixed(2)}`],
          ['Subtotal','','', `$${(charges.laborSubtotal ?? 0).toFixed(2)}`]
        ],
        theme: 'grid',
        styles: { fontSize: 6, cellPadding: 1 },
        headStyles: { fillColor: [200, 200, 200], fontSize: 6 }
      });
      const serviceFinalY = doc.lastAutoTable.finalY;

      // Travel Charges (Top-right)
      doc.text('Travel Charges', marginX + colW + gap, gridY);
      doc.autoTable({
        margin: { left: marginX + colW + gap },
        startY: gridY + 3,
        tableWidth: colW,
        head: [['Category','Hours','Rate','Charge']],
        body: [
          ['Weekday', (charges.weekdayTravel?.hours ?? 0).toFixed(2), '$80', `$${(charges.weekdayTravel?.charge ?? 0).toFixed(2)}`],
          ['Saturday', (charges.saturdayTravel?.hours ?? 0).toFixed(2), '$120', `$${(charges.saturdayTravel?.charge ?? 0).toFixed(2)}`],
          ['Sun/Hol', (charges.sundayTravel?.hours ?? 0).toFixed(2), '$160', `$${(charges.sundayTravel?.charge ?? 0).toFixed(2)}`],
          ['Subtotal','','', `$${(charges.travelChargesSubtotal ?? 0).toFixed(2)}`]
        ],
        theme: 'grid',
        styles: { fontSize: 6, cellPadding: 1 },
        headStyles: { fillColor: [200, 200, 200], fontSize: 6 }
      });
      const travelChargesFinalY = doc.lastAutoTable.finalY;

      // Calculate bottomY
      const bottomY = Math.max(serviceFinalY, travelChargesFinalY) + 5;

      // Travel Expenses (Bottom-left)
      doc.text('Travel Expenses', marginX, bottomY);
      doc.autoTable({
        margin: { left: marginX },
        startY: bottomY + 3,
        tableWidth: colW,
        head: [['Category','Amount','Details']],
        body: [
          ['Per Diem', `$${(charges?.travel?.perDiemTotal ?? 0).toFixed(2)}`, `${travelData.perDiemType === 'local' ? '$65/day' : '$220/day'} x ${travelData.perDiemDays ?? 0}`],
          ['Mileage', `$${(charges?.travel?.mileageTotal ?? 0).toFixed(2)}`, `${travelData.mileage ?? 0} miles at $0.63`],
          ['Auto/Taxi', `$${(charges?.travel?.otherTravel ?? 0).toFixed(2)}`, ''],
          ['Airfare', `$${(charges?.travel?.airTravel ?? 0).toFixed(2)}`, `To: ${travelData.airTravel?.destination ?? ''}, From: ${travelData.airTravel?.origin ?? ''}, Return: ${travelData.airTravel?.return ?? ''}`],
          ['Subtotal', `$${(charges?.travel?.travelExpensesSubtotal ?? 0).toFixed(2)}`, '']
        ],
        theme: 'grid',
        styles: { fontSize: 6, cellPadding: 1 },
        headStyles: { fillColor: [200, 200, 200], fontSize: 6 }
      });
      const expensesFinalY = doc.lastAutoTable.finalY;

      // Total Charges (Bottom-right)
      doc.text('Total Charges', marginX + colW + gap, bottomY);
      doc.autoTable({
        margin: { left: marginX + colW + gap },
        startY: bottomY + 3,
        tableWidth: colW,
        head: [['Category','Total']],
        body: [
          ['Service Charges', `$${(charges.laborSubtotal ?? 0).toFixed(2)}`],
          ['Travel Charges', `$${(charges.travelChargesSubtotal ?? 0).toFixed(2)}`],
          ['Travel Expenses', `$${(charges?.travel?.travelExpensesSubtotal ?? 0).toFixed(2)}`],
          ['Grand Total', `$${totalCharges.toFixed(2)}`]
        ],
        theme: 'grid',
        styles: { fontSize: 6, cellPadding: 1 },
        headStyles: { fillColor: [173, 216, 230], fontSize: 6 }
      });
      const totalFinalY = doc.lastAutoTable.finalY;

      // Footer Text
      const footerY = Math.max(expensesFinalY, totalFinalY) + 10;
      doc.setFontSize(6);
      doc.text('By signing you agree to the charges above and are satisfied with the service.', marginX, footerY);
      doc.text('Charges are APPROXIMATE unless stamped in lower right.', marginX, footerY + 3);
      doc.setFont('helvetica', 'bold');
      doc.text('Thank you for your business.', marginX, footerY + 6);

      // Signature Area
      const signatureY = footerY + 12;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      // Right: Accepted By
      const acceptedText = 'Accepted By:';
      const acceptedTextWidth = doc.getTextWidth(acceptedText);
      doc.text(acceptedText, pageWidth - marginX - acceptedTextWidth - 60, signatureY);
      doc.line(pageWidth - marginX - 60, signatureY, pageWidth - marginX, signatureY); // Signature line

      if (preview) {
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        setPdfDataUrl(url);
        return url;
      } else {
        doc.save('JoshuaToddIndustriesServiceReport.pdf');
      }
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Failed to generate PDF. See console for details.');
    }
  };

  useEffect(() => {
    generatePDF(true).then(url => setPdfDataUrl(url));
    return () => pdfDataUrl && URL.revokeObjectURL(pdfDataUrl);
  }, [customerInfo, entries, travelData, serviceReportData, machineInfo, invoiceInfo]);

  const handleExportPDF = () => generatePDF(false);

  return (
    <div className="mb-12">
      <h2 className="text-2xl font-semibold mb-4">Service Report Preview</h2>
      <div className="flex gap-4 mb-4 flex-wrap">
        <button onClick={() => navigate('/')} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Time Sheet</button>
        <button onClick={() => navigate('/service-report')} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Service Report</button>
        <button onClick={() => navigate('/invoice')} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Invoice</button>
        <button onClick={handleExportPDF} className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600">Export to PDF</button>
      </div>
      <div className="w-[800px] h-[800px] overflow-auto border rounded">
        <PDFPreview pdfDataUrl={pdfDataUrl} />
      </div>
    </div>
  );
}

export default ServiceReportPage;

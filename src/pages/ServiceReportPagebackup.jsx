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

  const { customerInfo, travelData = {}, entries = [], serviceReportData, machineInfo } = context;
  const [pdfDataUrl, setPdfDataUrl] = useState(null);

  const charges = calculateCharges(entries, travelData);
  const totalCharges = charges.laborSubtotal + charges.travelChargesSubtotal + charges.travel.travelExpensesSubtotal;

  const formatDate = (dateString) => {
    if (!dateString || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateString)) return 'N/A';
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) return 'N/A';
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return `${days[date.getDay()]} ${String(month).padStart(2,'0')}/${String(day).padStart(2,'0')}/${String(year).slice(-2)}`;
  };

  const getReportDate = () => entries.length && entries[0].date ? formatDate(entries[0].date) : 'N/A';

  const generatePDF = (preview = false) => {
    try {
      const doc = new jsPDF();
      // Logo & Header
      doc.addImage(logo, 'PNG', doc.internal.pageSize.getWidth() - 52.5, 10, 37.5, 11.25);
      doc.setTextColor(0,0,255);
      doc.setFillColor(230,240,255);

      let y = 10;
      doc.setFontSize(8);
      doc.text('Joshua Todd Industries, LLC Service Report', 10, y);
      y += 3;
      doc.text('Email: josh@jtiaz.com', 10, y);
      y += 3;
      doc.text('Phone: (623) 300-6445', 10, y);
      y += 3;
      doc.text(`Date: ${getReportDate()}`, 10, y);
      y += 5;

      // Customer Information
      doc.setFontSize(7);
      doc.text('Customer Information', 10, y);
      y += 3;
      doc.autoTable({
        startY: y,
        head: [['Field','Value','Field','Value']],
        body: [
          ['Company', customerInfo.company||'N/A','Contact', customerInfo.contact||'N/A'],
          ['Address', customerInfo.address||'N/A','Phone', customerInfo.phone||'N/A'],
          ['City', customerInfo.city||'N/A','Email', customerInfo.email||'N/A'],
          ['State', customerInfo.state||'N/A','Purpose', customerInfo.purpose||'N/A'],
        ],
        theme:'grid',
        styles:{fontSize:6,cellPadding:1},
        headStyles:{fillColor:[200,200,200],fontSize:6},
        margin:{left:10,right:10}
      });
      y = doc.lastAutoTable.finalY + 5;

      // Machine Information
      doc.text('Machine Information', 10, y);
      y += 3;
      doc.autoTable({
        startY: y,
        head: [['Field','Value','Field','Value','Field','Value']],
        body: [[
          'Model', machineInfo.model||'N/A',
          'Serial No.', machineInfo.serialNumber||'N/A',
          'Job No.', machineInfo.jobNumber||'N/A'
        ]],
        theme:'grid',
        styles:{fontSize:6,cellPadding:1},
        headStyles:{fillColor:[200,200,200],fontSize:6},
        margin:{left:10,right:10}
      });
      y = doc.lastAutoTable.finalY + 5;

      // Service Work Details
      doc.text('Service Work Details', 10, y);
      y += 3;
      const workRows = entries.map(e=>[formatDate(e.date), serviceReportData?.[e.date]||'No description']);
      if(workRows.length) {
        doc.autoTable({
          startY: y,
          head: [['Date','Work Performed']],
          body: workRows,
          theme:'grid',
          styles:{fontSize:6,cellPadding:1},
          headStyles:{fillColor:[200,200,200],fontSize:6},
          margin:{left:10,right:10}
        });
        y = doc.lastAutoTable.finalY + 5;
      }

      // Charges grid
      const pageW = doc.internal.pageSize.getWidth();
      const marginX = 10, gap = 10;
      const colW = (pageW - marginX*2 - gap)/2;

      // Service Charges
      doc.text('Service Charges', marginX, y);
      doc.autoTable({
        startX: marginX,
        startY: y+3,
        tableWidth: colW,
        head: [['Category','Hours','Rate','Charge']],
        body: [
          ['Straight', charges.straight.hours.toFixed(2), '$120', `$${charges.straight.charge.toFixed(2)}`],
          ['Sat/OT', charges.overtime.hours.toFixed(2), '$180', `$${charges.overtime.charge.toFixed(2)}`],
          ['Sun/Hol', charges.double.hours.toFixed(2), '$240', `$${charges.double.charge.toFixed(2)}`],
          ['Subtotal', '', '', `$${charges.laborSubtotal.toFixed(2)}`]
        ],
        theme:'grid',
        styles:{fontSize:6,cellPadding:1},
        headStyles:{fillColor:[200,200,200],fontSize:6},
        margin:{left:marginX},
        columnStyles:{0:{cellWidth:15},1:{cellWidth:10},2:{cellWidth:10},3:{cellWidth:colW-35}}
      });
      const serviceEnd = doc.lastAutoTable.finalY;

      // Travel Charges
      doc.text('Travel Charges', marginX + colW + gap, y);
      doc.autoTable({
        startX: marginX + colW + gap,
        startY: y+3,
        tableWidth: colW,
        head: [['Category','Hours','Rate','Charge']],
        body: [
          ['Weekday', charges.weekdayTravel.hours.toFixed(2), '$80', `$${charges.weekdayTravel.charge.toFixed(2)}`],
          ['Saturday', charges.saturdayTravel.hours.toFixed(2), '$120', `$${charges.saturdayTravel.charge.toFixed(2)}`],
          ['Sun/Hol', charges.sundayTravel.hours.toFixed(2), '$160', `$${charges.sundayTravel.charge.toFixed(2)}`],
          ['Subtotal', '', '', `$${charges.travelChargesSubtotal.toFixed(2)}`]
        ],
        theme:'grid',
        styles:{fontSize:6,cellPadding:1},
        headStyles:{fillColor:[200,200,200],fontSize:6},
        margin:{left:marginX+colW+gap},
        columnStyles:{0:{cellWidth:15},1:{cellWidth:10},2:{cellWidth:10},3:{cellWidth:colW-35}}
      });
      const travelEnd = doc.lastAutoTable.finalY;
      y = Math.max(serviceEnd, travelEnd) + 5;

      // Travel Expenses
      doc.text('Travel Expenses', marginX, y);
      doc.autoTable({
        startX: marginX,
        startY: y+3,
        tableWidth: colW,
        head: [['Category','Amount','Details']],
        body: [
          ['Per Diem', `$${charges.travel.perDiemTotal.toFixed(2)}`, travelData.perDiemType==='local'?`$65/day x ${travelData.perDiemDays}`:`$220/day x ${travelData.perDiemDays}`],
          ['Mileage', `$${charges.travel.mileageTotal.toFixed(2)}`, `${travelData.mileage} miles @ $0.63`],
          ['Auto/Taxi', `$${charges.travel.otherTravel.toFixed(2)}`, ''],
          ['Airfare', `$${charges.travel.airTravel.toFixed(2)}`, `From: ${travelData.airTravel.origin}, To: ${travelData.airTravel.destination}, Return: ${travelData.airTravel.return}`],
          ['Subtotal', `$${charges.travel.travelExpensesSubtotal.toFixed(2)}`, '']
        ],
        theme:'grid',
        styles:{fontSize:6,cellPadding:1},
        headStyles:{fillColor:[200,200,200],fontSize:6},
        margin:{left:marginX},
        columnStyles:{0:{cellWidth:20},1:{cellWidth:30},2:{cellWidth:colW-50}}
      });
      // Shift bottom text below table
      const footY = doc.lastAutoTable.finalY + 10;
      doc.setFontSize(6);
      doc.text('By signing you agree to the charges above and are satisfied with the service.', 10, footY, { maxWidth: pageW-20 });
      doc.text('Charges are APPROXIMATE unless stamped in lower right.', 10, footY+5, { maxWidth: pageW-20 });
      doc.setFont('helvetica','bold');
      doc.text('Thank you for your business.', 10, footY+10);

      if (preview) {
        const blob = doc.output('blob');
        setPdfDataUrl(URL.createObjectURL(blob));
        return pdfDataUrl;
      } else {
        doc.save('ServiceReport.pdf');
      }
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Failed to generate PDF.');
    }
  };

  useEffect(() => {
    generatePDF(true);
  }, [customerInfo, entries, travelData, serviceReportData, machineInfo]);

  return (
    <div className="mb-12">
      <h2 className="text-2xl font-semibold mb-4">Service Report Preview</h2>
      <div className="flex gap-4 mb-4 flex-wrap">
        <button onClick={() => navigate('/')} className="bg-blue-500 text-white px-4 py-2 rounded">Time Sheet</button>
        <button onClick={() => navigate('/service-report')} className="bg-blue-500 text-white px-4 py-2 rounded">Service Report</button>
        <button onClick={() => navigate('/invoice')} className="bg-blue-500 text-white px-4 py-2 rounded">Invoice</button>
        <button onClick={() => generatePDF(false)} className="bg-green-500 text-white px-4 py-2 rounded">Export to PDF</button>
      </div>
      <div className="w-[800px] h-[800px] overflow-auto border rounded">
        <PDFPreview pdfDataUrl={pdfDataUrl} />
      </div>
    </div>
  );
}

export default ServiceReportPage;

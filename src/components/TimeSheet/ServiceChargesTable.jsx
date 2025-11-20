import React from 'react';

function ServiceChargesTable({ charges }) {
  console.log('ServiceChargesTable charges:', JSON.stringify(charges, null, 2));

  return (
    <div className="mt-4 bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
      <h3 className="text-lg font-semibold mb-2">Charges</h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Service Charges Table */}
        <div className="overflow-x-auto">
          <h4 className="text-md font-medium mb-1">Service Charges</h4>
          <table className="w-full border-collapse border border-gray-300 text-sm">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-gray-300 p-2 text-left">Category</th>
                <th className="border border-gray-300 p-2 text-right">Hours</th>
                <th className="border border-gray-300 p-2 text-right">Rate</th>
                <th className="border border-gray-300 p-2 text-right">Charge</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-300 p-2">Straight</td>
                <td className="border border-gray-300 p-2 text-right">{charges.straight?.hours.toFixed(2) || '0.00'}</td>
                <td className="border border-gray-300 p-2 text-right">$120</td>
                <td className="border border-gray-300 p-2 text-right font-bold">${charges.straight?.charge.toFixed(2) || '0.00'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 p-2">Sat/OT</td>
                <td className="border border-gray-300 p-2 text-right">{charges.overtime?.hours.toFixed(2) || '0.00'}</td>
                <td className="border border-gray-300 p-2 text-right">$180</td>
                <td className="border border-gray-300 p-2 text-right font-bold">${charges.overtime?.charge.toFixed(2) || '0.00'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 p-2">Sun/Hol</td>
                <td className="border border-gray-300 p-2 text-right">{charges.double?.hours.toFixed(2) || '0.00'}</td>
                <td className="border border-gray-300 p-2 text-right">$240</td>
                <td className="border border-gray-300 p-2 text-right font-bold">${charges.double?.charge.toFixed(2) || '0.00'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 p-2 font-bold">Subtotal</td>
                <td className="border border-gray-300 p-2"></td>
                <td className="border border-gray-300 p-2"></td>
                <td className="border border-gray-300 p-2 text-right font-bold">${charges.laborSubtotal?.toFixed(2) || '0.00'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Travel Charges Table */}
        <div className="overflow-x-auto">
          <h4 className="text-md font-medium mb-1">Travel Charges</h4>
          <table className="w-full border-collapse border border-gray-300 text-sm">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-gray-300 p-2 text-left">Category</th>
                <th className="border border-gray-300 p-2 text-right">Hours</th>
                <th className="border border-gray-300 p-2 text-right">Rate</th>
                <th className="border border-gray-300 p-2 text-right">Charge</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-300 p-2">Weekday</td>
                <td className="border border-gray-300 p-2 text-right">{charges.weekdayTravel?.hours.toFixed(2) || '0.00'}</td>
                <td className="border border-gray-300 p-2 text-right">$80</td>
                <td className="border border-gray-300 p-2 text-right font-bold">${charges.weekdayTravel?.charge.toFixed(2) || '0.00'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 p-2">Saturday</td>
                <td className="border border-gray-300 p-2 text-right">{charges.saturdayTravel?.hours.toFixed(2) || '0.00'}</td>
                <td className="border border-gray-300 p-2 text-right">$120</td>
                <td className="border border-gray-300 p-2 text-right font-bold">${charges.saturdayTravel?.charge.toFixed(2) || '0.00'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 p-2">Sun/Hol</td>
                <td className="border border-gray-300 p-2 text-right">{charges.sundayTravel?.hours.toFixed(2) || '0.00'}</td>
                <td className="border border-gray-300 p-2 text-right">$160</td>
                <td className="border border-gray-300 p-2 text-right font-bold">${charges.sundayTravel?.charge.toFixed(2) || '0.00'}</td>
              </tr>
              <tr>
                <td className="border border-gray-300 p-2 font-bold">Subtotal</td>
                <td className="border border-gray-300 p-2"></td>
                <td className="border border-gray-300 p-2"></td>
                <td className="border border-gray-300 p-2 text-right font-bold">${charges.travelChargesSubtotal?.toFixed(2) || '0.00'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ServiceChargesTable;
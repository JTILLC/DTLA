import { useState } from 'react';
import { useTimeSheet } from '../../context/TimeSheetContext';

function TravelCharges() {
  const { travelData, setTravelData } = useTimeSheet();
  const [formData, setFormData] = useState({
    perDiemType: travelData?.perDiemType || 'local',
    perDiemDays: travelData?.perDiemDays || 0,
    mileage: travelData?.mileage || 0,
    otherTravel: travelData?.otherTravel || 0,
    airTravel: {
      cost: travelData?.airTravel?.cost || 0,
      origin: travelData?.airTravel?.origin || '',
      destination: travelData?.airTravel?.destination || '',
      return: travelData?.airTravel?.return || '',
    },
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name.startsWith('airTravel.')) {
      const field = name.split('.')[1];
      setFormData((prev) => ({
        ...prev,
        airTravel: { ...prev.airTravel, [field]: value },
      }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setTravelData({
      perDiemType: formData.perDiemType,
      perDiemDays: Number(formData.perDiemDays) || 0,
      mileage: Number(formData.mileage) || 0,
      otherTravel: Number(formData.otherTravel) || 0,
      airTravel: {
        cost: Number(formData.airTravel.cost) || 0,
        origin: formData.airTravel.origin,
        destination: formData.airTravel.destination,
        return: formData.airTravel.return,
      },
    });
    alert('Travel data saved successfully');
  };

  return (
    <div className="mb-12">
      <h2 className="text-2xl font-semibold mb-4">Travel Charges</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Per Diem Type</label>
          <select
            name="perDiemType"
            value={formData.perDiemType}
            onChange={handleInputChange}
            className="w-full border p-2 rounded"
          >
            <option value="local">Local ($65/day)</option>
            <option value="non-local">Non-Local ($220/day)</option>
          </select>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Per Diem Days</label>
          <input
            type="number"
            name="perDiemDays"
            value={formData.perDiemDays}
            onChange={handleInputChange}
            className="w-full border p-2 rounded"
            min="0"
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Mileage (miles)</label>
          <input
            type="number"
            name="mileage"
            value={formData.mileage}
            onChange={handleInputChange}
            className="w-full border p-2 rounded"
            min="0"
            step="0.1"
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Auto/Taxi/Tolls/Fuel ($)</label>
          <input
            type="number"
            name="otherTravel"
            value={formData.otherTravel}
            onChange={handleInputChange}
            className="w-full border p-2 rounded"
            min="0"
            step="0.01"
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Airfare Cost ($)</label>
          <input
            type="number"
            name="airTravel.cost"
            value={formData.airTravel.cost}
            onChange={handleInputChange}
            className="w-full border p-2 rounded"
            min="0"
            step="0.01"
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Airfare Origin</label>
          <input
            type="text"
            name="airTravel.origin"
            value={formData.airTravel.origin}
            onChange={handleInputChange}
            className="w-full border p-2 rounded"
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Airfare Destination</label>
          <input
            type="text"
            name="airTravel.destination"
            value={formData.airTravel.destination}
            onChange={handleInputChange}
            className="w-full border p-2 rounded"
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Airfare Return</label>
          <input
            type="text"
            name="airTravel.return"
            value={formData.airTravel.return}
            onChange={handleInputChange}
            className="w-full border p-2 rounded"
          />
        </div>
        <button
          type="submit"
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Save Travel Data
        </button>
      </form>
    </div>
  );
}

export default TravelCharges;
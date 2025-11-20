import { useState } from 'react';
import { useTimeSheet } from '../../context/TimeSheetContext';

function CustomerInfo() {
  const { customerInfo, setCustomerInfo } = useTimeSheet();
  const [formData, setFormData] = useState(customerInfo);
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.serviceReportNumber) newErrors.serviceReportNumber = 'Service Report Number is required';
    if (!formData.company) newErrors.company = 'Company is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validateForm()) {
      setCustomerInfo(formData);
      alert('Customer information saved successfully');
    }
  };

  return (
    <div className="mb-12">
      <h2 className="text-2xl font-semibold mb-4">Customer Information</h2>
      <form onSubmit={handleSubmit}>
        {[
          { label: 'Service Report Number', name: 'serviceReportNumber' },
          { label: 'Company', name: 'company' },
          { label: 'Address', name: 'address' },
          { label: 'City', name: 'city' },
          { label: 'State', name: 'state' },
          { label: 'Contact', name: 'contact' },
          { label: 'Title', name: 'title' },
          { label: 'Phone', name: 'phone' },
          { label: 'Email', name: 'email' },
          { label: 'Purpose', name: 'purpose' },
        ].map((field) => (
          <div key={field.name} className="mb-4">
            <label className="block text-sm font-medium mb-1">{field.label}</label>
            <input
              type="text"
              name={field.name}
              value={formData[field.name]}
              onChange={handleChange}
              className="w-full border p-2 rounded"
            />
            {errors[field.name] && <p className="text-red-500 text-sm">{errors[field.name]}</p>}
          </div>
        ))}
        <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
          Save
        </button>
      </form>
    </div>
  );
}

export default CustomerInfo;

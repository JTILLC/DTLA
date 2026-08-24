// src/config/constants.js - Centralized configuration and constants

// Labor rates per hour
export const LABOR_RATES = {
  STRAIGHT: 120,
  OVERTIME: 180,
  DOUBLE: 240,
};

// Travel charge rates per day
export const TRAVEL_RATES = {
  WEEKDAY: 80,
  SATURDAY: 120,
  SUNDAY_HOLIDAY: 160,
};

// Per diem rates
export const PER_DIEM_RATES = {
  LOCAL: 65,
  NON_LOCAL: 220,
};

// Default values
export const DEFAULTS = {
  MILEAGE_RATE: 0.72, // single source of truth for the default mileage rate ($/mile)
  LUNCH_DURATION: 0.5,
  PER_DIEM_TYPE: 'local',
};

// Company information
export const COMPANY_INFO = {
  name: 'Joshua Todd Industries, LLC',
  email: 'josh@jtiaz.com',
  phone: '(623) 300-6445',
  address: '1329 N Malibu Lane',
  cityStateZip: 'Gilbert, AZ 85234',
  fullAddress: '1329 N Malibu Lane, Gilbert, AZ 85234',
  logoUrl: 'https://i.imgur.com/YourLogo.png', // Update with actual logo URL
};

// Form field configurations
export const CUSTOMER_FIELDS = [
  { key: 'company', label: 'Company', required: true },
  { key: 'contact', label: 'Contact' },
  { key: 'address', label: 'Address' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'email', label: 'Email' },
  { key: 'state', label: 'State' },
  { key: 'purpose', label: 'Purpose of Visit' },
];

export const INVOICE_FIELDS = [
  { key: 'invoiceNumber', label: 'Invoice #' },
  { key: 'invoiceDate', label: 'Invoice Date' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'poRefer', label: 'P.O. / Reference' },
  { key: 'serviceDates', label: 'Service Dates' },
  { key: 'paymentTerms', label: 'Payment Terms' },
];

// PDF configuration
export const PDF_CONFIG = {
  pageSize: 'letter',
  orientation: 'portrait',
  margin: 14,
  logoWidth: 50,
  logoHeight: 25,
  titleFontSize: 18,
  subtitleFontSize: 12,
  bodyFontSize: 10,
  tableFontSize: 9,
};

// Day types for travel calculations
export const DAY_TYPES = {
  WEEKDAY: 'weekday',
  SATURDAY: 'saturday',
  SUNDAY: 'sunday',
  HOLIDAY: 'holiday',
};

// Status messages
export const MESSAGES = {
  SELECT_CUSTOMER: 'Please select a customer first',
  NO_ENTRIES: 'No time entries to save',
  SAVE_SUCCESS: 'Data saved successfully!',
  DELETE_CONFIRM: 'Are you sure you want to delete this?',
  RESET_CONFIRM: 'Are you sure you want to reset all data? This cannot be undone.',
  CLOUD_SAVE_SUCCESS: 'Saved to cloud successfully!',
  CLOUD_LOAD_SUCCESS: 'Loaded from cloud successfully!',
};

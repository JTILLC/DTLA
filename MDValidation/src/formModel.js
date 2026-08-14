// Field definitions and the blank form data model for the Metal Detection Validation Form.

export const TRANSIT_TYPES = ['Belt', 'Modular', 'Drop'];

export const EJECTION_TYPES = [
  'Piston', 'Air Blast', 'Flap',
  'Retract', 'Valve', 'Downstream Stop',
  'Belt Stop', 'Other',
];

export const SAMPLE_TYPES = [
  { key: 'FE', label: '(FE) Ferrous' },
  { key: 'NFE', label: '(NFE) Non-Ferrous' },
  { key: 'SS', label: '(SS) Stainless Steel' },
];

export const blankFactoryRow = () => ({ diameter: '', manufacturer: '', serial: '', detected: '' }); // detected: 'Yes' | 'No'

export const blankProdRow = () => ({ diameter: '', detected: false, ejected: false });

export const blankProductSetup = () => ({
  productName: '',
  productDescription: '',
  sensitivity: '',
  band: '',
  txProgram: '',
  beltSpeed: '',
  ejectionMode: '',
  ejectionDistance: '',
  ejectionTime: '',
  noiseRunning: '',
  noiseEjecting: '',
  detection: { FE: blankProdRow(), NFE: blankProdRow(), SS: blankProdRow() },
});

export const initialData = () => ({
  certificateNo: '',

  // Customer information
  company: '',
  address: '',
  customerContact: '',
  position: '',
  phone: '',
  email: '',

  // Metal detector information
  brand: '',
  model: '',
  serialNumber: '',
  dimensions: '',

  // Transit type (single-select)
  transitType: '',

  // Ejection type (multi-select) + free text for "Other"
  ejectionTypes: [],
  ejectionOther: '',

  // Product default detection (factory default)
  factory: { FE: blankFactoryRow(), NFE: blankFactoryRow(), SS: blankFactoryRow() },

  // Product description & observation
  productType: '',
  wetDry: '',           // 'Wet' | 'Dry'
  inProduction: '',     // 'Yes' | 'No'
  systemStable: '',     // 'Yes' | 'No'
  baselineBars: '',     // product noise reading
  baselineStars: '',    // product noise reading
  systemDamaged: '',    // 'Yes' | 'No'
  detailedObservation: '',

  // Page 2 — product setups (add/remove; defaults to two)
  productSetups: [blankProductSetup(), blankProductSetup()],

  // Validation results
  validationResult: '', // 'Pass' | 'Fail'
  finalNotes: '',

  // Customer acknowledgement & signatures
  dateOfValidation: '',
  renewalDate: '',
  customerRepresentative: '',
  validatorName: '',
  customerSignatureImg: '', // PNG data URL (typed-in-cursive or hand-drawn)
  validatorSignatureImg: '',

  cloudId: '', // set once saved to / loaded from the cloud
});

export const STORAGE_KEY = 'mdvc-validation-form';

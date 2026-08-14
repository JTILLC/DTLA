// Data model for the X-Ray Validation Form.

export const blankSample = () => ({ type: '', size: '' });

export const xrayInitialData = () => ({
  // top info
  modelInformation: '',
  jobNumber: '',
  serialNumber: '',
  customerName: '',
  customerLocation: '',
  customerContact: '',

  // radiation detected per oval on the machine diagram (keyed by oval number 1..17)
  ovals: {},

  // sample sizes for foreign material (mm)
  productDescription: '',
  packagingMaterial: '',
  packageWeight: '',

  // test samples detected (add/remove)
  samples: [blankSample(), blankSample(), blankSample(), blankSample()],

  // machine diagnostics
  packageRejected: '',   // 'Yes' | 'No'
  corrections: '',
  maxIrradiation: '',
  voltage: '',
  current: '',
  lineSensor: '',
  generatorHours: '',
  xrayLamp: '',
  safetyCircuits: '',

  result: '',            // 'Pass' | 'Fail'
  date: '',
  dateDue: '',

  // signatures
  surveyor: '',
  customerRepresentative: '',
  surveyorSignatureImg: '',
  customerSignatureImg: '',

  cloudId: '',
});

export const XRAY_STORAGE_KEY = 'xray-validation-form';
export const XRAY_COLLECTION = 'xray_validations';

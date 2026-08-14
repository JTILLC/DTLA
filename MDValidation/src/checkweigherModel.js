// Data model for the Checkweigher Span Calibration Certificate.

export const checkweigherInitialData = () => ({
  modelInformation: '',
  jobNumber: '',
  serialNumber: '',
  customerName: '',
  customerLocation: '',
  customerContact: '',

  zeroAdjust: '',            // 'Yes' | 'No'
  lowestWeight: '',
  highestWeight: '',

  performSpanAdjustment: false,
  spanCalWeightSize: '',
  positionReadings: { topLeft: '', topRight: '', bottomLeft: '', bottomRight: '' },

  sampleWeights: Array(20).fill(''), // 20 sample weight test values
  comments: '',

  product: '',
  speed: '',
  actualWeight: '',
  meanWeight: '',
  standardDeviation: '',

  signerName: '',            // Customer Name (print)
  customerSignatureImg: '',
  validatorSignatureImg: '',
  customerDate: '',
  validatorDate: '',

  cloudId: '',
});

export const CW_STORAGE_KEY = 'checkweigher-validation-form';
export const CW_COLLECTION = 'checkweigher_validations';

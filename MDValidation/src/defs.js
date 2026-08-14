import { initialData as metalInit, STORAGE_KEY as metalStore } from './formModel';
import { buildValidationPDF } from './pdf';
import MetalFields from './MetalFields';
import { xrayInitialData, XRAY_STORAGE_KEY, XRAY_COLLECTION } from './xrayModel';
import { buildXrayPDF } from './xrayPdf';
import XrayFields from './XrayFields';
import { checkweigherInitialData, CW_STORAGE_KEY, CW_COLLECTION } from './checkweigherModel';
import { buildCheckweigherPDF } from './checkweigherPdf';
import CheckweigherFields from './CheckweigherFields';

// Each validation form is fully described here; FormShell drives the generic UI from this.
export const FORMS = {
  xray: {
    key: 'xray',
    short: 'X-Ray',
    title: 'X-Ray Validation Form',
    icon: '☢️',
    initialData: xrayInitialData,
    buildPdf: buildXrayPDF,
    storageKey: XRAY_STORAGE_KEY,
    collection: XRAY_COLLECTION,
    customerFields: ['customerName', 'customerLocation', 'customerContact'],
    fileName: (d) => `${d.serialNumber || d.customerName || 'xray'}-xray-validation`,
    summary: (v) => ({ title: v.customerName || '(no customer)', sub: `${v.serialNumber || 'no serial'} · ${v.modelInformation || ''}` }),
    Fields: XrayFields,
  },
  metal: {
    key: 'metal',
    short: 'Metal Detector',
    title: 'Metal Detection Validation Form',
    icon: '🧲',
    initialData: metalInit,
    buildPdf: buildValidationPDF,
    storageKey: metalStore,
    collection: 'metal_validations',
    customerFields: ['company', 'address', 'customerContact', 'position', 'phone', 'email'],
    fileName: (d) => `${d.certificateNo || 'no-cert'}-MDVF-${d.serialNumber || 'no-serial'}`,
    summary: (v) => ({ title: v.company || '(no company)', sub: `Cert ${v.certificateNo || '—'} · ${v.serialNumber || 'no serial'}` }),
    Fields: MetalFields,
  },
  checkweigher: {
    key: 'checkweigher',
    short: 'Checkweigher',
    title: 'Checkweigher Span Calibration Certificate',
    icon: '⚖️',
    initialData: checkweigherInitialData,
    buildPdf: buildCheckweigherPDF,
    storageKey: CW_STORAGE_KEY,
    collection: CW_COLLECTION,
    customerFields: ['customerName', 'customerLocation', 'customerContact'],
    fileName: (d) => `${d.serialNumber || d.customerName || 'checkweigher'}-checkweigher-calibration`,
    summary: (v) => ({ title: v.customerName || '(no customer)', sub: `${v.serialNumber || 'no serial'} · ${v.modelInformation || ''}` }),
    Fields: CheckweigherFields,
  },
};

export const FORM_LIST = [FORMS.xray, FORMS.metal, FORMS.checkweigher];

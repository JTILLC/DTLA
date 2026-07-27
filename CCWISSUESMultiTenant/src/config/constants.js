// src/config/constants.js - Centralized configuration and constants

export const ISSUE_TYPES = [
  'None',
  'Chute',
  'Operator',
  'Load Cell',
  'Detached Head',
  'Stepper Motor Error',
  'Hopper Issues',
  'Installed Wrong',
  'Radial Feeder',
  'Booster Hopper Issues',
  'Other'
];

export const FIXED_STATUS = {
  NA: 'na',
  FIXED: 'fixed',
  NOT_FIXED: 'not_fixed',
  ACTIVE_WITH_ISSUES: 'active_with_issues'
};

export const FIXED_STATUS_LABELS = {
  [FIXED_STATUS.NA]: 'N/A',
  [FIXED_STATUS.FIXED]: 'Fixed',
  [FIXED_STATUS.NOT_FIXED]: 'Not Fixed',
  [FIXED_STATUS.ACTIVE_WITH_ISSUES]: 'Active w/ Issues'
};

export const FIXED_STATUS_COLORS = {
  [FIXED_STATUS.NA]: '#6c757d',
  [FIXED_STATUS.FIXED]: '#ffc107',
  [FIXED_STATUS.NOT_FIXED]: '#dc3545',
  [FIXED_STATUS.ACTIVE_WITH_ISSUES]: '#17a2b8'
};

export const HEAD_STATUS = {
  ACTIVE: 'active',
  OFFLINE: 'offline'
};

export const PDF_CONFIG = {
  pageSize: 'a4',
  orientation: 'portrait',
  margin: 14,
  logoUrl: 'https://i.imgur.com/GQRZTtW.png',
  logoWidth: 30,
  logoHeight: 15,
  titleFontSize: 16,
  subtitleFontSize: 12,
  bodyFontSize: 10,
  tableFontSize: 8
};

export const SHARE_LINK_BASE_URL = 'https://jti-ccw-viewer.pages.dev/view';

export const DEFAULT_HEAD_COUNT = 14;

// Machine audit checklist — each item gets a Good / Bad / N-A status + a note
export const AUDIT_SECTIONS = [
  {
    title: 'EXTERIOR',
    items: [
      'RCU Condition', 'RF Pan Condition', 'DF Pan Condition', 'AF Pan Condition',
      'Chutes Condition', 'Infeed Chute Support Arms', 'RF Bolts Missing',
      'RF Boots Condition', 'DF Boots Condition', 'AF Boots Condition',
      'Pool Hopper Condition', 'Weigh Hopper Condition', 'Booster Hopper Condition',
    ],
  },
  {
    title: 'INTERIOR',
    items: [
      'Feeder Cover Condition', 'RF Feeder Condition', 'DF Feeder Condition', 'AF Feeder Condition',
      'WDU Condition', 'BDU Condition', 'Cabinet Doors Condition',
      'Drains Installed and clear', 'Air Dryer Functional',
    ],
  },
  {
    title: 'MISC ITEMS',
    items: [
      'TH/DTH/RS Condition', 'DF Test Drive', 'AF Test Drive',
      'TH Test Drive', 'DTH Test Drive', 'RS Test Drive', 'Touch Calb?',
    ],
  },
];

export const DEFAULT_GLOBAL_DATA = {
  customer: '',
  address: '',
  cityState: '',
  headCount: '14'
};

export const DEFAULT_HEAD = {
  status: 'active',
  error: 'None',
  notes: '',
  fixed: 'na',
  issues: [],
  currentWeight: 0,
  spanWeight: 0,
  weightDifference: 0
};

export const DEBOUNCE_DELAYS = {
  autoSave: 500,
  layoutSave: 500,
  searchFilter: 300
};

// Multi-tenant: all customer data lives under ONE shared workspace root
// (the original owner's uid), regardless of which user is signed in. Admins
// (see app_roles) read/write every customer; a customer user is scoped by
// Firestore rules to their own customers/{cid} subtree. Data paths use this
// constant instead of the logged-in user's uid so a customer login writes into
// the shared workspace, not a separate silo. See SETUP-MULTITENANT.md.
export const WORKSPACE_UID = 'tgezUokMZ1PO7iEDbLbj2U7Uwbx1';

// RedZone (QAD Redzone) maintenance push integration.
// The browser app never talks to RedZone directly (its OAuth secrets can't be
// exposed client-side) — it POSTs to our own Cloudflare Worker broker, which
// authenticates to RedZone and creates/updates the work order. See
// redzone-worker/ in this repo. Leave `pushEndpoint` empty until the Worker is
// deployed and RedZone API credentials are provisioned; while empty, the
// "Send to RedZone" button stays visible but explains it isn't configured yet.
export const REDZONE_CONFIG = {
  // Full URL of the deployed Worker's push endpoint, e.g.
  // 'https://ccwissues-redzone.<subdomain>.workers.dev/push'
  pushEndpoint: '',
  // Optional shared secret the Worker checks (sent as x-ccw-key header). This is
  // NOT the RedZone secret — it only gates who may call the Worker. Safe-ish to
  // ship, but prefer leaving blank and enforcing origin/CORS on the Worker.
  clientKey: ''
};

// Firebase configuration
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDnhtjMPh5bkKgRyZEfqIJmVISrJ_UkrB4",
  authDomain: "downtimelogger-a96fb.firebaseapp.com",
  projectId: "downtimelogger-a96fb",
  storageBucket: "downtimelogger-a96fb.firebasestorage.app",
  messagingSenderId: "941297034751",
  appId: "1:941297034751:web:80322c27de1b1b2e0cf3ca",
  measurementId: "G-ZRNDDFPK74"
};

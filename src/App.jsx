import { Fragment, useState, useEffect, useRef, useMemo } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Capacitor } from '@capacitor/core';
import {
  DocumentScanner,
  ResponseType,
  ScannerMode,
  ScanDocumentResponseStatus,
} from '@capgo/capacitor-document-scanner';
// 'dispatcher' | 'driver'
import './App.css';

export default function App() {
const rawApiBase = import.meta.env.VITE_API_BASE || '';
const API_BASE = (() => {
  if (!rawApiBase) return '';
  if (typeof window === 'undefined') return rawApiBase.replace(/\/$/, '');

  try {
    const apiUrl = new URL(rawApiBase);
    const localApiHosts = new Set(['localhost', '127.0.0.1']);
    const browserHost = window.location.hostname;

    if (localApiHosts.has(apiUrl.hostname) && !localApiHosts.has(browserHost)) {
      apiUrl.hostname = browserHost;
      return apiUrl.toString().replace(/\/$/, '');
    }

    return rawApiBase.replace(/\/$/, '');
  } catch {
    return rawApiBase.replace(/\/$/, '');
  }
})();
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const APP_PORTAL = import.meta.env.VITE_APP_PORTAL || 'web';
const APP_TIME_ZONE = 'America/Chicago';
const DEMO_TOKEN = 'PORTFLOW_DEMO';
const DEMO_ACCESS_CODE = import.meta.env.VITE_DEMO_ACCESS_CODE || 'PORTFLOW-DEMO';
const PORTFLOW_OWNER_EMAIL = (import.meta.env.VITE_PORTFLOW_OWNER_EMAIL || 'oliver@portflow-net.com').toLowerCase();

const getDateStringInAppTimeZone = (dateValue = new Date()) => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const getPart = (type) => parts.find((part) => part.type === type)?.value || '';
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  return year && month && day ? `${year}-${month}-${day}` : '';
};

const getLocalDatePortion = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
};

const getDateStringWithOffsetInAppTimeZone = (offsetDays = 0) => {
  const today = getDateStringInAppTimeZone();
  if (!today) return '';

  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0));
  return getDateStringInAppTimeZone(date);
};
const isDriverWebPath = typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/driver';
const isDriverApp = APP_PORTAL === 'driver' || isDriverWebPath;

const [driverForm, setDriverForm] = useState({
  id: '',
  name: '',
  email: '',
  password: '',
  phone: '',
  truck: '',
  isActive: true,
});

const emptyStaffForm = {
  name: '',
  email: '',
  password: '',
  role: 'dispatcher',
  isActive: true,
};

const staffRoleOptions = [
  { value: 'dispatcher', label: 'Dispatcher' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
];

const fullAccessRoles = new Set(['admin', 'owner', 'carrier']);
const getNormalizedRole = (role) => String(role || '').trim().toLowerCase();
const isPortFlowOwnerUser = (user = {}) => {
  const safeUser = user || {};
  return (
    getNormalizedRole(safeUser.role) === 'owner' ||
    String(safeUser.email || '').trim().toLowerCase() === PORTFLOW_OWNER_EMAIL
  );
};
const getDefaultViewForRole = (role) => {
  const normalizedRole = getNormalizedRole(role);
  if (normalizedRole === 'owner') return 'tenants';
  if (normalizedRole === 'driver') return 'driver';
  if (normalizedRole === 'payroll') return 'settlements';
  return 'dispatch';
};

const roleCanAccessView = (role, view) => {
  const normalizedRole = getNormalizedRole(role);
  if (view === 'tenants') return normalizedRole === 'owner';
  if (fullAccessRoles.has(normalizedRole)) return true;
  if (normalizedRole === 'driver') return view === 'driver';
  if (normalizedRole === 'payroll') return ['settlements', 'invoices', 'accounting', 'settings'].includes(view);
  if (normalizedRole === 'manager') {
    return ['dispatch', 'completed', 'drivers', 'customers', 'settlements', 'invoices', 'accounting', 'settings'].includes(view);
  }
  if (normalizedRole === 'dispatcher') {
    return ['dispatch', 'completed', 'drivers', 'customers', 'settings'].includes(view);
  }
  return view === 'dispatch';
};

const [staffForm, setStaffForm] = useState(emptyStaffForm);

 const checklistDocumentTypes = [
  'IN EIR',
  'OUT EIR',
  'POD',
  'BOL',
  'Rate Confirmation',
];
const shipLineOptions = [
  'CHS: COSCO',
  'CMA: CMA-CGM',
  'EVG: EVERGREEN',
  'HAS: Hyundai',
  'HLC: Hapag Lloyd',
  'LPU: Linea',
  'MAE: Maersk',
  'MSC',
  'ONL: ONE Line',
  'OOC: OOCL',
  'YML: Yang Ming',
  'ZIM: ZIM Lines',
];
const loadPresets = [
  {
    name: 'Bayport Import',
    pickup: 'Bayport Container Terminal',
    returnLocation: 'Bayport Container Terminal',
    status: 'Dispatched',
    availabilityStatus: 'Not Available',
  },
  {
    name: 'Barbours Cut Import',
    pickup: 'Barbours Cut Terminal',
    returnLocation: 'Barbours Cut Terminal',
    status: 'Dispatched',
    availabilityStatus: 'Not Available',
  },
  {
    name: 'Yard Move',
    status: 'Dispatched',
    availabilityStatus: 'Not Available',
    dropType: 'Yard',
  },
  {
    name: 'Export Load',
    status: 'Dispatched',
    availabilityStatus: 'Not Available',
    containerNumber: '',
  },
];
const documentTypes = [...checklistDocumentTypes, 'Other'];
const normalizeDocType = (type) => {
  if (!type) return '';

  const t = type.toLowerCase();

  if (t === 'in eir') return 'IN EIR';
  if (t === 'out eir') return 'OUT EIR';

  return type;
};

  const parseMoney = (value) => {
    if (!value) return 0;
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    const number = parseFloat(cleaned);
    return Number.isNaN(number) ? 0 : number;
  };

  const formatMoney = (value) => {
    return `$${value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

 const formatAppointmentTime = (value) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}; 

const normalizeDateTimeInputValue = (value) => {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return text;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 16);

  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatDateTime = (value) => {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const normalizeDriverText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-');

const getDriverRecord = (driverValue) => {
  const raw = String(driverValue || '').trim();
  if (!raw) return null;

  const normalized = normalizeDriverText(raw);

  return (
    driversList.find((d) => normalizeDriverText(d.id) === normalized) ||
    driversList.find((d) => normalizeDriverText(d.name) === normalized) ||
    driversList.find(
      (d) => `${normalizeDriverText(d.id)}-${normalizeDriverText(d.name)}` === normalized
    ) ||
    null
  );
};

const getDriverLabel = (driverValue) => {
  const match = getDriverRecord(driverValue);
  if (match) return `${match.id} - ${match.name}`;
  return String(driverValue || '').trim() || 'No driver assigned';
};

const getLoadQuickStatus = (load = {}) => {
  const operationalStatus = String(load.status || '').trim();
  const operationalKey = operationalStatus.toLowerCase();

  if (['in transit', 'dropped', 'delivered', 'completed'].includes(operationalKey)) {
    return operationalStatus;
  }

  if (['Available', 'Not Available'].includes(load.availabilityStatus)) {
    return load.availabilityStatus;
  }

  return operationalStatus || '';
};

const getLoadQuickStatusKey = (load = {}) =>
  String(getLoadQuickStatus(load) || '').trim().toLowerCase();

const getDroppedByDriverValue = (load = {}) => {
  const droppedBy = normalizeDriverForStorage(load.droppedBy);
  if (droppedBy) return droppedBy;
  return getLoadQuickStatusKey(load) === 'dropped'
    ? normalizeDriverForStorage(load.driver)
    : '';
};

const getAvailabilityStatusKey = (load = {}) =>
  String(load.availabilityStatus || '').trim().toLowerCase();

const normalizeDriverForStorage = (driverValue) => {
  const raw = String(driverValue || '').trim();
  if (!raw) return '';

  const match = getDriverRecord(raw);
  if (match?.id) return match.id;

  const idMatch = raw.match(/\bDRV-\d+\b/i);
  return idMatch ? idMatch[0].toUpperCase() : '';
};

const shouldAutoDispatchLoad = (driverValue, status) => {
  const driverId = normalizeDriverForStorage(driverValue);
  const currentStatus = String(status || '').trim().toLowerCase();
  return Boolean(driverId) && (!currentStatus || ['pending', 'available', 'not available'].includes(currentStatus));
};

const getStatusAfterDriverAssignment = (driverValue, status) =>
  shouldAutoDispatchLoad(driverValue, status) ? 'Dispatched' : status;

const driverMatchesCurrentUser = (driverValue, currentUser) => {
  const assignedDriverId = normalizeDriverForStorage(driverValue);
  const currentDriverId = normalizeDriverForStorage(currentUser?.driverId);
  return Boolean(assignedDriverId && currentDriverId && assignedDriverId === currentDriverId);
};

const shortLocation = (value) => {
  if (!value) return '—';
  return value.split(',')[0];
};
const getGoogleMapsLink = (address) => {
  if (!address) return '#';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
};
const getGoogleMapsCoordinateLink = (latitude, longitude) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;

const formatMiles = (value) => {
  const miles = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(miles) || miles <= 0) return '—';
  return `${miles.toFixed(1)} mi`;
};

const getRouteMileStops = (load = {}) => {
  const nextMoveType = String(load.nextMoveType || '').trim().toLowerCase();
  const destination = nextMoveType === 'return'
    ? load.returnLocation || load.delivery
    : load.delivery;

  return [
    load.pickup,
    destination,
    nextMoveType === 'return' ? '' : load.returnLocation,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const calculateDrivingMiles = async (load = {}) => {
  const stops = getRouteMileStops(load);
  if (stops.length < 2) {
    throw new Error('Pickup and delivery are required to calculate miles.');
  }
  if (!window.google?.maps?.DistanceMatrixService) {
    throw new Error('Google Maps is still loading. Try again in a moment.');
  }

  const service = new window.google.maps.DistanceMatrixService();
  let totalMeters = 0;

  for (let index = 0; index < stops.length - 1; index += 1) {
    const origin = stops[index];
    const destination = stops[index + 1];
    const result = await new Promise((resolve, reject) => {
      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: window.google.maps.TravelMode.DRIVING,
          unitSystem: window.google.maps.UnitSystem.IMPERIAL,
        },
        (response, status) => {
          if (status !== 'OK') {
            reject(new Error(`Google Maps distance failed: ${status}`));
            return;
          }
          const element = response?.rows?.[0]?.elements?.[0];
          if (!element || element.status !== 'OK' || !element.distance?.value) {
            reject(new Error(`No route found from ${shortLocation(origin)} to ${shortLocation(destination)}.`));
            return;
          }
          resolve(element.distance.value);
        }
      );
    });
    totalMeters += result;
  }

  return Math.round((totalMeters / 1609.344) * 10) / 10;
};

const formatRelativeTime = (value) => {
  if (!value) return 'No update yet';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes === 1) return '1 min ago';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours === 1) return '1 hr ago';
  if (diffHours < 24) return `${diffHours} hrs ago`;

  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getDocumentUrl = (doc) => {
  if (!doc) return '';
  if (doc.id) return `${API_BASE}/api/documents/${encodeURIComponent(doc.id)}/file`;
  if (doc.url) return `${API_BASE}${doc.url}`;

  const filePath = String(doc.filePath || '');
  const fileName = filePath.split(/[\\/]/).pop();
  return fileName ? `${API_BASE}/uploads/${encodeURIComponent(fileName)}` : '';
};

const formatLocationAddress = (location = {}) => {
  const address = [
    location.address,
    location.city,
    location.state,
    location.zip,
  ]
    .filter(Boolean)
    .join(', ');

  return address || location.name || '';
};

const getLocationOptionLabel = (location = {}) => {
  const address = formatLocationAddress(location);
  if (location.name && address && location.name !== address) {
    return `${location.name} - ${address}`;
  }
  return address || location.name || 'Unnamed location';
};

const getAuthStorageKey = (key) => (isDriverApp ? `driver:${key}` : key);

const getAuthStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    return isDriverApp ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

const getAuthStorageItem = (key) => {
  const storage = getAuthStorage();
  if (!storage) return '';
  const storageKey = getAuthStorageKey(key);
  return storage.getItem(storageKey) || (isDriverApp ? window.localStorage?.getItem(key) : '') || '';
};
const setAuthStorageItem = (key, value) => {
  const storage = getAuthStorage();
  if (storage) storage.setItem(getAuthStorageKey(key), value);
};
const removeAuthStorageItem = (key) => {
  const storage = getAuthStorage();
  if (storage) storage.removeItem(getAuthStorageKey(key));
};
const clearAuthSession = () => {
  ['authToken', 'currentUser', 'company'].forEach((key) => {
    removeAuthStorageItem(key);
    if (isDriverApp) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore legacy storage cleanup failures.
      }
    }
  });
};
const saveAuthSession = (token, user, companyData) => {
  setAuthStorageItem('authToken', token || '');
  setAuthStorageItem('currentUser', JSON.stringify(user || null));
  if (companyData) {
    setAuthStorageItem('company', JSON.stringify(companyData));
  } else {
    removeAuthStorageItem('company');
  }
};
const saveCompanySession = (companyData) => {
  if (companyData) {
    setAuthStorageItem('company', JSON.stringify(companyData));
  }
};
const parseAuthJson = (key) => {
  try {
    return JSON.parse(getAuthStorageItem(key) || 'null');
  } catch {
    return null;
  }
};
const loginPathRequested =
  typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/login';
if (loginPathRequested) {
  clearAuthSession();
}

const isInvalidTokenError = (message = '') =>
  String(message).toLowerCase().includes('invalid token') ||
  String(message).toLowerCase().includes('unauthorized') ||
  String(message).includes('401');

const handleAuthError = (message) => {
  if (!isInvalidTokenError(message)) return false;
  if (getAuthStorageItem('authToken') === DEMO_TOKEN) return false;

  clearAuthSession();
  setAuthToken('');
  setCurrentUser(null);
  setCompany(null);
  setLoginError('Your session expired after the latest update. Please log in again.');
  return true;
};
  const calculateLoadSettlement = ({ driverRate, detention, lumper, fuelAdvance }) => {
    const total =
      parseMoney(driverRate) +
      parseMoney(lumper) -
      parseMoney(fuelAdvance);

    return formatMoney(total);
  };

  const roundMoney = (value = 0) => Math.round((Number(value) || 0) * 100) / 100;

  class SettlementEngine {
    constructor(config = {}) {
      this.config = {
        dispatchRate: Number(config.dispatchRate) || 0,
        driverPercentage: Number(config.driverPercentage) || 0,
        weeklyInsurance: parseMoney(config.weeklyInsurance),
        fuel: parseMoney(config.fuel),
        parking: parseMoney(config.parking),
        loanRepayment: parseMoney(config.loanRepayment),
        occupationalAccident: parseMoney(config.occupationalAccident),
        otherPersonalDeductions: parseMoney(config.otherPersonalDeductions),
        detentionHourlyRate: parseMoney(config.detentionHourlyRate),
        detentionHours: parseMoney(config.detentionHours),
      };
    }

    getLoadRevenue(load = {}) {
      const revenue = load.revenue || {};
      const lineHaul = parseMoney(revenue.lineHaul ?? load.lineHaul ?? load.rate ?? load.driverRate);
      const prePull = parseMoney(revenue.prePull ?? load.prePull ?? load.prePullPay);
      const stopOff = parseMoney(revenue.stopOff ?? load.stopOff ?? load.stopOffPay);

      return {
        lineHaul: roundMoney(lineHaul),
        prePull: roundMoney(prePull),
        stopOff: roundMoney(stopOff),
        total: roundMoney(lineHaul + prePull + stopOff),
      };
    }

    process(loads = [], expenses = {}) {
      const revenueItems = loads.map((load) => ({
        loadId: load.id || load.loadNumber || '',
        container: load.containerNumber || '',
        customer: load.customer || '',
        ...this.getLoadRevenue(load),
      }));

      const manualRevenue = {
        prePull: parseMoney(expenses.prePulls),
        stopOff: parseMoney(expenses.stopOffs),
      };

      const revenueSummary = {
        lineHaul: roundMoney(revenueItems.reduce((sum, item) => sum + item.lineHaul, 0)),
        prePulls: roundMoney(revenueItems.reduce((sum, item) => sum + item.prePull, 0) + manualRevenue.prePull),
        stopOffs: roundMoney(revenueItems.reduce((sum, item) => sum + item.stopOff, 0) + manualRevenue.stopOff),
      };
      revenueSummary.totalGrossRevenue = roundMoney(
        revenueSummary.lineHaul + revenueSummary.prePulls + revenueSummary.stopOffs
      );

      const sharedDeductions = {
        dispatchFee: roundMoney(revenueSummary.totalGrossRevenue * this.config.dispatchRate),
        weeklyInsurance: roundMoney(this.config.weeklyInsurance),
        fuel: roundMoney(this.config.fuel),
      };
      sharedDeductions.totalSharedExpenses = roundMoney(
        sharedDeductions.dispatchFee + sharedDeductions.weeklyInsurance + sharedDeductions.fuel
      );

      const splittableRevenue = roundMoney(
        revenueSummary.totalGrossRevenue - sharedDeductions.totalSharedExpenses
      );
      const splitStage = {
        driverPercentage: this.config.driverPercentage,
        splittableRevenue,
        baseDriverPay: roundMoney(splittableRevenue * this.config.driverPercentage),
      };

      const fallbackDetentionPay = parseMoney(expenses.detentionPay);
      const hourlyDetentionPay =
        this.config.detentionHourlyRate > 0 && this.config.detentionHours > 0
          ? this.config.detentionHourlyRate * this.config.detentionHours
          : fallbackDetentionPay;
      const additions = {
        detentionPay: roundMoney(hourlyDetentionPay),
      };
      additions.totalAdditions = roundMoney(additions.detentionPay);

      const personalDeductions = {
        parking: roundMoney(this.config.parking),
        loanRepayment: roundMoney(this.config.loanRepayment),
        occupationalAccident: roundMoney(this.config.occupationalAccident),
        otherPersonalDeductions: roundMoney(this.config.otherPersonalDeductions),
      };
      personalDeductions.totalPersonalDeductions = roundMoney(
        personalDeductions.parking +
          personalDeductions.loanRepayment +
          personalDeductions.occupationalAccident +
          personalDeductions.otherPersonalDeductions
      );

      const finalTakeHomePay = roundMoney(
        splitStage.baseDriverPay + additions.totalAdditions - personalDeductions.totalPersonalDeductions
      );

      return {
        config: this.config,
        revenueItems,
        revenueSummary,
        sharedDeductions,
        splitStage,
        additions,
        personalDeductions,
        finalTakeHomePay,
        statementSummary: {
          revenueSummary,
          sharedDeductions,
          splitStage,
          finalAdjustments: {
            additions,
            personalDeductions,
            finalTakeHomePay,
          },
        },
      };
    }
  }

  const calculateSettlement = (data = {}) => {
    const engine = new SettlementEngine({
      dispatchRate: data.dispatchRate,
      driverPercentage: data.driverSplitRate ?? data.driverPercentage,
      weeklyInsurance: data.insurance ?? data.weeklyInsurance,
      fuel: data.fuel,
      parking: data.parking,
      loanRepayment: data.loanRepayment,
      occupationalAccident: data.occupationalAccident,
      otherPersonalDeductions: data.otherPersonalDeductions,
      detentionHourlyRate: data.detentionHourlyRate,
      detentionHours: data.detentionHours,
    });
    const loads = Array.isArray(data.loads)
      ? data.loads
      : (Array.isArray(data.loadRates) ? data.loadRates : []).map((rate, index) => ({
          id: `load-${index + 1}`,
          rate,
        }));

    const result = engine.process(loads, {
      prePulls: data.prePulls,
      stopOffs: data.stopOffs,
      detentionPay: data.detentionPay,
    });

    return {
      ...result,
      grossPay: result.revenueSummary.totalGrossRevenue,
      dispatchRate: result.config.dispatchRate,
      dispatchFee: result.sharedDeductions.dispatchFee,
      insurance: result.sharedDeductions.weeklyInsurance,
      fuel: result.sharedDeductions.fuel,
      sharedDeductions: result.sharedDeductions.totalSharedExpenses,
      splitAmount: result.splitStage.splittableRevenue,
      driverSplitRate: result.splitStage.driverPercentage,
      driverShare: result.splitStage.baseDriverPay,
      parking: result.personalDeductions.parking,
      loanRepayment: result.personalDeductions.loanRepayment,
      occupationalAccident: result.personalDeductions.occupationalAccident,
      otherPersonalDeductions: result.personalDeductions.otherPersonalDeductions,
      detentionPay: result.additions.detentionPay,
      finalPayCheck: result.finalTakeHomePay,
    };
  };

  const customerExtraChargeTypes = [
    'Chassis Charge',
    'Storage Charge',
    'Scale Ticket',
    'Lumper Charge',
    'Waiting Time',
    'Other',
  ];

  const parseCustomerExtraCharges = (load = {}) => {
    const source = load.customerExtraCharges || load.customerExtraChargesJson || [];
    if (Array.isArray(source)) return source;
    try {
      const parsed = JSON.parse(source || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const normalizeCustomerExtraCharges = (charges = []) =>
    charges
      .map((charge) => ({
        id: charge.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: String(charge.type || 'Other').trim() || 'Other',
        description: String(charge.description || '').trim(),
        amount: parseMoney(charge.amount),
      }))
      .filter((charge) => charge.description || charge.amount);

  const getCustomerExtraChargesTotal = (load) =>
    parseCustomerExtraCharges(load).reduce((sum, charge) => sum + parseMoney(charge.amount), 0);

  const getCustomerBillAmount = (load) =>
    parseMoney(load?.rate) + parseMoney(load?.detention) + getCustomerExtraChargesTotal(load);

  const getDriverPayWithDetention = (load) =>
    parseMoney(load?.driverRate);

const getPaperworkStatusFromDocuments = (documents = []) => {
  return documents.length > 0 ? 'Submitted' : 'Pending';
};

const getDocumentCategory = (doc) =>
  String(doc?.category || doc?.type || '').trim().toUpperCase();

const requiredDriverDocumentTypes = ['POD'];

const hasRequiredDriverDocuments = (load) => {
  const uploaded = new Set((load?.documents || []).map(getDocumentCategory));
  return requiredDriverDocumentTypes.every((docType) => uploaded.has(docType));
};

const getMissingDriverDocuments = (load) => {
  const uploaded = new Set((load?.documents || []).map(getDocumentCategory));
  return requiredDriverDocumentTypes.filter((docType) => !uploaded.has(docType));
};

 const getTodayDate = () => getDateStringInAppTimeZone();

  const getStartOfWeek = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const getEndOfWeek = (date) => {
    const start = getStartOfWeek(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
  };

  const isDateInRange = (dateString, start, end) => {
    if (!dateString) return false;
    const date = new Date(`${dateString}T12:00:00`);
    return date >= start && date <= end;
  };

  const emptyLoad = {
    id: '',
    loadDate: getTodayDate(),
    customer: '',
    driver: '',
    truck: '',
    pickup: '',
    delivery: '',
    streetTurn: false,
    deliveryType: '',
    referenceNumber: '',
    poNumber: '',
    pickupNumber: '',
    reservationNumber: '',
    returnNumber: '',
    returnLocation: '',
    nextMoveType: '',
    lastFreeDay: '',
    containerNumber: '',
    bookingNumber: '',
    appointmentTime: '',
    eta: '',
    chassisNumber: '',
    sealNumber: '',
    containerSize: '',
    shipLine: '',
    rate: '',
    driverRate: '',
    miles: '',
    status: 'Dispatched',
    availabilityStatus: 'Not Available',
    paperwork: 'Pending',
    detention: '$0.00',
    lumper: '$0.00',
    fuelAdvance: '$0.00',
    settlement: '$0.00',
    notes: '',
    documents: [],
    dropType: '',
dropLocation: '',
droppedBy: '',
dropDateTime: '',
  };

  const emptyCustomer = {
    id: '',
    name: '',
    contactName: '',
    email: '',
    phone: '',
    notes: '',
    address: '',
city: '',
state: '',
zip: '',
  };

const getDemoData = () => {
  const today = getDateStringInAppTimeZone();
  const tomorrow = getDateStringWithOffsetInAppTimeZone(1);
  const yesterday = getDateStringWithOffsetInAppTimeZone(-1);

  const demoDrivers = [
    { id: 'DRV-001', name: 'Manuel Escobar', email: 'manuel.demo@portflow.com', phone: '346-555-0101', truck: 'TX-104', isActive: true },
    { id: 'DRV-002', name: 'Luis Martinez', email: 'luis.demo@portflow.com', phone: '346-555-0102', truck: 'TX-118', isActive: true },
    { id: 'DRV-003', name: 'Carlos Rivera', email: 'carlos.demo@portflow.com', phone: '346-555-0103', truck: 'TX-122', isActive: true },
  ];

  const demoLoads = [
    {
      ...emptyLoad,
      id: 'DEMO-1001',
      loadDate: today,
      customer: 'Blue Wave Imports',
      driver: 'DRV-001',
      truck: 'TX-104',
      pickup: 'Barbours Cut Terminal, La Porte, TX',
      delivery: 'Blue Wave Warehouse, 8200 Market St, Houston, TX',
      returnLocation: 'Barbours Cut Empty Yard',
      deliveryType: 'local',
      referenceNumber: 'REF-77821',
      poNumber: 'PO-44021',
      pickupNumber: 'PU-8120',
      containerNumber: 'MSCU4527810',
      bookingNumber: 'BOL884210',
      appointmentTime: `${today}T09:30`,
      eta: '10:45 AM',
      chassisNumber: 'CHZ884201',
      sealNumber: 'SEAL7712',
      containerSize: '40HC',
      shipLine: 'MSC',
      rate: '$1,225.00',
      driverRate: '$525.00',
      status: 'Dispatched',
      availabilityStatus: 'Available',
      paperwork: 'Pending',
      lastFreeDay: today,
      documents: [{ id: 'demo-pod-1', category: 'POD', fileName: 'demo-pod.pdf', uploadedAt: new Date().toISOString() }],
    },
    {
      ...emptyLoad,
      id: 'DEMO-1002',
      loadDate: today,
      customer: 'Gulf Coast Retail',
      driver: 'DRV-002',
      truck: 'TX-118',
      pickup: 'Bayport Terminal, Pasadena, TX',
      delivery: 'Gulf Coast DC, 1550 Commerce Pkwy, Pasadena, TX',
      returnLocation: 'Bayport Empty Yard',
      deliveryType: 'local',
      referenceNumber: 'REF-77822',
      poNumber: 'PO-44022',
      pickupNumber: 'PU-8121',
      containerNumber: 'TCLU3389021',
      bookingNumber: 'BOL884211',
      appointmentTime: `${today}T13:00`,
      eta: '2:15 PM',
      chassisNumber: 'CHZ338902',
      sealNumber: 'SEAL3389',
      containerSize: '20ST',
      shipLine: 'CMA: CMA-CGM',
      rate: '$950.00',
      driverRate: '$425.00',
      status: 'In Transit',
      availabilityStatus: '',
      paperwork: 'Pending',
      lastFreeDay: tomorrow,
    },
    {
      ...emptyLoad,
      id: 'DEMO-1003',
      loadDate: yesterday,
      customer: 'Lone Star Foods',
      driver: 'DRV-003',
      truck: 'TX-122',
      pickup: 'Barbours Cut Terminal, La Porte, TX',
      delivery: 'Lone Star Cold Storage, 410 Freeport Rd, Houston, TX',
      returnLocation: 'Barbours Cut Empty Yard',
      deliveryType: 'highway',
      referenceNumber: 'REF-77823',
      poNumber: 'PO-44023',
      pickupNumber: 'PU-8122',
      containerNumber: 'CMAU7703914',
      bookingNumber: 'BOL884212',
      appointmentTime: `${yesterday}T08:00`,
      chassisNumber: 'CHZ770391',
      sealNumber: 'SEAL7703',
      containerSize: '40ST',
      shipLine: 'MAE: Maersk',
      rate: '$1,450.00',
      driverRate: '$650.00',
      status: 'Completed',
      paperwork: 'Complete',
      lastFreeDay: yesterday,
      documents: [
        { id: 'demo-out-eir-1', category: 'OUT EIR', fileName: 'demo-out-eir.pdf', uploadedAt: new Date().toISOString() },
        { id: 'demo-pod-2', category: 'POD', fileName: 'demo-pod.pdf', uploadedAt: new Date().toISOString() },
      ],
    },
    {
      ...emptyLoad,
      id: 'DEMO-1004',
      loadDate: tomorrow,
      customer: 'Texas Solar Supply',
      driver: '',
      pickup: 'Bayport Terminal, Pasadena, TX',
      delivery: 'Texas Solar Yard, 2900 Beltway 8, Houston, TX',
      deliveryType: 'local',
      referenceNumber: 'REF-77824',
      poNumber: 'PO-44024',
      containerNumber: 'OOLU9921145',
      bookingNumber: 'BOL884213',
      appointmentTime: `${tomorrow}T11:30`,
      containerSize: '40HC',
      shipLine: 'OOC: OOCL',
      rate: '$1,100.00',
      driverRate: '$500.00',
      status: 'Not Available',
      availabilityStatus: 'Not Available',
      lastFreeDay: tomorrow,
      notes: 'Demo load with road hold.',
    },
  ];

  return {
    company: {
      id: 'demo-company',
      name: 'PortFlow Demo Carrier',
      email: 'oliver@portflow-net.com',
      invoiceName: 'PortFlow Demo Carrier',
      invoiceAddress: 'Houston, TX',
      logoUrl: '/portflow-icon-192.png',
      portHoustonConfigured: true,
      portHoustonCredentials: {},
    },
    user: {
      id: 'demo-dispatcher',
      companyId: 'demo-company',
      name: 'Demo Dispatcher',
      email: 'demo@portflow.com',
      role: 'admin',
    },
    drivers: demoDrivers,
    customers: [
      { id: 'CUST-DEMO-1', name: 'Blue Wave Imports', contactName: 'Sarah Jones', email: 'ops@bluewave.example', phone: '713-555-0140', address: '8200 Market St', city: 'Houston', state: 'TX', zip: '77029' },
      { id: 'CUST-DEMO-2', name: 'Gulf Coast Retail', contactName: 'Mike Adams', email: 'dispatch@gulf.example', phone: '713-555-0141', address: '1550 Commerce Pkwy', city: 'Pasadena', state: 'TX', zip: '77507' },
      { id: 'CUST-DEMO-3', name: 'Lone Star Foods', contactName: 'Ana Garcia', email: 'shipping@lonestar.example', phone: '713-555-0142', address: '410 Freeport Rd', city: 'Houston', state: 'TX', zip: '77015' },
    ],
    locations: [
      { id: 'LOC-DEMO-1', name: 'Barbours Cut Terminal', type: 'pickup', address: '1515 E Barbours Cut Blvd', city: 'La Porte', state: 'TX', zip: '77571' },
      { id: 'LOC-DEMO-2', name: 'Bayport Terminal', type: 'pickup', address: '12619 Port Rd', city: 'Pasadena', state: 'TX', zip: '77586' },
      { id: 'LOC-DEMO-3', name: 'Blue Wave Warehouse', type: 'delivery', address: '8200 Market St', city: 'Houston', state: 'TX', zip: '77029' },
    ],
    loads: demoLoads,
    invoices: [],
    users: [
      { id: 'demo-dispatcher', name: 'Demo Dispatcher', email: 'demo@portflow.com', role: 'admin', isActive: true },
      ...demoDrivers.map((driver) => ({ id: `user-${driver.id}`, name: driver.name, email: driver.email, role: 'driver', isActive: true, driverId: driver.id })),
    ],
    liveLocations: [
      { driverId: 'DRV-001', driverName: 'Manuel Escobar', latitude: 29.7355, longitude: -95.0124, updatedAt: new Date().toISOString() },
      { driverId: 'DRV-002', driverName: 'Luis Martinez', latitude: 29.6211, longitude: -95.0156, updatedAt: new Date().toISOString() },
    ],
  };
};
  
  const addressInputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const inlineCustomerAddressInputRef = useRef(null);
  const inlineCustomerAutocompleteRef = useRef(null);

  const pickupInputRef = useRef(null);
const pickupAutocompleteRef = useRef(null);
const newPickupAddressInputRef = useRef(null);
const newPickupAutocompleteRef = useRef(null);

const deliveryInputRef = useRef(null);
const deliveryAutocompleteRef = useRef(null);

const returnInputRef = useRef(null);
const returnAutocompleteRef = useRef(null);
const [allUsers, setAllUsers] = useState([]);
const [locations, setLocations] = useState([]);
const newDeliveryAddressInputRef = useRef(null);
const newDeliveryAutocompleteRef = useRef(null);
const [uploadDocType, setUploadDocType] = useState({});
const [uploadFileByLoad, setUploadFileByLoad] = useState({});
const uploadFileRef = useRef({});
const [driverUploadStatusByLoad, setDriverUploadStatusByLoad] = useState({});
const [driverCameraLoadId, setDriverCameraLoadId] = useState('');
const [driverCameraError, setDriverCameraError] = useState('');
const [driverScannerPreview, setDriverScannerPreview] = useState(null);
const [driverScannerMode, setDriverScannerMode] = useState('web');
const [driverScannerUploading, setDriverScannerUploading] = useState(false);
const driverCameraVideoRef = useRef(null);
const driverCameraStreamRef = useRef(null);
const [dashboardFilter, setDashboardFilter] = useState('all');
const [appointmentDateFilter, setAppointmentDateFilter] = useState('today');
const [appointmentDeliveryTypeFilter, setAppointmentDeliveryTypeFilter] = useState('all');
const [customAppointmentDate, setCustomAppointmentDate] = useState(getTodayDate());
const [availableAppointmentDateFilter, setAvailableAppointmentDateFilter] = useState('today');
const [availableDeliveryTypeFilter, setAvailableDeliveryTypeFilter] = useState('all');
const [availableCustomAppointmentDate, setAvailableCustomAppointmentDate] = useState(getTodayDate());
const [driverMobileTab, setDriverMobileTab] = useState('active');
const [driverTrackingEnabled, setDriverTrackingEnabled] = useState(false);
const [driverTrackingStatus, setDriverTrackingStatus] = useState('Location sharing is off.');
const [driverTrackingHelp, setDriverTrackingHelp] = useState('');
const [driverLastLocation, setDriverLastLocation] = useState(null);
const driverWatchRef = useRef(null);
const [liveDriverLocations, setLiveDriverLocations] = useState([]);
const driverMapRef = useRef(null);
const driverMapInstanceRef = useRef(null);
const driverMapMarkersRef = useRef({});
const driverMapHasFitRef = useRef(false);

const getAddressPartsFromPlace = (place) => {
  let street = '';
  let city = '';
  let state = '';
  let zip = '';

  (place?.address_components || []).forEach((component) => {
    const types = component.types || [];

    if (types.includes('street_number')) {
      street = `${component.long_name} ${street}`;
    }

    if (types.includes('route')) {
      street += component.long_name;
    }

    if (types.includes('locality')) {
      city = component.long_name;
    }

    if (types.includes('administrative_area_level_1')) {
      state = component.short_name;
    }

    if (types.includes('postal_code')) {
      zip = component.long_name;
    }
  });

  return { street: street.trim(), city, state, zip };
};

const savedUser = parseAuthJson('currentUser');
const savedCompany = parseAuthJson('company');
const defaultDispatchLoadColumnOrder = [
  'loadDate',
  'customer',
  'containerNumber',
  'bookingNumber',
  'containerSize',
  'shipLine',
  'pickup',
  'delivery',
  'appointmentTime',
  'driver',
  'eta',
  'status',
  'referenceNumber',
  'poNumber',
  'pickupNumber',
  'paperwork',
];
const getSavedDispatchColumnKey = (companySource, userSource) =>
  `portflow-all-loads-columns-${companySource?.id || userSource?.companyId || userSource?.id || 'default'}`;
const getSavedDeductionReasonsKey = (companySource, userSource) =>
  `portflow-settlement-deduction-reasons-${companySource?.id || userSource?.companyId || userSource?.id || 'default'}`;
const getSavedDeductionDetailsKey = (companySource, userSource) =>
  `portflow-settlement-deduction-details-${companySource?.id || userSource?.companyId || userSource?.id || 'default'}`;
const getSavedSettlementCustomDeductionsKey = (companySource, userSource) =>
  `portflow-settlement-custom-deductions-${companySource?.id || userSource?.companyId || userSource?.id || 'default'}`;
const getSavedSettlementManualLoadsKey = (companySource, userSource) =>
  `portflow-settlement-manual-loads-${companySource?.id || userSource?.companyId || userSource?.id || 'default'}`;
const getValidDispatchColumnOrder = (order = []) => {
  const allowed = new Set(defaultDispatchLoadColumnOrder);
  const cleanOrder = Array.isArray(order)
    ? order.filter((key, index) => allowed.has(key) && order.indexOf(key) === index)
    : [];
  return [
    ...cleanOrder,
    ...defaultDispatchLoadColumnOrder.filter((key) => !cleanOrder.includes(key)),
  ];
};
const portHoustonCredentialGroups = [
  {
    terminal: 'BAYPORT TERMINAL',
    rows: [
      { key: 'bayportContainerTracking', label: 'Container Tracking' },
      { key: 'bayportAppointmentScheduling', label: 'Appointment Scheduling' },
    ],
  },
  {
    terminal: 'BARBOURS CUT TERMINALS',
    rows: [
      { key: 'barboursCutContainerTracking', label: 'Container Tracking' },
      { key: 'barboursCutAppointmentScheduling', label: 'Appointment Scheduling' },
    ],
  },
  {
    terminal: 'BNSF HOUSTON',
    rows: [{ key: 'bnsfHouston', label: 'Rail Login' }],
  },
  {
    terminal: 'UP HOUSTON',
    rows: [{ key: 'upHouston', label: 'Rail Login' }],
  },
];
const buildPortHoustonCredentialForm = (source = {}) => {
  const credentials = source.portHoustonCredentials || {};
  return portHoustonCredentialGroups.reduce((form, group) => {
    group.rows.forEach((row) => {
      form[row.key] = {
        username: credentials[row.key]?.username || '',
        password: '',
      };
    });
    return form;
  }, {});
};

const [activeView, setActiveView] = useState(
  isDriverApp || savedUser?.role === 'driver' ? 'driver' : getDefaultViewForRole(savedUser?.role)
);

const [loadsData, setLoadsData] = useState([]);
const availableLoads = loadsData.filter(
  (load) => getAvailabilityStatusKey(load) === 'available' && !['delivered', 'completed'].includes(getLoadQuickStatusKey(load))
);

const notAvailableLoads = loadsData.filter(
  (load) => getAvailabilityStatusKey(load) === 'not available' && !['delivered', 'completed'].includes(getLoadQuickStatusKey(load))
);

const [selectedPresetName, setSelectedPresetName] = useState('');
const [selectedLoad, setSelectedLoad] = useState(null);
const buildDropDetailsDraft = (load = {}) => ({
  dropType: load.dropType || '',
  dropLocation: load.dropLocation || '',
  droppedBy: normalizeDriverForStorage(load.droppedBy) || normalizeDriverForStorage(load.driver) || '',
  dropDateTime: normalizeDateTimeInputValue(load.dropDateTime || ''),
  nextDriver: normalizeDriverForStorage(load.driver) || '',
  nextMoveType: load.nextMoveType || 'Delivery',
});
const [dropDetailsDraft, setDropDetailsDraft] = useState(buildDropDetailsDraft());
const [dispatchColumnOrder, setDispatchColumnOrder] = useState(() => {
  try {
    return getValidDispatchColumnOrder(
      JSON.parse(localStorage.getItem(getSavedDispatchColumnKey(savedCompany, savedUser)) || '[]')
    );
  } catch {
    return defaultDispatchLoadColumnOrder;
  }
});
const [draggedDispatchColumn, setDraggedDispatchColumn] = useState('');
const [userRole, setUserRole] = useState(isDriverApp ? 'driver' : 'dispatcher');
const [driversList, setDriversList] = useState([]);
const [customers, setCustomers] = useState([]);
const [customerForm, setCustomerForm] = useState(emptyCustomer);
const [showCustomerEditor, setShowCustomerEditor] = useState(false);
const [editingCustomerId, setEditingCustomerId] = useState(null);
const fileInputRef = useRef(null);
const [previewDocument, setPreviewDocument] = useState(null);
const [previewUrl, setPreviewUrl] = useState('');

const [showForm, setShowForm] = useState(false);
const [isEditing, setIsEditing] = useState(false);
const [showLocationEditor, setShowLocationEditor] = useState(false);

const sigCanvas = useRef(null);
const [signatures, setSignatures] = useState({});
const [newLoad, setNewLoad] = useState(emptyLoad);
const [editingLoad, setEditingLoad] = useState(emptyLoad);

const [loginEmail, setLoginEmail] = useState('');
const [loginPassword, setLoginPassword] = useState('');
const [loginError, setLoginError] = useState('');
const [authMode, setAuthMode] = useState('login');
const [ownerResetCode, setOwnerResetCode] = useState('');
const [ownerNewPassword, setOwnerNewPassword] = useState('');
const [showPublicLanding, setShowPublicLanding] = useState(!isDriverApp && !savedUser && !loginPathRequested);
const [demoAccessCode, setDemoAccessCode] = useState('');
const [demoAccessError, setDemoAccessError] = useState('');
const [registerName, setRegisterName] = useState('');
const [authToken, setAuthToken] = useState(getAuthStorageItem('authToken') || '');
const [currentUser, setCurrentUser] = useState(savedUser || null);
const [company, setCompany] = useState(savedCompany || null);
const canManageTenants = isPortFlowOwnerUser(currentUser);
const isDemoMode = authToken === DEMO_TOKEN || currentUser?.id === 'demo-dispatcher';
const [tenantCompanies, setTenantCompanies] = useState([]);
const [demoRequests, setDemoRequests] = useState([]);
const [tenantStatusMessage, setTenantStatusMessage] = useState('');
const [tenantLoading, setTenantLoading] = useState(false);
const [demoRequestForm, setDemoRequestForm] = useState({
  companyName: '',
  contactName: '',
  email: '',
  phone: '',
  message: '',
});
const [demoRequestStatus, setDemoRequestStatus] = useState('');
const [companyLogoUploading, setCompanyLogoUploading] = useState(false);
const [companyLogoVersion, setCompanyLogoVersion] = useState(Date.now());
const [companyProfileEditing, setCompanyProfileEditing] = useState(false);
const [companyProfileStatus, setCompanyProfileStatus] = useState('');
const [companyProfileForm, setCompanyProfileForm] = useState({
  name: savedCompany?.name || '',
  invoiceAddress: savedCompany?.invoiceAddress || '',
});
const [invoiceBrandingForm, setInvoiceBrandingForm] = useState({
  invoiceName: savedCompany?.invoiceName || savedCompany?.name || '',
  invoiceAddress: savedCompany?.invoiceAddress || '',
  settlementCompanyName: savedCompany?.settlementCompanyName || savedCompany?.invoiceName || savedCompany?.name || '',
});
const [invoiceBrandingStatus, setInvoiceBrandingStatus] = useState('');
const defaultPodSettings = {
  showCompanyInfo: false,
  showCustomerInfo: true,
  showPickup: true,
  showDelivery: true,
  showReturn: true,
  showDriverTruck: true,
  showSignatures: true,
};
const [podSettingsForm, setPodSettingsForm] = useState({
  ...defaultPodSettings,
  ...(savedCompany?.podSettings || {}),
});
const [podSettingsStatus, setPodSettingsStatus] = useState('');
const [auditLogs, setAuditLogs] = useState([]);
const [selectedLoadAuditLogs, setSelectedLoadAuditLogs] = useState([]);
const [driverContainerByLoad, setDriverContainerByLoad] = useState({});
const [driverChassisByLoad, setDriverChassisByLoad] = useState({});
const driverEquipmentDraftsRef = useRef({});
const [portHoustonChecksByLoad, setPortHoustonChecksByLoad] = useState({});
const [portHoustonCheckingLoadId, setPortHoustonCheckingLoadId] = useState('');
const [smartPortLookupLoading, setSmartPortLookupLoading] = useState(false);
const [smartPortLookupStatus, setSmartPortLookupStatus] = useState('');
const [mileageEstimating, setMileageEstimating] = useState('');
const [mileageEstimateStatus, setMileageEstimateStatus] = useState('');
const [portHoustonSettingsForm, setPortHoustonSettingsForm] = useState(
  buildPortHoustonCredentialForm(savedCompany || {})
);
const [portHoustonSettingsStatus, setPortHoustonSettingsStatus] = useState('');
const [appNotifications, setAppNotifications] = useState([]);
const previousLoadsRef = useRef(null);
const driverAssignmentSeenRef = useRef(new Set());
const [portHoustonSettingsSaving, setPortHoustonSettingsSaving] = useState('');
const dispatchColumnStorageKey = getSavedDispatchColumnKey(company, currentUser);
const deductionReasonsStorageKey = getSavedDeductionReasonsKey(company, currentUser);
const deductionDetailsStorageKey = getSavedDeductionDetailsKey(company, currentUser);
const customDeductionsStorageKey = getSavedSettlementCustomDeductionsKey(company, currentUser);
const settlementManualLoadsStorageKey = getSavedSettlementManualLoadsKey(company, currentUser);
const [savedDeductionReasons, setSavedDeductionReasons] = useState(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(getSavedDeductionReasonsKey(savedCompany, savedUser)) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
});
const [settlementDeductionDetails, setSettlementDeductionDetails] = useState(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(getSavedDeductionDetailsKey(savedCompany, savedUser)) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
});
const [settlementCustomDeductions, setSettlementCustomDeductions] = useState(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(getSavedSettlementCustomDeductionsKey(savedCompany, savedUser)) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
});
const [settlementManualLoadIds, setSettlementManualLoadIds] = useState(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(getSavedSettlementManualLoadsKey(savedCompany, savedUser)) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
});
const [settlementCustomDeductionDraft, setSettlementCustomDeductionDraft] = useState({
  name: '',
  description: '',
  type: 'fixed',
  amount: '',
});

useEffect(() => {
  if (!currentUser || !roleCanAccessView(currentUser.role, 'dispatch')) return;
  if (isDemoMode) return;

  try {
    setDispatchColumnOrder(
      getValidDispatchColumnOrder(
        JSON.parse(localStorage.getItem(dispatchColumnStorageKey) || '[]')
      )
    );
  } catch {
    setDispatchColumnOrder(defaultDispatchLoadColumnOrder);
  }
}, [dispatchColumnStorageKey, currentUser, isDemoMode]);

useEffect(() => {
  if (!currentUser || !roleCanAccessView(currentUser.role, 'dispatch')) return;

  try {
    localStorage.setItem(
      dispatchColumnStorageKey,
      JSON.stringify(getValidDispatchColumnOrder(dispatchColumnOrder))
    );
  } catch (error) {
    console.error('Failed to save All Loads column order:', error);
  }
}, [currentUser, dispatchColumnStorageKey, dispatchColumnOrder]);

useEffect(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(deductionReasonsStorageKey) || '[]');
    setSavedDeductionReasons(Array.isArray(stored) ? stored : []);
  } catch {
    setSavedDeductionReasons([]);
  }
}, [deductionReasonsStorageKey]);

useEffect(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(deductionDetailsStorageKey) || '{}');
    setSettlementDeductionDetails(stored && typeof stored === 'object' ? stored : {});
  } catch {
    setSettlementDeductionDetails({});
  }
}, [deductionDetailsStorageKey]);

useEffect(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(customDeductionsStorageKey) || '{}');
    setSettlementCustomDeductions(stored && typeof stored === 'object' ? stored : {});
  } catch {
    setSettlementCustomDeductions({});
  }
}, [customDeductionsStorageKey]);

useEffect(() => {
  try {
    localStorage.setItem(deductionReasonsStorageKey, JSON.stringify(savedDeductionReasons));
  } catch (error) {
    console.error('Failed to save deduction reasons:', error);
  }
}, [deductionReasonsStorageKey, savedDeductionReasons]);

useEffect(() => {
  try {
    localStorage.setItem(deductionDetailsStorageKey, JSON.stringify(settlementDeductionDetails));
  } catch (error) {
    console.error('Failed to save deduction details:', error);
  }
}, [deductionDetailsStorageKey, settlementDeductionDetails]);

useEffect(() => {
  try {
    localStorage.setItem(customDeductionsStorageKey, JSON.stringify(settlementCustomDeductions));
  } catch (error) {
    console.error('Failed to save custom settlement deductions:', error);
  }
}, [customDeductionsStorageKey, settlementCustomDeductions]);

useEffect(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(settlementManualLoadsStorageKey) || '{}');
    setSettlementManualLoadIds(stored && typeof stored === 'object' ? stored : {});
  } catch {
    setSettlementManualLoadIds({});
  }
}, [settlementManualLoadsStorageKey]);

useEffect(() => {
  try {
    localStorage.setItem(settlementManualLoadsStorageKey, JSON.stringify(settlementManualLoadIds));
  } catch (error) {
    console.error('Failed to save manual settlement loads:', error);
  }
}, [settlementManualLoadsStorageKey, settlementManualLoadIds]);

const getCompanyLogoSrc = () => {
  if (!company?.logoUrl) return '';
  const url = company.logoUrl.startsWith('http')
    ? company.logoUrl
    : `${API_BASE}${company.logoUrl}`;
  return `${url}${url.includes('?') ? '&' : '?'}v=${companyLogoVersion}`;
};

useEffect(() => {
  setPortHoustonSettingsForm(buildPortHoustonCredentialForm(company || {}));
}, [company?.portHoustonCredentials]);

useEffect(() => {
  setCompanyProfileForm({
    name: company?.name || '',
    invoiceAddress: company?.invoiceAddress || '',
  });
  setInvoiceBrandingForm({
    invoiceName: company?.invoiceName || company?.name || '',
    invoiceAddress: company?.invoiceAddress || '',
    settlementCompanyName: company?.settlementCompanyName || company?.invoiceName || company?.name || '',
  });
}, [company?.invoiceName, company?.invoiceAddress, company?.settlementCompanyName, company?.name]);

useEffect(() => {
  setPodSettingsForm({
    ...defaultPodSettings,
    ...(company?.podSettings || {}),
  });
}, [company?.podSettings]);

const handleLogin = async (e) => {
  e.preventDefault();

  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: loginEmail,
        password: loginPassword,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Server said: ${data.error || 'Login failed'}`);
    }

    if (isDriverApp && data.user?.role !== 'driver') {
      throw new Error('PortFlow Driver only allows driver accounts.');
    }

    setAuthToken(data.token);
    setCurrentUser(data.user);
    const nextView = isDriverApp || data.user?.role === 'driver'
      ? 'driver'
      : getDefaultViewForRole(data.user?.role);
    setActiveView(nextView);

    saveAuthSession(data.token, data.user, data.company);

    if (data.company) {
      setCompany(data.company);
    }

    setLoginError('');
    window.setTimeout(() => {
      window.location.reload();
    }, 80);
  } catch (error) {
    console.error('Login failed:', error);
    setLoginError(error.message);
  }
};

const handleRegister = async (e) => {
  e.preventDefault();

  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: registerName,
        email: loginEmail,
        password: loginPassword,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Server said: ${data.error || 'Registration failed'}`);
    }

    if (data.pendingApproval) {
      setLoginError(data.message || 'Account request received. PortFlow will approve access before login is enabled.');
      setAuthMode('login');
      setRegisterName('');
      setLoginPassword('');
      return;
    }

    setAuthToken(data.token);
    setCurrentUser(data.user);
    setCompany(data.company || null);
    setActiveView(isDriverApp ? 'driver' : getDefaultViewForRole(data.user?.role));

    saveAuthSession(data.token, data.user, data.company);

    setLoginError('');
  } catch (error) {
    console.error('Registration failed:', error);
    setLoginError(error.message);
  }
};

const handleOwnerPasswordReset = async (e) => {
  e.preventDefault();

  try {
    const res = await fetch(`${API_BASE}/api/owner/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: loginEmail,
        resetCode: ownerResetCode,
        newPassword: ownerNewPassword,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Password reset failed');
    }

    setLoginPassword('');
    setOwnerResetCode('');
    setOwnerNewPassword('');
    setAuthMode('login');
    setLoginError(data.message || 'Password reset. You can log in now.');
  } catch (error) {
    console.error('Owner password reset failed:', error);
    setLoginError(error.message);
  }
};

const applyDemoData = () => {
  const demo = getDemoData();
  setAuthToken(DEMO_TOKEN);
  setCurrentUser(demo.user);
  setCompany(demo.company);
  setLoadsData(demo.loads);
  setDriversList(demo.drivers);
  setCustomers(demo.customers);
  setLocations(demo.locations);
  setSavedInvoices(demo.invoices);
  setAllUsers(demo.users);
  setLiveDriverLocations(demo.liveLocations);
  setSelectedLoad(null);
  setActiveView('dispatch');
  setDashboardFilter('all');
  setShowPublicLanding(false);
  setLoginError('');

  saveAuthSession(DEMO_TOKEN, demo.user, demo.company);
};

const handleStartDemo = () => {
  if (String(demoAccessCode || '').trim() !== DEMO_ACCESS_CODE) {
    setDemoAccessError('Enter the demo access code provided by PortFlow.');
    return;
  }
  setDemoAccessError('');
  applyDemoData();
};

const handleSubmitDemoRequest = async (e) => {
  e.preventDefault();
  setDemoRequestStatus('Sending demo request...');

  try {
    const res = await fetch(`${API_BASE}/api/demo-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(demoRequestForm),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to send demo request');
    }

    setDemoRequestForm({ companyName: '', contactName: '', email: '', phone: '', message: '' });
    setDemoRequestStatus('Demo request received. PortFlow will follow up soon.');
  } catch (error) {
    console.error('Demo request failed:', error);
    setDemoRequestStatus(`Could not send demo request: ${error.message}`);
  }
};

const fetchTenantManagement = async () => {
  if (!authToken || !canManageTenants) return;

  setTenantLoading(true);
  try {
    const [companiesRes, requestsRes] = await Promise.all([
      fetch(`${API_BASE}/api/tenant-management/companies`, {
        headers: { Authorization: `Bearer ${authToken}` },
      }),
      fetch(`${API_BASE}/api/tenant-management/demo-requests`, {
        headers: { Authorization: `Bearer ${authToken}` },
      }),
    ]);

    const companiesData = await companiesRes.json();
    const requestsData = await requestsRes.json();

    if (!companiesRes.ok) throw new Error(companiesData.error || 'Failed to load tenants');
    if (!requestsRes.ok) throw new Error(requestsData.error || 'Failed to load demo requests');

    setTenantCompanies(Array.isArray(companiesData) ? companiesData : []);
    setDemoRequests(Array.isArray(requestsData) ? requestsData : []);
    setTenantStatusMessage('');
  } catch (error) {
    console.error('Tenant Management load failed:', error);
    setTenantStatusMessage(`Tenant Management error: ${error.message}`);
  } finally {
    setTenantLoading(false);
  }
};

const handleTenantFieldChange = (tenantId, field, value) => {
  setTenantCompanies((prev) =>
    prev.map((tenant) => (tenant.id === tenantId ? { ...tenant, [field]: value } : tenant))
  );
};

const handleSaveTenant = async (tenant) => {
  if (!tenant?.id) return;

  setTenantStatusMessage('Saving tenant...');
  try {
    const res = await fetch(`${API_BASE}/api/tenant-management/companies/${tenant.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        serviceStatus: tenant.serviceStatus,
        subscriptionPlan: tenant.subscriptionPlan,
        subscriptionNotes: tenant.subscriptionNotes,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save tenant');
    }

    setTenantStatusMessage(`${tenant.name} updated.`);
    await fetchTenantManagement();
  } catch (error) {
    console.error('Tenant update failed:', error);
    setTenantStatusMessage(`Could not update tenant: ${error.message}`);
  }
};

const handleUpdateDemoRequestStatus = async (requestId, status) => {
  setTenantStatusMessage('Updating demo request...');
  try {
    const res = await fetch(`${API_BASE}/api/tenant-management/demo-requests/${requestId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update demo request');
    }

    setTenantStatusMessage('Demo request updated.');
    await fetchTenantManagement();
  } catch (error) {
    console.error('Demo request update failed:', error);
    setTenantStatusMessage(`Could not update demo request: ${error.message}`);
  }
};
const handleDriverDocumentUpload = async (loadId) => {
  try {
    const selectedUpload = uploadFileByLoad[loadId] || uploadFileRef.current[loadId];
    const files = Array.isArray(selectedUpload)
      ? selectedUpload.filter(Boolean)
      : selectedUpload
        ? [selectedUpload]
        : [];
    const category = uploadDocType[loadId] || 'POD';

    if (!files.length) {
      alert('Please choose a file first.');
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    formData.append('category', category);
    formData.append('loadNumber', loadId);

    const res = await fetch(`${API_BASE}/api/loads/${loadId}/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to upload document');
    }

    alert(`${category} uploaded successfully`);

    setUploadFileByLoad((prev) => ({
      ...prev,
      [loadId]: null,
    }));
    delete uploadFileRef.current[loadId];
    setDriverUploadStatusByLoad((prev) => ({
      ...prev,
      [loadId]: '',
    }));

    await fetchLoads();
  } catch (error) {
    console.error('Upload error:', error);
    alert(`Failed to upload document: ${error.message}`);
  }
};

const getUploadSelectionLabel = (selectedUpload) => {
  if (Array.isArray(selectedUpload)) {
    if (!selectedUpload.length) return 'No document selected';
    if (selectedUpload.length === 1) return selectedUpload[0]?.name || '1 document selected';
    return `${selectedUpload.length} scanned pages selected`;
  }

  return selectedUpload?.name || 'No document selected';
};

const handleDriverUploadFileChange = (loadId, fileOrFiles, source = 'camera') => {
  const files = Array.isArray(fileOrFiles)
    ? fileOrFiles.filter(Boolean)
    : fileOrFiles
      ? [fileOrFiles]
      : [];

  if (!files.length) {
    setDriverUploadStatusByLoad((prev) => ({
      ...prev,
      [loadId]: `No file received from ${source}. Please try again.`,
    }));
    return;
  }

  const uploadValue = files.length === 1 ? files[0] : files;
  uploadFileRef.current[loadId] = uploadValue;
  setUploadFileByLoad((prev) => ({
    ...prev,
    [loadId]: uploadValue,
  }));
  setDriverUploadStatusByLoad((prev) => ({
    ...prev,
    [loadId]:
      files.length === 1
        ? `Ready: ${files[0].name || 'camera photo'} (${files[0].type || 'photo'}, ${files[0].size || 0} bytes)`
        : `Ready: ${files.length} scanned pages from ${source}`,
  }));
};

const getFuelPricePerGallon = (amount = fuelForm.amountPaid, gallons = fuelForm.gallons) => {
  const amountValue = Number(String(amount || '').replace(/[$,\s]/g, ''));
  const gallonsValue = Number(String(gallons || '').replace(/[,\s]/g, ''));
  if (!Number.isFinite(amountValue) || !Number.isFinite(gallonsValue) || gallonsValue <= 0) return 0;
  return amountValue / gallonsValue;
};

const getDriverDefaultTruck = () =>
  getDriverRecord(currentUser?.driverId)?.truck || currentUser?.truck || '';

const fetchFuelSummary = async (filters = fuelFilters) => {
  if (!authToken || currentUser?.role === 'driver') return;

  try {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    const res = await fetch(`${API_BASE}/api/fuel/summary?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      cache: 'no-store',
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && handleAuthError('Unauthorized')) return;
      throw new Error(data.error || 'Failed to load fuel summary');
    }

    setFuelSummary({
      totalFuelSpend: Number(data.totalFuelSpend || 0),
      totalGallons: Number(data.totalGallons || 0),
      averagePricePerGallon: Number(data.averagePricePerGallon || 0),
      count: Number(data.count || 0),
      weeklyTotals: Array.isArray(data.weeklyTotals) ? data.weeklyTotals : [],
    });
    setFuelTransactions(Array.isArray(data.transactions) ? data.transactions : []);
  } catch (error) {
    console.error('Fuel summary error:', error);
  }
};

const fetchDriverFuelHistory = async () => {
  if (!authToken || currentUser?.role !== 'driver' || !currentUser?.driverId) return;

  try {
    const res = await fetch(`${API_BASE}/api/fuel/driver/${encodeURIComponent(currentUser.driverId)}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      cache: 'no-store',
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && handleAuthError('Unauthorized')) return;
      throw new Error(data.error || 'Failed to load fuel history');
    }

    setFuelTransactions(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('Driver fuel history error:', error);
  }
};

const startFuelReceiptScan = async () => {
  setFuelStatus('');

  if (!Capacitor.isNativePlatform?.()) {
    setFuelStatus('Use Choose Receipt on this browser. Native scan is available in the Android app.');
    return;
  }

  try {
    const result = await DocumentScanner.scanDocument({
      responseType: ResponseType.Base64,
      scannerMode: ScannerMode.Full,
      letUserAdjustCrop: true,
      reviewCapturedDocument: false,
      maxNumDocuments: 1,
      croppedImageQuality: 95,
      brightness: 4,
      contrast: 1.12,
    });

    if (result?.status === ScanDocumentResponseStatus.Cancel) {
      setFuelStatus('Receipt scan cancelled.');
      return;
    }

    const dataUrl = getNativeScannerDataUrl(result?.scannedImages?.[0] || '');
    if (!dataUrl) {
      setFuelStatus('No receipt image was returned. Please try again.');
      return;
    }

    const blob = await blobFromDataUrl(dataUrl);
    const file = new File([blob], `fuel-receipt-${currentUser?.driverId || 'driver'}-${Date.now()}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });

    setFuelReceiptFile(file);
    setFuelStatus(`Receipt ready: ${file.name}`);
  } catch (error) {
    console.error('Fuel receipt scanner failed:', error);
    setFuelStatus(`Receipt scanner failed: ${error.message}`);
  }
};

const handleFuelSubmit = async (event) => {
  event.preventDefault();
  if (!authToken || !currentUser?.driverId) return;

  const amountPaid = Number(String(fuelForm.amountPaid || '').replace(/[$,\s]/g, ''));
  const gallons = Number(String(fuelForm.gallons || '').replace(/[,\s]/g, ''));

  if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
    setFuelStatus('Total amount must be greater than zero.');
    return;
  }

  if (!Number.isFinite(gallons) || gallons <= 0) {
    setFuelStatus('Gallons must be greater than zero.');
    return;
  }

  setFuelSubmitting(true);
  setFuelStatus('Saving fuel transaction...');

  try {
    const formData = new FormData();
    formData.append('driverId', currentUser.driverId);
    formData.append('truckId', fuelForm.truckId || getDriverDefaultTruck());
    formData.append('dateTime', fuelForm.dateTime || new Date().toISOString());
    formData.append('amountPaid', String(amountPaid));
    formData.append('gallons', String(gallons));
    formData.append('fuelStation', fuelForm.fuelStation);
    formData.append('loadNumber', fuelForm.loadNumber);
    if (fuelReceiptFile) {
      formData.append('receipt', fuelReceiptFile);
    }

    const res = await fetch(`${API_BASE}/api/fuel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && handleAuthError('Unauthorized')) return;
      throw new Error(data.error || 'Failed to save fuel transaction');
    }

    setFuelStatus('Fuel saved successfully.');
    setFuelForm({
      amountPaid: '',
      gallons: '',
      truckId: getDriverDefaultTruck(),
      fuelStation: '',
      loadNumber: '',
      dateTime: '',
    });
    setFuelReceiptFile(null);
    await fetchDriverFuelHistory();
  } catch (error) {
    console.error('Fuel submit error:', error);
    setFuelStatus(`Failed to save fuel: ${error.message}`);
  } finally {
    setFuelSubmitting(false);
  }
};

const handleOpenFuelReceipt = async (fuel) => {
  if (!fuel?.receiptImageUrl) return;

  try {
    const res = await fetch(`${API_BASE}${fuel.receiptImageUrl}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to open receipt');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(url);
    setPreviewDocument({
      name: fuel.receiptOriginalName || `Fuel receipt ${fuel.id}`,
      type: fuel.receiptMimeType || blob.type,
    });
  } catch (error) {
    console.error('Open fuel receipt error:', error);
    alert(`Failed to open receipt: ${error.message}`);
  }
};

const exportFuelCsv = () => {
  const rows = [
    ['Weekly Fuel Comparison'],
    ['Type', 'Week Start', 'Week End', 'Day', 'Date', 'Transactions', 'Total Spend', 'Total Gallons', 'Average Price Per Gallon'],
    ...(fuelSummary.weeklyTotals || []).flatMap((week) => [
      [
        'Week',
        week.weekStart || '',
        week.weekEnd || '',
        '',
        '',
        week.count || 0,
        Number(week.totalFuelSpend || 0).toFixed(2),
        Number(week.totalGallons || 0).toFixed(3),
        Number(week.averagePricePerGallon || 0).toFixed(2),
      ],
      ...(week.dailyTotals || []).map((day) => [
        'Day',
        week.weekStart || '',
        week.weekEnd || '',
        day.dayName || '',
        day.date || '',
        day.count || 0,
        Number(day.totalFuelSpend || 0).toFixed(2),
        Number(day.totalGallons || 0).toFixed(3),
        Number(day.averagePricePerGallon || 0).toFixed(2),
      ]),
    ]),
    [],
    ['Fuel Transactions'],
    ['Date/Time', 'Driver', 'Driver ID', 'Truck', 'Station', 'Load Number', 'Amount Paid', 'Gallons', 'Price Per Gallon'],
    ...fuelTransactions.map((fuel) => [
      fuel.dateTime || '',
      fuel.driverName || '',
      fuel.driverId || '',
      fuel.truckId || '',
      fuel.fuelStation || '',
      fuel.loadNumber || '',
      Number(fuel.amountPaid || 0).toFixed(2),
      Number(fuel.gallons || 0).toFixed(3),
      Number(fuel.pricePerGallon || 0).toFixed(2),
    ]),
  ];
  const csv = rows
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `portflow-fuel-${fuelFilters.from || 'all'}-${fuelFilters.to || 'today'}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const stopDriverCameraStream = () => {
  if (driverCameraStreamRef.current) {
    driverCameraStreamRef.current.getTracks().forEach((track) => track.stop());
  }
  driverCameraStreamRef.current = null;
};

const closeDriverCamera = () => {
  stopDriverCameraStream();
  setDriverCameraLoadId('');
  setDriverCameraError('');
  setDriverScannerPreview(null);
  setDriverScannerMode('web');
  setDriverScannerUploading(false);
};

const getNativeScannerDataUrl = (image) => {
  if (!image) return '';
  if (image.startsWith('data:')) return image;
  return `data:image/jpeg;base64,${image}`;
};

const blobFromDataUrl = async (dataUrl) => {
  const response = await fetch(dataUrl);
  return response.blob();
};

const startNativeDocumentScan = async (loadId) => {
  setDriverCameraLoadId(loadId);
  setDriverScannerMode('native');
  setDriverCameraError('');
  setDriverScannerPreview(null);
  setDriverScannerUploading(false);

  try {
    const result = await DocumentScanner.scanDocument({
      responseType: ResponseType.Base64,
      scannerMode: ScannerMode.Full,
      letUserAdjustCrop: true,
      reviewCapturedDocument: false,
      maxNumDocuments: 8,
      croppedImageQuality: 95,
      brightness: 6,
      contrast: 1.18,
    });

    if (result?.status === ScanDocumentResponseStatus.Cancel) {
      closeDriverCamera();
      setDriverUploadStatusByLoad((prev) => ({
        ...prev,
        [loadId]: 'Scan cancelled.',
      }));
      return;
    }

    const dataUrls = (result?.scannedImages || []).map(getNativeScannerDataUrl).filter(Boolean);
    if (!dataUrls.length) {
      setDriverCameraError('The scanner did not return a document. Please try again.');
      return;
    }

    setDriverScannerPreview({
      loadId,
      dataUrls,
      fileNames: dataUrls.map((_, index) =>
        `driver-scan-${loadId}-${Date.now()}-${index + 1}.jpg`
      ),
      source: 'native',
    });
  } catch (error) {
    console.error('Native document scanner failed:', error);
    const message = String(error?.message || error || '');
    if (/cancel/i.test(message)) {
      closeDriverCamera();
      setDriverUploadStatusByLoad((prev) => ({
        ...prev,
        [loadId]: 'Scan cancelled.',
      }));
      return;
    }

    setDriverScannerMode('web');
    setDriverCameraError(
      `Native scanner unavailable on this device, using web camera instead. ${message}`
    );
  }
};

const openDriverCamera = (loadId) => {
  if (Capacitor.isNativePlatform?.()) {
    startNativeDocumentScan(loadId);
    return;
  }

  setDriverCameraLoadId(loadId);
  setDriverScannerMode('web');
  setDriverCameraError('');
  setDriverScannerPreview(null);
  setDriverScannerUploading(false);
};

const getScannerGuideBounds = (width, height) => {
  const guideWidth = Math.min(width * 0.86, height * 0.72);
  const guideHeight = guideWidth * 1.32;
  const safeHeight = Math.min(guideHeight, height * 0.82);
  const safeWidth = safeHeight / 1.32;
  return {
    x: Math.round((width - safeWidth) / 2),
    y: Math.round((height - safeHeight) / 2),
    width: Math.round(safeWidth),
    height: Math.round(safeHeight),
  };
};

const detectDocumentBounds = (imageData, guideBounds) => {
  const { data, width, height } = imageData;
  const leftLimit = Math.max(0, guideBounds.x - Math.round(width * 0.08));
  const rightLimit = Math.min(width - 1, guideBounds.x + guideBounds.width + Math.round(width * 0.08));
  const topLimit = Math.max(0, guideBounds.y - Math.round(height * 0.08));
  const bottomLimit = Math.min(height - 1, guideBounds.y + guideBounds.height + Math.round(height * 0.08));
  let minX = rightLimit;
  let maxX = leftLimit;
  let minY = bottomLimit;
  let maxY = topLimit;
  let hits = 0;

  for (let y = topLimit; y <= bottomLimit; y += 3) {
    for (let x = leftLimit; x <= rightLimit; x += 3) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const colorSpread = Math.max(r, g, b) - Math.min(r, g, b);

      if (luminance > 142 && colorSpread < 86) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        hits += 1;
      }
    }
  }

  const detectedWidth = maxX - minX;
  const detectedHeight = maxY - minY;
  const minimumArea = (guideBounds.width * guideBounds.height) / 8;

  if (hits < 80 || detectedWidth * detectedHeight < minimumArea) {
    return guideBounds;
  }

  const pad = Math.round(Math.min(width, height) * 0.015);
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: Math.min(width - minX, detectedWidth + pad * 2),
    height: Math.min(height - minY, detectedHeight + pad * 2),
  };
};

const enhanceDocumentCanvas = (sourceCanvas, bounds) => {
  const outputWidth = 1400;
  const outputHeight = Math.round(outputWidth * 1.32);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outputContext = outputCanvas.getContext('2d');

  outputContext.fillStyle = '#ffffff';
  outputContext.fillRect(0, 0, outputWidth, outputHeight);
  outputContext.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    outputWidth,
    outputHeight
  );

  const imageData = outputContext.getImageData(0, 0, outputWidth, outputHeight);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const grayscale = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const contrasted = Math.max(0, Math.min(255, (grayscale - 118) * 1.55 + 138));
    data[i] = contrasted;
    data[i + 1] = contrasted;
    data[i + 2] = contrasted;
  }

  outputContext.putImageData(imageData, 0, 0);
  return outputCanvas;
};

const captureDriverCameraPhoto = () => {
  const loadId = driverCameraLoadId;
  const video = driverCameraVideoRef.current;
  if (!loadId || !video || !video.videoWidth || !video.videoHeight) {
    setDriverCameraError('Camera is not ready yet. Wait a second and try Capture again.');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const guideBounds = getScannerGuideBounds(canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const documentBounds = detectDocumentBounds(imageData, guideBounds);
  const processedCanvas = enhanceDocumentCanvas(canvas, documentBounds);

  const dataUrl = processedCanvas.toDataURL('image/jpeg', 0.92);
  setDriverScannerPreview({
    loadId,
    dataUrls: [dataUrl],
    fileNames: [`driver-scan-${loadId}-${Date.now()}.jpg`],
    source: 'web',
  });
  stopDriverCameraStream();
};

const useDriverScannerPreview = async () => {
  if (!driverScannerPreview?.loadId || !driverScannerPreview?.dataUrls?.length) return;

  try {
    setDriverScannerUploading(true);
    const preview = driverScannerPreview;
    const files = await Promise.all(
      preview.dataUrls.map(async (dataUrl, index) => {
        const blob = await blobFromDataUrl(dataUrl);
        return new File([blob], preview.fileNames?.[index] || `driver-scan-${preview.loadId}-${index + 1}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      })
    );

    handleDriverUploadFileChange(
      preview.loadId,
      files.length === 1 ? files[0] : files,
      preview.source === 'native' ? 'native scanner' : 'PortFlow scanner'
    );
    closeDriverCamera();
  } catch (error) {
    console.error('Scanner preview conversion failed:', error);
    setDriverCameraError('Could not save the scanned document. Please try again.');
    setDriverScannerUploading(false);
  }
};

const confirmAndUploadDriverScannerPreview = async () => {
  if (!driverScannerPreview?.loadId || !driverScannerPreview?.dataUrls?.length) return;

  try {
    setDriverScannerUploading(true);
    const preview = driverScannerPreview;
    const files = await Promise.all(
      preview.dataUrls.map(async (dataUrl, index) => {
        const blob = await blobFromDataUrl(dataUrl);
        return new File([blob], preview.fileNames?.[index] || `driver-scan-${preview.loadId}-${index + 1}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
        });
      })
    );

    handleDriverUploadFileChange(
      preview.loadId,
      files.length === 1 ? files[0] : files,
      preview.source === 'native' ? 'native scanner' : 'PortFlow scanner'
    );
    await handleDriverDocumentUpload(preview.loadId);
    closeDriverCamera();
  } catch (error) {
    console.error('Scanner upload failed:', error);
    setDriverCameraError(`Could not upload the scanned document: ${error.message}`);
    setDriverScannerUploading(false);
  }
};

const retakeDriverScannerPhoto = async () => {
  if (driverScannerMode === 'native' && driverCameraLoadId) {
    await startNativeDocumentScan(driverCameraLoadId);
    return;
  }

  setDriverScannerPreview(null);
  setDriverCameraError('');
  if (!navigator.mediaDevices?.getUserMedia) return;

  try {
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 4096 },
        height: { ideal: 3072 },
      },
      audio: false,
    });

    driverCameraStreamRef.current = stream;
    if (driverCameraVideoRef.current) {
      driverCameraVideoRef.current.srcObject = stream;
      await driverCameraVideoRef.current.play();
    }
  } catch (error) {
    console.error('Driver scanner retake failed:', error);
    setDriverCameraError(`Camera blocked or unavailable: ${error.message}`);
  }
};

useEffect(() => {
  if (!driverCameraLoadId || driverScannerMode !== 'web') return;

  let cancelled = false;

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setDriverCameraError('This phone browser does not allow in-app camera access.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
        },
        audio: false,
      });

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      driverCameraStreamRef.current = stream;
      if (driverCameraVideoRef.current) {
        driverCameraVideoRef.current.srcObject = stream;
        await driverCameraVideoRef.current.play();
      }
    } catch (error) {
      console.error('Driver camera failed:', error);
      setDriverCameraError(`Camera blocked or unavailable: ${error.message}`);
    }
  };

  startCamera();

  return () => {
    cancelled = true;
    stopDriverCameraStream();
  };
}, [driverCameraLoadId, driverScannerMode]);


const [searchTerm, setSearchTerm] = useState('');
const [statusFilter, setStatusFilter] = useState('All');
const [paperworkFilter, setPaperworkFilter] = useState('All');
const [selectedDocumentType, setSelectedDocumentType] = useState('POD');
const [selectedAccountingDocumentType, setSelectedAccountingDocumentType] = useState('POD');
const [selectedSettlementDriverId, setSelectedSettlementDriverId] = useState('');
const [settlementStartDate, setSettlementStartDate] = useState('');
const [settlementEndDate, setSettlementEndDate] = useState('');
const [settlementNote, setSettlementNote] = useState('');
const [settlementContainerSearch, setSettlementContainerSearch] = useState('');
const [settlementManualLoadSearch, setSettlementManualLoadSearch] = useState('');
const [settlementDeductionReasonInput, setSettlementDeductionReasonInput] = useState('');
const [settlementCalculatorInputs, setSettlementCalculatorInputs] = useState({
  dispatchRate: '10',
  driverSplitRate: '50',
  insurance: '350',
  fuel: '',
  prePulls: '',
  stopOffs: '',
  parking: '',
  loanRepayment: '',
  occupationalAccident: '',
  detentionHours: '',
  detentionHourlyRate: '',
});
const [accountingSearchTerm, setAccountingSearchTerm] = useState('');
const [completedLoadDateFilter, setCompletedLoadDateFilter] = useState('today');
const [completedLoadCustomDate, setCompletedLoadCustomDate] = useState(getTodayDate());
const [mileageReportYear, setMileageReportYear] = useState(() => getTodayDate().slice(0, 4));
const [fuelTransactions, setFuelTransactions] = useState([]);
const [fuelSummary, setFuelSummary] = useState({
  totalFuelSpend: 0,
  totalGallons: 0,
  averagePricePerGallon: 0,
  count: 0,
  weeklyTotals: [],
});
const [fuelFilters, setFuelFilters] = useState({
  from: getDateStringWithOffsetInAppTimeZone(-7),
  to: getDateStringInAppTimeZone(),
  driverId: '',
  truckId: '',
});
const [fuelForm, setFuelForm] = useState({
  amountPaid: '',
  gallons: '',
  truckId: '',
  fuelStation: '',
  loadNumber: '',
  dateTime: '',
});
const [fuelReceiptFile, setFuelReceiptFile] = useState(null);
const [fuelStatus, setFuelStatus] = useState('');
const [fuelSubmitting, setFuelSubmitting] = useState(false);
const [selectedAccountingLoadId, setSelectedAccountingLoadId] = useState('');
const [selectedSettlementLoadId, setSelectedSettlementLoadId] = useState('');
const [settlementReviewLoadId, setSettlementReviewLoadId] = useState('');
const [settlementPayDrafts, setSettlementPayDrafts] = useState({});
const [settlementPayStatus, setSettlementPayStatus] = useState('');
const [backendSettlements, setBackendSettlements] = useState([]);
const [activeBackendSettlement, setActiveBackendSettlement] = useState(null);
const [settlementBackendLoading, setSettlementBackendLoading] = useState(false);
const [settlementBackendStatus, setSettlementBackendStatus] = useState('');
const [backendDeductionDraft, setBackendDeductionDraft] = useState({
  kind: 'deduction',
  calculationType: 'flat',
  description: '',
  amount: '',
});
const [backendNetDeductionDraft, setBackendNetDeductionDraft] = useState({
  description: '',
  amount: '',
});
const [editingBackendDeductionId, setEditingBackendDeductionId] = useState('');
const [editingBackendNetDeductionId, setEditingBackendNetDeductionId] = useState('');
const [invoiceLoadId, setInvoiceLoadId] = useState('');
const [savedInvoices, setSavedInvoices] = useState([]);
const [invoiceStatusMessage, setInvoiceStatusMessage] = useState('');
const [invoicePaymentDrafts, setInvoicePaymentDrafts] = useState({});
const [accountingBillAmountDrafts, setAccountingBillAmountDrafts] = useState({});
const [accountingExtraChargeDrafts, setAccountingExtraChargeDrafts] = useState({});
const [accountingExtraChargesOpenLoadId, setAccountingExtraChargesOpenLoadId] = useState('');
const [accountingExtraChargeStatus, setAccountingExtraChargeStatus] = useState('');
const [activeLocationPicker, setActiveLocationPicker] = useState('');

useEffect(() => {
  if (!isDemoMode) return;

  const demo = getDemoData();
  setCurrentUser((prev) => prev || demo.user);
  setCompany((prev) => prev || demo.company);
  setLoadsData(demo.loads);
  setDriversList(demo.drivers);
  setCustomers(demo.customers);
  setLocations(demo.locations);
  setSavedInvoices(demo.invoices);
  setAllUsers(demo.users);
  setLiveDriverLocations(demo.liveLocations);
}, [isDemoMode]);

const [showNewPickupForm, setShowNewPickupForm] = useState(false);
const [showNewPickup, setShowNewPickup] = useState(false);
const [newPickupLocation, setNewPickupLocation] = useState({
  name: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  type: 'pickup',
  customerId: '',
  notes: '',
});

const [showNewDeliveryForm, setShowNewDeliveryForm] = useState(false);
const [newDeliveryLocation, setNewDeliveryLocation] = useState({
  name: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  type: 'delivery',
  customerId: '',
  notes: '',
});

const [showNewReturnForm, setShowNewReturnForm] = useState(false);
const [newReturnLocation, setNewReturnLocation] = useState({
  name: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  type: 'return',
  customerId: '',
  notes: '',
});
useEffect(() => {
  if (!currentUser) return;

  if (isDriverApp && currentUser.role !== 'driver') {
    clearAuthSession();
    setAuthToken('');
    setCurrentUser(null);
    setCompany(null);
    setLoginError('Please log in with a driver account.');
    return;
  }

  if (isDriverApp || currentUser.role === 'driver') {
    setActiveView('driver');
  } else {
    setActiveView('dispatch');
  }
}, [currentUser, isDriverApp]);

useEffect(() => {
  if (!GOOGLE_MAPS_API_KEY) return;
  if (window.google?.maps?.places) return;
  if (document.querySelector('script[data-portflow-google-maps="true"]')) return;

  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
    GOOGLE_MAPS_API_KEY
  )}&libraries=places`;
  script.async = true;
  script.defer = true;
  script.dataset.portflowGoogleMaps = 'true';
  document.head.appendChild(script);
}, [GOOGLE_MAPS_API_KEY]);

useEffect(() => {
  if (!showForm) return undefined;
  if (Number.parseFloat(String(newLoad.miles || '').replace(/[^0-9.-]/g, '')) > 0) return undefined;
  if (!newLoad.pickup || !newLoad.delivery) return undefined;

  const timeout = setTimeout(() => {
    estimateLoadMiles('new');
  }, 900);

  return () => clearTimeout(timeout);
}, [showForm, newLoad.pickup, newLoad.delivery, newLoad.returnLocation]);

useEffect(() => {
  if (!isEditing) return undefined;
  if (Number.parseFloat(String(editingLoad?.miles || '').replace(/[^0-9.-]/g, '')) > 0) return undefined;
  if (!editingLoad?.pickup || !editingLoad?.delivery) return undefined;

  const timeout = setTimeout(() => {
    estimateLoadMiles('edit');
  }, 900);

  return () => clearTimeout(timeout);
}, [isEditing, editingLoad?.pickup, editingLoad?.delivery, editingLoad?.returnLocation]);

useEffect(() => {
  pickupAutocompleteRef.current = null;

  const interval = setInterval(() => {
    if (
      window.google &&
      window.google.maps &&
      window.google.maps.places &&
      addressInputRef.current &&
      !autocompleteRef.current
    ) {
      const autocomplete = new window.google.maps.places.Autocomplete(
        addressInputRef.current,
        {
          types: ['address'],
          componentRestrictions: { country: 'us' },
        }
      );

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place || !place.address_components) return;

        const { street, city, state, zip } = getAddressPartsFromPlace(place);

        setCustomerForm((prev) => ({
          ...prev,
          address: street,
          city,
          state,
          zip,
        }));
      });

      autocompleteRef.current = autocomplete;
      clearInterval(interval);
    }
  }, 500);

  return () => clearInterval(interval);
}, [showForm]);

useEffect(() => {
  pickupAutocompleteRef.current = null;

  const interval = setInterval(() => {
    if (
      window.google &&
      window.google.maps &&
      window.google.maps.places &&
      pickupInputRef.current &&
      !pickupAutocompleteRef.current
    ) {
      const autocomplete = new window.google.maps.places.Autocomplete(
        pickupInputRef.current,
        {
          types: ['address'],
          componentRestrictions: { country: 'us' },
        }
      );

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place || !place.formatted_address) return;

        setNewLoad((prev) => ({
          ...prev,
          pickup: place.formatted_address,
        }));
      });

      pickupAutocompleteRef.current = autocomplete;
      clearInterval(interval);
    }
  }, 500);

  return () => clearInterval(interval);
}, [showForm]);

useEffect(() => {
  newPickupAutocompleteRef.current = null;

  const interval = setInterval(() => {
    if (
      window.google &&
      window.google.maps &&
      window.google.maps.places &&
      newPickupAddressInputRef.current &&
      !newPickupAutocompleteRef.current
    ) {
      const autocomplete = new window.google.maps.places.Autocomplete(
        newPickupAddressInputRef.current,
        {
          types: ['address'],
          componentRestrictions: { country: 'us' },
        }
      );

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place || !place.address_components) return;

        const { street, city, state, zip } = getAddressPartsFromPlace(place);

        setNewPickupLocation((prev) => ({
          ...prev,
          address: street,
          city,
          state,
          zip,
        }));
      });

      newPickupAutocompleteRef.current = autocomplete;
      clearInterval(interval);
    }
  }, 500);

  return () => clearInterval(interval);
}, [showNewPickup]);

useEffect(() => {
  inlineCustomerAutocompleteRef.current = null;

  const interval = setInterval(() => {
    if (
      window.google &&
      window.google.maps &&
      window.google.maps.places &&
      inlineCustomerAddressInputRef.current &&
      !inlineCustomerAutocompleteRef.current
    ) {
      const autocomplete = new window.google.maps.places.Autocomplete(
        inlineCustomerAddressInputRef.current,
        {
          types: ['address'],
          componentRestrictions: { country: 'us' },
        }
      );

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place || !place.address_components) return;

        const { street, city, state, zip } = getAddressPartsFromPlace(place);

        setCustomerForm((prev) => ({
          ...prev,
          address: street,
          city,
          state,
          zip,
        }));
      });

      inlineCustomerAutocompleteRef.current = autocomplete;
      clearInterval(interval);
    }
  }, 500);

  return () => clearInterval(interval);
}, [showCustomerEditor]);
useEffect(() => {
  newDeliveryAutocompleteRef.current = null;

  const interval = setInterval(() => {
    if (
      window.google &&
      window.google.maps &&
      window.google.maps.places &&
      deliveryInputRef.current &&
      !deliveryAutocompleteRef.current
    ) {
      const autocomplete = new window.google.maps.places.Autocomplete(
        deliveryInputRef.current,
        {
          types: ['address'],
          componentRestrictions: { country: 'us' },
        }
      );

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place || !place.formatted_address) return;

        setNewLoad((prev) => ({
          ...prev,
          delivery: place.formatted_address,
        }));
      });

      deliveryAutocompleteRef.current = autocomplete;
      clearInterval(interval);
    }
  }, 500);

  return () => clearInterval(interval);
}, [showForm]);
useEffect(() => {
  returnAutocompleteRef.current = null;

  const interval = setInterval(() => {
    if (
      window.google &&
      window.google.maps &&
      window.google.maps.places &&
      returnInputRef.current &&
      !returnAutocompleteRef.current
    ) {
      const autocomplete = new window.google.maps.places.Autocomplete(
        returnInputRef.current,
        {
          types: ['address'],
          componentRestrictions: { country: 'us' },
        }
      );

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place || !place.formatted_address) return;

        setNewLoad((prev) => ({
          ...prev,
          returnLocation: place.formatted_address,
        }));
      });

      returnAutocompleteRef.current = autocomplete;
      clearInterval(interval);
    }
  }, 500);

  return () => clearInterval(interval);
}, [showForm]);

useEffect(() => {
  const interval = setInterval(() => {
    if (
      window.google &&
      window.google.maps &&
      window.google.maps.places &&
      newDeliveryAddressInputRef.current &&
      !newDeliveryAutocompleteRef.current
    ) {
      const autocomplete = new window.google.maps.places.Autocomplete(
        newDeliveryAddressInputRef.current,
        {
          types: ['address'],
          componentRestrictions: { country: 'us' },
        }
      );

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place || !place.address_components) return;

        const { street, city, state, zip } = getAddressPartsFromPlace(place);

        setNewDeliveryLocation((prev) => ({
          ...prev,
          address: street || place.formatted_address || '',
          city,
          state,
          zip,
        }));
      });

      newDeliveryAutocompleteRef.current = autocomplete;
      clearInterval(interval);
    }
  }, 500);

  return () => clearInterval(interval);
}, [showNewDeliveryForm, showForm, GOOGLE_MAPS_API_KEY]);

const fetchDrivers = async () => {
  if (!authToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/drivers`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      cache: 'no-store',
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401 && handleAuthError(data.error || 'Unauthorized')) return;
      throw new Error(data.error || 'Failed to fetch drivers');
    }

    setDriversList(data);
  } catch (error) {
    console.error('Failed to fetch drivers:', error);
  }
};
const fetchAllUsers = async () => {
  if (!authToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/all-users`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch users');
    }

    setAllUsers(data);
  } catch (error) {
    console.error('Failed to fetch users:', error);
  }
};

const fetchCompanyProfile = async () => {
  if (!authToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/company`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      cache: 'no-store',
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401 && handleAuthError(data.error || 'Unauthorized')) return;
      throw new Error(data.error || 'Failed to fetch company profile');
    }

    setCompany(data);
    saveCompanySession(data);
  } catch (error) {
    console.error('Failed to fetch company profile:', error);
  }
};

const handleCompanyLogoUpload = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    setCompanyLogoUploading(true);
    const formData = new FormData();
    formData.append('logo', file);

    const res = await fetch(`${API_BASE}/api/company/logo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to upload logo');
    }

    setCompany(data);
    setCompanyLogoVersion(Date.now());
    saveCompanySession(data);
  } catch (error) {
    console.error('Failed to upload company logo:', error);
    alert(`Failed to upload logo: ${error.message}`);
  } finally {
    setCompanyLogoUploading(false);
    e.target.value = '';
  }
};

const handleSaveCompanyProfile = async (e) => {
  e.preventDefault();

  try {
    setCompanyProfileStatus('');
    const res = await fetch(`${API_BASE}/api/company/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(companyProfileForm),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save company profile');
    }

    setCompany(data);
    saveCompanySession(data);
    setCompanyProfileEditing(false);
    setCompanyProfileStatus('Company profile saved.');
  } catch (error) {
    console.error('Failed to save company profile:', error);
    setCompanyProfileStatus(`Failed to save company profile: ${error.message}`);
  }
};

const handleSaveInvoiceBranding = async (e) => {
  e.preventDefault();

  try {
    setInvoiceBrandingStatus('');
    const res = await fetch(`${API_BASE}/api/company/invoice-branding`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(invoiceBrandingForm),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save invoice branding');
    }

    setCompany(data);
    saveCompanySession(data);
    setInvoiceBrandingStatus('Invoice branding saved.');
  } catch (error) {
    console.error('Failed to save invoice branding:', error);
    setInvoiceBrandingStatus(`Failed to save invoice branding: ${error.message}`);
  }
};

const handleSavePodSettings = async (e) => {
  e.preventDefault();

  try {
    setPodSettingsStatus('');
    const res = await fetch(`${API_BASE}/api/company/pod-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(podSettingsForm),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save POD settings');
    }

    setCompany(data);
    saveCompanySession(data);
    setPodSettingsStatus('POD settings saved.');
  } catch (error) {
    console.error('Failed to save POD settings:', error);
    setPodSettingsStatus(`Failed to save POD settings: ${error.message}`);
  }
};

const handleSavePortHoustonSettings = async (group) => {
  const groupCredentials = group.rows.reduce((credentials, row) => {
    credentials[row.key] = portHoustonSettingsForm[row.key] || { username: '', password: '' };
    return credentials;
  }, {});

  try {
    setPortHoustonSettingsSaving(group.terminal);
    setPortHoustonSettingsStatus('');

    const res = await fetch(`${API_BASE}/api/company/port-houston`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ credentials: groupCredentials }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save Port Houston settings');
    }

    setCompany(data);
    saveCompanySession(data);
    setPortHoustonSettingsForm(buildPortHoustonCredentialForm(data));
    setPortHoustonSettingsStatus(`${group.terminal} credentials saved.`);
  } catch (error) {
    console.error('Failed to save Port Houston settings:', error);
    setPortHoustonSettingsStatus(`${group.terminal}: ${error.message}`);
  } finally {
    setPortHoustonSettingsSaving('');
  }
};

const handleClearPortHoustonSettings = async (group) => {
  const groupCredentials = group.rows.reduce((credentials, row) => {
    credentials[row.key] = { clear: true };
    return credentials;
  }, {});

  try {
    setPortHoustonSettingsSaving(group.terminal);
    setPortHoustonSettingsStatus('');

    const res = await fetch(`${API_BASE}/api/company/port-houston`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ credentials: groupCredentials }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Failed to clear Port Houston settings');
    }

    setCompany(data);
    saveCompanySession(data);
    setPortHoustonSettingsForm(buildPortHoustonCredentialForm(data));
    setPortHoustonSettingsStatus(`${group.terminal} credentials cleared.`);
  } catch (error) {
    console.error('Failed to clear Port Houston settings:', error);
    setPortHoustonSettingsStatus(`${group.terminal}: ${error.message}`);
  } finally {
    setPortHoustonSettingsSaving('');
  }
};

const parseAuditJson = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const formatAuditValue = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const fetchAuditLogs = async () => {
  if (!authToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/audit-logs`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      cache: 'no-store',
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch audit logs');
    }

    setAuditLogs(data);
  } catch (error) {
    console.error('Failed to fetch audit logs:', error);
  }
};

const fetchSelectedLoadAuditLogs = async (loadId) => {
  if (!authToken || !loadId || !roleCanAccessView(currentUser?.role, 'dispatch')) return;

  try {
    const res = await fetch(`${API_BASE}/api/loads/${encodeURIComponent(loadId)}/audit-logs`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      cache: 'no-store',
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch load audit logs');
    }

    setSelectedLoadAuditLogs(data);
  } catch (error) {
    console.error('Failed to fetch load audit logs:', error);
    setSelectedLoadAuditLogs([]);
  }
};

const normalizeLoadedLoads = (loads = []) =>
  loads.map((load) => ({
    ...load,
    documents: load.documents || [],
    paperwork: getPaperworkStatusFromDocuments(load.documents || []),
  }));

const getLoadAlertLabel = (load = {}) =>
  load.containerNumber || load.referenceNumber || load.poNumber || load.bookingNumber || load.id || 'load';

const getDriverAssignmentAlertKey = () =>
  `portflow-driver-assigned-alerts-${currentUser?.driverId || currentUser?.id || 'unknown'}`;

const saveSeenDriverAssignments = () => {
  if (currentUser?.role !== 'driver') return;
  try {
    localStorage.setItem(
      getDriverAssignmentAlertKey(),
      JSON.stringify(Array.from(driverAssignmentSeenRef.current))
    );
  } catch (error) {
    console.error('Failed to save driver assignment alerts:', error);
  }
};

const pushAppNotification = (type, title, message) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setAppNotifications((prev) => [
    { id, type, title, message },
    ...prev.slice(0, 2),
  ]);

  window.setTimeout(() => {
    setAppNotifications((prev) => prev.filter((notice) => notice.id !== id));
  }, 12000);

  if (navigator.vibrate) {
    navigator.vibrate(type === 'driver' ? [150, 80, 150] : 120);
  }
};

const detectLoadNotifications = (nextLoads = []) => {
  const previousLoads = previousLoadsRef.current;

  if (!currentUser) {
    previousLoadsRef.current = nextLoads;
    return;
  }

  if (currentUser.role === 'driver') {
    const activeAssignedLoads = nextLoads.filter((load) => {
      const status = String(load.status || '').trim().toLowerCase();
      return (
        driverMatchesCurrentUser(load.driver, currentUser) &&
        !['delivered', 'completed', 'dropped'].includes(status)
      );
    });

    if (!previousLoads) {
      activeAssignedLoads.forEach((load) => driverAssignmentSeenRef.current.add(load.id));
      saveSeenDriverAssignments();
      previousLoadsRef.current = nextLoads;
      return;
    }

    activeAssignedLoads.forEach((load) => {
      if (driverAssignmentSeenRef.current.has(load.id)) return;

      driverAssignmentSeenRef.current.add(load.id);
      pushAppNotification(
        'driver',
        'New load assigned',
        `${getLoadAlertLabel(load)} is now assigned to you.`
      );
    });

    saveSeenDriverAssignments();
  }

  if (previousLoads && roleCanAccessView(currentUser.role, 'dispatch')) {
    const previousById = previousLoads.reduce((map, load) => {
      map[load.id] = load;
      return map;
    }, {});
    const finishedStatuses = new Set(['dropped', 'delivered', 'completed']);

    nextLoads.forEach((load) => {
      const previousLoad = previousById[load.id];
      if (!previousLoad || !hasAssignedDriver(load)) return;

      const previousStatus = getLoadQuickStatusKey(previousLoad);
      const nextStatus = getLoadQuickStatusKey(load);

      if (finishedStatuses.has(previousStatus) || !finishedStatuses.has(nextStatus)) return;

      const driverName = getDriverLabel(load.driver);
      const actionText = nextStatus === 'dropped' ? 'dropped' : 'completed';
      pushAppNotification(
        'dispatch',
        `${driverName} ${actionText} a load`,
        `${getLoadAlertLabel(load)} was marked ${actionText}.`
      );
    });
  }

  previousLoadsRef.current = nextLoads;
};

useEffect(() => {
  previousLoadsRef.current = null;
  driverAssignmentSeenRef.current = new Set();

  if (currentUser?.role !== 'driver') return;

  try {
    const storedIds = JSON.parse(localStorage.getItem(getDriverAssignmentAlertKey()) || '[]');
    driverAssignmentSeenRef.current = new Set(Array.isArray(storedIds) ? storedIds : []);
  } catch (error) {
    console.error('Failed to load driver assignment alerts:', error);
  }
}, [currentUser?.id, currentUser?.driverId, currentUser?.role]);

const fetchLoads = async () => {
  if (!authToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/loads`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401 && handleAuthError('Unauthorized')) return;
      throw new Error(`Failed to fetch loads: ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error('Loads response is not an array');
    }

    const loadsWithPaperwork = normalizeLoadedLoads(data);

    detectLoadNotifications(loadsWithPaperwork);
    setLoadsData(loadsWithPaperwork);

    setSelectedLoad((prev) => {
      if (loadsWithPaperwork.length === 0) return null;
      if (!prev) return null;
      return loadsWithPaperwork.find((load) => load.id === prev.id) || null;
    });

    setInvoiceLoadId((prev) => {
      if (data.length === 0) return '';
      if (prev && data.some((load) => load.id === prev)) return prev;
      return data[0].id;
    });
  } catch (error) {
    console.error('Error loading loads:', error);
  }
};

const fetchDriverLocations = async () => {
  if (!authToken || !roleCanAccessView(currentUser?.role, 'dispatch')) return;

  try {
    const res = await fetch(`${API_BASE}/api/driver-locations`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      if (res.status === 401 && handleAuthError('Unauthorized')) return;
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to fetch driver locations');
    }

    const data = await res.json();
    setLiveDriverLocations(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('Error loading driver locations:', error);
  }
};
  const fetchCustomers = async () => {
  if (!authToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/customers`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401 && handleAuthError('Unauthorized')) return;
      throw new Error(`Failed to fetch customers: ${res.status}`);
    }

    const data = await res.json();
    setCustomers(data);
  } catch (error) {
    console.error('Error loading customers:', error);
  }
};

  const fetchInvoices = async () => {
  if (!authToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/invoices`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401 && handleAuthError('Unauthorized')) return;
      throw new Error(`Failed to fetch invoices: ${res.status}`);
    }

    const data = await res.json();
    setSavedInvoices(data);
  } catch (error) {
    console.error('Error loading invoices:', error);
  }
};

const fetchLocations = async () => {
  if (!authToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/locations`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401 && handleAuthError('Unauthorized')) return;
      throw new Error(`Failed to fetch locations: ${res.status}`);
    }

    const data = await res.json();
    setLocations(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('Error fetching locations:', error);
  }
};

const handleDeleteLocation = async (locationId) => {
  const confirmDelete = window.confirm('Delete this location?');
  if (!confirmDelete) return;

  try {
    const res = await fetch(`${API_BASE}/api/locations/${locationId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete location');
    }

    await fetchLocations();
  } catch (error) {
    console.error('Failed to delete location:', error);
    alert(`Failed to delete location: ${error.message}`);
  }
};

useEffect(() => {
  if (activeView === 'settings') {
    if (fullAccessRoles.has(getNormalizedRole(currentUser?.role))) {
      fetchAllUsers();
    }
    fetchCompanyProfile();
    fetchAuditLogs();
  }
}, [activeView, authToken, currentUser?.role]);

useEffect(() => {
  setDropDetailsDraft(selectedLoad ? buildDropDetailsDraft(selectedLoad) : buildDropDetailsDraft());
}, [selectedLoad?.id]);

useEffect(() => {
  if (selectedLoad?.id && roleCanAccessView(currentUser?.role, 'dispatch')) {
    fetchSelectedLoadAuditLogs(selectedLoad.id);
  } else {
    setSelectedLoadAuditLogs([]);
  }
}, [selectedLoad?.id, authToken, currentUser?.role]);

useEffect(() => {
  if (!currentUser) return;
  if (activeView === 'tenants' && canManageTenants) return;
  if (!roleCanAccessView(currentUser.role, activeView)) {
    setActiveView(getDefaultViewForRole(currentUser.role));
  }
}, [activeView, currentUser, canManageTenants]);

useEffect(() => {
  if (isDemoMode) return;
  if (activeView === 'drivers') {
    fetchDrivers();
  }
}, [activeView, authToken, isDemoMode]);

useEffect(() => {
  if (isDemoMode) return;
  if (activeView === 'tenants' && canManageTenants) {
    fetchTenantManagement();
  }
}, [activeView, authToken, isDemoMode, canManageTenants]);


useEffect(() => {
  if (!authToken || isDemoMode) return;

  fetchLoads();
  fetchCustomers();
  fetchInvoices();
  fetchLocations();
  fetchDrivers();
  fetchCompanyProfile();
  fetchDriverLocations();
  if (currentUser?.role === 'driver') {
    fetchDriverFuelHistory();
    setFuelForm((prev) => ({
      ...prev,
      truckId: prev.truckId || getDriverDefaultTruck(),
    }));
  } else if (roleCanAccessView(currentUser?.role, 'accounting')) {
    fetchFuelSummary();
  }
}, [authToken, isDemoMode]);

useEffect(() => {
  if (!authToken || isDemoMode || currentUser?.role === 'driver' || activeView !== 'accounting') return;
  fetchFuelSummary();
}, [authToken, isDemoMode, activeView, fuelFilters.from, fuelFilters.to, fuelFilters.driverId, fuelFilters.truckId]);

useEffect(() => {
  if (currentUser?.role !== 'driver') return;
  setFuelForm((prev) => ({
    ...prev,
    truckId: prev.truckId || getDriverDefaultTruck(),
  }));
}, [currentUser?.driverId, currentUser?.role, driversList]);

useEffect(() => {
  if (!authToken || isDemoMode || activeView === 'driver') return;

  const interval = setInterval(() => {
    fetchLoads();
  }, 5000);

  return () => clearInterval(interval);
}, [authToken, isDemoMode, activeView]);

useEffect(() => {
  if (!authToken || isDemoMode || isEditing) return;

  const interval = setInterval(() => {
    refreshLoadsData();
  }, 5000);

  return () => clearInterval(interval);
}, [authToken, isDemoMode, activeView, isEditing]);

  /*const getDriverName = (driverId) =>
    driversList.find((d) => d.id === driverId)?.name || 'Unknown';*/

  const getDriverName = (driverValue) =>
    getDriverRecord(driverValue)?.name || 'Unknown';

  const getDriverTruck = (driverValue) =>
    getDriverRecord(driverValue)?.truck || 'N/A';

  const getChecklistStatus = (load, docType) =>
    (load.documents || []).some(
    (doc) =>
      (doc.category || doc.type || '').toLowerCase() === docType.toLowerCase()
  );
  const driverStatuses = driversList.map((driver) => {
    const activeLoad = loadsData.find(
      (load) =>
        normalizeDriverForStorage(load.driver) === driver.id &&
        (load.status === 'Dispatched' || load.status === 'In Transit')
    );

    const hasUploadedPod = (load) => {
  if (!load || !Array.isArray(load.documents)) return false;
  return load.documents.some(
    (doc) => (doc.type || '').toLowerCase() === 'pod'
  );
};

    if (activeLoad) {
      return {
        driver: `${driver.id} - ${driver.name}`,
        status: 'On Load',
        truck: driver.truck,
        location:
          activeLoad.status === 'Dispatched'
            ? activeLoad.pickup
            : `En Route to ${activeLoad.delivery}`,
      };
    }

    return {
      driver: `${driver.id} - ${driver.name}`,
      status: 'Available',
      truck: driver.truck,
      location: driver.homeBase,
    };
  });

  const activeSettlementDriverId = selectedSettlementDriverId || driversList[0]?.id || '';
  const settlementManualLoadKey = [
    activeSettlementDriverId || 'no-driver',
    settlementStartDate || 'all-start',
    settlementEndDate || 'all-end',
  ].join('|');
  const currentSettlementManualLoadIds = settlementManualLoadIds[settlementManualLoadKey] || [];
  const getSettlementAppointmentDate = (load) => {
    const rawAppointment = String(load.appointmentTime || '').trim();
    if (!rawAppointment) return null;

    const localDate = getLocalDatePortion(rawAppointment);
    if (localDate) return localDate;

    return getDateStringInAppTimeZone(rawAppointment) || null;
  };

  const filteredSettlementLoads = useMemo(() => {
    const periodLoads = loadsData.filter((load) => {
      const matchesDriver = activeSettlementDriverId
        ? normalizeDriverForStorage(load.driver) === activeSettlementDriverId
        : true;
      const settlementAppointmentDate = getSettlementAppointmentDate(load);
      const matchesStart =
        !settlementStartDate || (settlementAppointmentDate && settlementAppointmentDate >= settlementStartDate);
      const matchesEnd =
        !settlementEndDate || (settlementAppointmentDate && settlementAppointmentDate <= settlementEndDate);
      return matchesDriver && matchesStart && matchesEnd;
    });

    const loadMap = new Map(periodLoads.map((load) => [load.id, load]));
    currentSettlementManualLoadIds.forEach((loadId) => {
      const manualLoad = loadsData.find(
        (load) =>
          load.id === loadId &&
          (!activeSettlementDriverId || normalizeDriverForStorage(load.driver) === activeSettlementDriverId)
      );
      if (manualLoad) loadMap.set(manualLoad.id, manualLoad);
    });

    return Array.from(loadMap.values());
  }, [
    loadsData,
    activeSettlementDriverId,
    settlementStartDate,
    settlementEndDate,
    currentSettlementManualLoadIds,
  ]);

  const activeSettlementDriver =
    driversList.find((driver) => driver.id === activeSettlementDriverId) ||
    null;

  const settlementCustomDeductionKey = [
    activeSettlementDriver?.id || 'no-driver',
    settlementStartDate || 'all-start',
    settlementEndDate || 'all-end',
  ].join('|');

  const currentSettlementCustomDeductions =
    settlementCustomDeductions[settlementCustomDeductionKey] || [];

  const settlementTripPayTotalNumber = filteredSettlementLoads.reduce(
    (sum, load) => sum + parseMoney(load.driverRate),
    0
  );

  const getSettlementCustomDeductionAmountNumber = (item = {}) => {
    if (item.type === 'percent') {
      return settlementTripPayTotalNumber * (parseMoney(item.percent ?? item.amount) / 100);
    }

    return parseMoney(item.amount);
  };

  const getSettlementCustomDeductionAmount = (item = {}) =>
    formatMoney(getSettlementCustomDeductionAmountNumber(item));

  const getSettlementCustomDeductionLabel = (item = {}) =>
    item.type === 'percent'
      ? `${item.percent ?? (item.amount || 0)}% of trip pay`
      : 'Fixed amount';

  const settlementCustomDeductionTotalNumber = currentSettlementCustomDeductions.reduce(
    (sum, item) => sum + getSettlementCustomDeductionAmountNumber(item),
    0
  );

  const settlementPeriodLabel =
    settlementStartDate || settlementEndDate
      ? `${settlementStartDate || 'Start'} to ${settlementEndDate || 'End'}`
      : 'All appointment dates';

  const settlementDetentionPayNumber = filteredSettlementLoads.reduce(
    (sum, load) => sum + parseMoney(load.detention),
    0
  );
  const settlementCalculation = calculateSettlement({
    loads: filteredSettlementLoads,
    dispatchRate: parseMoney(settlementCalculatorInputs.dispatchRate) / 100,
    driverSplitRate: parseMoney(settlementCalculatorInputs.driverSplitRate) / 100,
    insurance: settlementCalculatorInputs.insurance,
    fuel: settlementCalculatorInputs.fuel,
    prePulls: settlementCalculatorInputs.prePulls,
    stopOffs: settlementCalculatorInputs.stopOffs,
    parking: settlementCalculatorInputs.parking,
    loanRepayment: settlementCalculatorInputs.loanRepayment,
    occupationalAccident: settlementCalculatorInputs.occupationalAccident,
    otherPersonalDeductions: settlementCustomDeductionTotalNumber,
    detentionHours: settlementCalculatorInputs.detentionHours,
    detentionHourlyRate: settlementCalculatorInputs.detentionHourlyRate,
    detentionPay: settlementDetentionPayNumber,
  });
  const settlementStatementSummary = settlementCalculation.statementSummary;

  const settlementReport = activeSettlementDriver
    ? [
        {
          driverId: activeSettlementDriver.id,
          driverName: activeSettlementDriver.name,
          loadsCount: filteredSettlementLoads.length,
          grossPay: formatMoney(settlementCalculation.grossPay),
          dispatchFee: formatMoney(settlementCalculation.dispatchFee),
          insurance: formatMoney(settlementCalculation.insurance),
          fuel: formatMoney(settlementCalculation.fuel),
          prePulls: formatMoney(settlementCalculation.revenueSummary.prePulls),
          stopOffs: formatMoney(settlementCalculation.revenueSummary.stopOffs),
          sharedDeductions: formatMoney(settlementCalculation.sharedDeductions),
          splitAmount: formatMoney(settlementCalculation.splitAmount),
          driverShare: formatMoney(settlementCalculation.driverShare),
          parking: formatMoney(settlementCalculation.parking),
          loanRepayment: formatMoney(settlementCalculation.loanRepayment),
          occupationalAccident: formatMoney(settlementCalculation.occupationalAccident),
          otherPersonalDeductions: formatMoney(settlementCalculation.otherPersonalDeductions),
          finalPayCheck: formatMoney(settlementCalculation.finalPayCheck),
          totalDriverRate: formatMoney(settlementCalculation.grossPay),
          totalDetention: formatMoney(settlementCalculation.detentionPay),
          totalLumper: formatMoney(
            filteredSettlementLoads.reduce((sum, load) => sum + parseMoney(load.lumper), 0)
          ),
          totalFuelAdvance: formatMoney(settlementCalculation.fuel),
          totalCustomDeductions: formatMoney(settlementCustomDeductionTotalNumber),
          totalSettlement: formatMoney(settlementCalculation.driverShare),
          finalPayment: formatMoney(settlementCalculation.finalPayCheck),
        },
      ]
    : [];

  const settlementTotals = settlementReport[0] || {
    loadsCount: 0,
    grossPay: formatMoney(0),
    dispatchFee: formatMoney(0),
    insurance: formatMoney(0),
    fuel: formatMoney(0),
    prePulls: formatMoney(0),
    stopOffs: formatMoney(0),
    sharedDeductions: formatMoney(0),
    splitAmount: formatMoney(0),
    driverShare: formatMoney(0),
    parking: formatMoney(0),
    loanRepayment: formatMoney(0),
    occupationalAccident: formatMoney(0),
    otherPersonalDeductions: formatMoney(0),
    finalPayCheck: formatMoney(0),
    totalDriverRate: formatMoney(0),
    totalDetention: formatMoney(0),
    totalLumper: formatMoney(0),
    totalFuelAdvance: formatMoney(0),
    totalCustomDeductions: formatMoney(0),
    totalSettlement: formatMoney(0),
    finalPayment: formatMoney(0),
  };

  useEffect(() => {
    if (!selectedSettlementDriverId && driversList[0]?.id) {
      setSelectedSettlementDriverId(driversList[0].id);
    }
  }, [driversList, selectedSettlementDriverId]);

  const handleSetSettlementWeek = (direction) => {
    const reference = direction === 'current'
      ? new Date()
      : settlementStartDate
      ? new Date(`${settlementStartDate}T12:00:00`)
      : new Date();
    if (direction === 'previous') reference.setDate(reference.getDate() - 7);
    if (direction === 'next') reference.setDate(reference.getDate() + 7);

    const start = getStartOfWeek(reference);
    const end = getEndOfWeek(reference);
    setSettlementStartDate(start.toISOString().split('T')[0]);
    setSettlementEndDate(end.toISOString().split('T')[0]);
    setSelectedSettlementLoadId('');
  };

  const handleClearSettlementPeriod = () => {
    setSettlementStartDate('');
    setSettlementEndDate('');
    setSelectedSettlementLoadId('');
    setActiveBackendSettlement(null);
  };

  const fetchBackendSettlementById = async (settlementId) => {
    const res = await fetch(`${API_BASE}/api/driver-settlements/${settlementId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load settlement');
    }
    return data;
  };

  const fetchActiveBackendSettlement = async () => {
    if (!authToken || !activeSettlementDriverId || !settlementStartDate || !settlementEndDate) {
      setBackendSettlements([]);
      setActiveBackendSettlement(null);
      return null;
    }

    setSettlementBackendLoading(true);
    try {
      const params = new URLSearchParams({
        driverId: activeSettlementDriverId,
        periodStart: settlementStartDate,
        periodEnd: settlementEndDate,
      });
      const res = await fetch(`${API_BASE}/api/driver-settlements?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load settlements');
      }

      setBackendSettlements(Array.isArray(data) ? data : []);
      const current = (Array.isArray(data) ? data : []).find(
        (item) =>
          item.driverId === activeSettlementDriverId &&
          item.periodStart === settlementStartDate &&
          item.periodEnd === settlementEndDate
      );

      if (!current) {
        setActiveBackendSettlement(null);
        return null;
      }

      const fullSettlement = await fetchBackendSettlementById(current.id);
      setActiveBackendSettlement(fullSettlement);
      setSettlementNote(fullSettlement.notes || fullSettlement.statement?.settlement?.notes || '');
      return fullSettlement;
    } catch (error) {
      console.error('Failed to load backend settlement:', error);
      setSettlementBackendStatus(`Could not load database settlement: ${error.message}`);
      return null;
    } finally {
      setSettlementBackendLoading(false);
    }
  };

  const createBackendSettlement = async () => {
    if (!activeSettlementDriverId || !settlementStartDate || !settlementEndDate) {
      setSettlementBackendStatus('Choose a driver and week before creating a database settlement.');
      return null;
    }

    setSettlementBackendLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/driver-settlements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          driverId: activeSettlementDriverId,
          periodStart: settlementStartDate,
          periodEnd: settlementEndDate,
          notes: settlementNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create settlement');
      }

      setActiveBackendSettlement(data);
      setSettlementNote(data.notes || data.statement?.settlement?.notes || settlementNote);
      setSettlementBackendStatus(`Database settlement created for ${settlementPeriodLabel}.`);
      await fetchActiveBackendSettlement();
      return data;
    } catch (error) {
      console.error('Failed to create backend settlement:', error);
      setSettlementBackendStatus(`Failed to create database settlement: ${error.message}`);
      return null;
    } finally {
      setSettlementBackendLoading(false);
    }
  };

  const ensureBackendSettlement = async () => {
    if (activeBackendSettlement?.id) return activeBackendSettlement;
    return createBackendSettlement();
  };

  const handleCompleteBackendSettlement = async () => {
    if (!activeBackendSettlement?.id) return;

    const confirmed = window.confirm(
      'Mark this driver settlement complete? Payroll can still print or export it after completion.'
    );
    if (!confirmed) return;

    setSettlementBackendLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/driver-settlements/${activeBackendSettlement.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ status: 'Complete', notes: settlementNote }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete settlement');
      }

      setActiveBackendSettlement(data);
      setSettlementNote(data.notes || data.statement?.settlement?.notes || settlementNote);
      setSettlementBackendStatus('Database settlement marked complete with payroll note saved. You can now print or export it for the driver.');
    } catch (error) {
      console.error('Failed to complete backend settlement:', error);
      setSettlementBackendStatus(`Failed to complete settlement: ${error.message}`);
    } finally {
      setSettlementBackendLoading(false);
    }
  };

  useEffect(() => {
    if (activeView !== 'settlements') return;
    fetchActiveBackendSettlement();
  }, [activeView, activeSettlementDriverId, settlementStartDate, settlementEndDate, authToken]);

  const getSettlementAppointmentDateValue = (load) => {
    const appointmentTime = String(load.appointmentTime || '').trim();
    if (!appointmentTime) return 0;

    const appointmentDateTime = new Date(appointmentTime).getTime();
    return Number.isNaN(appointmentDateTime) ? 0 : appointmentDateTime;
  };

  /*const settlementReport = driversList.map((driver) => {
    const driverLoads = filteredSettlementLoads.filter(
      (load) => normalizeDriverForStorage(load.driver) === driver.id
    );

    return {
      driverId: driver.id,
      driverName: driver.name,
      loadsCount: driverLoads.length,
      totalDriverRate: formatMoney(
        driverLoads.reduce((sum, load) => sum + parseMoney(load.driverRate), 0)
      ),
      totalDetention: formatMoney(
        driverLoads.reduce((sum, load) => sum + parseMoney(load.detention), 0)
      ),
      totalLumper: formatMoney(
        driverLoads.reduce((sum, load) => sum + parseMoney(load.lumper), 0)
      ),
      totalFuelAdvance: formatMoney(
        driverLoads.reduce((sum, load) => sum + parseMoney(load.fuelAdvance), 0)
      ),
      totalSettlement: formatMoney(
        driverLoads.reduce((sum, load) => sum + parseMoney(load.settlement), 0)
      ),
    };
  });*/

  const settlementDetailLoads = [...filteredSettlementLoads].sort((a, b) => {
    const dateCompare = getSettlementAppointmentDateValue(a) - getSettlementAppointmentDateValue(b);
    if (dateCompare !== 0) return dateCompare;
    return getDriverLabel(a.driver).localeCompare(getDriverLabel(b.driver));
  });

  const normalizedSettlementContainerSearch = settlementContainerSearch.trim().toLowerCase();
  const visibleSettlementLoads = normalizedSettlementContainerSearch
    ? settlementDetailLoads.filter((load) =>
        String(load.containerNumber || '').toLowerCase().includes(normalizedSettlementContainerSearch)
      )
    : settlementDetailLoads;
  const isCompletedLoad = (load) => ['delivered', 'completed'].includes(getLoadQuickStatusKey(load));
  const isDeliveredLoad = isCompletedLoad;

  const settlementManualLoadCandidates = useMemo(() => {
    const term = settlementManualLoadSearch.trim().toLowerCase();
    if (!activeSettlementDriverId || !term) return [];
    const existingLoadIds = new Set(filteredSettlementLoads.map((load) => load.id));

    return (loadsData || [])
      .filter((load) => isCompletedLoad(load))
      .filter((load) => !existingLoadIds.has(load.id))
      .filter((load) => {
        const haystack = [
          load.id,
          load.containerNumber,
          load.referenceNumber,
          load.poNumber,
          load.bookingNumber,
          load.customer,
          getDriverLabel(load.driver),
          formatAppointmentTime(load.appointmentTime),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => getSettlementAppointmentDateValue(b) - getSettlementAppointmentDateValue(a))
      .slice(0, 12);
  }, [activeSettlementDriverId, filteredSettlementLoads, loadsData, settlementManualLoadSearch]);

  const isLoadOutsideSettlementPeriod = (load) => {
    const settlementAppointmentDate = getSettlementAppointmentDate(load);
    if (!settlementAppointmentDate) return true;
    if (settlementStartDate && settlementAppointmentDate < settlementStartDate) return true;
    if (settlementEndDate && settlementAppointmentDate > settlementEndDate) return true;
    return false;
  };

  const getBackendSettlementLineForLoad = (loadId) =>
    activeBackendSettlement?.statement?.loads?.find((line) => line.loadId === loadId) || null;

  const settlementReviewLoad = settlementReviewLoadId
    ? loadsData.find((load) => load.id === settlementReviewLoadId) || null
    : null;

  const selectedSettlementLoad =
    visibleSettlementLoads.find((load) => load.id === selectedSettlementLoadId) ||
    visibleSettlementLoads[0] ||
    null;

  const getSettlementPayValue = (load, field) =>
    settlementPayDrafts[load.id]?.[field] ?? load[field] ?? '$0.00';

  const getSettlementPayTotal = (load) =>
    calculateLoadSettlement({
      driverRate: getSettlementPayValue(load, 'driverRate'),
      detention: getSettlementPayValue(load, 'detention'),
      lumper: getSettlementPayValue(load, 'lumper'),
      fuelAdvance: getSettlementPayValue(load, 'fuelAdvance'),
    });

const paperworkAlerts = loadsData.filter((load) => load.paperwork);

const activeOperationsLoads = (loadsData || []).filter((load) => !isCompletedLoad(load));
const isLoadReadyForAccounting = (load) =>
  String(load?.billingStatus || '').trim().toLowerCase() === 'ready to bill' ||
  savedInvoices.some((invoice) => invoice.loadId === load?.id);
const getRelativeDateString = (offsetDays = 0) => getDateStringWithOffsetInAppTimeZone(offsetDays);
const getLoadAppointmentDate = (load) => {
  const rawAppointment = String(load?.appointmentTime || '').trim();
  if (!rawAppointment) return '';
  const localDate = getLocalDatePortion(rawAppointment);
  if (localDate) return localDate;

  const date = new Date(rawAppointment);
  return Number.isNaN(date.getTime()) ? '' : getDateStringInAppTimeZone(date);
};
const completedReviewLoads = (loadsData || [])
  .filter((load) => isCompletedLoad(load) && !isLoadReadyForAccounting(load))
  .sort((a, b) => String(b.appointmentTime || b.loadDate || '').localeCompare(String(a.appointmentTime || a.loadDate || '')));
const completedAccountingLoads = (loadsData || [])
  .filter((load) => isCompletedLoad(load) && isLoadReadyForAccounting(load))
  .sort((a, b) => String(b.loadDate || '').localeCompare(String(a.loadDate || '')));
const getCompletedLoadFilterDate = () => {
  if (completedLoadDateFilter === 'yesterday') return getRelativeDateString(-1);
  if (completedLoadDateFilter === 'custom') return completedLoadCustomDate;
  return getRelativeDateString(0);
};
const filteredCompletedReviewLoads = completedReviewLoads.filter((load) => {
  const targetDate = getCompletedLoadFilterDate();
  return targetDate ? getLoadAppointmentDate(load) === targetDate : true;
});
const getNumericMiles = (value) => {
  const miles = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(miles) && miles > 0 ? miles : 0;
};
const getMileageReportDate = (load = {}) =>
  getLocalDatePortion(load.appointmentTime) ||
  getLocalDatePortion(load.loadDate) ||
  getLocalDatePortion(load.completedAt) ||
  '';
const mileageReportYears = [
  getTodayDate().slice(0, 4),
  ...completedAccountingLoads
    .map((load) => getMileageReportDate(load).slice(0, 4))
    .filter(Boolean),
]
  .filter((year, index, years) => years.indexOf(year) === index)
  .sort((a, b) => b.localeCompare(a));
const mileageReportLoads = completedAccountingLoads.filter((load) =>
  getMileageReportDate(load).startsWith(String(mileageReportYear || ''))
);
const mileageReportRows = Object.values(
  mileageReportLoads.reduce((groups, load) => {
    const driverId = normalizeDriverForStorage(load.driver) || 'UNASSIGNED';
    const driverName = driverId === 'UNASSIGNED' ? 'Unassigned' : getDriverLabel(driverId);
    const miles = getNumericMiles(load.miles);
    groups[driverId] = groups[driverId] || {
      driverId,
      driverName,
      loadCount: 0,
      totalMiles: 0,
      missingMiles: 0,
    };
    groups[driverId].loadCount += 1;
    groups[driverId].totalMiles += miles;
    if (!miles) groups[driverId].missingMiles += 1;
    return groups;
  }, {})
).sort((a, b) => b.totalMiles - a.totalMiles || a.driverName.localeCompare(b.driverName));
const mileageReportTotals = mileageReportRows.reduce(
  (totals, row) => ({
    loadCount: totals.loadCount + row.loadCount,
    totalMiles: totals.totalMiles + row.totalMiles,
    missingMiles: totals.missingMiles + row.missingMiles,
  }),
  { loadCount: 0, totalMiles: 0, missingMiles: 0 }
);
const normalizedAccountingSearchTerm = String(accountingSearchTerm || '').trim().toLowerCase();
const filteredAccountingLoads = normalizedAccountingSearchTerm
  ? completedAccountingLoads.filter((load) => {
      const customer = String(load.customer || '').toLowerCase();
      const container = String(load.containerNumber || '').toLowerCase();
      const reference = String(load.referenceNumber || '').toLowerCase();
      const poNumber = String(load.poNumber || '').toLowerCase();
      const pickupNumber = String(load.pickupNumber || '').toLowerCase();
      return (
        customer.includes(normalizedAccountingSearchTerm) ||
        container.includes(normalizedAccountingSearchTerm) ||
        reference.includes(normalizedAccountingSearchTerm) ||
        poNumber.includes(normalizedAccountingSearchTerm) ||
        pickupNumber.includes(normalizedAccountingSearchTerm)
      );
    })
  : completedAccountingLoads;
const selectedAccountingLoad =
  selectedAccountingLoadId
    ? filteredAccountingLoads.find((load) => load.id === selectedAccountingLoadId) || null
    : null;
const completedExtraChargeLoad =
  accountingExtraChargesOpenLoadId
    ? completedReviewLoads.find((load) => load.id === accountingExtraChargesOpenLoadId) || null
    : null;
const selectedAccountingInvoice = selectedAccountingLoad
  ? savedInvoices.find((invoice) => invoice.loadId === selectedAccountingLoad.id) || null
  : null;
const hasLastFreeDay = (load) => Boolean(String(load.lfd || load.lastFreeDay || '').trim());
const hasAppointment = (load) => Boolean(String(load.appointmentTime || '').trim());
const getAppointmentFilterDate = () => {
  if (appointmentDateFilter === 'yesterday') return getRelativeDateString(-1);
  if (appointmentDateFilter === 'tomorrow') return getRelativeDateString(1);
  if (appointmentDateFilter === 'custom') return customAppointmentDate;
  return getRelativeDateString(0);
};
const getAvailableAppointmentFilterDate = () => {
  if (availableAppointmentDateFilter === 'all') return '';
  if (availableAppointmentDateFilter === 'tomorrow') return getRelativeDateString(1);
  if (availableAppointmentDateFilter === 'custom') return availableCustomAppointmentDate;
  return getRelativeDateString(0);
};
const matchesAppointmentDateFilter = (load) => {
  const targetDate = getAppointmentFilterDate();
  if (!targetDate) return hasAppointment(load);
  return getLoadAppointmentDate(load) === targetDate;
};
const matchesAvailableAppointmentDateFilter = (load) => {
  const targetDate = getAvailableAppointmentFilterDate();
  if (!targetDate) return hasAppointment(load);
  return getLoadAppointmentDate(load) === targetDate;
};
const getDeliveryTypeKey = (load = {}) =>
  String(load.deliveryType || '').trim().toLowerCase();
const getDeliveryTypeLabel = (value = '') => {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'local') return 'Local Delivery';
  if (key === 'highway') return 'Highway Delivery';
  return 'Not Set';
};
const matchesAppointmentDeliveryTypeFilter = (load) =>
  appointmentDeliveryTypeFilter === 'all' ||
  getDeliveryTypeKey(load) === appointmentDeliveryTypeFilter;
const matchesAvailableDeliveryTypeFilter = (load) =>
  availableDeliveryTypeFilter === 'all' ||
  getDeliveryTypeKey(load) === availableDeliveryTypeFilter;
const hasAssignedDriver = (load) => {
  const rawDriver = String(load?.driver || '').trim();
  return Boolean(rawDriver && !/^(-+\s*)?(no driver|assign later|select driver|not assigned)$/i.test(rawDriver));
};

const isDriverAssignedDispatchLoad = (load) => {
  const status = String(load?.status || '').trim().toLowerCase();
  return hasAssignedDriver(load) && !['in transit', 'dropped', 'delivered', 'completed'].includes(status);
};

 const lfdCount = (loadsData || []).filter(
  (load) => hasLastFreeDay(load) && !isDeliveredLoad(load)
).length;



const dispatchedLoads = loadsData.filter(
  (load) => isDriverAssignedDispatchLoad(load)
);

const inTransitLoads = loadsData.filter(
  (load) => getLoadQuickStatusKey(load) === 'in transit'
);

const droppedLoads = loadsData.filter(
  (load) => getLoadQuickStatusKey(load) === 'dropped'
);

const lfdLoads = loadsData.filter(
  (load) => hasLastFreeDay(load) && !isDeliveredLoad(load)
);

const appointmentLoads = loadsData.filter(
  (load) => hasAppointment(load) && !isCompletedLoad(load)
);

const summaryCards = [
  { title: 'Dispatched', value: dispatchedLoads.length, filter: 'dispatched' },
  { title: 'In Transit', value: inTransitLoads.length, filter: 'in-transit' },
  { title: 'Dropped', value: droppedLoads.length, filter: 'dropped' },
  { title: 'Appointments', value: appointmentLoads.length, filter: 'appointments' },
  { title: 'LFD', value: lfdLoads.length, filter: 'lfd' },
  { title: 'Available', value: availableLoads.length, filter: 'available' },
  { title: 'Not Available', value: notAvailableLoads.length, filter: 'not-available' },
];

const filteredLoads = loadsData.filter((load) => {
  const term = searchTerm.toLowerCase();

  if (currentUser?.role === 'driver' && !driverMatchesCurrentUser(load.driver, currentUser)) {
    return false;
  }

  const matchesSearch =
    (load.id || '').toLowerCase().includes(term) ||
    (load.driver || '').toLowerCase().includes(term) ||
    (load.customer || '').toLowerCase().includes(term) ||
    (load.referenceNumber || '').toLowerCase().includes(term) ||
    (load.containerNumber || '').toLowerCase().includes(term);

  const matchesStatus =
    statusFilter === 'All' || getLoadQuickStatus(load) === statusFilter;

  const matchesPaperwork =
    paperworkFilter === 'All' || load.paperwork === paperworkFilter;

  return matchesSearch && matchesStatus && matchesPaperwork;
});

  const selectedInvoiceLoad =
    loadsData.find((load) => load.id === invoiceLoadId) || null;

  const selectedCustomer =
    customers.find((customer) => customer.name === selectedInvoiceLoad?.customer) || null;

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    setNewLoad((prev) => {
      const updated = {
        ...prev,
        [name]: value,
        truck: name === 'driver' ? (value ? getDriverTruck(value) : '') : prev.truck,
        status:
          name === 'driver'
            ? getStatusAfterDriverAssignment(value, prev.status)
            : name === 'status'
              ? value
              : prev.status,
      };

      updated.settlement = calculateLoadSettlement({
        driverRate: updated.driverRate,
        detention: updated.detention,
        lumper: updated.lumper,
        fuelAdvance: updated.fuelAdvance,
      });

      return updated;
    });
  };

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;

    setEditingLoad((prev) => {
  const updated = {
  ...prev,
  [name]: value,
  truck: name === 'driver' ? (value ? getDriverTruck(value) : '') : prev.truck,
  status:
    name === 'driver'
      ? getStatusAfterDriverAssignment(value, prev.status)
      : name === 'status'
        ? value
        : prev.status,
};

if (name === 'driver' && prev.status === 'Dropped') {
  updated.pickup = getDroppedLoadPickup(prev);
}

      updated.settlement = calculateLoadSettlement({
        driverRate: updated.driverRate,
        detention: updated.detention,
        lumper: updated.lumper,
        fuelAdvance: updated.fuelAdvance,
      });

      return updated;
    });
  };

  const estimateLoadMiles = async (mode = 'new') => {
    const isEdit = mode === 'edit';
    const loadForEstimate = isEdit ? editingLoad : newLoad;
    setMileageEstimating(mode);
    setMileageEstimateStatus('Calculating route miles...');

    try {
      const miles = await calculateDrivingMiles(loadForEstimate);
      const milesValue = String(miles.toFixed(1));
      if (isEdit) {
        setEditingLoad((prev) => ({ ...prev, miles: milesValue }));
      } else {
        setNewLoad((prev) => ({ ...prev, miles: milesValue }));
      }
      setMileageEstimateStatus(`Estimated ${formatMiles(miles)} from pickup, delivery, and return.`);
      return milesValue;
    } catch (error) {
      setMileageEstimateStatus(error.message || 'Unable to calculate miles.');
      return '';
    } finally {
      setMileageEstimating('');
    }
  };

  const getLoadMilesForSave = async (load, mode = 'new') => {
    if (Number.parseFloat(String(load?.miles ?? '').replace(/[^0-9.-]/g, '')) > 0) {
      return load.miles;
    }
    return estimateLoadMiles(mode);
  };

  const findDuplicateContainerLoad = (containerNumber, currentLoadId = '') => {
    const normalizedContainer = String(containerNumber || '').trim().toUpperCase();
    if (!normalizedContainer) return null;

    return loadsData.find((load) => {
      if (currentLoadId && load.id === currentLoadId) return false;
      return String(load.containerNumber || '').trim().toUpperCase() === normalizedContainer;
    });
  };

  const canReuseContainerAsStreetTurn = (load = {}, isExportLoad = false) =>
    Boolean(load.streetTurn) && isExportLoad;

const handleAddLoad = async (e) => {
  e.preventDefault();
  const isExportLoad = selectedPresetName === 'Export Load';
  const duplicateContainerLoad = findDuplicateContainerLoad(newLoad.containerNumber);
  if (
    duplicateContainerLoad &&
    !canReuseContainerAsStreetTurn(newLoad, isExportLoad)
  ) {
    alert(
      `Container ${String(newLoad.containerNumber || '').trim().toUpperCase()} is already on load ${duplicateContainerLoad.id}. Use Export Load + Street Turn only when this is a real reuse.`
    );
    return;
  }

  if (
    !String(newLoad.customer || '').trim() ||
    !String(newLoad.referenceNumber || '').trim() ||
    (!isExportLoad && !String(newLoad.containerNumber || '').trim()) ||
    !String(newLoad.pickup || '').trim() ||
    !String(newLoad.delivery || '').trim()
  ) {
    alert(
      isExportLoad
        ? 'Please complete Customer, Reference #, Pickup, and Delivery before creating the export load.'
        : 'Please complete Customer, Reference #, Container Number, Pickup, and Delivery before creating the load.'
    );
    return;
  }
  try {
    await saveLocationIfNotExists(newLoad.pickup, 'pickup');
    await saveLocationIfNotExists(newLoad.delivery, 'delivery');
    await saveLocationIfNotExists(newLoad.returnLocation, 'return');
    const savedMiles = await getLoadMilesForSave(newLoad, 'new');

    const loadToAdd = {
      ...newLoad,
      id: newLoad.id || '',
      loadDate: newLoad.loadDate || getTodayDate(),
      truck: newLoad.truck || getDriverTruck(newLoad.driver),
      rate: newLoad.rate || '$0.00',
      driverRate: newLoad.driverRate || '$0.00',
      detention: newLoad.detention || '$0.00',
      lumper: newLoad.lumper || '$0.00',
      fuelAdvance: newLoad.fuelAdvance || '$0.00',
      settlement: calculateLoadSettlement({
        driverRate: newLoad.driverRate || '$0.00',
        detention: newLoad.detention || '$0.00',
        lumper: newLoad.lumper || '$0.00',
        fuelAdvance: newLoad.fuelAdvance || '$0.00',
      }),
      referenceNumber: newLoad.referenceNumber || '',
      pod: newLoad.pod || '',
      containerSize: newLoad.containerSize || '',
     chassisNumber: newLoad.chassisNumber || '',
      sealNumber: newLoad.sealNumber || '',
      containerNumber: newLoad.containerNumber || '',
    bookingNumber: newLoad.bookingNumber || '',
      miles: savedMiles || newLoad.miles || '',
      eta: newLoad.eta || '',
      availabilityStatus: newLoad.availabilityStatus || 'Not Available',
      documents: [],
      paperwork: getPaperworkStatusFromDocuments([]),
    };

const payload = {
  ...loadToAdd,
  driver: normalizeDriverForStorage(newLoad.driver),
  truck: newLoad.driver ? getDriverTruck(newLoad.driver) : '',
  status: getStatusAfterDriverAssignment(newLoad.driver, loadToAdd.status),
};

const res = await fetch(`${API_BASE}/api/loads`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  },
  body: JSON.stringify(payload),
});

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.details || data.error || 'Failed to create load');
    }

    setLoadsData((prev) => {
      const withoutCurrent = prev.filter((load) => load.id !== data.id);
      return [data, ...withoutCurrent];
    });

    setInvoiceLoadId(data.id);
    setShowForm(false);
    setNewLoad(emptyLoad);
    setSelectedPresetName('');

    await fetchLoads();
    await fetchLocations();
    await fetchSelectedLoadAuditLogs(data.id);
  } catch (error) {
    console.error('Failed to create load:', error);
    if (handleAuthError(error.message)) return;
    alert(`Failed to create load: ${error.message}`);
  }
};
const handleEditClick = () => {
  setEditingLoad({
    ...selectedLoad,
    driver: normalizeDriverForStorage(selectedLoad?.driver),
  });

  setIsEditing(true);
  setShowForm(false);
};

const handleUpdateLoad = async (e) => {
  e.preventDefault();

  const updatedLoad = {
    ...editingLoad,
    lastFreeDay: editingLoad.lastFreeDay || '',
    referenceNumber: editingLoad.referenceNumber || '',
    pod: editingLoad.pod || '',
    loadDate: editingLoad.loadDate || getTodayDate(),
    eta: editingLoad.eta || '',
    truck: editingLoad.truck || getDriverTruck(editingLoad.driver),
    rate: editingLoad.rate || '$0.00',
    driverRate: editingLoad.driverRate || '$0.00',
    detention: editingLoad.detention || '$0.00',
    lumper: editingLoad.lumper || '$0.00',
    fuelAdvance: editingLoad.fuelAdvance || '$0.00',
    settlement: calculateLoadSettlement({
      driverRate: editingLoad.driverRate || '$0.00',
      detention: editingLoad.detention || '$0.00',
      lumper: editingLoad.lumper || '$0.00',
      fuelAdvance: editingLoad.fuelAdvance || '$0.00',
    }),
    paperwork: getPaperworkStatusFromDocuments(editingLoad.documents || []),
  };
  const duplicateContainerLoad = findDuplicateContainerLoad(
    updatedLoad.containerNumber,
    updatedLoad.id
  );
  if (duplicateContainerLoad && !updatedLoad.streetTurn) {
    alert(
      `Container ${String(updatedLoad.containerNumber || '').trim().toUpperCase()} is already on load ${duplicateContainerLoad.id}. Mark this load as Street Turn only when this is a real export reuse.`
    );
    return;
  }
  try {

    /* EDITLOAD FUNTION */
const savedMiles = await getLoadMilesForSave(updatedLoad, 'edit');

const payload = {
  ...updatedLoad,
  miles: savedMiles || updatedLoad.miles || '',
  driver: normalizeDriverForStorage(updatedLoad.driver),
  truck: updatedLoad.driver ? getDriverTruck(updatedLoad.driver) : '',
  droppedBy: normalizeDriverForStorage(updatedLoad.droppedBy),
  status: getStatusAfterDriverAssignment(updatedLoad.driver, updatedLoad.status),
};

const res = await fetch(`${API_BASE}/api/loads/${editingLoad.id}`, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  },
  body: JSON.stringify(payload),
});

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.details || data.error || 'Failed to update load');
    }

    setLoadsData((prev) =>
      prev.map((load) => (load.id === data.id ? data : load))
    );
    setSelectedLoad(data);
    setEditingLoad(data);
    setIsEditing(false);
    await fetchSelectedLoadAuditLogs(data.id);
  } catch (error) {
    console.error('Failed to update load:', error);
    alert(`Failed to update load: ${error.message}`);
  }
};

const getPortHoustonSummary = (result) => {
  const availability = result?.availability || result || {};
  const gate = result?.gate || {};
  const lastGateMove = gate.lastGateMove || (Array.isArray(gate.events) ? gate.events[0] : null);

  return {
    available: availability.available,
    terminal: availability.terminal || result?.terminal || '',
    roadImpediments: availability.roadImpediments || availability.impediments || [],
    statusReason: availability.statusReason || result?.suggested?.portStatusReason || '',
    transitState: availability.transitState || result?.suggested?.transitState || '',
    stoppedRoad: availability.stoppedRoad ?? result?.suggested?.stoppedRoad ?? null,
    lastFreeDay: availability.lastFreeDay || '',
    lastGateMove,
    outEir: result?.eir?.out || null,
    inEir: result?.eir?.in || null,
    eirNote: result?.eir?.note || '',
    hasPortDocuments: Boolean(result?.eir?.hasPortDocuments),
    portTransactionNumbers: result?.eir?.transactionNumbers || [],
    gateTransactionCount: result?.gateTransactions?.transactions?.length || 0,
    gateLookupMethod: result?.gateTransactions?.lookupMethod || '',
    gateLookupReason: result?.gateTransactions?.reason || result?.gateTransactions?.error || '',
    checkedBy: result?.checkedBy || '',
    checkedAt: result?.checkedAt || '',
  };
};

const formatPortHoustonValue = (value) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatPortHoustonValue).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    const preferredKeys = [
      'id',
      'code',
      'name',
      'description',
      'message',
      'reason',
      'remark',
      'hold',
      'holdId',
      'impedimentRoad',
      'impedimentRail',
      'impedimentVessel',
      'type',
      'severity',
    ];
    const parts = preferredKeys
      .map((key) => value?.[key])
      .filter((item) => item !== undefined && item !== null && String(item).trim() !== '')
      .map(String);
    if (parts.length) return parts.join(' - ');
    try {
      return JSON.stringify(value);
    } catch {
      return 'Port returned details';
    }
  }
  return String(value);
};

const formatPortHoustonList = (value, fallback = 'None returned') => {
  const text = formatPortHoustonValue(value);
  return text || fallback;
};

const formatPortHoustonGateMove = (move) => {
  if (!move) return 'Not returned';
  const event = move.eventTypeId || move.subType || move.stageId || move.eventStartTime || move.created || '';
  if (String(event).toUpperCase() === 'UNIT_CREATE') {
    return 'Container record created, no gate move yet';
  }
  return formatPortHoustonValue(event) || 'Not returned';
};

const normalizePortShipLineForForm = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const rawKey = raw.split(':')[0].trim().toLowerCase();
  const exact = shipLineOptions.find((line) => line.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const prefix = shipLineOptions.find((line) => line.split(':')[0].trim().toLowerCase() === rawKey);
  return prefix || raw;
};

const fillEmptyPortField = (currentValue, portValue) => {
  const normalizedPortValue = String(portValue || '').trim();
  return String(currentValue || '').trim() || !normalizedPortValue ? currentValue : normalizedPortValue;
};

const handleSmartPortLookup = async () => {
  const containerNumber = String(newLoad.containerNumber || '').trim().toUpperCase();
  const bolNumber = String(newLoad.referenceNumber || newLoad.poNumber || newLoad.bookingNumber || '').trim();

  if (!containerNumber && !bolNumber) {
    setSmartPortLookupStatus('Enter a container number, reference/BOL, PO, or booking number first.');
    return;
  }

  setSmartPortLookupLoading(true);
  setSmartPortLookupStatus('Checking Port Houston...');

  try {
    const params = new URLSearchParams();
    if (containerNumber) params.set('containerNumber', containerNumber);
    if (bolNumber) params.set('bolNumber', bolNumber);
    const terminal = `${newLoad.pickup || ''} ${newLoad.returnLocation || ''}`.trim();
    if (terminal) params.set('terminal', terminal);

    const res = await fetch(`${API_BASE}/api/port-houston/load-lookup?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Failed to check Port Houston');
    }

    const suggested = data.suggested || {};
    setNewLoad((prev) => ({
      ...prev,
      containerNumber: fillEmptyPortField(prev.containerNumber, suggested.containerNumber),
      containerSize: fillEmptyPortField(prev.containerSize, suggested.containerSize),
      shipLine: fillEmptyPortField(prev.shipLine, normalizePortShipLineForForm(suggested.shipLine)),
      bookingNumber: fillEmptyPortField(prev.bookingNumber, suggested.bookingNumber),
      referenceNumber: fillEmptyPortField(prev.referenceNumber, suggested.billOfLading),
      sealNumber: fillEmptyPortField(prev.sealNumber, suggested.sealNumber),
      lastFreeDay: fillEmptyPortField(prev.lastFreeDay, getLocalDatePortion(suggested.lastFreeDay)),
      availabilityStatus: fillEmptyPortField(prev.availabilityStatus, suggested.availabilityStatus),
      notes:
        suggested.vesselName && !String(prev.notes || '').includes(`Port vessel: ${suggested.vesselName}`)
          ? `${prev.notes || ''}${prev.notes ? '\n' : ''}Port vessel: ${suggested.vesselName}`
          : prev.notes,
    }));

    const filled = [
      suggested.containerNumber && 'container',
      suggested.containerSize && 'size',
      suggested.shipLine && 'ship line',
      suggested.lastFreeDay && 'LFD',
      suggested.availabilityStatus && 'availability',
      suggested.bookingNumber && 'booking',
      suggested.sealNumber && 'seal',
    ].filter(Boolean);

    setSmartPortLookupStatus(
      filled.length
        ? `Port Houston returned: ${filled.join(', ')}.${suggested.portStatusReason ? ` ${suggested.portStatusReason}` : ''}`
        : 'Port Houston responded, but no extra load fields were returned for this container yet.'
    );
  } catch (error) {
    console.error('Smart Port lookup failed:', error);
    setSmartPortLookupStatus(`Unable to check Port Houston: ${error.message}`);
  } finally {
    setSmartPortLookupLoading(false);
  }
};

const handleCheckPortHouston = async (load) => {
  if (!load?.id) return;

  setPortHoustonCheckingLoadId(load.id);
  setPortHoustonChecksByLoad((prev) => ({
    ...prev,
    [load.id]: { loading: true, error: '', result: prev[load.id]?.result || null },
  }));

  try {
    const res = await fetch(`${API_BASE}/api/loads/${encodeURIComponent(load.id)}/port-houston-check`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const diagnosticText = data.diagnostics
        ? ` Using client ID ${data.diagnostics.clientId || 'missing'} from ${data.diagnostics.clientIdSource || 'unknown source'}; secret from ${data.diagnostics.clientSecretSource || 'unknown source'} (${data.diagnostics.clientSecretLength || 0} characters).${data.diagnostics.authMethodsTried ? ` Auth methods tried: ${data.diagnostics.authMethodsTried}.` : ''}${data.diagnostics.authAttempts?.length ? ` Auth responses: ${data.diagnostics.authAttempts.map((attempt) => `${attempt.method} ${attempt.status}`).join(', ')}.` : ''}`
        : '';
      throw new Error(`${data.error || 'Failed to check Port Houston'}${diagnosticText}`);
    }

    setPortHoustonChecksByLoad((prev) => ({
      ...prev,
      [load.id]: { loading: false, error: '', result: data },
    }));
    if (data.updatedLoad) {
      setLoadsData((prev) =>
        prev.map((item) => (item.id === data.updatedLoad.id ? data.updatedLoad : item))
      );
      setSelectedLoad((prev) =>
        prev?.id === data.updatedLoad.id ? data.updatedLoad : prev
      );
      setEditingLoad((prev) =>
        prev?.id === data.updatedLoad.id ? data.updatedLoad : prev
      );
    }
    await fetchSelectedLoadAuditLogs(load.id);
  } catch (error) {
    setPortHoustonChecksByLoad((prev) => ({
      ...prev,
      [load.id]: { loading: false, error: error.message, result: prev[load.id]?.result || null },
    }));
  } finally {
    setPortHoustonCheckingLoadId('');
  }
};

const handleSettlementPayChange = (loadId, field, value) => {
  setSettlementPayDrafts((prev) => ({
    ...prev,
    [loadId]: {
      ...(prev[loadId] || {}),
      [field]: value,
    },
  }));
  setSettlementPayStatus('');
};

const handleSettlementDeductionDetailChange = (loadId, value) => {
  setSettlementDeductionDetails((prev) => ({
    ...prev,
    [loadId]: value,
  }));
  setSettlementPayStatus('');
};

const handleSettlementCalculatorInputChange = (field, value) => {
  setSettlementCalculatorInputs((prev) => ({
    ...prev,
    [field]: value,
  }));
  setSettlementPayStatus('');
};

const handleSaveDeductionReason = () => {
  const reason = settlementDeductionReasonInput.trim();
  if (!reason) return;

  setSavedDeductionReasons((prev) => {
    if (prev.some((item) => item.toLowerCase() === reason.toLowerCase())) return prev;
    return [...prev, reason].sort((a, b) => a.localeCompare(b));
  });
  setSettlementDeductionReasonInput('');
  setSettlementPayStatus(`Deduction reason saved: ${reason}`);
};

const getSettlementDeductionDetail = (load) =>
  settlementDeductionDetails[load.id] || '';

const handleAddManualSettlementLoad = async (loadId) => {
  const load = loadsData.find((item) => item.id === loadId);
  if (!load) return;

  const currentPay = getSettlementPayValue(load, 'driverRate');
  const enteredPay = window.prompt(
    `Driver pay for ${load.containerNumber || load.id}`,
    currentPay
  );
  if (enteredPay === null) return;
  const outsidePeriod = isLoadOutsideSettlementPeriod(load);
  const priorSettlementLine = getBackendSettlementLineForLoad(load.id);
  const originalLoadDriver = getDriverLabel(load.driver);
  const settlementDriverLabel = getDriverLabel(activeSettlementDriverId);
  const isCrossDriverAdjustment =
    normalizeDriverForStorage(load.driver) !== normalizeDriverForStorage(activeSettlementDriverId);
  const backendSettlement = await ensureBackendSettlement();
  if (!backendSettlement?.id) return;

  try {
    const res = await fetch(`${API_BASE}/api/driver-settlements/${backendSettlement.id}/loads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        loadId,
        payAmount: enteredPay,
        movesCount: load.movesCount || 1,
        description: [
          outsidePeriod ? 'Outside-period load' : 'Manual load add',
          isCrossDriverAdjustment ? `cross-driver adjustment from ${originalLoadDriver || 'unassigned driver'} to ${settlementDriverLabel}` : '',
          priorSettlementLine ? 'already listed in this settlement statement' : '',
          `appointment ${formatAppointmentTime(load.appointmentTime) || 'not set'}`,
        ].filter(Boolean).join(' - '),
        source: isCrossDriverAdjustment ? 'cross_driver' : outsidePeriod ? 'outside_period' : 'manual',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to add load to settlement');
    }
    setActiveBackendSettlement(data);
  } catch (error) {
    console.error('Failed to add backend settlement load:', error);
    setSettlementBackendStatus(`Failed to save extra load: ${error.message}`);
    return;
  }

  setSettlementManualLoadIds((prev) => {
    const existing = prev[settlementManualLoadKey] || [];
    if (existing.includes(loadId)) return prev;
    return {
      ...prev,
      [settlementManualLoadKey]: [...existing, loadId],
    };
  });
  setSelectedSettlementLoadId(loadId);
  setSettlementPayDrafts((prev) => ({
    ...prev,
    [loadId]: {
      ...(prev[loadId] || {}),
      driverRate: enteredPay,
    },
  }));
  setSettlementManualLoadSearch('');
  setSettlementPayStatus(`Added ${load.containerNumber || load.id} to this settlement.`);
  setSettlementBackendStatus(`Saved ${load.containerNumber || load.id} to the database settlement.`);
};

const handleRemoveManualSettlementLoad = async (loadId) => {
  const load = loadsData.find((item) => item.id === loadId);
  const backendLine = activeBackendSettlement?.statement?.loads?.find(
    (item) => item.loadId === loadId && ['manual', 'outside_period', 'cross_driver'].includes(item.source)
  );

  if (activeBackendSettlement?.id && backendLine?.settlementLoadId) {
    try {
      const res = await fetch(
        `${API_BASE}/api/driver-settlements/${activeBackendSettlement.id}/loads/${backendLine.settlementLoadId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove load from settlement');
      }
      setActiveBackendSettlement(data);
    } catch (error) {
      console.error('Failed to remove backend settlement load:', error);
      setSettlementBackendStatus(`Failed to remove extra load: ${error.message}`);
      return;
    }
  }

  setSettlementManualLoadIds((prev) => ({
    ...prev,
    [settlementManualLoadKey]: (prev[settlementManualLoadKey] || []).filter((id) => id !== loadId),
  }));
  setSelectedSettlementLoadId((current) => (current === loadId ? '' : current));
  setSettlementPayStatus(`Removed ${load?.containerNumber || loadId} from this settlement.`);
  setSettlementBackendStatus(`Removed ${load?.containerNumber || loadId} from the database settlement.`);
};

const handleCustomDeductionDraftChange = (field, value) => {
  setSettlementCustomDeductionDraft((prev) => ({
    ...prev,
    [field]: value,
  }));
  setSettlementPayStatus('');
};

const handleAddSettlementCustomDeduction = async () => {
  const name = settlementCustomDeductionDraft.name.trim();
  const description = settlementCustomDeductionDraft.description.trim();
  const type = settlementCustomDeductionDraft.type || 'fixed';
  const amount = settlementCustomDeductionDraft.amount.trim();

  if (!name || !amount) {
    setSettlementPayStatus(`Add a deduction name and ${type === 'percent' ? 'percent' : 'amount'} first.`);
    return;
  }

  const numericAmount = parseMoney(amount);
  if (numericAmount <= 0) {
    setSettlementPayStatus(`Enter a ${type === 'percent' ? 'percent' : 'deduction amount'} greater than 0.`);
    return;
  }

  const deductionAmount =
    type === 'percent'
      ? settlementTripPayTotalNumber * (numericAmount / 100)
      : numericAmount;

  const backendSettlement = await ensureBackendSettlement();
  if (!backendSettlement?.id) return;

  try {
    const res = await fetch(`${API_BASE}/api/driver-settlements/${backendSettlement.id}/deductions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        description: [name, description].filter(Boolean).join(' - '),
        amount: -Math.abs(deductionAmount),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to add deduction');
    }
    setActiveBackendSettlement(data);
  } catch (error) {
    console.error('Failed to add backend deduction:', error);
    setSettlementBackendStatus(`Failed to save deduction: ${error.message}`);
    return;
  }

  setSettlementCustomDeductions((prev) => ({
    ...prev,
    [settlementCustomDeductionKey]: [
      ...(prev[settlementCustomDeductionKey] || []),
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        description,
        type,
        percent: type === 'percent' ? amount : '',
        amount: type === 'percent' ? formatMoney(deductionAmount) : amount,
      },
    ],
  }));

  setSavedDeductionReasons((prev) => {
    if (prev.some((item) => item.toLowerCase() === name.toLowerCase())) return prev;
    return [...prev, name].sort((a, b) => a.localeCompare(b));
  });

  setSettlementCustomDeductionDraft({ name: '', description: '', type: 'fixed', amount: '' });
  setSettlementPayStatus(`Custom deduction added: ${name}`);
  setSettlementBackendStatus(`Saved deduction to the database settlement: ${name}`);
};

const handleRemoveSettlementCustomDeduction = (deductionId) => {
  setSettlementCustomDeductions((prev) => ({
    ...prev,
    [settlementCustomDeductionKey]: (prev[settlementCustomDeductionKey] || []).filter(
      (item) => item.id !== deductionId
    ),
  }));
  setSettlementPayStatus('Custom deduction removed.');
};

const handleBackendDeductionDraftChange = (field, value) => {
  setBackendDeductionDraft((prev) => ({
    ...prev,
    [field]: value,
  }));
  setSettlementBackendStatus('');
};

const resetBackendDeductionDraft = () => {
  setEditingBackendDeductionId('');
  setBackendDeductionDraft({ kind: 'deduction', calculationType: 'flat', description: '', amount: '' });
};

const handleRemoveSavedBackendDeductionReason = () => {
  const targetReason = backendDeductionDraft.description.trim();
  if (!targetReason) {
    setSettlementBackendStatus('Select or type a saved description to remove.');
    return;
  }

  setSavedDeductionReasons((prev) =>
    prev.filter((reason) => reason.trim().toLowerCase() !== targetReason.toLowerCase())
  );
  setBackendDeductionDraft((prev) => ({
    ...prev,
    description: prev.description.trim().toLowerCase() === targetReason.toLowerCase() ? '' : prev.description,
  }));
  setSettlementBackendStatus(`Removed saved description: ${targetReason}`);
};

const handleEditBackendDeduction = (item) => {
  if (!item?.id) return;

  const amount = Math.abs(parseMoney(item.amount));
  setEditingBackendDeductionId(item.id);
  setBackendDeductionDraft({
    kind: parseMoney(item.amount) < 0 ? 'deduction' : 'reimbursement',
    calculationType: 'flat',
    description: item.description || '',
    amount: amount ? amount.toFixed(2) : '',
  });
  setSettlementBackendStatus('Editing database deduction. Save adjustment when ready.');
};

const handleCancelBackendDeductionEdit = () => {
  resetBackendDeductionDraft();
  setSettlementBackendStatus('Deduction edit canceled.');
};

const resetBackendNetDeductionDraft = () => {
  setBackendNetDeductionDraft({
    description: '',
    amount: '',
  });
  setEditingBackendNetDeductionId('');
};

const handleBackendNetDeductionDraftChange = (field, value) => {
  setBackendNetDeductionDraft((prev) => ({
    ...prev,
    [field]: value,
  }));
  setSettlementBackendStatus('');
};

const handleEditBackendNetDeduction = (item) => {
  if (!item?.id) return;

  setEditingBackendNetDeductionId(item.id);
  setBackendNetDeductionDraft({
    description: item.description || '',
    amount: Math.abs(parseMoney(item.amount)).toFixed(2),
  });
  setSettlementBackendStatus('Editing net deduction. Save when ready.');
};

const handleCancelBackendNetDeductionEdit = () => {
  resetBackendNetDeductionDraft();
  setSettlementBackendStatus('Net deduction edit canceled.');
};

const handleAddBackendNetDeduction = async () => {
  const description = backendNetDeductionDraft.description.trim();
  const amount = Math.abs(parseMoney(backendNetDeductionDraft.amount));

  if (!description || !backendNetDeductionDraft.amount.trim()) {
    setSettlementBackendStatus('Add a net deduction description and amount first.');
    return;
  }

  if (!amount) {
    setSettlementBackendStatus('Enter a net deduction amount greater than 0.');
    return;
  }

  const backendSettlement = await ensureBackendSettlement();
  if (!backendSettlement?.id) return;

  const isEditing = Boolean(editingBackendNetDeductionId);
  setSettlementBackendLoading(true);
  try {
    const res = await fetch(`${API_BASE}/api/driver-settlements/${backendSettlement.id}/deductions${isEditing ? `/${editingBackendNetDeductionId}` : ''}`, {
      method: isEditing ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        description,
        amount: -amount,
        stage: 'net_deduction',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save net deduction');
    }

    setActiveBackendSettlement(data);
    resetBackendNetDeductionDraft();
    setSettlementBackendStatus(`Net deduction ${isEditing ? 'updated' : 'saved'} after net pay.`);
  } catch (error) {
    console.error('Failed to save net deduction:', error);
    setSettlementBackendStatus(`Failed to save net deduction: ${error.message}`);
  } finally {
    setSettlementBackendLoading(false);
  }
};

const handleAddBackendDeduction = async () => {
  const kind = backendDeductionDraft.kind === 'reimbursement' ? 'reimbursement' : 'deduction';
  const calculationType = backendDeductionDraft.calculationType === 'percent' ? 'percent' : 'flat';
  const description = backendDeductionDraft.description.trim();
  const rawAmount = Math.abs(parseMoney(backendDeductionDraft.amount));

  if (!description || !backendDeductionDraft.amount.trim()) {
    setSettlementBackendStatus('Add a description and amount first.');
    return;
  }

  if (!rawAmount) {
    setSettlementBackendStatus(`Enter a ${calculationType === 'percent' ? 'percent' : 'amount'} greater than 0.`);
    return;
  }

  const grossPay = parseMoney(activeBackendSettlement?.statement?.totals?.grossPay || 0);
  if (calculationType === 'percent' && !grossPay) {
    setSettlementBackendStatus('This settlement needs gross pay before a percent deduction can be calculated.');
    return;
  }

  const amount = calculationType === 'percent' ? grossPay * (rawAmount / 100) : rawAmount;
  const signedAmount = kind === 'deduction' ? -amount : amount;
  const savedDescription =
    calculationType === 'percent'
      ? `${description} (${rawAmount}% of gross pay ${formatMoney(grossPay)})`
      : description;
  const backendSettlement = await ensureBackendSettlement();
  if (!backendSettlement?.id) return;

  const isEditing = Boolean(editingBackendDeductionId);
  setSettlementBackendLoading(true);
  try {
    const res = await fetch(`${API_BASE}/api/driver-settlements/${backendSettlement.id}/deductions${isEditing ? `/${editingBackendDeductionId}` : ''}`, {
      method: isEditing ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        description: savedDescription,
        amount: signedAmount,
        stage: 'gross_adjustment',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to add deduction');
    }

    setActiveBackendSettlement(data);
    resetBackendDeductionDraft();
    setSettlementBackendStatus(
      `${kind === 'deduction' ? 'Deduction' : 'Add pay / reimbursement'} ${isEditing ? 'updated' : 'saved'} to the database settlement.`
    );
  } catch (error) {
    console.error('Failed to save database deduction:', error);
    setSettlementBackendStatus(`Failed to save deduction: ${error.message}`);
  } finally {
    setSettlementBackendLoading(false);
  }
};

const handleRemoveBackendDeduction = async (deductionId) => {
  if (!activeBackendSettlement?.id || !deductionId) return;

  setSettlementBackendLoading(true);
  try {
    const res = await fetch(
      `${API_BASE}/api/driver-settlements/${activeBackendSettlement.id}/deductions/${deductionId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to remove deduction');
    }

    setActiveBackendSettlement(data);
    setSettlementBackendStatus('Database deduction removed.');
  } catch (error) {
    console.error('Failed to remove database deduction:', error);
    setSettlementBackendStatus(`Failed to remove deduction: ${error.message}`);
  } finally {
    setSettlementBackendLoading(false);
  }
};

const handleSettlementLoadSelect = (loadId) => {
  setSelectedSettlementLoadId(loadId);
  setSettlementPayStatus('');
};

const handleResetSettlementPayDraft = (loadId) => {
  setSettlementPayDrafts((prev) => {
    const next = { ...prev };
    delete next[loadId];
    return next;
  });
  setSettlementPayStatus('');
};

const handleSaveSettlementPay = async (load) => {
  const draft = settlementPayDrafts[load.id] || {};
  const updatedLoad = {
    ...load,
    driverRate: draft.driverRate ?? load.driverRate ?? '$0.00',
    detention: draft.detention ?? load.detention ?? '$0.00',
    lumper: draft.lumper ?? load.lumper ?? '$0.00',
    fuelAdvance: draft.fuelAdvance ?? load.fuelAdvance ?? '$0.00',
  };

  updatedLoad.settlement = calculateLoadSettlement({
    driverRate: updatedLoad.driverRate,
    detention: updatedLoad.detention,
    lumper: updatedLoad.lumper,
    fuelAdvance: updatedLoad.fuelAdvance,
  });

  try {
    const payload = {
      ...updatedLoad,
      driver: normalizeDriverForStorage(updatedLoad.driver),
      truck: updatedLoad.driver ? getDriverTruck(updatedLoad.driver) : '',
      droppedBy: normalizeDriverForStorage(updatedLoad.droppedBy),
      paperwork: getPaperworkStatusFromDocuments(updatedLoad.documents || []),
    };

    const res = await fetch(`${API_BASE}/api/loads/${load.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.details || data.error || 'Failed to update load pay');
    }

    setLoadsData((prev) =>
      prev.map((currentLoad) => (currentLoad.id === data.id ? data : currentLoad))
    );
    setSelectedLoad((prev) => (prev?.id === data.id ? data : prev));
    setEditingLoad((prev) => (prev?.id === data.id ? data : prev));

    let backendSettlementForPay = activeBackendSettlement;
    if (!backendSettlementForPay?.id && activeSettlementDriverId) {
      backendSettlementForPay = await ensureBackendSettlement();
    }

    if (backendSettlementForPay?.id) {
      const backendLine = backendSettlementForPay.statement?.loads?.find((line) => line.loadId === data.id);
      const settlementPayload = {
        loadId: data.id,
        payAmount: updatedLoad.driverRate,
        movesCount: updatedLoad.movesCount || data.movesCount || 1,
        description: backendLine?.description || 'Updated from settlement sheet',
        source: backendLine?.source || 'manual',
      };
      const settlementUrl = backendLine?.settlementLoadId
        ? `${API_BASE}/api/driver-settlements/${backendSettlementForPay.id}/loads/${backendLine.settlementLoadId}`
        : `${API_BASE}/api/driver-settlements/${backendSettlementForPay.id}/loads`;
      const settlementRes = await fetch(settlementUrl, {
        method: backendLine?.settlementLoadId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(settlementPayload),
      });
      const settlementData = await settlementRes.json();
      if (!settlementRes.ok) {
        throw new Error(settlementData.error || 'Load saved, but database statement pay did not update');
      }
      setActiveBackendSettlement(settlementData);
      setSettlementBackendStatus(`Database settlement updated for ${data.containerNumber || data.id}.`);
    }

    handleResetSettlementPayDraft(load.id);
    setSettlementPayStatus(`Load pay saved for ${data.id} and synced to the database statement.`);
  } catch (error) {
    console.error('Failed to update load pay:', error);
    setSettlementPayStatus(`Failed to save load pay: ${error.message}`);
  }
};

const handleDeleteLoad = async () => {
  if (!selectedLoad) return;

  const confirmDelete = window.confirm(
    `Are you sure you want to delete load ${selectedLoad.id}?`
  );
  if (!confirmDelete) return;

  try {
    const res = await fetch(`${API_BASE}/api/loads/${selectedLoad.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete load');
    }

    await fetchLoads();
    setSelectedLoad(null);
    setIsEditing(false);
    setShowForm(false);
  } catch (error) {
    console.error('Failed to delete load:', error);
    alert(`Failed to delete load: ${error.message}`);
  }
};

const handleQuickDriverChange = async (e) => {
  if (!selectedLoad) return;

const newDriver = normalizeDriverForStorage(e.target.value);

const updatedLoad = {
  ...selectedLoad,
  driver: newDriver,
  truck: newDriver ? getDriverTruck(newDriver) : '',
  status: getStatusAfterDriverAssignment(newDriver, selectedLoad.status),
  pickup:
    selectedLoad.status === 'Dropped'
      ? getDroppedLoadPickup(selectedLoad)
      : selectedLoad.pickup,
};

  setSelectedLoad(updatedLoad);

  try {
    const res = await fetch(`${API_BASE}/api/loads/${updatedLoad.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(updatedLoad),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to update driver');
    }

    await fetchLoads();
    await fetchSelectedLoadAuditLogs(updatedLoad.id);
  } catch (error) {
    console.error('Failed to update driver:', error);
  }
};
const handleQuickStatusChange = async (e) => {
  if (!selectedLoad) return;

 const newStatus = e.target.value;
 const isAvailabilityStatus = ['Available', 'Not Available'].includes(newStatus);

const updatedLoad = {
  ...selectedLoad,
  status: isAvailabilityStatus ? 'Dispatched' : newStatus,
  availabilityStatus: isAvailabilityStatus ? newStatus : '',
  droppedBy:
    !isAvailabilityStatus && newStatus === 'Dropped'
      ? normalizeDriverForStorage(selectedLoad.driver)
      : selectedLoad.droppedBy || '',
  dropDateTime:
    !isAvailabilityStatus && newStatus === 'Dropped'
      ? new Date().toISOString()
      : selectedLoad.dropDateTime || '',
};

  setSelectedLoad(updatedLoad);
  if (!isAvailabilityStatus && newStatus === 'Dropped') {
    setDropDetailsDraft(buildDropDetailsDraft(updatedLoad));
  }

  try {
    const res = await fetch(`${API_BASE}/api/loads/${updatedLoad.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(updatedLoad),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to update status');
    }

    const data = await res.json();
    setLoadsData((prevLoads) =>
      prevLoads.map((load) => (load.id === data.id ? data : load))
    );
    setSelectedLoad(data);
    setEditingLoad((prev) => (prev?.id === data.id ? data : prev));
    await fetchSelectedLoadAuditLogs(data.id);
  } catch (error) {
    console.error('Failed to update status:', error);
  }
};

const handleSaveDropDetails = async () => {
  if (!selectedLoad?.id) return;
  if (!String(dropDetailsDraft.dropLocation || '').trim()) {
    alert('Please select where the container was dropped.');
    return;
  }

  const updatedLoad = {
    ...selectedLoad,
    status: 'Dropped',
    availabilityStatus: '',
    dropType: dropDetailsDraft.dropType || selectedLoad.dropType || '',
    dropLocation: dropDetailsDraft.dropLocation || '',
    nextMoveType: dropDetailsDraft.nextMoveType || selectedLoad.nextMoveType || 'Delivery',
    droppedBy:
      normalizeDriverForStorage(dropDetailsDraft.droppedBy) ||
      normalizeDriverForStorage(selectedLoad.driver),
    dropDateTime: dropDetailsDraft.dropDateTime || new Date().toISOString(),
  };

  try {
    const res = await fetch(`${API_BASE}/api/loads/${updatedLoad.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(updatedLoad),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to save drop details');
    }

    const data = await res.json();
    setSelectedLoad(data);
    setDropDetailsDraft(buildDropDetailsDraft(data));
    setLoadsData((prevLoads) =>
      prevLoads.map((load) => (load.id === data.id ? data : load))
    );
    await fetchLoads();
    await fetchSelectedLoadAuditLogs(data.id);
    alert('Drop details saved.');
  } catch (error) {
    console.error('Failed to save drop details:', error);
    alert(`Failed to save drop details: ${error.message}`);
  }
};

const getDroppedLoadPickup = (load = {}) =>
  String(load.dropLocation || '').trim() ||
  (String(load.dropType || '').toLowerCase().includes('customer')
    ? load.delivery
    : load.returnLocation) ||
  load.pickup ||
  '';

const handleReopenDroppedLoad = async () => {
  if (!selectedLoad?.id) return;

  const nextDriver = normalizeDriverForStorage(dropDetailsDraft.nextDriver || selectedLoad.driver);
  if (!nextDriver) {
    alert('Please assign a driver before reopening this load.');
    return;
  }

  const dropLoadForPickup = {
    ...selectedLoad,
    dropType: dropDetailsDraft.dropType || selectedLoad.dropType,
    dropLocation: dropDetailsDraft.dropLocation || selectedLoad.dropLocation,
    nextMoveType: dropDetailsDraft.nextMoveType || selectedLoad.nextMoveType || 'Delivery',
  };
  const droppedPickup = getDroppedLoadPickup(dropLoadForPickup);
  if (!String(droppedPickup || '').trim()) {
    alert('Please select the drop location before reopening this load.');
    return;
  }

  const updatedLoad = {
    ...selectedLoad,
    status: 'Dispatched',
    availabilityStatus: '',
    driver: nextDriver,
    truck: getDriverTruck(nextDriver),
    pickup: droppedPickup,
    nextMoveType: dropDetailsDraft.nextMoveType || selectedLoad.nextMoveType || 'Delivery',
    dropType: dropDetailsDraft.dropType || selectedLoad.dropType || '',
    dropLocation: dropDetailsDraft.dropLocation || selectedLoad.dropLocation || '',
    droppedBy:
      normalizeDriverForStorage(dropDetailsDraft.droppedBy) ||
      normalizeDriverForStorage(selectedLoad.droppedBy) ||
      normalizeDriverForStorage(selectedLoad.driver),
    dropDateTime: dropDetailsDraft.dropDateTime || selectedLoad.dropDateTime || new Date().toISOString(),
  };

  try {
    const res = await fetch(`${API_BASE}/api/loads/${updatedLoad.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(updatedLoad),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Failed to reopen load');
    }

    setLoadsData((prevLoads) =>
      prevLoads.map((load) => (load.id === data.id ? data : load))
    );
    setSelectedLoad(data);
    setDropDetailsDraft(buildDropDetailsDraft(data));
    setEditingLoad((prev) => (prev?.id === data.id ? data : prev));
    await fetchLoads();
    await fetchSelectedLoadAuditLogs(data.id);
    alert('Load reopened and assigned to driver.');
  } catch (error) {
    console.error('Failed to reopen dropped load:', error);
    alert(`Failed to reopen load: ${error.message}`);
  }
};

const handleGenerateCustomerPdf = async (loadForPacket) => {
  if (!loadForPacket?.id) return;

  try {
    const sanitizePdfDownloadName = (value, fallback = 'customer-packet') => {
      const safe = String(value || fallback)
        .trim()
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/^-+|-+$/g, '');
      return safe || fallback;
    };
    const savedInvoiceNumber =
      savedInvoices.find((invoice) => invoice.loadId === loadForPacket.id)?.invoiceNumber || '';
    const res = await fetch(
      `${API_BASE}/api/loads/${loadForPacket.id}/customer-packet`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to generate PDF');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const disposition = res.headers.get('Content-Disposition') || '';
    const headerFilename =
      disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] || '';
    const filenameBase = sanitizePdfDownloadName(
      decodeURIComponent(headerFilename || '').replace(/\.pdf$/i, '') ||
        savedInvoiceNumber ||
        loadForPacket.invoiceNumber ||
        loadForPacket.id,
      loadForPacket.id
    );

    const link = document.createElement('a');
    link.href = url;
    link.download = `${filenameBase}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => window.URL.revokeObjectURL(url), 5000);
  } catch (error) {
    console.error('Customer PDF error:', error);
    alert(`Failed to generate PDF: ${error.message}`);
  }
};

const handleRestoreCompletedLoad = async (loadToRestore) => {
  if (!loadToRestore?.id) return;

  const confirmRestore = window.confirm(
    `Restore load ${loadToRestore.containerNumber || loadToRestore.id} back to Dispatch?`
  );
  if (!confirmRestore) return;

  const restoredLoad = {
    ...loadToRestore,
    status: 'Dispatched',
    availabilityStatus: '',
  };

  try {
    const res = await fetch(`${API_BASE}/api/loads/${restoredLoad.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(restoredLoad),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Failed to restore load');
    }

    setLoadsData((prevLoads) =>
      prevLoads.map((load) => (load.id === data.id ? data : load))
    );
    setSelectedAccountingLoadId('');
    setSelectedLoad(data);
    setEditingLoad(data);
    await fetchLoads();
    alert('Load restored to Dispatch.');
  } catch (error) {
    console.error('Failed to restore completed load:', error);
    alert(`Failed to restore load: ${error.message}`);
  }
};

const handleSendCompletedLoadToAccounting = async (loadToBill) => {
  if (!loadToBill?.id) return;
  if (accountingExtraChargesOpenLoadId === loadToBill.id) {
    alert('Please save or close customer extra charges before sending this load to Accounting.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/loads/${encodeURIComponent(loadToBill.id)}/billing-status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ billingStatus: 'Ready To Bill' }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Failed to send load to accounting');
    }

    setLoadsData((prevLoads) =>
      prevLoads.map((load) => (load.id === data.id ? { ...load, ...data } : load))
    );
    setSelectedLoad((prev) => (prev?.id === data.id ? { ...prev, ...data } : prev));
    setAccountingSearchTerm('');
    setSelectedAccountingLoadId(data.id);
    setActiveView('accounting');
  } catch (error) {
    console.error('Failed to send completed load to accounting:', error);
    alert(`Failed to send to accounting: ${error.message}`);
  }
};

const uploadDocumentsForLoad = async (loadId, files, category) => {
  if (!loadId || !files.length) return null;

  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  formData.append('category', category || 'Other');

  const res = await fetch(`${API_BASE}/api/loads/${loadId}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    body: formData,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Failed to upload documents');
  }

  return data;
};

const handleDocumentUpload = async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length || !selectedLoad) return;

  try {
    await uploadDocumentsForLoad(selectedLoad.id, files, selectedDocumentType || 'Other');
    await fetchLoads();
    await fetchSelectedLoadAuditLogs(selectedLoad.id);

    
  } catch (error) {
    console.error('Document upload error:', error);
    alert(`Failed to upload documents: ${error.message}`);
  } finally {
    e.target.value = '';
  }
};

const handleAccountingDocumentUpload = async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length || !selectedAccountingLoad) return;

  try {
    await uploadDocumentsForLoad(
      selectedAccountingLoad.id,
      files,
      selectedAccountingDocumentType || 'Other'
    );
    setSelectedAccountingLoadId(selectedAccountingLoad.id);
    await fetchLoads();
  } catch (error) {
    console.error('Billing document upload error:', error);
    alert(`Failed to upload billing documents: ${error.message}`);
  } finally {
    e.target.value = '';
  }
};

  const handleDeleteDocument = async (docId) => {
    try {
      await fetch(`${API_BASE}/api/documents/${docId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      await fetchLoads();
    } catch (error) {
      console.error('Failed to delete document:', error);
    }
  };

  const handleDocumentCategoryChange = async (docId, newCategory) => {
    try {
      await fetch(`${API_BASE}/api/documents/${docId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ category: newCategory }),
      });
      await fetchLoads();
    } catch (error) {
      console.error('Failed to update document category:', error);
    }
  };

const handleOpenDocument = async (doc) => {
  if (!doc) return;

  const openedWindow = window.open('', '_blank');
  if (openedWindow) {
    openedWindow.document.write('<p style="font-family: Arial, sans-serif; padding: 16px;">Opening document...</p>');
  }

  try {
    const fileUrl = getDocumentUrl(doc);

    const res = await fetch(fileUrl, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to open document');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    if (openedWindow) {
      openedWindow.location.href = url;
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
      return;
    }

    setPreviewDocument(doc);
    setPreviewUrl(url);
  } catch (error) {
    console.error('Open document error:', error);
    if (openedWindow && !openedWindow.closed) {
      openedWindow.close();
    }
    alert(`Failed to open document: ${error.message}`);
  }
};

const handleClosePreview = () => {
  if (previewUrl) {
    window.URL.revokeObjectURL(previewUrl);
  }
  setPreviewUrl('');
  setPreviewDocument(null);
};

const handleDownloadDocument = async (doc) => {
  if (!doc) return;

  try {
    const fileUrl = getDocumentUrl(doc);

    const res = await fetch(fileUrl, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to download document');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => window.URL.revokeObjectURL(url), 5000);
  } catch (error) {
    console.error('Download document error:', error);
    alert(`Failed to download document: ${error.message}`);
  }
};
const handleCustomerFormChange = (e) => {
  const { name, value } = e.target;
  setCustomerForm((prev) => ({ ...prev, [name]: value }));
};

const handleSaveCustomer = async (e) => {
  if (e) e.preventDefault();
  const isCreatingCustomer = !editingCustomerId;
  const savedCustomerName = customerForm.name || '';

  const payload = {
    ...customerForm,
    id: editingCustomerId || `CUS-${Date.now()}`,
  };

  try {
    const res = await fetch(
      editingCustomerId
        ? `${API_BASE}/api/customers/${editingCustomerId}`
        : `${API_BASE}/api/customers`,
      {
        method: editingCustomerId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save customer');
    }

    await fetchCustomers();
    if (isCreatingCustomer && savedCustomerName) {
      setNewLoad((prev) => ({ ...prev, customer: savedCustomerName }));
    }
    setCustomerForm(emptyCustomer);
    setEditingCustomerId(null);
    setShowCustomerEditor(false);
  } catch (error) {
    console.error('Failed to save customer:', error);
    alert(`Failed to save customer: ${error.message}`);
  }
};
  const handleEditCustomer = (customer) => {
    setCustomerForm(customer);
    setEditingCustomerId(customer.id);
  };

const handleDeleteCustomer = async (customerId) => {
  const confirmDelete = window.confirm('Delete this customer?');
  if (!confirmDelete) return;

  try {
    const res = await fetch(`${API_BASE}/api/customers/${customerId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete customer');
    }

    await fetchCustomers();

    if (editingCustomerId === customerId) {
      setCustomerForm(emptyCustomer);
      setEditingCustomerId(null);
    }
  } catch (error) {
    console.error('Failed to delete customer:', error);
    alert(`Failed to delete customer: ${error.message}`);
  }
};
const handleSaveDriver = async (e) => {
  if (e) e.preventDefault();

  try {
    const res = await fetch(`${API_BASE}/api/drivers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(driverForm),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to create driver');
    }

    if (data.driver) {
      setDriversList((prev) => {
        const withoutDuplicate = prev.filter((driver) => driver.id !== data.driver.id);
        return [...withoutDuplicate, data.driver].sort((a, b) =>
          String(a.name || '').localeCompare(String(b.name || ''))
        );
      });
    }

    alert('Driver created successfully');
    await fetchDrivers();
    await fetchAllUsers();

    setDriverForm({
      id: '',
      name: '',
      email: '',
      password: '',
      phone: '',
      truck: '',
      isActive: true,
    });
  } catch (error) {
    console.error('Failed to save driver:', error);
    alert(`Failed to save driver: ${error.message}`);
  }
};

const handleSaveStaffUser = async (e) => {
  if (e) e.preventDefault();

  try {
    const res = await fetch(`${API_BASE}/api/staff-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(staffForm),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to create staff user');
    }

    alert('Team member created successfully');
    await fetchAllUsers();
    setStaffForm(emptyStaffForm);
  } catch (error) {
    console.error('Failed to save staff user:', error);
    alert(`Failed to save staff user: ${error.message}`);
  }
};

const handleToggleUserStatus = async (userId, nextStatus) => {
  try {
    const res = await fetch(`${API_BASE}/api/users/${userId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ isActive: nextStatus }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to update user status');
    }

    await fetchAllUsers();
    await fetchDrivers();
  } catch (error) {
    console.error('Failed to update user status:', error);
    alert(`Failed to update user status: ${error.message}`);
  }
};

const handleChangeUserRole = async (userId, newRole) => {
  try {
    const res = await fetch(`${API_BASE}/api/users/${userId}/role`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ role: newRole }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to update role');
    }

    await fetchAllUsers();
    await fetchDrivers();
  } catch (error) {
    console.error('Failed to update role:', error);
    alert(`Failed to update role: ${error.message}`);
  }
};
  const handleExportSettlementCsv = () => {
    const rows = visibleSettlementLoads.map((load) => ({
      Type: 'Load',
      Driver: activeSettlementDriver
        ? `${activeSettlementDriver.id} - ${activeSettlementDriver.name}`
        : getDriverLabel(load.driver),
      Period: settlementPeriodLabel,
      Date: load.loadDate || '',
      Load: load.id,
      Customer: load.customer || '',
      Container: load.containerNumber || '',
      Reference: load.referenceNumber || load.bookingNumber || '',
      LoadPay: getSettlementPayValue(load, 'driverRate'),
      Detention: getSettlementPayValue(load, 'detention'),
      Lumper: getSettlementPayValue(load, 'lumper'),
      Deductions: getSettlementPayValue(load, 'fuelAdvance'),
      DeductionReason: getSettlementDeductionDetail(load),
      NetSettlement: getSettlementPayTotal(load),
      Note: settlementNote,
    }));

    const customDeductionRows = currentSettlementCustomDeductions.map((item) => ({
      Type: 'Custom Deduction',
      Driver: activeSettlementDriver
        ? `${activeSettlementDriver.id} - ${activeSettlementDriver.name}`
        : '',
      Period: settlementPeriodLabel,
      Date: '',
      Load: '',
      Customer: '',
      Container: '',
      Reference: '',
      LoadPay: '',
      Detention: '',
      Lumper: '',
      Deductions: getSettlementCustomDeductionAmount(item),
      DeductionReason: item.name,
      DeductionDescription: [getSettlementCustomDeductionLabel(item), item.description]
        .filter(Boolean)
        .join(' - '),
      NetSettlement: '',
      Note: settlementNote,
    }));

    const settlementSummaryRows = [
      ['Line Haul', formatMoney(settlementStatementSummary.revenueSummary.lineHaul)],
      ['Pre-pulls', settlementTotals.prePulls],
      ['Stop-offs', settlementTotals.stopOffs],
      ['Total Gross Revenue', settlementTotals.grossPay],
      ['Dispatch Fee', settlementTotals.dispatchFee],
      ['Insurance', settlementTotals.insurance],
      ['Fuel', settlementTotals.fuel],
      ['Shared Deductions', settlementTotals.sharedDeductions],
      ['Splittable Revenue', settlementTotals.splitAmount],
      ['Base Driver Pay', settlementTotals.driverShare],
      ['Detention Pay', settlementTotals.totalDetention],
      ['Parking', settlementTotals.parking],
      ['Loan Repayment', settlementTotals.loanRepayment],
      ['Occupational Accident', settlementTotals.occupationalAccident],
      ['Other Personal Deductions', settlementTotals.otherPersonalDeductions],
      ['Final Take Home Pay', settlementTotals.finalPayCheck],
    ].map(([label, amount]) => ({
      Type: 'Settlement Summary',
      Driver: activeSettlementDriver
        ? `${activeSettlementDriver.id} - ${activeSettlementDriver.name}`
        : '',
      Period: settlementPeriodLabel,
      Date: '',
      Load: '',
      Customer: '',
      Container: '',
      Reference: label,
      LoadPay: '',
      Detention: '',
      Lumper: '',
      Deductions: '',
      DeductionReason: '',
      DeductionDescription: '',
      NetSettlement: amount,
      Note: settlementNote,
    }));

    const exportRows = [...settlementSummaryRows, ...rows, ...customDeductionRows];

    const headers = Object.keys(exportRows[0] || {
      Type: '',
      Driver: '',
      Period: '',
      Date: '',
      Load: '',
      Customer: '',
      Container: '',
      Reference: '',
      LoadPay: '',
      Detention: '',
      Lumper: '',
      Deductions: '',
      DeductionReason: '',
      DeductionDescription: '',
      NetSettlement: '',
      Note: '',
    });

    const csv = [
      headers.join(','),
      ...exportRows.map((row) =>
        headers
          .map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const driverSlug = (activeSettlementDriver?.name || 'driver')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const periodSlug = `${settlementStartDate || 'all'}-${settlementEndDate || 'dates'}`;
    link.download = `driver-settlement-${driverSlug}-${periodSlug}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrintSettlementReport = () => {
    const periodLabel = settlementPeriodLabel;
    const settlementCompanyName = company?.settlementCompanyName || company?.invoiceName || company?.name || 'Company';
    const escapeSettlementHtml = (value) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const rowsHtml = visibleSettlementLoads
      .map(
        (load) => `
          <tr>
            <td>${load.loadDate || '-'}</td>
            <td>${load.id}</td>
            <td>${load.customer || '-'}</td>
            <td>${load.containerNumber || '-'}</td>
            <td>${load.referenceNumber || load.bookingNumber || '-'}</td>
            <td>${getSettlementPayValue(load, 'driverRate')}</td>
            <td>${getSettlementPayValue(load, 'detention')}</td>
            <td>${getSettlementPayValue(load, 'lumper')}</td>
            <td>${getSettlementPayValue(load, 'fuelAdvance')}</td>
            <td>${getSettlementDeductionDetail(load) || '-'}</td>
            <td>${getSettlementPayTotal(load)}</td>
          </tr>
        `
      )
      .join('');

    const customDeductionsHtml = currentSettlementCustomDeductions
      .map(
        (item) => `
          <tr>
            <td>${item.name || '-'}</td>
            <td>${[getSettlementCustomDeductionLabel(item), item.description].filter(Boolean).join(' - ') || '-'}</td>
            <td>${getSettlementCustomDeductionAmount(item)}</td>
          </tr>
        `
      )
      .join('');

    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Driver Settlement Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
            h1 { margin: 0 0 8px; }
            p { margin: 0 0 20px; color: #4b5563; }
            .summary { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin: 18px 0; }
            .box { border: 1px solid #d1d5db; padding: 10px; border-radius: 8px; }
            .box span { display: block; color: #6b7280; font-size: 12px; margin-bottom: 4px; }
            .note { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; margin: 18px 0; white-space: pre-wrap; }
            h2 { margin: 22px 0 8px; font-size: 18px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; font-size: 14px; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          <h1>${escapeSettlementHtml(settlementCompanyName)}</h1>
          <p>Driver Settlement Report</p>
          <p>Driver: ${activeSettlementDriver ? `${activeSettlementDriver.id} - ${activeSettlementDriver.name}` : '-'}</p>
          <p>Period: ${periodLabel}</p>
          <div class="summary">
            <div class="box"><span>Loads</span><strong>${settlementTotals.loadsCount}</strong></div>
            <div class="box"><span>Total Gross Revenue</span><strong>${settlementTotals.grossPay}</strong></div>
            <div class="box"><span>Dispatch Fee</span><strong>${settlementTotals.dispatchFee}</strong></div>
            <div class="box"><span>Shared Deductions</span><strong>${settlementTotals.sharedDeductions}</strong></div>
            <div class="box"><span>Splittable Revenue</span><strong>${settlementTotals.splitAmount}</strong></div>
            <div class="box"><span>Base Driver Pay</span><strong>${settlementTotals.driverShare}</strong></div>
            <div class="box"><span>Final Take Home Pay</span><strong>${settlementTotals.finalPayCheck}</strong></div>
          </div>
          ${settlementNote ? `<div class="note"><strong>Payroll Note</strong><br>${settlementNote}</div>` : ''}
          <h2>Custom Deductions</h2>
          <table>
            <thead>
              <tr>
                <th>Deduction Name</th>
                <th>Description</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${customDeductionsHtml || '<tr><td colspan="3">No custom deductions</td></tr>'}
            </tbody>
          </table>
          <h2>Loads</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Load</th>
                <th>Customer</th>
                <th>Container</th>
                <th>Reference</th>
                <th>Load Pay</th>
                <th>Detention</th>
                <th>Lumper</th>
                <th>Deductions</th>
                <th>Deduction Reason</th>
                <th>Net Settlement</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const handleExportBackendSettlementCsv = () => {
    const statement = activeBackendSettlement?.statement;
    if (!statement) return;

    const summaryRows = [
      ['Gross Pay', statement.totals?.grossPay],
      ['Adjustments Total', statement.totals?.adjustmentsTotal],
      ['Net Before Deductions', statement.totals?.netBeforeDeductions],
      ['Net Deductions', -(statement.totals?.netDeductionsTotal || 0)],
      ['Net Pay', statement.totals?.netPay],
      ['Load Count', statement.totals?.loadCount],
    ].map(([label, amount]) => ({
      Type: 'Summary',
      Driver: `${statement.driver?.id || ''} - ${statement.driver?.name || ''}`.trim(),
      Period: `${statement.settlement?.periodStart || ''} to ${statement.settlement?.periodEnd || ''}`,
      Date: '',
      Load: '',
      Customer: '',
      Container: '',
      Reference: label,
      Miles: '',
      Source: '',
      Description: '',
      Amount: formatMoney(amount || 0),
    }));

    const loadRows = (statement.loads || []).map((line) => ({
      Type: 'Load Pay',
      Driver: `${statement.driver?.id || ''} - ${statement.driver?.name || ''}`.trim(),
      Period: `${statement.settlement?.periodStart || ''} to ${statement.settlement?.periodEnd || ''}`,
      Date: formatAppointmentTime(line.appointmentTime) || '',
      Load: line.loadId || '',
      Customer: line.customer || '',
      Container: line.containerNumber || '',
      Reference: line.referenceNumber || '',
      Miles: formatMiles(line.miles),
      Source: line.source || 'auto',
      Description: line.description || '',
      Amount: formatMoney(line.payAmount || 0),
    }));

    const deductionRows = (statement.deductions || []).map((item) => ({
      Type: parseMoney(item.amount) < 0 ? 'Deduction' : 'Reimbursement',
      Driver: `${statement.driver?.id || ''} - ${statement.driver?.name || ''}`.trim(),
      Period: `${statement.settlement?.periodStart || ''} to ${statement.settlement?.periodEnd || ''}`,
      Date: formatDateTime(item.createdAt),
      Load: '',
      Customer: '',
      Container: '',
      Reference: '',
      Miles: '',
      Source: item.addedBy || '',
      Description: item.description || '',
      Amount: formatMoney(item.amount || 0),
    }));

    const netDeductionRows = (statement.netDeductions || []).map((item) => ({
      Type: 'Net Deduction',
      Driver: `${statement.driver?.id || ''} - ${statement.driver?.name || ''}`.trim(),
      Period: `${statement.settlement?.periodStart || ''} to ${statement.settlement?.periodEnd || ''}`,
      Date: formatDateTime(item.createdAt),
      Load: '',
      Customer: '',
      Container: '',
      Reference: '',
      Miles: '',
      Source: item.addedBy || '',
      Description: item.description || '',
      Amount: formatMoney(item.amount || 0),
    }));

    const exportRows = [...summaryRows, ...loadRows, ...deductionRows, ...netDeductionRows];
    const headers = Object.keys(exportRows[0] || {
      Type: '',
      Driver: '',
      Period: '',
      Date: '',
      Load: '',
      Customer: '',
      Container: '',
      Reference: '',
      Miles: '',
      Source: '',
      Description: '',
      Amount: '',
    });

    const csv = [
      headers.join(','),
      ...exportRows.map((row) =>
        headers
          .map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const driverSlug = (statement.driver?.name || 'driver')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    link.href = url;
    link.download = `database-settlement-${driverSlug}-${statement.settlement?.periodStart || 'start'}-${statement.settlement?.periodEnd || 'end'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrintBackendSettlementReport = () => {
    const statement = activeBackendSettlement?.statement;
    if (!statement) return;
    const settlementCompanyName = company?.settlementCompanyName || company?.invoiceName || company?.name || 'Company';
    const payrollNote = activeBackendSettlement?.notes || statement.settlement?.notes || '';

    const escapeHtml = (value) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const loadsHtml = (statement.loads || [])
      .map(
        (line) => `
          <tr>
            <td>${escapeHtml(formatAppointmentTime(line.appointmentTime) || '-')}</td>
            <td>${escapeHtml(line.loadId || line.description || '-')}</td>
            <td>${escapeHtml(line.customer || '-')}</td>
            <td>${escapeHtml(line.containerNumber || '-')}</td>
            <td>${escapeHtml(line.referenceNumber || '-')}</td>
            <td>${escapeHtml(formatMiles(line.miles))}</td>
            <td>${escapeHtml(line.source || 'auto')}</td>
            <td>${escapeHtml(formatMoney(line.payAmount || 0))}</td>
          </tr>
        `
      )
      .join('');

    const adjustmentsHtml = (statement.deductions || [])
      .map(
        (item) => `
          <tr>
            <td>${parseMoney(item.amount) < 0 ? 'Deduction' : 'Reimbursement'}</td>
            <td>${escapeHtml(item.description || '-')}</td>
            <td>${escapeHtml(item.addedBy || '-')}</td>
            <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
            <td>${escapeHtml(formatMoney(item.amount || 0))}</td>
          </tr>
        `
      )
      .join('');

    const netDeductionsHtml = (statement.netDeductions || [])
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.description || '-')}</td>
            <td>${escapeHtml(item.addedBy || '-')}</td>
            <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
            <td>${escapeHtml(formatMoney(item.amount || 0))}</td>
          </tr>
        `
      )
      .join('');

    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Database Settlement Payroll Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
            h1 { margin: 0 0 8px; }
            p { margin: 0 0 10px; color: #4b5563; }
            .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
            .box { border: 1px solid #d1d5db; padding: 10px; border-radius: 8px; }
            .box span { display: block; color: #6b7280; font-size: 12px; margin-bottom: 4px; }
            .note { border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 10px; padding: 12px; margin: 18px 0; color: #1e3a8a; }
            .note strong { display: block; margin-bottom: 6px; color: #1e40af; }
            h2 { margin: 22px 0 8px; font-size: 18px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; font-size: 13px; }
            th { background: #f3f4f6; }
            .net { font-size: 18px; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(settlementCompanyName)}</h1>
          <p>Database Settlement Payroll Report</p>
          <p>Driver: ${escapeHtml(`${statement.driver?.id || ''} - ${statement.driver?.name || ''}`.trim())}</p>
          <p>Period: ${escapeHtml(statement.settlement?.periodStart || '')} to ${escapeHtml(statement.settlement?.periodEnd || '')}</p>
          <p>Status: ${escapeHtml(activeBackendSettlement.status || statement.settlement?.status || 'Draft')}</p>
          <p>Statement Version: ${escapeHtml(statement.settlement?.version || activeBackendSettlement.version || 1)}</p>

          ${
            payrollNote
              ? `<div class="note"><strong>Payroll Note</strong>${escapeHtml(payrollNote).replace(/\n/g, '<br>')}</div>`
              : ''
          }

          <div class="summary">
            <div class="box"><span>Loads</span><strong>${escapeHtml(statement.totals?.loadCount || 0)}</strong></div>
            <div class="box"><span>Gross Pay</span><strong>${escapeHtml(formatMoney(statement.totals?.grossPay || 0))}</strong></div>
            <div class="box"><span>Adjustments</span><strong>${escapeHtml(formatMoney(statement.totals?.adjustmentsTotal || 0))}</strong></div>
            <div class="box"><span>Net Deductions</span><strong>${escapeHtml(formatMoney(-(statement.totals?.netDeductionsTotal || 0)))}</strong></div>
            <div class="box"><span>Net Pay</span><strong class="net">${escapeHtml(formatMoney(statement.totals?.netPay || 0))}</strong></div>
          </div>

          <h2>Loads</h2>
          <table>
            <thead>
              <tr>
                <th>Appointment</th>
                <th>Load</th>
                <th>Customer</th>
                <th>Container</th>
                <th>Reference</th>
                <th>Miles</th>
                <th>Source</th>
                <th>Pay</th>
              </tr>
            </thead>
            <tbody>${loadsHtml || '<tr><td colspan="8">No loads in this statement</td></tr>'}</tbody>
          </table>

          <h2>Deductions / Reimbursements</h2>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>Added By</th>
                <th>Date</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>${adjustmentsHtml || '<tr><td colspan="5">No deductions or reimbursements</td></tr>'}</tbody>
          </table>

          <h2>Net Deductions</h2>
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Added By</th>
                <th>Date</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>${netDeductionsHtml || '<tr><td colspan="4">No net deductions</td></tr>'}</tbody>
          </table>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };
  
const createInvoiceForLoad = async (load, amountOverride = null) => {
  if (!load) return null;
  try {
    const invoicePayload = {
      customerId: load.customerId || selectedCustomer?.id || '',
      customerName: load.customer || 'Customer',
      loadId: load.id,
      referenceNumber: load.referenceNumber || '',
      poNumber: load.poNumber || '',
      amount:
        amountOverride === null || amountOverride === undefined
          ? getCustomerBillAmount(load)
          : parseMoney(amountOverride),
      status: 'Unpaid',
      issueDate: getTodayDate(),
      dueDate: '',
      notes: load.notes || '',
    };

    const res = await fetch(`${API_BASE}/api/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(invoicePayload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.details || data.error || 'Failed to create invoice');
    }

    setSavedInvoices((prev) => {
      const withoutCurrent = prev.filter(
        (inv) => inv.loadId !== load.id
      );
      return [...withoutCurrent, data];
    });

    setInvoiceStatusMessage(`Invoice ${data.invoiceNumber} saved successfully.`);
    return data;
  } catch (error) {
    console.error('Save invoice error:', error);
    setInvoiceStatusMessage(`Failed to save invoice: ${error.message}`);
    return null;
  }
};

const handleSaveInvoice = async () => {
  await createInvoiceForLoad(selectedInvoiceLoad);
};

const handleCreateAccountingInvoice = async (load) => {
  if (!load?.id) return;
  const createdInvoice = await createInvoiceForLoad(load, getAccountingBillAmountDraft(load));
  if (createdInvoice) {
    setAccountingBillAmountDrafts((prev) => {
      const next = { ...prev };
      delete next[load.id];
      return next;
    });
  }
};

const exportMileageReportCsv = () => {
  const rows = [
    {
      Year: mileageReportYear,
      Driver: 'TOTAL',
      'Completed Loads': mileageReportTotals.loadCount,
      'Total Miles': mileageReportTotals.totalMiles.toFixed(1),
      'Loads Missing Miles': mileageReportTotals.missingMiles,
    },
    ...mileageReportRows.map((row) => ({
      Year: mileageReportYear,
      Driver: row.driverName,
      'Completed Loads': row.loadCount,
      'Total Miles': row.totalMiles.toFixed(1),
      'Loads Missing Miles': row.missingMiles,
    })),
  ];
  const headers = Object.keys(rows[0] || {
    Year: '',
    Driver: '',
    'Completed Loads': '',
    'Total Miles': '',
    'Loads Missing Miles': '',
  });
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `driver-mileage-report-${mileageReportYear || 'year'}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const handleInvoiceStatusChange = async (invoiceId, newStatus) => {
  try {
    const res = await fetch(`${API_BASE}/api/invoices/${invoiceId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to update invoice status');
    }

    setSavedInvoices((prev) =>
      prev.map((invoice) =>
        invoice.id === invoiceId ? { ...invoice, status: newStatus } : invoice
      )
    );
  } catch (error) {
    console.error('Failed to update invoice status:', error);
  }
};

const getInvoicePaymentDraft = (invoice) => {
  if (!invoice) {
    return {
      amount: '',
      paidAmount: '',
      paymentDate: getTodayDate(),
      paymentMethod: '',
      paymentNotes: '',
    };
  }

  return invoicePaymentDrafts[invoice.id] || {
    amount:
      invoice.amount === null || invoice.amount === undefined || invoice.amount === ''
        ? ''
        : String(invoice.amount),
    paidAmount:
      invoice.paidAmount === null || invoice.paidAmount === undefined || invoice.paidAmount === ''
        ? ''
        : String(invoice.paidAmount),
    paymentDate: invoice.paymentDate || getTodayDate(),
    paymentMethod: invoice.paymentMethod || '',
    paymentNotes: invoice.paymentNotes || '',
  };
};

const getInvoiceBalance = (invoice, draft = null) => {
  if (!invoice) return 0;
  const activeDraft = draft || getInvoicePaymentDraft(invoice);
  return Math.max(0, parseMoney(activeDraft.amount ?? invoice.amount) - parseMoney(activeDraft.paidAmount));
};

const getAccountingBillAmountDraft = (load) => {
  if (!load?.id) return '';
  return accountingBillAmountDrafts[load.id] ?? formatMoney(getCustomerBillAmount(load));
};

const handleAccountingBillAmountChange = (loadId, value) => {
  setAccountingBillAmountDrafts((prev) => ({
    ...prev,
    [loadId]: value,
  }));
  setInvoiceStatusMessage('');
};

const getAccountingExtraChargeDraft = (load) => {
  if (!load?.id) return [];
  return accountingExtraChargeDrafts[load.id] ?? parseCustomerExtraCharges(load);
};

const openAccountingExtraChargesEditor = (load, withNewRow = false) => {
  if (!load?.id) return;
  const existingRows = parseCustomerExtraCharges(load);
  setAccountingExtraChargeDrafts((prev) => ({
    ...prev,
    [load.id]: withNewRow && existingRows.length === 0
      ? [{
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'Chassis Charge',
          description: '',
          amount: '',
        }]
      : existingRows,
  }));
  setAccountingExtraChargesOpenLoadId(load.id);
  setAccountingExtraChargeStatus('');
};

const closeAccountingExtraChargesEditor = (load) => {
  if (!load?.id) return;
  setAccountingExtraChargeDrafts((prev) => {
    const next = { ...prev };
    delete next[load.id];
    return next;
  });
  setAccountingExtraChargesOpenLoadId('');
  setAccountingExtraChargeStatus('');
};

const handleAccountingExtraChargeChange = (load, index, field, value) => {
  if (!load?.id) return;
  const currentRows = getAccountingExtraChargeDraft(load);
  const nextRows = currentRows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, [field]: value } : row
  );
  setAccountingExtraChargeDrafts((prev) => ({ ...prev, [load.id]: nextRows }));
  setAccountingExtraChargeStatus('');
};

const handleAddAccountingExtraCharge = (load) => {
  if (!load?.id) return;
  setAccountingExtraChargesOpenLoadId(load.id);
  setAccountingExtraChargeDrafts((prev) => ({
    ...prev,
    [load.id]: [
      ...(prev[load.id] ?? parseCustomerExtraCharges(load)),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: 'Chassis Charge',
        description: '',
        amount: '',
      },
    ],
  }));
  setAccountingExtraChargeStatus('');
};

const handleRemoveAccountingExtraCharge = (load, index) => {
  if (!load?.id) return;
  const nextRows = getAccountingExtraChargeDraft(load).filter((_, rowIndex) => rowIndex !== index);
  setAccountingExtraChargeDrafts((prev) => ({ ...prev, [load.id]: nextRows }));
  setAccountingExtraChargeStatus('');
};

const handleSaveAccountingExtraCharges = async (load) => {
  if (!load?.id) return;
  const charges = normalizeCustomerExtraCharges(getAccountingExtraChargeDraft(load));
  const updatedLoad = {
    ...load,
    customerExtraCharges: charges,
    customerExtraChargesJson: JSON.stringify(charges),
  };

  try {
    const res = await fetch(`${API_BASE}/api/loads/${load.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(updatedLoad),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.details || data.error || 'Failed to save extra charges');
    }

    const normalizedLoad = normalizeLoadedLoads([data])[0];
    setLoadsData((prev) =>
      prev.map((item) => (item.id === normalizedLoad.id ? normalizedLoad : item))
    );
    setSelectedLoad((prev) => (prev?.id === normalizedLoad.id ? normalizedLoad : prev));
    setSelectedAccountingLoadId(normalizedLoad.id);
    setAccountingExtraChargeDrafts((prev) => {
      const next = { ...prev };
      delete next[load.id];
      return next;
    });
    setAccountingExtraChargesOpenLoadId('');
    setAccountingBillAmountDrafts((prev) => ({
      ...prev,
      [load.id]: formatMoney(getCustomerBillAmount(normalizedLoad)),
    }));
    setAccountingExtraChargeStatus('Customer extra charges saved.');
  } catch (error) {
    console.error('Failed to save customer extra charges:', error);
    setAccountingExtraChargeStatus(`Failed to save charges: ${error.message}`);
  }
};

const handleInvoicePaymentDraftChange = (invoiceId, field, value) => {
  setInvoicePaymentDrafts((prev) => ({
    ...prev,
    [invoiceId]: {
      ...(prev[invoiceId] || {}),
      [field]: value,
    },
  }));
  setInvoiceStatusMessage('');
};

const handleSaveInvoicePayment = async (invoice) => {
  if (!invoice?.id) return;
  const draft = getInvoicePaymentDraft(invoice);

  try {
    const res = await fetch(`${API_BASE}/api/invoices/${invoice.id}/payment`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        amount: parseMoney(draft.amount ?? invoice.amount),
        paidAmount: parseMoney(draft.paidAmount),
        paymentDate: draft.paymentDate || '',
        paymentMethod: draft.paymentMethod || '',
        paymentNotes: draft.paymentNotes || '',
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save customer payment');
    }

    setSavedInvoices((prev) =>
      prev.map((item) => (item.id === data.id ? data : item))
    );
    setInvoicePaymentDrafts((prev) => {
      const next = { ...prev };
      delete next[invoice.id];
      return next;
    });
    setInvoiceStatusMessage(`Payment updated for ${data.invoiceNumber}.`);
  } catch (error) {
    console.error('Failed to save invoice payment:', error);
    setInvoiceStatusMessage(`Failed to save payment: ${error.message}`);
  }
};

const handleMarkInvoiceUnpaid = async (invoice) => {
  if (!invoice?.id) return;
  const draft = getInvoicePaymentDraft(invoice);

  try {
    const res = await fetch(`${API_BASE}/api/invoices/${invoice.id}/payment`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        amount: parseMoney(draft.amount ?? invoice.amount),
        paidAmount: 0,
        paymentDate: '',
        paymentMethod: '',
        paymentNotes: '',
        status: 'Unpaid',
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to mark invoice unpaid');
    }

    setSavedInvoices((prev) =>
      prev.map((item) => (item.id === data.id ? data : item))
    );
    setInvoicePaymentDrafts((prev) => {
      const next = { ...prev };
      delete next[invoice.id];
      return next;
    });
    setInvoiceStatusMessage(`${data.invoiceNumber} marked unpaid.`);
  } catch (error) {
    console.error('Failed to mark invoice unpaid:', error);
    setInvoiceStatusMessage(`Failed to mark unpaid: ${error.message}`);
  }
};
const handleGeneratePOD = (loadForPod = selectedInvoiceLoad) => {
  if (!loadForPod) return;

  const sanitizePrintFilename = (value, fallback = 'POD') => {
    const safe = String(value || fallback)
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '');
    return safe || fallback;
  };
  const podFilename = sanitizePrintFilename(
    loadForPod.containerNumber || loadForPod.id,
    'POD'
  );
  const escapePodHtml = (value) =>
    String(value || '—')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const podField = (label, value) => `
    <div class="field">
      <span>${escapePodHtml(label)}</span>
      <strong>${escapePodHtml(value)}</strong>
    </div>
  `;
  const podAddress = (label, value) => `
    <div class="address-block">
      <span>${escapePodHtml(label)}</span>
      <p>${escapePodHtml(value)}</p>
    </div>
  `;
  const signatureImage =
    loadForPod?.id && signatures[loadForPod.id]
      ? `<img src="${signatures[loadForPod.id]}" alt="Signature" />`
      : '';
  const podSettings = {
    ...defaultPodSettings,
    ...(company?.podSettings || {}),
  };
  const podCompanyHtml = podSettings.showCompanyInfo
    ? `
      <div class="pod-company-box">
        <span>Carrier</span>
        <strong>${escapePodHtml(company?.invoiceName || company?.name || '')}</strong>
        ${company?.invoiceAddress ? `<p>${escapePodHtml(company.invoiceAddress)}</p>` : ''}
      </div>
    `
    : '';
  const podMetaFields = [
    podField('Load ID', loadForPod.id),
    podField('Reference #', loadForPod.referenceNumber),
    podField('Load Date', loadForPod.loadDate),
    podSettings.showCustomerInfo ? podField('Customer', loadForPod.customer) : '',
    podSettings.showDriverTruck ? podField('Driver', getDriverLabel(loadForPod.driver)) : '',
    podSettings.showDriverTruck ? podField('Truck', loadForPod.truck) : '',
    podField('Container', loadForPod.containerNumber),
    podField('Size', loadForPod.containerSize),
    podField('Chassis #', loadForPod.chassisNumber),
    podField('Seal #', loadForPod.sealNumber),
    podField('Booking #', loadForPod.bookingNumber),
    podField('POD #', loadForPod.pod),
  ]
    .filter(Boolean)
    .join('');
  const podAddressFields = [
    podSettings.showPickup ? podAddress('Pickup', loadForPod.pickup) : '',
    podSettings.showDelivery ? podAddress('Delivery', getDeliveryDisplay(loadForPod.delivery)) : '',
    podSettings.showReturn ? podAddress('Return', loadForPod.returnLocation) : '',
  ]
    .filter(Boolean)
    .join('');
  const podRouteHtml = podAddressFields
    ? `
      <h2 class="section-title">Route</h2>
      <section class="addresses">
        ${podAddressFields}
      </section>
    `
    : '';
  const podSignatureHtml = podSettings.showSignatures
    ? `
      <h2 class="section-title">Delivery Confirmation</h2>
      <section class="signature-grid">
        <div class="signature-card">
          <span>Delivery Date</span>
          <div class="signature-line"></div>
        </div>
        <div class="signature-card">
          <span>Receiver Name</span>
          <div class="signature-line"></div>
        </div>
        <div class="signature-card">
          <span>Receiver Signature</span>
          <div class="signature-line"></div>
        </div>
        <div class="signature-card">
          <span>Driver Signature</span>
          ${signatureImage || '<div class="signature-line"></div>'}
        </div>
      </section>
    `
    : '';
  const modernPodHtml = `
    <html>
      <head>
        <title>${escapePodHtml(podFilename)}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #eef2f7;
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
            line-height: 1.4;
          }
          .page {
            width: 8.5in;
            min-height: 11in;
            margin: 0 auto;
            padding: 34px;
            background: #ffffff;
          }
          .hero {
            display: flex;
            justify-content: space-between;
            gap: 24px;
            padding: 24px;
            border-radius: 10px;
            background: #0f172a;
            color: #ffffff;
          }
          .brand {
            color: #93c5fd;
            font-size: 13px;
            font-weight: 800;
            letter-spacing: 0;
            text-transform: uppercase;
          }
          h1 { margin: 6px 0 0; font-size: 32px; line-height: 1.05; }
          .hero p { margin: 8px 0 0; color: #cbd5e1; }
          .status-badge {
            align-self: flex-start;
            padding: 8px 12px;
            border: 1px solid rgba(255, 255, 255, 0.24);
            border-radius: 999px;
            color: #ffffff;
            font-size: 12px;
            font-weight: 800;
            white-space: nowrap;
          }
          .pod-company-box {
            margin: 14px 0 0;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.24);
            border-radius: 8px;
          }
          .pod-company-box span {
            display: block;
            color: #93c5fd;
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
          }
          .pod-company-box strong {
            display: block;
            margin-top: 4px;
            color: #ffffff;
          }
          .pod-company-box p {
            margin: 4px 0 0;
            color: #cbd5e1;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin: 18px 0;
          }
          .field,
          .address-block,
          .signature-card {
            border: 1px solid #dbe4f0;
            border-radius: 8px;
            background: #f8fafc;
          }
          .field { min-height: 72px; padding: 12px; }
          .field span,
          .address-block span,
          .signature-card span {
            display: block;
            color: #64748b;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
          }
          .field strong {
            display: block;
            margin-top: 5px;
            color: #111827;
            font-size: 14px;
            overflow-wrap: anywhere;
          }
          .section-title {
            margin: 22px 0 10px;
            color: #0f172a;
            font-size: 15px;
            font-weight: 900;
            text-transform: uppercase;
          }
          .addresses {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
          }
          .address-block { padding: 14px; }
          .address-block p {
            margin: 6px 0 0;
            color: #111827;
            font-size: 14px;
            font-weight: 700;
            overflow-wrap: anywhere;
          }
          .signature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-top: 12px;
          }
          .signature-card { min-height: 120px; padding: 14px; }
          .signature-line {
            height: 58px;
            margin-top: 20px;
            border-bottom: 2px solid #111827;
          }
          .signature-card img {
            display: block;
            max-width: 100%;
            max-height: 76px;
            margin: 10px 0 0;
            border-bottom: 2px solid #111827;
          }
          .footer {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            margin-top: 24px;
            padding-top: 12px;
            border-top: 1px solid #dbe4f0;
            color: #64748b;
            font-size: 11px;
          }
          @media print {
            body { background: #ffffff; }
            .page { width: auto; min-height: auto; margin: 0; padding: 24px; }
          }
        </style>
      </head>
      <body>
        <main class="page">
          <section class="hero">
            <div>
              <h1>Proof of Delivery</h1>
              <p>Delivery confirmation for load ${escapePodHtml(loadForPod.id)}</p>
              ${podCompanyHtml}
            </div>
            <div class="status-badge">POD</div>
          </section>

          <section class="meta-grid">
            ${podMetaFields}
          </section>

          ${podRouteHtml}
          ${podSignatureHtml}

          <footer class="footer">
            <span>Generated POD</span>
            <span>${escapePodHtml(new Date().toLocaleString())}</span>
          </footer>
        </main>
      </body>
    </html>
  `;

  const modernWindow = window.open('', '_blank');
  if (!modernWindow) return;

  modernWindow.document.write(modernPodHtml);
  modernWindow.document.close();
  modernWindow.document.title = podFilename;
  modernWindow.print();
  return;

  const podHtml = `
    <html>
      <head>
        <title>POD</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; }
          h1, h2 { text-align: center; margin: 0; }
          h2 { margin-top: 10px; margin-bottom: 30px; }
          .section { margin-bottom: 20px; }
          .line { border-bottom: 1px solid #000; margin-top: 20px; height: 20px; }
        </style>
      </head>
      <body>
        <h1>PORTFLOW DISPATCH</h1>
        <h2>Proof of Delivery (POD)</h2>

        <div class="section">
          <strong>Load ID:</strong> ${selectedInvoiceLoad.id || '—'}<br/>
          <strong>Reference #:</strong> ${selectedInvoiceLoad.referenceNumber || '—'}<br/>
          <strong>Date:</strong> ${selectedInvoiceLoad.loadDate || '—'}
          </div>
        </div>

        <div class="section">
          <strong>Customer:</strong> ${selectedInvoiceLoad.customer || '—'}<br/>
          <strong>Driver:</strong> ${getDriverLabel(selectedInvoiceLoad.driver)}<br/>
          <strong>Truck:</strong> ${selectedInvoiceLoad.truck || '—'}
        </div>

        <div class="section">
          <strong>Pickup:</strong> ${selectedInvoiceLoad.pickup || '—'}<br/>
          <strong>Delivery:</strong> ${getDeliveryDisplay(selectedInvoiceLoad.delivery) || '—'}<br/>
          <strong>Return:</strong> ${selectedInvoiceLoad.returnLocation || '—'}
        </div>

        <div class="section">
          <strong>Container:</strong> ${selectedInvoiceLoad.containerNumber || '—'} (${selectedInvoiceLoad.containerSize || '—'})<br/>
          <strong>Chassis #:</strong> ${selectedInvoiceLoad.chassisNumber || '—'}<br/>
          <strong>Seal #:</strong> ${selectedInvoiceLoad.sealNumber || '—'}
        </div>

        <div class="section">
          <strong>Delivery Date:</strong> __________________________
        </div>

        <div class="section">
          <strong>Receiver Name:</strong> __________________________
        </div>

        <div class="section">
  <strong>${
  selectedInvoiceLoad?.id && signatures[selectedInvoiceLoad.id]
    ? `<img src="${signatures[selectedInvoiceLoad.id]}" alt="Signature" style="max-width: 300px; max-height: 120px; border-bottom: 1px solid #000; padding-top: 10px;" />`
    : `<div class="line"></div>`
}
</div>
      </body>
    </html>
  `;

  const newWindow = window.open('', '_blank');
  if (!newWindow) return;

  newWindow.document.write(podHtml);
  newWindow.document.close();
  newWindow.print();
};

const handleLogout = () => {
  clearAuthSession();
  setAuthToken('');
  setCurrentUser(null);
  setCompany(null);
  setSelectedLoad(null);
  setSelectedAccountingLoadId('');
  setIsEditing(false);
  setLoginError('');
  setLoginPassword('');
  setAuthMode('login');
  setActiveView(isDriverApp ? 'driver' : 'dispatch');
  setShowPublicLanding(false);
  window.location.replace(isDriverApp ? '/driver' : '/login');
};

const handlePrintInvoice = () => {
  if (!selectedInvoiceLoad) return;

  const invoiceNumber =
    savedInvoices.find((inv) => inv.loadId === selectedInvoiceLoad.id)?.invoiceNumber ||
    'INV-XXXX';

  const customerName = selectedInvoiceLoad.customer || 'Customer';
  const customerContact = selectedCustomer?.contactName || '';
  const customerEmail = selectedCustomer?.email || '';
  const customerPhone = selectedCustomer?.phone || '';
  const invoiceCompanyName = company?.invoiceName || company?.name || 'Company';
  const invoiceCompanyAddress = company?.invoiceAddress || '';
  const invoiceLogoSrc = getCompanyLogoSrc();
  const invoiceExtraCharges = parseCustomerExtraCharges(selectedInvoiceLoad);
  const invoiceChargeRows = [
    { description: 'Linehaul / Load Rate', amount: parseMoney(selectedInvoiceLoad.rate) },
    ...(parseMoney(selectedInvoiceLoad.detention) > 0
      ? [{ description: 'Detention', amount: parseMoney(selectedInvoiceLoad.detention) }]
      : []),
    ...invoiceExtraCharges.map((charge) => ({
      description: `${charge.type || 'Extra Charge'}${charge.description ? ` - ${charge.description}` : ''}`,
      amount: parseMoney(charge.amount),
    })),
  ];
  const invoiceChargesHtml = invoiceChargeRows
    .map(
      (charge) => `
        <tr>
          <td>${charge.description}</td>
          <td>${formatMoney(charge.amount)}</td>
        </tr>
      `
    )
    .join('');
  const formattedInvoiceTotal = formatMoney(getCustomerBillAmount(selectedInvoiceLoad));

  const printWindow = window.open('', '_blank', 'width=1100,height=800');
  if (!printWindow) return;

  printWindow.document.write(`
    <html>
      <head>
        <title>Invoice ${invoiceNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
          h1, h2, h3, p { margin: 0; }
          .header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
          .brand { display: flex; gap: 12px; align-items: flex-start; }
          .brand img { width: 72px; max-height: 72px; object-fit: contain; }
          .brand-address { margin-top: 6px; color: #4b5563; white-space: pre-line; }
          .section { margin-bottom: 20px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
          .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 16px; }
          .line { margin-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { text-align: left; padding: 10px; border-bottom: 1px solid #e5e7eb; }
          th:last-child, td:last-child { text-align: right; }
          .total { font-size: 20px; font-weight: bold; margin-top: 12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">
            ${invoiceLogoSrc ? `<img src="${invoiceLogoSrc}" alt="Company logo" />` : ''}
            <div>
              <h2>${invoiceCompanyName}</h2>
              ${invoiceCompanyAddress ? `<p class="brand-address">${invoiceCompanyAddress}</p>` : ''}
            </div>
          </div>
          <div>
            <h1>Invoice</h1>
            <p>Invoice Number: ${invoiceNumber}</p>
            <p>Load ID: ${selectedInvoiceLoad.id || '—'}</p>
          </div>
        </div>

        <div class="section grid">
          <div class="card">
            <h3>Customer</h3>
            <div class="line"><strong>Name:</strong> ${customerName}</div>
            <div class="line"><strong>Contact:</strong> ${customerContact || '—'}</div>
            <div class="line"><strong>Email:</strong> ${customerEmail || '—'}</div>
            <div class="line"><strong>Phone:</strong> ${customerPhone || '—'}</div>
          </div>

          <div class="card">
            <h3>Load Details</h3>
            <div class="line"><strong>Broker Reference:</strong> ${selectedInvoiceLoad.referenceNumber || '—'}</div>
            <div class="line"><strong>POD:</strong> ${selectedInvoiceLoad.pod || '—'}</div>
            <div class="line"><strong>Pickup:</strong> ${selectedInvoiceLoad.pickup || '—'}</div>
            <div class="line"><strong>Delivery:</strong> ${getDeliveryDisplay(selectedInvoiceLoad.delivery) || '—'}</div>
            <div class="line"><strong>Return:</strong> ${selectedInvoiceLoad.returnLocation || '—'}</div>
            <div class="line"><strong>Container:</strong> ${selectedInvoiceLoad.containerNumber || '—'}</div>
            <div class="line"><strong>Chassis:</strong> ${selectedInvoiceLoad.chassisNumber || '—'}</div>
          </div>
        </div>

        <div class="section card">
          <h3>Charges</h3>
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${invoiceChargesHtml}
            </tbody>
          </table>
          <div class="total">Amount Due: ${formattedInvoiceTotal}</div>
        </div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
};

const pickupLocations = Array.isArray(locations)
  ? locations.filter(
      (loc) =>
        !loc.type ||
        loc.type === 'pickup' ||
        loc.type === 'port' ||
        loc.type === 'yard' ||
        loc.type === 'warehouse'
    )
  : [];

const deliveryLocations = Array.isArray(locations)
  ? locations.filter(
      (loc) =>
        !loc.type ||
        loc.type === 'delivery' ||
        loc.type === 'warehouse'
    )
  : [];

const returnLocations = Array.isArray(locations)
  ? locations.filter(
      (loc) =>
        !loc.type ||
        loc.type === 'return' ||
        loc.type === 'yard' ||
        loc.type === 'port' ||
        loc.type === 'warehouse'
    )
  : [];

const normalizeLocationText = (value = '') =>
  String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const getSavedLocationDisplay = (value = '', options = []) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';

  const normalizedValue = normalizeLocationText(rawValue);
  const match = (options || []).find((loc) => {
    const address = normalizeLocationText(formatLocationAddress(loc));
    const label = normalizeLocationText(getLocationOptionLabel(loc));
    return normalizedValue === address || normalizedValue === label;
  });

  return match ? getLocationOptionLabel(match) : rawValue;
};

const getDeliveryDisplay = (value = '') =>
  getSavedLocationDisplay(value, deliveryLocations);

const getLoadNextMoveType = (load = {}) => {
  const value = String(load.nextMoveType || '').trim().toLowerCase();
  return value === 'return' ? 'Return' : 'Delivery';
};

const getDriverDestination = (load = {}) =>
  getLoadNextMoveType(load) === 'Return'
    ? load.returnLocation || load.delivery || ''
    : load.delivery || '';
           
  const handleSaveNewPickupLocation = async () => {
  try {
    const payload = {
      ...newPickupLocation,
      customerId: newLoad.customerId || '',
      type: 'pickup',
    };

    const res = await fetch(`${API_BASE}/api/locations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save pickup location');
    }

    await fetchLocations();

    const fullAddress = formatLocationAddress(newPickupLocation);

    setNewLoad((prev) => ({
      ...prev,
      pickup: fullAddress,
    }));

    setNewPickupLocation({
      name: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      type: 'pickup',
      customerId: '',
      notes: '',
    });

    setShowNewPickup(false);
  } catch (error) {
    console.error('Error saving pickup location:', error);
    if (handleAuthError(error.message)) return;
    alert(error.message);
  }
};

const handleSelectSavedLocation = (field, locationId) => {
  const selected = locations.find((loc) => loc.id === locationId);
  if (!selected) return;

  setNewLoad((prev) => ({
    ...prev,
    [field]: formatLocationAddress(selected),
  }));
};

const handleDriverStatusUpdate = async (loadId, newStatus) => {
  try {
    const loadToUpdate = loadsData.find((load) => load.id === loadId);

    if (newStatus === 'Delivered' && !hasRequiredDriverDocuments(loadToUpdate)) {
      const missing = getMissingDriverDocuments(loadToUpdate).join(', ');
      alert(`Please upload ${missing} before completing this load.`);
      return;
    }

    const res = await fetch(`${API_BASE}/api/loads/${loadId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
     body: JSON.stringify({
  status: newStatus,
  dropDateTime: newStatus === 'Dropped' ? new Date().toISOString() : '',
}),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to update status');
    }

    setLoadsData((prevLoads) =>
      prevLoads.map((load) =>
        load.id === loadId
          ? {
              ...load,
              status: newStatus,
              availabilityStatus: ['In Transit', 'Dropped', 'Delivered'].includes(newStatus)
                ? ''
                : load.availabilityStatus,
              droppedBy:
                newStatus === 'Dropped'
                  ? normalizeDriverForStorage(load.driver)
                  : load.droppedBy,
              dropDateTime:
                newStatus === 'Dropped'
                  ? data.dropDateTime || new Date().toISOString()
                  : load.dropDateTime,
            }
          : load
      )
    );

    await fetchLoads();
    alert(newStatus === 'Delivered' ? 'Load completed' : `Status updated to ${newStatus}`);
  } catch (error) {
    console.error('STATUS UPDATE ERROR:', error);
    alert(`Failed to update status: ${error.message}`);
  }
};

const setDriverEquipmentDraft = (loadId, field, value) => {
  driverEquipmentDraftsRef.current[loadId] = {
    ...(driverEquipmentDraftsRef.current[loadId] || {}),
    [field]: value,
  };
};

const getDriverEquipmentDraft = (loadId, field) =>
  driverEquipmentDraftsRef.current[loadId]?.[field] ?? '';

const handleDriverContainerUpdate = async (loadId) => {
  const loadToUpdate = loadsData.find((load) => load.id === loadId);
  const containerNumber = String(
    getDriverEquipmentDraft(loadId, 'containerNumber') || driverContainerByLoad[loadId] || ''
  ).trim().toUpperCase();
  const chassisNumber = String(
    getDriverEquipmentDraft(loadId, 'chassisNumber') || driverChassisByLoad[loadId] || ''
  ).trim().toUpperCase();

  if (loadToUpdate?.containerNumber && containerNumber) {
    alert('This load already has a container number. Dispatch must edit it if a correction is needed.');
    return;
  }

  if (!containerNumber && !chassisNumber) {
    alert('Please enter the container number or chassis number first.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/loads/${loadId}/container-number`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ containerNumber, chassisNumber }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to update container number');
    }

    setLoadsData((prevLoads) =>
      prevLoads.map((load) =>
        load.id === loadId
          ? {
              ...load,
              containerNumber: data.containerNumber ?? load.containerNumber,
              chassisNumber: data.chassisNumber ?? load.chassisNumber,
            }
          : load
      )
    );
    driverEquipmentDraftsRef.current[loadId] = {};
    setDriverContainerByLoad((prev) => ({ ...prev, [loadId]: '' }));
    setDriverChassisByLoad((prev) => ({ ...prev, [loadId]: '' }));
    await fetchLoads();
    alert('Equipment details saved');
  } catch (error) {
    console.error('Equipment update error:', error);
    alert(`Failed to save equipment details: ${error.message}`);
  }
};

const saveLocationIfNotExists = async (value, type) => {
  if (!value) return;

  const normalizedValue = String(value).trim().toLowerCase();
  const exists = locations.some(
    (loc) =>
      loc.name?.toLowerCase() === normalizedValue ||
      loc.address?.toLowerCase() === normalizedValue ||
      formatLocationAddress(loc).toLowerCase() === normalizedValue
  );

  if (exists) return;

  try {
    const res = await fetch(`${API_BASE}/api/locations`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  },
  body: JSON.stringify({
    name: value,
    address: value,
    type,
  }),
});

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save location');
    }

    await fetchLocations();
  } catch (err) {
    console.error('Auto-save location failed:', err);
    if (handleAuthError(err.message)) return;
    throw err;
  }
};

const handleSaveNewDeliveryLocation = async () => {
  try {
    const payload = {
      ...newDeliveryLocation,
      customerId: newLoad.customerId || '',
      type: 'delivery',
    };

    const res = await fetch(`${API_BASE}/api/locations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save delivery location');
    }

    const savedLocation = {
      ...payload,
      id: data.id,
      companyId: company?.id || currentUser?.companyId || '',
    };
    const fullAddress = formatLocationAddress(savedLocation);

    setLocations((prev) => {
      const withoutDuplicate = prev.filter((location) => location.id !== savedLocation.id);
      return [...withoutDuplicate, savedLocation];
    });

    setNewLoad((prev) => ({
      ...prev,
      delivery: fullAddress,
    }));

    setNewDeliveryLocation({
      name: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      type: 'delivery',
      customerId: '',
      notes: '',
    });

    setShowNewDeliveryForm(false);
  } catch (error) {
    console.error('Error saving delivery location:', error);
    if (handleAuthError(error.message)) return;
    alert(error.message);
  }
};
const handleSelectSavedLocationForSelectedLoad = (field, locationId) => {
  const selected = locations.find((loc) => loc.id === locationId);
  if (!selected) return;

  setSelectedLoad((prev) => ({
    ...prev,
    [field]: [selected.name, selected.address, selected.city, selected.state, selected.zip]
      .filter(Boolean)
      .join(', '),
  }));
};

const handleSelectedLoadCustomerChange = (e) => {
  const customerName = e.target.value;

  setSelectedLoad((prev) => ({
    ...prev,
    customer: customerName,
  }));
};

if (!authToken && !isDriverApp && showPublicLanding) {
return (
    <div className="public-page">
      <header className="public-nav">
        <div className="public-brand">
          <img src="/portflow-icon-192.png" alt="PortFlow" />
          <div>
            <strong>PortFlow</strong>
            <span>Logistics Analytics</span>
          </div>
        </div>
        <div className="public-nav-actions">
          <a className="public-link-btn" href="/privacy.html" target="_blank" rel="noreferrer">
            Privacy
          </a>
          <button
            type="button"
            className="public-link-btn"
            onClick={() => {
              setAuthMode('login');
              setShowPublicLanding(false);
            }}
          >
            Client Login
          </button>
          <a className="public-primary-btn" href="#demo-request">
            Request Demo
          </a>
        </div>
      </header>

      <main>
        <section className="public-hero">
          <div className="public-hero-copy">
            <span className="public-kicker">Built for port trucking teams</span>
            <h1>Dispatch, driver paperwork, billing, and settlements in one clean TMS.</h1>
            <p>
              PortFlow helps container carriers run daily dispatch, mobile driver updates, document scanning,
              customer billing, payroll settlement, and Port Houston visibility from one connected workspace.
            </p>
            <div className="public-hero-actions">
              <a className="public-primary-btn" href="#demo-request">
                Schedule a Demo
              </a>
              <button
                type="button"
                className="public-link-btn"
                onClick={() => {
                  setAuthMode('login');
                  setShowPublicLanding(false);
                }}
              >
                Open Login
              </button>
            </div>
          </div>

          <div className="public-product-preview" aria-label="PortFlow dashboard preview">
            <div className="public-preview-top">
              <span>Today's Loads</span>
              <strong>Operations Board</strong>
            </div>
            <div className="public-preview-stats">
              <div><span>Available</span><strong>18</strong></div>
              <div><span>Dispatched</span><strong>24</strong></div>
              <div><span>Completed</span><strong>11</strong></div>
            </div>
            <div className="public-preview-table">
              {[
                ['BCT', 'MSCU4527810', 'Available', 'LFD Today'],
                ['BPT', 'TCLU3389021', 'Dispatched', 'Driver ETA 2:15'],
                ['BCT', 'CMAU7703914', 'Completed', 'Ready to bill'],
              ].map(([terminal, container, status, note]) => (
                <div className="public-preview-row" key={container}>
                  <span>{terminal}</span>
                  <strong>{container}</strong>
                  <em>{status}</em>
                  <small>{note}</small>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="public-feature-grid">
          {[
            ['Dispatch Board', 'Track available, dispatched, dropped, completed, appointment, and LFD loads.'],
            ['Driver Mobile', 'Drivers see assigned loads, scan documents, add chassis/container details, and complete PODs.'],
            ['Accounting', 'Bill completed loads, track paid/unpaid status, print invoices, and attach paperwork.'],
            ['Settlements', 'Create payroll statements with loads, deductions, reimbursements, CSV export, and print reports.'],
            ['Port Houston', 'Use smart container lookup for availability, LFD, terminal, line, size, holds, and port details.'],
            ['Documents', 'Upload POD, BOL, EIR, receipts, and customer paperwork directly to each shipment.'],
          ].map(([title, text]) => (
            <article className="public-feature-card" key={title}>
              <h2>{title}</h2>
              <p>{text}</p>
            </article>
          ))}
        </section>

        <section className="public-demo-band" id="demo-request">
          <div>
            <span className="public-kicker">Demo access by request</span>
            <h2>Approved prospects can try PortFlow without touching your live operation.</h2>
            <p>
              Request demo access first. Once approved, use the access code provided by PortFlow to launch the sample workspace.
            </p>
          </div>
          <div className="public-demo-access">
            <form className="public-demo-form" onSubmit={handleSubmitDemoRequest}>
              <label>
                <span>Company Name</span>
                <input
                  value={demoRequestForm.companyName}
                  onChange={(e) => setDemoRequestForm((prev) => ({ ...prev, companyName: e.target.value }))}
                  placeholder="Company name"
                  required
                />
              </label>
              <label>
                <span>Contact Name</span>
                <input
                  value={demoRequestForm.contactName}
                  onChange={(e) => setDemoRequestForm((prev) => ({ ...prev, contactName: e.target.value }))}
                  placeholder="Your name"
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={demoRequestForm.email}
                  onChange={(e) => setDemoRequestForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="email@company.com"
                  required
                />
              </label>
              <label>
                <span>Phone</span>
                <input
                  value={demoRequestForm.phone}
                  onChange={(e) => setDemoRequestForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="Phone"
                />
              </label>
              <label className="public-demo-message">
                <span>What do you want to improve?</span>
                <textarea
                  rows="3"
                  value={demoRequestForm.message}
                  onChange={(e) => setDemoRequestForm((prev) => ({ ...prev, message: e.target.value }))}
                  placeholder="Dispatch, driver app, billing, settlements..."
                />
              </label>
              <button type="submit" className="public-primary-btn">
                Send Demo Request
              </button>
              {demoRequestStatus && <p>{demoRequestStatus}</p>}
            </form>
            <label>
              <span>Demo Access Code</span>
              <input
                type="password"
                value={demoAccessCode}
                onChange={(e) => {
                  setDemoAccessCode(e.target.value);
                  setDemoAccessError('');
                }}
                placeholder="Enter code"
              />
            </label>
            {demoAccessError && <p>{demoAccessError}</p>}
            <button type="button" className="public-primary-btn" onClick={handleStartDemo}>
              Launch Approved Demo
            </button>
          </div>
        </section>
      </main>
      <footer className="public-footer">
        <span>PortFlow Logistics Analytics</span>
        <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>
      </footer>
    </div>
  );
}

if (!authToken) {
return (
    <div className={isDriverApp ? 'driver-mobile-login' : 'auth-shell'}>
      <div className={isDriverApp ? '' : 'auth-card'}>
        {!isDriverApp && (
          <div className="auth-brand">
            <img src="/portflow-icon-192.png" alt="PortFlow" />
            <div>
              <span>PortFlow</span>
              <strong>
                {authMode === 'register'
                  ? 'Request company access'
                  : authMode === 'reset'
                  ? 'Reset owner password'
                  : 'Dispatcher login'}
              </strong>
            </div>
          </div>
        )}

        <h2>
          {isDriverApp
            ? 'PortFlow Driver'
            : authMode === 'register'
            ? 'Create PortFlow Account'
            : authMode === 'reset'
            ? 'Reset Owner Password'
            : 'Welcome Back'}
        </h2>

        {!isDriverApp && (
          <p className="auth-subtitle">
            {authMode === 'register'
              ? 'Send a company access request. PortFlow will approve it before login is enabled.'
              : authMode === 'reset'
              ? 'Use your private reset code to set a new owner password.'
              : 'Sign in to manage loads, drivers, documents, and dispatch updates.'}
          </p>
        )}

      <form
        className={isDriverApp ? '' : 'auth-form'}
        onSubmit={
          !isDriverApp && authMode === 'register'
            ? handleRegister
            : !isDriverApp && authMode === 'reset'
            ? handleOwnerPasswordReset
            : handleLogin
        }
      >
        {!isDriverApp && authMode === 'register' && (
          <div className="auth-field">
            <label>Company Name</label>
            <input
              type="text"
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
            />
          </div>
        )}

        <div className={isDriverApp ? '' : 'auth-field'}>
          <label>Email</label>
          <input
            type="email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
          />
        </div>

        {authMode === 'reset' ? (
          <>
            <div className="auth-field">
              <label>Reset Code</label>
              <input
                type="password"
                value={ownerResetCode}
                onChange={(e) => setOwnerResetCode(e.target.value)}
              />
            </div>
            <div className="auth-field">
              <label>New Password</label>
              <input
                type="password"
                value={ownerNewPassword}
                onChange={(e) => setOwnerNewPassword(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className={isDriverApp ? '' : 'auth-field'}>
            <label>Password</label>
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
            />
          </div>
        )}

        {loginError && (
          <p className={isDriverApp ? 'driver-login-error' : 'auth-error'}>
            {loginError}
          </p>
        )}

        <button type="submit" className={isDriverApp ? '' : 'auth-primary-btn'}>
          {authMode === 'register'
            ? 'Request Account Access'
            : authMode === 'reset'
            ? 'Reset Password'
            : 'Log In'}
        </button>
      </form>

      {!isDriverApp && (
        <>
          <button
            type="button"
            onClick={() => {
              setLoginError('');
              setAuthMode(authMode === 'register' ? 'login' : 'register');
            }}
            className="auth-secondary-btn"
          >
            {authMode === 'register'
              ? 'Already have an account? Log in'
              : 'Request company access'}
          </button>
          <button
            type="button"
            onClick={() => {
              setLoginError('');
              setAuthMode(authMode === 'reset' ? 'login' : 'reset');
            }}
            className="auth-secondary-btn"
          >
            {authMode === 'reset' ? 'Back to login' : 'Reset owner password'}
          </button>
          <button
            type="button"
            onClick={() => setShowPublicLanding(true)}
            className="auth-secondary-btn"
          >
            Back to PortFlow overview
          </button>
          <a className="auth-privacy-link" href="/privacy.html" target="_blank" rel="noreferrer">
            Privacy Policy
          </a>
        </>
      )}
      </div>
    </div>
  );
}


const baseFilteredLoadsData =
  dashboardFilter === 'lfd'
    ? activeOperationsLoads.filter((load) => hasLastFreeDay(load))
    : dashboardFilter === 'appointments'
    ? activeOperationsLoads.filter(
        (load) =>
          hasAppointment(load) &&
          matchesAppointmentDateFilter(load) &&
          matchesAppointmentDeliveryTypeFilter(load)
      )
    : dashboardFilter === 'available'
    ? activeOperationsLoads.filter(
        (load) =>
          getAvailabilityStatusKey(load) === 'available' &&
          matchesAvailableAppointmentDateFilter(load) &&
          matchesAvailableDeliveryTypeFilter(load)
      )
    : dashboardFilter === 'not-available'
    ? activeOperationsLoads.filter(
        (load) => getAvailabilityStatusKey(load) === 'not available'
      )
    : dashboardFilter === 'dispatched'
    ? activeOperationsLoads.filter(
        (load) => isDriverAssignedDispatchLoad(load)
      )
    : dashboardFilter === 'in-transit'
    ? activeOperationsLoads.filter(
        (load) => getLoadQuickStatusKey(load) === 'in transit'
      )

          : dashboardFilter === 'dropped'
    ? activeOperationsLoads.filter(
        (load) => getLoadQuickStatusKey(load) === 'dropped'
      )

    : activeOperationsLoads;
    const normalizedSearchTerm = String(searchTerm || '').trim().toLowerCase();

const getNewestLoadSortValue = (load = {}) => {
  const idNumber = Number(String(load.id || '').match(/(\d+)$/)?.[1] || 0);
  if (idNumber) return idNumber;

  const createdTime = Date.parse(load.createdAt || '');
  if (!Number.isNaN(createdTime)) return createdTime;

  const loadDateTime = Date.parse(`${load.loadDate || ''}T12:00:00`);
  return Number.isNaN(loadDateTime) ? 0 : loadDateTime;
};

const sortLoadsNewestFirst = (a, b) => getNewestLoadSortValue(b) - getNewestLoadSortValue(a);
    
const viewFilteredLoadsData =
  activeView === 'driver'
    ? (loadsData || []).filter((load) => {
        const status = String(load.status || '').trim().toLowerCase();
        const matchesDriver = driverMatchesCurrentUser(load.driver, currentUser);

        return matchesDriver && !['delivered', 'dropped'].includes(status);
      })
    : baseFilteredLoadsData;

const filteredLoadsData = viewFilteredLoadsData.filter((load) => {
  if (!normalizedSearchTerm) return true;
  const loadName = String(load.name || '').trim().toLowerCase();
  const loadCustomer = String(load.customer || '').trim().toLowerCase();
  const loadDriver = String(getDriverLabel(load.driver) || load.driver || '').trim().toLowerCase();
  const loadReference = String(load.referenceNumber || '').trim().toLowerCase();
  const loadPo = String(load.poNumber || '').trim().toLowerCase();
  const loadPickupNumber = String(load.pickupNumber || '').trim().toLowerCase();
  const loadContainer = String(load.containerNumber || '').trim().toLowerCase();
  const loadBooking = String(load.bookingNumber || '').trim().toLowerCase();
  return (
    loadName.includes(normalizedSearchTerm) ||
    loadCustomer.includes(normalizedSearchTerm) ||
    loadDriver.includes(normalizedSearchTerm) ||
    loadReference.includes(normalizedSearchTerm) ||
    loadPo.includes(normalizedSearchTerm) ||
    loadPickupNumber.includes(normalizedSearchTerm) ||
    loadContainer.includes(normalizedSearchTerm) ||
    loadBooking.includes(normalizedSearchTerm)
  );
}).sort(sortLoadsNewestFirst);

const getDispatchLoadPaperworkLabel = (load) => {
  const hasPod = load.documents?.some(
    (doc) => (doc.category || '').trim().toUpperCase() === 'POD'
  );
  const hasInEir = load.documents?.some(
    (doc) => (doc.category || '').trim().toUpperCase() === 'IN EIR'
  );
  const hasOutEir = load.documents?.some(
    (doc) => (doc.category || '').trim().toUpperCase() === 'OUT EIR'
  );

  if (hasPod && hasInEir && hasOutEir) return 'Complete';
  if (hasPod || hasInEir || hasOutEir) return 'Partial';
  return 'Missing';
};

const handleDispatchColumnDragStart = (event, columnKey) => {
  setDraggedDispatchColumn(columnKey);
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', columnKey);
};

const handleDispatchColumnDrop = (event, targetColumnKey) => {
  event.preventDefault();
  const sourceColumnKey = event.dataTransfer.getData('text/plain') || draggedDispatchColumn;
  setDraggedDispatchColumn('');

  if (!sourceColumnKey || sourceColumnKey === targetColumnKey) return;

  setDispatchColumnOrder((prev) => {
    const nextOrder = getValidDispatchColumnOrder(prev);
    const sourceIndex = nextOrder.indexOf(sourceColumnKey);
    const targetIndex = nextOrder.indexOf(targetColumnKey);

    if (sourceIndex < 0 || targetIndex < 0) return nextOrder;

    const [movedColumn] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, movedColumn);
    return nextOrder;
  });
};

const dispatchLoadColumnsByKey = {
  loadDate: {
    label: 'Date',
    render: (load) => load.loadDate || '-',
  },
  customer: {
    label: 'Broker',
    render: (load) => load.customer || '-',
  },
  containerNumber: {
    label: 'Container',
    render: (load) => (
      <button
        type="button"
        className="container-link"
        onClick={(event) => {
          event.stopPropagation();
          setSelectedLoad(load);
          setIsEditing(false);
        }}
      >
        {load.containerNumber || 'Open load'}
      </button>
    ),
  },
  bookingNumber: {
    label: 'Booking #',
    render: (load) => load.bookingNumber || '-',
  },
  containerSize: {
    label: 'Size',
    render: (load) => load.containerSize || '-',
  },
  shipLine: {
    label: 'Ship Line',
    render: (load) => load.shipLine || '-',
  },
  pickup: {
    label: 'Pickup',
    render: (load) => shortLocation(load.pickup),
  },
  delivery: {
    label: 'Delivery',
    render: (load) => getDeliveryDisplay(load.delivery) || '-',
  },
  appointmentTime: {
    label: 'Appointment',
    render: (load) => formatAppointmentTime(load.appointmentTime),
  },
  driver: {
    label: 'Driver',
    render: (load) => (load.driver ? getDriverLabel(load.driver) : 'Not Assigned'),
  },
  eta: {
    label: 'ETA',
    render: (load) => formatAppointmentTime(load.eta),
  },
  status: {
    label: 'Status',
    render: (load) => {
      const displayStatus = getLoadQuickStatus(load);
      return (
        <span className={`sheet-status ${String(displayStatus || '').toLowerCase().replace(/\s/g, '-')}`}>
          {displayStatus || '-'}
        </span>
      );
    },
  },
  referenceNumber: {
    label: 'Ref #',
    render: (load) => load.referenceNumber || '-',
  },
  poNumber: {
    label: 'PO #',
    render: (load) => load.poNumber || '-',
  },
  pickupNumber: {
    label: 'Pick Up #',
    render: (load) => load.pickupNumber || '-',
  },
  paperwork: {
    label: 'Paperwork',
    render: (load) => {
      const paperworkLabel = getDispatchLoadPaperworkLabel(load);
      return (
        <span className={`sheet-paperwork ${paperworkLabel.toLowerCase()}`}>
          {paperworkLabel}
        </span>
      );
    },
  },
};

const orderedDispatchLoadColumns = dispatchColumnOrder
  .map((key) => ({ key, ...dispatchLoadColumnsByKey[key] }))
  .filter((column) => column.label);
const getSelectedLocationIdForField = (field, options = []) =>
  (options || []).find((loc) => formatLocationAddress(loc) === newLoad[field])?.id || '';

const getFilteredLocationOptions = (field, options = []) => {
  const term = String(newLoad[field] || '').trim().toLowerCase();
  const cleanOptions = Array.isArray(options) ? options : [];
  if (!term) return cleanOptions.slice(0, 8);

  return cleanOptions
    .filter((loc) => {
      const label = getLocationOptionLabel(loc).toLowerCase();
      const address = formatLocationAddress(loc).toLowerCase();
      return label.includes(term) || address.includes(term);
    })
    .slice(0, 8);
};

const renderLocationSearchField = ({
  field,
  label,
  options,
  placeholder,
  emptyText = 'No saved locations found.',
  allowDelete = false,
}) => {
  const selectedLocationId = getSelectedLocationIdForField(field, options);
  const filteredOptions = getFilteredLocationOptions(field, options);
  const isOpen = activeLocationPicker === field;
  const inputId = `location-search-${field}`;
  const menuId = `${inputId}-menu`;

  return (
    <div className="location-search-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="location-search-row">
        <input
          id={inputId}
          type="text"
          name={field}
          value={newLoad[field] || ''}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={menuId}
          onFocus={() => setActiveLocationPicker(field)}
          onBlur={() => window.setTimeout(() => {
            setActiveLocationPicker((current) => (current === field ? '' : current));
          }, 160)}
          onChange={(e) => {
            setNewLoad((prev) => ({ ...prev, [field]: e.target.value }));
            setActiveLocationPicker(field);
          }}
        />
        {allowDelete && (
          <button
            type="button"
            className="secondary-btn compact-btn danger-btn location-delete-btn"
            onClick={async () => {
              if (!selectedLocationId) return;
              await handleDeleteLocation(selectedLocationId);
              setNewLoad((prev) => ({ ...prev, [field]: '' }));
            }}
            disabled={!selectedLocationId}
            title={`Delete selected ${label.toLowerCase()}`}
            aria-label={`Delete selected ${label.toLowerCase()}`}
          >
            X
          </button>
        )}
      </div>
      {isOpen && (
        <div id={menuId} className="location-search-menu" role="listbox">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((loc) => (
              <button
                key={loc.id}
                type="button"
                className="location-search-option"
                role="option"
                aria-selected={formatLocationAddress(loc) === newLoad[field]}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  handleSelectSavedLocation(field, loc.id);
                  setActiveLocationPicker('');
                }}
              >
                <strong>{loc.name || getLocationOptionLabel(loc)}</strong>
                <span>{formatLocationAddress(loc)}</span>
              </button>
            ))
          ) : (
            <div className="location-search-empty">{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
};
const activeLoads = filteredLoadsData.length;

const driverInTransitLoads = filteredLoadsData.filter(
  (l) => (l.status || '').toLowerCase() === 'in transit'
).length;

const driverDeliveredLoads = loadsData.filter((l) => {
  return (
    driverMatchesCurrentUser(l.driver, currentUser) &&
    String(l.status || '').trim().toLowerCase() === 'delivered'
  );
}).length;

const refreshLoadsData = async () => {
  if (!authToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/loads`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load loads');
    }

    const loadsWithPaperwork = normalizeLoadedLoads(data);
    detectLoadNotifications(loadsWithPaperwork);
    setLoadsData(loadsWithPaperwork);
  } catch (error) {
    console.error('Error refreshing loads:', error);
  }
};

const sendDriverLocation = async (position) => {
  if (!authToken || currentUser?.role !== 'driver') return;

  const payload = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    heading: position.coords.heading,
    speed: position.coords.speed,
    source: isDriverApp ? 'android-driver-app' : 'driver-web',
  };

  setDriverLastLocation({
    ...payload,
    updatedAt: new Date().toISOString(),
  });

  try {
    const res = await fetch(`${API_BASE}/api/driver-location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to share location');
    }

    setDriverTrackingStatus(`Tracking on • ${formatRelativeTime(data.updatedAt)}`);
  } catch (error) {
    console.error('Failed to share driver location:', error);
    setDriverTrackingStatus(`Tracking paused: ${error.message}`);
  }
};

const stopDriverTracking = () => {
  if (driverWatchRef.current && navigator.geolocation) {
    navigator.geolocation.clearWatch(driverWatchRef.current);
  }

  driverWatchRef.current = null;
  setDriverTrackingEnabled(false);
  setDriverTrackingStatus('Location sharing is off.');
  setDriverTrackingHelp('');
};

const startDriverTracking = () => {
  if (!navigator.geolocation) {
    setDriverTrackingStatus('This phone does not support location sharing.');
    setDriverTrackingHelp('');
    return;
  }

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    setDriverTrackingEnabled(false);
    setDriverTrackingStatus('iPhone requires the secure HTTPS driver link to allow location.');
    setDriverTrackingHelp('Open https://portflow-dashboard.onrender.com/driver on the phone, then tap Start again.');
    return;
  }

  setDriverTrackingStatus('Requesting phone location permission...');
  setDriverTrackingHelp('When the iPhone popup appears, tap Allow While Using App or Allow.');
  setDriverTrackingEnabled(true);

  const trackingOptions = {
    enableHighAccuracy: true,
    maximumAge: 15000,
    timeout: 20000,
  };

  const handleTrackingError = (error) => {
    if (driverWatchRef.current && navigator.geolocation) {
      navigator.geolocation.clearWatch(driverWatchRef.current);
    }

    driverWatchRef.current = null;
    setDriverTrackingEnabled(false);
    setDriverTrackingStatus(
      error.code === error.PERMISSION_DENIED
        ? 'Location permission is blocked for this site.'
        : `Location unavailable: ${error.message}`
    );
    setDriverTrackingHelp(
      error.code === error.PERMISSION_DENIED
        ? 'On iPhone: Settings > Privacy & Security > Location Services > Safari Websites > Allow or Ask Next Time. Then reopen PortFlow and tap Start.'
        : 'Check that Location Services are on, then tap Start again.'
    );
  };

  navigator.geolocation.getCurrentPosition(
    (position) => {
      sendDriverLocation(position);
      setDriverTrackingHelp('');
      driverWatchRef.current = navigator.geolocation.watchPosition(
        (nextPosition) => {
          sendDriverLocation(nextPosition);
        },
        handleTrackingError,
        trackingOptions
      );
    },
    handleTrackingError,
    trackingOptions
  );
};

useEffect(() => {
  return () => {
    if (driverWatchRef.current && navigator.geolocation) {
      navigator.geolocation.clearWatch(driverWatchRef.current);
    }
  };
}, []);

const getDriverLoadAssignmentOrder = (load = {}) => {
  const idNumber = Number(String(load.id || '').match(/(\d+)$/)?.[1] || 0);
  if (idNumber) return idNumber;

  const createdTime = Date.parse(load.createdAt || '');
  if (!Number.isNaN(createdTime)) return createdTime;

  const loadDateTime = Date.parse(`${load.loadDate || ''}T12:00:00`);
  return Number.isNaN(loadDateTime) ? Number.MAX_SAFE_INTEGER : loadDateTime;
};

const getDriverLoadAppointmentOrder = (load = {}) => {
  const rawAppointment = String(load.appointmentTime || '').trim();
  if (!rawAppointment) return Number.MAX_SAFE_INTEGER;

  const appointmentTime = Date.parse(rawAppointment);
  return Number.isNaN(appointmentTime) ? Number.MAX_SAFE_INTEGER : appointmentTime;
};

const getDriverLoadStatusOrder = (load = {}) => {
  const status = String(load.status || '').trim().toLowerCase();
  if (status === 'in transit') return 0;
  if (status === 'dispatched') return 1;
  return 2;
};

const sortDriverLoads = (loads = []) =>
  [...loads].sort((a, b) => {
    const statusCompare = getDriverLoadStatusOrder(a) - getDriverLoadStatusOrder(b);
    if (statusCompare !== 0) return statusCompare;

    const appointmentCompare = getDriverLoadAppointmentOrder(a) - getDriverLoadAppointmentOrder(b);
    if (appointmentCompare !== 0) return appointmentCompare;

    return getDriverLoadAssignmentOrder(a) - getDriverLoadAssignmentOrder(b);
  });

const driverActiveLoads = sortDriverLoads((loadsData || []).filter((load) => {
  const status = String(load.status || '').trim().toLowerCase();
  return driverMatchesCurrentUser(load.driver, currentUser) && !['delivered', 'dropped'].includes(status);
}));

const driverCompletedLoads = sortDriverLoads((loadsData || []).filter((load) => {
  const status = String(load.status || '').trim().toLowerCase();
  return driverMatchesCurrentUser(load.driver, currentUser) && status === 'delivered';
}));

const driverNeedsDocsLoads = driverActiveLoads.filter((load) => !hasRequiredDriverDocuments(load));
const driverVisibleLoads =
  driverMobileTab === 'paperwork'
    ? driverNeedsDocsLoads
    : driverMobileTab === 'completed'
    ? driverCompletedLoads
    : driverActiveLoads;

const activeLoadsByDriver = useMemo(() => {
  return (loadsData || []).reduce((groups, load) => {
    const status = String(load.status || '').trim().toLowerCase();
    if (['delivered', 'completed'].includes(status)) return groups;

    const driverId = normalizeDriverForStorage(load.driver);
    if (!driverId) return groups;

    groups[driverId] = groups[driverId] || [];
    groups[driverId].push(load);
    return groups;
  }, {});
}, [loadsData, driversList]);

const trackedDriverLocations = liveDriverLocations
  .map((location) => ({
    ...location,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    activeLoads: activeLoadsByDriver[location.driverId] || [],
  }))
  .filter((location) => Number.isFinite(location.latitude) && Number.isFinite(location.longitude));

useEffect(() => {
  if (!driverMapRef.current || !window.google?.maps || trackedDriverLocations.length === 0) return;

  if (!driverMapInstanceRef.current) {
    driverMapInstanceRef.current = new window.google.maps.Map(driverMapRef.current, {
      center: {
        lat: trackedDriverLocations[0].latitude,
        lng: trackedDriverLocations[0].longitude,
      },
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
  }

  const bounds = new window.google.maps.LatLngBounds();
  const activeMarkerIds = new Set();

  trackedDriverLocations.forEach((location) => {
    const position = { lat: location.latitude, lng: location.longitude };
    activeMarkerIds.add(location.driverId);
    bounds.extend(position);

    if (!driverMapMarkersRef.current[location.driverId]) {
      driverMapMarkersRef.current[location.driverId] = new window.google.maps.Marker({
        map: driverMapInstanceRef.current,
        position,
        label: {
          text: String(location.driverName || location.driverId || '?').slice(0, 1).toUpperCase(),
          color: '#ffffff',
          fontWeight: '800',
        },
      });
    }

    const marker = driverMapMarkersRef.current[location.driverId];
    marker.setPosition(position);
    marker.setTitle(`${location.driverName || location.driverId} • ${formatRelativeTime(location.updatedAt)}`);
  });

  Object.entries(driverMapMarkersRef.current).forEach(([driverId, marker]) => {
    if (!activeMarkerIds.has(driverId)) {
      marker.setMap(null);
      delete driverMapMarkersRef.current[driverId];
    }
  });

  if (!driverMapHasFitRef.current) {
    if (trackedDriverLocations.length === 1) {
      driverMapInstanceRef.current.setCenter(bounds.getCenter());
      driverMapInstanceRef.current.setZoom(12);
    } else {
      driverMapInstanceRef.current.fitBounds(bounds, 48);
    }
    driverMapHasFitRef.current = true;
  }
}, [trackedDriverLocations]);

const getDriverStatusClass = (status) =>
  String(status || 'assigned')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

const NotificationStack = () =>
  appNotifications.length > 0 ? (
    <div className="app-notification-stack" aria-live="polite">
      {appNotifications.map((notice) => (
        <section key={notice.id} className={`app-notification notice-${notice.type}`}>
          <div>
            <strong>{notice.title}</strong>
            <p>{notice.message}</p>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() =>
              setAppNotifications((prev) => prev.filter((item) => item.id !== notice.id))
            }
          >
            x
          </button>
        </section>
      ))}
    </div>
  ) : null;

const DriverLoadCard = ({ load }) => {
  const selectedFile = uploadFileByLoad[load.id] || uploadFileRef.current[load.id];
  const uploadStatus = driverUploadStatusByLoad[load.id];
  const missingDocuments = getMissingDriverDocuments(load);
  const paperworkComplete = hasRequiredDriverDocuments(load);
  const driverDestination = getDriverDestination(load);
  const driverDestinationLabel = getLoadNextMoveType(load) === 'Return' ? 'Return Destination' : 'Delivery';

  return (
    <article className="driver-load-card">
      <div className="driver-load-card-header">
        <div>
          <span className="driver-card-kicker">Load {load.id}</span>
          <h3>{load.referenceNumber || load.poNumber || load.bookingNumber || 'No reference'}</h3>
        </div>
        <span className={`driver-status-pill status-${getDriverStatusClass(load.status)}`}>
          {load.status || 'Assigned'}
        </span>
      </div>

      <div className="driver-info-grid">
        <div className="driver-info-item wide">
          <span>Pickup</span>
          {load.pickup ? (
            <a href={getGoogleMapsLink(load.pickup)} target="_blank" rel="noopener noreferrer">
              {load.pickup}
            </a>
          ) : (
            <strong>-</strong>
          )}
        </div>
        <div className="driver-info-item wide">
          <span>{driverDestinationLabel}</span>
          {driverDestination ? (
            <a href={getGoogleMapsLink(driverDestination)} target="_blank" rel="noopener noreferrer">
              {getLoadNextMoveType(load) === 'Return'
                ? driverDestination
                : getDeliveryDisplay(driverDestination)}
            </a>
          ) : (
            <strong>-</strong>
          )}
        </div>
        <div className="driver-info-item">
          <span>Appointment</span>
          <strong>{formatAppointmentTime(load.appointmentTime)}</strong>
        </div>
        <div className="driver-info-item">
          <span>Container</span>
          <strong>{load.containerNumber || '-'}</strong>
        </div>
        <div className="driver-info-item">
          <span>Size</span>
          <strong>{load.containerSize || '-'}</strong>
        </div>
        <div className="driver-info-item">
          <span>Ship Line</span>
          <strong>{load.shipLine || '-'}</strong>
        </div>
        <div className="driver-info-item">
          <span>Chassis</span>
          <strong>{load.chassisNumber || '-'}</strong>
        </div>
        <div className="driver-info-item">
          <span>Driver Pay</span>
          <strong>{load.driverRate ? formatMoney(getDriverPayWithDetention(load)) : '-'}</strong>
        </div>
        <div className="driver-info-item">
          <span>PO #</span>
          <strong>{load.poNumber || '-'}</strong>
        </div>
        <div className="driver-info-item">
          <span>Booking #</span>
          <strong>{load.bookingNumber || '-'}</strong>
        </div>
        <div className="driver-info-item">
          <span>Pick Up #</span>
          <strong>{load.pickupNumber || '-'}</strong>
        </div>
        <div className="driver-info-item">
          <span>Reservation</span>
          <strong>{load.reservationNumber || '-'}</strong>
        </div>
        <div className="driver-info-item">
          <span>Return</span>
          <strong>{load.returnNumber || '-'}</strong>
        </div>
      </div>

      {load.returnLocation && (
        <a
          className="driver-map-link"
          href={getGoogleMapsLink(load.returnLocation)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open return location
        </a>
      )}

      <div className="driver-container-update">
        <label htmlFor={`container-${load.id}`}>Container Number</label>
        <input
          id={`container-${load.id}`}
          type="text"
          placeholder={load.containerNumber ? 'Container number saved' : 'Enter container number'}
          defaultValue=""
          disabled={Boolean(load.containerNumber)}
          onChange={(e) => setDriverEquipmentDraft(load.id, 'containerNumber', e.target.value)}
        />
        <label htmlFor={`chassis-${load.id}`}>Chassis Number</label>
        <input
          id={`chassis-${load.id}`}
          type="text"
          placeholder={load.chassisNumber ? 'Update chassis number' : 'Enter chassis number'}
          defaultValue=""
          onChange={(e) => setDriverEquipmentDraft(load.id, 'chassisNumber', e.target.value)}
        />
        <button type="button" onClick={() => handleDriverContainerUpdate(load.id)}>
          Save Equipment
        </button>
      </div>

      <div className="driver-status-actions" aria-label="Load status actions">
        <button type="button" onClick={() => handleDriverStatusUpdate(load.id, 'In Transit')}>
          Start
        </button>
        <button type="button" onClick={() => handleDriverStatusUpdate(load.id, 'Dropped')}>
          Dropped
        </button>
        <button
          type="button"
          onClick={() => handleDriverStatusUpdate(load.id, 'Delivered')}
          disabled={!paperworkComplete}
        >
          Complete
        </button>
      </div>

      <section className="driver-paperwork-panel">
        <div className="driver-paperwork-header">
          <div>
            <span>Paperwork</span>
            <strong>{paperworkComplete ? 'Ready to complete' : `Missing ${missingDocuments.join(', ')}`}</strong>
          </div>
          <span className={paperworkComplete ? 'status-pill active' : 'status-pill inactive'}>
            {paperworkComplete ? 'Done' : 'Needed'}
          </span>
        </div>

        <select
          value={uploadDocType[load.id] || 'POD'}
          onChange={(e) =>
            setUploadDocType((prev) => ({
              ...prev,
              [load.id]: e.target.value,
            }))
          }
        >
          <option value="POD">POD</option>
          <option value="IN EIR">IN EIR</option>
          <option value="OUT EIR">OUT EIR</option>
          <option value="OTHER">Other</option>
        </select>

        <div className="driver-upload-actions">
          <button type="button" className="driver-upload-label driver-camera-button" onClick={() => openDriverCamera(load.id)}>
            Scan Document
          </button>

          <label className="driver-upload-label" htmlFor={`upload-${load.id}`}>
            Choose File
          </label>
          <input
            id={`upload-${load.id}`}
            type="file"
            accept="image/*,.pdf"
            className="driver-native-file-input"
            onChange={(e) =>
              handleDriverUploadFileChange(load.id, e.target.files?.[0] || null, 'file picker')
            }
          />
        </div>

        <p className="driver-upload-name">{getUploadSelectionLabel(selectedFile)}</p>
        {uploadStatus && <p className="driver-upload-debug">{uploadStatus}</p>}

        <button type="button" className="driver-upload-submit" onClick={() => handleDriverDocumentUpload(load.id)}>
          Upload Document
        </button>
      </section>
    </article>
  );
};

if ((isDriverApp || activeView === 'driver') && currentUser?.role === 'driver') {
  return (
    <main className="driver-mobile-shell">
      <header className="driver-app-header">
        <div>
          <span className="driver-app-eyebrow">PortFlow Driver</span>
          <h1>{currentUser?.name || 'Driver'}</h1>
          <p>{currentUser?.email}</p>
        </div>
        <button type="button" onClick={handleLogout} aria-label="Log out">
          Exit
        </button>
      </header>

      <NotificationStack />

      {driverCameraLoadId && (
        <section className="driver-camera-modal" aria-label="PortFlow document scanner">
          <div className="driver-camera-box">
            <div className="driver-camera-header">
              <div>
                <strong>{driverScannerPreview ? 'Review Scan' : 'Scan Document'}</strong>
                <span>Load {driverCameraLoadId}</span>
              </div>
              <button type="button" onClick={closeDriverCamera}>Close</button>
            </div>
            {driverScannerPreview ? (
              <div className="driver-scanner-preview">
                <img src={driverScannerPreview.dataUrls?.[0]} alt="Processed scanned document preview" />
                {driverScannerPreview.dataUrls?.length > 1 && (
                  <p>{driverScannerPreview.dataUrls.length} scanned pages ready</p>
                )}
              </div>
            ) : (
              <div className="driver-scanner-camera-frame">
                <video ref={driverCameraVideoRef} autoPlay playsInline muted />
                <div className="driver-scanner-overlay" aria-hidden="true">
                  <div className="driver-scanner-guide">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            )}
            {driverCameraError && <p className="driver-camera-error">{driverCameraError}</p>}
            {driverScannerPreview ? (
              <div className="driver-scanner-actions">
                <button type="button" className="driver-camera-retake" onClick={retakeDriverScannerPhoto}>
                  Retake
                </button>
                <button
                  type="button"
                  className="driver-camera-retake"
                  onClick={useDriverScannerPreview}
                  disabled={driverScannerUploading}
                >
                  Use Scan
                </button>
                <button
                  type="button"
                  className="driver-camera-capture"
                  onClick={confirmAndUploadDriverScannerPreview}
                  disabled={driverScannerUploading}
                >
                  {driverScannerUploading ? 'Uploading...' : 'Confirm & Upload'}
                </button>
              </div>
            ) : (
              <button type="button" className="driver-camera-capture" onClick={captureDriverCameraPhoto}>
                Capture Scan
              </button>
            )}
          </div>
        </section>
      )}

      <section className="driver-metrics-row" aria-label="Driver load summary">
        <div>
          <span>Active</span>
          <strong>{driverActiveLoads.length}</strong>
        </div>
        <div>
          <span>In Transit</span>
          <strong>{driverInTransitLoads}</strong>
        </div>
        <div>
          <span>Done</span>
          <strong>{driverDeliveredLoads}</strong>
        </div>
      </section>

      <section className="driver-tracking-card">
        <div>
          <span>Live tracking</span>
          <strong>{driverTrackingEnabled ? 'Sharing location' : 'Off'}</strong>
          <p>{driverLastLocation ? `Last sent ${formatRelativeTime(driverLastLocation.updatedAt)}` : driverTrackingStatus}</p>
          {driverTrackingHelp && <p className="driver-tracking-help">{driverTrackingHelp}</p>}
        </div>
        <button
          type="button"
          className={driverTrackingEnabled ? 'tracking-stop-btn' : ''}
          onClick={driverTrackingEnabled ? stopDriverTracking : startDriverTracking}
        >
          {driverTrackingEnabled ? 'Stop' : 'Start'}
        </button>
      </section>

      <nav className="driver-tab-bar" aria-label="Driver load tabs">
        <button
          type="button"
          className={driverMobileTab === 'active' ? 'active' : ''}
          onClick={() => setDriverMobileTab('active')}
        >
          Active
        </button>
        <button
          type="button"
          className={driverMobileTab === 'paperwork' ? 'active' : ''}
          onClick={() => setDriverMobileTab('paperwork')}
        >
          Paperwork
        </button>
        <button
          type="button"
          className={driverMobileTab === 'completed' ? 'active' : ''}
          onClick={() => setDriverMobileTab('completed')}
        >
          Completed
        </button>
        <button
          type="button"
          className={driverMobileTab === 'fuel' ? 'active' : ''}
          onClick={() => setDriverMobileTab('fuel')}
        >
          Fuel
        </button>
      </nav>

      {driverMobileTab === 'fuel' ? (
        <section className="driver-fuel-panel">
          <div className="driver-paperwork-header">
            <div>
              <span>Fuel</span>
              <strong>Add Fuel Purchase</strong>
            </div>
            <span className="status-pill active">
              {formatMoney(getFuelPricePerGallon())}/gal
            </span>
          </div>

          <form className="driver-fuel-form" onSubmit={handleFuelSubmit}>
            <label>
              <span>Total Amount ($)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={fuelForm.amountPaid}
                onChange={(e) => setFuelForm((prev) => ({ ...prev, amountPaid: e.target.value }))}
                placeholder="0.00"
                required
              />
            </label>
            <label>
              <span>Gallons</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.001"
                value={fuelForm.gallons}
                onChange={(e) => setFuelForm((prev) => ({ ...prev, gallons: e.target.value }))}
                placeholder="0.000"
                required
              />
            </label>
            <label>
              <span>Truck Number</span>
              <input
                type="text"
                value={fuelForm.truckId}
                onChange={(e) => setFuelForm((prev) => ({ ...prev, truckId: e.target.value }))}
                placeholder={getDriverDefaultTruck() || 'Truck / Unit'}
              />
            </label>
            <label>
              <span>Station Name</span>
              <input
                type="text"
                value={fuelForm.fuelStation}
                onChange={(e) => setFuelForm((prev) => ({ ...prev, fuelStation: e.target.value }))}
                placeholder="Fuel station"
              />
            </label>
            <label>
              <span>Load Number</span>
              <select
                value={fuelForm.loadNumber}
                onChange={(e) => setFuelForm((prev) => ({ ...prev, loadNumber: e.target.value }))}
              >
                <option value="">No load selected</option>
                {driverActiveLoads.map((load) => (
                  <option key={load.id} value={load.id}>
                    {load.id} - {load.containerNumber || load.referenceNumber || 'Load'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Date / Time</span>
              <input
                type="datetime-local"
                value={normalizeDateTimeInputValue(fuelForm.dateTime)}
                onChange={(e) => setFuelForm((prev) => ({ ...prev, dateTime: e.target.value }))}
              />
            </label>

            <div className="driver-fuel-total">
              <span>Price Per Gallon</span>
              <strong>{formatMoney(getFuelPricePerGallon())}</strong>
            </div>

            <div className="driver-upload-actions">
              <button type="button" className="driver-upload-label driver-camera-button" onClick={startFuelReceiptScan}>
                Scan Receipt
              </button>
              <label className="driver-upload-label" htmlFor="fuel-receipt-upload">
                Choose Receipt
              </label>
              <input
                id="fuel-receipt-upload"
                type="file"
                accept="image/*,.pdf"
                className="driver-native-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setFuelReceiptFile(file);
                  setFuelStatus(file ? `Receipt ready: ${file.name}` : 'No receipt selected.');
                }}
              />
            </div>

            <p className="driver-upload-name">
              {fuelReceiptFile?.name || 'No receipt selected'}
            </p>
            {fuelStatus && <p className="driver-upload-debug">{fuelStatus}</p>}

            <button type="submit" className="driver-upload-submit" disabled={fuelSubmitting}>
              {fuelSubmitting ? 'Saving...' : 'Save Fuel'}
            </button>
          </form>

          <div className="driver-fuel-history">
            <div className="driver-paperwork-header">
              <div>
                <span>History</span>
                <strong>{fuelTransactions.length} fuel records</strong>
              </div>
            </div>
            {fuelTransactions.length === 0 ? (
              <p className="driver-upload-name">No fuel purchases saved yet.</p>
            ) : (
              fuelTransactions.slice(0, 8).map((fuel) => (
                <div key={fuel.id} className="driver-fuel-row">
                  <div>
                    <strong>{formatMoney(fuel.amountPaid)} / {Number(fuel.gallons || 0).toFixed(2)} gal</strong>
                    <span>{fuel.fuelStation || 'Fuel station'} - {formatDateTime(fuel.dateTime)}</span>
                  </div>
                  {fuel.receiptImageUrl && (
                    <button type="button" onClick={() => handleOpenFuelReceipt(fuel)}>
                      Receipt
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      ) : driverVisibleLoads.length === 0 ? (
        <section className="driver-empty-state">
          <strong>No loads here.</strong>
          <p>{driverMobileTab === 'paperwork' ? 'Paperwork is caught up.' : 'Assigned loads will appear here.'}</p>
        </section>
      ) : (
        <div className="driver-load-list">
          {driverVisibleLoads.map((load) => (
            <DriverLoadCard key={load.id} load={load} />
          ))}
        </div>
      )}
    </main>
  );
}

    if ((isDriverApp || activeView === 'driver') && currentUser?.role === 'driver') {
  return (
    <div
  className={isDriverApp ? 'driver-mobile-shell' : ''}
  style={{
    backgroundColor: '#ffffff',
    color: '#111827',
    borderRadius: '16px',
    padding: '18px',
    marginBottom: '18px',
    boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
  }}
>
      <div
  style={{
    backgroundColor: '#111827',
    color: '#fff',
    borderRadius: '16px',
    padding: '18px',
    marginBottom: '18px',
    boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
  }}
>
  <h2
  style={{
    margin: 0,
    fontSize: '28px',
    fontWeight: '700',
    color: '#ffffff',
  }}
>
  🚛 Driver Portal
</h2>

  <p
    style={{
      marginTop: '8px',
      marginBottom: 0,
      color: '#ffffff',
      fontSize: '15px',
      fontWeight: '500',
    }}
  >
    Welcome, {currentUser?.name || currentUser?.email}
  </p>
</div>
      
      <button
  onClick={handleLogout}
  style={{
    marginTop: '10px',
    padding: '8px 12px',
    backgroundColor: '#dc3545',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  }}
>
  Logout
</button>

      {viewFilteredLoadsData.length === 0 ? (
        <p>No loads assigned.</p>
      ) : (
        <div className="load-list">
          {viewFilteredLoadsData.map((load) => (
            <div
              key={load.id}
              
              className="load-card"
              style={{
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  padding: '16px',
  marginBottom: '16px',
  backgroundColor: '#ffffff',
  boxShadow: '0 4px 10px rgba(0,0,0,0.05)',
}}
            >
             <h3
  style={{
    marginBottom: '12px',
    fontSize: '20px',
    fontWeight: '700',
    color: '#1f2937',
  }}
>
  Reference #: {load.referenceNumber || '-'}
</h3>
<div
  style={{
    marginBottom: '8px',
    color: '#4b5563',
    fontSize: '14px',
  }}
>
  <div
    style={{
      height: '1px',
      backgroundColor: '#e5e7eb',
      margin: '10px 0',
    }}
  />
  <p><strong>Booking #:</strong> {load.bookingNumber || '-'}</p>
  <p>
    🚛 <strong>Container:</strong><br />
    {load.containerNumber || '-'}
    {load.containerSize ? ` (${load.containerSize})` : ''}
  </p>

  <div className="driver-container-update">
    <label htmlFor={`container-${load.id}`}>Container Number</label>
    <input
      id={`container-${load.id}`}
      type="text"
      placeholder={load.containerNumber ? 'Container number saved' : 'Enter container number'}
      defaultValue=""
      disabled={Boolean(load.containerNumber)}
      onChange={(e) => setDriverEquipmentDraft(load.id, 'containerNumber', e.target.value)}
    />
    <label htmlFor={`chassis-${load.id}`}>Chassis Number</label>
    <input
      id={`chassis-${load.id}`}
      type="text"
      placeholder={load.chassisNumber ? 'Update chassis number' : 'Enter chassis number'}
      defaultValue=""
      onChange={(e) => setDriverEquipmentDraft(load.id, 'chassisNumber', e.target.value)}
    />
    <button type="button" onClick={() => handleDriverContainerUpdate(load.id)}>
      Save Equipment
    </button>
  </div>

  <p>
    <strong>Container Size:</strong> {load.containerSize || '-'}
  </p>
  <p>
    <strong>Chassis #:</strong> {load.chassisNumber || '-'}
  </p>
</div>
<p
  style={{
    marginBottom: '8px',
    color: '#4b5563',
    fontSize: '14px',
  }}
>
   🚢 <strong>Ship Line:</strong><br /> {load.shipLine || '-'}
</p>
<p
  style={{
    marginBottom: '8px',
    color: '#4b5563',
    fontSize: '14px',
  }}
>

 📍 <strong>Pick Up Location:</strong><br />
  {load.pickup ? (
    <a
      href={getGoogleMapsLink(load.pickup)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {load.pickup}
    </a>
  ) : (
    '-'
  )}
</p>
<div
  style={{
    marginBottom: '8px',
    color: '#4b5563',
    fontSize: '14px',
  }}
>
  <p>🔢 <strong>Reservation #:</strong> {load.reservationNumber || '-'}</p>
  <p>
    📦 <strong>Delivery Location:</strong><br />
    {load.delivery ? (
      <a
        href={getGoogleMapsLink(load.delivery)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {getDeliveryDisplay(load.delivery)}
      </a>
    ) : (
      '-'
    )}
  </p>
</div>
<div
  style={{
    marginBottom: '8px',
    color: '#4b5563',
    fontSize: '14px',
  }}
>
  <p>🔢 <strong>Return #:</strong> {load.returnNumber || '-'}</p>
  <p>
    🔁 <strong>Return Location:</strong><br />
    {load.returnLocation ? (
      <a
        href={getGoogleMapsLink(load.returnLocation)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {load.returnLocation}
      </a>
    ) : (
      '-'
    )}
  </p>
</div>
<div
  style={{
    marginTop: '10px',
    padding: '10px',
    borderRadius: '10px',
    backgroundColor: '#f9fafb',
  }}
>
  <p style={{ fontWeight: '600', marginBottom: '4px' }}>
    📅 Appointment
  </p>
  <p style={{ margin: 0, color: '#374151' }}>
    {formatAppointmentTime(load.appointmentTime)}
  </p>
</div>
<p
  style={{
    marginBottom: '8px',
    color: '#4b5563',
    fontSize: '14px',
  }}
>
  <strong>Driver Pay:</strong>{' '}
  <span style={{ color: '#16a34a', fontWeight: '700' }}>
    {load.driverRate
      ? `$${parseFloat(load.driverRate).toFixed(2)}`
      : '-'}
  </span>
</p>
<div
  style={{
    marginBottom: '8px',
    color: '#4b5563',
    fontSize: '14px',
  }}
>
  <p style={{ marginTop: '10px' }}>
    🚦<strong>Status:</strong>{' '}
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: '700',
        backgroundColor:
          load.status === 'Delivered'
            ? '#dcfce7'
            : load.status === 'In Transit'
            ? '#dbeafe'
            : '#f3f4f6',
        color:
          load.status === 'Delivered'
            ? '#166534'
            : load.status === 'In Transit'
            ? '#1d4ed8'
            : '#374151',
      }}
    >
      {load.status || '-'}
    </span>
  </p>
</div>
<div style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
  <button
    type="button"
    onClick={() => handleDriverStatusUpdate(load.id, 'In Transit')}
    style={{
      padding: '10px 14px',
      border: 'none',
      borderRadius: '10px',
      backgroundColor: '#2563eb',
      color: '#fff',
      fontWeight: '600',
      cursor: 'pointer',
    }}
  >
    In Transit
  </button>
<button
  type="button"
  onClick={() => handleDriverStatusUpdate(load.id, 'Dropped')}
  style={{
    padding: '10px 14px',
    border: 'none',
    borderRadius: '10px',
    backgroundColor: '#f59e0b',
    color: '#fff',
    fontWeight: '600',
    cursor: 'pointer',
  }}
>
  Dropped
</button>
  <button
    type="button"
    onClick={() => handleDriverStatusUpdate(load.id, 'Delivered')}
    disabled={!hasRequiredDriverDocuments(load)}
    style={{
      padding: '10px 14px',
      border: 'none',
      borderRadius: '10px',
      backgroundColor: hasRequiredDriverDocuments(load) ? '#16a34a' : '#9ca3af',
      color: '#fff',
      fontWeight: '600',
      cursor: hasRequiredDriverDocuments(load) ? 'pointer' : 'not-allowed',
    }}
  >
    Complete Load
  </button>
</div>

<div
  style={{
    marginTop: '14px',
    padding: '14px',
    borderRadius: '12px',
    backgroundColor: '#f3f4f6',
  }}
>
  <p><strong>Scan or Upload Paperwork:</strong></p>
  {!hasRequiredDriverDocuments(load) && (
    <p className="driver-upload-name">
      Required before complete: {getMissingDriverDocuments(load).join(', ')}
    </p>
  )}

  <select
    value={uploadDocType[load.id] || 'POD'}
    onChange={(e) =>
      setUploadDocType((prev) => ({
        ...prev,
        [load.id]: e.target.value,
      }))
    }
    style={{
      width: '100%',
      padding: '10px',
      marginTop: '8px',
      borderRadius: '8px',
      border: '1px solid #d1d5db',
    }}
  >
    <option value="POD">POD</option>
  <option value="IN EIR">IN EIR</option>
  <option value="OUT EIR">OUT EIR</option>
  <option value="OTHER">OTHER</option>
</select>

  <div className="driver-upload-actions">
    <button type="button" className="driver-upload-label driver-camera-button" onClick={() => openDriverCamera(load.id)}>
      Scan Document
    </button>
    <label className="driver-upload-label" htmlFor={`scan-${load.id}`}>
      Take Photo
    </label>
    <input
      id={`scan-${load.id}`}
      type="file"
      accept="image/*"
      className="driver-native-file-input"
      onClick={(e) => {
        e.currentTarget.value = '';
      }}
      onInput={(e) => handleDriverUploadFileChange(load.id, e.currentTarget.files?.[0] || null, 'photo picker')}
      onChange={(e) => handleDriverUploadFileChange(load.id, e.currentTarget.files?.[0] || null, 'photo picker')}
    />

    <label className="driver-upload-label" htmlFor={`upload-${load.id}`}>
      Choose File or Photo
    </label>
    <input
      id={`upload-${load.id}`}
      type="file"
      accept="image/*,.pdf"
      className="driver-native-file-input"
      onChange={(e) =>
        handleDriverUploadFileChange(load.id, e.target.files?.[0] || null, 'file picker')
      }
    />
  </div>

  <p className="driver-upload-name">
    {getUploadSelectionLabel(uploadFileByLoad[load.id] || uploadFileRef.current[load.id])}
  </p>
  {driverUploadStatusByLoad[load.id] && (
    <p className="driver-upload-debug">{driverUploadStatusByLoad[load.id]}</p>
  )}

  <button
    type="button"
    style={{
      marginTop: '10px',
      width: '100%',
      padding: '10px 14px',
      border: 'none',
      borderRadius: '10px',
      backgroundColor: '#111827',
      color: '#fff',
      fontWeight: '600',
      cursor: 'pointer',
    }}
    onClick={() => handleDriverDocumentUpload(load.id)}
  >
    Upload Document
  </button>
</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
  return (
  <div className="app-shell">
     {fullAccessRoles.has(getNormalizedRole(currentUser?.role)) && (
     <div className="view-toggle portal-toggle">
      <button type="button" className="toggle-btn" onClick={() => setUserRole('driver')}>
        Driver View
      </button>

      <button type="button" className="toggle-btn" onClick={() => setUserRole('dispatcher')}>
        Dispatcher View
      </button>
    </div>
     )}
    {userRole === 'driver' && (
  <div style={{ marginTop: '10px' }}>
   <select
  name="driver"
  value={editingLoad.driver || ''}
  onChange={(e) => {
    const value = e.target.value;

    setEditingLoad((prev) => ({
      ...prev,
      driver: value,
      truck: value ? getDriverTruck(value) : '',
    }));
  }}
>
  <option value="">No Driver</option>
  {driversList.map((d) => (
    <option key={d.id} value={d.id}>
      {d.id} - {d.name}
    </option>
  ))}
</select>
  </div>
)}
      <header className="topbar">
        <div className="brand-block">
          {getCompanyLogoSrc() && (
            <img
              src={getCompanyLogoSrc()}
              alt={`${company?.name || 'Company'} logo`}
              className="company-logo"
            />
          )}
          <div>
          <h1>{company?.name || 'PortFlow Dispatch'}</h1>
          {isDemoMode && <span className="demo-mode-badge">Demo Mode - sample data only</span>}
          <p>Dispatch • Settlements • Paperwork • Load Tracking</p>
        </div>

        </div>

        <div className="topbar-actions">
          <div className="view-toggle">
            {roleCanAccessView(currentUser?.role, 'dispatch') && (
            <button
              className={activeView === 'dispatch' ? 'toggle-btn active' : 'toggle-btn'}
              onClick={() => setActiveView('dispatch')}
            >
              Dispatch Board
            </button>
            )}
            {roleCanAccessView(currentUser?.role, 'completed') && (
            <button
              className={activeView === 'completed' ? 'toggle-btn active' : 'toggle-btn'}
              onClick={() => setActiveView('completed')}
            >
              Completed Loads
            </button>
            )}
            {roleCanAccessView(currentUser?.role, 'settlements') && (
            <button
              className={activeView === 'settlements' ? 'toggle-btn active' : 'toggle-btn'}
              onClick={() => setActiveView('settlements')}
            >
              Driver Settlements
            </button>
            )}
            {roleCanAccessView(currentUser?.role, 'customers') && (
            <button
              className={activeView === 'customers' ? 'toggle-btn active' : 'toggle-btn'}
              onClick={() => setActiveView('customers')}
            >
              Customers
            </button>
            )}
{roleCanAccessView(currentUser?.role, 'drivers') && (
<button
              className={activeView === 'drivers' ? 'toggle-btn active' : 'toggle-btn'}
              onClick={() => setActiveView('drivers')}
            >
              Drivers
            </button>
)}

{roleCanAccessView(currentUser?.role, 'settings') && (
<button
  className={activeView === 'settings' ? 'toggle-btn active' : 'toggle-btn'}
  onClick={() => setActiveView('settings')}
>
  Settings
</button>
)}

            {roleCanAccessView(currentUser?.role, 'invoices') && (
            <button
              className={activeView === 'invoices' ? 'toggle-btn active' : 'toggle-btn'}
              onClick={() => setActiveView('invoices')}
            >
              Invoices
            </button>
            )}
            {roleCanAccessView(currentUser?.role, 'accounting') && (
            <button
              className={activeView === 'accounting' ? 'toggle-btn active' : 'toggle-btn'}
              onClick={() => setActiveView('accounting')}
            >
              Accounting
            </button>
            )}
            {canManageTenants && (
              <button
                className={activeView === 'tenants' ? 'toggle-btn active' : 'toggle-btn'}
                onClick={() => setActiveView('tenants')}
              >
                Tenant Management
              </button>
            )}
          </div>

          {activeView === 'dispatch' && (
            <button
  className="primary-btn"
  onClick={() => {
    const nextShowForm = !showForm;

    setShowForm(nextShowForm);
    setIsEditing(false);

    if (!nextShowForm) {
      setNewLoad(emptyLoad);
      setSelectedPresetName('');
    }
  }}
>
  {showForm ? 'Close Form' : '+ Add New Load'}
</button>
          )}
          <button type="button" className="secondary-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <NotificationStack />

      {activeView === 'dispatch' && (
        <>
          {showForm && (
            <section className="panel add-load-panel">
              <div className="panel-header">
                <h3>Add New Load</h3>
              </div>

              <form className="load-form" onSubmit={handleAddLoad}>

<div style={{
  marginTop: '16px',
  padding: '12px',
  background: '#f9fafb',
  borderRadius: '10px',
  border: '1px solid #e5e7eb',
}}>

                <h3 style={{ marginTop: '16px' }}>Basic Information</h3>
                
  <input
    type="text"
    name="id"
    placeholder="Load ID (example: LD-1004)"
    value={newLoad.id}
    onChange={handleInputChange}
  />
<select
  value={selectedPresetName}
  onChange={(e) => {
    const presetName = e.target.value;
    setSelectedPresetName(presetName);

    const selectedPreset = loadPresets.find(
      (preset) => preset.name === presetName
    );

    if (!selectedPreset) return;

    setNewLoad((prev) => ({
      ...prev,
      ...selectedPreset,
    }));
  }}
>
  <option value="">Select Load Preset</option>
  {loadPresets.map((preset) => (
    <option key={preset.name} value={preset.name}>
      {preset.name}
    </option>
  ))}
</select>
  <input
    type="date"
    name="loadDate"
    value={newLoad.loadDate}
    onChange={handleInputChange}
    required
  />


<div style={{ marginBottom: '12px' }}>

  <label style={{ display: 'block', marginBottom: '4px' }}>Customer</label>
  <select
    name="customer"
    value={newLoad.customer}
    onChange={handleInputChange}
    required
  >
    <option value="">Select Customer</option>
    {customers.map((customer) => (
      <option key={customer.id} value={customer.name}>
        {customer.name}
      </option>
    ))}
  </select>
</div>
  <div className="inline-action-row">
    <button
      type="button"
      className="secondary-btn compact-btn"
      onClick={() => setShowCustomerEditor((prev) => !prev)}
    >
      {showCustomerEditor ? 'Close Customer Editor' : 'Edit Customer'}
    </button>

    <button
      type="button"
      className="primary-btn compact-btn"
      onClick={() => {
        setCustomerForm(emptyCustomer);
        setEditingCustomerId(null);
        setShowCustomerEditor(true);
      }}
    >
      Create Customer
    </button>
  </div>

  {showCustomerEditor && (
    <div style={{ marginTop: '10px', marginBottom: '12px' }}>
      
    
      <input
        type="text"
        placeholder="Customer Name"
        value={customerForm.name || ''}
        onChange={(e) =>
          setCustomerForm((prev) => ({
            ...prev,
            name: e.target.value,
          }))
        }
      />
      <input
        ref={inlineCustomerAddressInputRef}
        type="text"
        placeholder="Street Address"
        value={customerForm.address || ''}
        onChange={(e) =>
          setCustomerForm((prev) => ({
            ...prev,
            address: e.target.value,
          }))
        }
      />

      <input
        type="text"
        placeholder="City"
        value={customerForm.city || ''}
        onChange={(e) =>
          setCustomerForm((prev) => ({
            ...prev,
            city: e.target.value,
          }))
        }
      />

      <input
        type="text"
        placeholder="State"
        value={customerForm.state || ''}
        onChange={(e) =>
          setCustomerForm((prev) => ({
            ...prev,
            state: e.target.value,
          }))
        }
      />

      <input
        type="text"
        placeholder="ZIP"
        value={customerForm.zip || ''}
        onChange={(e) =>
          setCustomerForm((prev) => ({
            ...prev,
            zip: e.target.value,
          }))
        }
      />

      <button type="button" className="primary-btn compact-btn" onClick={handleSaveCustomer}>
        {editingCustomerId ? 'Save Customer' : 'Create Customer'}
      </button>
    </div>
  )}
</div>

<div style={{
  marginTop: '16px',
  padding: '12px',
  background: '#f9fafb',
  borderRadius: '10px',
  border: '1px solid #e5e7eb',
}}>

<h3 style={{ marginTop: '16px' }}>Reference Details</h3>
  <input
  type="text"
  name="referenceNumber"
  value={newLoad.referenceNumber || ''}
  onChange={(e) =>
    setNewLoad((prev) => ({
      ...prev,
      referenceNumber: e.target.value,
    }))
  }
  placeholder="Reference #"
/>
<input
  type="text"
  name="returnNumber"
  placeholder="Return #"
  value={newLoad.returnNumber || ''}
  onChange={handleInputChange}
/>

<input
  type="text"
  name="reservationNumber"
  placeholder="Reservation #"
  value={newLoad.reservationNumber || ''}
  onChange={handleInputChange}
/>
</div>

<div
  style={{
    marginTop: '16px',
    padding: '12px',
    background: '#f9fafb',
    borderRadius: '10px',
    border: '1px solid #e5e7eb',
  }}
>
  <h3 style={{ marginBottom: '10px' }}>Container Details</h3>

  <input
    type="text"
    name="containerNumber"
    placeholder={selectedPresetName === 'Export Load' ? 'Container Number (optional for export)' : 'Container Number'}
    value={newLoad.containerNumber}
    onChange={handleInputChange}
  />
  <div className="smart-port-lookup">
    <button
      type="button"
      className="primary-btn smart-port-lookup-btn"
      onClick={handleSmartPortLookup}
      disabled={
        smartPortLookupLoading ||
        (!newLoad.containerNumber && !newLoad.referenceNumber && !newLoad.poNumber && !newLoad.bookingNumber)
      }
    >
      {smartPortLookupLoading ? 'Checking Port...' : 'Smart Port Lookup'}
    </button>
    {smartPortLookupStatus && (
      <p
        className={`smart-port-status ${
          smartPortLookupStatus.toLowerCase().startsWith('unable') ? 'error' : ''
        }`}
      >
        {smartPortLookupStatus}
      </p>
    )}
  </div>
  {selectedPresetName === 'Export Load' && (
    <label className="checkbox-row">
      <input
        type="checkbox"
        name="streetTurn"
        checked={Boolean(newLoad.streetTurn)}
        onChange={(e) =>
          setNewLoad((prev) => ({
            ...prev,
            streetTurn: e.target.checked,
          }))
        }
      />
      <span>Street Turn / reuse container</span>
    </label>
  )}

  <input
    type="text"
    name="bookingNumber"
    placeholder="Booking Number"
    value={newLoad.bookingNumber || ''}
    onChange={handleInputChange}
  />

  <input
    type="text"
    name="containerSize"
    placeholder="Container Size (20 / 40 / 45)"
    value={newLoad.containerSize}
    onChange={handleInputChange}
  />

  <select
    name="shipLine"
    value={newLoad.shipLine || ''}
    onChange={handleInputChange}
  >
    <option value="">🚢 Select Ship Line</option>
    {shipLineOptions.map((line) => (
      <option key={line} value={line}>
        {line}
      </option>
    ))}
  </select>

  <input
    type="text"
    name="chassisNumber"
    placeholder="Chassis Number"
    value={newLoad.chassisNumber}
    onChange={handleInputChange}
  />

  <div className="form-group">
    <label>PO #</label>
    <input
      type="text"
      name="poNumber"
      value={newLoad.poNumber || ''}
      onChange={handleInputChange}
    />
  </div>

  <div className="form-group">
    <label>Pick Up #</label>
    <input
      type="text"
      name="pickupNumber"
      value={newLoad.pickupNumber || ''}
      onChange={handleInputChange}
    />
  </div>

  <div className="form-group">
    <label>Delivery Type</label>
    <select
      name="deliveryType"
      value={newLoad.deliveryType || ''}
      onChange={handleInputChange}
    >
      <option value="">Select Delivery Type</option>
      <option value="local">Local Delivery</option>
      <option value="highway">Highway Delivery</option>
    </select>
  </div>

  <input
    type="text"
    name="sealNumber"
    placeholder="Seal Number"
    value={newLoad.sealNumber}
    onChange={handleInputChange}
  />
</div>

<div style={{
  marginTop: '16px',
  padding: '12px',
  background: '#f9fafb',
  borderRadius: '10px',
  border: '1px solid #e5e7eb',
}}>
<h3 style={{ marginTop: '16px' }}>Driver Assignment</h3>

<select
  name="driver"
  value={newLoad.driver}
  onChange={handleInputChange}
>
  <option value="">Assign Later</option>
  {driversList.map((d) => (
    <option key={d.id} value={d.id}>
      {d.id} - {d.name}
    </option>
  ))}
</select>

  <input
    type="text"
    name="truck"
    placeholder="Truck"
    value={newLoad.truck}
    onChange={handleInputChange}
    readOnly
  />
</div>

<div
  style={{
    marginTop: '16px',
    padding: '12px',
    background: '#f9fafb',
    borderRadius: '10px',
    border: '1px solid #e5e7eb',
  }}
>
<h3 style={{ marginBottom: '10px' }}>Locations</h3>

{!showNewPickup ? (
  <>
    {renderLocationSearchField({
      field: 'pickup',
      label: 'Pickup Location',
      options: pickupLocations,
      placeholder: 'Type or select pickup location',
      emptyText: 'No pickup locations found.',
    })}

    <button
      type="button"
      className="secondary-btn compact-btn"
      onClick={() => setShowNewPickup(true)}
    >
      + New Pickup
    </button>
  </>
  
) : (
  <div style={{ marginTop: '10px', marginBottom: '12px' }}>
    <input
      type="text"
      placeholder="Pickup Name"
      value={newPickupLocation.name}
      onChange={(e) =>
        setNewPickupLocation((prev) => ({ ...prev, name: e.target.value }))
      }
    />

    <input
      ref={newPickupAddressInputRef}
      type="text"
      placeholder="Street Address"
      value={newPickupLocation.address}
      onChange={(e) =>
        setNewPickupLocation((prev) => ({ ...prev, address: e.target.value }))
      }
    />

    <input
      type="text"
      placeholder="City"
      value={newPickupLocation.city}
      onChange={(e) =>
        setNewPickupLocation((prev) => ({ ...prev, city: e.target.value }))
      }
    />

    <input
      type="text"
      placeholder="State"
      value={newPickupLocation.state}
      onChange={(e) =>
        setNewPickupLocation((prev) => ({ ...prev, state: e.target.value }))
      }
    />

    <input
      type="text"
      placeholder="ZIP"
      value={newPickupLocation.zip}
      onChange={(e) =>
        setNewPickupLocation((prev) => ({ ...prev, zip: e.target.value }))
      }
    />

    <button type="button" className="primary-btn compact-btn" onClick={handleSaveNewPickupLocation}>
      Save Pickup Location
    </button>

    <button
      type="button"
      className="secondary-btn compact-btn"
      onClick={() => setShowNewPickup(false)}
    >
      Use Saved Pickup
    </button>
  </div>
)}

{showLocationEditor && (
  <div style={{ marginBottom: '12px' }}>
<div style={{ marginTop: '15px' }}>
  <h4>Saved Locations</h4>

  {locations.length === 0 ? (
    <p>No locations saved yet.</p>
  ) : (
    locations.map((loc) => (
      <div
        key={loc.id}
        style={{
          borderBottom: '1px solid #ddd',
          padding: '8px 0',
        }}
      >
        <div><strong>{loc.name}</strong></div>
        <div>
          {[loc.address, loc.city, loc.state, loc.zip]
            .filter(Boolean)
            .join(', ')}
        </div>

        <button
          type="button"
          className="secondary-btn compact-btn danger-btn"
          onClick={() => handleDeleteLocation(loc.id)}
        >
          Delete
        </button>
      </div>
    ))
  )}
</div>
  </div>
)}

{renderLocationSearchField({
  field: 'delivery',
  label: 'Delivery Location',
  options: deliveryLocations,
  placeholder: 'Type or select delivery location',
  emptyText: 'No delivery locations found.',
  allowDelete: true,
})}

<div className="inline-action-row location-action-row">
  <button
    type="button"
    className="secondary-btn compact-btn"
    onClick={() => setShowNewDeliveryForm((prev) => !prev)}
  >
    {showNewDeliveryForm ? 'Cancel New Delivery' : '+ New Delivery'}
  </button>

  <button
    type="button"
    className="secondary-btn compact-btn"
    onClick={() => setShowLocationEditor((prev) => !prev)}
  >
    {showLocationEditor ? 'Close Locations' : 'Edit Locations'}
  </button>
</div>
{showNewDeliveryForm && (
  <div style={{ marginBottom: '10px' }}>
    <input
      type="text"
      placeholder="Delivery Name"
      value={newDeliveryLocation.name}
      onChange={(e) =>
        setNewDeliveryLocation((prev) => ({ ...prev, name: e.target.value }))
      }
    />

    <input
  ref={newDeliveryAddressInputRef}
  type="text"
  placeholder="Street Address"
  value={newDeliveryLocation.address}
  onChange={(e) =>
    setNewDeliveryLocation((prev) => ({ ...prev, address: e.target.value }))
  }
/>

    <input
      type="text"
      placeholder="City"
      value={newDeliveryLocation.city}
      onChange={(e) =>
        setNewDeliveryLocation((prev) => ({ ...prev, city: e.target.value }))
      }
    />

    <input
      type="text"
      placeholder="State"
      value={newDeliveryLocation.state}
      onChange={(e) =>
        setNewDeliveryLocation((prev) => ({ ...prev, state: e.target.value }))
      }
    />

    <input
      type="text"
      placeholder="ZIP"
      value={newDeliveryLocation.zip}
      onChange={(e) =>
        setNewDeliveryLocation((prev) => ({ ...prev, zip: e.target.value }))
      }
    />

    <button type="button" className="primary-btn compact-btn" onClick={handleSaveNewDeliveryLocation}>
      Save Delivery Location
    </button>
  </div>
)}

<label>Appointment Time</label>
<input
  type="datetime-local"
  name="appointmentTime"
  value={normalizeDateTimeInputValue(newLoad.appointmentTime)}
  onChange={handleInputChange}
/>

<label>ETA</label>
<input
  type="datetime-local"
  name="eta"
  value={normalizeDateTimeInputValue(newLoad.eta)}
  onChange={handleInputChange}
/>

{renderLocationSearchField({
  field: 'returnLocation',
  label: 'Return Location',
  options: returnLocations,
  placeholder: 'Type or select return location',
  emptyText: 'No return locations found.',
})}

<div className="form-group">
  <label>Route Miles</label>
  <div className="inline-action-row">
    <input
      type="number"
      name="miles"
      min="0"
      step="0.1"
      placeholder="Auto miles"
      value={newLoad.miles || ''}
      onChange={handleInputChange}
    />
    <button
      type="button"
      className="secondary-btn compact-btn"
      onClick={() => estimateLoadMiles('new')}
      disabled={mileageEstimating === 'new'}
    >
      {mileageEstimating === 'new' ? 'Calculating...' : 'Estimate'}
    </button>
  </div>
  {mileageEstimateStatus && mileageEstimating !== 'edit' && (
    <p className="documents-empty">{mileageEstimateStatus}</p>
  )}
</div>

<label>LFD</label>
<input
  type="date"
  name="lastFreeDay"
  value={newLoad.lastFreeDay || ''}
  onChange={handleInputChange}
/>
</div>
<div
  style={{
    marginTop: '16px',
    padding: '12px',
    background: '#f9fafb',
    borderRadius: '10px',
    border: '1px solid #e5e7eb',
  }}
>
  <h3 style={{ marginBottom: '10px' }}>Rates & Status</h3>

  <input
    type="text"
    name="rate"
    placeholder="Load Rate (customer rate)"
    value={newLoad.rate}
    onChange={handleInputChange}
    required
  />

  <input
    type="text"
    name="driverRate"
    placeholder="Driver Rate"
    value={newLoad.driverRate}
    onChange={handleInputChange}
    required
  />

 <select name="status" value={newLoad.status} onChange={handleInputChange}>
  <option value="Dispatched">Dispatched</option>
  <option value="In Transit">In Transit</option>
  <option value="Dropped">Dropped</option>
  <option value="Delivered">Delivered</option>
</select>

  <label>Availability</label>
<select
  name="availabilityStatus"
  value={newLoad.availabilityStatus || 'Not Available'}
  onChange={handleInputChange}
>
  <option value="Available">Available</option>
  <option value="Not Available">Not Available</option>
</select>

  <input type="text" name="detention" placeholder="Detention" value={newLoad.detention} onChange={handleInputChange} />
  <input type="text" name="lumper" placeholder="Lumper" value={newLoad.lumper} onChange={handleInputChange} />
  <input type="text" name="fuelAdvance" placeholder="Fuel Advance" value={newLoad.fuelAdvance} onChange={handleInputChange} />
  <input type="text" name="settlement" value={newLoad.settlement} readOnly placeholder="Auto Settlement" />
</div>

  <div
  style={{
    marginTop: '16px',
    padding: '12px',
    background: '#f9fafb',
    borderRadius: '10px',
    border: '1px solid #e5e7eb',
  }}
>
  <h3 style={{ marginBottom: '10px' }}>Notes</h3>

  <textarea
    name="notes"
    placeholder="Dispatcher Notes"
    value={newLoad.notes}
    onChange={handleInputChange}
    rows="4"
  />
</div>

  <div style={{ marginTop: '16px', textAlign: 'right' }}>
  <button type="submit" className="primary-btn" style={{ width: 'auto' }}>
    Save Load
  </button>
</div>
              </form>
            </section>
          )}

          <section className="summary-grid">
  {summaryCards.map((card) => (
    <div
  key={card.title}
  className={`summary-card ${dashboardFilter === card.filter ? 'active-summary-card' : ''} card-${card.filter}`}
  onClick={() =>
    setDashboardFilter(dashboardFilter === card.filter ? '' : card.filter || '')
  }
>
      <h3>{card.title}</h3>
      <p>{card.value}</p>
    </div>
  ))}
</section>

          {dashboardFilter === 'appointments' && (
            <section className="appointment-filter-panel">
              <div>
                <span>Appointment Date</span>
                <strong>{filteredLoadsData.length} loads</strong>
              </div>
              <select
                value={appointmentDateFilter}
                onChange={(e) => setAppointmentDateFilter(e.target.value)}
                className="filter-select"
              >
                <option value="yesterday">Yesterday</option>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="custom">Custom</option>
              </select>
              <select
                value={appointmentDeliveryTypeFilter}
                onChange={(e) => setAppointmentDeliveryTypeFilter(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Delivery Types</option>
                <option value="local">Local Delivery</option>
                <option value="highway">Highway Delivery</option>
              </select>
              {appointmentDateFilter === 'custom' && (
                <input
                  type="date"
                  value={customAppointmentDate}
                  onChange={(e) => setCustomAppointmentDate(e.target.value)}
                  className="filter-select"
                />
              )}
            </section>
          )}

          {dashboardFilter === 'available' && (
            <section className="appointment-filter-panel">
              <div>
                <span>Available By Appointment</span>
                <strong>{filteredLoadsData.length} loads</strong>
              </div>
              <select
                value={availableAppointmentDateFilter}
                onChange={(e) => setAvailableAppointmentDateFilter(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Loads</option>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="custom">Custom</option>
              </select>
              <select
                value={availableDeliveryTypeFilter}
                onChange={(e) => setAvailableDeliveryTypeFilter(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Delivery Types</option>
                <option value="local">Local Delivery</option>
                <option value="highway">Highway Delivery</option>
              </select>
              {availableAppointmentDateFilter === 'custom' && (
                <input
                  type="date"
                  value={availableCustomAppointmentDate}
                  onChange={(e) => setAvailableCustomAppointmentDate(e.target.value)}
                  className="filter-select"
                />
              )}
            </section>
          )}

          <section className="panel driver-tracking-panel">
            <div className="panel-header compact-header">
              <div>
                <h3>Driver Live Tracking</h3>
                <p className="panel-subtitle">Drivers appear here after they tap Start in the phone app. Use Refresh to update locations.</p>
              </div>
              <div className="details-actions">
                <span>{trackedDriverLocations.length} online</span>
                <button
                  type="button"
                  className="secondary-btn compact-btn"
                  onClick={fetchDriverLocations}
                >
                  Refresh
                </button>
              </div>
            </div>

            {trackedDriverLocations.length > 0 ? (
              <div className="driver-tracking-grid">
                <div className="driver-map-canvas" ref={driverMapRef} aria-label="Driver live map" />
                <div className="driver-location-list">
                  {trackedDriverLocations.map((location) => {
                    const isFresh = Date.now() - new Date(location.updatedAt).getTime() < 10 * 60 * 1000;
                    const activeLoad = location.activeLoads[0];

                    return (
                      <article key={location.driverId} className="driver-location-row">
                        <div>
                          <strong>{location.driverName || getDriverLabel(location.driverId)}</strong>
                          <span>
                            {location.truck ? `Truck ${location.truck}` : 'Truck N/A'} • {formatRelativeTime(location.updatedAt)}
                          </span>
                          <span>
                            {activeLoad
                              ? `${activeLoad.containerNumber || activeLoad.referenceNumber || activeLoad.id} • ${activeLoad.status || 'Assigned'}`
                              : 'No active load found'}
                          </span>
                        </div>
                        <div className="driver-location-actions">
                          <span className={isFresh ? 'live-dot fresh' : 'live-dot stale'}>
                            {isFresh ? 'Live' : 'Stale'}
                          </span>
                          <a
                            href={getGoogleMapsCoordinateLink(location.latitude, location.longitude)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open Map
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <p>No driver locations yet. Ask a driver to open the driver app and tap Start under Live tracking.</p>
              </div>
            )}
          </section>

          <main className="dashboard-grid dispatch-workspace">
            <section className="panel">
              <div className="panel-header">
                <h3>All Loads</h3>
                <span>{filteredLoadsData.length} loads</span>
              </div>

              <div className="filters-bar">
                <input
                  type="text"
                  placeholder="Search by container#, PO#, pick up #, driver, customer, or reference#"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />

                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="filter-select">
  <option value="All">All Statuses</option>
  <option value="Dispatched">Dispatched</option>
  <option value="In Transit">In Transit</option>
  <option value="Dropped">Dropped</option>
</select>

                <select value={paperworkFilter} onChange={(e) => setPaperworkFilter(e.target.value)} className="filter-select">
                  <option value="All">All Paperwork</option>
                  <option value="Pending">Pending</option>
                  <option value="Submitted">Submitted</option>
                </select>
              </div>
              <div className="dispatch-sheet-wrap">
                {filteredLoadsData.length > 0 ? (
                  <table className="dispatch-load-sheet">
                    <thead>
                      <tr>
                        {orderedDispatchLoadColumns.map((column) => (
                          <th
                            key={column.key}
                            draggable
                            className={draggedDispatchColumn === column.key ? 'dragging-column' : ''}
                            onDragStart={(event) => handleDispatchColumnDragStart(event, column.key)}
                            onDragEnd={() => setDraggedDispatchColumn('')}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => handleDispatchColumnDrop(event, column.key)}
                            title="Drag to move this column"
                          >
                            <span className="column-drag-handle" aria-hidden="true">::</span>
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLoadsData.map((load) => (
                        <tr
                          key={load.id}
                          className={selectedLoad?.id === load.id ? 'selected' : ''}
                          onClick={() => {
                            setSelectedLoad(load);
                            setIsEditing(false);
                          }}
                        >
                          {orderedDispatchLoadColumns.map((column) => (
                            <td key={`${load.id}-${column.key}`}>{column.render(load)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state">
                    <p>No loads found with those filters.</p>
                  </div>
                )}
              </div>

              <div className="legacy-load-list-hidden" aria-hidden="true">
                {filteredLoadsData.length > 0 ? (
                  filteredLoadsData.map((load) => (
                    <button
                      key={load.id}
                      className={`load-card ${selectedLoad?.id === load.id ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedLoad(load);
                        setIsEditing(false);
                      }}
                    >
                      <div className="load-card-top">
                        <strong>{load.id}</strong>
                        <span className={`status-badge ${load.status.toLowerCase().replace(/\s/g, '-')}`}>
                          {load.status}
                        </span>
                      </div>

                      <p><strong>Date:</strong> {load.loadDate}</p>
                      <p>
  <strong>Status:</strong>{' '}
  <span
    style={{
      padding: '4px 10px',
      borderRadius: '20px',
      fontSize: '12px',
      fontWeight: '600',
      backgroundColor:
        load.status === 'Delivered'
          ? '#dcfce7'
          : load.status === 'In Transit'
          ? '#dbeafe'
          : '#f3f4f6',
      color:
        load.status === 'Delivered'
          ? '#166534'
          : load.status === 'In Transit'
          ? '#1e40af'
          : '#374151',
    }}
  >
    {load.status || '-'}
  </span>
</p>
                      <div className="load-card-grid">

  <div className="load-card-grid">

  {userRole !== 'driver' && (
    <div className="load-field">
      <strong>Customer</strong>
      {load.customer || '—'}
    </div>
  )}

  <div className="load-field">
    <strong>Driver</strong>
    {load.driver ? getDriverLabel(load.driver) : 'Not Assigned'}
  </div>
  
 <div className="load-field">
  <strong>📍 Pick Up</strong>
  {shortLocation(load.pickup)}
</div>

  <p>🚛 <strong>Container:</strong><br />
    {load.containerNumber || '-'}
    {load.containerSize ? ` (${load.containerSize})` : ''}
  </p>
<p>🚢 <strong>Ship Line:</strong><br /> {load.shipLine || '-'}</p>
 <p>📅 <strong>Appointment:</strong><br />
    {formatAppointmentTime(load.appointmentTime)}
  </p>

<div className="load-field">
  <strong>Reference #</strong>
  {load.referenceNumber || '—'}
</div>

   <div className="load-field">
  <strong>📦 Delivery</strong>
  {getDeliveryDisplay(load.delivery) || '-'}
</div>
   <p>📍 <strong>Drop Type:</strong><br /> {load.dropType || '-'}</p>
   <p>📍 <strong>Drop Location:</strong><br /> {load.dropLocation || '-'}</p>
   <p>👤 <strong>Dropped By:</strong><br /> {getDroppedByDriverValue(load) ? getDriverLabel(getDroppedByDriverValue(load)) : '—'}</p>
   <p>📅 <strong>Drop Date/Time:</strong><br /> {load.dropDateTime || '-'}</p>
<div className="load-field">
  <strong>🔁 Return</strong>
  {shortLocation(load.returnLocation)}
</div>
 
 <p>🔢<strong>Return #:</strong> {load.returnNumber || '-'}</p>
{load.status === 'Dropped' && (
  <p>
    📍 <strong>Dropped:</strong> {load.dropType || '-'} <br />
    📌 {load.dropType === 'Customer'
      ? getDeliveryDisplay(load.delivery) || '-'
      : load.returnLocation || '-'}
  </p>
)}
<div className="load-field">
  <strong>PO#</strong>
  {load.poNumber || '—'}
</div>





<div className="load-field">
  <strong>Pick Up #</strong>
  {load.pickupNumber || '—'}
</div>

  {userRole !== 'driver' && (
    <div className="load-field">
      <strong>Load Rate</strong>
      ${load.rate || '0.00'}
    </div>
  )}

  <div className="load-field">
    <strong>Driver Rate</strong>
    ${load.driverRate || '0.00'}
  </div>

  <div className="load-field">
    <strong>Detention</strong>
    {load.detention || '0.00'}
  </div>

  
</div>

<div style={{ marginTop: '10px' }}>
  <p style={{ marginBottom: '6px', fontWeight: '600', color: '#1f2937' }}>
    Paperwork Status
  </p>

  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
    {load.documents?.some(
      (doc) => (doc.category || '').trim().toUpperCase() === 'POD'
    ) ? (
      <span
        style={{
          padding: '4px 10px',
          borderRadius: '999px',
          backgroundColor: '#dcfce7',
          color: '#166534',
          fontSize: '12px',
          fontWeight: '700',
        }}
      >
        POD
      </span>
    ) : (
      <span
        style={{
          padding: '4px 10px',
                  backgroundColor: '#fee2e2',
          color: '#991b1b',
          fontSize: '12px',
          fontWeight: '700',
        }}
      >
        Missing POD
      </span>
    )}

    {load.documents?.some(
      (doc) => (doc.category || '').trim().toUpperCase() === 'IN EIR'
    ) && (
      <span
        style={{
          padding: '4px 10px',
          borderRadius: '999px',
          backgroundColor: '#dbeafe',
          color: '#1d4ed8',
          fontSize: '12px',
          fontWeight: '700',
        }}
      >
        IN EIR
      </span>
    )}

    {load.documents?.some(
      (doc) => (doc.category || '').trim().toUpperCase() === 'OUT EIR'
    ) && (
      <span
        style={{
          padding: '4px 10px',
          borderRadius: '999px',
          backgroundColor: '#fef3c7',
          color: '#92400e',
          fontSize: '12px',
          fontWeight: '700',
        }}
      >
        OUT EIR
      </span>
    )}

    {load.documents?.some(
      (doc) => (doc.category || '').trim().toUpperCase() === 'POD'
    ) &&
      load.documents?.some(
        (doc) => (doc.category || '').trim().toUpperCase() === 'IN EIR'
      ) &&
      load.documents?.some(
        (doc) => (doc.category || '').trim().toUpperCase() === 'OUT EIR'
      ) && (
        <span
          style={{
            padding: '4px 10px',
            borderRadius: '999px',
            backgroundColor: '#dcfce7',
            color: '#166534',
            fontSize: '12px',
            fontWeight: '700',
          }}
        >
          Paperwork Complete
        </span>
      )}
  </div>
</div>

</div>

                    

                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    <p>No loads found with those filters.</p>
                  </div>
                )}
              </div>
            </section>

            {selectedLoad && (
              <button
                type="button"
                className="load-details-backdrop"
                aria-label="Close load details"
                onClick={() => {
                  setSelectedLoad(null);
                  setIsEditing(false);
                }}
              />
            )}

            <section className={`panel load-details-drawer ${selectedLoad ? 'open' : ''}`}>
              {selectedLoad ? (
                <>
                  <div className="panel-header">
                    <h3>Load Details</h3>
                    <div className="details-actions">
                      <span>{selectedLoad.id}</span>
                      <button
                        className="secondary-btn"
                        onClick={() => handleCheckPortHouston(selectedLoad)}
                        disabled={portHoustonCheckingLoadId === selectedLoad.id}
                      >
                        {portHoustonCheckingLoadId === selectedLoad.id ? 'Checking...' : 'Check Port Houston'}
                      </button>
                      <button
                        type="button"
                        className="pod-generate-btn"
                        onClick={() => handleGeneratePOD(selectedLoad)}
                      >
                        Generate POD
                      </button>
                      {isEditing ? (
                        <>
                          <button type="submit" form="load-edit-form" className="primary-btn">
                            Save Changes
                          </button>
                          <button type="button" className="secondary-btn" onClick={() => setIsEditing(false)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button className="secondary-btn" onClick={handleEditClick}>Edit Load</button>
                      )}
                      <button className="danger-btn" onClick={handleDeleteLoad}>Delete Load</button>
                      <button
                        type="button"
                        className="secondary-btn drawer-close-btn"
                        onClick={() => {
                          setSelectedLoad(null);
                          setIsEditing(false);
                        }}
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <form id="load-edit-form" className="load-form" onSubmit={handleUpdateLoad}>
                      <div className="edit-load-group">
                        <div className="edit-load-group-header">
                          <h4>Customer & References</h4>
                          <span>Reference, PO, pickup, reservation, seal, and return numbers</span>
                        </div>
                        <div className="edit-load-grid">
                          <select name="customer" value={editingLoad?.customer || ''} onChange={handleEditInputChange}>
                            <option value="">Select Customer</option>
                            {customers.map((customer) => (
                              <option key={customer.id} value={customer.name}>
                                {customer.name}
                              </option>
                            ))}
                          </select>
                          <input type="text" name="referenceNumber" placeholder="Broker Reference #" value={editingLoad?.referenceNumber || ''} onChange={handleEditInputChange} />
                          <input type="text" name="poNumber" placeholder="PO #" value={editingLoad?.poNumber || ''} onChange={handleEditInputChange} />
                          <input type="text" name="pickupNumber" placeholder="Pick Up #" value={editingLoad?.pickupNumber || ''} onChange={handleEditInputChange} />
                          <input type="text" name="reservationNumber" placeholder="Reservation #" value={editingLoad.reservationNumber || ''} onChange={handleEditInputChange} />
                          <input type="text" name="sealNumber" placeholder="Seal #" value={editingLoad.sealNumber} onChange={handleEditInputChange} />
                          <input type="text" name="returnNumber" placeholder="Return #" value={editingLoad.returnNumber || ''} onChange={handleEditInputChange} />
                          <input type="text" name="bookingNumber" placeholder="Booking Number" value={editingLoad.bookingNumber || ''} onChange={handleEditInputChange} />
                        </div>
                      </div>

                      <div className="edit-load-group">
                        <div className="edit-load-group-header">
                          <h4>Equipment</h4>
                          <span>Container, size, ship line, and chassis</span>
                        </div>
                        <div className="edit-load-grid">
                          <input type="text" name="containerNumber" placeholder="Container Number" value={editingLoad.containerNumber} onChange={handleEditInputChange} />
                          <input type="text" name="containerSize" placeholder="Container Size" value={editingLoad.containerSize} onChange={handleEditInputChange} />
                          <select name="shipLine" value={editingLoad.shipLine || ''} onChange={handleEditInputChange}>
                            <option value="">Select Ship Line</option>
                            {shipLineOptions.map((line) => (
                              <option key={line} value={line}>
                                {line}
                              </option>
                            ))}
                          </select>
                          <input type="text" name="chassisNumber" placeholder="Chassis Number" value={editingLoad.chassisNumber} onChange={handleEditInputChange} />
                          <label className="checkbox-row edit-load-wide">
                            <input
                              type="checkbox"
                              name="streetTurn"
                              checked={Boolean(editingLoad.streetTurn)}
                              onChange={(e) =>
                                setEditingLoad((prev) => ({
                                  ...prev,
                                  streetTurn: e.target.checked,
                                }))
                              }
                            />
                            <span>Street Turn / reuse container</span>
                          </label>
                        </div>
                      </div>

                      <div className="edit-load-group">
                        <div className="edit-load-group-header">
                          <h4>Locations</h4>
                          <span>Pickup, delivery, return, and route miles</span>
                        </div>
                        <div className="edit-load-grid">
                          <input type="text" name="pickup" placeholder="Pickup" value={editingLoad.pickup} onChange={handleEditInputChange} />
                          <input type="text" name="delivery" placeholder="Delivery" value={editingLoad.delivery} onChange={handleEditInputChange} />
                          <input type="text" name="returnLocation" placeholder="Return Location" value={editingLoad.returnLocation} onChange={handleEditInputChange} />
                          <select name="deliveryType" value={editingLoad?.deliveryType || ''} onChange={handleEditInputChange}>
                            <option value="">Select Delivery Type</option>
                            <option value="local">Local Delivery</option>
                            <option value="highway">Highway Delivery</option>
                          </select>
                          <label className="edit-load-field edit-load-wide">
                            <span>Route Miles</span>
                            <div className="inline-action-row">
                              <input
                                type="number"
                                name="miles"
                                min="0"
                                step="0.1"
                                placeholder="Auto miles"
                                value={editingLoad.miles || ''}
                                onChange={handleEditInputChange}
                              />
                              <button
                                type="button"
                                className="secondary-btn compact-btn"
                                onClick={() => estimateLoadMiles('edit')}
                                disabled={mileageEstimating === 'edit'}
                              >
                                {mileageEstimating === 'edit' ? 'Calculating...' : 'Estimate'}
                              </button>
                            </div>
                          </label>
                          {mileageEstimateStatus && mileageEstimating !== 'new' && (
                            <p className="documents-empty edit-load-wide">{mileageEstimateStatus}</p>
                          )}
                        </div>
                      </div>

                      <div className="edit-load-group">
                        <div className="edit-load-group-header">
                          <h4>Schedule</h4>
                          <span>Load date, appointment, LFD, and ETA</span>
                        </div>
                        <div className="edit-load-grid">
                          <label className="edit-load-field">
                            <span>Load Date</span>
                            <input type="date" name="loadDate" value={editingLoad?.loadDate || ''} onChange={handleEditInputChange} />
                          </label>
                          <label className="edit-load-field">
                            <span>Appointment Time</span>
                            <input type="datetime-local" name="appointmentTime" value={normalizeDateTimeInputValue(editingLoad?.appointmentTime)} onChange={handleEditInputChange} />
                          </label>
                          <label className="edit-load-field">
                            <span>LFD</span>
                            <input type="date" name="lastFreeDay" value={editingLoad.lastFreeDay || ''} onChange={handleEditInputChange} />
                          </label>
                          <label className="edit-load-field">
                            <span>ETA</span>
                            <input type="datetime-local" name="eta" value={normalizeDateTimeInputValue(editingLoad?.eta)} onChange={handleEditInputChange} />
                          </label>
                        </div>
                      </div>

                      <div className="edit-load-group">
                        <div className="edit-load-group-header">
                          <h4>Drop Details</h4>
                          <span>Drop type, location, driver, and drop time</span>
                        </div>
                        <div className="edit-load-grid">
                          <select name="dropType" value={editingLoad.dropType || ''} onChange={handleEditInputChange}>
                            <option value="">Select Drop Type</option>
                            <option value="Customer">Customer</option>
                            <option value="Yard">Yard / Pre-pull</option>
                          </select>
                          <select name="nextMoveType" value={editingLoad.nextMoveType || 'Delivery'} onChange={handleEditInputChange}>
                            <option value="Delivery">Next Move: Delivery</option>
                            <option value="Return">Next Move: Return</option>
                          </select>
                          <input type="text" name="dropLocation" placeholder="Drop Location" value={editingLoad.dropLocation || ''} onChange={handleEditInputChange} />
                          <select name="droppedBy" value={editingLoad.droppedBy || ''} onChange={handleEditInputChange}>
                            <option value="">Select Dropped By</option>
                            {driversList.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.id} - {d.name}
                              </option>
                            ))}
                          </select>
                          <label className="edit-load-field">
                            <span>Drop Date/Time</span>
                            <input type="datetime-local" name="dropDateTime" value={editingLoad.dropDateTime || ''} onChange={handleEditInputChange} />
                          </label>
                        </div>
                      </div>

                      <div className="edit-load-group">
                        <div className="edit-load-group-header">
                          <h4>Driver, Status & Money</h4>
                          <span>Assignment, availability, rates, and notes</span>
                        </div>
                        <div className="edit-load-grid">
                          <select name="driver" value={editingLoad?.driver || ''} onChange={handleEditInputChange}>
                            <option value="">Select Driver</option>
                            {driversList.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.id} - {d.name}
                              </option>
                            ))}
                          </select>
                          <input type="text" name="truck" placeholder="Truck" value={editingLoad.truck} onChange={handleEditInputChange} readOnly />
                          <label className="edit-load-field">
                            <span>Load Rate</span>
                            <input type="text" name="rate" placeholder="Load Rate" value={editingLoad.rate} onChange={handleEditInputChange} />
                          </label>
                          <label className="edit-load-field">
                            <span>Driver Rate</span>
                            <input type="text" name="driverRate" placeholder="Driver Rate" value={editingLoad.driverRate} onChange={handleEditInputChange} />
                          </label>

                      <select name="status" value={editingLoad.status} onChange={handleEditInputChange}>
                       <option value="Dispatched">Dispatched</option>
<option value="In Transit">In Transit</option>
<option value="Dropped">Dropped</option>
<option value="Delivered">Delivered</option>
                      </select>

                          <select name="availabilityStatus" value={editingLoad?.availabilityStatus || 'Available'} onChange={handleEditInputChange}>
                            <option value="Available">Available</option>
                            <option value="Not Available">Not Available</option>
                          </select>

                      
                          <input type="text" name="detention" placeholder="Customer Detention" value={editingLoad.detention} onChange={handleEditInputChange} />
                          <input type="text" name="lumper" placeholder="Lumper" value={editingLoad.lumper} onChange={handleEditInputChange} />
                          <input type="text" name="fuelAdvance" placeholder="Fuel Advance" value={editingLoad.fuelAdvance} onChange={handleEditInputChange} />
                          <input type="text" name="settlement" value={editingLoad.settlement} readOnly placeholder="Auto Settlement" />
                          <textarea className="edit-load-wide" name="notes" placeholder="Dispatcher Notes" value={editingLoad.notes} onChange={handleEditInputChange} rows="4" />
                        </div>
                      </div>

                    </form>
                  ) : (
                    <>
                      <div className="quick-actions-grid">
                        <div className="quick-driver-box">
                          <label htmlFor="quick-driver-select">Quick Driver Change</label>
                          <select
  id="quick-driver-select"
  value={normalizeDriverForStorage(selectedLoad.driver)}
  onChange={handleQuickDriverChange}
  className="quick-driver-select"
>
  <option value="">-- No Driver --</option>
  {driversList.map((d) => (
    <option key={d.id} value={d.id}>
      {d.id} - {d.name}
    </option>
  ))}
</select>
                        </div>

                        <div className="quick-driver-box">
                          <label htmlFor="quick-status-select">Quick Status Change</label>
                          <select
                            id="quick-status-select"
                            value={getLoadQuickStatus(selectedLoad)}
                            onChange={handleQuickStatusChange}
                            className="quick-driver-select"
                          >
                            <option value="Dispatched">Dispatched</option>
                            <option value="In Transit">In Transit</option>
                            <option value="Dropped">Dropped</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Available">Available</option>
                            <option value="Not Available">Not Available</option>
                          </select>
                        </div>
                      </div>

                      {getLoadQuickStatusKey(selectedLoad) === 'dropped' && (
                        <div className="drop-details-panel">
                          <div className="panel-header compact-header">
                            <div>
                              <h3>Drop Details</h3>
                              <p className="panel-subtitle">Record where dispatch wants the container tracked after the driver drops it.</p>
                            </div>
                            <div className="details-actions">
                              <button type="button" className="secondary-btn compact-btn" onClick={handleReopenDroppedLoad}>
                                Reopen for Driver
                              </button>
                              <button type="button" className="primary-btn compact-btn" onClick={handleSaveDropDetails}>
                                Save Drop
                              </button>
                            </div>
                          </div>

                          <div className="drop-details-grid">
                            <label>
                              <span>Drop Type</span>
                              <select
                                value={dropDetailsDraft.dropType || ''}
                                onChange={(e) =>
                                  setDropDetailsDraft((prev) => ({
                                    ...prev,
                                    dropType: e.target.value,
                                    dropLocation: '',
                                  }))
                                }
                              >
                                <option value="">Select Drop Type</option>
                                <option value="Customer">Customer</option>
                                <option value="Yard">Yard</option>
                              </select>
                            </label>
                            <label>
                              <span>Next Move</span>
                              <select
                                value={dropDetailsDraft.nextMoveType || 'Delivery'}
                                onChange={(e) =>
                                  setDropDetailsDraft((prev) => ({
                                    ...prev,
                                    nextMoveType: e.target.value,
                                  }))
                                }
                              >
                                <option value="Delivery">Delivery</option>
                                <option value="Return">Return</option>
                              </select>
                            </label>
                            <label>
                              <span>Drop Location</span>
                              <select
                                value={dropDetailsDraft.dropLocation || ''}
                                onChange={(e) =>
                                  setDropDetailsDraft((prev) => ({
                                    ...prev,
                                    dropLocation: e.target.value,
                                  }))
                                }
                              >
                                <option value="">Select drop location</option>
                                {((dropDetailsDraft.dropType || selectedLoad.dropType) === 'Yard'
                                  ? returnLocations
                                  : deliveryLocations
                                ).map((loc) => {
                                  const address = formatLocationAddress(loc);
                                  return (
                                    <option key={loc.id} value={address}>
                                      {getLocationOptionLabel(loc)}
                                    </option>
                                  );
                                })}
                              </select>
                            </label>
                            <label>
                              <span>Dropped By</span>
                              <select
                                value={normalizeDriverForStorage(dropDetailsDraft.droppedBy)}
                                onChange={(e) =>
                                  setDropDetailsDraft((prev) => ({
                                    ...prev,
                                    droppedBy: e.target.value,
                                  }))
                                }
                              >
                                <option value="">Select driver</option>
                                {driversList.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.id} - {d.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span>Drop Date/Time</span>
                              <input
                                type="datetime-local"
                                value={dropDetailsDraft.dropDateTime || ''}
                                onChange={(e) =>
                                  setDropDetailsDraft((prev) => ({
                                    ...prev,
                                    dropDateTime: e.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              <span>Next Driver</span>
                              <select
                                value={normalizeDriverForStorage(dropDetailsDraft.nextDriver)}
                                onChange={(e) =>
                                  setDropDetailsDraft((prev) => ({
                                    ...prev,
                                    nextDriver: e.target.value,
                                  }))
                                }
                              >
                                <option value="">Select driver to move it</option>
                                {driversList.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.id} - {d.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>
                      )}

                      <div className="port-check-box">
                        <div className="documents-header">
                          <h4>Port Houston Container Availability</h4>
                          <button
                            type="button"
                            className="primary-btn"
                            onClick={() => handleCheckPortHouston(selectedLoad)}
                            disabled={portHoustonCheckingLoadId === selectedLoad.id}
                          >
                            {portHoustonCheckingLoadId === selectedLoad.id ? 'Checking...' : 'Check Port Houston'}
                          </button>
                        </div>
                        <p className="documents-empty">
                          Current availability status: <strong>{selectedLoad.availabilityStatus || 'Not Available'}</strong>
                        </p>
                      </div>

                      <div className="details-grid">
                        <div className="detail-box"><span>Load Date</span><strong>{selectedLoad.loadDate}</strong></div>
                        <div className="detail-box"><span>Reference #</span><strong>{selectedLoad.referenceNumber || '—'}</strong></div>
                        <div className="detail-box"><span>PO #</span><strong>{selectedLoad.poNumber || '—'}</strong></div>
                        <div className="detail-box"><span>Pick Up #</span><strong>{selectedLoad.pickupNumber || '—'}</strong></div>
                        <div className="detail-box">
  <span>Return #</span>
  <strong>{selectedLoad.returnNumber || '—'}</strong>
</div>
<div className="detail-box">
  <span>Reservation #</span>
  <strong>{selectedLoad.reservationNumber || '—'}</strong>
</div>
                        <div className="detail-box"><span>Container Number</span><strong>{selectedLoad.containerNumber || '—'}</strong></div>
                        <div className="detail-box"><span>Container Size</span><strong>{selectedLoad.containerSize || '—'}</strong></div>
                        <div className="detail-box"><span>Ship Line</span><strong>{selectedLoad.shipLine || '—'}</strong></div>

                        <div className="detail-box">
  <span>Driver</span>
  <strong>{getDriverLabel(selectedLoad.driver)}</strong>
</div>
                        <div className="detail-box"><span>Truck</span><strong>{selectedLoad.truck}</strong></div>
                        <div className="detail-box"><span>Availability</span><strong>{selectedLoad.availabilityStatus || 'Not Available'}</strong></div>
                        <div className="detail-box"><span>Delivery Type</span><strong>{getDeliveryTypeLabel(selectedLoad.deliveryType)}</strong></div>
                        <div className="detail-box"><span>Pick Up Location</span><strong>{selectedLoad.pickup}</strong></div>
                        <div className="detail-box"><span>Delivery Location</span><strong>{getDeliveryDisplay(selectedLoad.delivery) || '—'}</strong></div>
                        <div className="detail-box"><span>Appointment</span><strong>{formatAppointmentTime(selectedLoad.appointmentTime)}</strong></div>
                        <div className="detail-box"><span>ETA</span><strong>{formatAppointmentTime(selectedLoad.eta)}</strong></div>
                        <div className="detail-box"><span>Return Location</span><strong>{selectedLoad.returnLocation}</strong></div>
                        <div className="detail-box"><span>Route Miles</span><strong>{formatMiles(selectedLoad.miles)}</strong></div>
                        <div className="detail-box">
  <span>Drop Type</span>
  <strong>{selectedLoad.dropType || '—'}</strong>
</div>

<div className="detail-box">
  <span>Next Move</span>
  <strong>{getLoadNextMoveType(selectedLoad)}</strong>
</div>

<div className="detail-box">
  <span>Drop Location</span>
  <strong>{selectedLoad.dropLocation || '—'}</strong>
</div>

<div className="detail-box">
  <span>Dropped By</span>
  <strong>
    {getDroppedByDriverValue(selectedLoad)
      ? getDriverLabel(getDroppedByDriverValue(selectedLoad))
      : '—'}
  </strong>
</div>

<div className="detail-box">
  <span>Drop Date/Time</span>
  <strong>{formatDateTime(selectedLoad.dropDateTime)}</strong>
</div>
                        <div className="detail-box"><span>Booking Number</span><strong>{selectedLoad.bookingNumber || '—'}</strong></div>
                        <div className="detail-box"><span>Chassis Number</span><strong>{selectedLoad.chassisNumber}</strong></div>
                        <div className="detail-box"><span>Seal Number</span><strong>{selectedLoad.sealNumber}</strong></div>
                        <div className="detail-box"><span>Load Rate</span><strong>{selectedLoad.rate}</strong></div>
                        <div className="detail-box"><span>Bill Total</span><strong>{formatMoney(getCustomerBillAmount(selectedLoad))}</strong></div>
                        <div className="detail-box"><span>Driver Rate</span><strong>{selectedLoad.driverRate}</strong></div>
                        <div className="detail-box"><span>Driver Pay</span><strong>{formatMoney(getDriverPayWithDetention(selectedLoad))}</strong></div>
                        <div className="detail-box"><span>Paperwork</span><strong>{selectedLoad.paperwork}</strong></div>
                        <div className="detail-box"><span>Customer Detention</span><strong>{selectedLoad.detention}</strong></div>
                        
                      </div>

                      <div className="settlement-box">
                        <h4>Customer / Driver Amounts</h4>
                        <div className="settlement-row"><span>Load Rate</span><strong>{selectedLoad.rate}</strong></div>
                        <div className="settlement-row"><span>Bill Total</span><strong>{formatMoney(getCustomerBillAmount(selectedLoad))}</strong></div>
                        <div className="settlement-row"><span>Driver Rate</span><strong>{selectedLoad.driverRate}</strong></div>
                        <div className="settlement-row"><span>Customer Detention</span><strong>{selectedLoad.detention}</strong></div>
                        <div className="settlement-row"><span>Lumper</span><strong>{selectedLoad.lumper}</strong></div>
                        <div className="settlement-row"><span>Fuel Advance</span><strong>- {selectedLoad.fuelAdvance}</strong></div>
                        <div className="settlement-row total"><span>Settlement</span><strong>{selectedLoad.settlement}</strong></div>
                      </div>

                      {(() => {
                        const checkState = portHoustonChecksByLoad[selectedLoad.id];
                        const summary = getPortHoustonSummary(checkState?.result);
                        return (
                          <div className="port-check-box">
                            <div className="documents-header">
                              <h4>Port Houston Check</h4>
                              <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => handleCheckPortHouston(selectedLoad)}
                                disabled={portHoustonCheckingLoadId === selectedLoad.id}
                              >
                                {portHoustonCheckingLoadId === selectedLoad.id ? 'Checking...' : 'Refresh'}
                              </button>
                            </div>

                            {checkState?.error ? (
                              <div className="port-check-error">
                                <strong>Unable to check Port Houston</strong>
                                <p>{checkState.error}</p>
                              </div>
                            ) : checkState?.result ? (
                              <div className="port-check-grid">
                                <div className="detail-box">
                                  <span>Available</span>
                                  <strong>
                                    {summary.available === true
                                      ? 'Yes'
                                      : summary.available === false
                                        ? 'No'
                                        : 'Not returned'}
                                  </strong>
                                </div>
                                <div className="detail-box"><span>Terminal</span><strong>{summary.terminal || 'Not returned'}</strong></div>
                                <div className="detail-box"><span>Last Free Day</span><strong>{summary.lastFreeDay || 'Not returned'}</strong></div>
                                <div className="detail-box"><span>Transit State</span><strong>{summary.transitState || 'Not returned'}</strong></div>
                                <div className="detail-box"><span>Road Hold</span><strong>{summary.stoppedRoad === true ? 'Yes' : summary.stoppedRoad === false ? 'No' : 'Not returned'}</strong></div>
                                <div className="detail-box">
                                  <span>Last Gate Move</span>
                                  <strong>{formatPortHoustonGateMove(summary.lastGateMove)}</strong>
                                </div>
                                <div className="detail-box port-check-note">
                                  <span>Port Status Reason</span>
                                  <strong>{summary.statusReason || 'Not returned'}</strong>
                                </div>
                                <div className="detail-box">
                                  <span>Holds / Road Impediments</span>
                                  <strong>{formatPortHoustonList(summary.roadImpediments)}</strong>
                                </div>
                                <div className="detail-box"><span>OUT EIR</span><strong>{summary.outEir?.url ? <a href={summary.outEir.url} target="_blank" rel="noreferrer">Open</a> : 'Not available'}</strong></div>
                                <div className="detail-box"><span>IN EIR</span><strong>{summary.inEir?.url ? <a href={summary.inEir.url} target="_blank" rel="noreferrer">Open</a> : 'Not available'}</strong></div>
                                <div className="detail-box">
                                  <span>Gate Transactions</span>
                                  <strong>
                                    {summary.gateTransactionCount
                                      ? `${summary.gateTransactionCount} found${summary.gateLookupMethod ? ` (${summary.gateLookupMethod})` : ''}`
                                      : summary.gateLookupReason || 'None returned'}
                                  </strong>
                                </div>
                                <div className="detail-box port-check-note">
                                  <span>EIR Status</span>
                                  <strong>
                                    {summary.eirNote ||
                                      (summary.hasPortDocuments
                                        ? 'Port says official EIR documents exist in the Customer Service Portal. EVP returns digital EIR data only.'
                                        : 'No EIR data returned yet.')}
                                  </strong>
                                </div>
                                <div className="detail-box"><span>Checked By</span><strong>{summary.checkedBy || 'Not returned'}</strong></div>
                                <div className="detail-box"><span>Checked At</span><strong>{formatDateTime(summary.checkedAt)}</strong></div>
                              </div>
                            ) : (
                              <p className="documents-empty">
                                Click Check Port Houston to request availability, holds, LFD, and gate movement details.
                              </p>
                            )}
                          </div>
                        );
                      })()}

                      <div className="documents-box">
                        <div className="documents-header">
                          <h4>Documents / Paperwork</h4>
                          <div className="documents-toolbar">
<button
  type="button"
  className="customer-pdf-btn"
  onClick={() => handleGenerateCustomerPdf(selectedLoad)}
>
  Generate Customer PDF
</button>
                            <select
                              value={selectedDocumentType}
                              onChange={(e) => setSelectedDocumentType(e.target.value)}
                              className="document-type-select"
                            >
                              {documentTypes.map((docType) => (
                                <option key={docType} value={docType}>
                                  {docType}
                                </option>
                              ))}
                            </select>

                            <label className="upload-btn">
                              Upload Files
                              <input
  type="file"
  multiple
  onChange={handleDocumentUpload}
  ref={fileInputRef}
  hidden
/>
                            </label>
                          </div>
                        </div>

                        <div className="checklist-grid">
                          {checklistDocumentTypes.map((docType) => {
                            const isUploaded = getChecklistStatus(selectedLoad, docType);
                            const uploadedDoc = (selectedLoad.documents || []).find(
  (doc) =>
    (doc.category || doc.type || '').toLowerCase() === docType.toLowerCase()
);

                            return (
                              <div key={docType} className={`checklist-card ${isUploaded ? 'uploaded' : 'missing'}`}>
                                <span>{docType}</span>
                                <strong>
  {isUploaded
    ? `Uploaded (${uploadedDoc?.name || ''})`
    : 'Missing'}
</strong>
                              </div>
                            );
                          })}
                        </div>

                        {selectedLoad.documents && selectedLoad.documents.length > 0 ? (
                          <div className="documents-list">
                            {selectedLoad.documents.map((doc) => (
                              <div key={doc.id} className="document-card">
                                <div className="document-info">
                                  <strong>{doc.name}</strong>
                                  <p>{doc.size} • {normalizeDocType(doc.type)}</p>

                                  <div className="document-meta">
                                    <span className="document-badge">{doc.category}</span>

                                    <select
                                      value={doc.category}
                                      onChange={(e) => handleDocumentCategoryChange(doc.id, e.target.value)}
                                      className="document-row-select"
                                    >
                                      {documentTypes.map((docType) => (
                                        <option key={docType} value={docType}>
                                          {docType}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                <div className="document-actions">
                                  <button className="secondary-btn" onClick={() => handleOpenDocument(doc)}>Open</button>
                                  <button className="secondary-btn" onClick={() => handleDownloadDocument(doc)}>Download</button>
                                  <button className="secondary-btn" onClick={() => handleDeleteDocument(doc.id)}>Remove</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="documents-empty">No documents uploaded yet.</p>
                        )}
                      </div>

                      <div className="audit-panel load-audit-box">
                        <div className="documents-header">
                          <h4>Audit History</h4>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => fetchSelectedLoadAuditLogs(selectedLoad.id)}
                          >
                            Refresh
                          </button>
                        </div>

                        {selectedLoadAuditLogs.length === 0 ? (
                          <p className="documents-empty">No audit history for this load yet.</p>
                        ) : (
                          <div className="audit-list compact">
                            {selectedLoadAuditLogs.map((log) => {
                              const changedFields = parseAuditJson(log.changedFields, {});
                              const changedEntries = Object.entries(changedFields || {});
                              return (
                                <div key={log.id} className="audit-row">
                                  <div className="audit-row-main">
                                    <strong>{log.action}</strong>
                                    <span>{log.userName || 'System'} • {formatDateTime(log.createdAt)}</span>
                                  </div>
                                  <div className="audit-changes">
                                    {changedEntries.length === 0 ? (
                                      <span>No field details</span>
                                    ) : (
                                      changedEntries.map(([field, change]) => (
                                        <div key={field} className="audit-change">
                                          <span>{field}</span>
                                          <strong>{formatAuditValue(change?.oldValue)} → {formatAuditValue(change?.newValue)}</strong>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="notes-box">
                        <h4>Dispatcher Notes</h4>
                        <p>{newLoad.notes}</p>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <p>No load selected.</p>
                </div>
              )}
            </section>
          </main>

          <section className="bottom-grid">
            <section className="panel">
              <div className="panel-header"><h3>Driver Status</h3></div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Status</th>
                      <th>Truck</th>
                      <th>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverStatuses.map((item) => (
                      <tr key={item.driver}>
                        <td>{item.driver}</td>
                        <td>{item.status}</td>
                        <td>{item.truck}</td>
                        <td>{item.location}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><h3>Paperwork Alerts</h3></div>
              <div className="alerts-list">
                {paperworkAlerts.map((load) => (
                  <div key={load.id} className="alert-card">
                    <strong>{load.id}</strong>
                    <p>
  Driver:{' '}
  {getDriverLabel(load.driver)}
</p>
                    {load.paperwork && <p>Paperwork Status: {load.paperwork}</p>}
                  </div>
                ))}
              </div>
            </section>
          </section>
        </>
      )}

      {activeView === 'settlements' && (
        <div className="settlements-view">
        <section className="panel settlement-entry-panel">
          <div className="panel-header">
            <div>
              <h3>Payroll Load Pay Entry</h3>
              <p className="panel-subtitle">Choose one driver and settlement period, then add pay, deductions, and payroll notes.</p>
            </div>
            <span>{settlementPeriodLabel}</span>
          </div>

          {settlementPayStatus && (
            <div className="settlement-period-note">
              <p>{settlementPayStatus}</p>
            </div>
          )}

          <div className="settlement-period-note">
            <p>
              {activeBackendSettlement?.id
                ? `Database settlement ${activeBackendSettlement.status || activeBackendSettlement.statement?.settlement?.status || 'Draft'}: ${formatMoney(activeBackendSettlement.statement?.totals?.netPay || 0)} net pay, ${activeBackendSettlement.statement?.totals?.loadCount || 0} load(s), version ${activeBackendSettlement.statement?.settlement?.version || activeBackendSettlement.version || 1}.`
                : settlementStartDate && settlementEndDate
                  ? 'No database settlement has been created for this driver/week yet.'
                  : 'Choose a driver and week to create a database settlement.'}
            </p>
            {settlementBackendStatus && <p>{settlementBackendStatus}</p>}
            <div className="settlement-period-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={activeBackendSettlement?.id ? fetchActiveBackendSettlement : createBackendSettlement}
                disabled={settlementBackendLoading || !activeSettlementDriverId || !settlementStartDate || !settlementEndDate}
              >
                {activeBackendSettlement?.id ? 'Refresh Database Settlement' : 'Create Database Settlement'}
              </button>
              {activeBackendSettlement?.id && (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={fetchActiveBackendSettlement}
                  disabled={settlementBackendLoading}
                >
                  Reload
                </button>
              )}
              {activeBackendSettlement?.id &&
                String(activeBackendSettlement.status || activeBackendSettlement.statement?.settlement?.status || '')
                  .trim()
                  .toLowerCase() !== 'complete' && (
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleCompleteBackendSettlement}
                    disabled={settlementBackendLoading}
                  >
                    Complete Settlement
                  </button>
                )}
            </div>
          </div>

          <div className="settlement-entry-grid">
            <label className="settlement-entry-field settlement-entry-driver">
              <span>Driver</span>
              <select
                className="filter-select"
                value={selectedSettlementDriverId || driversList[0]?.id || ''}
                onChange={(e) => {
                  setSelectedSettlementDriverId(e.target.value);
                  setSelectedSettlementLoadId('');
                }}
              >
                {driversList.length === 0 ? (
                  <option value="">No drivers found</option>
                ) : (
                  driversList.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.id} - {driver.name}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="settlement-entry-field">
              <span>Appointment Start</span>
              <input
                type="date"
                value={settlementStartDate}
                onChange={(e) => {
                  setSettlementStartDate(e.target.value);
                  setSelectedSettlementLoadId('');
                }}
              />
            </label>

            <label className="settlement-entry-field">
              <span>Appointment End</span>
              <input
                type="date"
                value={settlementEndDate}
                onChange={(e) => {
                  setSettlementEndDate(e.target.value);
                  setSelectedSettlementLoadId('');
                }}
              />
            </label>

            <div className="settlement-period-actions">
              <button type="button" className="secondary-btn" onClick={() => handleSetSettlementWeek('previous')}>
                Previous Week
              </button>
              <button type="button" className="secondary-btn" onClick={() => handleSetSettlementWeek('current')}>
                This Week
              </button>
              <button type="button" className="secondary-btn" onClick={() => handleSetSettlementWeek('next')}>
                Next Week
              </button>
              <button type="button" className="secondary-btn" onClick={handleClearSettlementPeriod}>
                All Dates
              </button>
            </div>

            <div className="settlement-entry-field settlement-manual-load-field">
              <span>Add Load Outside Period</span>
              <input
                type="search"
                placeholder="Search by container, load ID, reference, PO, customer"
                value={settlementManualLoadSearch}
                onChange={(e) => setSettlementManualLoadSearch(e.target.value)}
              />
              {settlementManualLoadSearch.trim() && (
                <div className="settlement-manual-results">
                  {settlementManualLoadCandidates.length === 0 ? (
                    <p>No outside-period loads found for this driver.</p>
                  ) : (
                    settlementManualLoadCandidates.map((load) => (
                      <button
                        key={load.id}
                        type="button"
                        className="settlement-manual-result"
                        onClick={() => handleAddManualSettlementLoad(load.id)}
                      >
                        <strong>{load.containerNumber || load.id}</strong>
                        <span>
                          {formatAppointmentTime(load.appointmentTime) || 'No appointment'} - {load.customer || 'No customer'} - {load.referenceNumber || load.poNumber || load.id}
                        </span>
                        <span>
                          Load driver: {getDriverLabel(load.driver)} - Pays to: {getDriverLabel(activeSettlementDriverId)}
                        </span>
                        <span>
                          {isLoadOutsideSettlementPeriod(load) ? 'Outside current period' : 'Inside current period'} - {getDeliveryDisplay(load.delivery) || 'No delivery'}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {currentSettlementManualLoadIds.length > 0 && (
                <p className="settlement-manual-note">
                  {currentSettlementManualLoadIds.length} manually added load{currentSettlementManualLoadIds.length === 1 ? '' : 's'} in this settlement.
                </p>
              )}
            </div>

            <label className="settlement-entry-field settlement-container-search">
              <span>Search Container</span>
              <input
                type="search"
                placeholder="Type container number"
                value={settlementContainerSearch}
                onChange={(e) => {
                  setSettlementContainerSearch(e.target.value);
                  setSelectedSettlementLoadId('');
                }}
              />
            </label>

            <label className="settlement-entry-field settlement-entry-load">
              <span>Load</span>
              <select
                className="filter-select"
                value={selectedSettlementLoad?.id || ''}
                onChange={(e) => handleSettlementLoadSelect(e.target.value)}
              >
                {visibleSettlementLoads.length === 0 ? (
                  <option value="">No loads found</option>
                ) : (
                  visibleSettlementLoads.map((load) => (
                    <option key={load.id} value={load.id}>
                      {formatAppointmentTime(load.appointmentTime) || 'No appointment'} - {load.containerNumber || 'No container'} - {getDriverLabel(load.driver)} - {load.id}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="settlement-entry-field settlement-note-field">
              <span>Payroll Note</span>
              <textarea
                rows="3"
                placeholder="Internal note for this driver's settlement"
                value={settlementNote}
                onChange={(e) => setSettlementNote(e.target.value)}
              />
            </label>

            <div className="settlement-entry-meta">
              <div>
                <span>Customer</span>
                <strong>{selectedSettlementLoad?.customer || '-'}</strong>
              </div>
              <div>
                <span>Container</span>
                <strong>{selectedSettlementLoad?.containerNumber || '-'}</strong>
              </div>
              <div>
                <span>Reference</span>
                <strong>{selectedSettlementLoad?.referenceNumber || selectedSettlementLoad?.bookingNumber || '-'}</strong>
              </div>
            </div>

            {selectedSettlementLoad && (
              <>
                <label className="settlement-entry-field">
                  <span>Load Pay</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={getSettlementPayValue(selectedSettlementLoad, 'driverRate')}
                    onChange={(e) =>
                      handleSettlementPayChange(selectedSettlementLoad.id, 'driverRate', e.target.value)
                    }
                  />
                </label>

                <label className="settlement-entry-field">
                  <span>Lumper</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={getSettlementPayValue(selectedSettlementLoad, 'lumper')}
                    onChange={(e) =>
                      handleSettlementPayChange(selectedSettlementLoad.id, 'lumper', e.target.value)
                    }
                  />
                </label>

                <label className="settlement-entry-field">
                  <span>Deductions / Fuel Advance</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={getSettlementPayValue(selectedSettlementLoad, 'fuelAdvance')}
                    onChange={(e) =>
                      handleSettlementPayChange(selectedSettlementLoad.id, 'fuelAdvance', e.target.value)
                    }
                  />
                </label>

                <label className="settlement-entry-field settlement-deduction-detail-field">
                  <span>Deduction Reason</span>
                  <input
                    type="search"
                    list="settlement-deduction-reasons"
                    placeholder="Search or type reason"
                    value={getSettlementDeductionDetail(selectedSettlementLoad)}
                    onChange={(e) =>
                      handleSettlementDeductionDetailChange(selectedSettlementLoad.id, e.target.value)
                    }
                  />
                  <datalist id="settlement-deduction-reasons">
                    {savedDeductionReasons.map((reason) => (
                      <option key={reason} value={reason} />
                    ))}
                  </datalist>
                </label>

                <label className="settlement-entry-field settlement-deduction-save-field">
                  <span>Save New Reason</span>
                  <div className="settlement-deduction-save-row">
                    <input
                      type="text"
                      placeholder="Example: Repair, advance, toll"
                      value={settlementDeductionReasonInput}
                      onChange={(e) => setSettlementDeductionReasonInput(e.target.value)}
                    />
                    <button type="button" className="secondary-btn" onClick={handleSaveDeductionReason}>
                      Add
                    </button>
                  </div>
                </label>

                <div className="settlement-entry-total">
                  <span>Net Driver Pay</span>
                  <strong>{getSettlementPayTotal(selectedSettlementLoad)}</strong>
                </div>

                <div className="settlement-entry-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => handleSaveSettlementPay(selectedSettlementLoad)}
                  >
                    Save Load Pay
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => handleResetSettlementPayDraft(selectedSettlementLoad.id)}
                  >
                    Reset
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        {false && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Driver Settlement Summary</h3>
              <p className="panel-subtitle">
                {activeSettlementDriver ? `${activeSettlementDriver.id} - ${activeSettlementDriver.name}` : 'No driver selected'} • {settlementPeriodLabel}
              </p>
            </div>
            <div className="details-actions">
              <span>{settlementTotals.loadsCount} loads</span>
              <button className="secondary-btn" onClick={handleExportSettlementCsv}>Export CSV</button>
              <button className="primary-btn" onClick={handlePrintSettlementReport}>Print Report</button>
            </div>
          </div>

          {settlementNote && (
            <div className="settlement-note-preview">
              <span>Payroll Note</span>
              <p>{settlementNote}</p>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Loads</th>
                  <th>Gross Revenue</th>
                  <th>Shared Deductions</th>
                  <th>Base Driver Pay</th>
                  <th>Parking</th>
                  <th>Loan</th>
                  <th>Detention</th>
                  <th>Take Home Pay</th>
                </tr>
              </thead>
              <tbody>
                {settlementReport.map((item) => (
                  <tr key={item.driverId}>
                    <td>{item.driverId} - {item.driverName}</td>
                    <td>{item.loadsCount}</td>
                    <td>{item.grossPay}</td>
                    <td>{item.sharedDeductions}</td>
                    <td>{item.driverShare}</td>
                    <td>{item.parking}</td>
                    <td>{item.loanRepayment}</td>
                    <td>{item.totalDetention}</td>
                    <td>{item.finalPayCheck}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {activeBackendSettlement?.id && (
          <section className="panel settlement-deductions-panel">
            <div className="panel-header">
              <div>
                <h3>Database Deductions / Reimbursements</h3>
                <p className="panel-subtitle">Choose Deduction to subtract from pay or Reimbursement to add money back to the driver.</p>
              </div>
              <span>{formatMoney(activeBackendSettlement.statement?.totals?.adjustmentsTotal || 0)}</span>
            </div>

            <div className="settlement-custom-deduction-form">
              <label className="settlement-entry-field">
                <span>Type</span>
                <select
                  className="filter-select"
                  value={backendDeductionDraft.kind}
                  onChange={(e) => handleBackendDeductionDraftChange('kind', e.target.value)}
                >
                  <option value="deduction">Deduction - subtract from pay</option>
                  <option value="reimbursement">Add Pay / Reimbursement - add to pay</option>
                </select>
              </label>
              <div className="settlement-entry-field">
                <span>Description</span>
                <div className="settlement-deduction-save-row">
                  <input
                    type="search"
                    list="settlement-deduction-reasons"
                    placeholder="Driver detention pay, parking, repair, reimbursement"
                    value={backendDeductionDraft.description}
                    onChange={(e) => handleBackendDeductionDraftChange('description', e.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={handleRemoveSavedBackendDeductionReason}
                    disabled={settlementBackendLoading}
                    title="Remove this saved description"
                  >
                    X
                  </button>
                </div>
              </div>
              <label className="settlement-entry-field">
                <span>Calculation</span>
                <select
                  className="filter-select"
                  value={backendDeductionDraft.calculationType}
                  onChange={(e) => handleBackendDeductionDraftChange('calculationType', e.target.value)}
                >
                  <option value="flat">Flat $</option>
                  <option value="percent">Percent % of gross pay</option>
                </select>
              </label>
              <label className="settlement-entry-field">
                <span>{backendDeductionDraft.calculationType === 'percent' ? 'Percent' : 'Amount'}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={backendDeductionDraft.calculationType === 'percent' ? '10' : '37.50'}
                  value={backendDeductionDraft.amount}
                  onChange={(e) => handleBackendDeductionDraftChange('amount', e.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary-btn"
                onClick={handleAddBackendDeduction}
                disabled={settlementBackendLoading}
              >
                {editingBackendDeductionId
                  ? 'Save Adjustment'
                  : `Add ${backendDeductionDraft.kind === 'reimbursement' ? 'Pay / Reimbursement' : 'Deduction'}`}
              </button>
              {editingBackendDeductionId && (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleCancelBackendDeductionEdit}
                  disabled={settlementBackendLoading}
                >
                  Cancel
                </button>
              )}
              {backendDeductionDraft.calculationType === 'percent' && backendDeductionDraft.amount && (
                <p className="settlement-manual-note">
                  Calculates to {formatMoney(
                    parseMoney(activeBackendSettlement.statement?.totals?.grossPay || 0) *
                      (Math.abs(parseMoney(backendDeductionDraft.amount)) / 100)
                  )} from gross pay.
                </p>
              )}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Added By</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeBackendSettlement.statement?.deductions || []).length === 0 ? (
                    <tr>
                      <td colSpan="6" className="settlement-empty-cell">No database deductions or reimbursements yet.</td>
                    </tr>
                  ) : (
                    activeBackendSettlement.statement.deductions.map((item) => (
                      <tr key={item.id}>
                        <td>{parseMoney(item.amount) < 0 ? 'Deduction' : 'Reimbursement'}</td>
                        <td>{item.description}</td>
                        <td>{item.addedBy || '-'}</td>
                        <td>{formatDateTime(item.createdAt)}</td>
                        <td>{formatMoney(item.amount)}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleEditBackendDeduction(item)}
                            disabled={settlementBackendLoading}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleRemoveBackendDeduction(item.id)}
                            disabled={settlementBackendLoading}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeBackendSettlement?.id && (
          <section className="panel settlement-deductions-panel">
            <div className="panel-header">
              <div>
                <h3>Net Deductions</h3>
                <p className="panel-subtitle">Subtract after net pay for items like final payroll deductions or post-settlement charges.</p>
              </div>
              <span>-{formatMoney(activeBackendSettlement.statement?.totals?.netDeductionsTotal || 0)}</span>
            </div>

            <div className="settlement-custom-deduction-form">
              <label className="settlement-entry-field">
                <span>Description</span>
                <input
                  type="text"
                  placeholder="Example: post-settlement repair, final deduction"
                  value={backendNetDeductionDraft.description}
                  onChange={(e) => handleBackendNetDeductionDraftChange('description', e.target.value)}
                />
              </label>
              <label className="settlement-entry-field">
                <span>Amount</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="37.50"
                  value={backendNetDeductionDraft.amount}
                  onChange={(e) => handleBackendNetDeductionDraftChange('amount', e.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary-btn"
                onClick={handleAddBackendNetDeduction}
                disabled={settlementBackendLoading}
              >
                {editingBackendNetDeductionId ? 'Save Net Deduction' : 'Add Net Deduction'}
              </button>
              {editingBackendNetDeductionId && (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleCancelBackendNetDeductionEdit}
                  disabled={settlementBackendLoading}
                >
                  Cancel
                </button>
              )}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Added By</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeBackendSettlement.statement?.netDeductions || []).length === 0 ? (
                    <tr>
                      <td colSpan="5" className="settlement-empty-cell">No net deductions yet.</td>
                    </tr>
                  ) : (
                    activeBackendSettlement.statement.netDeductions.map((item) => (
                      <tr key={item.id}>
                        <td>{item.description}</td>
                        <td>{item.addedBy || '-'}</td>
                        <td>{formatDateTime(item.createdAt)}</td>
                        <td>{formatMoney(item.amount)}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleEditBackendNetDeduction(item)}
                            disabled={settlementBackendLoading}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleRemoveBackendDeduction(item.id)}
                            disabled={settlementBackendLoading}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeBackendSettlement?.statement && (
          <section className="panel settlement-detail-panel">
            <div className="panel-header">
              <div>
                <h3>Database Settlement Statement</h3>
                <p className="panel-subtitle">
                  {activeBackendSettlement.status || activeBackendSettlement.statement?.settlement?.status || 'Draft'} statement for {activeBackendSettlement.statement.driver?.id} - {activeBackendSettlement.statement.driver?.name}
                </p>
              </div>
              <div className="details-actions">
                <span>Gross {formatMoney(activeBackendSettlement.statement.totals?.grossPay || 0)}</span>
                <span>Net Deductions {formatMoney(-(activeBackendSettlement.statement.totals?.netDeductionsTotal || 0))}</span>
                <span>Net {formatMoney(activeBackendSettlement.statement.totals?.netPay || 0)}</span>
                <button type="button" className="secondary-btn" onClick={handleExportBackendSettlementCsv}>
                  Export CSV
                </button>
                <button type="button" className="primary-btn" onClick={handlePrintBackendSettlementReport}>
                  Print Report
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Appointment</th>
                    <th>Load</th>
                    <th>Customer</th>
                    <th>Container</th>
                    <th>Miles</th>
                    <th>Source</th>
                    <th>Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeBackendSettlement.statement.loads || []).length === 0 ? (
                    <tr>
                      <td colSpan="7" className="settlement-empty-cell">No database settlement loads yet.</td>
                    </tr>
                  ) : (
                    activeBackendSettlement.statement.loads.map((line) => (
                      <tr key={line.settlementLoadId}>
                        <td>{formatAppointmentTime(line.appointmentTime) || '-'}</td>
                        <td>{line.loadId || line.description || '-'}</td>
                        <td>{line.customer || '-'}</td>
                        <td>
                          {line.loadId ? (
                            <button
                              type="button"
                              className="settlement-link-button"
                              onClick={() => setSettlementReviewLoadId(line.loadId)}
                            >
                              {line.containerNumber || line.loadId}
                            </button>
                          ) : (
                            line.containerNumber || '-'
                          )}
                        </td>
                        <td>{formatMiles(line.miles)}</td>
                        <td>{line.source || 'auto'}</td>
                        <td>{formatMoney(line.payAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Adjustment</th>
                    <th>Added By</th>
                    <th>Date</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeBackendSettlement.statement.deductions || []).length === 0 ? (
                    <tr>
                      <td colSpan="4" className="settlement-empty-cell">No database deductions or reimbursements yet.</td>
                    </tr>
                  ) : (
                    activeBackendSettlement.statement.deductions.map((item) => (
                      <tr key={item.id}>
                        <td>{item.description}</td>
                        <td>{item.addedBy || '-'}</td>
                        <td>{formatDateTime(item.createdAt)}</td>
                        <td>{formatMoney(item.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="panel settlement-detail-panel">
          <div className="panel-header">
            <div>
              <h3>Settlement Sheet</h3>
              <p className="panel-subtitle">Review and edit every load in a sheet-style payroll table.</p>
            </div>
            <span>{visibleSettlementLoads.length} loads</span>
          </div>

          <div className="settlement-sheet-wrap">
            <table className="settlement-load-sheet">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Driver</th>
                  <th>Load</th>
                  <th>Customer</th>
                  <th>Container</th>
                  <th>Load Pay</th>
                  <th>Lumper</th>
                  <th>Deductions</th>
                  <th>Deduction Reason</th>
                  <th>Net Settlement</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleSettlementLoads.length === 0 ? (
                  <tr>
                      <td colSpan="11" className="settlement-empty-cell">
                      No loads found for this settlement period or container search.
                    </td>
                  </tr>
                ) : (
                  visibleSettlementLoads.map((load) => {
                    const hasDraft = Boolean(settlementPayDrafts[load.id]);
                    const isManualSettlementLoad = currentSettlementManualLoadIds.includes(load.id);
                    const backendLine = getBackendSettlementLineForLoad(load.id);
                    const isCrossDriverSettlementLoad = backendLine?.source === 'cross_driver';
                    return (
                      <tr key={load.id}>
                        <td>{load.loadDate || '-'}</td>
                        <td>{getDriverLabel(load.driver)}</td>
                        <td>
                          <strong>{load.id}</strong>
                          <span>{load.referenceNumber || load.bookingNumber || 'No reference'}</span>
                          {isManualSettlementLoad && <span>Manual add</span>}
                          {isCrossDriverSettlementLoad && <span>Cross-driver pay</span>}
                        </td>
                        <td>{load.customer || '-'}</td>
                        <td>
                          <button
                            type="button"
                            className="settlement-link-button"
                            onClick={() => setSettlementReviewLoadId(load.id)}
                          >
                            {load.containerNumber || load.id}
                          </button>
                        </td>
                        {['driverRate', 'lumper', 'fuelAdvance'].map((field) => (
                          <td key={field}>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="settlement-pay-input"
                              value={getSettlementPayValue(load, field)}
                              onChange={(e) =>
                                handleSettlementPayChange(load.id, field, e.target.value)
                              }
                            />
                          </td>
                        ))}
                        <td>
                          <input
                            type="search"
                            list="settlement-deduction-reasons"
                            className="settlement-pay-input settlement-deduction-input"
                            placeholder="Reason"
                            value={getSettlementDeductionDetail(load)}
                            onChange={(e) =>
                              handleSettlementDeductionDetailChange(load.id, e.target.value)
                            }
                          />
                        </td>
                        <td className="settlement-net">{getSettlementPayTotal(load)}</td>
                        <td>
                          <div className="settlement-row-actions">
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={() => handleSaveSettlementPay(load)}
                              disabled={!hasDraft}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => handleResetSettlementPayDraft(load.id)}
                              disabled={!hasDraft}
                            >
                              Reset
                            </button>
                            {isManualSettlementLoad && (
                              <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => handleRemoveManualSettlementLoad(load.id)}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
        </div>
      )}

      {activeView === 'customers' && (
        <div className="dashboard-grid customers-grid">
          <section className="panel">
            <div className="panel-header">
              <h3>{editingCustomerId ? 'Edit Customer' : 'Add Customer'}</h3>
            </div>

            <form className="load-form" onSubmit={handleSaveCustomer}>
              <input
                type="text"
                name="name"
                placeholder="Customer Name"
                value={customerForm.name}
                onChange={handleCustomerFormChange}
                required
              />
              <input
                type="text"
                name="contactName"
                placeholder="Contact Name"
                value={customerForm.contactName}
                onChange={handleCustomerFormChange}
              />
              <input
                type="email"
                name="email"
                placeholder="Email"
                value={customerForm.email}
                onChange={handleCustomerFormChange}
              />
              <input
                type="text"
                name="phone"
                placeholder="Phone"
                value={customerForm.phone}
                onChange={handleCustomerFormChange}
              />
              <input
  ref={addressInputRef}
  type="text"
  name="address"
  placeholder="Street Address"
  value={customerForm.address || ''}
  onChange={handleCustomerFormChange}
/>

<input
  type="text"
  name="city"
  placeholder="City"
  value={customerForm.city || ''}
  onChange={handleCustomerFormChange}
/>

<input
  type="text"
  name="state"
  placeholder="State"
  value={customerForm.state || ''}
  onChange={handleCustomerFormChange}
/>

<input
  type="text"
  name="zip"
  placeholder="ZIP Code"
  value={customerForm.zip || ''}
  onChange={handleCustomerFormChange}
/>
              <textarea
                name="notes"
                placeholder="Customer Notes"
                value={customerForm.notes}
                onChange={handleCustomerFormChange}
                rows="4"
              />

              <div className="form-actions">
                <button type="submit" className="primary-btn">
                  {editingCustomerId ? 'Save Customer' : 'Add Customer'}
                </button>
                {editingCustomerId && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      setCustomerForm(emptyCustomer);
                      setEditingCustomerId(null);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Customer List</h3>
              <span>{customers.length} customers</span>
            </div>

            <div className="alerts-list">
              {customers.length > 0 ? (
                customers.map((customer) => (
                  <div key={customer.id} className="alert-card customer-card">
                    <strong>{customer.name}</strong>
                    <p>Contact: {customer.contactName || '—'}</p>
                    <p>Email: {customer.email || '—'}</p>
                    <p>Phone: {customer.phone || '—'}</p>
                    <p>Notes: {customer.notes || '—'}</p>

                    <div className="document-actions">
                      <button className="secondary-btn" onClick={() => handleEditCustomer(customer)}>
                        Edit
                      </button>
                      <button className="danger-btn" onClick={() => handleDeleteCustomer(customer.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <p>No customers saved yet.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
{activeView === 'drivers' && (
  <div className="dashboard-grid admin-grid">
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Create Driver</h3>
          <p className="panel-subtitle">Add a driver login for dispatch assignments.</p>
        </div>
      </div>

      <form className="load-form admin-form" onSubmit={handleSaveDriver}>
        <input
          type="text"
          placeholder="Driver ID (optional, auto DRV-001)"
          value={driverForm.id}
          onChange={(e) =>
            setDriverForm((prev) => ({ ...prev, id: e.target.value }))
          }
        />

        <input
          type="text"
          placeholder="Driver Name"
          value={driverForm.name}
          onChange={(e) =>
            setDriverForm((prev) => ({ ...prev, name: e.target.value }))
          }
          required
        />

        <input
          type="email"
          placeholder="Driver Email"
          value={driverForm.email}
          onChange={(e) =>
            setDriverForm((prev) => ({ ...prev, email: e.target.value }))
          }
          required
        />

        <input
          type="tel"
          placeholder="Driver Phone"
          value={driverForm.phone}
          onChange={(e) =>
            setDriverForm((prev) => ({ ...prev, phone: e.target.value }))
          }
        />

        <input
          type="text"
          placeholder="Truck Number"
          value={driverForm.truck}
          onChange={(e) =>
            setDriverForm((prev) => ({ ...prev, truck: e.target.value }))
          }
        />

        <input
          type="password"
          placeholder="Temporary Password"
          value={driverForm.password}
          onChange={(e) =>
            setDriverForm((prev) => ({ ...prev, password: e.target.value }))
          }
          required
        />

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={driverForm.isActive}
            onChange={(e) =>
              setDriverForm((prev) => ({ ...prev, isActive: e.target.checked }))
            }
          />
          Active driver account
        </label>

        <div className="form-actions">
          <button type="submit" className="primary-btn">Create Driver</button>
        </div>
      </form>
    </section>

    <section className="panel">
      <div className="panel-header">
        <h3>Saved Drivers</h3>
        <span>{driversList.length} drivers</span>
      </div>

      {driversList.length === 0 ? (
        <div className="empty-state">
          <p>No drivers created yet.</p>
        </div>
      ) : (
        <div className="admin-list">
          {driversList.map((driver) => (
            <div key={driver.id} className="admin-row">
              <div className="admin-row-main">
                <strong>{driver.name}</strong>
                <span>{driver.email}</span>
                <span>{driver.phone || 'No phone on file'}</span>
              </div>
              <div className="admin-row-meta">
                <span>{driver.id}</span>
                <span>Truck {driver.truck || 'N/A'}</span>
                <span>Driver</span>
                <span className={driver.isActive ? 'status-pill active' : 'status-pill inactive'}>
                  {driver.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  </div>
)}

{activeView === 'tenants' && canManageTenants && (
  <div className="dashboard-grid tenant-grid">
    <section className="panel tenant-panel">
      <div className="panel-header">
        <div>
          <h3>Tenant Management</h3>
          <p className="panel-subtitle">Control company access, subscription status, and service notes.</p>
          <p className="panel-subtitle">Set status to Active or Trial to enable login. Suspended or Canceled blocks users from entering.</p>
        </div>
        <button type="button" className="secondary-btn compact-btn" onClick={fetchTenantManagement} disabled={tenantLoading}>
          {tenantLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {tenantStatusMessage && <p className="status-message">{tenantStatusMessage}</p>}

      <div className="tenant-summary-row">
        <div><span>Companies</span><strong>{tenantCompanies.length}</strong></div>
        <div><span>Active</span><strong>{tenantCompanies.filter((item) => item.serviceStatus === 'Active').length}</strong></div>
        <div><span>Past Due</span><strong>{tenantCompanies.filter((item) => item.serviceStatus === 'Past Due').length}</strong></div>
        <div><span>Suspended</span><strong>{tenantCompanies.filter((item) => item.serviceStatus === 'Suspended').length}</strong></div>
      </div>

      <div className="tenant-list">
        {tenantCompanies.length === 0 ? (
          <div className="empty-state"><p>No companies found yet.</p></div>
        ) : (
          tenantCompanies.map((tenant) => (
            <article key={tenant.id} className="tenant-card">
              <div className="tenant-card-main">
                <div>
                  <span className={`tenant-status tenant-status-${String(tenant.serviceStatus || 'Active').toLowerCase().replace(/\s+/g, '-')}`}>
                    {tenant.serviceStatus || 'Active'}
                  </span>
                  <h4>{tenant.name}</h4>
                  <p>{tenant.email}</p>
                  <small>Created {formatDateTime(tenant.createdAt)} | Users {tenant.usersCount || 0} | Loads {tenant.loadsCount || 0}</small>
                </div>
                <button type="button" className="primary-btn compact-btn" onClick={() => handleSaveTenant(tenant)}>
                  Save Tenant
                </button>
              </div>

              <div className="tenant-controls">
                <label>
                  <span>Status</span>
                  <select
                    value={tenant.serviceStatus || 'Active'}
                    onChange={(e) => handleTenantFieldChange(tenant.id, 'serviceStatus', e.target.value)}
                  >
                    <option value="Active">Active</option>
                    <option value="Trial">Trial</option>
                    <option value="Past Due">Past Due</option>
                    <option value="Suspended">Suspended</option>
                    <option value="Canceled">Canceled</option>
                  </select>
                </label>
                <label>
                  <span>Plan</span>
                  <input
                    value={tenant.subscriptionPlan || ''}
                    onChange={(e) => handleTenantFieldChange(tenant.id, 'subscriptionPlan', e.target.value)}
                    placeholder="Demo, Monthly, Enterprise..."
                  />
                </label>
                <label className="tenant-notes-field">
                  <span>Owner Notes</span>
                  <textarea
                    rows="2"
                    value={tenant.subscriptionNotes || ''}
                    onChange={(e) => handleTenantFieldChange(tenant.id, 'subscriptionNotes', e.target.value)}
                    placeholder="Payment status, contact notes, renewal details..."
                  />
                </label>
              </div>
            </article>
          ))
        )}
      </div>
    </section>

    <section className="panel tenant-panel">
      <div className="panel-header">
        <div>
          <h3>Demo Requests</h3>
          <p className="panel-subtitle">Prospects submitted from the public PortFlow page.</p>
        </div>
        <span>{demoRequests.length} request(s)</span>
      </div>

      <div className="tenant-list">
        {demoRequests.length === 0 ? (
          <div className="empty-state"><p>No demo requests yet.</p></div>
        ) : (
          demoRequests.map((request) => (
            <article key={request.id} className="tenant-card demo-request-card">
              <div className="tenant-card-main">
                <div>
                  <span className="tenant-status tenant-status-trial">{request.status || 'New'}</span>
                  <h4>{request.companyName}</h4>
                  <p>{request.contactName || 'No contact name'} | {request.email} | {request.phone || 'No phone'}</p>
                  <small>Requested {formatDateTime(request.createdAt)}</small>
                </div>
                <select
                  value={request.status || 'New'}
                  onChange={(e) => handleUpdateDemoRequestStatus(request.id, e.target.value)}
                >
                  <option value="New">New</option>
                  <option value="Contacted">Contacted</option>
                  <option value="Approved">Approved</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>
              {request.message && <p className="tenant-request-message">{request.message}</p>}
            </article>
          ))
        )}
      </div>
    </section>
  </div>
)}

{activeView === 'settings' && (
  <div className="dashboard-grid settings-grid">
    {fullAccessRoles.has(getNormalizedRole(currentUser?.role)) && (
      <>
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Add Team Member</h3>
          <p className="panel-subtitle">Create internal staff access. Driver accounts stay in the Drivers section.</p>
        </div>
      </div>

      <form className="load-form admin-form" onSubmit={handleSaveStaffUser}>
        <input
          type="text"
          placeholder="Name"
          value={staffForm.name}
          onChange={(e) => setStaffForm((prev) => ({ ...prev, name: e.target.value }))}
          required
        />

        <input
          type="email"
          placeholder="Email"
          value={staffForm.email}
          onChange={(e) => setStaffForm((prev) => ({ ...prev, email: e.target.value }))}
          required
        />

        <input
          type="password"
          placeholder="Temporary Password"
          value={staffForm.password}
          onChange={(e) => setStaffForm((prev) => ({ ...prev, password: e.target.value }))}
          required
        />

        <select
          value={staffForm.role}
          onChange={(e) => setStaffForm((prev) => ({ ...prev, role: e.target.value }))}
          className="filter-select"
        >
          {staffRoleOptions.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={staffForm.isActive}
            onChange={(e) => setStaffForm((prev) => ({ ...prev, isActive: e.target.checked }))}
          />
          Active staff account
        </label>

        <div className="form-actions">
          <button type="submit" className="primary-btn">Create Staff User</button>
        </div>
      </form>
    </section>

    <section className="panel">
      <div className="panel-header">
        <h3>Users</h3>
        <span>{allUsers.length} users</span>
      </div>

      {allUsers.length === 0 ? (
        <div className="empty-state">
          <p>No users found.</p>
        </div>
      ) : (
        <div className="admin-list">
          {allUsers.map((user) => (
            <div key={user.id} className="admin-row user-row">
              <div className="admin-row-main">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>

              <div className="user-controls">
                {user.role === 'carrier' ? (
                  <span className="role-label">Main Account</span>
                ) : user.role === 'driver' ? (
                  <span className="role-label">Driver - manage in Drivers</span>
                ) : (
                  <select
                    value={user.role}
                    onChange={(e) => handleChangeUserRole(user.id, e.target.value)}
                    className="filter-select role-select"
                  >
                    {staffRoleOptions.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                )}

                <span className={user.isActive ? 'status-pill active' : 'status-pill inactive'}>
                  {user.isActive ? 'Active' : 'Inactive'}
                </span>

                {user.role !== 'carrier' && (
                  <button
                    type="button"
                    className={user.isActive ? 'secondary-btn' : 'primary-btn'}
                    onClick={() => handleToggleUserStatus(user.id, !user.isActive)}
                  >
                    {user.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>

    <section className="panel">
      <div className="panel-header">
        <h3>Company Profile</h3>
        {!companyProfileEditing && (
          <button
            type="button"
            className="secondary-btn compact-btn"
            onClick={() => {
              setCompanyProfileForm({
                name: company?.name || '',
                invoiceAddress: company?.invoiceAddress || '',
              });
              setCompanyProfileStatus('');
              setCompanyProfileEditing(true);
            }}
          >
            Edit Profile
          </button>
        )}
      </div>
      <div className="company-profile">
        {companyProfileEditing ? (
          <form className="invoice-branding-settings" onSubmit={handleSaveCompanyProfile}>
            <div className="settings-row-header">
              <div>
                <span>Company Profile</span>
                <strong>Edit the company name and address</strong>
              </div>
              <div className="details-actions">
                <button type="submit" className="primary-btn compact-btn">
                  Save Profile
                </button>
                <button
                  type="button"
                  className="secondary-btn compact-btn"
                  onClick={() => {
                    setCompanyProfileForm({
                      name: company?.name || '',
                      invoiceAddress: company?.invoiceAddress || '',
                    });
                    setCompanyProfileStatus('');
                    setCompanyProfileEditing(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
            <div className="invoice-branding-grid">
              <label>
                <span>Company Name</span>
                <input
                  type="text"
                  value={companyProfileForm.name}
                  onChange={(e) =>
                    setCompanyProfileForm((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  placeholder="Company name"
                />
              </label>
              <label>
                <span>Company Address</span>
                <textarea
                  value={companyProfileForm.invoiceAddress}
                  onChange={(e) =>
                    setCompanyProfileForm((prev) => ({
                      ...prev,
                      invoiceAddress: e.target.value,
                    }))
                  }
                  placeholder="Street, city, state, zip"
                  rows={3}
                />
              </label>
            </div>
          </form>
        ) : (
          <>
            <div className="detail-box">
              <span>Company</span>
              <strong>{company?.name || 'PortFlow Dispatch'}</strong>
            </div>
            <div className="detail-box">
              <span>Company Address</span>
              <strong>{company?.invoiceAddress || 'Not saved'}</strong>
            </div>
            <div className="detail-box">
              <span>Account Email</span>
              <strong>{company?.email || currentUser?.email || 'Not available'}</strong>
            </div>
          </>
        )}
        {companyProfileStatus && (
          <p className={companyProfileStatus.includes('saved') ? 'settings-status success' : 'settings-status error'}>
            {companyProfileStatus}
          </p>
        )}
        <div className="company-logo-settings">
          <span>Company Logo</span>
          <div className="company-logo-preview">
            {getCompanyLogoSrc() ? (
              <img src={getCompanyLogoSrc()} alt={`${company?.name || 'Company'} logo`} />
            ) : (
              <strong>No logo uploaded</strong>
            )}
          </div>
          <label className="upload-btn">
            {companyLogoUploading ? 'Uploading...' : 'Upload Logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleCompanyLogoUpload}
              hidden
              disabled={companyLogoUploading}
            />
          </label>
        </div>
        <form className="invoice-branding-settings" onSubmit={handleSaveInvoiceBranding}>
          <div className="settings-row-header">
            <div>
              <span>Invoice Branding</span>
              <strong>Company details shown on invoices</strong>
            </div>
            <button type="submit" className="primary-btn compact-btn">
              Save Branding
            </button>
          </div>

          <div className="invoice-branding-grid">
            <label>
              <span>Company Name on Invoice</span>
              <input
                type="text"
                value={invoiceBrandingForm.invoiceName}
                onChange={(e) =>
                  setInvoiceBrandingForm((prev) => ({
                    ...prev,
                    invoiceName: e.target.value,
                  }))
                }
                placeholder="Company name"
              />
            </label>
            <label>
              <span>Company Address on Invoice</span>
              <textarea
                value={invoiceBrandingForm.invoiceAddress}
                onChange={(e) =>
                  setInvoiceBrandingForm((prev) => ({
                    ...prev,
                    invoiceAddress: e.target.value,
                  }))
                }
                placeholder="Street, city, state, zip"
                rows={3}
              />
            </label>
            <label>
              <span>Company Name on Driver Settlements</span>
              <input
                type="text"
                value={invoiceBrandingForm.settlementCompanyName}
                onChange={(e) =>
                  setInvoiceBrandingForm((prev) => ({
                    ...prev,
                    settlementCompanyName: e.target.value,
                  }))
                }
                placeholder="Company name for payroll reports"
              />
            </label>
          </div>

          <div className="invoice-branding-logo-row">
            <div className="company-logo-preview">
              {getCompanyLogoSrc() ? (
                <img src={getCompanyLogoSrc()} alt={`${company?.name || 'Company'} invoice logo`} />
              ) : (
                <strong>No logo uploaded</strong>
              )}
            </div>
            <label className="upload-btn">
              {companyLogoUploading ? 'Uploading...' : 'Upload Invoice Logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleCompanyLogoUpload}
                hidden
                disabled={companyLogoUploading}
              />
            </label>
          </div>

          {invoiceBrandingStatus && (
            <p className={invoiceBrandingStatus.includes('saved') ? 'settings-status success' : 'settings-status error'}>
              {invoiceBrandingStatus}
            </p>
          )}
        </form>
        <form className="invoice-branding-settings" onSubmit={handleSavePodSettings}>
          <div className="settings-row-header">
            <div>
              <span>POD Display Settings</span>
              <strong>Choose what appears on generated PODs</strong>
            </div>
            <button type="submit" className="primary-btn compact-btn">
              Save POD Settings
            </button>
          </div>

          <div className="pod-settings-grid">
            {[
              ['showCompanyInfo', 'Show company information'],
              ['showCustomerInfo', 'Show customer name'],
              ['showPickup', 'Show pickup location'],
              ['showDelivery', 'Show delivery location'],
              ['showReturn', 'Show return location'],
              ['showDriverTruck', 'Show driver and truck'],
              ['showSignatures', 'Show signature section'],
            ].map(([key, label]) => (
              <label key={key} className="settings-toggle-row">
                <input
                  type="checkbox"
                  checked={Boolean(podSettingsForm[key])}
                  onChange={(e) =>
                    setPodSettingsForm((prev) => ({
                      ...prev,
                      [key]: e.target.checked,
                    }))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {podSettingsStatus && (
            <p className={podSettingsStatus.includes('saved') ? 'settings-status success' : 'settings-status error'}>
              {podSettingsStatus}
            </p>
          )}
        </form>
        <div className="port-houston-settings">
          <div className="settings-row-header">
            <div>
              <span>Terminal Credentials</span>
              <strong>{company?.portHoustonConfigured ? 'Credentials saved' : 'Credentials Required'}</strong>
            </div>
            <span className={company?.portHoustonConfigured ? 'status-pill active' : 'status-pill inactive'}>
              {company?.portHoustonConfigured ? 'Active' : 'Missing'}
            </span>
          </div>

          <div className="terminal-credentials-list">
            {portHoustonCredentialGroups.map((group) => (
              <div key={group.terminal} className="terminal-credential-group">
                <div className="terminal-credential-title">
                  <div>
                    <h4>{group.terminal}</h4>
                    <span>
                      {group.rows.some((row) => company?.portHoustonCredentials?.[row.key]?.configured)
                        ? 'Credentials saved'
                        : 'Credentials Required'}
                    </span>
                  </div>
                  <div className="terminal-credential-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => handleClearPortHoustonSettings(group)}
                      disabled={portHoustonSettingsSaving === group.terminal}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => handleSavePortHoustonSettings(group)}
                      disabled={portHoustonSettingsSaving === group.terminal}
                    >
                      {portHoustonSettingsSaving === group.terminal ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>

                {group.rows.map((row) => {
                  const configured = company?.portHoustonCredentials?.[row.key]?.configured;
                  return (
                    <div key={row.key} className="terminal-credential-row">
                      <div className="terminal-credential-label">
                        <strong>{row.label}</strong>
                        <span>{configured ? 'Credentials saved' : 'Credentials Required'}</span>
                      </div>
                      <input
                        type="text"
                        placeholder="Enter Login"
                        value={portHoustonSettingsForm[row.key]?.username || ''}
                        onChange={(e) =>
                          setPortHoustonSettingsForm((prev) => ({
                            ...prev,
                            [row.key]: {
                              ...(prev[row.key] || {}),
                              username: e.target.value,
                            },
                          }))
                        }
                        autoComplete="username"
                      />
                      <input
                        type="password"
                        placeholder="Enter Password"
                        value={portHoustonSettingsForm[row.key]?.password || ''}
                        onChange={(e) =>
                          setPortHoustonSettingsForm((prev) => ({
                            ...prev,
                            [row.key]: {
                              ...(prev[row.key] || {}),
                              password: e.target.value,
                            },
                          }))
                        }
                        autoComplete="current-password"
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {portHoustonSettingsStatus && (
            <p className={portHoustonSettingsStatus.includes('saved') ? 'settings-status success' : 'settings-status error'}>
              {portHoustonSettingsStatus}
            </p>
          )}
        </div>
        <div className="detail-box">
          <span>Current User</span>
          <strong>{currentUser?.name || 'Not available'}</strong>
        </div>
        <div className="detail-box">
          <span>Role</span>
          <strong>{currentUser?.role || 'Not available'}</strong>
        </div>
      </div>
    </section>
      </>
    )}

    <section className="panel audit-panel">
      <div className="panel-header">
        <div>
          <h3>Audit Log</h3>
          <p className="panel-subtitle">Read-only history of changes for your company.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={fetchAuditLogs}>
          Refresh
        </button>
      </div>

      {auditLogs.length === 0 ? (
        <div className="empty-state">
          <p>No audit history found yet.</p>
        </div>
      ) : (
        <div className="audit-list">
          {auditLogs.map((log) => {
            const changedFields = parseAuditJson(log.changedFields, {});
            const changedEntries = Object.entries(changedFields || {});
            return (
              <div key={log.id} className="audit-row">
                <div className="audit-row-main">
                  <strong>{log.action} {log.entityType}</strong>
                  <span>{log.entityLabel || log.entityId || '-'}</span>
                  <span>
                    {log.userName || 'System'} ({log.userRole || 'unknown'}) • {formatDateTime(log.createdAt)}
                  </span>
                </div>
                <div className="audit-changes">
                  {changedEntries.length === 0 ? (
                    <span>No field details</span>
                  ) : (
                    changedEntries.slice(0, 4).map(([field, change]) => (
                      <div key={field} className="audit-change">
                        <span>{field}</span>
                        <strong>{formatAuditValue(change?.oldValue)} → {formatAuditValue(change?.newValue)}</strong>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  </div>
)}
      {activeView === 'completed' && (
        <section className="panel accounting-panel">
          <div className="panel-header">
            <div>
              <h3>Completed Loads</h3>
              <span>{filteredCompletedReviewLoads.length} loads waiting for dispatch review</span>
            </div>
            <div className="details-actions">
              <span className="status-pill active">Review before billing</span>
            </div>
          </div>

          <div className="accounting-summary-strip">
            <div>
              <span>Waiting Review</span>
              <strong>{completedReviewLoads.length}</strong>
            </div>
            <div>
              <span>Shown</span>
              <strong>{filteredCompletedReviewLoads.length}</strong>
            </div>
            <div>
              <span>Ready In Accounting</span>
              <strong>{completedAccountingLoads.length}</strong>
            </div>
          </div>

          <div className="accounting-search-bar">
            <select
              value={completedLoadDateFilter}
              onChange={(e) => setCompletedLoadDateFilter(e.target.value)}
              className="filter-select"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="custom">Custom</option>
            </select>
            {completedLoadDateFilter === 'custom' && (
              <input
                type="date"
                value={completedLoadCustomDate}
                onChange={(e) => setCompletedLoadCustomDate(e.target.value)}
              />
            )}
            <span>Appointment date: {getCompletedLoadFilterDate() || 'Any'}</span>
          </div>

          {filteredCompletedReviewLoads.length > 0 ? (
            <div className="table-wrap accounting-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Appointment</th>
                    <th>Customer</th>
                    <th>Container</th>
                    <th>Reference #</th>
                    <th>Driver</th>
                    <th>Delivery</th>
                    <th>Paperwork</th>
                    <th>Extras</th>
                    <th>Bill Total</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompletedReviewLoads.map((load) => (
                    <tr key={load.id}>
                      <td>{load.appointmentTime ? formatAppointmentTime(load.appointmentTime) : load.loadDate || '-'}</td>
                      <td>{load.customer || '-'}</td>
                      <td>{load.containerNumber || '-'}</td>
                      <td>{load.referenceNumber || '-'}</td>
                      <td>{load.driver ? getDriverLabel(load.driver) : 'Not Assigned'}</td>
                      <td>{load.deliveryLocationName || load.deliveryLocation || load.deliveryAddress || '-'}</td>
                      <td>
                        <span className={`sheet-paperwork ${String(load.paperwork || '').toLowerCase()}`}>
                          {load.paperwork || getPaperworkStatusFromDocuments(load.documents || []) || 'Pending'}
                        </span>
                      </td>
                      <td>{formatMoney(getCustomerExtraChargesTotal(load))}</td>
                      <td>{formatMoney(getCustomerBillAmount(load))}</td>
                      <td>
                        <div className="accounting-row-actions">
                          <button
                            type="button"
                            className="secondary-btn compact-btn"
                            onClick={() => openAccountingExtraChargesEditor(load, parseCustomerExtraCharges(load).length === 0)}
                          >
                            {parseCustomerExtraCharges(load).length > 0 ? 'Edit Charges' : 'Add Charges'}
                          </button>
                          <button
                            type="button"
                            className="secondary-btn compact-btn"
                            onClick={() => {
                              setSelectedLoad(load);
                              setEditingLoad(load);
                              setActiveView('dispatch');
                            }}
                          >
                            Review
                          </button>
                          <button
                            type="button"
                            className="primary-btn compact-btn"
                            onClick={() => handleSendCompletedLoadToAccounting(load)}
                          >
                            Send to Accounting
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <p>
                {completedReviewLoads.length > 0
                  ? 'No completed loads match this appointment date.'
                  : 'No completed loads waiting for review.'}
              </p>
            </div>
          )}

          {completedExtraChargeLoad && (
            <div className="invoice-box accounting-extra-charges-box">
              <div className="documents-header">
                <h4>Customer Extra Charges</h4>
                <span>{completedExtraChargeLoad.containerNumber || completedExtraChargeLoad.id}</span>
              </div>

              <div className="table-wrap accounting-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {getAccountingExtraChargeDraft(completedExtraChargeLoad).map((charge, index) => (
                      <tr key={charge.id || index}>
                        <td>
                          <select
                            className="filter-select"
                            value={charge.type || 'Other'}
                            onChange={(e) =>
                              handleAccountingExtraChargeChange(completedExtraChargeLoad, index, 'type', e.target.value)
                            }
                          >
                            {customerExtraChargeTypes.map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={charge.description || ''}
                            placeholder="Reason or note"
                            onChange={(e) =>
                              handleAccountingExtraChargeChange(completedExtraChargeLoad, index, 'description', e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={charge.amount ?? ''}
                            placeholder="$0.00"
                            onChange={(e) =>
                              handleAccountingExtraChargeChange(completedExtraChargeLoad, index, 'amount', e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="danger-btn compact-btn"
                            onClick={() => handleRemoveAccountingExtraCharge(completedExtraChargeLoad, index)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="accounting-payment-summary">
                <div>
                  <span>Extras Total</span>
                  <strong>
                    {formatMoney(
                      getAccountingExtraChargeDraft(completedExtraChargeLoad).reduce(
                        (sum, charge) => sum + parseMoney(charge.amount),
                        0
                      )
                    )}
                  </strong>
                </div>
                <div>
                  <span>Bill Total After Extras</span>
                  <strong>
                    {formatMoney(
                      parseMoney(completedExtraChargeLoad.rate) +
                      parseMoney(completedExtraChargeLoad.detention) +
                      getAccountingExtraChargeDraft(completedExtraChargeLoad).reduce(
                        (sum, charge) => sum + parseMoney(charge.amount),
                        0
                      )
                    )}
                  </strong>
                </div>
              </div>

              <div className="details-actions">
                <button
                  type="button"
                  className="secondary-btn compact-btn"
                  onClick={() => handleAddAccountingExtraCharge(completedExtraChargeLoad)}
                >
                  Add Another
                </button>
                <button
                  type="button"
                  className="primary-btn compact-btn"
                  onClick={() => handleSaveAccountingExtraCharges(completedExtraChargeLoad)}
                >
                  Save Extra Charges
                </button>
                <button
                  type="button"
                  className="secondary-btn compact-btn"
                  onClick={() => closeAccountingExtraChargesEditor(completedExtraChargeLoad)}
                >
                  Close
                </button>
              </div>
              {accountingExtraChargeStatus && (
                <p className={accountingExtraChargeStatus.includes('Failed') ? 'settings-status error' : 'settings-status success'}>
                  {accountingExtraChargeStatus}
                </p>
              )}
            </div>
          )}
        </section>
      )}
      {activeView === 'accounting' && (
        <section className="panel accounting-panel">
          <div className="panel-header">
            <div>
              <h3>Accounting</h3>
              <span>{completedAccountingLoads.length} completed loads ready for billing</span>
            </div>
            <div className="details-actions">
              <button type="button" className="primary-btn compact-btn">
                Bill
              </button>
            </div>
          </div>

          <div className="accounting-summary-strip">
            <div>
              <span>Completed Loads</span>
              <strong>{completedAccountingLoads.length}</strong>
            </div>
            <div>
              <span>Total Load Revenue</span>
              <strong>
                {formatMoney(
                  completedAccountingLoads.reduce((sum, load) => sum + getCustomerBillAmount(load), 0)
                )}
              </strong>
            </div>
            <div>
              <span>Saved Invoices</span>
              <strong>{savedInvoices.length}</strong>
            </div>
          </div>

          <div className="accounting-fuel-panel">
            <div className="panel-header">
              <div>
                <h3>Yearly Driver Mileage</h3>
                <span>Completed loads by appointment year</span>
              </div>
              <div className="details-actions">
                <select
                  value={mileageReportYear}
                  onChange={(e) => setMileageReportYear(e.target.value)}
                >
                  {mileageReportYears.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                <button type="button" className="secondary-btn compact-btn" onClick={exportMileageReportCsv}>
                  Export CSV
                </button>
              </div>
            </div>

            <div className="accounting-summary-strip">
              <div>
                <span>Total Miles</span>
                <strong>{formatMiles(mileageReportTotals.totalMiles)}</strong>
              </div>
              <div>
                <span>Completed Loads</span>
                <strong>{mileageReportTotals.loadCount}</strong>
              </div>
              <div>
                <span>Missing Miles</span>
                <strong>{mileageReportTotals.missingMiles}</strong>
              </div>
            </div>

            {mileageReportRows.length > 0 ? (
              <div className="table-wrap accounting-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Completed Loads</th>
                      <th>Total Miles</th>
                      <th>Missing Miles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mileageReportRows.map((row) => (
                      <tr key={row.driverId}>
                        <td>{row.driverName}</td>
                        <td>{row.loadCount}</td>
                        <td>{formatMiles(row.totalMiles)}</td>
                        <td>{row.missingMiles}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <p>No completed loads with dates for {mileageReportYear || 'this year'} yet.</p>
              </div>
            )}
          </div>

          <div className="accounting-search-bar">
            <input
              type="text"
              value={accountingSearchTerm}
              onChange={(e) => setAccountingSearchTerm(e.target.value)}
              className="search-input"
              placeholder="Search billing by customer, container, reference #, PO #, or pick up #"
            />
            <span>{filteredAccountingLoads.length} shown</span>
          </div>

          {filteredAccountingLoads.length > 0 ? (
            <div className="table-wrap accounting-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Container</th>
                    <th>Reference #</th>
                    <th>PO #</th>
                    <th>Pick Up #</th>
                    <th>Driver</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccountingLoads.map((load) => {
                    const invoice = savedInvoices.find((item) => item.loadId === load.id);
                    return (
                      <tr key={load.id} className={selectedAccountingLoad?.id === load.id ? 'selected-row' : ''}>
                        <td>{load.loadDate || '—'}</td>
                        <td>{load.customer || '—'}</td>
                        <td>{load.containerNumber || '—'}</td>
                        <td>{load.referenceNumber || '—'}</td>
                        <td>{load.poNumber || '—'}</td>
                        <td>{load.pickupNumber || '—'}</td>
                        <td>{load.driver ? getDriverLabel(load.driver) : 'Not Assigned'}</td>
                        <td>
                          <span className={`sheet-status ${String(getLoadQuickStatus(load) || '').toLowerCase().replace(/\s/g, '-')}`}>
                            {getLoadQuickStatus(load) || 'Completed'}
                          </span>
                        </td>
                        <td>{formatMoney(parseMoney(invoice?.amount ?? getCustomerBillAmount(load)))}</td>
                        <td>{invoice ? formatMoney(parseMoney(invoice.paidAmount)) : '—'}</td>
                        <td>
                          {invoice
                            ? formatMoney(Math.max(0, parseMoney(invoice.amount) - parseMoney(invoice.paidAmount)))
                            : '—'}
                        </td>
                        <td>
                          <div className="accounting-row-actions">
                            <button
                              type="button"
                              className="secondary-btn compact-btn"
                              onClick={() => setSelectedAccountingLoadId(load.id)}
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              className="secondary-btn compact-btn"
                              onClick={() => {
                                setInvoiceLoadId(load.id);
                                setActiveView('invoices');
                              }}
                            >
                              {invoice ? invoice.invoiceNumber : 'Create Invoice'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <p>{completedAccountingLoads.length > 0 ? 'No completed loads match that search.' : 'No completed loads in billing yet.'}</p>
            </div>
          )}

          <div className="accounting-fuel-panel">
            <div className="panel-header">
              <div>
                <h3>Fuel Accounting</h3>
                <span>{fuelSummary.count} fuel transactions</span>
              </div>
              <button type="button" className="secondary-btn compact-btn" onClick={exportFuelCsv}>
                Export CSV
              </button>
            </div>

            <div className="accounting-summary-strip">
              <div>
                <span>Total Fuel Spend</span>
                <strong>{formatMoney(fuelSummary.totalFuelSpend)}</strong>
              </div>
              <div>
                <span>Total Gallons</span>
                <strong>{Number(fuelSummary.totalGallons || 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>Avg Price / Gal</span>
                <strong>{formatMoney(fuelSummary.averagePricePerGallon)}</strong>
              </div>
            </div>

            <div className="fuel-filter-grid">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={fuelFilters.from}
                  onChange={(e) => setFuelFilters((prev) => ({ ...prev, from: e.target.value }))}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={fuelFilters.to}
                  onChange={(e) => setFuelFilters((prev) => ({ ...prev, to: e.target.value }))}
                />
              </label>
              <label>
                <span>Driver</span>
                <select
                  value={fuelFilters.driverId}
                  onChange={(e) => setFuelFilters((prev) => ({ ...prev, driverId: e.target.value }))}
                >
                  <option value="">All drivers</option>
                  {driversList.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.id} - {driver.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Truck</span>
                <input
                  type="text"
                  value={fuelFilters.truckId}
                  onChange={(e) => setFuelFilters((prev) => ({ ...prev, truckId: e.target.value }))}
                  placeholder="Truck number"
                />
              </label>
            </div>

            <div className="fuel-weekly-panel">
              <div className="panel-header compact-header">
                <div>
                  <h3>Weekly Fuel Comparison</h3>
                  <p className="panel-subtitle">Compare company fuel spend by week using the filters above.</p>
                </div>
                <span>{(fuelSummary.weeklyTotals || []).length} weeks</span>
              </div>

              {(fuelSummary.weeklyTotals || []).length > 0 ? (
                <div className="table-wrap accounting-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Transactions</th>
                        <th>Total Spend</th>
                        <th>Total Gallons</th>
                        <th>Avg $/Gal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fuelSummary.weeklyTotals.map((week) => (
                        <Fragment key={week.weekStart}>
                          <tr className="fuel-week-row">
                            <td>{week.weekStart} to {week.weekEnd}</td>
                            <td>{week.count}</td>
                            <td>{formatMoney(week.totalFuelSpend)}</td>
                            <td>{Number(week.totalGallons || 0).toFixed(2)}</td>
                            <td>{formatMoney(week.averagePricePerGallon)}</td>
                          </tr>
                          {(week.dailyTotals || []).map((day) => (
                            <tr key={`${week.weekStart}-${day.date}`} className="fuel-day-row">
                              <td>{day.dayName} {day.date}</td>
                              <td>{day.count}</td>
                              <td>{formatMoney(day.totalFuelSpend)}</td>
                              <td>{Number(day.totalGallons || 0).toFixed(2)}</td>
                              <td>{formatMoney(day.averagePricePerGallon)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <p>No weekly fuel totals for these filters yet.</p>
                </div>
              )}
            </div>

            {fuelTransactions.length > 0 ? (
              <div className="table-wrap accounting-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Driver</th>
                      <th>Truck</th>
                      <th>Station</th>
                      <th>Load #</th>
                      <th>Amount</th>
                      <th>Gallons</th>
                      <th>$/Gal</th>
                      <th>Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fuelTransactions.map((fuel) => (
                      <tr key={fuel.id}>
                        <td>{formatDateTime(fuel.dateTime)}</td>
                        <td>{fuel.driverName || getDriverLabel(fuel.driverId)}</td>
                        <td>{fuel.truckId || '—'}</td>
                        <td>{fuel.fuelStation || '—'}</td>
                        <td>{fuel.loadNumber || '—'}</td>
                        <td>{formatMoney(fuel.amountPaid)}</td>
                        <td>{Number(fuel.gallons || 0).toFixed(2)}</td>
                        <td>{formatMoney(fuel.pricePerGallon)}</td>
                        <td>
                          {fuel.receiptImageUrl ? (
                            <button type="button" className="secondary-btn compact-btn" onClick={() => handleOpenFuelReceipt(fuel)}>
                              Open
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <p>No fuel transactions match these filters.</p>
              </div>
            )}
          </div>

          {selectedAccountingLoad && (
            <>
              <button
                type="button"
                className="load-details-backdrop accounting-details-backdrop"
                aria-label="Close billing load details"
                onClick={() => setSelectedAccountingLoadId('')}
              />
              <section className="panel load-details-drawer accounting-detail-panel accounting-detail-drawer open">
              <div className="panel-header">
                <div>
                  <h3>Bill Load Details</h3>
                  <p className="panel-subtitle">
                    {selectedAccountingLoad.containerNumber || 'No container'} • {selectedAccountingLoad.referenceNumber || selectedAccountingLoad.id}
                  </p>
                </div>
                <div className="details-actions">
                  <button
                    type="button"
                    className="customer-pdf-btn"
                    onClick={() => handleGenerateCustomerPdf(selectedAccountingLoad)}
                  >
                    Customer PDF
                  </button>
                  <button
                    type="button"
                    className="pod-generate-btn"
                    onClick={() => handleGeneratePOD(selectedAccountingLoad)}
                  >
                    Generate POD
                  </button>
                  <button
                    type="button"
                    className="secondary-btn compact-btn"
                    onClick={() => {
                      setInvoiceLoadId(selectedAccountingLoad.id);
                      setActiveView('invoices');
                    }}
                  >
                    Invoice
                  </button>
                  <button
                    type="button"
                    className="danger-btn compact-btn"
                    onClick={() => handleRestoreCompletedLoad(selectedAccountingLoad)}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="secondary-btn compact-btn drawer-close-btn"
                    onClick={() => setSelectedAccountingLoadId('')}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="details-grid accounting-details-grid">
                <div className="detail-box"><span>Status</span><strong>{getLoadQuickStatus(selectedAccountingLoad) || 'Completed'}</strong></div>
                <div className="detail-box"><span>Load Date</span><strong>{selectedAccountingLoad.loadDate || '—'}</strong></div>
                <div className="detail-box"><span>Appointment</span><strong>{formatAppointmentTime(selectedAccountingLoad.appointmentTime)}</strong></div>
                <div className="detail-box"><span>Customer</span><strong>{selectedAccountingLoad.customer || '—'}</strong></div>
                <div className="detail-box"><span>Broker</span><strong>{selectedAccountingLoad.brokerName || selectedAccountingLoad.broker || '—'}</strong></div>
                <div className="detail-box"><span>Reference #</span><strong>{selectedAccountingLoad.referenceNumber || '—'}</strong></div>
                <div className="detail-box"><span>PO #</span><strong>{selectedAccountingLoad.poNumber || '—'}</strong></div>
                <div className="detail-box"><span>Container</span><strong>{selectedAccountingLoad.containerNumber || '—'}</strong></div>
                <div className="detail-box"><span>Container Size</span><strong>{selectedAccountingLoad.containerSize || '—'}</strong></div>
                <div className="detail-box"><span>Ship Line</span><strong>{selectedAccountingLoad.shipLine || '—'}</strong></div>
                <div className="detail-box"><span>Pick Up #</span><strong>{selectedAccountingLoad.pickupNumber || '—'}</strong></div>
                <div className="detail-box"><span>Driver</span><strong>{selectedAccountingLoad.driver ? getDriverLabel(selectedAccountingLoad.driver) : 'Not Assigned'}</strong></div>
                <div className="detail-box"><span>Truck</span><strong>{selectedAccountingLoad.truck || '—'}</strong></div>
                <div className="detail-box"><span>Pickup</span><strong>{selectedAccountingLoad.pickup || '—'}</strong></div>
                <div className="detail-box"><span>Delivery</span><strong>{getDeliveryDisplay(selectedAccountingLoad.delivery) || '—'}</strong></div>
                <div className="detail-box"><span>Return Location</span><strong>{selectedAccountingLoad.returnLocation || '—'}</strong></div>
                <div className="detail-box"><span>Route Miles</span><strong>{formatMiles(selectedAccountingLoad.miles)}</strong></div>
                <div className="detail-box"><span>Drop Location</span><strong>{selectedAccountingLoad.dropLocation || '—'}</strong></div>
                <div className="detail-box"><span>Dropped By</span><strong>{getDroppedByDriverValue(selectedAccountingLoad) ? getDriverLabel(getDroppedByDriverValue(selectedAccountingLoad)) : '—'}</strong></div>
                <div className="detail-box"><span>Drop Date/Time</span><strong>{formatDateTime(selectedAccountingLoad.dropDateTime)}</strong></div>
                <div className="detail-box"><span>Load Rate</span><strong>{selectedAccountingLoad.rate || '$0.00'}</strong></div>
                <div className="detail-box"><span>Bill Total</span><strong>{formatMoney(getCustomerBillAmount(selectedAccountingLoad))}</strong></div>
                <div className="detail-box"><span>Driver Rate</span><strong>{selectedAccountingLoad.driverRate || '$0.00'}</strong></div>
                <div className="detail-box"><span>Driver Pay</span><strong>{formatMoney(getDriverPayWithDetention(selectedAccountingLoad))}</strong></div>
              </div>

              <div className="settlement-box accounting-settlement-box">
                <h4>Customer / Driver Amounts</h4>
                <div className="settlement-row"><span>Load Rate</span><strong>{selectedAccountingLoad.rate || '$0.00'}</strong></div>
                <div className="settlement-row"><span>Customer Extras</span><strong>{formatMoney(getCustomerExtraChargesTotal(selectedAccountingLoad))}</strong></div>
                <div className="settlement-row"><span>Bill Total</span><strong>{formatMoney(getCustomerBillAmount(selectedAccountingLoad))}</strong></div>
                <div className="settlement-row"><span>Driver Rate</span><strong>{selectedAccountingLoad.driverRate || '$0.00'}</strong></div>
                <div className="settlement-row"><span>Customer Detention</span><strong>{selectedAccountingLoad.detention || '$0.00'}</strong></div>
                <div className="settlement-row"><span>Lumper</span><strong>{selectedAccountingLoad.lumper || '$0.00'}</strong></div>
                <div className="settlement-row"><span>Fuel Advance</span><strong>- {selectedAccountingLoad.fuelAdvance || '$0.00'}</strong></div>
                <div className="settlement-row total"><span>Settlement</span><strong>{selectedAccountingLoad.settlement || '$0.00'}</strong></div>
              </div>

              <div className="invoice-box accounting-extra-charges-box">
                <div className="documents-header">
                  <h4>Customer Extra Charges</h4>
                  <div className="documents-toolbar">
                    <button
                      type="button"
                      className="secondary-btn compact-btn"
                      onClick={() => openAccountingExtraChargesEditor(selectedAccountingLoad, true)}
                    >
                      Add Charge
                    </button>
                    {parseCustomerExtraCharges(selectedAccountingLoad).length > 0 && (
                      <button
                        type="button"
                        className="secondary-btn compact-btn"
                        onClick={() => openAccountingExtraChargesEditor(selectedAccountingLoad)}
                      >
                        Edit Charges
                      </button>
                    )}
                    {accountingExtraChargesOpenLoadId === selectedAccountingLoad.id && (
                      <button
                        type="button"
                        className="secondary-btn compact-btn"
                        onClick={() => closeAccountingExtraChargesEditor(selectedAccountingLoad)}
                      >
                        Close
                      </button>
                    )}
                  </div>
                </div>
                {accountingExtraChargesOpenLoadId === selectedAccountingLoad.id ? (
                  <>
                    {getAccountingExtraChargeDraft(selectedAccountingLoad).length > 0 ? (
                      <div className="table-wrap accounting-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Type</th>
                              <th>Description</th>
                              <th>Amount</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {getAccountingExtraChargeDraft(selectedAccountingLoad).map((charge, index) => (
                              <tr key={charge.id || index}>
                                <td>
                                  <select
                                    className="filter-select"
                                    value={charge.type || 'Other'}
                                    onChange={(e) =>
                                      handleAccountingExtraChargeChange(selectedAccountingLoad, index, 'type', e.target.value)
                                    }
                                  >
                                    {customerExtraChargeTypes.map((type) => (
                                      <option key={type} value={type}>{type}</option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    value={charge.description || ''}
                                    placeholder="Reason or note"
                                    onChange={(e) =>
                                      handleAccountingExtraChargeChange(selectedAccountingLoad, index, 'description', e.target.value)
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={charge.amount ?? ''}
                                    placeholder="$0.00"
                                    onChange={(e) =>
                                      handleAccountingExtraChargeChange(selectedAccountingLoad, index, 'amount', e.target.value)
                                    }
                                  />
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="danger-btn compact-btn"
                                    onClick={() => handleRemoveAccountingExtraCharge(selectedAccountingLoad, index)}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty-state compact-empty">
                        <p>No extra charge rows open. Add a charge or close this editor.</p>
                      </div>
                    )}
                  </>
                ) : parseCustomerExtraCharges(selectedAccountingLoad).length > 0 ? (
                  <div className="table-wrap accounting-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Description</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parseCustomerExtraCharges(selectedAccountingLoad).map((charge, index) => (
                          <tr key={charge.id || index}>
                            <td>{charge.type || 'Other'}</td>
                            <td>{charge.description || '—'}</td>
                            <td>{formatMoney(charge.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state compact-empty">
                    <p>No customer extra charges added yet.</p>
                  </div>
                )}
                <div className="accounting-payment-summary">
                  <div>
                    <span>Extras Total</span>
                    <strong>
                      {formatMoney(
                        accountingExtraChargesOpenLoadId === selectedAccountingLoad.id
                          ? getAccountingExtraChargeDraft(selectedAccountingLoad).reduce((sum, charge) => sum + parseMoney(charge.amount), 0)
                          : getCustomerExtraChargesTotal(selectedAccountingLoad)
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Bill Total After Extras</span>
                    <strong>
                      {formatMoney(
                        parseMoney(selectedAccountingLoad.rate) +
                        parseMoney(selectedAccountingLoad.detention) +
                        (accountingExtraChargesOpenLoadId === selectedAccountingLoad.id
                          ? getAccountingExtraChargeDraft(selectedAccountingLoad).reduce((sum, charge) => sum + parseMoney(charge.amount), 0)
                          : getCustomerExtraChargesTotal(selectedAccountingLoad))
                      )}
                    </strong>
                  </div>
                </div>
                {accountingExtraChargesOpenLoadId === selectedAccountingLoad.id && (
                  <div className="details-actions">
                    <button
                      type="button"
                      className="secondary-btn compact-btn"
                      onClick={() => handleAddAccountingExtraCharge(selectedAccountingLoad)}
                    >
                      Add Another
                    </button>
                    <button
                      type="button"
                      className="primary-btn compact-btn"
                      onClick={() => handleSaveAccountingExtraCharges(selectedAccountingLoad)}
                    >
                      Save Extra Charges
                    </button>
                    <button
                      type="button"
                      className="secondary-btn compact-btn"
                      onClick={() => closeAccountingExtraChargesEditor(selectedAccountingLoad)}
                    >
                      Close
                    </button>
                  </div>
                )}
                {accountingExtraChargeStatus && (
                  <p className={accountingExtraChargeStatus.includes('Failed') ? 'settings-status error' : 'settings-status success'}>
                    {accountingExtraChargeStatus}
                  </p>
                )}
              </div>

              <div className="invoice-box accounting-payment-box">
                <div className="documents-header">
                  <h4>Customer Payment</h4>
                  <span>{selectedAccountingInvoice?.invoiceNumber || 'No invoice yet'}</span>
                </div>

                {selectedAccountingInvoice ? (
                  <>
                    {(() => {
                      const paymentDraft = getInvoicePaymentDraft(selectedAccountingInvoice);
                      const balance = getInvoiceBalance(selectedAccountingInvoice, paymentDraft);
                      return (
                        <>
                          <div className="accounting-payment-summary">
                            <div>
                              <span>Invoice Total</span>
                              <strong>{formatMoney(parseMoney(paymentDraft.amount ?? selectedAccountingInvoice.amount))}</strong>
                            </div>
                            <div>
                              <span>Paid</span>
                              <strong>{formatMoney(parseMoney(paymentDraft.paidAmount))}</strong>
                            </div>
                            <div>
                              <span>Balance</span>
                              <strong>{formatMoney(balance)}</strong>
                            </div>
                            <div>
                              <span>Status</span>
                              <strong>{selectedAccountingInvoice.status || 'Unpaid'}</strong>
                            </div>
                          </div>

                          <div className="accounting-payment-form">
                            <label className="settlement-entry-field">
                              <span>Final Bill Amount</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={paymentDraft.amount}
                                placeholder="$0.00"
                                onChange={(e) =>
                                  handleInvoicePaymentDraftChange(
                                    selectedAccountingInvoice.id,
                                    'amount',
                                    e.target.value
                                  )
                                }
                              />
                            </label>
                            <label className="settlement-entry-field">
                              <span>Paid Amount</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={paymentDraft.paidAmount}
                                placeholder="$0.00"
                                onChange={(e) =>
                                  handleInvoicePaymentDraftChange(
                                    selectedAccountingInvoice.id,
                                    'paidAmount',
                                    e.target.value
                                  )
                                }
                              />
                            </label>
                            <label className="settlement-entry-field">
                              <span>Payment Date</span>
                              <input
                                type="date"
                                value={paymentDraft.paymentDate}
                                onChange={(e) =>
                                  handleInvoicePaymentDraftChange(
                                    selectedAccountingInvoice.id,
                                    'paymentDate',
                                    e.target.value
                                  )
                                }
                              />
                            </label>
                            <label className="settlement-entry-field">
                              <span>Method</span>
                              <select
                                className="filter-select"
                                value={paymentDraft.paymentMethod}
                                onChange={(e) =>
                                  handleInvoicePaymentDraftChange(
                                    selectedAccountingInvoice.id,
                                    'paymentMethod',
                                    e.target.value
                                  )
                                }
                              >
                                <option value="">Select method</option>
                                <option value="ACH">ACH</option>
                                <option value="Check">Check</option>
                                <option value="Wire">Wire</option>
                                <option value="Credit Card">Credit Card</option>
                                <option value="Cash">Cash</option>
                                <option value="Other">Other</option>
                              </select>
                            </label>
                            <label className="settlement-entry-field accounting-payment-note-field">
                              <span>Payment Note</span>
                              <input
                                type="text"
                                value={paymentDraft.paymentNotes}
                                placeholder="Check #, ACH ref, short note"
                                onChange={(e) =>
                                  handleInvoicePaymentDraftChange(
                                    selectedAccountingInvoice.id,
                                    'paymentNotes',
                                    e.target.value
                                  )
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={() => handleSaveInvoicePayment(selectedAccountingInvoice)}
                            >
                              Save Payment
                            </button>
                            <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => handleMarkInvoiceUnpaid(selectedAccountingInvoice)}
                            >
                              Mark Unpaid
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <div className="empty-state compact-empty">
                    <p>Add the final bill amount, then create the invoice for this completed load.</p>
                    <label className="settlement-entry-field">
                      <span>Final Bill Amount</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={getAccountingBillAmountDraft(selectedAccountingLoad)}
                        placeholder="$0.00"
                        onChange={(e) =>
                          handleAccountingBillAmountChange(
                            selectedAccountingLoad.id,
                            e.target.value
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="primary-btn compact-btn"
                      onClick={() => handleCreateAccountingInvoice(selectedAccountingLoad)}
                    >
                      Create Invoice
                    </button>
                  </div>
                )}
              </div>

              <div className="documents-box accounting-documents-box">
                <div className="documents-header">
                  <h4>Documents / Paperwork</h4>
                  <div className="documents-toolbar">
                    <span>{(selectedAccountingLoad.documents || []).length} files</span>
                    <select
                      value={selectedAccountingDocumentType}
                      onChange={(e) => setSelectedAccountingDocumentType(e.target.value)}
                      className="document-type-select"
                    >
                      {documentTypes.map((docType) => (
                        <option key={docType} value={docType}>
                          {docType}
                        </option>
                      ))}
                    </select>
                    <label className="upload-btn">
                      Upload Files
                      <input
                        type="file"
                        multiple
                        onChange={handleAccountingDocumentUpload}
                        hidden
                      />
                    </label>
                  </div>
                </div>

                <div className="checklist-grid">
                  {checklistDocumentTypes.map((docType) => {
                    const isUploaded = getChecklistStatus(selectedAccountingLoad, docType);
                    const uploadedDoc = (selectedAccountingLoad.documents || []).find(
                      (doc) => (doc.category || doc.type || '').toLowerCase() === docType.toLowerCase()
                    );

                    return (
                      <div key={docType} className={`checklist-card ${isUploaded ? 'uploaded' : 'missing'}`}>
                        <span>{docType}</span>
                        <strong>{isUploaded ? `Uploaded (${uploadedDoc?.name || ''})` : 'Missing'}</strong>
                      </div>
                    );
                  })}
                </div>

                {selectedAccountingLoad.documents && selectedAccountingLoad.documents.length > 0 ? (
                  <div className="documents-list">
                    {selectedAccountingLoad.documents.map((doc) => (
                      <div key={doc.id} className="document-card">
                        <div className="document-info">
                          <strong>{doc.name}</strong>
                          <p>{doc.size} • {normalizeDocType(doc.type)}</p>
                          <div className="document-meta">
                            <span className="document-badge">{doc.category}</span>
                          </div>
                        </div>

                        <div className="document-actions">
                          <button className="secondary-btn" onClick={() => handleOpenDocument(doc)}>Open</button>
                          <button className="secondary-btn" onClick={() => handleDownloadDocument(doc)}>Download</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="documents-empty">No documents uploaded for this completed load.</p>
                )}
              </div>

              <div className="notes-box">
                <h4>Dispatcher Notes</h4>
                <p>{selectedAccountingLoad.notes || 'No notes saved.'}</p>
              </div>
              </section>
            </>
          )}
        </section>
      )}
      {activeView === 'invoices' && (
        <section className="panel">
          <div className="panel-header">
            <h3>Customer Invoices</h3>
            <div className="details-actions">
              <select
                value={invoiceLoadId}
                onChange={(e) => setInvoiceLoadId(e.target.value)}
                className="filter-select settlement-filter"
              >
                {(loadsData || []).map((load) => (
                  <option key={load.id} value={load.id}>
                    {load.id} - {load.customer}
                  </option>
                ))}
              </select>

              <button
  className="secondary-btn"
  onClick={handleSaveInvoice}
  disabled={!selectedInvoiceLoad || !selectedInvoiceLoad?.paperwork}
>
  Save Invoice
</button>

              <button
  className="secondary-btn"
  onClick={handlePrintInvoice}
  disabled={!selectedInvoiceLoad || !selectedInvoiceLoad?.paperwork}
>
  Print Invoice
</button>
              <button type="button" className="pod-generate-btn" onClick={handleGeneratePOD}>
                Generate POD
              </button>

              <div className="signature-panel">
                <div className="signature-panel-header">
                  <div>
                    <span>Signature</span>
                    <strong>Driver POD Signature</strong>
                  </div>
                  {selectedInvoiceLoad?.id && signatures[selectedInvoiceLoad.id] && (
                    <span className="status-pill active">Saved</span>
                  )}
                </div>

                <SignatureCanvas
                  ref={sigCanvas}
                  penColor="black"
                  canvasProps={{
                    width: 400,
                    height: 150,
                    className: 'sigCanvas signature-canvas',
                  }}
                />

                <div className="signature-actions">
                  <button
                    type="button"
                    className="secondary-btn compact-btn"
                    onClick={() => sigCanvas.current?.clear()}
                  >
                    Clear
                  </button>

                  <button
                    type="button"
                    className="primary-btn compact-btn"
                    onClick={() => {
                      const dataURL = sigCanvas.current?.toDataURL();
                      if (dataURL && selectedInvoiceLoad?.id) {
                        setSignatures((prev) => ({
                          ...prev,
                          [selectedInvoiceLoad.id]: dataURL,
                        }));
                        sigCanvas.current?.clear();
                      }
                    }}
                  >
                    Save Signature
                  </button>
                </div>

                {selectedInvoiceLoad?.id && signatures[selectedInvoiceLoad.id] && (
                  <div className="saved-signature-preview">
                    <span>Saved Signature</span>
                    <img
                      src={signatures[selectedInvoiceLoad.id]}
                      alt="signature"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {invoiceStatusMessage && (
            <div className="settlement-period-note">
              <p>{invoiceStatusMessage}</p>
            </div>
          )}

          {selectedInvoiceLoad ? (
            <div className="invoice-preview">
              <div className="invoice-header">
                <div className="invoice-brand-preview">
                  {getCompanyLogoSrc() && (
                    <img src={getCompanyLogoSrc()} alt={`${company?.name || 'Company'} invoice logo`} />
                  )}
                  <div>
                    <strong>{company?.invoiceName || company?.name || 'Company'}</strong>
                    {company?.invoiceAddress && <p>{company.invoiceAddress}</p>}
                  </div>
                </div>
                <div>
                  <h2>INVOICE</h2>
                </div>
                <div className="invoice-meta">
                  <p>
  <strong>Invoice #:</strong>{' '}
  {savedInvoices.find((inv) => inv.loadId === selectedInvoiceLoad.id)?.invoiceNumber || 'Not saved yet'}
                  </p>

                  <p><strong>Invoice Date:</strong> {selectedInvoiceLoad.loadDate}</p>
                  <p><strong>Load ID:</strong> {selectedInvoiceLoad.id}</p>
                  <p><strong>Reference #:</strong> {selectedInvoiceLoad.referenceNumber || '—'}</p>
                  <p><strong>PO#:</strong> {selectedInvoiceLoad.poNumber || '—'}</p>
                </div>
              </div>

              <div className="invoice-grid">
                <div className="invoice-box">
                  <h4>Bill To</h4>
                  <p><strong>{selectedInvoiceLoad.customer}</strong></p>
                  <p>{selectedCustomer?.contactName || '—'}</p>
                  <p>{selectedCustomer?.email || '—'}</p>
                  <p>{selectedCustomer?.phone || '—'}</p>
                </div>

                <div className="invoice-box">
                  <h4>Load Information</h4>
                  <p><strong>Reference #:</strong> {selectedInvoiceLoad.referenceNumber || '—'}</p>
                  <p><strong>PO#:</strong> {selectedInvoiceLoad.poNumber || '—'}</p>

                  <p><strong>Pick up Location:</strong> {selectedInvoiceLoad.pickup}</p>
                  <p><strong>Delivery Location:</strong> {getDeliveryDisplay(selectedInvoiceLoad.delivery) || '—'}</p>
                  <p><strong>Appointment:</strong> {selectedInvoiceLoad.appointmentTime || '—'}</p>
                  <p><strong>Return Location:</strong> {selectedInvoiceLoad.returnLocation || '—'}</p>
                  <p><strong>Container:</strong> {selectedInvoiceLoad.containerNumber || '—'}</p>
                </div>
              </div>

              <div className="invoice-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Linehaul / Load Rate</td>
                      <td>{formatMoney(parseMoney(selectedInvoiceLoad.rate))}</td>
                    </tr>
                    {parseMoney(selectedInvoiceLoad.detention) > 0 && (
                      <tr>
                        <td>Detention</td>
                        <td>{formatMoney(parseMoney(selectedInvoiceLoad.detention))}</td>
                      </tr>
                    )}
                    {parseCustomerExtraCharges(selectedInvoiceLoad).map((charge, index) => (
                      <tr key={charge.id || index}>
                        <td>
                          {charge.type || 'Extra Charge'}
                          {charge.description ? ` - ${charge.description}` : ''}
                        </td>
                        <td>{formatMoney(parseMoney(charge.amount))}</td>
                      </tr>
                    ))}
                    <tr className="invoice-total-row">
                      <td>Total Invoice</td>
                      <td>{formatMoney(getCustomerBillAmount(selectedInvoiceLoad))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="invoice-box">
                <h4>Notes</h4>
                <p>{selectedInvoiceLoad.notes || 'No additional notes.'}</p>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>No loads available for invoice.</p>
            </div>
          )}

          <div className="invoice-box" style={{ marginTop: '24px' }}>
            <div className="panel-header" style={{ marginBottom: '12px' }}>
              <h3>Saved Invoices</h3>
              <span>{savedInvoices.length} invoices</span>
            </div>

            {savedInvoices.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
  <tr>
    <th>Invoice #</th>
    <th>Customer</th>
    <th>Load ID</th>
    <th>Reference #</th>
    <th>Amount</th>
    <th>Status</th>
    <th>Issue Date</th>
  </tr>   
</thead>
                  <tbody>
                    {savedInvoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>{invoice.invoiceNumber}</td>
                        <td>{invoice.customerName}</td>
                        <td>{invoice.loadId}</td>
                        <td>{invoice.referenceNumber || '—'}</td>
                        <td>{formatMoney(Number(invoice.amount || 0))}</td>
                        <td>
                          <select
                            value={invoice.status}
                            onChange={(e) =>
                              handleInvoiceStatusChange(invoice.id, e.target.value)
                            }
                            className="filter-select"
                          >
                            <option value="Unpaid">Unpaid</option>
                            <option value="Partial">Partial</option>
                            <option value="Paid">Paid</option>
                            <option value="Overdue">Overdue</option>
                          </select>
                        </td>
                        <td>{invoice.issueDate || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <p>No saved invoices yet.</p>
              </div>
            )}
          </div>
        </section>
      )}
      {settlementReviewLoad && (
        <div className="modal-overlay" onClick={() => setSettlementReviewLoadId('')}>
          <div className="modal-content settlement-review-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{settlementReviewLoad.containerNumber || settlementReviewLoad.id}</h3>
                <p className="panel-subtitle">
                  {settlementReviewLoad.customer || 'No customer'} - {formatAppointmentTime(settlementReviewLoad.appointmentTime) || 'No appointment'}
                </p>
              </div>
              <button type="button" className="secondary-btn" onClick={() => setSettlementReviewLoadId('')}>
                Close
              </button>
            </div>

            <div className="settlement-review-grid">
              <div className="detail-box">
                <span>Load ID</span>
                <strong>{settlementReviewLoad.id}</strong>
              </div>
              <div className="detail-box">
                <span>Driver</span>
                <strong>{getDriverLabel(settlementReviewLoad.driver)}</strong>
              </div>
              <div className="detail-box">
                <span>Truck</span>
                <strong>{settlementReviewLoad.truck || '-'}</strong>
              </div>
              <div className="detail-box">
                <span>Route Miles</span>
                <strong>{formatMiles(settlementReviewLoad.miles)}</strong>
              </div>
              <div className="detail-box">
                <span>Driver Pay</span>
                <strong>{getSettlementPayValue(settlementReviewLoad, 'driverRate')}</strong>
              </div>
              <div className="detail-box">
                <span>Reference</span>
                <strong>{settlementReviewLoad.referenceNumber || settlementReviewLoad.poNumber || '-'}</strong>
              </div>
              <div className="detail-box">
                <span>Pickup #</span>
                <strong>{settlementReviewLoad.pickupNumber || '-'}</strong>
              </div>
            </div>

            <div className="settlement-review-route">
              <div className="address-block">
                <span>Pickup</span>
                <p>{settlementReviewLoad.pickup || '-'}</p>
              </div>
              <div className="address-block">
                <span>Delivery</span>
                <p>{getDeliveryDisplay(settlementReviewLoad.delivery) || '-'}</p>
              </div>
              <div className="address-block">
                <span>Return</span>
                <p>{settlementReviewLoad.returnLocation || '-'}</p>
              </div>
            </div>

            <div className="settlement-review-docs">
              <div className="documents-header">
                <h4>Documents / Paperwork</h4>
                <div className="checklist-grid settlement-review-checks">
                  {['POD', 'IN EIR', 'OUT EIR'].map((docType) => {
                    const isUploaded = getChecklistStatus(settlementReviewLoad, docType);
                    return (
                      <div key={docType} className={`checklist-card ${isUploaded ? 'uploaded' : 'missing'}`}>
                        <span>{docType}</span>
                        <strong>{isUploaded ? 'Uploaded' : 'Missing'}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>

              {settlementReviewLoad.documents?.length ? (
                <div className="documents-list">
                  {settlementReviewLoad.documents.map((doc) => (
                    <div key={doc.id} className="document-card">
                      <div className="document-info">
                        <strong>{doc.name}</strong>
                        <p>{doc.size} - {normalizeDocType(doc.type)}</p>
                        <span className="document-badge">{doc.category}</span>
                      </div>
                      <div className="document-actions">
                        <button className="secondary-btn" onClick={() => handleOpenDocument(doc)}>Open</button>
                        <button className="secondary-btn" onClick={() => handleDownloadDocument(doc)}>Download</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="documents-empty">No documents uploaded for this load.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {previewDocument && previewUrl && (
  <div className="modal-overlay" onClick={handleClosePreview}>
    <div className="modal-content preview-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <h3>{previewDocument.name}</h3>
        <button type="button" className="secondary-btn" onClick={handleClosePreview}>
          Close
        </button>
      </div>

      <div className="preview-frame-wrap">
        {previewDocument.type?.includes('pdf') ? (
          <iframe
            src={previewUrl}
            title={previewDocument.name}
            className="preview-frame"
          />
        ) : previewDocument.type?.startsWith('image/') ? (
          <img
            src={previewUrl}
            alt={previewDocument.name}
            className="preview-image"
          />
        ) : (
          <div className="documents-empty">
            Preview not available for this file type.
          </div>
        )}
      </div>
    </div>
  </div>
)}
    </div>
  );
}

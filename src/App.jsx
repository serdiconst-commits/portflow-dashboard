import { useState, useEffect, useRef, useMemo } from 'react';
import SignatureCanvas from 'react-signature-canvas';
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
const getDefaultViewForRole = (role) => {
  const normalizedRole = getNormalizedRole(role);
  if (normalizedRole === 'driver') return 'driver';
  if (normalizedRole === 'payroll') return 'settlements';
  return 'dispatch';
};

const roleCanAccessView = (role, view) => {
  const normalizedRole = getNormalizedRole(role);
  if (fullAccessRoles.has(normalizedRole)) return true;
  if (normalizedRole === 'driver') return view === 'driver';
  if (normalizedRole === 'payroll') return ['settlements', 'invoices', 'settings'].includes(view);
  if (normalizedRole === 'manager') {
    return ['dispatch', 'drivers', 'customers', 'settlements', 'invoices', 'settings'].includes(view);
  }
  if (normalizedRole === 'dispatcher') {
    return ['dispatch', 'drivers', 'customers', 'settings'].includes(view);
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
  return load.status || load.availabilityStatus || '';
};

const getLoadQuickStatusKey = (load = {}) =>
  String(getLoadQuickStatus(load) || '').trim().toLowerCase();

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

const isInvalidTokenError = (message = '') =>
  String(message).toLowerCase().includes('invalid token') ||
  String(message).toLowerCase().includes('unauthorized');

const handleAuthError = (message) => {
  if (!isInvalidTokenError(message)) return false;

  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('company');
  setAuthToken('');
  setCurrentUser(null);
  setCompany(null);
  setLoginError('Your session expired after the latest update. Please log in again.');
  alert('Your session expired. Please log in again, then save the address.');
  return true;
};
  const calculateSettlement = ({ driverRate, detention, lumper, fuelAdvance }) => {
    const total =
      parseMoney(driverRate) +
      parseMoney(detention) +
      parseMoney(lumper) -
      parseMoney(fuelAdvance);

    return formatMoney(total);
  };

const getPaperworkStatusFromDocuments = (documents = []) => {
  return documents.length > 0 ? 'Submitted' : 'Pending';
};

const getDocumentCategory = (doc) =>
  String(doc?.category || doc?.type || '').trim().toUpperCase();

const requiredDriverDocumentTypes = ['POD', 'IN EIR', 'OUT EIR'];

const hasRequiredDriverDocuments = (load) => {
  const uploaded = new Set((load?.documents || []).map(getDocumentCategory));
  return requiredDriverDocumentTypes.every((docType) => uploaded.has(docType));
};

const getMissingDriverDocuments = (load) => {
  const uploaded = new Set((load?.documents || []).map(getDocumentCategory));
  return requiredDriverDocumentTypes.filter((docType) => !uploaded.has(docType));
};

  const getTodayDate = () => new Date().toISOString().split('T')[0];

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
    referenceNumber: '',
    poNumber: '',
    reservationNumber: '',
    returnNumber: '',
    returnLocation: '',
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
const driverCameraVideoRef = useRef(null);
const driverCameraStreamRef = useRef(null);
const [dashboardFilter, setDashboardFilter] = useState('all');
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

const savedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
const savedCompany = JSON.parse(localStorage.getItem('company') || 'null');
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
  (load) => getAvailabilityStatusKey(load) === 'available'
);

const notAvailableLoads = loadsData.filter(
  (load) => getAvailabilityStatusKey(load) === 'not available'
);

const [selectedPresetName, setSelectedPresetName] = useState('');
const [selectedLoad, setSelectedLoad] = useState(null);
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
const [registerName, setRegisterName] = useState('');
const [authToken, setAuthToken] = useState(localStorage.getItem('authToken') || '');
const [currentUser, setCurrentUser] = useState(savedUser || null);
const [company, setCompany] = useState(savedCompany || null);
const [companyLogoUploading, setCompanyLogoUploading] = useState(false);
const [companyLogoVersion, setCompanyLogoVersion] = useState(Date.now());
const [auditLogs, setAuditLogs] = useState([]);
const [selectedLoadAuditLogs, setSelectedLoadAuditLogs] = useState([]);
const [driverContainerByLoad, setDriverContainerByLoad] = useState({});
const [portHoustonChecksByLoad, setPortHoustonChecksByLoad] = useState({});
const [portHoustonCheckingLoadId, setPortHoustonCheckingLoadId] = useState('');
const [portHoustonSettingsForm, setPortHoustonSettingsForm] = useState(
  buildPortHoustonCredentialForm(savedCompany || {})
);
const [portHoustonSettingsStatus, setPortHoustonSettingsStatus] = useState('');
const [portHoustonSettingsSaving, setPortHoustonSettingsSaving] = useState('');

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

    localStorage.setItem('authToken', data.token);
    localStorage.setItem('currentUser', JSON.stringify(data.user));

    if (data.company) {
      setCompany(data.company);
      localStorage.setItem('company', JSON.stringify(data.company));
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

    setAuthToken(data.token);
    setCurrentUser(data.user);
    setCompany(data.company || null);
    setActiveView(isDriverApp ? 'driver' : getDefaultViewForRole(data.user?.role));

    localStorage.setItem('authToken', data.token);
    localStorage.setItem('currentUser', JSON.stringify(data.user));

    if (data.company) {
      localStorage.setItem('company', JSON.stringify(data.company));
    }

    setLoginError('');
  } catch (error) {
    console.error('Registration failed:', error);
    setLoginError(error.message);
  }
};
const handleDriverDocumentUpload = async (loadId) => {
  try {
    const file = uploadFileByLoad[loadId] || uploadFileRef.current[loadId];
    const category = uploadDocType[loadId] || 'POD';

    if (!file) {
      alert('Please choose a file first.');
      return;
    }

    const formData = new FormData();
    formData.append('files', file);
    formData.append('category', category);

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

const handleDriverUploadFileChange = (loadId, file, source = 'camera') => {
  if (!file) {
    setDriverUploadStatusByLoad((prev) => ({
      ...prev,
      [loadId]: `No file received from ${source}. Please try again.`,
    }));
    return;
  }

  uploadFileRef.current[loadId] = file;
  setUploadFileByLoad((prev) => ({
    ...prev,
    [loadId]: file,
  }));
  setDriverUploadStatusByLoad((prev) => ({
    ...prev,
    [loadId]: `Ready: ${file.name || 'camera photo'} (${file.type || 'photo'}, ${file.size || 0} bytes)`,
  }));
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
};

const openDriverCamera = (loadId) => {
  setDriverCameraLoadId(loadId);
  setDriverCameraError('');
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

  canvas.toBlob(
    (blob) => {
      if (!blob) {
        setDriverCameraError('Could not save the camera photo. Please try again.');
        return;
      }

      const file = new File([blob], `driver-photo-${loadId}-${Date.now()}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });

      handleDriverUploadFileChange(loadId, file, 'PortFlow camera');
      closeDriverCamera();
    },
    'image/jpeg',
    0.9
  );
};

useEffect(() => {
  if (!driverCameraLoadId) return;

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
}, [driverCameraLoadId]);


const [searchTerm, setSearchTerm] = useState('');
const [statusFilter, setStatusFilter] = useState('All');
const [paperworkFilter, setPaperworkFilter] = useState('All');
const [selectedDocumentType, setSelectedDocumentType] = useState('POD');
const [selectedSettlementDriverId, setSelectedSettlementDriverId] = useState('');
const [settlementStartDate, setSettlementStartDate] = useState('');
const [settlementEndDate, setSettlementEndDate] = useState('');
const [settlementNote, setSettlementNote] = useState('');
const [settlementContainerSearch, setSettlementContainerSearch] = useState('');
const [selectedSettlementLoadId, setSelectedSettlementLoadId] = useState('');
const [settlementPayDrafts, setSettlementPayDrafts] = useState({});
const [settlementPayStatus, setSettlementPayStatus] = useState('');
const [invoiceLoadId, setInvoiceLoadId] = useState('');
const [savedInvoices, setSavedInvoices] = useState([]);
const [invoiceStatusMessage, setInvoiceStatusMessage] = useState('');
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
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('company');
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
      throw new Error(data.error || 'Failed to fetch company profile');
    }

    setCompany(data);
    localStorage.setItem('company', JSON.stringify(data));
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
    localStorage.setItem('company', JSON.stringify(data));
  } catch (error) {
    console.error('Failed to upload company logo:', error);
    alert(`Failed to upload logo: ${error.message}`);
  } finally {
    setCompanyLogoUploading(false);
    e.target.value = '';
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
    localStorage.setItem('company', JSON.stringify(data));
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
    localStorage.setItem('company', JSON.stringify(data));
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
      throw new Error(`Failed to fetch loads: ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error('Loads response is not an array');
    }

    const loadsWithPaperwork = data.map((load) => ({
  ...load,
  documents: load.documents || [],
  paperwork: getPaperworkStatusFromDocuments(load.documents || []),
}));

setLoadsData(loadsWithPaperwork);

    setSelectedLoad((prev) => {
      if (loadsWithPaperwork.length === 0) return null;
      if (!prev) return loadsWithPaperwork[0];
      return loadsWithPaperwork.find((load) => load.id === prev.id) || loadsWithPaperwork[0];
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

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch driver locations');
    }

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
  if (selectedLoad?.id && roleCanAccessView(currentUser?.role, 'dispatch')) {
    fetchSelectedLoadAuditLogs(selectedLoad.id);
  } else {
    setSelectedLoadAuditLogs([]);
  }
}, [selectedLoad?.id, authToken, currentUser?.role]);

useEffect(() => {
  if (!currentUser) return;
  if (!roleCanAccessView(currentUser.role, activeView)) {
    setActiveView(getDefaultViewForRole(currentUser.role));
  }
}, [activeView, currentUser]);

useEffect(() => {
  if (activeView === 'drivers') {
    fetchDrivers();
  }
}, [activeView, authToken]);


 useEffect(() => {
  if (!authToken) return;

  fetchLoads();
  fetchCustomers();
  fetchInvoices();
  fetchLocations();
  fetchDrivers();
  fetchCompanyProfile();
  fetchDriverLocations();
}, [authToken]);

useEffect(() => {
  if (!authToken || activeView === 'driver') return;

  const interval = setInterval(() => {
    fetchLoads();
    fetchDriverLocations();
  }, 5000);

  return () => clearInterval(interval);
}, [authToken, activeView]);

useEffect(() => {
  if (!authToken || isEditing) return;

  const interval = setInterval(() => {
    refreshLoadsData();
  }, 5000);

  return () => clearInterval(interval);
}, [authToken, activeView, isEditing]);

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

  const filteredSettlementLoads = useMemo(() => {
    const activeDriverId = selectedSettlementDriverId || driversList[0]?.id || '';
    const start = settlementStartDate ? new Date(`${settlementStartDate}T00:00:00`) : null;
    const end = settlementEndDate ? new Date(`${settlementEndDate}T23:59:59`) : null;

    return loadsData.filter((load) => {
      const matchesDriver = activeDriverId
        ? normalizeDriverForStorage(load.driver) === activeDriverId
        : true;
      const loadDate = load.loadDate ? new Date(`${load.loadDate}T12:00:00`) : null;
      const matchesStart = !start || (loadDate && loadDate >= start);
      const matchesEnd = !end || (loadDate && loadDate <= end);
      return matchesDriver && matchesStart && matchesEnd;
    });
  }, [loadsData, selectedSettlementDriverId, driversList, settlementStartDate, settlementEndDate]);

  const activeSettlementDriver =
    driversList.find((driver) => driver.id === (selectedSettlementDriverId || driversList[0]?.id)) ||
    null;

  const settlementPeriodLabel =
    settlementStartDate || settlementEndDate
      ? `${settlementStartDate || 'Start'} to ${settlementEndDate || 'End'}`
      : 'All load dates';

  const settlementReport = activeSettlementDriver
    ? [
        {
          driverId: activeSettlementDriver.id,
          driverName: activeSettlementDriver.name,
          loadsCount: filteredSettlementLoads.length,
          totalDriverRate: formatMoney(
            filteredSettlementLoads.reduce((sum, load) => sum + parseMoney(load.driverRate), 0)
          ),
          totalDetention: formatMoney(
            filteredSettlementLoads.reduce((sum, load) => sum + parseMoney(load.detention), 0)
          ),
          totalLumper: formatMoney(
            filteredSettlementLoads.reduce((sum, load) => sum + parseMoney(load.lumper), 0)
          ),
          totalFuelAdvance: formatMoney(
            filteredSettlementLoads.reduce((sum, load) => sum + parseMoney(load.fuelAdvance), 0)
          ),
          totalSettlement: formatMoney(
            filteredSettlementLoads.reduce((sum, load) => sum + parseMoney(load.settlement), 0)
          ),
        },
      ]
    : [];

  const settlementTotals = settlementReport[0] || {
    loadsCount: 0,
    totalDriverRate: formatMoney(0),
    totalDetention: formatMoney(0),
    totalLumper: formatMoney(0),
    totalFuelAdvance: formatMoney(0),
    totalSettlement: formatMoney(0),
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
    const dateCompare = String(a.loadDate || '').localeCompare(String(b.loadDate || ''));
    if (dateCompare !== 0) return dateCompare;
    return getDriverLabel(a.driver).localeCompare(getDriverLabel(b.driver));
  });

  const normalizedSettlementContainerSearch = settlementContainerSearch.trim().toLowerCase();
  const visibleSettlementLoads = normalizedSettlementContainerSearch
    ? settlementDetailLoads.filter((load) =>
        String(load.containerNumber || '').toLowerCase().includes(normalizedSettlementContainerSearch)
      )
    : settlementDetailLoads;

  const selectedSettlementLoad =
    visibleSettlementLoads.find((load) => load.id === selectedSettlementLoadId) ||
    visibleSettlementLoads[0] ||
    null;

  const getSettlementPayValue = (load, field) =>
    settlementPayDrafts[load.id]?.[field] ?? load[field] ?? '$0.00';

  const getSettlementPayTotal = (load) =>
    calculateSettlement({
      driverRate: getSettlementPayValue(load, 'driverRate'),
      detention: getSettlementPayValue(load, 'detention'),
      lumper: getSettlementPayValue(load, 'lumper'),
      fuelAdvance: getSettlementPayValue(load, 'fuelAdvance'),
    });

  const paperworkAlerts = loadsData.filter((load) => load.paperwork);

const isCompletedLoad = (load) => ['delivered', 'completed'].includes(getLoadQuickStatusKey(load));
const isDeliveredLoad = isCompletedLoad;
const hasLastFreeDay = (load) => Boolean(String(load.lfd || load.lastFreeDay || '').trim());
const hasAppointment = (load) => Boolean(String(load.appointmentTime || '').trim());
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

const deliveredLoads = loadsData.filter(
  (load) => getLoadQuickStatusKey(load) === 'delivered'
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
  { title: 'Delivered', value: deliveredLoads.length, filter: 'delivered' },
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
      };

      updated.settlement = calculateSettlement({
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
};

if (name === 'driver' && prev.status === 'Dropped') {
  updated.pickup =
    prev.dropType === 'Customer'
      ? prev.delivery || prev.pickup
      : prev.returnLocation || prev.pickup;
}

      updated.settlement = calculateSettlement({
        driverRate: updated.driverRate,
        detention: updated.detention,
        lumper: updated.lumper,
        fuelAdvance: updated.fuelAdvance,
      });

      return updated;
    });
  };

const handleAddLoad = async (e) => {
  e.preventDefault();
  const isExportLoad = selectedPresetName === 'Export Load';
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
      settlement: calculateSettlement({
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
      eta: newLoad.eta || '',
      availabilityStatus: newLoad.availabilityStatus || 'Not Available',
      documents: [],
      paperwork: getPaperworkStatusFromDocuments([]),
    };

    const payload = {
  ...loadToAdd,
  driver: normalizeDriverForStorage(newLoad.driver),
  truck: newLoad.driver ? getDriverTruck(newLoad.driver) : '',
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

    setSelectedLoad(data);
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
    settlement: calculateSettlement({
      driverRate: editingLoad.driverRate || '$0.00',
      detention: editingLoad.detention || '$0.00',
      lumper: editingLoad.lumper || '$0.00',
      fuelAdvance: editingLoad.fuelAdvance || '$0.00',
    }),
    paperwork: getPaperworkStatusFromDocuments(editingLoad.documents || []),
  };
  try {

    /* EDITLOAD FUNTION */

const payload = {
  ...updatedLoad,
  driver: normalizeDriverForStorage(updatedLoad.driver),
  truck: updatedLoad.driver ? getDriverTruck(updatedLoad.driver) : '',
  droppedBy: normalizeDriverForStorage(updatedLoad.droppedBy),
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
    lastFreeDay: availability.lastFreeDay || '',
    lastGateMove,
    outEir: result?.eir?.out || null,
    inEir: result?.eir?.in || null,
    checkedBy: result?.checkedBy || '',
    checkedAt: result?.checkedAt || '',
  };
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

  updatedLoad.settlement = calculateSettlement({
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
    handleResetSettlementPayDraft(load.id);
    setSettlementPayStatus(`Load pay saved for ${data.id}.`);
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
  pickup:
    selectedLoad.status === 'Dropped'
      ? selectedLoad.dropType === 'Customer'
        ? selectedLoad.delivery || selectedLoad.pickup
        : selectedLoad.returnLocation || selectedLoad.pickup
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
  status: isAvailabilityStatus ? selectedLoad.status : newStatus,
  availabilityStatus: isAvailabilityStatus ? newStatus : '',
  dropDateTime:
    !isAvailabilityStatus && newStatus === 'Dropped'
      ? new Date().toISOString()
      : selectedLoad.dropDateTime || '',
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

  const updatedLoad = {
    ...selectedLoad,
    status: 'Dropped',
    dropDateTime: selectedLoad.dropDateTime || new Date().toISOString(),
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
    setLoadsData((prevLoads) =>
      prevLoads.map((load) => (load.id === data.id ? data : load))
    );
    await fetchLoads();
    await fetchSelectedLoadAuditLogs(data.id);
  } catch (error) {
    console.error('Failed to save drop details:', error);
    alert(`Failed to save drop details: ${error.message}`);
  }
};

const handleDocumentUpload = async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length || !selectedLoad) return;

  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  formData.append('category', selectedDocumentType || 'Other');

  try {
    const res = await fetch(`${API_BASE}/api/loads/${selectedLoad.id}/documents`, {
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

    await fetchLoads();
    await fetchSelectedLoadAuditLogs(selectedLoad.id);

    
  } catch (error) {
    console.error('Document upload error:', error);
    alert(`Failed to upload documents: ${error.message}`);
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

    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl);
    }

    setPreviewDocument(doc);
    setPreviewUrl(url);
  } catch (error) {
    console.error('Open document error:', error);
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
      NetSettlement: getSettlementPayTotal(load),
      Note: settlementNote,
    }));

    const headers = Object.keys(rows[0] || {
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
      NetSettlement: '',
      Note: '',
    });

    const csv = [
      headers.join(','),
      ...rows.map((row) =>
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
            <td>${getSettlementPayTotal(load)}</td>
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
            .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 18px 0; }
            .box { border: 1px solid #d1d5db; padding: 10px; border-radius: 8px; }
            .box span { display: block; color: #6b7280; font-size: 12px; margin-bottom: 4px; }
            .note { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; margin: 18px 0; white-space: pre-wrap; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; font-size: 14px; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          <h1>Driver Settlement Report</h1>
          <p>Driver: ${activeSettlementDriver ? `${activeSettlementDriver.id} - ${activeSettlementDriver.name}` : '-'}</p>
          <p>Period: ${periodLabel}</p>
          <div class="summary">
            <div class="box"><span>Loads</span><strong>${settlementTotals.loadsCount}</strong></div>
            <div class="box"><span>Load Pay</span><strong>${settlementTotals.totalDriverRate}</strong></div>
            <div class="box"><span>Detention</span><strong>${settlementTotals.totalDetention}</strong></div>
            <div class="box"><span>Lumper</span><strong>${settlementTotals.totalLumper}</strong></div>
            <div class="box"><span>Net Pay</span><strong>${settlementTotals.totalSettlement}</strong></div>
          </div>
          ${settlementNote ? `<div class="note"><strong>Payroll Note</strong><br>${settlementNote}</div>` : ''}
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
  
const handleSaveInvoice = async () => {
  if (!selectedInvoiceLoad) return;

  if (!selectedInvoiceLoad?.pod) {
    alert('POD is required before saving invoice');
    return;
  }

  try {
    const invoicePayload = {
      customerId: selectedCustomer?.id || '',
      customerName: selectedInvoiceLoad.customer || 'Customer',
      loadId: selectedInvoiceLoad.id,
      referenceNumber: selectedInvoiceLoad.referenceNumber || '',
      poNumber: selectedInvoiceLoad.poNumber || '',
      amount: parseMoney(selectedInvoiceLoad.rate),
      status: 'Unpaid',
      issueDate: getTodayDate(),
      dueDate: '',
      notes: selectedInvoiceLoad.notes || '',
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
        (inv) => inv.loadId !== selectedInvoiceLoad.id
      );
      return [...withoutCurrent, data];
    });

    setInvoiceStatusMessage(`Invoice ${data.invoiceNumber} saved successfully.`);
  } catch (error) {
    console.error('Save invoice error:', error);
    setInvoiceStatusMessage(`Failed to save invoice: ${error.message}`);
  }
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
const handleGeneratePOD = () => {
  if (!selectedInvoiceLoad) return;

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
          <strong>Delivery:</strong> ${selectedInvoiceLoad.delivery || '—'}<br/>
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
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('company');
  setAuthToken('');
  setCurrentUser(null);
  setCompany(null);
};

const handlePrintInvoice = () => {
  if (!selectedInvoiceLoad) return;

  if (!selectedInvoiceLoad?.pod) {
    alert('POD is required before printing invoice');
    return;
  }

  const invoiceNumber =
    savedInvoices.find((inv) => inv.loadId === selectedInvoiceLoad.id)?.invoiceNumber ||
    'INV-XXXX';

  const customerName = selectedInvoiceLoad.customer || 'Customer';
  const customerContact = selectedCustomer?.contactName || '';
  const customerEmail = selectedCustomer?.email || '';
  const customerPhone = selectedCustomer?.phone || '';

  const formattedRate = `$${Number(selectedInvoiceLoad.rate || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const printWindow = window.open('', '_blank', 'width=1100,height=800');
  if (!printWindow) return;

  printWindow.document.write(`
    <html>
      <head>
        <title>Invoice ${invoiceNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
          h1, h2, h3, p { margin: 0; }
          .header { margin-bottom: 24px; }
          .section { margin-bottom: 20px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
          .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 16px; }
          .line { margin-bottom: 8px; }
          .total { font-size: 20px; font-weight: bold; margin-top: 12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Invoice</h1>
          <p>Invoice Number: ${invoiceNumber}</p>
          <p>Load ID: ${selectedInvoiceLoad.id || '—'}</p>
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
            <div class="line"><strong>Delivery:</strong> ${selectedInvoiceLoad.delivery || '—'}</div>
            <div class="line"><strong>Return:</strong> ${selectedInvoiceLoad.returnLocation || '—'}</div>
            <div class="line"><strong>Container:</strong> ${selectedInvoiceLoad.containerNumber || '—'}</div>
            <div class="line"><strong>Chassis:</strong> ${selectedInvoiceLoad.chassisNumber || '—'}</div>
          </div>
        </div>

        <div class="section card">
          <h3>Charges</h3>
          <div class="total">Amount Due: ${formattedRate}</div>
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
        load.id === loadId ? { ...load, status: newStatus } : load
      )
    );

    await fetchLoads();
    alert(newStatus === 'Delivered' ? 'Load completed' : `Status updated to ${newStatus}`);
  } catch (error) {
    console.error('STATUS UPDATE ERROR:', error);
    alert(`Failed to update status: ${error.message}`);
  }
};

const handleDriverContainerUpdate = async (loadId) => {
  const containerNumber = String(driverContainerByLoad[loadId] || '').trim().toUpperCase();

  if (!containerNumber) {
    alert('Please enter the container number first.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/loads/${loadId}/container-number`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ containerNumber }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to update container number');
    }

    setLoadsData((prevLoads) =>
      prevLoads.map((load) =>
        load.id === loadId ? { ...load, containerNumber: data.containerNumber } : load
      )
    );
    setDriverContainerByLoad((prev) => ({ ...prev, [loadId]: '' }));
    await fetchLoads();
    alert('Container number saved');
  } catch (error) {
    console.error('Container update error:', error);
    alert(`Failed to save container number: ${error.message}`);
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

if (!authToken) {
return (
    <div className={isDriverApp ? 'driver-mobile-login' : ''} style={{ maxWidth: '400px', margin: '80px auto', padding: '24px' }}>
      <h2>
        {isDriverApp
          ? 'PortFlow Driver'
          : authMode === 'register'
          ? 'Create PortFlow Account'
          : 'PortFlow Login'}
      </h2>

      <form onSubmit={!isDriverApp && authMode === 'register' ? handleRegister : handleLogin}>
        {!isDriverApp && authMode === 'register' && (
          <div style={{ marginBottom: '12px' }}>
            <label>Company Name</label>
            <input
              type="text"
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
              style={{ width: '100%', padding: '10px', marginTop: '4px' }}
            />
          </div>
        )}

        <div style={{ marginBottom: '12px' }}>
          <label>Email</label>
          <input
            type="email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            style={{ width: '100%', padding: '10px', marginTop: '4px' }}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label>Password</label>
          <input
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            style={{ width: '100%', padding: '10px', marginTop: '4px' }}
          />
        </div>

        {loginError && (
          <p style={{ color: 'red', marginBottom: '12px' }}>
            {loginError}
          </p>
        )}

        <button type="submit" style={{ width: '100%', padding: '10px' }}>
          {authMode === 'register' ? 'Create Account' : 'Log In'}
        </button>
      </form>

      {!isDriverApp && (
        <button
          type="button"
          onClick={() => {
            setLoginError('');
            setAuthMode(authMode === 'register' ? 'login' : 'register');
          }}
          style={{
            width: '100%',
            padding: '10px',
            marginTop: '10px',
            background: 'transparent',
            border: '1px solid #d1d5db',
          }}
        >
          {authMode === 'register'
            ? 'Already have an account? Log in'
            : 'Create first company account'}
        </button>
      )}
    </div>
  );
}


const baseFilteredLoadsData =
  dashboardFilter === 'lfd'
    ? loadsData.filter((load) => hasLastFreeDay(load) && !isDeliveredLoad(load))
    : dashboardFilter === 'appointments'
    ? loadsData.filter((load) => hasAppointment(load) && !isCompletedLoad(load))
    : dashboardFilter === 'available'
    ? loadsData.filter(
        (load) => getAvailabilityStatusKey(load) === 'available'
      )
    : dashboardFilter === 'not-available'
    ? loadsData.filter(
        (load) => getAvailabilityStatusKey(load) === 'not available'
      )
    : dashboardFilter === 'dispatched'
    ? loadsData.filter(
        (load) => isDriverAssignedDispatchLoad(load)
      )
    : dashboardFilter === 'in-transit'
    ? loadsData.filter(
        (load) => getLoadQuickStatusKey(load) === 'in transit'
      )

          : dashboardFilter === 'dropped'
    ? loadsData.filter(
        (load) => getLoadQuickStatusKey(load) === 'dropped'
      )

    : dashboardFilter === 'delivered'
    ? loadsData.filter(
        (load) => getLoadQuickStatusKey(load) === 'delivered'
      )
    : loadsData;
    const normalizedSearchTerm = String(searchTerm || '').trim().toLowerCase();
    
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
  const loadContainer = String(load.containerNumber || '').trim().toLowerCase();
  const loadBooking = String(load.bookingNumber || '').trim().toLowerCase();
  return (
    loadName.includes(normalizedSearchTerm) ||
    loadCustomer.includes(normalizedSearchTerm) ||
    loadDriver.includes(normalizedSearchTerm) ||
    loadReference.includes(normalizedSearchTerm) ||
    loadPo.includes(normalizedSearchTerm) ||
    loadContainer.includes(normalizedSearchTerm) ||
    loadBooking.includes(normalizedSearchTerm)
  );
});
const selectedDeliveryLocationId =
  (deliveryLocations || []).find((loc) => formatLocationAddress(loc) === newLoad.delivery)?.id || '';
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

    setLoadsData(data);
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

const driverActiveLoads = (loadsData || []).filter((load) => {
  const status = String(load.status || '').trim().toLowerCase();
  return driverMatchesCurrentUser(load.driver, currentUser) && !['delivered', 'dropped'].includes(status);
});

const driverCompletedLoads = (loadsData || []).filter((load) => {
  const status = String(load.status || '').trim().toLowerCase();
  return driverMatchesCurrentUser(load.driver, currentUser) && status === 'delivered';
});

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

  if (trackedDriverLocations.length === 1) {
    driverMapInstanceRef.current.setCenter(bounds.getCenter());
    driverMapInstanceRef.current.setZoom(12);
  } else {
    driverMapInstanceRef.current.fitBounds(bounds, 48);
  }
}, [trackedDriverLocations]);

const getDriverStatusClass = (status) =>
  String(status || 'assigned')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

const DriverLoadCard = ({ load }) => {
  const selectedFile = uploadFileByLoad[load.id] || uploadFileRef.current[load.id];
  const uploadStatus = driverUploadStatusByLoad[load.id];
  const missingDocuments = getMissingDriverDocuments(load);
  const paperworkComplete = hasRequiredDriverDocuments(load);

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
          <span>Delivery</span>
          {load.delivery ? (
            <a href={getGoogleMapsLink(load.delivery)} target="_blank" rel="noopener noreferrer">
              {load.delivery}
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
          <span>Pay</span>
          <strong>{load.driverRate ? formatMoney(parseMoney(load.driverRate)) : '-'}</strong>
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
          placeholder={load.containerNumber ? 'Update container number' : 'Enter container number'}
          value={driverContainerByLoad[load.id] ?? ''}
          onChange={(e) =>
            setDriverContainerByLoad((prev) => ({
              ...prev,
              [load.id]: e.target.value,
            }))
          }
        />
        <button type="button" onClick={() => handleDriverContainerUpdate(load.id)}>
          Save Container
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
            Take Photo
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

        <p className="driver-upload-name">{selectedFile?.name || 'No document selected'}</p>
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

      {driverCameraLoadId && (
        <section className="driver-camera-modal" aria-label="PortFlow camera">
          <div className="driver-camera-box">
            <div className="driver-camera-header">
              <strong>Take Document Photo</strong>
              <button type="button" onClick={closeDriverCamera}>Close</button>
            </div>
            <video ref={driverCameraVideoRef} autoPlay playsInline muted />
            {driverCameraError && <p className="driver-camera-error">{driverCameraError}</p>}
            <button type="button" className="driver-camera-capture" onClick={captureDriverCameraPhoto}>
              Capture Photo
            </button>
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
      </nav>

      {driverVisibleLoads.length === 0 ? (
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
      placeholder={load.containerNumber ? 'Update container number' : 'Enter container number'}
      value={driverContainerByLoad[load.id] ?? ''}
      onChange={(e) =>
        setDriverContainerByLoad((prev) => ({
          ...prev,
          [load.id]: e.target.value,
        }))
      }
    />
    <button type="button" onClick={() => handleDriverContainerUpdate(load.id)}>
      Save Container
    </button>
  </div>

  <p>
    <strong>Container Size:</strong> {load.containerSize || '-'}
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
        {load.delivery}
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
    {(uploadFileByLoad[load.id] || uploadFileRef.current[load.id])?.name || 'No document selected'}
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

<label>Pickup Location</label>

{!showNewPickup ? (
  <>
<select
  value={
    (pickupLocations || []).find((loc) => formatLocationAddress(loc) === newLoad.pickup)?.id || ''
  }
  onChange={(e) => {
    const selectedId = e.target.value;

    if (!selectedId) {
      setNewLoad((prev) => ({ ...prev, pickup: '' }));
      return;
    }

    const selectedLocation = (pickupLocations || []).find(
      (loc) => String(loc.id) === String(selectedId)
    );

    setNewLoad((prev) => ({
      ...prev,
      pickup: selectedLocation ? formatLocationAddress(selectedLocation) : '',
    }));
  }}
>
  <option value="">Select saved pickup location</option>
  {(pickupLocations || []).map((loc) => (
    <option key={loc.id} value={loc.id}>
      {getLocationOptionLabel(loc)}
    </option>
  ))}
</select>

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


<label>Delivery Location</label>
<div className="location-select-row">
  <select
    value={selectedDeliveryLocationId}
    onChange={(e) => {
      const selectedId = e.target.value;

      if (!selectedId) {
        setNewLoad((prev) => ({ ...prev, delivery: '' }));
        return;
      }

      handleSelectSavedLocation('delivery', selectedId);
    }}
  >
    <option value="">Select saved delivery location</option>
    {(deliveryLocations || []).map((loc) => (
      <option key={loc.id} value={loc.id}>
        {getLocationOptionLabel(loc)}
      </option>
    ))}
  </select>
  <button
    type="button"
    className="secondary-btn compact-btn danger-btn location-delete-btn"
    onClick={async () => {
      if (!selectedDeliveryLocationId) return;
      await handleDeleteLocation(selectedDeliveryLocationId);
      setNewLoad((prev) => ({ ...prev, delivery: '' }));
    }}
    disabled={!selectedDeliveryLocationId}
    title="Delete selected delivery location"
    aria-label="Delete selected delivery location"
  >
    X
  </button>
</div>

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

<label>Return Location</label>
<select
  value={
    (returnLocations || []).find((loc) => formatLocationAddress(loc) === newLoad.returnLocation)?.id || ''
  }
  onChange={(e) => {
    const selectedId = e.target.value;

    if (!selectedId) {
      setNewLoad((prev) => ({ ...prev, returnLocation: '' }));
      return;
    }

    handleSelectSavedLocation('returnLocation', selectedId);
  }}
>
  <option value="">Select return location</option>
  {(returnLocations || []).map((loc) => (
    <option key={loc.id} value={loc.id}>
      {getLocationOptionLabel(loc)}
    </option>
  ))}
</select>

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

          <section className="panel driver-tracking-panel">
            <div className="panel-header compact-header">
              <div>
                <h3>Driver Live Tracking</h3>
                <p className="panel-subtitle">Drivers appear here after they tap Start in the phone app.</p>
              </div>
              <span>{trackedDriverLocations.length} online</span>
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

          <main className="dashboard-grid">
            <section className="panel">
              <div className="panel-header">
                <h3>All Loads</h3>
                <span>{filteredLoadsData.length} loads</span>
              </div>

              <div className="filters-bar">
                <input
                  type="text"
                  placeholder="Search by container#, PO#, driver, customer, or reference#"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />

                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="filter-select">
  <option value="All">All Statuses</option>
  <option value="Dispatched">Dispatched</option>
  <option value="In Transit">In Transit</option>
  <option value="Dropped">Dropped</option>
  <option value="Delivered">Delivered</option>
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
                        <th>Date</th>
                        <th>Broker</th>
                        <th>Container</th>
                        <th>Booking #</th>
                        <th>Size</th>
                        <th>Ship Line</th>
                        <th>Pickup</th>
                        <th>Delivery</th>
                        <th>Appointment</th>
                        <th>Driver</th>
                        <th>ETA</th>
                        <th>Status</th>
                        <th>Ref #</th>
                        <th>PO #</th>
                        <th>Paperwork</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLoadsData.map((load) => {
                        const displayStatus = getLoadQuickStatus(load);
                        const hasPod = load.documents?.some(
                          (doc) => (doc.category || '').trim().toUpperCase() === 'POD'
                        );
                        const hasInEir = load.documents?.some(
                          (doc) => (doc.category || '').trim().toUpperCase() === 'IN EIR'
                        );
                        const hasOutEir = load.documents?.some(
                          (doc) => (doc.category || '').trim().toUpperCase() === 'OUT EIR'
                        );
                        const paperworkLabel =
                          hasPod && hasInEir && hasOutEir
                            ? 'Complete'
                            : hasPod || hasInEir || hasOutEir
                            ? 'Partial'
                            : 'Missing';

                        return (
                          <tr
                            key={load.id}
                            className={selectedLoad?.id === load.id ? 'selected' : ''}
                            onClick={() => {
                              setSelectedLoad(load);
                              setIsEditing(false);
                            }}
                          >
                            <td>{load.loadDate || '-'}</td>
                            <td>{load.customer || '-'}</td>
                            <td>
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
                            </td>
                            <td>{load.bookingNumber || '-'}</td>
                            <td>{load.containerSize || '-'}</td>
                            <td>{load.shipLine || '-'}</td>
                            <td>{shortLocation(load.pickup)}</td>
                            <td>{shortLocation(load.delivery)}</td>
                            <td>{formatAppointmentTime(load.appointmentTime)}</td>
                            <td>{load.driver ? getDriverLabel(load.driver) : 'Not Assigned'}</td>
                            <td>{formatAppointmentTime(load.eta)}</td>
                            <td>
                              <span className={`sheet-status ${String(displayStatus || '').toLowerCase().replace(/\s/g, '-')}`}>
                                {displayStatus || '-'}
                              </span>
                            </td>
                            <td>{load.referenceNumber || '-'}</td>
                            <td>{load.poNumber || '-'}</td>
                            <td>
                              <span className={`sheet-paperwork ${paperworkLabel.toLowerCase()}`}>
                                {paperworkLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
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
  {shortLocation(load.delivery)}
</div>
   <p>📍 <strong>Drop Type:</strong><br /> {load.dropType || '-'}</p>
   <p>📍 <strong>Drop Location:</strong><br /> {load.dropLocation || '-'}</p>
   <p>👤 <strong>Dropped By:</strong><br /> {load.droppedBy ? getDriverLabel(load.droppedBy) : '—'}</p>
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
      ? load.delivery || '-'
      : load.returnLocation || '-'}
  </p>
)}
<div className="load-field">
  <strong>PO#</strong>
  {load.poNumber || '—'}
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

            <section className="panel">
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
                      <button className="secondary-btn" onClick={handleEditClick}>Edit Load</button>
                      <button className="danger-btn" onClick={handleDeleteLoad}>Delete Load</button>
                    </div>
                  </div>

                  {isEditing ? (
                    <form className="load-form" onSubmit={handleUpdateLoad}>
                      <select
                        name="customer"
                        value={editingLoad?.customer || ''}
                        onChange={handleEditInputChange}
                      >
                        <option value="">Select Customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.name}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                      
                      <input
  type="text"
  name="referenceNumber"
  placeholder="Broker Reference #"
  value={editingLoad?.referenceNumber || ''}
  onChange={handleEditInputChange}
/>
<div className="form-group">

  <input
  type="text"
  name="poNumber"
  placeholder="PO#"
  value={editingLoad?.poNumber || ''}
  onChange={handleEditInputChange}
/>

<input
  type="text"
  name="reservationNumber"
  placeholder="Reservation #"
  value={editingLoad.reservationNumber || ''}
  onChange={handleEditInputChange}
/>
<input
  type="text"
  name="returnNumber"
  placeholder="Return #"
  value={editingLoad.returnNumber || ''}
  onChange={handleEditInputChange}
/>

</div>
<div className="form-group">
  <label>Detention</label>
  <input
    type="text"
    name="detention"
    placeholder="Enter Detention"
    value={editingLoad?.detention || ''}
    onChange={handleEditInputChange}
  />
</div>

<select
  name="dropType"
  value={editingLoad.dropType || ''}
  onChange={handleEditInputChange}
>
  <option value="">Select Drop Type</option>
  <option value="Dropped at Customer">Dropped at Customer</option>
  <option value="Dropped at Yard">Dropped at Yard</option>
</select>

<input
  type="text"
  name="dropLocation"
  placeholder="Drop Location"
  value={editingLoad.dropLocation || ''}
  onChange={handleEditInputChange}
/>

<select
  name="droppedBy"
  value={editingLoad.droppedBy || ''}
  onChange={handleEditInputChange}
>
  <option value="">Select Dropped By</option>
  {driversList.map((d) => (
    <option key={d.id} value={d.id}>
      {d.id} - {d.name}
    </option>
  ))}
</select>

<input
  type="datetime-local"
  name="dropDateTime"
  value={editingLoad.dropDateTime || ''}
  onChange={handleEditInputChange}
/>

                      <input type="date" name="loadDate" value={editingLoad?.loadDate || ''} onChange={handleEditInputChange} />

                      <select name="driver" value={editingLoad?.driver || ''} onChange={handleEditInputChange}>
                        <option value="">Select Driver</option>
                        {driversList.map((d) => (
                          <option key={d.id} value={d.id}>
                           {d.id} - {d.name}
                          </option>
                        ))}
                      </select>

                      <input type="text" name="truck" placeholder="Truck" value={editingLoad.truck} onChange={handleEditInputChange} readOnly />
                      <input type="text" name="pickup" placeholder="Pickup" value={editingLoad.pickup} onChange={handleEditInputChange} />
                      <input type="text" name="delivery" placeholder="Delivery" value={editingLoad.delivery} onChange={handleEditInputChange} />
                      <label>Appointment Time</label>
                      <input
  type="datetime-local"
  name="appointmentTime"
  value={normalizeDateTimeInputValue(editingLoad?.appointmentTime)}
  onChange={handleEditInputChange}
/>

                      <label>ETA</label>
                      <input
  type="datetime-local"
  name="eta"
  value={normalizeDateTimeInputValue(editingLoad?.eta)}
  onChange={handleEditInputChange}
/>

                      <input type="text" name="returnLocation" placeholder="Return Location" value={editingLoad.returnLocation} onChange={handleEditInputChange} />
                      <select
  name="dropType"
  value={editingLoad.dropType || ''}
  onChange={handleEditInputChange}
>
  <option value="">Select Drop Type</option>
  <option value="Yard">Yard</option>
  <option value="Customer">Customer</option>
</select>
                      <input type="text" name="containerNumber" placeholder="Container Number" value={editingLoad.containerNumber} onChange={handleEditInputChange} />
                      <input type="text" name="bookingNumber" placeholder="Booking Number" value={editingLoad.bookingNumber || ''} onChange={handleEditInputChange} />
                      <select
  name="shipLine"
  value={editingLoad.shipLine || ''}
  onChange={handleEditInputChange}
>
  <option value="">🚢 Select Ship Line</option>
  {shipLineOptions.map((line) => (
    <option key={line} value={line}>
      {line}
    </option>
  ))}
</select>
                      <input type="text" name="chassisNumber" placeholder="Chassis Number" value={editingLoad.chassisNumber} onChange={handleEditInputChange} />
                      <input type="text" name="sealNumber" placeholder="Seal Number" value={editingLoad.sealNumber} onChange={handleEditInputChange} />
                      <input type="text" name="containerSize" placeholder="Container Size" value={editingLoad.containerSize} onChange={handleEditInputChange} />
                      <input type="text" name="rate" placeholder="Load Rate" value={editingLoad.rate} onChange={handleEditInputChange} />
                      <input type="text" name="driverRate" placeholder="Driver Rate" value={editingLoad.driverRate} onChange={handleEditInputChange} />

                      <select name="status" value={editingLoad.status} onChange={handleEditInputChange}>
                       <option value="Dispatched">Dispatched</option>
<option value="In Transit">In Transit</option>
<option value="Dropped">Dropped</option>
<option value="Delivered">Delivered</option>
                      </select>

                      <label>Availability</label>
<select
  name="availabilityStatus"
  value={editingLoad?.availabilityStatus || 'Available'}
  onChange={handleEditInputChange}
>
  <option value="Available">Available</option>
  <option value="Not Available">Not Available</option>
</select>

                      
                      <input type="text" name="detention" placeholder="Detention" value={editingLoad.detention} onChange={handleEditInputChange} />
                      <input type="text" name="lumper" placeholder="Lumper" value={editingLoad.lumper} onChange={handleEditInputChange} />
                      <input type="text" name="fuelAdvance" placeholder="Fuel Advance" value={editingLoad.fuelAdvance} onChange={handleEditInputChange} />
                      <input type="text" name="settlement" value={editingLoad.settlement} readOnly placeholder="Auto Settlement" />

                      <textarea name="notes" placeholder="Dispatcher Notes" value={editingLoad.notes} onChange={handleEditInputChange} rows="4" />

                      <label>LFD</label>
<input
  type="date"
  name="lastFreeDay"
  value={newLoad.lastFreeDay || ''}
  onChange={handleInputChange}
/>

                      <div className="form-actions">
                        <button type="submit" className="primary-btn">Save Changes</button>
                        <button type="button" className="secondary-btn" onClick={() => setIsEditing(false)}>Cancel</button>
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
                            <button type="button" className="primary-btn compact-btn" onClick={handleSaveDropDetails}>
                              Save Drop
                            </button>
                          </div>

                          <div className="drop-details-grid">
                            <label>
                              <span>Drop Type</span>
                              <select
                                value={selectedLoad.dropType || ''}
                                onChange={(e) =>
                                  setSelectedLoad((prev) => ({
                                    ...prev,
                                    dropType: e.target.value,
                                  }))
                                }
                              >
                                <option value="">Select Drop Type</option>
                                <option value="Customer">Customer</option>
                                <option value="Yard">Yard</option>
                              </select>
                            </label>
                            <label>
                              <span>Drop Location</span>
                              <input
                                type="text"
                                placeholder="Where was the container dropped?"
                                value={selectedLoad.dropLocation || ''}
                                onChange={(e) =>
                                  setSelectedLoad((prev) => ({
                                    ...prev,
                                    dropLocation: e.target.value,
                                  }))
                                }
                              />
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
                        <div className="detail-box">
  <span>Return #</span>
  <strong>{selectedLoad.returnNumber || '—'}</strong>
</div>
<div className="detail-box">
  <span>Reservation #</span>
  <strong>{selectedLoad.reservationNumber || '—'}</strong>
</div>
                        <div className="detail-box">
  <span>Driver</span>
  <strong>{getDriverLabel(selectedLoad.driver)}</strong>
</div>
                        <div className="detail-box"><span>Truck</span><strong>{selectedLoad.truck}</strong></div>
                        <div className="detail-box"><span>Availability</span><strong>{selectedLoad.availabilityStatus || 'Not Available'}</strong></div>
                        <div className="detail-box"><span>Pick Up Location</span><strong>{selectedLoad.pickup}</strong></div>
                        <div className="detail-box"><span>Delivery Location</span><strong>{selectedLoad.delivery}</strong></div>
                        <div className="detail-box"><span>Appointment</span><strong>{formatAppointmentTime(selectedLoad.appointmentTime)}</strong></div>
                        <div className="detail-box"><span>ETA</span><strong>{formatAppointmentTime(selectedLoad.eta)}</strong></div>
                        <div className="detail-box"><span>Return Location</span><strong>{selectedLoad.returnLocation}</strong></div>
                        <div className="detail-box">
  <span>Drop Type</span>
  <strong>{selectedLoad.dropType || '—'}</strong>
</div>

<div className="detail-box">
  <span>Drop Location</span>
  <strong>{selectedLoad.dropLocation || '—'}</strong>
</div>

<div className="detail-box">
  <span>Dropped By</span>
  <strong>
    {selectedLoad.droppedBy
      ? getDriverLabel(selectedLoad.droppedBy)
      : '—'}
  </strong>
</div>

<div className="detail-box">
  <span>Drop Date/Time</span>
  <strong>{formatDateTime(selectedLoad.dropDateTime)}</strong>
</div>
<div className="detail-box">
  <span>Current Pickup</span>
  <strong>{selectedLoad.pickup || '—'}</strong>
</div>
                        <div className="detail-box"><span>Container Number</span><strong>{selectedLoad.containerNumber}</strong></div>
                        <div className="detail-box"><span>Booking Number</span><strong>{selectedLoad.bookingNumber || '—'}</strong></div>
                        <div className="detail-box"><span>Chassis Number</span><strong>{selectedLoad.chassisNumber}</strong></div>
                        <div className="detail-box"><span>Seal Number</span><strong>{selectedLoad.sealNumber}</strong></div>
                        <div className="detail-box"><span>Container Size</span><strong>{selectedLoad.containerSize}</strong></div>
                        <div className="detail-box"><span>Load Rate</span><strong>{selectedLoad.rate}</strong></div>
                        <div className="detail-box"><span>Driver Rate</span><strong>{selectedLoad.driverRate}</strong></div>
                        <div className="detail-box"><span>Paperwork</span><strong>{selectedLoad.paperwork}</strong></div>
                        <div className="detail-box"><span>Ship Line</span><strong>{selectedLoad.shipLine}</strong></div>
                        <div className="detail-box"><span>Detention</span><strong>{selectedLoad.detention}</strong></div>
                        
                      </div>

                      <div className="settlement-box">
                        <h4>Settlement Breakdown</h4>
                        <div className="settlement-row"><span>Load Rate</span><strong>{selectedLoad.rate}</strong></div>
                        <div className="settlement-row"><span>Driver Rate</span><strong>{selectedLoad.driverRate}</strong></div>
                        <div className="settlement-row"><span>Detention</span><strong>{selectedLoad.detention}</strong></div>
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
                                <div className="detail-box">
                                  <span>Last Gate Move</span>
                                  <strong>{summary.lastGateMove?.eventTypeId || summary.lastGateMove?.eventStartTime || 'Not returned'}</strong>
                                </div>
                                <div className="detail-box">
                                  <span>Holds / Road Impediments</span>
                                  <strong>
                                    {Array.isArray(summary.roadImpediments)
                                      ? summary.roadImpediments.join(', ') || 'None returned'
                                      : String(summary.roadImpediments || 'None returned')}
                                  </strong>
                                </div>
                                <div className="detail-box"><span>OUT EIR</span><strong>{summary.outEir?.url ? <a href={summary.outEir.url} target="_blank" rel="noreferrer">Open</a> : 'Not available'}</strong></div>
                                <div className="detail-box"><span>IN EIR</span><strong>{summary.inEir?.url ? <a href={summary.inEir.url} target="_blank" rel="noreferrer">Open</a> : 'Not available'}</strong></div>
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
  onClick={async () => {
  try {
    const res = await fetch(
      `${API_BASE}/api/loads/${selectedLoad.id}/customer-packet`,
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

    window.open(url, '_blank');

    setTimeout(() => window.URL.revokeObjectURL(url), 5000);
  } catch (error) {
    console.error('Customer PDF error:', error);
    alert(`Failed to generate PDF: ${error.message}`);
  }
}}
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
              <span>Start Date</span>
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
              <span>End Date</span>
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
                      {load.loadDate || 'No date'} - {load.containerNumber || 'No container'} - {getDriverLabel(load.driver)} - {load.id}
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
                  <span>Detention</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={getSettlementPayValue(selectedSettlementLoad, 'detention')}
                    onChange={(e) =>
                      handleSettlementPayChange(selectedSettlementLoad.id, 'detention', e.target.value)
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
                  <th>Driver Rate</th>
                  <th>Detention</th>
                  <th>Lumper</th>
                  <th>Deductions</th>
                  <th>Total Settlement</th>
                </tr>
              </thead>
              <tbody>
                {settlementReport.map((item) => (
                  <tr key={item.driverId}>
                    <td>{item.driverId} - {item.driverName}</td>
                    <td>{item.loadsCount}</td>
                    <td>{item.totalDriverRate}</td>
                    <td>{item.totalDetention}</td>
                    <td>{item.totalLumper}</td>
                    <td>{item.totalFuelAdvance}</td>
                    <td>{item.totalSettlement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

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
                  <th>Detention</th>
                  <th>Lumper</th>
                  <th>Deductions</th>
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
                    return (
                      <tr key={load.id}>
                        <td>{load.loadDate || '-'}</td>
                        <td>{getDriverLabel(load.driver)}</td>
                        <td>
                          <strong>{load.id}</strong>
                          <span>{load.referenceNumber || load.bookingNumber || 'No reference'}</span>
                        </td>
                        <td>{load.customer || '-'}</td>
                        <td>{load.containerNumber || '-'}</td>
                        {['driverRate', 'detention', 'lumper', 'fuelAdvance'].map((field) => (
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
          placeholder="Driver ID (optional, auto-generated)"
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
      </div>
      <div className="company-profile">
        <div className="detail-box">
          <span>Company</span>
          <strong>{company?.name || 'PortFlow Dispatch'}</strong>
        </div>
        <div className="detail-box">
          <span>Account Email</span>
          <strong>{company?.email || currentUser?.email || 'Not available'}</strong>
        </div>
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
                {(filteredLoadsData || []).map((load) => (
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
              <button onClick={handleGeneratePOD} style={{ marginLeft: '10px' }}>
  Generate POD
</button>
<div style={{ marginTop: '20px' }}>
  <h3>Signature</h3>

  <SignatureCanvas
    ref={sigCanvas}
    penColor="black"
    canvasProps={{
      width: 400,
      height: 150,
      className: 'sigCanvas',
      style: { border: '1px solid #000' }
    }}
  />

  <div style={{ marginTop: '10px' }}>
    <button onClick={() => sigCanvas.current.clear()}>
      Clear
    </button>

<button
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
  style={{ marginLeft: '10px' }}
>
  Save Signature
</button>
  </div>
</div>

{selectedInvoiceLoad?.id && signatures[selectedInvoiceLoad.id] && (
  <div style={{ marginTop: '10px' }}>
    <p>Saved Signature:</p>
    <img
      src={signatures[selectedInvoiceLoad.id]}
      alt="signature"
      style={{ border: '1px solid #000', maxWidth: '400px' }}
    />
  </div>
)}
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
                <div>
                  <h2>INVOICE</h2>
                  <p>PortFlow Dispatch</p>
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
                  <p><strong>Delivery Location:</strong> {selectedInvoiceLoad.delivery}</p>
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
                      <td>{selectedInvoiceLoad.rate}</td>
                    </tr>
                    <tr className="invoice-total-row">
                      <td>Total Invoice</td>
                      <td>{selectedInvoiceLoad.rate}</td>
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

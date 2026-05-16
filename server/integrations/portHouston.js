const DEFAULT_FIELDS = [
  'extras.dwellDays',
  'scope.facility_id',
  'unitId',
  'eqtypeId',
  'isoGroup',
  'line',
  'category',
  'freightKind',
  'stopFlags',
  'impediments',
  'lastFreeDay',
  'ufvPosition',
  'timestamps.timeIn',
  'timestamps.timeOut',
].join(',');

const EQUIPMENT_HISTORY_FIELDS = [
  'eventTypeId',
  'created',
  'changed',
  'note',
].join(',');

const DEFAULT_API_BASE = 'https://api.america.naviscloudops.com/v3/evp';
const DEFAULT_AUTH_URL =
  'https://auth-v1.america.naviscloudops.com/auth/realms/phaprod/protocol/openid-connect/token';

const normalizeEnabled = (value) => String(value || '').trim().toLowerCase() === 'true';

const trimSlash = (value = '') => String(value).replace(/\/+$/, '');

const getConfig = (credentials = {}) => ({
  enabled:
    normalizeEnabled(process.env.PORT_HOUSTON_ENABLED) ||
    Boolean((credentials.clientId || credentials.username) && (credentials.clientSecret || credentials.password)),
  apiBase: trimSlash(process.env.PORT_HOUSTON_API_BASE || DEFAULT_API_BASE),
  authUrl: process.env.PORT_HOUSTON_AUTH_URL || DEFAULT_AUTH_URL,
  apiKey: process.env.PORT_HOUSTON_API_KEY || '',
  clientId:
    credentials.clientId ||
    credentials.username ||
    process.env.PORT_HOUSTON_CLIENT_ID ||
    process.env.PORT_HOUSTON_USERNAME ||
    '',
  clientSecret:
    credentials.clientSecret ||
    credentials.password ||
    process.env.PORT_HOUSTON_CLIENT_SECRET ||
    process.env.PORT_HOUSTON_API_KEY ||
    process.env.PORT_HOUSTON_PASSWORD ||
    '',
});

const assertConfigured = (config) => {
  if (!config.enabled) {
    const error = new Error('Port Houston integration is disabled. Set PORT_HOUSTON_ENABLED=true after API access is approved.');
    error.status = 503;
    error.code = 'PORT_HOUSTON_DISABLED';
    throw error;
  }

  if (!config.clientId || !config.clientSecret) {
    const error = new Error('Port Houston credentials are required. Add API credentials from Port Houston Data Integration.');
    error.status = 503;
    error.code = 'PORT_HOUSTON_NOT_CONFIGURED';
    throw error;
  }
};

const requestToken = async (config) => {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const res = await fetch(config.authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    const error = new Error(data.error_description || data.error || 'Failed to authenticate with Port Houston API.');
    error.status = res.status || 502;
    error.response = data;
    throw error;
  }

  return data.access_token;
};

const portHoustonFetch = async (path, query = {}, credentials = {}) => {
  const config = getConfig(credentials);
  assertConfigured(config);

  const token = await requestToken(config);
  const url = new URL(`${config.apiBase}${path}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, value);
    }
  });

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json().catch(() => ({}))
    : await res.text();

  if (!res.ok) {
    const error = new Error(typeof data === 'object' ? data.error || 'Port Houston API request failed.' : data || 'Port Houston API request failed.');
    error.status = res.status || 502;
    error.response = data;
    throw error;
  }

  return data;
};

const unwrapRecords = (response) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.results)) return response.results;
  if (Array.isArray(response?.units)) return response.units;
  return response ? [response] : [];
};

const getFirstValue = (record, keys) => {
  for (const key of keys) {
    const value = key.split('.').reduce((current, part) => current?.[part], record);
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};

const normalizeAvailability = (response) => {
  const records = unwrapRecords(response);
  const unit = records[0] || {};
  const impediments = getFirstValue(unit, ['impediments', 'roadImpediments', 'stopFlags']) || [];

  return {
    available: records.length > 0 && (!Array.isArray(impediments) || impediments.length === 0),
    terminal: getFirstValue(unit, ['scope.facility_id', 'facility', 'facilityId', 'terminal']),
    roadImpediments: impediments,
    lastFreeDay: getFirstValue(unit, ['lastFreeDay', 'lfd']),
    raw: response,
  };
};

export const getContainerAvailability = async (containerNumber, credentials = {}) => {
  const response = await portHoustonFetch('/inventory/units/', {
    operator: 'POHA',
    predicate: `unitId = ${containerNumber}`,
    fields: DEFAULT_FIELDS,
  }, credentials);

  return normalizeAvailability(response);
};

export const getBolAvailability = async (bolNumber, credentials = {}) => {
  const response = await portHoustonFetch('/inventory/units', {
    operator: 'POHA',
    predicate: `category = IMPRT and blNbr = ${bolNumber}`,
    fields: DEFAULT_FIELDS,
  }, credentials);

  return {
    containers: unwrapRecords(response).map((record) => normalizeAvailability(record)),
    raw: response,
  };
};

export const getGateHistory = async (containerNumber, credentials = {}) => {
  // Port Houston docs map container movement history to GetEquipmentHistory:
  // GET /service/events?predicate=appliedToNaturalKey = <container>.
  // GetGateTransactions exists for transaction number lookup; container lookup should
  // use equipment history unless Port Houston grants a container-based gate endpoint.
  const response = await portHoustonFetch('/service/events', {
    operator: 'POHA',
    facility: 'BPT',
    predicate: `appliedToNaturalKey = ${containerNumber}`,
    fields: EQUIPMENT_HISTORY_FIELDS,
  }, credentials);

  const events = unwrapRecords(response);
  return {
    events,
    lastGateMove: events[0] || null,
    raw: response,
  };
};

export const isPortHoustonConfigured = () => {
  try {
    assertConfigured(getConfig());
    return true;
  } catch {
    return false;
  }
};

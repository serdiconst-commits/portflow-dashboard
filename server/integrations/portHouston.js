const DEFAULT_FIELDS = [
  'extras.dwellDays',
  'scope.facility_id',
  'unitId',
  'eqtypeId',
  'isoGroup',
  'line',
  'lineId',
  'category',
  'freightKind',
  'blNbr',
  'sealNbr1',
  'transitState',
  'stoppedRoad',
  'routing.pod1Id',
  'stopFlags',
  'impediments',
  'lastFreeDay',
  'lineLastFreeDay',
  'timeIn',
  'timeOut',
  'ufvPosition',
  'timestamps.timeIn',
  'timestamps.timeOut',
].join(',');

const EQUIPMENT_HISTORY_FIELDS = [
  'eventTypeId',
  'created',
  'changed',
  'note',
  'appliedToNaturalKey',
  'appliedToPrimaryKey',
  'relatedEntityId',
  'relatedBatchNbr',
  'primaryEventGkey',
].join(',');

const GATE_TRANSACTION_FIELDS = [
  'gkey',
  'facility_id',
  'nbr',
  'subType',
  'status',
  'stageId',
  'handled',
  'created',
  'changed',
  'truckLicenseNbr',
  'trkcoId',
  'ctrId',
  'unitId',
  'lineId',
  'ctrTypeId',
  'eqoEqIsoGroup',
  'eqoEqLength',
  'eqoEqHeight',
  'chsId',
  'chsIsOwners',
  'eqoNbr',
  'blNbr',
  'sealNbr1',
  'ctrTicketPosId',
  'scaleWeight',
  'ctrGrossWeight',
  'hasDocuments',
  'scope.facility_id',
].join(',');

const EQUIPMENT_OWNERSHIP_FIELDS = [
  'unitId',
  'eqOperatorId',
  'eqOwnerId',
  'line',
  'lineId',
].join(',');

const ASSOCIATED_EQUIPMENT_FIELDS = [
  'eqClass',
  'unitId',
  'nominalLength',
  'isoGroup',
  'nominalHeight',
  'eqtypeId',
  'lastKnownPosition.posName',
  'freightKind',
  'category',
].join(',');

const DEFAULT_API_BASE = 'https://api.america.naviscloudops.com/v3/evp';
const DEFAULT_AUTH_URL =
  'https://auth-v1.america.naviscloudops.com/auth/realms/phaprod/protocol/openid-connect/token';

const normalizeEnabled = (value) => String(value || '').trim().toLowerCase() === 'true';

const trimSlash = (value = '') => String(value).replace(/\/+$/, '');

const normalizeCredentialValue = (value = '') => {
  const trimmed = String(value || '').trim();
  const quoteMatch = trimmed.match(/^(['"])(.*)\1$/);
  return quoteMatch ? quoteMatch[2].trim() : trimmed;
};

export const getPortHoustonFacilityCode = (terminal = '') => {
  const normalized = String(terminal || '').toLowerCase();
  if (normalized.includes('barbours') || normalized.includes('barbour') || normalized.includes('bct')) {
    return 'BCT';
  }
  if (normalized.includes('bayport') || normalized.includes('bpt')) {
    return 'BPT';
  }
  return '';
};

const maskValue = (value = '') => {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 3)}...${text.slice(-3)}`;
};

const getCredentialParts = (credentials = {}) => {
  const rawEnvClientId = process.env.PORT_HOUSTON_CLIENT_ID || process.env.PORT_HOUSTON_USERNAME || '';
  const rawEnvClientSecret =
    process.env.PORT_HOUSTON_CLIENT_SECRET ||
    process.env.PORT_HOUSTON_API_KEY ||
    process.env.PORT_HOUSTON_PASSWORD ||
    '';
  const envClientId = normalizeCredentialValue(rawEnvClientId);
  const envClientSecret =
    normalizeCredentialValue(rawEnvClientSecret);
  const credentialClientId = normalizeCredentialValue(credentials.clientId || credentials.username || '');
  const credentialClientSecret = normalizeCredentialValue(credentials.clientSecret || credentials.password || '');

  return {
    envClientId,
    envClientSecret,
    credentialClientId,
    credentialClientSecret,
  };
};

const buildConfig = ({ clientId, clientSecret, source }) => ({
  enabled:
    normalizeEnabled(process.env.PORT_HOUSTON_ENABLED) ||
    Boolean(clientId && clientSecret),
  apiBase: trimSlash(process.env.PORT_HOUSTON_API_BASE || DEFAULT_API_BASE),
  authUrl: process.env.PORT_HOUSTON_AUTH_URL || DEFAULT_AUTH_URL,
  apiKey: process.env.PORT_HOUSTON_API_KEY || '',
  clientId,
  clientSecret,
  diagnostics: {
    clientId: maskValue(clientId),
    clientIdSource: source,
    clientSecretSource: source,
    clientSecretLength: String(clientSecret || '').length,
  },
});

const getConfig = (credentials = {}) => {
  const {
    envClientId,
    envClientSecret,
    credentialClientId,
    credentialClientSecret,
  } = getCredentialParts(credentials);
  const clientId = credentialClientId || envClientId;
  const clientSecret = credentialClientSecret || envClientSecret;

  return buildConfig({
    clientId,
    clientSecret,
    source: credentialClientId ? 'terminal credentials' : envClientId ? 'Render environment' : 'missing',
  });
};

const getConfigCandidates = (credentials = {}) => {
  const {
    envClientId,
    envClientSecret,
    credentialClientId,
    credentialClientSecret,
  } = getCredentialParts(credentials);

  const candidates = [];
  if (credentialClientId && credentialClientSecret) {
    candidates.push(buildConfig({
      clientId: credentialClientId,
      clientSecret: credentialClientSecret,
      source: 'terminal credentials',
    }));
  }

  const envIsDifferent =
    envClientId &&
    envClientSecret &&
    (envClientId !== credentialClientId || envClientSecret !== credentialClientSecret);

  if (envIsDifferent || (!credentialClientId && envClientId && envClientSecret)) {
    candidates.push(buildConfig({
      clientId: envClientId,
      clientSecret: envClientSecret,
      source: 'Render environment',
    }));
  }

  return candidates.length ? candidates : [getConfig(credentials)];
};

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

const requestTokenWithBodyCredentials = async (config) => {
  const res = await fetch(config.authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  const data = await res.json().catch(() => ({}));

  return { res, data, authMethod: 'form body' };
};

const requestTokenWithBasicAuth = async (config) => {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const res = await fetch(config.authUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    }),
  });

  const data = await res.json().catch(() => ({}));

  return { res, data, authMethod: 'basic auth' };
};

const requestToken = async (config) => {
  const attempts = [
    await requestTokenWithBodyCredentials(config),
  ];

  if (!attempts[0].res.ok || !attempts[0].data.access_token) {
    attempts.push(await requestTokenWithBasicAuth(config));
  }

  const successfulAttempt = attempts.find((attempt) => attempt.res.ok && attempt.data.access_token);
  if (successfulAttempt) {
    return successfulAttempt.data.access_token;
  }

  const lastAttempt = attempts.at(-1);
  const error = new Error(
    lastAttempt.data.error_description ||
      lastAttempt.data.error ||
      'Failed to authenticate with Port Houston API.'
  );
  error.status = lastAttempt.res.status || 502;
  error.response = lastAttempt.data;
  error.diagnostics = {
    ...config.diagnostics,
    authMethodsTried: attempts.map((attempt) => attempt.authMethod).join(', '),
    authAttempts: attempts.map((attempt) => ({
      method: attempt.authMethod,
      status: attempt.res.status,
      error: attempt.data?.error || '',
      errorDescription: attempt.data?.error_description || '',
    })),
  };
  throw error;
};

const portHoustonFetch = async (path, query = {}, credentials = {}) => {
  const configs = getConfigCandidates(credentials);
  let token = '';
  let config = null;
  const authErrors = [];

  for (const candidate of configs) {
    try {
      assertConfigured(candidate);
      token = await requestToken(candidate);
      config = candidate;
      break;
    } catch (error) {
      authErrors.push(error);
      if (error.status !== 401) {
        throw error;
      }
    }
  }

  if (!config || !token) {
    const lastError = authErrors.at(-1) || new Error('Failed to authenticate with Port Houston API.');
    if (authErrors.length > 1) {
      lastError.diagnostics = {
        ...(lastError.diagnostics || {}),
        credentialSourcesTried: authErrors.map((error) => error.diagnostics?.clientIdSource || 'unknown'),
        authErrors: authErrors.map((error) => ({
          source: error.diagnostics?.clientIdSource || 'unknown',
          status: error.status || '',
          message: error.message,
          authMethodsTried: error.diagnostics?.authMethodsTried || '',
        })),
      };
    }
    throw lastError;
  }
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

const portHoustonFetchBuffer = async (path, query = {}, credentials = {}) => {
  const configs = getConfigCandidates(credentials);
  let token = '';
  let config = null;
  const authErrors = [];

  for (const candidate of configs) {
    try {
      assertConfigured(candidate);
      token = await requestToken(candidate);
      config = candidate;
      break;
    } catch (error) {
      authErrors.push(error);
      if (error.status !== 401) {
        throw error;
      }
    }
  }

  if (!config || !token) {
    throw authErrors.at(-1) || new Error('Failed to authenticate with Port Houston API.');
  }

  const url = /^https?:\/\//i.test(String(path))
    ? new URL(path)
    : new URL(`${config.apiBase}${path}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, value);
    }
  });

  const res = await fetch(url, {
    headers: {
      Accept: 'application/pdf,image/*,application/octet-stream,*/*',
      Authorization: `Bearer ${token}`,
    },
  });

  const contentType = res.headers.get('content-type') || 'application/pdf';
  const buffer = Buffer.from(await res.arrayBuffer());

  if (!res.ok) {
    const bodyText = buffer.toString('utf8').slice(0, 500);
    const error = new Error(bodyText || 'Port Houston document download failed.');
    error.status = res.status || 502;
    error.response = bodyText;
    throw error;
  }

  if (contentType.includes('application/json')) {
    const bodyText = buffer.toString('utf8');
    const error = new Error(`Port Houston document endpoint returned JSON instead of a document: ${bodyText.slice(0, 300)}`);
    error.status = 502;
    error.response = bodyText;
    throw error;
  }

  return { buffer, contentType };
};

const unwrapRecords = (response) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.content)) return response.content;
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

const normalizeBoolean = (value) => {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const normalized = String(value || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return null;
};

const formatImpediment = (value) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatImpediment).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    const preferredKeys = [
      'impedimentRoad',
      'impedimentRail',
      'impedimentVessel',
      'remark',
      'description',
      'message',
      'reason',
      'hold',
      'holdId',
      'type',
      'code',
      'name',
    ];
    const parts = preferredKeys
      .map((key) => value?.[key])
      .filter((item) => item !== undefined && item !== null && String(item).trim() !== '')
      .map(formatImpediment)
      .filter(Boolean);
    if (parts.length) return parts.join(' - ');

    return Object.entries(value)
      .map(([key, child]) => {
        const formatted = formatImpediment(child);
        return formatted ? `${key}: ${formatted}` : '';
      })
      .filter(Boolean)
      .join(', ');
  }
  return String(value);
};

const normalizeImpediments = (value) => {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.map(formatImpediment).filter(Boolean);
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, child]) => {
        const formatted = formatImpediment(child);
        return formatted ? `${key}: ${formatted}` : '';
      })
      .filter(Boolean);
  }
  return [String(value)].filter(Boolean);
};

const normalizeContainerSizeCode = (value = '') => {
  const raw = String(value || '').trim();
  const normalized = raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const sizeMap = {
    '45G1': '40 HC',
    '42G1': '40 ST',
    '22G1': '20 ST',
    '45RT': '40 RF',
    '40HC': '40 HC',
    '40HQ': '40 HC',
    '40ST': '40 ST',
    '20ST': '20 ST',
    '40RF': '40 RF',
  };

  return sizeMap[normalized] || raw;
};

const normalizeAvailability = (response) => {
  const records = unwrapRecords(response);
  const unit = records[0] || {};
  const found = records.length > 0 && Object.keys(unit).length > 0;
  const transitState = String(getFirstValue(unit, ['transitState']) || '').trim().toUpperCase();
  const stoppedRoad = normalizeBoolean(getFirstValue(unit, ['stoppedRoad']));
  const impediments = normalizeImpediments(getFirstValue(unit, ['impediments', 'roadImpediments', 'stopFlags']));
  const available = found && transitState === 'S40_YARD' && stoppedRoad !== true;
  const statusReason = !found
    ? 'Container not found in Port Houston response.'
    : available
      ? 'Container is in yard and has no active road hold.'
      : stoppedRoad
        ? 'Container has an active road hold.'
        : transitState
          ? `Container transit state is ${transitState}, not S40_YARD.`
          : 'Container transit state was not returned by Port Houston.';

  return {
    found,
    available,
    statusReason,
    transitState,
    stoppedRoad,
    terminal: getFirstValue(unit, ['scope.facility_id', 'facility', 'facilityId', 'terminal', 'routing.pod1Id']),
    roadImpediments: impediments,
    lastFreeDay: getFirstValue(unit, ['lastFreeDay', 'lineLastFreeDay', 'lfd']),
    containerNumber: getFirstValue(unit, ['unitId', 'ctrId', 'containerNumber']),
    containerSize: normalizeContainerSizeCode(getFirstValue(unit, ['eqtypeId', 'ctrTypeId', 'equipmentType', 'isoGroup'])),
    shipLine: getFirstValue(unit, ['lineId', 'line', 'shippingLine', 'operator', 'scope.operator_id']),
    bookingNumber: getFirstValue(unit, ['eqoNbr', 'bookingNumber', 'bookingNbr', 'blNbr']),
    billOfLading: getFirstValue(unit, ['blNbr']),
    sealNumber: getFirstValue(unit, ['sealNbr1', 'sealNumber', 'seal1']),
    vesselName: getFirstValue(unit, ['vesselName', 'vessel', 'visit.vesselName', 'carrierVisit.vesselName']),
    timeIn: getFirstValue(unit, ['timeIn', 'timestamps.timeIn']),
    timeOut: getFirstValue(unit, ['timeOut', 'timestamps.timeOut']),
    raw: response,
  };
};

const normalizeGateTransaction = (record = {}) => ({
  gkey: getFirstValue(record, ['gkey']),
  nbr: getFirstValue(record, ['nbr']),
  subType: String(getFirstValue(record, ['subType']) || '').trim().toUpperCase(),
  eirType: String(getFirstValue(record, ['subType']) || '').trim().toUpperCase() === 'RI'
    ? 'IN EIR'
    : String(getFirstValue(record, ['subType']) || '').trim().toUpperCase() === 'RO'
      ? 'OUT EIR'
      : '',
  status: getFirstValue(record, ['status']),
  stageId: getFirstValue(record, ['stageId']),
  handled: getFirstValue(record, ['handled']),
  created: getFirstValue(record, ['created']),
  changed: getFirstValue(record, ['changed']),
  truckLicenseNbr: getFirstValue(record, ['truckLicenseNbr']),
  truckingCompany: getFirstValue(record, ['trkcoId']),
  containerNumber: getFirstValue(record, ['ctrId', 'unitId']),
  shipLine: getFirstValue(record, ['lineId']),
  containerSize: normalizeContainerSizeCode(getFirstValue(record, ['ctrTypeId', 'eqoEqIsoGroup'])),
  containerType: getFirstValue(record, ['ctrTypeId']),
  equipmentIsoGroup: getFirstValue(record, ['eqoEqIsoGroup']),
  equipmentLength: getFirstValue(record, ['eqoEqLength']),
  equipmentHeight: getFirstValue(record, ['eqoEqHeight']),
  chassisNumber: getFirstValue(record, ['chsId']),
  chassisIsOwner: getFirstValue(record, ['chsIsOwners']),
  bookingNumber: getFirstValue(record, ['eqoNbr']),
  billOfLading: getFirstValue(record, ['blNbr']),
  sealNumber: getFirstValue(record, ['sealNbr1']),
  ticketPosition: getFirstValue(record, ['ctrTicketPosId']),
  scaleWeight: getFirstValue(record, ['scaleWeight']),
  containerGrossWeight: getFirstValue(record, ['ctrGrossWeight']),
  hasDocuments: normalizeBoolean(getFirstValue(record, ['hasDocuments'])),
  terminal: getFirstValue(record, ['facility_id', 'scope.facility_id', 'facility', 'facilityId', 'terminalId']),
  raw: record,
});

const sortGateTransactions = (transactions = []) =>
  [...transactions].sort((a, b) => {
    const bTime = Date.parse(b.handled || b.changed || b.created || '') || 0;
    const aTime = Date.parse(a.handled || a.changed || a.created || '') || 0;
    return bTime - aTime;
  });

const extractTransactionNumbersFromText = (value = '') => {
  const text = String(value || '');
  const matches = [...text.matchAll(/(?:nbr|transaction|transnbr|gate transaction|eir)\D{0,24}(\d{5,})/gi)];
  return matches.map((match) => match[1]).filter(Boolean);
};

export const extractGateTransactionNumbersFromHistory = (gateHistory = {}) => {
  const events = Array.isArray(gateHistory?.events) ? gateHistory.events : [];
  return [...new Set(events.flatMap((event) => [
    ...extractTransactionNumbersFromText(event.note),
    ...extractTransactionNumbersFromText(event.eventTypeId),
    ...extractTransactionNumbersFromText(event.relatedEntityId),
  ]))];
};

export const getContainerAvailability = async (containerNumber, credentials = {}, facility = '') => {
  const response = await portHoustonFetch('/inventory/units/', {
    operator: 'POHA',
    facility: getPortHoustonFacilityCode(facility) || String(facility || '').trim().toUpperCase(),
    predicate: `unitId = ${containerNumber}`,
    fields: DEFAULT_FIELDS,
  }, credentials);

  return normalizeAvailability(response);
};

export const getBolAvailability = async (bolNumber, credentials = {}, facility = '') => {
  const response = await portHoustonFetch('/inventory/units', {
    operator: 'POHA',
    facility: getPortHoustonFacilityCode(facility) || String(facility || '').trim().toUpperCase(),
    predicate: `category = IMPRT and blNbr = ${bolNumber}`,
    fields: DEFAULT_FIELDS,
  }, credentials);

  return {
    containers: unwrapRecords(response).map((record) => normalizeAvailability(record)),
    raw: response,
  };
};

export const getEquipmentOwnership = async (containerNumber, credentials = {}, facility = '') => {
  const response = await portHoustonFetch('/inventory/units', {
    operator: 'POHA',
    facility: getPortHoustonFacilityCode(facility) || String(facility || '').trim().toUpperCase(),
    predicate: `unitId = ${containerNumber}`,
    fields: EQUIPMENT_OWNERSHIP_FIELDS,
  }, credentials);

  const record = unwrapRecords(response)[0] || {};
  return {
    containerNumber: getFirstValue(record, ['unitId']),
    equipmentOperator: getFirstValue(record, ['eqOperatorId', 'lineId', 'line']),
    equipmentOwner: getFirstValue(record, ['eqOwnerId', 'lineId', 'line']),
    raw: response,
  };
};

export const getAssociatedEquipment = async (bookingNumber, credentials = {}, facility = '') => {
  const response = await portHoustonFetch('/inventory/units', {
    operator: 'POHA',
    facility: getPortHoustonFacilityCode(facility) || String(facility || '').trim().toUpperCase(),
    predicate: `departOrderNbr = ${bookingNumber}`,
    fields: ASSOCIATED_EQUIPMENT_FIELDS,
  }, credentials);

  return {
    containers: unwrapRecords(response).map((record) => ({
      containerNumber: getFirstValue(record, ['unitId']),
      containerSize: normalizeContainerSizeCode(getFirstValue(record, ['eqtypeId', 'isoGroup'])),
      equipmentClass: getFirstValue(record, ['eqClass']),
      freightKind: getFirstValue(record, ['freightKind']),
      category: getFirstValue(record, ['category']),
      position: getFirstValue(record, ['lastKnownPosition.posName']),
      raw: record,
    })),
    raw: response,
  };
};

export const getGateHistory = async (containerNumber, credentials = {}, facility = '') => {
  // Port Houston docs map container movement history to GetEquipmentHistory:
  // GET /service/events?predicate=appliedToNaturalKey = <container>.
  // EIR-style gate data is pulled separately from GetGateTransactions by ctrId.
  // BCT and BPT use the same connection; omit facility to search all terminals.
  const response = await portHoustonFetch('/service/events', {
    operator: 'POHA',
    facility: getPortHoustonFacilityCode(facility) || String(facility || '').trim().toUpperCase(),
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

export const getGateTransactionByNumber = async (transactionNumber, credentials = {}, facility = '') => {
  const cleanNumber = String(transactionNumber || '').trim();
  const response = await portHoustonFetch('/road/gatetransactions', {
    operator: 'POHA',
    facility: getPortHoustonFacilityCode(facility) || String(facility || '').trim().toUpperCase(),
    predicate: `nbr = ${cleanNumber}`,
    fields: GATE_TRANSACTION_FIELDS,
  }, credentials);

  return sortGateTransactions(unwrapRecords(response).map(normalizeGateTransaction));
};

export const getGateTransactionsByContainer = async (containerNumber, credentials = {}, facility = '') => {
  const cleanContainer = String(containerNumber || '').trim().toUpperCase();
  if (!cleanContainer) {
    return {
      transactions: [],
      outEirTransaction: null,
      inEirTransaction: null,
      lookupMethod: '',
      requestedContainerNumber: '',
      errors: [],
      raw: [],
    };
  }

  const response = await portHoustonFetch('/road/gatetransactions', {
    operator: 'POHA',
    facility: getPortHoustonFacilityCode(facility) || String(facility || '').trim().toUpperCase(),
    predicate: `ctrId = ${cleanContainer}`,
    fields: GATE_TRANSACTION_FIELDS,
  }, credentials);

  const sortedTransactions = sortGateTransactions(unwrapRecords(response).map(normalizeGateTransaction));

  return {
    transactions: sortedTransactions,
    outEirTransaction: sortedTransactions.find((item) =>
      ['RO', 'RM', 'DM', 'DI', 'DE'].includes(item.subType) && item.hasDocuments === true
    ) || sortedTransactions.find((item) => ['RO', 'RM', 'DM', 'DI', 'DE'].includes(item.subType)) || null,
    inEirTransaction: sortedTransactions.find((item) =>
      ['RI', 'RE', 'RC', 'RB'].includes(item.subType) && item.hasDocuments === true
    ) || sortedTransactions.find((item) => ['RI', 'RE', 'RC', 'RB'].includes(item.subType)) || null,
    lookupMethod: 'ctrId',
    requestedContainerNumber: cleanContainer,
    errors: [],
    raw: sortedTransactions.map((item) => item.raw),
  };
};

export const getGateTransactionsByNumbers = async (transactionNumbers = [], credentials = {}, facility = '') => {
  const uniqueNumbers = [...new Set(transactionNumbers.map((item) => String(item || '').trim()).filter(Boolean))];
  const transactions = [];
  const errors = [];
  for (const transactionNumber of uniqueNumbers) {
    try {
      transactions.push(...await getGateTransactionByNumber(transactionNumber, credentials, facility));
    } catch (error) {
      errors.push({
        nbr: transactionNumber,
        message: error.message,
        status: error.status || '',
      });
    }
  }

  const sortedTransactions = sortGateTransactions(transactions);

  return {
    transactions: sortedTransactions,
    outEirTransaction: sortedTransactions.find((item) =>
      ['RO', 'RM', 'DM', 'DI', 'DE'].includes(item.subType) && item.hasDocuments === true
    ) || null,
    inEirTransaction: sortedTransactions.find((item) =>
      ['RI', 'RE', 'RC', 'RB'].includes(item.subType) && item.hasDocuments === true
    ) || null,
    lookupMethod: uniqueNumbers.length ? 'nbr' : '',
    requestedTransactionNumbers: uniqueNumbers,
    errors,
    raw: sortedTransactions.map((item) => item.raw),
  };
};

export const downloadGateTransactionDocument = async (transactionId, credentials = {}) => {
  const cleanId = String(transactionId || '').trim();
  if (!cleanId) {
    throw new Error('Gate transaction number is required to download EIR.');
  }

  const pattern = process.env.PORT_HOUSTON_EIR_DOCUMENT_URL_PATTERN || '';
  const endpoint = pattern
    ? pattern.replaceAll('{id}', encodeURIComponent(cleanId))
    : `/road/gatetransactions/${encodeURIComponent(cleanId)}/documents`;

  return portHoustonFetchBuffer(endpoint, {}, credentials);
};

export const isPortHoustonConfigured = () => {
  try {
    assertConfigured(getConfig());
    return true;
  } catch {
    return false;
  }
};

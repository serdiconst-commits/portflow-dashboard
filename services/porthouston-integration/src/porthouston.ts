import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  Method,
} from "axios";
import { AppointmentPayload, JsonObject, TokenState } from "./types.js";
import type {
  PortHoustonSubscriptionPayload,
  RetrievedEirDocument,
} from "./types.js";
import { getEirCategoryFromSubType } from "./tms.js";

const DEFAULT_API_BASE_URL = "https://api.america.naviscloudops.com/v3/";
const TOKEN_REFRESH_SAFETY_MS = 60_000;
const REQUEST_RETRY_COUNT = 2;

const getEnv = (key: string, fallback = "") => process.env[key] || fallback;
const normalizeCredentialValue = (value = "") => {
  const trimmed = String(value || "").trim();
  const quoteMatch = trimmed.match(/^(['"])(.*)\1$/);
  return quoteMatch ? quoteMatch[2].trim() : trimmed;
};

const normalizeBaseUrl = (url: string) => (url.endsWith("/") ? url : `${url}/`);

const normalizeFacility = (facility = "") => {
  const normalized = facility.trim().toUpperCase();
  if (normalized === "BCT" || normalized === "BPT") return normalized;
  return normalized;
};

const withOptionalFacility = (params: Record<string, string>) => {
  const facility = normalizeFacility(params.facility || "");
  const nextParams = { ...params };
  delete nextParams.facility;
  return facility ? { facility, ...nextParams } : nextParams;
};

const evpPath = (path: string) => `evp/${path.replace(/^\/+/, "")}`;

const apiBaseUrl = normalizeBaseUrl(
  getEnv("PORT_HOUSTON_API_BASE_URL", DEFAULT_API_BASE_URL),
);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getDefaultAuthUrl = () => new URL("oauth/token", apiBaseUrl).toString();

const client: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  timeout: 30_000,
  headers: {
    Accept: "application/json",
  },
});

let tokenState: TokenState | null = null;

const getCredentials = () => {
  const clientId = normalizeCredentialValue(getEnv("PORT_HOUSTON_CLIENT_ID"));
  const clientSecret = normalizeCredentialValue(
    getEnv("PORT_HOUSTON_CLIENT_SECRET"),
  );

  if (!clientId || !clientSecret) {
    throw new Error(
      "PORT_HOUSTON_CLIENT_ID and PORT_HOUSTON_CLIENT_SECRET are required.",
    );
  }

  return { clientId, clientSecret };
};

const parseExpiresIn = (value: unknown) => {
  const seconds = Number(value || 3600);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
};

const getAccessTokenFromResponse = (data: JsonObject) => {
  const token = data.access_token || data.accessToken || data.token;
  if (!token || typeof token !== "string") {
    throw new Error(
      "Port Houston token response did not include an access token.",
    );
  }
  return token;
};

export async function authenticate(forceRefresh = false): Promise<string> {
  if (
    !forceRefresh &&
    tokenState &&
    Date.now() < tokenState.expiresAt - TOKEN_REFRESH_SAFETY_MS
  ) {
    return tokenState.accessToken;
  }

  const { clientId, clientSecret } = getCredentials();
  const authUrl = getEnv("PORT_HOUSTON_AUTH_URL", getDefaultAuthUrl());
  const attempts: Array<{
    method: string;
    headers: Record<string, string>;
    body: URLSearchParams;
  }> = [
    {
      method: "form body",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
    {
      method: "basic auth",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    },
  ];

  const failures = [];
  for (const attempt of attempts) {
    const response = await fetch(authUrl, {
      method: "POST",
      headers: { Accept: "application/json", ...attempt.headers },
      body: attempt.body,
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await response.json().catch(() => ({}))) as JsonObject;
    if (response.ok && data.access_token) {
      const accessToken = getAccessTokenFromResponse(data);
      const expiresIn = parseExpiresIn(data.expires_in);
      tokenState = {
        accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
      };
      return accessToken;
    }
    failures.push({
      method: attempt.method,
      status: response.status,
      error: String(data.error || ""),
    });
  }

  throw new Error(
    `Port Houston authentication failed: ${JSON.stringify(failures)}`,
  );
}

const requestPortHouston = async <T = unknown>(
  method: Method,
  endpoint: string,
  options: AxiosRequestConfig = {},
): Promise<T> => {
  const token = await authenticate();

  for (let attempt = 0; attempt <= REQUEST_RETRY_COUNT; attempt += 1) {
    try {
      const response = await client.request<T>({
        method,
        url: endpoint,
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${attempt === 0 ? token : await authenticate(attempt > 0)}`,
        },
      });

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<JsonObject>;
      const canRetry =
        axiosError.response?.status === 401 ||
        axiosError.response?.status === 429 ||
        (axiosError.response?.status !== undefined &&
          axiosError.response.status >= 500) ||
        !axiosError.response;

      if (attempt < REQUEST_RETRY_COUNT && canRetry) {
        if (axiosError.response?.status === 401) {
          await authenticate(true);
        }
        await wait(300 * (attempt + 1));
        continue;
      }

      const details = axiosError.response?.data
        ? JSON.stringify(axiosError.response.data)
        : axiosError.message;
      throw new Error(`Port Houston API request failed: ${details}`);
    }
  }

  throw new Error("Port Houston API request failed.");
};

const requestPortHoustonBuffer = async (
  endpoint: string,
  options: AxiosRequestConfig = {},
): Promise<{ data: Buffer; contentType: string }> => {
  const token = await authenticate();
  const response = await client.request<ArrayBuffer>({
    method: "GET",
    url: endpoint,
    ...options,
    responseType: "arraybuffer",
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  return {
    data: Buffer.from(response.data),
    contentType: String(response.headers["content-type"] || "application/pdf"),
  };
};

export const getVesselSchedule = (fromDate: string, toDate: string) =>
  requestPortHouston("GET", evpPath("vessel/vesselvisits"), {
    params: {
      operator: "POHA",
      predicate: `eta >= ${fromDate}T00:00:00.000Z and etd <= ${toDate}T00:00:00.000Z`,
      fields: "vesId,vesName,reeferCutoff,cargoCutoff,hazCutoff",
      size: "100",
    },
  });

export const getAvailableContainers = (unitId: string) =>
  requestPortHouston("GET", evpPath("inventory/units/"), {
    params: {
      operator: "POHA",
      predicate: `unitId = ${unitId}`,
      fields:
        "extras.dwellDays,scope.facility_id,unitId,eqtypeId,isoGroup,line,category,freightKind,stopFlags,impediments,lastFreeDay,ufvPosition,timestamps.timeIn,timestamps.timeOut",
    },
  });

export const getAssociatedEquipment = (
  facility: string,
  departOrderNbr: string,
) =>
  requestPortHouston("GET", evpPath("inventory/units"), {
    params: {
      operator: "POHA",
      ...withOptionalFacility({ facility }),
      predicate: `departOrderNbr = ${departOrderNbr}`,
      fields:
        "eqClass,unitId,nominalLength,isoGroup,nominalHeight,eqtypeId,lastKnownPosition.posName,freightKind,category",
    },
  });

export const getAvailableContainersByBol = (blNbr: string) =>
  requestPortHouston("GET", evpPath("inventory/units"), {
    params: {
      operator: "POHA",
      predicate: `category = IMPRT and stoppedRoad = true and blNbr = ${blNbr}`,
      fields:
        "extras.dwellDays,scope.facility_id,unitId,eqtypeId,isoGroup,line,category,freightKind,stopFlags,impediments,lastFreeDay,ufvPosition,timestamps.timeIn,timestamps.timeOut",
    },
  });

export const getEquipmentOwnership = (unitId: string) =>
  requestPortHouston("GET", evpPath("inventory/units"), {
    params: {
      operator: "POHA",
      predicate: `unitId = ${unitId}`,
      fields: "unitId,eqOperatorId,eqOwnerId",
    },
  });

export const createAppointment = (payload: AppointmentPayload) =>
  requestPortHouston("POST", "CreateAppointment", { data: payload });

export const updateAppointment = (payload: AppointmentPayload) =>
  requestPortHouston("POST", "UpdateAppointment", { data: payload });

export const cancelAppointment = (payload: AppointmentPayload) =>
  requestPortHouston("POST", "CancelAppointment", { data: payload });

export const getBookingInquiry = (bookingNumber: string) =>
  requestPortHouston("GET", evpPath("orders/bookings"), {
    params: {
      operator: "POHA",
      predicate: `subType = BOOK and nbr = ${bookingNumber}`,
    },
  });

export const getEquipmentHistory = (unitId: string, facility = "") =>
  requestPortHouston("GET", evpPath("service/events"), {
    params: {
      operator: "POHA",
      ...withOptionalFacility({ facility }),
      predicate: `appliedToNaturalKey = ${unitId}`,
      fields: "eventTypeId,created,changed,note",
    },
  });

export const getGateTransactions = (nbr: string) =>
  requestPortHouston("GET", evpPath("road/gatetransactions"), {
    params: { operator: "POHA", nbr },
  });

export const getRoadGateTransaction = (nbr: string) =>
  requestPortHouston("GET", evpPath("road/gatetransactions"), {
    params: { operator: "POHA", nbr },
  });

export const createSubscription = (payload: PortHoustonSubscriptionPayload) =>
  requestPortHouston("POST", evpPath("notify/subscribers"), { data: payload });

const getEirDocumentEndpoint = (transactionId: string) => {
  const pattern = getEnv("PORT_HOUSTON_EIR_DOCUMENT_URL_PATTERN");
  if (pattern) {
    return pattern.replaceAll("{id}", encodeURIComponent(transactionId));
  }
  return evpPath(`road/gatetransactions/${encodeURIComponent(transactionId)}/documents`);
};

export const downloadEirDocument = async (
  transactionId: string,
  subType = "",
): Promise<RetrievedEirDocument> => {
  const endpoint = getEirDocumentEndpoint(transactionId);
  const { data, contentType } = await requestPortHoustonBuffer(endpoint);
  const category = getEirCategoryFromSubType(subType);
  if (!category) {
    throw new Error(`Unsupported Port Houston EIR subtype: ${subType || "missing"}`);
  }
  const extension = contentType.includes("image") ? "jpg" : "pdf";

  return {
    category,
    fileName: `${category.replace(" ", "-").toLowerCase()}-${transactionId}.${extension}`,
    contentType,
    data,
  };
};

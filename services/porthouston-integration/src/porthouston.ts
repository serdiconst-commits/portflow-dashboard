import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  Method,
} from "axios";
import { AppointmentPayload, JsonObject, TokenState } from "./types.js";

const DEFAULT_API_BASE_URL = "https://api.america.naviscloudops.com/v3/";
const TOKEN_REFRESH_SAFETY_MS = 60_000;

const getEnv = (key: string, fallback = "") => process.env[key] || fallback;

const normalizeBaseUrl = (url: string) => (url.endsWith("/") ? url : `${url}/`);

const apiBaseUrl = normalizeBaseUrl(
  getEnv("PORT_HOUSTON_API_BASE_URL", DEFAULT_API_BASE_URL),
);

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
  const clientId = getEnv("PORT_HOUSTON_CLIENT_ID");
  const clientSecret = getEnv("PORT_HOUSTON_CLIENT_SECRET");

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
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const response = await axios.post<JsonObject>(authUrl, form.toString(), {
      timeout: 30_000,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const accessToken = getAccessTokenFromResponse(response.data);
    const expiresIn = parseExpiresIn(response.data.expires_in);
    tokenState = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return accessToken;
  } catch {
    const response = await axios.post<JsonObject>(
      authUrl,
      new URLSearchParams({ grant_type: "client_credentials" }).toString(),
      {
        timeout: 30_000,
        auth: {
          username: clientId,
          password: clientSecret,
        },
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    const accessToken = getAccessTokenFromResponse(response.data);
    const expiresIn = parseExpiresIn(response.data.expires_in);
    tokenState = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return accessToken;
  }
}

const requestPortHouston = async <T = unknown>(
  method: Method,
  endpoint: string,
  options: AxiosRequestConfig = {},
): Promise<T> => {
  const token = await authenticate();

  try {
    const response = await client.request<T>({
      method,
      url: endpoint,
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<JsonObject>;
    if (axiosError.response?.status === 401) {
      const refreshedToken = await authenticate(true);
      const retry = await client.request<T>({
        method,
        url: endpoint,
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${refreshedToken}`,
        },
      });
      return retry.data;
    }

    const details = axiosError.response?.data
      ? JSON.stringify(axiosError.response.data)
      : axiosError.message;
    throw new Error(`Port Houston API request failed: ${details}`);
  }
};

export const getVesselSchedule = (fromDate: string, toDate: string) =>
  requestPortHouston("GET", "GetVesselSchedule", {
    params: { eta: fromDate, etd: toDate },
  });

export const getAvailableContainers = (unitId: string) =>
  requestPortHouston("GET", "GetAvailableContainers", {
    params: { unitId },
  });

export const getAssociatedEquipment = (
  facility: string,
  departOrderNbr: string,
) =>
  requestPortHouston("GET", "GetAssociatedEquipment", {
    params: { facility, departOrderNbr },
  });

export const getAvailableContainersByBol = (blNbr: string) =>
  requestPortHouston("GET", "GetAvailableContainersByBOL", {
    params: { blNbr },
  });

export const getEquipmentOwnership = (unitId: string) =>
  requestPortHouston("GET", "GetEquipmentOwnership", {
    params: { unitId },
  });

export const createAppointment = (payload: AppointmentPayload) =>
  requestPortHouston("POST", "CreateAppointment", { data: payload });

export const updateAppointment = (payload: AppointmentPayload) =>
  requestPortHouston("POST", "UpdateAppointment", { data: payload });

export const cancelAppointment = (payload: AppointmentPayload) =>
  requestPortHouston("POST", "CancelAppointment", { data: payload });

export const getBookingInquiry = (bookingNumber: string) =>
  requestPortHouston("GET", "GetBookingInquiry", {
    params: { bookingNumber },
  });

export const getEquipmentHistory = (unitId: string) =>
  requestPortHouston("GET", "GetEquipmentHistory", {
    params: { unitId },
  });

export const getGateTransactions = (nbr: string) =>
  requestPortHouston("GET", "GetGateTransactions", {
    params: { nbr },
  });

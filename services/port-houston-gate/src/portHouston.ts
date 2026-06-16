import axios, { AxiosError } from "axios";
import "dotenv/config";
import type { CachedToken, PortHoustonTokenResponse } from "./types.js";

const DEFAULT_BASE_URL = "https://api.america.naviscloudops.com/v3/";
const DEFAULT_GATE_ENDPOINT = "evp/road/gatetransactions";
const DEFAULT_TOKEN_URL =
  "https://auth-v1.america.naviscloudops.com/auth/realms/phaprod/protocol/openid-connect/token";

let cachedToken: CachedToken | null = null;

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");

const buildGateTransactionUrl = (): string => {
  const baseUrl = process.env.PORT_HOUSTON_BASE_URL || DEFAULT_BASE_URL;
  const endpoint =
    process.env.PORT_HOUSTON_GATETRANSACTIONS_ENDPOINT || DEFAULT_GATE_ENDPOINT;
  return `${baseUrl.replace(/\/+$/g, "")}/${trimSlashes(endpoint)}`;
};

const isTokenValid = (): boolean =>
  Boolean(cachedToken?.accessToken && cachedToken.expiresAt > Date.now() + 60_000);

const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object") return JSON.stringify(data);
    return error.message;
  }
  return error instanceof Error ? error.message : "Unknown Port Houston error";
};

/**
 * Exchange Port Houston client credentials for an OAuth bearer token.
 * The token is cached in memory until shortly before expiry.
 */
export const authenticate = async (forceRefresh = false): Promise<string> => {
  if (!forceRefresh && isTokenValid() && cachedToken) {
    return cachedToken.accessToken;
  }

  const clientId = getRequiredEnv("PORT_HOUSTON_CLIENT_ID");
  const clientSecret = getRequiredEnv("PORT_HOUSTON_CLIENT_SECRET");
  const tokenUrl = process.env.PORT_HOUSTON_TOKEN_URL || DEFAULT_TOKEN_URL;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const response = await axios.post<PortHoustonTokenResponse>(tokenUrl, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 20_000,
    });

    if (!response.data.access_token) {
      throw new Error("Port Houston token response did not include access_token.");
    }

    const expiresInSeconds = Number(response.data.expires_in || 1_800);
    cachedToken = {
      accessToken: response.data.access_token,
      expiresAt: Date.now() + expiresInSeconds * 1_000,
    };

    return cachedToken.accessToken;
  } catch (error) {
    throw new Error(`Port Houston authentication failed: ${getErrorMessage(error)}`);
  }
};

/**
 * Fetch one Port Houston gate transaction by transaction number (nbr).
 * Retries once with a fresh token when Port Houston returns 401.
 */
export const getGateTransaction = async (nbr: string): Promise<unknown> => {
  const cleanNbr = String(nbr || "").trim();
  if (!cleanNbr) {
    throw new Error("Gate transaction number is required.");
  }

  const operator = process.env.PORT_HOUSTON_OPERATOR_CODE || "POHA";
  const request = async (token: string) =>
    axios.get(buildGateTransactionUrl(), {
      params: {
        operator,
        predicate: `nbr = ${cleanNbr}`,
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 30_000,
    });

  try {
    const token = await authenticate();
    const response = await request(token);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axios.isAxiosError(axiosError) && axiosError.response?.status === 401) {
      const token = await authenticate(true);
      const response = await request(token);
      return response.data;
    }

    throw new Error(`Failed to fetch gate transaction ${cleanNbr}: ${getErrorMessage(error)}`);
  }
};

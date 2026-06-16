export interface PortHoustonTokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface GateTransactionRequest {
  nbr: string;
}

export interface GateTransactionResult {
  raw: unknown;
}

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}

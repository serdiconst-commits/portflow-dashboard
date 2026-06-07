export type JsonObject = Record<string, unknown>;

export type AppointmentPayload = JsonObject & {
  facility?: string;
  appointmentNbr?: string;
  unitId?: string;
  truckLicenseNbr?: string;
  startTime?: string;
  endTime?: string;
};

export type TokenState = {
  accessToken: string;
  expiresAt: number;
};

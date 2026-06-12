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

export type PortHoustonSubscriptionPayload = {
  type: "subscribe";
  channel: "/nsp";
  transport: "ws";
  groupId: string;
  filters: Array<{
    eventName: string;
    operation?: "create" | "update" | "delete";
    changeFields?: {
      include?: string[];
      exclude?: string[];
    };
    filter?: {
      predicate?: string[];
      fields?: string[];
    };
  }>;
};

export type TruckTransactionPayload = JsonObject & {
  gkey?: string | number;
  nbr?: string | number;
  subType?: string;
  status?: string;
  stageId?: string;
  ctrId?: string;
  unitId?: string;
  blNbr?: string;
  hasDocuments?: boolean;
  handled?: string;
  created?: string;
  changed?: string;
  scope?: {
    facility_id?: string;
  };
};

export type ShipmentMapping = {
  containerNumber: string;
  billOfLading: string;
  transactionNumber: string;
  transactionGkey: string;
  facility: string;
  eventType: string;
  eirCategory: "IN EIR" | "OUT EIR" | "";
  shipmentStatus: "At Port" | "Picked Up" | "Dispatched";
  handledAt: string;
};

export type RetrievedEirDocument = {
  category: "IN EIR" | "OUT EIR";
  fileName: string;
  contentType: string;
  data: Buffer;
};

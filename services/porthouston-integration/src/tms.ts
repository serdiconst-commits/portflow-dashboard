import axios from "axios";
import type {
  JsonObject,
  RetrievedEirDocument,
  ShipmentMapping,
  TruckTransactionPayload,
} from "./types.js";

const getEnv = (key: string, fallback = "") => process.env[key] || fallback;

const normalize = (value: unknown) => String(value || "").trim();

export const getEirCategoryFromSubType = (
  subType: unknown,
): "IN EIR" | "OUT EIR" | "" => {
  const normalized = normalize(subType).toUpperCase();
  if (["RM", "DE"].includes(normalized)) return "IN EIR";
  if (["DI", "RE"].includes(normalized)) return "OUT EIR";
  return "";
};

export const getShipmentStatusFromTransaction = (
  transaction: TruckTransactionPayload,
): "At Port" | "Picked Up" | "Dispatched" => {
  const subType = normalize(transaction.subType).toUpperCase();
  const stageId = normalize(transaction.stageId).toLowerCase();

  if (subType === "DI" || subType === "RE" || stageId.includes("outgate")) {
    return "Picked Up";
  }
  if (subType === "DE" || subType === "RM" || stageId.includes("ingate")) {
    return "At Port";
  }
  return "Dispatched";
};

export const mapTruckTransactionToShipment = (
  transaction: TruckTransactionPayload,
): ShipmentMapping => ({
  containerNumber: normalize(transaction.ctrId || transaction.unitId),
  billOfLading: normalize(transaction.blNbr),
  transactionNumber: normalize(transaction.nbr),
  transactionGkey: normalize(transaction.gkey),
  facility: normalize(transaction.scope?.facility_id),
  eventType: normalize(transaction.subType),
  eirCategory: getEirCategoryFromSubType(transaction.subType),
  shipmentStatus: getShipmentStatusFromTransaction(transaction),
  handledAt: normalize(
    transaction.handled || transaction.changed || transaction.created,
  ),
});

const getTmsHeaders = (): Record<string, string> => {
  const token = getEnv("PORTFLOW_TMS_API_TOKEN");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const updateTmsShipment = async (
  mapping: ShipmentMapping,
  sourceEvent: JsonObject,
) => {
  const baseUrl = getEnv("PORTFLOW_TMS_API_BASE_URL");
  if (!baseUrl) {
    console.log(
      "[porthouston-webhook] PORTFLOW_TMS_API_BASE_URL is not set; mapped event only.",
      mapping,
    );
    return {
      skipped: true,
      reason: "PORTFLOW_TMS_API_BASE_URL not configured",
    };
  }

  const response = await axios.post(
    `${baseUrl.replace(/\/+$/, "")}/api/port-houston/events`,
    { mapping, sourceEvent },
    { headers: getTmsHeaders(), timeout: 30_000 },
  );

  return response.data;
};

export const uploadEirToTms = async (
  mapping: ShipmentMapping,
  document: RetrievedEirDocument,
) => {
  const uploadUrl = getEnv("PORTFLOW_TMS_EIR_UPLOAD_URL");
  if (!uploadUrl) {
    console.log(
      "[porthouston-webhook] PORTFLOW_TMS_EIR_UPLOAD_URL is not set; EIR upload skipped.",
      { mapping, fileName: document.fileName },
    );
    return {
      skipped: true,
      reason: "PORTFLOW_TMS_EIR_UPLOAD_URL not configured",
    };
  }

  const form = new FormData();
  const blob = new Blob([new Uint8Array(document.data)], {
    type: document.contentType,
  });
  form.append("file", blob, document.fileName);
  form.append("category", document.category);
  form.append("containerNumber", mapping.containerNumber);
  form.append("billOfLading", mapping.billOfLading);
  form.append("transactionNumber", mapping.transactionNumber);
  form.append("transactionGkey", mapping.transactionGkey);
  form.append("facility", mapping.facility);

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: getTmsHeaders(),
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`TMS EIR upload failed: ${response.status} ${body}`);
  }

  return response.json().catch(() => ({ ok: true }));
};

export const alertDispatchOnHold = async (
  event: JsonObject,
  mapping: Partial<ShipmentMapping>,
) => {
  const alertUrl = getEnv("PORTFLOW_DISPATCH_ALERT_URL");
  if (!alertUrl) {
    console.warn(
      "[porthouston-webhook] SSL hold detected, but alert URL is not configured.",
      {
        mapping,
      },
    );
    return {
      skipped: true,
      reason: "PORTFLOW_DISPATCH_ALERT_URL not configured",
    };
  }

  const response = await axios.post(
    alertUrl,
    {
      type: "PORT_HOUSTON_SSL_HOLD",
      message: "Port Houston reported a container on SSL hold.",
      mapping,
      event,
    },
    { headers: getTmsHeaders(), timeout: 30_000 },
  );

  return response.data;
};

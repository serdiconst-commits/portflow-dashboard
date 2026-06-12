import express from "express";
import {
  createSubscription,
  downloadEirDocument,
  getRoadGateTransaction,
} from "../porthouston.js";
import { defaultSubscriptions } from "../subscriptions.js";
import {
  alertDispatchOnHold,
  mapTruckTransactionToShipment,
  updateTmsShipment,
  uploadEirToTms,
} from "../tms.js";
import type { JsonObject, TruckTransactionPayload } from "../types.js";

const router = express.Router();

const normalize = (value: unknown) => String(value || "").trim();

const getWebhookSecret = () => process.env.PORT_HOUSTON_WEBHOOK_SECRET || "";

const isAuthorizedWebhook = (req: express.Request) => {
  const secret = getWebhookSecret();
  if (!secret) return true;
  const provided =
    normalize(req.header("x-porthouston-webhook-secret")) ||
    normalize(req.query.secret);
  return provided === secret;
};

const collectEvents = (body: unknown): JsonObject[] => {
  if (Array.isArray(body))
    return body.filter((item): item is JsonObject =>
      Boolean(item && typeof item === "object"),
    );
  if (!body || typeof body !== "object") return [];

  const jsonBody = body as JsonObject;
  const candidates = [
    jsonBody.data,
    jsonBody.events,
    jsonBody.items,
    jsonBody.payload,
    jsonBody.record,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is JsonObject =>
        Boolean(item && typeof item === "object"),
      );
    }
    if (candidate && typeof candidate === "object") {
      return [candidate as JsonObject];
    }
  }

  return [jsonBody];
};

const getEventName = (event: JsonObject) =>
  normalize(event.eventName || event.event || event.entityName || event.type);

const isTruckTransactionEvent = (event: JsonObject) => {
  const eventName = getEventName(event).toLowerCase();
  return (
    eventName === "trucktransaction" ||
    "ctrId" in event ||
    "hasDocuments" in event
  );
};

const isSslHoldEvent = (event: JsonObject) => {
  const eventName = getEventName(event).toLowerCase();
  const impediments = event.impediments;
  const stoppedRoad = String(event.stoppedRoad || "").toLowerCase();
  return (
    eventName === "unit" &&
    (stoppedRoad === "true" ||
      (Array.isArray(impediments) && impediments.length > 0) ||
      normalize(impediments))
  );
};

const firstRecord = (value: unknown): JsonObject => {
  if (Array.isArray(value)) {
    const record = value.find((item) => item && typeof item === "object");
    return (record || {}) as JsonObject;
  }
  return value && typeof value === "object" ? (value as JsonObject) : {};
};

const enrichTruckTransaction = async (
  event: TruckTransactionPayload,
): Promise<TruckTransactionPayload> => {
  const nbr = normalize(event.nbr);
  if (!nbr) return event;

  try {
    const details = await getRoadGateTransaction(nbr);
    return {
      ...event,
      ...firstRecord(details),
    };
  } catch (error) {
    console.warn(
      "[porthouston-webhook] Could not fetch gate transaction details.",
      {
        nbr,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return event;
  }
};

const handleTruckTransaction = async (event: TruckTransactionPayload) => {
  const transaction = await enrichTruckTransaction(event);
  const mapping = mapTruckTransactionToShipment(transaction);
  const tmsUpdate = await updateTmsShipment(mapping, transaction);
  const transactionId = mapping.transactionNumber || mapping.transactionGkey;
  const shouldFetchEir =
    Boolean(transaction.hasDocuments) &&
    Boolean(transactionId) &&
    Boolean(mapping.eirCategory);

  if (!shouldFetchEir) {
    return {
      type: "TruckTransaction",
      mapping,
      tmsUpdate,
      eirUpload: null,
      note: "No EIR download attempted for this event.",
    };
  }

  const document = await downloadEirDocument(
    transactionId,
    normalize(transaction.subType),
  );
  const eirUpload = await uploadEirToTms(mapping, document);

  return {
    type: "TruckTransaction",
    mapping,
    tmsUpdate,
    eirUpload,
  };
};

const handleSslHold = async (event: JsonObject) => {
  const mapping = {
    containerNumber: normalize(event.unitId || event.ctrId),
    billOfLading: normalize(event.blNbr),
    facility: normalize((event.scope as JsonObject | undefined)?.facility_id),
  };

  const alert = await alertDispatchOnHold(event, mapping);
  return { type: "SSLHold", mapping, alert };
};

router.post("/webhook/porthouston", async (req, res) => {
  if (!isAuthorizedWebhook(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized webhook" });
    return;
  }

  const events = collectEvents(req.body);
  console.log(`[porthouston-webhook] Received ${events.length} event(s).`);

  const results = [];
  for (const event of events) {
    try {
      console.log("[porthouston-webhook] Event audit:", JSON.stringify(event));

      if (isTruckTransactionEvent(event)) {
        results.push(
          await handleTruckTransaction(event as TruckTransactionPayload),
        );
        continue;
      }

      if (isSslHoldEvent(event)) {
        results.push(await handleSslHold(event));
        continue;
      }

      results.push({ type: getEventName(event) || "Unknown", skipped: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[porthouston-webhook] Event handling failed:", message);
      results.push({ ok: false, error: message });
    }
  }

  res.json({ ok: true, processed: results.length, results });
});

router.post("/subscriptions/default", async (_req, res) => {
  const payloads = defaultSubscriptions();
  const results = [];

  for (const payload of payloads) {
    results.push({
      groupId: payload.groupId,
      response: await createSubscription(payload),
    });
  }

  res.json({ ok: true, subscriptions: results });
});

export default router;

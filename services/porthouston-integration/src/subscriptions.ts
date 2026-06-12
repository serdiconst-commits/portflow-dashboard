import type { PortHoustonSubscriptionPayload } from "./types.js";

const baseSubscription = (
  groupId: string,
  eventName: string,
  fields: string[],
  predicate: string[] = [],
): PortHoustonSubscriptionPayload => ({
  type: "subscribe",
  channel: "/nsp",
  transport: "ws",
  groupId,
  filters: [
    {
      eventName,
      operation: "update",
      filter: {
        predicate,
        fields,
      },
    },
  ],
});

export const buildEmptyContainerGateOutSubscription = (
  truckingCompanyId = "",
): PortHoustonSubscriptionPayload =>
  baseSubscription(
    "GetEmptyContainerGateOutUpdates",
    "TruckTransaction",
    [
      "gkey",
      "nbr",
      "subType",
      "status",
      "truckLicenseNbr",
      "ctrId",
      "chsId",
      "eqoNbr",
      "stageId",
      "gateId",
      "hasDocuments",
      "blNbr",
    ],
    [
      "subType=DM",
      "status=COMPLETE",
      "stageId=outgate",
      ...(truckingCompanyId ? [`trkcolId=${truckingCompanyId}`] : []),
    ],
  );

export const buildBookingUpdatesSubscription = (
  bookingNumber = "",
): PortHoustonSubscriptionPayload =>
  baseSubscription(
    "GetBookingUpdates",
    "Booking",
    [
      "nbr",
      "quantity",
      "tally",
      "tallyReceive",
      "ueCount",
      "visitPhase",
      "visit.visitId",
      "publishedEta",
      "publishedEtd",
      "timeBeginReceive",
      "timeCargoCutoff",
      "timeReeferCutoff",
      "timeHazCutoff",
    ],
    bookingNumber ? [`nbr=${bookingNumber}`] : [],
  );

export const buildContainerBySslOnHoldSubscription = (
  steamshipLine = "",
): PortHoustonSubscriptionPayload =>
  baseSubscription(
    "GetContainerBySSLOnHoldUpdates",
    "Unit",
    ["unitId", "blNbr", "eqOwnerId", "impediments", "stoppedRoad"],
    [
      "transitState=S40_YARD",
      "category=IMPRT",
      ...(steamshipLine ? [`eqOwnerId=${steamshipLine}`] : []),
    ],
  );

export const defaultSubscriptions = () => [
  buildEmptyContainerGateOutSubscription(
    process.env.PORT_HOUSTON_TRUCKING_COMPANY_ID || "",
  ),
  buildBookingUpdatesSubscription(
    process.env.PORT_HOUSTON_BOOKING_NUMBER || "",
  ),
  buildContainerBySslOnHoldSubscription(
    process.env.PORT_HOUSTON_STEAMSHIP_LINE || "",
  ),
];

import express from "express";
import {
  cancelAppointment,
  createAppointment,
  getAssociatedEquipment,
  getAvailableContainers,
  getAvailableContainersByBol,
  getBookingInquiry,
  getEquipmentHistory,
  getEquipmentOwnership,
  getGateTransactions,
  getVesselSchedule,
  updateAppointment,
} from "../porthouston.js";

const router = express.Router();

const requireQuery = (value: unknown, name: string) => {
  if (!value || typeof value !== "string") {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const requireParam = (value: string | string[] | undefined, name: string) => {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
};

const optionalQuery = (value: unknown) =>
  typeof value === "string" ? value : "";

const handleRoute = (
  fn: (req: express.Request) => Promise<unknown>,
): express.RequestHandler => {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.json({ ok: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(400).json({ ok: false, error: message });
    }
  };
};

router.get(
  "/vessel-schedule",
  handleRoute((req) =>
    getVesselSchedule(
      requireQuery(req.query.fromDate, "fromDate"),
      requireQuery(req.query.toDate, "toDate"),
    ),
  ),
);

router.get(
  "/available-containers/:unitId",
  handleRoute((req) =>
    getAvailableContainers(requireParam(req.params.unitId, "unitId")),
  ),
);

router.get(
  "/associated-equipment",
  handleRoute((req) =>
    getAssociatedEquipment(
      optionalQuery(req.query.facility),
      requireQuery(req.query.departOrderNbr, "departOrderNbr"),
    ),
  ),
);

router.get(
  "/available-containers-by-bol/:blNbr",
  handleRoute((req) =>
    getAvailableContainersByBol(requireParam(req.params.blNbr, "blNbr")),
  ),
);

router.get(
  "/equipment-ownership/:unitId",
  handleRoute((req) =>
    getEquipmentOwnership(requireParam(req.params.unitId, "unitId")),
  ),
);

router.post(
  "/appointments",
  handleRoute((req) => createAppointment(req.body)),
);

router.put(
  "/appointments",
  handleRoute((req) => updateAppointment(req.body)),
);

router.delete(
  "/appointments",
  handleRoute((req) => cancelAppointment(req.body)),
);

router.get(
  "/booking-inquiry/:bookingNumber",
  handleRoute((req) =>
    getBookingInquiry(requireParam(req.params.bookingNumber, "bookingNumber")),
  ),
);

router.get(
  "/equipment-history/:unitId",
  handleRoute((req) =>
    getEquipmentHistory(
      requireParam(req.params.unitId, "unitId"),
      optionalQuery(req.query.facility),
    ),
  ),
);

router.get(
  "/gate-transactions/:nbr",
  handleRoute((req) =>
    getGateTransactions(requireParam(req.params.nbr, "nbr")),
  ),
);

export default router;

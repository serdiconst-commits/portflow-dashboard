import { Router } from "express";
import { getGateTransaction } from "./portHouston.js";
import type { ApiErrorBody } from "./types.js";

const router = Router();

router.get("/gate-transactions/:nbr", async (req, res) => {
  try {
    const result = await getGateTransaction(req.params.nbr);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch gate transaction.";
    const status = message.includes("required") ? 400 : 502;
    const body: ApiErrorBody = {
      error: message,
    };
    res.status(status).json(body);
  }
});

export default router;

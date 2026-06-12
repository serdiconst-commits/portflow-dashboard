import "dotenv/config";
import express from "express";
import porthoustonRouter from "./routes/porthouston.js";
import webhookRouter from "./routes/webhook.js";

const app = express();
const port = Number(process.env.PORT || 3010);

app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "porthouston-integration" });
});

app.use("/porthouston", porthoustonRouter);
app.use("/porthouston", webhookRouter);

app.listen(port, () => {
  console.log(`porthouston-integration listening on port ${port}`);
});

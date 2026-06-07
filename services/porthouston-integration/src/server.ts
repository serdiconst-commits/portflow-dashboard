import "dotenv/config";
import express from "express";
import porthoustonRouter from "./routes/porthouston.js";

const app = express();
const port = Number(process.env.PORT || 3010);

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "porthouston-integration" });
});

app.use("/porthouston", porthoustonRouter);

app.listen(port, () => {
  console.log(`porthouston-integration listening on port ${port}`);
});

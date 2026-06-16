import "dotenv/config";
import express from "express";
import routes from "./routes.js";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "port-houston-gate" });
});

app.use("/", routes);

app.listen(port, () => {
  console.log(`port-houston-gate listening on port ${port}`);
});

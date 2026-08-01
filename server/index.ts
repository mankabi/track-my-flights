import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { apiRouter } from "./routes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MFM_PORT ?? 7470);

const app = express();
app.use(express.json());
app.use("/api", apiRouter);

if (process.env.NODE_ENV === "production") {
  const dist = path.join(ROOT, "web", "dist");
  app.use(express.static(dist));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, "127.0.0.1", () => {
  const airports = db.prepare("SELECT COUNT(*) AS n FROM airports").get() as { n: number };
  const flights = db.prepare("SELECT COUNT(*) AS n FROM flights").get() as { n: number };
  console.log(
    `Track My Flights server on http://localhost:${PORT} (airports: ${airports.n}, flights: ${flights.n})`,
  );
});

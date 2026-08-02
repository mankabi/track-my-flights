import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { apiRouter } from "./routes.js";
import { checkRequest } from "./lib/guard.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MFM_PORT ?? 7470);

const app = express();

// C5 (WORKBOOK §16): DNS 리바인딩·CSRF 방어 — Host/Origin 호스트네임 허용목록.
// 주의: 이 앱은 의도적으로 CORS 헤더를 보내지 않는다. cors() 미들웨어를 절대 추가하지 말 것 —
// "CORS 부재"가 크로스오리진 응답 읽기·preflight 요청을 막는 방어층으로 작동하고 있다(회귀 위험).
const extraHosts = new Set(
  (process.env.MFM_ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
);
app.use((req, res, next) => {
  const r = checkRequest(req, extraHosts);
  if (!r.ok) return res.status(403).json({ error: { code: r.code } });
  next();
});

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

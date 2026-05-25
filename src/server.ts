// Desenvolvido por L. A. Leandro - São José dos Campos - SP - 25/05/2026

import express from "express";
import dotenv from "dotenv";
import { rateLimit } from "./middleware/rateLimit";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.get("/api/public", (_req, res) => {
  res.json({ message: "Rota pública - sem rate limit" });
});

app.get("/api/protected", rateLimit({ maxRequests: 10, windowSeconds: 60 }), (_req, res) => {
  res.json({ message: "Rota protegida - rate limit ativo" });
});

app.post("/api/login", rateLimit({ maxRequests: 5, windowSeconds: 60 }), (req, res) => {
  const { username } = req.body;
  res.json({ message: `Tentativa de login para: ${username || "anon"}` });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});

app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
  console.log(`[server] Health: http://localhost:${PORT}/health`);
  console.log(`[server] Public: http://localhost:${PORT}/api/public`);
  console.log(`[server] Protected (10 req/min): http://localhost:${PORT}/api/protected`);
  console.log(`[server] Login (5 req/min): http://localhost:${PORT}/api/login`);
});

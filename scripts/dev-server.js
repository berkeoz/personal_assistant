// Local dev server for testing the Vercel port without deploying.
// Serves index.html and dispatches /api/* requests to the exact same
// handler modules Vercel would run, against an in-memory KV emulator
// (data resets on restart — that's fine, this is just for local testing).

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ---- In-memory KV emulator (mimics Upstash's REST GET/SET shape) ----
const store = new Map();
const kvServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const [, op, key] = url.pathname.split("/");
  if (op === "get" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ result: store.has(key) ? store.get(key) : null }));
  }
  if (op === "set" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      store.set(key, body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result: "OK" }));
    });
    return;
  }
  res.statusCode = 404;
  res.end();
});

await new Promise((resolve) => kvServer.listen(0, "127.0.0.1", resolve));
process.env.KV_REST_API_URL = `http://127.0.0.1:${kvServer.address().port}`;
process.env.KV_REST_API_TOKEN = "dev-token";

// ---- Single catch-all handler, mirroring api/handler.js + vercel.json's rewrite on Vercel ----
const ALL_HANDLER_MOD = "../api/handler.js";
let allHandler = null;
async function loadHandler() {
  if (!allHandler) {
    const m = await import(new URL(ALL_HANDLER_MOD, import.meta.url));
    allHandler = m.default;
  }
  return allHandler;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname.startsWith("/api/")) {
    const all = url.pathname.slice("/api/".length).split("/").filter(Boolean);
    if (all.length === 0) {
      res.statusCode = 404;
      return res.end("Not found");
    }
    const query = Object.fromEntries(url.searchParams);
    query.path = all;
    req.query = query;
    const raw = await readBody(req);
    if (raw) {
      try {
        req.body = JSON.parse(raw);
      } catch {
        req.body = raw;
      }
    }
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
    res.send = (val) => res.end(typeof val === "string" ? val : JSON.stringify(val));
    try {
      const handler = await loadHandler();
      await handler(req, res);
    } catch (e) {
      console.error(e);
      res.statusCode = 500;
      res.end(String(e));
    }
    return;
  }

  const html = await readFile(path.join(ROOT, "index.html"));
  res.setHeader("Content-Type", "text/html");
  res.end(html);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Personal Assistant (Vercel port) running at http://localhost:${PORT}`);
  console.log(`Local KV emulator: in-memory, resets on restart`);
});

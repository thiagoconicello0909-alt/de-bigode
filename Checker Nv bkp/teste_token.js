import fs from "fs";
import path from "path";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies, listarProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";

const casa = loadCasas()["5853"];
loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "db", "captcha.json"), "utf-8"));
const proxy = listarProxies()[0] || null;
console.log("proxy:", proxy || "NENHUM");

const headers = {
  ...(casa.headers || {}),
  origin: `https://${casa.domain}`,
  referer: `https://${casa.domain}/`,
  "x-request-source": "web_client",
  "x-trace-id": "TESTE",
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
};

async function solve(sitekey, action, cdata) {
  const c = await axios.post("https://api.capsolver.com/createTask", {
    clientKey: cfg.apiKey,
    task: {
      type: "AntiTurnstileTaskProxyLess",
      websiteURL: `https://${casa.domain}/`,
      websiteKey: sitekey,
      metadata: { ...(action ? { action } : {}), ...(cdata ? { cdata } : {}) },
    },
  }, { timeout: 30000, validateStatus: () => true });

  if (c.data?.errorId) { console.log("  capsolver:", c.data.errorDescription); return null; }
  const id = c.data?.taskId;
  if (!id) return null;

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await axios.post("https://api.capsolver.com/getTaskResult", {
      clientKey: cfg.apiKey, taskId: id,
    }, { timeout: 30000, validateStatus: () => true });
    if (r.data?.status === "ready") return r.data.solution?.token || null;
    if (r.data?.errorId) { console.log("  capsolver:", r.data.errorDescription); return null; }
  }
  return null;
}

for (const [rotulo, cdata] of [
  ["com cdata", `${casa.tenantId}=${casa.deviceId}`],
  ["sem cdata", ""],
]) {
  const tok = await solve(casa.turnstile.sitekeyHeader, casa.turnstile.action, cdata);
  console.log(`\n[${rotulo}] token: ${tok ? "ok" : "falhou"}`);
  if (!tok) continue;

  const r = await axios.post("http://127.0.0.1:3334/post", {
    url: `https://${casa.apiHost}${casa.loginPath}`,
    headers: { ...headers, "x-token": tok },
    body: casa.bodyTemplate,
    ...(proxy ? { proxy } : {}),
  }, { timeout: 25000, validateStatus: () => true });

  const txt = String(r.data?.text ?? "");
  const titulo = (txt.match(/<title[^>]*>([^<]{0,100})/i) || [])[1] || (txt.trim().startsWith("{") ? "JSON" : "");
  console.log(`  http=${r.status} | ${titulo.trim().slice(0, 60)}`);
  console.log(`  ${txt.slice(0, 140).replace(/\s+/g, " ")}`);
}

process.exit(0);
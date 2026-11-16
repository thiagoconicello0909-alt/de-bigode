// diag_post.js — testa o POST do auth.login direto
import path from "path";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies, listarProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";

const casa = loadCasas()["5853"];
loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();

const url = `https://${casa.apiHost}${casa.loginPath}`;
const headers = {
  ...(casa.headers || {}),
  origin: `https://${casa.domain}`,
  referer: `https://${casa.domain}/`,
  "x-trace-id": "DIAGPOST1",
  "x-request-source": "web_client",
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
};

const proxy = listarProxies()[0] || null;

for (const [rotulo, p] of [["POST direto", null], ["POST proxy", proxy]]) {
  if (rotulo.endsWith("proxy") && !p) continue;
  try {
    const r = await axios.post(
      "http://127.0.0.1:3334/post",
      { url, headers, body: casa.bodyTemplate, ...(p ? { proxy: p } : {}) },
      { timeout: 25000, validateStatus: () => true },
    );
    const corpo = (r.data?.text ?? JSON.stringify(r.data)).slice(0, 260).replace(/\s+/g, " ");
    console.log(`\n[${rotulo}] http=${r.status}\n  ${corpo}`);
  } catch (e) {
    console.log(`\n[${rotulo}] FALHA ${e.message}`);
  }
}

process.exit(0);
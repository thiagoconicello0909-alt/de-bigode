// diag3.js — matriz GET/POST x caminho
import path from "path";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";

const casa = loadCasas()["5853"];
loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();

const base = `https://${casa.apiHost}`;
const headers = {
  ...(casa.headers || {}),
  origin: `https://${casa.domain}`,
  referer: `https://${casa.domain}/`,
  "x-trace-id": "DIAG3",
  "x-request-source": "web_client",
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
};
const minimo = { accept: "*/*", "content-type": "application/json" };

const loginUrl = `${base}${casa.loginPath}`;
const detailsUrl = `${base}/api/frontend/trpc/user.details?input=%7B%22json%22%3A%7B%7D%7D`;

const casos = [
  ["GET  auth.login", "get", loginUrl, "", headers],
  ["POST user.details", "post", detailsUrl, '{"json":{}}', headers],
  ["POST auth.login corpo vazio", "post", loginUrl, "", headers],
  ["POST auth.login headers minimos", "post", loginUrl, casa.bodyTemplate, minimo],
  ["POST auth.login completo", "post", loginUrl, casa.bodyTemplate, headers],
];

for (const [rotulo, metodo, url, body, h] of casos) {
  try {
    const r = await axios.post(
      `http://127.0.0.1:3334/${metodo}`,
      { url, headers: h, body },
      { timeout: 25000, validateStatus: () => true },
    );
    const txt = (r.data?.text ?? JSON.stringify(r.data)).slice(0, 200).replace(/\s+/g, " ");
    console.log(`\n[${rotulo}] http=${r.status}\n  ${txt}`);
  } catch (e) {
    console.log(`\n[${rotulo}] FALHA ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 900));
}

process.exit(0);
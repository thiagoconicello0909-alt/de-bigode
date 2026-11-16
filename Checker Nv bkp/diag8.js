import path from "path";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { buildHeaders, buildQuery } from "./src/trpc.js";

const [nome, cred] = process.argv.slice(2);
const casa = loadCasas()[nome];
const i = cred.indexOf(":");
const body = JSON.parse(casa.bodyTemplate);
body.json.username = cred.slice(0, i);
body.json.password = cred.slice(i + 1);

loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();

const TLS = "http://127.0.0.1:3334";
const ver = (tag, t) => {
  const s = String(t || "").replace(/\s+/g, " ");
  const bloq = /attention required/i.test(s);
  console.log(`${tag} → ${bloq ? "BLOQUEADO" : "OK"} | ${s.slice(0, 220)}`);
};

// 1) GET auth.login
const g = await axios.post(`${TLS}/get`, {
  url: `https://${casa.apiHost}${buildQuery(casa.loginPath, body)}`,
  headers: buildHeaders(casa, {}),
  body: "",
}, { timeout: 20000, validateStatus: () => true });
ver("GET auth.login", g.data?.text);

// 2) GET user.details (controle: já sabemos que responde JSON)
const d = await axios.post(`${TLS}/get`, {
  url: `https://${casa.apiHost}${buildQuery("/api/frontend/trpc/user.details", { json: {} })}`,
  headers: buildHeaders(casa, {}),
  body: "",
}, { timeout: 20000, validateStatus: () => true });
ver("GET user.details", d.data?.text);

// 3) POST auth.token (controle: outro POST)
const p = await axios.post(`${TLS}/post`, {
  url: `https://${casa.apiHost}${casa.tokenPath}`,
  headers: buildHeaders(casa, {}),
  body: JSON.stringify({ json: {} }),
}, { timeout: 20000, validateStatus: () => true });
ver("POST auth.token", p.data?.text);

process.exit(0);
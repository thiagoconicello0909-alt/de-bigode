import path from "path";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { buildHeaders } from "./src/trpc.js";

const [nome, cred] = process.argv.slice(2);
const casa = loadCasas()[nome];
const i = cred.indexOf(":");
const body = JSON.parse(casa.bodyTemplate);
body.json.username = cred.slice(0, i);
body.json.password = cred.slice(i + 1);

loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();

const TLS = "http://127.0.0.1:3334";
const juntar = (cs) => cs.map((c) => c.split(";")[0]).join("; ");

// A) pega o HTML do site e os cookies que o Cloudflare emitir
const a = await axios.post(`${TLS}/get`, {
  url: `https://${casa.domain}/`,
  headers: { ...buildHeaders(casa, {}), accept: "text/html,application/xhtml+xml" },
  body: "",
}, { timeout: 20000, validateStatus: () => true });

const hA = a.data?.headers || {};
const csA = [].concat(hA["Set-Cookie"] || hA["set-cookie"] || []);
console.log("A status:", a.status, "| cookies:", csA.map((c) => c.split("=")[0]).join(",") || "nenhum");
console.log("A challenge?", /just a moment|attention required/i.test(String(a.data?.text || "")) ? "SIM" : "nao");

// B) POST com esses cookies
const b = await axios.post(`${TLS}/post`, {
  url: `https://${casa.apiHost}${casa.loginPath}`,
  headers: { ...buildHeaders(casa, {}), ...(csA.length ? { cookie: juntar(csA) } : {}) },
  body: JSON.stringify(body),
}, { timeout: 20000, validateStatus: () => true });
const tB = String(b.data?.text || "");
console.log("B status:", b.status, "| bloqueio?", /attention required/i.test(tB) ? "SIM" : "nao");
console.log("B trecho:", tB.replace(/\s+/g, " ").slice(0, 200));

// C) usa o __cf_bm que o próprio POST devolveu
const csB = [].concat(b.data?.headers?.["Set-Cookie"] || []);
const bm = csB.find((c) => c.startsWith("__cf_bm"));
if (bm) {
  const c = await axios.post(`${TLS}/post`, {
    url: `https://${casa.apiHost}${casa.loginPath}`,
    headers: { ...buildHeaders(casa, {}), cookie: bm.split(";")[0] },
    body: JSON.stringify(body),
  }, { timeout: 20000, validateStatus: () => true });
  const tC = String(c.data?.text || "");
  console.log("C status:", c.status, "| bloqueio?", /attention required/i.test(tC) ? "SIM" : "nao");
  console.log("C trecho:", tC.replace(/\s+/g, " ").slice(0, 200));
} else {
  console.log("C: sem __cf_bm na resposta");
}
process.exit(0);
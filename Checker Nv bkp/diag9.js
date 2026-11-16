import path from "path";
import axios from "axios";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies, getNextProxy, getProxyCount } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { buildHeaders } from "./src/trpc.js";
import { obterClearance } from "./src/cloudflare.js";

const [nome, cred] = process.argv.slice(2);
const casa = loadCasas()[nome];
const i = cred.indexOf(":");
const body = JSON.parse(casa.bodyTemplate);
body.json.username = cred.slice(0, i);
body.json.password = cred.slice(i + 1);

loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();
const proxy = getNextProxy();
console.log("proxy:", proxy, "| total:", getProxyCount());

const cf = await obterClearance(casa, proxy);
console.log("clearance:", cf ? "OK" : "FALHOU");
if (!cf) process.exit(0);

const r = await axios.post("http://127.0.0.1:3334/post", {
  url: `https://${casa.apiHost}${casa.loginPath}`,
  headers: { ...buildHeaders(casa, {}), cookie: cf.cookie, ...(cf.ua ? { "user-agent": cf.ua } : {}) },
  body: JSON.stringify(body),
  ...(proxy ? { proxy } : {}),
}, { timeout: 25000, validateStatus: () => true });

const t = String(r.data?.text || "");
console.log("status:", r.status, "| bloqueio?", /attention required/i.test(t) ? "SIM" : "nao");
console.log("trecho:", t.replace(/\s+/g, " ").slice(0, 300));
process.exit(0);
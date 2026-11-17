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

const r = await axios.post("http://127.0.0.1:3334/post", {
  url: `https://${casa.apiHost}${casa.loginPath}`,
  headers: buildHeaders(casa, {}),
  body: JSON.stringify(body),
}, { timeout: 20000, validateStatus: () => true });

console.log("status:", r.status);
console.log("chaves data:", Object.keys(r.data || {}));
console.log("headers:", JSON.stringify(r.data?.headers || {}, null, 1));
const t = String(r.data?.text || "");
console.log("tamanho:", t.length);
console.log("trecho:", t.replace(/\s+/g, " ").slice(0, 500));
process.exit(0);
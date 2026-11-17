import path from "path";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { post, normalize } from "./src/trpc.js";

const [nome, cred] = process.argv.slice(2);
const casa = loadCasas()[nome];
const i = cred.indexOf(":");
const body = JSON.parse(casa.bodyTemplate);
body.json.username = cred.slice(0, i);
body.json.password = cred.slice(i + 1);

loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();

const raw = await post(casa, casa.loginPath, body);
console.log("=== RAW ===");
console.log(String(raw).slice(0, 1500));
console.log("\n=== NORMALIZADO ===");
console.log(JSON.stringify(normalize(raw)).slice(0, 900));
process.exit(0);
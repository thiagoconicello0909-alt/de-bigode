// vip.js v3 — teste rápido de perfil
import path from "path";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies, getProxyCount } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { get, withRouter, setRateLimit, normalize } from "./src/trpc.js";
import { login, extractAccount, statusLabel } from "./src/login.js";

const [nome, cred] = process.argv.slice(2);
const casa = loadCasas()[nome];
const i = cred.indexOf(":");

loadProxies(path.join(ROOT, "proxy.txt"));
console.log(`proxies carregados: ${getProxyCount()}`);
await startTlsProxy();
setRateLimit(600);

try {
  const auth = await login(casa, cred.slice(0, i), cred.slice(i + 1));
  if (!auth.ok) {
    console.log("login falhou:", auth.error);
    process.exit(0);
  }
  console.log("userId:", auth.userId, "| authTag ok\n");

  const combinado = {};
  for (const proc of ["user.details", "user.assets", "vip.info"]) {
    try {
      const raw = await get(casa, withRouter(casa, proc), { json: {} }, auth);
      const norm = normalize(raw);
      console.log(`${proc} → ${norm.ok ? "OK" : "ERRO"} ${String(norm.msg || "").slice(0, 160)}`);
      if (norm.ok && norm.data) {
        console.log("   ", JSON.stringify(norm.data).slice(0, 400));
        Object.assign(combinado, norm.data);
      }
    } catch (e) {
      console.log(`${proc} → FALHA ${e.message}`);
    }
  }

  const acc = extractAccount(combinado, casa);
  console.log("\n=== RESULTADO ===");
  console.log(`vip=${acc.vip ?? "?"} | saldo=${acc.balance ?? "?"} | ${statusLabel(acc.rawStatus) || "sem status"}`);
} catch (e) {
  console.log("\n[ERRO FATAL]", e.message);
}

process.exit(0);
import path from "path";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { login, extractAccount } from "./src/login.js";
import { post, normalize } from "./src/trpc.js";

const [nome, cred] = process.argv.slice(2);
const casa = loadCasas()[nome];
if (!casa) { console.error("casa não encontrada"); process.exit(1); }
const idx = cred.indexOf(":");

loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();
const auth = await login(casa, cred.slice(0, idx), cred.slice(idx + 1));
if (!auth.ok) { console.error("login falhou:", auth.error); process.exit(1); }
console.log("apiHost:", casa.apiHost, "| token ok\n");

const prefix = casa.loginPath.replace(/[^/]+$/, "");
const procs = ["member.info", "member.detail", "member.profile", "user.info", "member.account", "wallet.balance", "wallet.info", "main.perfil"];
const alvos = [
  ...procs.map((p) => prefix + p),
  "/main/perfil",
  "/api/frontend/main/perfil",
  "/api/main/perfil",
];

for (const p of alvos) {
  try {
    const norm = normalize(await post(casa, p, { json: {} }, auth.token));
    const acc = norm.ok && norm.data ? extractAccount(norm.data) : null;
    const achou = acc && (acc.balance !== null || acc.vip !== null);
    console.log(`${achou ? ">>> " : "    "}${p} | ok=${norm.ok} | saldo=${acc?.balance ?? "-"} vip=${acc?.vip ?? "-"} | ${String(norm.msg || "").slice(0, 90)}`);
    if (achou) console.log("      payload:", JSON.stringify(norm.data).slice(0, 400));
  } catch (e) {
    console.log(`    ${p} | erro: ${e.message}`);
  }
}
process.exit(0);
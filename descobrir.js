import path from "path";
import { ROOT } from "./src/paths.js";
import { loadCasas, saveCasas } from "./src/storage.js";
import { loadProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { setRateLimit, get, normalize, withRouter, pinProxy, headerModes } from "./src/trpc.js";
import { login, extractAccount } from "./src/login.js";

const ALVOS = [
  "main.perfil", "user.assets", "vip.info", "member.info", "user.info", "user.details", "main.userInfo",
];

const casas = loadCasas();
const nomes = Object.keys(casas);
if (!nomes.length) { console.log("sem casas cadastradas"); process.exit(0); }

let [nome, cred] = process.argv.slice(2);
if (!nome) {
  nomes.forEach((n, i) => console.log(`[${i + 1}] ${n} (${casas[n].domain})`));
  process.exit(0);
}
if (!casas[nome]) {
  const n = parseInt(nome, 10);
  if (!isNaN(n) && casas[nomes[n - 1]]) nome = nomes[n - 1];
}
if (!casas[nome] || !cred || !cred.includes(":")) {
  console.log("uso: node descobrir.js <casa> conta:senha");
  process.exit(0);
}

const casa = casas[nome];
const i = cred.indexOf(":");

loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();
setRateLimit(300);

pinProxy();
const auth = await login(casa, cred.slice(0, i).trim(), cred.slice(i + 1).trim());
if (!auth.ok) { console.log("login falhou:", auth.error); process.exit(0); }

console.log("authTag:", String(auth.authTag || "").slice(0, 40));
console.log("tokenData:", String(auth.tokenData || "").slice(0, 40));
console.log("token:", String(auth.token || "").slice(0, 40), "\n");

const modos = headerModes(auth);
const achados = [];

for (const modo of modos) {
  console.log(`\n=== ${modo.nome} ===`);
  const authV = { ...auth, extraHeaders: modo.headers };
  for (const proc of ALVOS) {
    const p = withRouter(casa, proc);
    try {
      const norm = normalize(await get(casa, p, { json: {} }, authV));
      const acc = extractAccount(norm.data || {}, casa);
      const bom = norm.ok && (acc.balance !== null || acc.vip !== null);
      console.log(`${bom ? "★★★" : norm.ok ? "ok " : "erro"} ${proc} → vip=${acc.vip ?? "-"} saldo=${acc.balance ?? "-"} ${norm.ok ? "" : `(${norm.msg.slice(0, 50)})`}`);
      if (bom) achados.push({ path: p, modo: modo.nome, headers: modo.headers });
    } catch (e) {
      console.log(`erro ${proc} → ${e.message.slice(0, 50)}`);
    }
  }
}

if (!achados.length) {
  console.log("\nnenhuma combinação funcionou — mande a saída toda");
  process.exit(0);
}

casa.perfilPath = achados[0].path;
casa.perfilBody = '{"json":{}}';
casa.extraHeaders = achados[0].headers;
saveCasas(casas);
console.log(`\n✅ gravado: ${achados[0].path} com ${achados[0].modo}`);
process.exit(0);
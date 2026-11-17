// shard.js — quebra contas.txt em N arquivos iguais e embaralhados
import fs from "fs";
import path from "path";
import { ROOT } from "./src/paths.js";

const args = process.argv.slice(2);
const flag = (nome, def) => {
  const a = args.find((x) => x.startsWith(`--${nome}=`));
  return a ? Number(a.split("=")[1]) : def;
};
const N = flag("n", 3);
const MANTER_TUDO = args.includes("--todos");
const FORCAR = args.includes("--forcar");
const SEMENTE = flag("seed", Date.now() % 1e9);

const ORIGEM = path.join(ROOT, "contas.txt");
if (!fs.existsSync(ORIGEM)) {
  console.log(`sem ${ORIGEM}`);
  process.exit(1);
}

function rng(s) {
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bruto = fs.readFileSync(ORIGEM, "utf8").split(/\r?\n/);
const vistos = new Set();
const bons = [];
let semFormato = 0;
let treze = 0;
let tamanho = 0;
let repetidos = 0;

for (const l of bruto) {
  const linha = l.trim().replace(/\s+/g, "");
  if (!linha) continue;
  const i = linha.indexOf(":");
  if (i < 1) { semFormato++; continue; }
  const user = linha.slice(0, i);
  const senha = linha.slice(i + 1);
  if (!senha) { semFormato++; continue; }
  if (!/^\d+$/.test(user)) { semFormato++; continue; }
  if (!MANTER_TUDO && user.length === 13) { treze++; continue; }
  if (!MANTER_TUDO && user.length !== 11) { tamanho++; continue; }
  if (vistos.has(user)) { repetidos++; continue; }
  vistos.add(user);
  bons.push(linha);
}

const r = rng(SEMENTE);
for (let i = bons.length - 1; i > 0; i--) {
  const j = Math.floor(r() * (i + 1));
  [bons[i], bons[j]] = [bons[j], bons[i]];
}

console.log(`lidas ${bruto.length} | validas ${bons.length}`);
console.log(`fora: formato ${semFormato} | 13 digitos ${treze} | tamanho ${tamanho} | repetidas ${repetidos}`);
if (!bons.length) process.exit(1);

const partes = [];
for (let n = 1; n <= N; n++) {
  const alvo = path.join(ROOT, `contas_${n}.txt`);
  if (fs.existsSync(alvo)) {
    if (!FORCAR) {
      console.log(`\n${alvo} ja existe — rode com --forcar`);
      process.exit(1);
    }
    fs.renameSync(alvo, `${alvo}.old`);
  }
  partes.push({ alvo, linhas: [] });
}

bons.forEach((l, k) => partes[k % N].linhas.push(l));

for (const p of partes) {
  fs.writeFileSync(p.alvo, `${p.linhas.join("\n")}\n`);
  console.log(`  ${path.basename(p.alvo)} → ${p.linhas.length}`);
}

const total = partes.reduce((s, p) => s + p.linhas.length, 0);
console.log(`\ndistribuidas ${total} | semente ${SEMENTE}`);
console.log(`estimativa ~${Math.ceil(total / 18)} min (${(total / 18 / 60).toFixed(1)} h)`);
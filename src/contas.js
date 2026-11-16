import fs from "fs";
import path from "path";
import { ROOT } from "./paths.js";
import { prompt, c } from "./ui.js";

export async function cmdAddContas() {
  const arquivo = path.join(ROOT, "contas.txt");
  console.log(`  ${c.DIM}Cole as contas (usuario:senha), uma por linha. Enter vazio encerra.${c.RESET}\n`);
  const linhas = [];
  while (true) {
    const l = (await prompt("  > ")).trim();
    if (!l) break;
    if (l.includes(":")) linhas.push(l);
    else console.log(`  ${c.R}ignorada (sem ":"): ${l}${c.RESET}`);
  }
  if (!linhas.length) return console.log("  Nada adicionado.");

  const soNove = linhas.filter((l) => {
    const u = l.slice(0, l.indexOf(":")).trim();
    return !/^\d{11}$/.test(u) || u[2] === "9";
  });
  const descartadas = linhas.length - soNove.length;
  if (descartadas) console.log(`  ${c.DIM}🔎 ${descartadas} ignorada(s) — 3º dígito ≠ 9${c.RESET}`);
  if (!soNove.length) return console.log("  Nenhuma sobrou após o filtro.");

  const atual = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, "utf-8").trimEnd() + "\n" : "";
  fs.writeFileSync(arquivo, atual + soNove.join("\n") + "\n", "utf-8");
  console.log(`  ✅ ${soNove.length} conta(s) adicionada(s) em contas.txt`);
}
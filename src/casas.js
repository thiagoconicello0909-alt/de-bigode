import fs from "fs";
import path from "path";
import readline from "readline";
import { ROOT } from "./paths.js";
import { prompt, c } from "./ui.js";
import { loadCasas, saveCasas, saveProbe, loadProbe } from "./storage.js";
import { splitCurls, parseCurl, buildCasa } from "./curl.js";
import { probe, probePerfil } from "./trpc.js";

const BONUS_ENDPOINT = "/api/active/receivedAwardList";
const BONUS_BODY = { page: 1, pageSize: 10, status: 0, timeDay: 60 };

function nomeDe(dominio) {
  return String(dominio || "").replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9_-]/gi, "").toLowerCase();
}

function resumo(casa) {
  const tags = [];
  if (casa.loginPath) tags.push("login");
  if (casa.perfilPath) tags.push("perfil");
  if (casa.infoPath) tags.push("info");
  if (casa.deepCheck?.enabled) tags.push("bonus");
  return tags.join("+") || "-";
}

async function perguntarNome(sugestao) {
  const nome = (await prompt(`  Nome da casa ${c.DIM}[${sugestao}]${c.RESET}: `)).trim() || sugestao;
  return nome.replace(/[^a-z0-9_.-]/gi, "_");
}

/** Lê a colagem inteira numa única interface — não perde linha no meio. */
function lerBloco() {
  console.log(`  ${c.DIM}Cole o curl de login. Enter vazio encerra.${c.RESET}\n`);
  return new Promise((resolve) => {
    const linhas = [];
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    process.stdout.write("  curl> ");
    rl.on("line", (l) => {
      if (!l.trim()) { rl.close(); return; }
      linhas.push(l);
      process.stdout.write("  curl> ");
    });
    rl.on("close", () => resolve(linhas.join("\n")));
  });
}

export async function cmdAdd() {
  let bruto = await lerBloco();

  // colagem veio curta? tenta o curl.txt
  if (bruto.split("\n").length < 3) {
    const arquivo = path.join(ROOT, "curl.txt");
    if (fs.existsSync(arquivo)) {
      const doArquivo = fs.readFileSync(arquivo, "utf-8");
      if (doArquivo.trim().length > bruto.length) {
        bruto = doArquivo;
        console.log(`  ${c.DIM}usando curl.txt (${doArquivo.length} bytes)${c.RESET}`);
      }
    }
  }

  const blocos = splitCurls(bruto);
  if (!blocos.length) return console.log(`  ${c.R}Nada colado.${c.RESET}`);

  const casas = loadCasas();
  let ok = 0, falhou = 0;
  for (const bloco of blocos) {
    const parsed = parseCurl(bloco);
    if (parsed.error) { console.log(`  ${c.R}x ${parsed.error}${c.RESET}`); falhou++; continue; }
    const casa = buildCasa(parsed);
    const nome = await perguntarNome(nomeDe(casa.domain));
    if (casas[nome]) {
      const resp = (await prompt(`  '${nome}' ja existe. Sobrescrever? [s/N]: `)).toLowerCase();
      if (resp !== "s") continue;
    }
    casa.lang = "pt";
    casa.criadaEm = new Date().toISOString();
    const bonus = (await prompt(`  Endpoint de bonus [Enter = ${BONUS_ENDPOINT}]: `)).trim();
    if (bonus !== "-") casa.deepCheck = { enabled: true, endpoint: bonus || BONUS_ENDPOINT, body: { ...BONUS_BODY } };
    casas[nome] = casa;
    ok++;
    console.log(`  ${c.GREEN}ok ${nome} | ${casa.domain} | tenant=${casa.tenantId}${c.RESET}`);
  }
  if (ok) { saveCasas(casas); console.log(`\n  ${c.GREEN}${ok} casa(s) salva(s).${c.RESET}`); }
  if (falhou) console.log(`  ${c.R}${falhou} curl(s) recusado(s).${c.RESET}`);
}

export function cmdList() {
  const casas = loadCasas();
  const nomes = Object.keys(casas);
  if (!nomes.length) return console.log(`  ${c.DIM}Nenhuma casa cadastrada.${c.RESET}`);
  console.log();
  for (const nome of nomes) {
    const casa = casas[nome];
    console.log(`  ${c.B}${nome}${c.RESET} | ${casa.domain} | tenant=${casa.tenantId} | ${resumo(casa)} | passMode=${casa.passMode || "plain"}`);
  }
  console.log(`\n  ${c.DIM}${nomes.length} casa(s).${c.RESET}`);
}

export async function cmdDiscover() {
  const alvo = (await prompt("  Casa (nome): ")).trim();
  const casas = loadCasas();
  const casa = casas[alvo];
  if (!casa) return console.log(`  ${c.R}casa '${alvo}' nao encontrada.${c.RESET}`);
  console.log(`\n  ${c.DIM}sondando ${casa.domain}...${c.RESET}`);
  let achados = [], perfil = null;
  try { achados = await probe(casa); } catch (e) { console.log(`  ${c.R}probe: ${e.message}${c.RESET}`); }
  try { perfil = await probePerfil(casa); } catch (e) { console.log(`  ${c.R}probe perfil: ${e.message}${c.RESET}`); }
  const procs = [...new Set([...(achados || []).map((a) => a.path), perfil?.path].filter(Boolean))];
  if (!procs.length) return console.log(`  ${c.YELLOW}Nada respondeu.${c.RESET}`);
  for (const p of procs) console.log(`  ${c.GREEN}ok ${p.split("/trpc/")[1] || p}${c.RESET}`);
  if (perfil?.path) {
    casa.perfilPath = perfil.path;
    casa.perfilBody = JSON.stringify(perfil.body || { json: {} });
  }
  casa.perfilProcs = [...new Set([...(casa.perfilProcs || []), ...procs.map((p) => p.split("/trpc/")[1] || p)])];
  casa.descobertoEm = new Date().toISOString();
  saveCasas(casas);
  saveProbe(alvo, { quando: casa.descobertoEm, procs, perfil });
  console.log(`  ${c.GREEN}${procs.length} procedure(s) gravada(s).${c.RESET}`);
}

export async function cmdLinkPerfil() {
  const alvo = (await prompt("  Casa (nome): ")).trim();
  const casas = loadCasas();
  const casa = casas[alvo];
  if (!casa) return console.log(`  ${c.R}casa '${alvo}' nao encontrada.${c.RESET}`);
  const bruto = await prompt("  curl de perfil> ");
  if (!bruto.trim()) return console.log(`  ${c.DIM}cancelado.${c.RESET}`);
  const parsed = parseCurl(bruto);
  if (parsed.error) return console.log(`  ${c.R}x ${parsed.error}${c.RESET}`);
  casa.perfilPath = parsed.path;
  casa.perfilBody = parsed.body || '{"json":{}}';
  casa.headers = { ...(casa.headers || {}), ...parsed.headers };
  casa.vinculadoEm = new Date().toISOString();
  const proc = parsed.path.split("/trpc/")[1];
  if (proc) casa.perfilProcs = [...new Set([...(casa.perfilProcs || []), proc])];
  saveCasas(casas);
  console.log(`  ${c.GREEN}perfil vinculado: ${proc || parsed.path}${c.RESET}`);
}

export async function cmdRemove() {
  const alvo = (await prompt("  Casa (nome): ")).trim();
  const casas = loadCasas();
  if (!casas[alvo]) return console.log(`  ${c.R}casa '${alvo}' nao encontrada.${c.RESET}`);
  const resp = (await prompt(`  Remover '${alvo}'? [s/N]: `)).toLowerCase();
  if (resp !== "s") return console.log(`  ${c.DIM}mantida.${c.RESET}`);
  delete casas[alvo];
  saveCasas(casas);
  try {
    const arquivo = path.join(ROOT, "db", "probe", `${alvo}.json`);
    if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
  } catch {}
  console.log(`  ${c.GREEN}'${alvo}' removida.${c.RESET}`);
}

export async function cmdRemoveAll() {
  const casas = loadCasas();
  const nomes = Object.keys(casas);
  if (!nomes.length) return console.log(`  ${c.DIM}Nada para remover.${c.RESET}`);
  const resp = (await prompt(`  Excluir TODAS as ${nomes.length} casas? Digite SIM: `)).trim();
  if (resp !== "SIM") return console.log(`  ${c.DIM}cancelado.${c.RESET}`);
  saveCasas({});
  console.log(`  ${c.GREEN}${nomes.length} casa(s) excluida(s).${c.RESET}`);
}

export async function cmdDeepCheck() {
  const alvo = (await prompt("  Casa (nome): ")).trim();
  const casas = loadCasas();
  const casa = casas[alvo];
  if (!casa) return console.log(`  ${c.R}casa '${alvo}' nao encontrada.${c.RESET}`);
  const endpoint = (await prompt(`  Endpoint [${casa.deepCheck?.endpoint || BONUS_ENDPOINT}]: `)).trim();
  const corpo = (await prompt(`  Body JSON [${JSON.stringify(BONUS_BODY)}]: `)).trim();
  let body = { ...BONUS_BODY };
  if (corpo) { try { body = JSON.parse(corpo); } catch { console.log(`  ${c.R}body invalido.${c.RESET}`); } }
  casa.deepCheck = { enabled: true, endpoint: endpoint || BONUS_ENDPOINT, body };
  saveCasas(casas);
  console.log(`  ${c.GREEN}bonus ativo: ${casa.deepCheck.endpoint}${c.RESET}`);
}

export default { cmdAdd, cmdList, cmdDiscover, cmdLinkPerfil, cmdRemove, cmdRemoveAll, cmdDeepCheck };
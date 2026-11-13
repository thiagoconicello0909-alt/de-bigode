import fs from "fs";
import path from "path";
import { ROOT } from "./paths.js";

const DIR = path.join(ROOT, "hits");
let linhas = [];
let casasAlvo = [];
let inicio = null;

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

const brl = (v) => {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return "?";
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
};

const ROTULO = {
  bonus: "BÔNUS",
  hit: "HIT",
  sem_saldo: "SEM SALDO",
  proibida: "PROIBIDA",
  senha: "SENHA ERRADA",
  nao_existe: "NÃO EXISTE",
  captcha: "CAPTCHA",
  bloqueio: "BLOQUEIO",
  schema: "SCHEMA",
  rate: "RATE LIMIT",
  inconclusivo: "INCONCLUSIVO",
  erro: "ERRO",
};

export function iniciarRelatorio(casas) {
  linhas = [];
  casasAlvo = [...casas];
  inicio = new Date();
}

export function registrar(r) {
  linhas.push({
    casa: String(r.casa || ""),
    conta: String(r.conta || ""),
    tipo: r.tipo || "inconclusivo",
    status: r.status || "",
    saldo: r.saldo ?? null,
    vip: r.vip ?? null,
    vipLabel: r.vipLabel || "",
    nome: r.nome || "",
    cpf: r.cpf || "",
    bonus: r.bonus || null,
    detalhe: String(r.detalhe || ""),
    quando: new Date().toISOString(),
  });
}

const ORDEM = { bonus: 0, hit: 1, sem_saldo: 2, proibida: 3, senha: 4, nao_existe: 5, captcha: 6, bloqueio: 7, schema: 8, rate: 9, inconclusivo: 10, erro: 11 };

/** Nome sempre inédito: relatorio-AAAAMMDD-HHMMSS.html (com sufixo se repetir no mesmo segundo). */
function nomeArquivo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const carimbo = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let arquivo = path.join(DIR, `relatorio-${carimbo}.html`);
  let i = 2;
  while (fs.existsSync(arquivo)) arquivo = path.join(DIR, `relatorio-${carimbo}-${i++}.html`);
  return arquivo;
}

export function finalizarRelatorio() {
  fs.mkdirSync(DIR, { recursive: true });
  const arquivo = nomeArquivo();

  const ordenadas = [...linhas].sort(
    (a, b) => a.casa.localeCompare(b.casa) || (ORDEM[a.tipo] - ORDEM[b.tipo]) || (Number(b.saldo ?? -1) - Number(a.saldo ?? -1)),
  );

  const contagem = {};
  for (const c of casasAlvo) contagem[c] = { total: 0, hit: 0, bonus: 0, proibida: 0, saldo: 0 };
  for (const l of linhas) {
    const c = contagem[l.casa];
    if (!c) continue;
    c.total++;
    if (l.tipo === "hit") c.hit++;
    if (l.tipo === "bonus") c.bonus++;
    if (l.tipo === "proibida") c.proibida++;
    if (typeof l.saldo === "number") c.saldo += l.saldo;
  }

  const cards = casasAlvo
    .map((c) => {
      const d = contagem[c] || { total: 0, hit: 0, bonus: 0, proibida: 0, saldo: 0 };
      return `<div class="card"><div class="card-nome">${esc(c)}</div>
        <div class="card-lin"><span class="v">${d.total}</span> contas</div>
        <div class="card-lin g"><span class="v">${d.hit}</span> hits</div>
        <div class="card-lin m"><span class="v">${d.bonus}</span> bônus</div>
        <div class="card-lin r"><span class="v">${d.proibida}</span> proibidas</div>
        <div class="card-lin d">soma saldo: ${brl(d.saldo)}</div></div>`;
    })
    .join("");

  const corpo = ordenadas
    .map((l) => {
      const bonusTxt = l.bonus?.hit
        ? `${l.bonus.total}x — ${brl(l.bonus.somaTotal)}`
        : l.bonus?.ok
          ? "sem bônus"
          : "";
      return `<tr data-tipo="${esc(l.tipo)}" data-casa="${esc(l.casa)}">
        <td>${esc(l.casa)}</td>
        <td class="conta">${esc(l.conta)}</td>
        <td><span class="chip ${esc(l.tipo)}">${ROTULO[l.tipo] || esc(l.tipo)}</span></td>
        <td class="num">${brl(l.saldo)}</td>
        <td class="num">${l.vipLabel ? esc(l.vipLabel) : l.vip !== null ? esc(l.vip) : "?"}</td>
        <td>${esc(l.nome)}</td>
        <td>${esc(l.cpf)}</td>
        <td class="bonus">${esc(bonusTxt)}</td>
        <td class="det">${esc(l.detalhe).slice(0, 160)}</td>
      </tr>`;
    })
    .join("");

  const opcoesCasa = casasAlvo.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório ${inicio ? inicio.toLocaleString("pt-BR") : ""}</title>
<style>
:root{--bg:#0d1117;--pnl:#161b22;--lin:#21262d;--tx:#c9d1d9;--dim:#8b949e;
--g:#238636;--m:#8957e5;--y:#9e6a03;--r:#b62324;--b:#1f6feb;--gy:#484f58}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:13px/1.45 "Segoe UI",system-ui,sans-serif}
header{padding:14px 18px;border-bottom:1px solid var(--lin);background:var(--pnl)}
h1{margin:0 0 4px;font-size:16px}
.sub{color:var(--dim);font-size:12px}
.cards{display:flex;flex-wrap:wrap;gap:10px;padding:14px 18px}
.card{background:var(--pnl);border:1px solid var(--lin);border-radius:8px;padding:10px 12px;min-width:150px}
.card-nome{font-weight:600;margin-bottom:6px;color:#fff}
.card-lin{color:var(--dim);font-size:12px}
.card-lin .v{color:var(--tx);font-weight:600}
.card-lin.g .v{color:#3fb950}.card-lin.m .v{color:#bc8cff}.card-lin.r .v{color:#f85149}
.barra{display:flex;flex-wrap:wrap;gap:8px;padding:0 18px 12px;align-items:center}
input,select,button{background:var(--pnl);color:var(--tx);border:1px solid var(--lin);
border-radius:6px;padding:6px 9px;font:inherit}
button{cursor:pointer}button:hover{border-color:var(--dim)}
button.ativo{background:#1f2937;border-color:#3fb950;color:#fff}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:7px 9px;border-bottom:1px solid var(--lin);text-align:left;vertical-align:top}
th{position:sticky;top:0;background:#11161d;color:var(--dim);cursor:pointer;user-select:none;white-space:nowrap}
tbody tr:hover{background:#12181f}
td.conta{font-family:Consolas,monospace;white-space:nowrap}
td.num{text-align:right;white-space:nowrap}
td.det{color:var(--dim);max-width:340px}
td.bonus{white-space:nowrap}
.chip{display:inline-block;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:700;color:#fff;white-space:nowrap}
.chip.bonus{background:var(--m)}.chip.hit{background:var(--g)}.chip.sem_saldo{background:var(--y)}
.chip.proibida{background:var(--r)}.chip.senha{background:var(--b)}.chip.nao_existe{background:var(--gy)}
.chip.captcha{background:#9e6a03}.chip.bloqueio{background:#8b3a1f}.chip.schema{background:#5a3b8b}
.chip.rate{background:#7a5c00}.chip.inconclusivo{background:#5a4b13}.chip.erro{background:#6e2b2b}
.vazio{padding:30px;text-align:center;color:var(--dim)}
</style></head><body>
<header>
<h1>Relatório de check</h1>
<div class="sub">${inicio ? inicio.toLocaleString("pt-BR") : ""} · ${linhas.length} conta(s) processada(s) · ${casasAlvo.length} casa(s)</div>
</header>
<div class="cards">${cards}</div>
<div class="barra">
  <input id="busca" placeholder="buscar conta, nome, CPF...">
  <select id="casa"><option value="">todas as casas</option>${opcoesCasa}</select>
  <button data-tipo="">todos</button>
  <button data-tipo="bonus">bônus</button>
  <button data-tipo="hit">hits</button>
  <button data-tipo="sem_saldo">sem saldo</button>
  <button data-tipo="proibida">proibidas</button>
  <button data-tipo="senha">senha errada</button>
  <button data-tipo="nao_existe">não existe</button>
  <button data-tipo="inconclusivo">inconclusivo</button>
  <button data-tipo="erro">erro</button>
</div>
<table id="tabela">
<thead><tr>
<th data-col="0">casa</th><th data-col="1">conta</th><th data-col="2">status</th>
<th data-col="3">saldo</th><th data-col="4">vip</th><th data-col="5">nome</th>
<th data-col="6">cpf</th><th data-col="7">bônus</th><th>detalhe</th>
</tr></thead>
<tbody>${corpo || `<tr><td colspan="9" class="vazio">nada registrado</td></tr>`}</tbody>
</table>
<script>
const tb = document.querySelector("#tabela tbody");
const busca = document.querySelector("#busca");
const selCasa = document.querySelector("#casa");
let tipoAtual = "";
function filtrar() {
  const q = busca.value.toLowerCase();
  const casa = selCasa.value;
  for (const tr of tb.rows) {
    const okTipo = !tipoAtual || tr.dataset.tipo === tipoAtual;
    const okCasa = !casa || tr.dataset.casa === casa;
    const okBusca = !q || tr.textContent.toLowerCase().includes(q);
    tr.style.display = okTipo && okCasa && okBusca ? "" : "none";
  }
}
busca.addEventListener("input", filtrar);
selCasa.addEventListener("change", filtrar);
document.querySelectorAll("button[data-tipo]").forEach((b) => {
  b.addEventListener("click", () => {
    tipoAtual = b.dataset.tipo;
    document.querySelectorAll("button[data-tipo]").forEach((x) => x.classList.remove("ativo"));
    b.classList.add("ativo");
    filtrar();
  });
});
let dir = 1, col = -1;
document.querySelectorAll("th[data-col]").forEach((th) => {
  th.addEventListener("click", () => {
    const c = Number(th.dataset.col);
    dir = c === col ? -dir : 1;
    col = c;
    const linhas = [...tb.rows];
    linhas.sort((a, b) => {
      const x = a.cells[c]?.textContent.trim() || "";
      const y = b.cells[c]?.textContent.trim() || "";
      const nx = Number(x.replace(/[^\\d,]/g, "").replace(",", "."));
      const ny = Number(y.replace(/[^\\d,]/g, "").replace(",", "."));
      if (Number.isFinite(nx) && Number.isFinite(ny) && c === 3) return (nx - ny) * dir;
      return x.localeCompare(y) * dir;
    });
    for (const l of linhas) tb.appendChild(l);
  });
});
document.querySelector('button[data-tipo=""]').classList.add("ativo");
</script>
</body></html>`;

  fs.writeFileSync(arquivo, html, "utf-8");
  try { fs.copyFileSync(arquivo, path.join(DIR, "relatorio.html")); } catch {}
  return arquivo;
}
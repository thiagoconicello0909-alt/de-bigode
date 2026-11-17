import fs from "fs";

let lista = [];
let idx = 0;
const cooldown = new Map();
const BAN_PADRAO = 5 * 60 * 1000;

export function normalizar(linha) {
  let l = String(linha).trim().replace(/\s+/g, "");
  if (!l) return null;
  if (/^(https?|socks5):\/\//i.test(l)) return l;

  const p = l.split(":");
  if (p.length === 2) return `http://${p[0]}:${p[1]}`;
  if (p.length === 4) return `http://${p[2]}:${p[3]}@${p[0]}:${p[1]}`;
  if (p.length === 3) return `http://${p[1]}:${p[2]}@${p[0]}`;
  return null;
}

export function loadProxies(arquivo) {
  lista = [];
  idx = 0;
  cooldown.clear();
  let bruto = [];
  try {
    bruto = fs.readFileSync(arquivo, "utf8").split(/\r?\n/);
  } catch {
    return 0;
  }

  const vistos = new Set();
  let invalidas = 0;
  for (const linha of bruto) {
    if (!linha.trim() || linha.trim().startsWith("#")) continue;
    const url = normalizar(linha);
    if (!url) { invalidas++; continue; }
    if (vistos.has(url)) continue;
    vistos.add(url);
    lista.push(url);
  }

  if (invalidas) console.log(`  ⚠ ${invalidas} proxy(s) em formato irreconhecível`);
  return lista.length;
}

/** Gateway rotativo tem 1 entrada: banir por 45s derruba tudo para a conexão direta. */
export function banirProxy(proxy, ms = BAN_PADRAO) {
  if (!proxy) return;
  const msFinal = lista.length <= 1 ? Math.min(ms, 5000) : ms;
  cooldown.set(proxy, Date.now() + msFinal);
}

export function proxiesLivres() {
  const agora = Date.now();
  return lista.filter((p) => (cooldown.get(p) || 0) <= agora).length;
}

/** Só devolve proxy com cooldown vencido. Se todos estão de castigo, devolve null (vai direto). */
export function getNextProxy() {
  if (!lista.length) return null;
  const agora = Date.now();
  for (let i = 0; i < lista.length; i++) {
    const p = lista[(idx + i) % lista.length];
    if ((cooldown.get(p) || 0) <= agora) {
      idx = (idx + i + 1) % lista.length;
      return p;
    }
  }
  return null;
}

export const getProxyCount = () => lista.length;
export const listarProxies = () => [...lista];
export const proxiesBanidos = () => [...cooldown.values()].filter((t) => t > Date.now()).length;
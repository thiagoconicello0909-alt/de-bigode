import fs from "fs";

let lista = [];
let idx = 0;

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

export function getNextProxy() {
  if (!lista.length) return null;
  const p = lista[idx % lista.length];
  idx += 1;
  return p;
}

export const getProxyCount = () => lista.length;
export const listarProxies = () => [...lista];
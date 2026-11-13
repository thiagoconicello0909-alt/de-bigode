// caminhos canônicos do projeto
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(AQUI, "..");

export const DB = path.join(ROOT, "db");
export const HITS = path.join(ROOT, "hits");
export const SONDA = path.join(DB, "sonda");
export const PROCS = path.join(DB, "procs");
export const CASAS_FILE = path.join(DB, "casas.json");
export const CONFIG_FILE = path.join(DB, "config.json");
export const CAPTCHA_FILE = path.join(DB, "captcha_config.json");
export const CONTAS_FILE = path.join(ROOT, "contas.txt");
export const PROXY_FILE = path.join(ROOT, "proxy.txt");

export function garantirPastas() {
  for (const p of [DB, HITS, SONDA, PROCS]) fs.mkdirSync(p, { recursive: true });
}
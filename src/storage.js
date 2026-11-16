import fs from "fs";
import path from "path";
import { ROOT } from "./paths.js";

const DB_DIR = path.join(ROOT, "db");
const CASAS_FILE = path.join(DB_DIR, "casas.json");
const CONFIG_FILE = path.join(DB_DIR, "config.json");
const PROBE_DIR = path.join(DB_DIR, "probe");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadCasas() {
  try {
    if (!fs.existsSync(CASAS_FILE)) return {};
    const data = JSON.parse(fs.readFileSync(CASAS_FILE, "utf-8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function saveCasas(casas) {
  ensureDir(DB_DIR);
  fs.writeFileSync(CASAS_FILE, JSON.stringify(casas, null, 2), "utf-8");
}

const DEFAULT_CONFIG = {
  threads: 5,
  delay: 300,
  minBalance: 3,
  minVip: 3,
  sound: true,
  notify: true,
  probeOnRun: false,
  txtDetalhado: true,
  filtro9: false,
};

export function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  ensureDir(DB_DIR);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...DEFAULT_CONFIG, ...config }, null, 2), "utf-8");
}

export function probeFile(name) {
  ensureDir(PROBE_DIR);
  return path.join(PROBE_DIR, `${name.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

export function loadProbe(name) {
  try {
    const file = probeFile(name);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function saveProbe(name, data) {
  fs.writeFileSync(probeFile(name), JSON.stringify(data, null, 2), "utf-8");
}
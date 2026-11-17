import { v4 as uuidv4 } from "uuid";
import { STATIC_TOKEN } from "./crypto.js";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomStr(len = 64, chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/") {
  let r = "";
  for (let i = 0; i < len; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

const DEVICES = [
  { brand: "samsung",  model: "SM-G998B" },
  { brand: "samsung",  model: "SM-G991B" },
  { brand: "samsung",  model: "SM-A528B" },
  { brand: "xiaomi",   model: "Redmi Note 12" },
  { brand: "motorola", model: "moto g82" },
];

function pickDevice() {
  return DEVICES[Math.floor(Math.random() * DEVICES.length)];
}

function flashUA(model) {
  const av = randInt(11, 14), cv = randInt(120, 136), sv = randInt(1000, 9900), mv = randInt(50, 199);
  return `Mozilla/5.0 (Linux; Android ${av}; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${cv}.0.${sv}.${mv} Mobile Safari/537.36 speed/1.1.52`;
}

export function buildHeaders(domain, siteCode) {
  const d = pickDevice();
  const nowup = Date.now();
  return {
    "Accept-Encoding": "identity",
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "content-type": "application/json",
    "sec-ch-ua": `"Not A;Brand";v="99", "Chromium";v="124"`,
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": `"Android"`,
    domain,
    platformType: 5,
    Nonce: uuidv4(),
    siteCode: siteCode ? String(siteCode) : "",
    "x-custom-referer": `https://${domain}`,
    Referer: `https://${domain}/`,
    Origin: `https://${domain}`,
    appversion: "1.1.97",
    currency: "BRL",
    auth: "",
    physicaldevicemodel: `${d.brand} ${d.model}`,
    devicemodel: `${d.brand} ${d.model}`,
    timestamp: Math.floor(nowup / 1000),
    clientTimeZone: "-3",
    token: STATIC_TOKEN,
    newJwt: "",
    language: "pt",
    "accept-language": "pt-BR,pt;q=0.9",
    "user-agent": flashUA(d.model),
    host: domain,
    connection: "Keep-Alive",
    "x-data-mode": "json_cipher",
    "x-version": "7.1.97",
    "x-request-id": uuidv4(),
    sign: randomStr(),
    "Cache-Control": "no-cache",
    "x-object-id": JSON.stringify({
      uid: "", browserLanguage: "pt-BR",
      init: { device: "", created: nowup, version: nowup - randInt(1e6, 5e6) },
    }),
  };
}
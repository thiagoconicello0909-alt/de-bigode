import fs from "fs";
import path from "path";
import { ROOT } from "./src/paths.js";

const ARQ = path.join(ROOT, "db", "casas.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";
const CHUA = '"Not-A.Brand";v="99", "Microsoft Edge";v="157", "Chromium";v="157"';
const SK_BODY = "0x4AAAAAAAiHEkDee-yqSdMj";
const SK_HEAD = "0x4AAAAAAB0oRY23FyZnllMo";

function casa(dominio, apiHost, tenantId, deviceId, versao, user, pass) {
  return {
    domain: dominio,
    apiHost,
    tenantId,
    loginPath: "/api/frontend/trpc/auth.login",
    tokenPath: "/api/frontend/trpc/auth.token",
    deviceId,
    clientVersion: versao,
    deviceType: "DesktopOS",
    captchaId: SK_BODY,
    browserLogin: true,
    browserPages: 2,
    channelId: 0,
    turnstile: {
      sitekeyBody: SK_BODY,
      sitekeyHeader: SK_HEAD,
      action: "api_protection",
      actionBody: "login",
    },
    headers: {
      accept: "*/*",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
      "client-language": "pt-BR",
      "content-type": "application/json",
      "sec-ch-ua": CHUA,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      tenantid: tenantId,
      "user-agent": UA,
      "x-client-version": versao,
      "x-device-type": "DesktopOS",
    },
    authScheme: "Bearer",
    bodyTemplate: JSON.stringify({
      json: {
        username: user,
        password: pass,
        hToken: null,
        lastLoginDevice: deviceId,
        loginDeviceModel: "web Windows NT 10.0 windows Windows NT 10.0; Win64; x64",
        appType: "DesktopOS",
        channelId: 0,
      },
      meta: { values: { hToken: ["undefined"] } },
    }),
    passMode: "plain",
    lang: "pt",
    rotativa: true,
    perfilProcs: ["user.assets", "vip.info"],
  };
}

const casas = {
  "79": casa("79x1.com", "api.ycyd123.com", "8529815", "0847b9c2-50d4-48f4-8d81-359e6fa263b2", "v240", "11986144754", "R@48142260g"),
  "5853": casa("9mulm4.com", "api.ycyd123.com", "9951229", "93729576-5ade-4632-9b0c-1c422fb4f9dd", "v240", "38998812201", "thauan1538"),
  "57a": casa("f893bij3.com", "api.ycyd123.com", "6155813", "7f7481e4-7d04-40da-a28f-5fa58ba88399", "v240", "61995932899", "Conicello09_"),
  "w78": casa("w78777.com", "api2.ycyd123.com", "1610468", "4b818150-e138-4fd4-82fb-ed550cd39d61", "v242", "51999373230", "Nando3315"),
  "3539": casa("3539a.com", "api.ycyd123.com", "3606032", "b390bcc6-7132-4af3-92e2-284c08f7bdc6", "v240", "51980480962", "cachima31"),
  "28g": casa("28g88yy.com", "api.ycyd123.com", "9412481", "eaf47d84-583e-49e3-bccf-a191ab195ec4", "v240", "45991055353", "Conicello09_"),
};

try {
  fs.writeFileSync(`${ARQ}.quebrado`, fs.readFileSync(ARQ, "utf-8"), "utf-8");
} catch {}

const texto = JSON.stringify(casas, null, 2);
JSON.parse(texto);
fs.writeFileSync(ARQ, texto, "utf-8");

console.log(`  bytes: ${fs.statSync(ARQ).size}`);
console.log(`  casas gravadas: ${Object.keys(casas).join(" ")}`);
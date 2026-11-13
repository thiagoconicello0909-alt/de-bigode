const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function buildHeaders(domain, siteCode = "") {
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const headers = {
    "user-agent": UA,
    accept: "application/json, text/plain, */*",
    "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
    "content-type": "application/json",
    origin: `https://${host}`,
    referer: `https://${host}/`,
    "x-device-type": "DesktopOS",
    "x-client-version": "v242",
    "x-request-source": "web_client",
  };
  if (siteCode) headers.sitecode = String(siteCode);
  return headers;
}

export default buildHeaders;
import sys
import threading
import json
import time
import queue
import socketserver
from http.server import HTTPServer, BaseHTTPRequestHandler
import tls_client

_SESSION_POOL_SIZE = 60
_session_pool = None
_pool_lock = threading.Lock()

_CONCURRENCY = 40
_sem = threading.Semaphore(_CONCURRENCY)

# UA/sec-ch-ua coerentes com cada impersonação. O UA da casa é ignorado.
PROFILES = {
    "chrome_133": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        '"Chromium";v="133", "Not(A:Brand";v="24", "Google Chrome";v="133"',
        "Windows",
    ),
    "chrome_131": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        '"Chromium";v="131", "Not(A:Brand";v="24", "Google Chrome";v="131"',
        "Windows",
    ),
    "chrome_124": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        '"Chromium";v="124", "Not(A:Brand";v="24", "Google Chrome";v="124"',
        "Windows",
    ),
    "chrome_120": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "Windows",
    ),
    "firefox_120": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
        None,
        None,
    ),
}

_IDENTS = list(PROFILES.keys())

CF_MARKS = ("just a moment", "attention required", "cf-challenge", "cf_chl_opt", "checking your browser", "__cf_chl")

TIMEOUT_REQ = 15
MAX_TENT = 2


class SessionPool:
    def __init__(self, size):
        self._size = size
        self._sessions = queue.Queue(maxsize=size)
        threading.Thread(target=self._prefill, daemon=True).start()

    def _prefill(self):
        for _ in range(self._size):
            item = self._make_session()
            if item:
                try:
                    self._sessions.put_nowait(item)
                except queue.Full:
                    break

    def _make_session(self):
        for ident in _IDENTS:
            try:
                s = tls_client.Session(client_identifier=ident, random_tls_extension_order=True)
                return (s, ident)
            except Exception:
                pass
        return None

    def acquire(self, timeout=5):
        try:
            return self._sessions.get(timeout=timeout)
        except queue.Empty:
            return self._make_session()

    def release(self, item):
        try:
            self._sessions.put_nowait(item)
        except queue.Full:
            try:
                item[0].close()
            except Exception:
                pass


def get_pool():
    global _session_pool
    if _session_pool is None:
        with _pool_lock:
            if _session_pool is None:
                _session_pool = SessionPool(_SESSION_POOL_SIZE)
    return _session_pool


def soltar(item, com_proxy):
    """Com proxy: fecha a sessão para o gateway sortear IP novo na próxima.
    Sem proxy: devolve ao pool."""
    if com_proxy:
        try:
            item[0].close()
        except Exception:
            pass
        return
    get_pool().release(item)


def descartar(item, com_proxy):
    try:
        item[0].close()
    except Exception:
        pass
    if com_proxy:
        return
    novo = get_pool()._make_session()
    if novo:
        get_pool().release(novo)


def aplicar_perfil(headers_clean, ident):
    forcado = headers_clean.pop("x-force-ua", None)
    if forcado:
        headers_clean["user-agent"] = forcado
        for k in list(headers_clean):
            if k.lower().startswith("sec-ch-ua"):
                headers_clean.pop(k, None)
        return headers_clean
    ua, chua, plat = PROFILES.get(ident, PROFILES["chrome_120"])
    headers_clean["user-agent"] = ua
    if chua:
        headers_clean["sec-ch-ua"] = chua
        headers_clean["sec-ch-ua-mobile"] = "?0"
        headers_clean["sec-ch-ua-platform"] = '"%s"' % plat
    else:
        for k in list(headers_clean):
            if k.lower().startswith("sec-ch-ua"):
                headers_clean.pop(k, None)
    return headers_clean


def eh_desafio(status, texto):
    if status in (403, 429, 503):
        return True
    amostra = (texto or "")[:1500].lower()
    return any(m in amostra for m in CF_MARKS)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, status, obj):
        body = json.dumps(obj).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path == "/health":
            pool = get_pool()
            self.send_json(200, {"status": "ok", "pool": pool._sessions.qsize(), "sem": _sem._value})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/post", "/get"):
            self.send_json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except Exception:
            self.send_json(400, {"error": "json invalido"})
            return

        url = data.get("url")
        headers = data.get("headers", {})
        body = data.get("body", "")
        proxy_url = data.get("proxy")
        com_proxy = bool(proxy_url)

        if not url:
            self.send_json(400, {"error": "url obrigatoria"})
            return

        skip = {"content-length", "transfer-encoding", "connection", "host",
                "user-agent", "accept-encoding"}
        headers_clean = {k: v for k, v in headers.items() if k.lower() not in skip}
        if "content-type" not in {k.lower() for k in headers_clean}:
            headers_clean["content-type"] = "text/plain"

        body_bytes = body.encode("utf-8") if isinstance(body, str) else (body or b"")

        acquired = _sem.acquire(blocking=True, timeout=15)
        if not acquired:
            self.send_json(503, {"error": "proxy sobrecarregado"})
            return

        last_err = None
        try:
            for attempt in range(MAX_TENT):
                # com proxy: sessão nova a cada tentativa = IP novo no gateway
                item = get_pool()._make_session() if com_proxy else get_pool().acquire(timeout=5)
                if item is None:
                    last_err = "sem sessao disponivel"
                    time.sleep(0.25)
                    continue

                session, ident = item
                try:
                    session.proxies = {"http": proxy_url, "https": proxy_url} if com_proxy else {}
                    hdrs = aplicar_perfil(dict(headers_clean), ident)

                    if self.path == "/get":
                        resp = session.get(url, headers=hdrs, timeout_seconds=TIMEOUT_REQ, allow_redirects=False)
                    else:
                        resp = session.post(url, data=body_bytes, headers=hdrs, timeout_seconds=TIMEOUT_REQ, allow_redirects=False)

                    texto = resp.text or ""

                    if resp.status_code == 407:
                        descartar(item, com_proxy)
                        last_err = "407 Proxy Authentication Required"
                        time.sleep(0.3 * (attempt + 1))
                        continue

                    if eh_desafio(resp.status_code, texto) and attempt < MAX_TENT - 1:
                        descartar(item, com_proxy)
                        last_err = "desafio cloudflare (%s)" % resp.status_code
                        time.sleep(0.5 + attempt * 0.4)
                        continue

                    soltar(item, com_proxy)
                    self.send_json(200, {
                        "status": resp.status_code,
                        "text": texto,
                        "headers": dict(resp.headers),
                        "ident": ident,
                    })
                    return
                except Exception as e:
                    last_err = str(e)
                    descartar(item, com_proxy)
                    if attempt < MAX_TENT - 1:
                        time.sleep(0.25)
        finally:
            _sem.release()

        self.send_json(502, {"error": last_err})


class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 512
    block_on_close = False


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3334
    get_pool()
    server = ThreadedHTTPServer(("127.0.0.1", port), Handler)
    print(f"[TLSProxy] Iniciando na porta {port} | concorrencia={_CONCURRENCY} | rotacao=por_request", flush=True)
    server.serve_forever()
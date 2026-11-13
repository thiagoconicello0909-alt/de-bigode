import sys
import threading
import json
import time
import queue
import socketserver
from http.server import HTTPServer, BaseHTTPRequestHandler
import tls_client

_SESSION_POOL_SIZE = 80
_session_pool = None
_pool_lock = threading.Lock()

_CONCURRENCY = 60
_sem = threading.Semaphore(_CONCURRENCY)

class SessionPool:
    def __init__(self, size):
        self._size = size
        self._sessions = queue.Queue(maxsize=size)
        threading.Thread(target=self._prefill, daemon=True).start()

    def _prefill(self):
        for _ in range(self._size):
            s = self._make_session()
            if s:
                try:
                    self._sessions.put_nowait(s)
                except queue.Full:
                    break

    def _make_session(self):
        for ident in ["chrome_120", "chrome_107", "chrome_103", "firefox_108"]:
            try:
                return tls_client.Session(client_identifier=ident, random_tls_extension_order=True)
            except Exception:
                pass
        return None

    def acquire(self, timeout=5):
        try:
            return self._sessions.get(timeout=timeout)
        except queue.Empty:
            return self._make_session()

    def release(self, session):
        try:
            self._sessions.put_nowait(session)
        except queue.Full:
            try:
                session.close()
            except Exception:
                pass

    def descartar(self, session):
        """Fecha a sessao e repoe o pool (usado quando o proxy esta ruim)."""
        try:
            session.close()
        except Exception:
            pass
        nova = self._make_session()
        if nova:
            self.release(nova)

def get_pool():
    global _session_pool
    if _session_pool is None:
        with _pool_lock:
            if _session_pool is None:
                _session_pool = SessionPool(_SESSION_POOL_SIZE)
    return _session_pool

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

        if not url:
            self.send_json(400, {"error": "url obrigatoria"})
            return

        skip = {"content-length", "transfer-encoding", "connection", "host"}
        headers_clean = {k: v for k, v in headers.items() if k.lower() not in skip}
        if "content-type" not in {k.lower() for k in headers_clean}:
            headers_clean["content-type"] = "text/plain"

        body_bytes = body.encode("utf-8") if isinstance(body, str) else (body or b"")

        acquired = _sem.acquire(blocking=True, timeout=10)
        if not acquired:
            self.send_json(503, {"error": "proxy sobrecarregado"})
            return

        pool = get_pool()
        last_err = None
        try:
            for attempt in range(2):
                session = pool.acquire(timeout=5)
                if session is None:
                    last_err = "sem sessao disponivel"
                    time.sleep(0.2)
                    continue
                try:
                    session.proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else {}
                    if self.path == "/get":
                        resp = session.get(
                            url,
                            headers=headers_clean,
                            timeout_seconds=18,
                            allow_redirects=False,
                        )
                    else:
                        resp = session.post(
                            url,
                            data=body_bytes,
                            headers=headers_clean,
                            timeout_seconds=18,
                            allow_redirects=False,
                        )
                    if resp.status_code == 407:
                        # sessao ficou com socket preso no proxy ruim: descarta e repoe
                        pool.descartar(session)
                        last_err = "407 Proxy Authentication Required"
                        if attempt < 1:
                            time.sleep(0.5 * (attempt + 1))
                        continue
                    pool.release(session)
                    resp_text = resp.text or ""
                    resp_headers = dict(resp.headers)
                    self.send_json(200, {"status": resp.status_code, "text": resp_text, "headers": resp_headers})
                    return
                except Exception as e:
                    last_err = str(e)
                    pool.descartar(session)
                    if attempt < 1:
                        time.sleep(0.2)
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
    print(f"[TLSProxy] Iniciando na porta {port} | concorrencia={_CONCURRENCY}...", flush=True)
    server.serve_forever()
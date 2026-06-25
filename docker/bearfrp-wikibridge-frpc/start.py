from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path


API_URL = os.getenv("BEARFRP_API_URL", "http://bearfrp:8000").rstrip("/")
STATE_DIR = Path(os.getenv("FRPC_STATE_DIR", "/state"))
FRP_VERSION = os.getenv("BEARFRP_FRPS_VERSION", "v0.58.1")
FRPC_SERVER_ADDR = os.getenv("BEARFRP_FRPC_SERVER_ADDR", "bearfrp")
FRPC_SERVER_PORT = int(os.getenv("BEARFRP_FRPC_SERVER_PORT", "7000"))

USERNAME = os.getenv("WIKIBRIDGE_BEARFRP_USER", "wikibridge")
PASSWORD = os.getenv("WIKIBRIDGE_BEARFRP_PASSWORD", "wikibridge-change-me")
PROXY_NAME = os.getenv("WIKIBRIDGE_BEARFRP_PROXY_NAME", "wikibridge")
PROXY_TYPE = os.getenv("WIKIBRIDGE_BEARFRP_PROXY_TYPE", "tcp").lower()
LOCAL_IP = os.getenv("WIKIBRIDGE_BEARFRP_LOCAL_IP", "nginx")
LOCAL_PORT = int(os.getenv("WIKIBRIDGE_BEARFRP_LOCAL_PORT", "80"))
SUBDOMAIN = os.getenv("WIKIBRIDGE_BEARFRP_SUBDOMAIN", "wikibridge")
TRAFFIC_MB = int(os.getenv("WIKIBRIDGE_BEARFRP_TRAFFIC_MB", "100"))
SPEED_LIMIT_KBPS = int(os.getenv("WIKIBRIDGE_BEARFRP_SPEED_LIMIT_KBPS", "1024"))


cookie_jar = CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))


def main() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    wait_for_api()
    login_or_register()
    ensure_balance()
    proxy = ensure_proxy()
    public_url = proxy.get("public_url") or (proxy.get("public_urls") or [None])[0]
    if public_url:
        print(f"WikiBridge BearFRP URL: {public_url}", flush=True)
    config = get_frpc_config(proxy["id"])
    config = rewrite_server(config)
    config_path = STATE_DIR / "frpc.toml"
    config_path.write_text(config, encoding="utf-8")
    frpc_path = ensure_frpc()
    os.execv(str(frpc_path), [str(frpc_path), "-c", str(config_path)])


def wait_for_api() -> None:
    for _ in range(90):
        try:
            request_json("GET", "/api/show/online")
            return
        except Exception as exc:
            print(f"Waiting for BearFRP API: {exc}", flush=True)
            time.sleep(2)
    raise RuntimeError("BearFRP API did not become ready")


def login_or_register() -> None:
    body = {"username": USERNAME, "password": PASSWORD}
    try:
        request_json("POST", "/api/user/register", body)
        return
    except urllib.error.HTTPError as exc:
        if exc.code != 400:
            raise
    request_json("POST", "/api/user/login", body)


def ensure_balance() -> None:
    user = request_json("GET", "/api/user/me")
    balance = int(user.get("balance_mb") or 0)
    while balance < TRAFFIC_MB:
        user = request_json("POST", "/api/user/recharge")
        next_balance = int(user.get("balance_mb") or balance)
        if next_balance <= balance:
            raise RuntimeError("Unable to recharge enough BearFRP demo traffic")
        balance = next_balance


def ensure_proxy() -> dict[str, object]:
    existing = find_proxy()
    if existing:
        if existing.get("proxy_type") != PROXY_TYPE:
            raise RuntimeError(
                f"Existing proxy {PROXY_NAME!r} has type {existing.get('proxy_type')!r}, "
                f"expected {PROXY_TYPE!r}"
            )
        response = request_json("PATCH", f"/api/proxies/{existing['id']}", proxy_body(update=True))
        return response["proxy"]

    try:
        response = request_json("POST", "/api/proxies", proxy_body(update=False))
    except urllib.error.HTTPError as exc:
        if exc.code != 400:
            raise
        ensure_balance()
        response = request_json("POST", "/api/proxies", proxy_body(update=False))
    return response["proxy"]


def find_proxy() -> dict[str, object] | None:
    response = request_json("GET", "/api/proxies")
    for proxy in response.get("proxies", []):
        if proxy.get("name") == PROXY_NAME and proxy.get("status") != "deleted":
            return proxy
    return None


def proxy_body(update: bool) -> dict[str, object]:
    body: dict[str, object] = {
        "name": PROXY_NAME,
        "speed_limit_kbps": SPEED_LIMIT_KBPS,
        "local_ip": LOCAL_IP,
        "local_port": LOCAL_PORT,
    }
    if not update:
        body["proxy_type"] = PROXY_TYPE
        body["traffic_mb"] = TRAFFIC_MB
    if PROXY_TYPE == "http":
        body["subdomain"] = SUBDOMAIN
    elif PROXY_TYPE == "tcp" and not update:
        body["tcp_ports"] = {
            "mode": "auto",
            "count": 1,
            "local_start_port": LOCAL_PORT,
        }
    return body


def get_frpc_config(proxy_id: object) -> str:
    response = request_json("GET", f"/api/proxies/{proxy_id}/scripts")
    config = response.get("frpc_config")
    if not isinstance(config, str) or not config.strip():
        raise RuntimeError("BearFRP did not return frpc_config")
    return config


def rewrite_server(config: str) -> str:
    config = re.sub(r'^serverAddr\s*=\s*".*"$', f'serverAddr = "{FRPC_SERVER_ADDR}"', config, count=1, flags=re.M)
    config = re.sub(r"^serverPort\s*=\s*\d+$", f"serverPort = {FRPC_SERVER_PORT}", config, count=1, flags=re.M)
    return config


def ensure_frpc() -> Path:
    frpc_path = STATE_DIR / "frpc"
    if frpc_path.exists() and os.access(frpc_path, os.X_OK):
        return frpc_path

    version_without_v = FRP_VERSION[1:] if FRP_VERSION.startswith("v") else FRP_VERSION
    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64"}:
        arch = "amd64"
    elif machine in {"aarch64", "arm64"}:
        arch = "arm64"
    else:
        raise RuntimeError(f"Unsupported architecture: {machine}")

    url = (
        f"https://github.com/fatedier/frp/releases/download/{FRP_VERSION}/"
        f"frp_{version_without_v}_linux_{arch}.tar.gz"
    )
    print(f"Downloading frpc from {url}", flush=True)
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "frp.tar.gz"
        urllib.request.urlretrieve(url, archive)
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(tmp)
        source = next(Path(tmp).glob("frp_*/frpc"), None)
        if source is None:
            raise RuntimeError("frpc binary not found in release archive")
        shutil.copy2(source, frpc_path)
    frpc_path.chmod(0o755)
    return frpc_path


def request_json(method: str, path: str, body: dict[str, object] | None = None) -> dict[str, object]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(API_URL + path, data=data, headers=headers, method=method)
    try:
        with opener.open(request, timeout=10) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"BearFRP API {method} {path} failed: HTTP {exc.code} {detail}", flush=True)
        raise
    if not payload:
        return {}
    return json.loads(payload.decode("utf-8"))


if __name__ == "__main__":
    main()

"""
Deploy raze-ts to raze.retris.io.

Two payloads, deployable independently:

  client  build output `dist/` -> ~/raze-live/dist, served by pm2 app `raze-web`
  relay   bundled multiplayer server -> ~/raze-relay, pm2 app `raze-relay` on 8788

`dist` is ~130 MB / 2200+ files but nearly all of it is unchanged baked art, so
this diffs an md5 manifest and uploads only what differs. The live tree is copied
to `dist.prev` first; rollback is one `mv` on the box.

Credentials: the password is read from the RZ_PASS environment variable and
nowhere else. Never pass it in argv — that puts it in `ps` output and shell
history. Set it for one command only:

    RZ_PASS='...' python tools/deploy.py all          # bash
    $env:RZ_PASS='...'; python tools/deploy.py all    # PowerShell

Usage:
    python tools/deploy.py [client|relay|verify|all] [--dry-run]
"""

import hashlib
import os
import posixpath
import stat
import sys
import time

import paramiko

HOST = "ssh.testservers.online"      # the bare apex is Cloudflare, which drops :22
PORT = 22
USER = "n00bi2761"

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_DIST = os.path.join(HERE, "dist")
LOCAL_RELAY = os.path.join(HERE, "dist-server", "server.mjs")
LOCAL_RELAY_PKG = os.path.join(HERE, "deploy", "relay")

REMOTE_HOME = f"/home/{USER}"
REMOTE_WEB = f"{REMOTE_HOME}/raze-live"
REMOTE_DIST = f"{REMOTE_WEB}/dist"
REMOTE_RELAY = f"{REMOTE_HOME}/raze-relay"

PUBLIC_URL = "https://raze.retris.io"
DRY = "--dry-run" in sys.argv


def log(msg):
    # pm2 and npm emit box-drawing and check marks; a Windows console on cp1252
    # raises UnicodeEncodeError mid-deploy if we hand those straight to print().
    enc = sys.stdout.encoding or "utf-8"
    print(str(msg).encode(enc, "replace").decode(enc, "replace"), flush=True)


def connect():
    pw = os.environ.get("RZ_PASS")
    if not pw:
        sys.exit(
            "RZ_PASS is not set.\n"
            "  bash:       RZ_PASS='...' python tools/deploy.py all\n"
            "  PowerShell: $env:RZ_PASS='...'; python tools/deploy.py all"
        )
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, pw, timeout=30, look_for_keys=False, allow_agent=False)
    return c


def run(ssh, cmd, check=True, quiet=False):
    """Run a remote command; return (rc, stdout, stderr)."""
    _in, out, err = ssh.exec_command(cmd, timeout=600)
    so = out.read().decode("utf-8", "replace")
    se = err.read().decode("utf-8", "replace")
    rc = out.channel.recv_exit_status()
    if not quiet:
        log(f"  $ {cmd}")
        for line in (so + se).strip().splitlines()[:20]:
            log(f"    {line}")
    if check and rc != 0:
        raise RuntimeError(f"remote command failed (rc={rc}): {cmd}\n{se}")
    return rc, so, se


# ---------------------------------------------------------------------------
# manifests
# ---------------------------------------------------------------------------

def local_manifest(root):
    """{relpath(posix): md5hex} for every file under root."""
    out = {}
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            p = os.path.join(dirpath, f)
            rel = os.path.relpath(p, root).replace(os.sep, "/")
            h = hashlib.md5()
            with open(p, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            out[rel] = h.hexdigest()
    return out


def remote_manifest(ssh, root):
    """
    Same shape, from the box.

    `find ... -exec md5sum {} +` must run ALONE. Adding `-printf '%s '` to get
    sizes interleaves every size ahead of the digests, because -printf is
    per-file while -exec + batches; the output is then unparseable and the diff
    silently reports that every file changed.
    """
    rc, so, _ = run(ssh, f"cd {root} 2>/dev/null && find . -type f -exec md5sum {{}} +",
                    check=False, quiet=True)
    if rc != 0:
        return {}
    out = {}
    for line in so.splitlines():
        line = line.rstrip()
        if not line or "  " not in line:
            continue
        digest, path = line.split("  ", 1)
        out[path[2:] if path.startswith("./") else path] = digest
    return out


def sftp_mkdirs(sftp, path):
    parts, cur = path.strip("/").split("/"), ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except IOError:
            sftp.mkdir(cur)


def push_files(sftp, local_root, remote_root, rels):
    made = set()
    for i, rel in enumerate(sorted(rels), 1):
        rpath = posixpath.join(remote_root, rel)
        rdir = posixpath.dirname(rpath)
        if rdir not in made:
            sftp_mkdirs(sftp, rdir)
            made.add(rdir)
        sftp.put(os.path.join(local_root, rel.replace("/", os.sep)), rpath)
        if i % 25 == 0 or i == len(rels):
            log(f"    uploaded {i}/{len(rels)}")


# ---------------------------------------------------------------------------
# client
# ---------------------------------------------------------------------------

def deploy_client(ssh):
    log("\n== client (dist -> ~/raze-live/dist) ==")
    if not os.path.isdir(LOCAL_DIST):
        raise SystemExit("no dist/ — run `npm run build` first")

    log("  hashing local dist ...")
    loc = local_manifest(LOCAL_DIST)
    log("  hashing remote dist ...")
    rem = remote_manifest(ssh, REMOTE_DIST)
    log(f"  local {len(loc)} files / remote {len(rem)} files")

    changed = sorted(k for k, v in loc.items() if rem.get(k) != v)
    removed = sorted(set(rem) - set(loc))
    size = sum(os.path.getsize(os.path.join(LOCAL_DIST, c.replace("/", os.sep))) for c in changed)
    log(f"  {len(changed)} to upload ({size/1e6:.1f} MB), {len(removed)} stale remote files")

    if DRY:
        for c in changed[:25]:
            log(f"    + {c}")
        return
    if not changed and not removed:
        log("  nothing to do")
        return

    ts = time.strftime("%Y%m%d-%H%M%S")
    run(ssh, f"cd {REMOTE_WEB} && rm -rf dist.prev && cp -a dist dist.prev && echo backed-up-{ts}")

    sftp = ssh.open_sftp()
    try:
        push_files(sftp, LOCAL_DIST, REMOTE_DIST, changed)
    finally:
        sftp.close()

    for rel in removed:
        run(ssh, f"rm -f {posixpath.join(REMOTE_DIST, rel)}", check=False, quiet=True)
    if removed:
        log(f"  removed {len(removed)} stale files")

    run(ssh, "pm2 restart raze-web --update-env")


# ---------------------------------------------------------------------------
# relay
# ---------------------------------------------------------------------------

def deploy_relay(ssh):
    log("\n== relay (server.mjs -> ~/raze-relay, pm2) ==")
    if not os.path.isfile(LOCAL_RELAY):
        raise SystemExit("no dist-server/server.mjs — run `npm run server:bundle` first")
    if DRY:
        log("  would upload server.mjs, package.json, ecosystem.config.cjs; npm i; pm2 start")
        return

    run(ssh, f"mkdir -p {REMOTE_RELAY}")
    sftp = ssh.open_sftp()
    try:
        sftp.put(LOCAL_RELAY, f"{REMOTE_RELAY}/server.mjs")
        for f in ("package.json", "ecosystem.config.cjs"):
            sftp.put(os.path.join(LOCAL_RELAY_PKG, f), f"{REMOTE_RELAY}/{f}")
    finally:
        sftp.close()
    log("  uploaded 3 files")

    run(ssh, f"cd {REMOTE_RELAY} && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3")

    # The old relay was a bare `node` process holding 8788. pm2 cannot bind the
    # port until it is gone, so retire it explicitly rather than letting the new
    # app crash-loop on EADDRINUSE.
    rc, so, _ = run(ssh, "pgrep -af 'node .*(server|index)\\.(mjs|ts)' | grep -v pm2 || true", check=False)
    for line in so.strip().splitlines():
        pid = line.split()[0]
        if pid.isdigit():
            log(f"  retiring bare node relay pid {pid}")
            run(ssh, f"kill {pid}", check=False, quiet=True)
    time.sleep(1)

    rc, so, _ = run(ssh, "pm2 describe raze-relay >/dev/null 2>&1 && echo EXISTS || echo NEW",
                    check=False, quiet=True)
    if "EXISTS" in so:
        run(ssh, f"cd {REMOTE_RELAY} && pm2 reload ecosystem.config.cjs --update-env")
    else:
        run(ssh, f"cd {REMOTE_RELAY} && pm2 start ecosystem.config.cjs")
    run(ssh, "pm2 save")
    run(ssh, "pm2 list | sed -n '1,12p'")


# ---------------------------------------------------------------------------
# verify
# ---------------------------------------------------------------------------

def verify(ssh):
    log("\n== verify ==")
    # From the box: the relay answers on loopback.
    run(ssh, "curl -s -m 5 http://127.0.0.1:8788/health || echo LOCAL_HEALTH_FAIL", check=False)
    # Through nginx + TLS: the path the browser actually uses.
    run(ssh, f"curl -s -m 8 {PUBLIC_URL}/raze-ws/health || echo PUBLIC_HEALTH_FAIL", check=False)
    # And the upgrade handshake itself.
    run(ssh, (
        "curl -s -o /dev/null -w '%{http_code}' -m 8 "
        "-H 'Connection: Upgrade' -H 'Upgrade: websocket' "
        "-H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==' "
        f"{PUBLIC_URL}/raze-ws ; echo ' <- expect 101'"
    ), check=False)
    run(ssh, "pm2 jlist | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
             "for(const a of JSON.parse(s))console.log(a.name, a.pm2_env.status, 'restarts='+a.pm2_env.restart_time)})\"",
        check=False)
    # If the upgrade above was not 101, it is almost always the proxy: a
    # `location` without the Upgrade/Connection headers answers 200 with the
    # relay's 426 body instead of switching protocols. Print the block so the
    # cause is visible in the same run rather than a second round trip.
    run(ssh, "grep -A 12 'raze-ws' /etc/nginx/sites-available/raze.retris.io "
             "2>/dev/null || echo '(cannot read nginx config without sudo)'", check=False)


def main():
    what = next((a for a in sys.argv[1:] if not a.startswith("-")), "all")
    if what not in ("client", "relay", "verify", "all"):
        sys.exit(__doc__)
    ssh = connect()
    log(f"connected to {USER}@{HOST}{'  (DRY RUN)' if DRY else ''}")
    try:
        if what in ("client", "all"):
            deploy_client(ssh)
        if what in ("relay", "all"):
            deploy_relay(ssh)
        if what in ("verify", "all") and not DRY:
            verify(ssh)
    finally:
        ssh.close()
    log("\ndone")


if __name__ == "__main__":
    main()

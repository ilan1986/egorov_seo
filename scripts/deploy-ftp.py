#!/usr/bin/env python3
"""Деплой статики Astro (dist/) на FTP-хостинг Reg.ru.
Сохраняет .htaccess на сервере (не трогает). Запуск: python scripts/deploy-ftp.py
Перед запуском собрать сайт: npm run build
"""
import os, sys, pathlib
from ftplib import FTP

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"

def load_env():
    env = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env

def main():
    env = load_env()
    host = env.get("FTP_HOST"); user = env.get("FTP_USER")
    pwd = env.get("FTP_PASS"); remote = env.get("FTP_REMOTE_DIR", "/")
    if not all([host, user, pwd]):
        sys.exit("Нет FTP_HOST/FTP_USER/FTP_PASS в .env")
    if not DIST.exists():
        sys.exit("Нет папки dist/ — сначала выполните: npm run build")

    ftp = FTP(); ftp.connect(host, 21, timeout=60); ftp.login(user, pwd); ftp.encoding = "utf-8"
    made = set()
    def ensure_dir(rd):
        cur = ""
        for part in rd.strip("/").split("/"):
            cur += "/" + part
            if cur in made: continue
            try: ftp.mkd(cur)
            except Exception: pass
            made.add(cur)

    files = [p for p in DIST.rglob("*") if p.is_file()]
    n = 0; total = 0
    for f in files:
        rel = f.relative_to(DIST).as_posix()
        rpath = f"{remote}/{rel}"
        ensure_dir(os.path.dirname(rpath))
        with open(f, "rb") as fh:
            ftp.storbinary(f"STOR {rpath}", fh)
        n += 1; total += f.stat().st_size
    ftp.quit()
    print(f"Деплой завершён: {n} файлов, {total // 1024} КБ → {host}:{remote}")

if __name__ == "__main__":
    main()

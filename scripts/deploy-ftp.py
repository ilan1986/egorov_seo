#!/usr/bin/env python3
"""Деплой статики Astro (dist/) на FTP-хостинг Reg.ru.
Устойчив к флаки-FTP: дельта по sha1 содержимого (не льём неизменившиеся файлы),
пофайловый ретрай с переподключением, реконнект при обрыве соединения.
Сохраняет .htaccess на сервере (не трогает — его нет в dist). Запуск: python scripts/deploy-ftp.py
Перед запуском собрать сайт: npm run build
Переменные: FORCE=1 — залить всё без дельты; FTP_RETRIES=4 — попыток на файл.
"""
import os, sys, time, pathlib, hashlib, json
from ftplib import FTP, error_perm, all_errors

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / "dist" / "client" if (ROOT / "dist" / "client").is_dir() else ROOT / "dist"  # node-standalone -> dist/client, static -> dist

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

class Deployer:
    def __init__(self, host, user, pwd, remote):
        self.host, self.user, self.pwd, self.remote = host, user, pwd, remote
        self.ftp = None
        self.made = set()
        self.connect()

    def connect(self):
        try:
            if self.ftp:
                try: self.ftp.close()
                except Exception: pass
            self.ftp = FTP()
            self.ftp.connect(self.host, 21, timeout=90)
            self.ftp.login(self.user, self.pwd)
            self.ftp.encoding = "utf-8"
            self.made.clear()  # после реконнекта заново гарантируем каталоги
        except all_errors as e:
            raise RuntimeError(f"FTP connect failed: {e}")

    def ensure_dir(self, rd):
        cur = ""
        for part in rd.strip("/").split("/"):
            cur += "/" + part
            if cur in self.made:
                continue
            try: self.ftp.mkd(cur)
            except Exception: pass
            self.made.add(cur)

    def remote_size(self, rpath):
        try:
            return self.ftp.size(rpath)
        except Exception:
            return None

    def upload(self, local, rpath, retries, unchanged=False):
        """Заливает файл с ретраями и реконнектом. Возвращает 'up'|'skip'|'fail'."""
        local_size = local.stat().st_size
        for attempt in range(1, retries + 1):
            try:
                # Дельта по СОДЕРЖИМОМУ (см. manifest ниже), а не по размеру: правка может
                # не менять длину файла — например, когда в HTML меняется только хеш в имени
                # CSS-файла. Такие страницы молча оставались на хостинге старыми.
                # Размер на сервере проверяем дополнительно: файл могли удалить или подменить.
                if not FORCE and unchanged:
                    rs = self.remote_size(rpath)
                    if rs == local_size:
                        return "skip"
                self.ensure_dir(os.path.dirname(rpath))
                with open(local, "rb") as fh:
                    self.ftp.storbinary(f"STOR {rpath}", fh)
                return "up"
            except all_errors as e:
                wait = min(2 ** attempt, 15)
                print(f"  ! {rpath} попытка {attempt}/{retries}: {e} — реконнект через {wait}с", flush=True)
                time.sleep(wait)
                try: self.connect()
                except Exception as ce:
                    print(f"    реконнект не удался: {ce}", flush=True)
        return "fail"

    def close(self):
        try: self.ftp.quit()
        except Exception:
            try: self.ftp.close()
            except Exception: pass

FORCE = os.environ.get("FORCE") in ("1", "true", "yes")

# Слепок того, что уже залито: путь → sha1 содержимого. Лежит рядом с данными агента,
# fan-out ядра этот каталог не трогает. Потерять его не страшно — будет один полный деплой.
MANIFEST = ROOT / "scripts" / "seo-agent" / "data" / "deploy-manifest.json"


def sha1(path):
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest():
    try:
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_manifest(data):
    try:
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception as e:
        print(f"  ! slepok ne sohranyon: {e}", flush=True)

def main():
    env = load_env()
    host = env.get("FTP_HOST"); user = env.get("FTP_USER")
    pwd = env.get("FTP_PASS"); remote = env.get("FTP_REMOTE_DIR", "/")
    retries = int(os.environ.get("FTP_RETRIES", "4"))
    if not all([host, user, pwd]):
        sys.exit("Нет FTP_HOST/FTP_USER/FTP_PASS в .env")
    if not DIST.exists():
        sys.exit("Нет папки dist/ — сначала выполните: npm run build")

    dep = Deployer(host, user, pwd, remote)
    files = [p for p in DIST.rglob("*") if p.is_file()]
    manifest = {} if FORCE else load_manifest()
    fresh = {}
    up = skip = fail = 0; total = 0
    failed_list = []
    for f in files:
        rel = f.relative_to(DIST).as_posix()
        rpath = f"{remote}/{rel}"
        # Файл может исчезнуть между обходом dist (rglob выше) и хэшированием/заливкой, если
        # ПАРАЛЛЕЛЬНЫЙ крон в это время делает `npm run build` (Astro пересобирает dist целиком).
        # Не роняем весь деплой из-за гонки — пропускаем: dist собирается полностью, файл дольётся
        # следующим прогоном. (Иначе один FileNotFoundError валит деплой и шлёт ложный алерт.)
        try:
            digest = sha1(f)
            r = dep.upload(f, rpath, retries, unchanged=(manifest.get(rel) == digest))
            size = f.stat().st_size
        except FileNotFoundError:
            skip += 1
            continue
        if r == "up": up += 1; total += size; fresh[rel] = digest
        elif r == "skip": skip += 1; fresh[rel] = digest
        else: fail += 1; failed_list.append(rel)
    dep.close()
    save_manifest(fresh)

    print(f"Деплой: залито {up}, пропущено (без изменений) {skip}, ошибок {fail} · {total // 1024} КБ → {host}:{remote}")
    if failed_list:
        print("НЕ залиты (повторите деплой):")
        for x in failed_list[:20]:
            print(f"  - {x}")
        sys.exit(1)  # ненулевой код — чтобы cron/скрипт увидел проблему

if __name__ == "__main__":
    main()

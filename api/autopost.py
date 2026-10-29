"""Автопостинг в Threads по очереди queue.csv. Рассчитан на запуск по расписанию (cron, GitHub Actions).

  python autopost.py            опубликовать посты, время которых подошло
  python autopost.py --dry-run  показать, что было бы опубликовано, ничего не отправляя

Настройки берутся из переменных окружения, а если их нет — из файла .env рядом со скриптом:
  ACCESS_TOKEN      токен Threads (python threads_api.py token <code>)
  THREADS_USERNAME  аккаунт, в который разрешено постить, без @. Иначе публикация не начнётся.

queue.csv (UTF-8, разделитель «;»): id;datetime_msk;text;image_url;status
  datetime_msk  «2026-11-03 08:00», московское время
  image_url     пусто — текстовый пост; иначе публичная ссылка на JPEG/PNG
  status        пусто — ждёт; posted:<id> — опубликован; error:<текст> — ошибка; skip — не публиковать
"""
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).parent
QUEUE = HERE / "queue.csv"
GRAPH = "https://graph.threads.net/v1.0"
MSK = timezone(timedelta(hours=3))  # в Москве нет перехода на летнее время
STALE_AFTER = timedelta(hours=6)    # пропущенный больше чем на 6 часов пост не публикуем задним числом
FORBIDDEN = {"zavidovobarn"}
FIELDS = ["id", "datetime_msk", "text", "image_url", "status"]


def setting(name):
    if os.environ.get(name):
        return os.environ[name].strip()
    env = HERE / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    return ""


def call(method, path, params):
    data = urllib.parse.urlencode(params).encode()
    url = GRAPH + path
    if method == "GET":
        url, data = f"{url}?{data.decode()}", None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method), timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"API {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")


def read_queue():
    with open(QUEUE, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


def write_queue(rows):
    with open(QUEUE, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, delimiter=";")
        w.writeheader()
        w.writerows(rows)


def due(rows, now):
    out = []
    for r in rows:
        if r["status"].strip():
            continue
        at = datetime.strptime(r["datetime_msk"].strip(), "%Y-%m-%d %H:%M").replace(tzinfo=MSK)
        if at <= now:
            out.append((r, now - at > STALE_AFTER))
    return out


def check_account(token):
    expected = setting("THREADS_USERNAME").lstrip("@").lower()
    if not expected:
        sys.exit("Не задан THREADS_USERNAME — не знаю, в какой аккаунт можно постить. Остановлено.")
    if expected in FORBIDDEN:
        sys.exit(f"THREADS_USERNAME={expected}: в этот аккаунт постить запрещено. Остановлено.")
    me = call("GET", "/me", {"fields": "username", "access_token": token})
    actual = me.get("username", "").lower()
    if actual != expected or actual in FORBIDDEN:
        sys.exit(f"Токен от аккаунта @{actual}, а разрешён @{expected}. Остановлено, ничего не опубликовано.")
    return actual


def publish(token, text, image_url):
    params = {"text": text, "access_token": token}
    if image_url:
        params.update(media_type="IMAGE", image_url=image_url)
    else:
        params.update(media_type="TEXT")
    container = call("POST", "/me/threads", params)
    time.sleep(30)  # Meta советует ~30 с между созданием контейнера и публикацией
    return call("POST", "/me/threads_publish", {"creation_id": container["id"], "access_token": token})["id"]


def main():
    dry = "--dry-run" in sys.argv
    rows = read_queue()
    now = datetime.now(MSK)
    todo = due(rows, now)
    if not todo:
        print(f"{now:%Y-%m-%d %H:%M} МСК: постов к публикации нет.")
        return
    for r, stale in todo:
        if len(r["text"]) > 500:
            r["status"] = f"error:текст длиннее 500 символов ({len(r['text'])})"
        elif stale:
            r["status"] = "skip:опоздал больше чем на 6 часов"
    ready = [r for r, _ in todo if not r["status"]]
    if dry:
        for r, _ in todo:
            print(f"[{r['status'] or 'К ПУБЛИКАЦИИ'}] {r['id']} {r['datetime_msk']}: {r['text'][:70]!r}")
        return
    token = setting("ACCESS_TOKEN")
    if not token:
        sys.exit("Нет ACCESS_TOKEN. Остановлено.")
    if ready:
        user = check_account(token)
        print(f"Аккаунт @{user} подтверждён.")
    for r in ready:
        try:
            r["status"] = f"posted:{publish(token, r['text'], r['image_url'].strip())}"
            print(f"Опубликован {r['id']} ({r['datetime_msk']}).")
        except Exception as e:
            r["status"] = f"error:{str(e)[:200]}"
            print(f"Ошибка {r['id']}: {e}")
    write_queue(rows)


if __name__ == "__main__":
    main()

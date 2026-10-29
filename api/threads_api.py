"""Threads API: токен и публикация. Только стандартная библиотека Python.

Команды (запускать из папки api):
  python threads_api.py token <code>   обменять code из адресной строки на токен на 60 дней
  python threads_api.py refresh        продлить токен ещё на 60 дней (раньше чем через 24 ч после выдачи нельзя)
  python threads_api.py me             проверить токен: показать аккаунт
  python threads_api.py limit          сколько постов осталось в лимите за 24 ч
  python threads_api.py post "текст"   опубликовать текстовый пост (до 500 символов)

Секрет и токен лежат в файле .env рядом со скриптом. Его никуда не отправляем и не публикуем.
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

ENV = Path(__file__).with_name(".env")
GRAPH = "https://graph.threads.net"
REDIRECT_URI = "https://www.google.com/"


def load_env():
    if not ENV.exists():
        sys.exit(f"Нет файла {ENV}. Скопируйте .env.example в .env и впишите APP_SECRET.")
    env = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def save_env(env):
    lines = [f"{k}={v}" for k, v in env.items()]
    ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")


def call(method, path, params):
    data = urllib.parse.urlencode(params).encode()
    url = GRAPH + path
    if method == "GET":
        url, data = f"{url}?{data.decode()}", None
    req = urllib.request.Request(url, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit(f"Ошибка API {e.code}: {body}")


def store_long_token(env, resp):
    env["ACCESS_TOKEN"] = resp["access_token"]
    expires = datetime.now() + timedelta(seconds=int(resp.get("expires_in", 5184000)))
    env["TOKEN_EXPIRES"] = expires.strftime("%Y-%m-%d")
    save_env(env)
    print(f"Токен сохранён в .env, действует до {env['TOKEN_EXPIRES']}.")
    print("Продлить: python threads_api.py refresh (раз в 30–50 дней).")


def cmd_token(code):
    env = load_env()
    code = code.split("#")[0].strip()
    short = call("POST", "/oauth/access_token", {
        "client_id": env["APP_ID"],
        "client_secret": env["APP_SECRET"],
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI,
    })
    env["USER_ID"] = str(short["user_id"])
    long = call("GET", "/access_token", {
        "grant_type": "th_exchange_token",
        "client_secret": env["APP_SECRET"],
        "access_token": short["access_token"],
    })
    me = call("GET", "/v1.0/me", {"fields": "username", "access_token": long["access_token"]})
    if me.get("username", "").lower() == "zavidovobarn":
        sys.exit("Вход выполнен в @zavidovobarn — этот аккаунт для автопостинга не используем. "
                 "Выйдите из него на threads.com, войдите в нужный и получите новый code.")
    print(f"Токен выдан для аккаунта @{me.get('username')}.")
    env["THREADS_USERNAME"] = me.get("username", "")
    store_long_token(env, long)


def cmd_refresh():
    env = load_env()
    resp = call("GET", "/refresh_access_token", {
        "grant_type": "th_refresh_token",
        "access_token": env["ACCESS_TOKEN"],
    })
    store_long_token(env, resp)


def cmd_me():
    env = load_env()
    me = call("GET", "/v1.0/me", {"fields": "id,username,name", "access_token": env["ACCESS_TOKEN"]})
    print(f"Аккаунт: @{me.get('username')} (id {me.get('id')}), токен до {env.get('TOKEN_EXPIRES', '?')}")


def cmd_limit():
    env = load_env()
    resp = call("GET", "/v1.0/me/threads_publishing_limit", {
        "fields": "quota_usage,config", "access_token": env["ACCESS_TOKEN"],
    })
    item = resp["data"][0]
    print(f"Опубликовано за 24 ч: {item['quota_usage']} из {item['config']['quota_total']}")


def cmd_post(text):
    if len(text) > 500:
        sys.exit(f"В тексте {len(text)} символов, лимит Threads — 500.")
    env = load_env()
    container = call("POST", "/v1.0/me/threads", {
        "media_type": "TEXT", "text": text, "access_token": env["ACCESS_TOKEN"],
    })
    time.sleep(30)  # Meta советует подождать ~30 с перед публикацией контейнера
    done = call("POST", "/v1.0/me/threads_publish", {
        "creation_id": container["id"], "access_token": env["ACCESS_TOKEN"],
    })
    print(f"Опубликовано, id поста: {done['id']}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    cmd, rest = args[0], args[1:]
    if cmd == "token" and rest:
        cmd_token(rest[0])
    elif cmd == "refresh":
        cmd_refresh()
    elif cmd == "me":
        cmd_me()
    elif cmd == "limit":
        cmd_limit()
    elif cmd == "post" and rest:
        cmd_post(rest[0])
    else:
        sys.exit(__doc__)

import os
import json
import time
from datetime import datetime
import config

# Ensure data directory exists
os.makedirs(config.DATA_DIR, exist_ok=True)

FILES = {
    "accounts": config.ACCOUNTS_FILE,
    "posts": config.POSTS_FILE,
    "tokens": config.TOKENS_FILE,
    "logs": config.LOGS_FILE,
    "targets": os.path.join(config.DATA_DIR, "targets.json")
}

# Initialize empty JSON files
for file_path in FILES.values():
    if not os.path.exists(file_path):
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False, indent=2)

def get_collection(name: str) -> list:
    file_path = FILES.get(name)
    if not file_path or not os.path.exists(file_path):
        return []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_collection(name: str, data: list):
    file_path = FILES.get(name)
    if not file_path:
        return
    tmp_path = file_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, file_path)

def insert_item(name: str, item: dict) -> dict:
    items = get_collection(name)
    items.append(item)
    save_collection(name, items)
    return item

def update_item(name: str, item_id: str, updates: dict) -> dict:
    items = get_collection(name)
    for i, item in enumerate(items):
        if item.get("id") == item_id:
            items[i].update(updates)
            save_collection(name, items)
            return items[i]
    return None

def delete_item(name: str, item_id: str) -> bool:
    items = get_collection(name)
    initial_len = len(items)
    items = [i for i in items if i.get("id") != item_id]
    save_collection(name, items)
    return len(items) < initial_len

def add_log(action: str, details: dict = None) -> dict:
    logs = get_collection("logs")
    log_entry = {
        "id": f"log_{int(time.time() * 1000)}",
        "timestamp": datetime.now().isoformat(),
        "action": action,
        "details": details or {}
    }
    logs.append(log_entry)
    save_collection("logs", logs)
    return log_entry

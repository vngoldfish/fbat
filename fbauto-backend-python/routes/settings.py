import os
import json
import database

def handle_settings_route(path: str, method: str, body: dict = None) -> tuple:
    # GET /api/settings
    if path == "/api/settings" and method == "GET":
        settings = database.get_collection("settings")
        if not settings:
            default_settings = {
                "id": "cfg_main",
                "seedingMinDelay": 3,
                "seedingMaxDelay": 10,
                "autoReplyCheckInterval": 1.0,
                "maxRetries": 3,
                "defaultReactType": "LOVE",
                "defaultReplyTemplates": [
                    "Dạ chào bạn, shop đã inbox tư vấn chi tiết cho bạn rồi nhé! ❤️",
                    "Cảm ơn bạn đã quan tâm, bạn check tin nhắn giúp shop nhé! ✨"
                ],
                "skipSelfComments": True,
                "showOnScreenBanner": True,
                "enableSounds": False,
                "debugMode": False,
                "apiUrl": "http://localhost:18923"
            }
            database.save_collection("settings", [default_settings])
            return 200, {"success": True, "settings": default_settings}
        return 200, {"success": True, "settings": settings[0]}

    # POST /api/settings
    if path == "/api/settings" and method == "POST":
        payload = body or {}
        payload["id"] = "cfg_main"
        database.save_collection("settings", [payload])
        database.add_log("SETTINGS_UPDATED", payload)
        return 200, {"success": True, "settings": payload}

    return 404, {"error": "Endpoint not found"}

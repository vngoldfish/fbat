import time
import json
import database
from utils import crypto

def handle_sync_route(path: str, method: str, body: dict = None) -> tuple:
    # GET /sync/status
    if path == "/sync/status" and method == "GET":
        return 200, {
            "status": "ok",
            "version": "7.0.0",
            "timestamp": int(time.time() * 1000),
            "service": "fbauto-backend-python"
        }

    # GET /sync/config
    if path == "/sync/config" and method == "GET":
        return 200, {
            "recaptcha_ent_key": "6Ld_sample_key_for_testing",
            "recaptcha_action": "flow"
        }

    # GET /sync/theme
    if path == "/sync/theme" and method == "GET":
        response_data = {"r": None, "g": 0, "x": None}
        return 200, {
            "d": crypto.serialize_theme(json.dumps(response_data))
        }

    # POST /sync/render
    if path == "/sync/render" and method == "POST":
        payload = body or {}
        if "d" in payload:
            try:
                payload = json.loads(crypto.parse_theme(payload["d"]))
            except Exception:
                pass
        database.insert_item("tokens", {
            "id": f"tok_{int(time.time() * 1000)}",
            "requestId": payload.get("r"),
            "token": payload.get("t"),
            "error": payload.get("e"),
            "userAgent": payload.get("u"),
            "receivedAt": int(time.time() * 1000)
        })
        return 200, {"success": True}

    # POST /sync/auto-post
    if path == "/sync/auto-post" and method == "POST":
        post_data = body or {}
        post_id = post_data.get("id")
        print(f"📌 [Python Backend] Extension Auto-Post Received: {post_data}")
        
        target_status = post_data.get("status", "completed")
        updated = database.update_item("posts", post_id, {
            "status": target_status,
            "executedAt": int(time.time() * 1000),
            "source": "chrome_extension"
        }) if post_id else None

        if not updated:
            new_post = {
                "id": post_id or f"post_{int(time.time() * 1000)}",
                "content": post_data.get("content", ""),
                "postType": post_data.get("postType", "post"),
                "targetUrl": post_data.get("targetUrl", ""),
                "status": target_status,
                "scheduledTime": int(time.time() * 1000),
                "executedAt": int(time.time() * 1000),
                "source": "chrome_extension"
            }
            database.insert_item("posts", new_post)
            updated = new_post

        database.add_log("EXTENSION_AUTO_POST", {"postId": updated["id"]})
        return 200, {
            "success": True,
            "message": "Post updated and logged by Python backend",
            "post": updated
        }

    # Stubs for other sync endpoints
    if path in ["/sync/google-one-activity", "/sync/google-flow-page", "/sync/grok-event"]:
        return 200, {"success": True}

    if path == "/sync/grok-poll-task":
        return 200, {"task": None}

    return 404, {"error": "Sync Route not found"}

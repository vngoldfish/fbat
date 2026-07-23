import time
import random
import string
from datetime import datetime
import database

def handle_posts_route(path: str, method: str, body: dict = None, query: dict = None) -> tuple:
    # GET /api/posts
    if path == "/api/posts" and method == "GET":
        posts = database.get_collection("posts")
        status = query.get("status") if query else None
        post_type = query.get("postType") or query.get("type") if query else None
        if status and status != "all":
            posts = [p for p in posts if p.get("status") == status]
        if post_type and post_type != "all":
            posts = [p for p in posts if p.get("postType") == post_type]
        return 200, {"posts": posts, "total": len(posts)}

    # POST /api/posts
    if path == "/api/posts" and method == "POST":
        payload = body or {}
        content = payload.get("content", "")
        post_type = payload.get("postType") or payload.get("type") or "post"
        if post_type not in ["post", "video", "reel", "story"]:
            post_type = "post"

        if not content and not payload.get("mediaUrl") and not payload.get("mediaData"):
            return 400, {"error": "Nội dung, URL Media hoặc File đính kèm không được để trống"}

        scheduled_time_raw = payload.get("scheduledTime")
        post_time = int(time.time() * 1000)
        if scheduled_time_raw:
            try:
                post_time = int(scheduled_time_raw)
            except (ValueError, TypeError):
                try:
                    dt = datetime.fromisoformat(str(scheduled_time_raw))
                    post_time = int(dt.timestamp() * 1000)
                except Exception:
                    post_time = int(time.time() * 1000)

        rand_str = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
        new_post = {
            "id": f"post_{int(time.time() * 1000)}_{rand_str}",
            "postType": post_type, # post | video | reel | story
            "content": content,
            "targetType": payload.get("targetType", "profile"), # profile | page | group
            "targetUrl": payload.get("targetUrl", ""),
            "targetId": payload.get("targetId", ""),
            "actorId": payload.get("actorId", ""), # Page ID if posting as Fanpage
            "accessToken": payload.get("accessToken", ""),
            "mediaUrl": payload.get("mediaUrl", ""),
            "mediaData": payload.get("mediaData", None),
            "seedingComments": payload.get("seedingComments", []), # Array of comments to seed
            "metrics": payload.get("metrics", {"likes": 0, "comments": 0, "shares": 0}),
            "scheduledTime": post_time,
            "repeatIntervalMinutes": int(payload.get("repeatIntervalMinutes") or 0),
            "status": "pending",
            "retryCount": 0,
            "maxRetries": 3,
            "lastError": None,
            "createdAt": int(time.time() * 1000)
        }

        database.insert_item("posts", new_post)
        database.add_log("CREATE_POST", {"postId": new_post["id"], "postType": post_type, "scheduledTime": new_post["scheduledTime"]})
        return 201, {"success": True, "post": new_post}

    # DELETE /api/posts/<id>
    if path.startswith("/api/posts/") and method == "DELETE":
        post_id = path.replace("/api/posts/", "").split("/")[0]
        deleted = database.delete_item("posts", post_id)
        if deleted:
            database.add_log("DELETE_POST", {"postId": post_id})
            return 200, {"success": True, "id": post_id}
        return 404, {"error": "Post not found"}

    # POST /api/posts/<id>/run-now
    if path.startswith("/api/posts/") and path.endswith("/run-now") and method == "POST":
        post_id = path.replace("/api/posts/", "").replace("/run-now", "")
        updated = database.update_item("posts", post_id, {
            "status": "pending",
            "scheduledTime": int(time.time() * 1000)
        })
        if updated:
            database.add_log("TRIGGER_POST_NOW", {"postId": post_id})
            return 200, {"success": True, "post": updated}
        return 404, {"error": "Post not found"}

    # PUT / PATCH /api/posts/<id>
    if path.startswith("/api/posts/") and method in ["PUT", "PATCH"]:
        post_id = path.split("/")[3] if len(path.split("/")) > 3 else ""
        updates = body or {}
        updated = database.update_item("posts", post_id, updates)
        if updated:
            database.add_log("UPDATE_POST", {"postId": post_id, "updates": updates})
            return 200, {"success": True, "post": updated}
        return 404, {"error": "Post not found"}

    return 404, {"error": "Post Route not found"}


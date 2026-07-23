import json
import time
import random
import re
import database

def handle_interactions(method, path, body=None, query=None):
    """Handle interaction-related API requests"""
    if query is None:
        query = {}

    # GET /api/interaction-tasks?status=pending — Extension polling
    if method == "GET" and path == "/api/interaction-tasks":
        status = query.get("status")
        all_items = database.get_collection("interactions")
        tasks = [t for t in all_items if "type" in t and not t.get("id", "").startswith("cache_")]
        if status:
            tasks = [t for t in tasks if t.get("status") == status]
        # Only return max 5 pending tasks, oldest first
        tasks.sort(key=lambda t: t.get("createdAt", 0))
        return 200, {"tasks": tasks[:5]}

    # PATCH /api/interaction-tasks/<id> — Extension reports result
    if method == "PATCH" and path.startswith("/api/interaction-tasks/"):
        task_id = path.split("/")[-1]
        update_data = body or {}
        task = database.update_item("interactions", task_id, update_data)
        if task:
            # If task completed with comments or metrics, update the cache
            result = task.get("result") or {}
            post_id = task.get("postId", "")
            if task.get("status") == "completed" and post_id:
                cache_id = f"cache_{post_id}"
                cache = _get_or_create_cache(post_id, task.get("fbPostId", ""))
                
                if task.get("type") == "FETCH_COMMENTS" and result.get("comments"):
                    database.update_item("interactions", cache_id, {
                        "comments": result["comments"],
                        "lastFetched": int(time.time() * 1000)
                    })
                if task.get("type") == "FETCH_METRICS" and result.get("metrics"):
                    database.update_item("interactions", cache_id, {
                        "metrics": result["metrics"],
                        "lastFetched": int(time.time() * 1000)
                    })
                    # Also update the post's metrics
                    database.update_item("posts", post_id, {"metrics": result["metrics"]})
            
            return 200, {"message": "Task updated", "task": task}
        return 404, {"error": "Task not found"}

    # DELETE /api/interaction-tasks — Cleanup old tasks
    if method == "DELETE" and path == "/api/interaction-tasks":
        _cleanup_old_tasks()
        return 200, {"message": "Cleaned up old tasks"}

    # Post-specific endpoints: /api/posts/<id>/...
    match = re.match(r"^/api/posts/([^/]+)/(comments|like|unlike|metrics)(?:/([^/]+))?$", path)
    if not match:
        return 404, {"error": "Endpoint not found"}

    post_id = match.group(1)
    action = match.group(2)
    comment_id = match.group(3)

    # Find the post
    posts = database.get_collection("posts")
    post = next((p for p in posts if p.get("id") == post_id), None)
    if not post:
        return 404, {"error": "Post not found"}
    
    fb_post_id = post.get("fbPostId")
    if not fb_post_id:
        return 400, {"error": "Post does not have an fbPostId"}

    # GET /api/posts/<id>/comments — return cached + optionally queue fetch
    if action == "comments" and method == "GET":
        cache = _get_or_create_cache(post_id, fb_post_id)
        refresh = query.get("refresh") == "true"
        if refresh:
            _create_task_if_not_pending(post_id, fb_post_id, "FETCH_COMMENTS", {})
        return 200, {"comments": cache.get("comments", []), "metrics": cache.get("metrics", post.get("metrics", {})), "lastFetched": cache.get("lastFetched", 0)}

    # POST /api/posts/<id>/comments — add a comment  
    if action == "comments" and method == "POST":
        text = (body or {}).get("text", "").strip()
        if not text:
            return 400, {"error": "Comment text is required"}
        task = _create_task(post_id, fb_post_id, "ADD_COMMENT", {"text": text})
        return 200, {"message": "Comment task created", "task": task}

    # DELETE /api/posts/<id>/comments/<comment_id>
    if action == "comments" and method == "DELETE" and comment_id:
        task = _create_task(post_id, fb_post_id, "DELETE_COMMENT", {"commentId": comment_id})
        return 200, {"message": "Delete comment task created", "task": task}

    # POST /api/posts/<id>/like
    if action == "like" and method == "POST":
        reaction_type = (body or {}).get("reactionType", "LIKE")
        task = _create_task(post_id, fb_post_id, "REACT_POST", {"reactionType": reaction_type})
        return 200, {"message": f"React ({reaction_type}) task created", "task": task}

    # POST /api/posts/<id>/unlike
    if action == "unlike" and method == "POST":
        task = _create_task(post_id, fb_post_id, "UNREACT_POST", {})
        return 200, {"message": "Unreact task created", "task": task}

    # GET /api/posts/<id>/metrics — return cached + queue refresh
    if action == "metrics" and method == "GET":
        cache = _get_or_create_cache(post_id, fb_post_id)
        _create_task_if_not_pending(post_id, fb_post_id, "FETCH_METRICS", {})
        return 200, {"metrics": cache.get("metrics", post.get("metrics", {})), "lastFetched": cache.get("lastFetched", 0)}

    return 400, {"error": "Invalid action"}


def _get_or_create_cache(post_id, fb_post_id):
    """Get or create cache entry for a post"""
    cache_id = f"cache_{post_id}"
    all_items = database.get_collection("interactions")
    cache = next((i for i in all_items if i.get("id") == cache_id), None)
    if not cache:
        cache = {
            "id": cache_id,
            "postId": post_id,
            "fbPostId": fb_post_id,
            "comments": [],
            "metrics": {"likes": 0, "comments": 0, "shares": 0},
            "lastFetched": 0
        }
        database.insert_item("interactions", cache)
    return cache


def _create_task_if_not_pending(post_id, fb_post_id, task_type, payload):
    """Only create a task if there's no pending task of the same type for this post"""
    all_items = database.get_collection("interactions")
    existing = [t for t in all_items 
                if t.get("postId") == post_id 
                and t.get("type") == task_type 
                and t.get("status") in ("pending", "in_progress")]
    if existing:
        return existing[0]  # Already has a pending task
    return _create_task(post_id, fb_post_id, task_type, payload)


def _create_task(post_id, fb_post_id, task_type, payload):
    """Create a new interaction task"""
    task = {
        "id": f"itask_{int(time.time()*1000)}_{random.randint(1000, 9999)}",
        "postId": post_id,
        "fbPostId": fb_post_id,
        "type": task_type,
        "payload": payload,
        "status": "pending",
        "result": None,
        "createdAt": int(time.time() * 1000),
        "completedAt": None
    }
    database.insert_item("interactions", task)
    return task


def _cleanup_old_tasks():
    """Remove completed/failed tasks older than 1 hour"""
    cutoff = int(time.time() * 1000) - 3600000
    all_items = database.get_collection("interactions")
    # Keep cache entries + recent tasks + pending tasks
    keep = [t for t in all_items 
            if t.get("id", "").startswith("cache_")
            or t.get("status") in ("pending", "in_progress")
            or t.get("createdAt", 0) > cutoff]
    database.save_collection("interactions", keep)

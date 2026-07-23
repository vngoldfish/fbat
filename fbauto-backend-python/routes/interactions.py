import json
import time
import random
import re
import database

def handle_interactions(method, path, body=None, query=None):
    """Handle interaction-related API requests"""
    if query is None:
        query = {}

    if method == "GET" and path == "/api/interaction-tasks":
        status = query.get("status")
        tasks = database.get_collection("interactions")
        if status:
            tasks = [t for t in tasks if t.get("status") == status and "type" in t]
        return 200, {"tasks": tasks}

    if method == "PATCH" and path.startswith("/api/interaction-tasks/"):
        task_id = path.split("/")[-1]
        task = database.update_item("interactions", task_id, body)
        if task:
            return 200, {"message": "Task updated", "task": task}
        return 404, {"error": "Task not found"}

    # Post-specific endpoints
    # /api/posts/<id>/...
    match = re.match(r"^/api/posts/([^/]+)/(comments|like|unlike|metrics)(?:/([^/]+))?$", path)
    if not match:
        return 404, {"error": "Endpoint not found"}

    post_id = match.group(1)
    action = match.group(2)
    comment_id = match.group(3)

    # find the post to get fbPostId
    posts = database.get_collection("posts")
    post = next((p for p in posts if p.get("id") == post_id), None)
    if not post:
        return 404, {"error": "Post not found"}
    
    fb_post_id = post.get("fbPostId")
    if not fb_post_id:
        return 400, {"error": "Post does not have an fbPostId"}

    task_type = None
    payload = {}

    if action == "comments":
        if method == "POST":
            task_type = "ADD_COMMENT"
            payload = {"text": body.get("text", "")} if body else {}
        elif method == "DELETE" and comment_id:
            task_type = "DELETE_COMMENT"
            payload = {"comment_id": comment_id}
        elif method == "GET":
            # return cache and create FETCH_COMMENTS
            task_type = "FETCH_COMMENTS"
            cache_id = f"cache_{post_id}"
            interactions = database.get_collection("interactions")
            cache = next((i for i in interactions if i.get("id") == cache_id), None)
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
            
            # Create fetch task
            _create_task(post_id, fb_post_id, task_type, payload)
            return 200, {"cache": cache}
            
    elif action == "like" and method == "POST":
        task_type = "REACT_POST"
        payload = {"reactionType": body.get("reactionType", "LIKE")} if body else {"reactionType": "LIKE"}
    elif action == "unlike" and method == "POST":
        task_type = "UNREACT_POST"
    elif action == "metrics" and method == "GET":
        task_type = "FETCH_METRICS"
        cache_id = f"cache_{post_id}"
        interactions = database.get_collection("interactions")
        cache = next((i for i in interactions if i.get("id") == cache_id), None)
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
        
        # Create fetch task
        _create_task(post_id, fb_post_id, task_type, payload)
        return 200, {"cache": cache}

    if task_type:
        task = _create_task(post_id, fb_post_id, task_type, payload)
        return 200, {"message": f"Task {task_type} created", "task": task}

    return 400, {"error": "Invalid action"}

def _create_task(post_id, fb_post_id, task_type, payload):
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

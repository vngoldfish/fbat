import time
import threading
import database
from services import facebook_service

_worker_thread = None
_stop_event = threading.Event()

def start_scheduler(interval_sec: int = 15):
    global _worker_thread, _stop_event
    if _worker_thread and _worker_thread.is_alive():
        return
    _stop_event.clear()
    _worker_thread = threading.Thread(target=_run_worker, args=(interval_sec,), daemon=True)
    _worker_thread.start()
    print(f"⏰ Python Scheduler Worker started (interval: {interval_sec}s)")

def stop_scheduler():
    global _stop_event
    _stop_event.set()
    print("🛑 Python Scheduler Worker stopped")

def _run_worker(interval_sec: int):
    while not _stop_event.is_set():
        try:
            process_scheduled_posts()
        except Exception as e:
            print(f"Error in python scheduler: {e}")
        _stop_event.wait(interval_sec)

def process_scheduled_posts():
    posts = database.get_collection("posts")
    now = int(time.time() * 1000)

    for post in posts:
        if post.get("status") == "pending" and post.get("scheduledTime", 0) <= now:
            post_id = post.get("id")
            # If no access token, this is handled by Chrome Extension — skip Python Graph API scheduler loop
            if not post.get("accessToken"):
                continue

            print(f"🚀 [Python Scheduler] Executing Post [{post_id}]: '{post.get('content', '')[:40]}...'")
            database.update_item("posts", post_id, {"status": "in_progress"})

            result = facebook_service.publish_post(post)

            if result.get("success"):
                updates = {
                    "status": "completed",
                    "executedAt": now,
                    "lastError": None,
                    "fbPostId": result.get("postId")
                }
                repeat_min = post.get("repeatIntervalMinutes", 0)
                if repeat_min > 0:
                    updates["status"] = "pending"
                    updates["scheduledTime"] = now + (repeat_min * 60000)

                database.update_item("posts", post_id, updates)
                database.add_log("SCHEDULED_POST_SUCCESS", {"postId": post_id, "fbPostId": result.get("postId")})
            elif result.get("isExtensionPost"):
                # Reset to pending so the Chrome Extension can pick it up
                database.update_item("posts", post_id, {
                    "status": "pending",
                    "scheduledTime": now + 10000,
                    "lastError": None
                })
                database.add_log("AWAITING_EXTENSION", {"postId": post_id})
            else:
                retry_count = post.get("retryCount", 0) + 1
                max_retries = post.get("maxRetries", 3)

                updates = {
                    "retryCount": retry_count,
                    "lastError": result.get("error")
                }

                if retry_count >= max_retries:
                    updates["status"] = "failed"
                else:
                    updates["status"] = "pending"
                    updates["scheduledTime"] = now + 60000 # Retry in 1 min

                database.update_item("posts", post_id, updates)
                database.add_log("SCHEDULED_POST_RETRY", {"postId": post_id, "retryCount": retry_count, "error": result.get("error")})

import urllib.request
import urllib.parse
import json
from datetime import datetime
import database

def publish_post(post: dict) -> dict:
    try:
        post_type = post.get("postType", "post")
        access_token = post.get("accessToken")
        target_id = post.get("targetId")

        if access_token and target_id:
            database.add_log("FB_POST_ATTEMPT", {
                "postId": post.get("id"),
                "postType": post_type,
                "content": post.get("content", "")[:50]
            })
            return publish_via_graph_api(post, target_id, access_token)

        # No access token -> Chrome Extension browser automation post
        return {
            "success": False,
            "isExtensionPost": True,
            "error": "Chờ Chrome Extension thực thi trên Facebook web"
        }
    except Exception as e:
        database.add_log("FB_POST_FAILED", {"postId": post.get("id"), "error": str(e)})
        return {"success": False, "error": str(e)}

def publish_via_graph_api(post: dict, target_id: str, access_token: str) -> dict:
    try:
        post_type = post.get("postType", "post")
        media_url = post.get("mediaUrl")
        content = post.get("content", "")

        if post_type == "video":
            endpoint = f"https://graph.facebook.com/v19.0/{target_id}/videos"
            data = {"description": content, "access_token": access_token}
            if media_url:
                data["file_url"] = media_url
        elif post_type == "reel":
            endpoint = f"https://graph.facebook.com/v19.0/{target_id}/video_reels"
            data = {"description": content, "access_token": access_token}
            if media_url:
                data["video_url"] = media_url
        elif post_type == "story":
            endpoint = f"https://graph.facebook.com/v19.0/{target_id}/photo_stories"
            data = {"caption": content, "access_token": access_token}
            if media_url:
                data["url"] = media_url
        else: # Regular post
            endpoint = f"https://graph.facebook.com/v19.0/{target_id}/photos" if media_url else f"https://graph.facebook.com/v19.0/{target_id}/feed"
            data = {"message": content, "access_token": access_token}
            if media_url:
                data["url"] = media_url

        encoded_data = urllib.parse.urlencode(data).encode("utf-8")
        req = urllib.request.Request(endpoint, data=encoded_data, method="POST")

        with urllib.request.urlopen(req, timeout=15) as response:
            res_body = response.read().decode("utf-8")
            result = json.loads(res_body)
            return {
                "success": True,
                "publishedAt": datetime.now().isoformat(),
                "postId": result.get("id") or result.get("post_id") or result.get("video_id"),
                "postType": post_type,
                "rawResponse": result
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


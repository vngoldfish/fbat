# 🚀 fbAUTO REST API Documentation & Integration Guide

**Base URL**: `http://127.0.0.1:18923`  
**Content-Type**: `application/json`

---

## 📌 Overview

Hệ thống REST API cho phép bạn tự động hóa đăng bài, lên lịch, chạy ngay, quản lý bài đăng trên Facebook (Profile, Fanpage, Group) thông qua HTTP requests từ cURL, Python, Node.js, Postman hoặc các công cụ Automation (n8n, Make, Zapier...).

---

## 📑 Danh Sách Endpoints

| Method | Endpoint | Mô Tả |
| :--- | :--- | :--- |
| `POST` | `/api/posts` | Tạo bài viết mới / Lên lịch đăng |
| `GET` | `/api/posts` | Danh sách tất cả bài viết (hỗ trợ lọc) |
| `GET` | `/api/posts/{id}` | Lấy thông tin 1 bài viết chi tiết |
| `POST` | `/api/posts/{id}/run-now` | Đăng ngay lập tức 1 bài đang chờ |
| `PATCH` | `/api/posts/{id}` | Cập nhật thông tin bài viết |
| `DELETE` | `/api/posts/{id}` | Xóa bài viết |
| `GET` | `/api/accounts` | Lấy danh sách tài khoản Fanpage / Token |
| `POST` | `/api/accounts` | Thêm tài khoản / Token |
| `DELETE` | `/api/accounts/{id}` | Xóa tài khoản |
| `GET` | `/api/logs` | Lấy nhật ký hệ thống |
| `GET` | `/health` | Kiểm tra trạng thái hoạt động server |

---

## 🛠️ Chi Tiết Các Endpoints & Cấu Trúc Request

### 1. Tạo Bài Viết Mới / Lên Lịch Đăng (`POST /api/posts`)

#### Request Body Schema:
```json
{
  "postType": "post",
  "content": "Nội dung bài viết của bạn ở đây...",
  "targetType": "profile",
  "targetId": "",
  "mediaUrl": "https://example.com/image.jpg",
  "seedingComments": [
    "Bài viết tuyệt vời quá!",
    "Cho mình xin thông tin sản phẩm với ạ!"
  ],
  "scheduledTime": 1784857130000,
  "repeatIntervalMinutes": 0
}
```

#### Chi Tiết Tham Số:
* `postType` *(string, bắt buộc)*: Định dạng bài viết:
  * `"post"`: Bài viết chuẩn (Feed Post)
  * `"video"`: Video Facebook
  * `"reel"`: Facebook Reels
  * `"story"`: Facebook Story
* `content` *(string)*: Nội dung chữ, caption.
* `targetType` *(string)*: `"profile"` (Trang cá nhân), `"page"` (Fanpage), hoặc `"group"` (Nhóm).
* `targetId` *(string, tùy chọn)*: ID của Fanpage hoặc Group (để trống nếu đăng lên Profile cá nhân).
* `mediaUrl` *(string, tùy chọn)*: Đường dẫn URL trực tiếp đến hình ảnh/video.
* `seedingComments` *(array of string, tùy chọn)*: Danh sách bình luận mồi tự động sau khi đăng.
* `scheduledTime` *(number/string, tùy chọn)*: Thời gian đăng tính bằng milisecond timestamp (ví dụ: `1784857130000`). Nếu để trống hoặc đặt bằng thời gian hiện tại, bài viết sẽ đăng ngay.
* `repeatIntervalMinutes` *(number, tùy chọn)*: Số phút tự động lặp lại đăng bài (mặc định: `0` - không lặp).

#### Example Response (201 Created):
```json
{
  "success": true,
  "post": {
    "id": "post_1784857130322_wwd7i",
    "postType": "post",
    "content": "Nội dung bài viết...",
    "targetType": "profile",
    "mediaUrl": "https://example.com/image.jpg",
    "seedingComments": ["Comment 1", "Comment 2"],
    "scheduledTime": 1784857130322,
    "status": "pending",
    "createdAt": 1784857130322
  }
}
```

---

### 2. Phát Lệnh Đăng Ngay Lập Tức (`POST /api/posts/{id}/run-now`)

Ép bài viết đang ở danh sách chờ thực thi đăng ngay lên Facebook lập tức.

#### URL Parameter:
* `id`: ID của bài viết (ví dụ: `post_1784857130322_wwd7i`)

#### Example Response (200 OK):
```json
{
  "success": true,
  "post": {
    "id": "post_1784857130322_wwd7i",
    "status": "pending",
    "scheduledTime": 1784857130000
  }
}
```

---

### 3. Lấy Danh Sách Bài Viết (`GET /api/posts`)

#### Query Parameters (Tùy chọn):
* `status`: Lọc theo trạng thái (`pending`, `completed`, `failed`, `all`). Mặc định: `all`.
* `postType`: Lọc theo loại (`post`, `video`, `reel`, `story`, `all`). Mặc định: `all`.

#### Ví dụ: `GET /api/posts?status=pending&postType=post`

---

### 4. Lấy Chi Tiết 1 Bài Viết (`GET /api/posts/{id}`)

#### Response (200 OK):
```json
{
  "success": true,
  "post": {
    "id": "post_1784857130322_wwd7i",
    "postType": "post",
    "content": "Nội dung...",
    "status": "completed",
    "fbPostId": "1017403417744575",
    "fbPostUrl": "https://www.facebook.com/permalink.php?story_fbid=1017403417744575&id=100084247794160",
    "progressStep": "🎉 Đã đăng thành công qua [GRAPHQL]!",
    "executedAt": 1784857147444
  }
}
```

---

### 5. Cập Nhật Bài Viết (`PATCH /api/posts/{id}`)

#### Request Body Schema:
```json
{
  "content": "Nội dung bài viết mới đã chỉnh sửa...",
  "status": "pending"
}
```

---

### 6. Xóa Bài Viết (`DELETE /api/posts/{id}`)

#### Response (200 OK):
```json
{
  "success": true,
  "id": "post_1784857130322_wwd7i"
}
```

---

## 💻 Ví Dụ Code Tích Hợp Call API

### 1. cURL (Command Line)

#### Tạo bài viết Feed Post mới & Đăng ngay:
```bash
curl -X POST http://127.0.0.1:18923/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "postType": "post",
    "content": "Bài viết tự động đăng qua API cURL!",
    "targetType": "profile",
    "seedingComments": [
      "Bình luận mồi 1",
      "Bình luận mồi 2"
    ]
  }'
```

#### Tạo bài đăng Reels với Video URL:
```bash
curl -X POST http://127.0.0.1:18923/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "postType": "reel",
    "content": "Thước phim Reels tự động qua API!",
    "mediaUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4"
  }'
```

---

### 2. Python (`requests`)

```python
import requests
import json

API_BASE = "http://127.0.0.1:18923"

# 1. Tạo bài viết mới
post_payload = {
    "postType": "post", # post | video | reel | story
    "content": "Chào mừng bạn đến với hệ thống tự động đăng bài fbAUTO!",
    "targetType": "profile",
    "mediaUrl": "https://picsum.photos/800/600",
    "seedingComments": [
        "Sản phẩm rất đẹp ạ!",
        "Tư vấn cho mình với shop"
    ]
}

response = requests.post(f"{API_BASE}/api/posts", json=post_payload)
result = response.json()
print("Create Post Result:", result)

# 2. Lấy ID bài vừa tạo và đăng ngay
if result.get("success"):
    post_id = result["post"]["id"]
    run_res = requests.post(f"{API_BASE}/api/posts/{post_id}/run-now")
    print("Run Now Result:", run_res.json())
```

---

### 3. JavaScript / Node.js (`fetch`)

```javascript
const API_BASE = "http://127.0.0.1:18923";

async function createAndPublishPost() {
  // 1. Tạo bài đăng mới
  const res = await fetch(`${API_BASE}/api/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postType: "post",
      content: "Đăng bài tự động từ ứng dụng Node.js!",
      seedingComments: ["Tuyệt vời!", "Giá thế nào shop ơi?"]
    })
  });

  const data = await res.json();
  console.log("Post Created:", data);

  // 2. Kích hoạt đăng ngay
  if (data.success && data.post) {
    const runRes = await fetch(`${API_BASE}/api/posts/${data.post.id}/run-now`, {
      method: "POST"
    });
    console.log("Run Now:", await runRes.json());
  }
}

createAndPublishPost();
```

---

## ⚡ Ghi Chú Tích Hợp
1. Đảm bảo server Python Backend đang chạy tại `http://127.0.0.1:18923`.
2. Đảm bảo Chrome Extension đang được bật và trình duyệt Chrome có tab Facebook đang đăng nhập.
3. Khi bạn gọi API `POST /api/posts`, bài viết sẽ tự động đi vào hàng chờ và Extension sẽ phát lệnh đăng ngầm qua GraphQL ngay lập tức.

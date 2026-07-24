# 📘 HƯỚNG DẪN CHI TIẾT TÍCH HỢP REST API - fbAUTO ENGINE

Tài liệu này hướng dẫn chi tiết cách gọi API để tự động tạo bài đăng, lên lịch, chạy ngay bài viết trên Facebook từ phần mềm bên ngoài (Python, Node.js, cURL, Postman, n8n, Make.com...).

---

## 🚀 1. Thông Tin Chung

* **Địa chỉ Server (Base URL)**: `http://127.0.0.1:18923`
* **Định dạng dữ liệu (Header)**: `Content-Type: application/json`
* **Phương thức mã hóa**: `UTF-8`

---

## 📋 2. Tổng Quan Danh Sách Endpoint

| STT | Phương Thức | Endpoint | Chức Năng |
| :---: | :---: | :--- | :--- |
| 1 | `POST` | `/api/posts` | **Tạo bài viết mới** (Hỗ trợ Feed Post, Video, Reels, Story) |
| 2 | `POST` | `/api/posts/{id}/run-now` | **Đăng ngay bài viết** đang trong danh sách chờ |
| 3 | `GET` | `/api/posts` | **Lấy danh sách tất cả bài viết** |
| 4 | `GET` | `/api/posts/{id}` | **Lấy thông tin chi tiết 1 bài viết** theo ID |
| 5 | `PATCH` | `/api/posts/{id}` | **Sửa thông tin / Cập nhật trạng thái** bài viết |
| 6 | `DELETE` | `/api/posts/{id}` | **Xóa bài viết** khỏi hệ thống |
| 7 | `GET` | `/health` | Kiểm tra server có đang hoạt động không |

---

## 🛠️ 3. Chi Tiết Các Endpoint & Tham Số

### 3.1. Tạo Bài Viết Mới / Lên Lịch Đăng (`POST /api/posts`)

Đây là API quan trọng nhất dùng để gửi bài viết từ phần mềm của bạn vào hệ thống fbAUTO.

#### Cấu trúc JSON Body (Mẫu đầy đủ):
```json
{
  "postType": "post",
  "content": "Nội dung bài viết quảng cáo sản phẩm...",
  "targetType": "profile",
  "targetId": "",
  "mediaUrl": "https://example.com/hinh-anh-san-pham.jpg",
  "seedingComments": [
    "Sản phẩm dùng rất thích ạ!",
    "Shop tư vấn giá cho mình với!"
  ],
  "scheduledTime": 1784857130000,
  "repeatIntervalMinutes": 0
}
```

#### Giải thích ý nghĩa từng trường:

| Trường (Field) | Kiểu dữ liệu | Bắt buộc | Giá trị hợp lệ / Mô tả |
| :--- | :---: | :---: | :--- |
| `postType` | `string` | **Có** | Loại bài viết: <br>• `"post"`: Bài viết thường (Feed Post)<br>• `"video"`: Video Facebook<br>• `"reel"`: Thước phim (Reels)<br>• `"story"`: Bản tin (Story) |
| `content` | `string` | **Có** | Nội dung chữ, mô tả hoặc caption của bài viết. |
| `targetType` | `string` | Không | Nơi đăng: `"profile"` (Trang cá nhân), `"page"` (Fanpage), `"group"` (Group). Mặc định: `"profile"`. |
| `targetId` | `string` | Không | ID Fanpage hoặc ID Group (để trống nếu đăng Profile). |
| `mediaUrl` | `string` | Không | Đường dẫn URL trực tiếp đến hình ảnh (.jpg, .png) hoặc video (.mp4). |
| `seedingComments` | `array` | Không | Mảng danh sách bình luận mồi tự động đăng sau khi bài viết lên Facebook thành công. |
| `scheduledTime` | `number` | Không | Timestamp (ms) thời gian muốn bài tự đăng. Để trống hoặc đặt `0` để đăng ngay. |
| `repeatIntervalMinutes` | `number` | Không | Số phút tự động đăng lặp lại bài viết (Mặc định `0` - không lặp). |

#### Kết quả trả về mẫu (`201 Created`):
```json
{
  "success": true,
  "post": {
    "id": "post_1784857514974_hdqyj",
    "postType": "post",
    "content": "Nội dung bài viết...",
    "source": "api",
    "status": "pending",
    "createdAt": 1784857514974
  }
}
```

---

### 3.2. Đăng Bài Ngay Lập Tức (`POST /api/posts/{id}/run-now`)

Sau khi tạo bài viết, nếu muốn kích hoạt bài đó đăng lên Facebook ngay mà không chờ hẹn giờ:

* **URL Parameter**: `{id}` là mã ID bài viết trả về từ API tạo bài (Ví dụ: `post_1784857514974_hdqyj`).

#### Kết quả trả về mẫu (`200 OK`):
```json
{
  "success": true,
  "post": {
    "id": "post_1784857514974_hdqyj",
    "status": "pending",
    "scheduledTime": 1784857514974
  }
}
```

---

### 3.3. Xem Danh Sách & Kiểm Tra Trạng Thái (`GET /api/posts`)

Lấy danh sách các bài đăng trong hệ thống. Có thể truyền tham số query để lọc:

* `GET /api/posts?status=pending` (Lấy bài đang chờ / đang chạy)
* `GET /api/posts?status=completed` (Lấy bài đã đăng thành công)
* `GET /api/posts?postType=reel` (Lọc theo bài Reels)

---

## 💻 4. Code Mẫu Tích Hợp Cho Các Ngôn Ngữ

### 4.1. Sử dụng cURL (Terminal / Command Prompt)

```bash
# 1. Tạo bài viết Feed Post kèm Seeding Comment
curl -X POST http://127.0.0.1:18923/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "postType": "post",
    "content": "Bài viết tự động qua cURL!",
    "mediaUrl": "https://picsum.photos/800/600",
    "seedingComments": ["Sản phẩm tuyệt vời!", "Inbox mình giá nhé"]
  }'

# 2. Tạo bài đăng Facebook Reels
curl -X POST http://127.0.0.1:18923/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "postType": "reel",
    "content": "Thước phim Reels tự động qua cURL!",
    "mediaUrl": "https://filesamples.com/samples/video/mp4/sample_640x360.mp4"
  }'
```

---

### 4.2. Sử dụng Python (`requests`)

```python
import requests

API_BASE = "http://127.0.0.1:18923"

# Bước 1: Gọi API tạo bài đăng mới
payload = {
    "postType": "post", # 'post' | 'video' | 'reel' | 'story'
    "content": "Tự động đăng bài từ Python Script!",
    "targetType": "profile",
    "mediaUrl": "https://picsum.photos/800/600",
    "seedingComments": [
        "Shop uy tín quá!",
        "Quan tâm tư vấn nhé"
    ]
}

response = requests.post(f"{API_BASE}/api/posts", json=payload)
data = response.json()

if data.get("success"):
    post_id = data["post"]["id"]
    print(f"✅ Đã tạo bài viết thành công! ID: {post_id}")
    
    # Bước 2: Kích hoạt phát lệnh đăng ngay
    run_res = requests.post(f"{API_BASE}/api/posts/{post_id}/run-now")
    print("🚀 Kết quả phát lệnh:", run_res.json())
```

---

### 4.3. Sử dụng JavaScript / Node.js (`fetch`)

```javascript
const API_BASE = "http://127.0.0.1:18923";

async function autoPostFromNodeJS() {
  // Bước 1: Gửi yêu cầu tạo bài đăng
  const response = await fetch(`${API_BASE}/api/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postType: "post",
      content: "Đăng bài tự động từ ứng dụng Node.js!",
      seedingComments: ["Bình luận mẫu 1", "Bình luận mẫu 2"]
    })
  });

  const result = await response.json();
  
  if (result.success) {
    const postId = result.post.id;
    console.log("✅ Bài viết đã được thêm vào hàng chờ:", postId);

    // Bước 2: Phát lệnh đăng ngay
    await fetch(`${API_BASE}/api/posts/${postId}/run-now`, { method: "POST" });
    console.log("🚀 Đã kích hoạt đăng ngầm qua Extension!");
  }
}

autoPostFromNodeJS();
```

---

### 4.4. Hướng dẫn cài đặt trên Postman

1. Mở **Postman** $\rightarrow$ Tạo Request mới.
2. Chọn phương thức: **`POST`**.
3. Điền URL: `http://127.0.0.1:18923/api/posts`
4. Vào tab **Headers** $\rightarrow$ Thêm: `Content-Type` : `application/json`
5. Vào tab **Body** $\rightarrow$ Chọn **raw** $\rightarrow$ chọn định dạng **JSON**.
6. Dán nội dung mẫu:
   ```json
   {
     "postType": "post",
     "content": "Bài viết test thử từ Postman",
     "seedingComments": ["Comment 1 từ Postman"]
   }
   ```
7. Bấm **Send**.

---

## 🖥️ 5. Quản Lý Bài Viết Đã Tạo Qua API Trên Trang Admin

Khi bài viết được tạo thành công từ API:
1. Bạn mở trang Admin tại `http://127.0.0.1:18923/admin`.
2. Bài viết sẽ hiển thị ngay lập tức trong mục **"📅 Lên Lịch & Đang Chờ"**.
3. Bài đăng từ API sẽ có thẻ nhận diện màu xanh dương: **`⚡ External API`**.
4. Bạn có thể nhấn nút **`⚡ Đăng Ngay`**, **`📋 Nhân Bản`**, hoặc **`🗑️ Xóa`** trực tiếp trên trang Admin như một bài viết bình thường.

# 📌 TÀI LIỆU THAM CHIẾU: Feed Post — Trạng thái hoạt động tốt
> **Ngày lưu:** 2026-07-23 23:40 JST  
> **Mục đích:** Lưu lại toàn bộ logic code đang hoạt động ổn định  
> **Chức năng OK:** Đăng text ✅ | Đăng ảnh ✅ | Đăng video ✅ | Trỏ link ✅ | Chia sẻ bảng tin ✅

## Bảng tham chiếu nhanh

### Endpoints Facebook
| Chức năng | URL |
|-----------|-----|
| Upload ảnh | `https://upload.facebook.com/ajax/react_composer/attachments/photo/upload?` |
| Video START | `https://vupload-edge.facebook.com/ajax/video/upload/requests/start/` |
| Video RUPLOAD | `https://rupload.facebook.com/fb_video/{hash}` |
| Video RECEIVE | `https://vupload-edge.facebook.com/ajax/video/upload/requests/receive/` |
| GraphQL | `https://www.facebook.com/api/graphql/` |

### GraphQL Doc IDs
| Mutation | Doc ID |
|----------|--------|
| ComposerStoryCreateMutation #1 | `27508435028820023` |
| ComposerStoryCreateMutation #2 | `27248647231502311` |
| ComposerStoryCreateMutation #3 | `6362241860538186` |
| ComposerStoryCreateMutation #4 | `6815340158580277` |
| ComposerStoryCreateMutation #5 | `6143924765664426` |
| CometCommentCreateMutation | `5384620808298758` |

### Giới hạn
| Loại | Giới hạn |
|------|----------|
| Ảnh upload | 10 MB |
| Video upload | 100 MB |
| Backend port | 18923 |

---

## 1. Admin UI (admin.html)

### handleAdminMediaFile(file) — Dòng 1166-1240
- Kiểm tra loại file bằng CẢ MIME type VÀ extension (fix cho macOS file.type rỗng)
- Ảnh: max 10MB, Video: max 100MB
- Resolve mimeType từ extension nếu file.type rỗng
- Lưu vào `_adminMediaData = { base64, fileName, mimeType, size }`

### handleAddPost(e) — Dòng 937-992
- Gửi POST /api/posts với postData + mediaData
- Nếu scheduledTime <= now + 60s → runPostNow(id)

---

## 2. Backend (routes/posts.py)
| Method | Endpoint | Chức năng |
|--------|----------|-----------|
| GET | /api/posts | Lấy danh sách, lọc status/postType |
| POST | /api/posts | Tạo bài, ID = post_{ts}_{rand5}, status=pending |
| DELETE | /api/posts/<id> | Xóa bài |
| POST | /api/posts/<id>/run-now | Set pending + scheduledTime=now |
| PATCH | /api/posts/<id> | Cập nhật status, fbPostUrl, lastError |

---

## 3. Upload Media (background.js:1536-1812)

### isVideo Detection — Dòng 1633
```javascript
const isVideo = fMime.startsWith("video/") || (fName && fName.match(/\.(mp4|mov|avi|mkv|webm)$/i));
```
**QUAN TRỌNG:** PHẢI kiểm tra cả MIME VÀ extension!

### Video: vupload-edge 3-Step
1. START → `vupload-edge.facebook.com/.../start/` → video_id, upload_session_id
2. RUPLOAD → `rupload.facebook.com/fb_video/{hash}` → ruploadHash
3. RECEIVE → `vupload-edge.facebook.com/.../receive/` → confirm

### Photo: Single Upload
- `upload.facebook.com/ajax/react_composer/attachments/photo/upload?`
- multipart/form-data: farr, file, photo (blob)

---

## 4. Đăng bài GraphQL (_executePostItem:1817-2335)

### isVideo — Dòng 1946
```javascript
const isVideo = (payload.mediaData && (
    (payload.mediaData.mimeType && payload.mediaData.mimeType.startsWith("video/")) || 
    (payload.mediaData.fileName && payload.mediaData.fileName.match(/\.(mp4|mov|avi|mkv|webm)$/i))
)) || postType === "video" || postType === "reel";
```

### GraphQL Variables — Dòng 2047-2094
```javascript
attachments: [
    isVideo ? { video: { id: String(mediaId) } } : { photo: { id: String(mediaId) } }
]
```

### URL Construction — Dòng 2138-2210
- pfbid → `facebook.com/{actorId}/posts/{pfbid}`
- Reel → `facebook.com/reel/{id}`
- Video → `facebook.com/watch/?v={id}`
- Photo → `facebook.com/photo/?fbid={id}`
- Story → `facebook.com/permalink.php?story_fbid={pid}&id={actorId}`

### Seeding Comments — Dòng 2251-2306
- doc_id: `5384620808298758`
- feedback_id: `btoa("feedback:" + postId)`
- Interval: 1200ms

---

## 5. TIER 2 DOM — ĐÃ TẮT HOÀN TOÀN
Nếu GraphQL fail → trả lỗi. KHÔNG mở giao diện.

---

## 6. Checklist khi sửa code

### ❗ KHÔNG ĐƯỢC thay đổi:
- isVideo detection phải check cả MIME VÀ extension
- _adminMediaData phải có 4 trường: base64, fileName, mimeType, size
- GraphQL attachments: `{ video: { id } }` cho video, `{ photo: { id } }` cho ảnh
- vupload 3-step: START → RUPLOAD → RECEIVE
- fallbackDocIds giữ nguyên thứ tự
- URL construction handle cả pfbid, legacy_story_id, story_fbid

### ⚠️ Khi thêm tính năng:
- Thêm media mới → cập nhật regex ở 3 nơi:
  1. admin.html dòng 1173-1174
  2. background.js dòng 1633
  3. background.js dòng 1946
- Đổi GraphQL → test text, ảnh, video riêng biệt
- Đổi URL → test link từng loại bài

# Tích hợp multi-agent — 14/11/2026

Phạm vi theo yêu cầu mới nhất: hoàn thiện Codex, OpenCode và Antigravity; giữ luồng Claude của upstream. 9Router không phải phụ thuộc bắt buộc.

## Đã triển khai

- Codex dùng app-server; OpenCode/Antigravity dùng ACP. Office nhận tiến trình/kết quả và trả lời yêu cầu qua giao thức native, thay cho việc chỉ đọc stdout của lệnh chạy một lần.
- Giao việc mới, chọn model, ảnh, tiếp hội thoại, dừng/cancel và nhận lỗi dùng chung luồng Office. Codex/OpenCode fork khi giao thức hỗ trợ; Antigravity tiếp phiên gốc vì không công bố fork.
- Duyệt lệnh/file một lần trong Office, không tự cấp quyền lâu dài; giữ kiểm tra lệnh nguy hiểm trên điện thoại. Codex có thêm thẻ trả lời câu hỏi không chứa dữ liệu bí mật.
- Chuẩn hóa tên/input công cụ trước khi phân loại permission, gồm shell của Codex và tên công cụ Antigravity/OpenCode.
- Dừng cả cây tiến trình riêng của tác vụ trên Windows và đợi tiến trình thoát trước khi báo hoàn tất.
- Ghi lịch sử quan sát đã che bí mật, loại private reasoning; giữ tối đa 120 mục/phiên. Giữ liên kết hội thoại hoàn tất trong sáu giờ qua restart. Viewer theo đúng nhánh Office đang tiếp.
- Tuần tự hóa sự kiện theo phiên; giữ chỗ hội thoại trước thao tác bất đồng bộ để tránh hai lần chạy cùng lúc.
- Lỗi quota của agent khác không tác động tài khoản Claude.
- OpenCode đi theo executable/shim được chọn trên PATH. Installer chọn bridge theo phiên bản CLI, giữ cấu hình/provider có sẵn.
- Chọn model theo ACP `configOptions` khi CLI công bố, giữ API model cũ khi được hỗ trợ; hỗ trợ biến thể model OpenCode qua cấu hình effort.
- UI có loading/lỗi/rỗng/thử lại khi tải model, giữ prompt/model đang nhập; hiển thị đúng agent và quick replies cho các agent.
- `doctor --agent codex|opencode|antigravity` kiểm tra đúng CLI, bridge và hoạt động của agent đó.

## Bằng chứng

Trên Windows, đã gọi CLI thật bằng prompt chỉ yêu cầu trả lời `OFFICE_OK`, không dùng tool hoặc sửa file:

| Agent | Phiên bản thử | Kết quả |
| --- | --- | --- |
| Codex | 0.169.0 | Đã trả lời qua app-server, dùng provider/config hiện có; hook/MCP làm thời gian khởi động dài hơn |
| OpenCode | 2.2.7 | Đã trả lời qua ACP với `opencode/deepseek-v4.1-flash-free`, provider chính thức, không qua 9Router |
| Antigravity | 1.5.9 | Đã trả lời qua ACP với cấu hình/model native |

- Unit/integration: **200 pass, 0 fail, 5 skip** (205 bài).
- Browser: **14 pass** — 5 smoke, 9 bài về multi-agent/model/retry/panel/subagent.
- Production build `.next-agents`: pass. Lint/typecheck/module map kiểm tra riêng trước bàn giao.
- Test tích hợp kiểm tra cả duyệt quyền, trả lời câu hỏi, resume Antigravity, lịch sử và liên kết hội thoại sau khi khởi động lại server.
- API thật trên Office mới: Codex 8 model, OpenCode 216 (12 model provider `opencode`), Antigravity 18. Số lượng phụ thuộc cấu hình CLI, không hardcode trong app.
- Office đã áp dụng ở cổng 4310. Trước restart không có tác vụ Office hoặc permission đang chờ; đã lưu sáu lịch sử phiên cũ và bản sao runtime trong `test-results-agents/runtime-before-restart-1794664507693/`.

## Cấu hình OpenCode chính thức

Chọn model có tiền tố `opencode/` trong Chat/Giao việc để dùng provider chính thức. Có thể dùng các provider trực tiếp khác mà OpenCode đã cấu hình. Office không tự sửa đăng nhập hay provider.

Trong lần kiểm tra này, global config cũ của CLI vẫn có default `9router/ds4.1flash1017`. Nếu để ô model trống, CLI tiếp tục dùng default của chính nó. Vì vậy muốn chạy trực tiếp thì chọn model `opencode/...`; không ngầm đổi cấu hình global của người dùng.

## Giới hạn còn lại

- “Đồng đều” áp dụng cho các thao tác chung của tác vụ do Office khởi chạy. Các đặc tính riêng như Claude background/cache, quota/tài khoản của từng provider và fork Antigravity không thể coi là tương đương.
- Phiên được mở ngoài Office chỉ được điều khiển khi có native hook/giao thức phù hợp; bridge hoạt động không đồng nghĩa mọi permission của mọi terminal có thể trả lời trong Office.
- Model có trong danh sách không đảm bảo tài khoản được dùng model đó. Thử Claude hiện tại gặp lỗi model từ cấu hình router; theo yêu cầu mới nhất không tiếp tục thay đổi/chẩn đoán Claude.
- Chưa chạy thực tế trên macOS/Linux; 5 bài skip trên Windows liên quan Swift, unzip, rewrite và Unix socket. Không bật bỏ qua permission để vượt giới hạn.
- Git merge vẫn chưa commit/push vì `.git` chỉ đọc trong môi trường này. Script `scripts/finish-upstream-sync.ps1` đã được cập nhật để gồm các module mới; chạy từ terminal có quyền ghi repo.

# Review sâu My Office — 14/11/2026

## Kết luận

Repo hiện là một **văn phòng theo dõi và giao việc cho nhiều coding CLI**, được
mở rộng từ hệ thống ban đầu dành cho Claude Code. Các bridge cho Codex,
OpenCode, Antigravity và ZCode có mã thực thi và kiểm thử; không phải chỉ thêm
logo. Tuy nhiên, quy tắc về danh tính, quyền duyệt, trạng thái, lịch sử và dữ
liệu chưa được áp dụng nhất quán trên tất cả các đường đi.

Vấn đề chính không chỉ là chữ “Claude” trên giao diện. Có lỗi khiến bộ lọc
lệnh nguy hiểm bỏ sót yêu cầu Codex, lịch sử chat trỏ sai nhánh hội thoại và
hai agent bị gộp thành một hàng thống kê. Nên ổn định các bất biến này trước
khi thêm cơ chế agent tự phân vai và giao việc cho nhau.

Phạm vi tải được đánh giá: một người dùng trên một máy, nhiều phiên từ nhiều
CLI, một vài trang/điện thoại cùng truy cập. Không đánh giá như SaaS nhiều
khách hàng. Không yêu cầu microservice, hệ thống hàng đợi phân tán hay chuyển
toàn bộ ứng dụng sang một framework khác.

Đây là review working tree, gồm cả thay đổi chưa commit. Tài liệu
`docs/multi-agent-experience-design.md` được tạo ở lượt trước vẫn là đề xuất,
không được coi là đặc tả đã duyệt. Review này không triển khai đề xuất đó.

## Đã xem và kiểm tra

| Phần | Cách kiểm tra | Kết luận chính |
| --- | --- | --- |
| Sản phẩm, README, metadata, Việt/Anh | Đọc lời dẫn và truy ngược nơi dùng | Định vị và hướng dẫn chung vẫn thiên về Claude |
| Installer, uninstaller, doctor, service | Đọc đường đi từng agent, chạy test installer | Có bảo vệ hook có sẵn; doctor/service chưa thống nhất theo agent |
| Bridge Claude, Codex, OpenCode 1/2, Antigravity, ZCode | Đọc và chạy test; tạo sự kiện giả | Có hỗ trợ thực; còn mất nghĩa khi chuẩn hóa sự kiện |
| CLI discovery, lệnh chạy, model | Đọc mã; đối chiếu `--help` CLI cài trên máy | Codex fork có thật trong phiên bản đang cài; không báo nhầm là lệnh không tồn tại |
| Session, task, fork/resume, kết quả | Truy luồng HTTP → task runner → chat → history | Lịch sử phiên gốc và nhánh office chưa nối đúng trên UI |
| Phê duyệt, điện thoại, tunnel, PIN | Đọc guard; gửi request giả vào server cô lập | Có phân quyền nhưng còn khoảng hở ở phân loại tool Codex và `/event` |
| Danh tính, timeline, replay, Wrapped | Đọc và self-check đầu vào trùng tên/qua ngày | Tên hiển thị đang được dùng làm khóa thống kê |
| Chi phí, quota, cache, tài khoản | Truy nguồn số liệu đến UI | Backend giới hạn dữ liệu Claude khá rõ; tổng trên UI che mất trạng thái không biết |
| Máy, process, cleanup, nền tảng | Đọc platform/system/service và test parser | Có kiểm tra PID/start time; chức năng quản lý session vẫn tập trung vào Claude |
| Giao diện và demo | Chrome thật, dữ liệu giả, mô phỏng không có WebGL | Xác nhận demo toàn Claude, `/rc` sai agent và lite bị chặn khi WebGL lỗi |
| Render, khởi động, chất lượng | Đọc boot/renderer/loop/quality/optimize | Có tối ưu thực tế, nhưng boot UI bị buộc vào renderer |
| Build và CI | Build production riêng; lint, types, unit, E2E chọn lọc | Build qua, 63 test qua, module map lỗi; cần phân biệt test giả với CLI thật |

Đọc sâu các đường điều khiển và dữ liệu ở trên. Không đọc từng mesh, từng
cửa hàng, từng hoạt ảnh hay mọi câu thoại để tìm lỗi mỹ thuật. Không khẳng
định toàn bộ các bài E2E của repo đều đã chạy.

## Mức hỗ trợ thực tế của từng agent

| Khả năng | Claude Code | Codex | OpenCode | Antigravity | ZCode |
| --- | --- | --- | --- | --- | --- |
| Bridge sự kiện | Có | Có | Có, hai thế hệ API | Có | Có, ít sự kiện hơn |
| Giao việc mới trong project | Có | Có | Có | Có | Có |
| Nhắn vào hội thoại đang mở ngoài office | Tiếp tục theo cơ chế park hiện tại | Fork rồi tiếp tục nhánh office | Fork rồi tiếp tục nhánh office | Chưa hỗ trợ | Chưa hỗ trợ |
| Tiếp tục hội thoại do office tạo | Có | Có | Có | Có | Có |
| Chọn model | Nhập ID | Danh sách hoặc ID | Danh sách hoặc ID | Danh sách hoặc ID | Cấu hình của CLI |
| Duyệt quyền qua office | Tool/câu hỏi/kế hoạch | Allow/deny theo hook, có lỗi phân loại bên dưới | Chưa có bridge trả lời | Chưa có bridge trả lời | Chưa có bridge trả lời |
| Lịch sử trước khi office quan sát | Có đọc transcript | Có fallback đọc transcript, kiểm tra root và session ID | Chưa | Chưa | Chưa |
| Quota, đổi tài khoản, cache | Có phần chuyên biệt | Chưa có dữ liệu tương đương | Chưa có dữ liệu tương đương | Chưa có dữ liệu tương đương | Chưa có dữ liệu tương đương |
| Trạng thái sau restart office | Có thể đọc lại session file | Phụ thuộc sự kiện mới | Phụ thuộc sự kiện mới | Phụ thuộc sự kiện mới | Phụ thuộc sự kiện mới |

Các giới hạn có ghi rõ trong `docs/multi-agent.md` không tự động là bug.
Chúng trở thành vấn đề sản phẩm khi lời dẫn hoặc nút bấm hứa một khả năng
mà agent đang chọn không có.

“Nhiều CLI”, “nhiều model/provider”, “nhiều session” và “đội agent hợp tác”
là các khái niệm khác nhau. Repo đã có ba phần đầu ở những mức khác nhau.
Chưa thấy bộ điều phối công việc chung có quan hệ phụ thuộc, chuyển giao
trách nhiệm, bàn giao kết quả và quy tắc giải quyết khi nhiều agent sửa
cùng một tài nguyên. Đây là khoảng cách thiết kế nếu mục tiêu tiếp theo
là một đội agent tự phối hợp; chưa coi nó là yêu cầu bắt buộc đã được chốt.

## Cần sửa trước

### 1. Quyền Codex không đi qua chuẩn hóa, bộ lọc nguy hiểm bị bỏ qua

- **Chỗ liên quan:** `server/index.mjs:1157`, `server/index.mjs:1165`,
  `server/index.mjs:2054`, `src/shared/danger.js`.
- **Vấn đề và bằng chứng:** `/event` dùng `normalizeAgentEvent`, nhưng
  `onPermission` phân loại trực tiếp tên tool gốc. Với payload Codex
  `tool_name: shell_command` và một chuỗi lệnh `rm -rf` giả, thẻ được tạo
  với `type: other`; `dangerKey` trả `null`. Tên tool này cũng xuất hiện
  trong test tích hợp hiện có của repo. Nhánh điện thoại cho phép `allow`
  khi bộ lọc trả `null` và quyền duyệt điện thoại đã được bật.
- **Sửa nhỏ nhất:** chuẩn hóa cùng ngữ nghĩa tool/đầu vào ở ranh giới
  permission, giữ native session ID riêng để trả lời đúng CLI. Không coi
  lệnh shell không phân loại được là lệnh đã được đánh giá an toàn.
- **Nếu bỏ qua:** chính sách “lệnh nguy hiểm chỉ duyệt trên máy” không
  áp dụng đúng cho các yêu cầu Codex này. Chuỗi trong kiểm tra không được
  thực thi; chưa thử với một yêu cầu thật từ provider.

### 2. Che bí mật sau khi gửi nội dung tới dịch vụ dịch

- **Chỗ liên quan:** `server/index.mjs:301`, đặc biệt dòng 307.
- **Vấn đề và bằng chứng:** metadata của subagent đi qua `toVi()` rồi
  mới `redact()`. Bật tiếng Việt và dịch tự động, một token giả vẫn xuất
  hiện nguyên vẹn ở ranh giới gửi tới Google Translate. Kiểm tra đã chặn
  lời gọi mạng, không gửi bí mật thật ra ngoài.
- **Sửa nhỏ nhất:** che nội dung trước khi gửi dịch; thêm test bắt nội
  dung ngay tại ranh giới mạng, không chỉ kiểm tra chữ cuối cùng trên UI.
- **Nếu bỏ qua:** chữ đã che trên giao diện không có nghĩa dữ liệu gốc
  chưa từng rời máy.

### 3. `/event` nhận sự kiện có Host/Origin ngoài nguồn tin cậy

- **Chỗ liên quan:** `server/index.mjs:1964` đến kiểm tra Host ở dòng 2007.
- **Vấn đề và bằng chứng:** endpoint chỉ kiểm tra loopback, xử lý trước
  `hostAllowed`, và không chặn `Origin` như các hook khác. Request giả
  mang Host/Origin lạ, `Content-Type: text/plain`, nhận 200 và tạo session.
- **Sửa nhỏ nhất:** áp dụng Host guard trước endpoint và chính sách từ
  chối nguồn trình duyệt nhất quán với các hook khác. Giữ tương thích
  các bridge Node/curl hiện tại.
- **Nếu bỏ qua:** dữ liệu theo dõi có thể bị giả mạo khi request tới được
  listener. Kiểm tra này chứng minh hành vi HTTP; không chứng minh một
  chuỗi khai thác qua trình duyệt thật hoặc thực thi mã từ xa.

### 4. Chờ dịch làm sự kiện cũ ghi đè trạng thái mới

- **Chỗ liên quan:** `server/index.mjs:776`, `server/index.mjs:834`.
- **Vấn đề và bằng chứng:** trì hoãn dịch 600 ms, gửi `PreToolUse` rồi
  `Stop`: session chuyển `rest`, sau đó sự kiện tool cũ hoàn tất và đổi
  lại thành `work`. Mã HTTP không chờ một sự kiện xong trước khi xử lý
  sự kiện tiếp theo.
- **Sửa nhỏ nhất:** chuyển trạng thái và ghi sự kiện theo thứ tự nhận;
  việc dịch chỉ bổ sung nhãn, không sở hữu trạng thái thực thi. Kiểm thử
  trường hợp chậm, thất bại và hai session độc lập.
- **Nếu bỏ qua:** agent đã xong vẫn bị báo đang làm; timeline và điều
  kiện cho phép tiếp tục hội thoại đều có thể sai.

### 5. Hai request có thể tiếp tục cùng một hội thoại Claude

- **Chỗ liên quan:** `server/index.mjs:2160`, `server/index.mjs:2167`,
  `server/index.mjs:2181`.
- **Vấn đề và bằng chứng:** `threads.running` được kiểm tra trước khi
  `await parkForPhone`, nhưng chỉ đặt sau khi bắt đầu task. Self-check
  chạy nguyên đoạn route với thao tác park giả có độ trễ: hai request
  cùng session đều nhận 200 và tạo hai run. Không tắt process thật.
- **Sửa nhỏ nhất:** giữ chỗ theo khóa hội thoại trước lần `await` đầu
  tiên; giải phóng nếu park hoặc start thất bại. Giới hạn toàn cục ba
  task không thay thế khóa từng hội thoại.
- **Nếu bỏ qua:** hai tab hoặc hai thiết bị có thể ghi đồng thời vào
  cùng hội thoại, gây trả lời lẫn và xung đột ngữ cảnh.

## Nên sửa

### 6. Khung hội thoại đọc phiên gốc sau khi chat đã chuyển sang nhánh office

- **Chỗ liên quan:** `server/index.mjs:540`, `server/index.mjs:562`,
  `server/index.mjs:2168`, `src/office/ui/group-chat-view.js:501`.
- **Vấn đề và bằng chứng:** với Codex, task fork sang ID mới và trả lời
  được gắn vào nhân vật phiên gốc. Viewer vẫn gọi `/api/log?id=<gốc>`.
  Kiểm tra server cô lập thấy câu trả lời trong nhóm nhưng không có cả
  prompt lẫn câu trả lời nhánh office trong lịch sử mà viewer đọc.
- **Sửa nhỏ nhất:** phân biệt phiên nguồn và nhánh đang tiếp tục; viewer
  cần đọc đúng lịch sử nhánh office bằng tham chiếu do server kiểm soát.
  Giữ nguyên lịch sử gốc và kiểm tra giới hạn truy cập transcript.
- **Nếu bỏ qua:** người dùng nhìn một ngữ cảnh nhưng đang nhắn vào một
  ngữ cảnh khác; tài liệu “nhớ phần vừa trao đổi” trở nên khó kiểm chứng.

### 7. Đổi tên tool nhưng chưa đổi cấu trúc tham số

- **Chỗ liên quan:** `server/agent-events.mjs:2`, `server/agent-events.mjs:17`,
  các caller `classify`, `testRunner`, `stepOf` trong server.
- **Vấn đề và bằng chứng:** `exec_command` được đổi thành `Bash`, nhưng
  `{ cmd: 'npm test' }` không thành `{ command: 'npm test' }`. Phần đọc
  nhãn và nhận diện test chỉ nhìn `command`. Antigravity cũng gán
  `SearchQuery` vào `query` trong khi classifier `Grep` đọc `pattern`.
- **Sửa nhỏ nhất:** adapter chuyển cả tên và tham số về cấu trúc dùng
  chung; kiểm thử bằng fixture theo đúng dạng từng tool gốc.
- **Nếu bỏ qua:** hoạt động đọc/sửa/chạy test có thể bị hiển thị thiếu
  hoặc sai dù hook đã tới được server.

### 8. Timeline dùng tên hiển thị làm danh tính

- **Chỗ liên quan:** `src/shared/timeline.js:19`, `server/wrapped.mjs`.
- **Vấn đề và bằng chứng:** hai session riêng của Codex và OpenCode,
  cùng tên `project-ab`, tạo ra một hàng thay vì hai. Session hook được
  đặt tên từ thư mục và chỉ hai ký tự đầu ID nên trường hợp trùng có
  thể xảy ra; Wrapped cũng khử trùng theo tên ở một số phép tính.
- **Sửa nhỏ nhất:** dùng danh tính nguồn ổn định có loại agent và native
  session ID; tên chỉ là nhãn. Nếu cần nối lại qua restart, nối theo
  danh tính đó thay vì gộp mọi phiên trùng tên.
- **Nếu bỏ qua:** thống kê giờ làm, số session và lịch sử nhiều agent
  bị trộn; người dùng không thể phân biệt hai run độc lập.

### 9. OpenCode 2 làm mất nghĩa thất bại/ngắt thực thi

- **Chỗ liên quan:** `hooks/opencode.mjs:106` và nhánh `session.status`.
- **Vấn đề và bằng chứng:** `session.execution.succeeded`, `failed` và
  `interrupted` đều thành trạng thái idle, sau đó phát `Stop`. Self-check
  sự kiện thất bại nhận được `Stop`, không có `StopFailure` hay lý do lỗi.
- **Sửa nhỏ nhất:** giữ kết quả thành công/thất bại/ngắt riêng khi đổi
  sang sự kiện dùng chung; không làm mất lỗi trước khi đến UI.
- **Nếu bỏ qua:** một run lỗi có thể trông như hoàn tất bình thường.

### 10. Chế độ danh sách vẫn phụ thuộc WebGL khởi tạo thành công

- **Chỗ liên quan:** `src/office/main.js:221`,
  `src/office/scene/renderer.js:41`, `src/office/ui/lite.js:45`.
- **Vấn đề và bằng chứng:** renderer ném lỗi trước khi module UI/network
  được setup. Chrome được mô phỏng không có WebGL, đã lưu lựa chọn lite,
  vẫn có 0 session card và lỗi `Error creating WebGL context`.
- **Sửa nhỏ nhất:** cho phần theo dõi/giao việc ở chế độ danh sách khởi
  động độc lập khi renderer thất bại. Không chỉ bắt lỗi rồi tiếp tục
  gọi các module vốn cần renderer.
- **Nếu bỏ qua:** mất GPU hoặc WebGL bị chặn làm mất cả chức năng điều
  khiển công việc, dù chế độ danh sách được mô tả là không cần WebGL.

### 11. Không có dữ liệu chi phí bị hiển thị như chi phí bằng không

- **Chỗ liên quan:** `src/office/ui/activity.js:238`,
  `src/office/people/accountant.js:90`, `server/index.mjs:746`.
- **Vấn đề và bằng chứng:** backend không tính chi phí cho agent khác
  Claude; ô tổng cộng `usage?.cost || 0`. Với chỉ Codex, API trả usage
  null nhưng Chrome hiển thị `≈$0.00`. Phần kế toán cũng dùng phép cộng
  tương tự. Dấu xấp xỉ không thể hiện việc thiếu toàn bộ dữ liệu.
- **Sửa nhỏ nhất:** thể hiện chưa có dữ liệu hoặc tổng chỉ bao phủ một
  số phiên; không suy giá provider/model khác từ bảng giá Claude.
- **Nếu bỏ qua:** người dùng hiểu sai mức dùng thực tế, đặc biệt khi
  so sánh nhiều agent hoặc provider.

### 12. Lời dẫn, demo và các thao tác chung chưa phản ánh agent đang dùng

- **Chỗ liên quan:** `src/i18n/locales/{en,vi}/chat.js`, `ui.js`,
  `topbar.js`, `lite.js`; `src/office/ui/session-drawer.js:89`;
  `src/office/demo/demo.js:157`; metadata và README.
- **Vấn đề và bằng chứng:** giao OpenCode vẫn có lời xác nhận Claude;
  Codex drawer hiện `/rc`; demo không có agent nên fallback tất cả thành
  Claude. Hai trường hợp sau được quan sát trực tiếp trên Chrome.
- **Sửa nhỏ nhất:** dùng từ chung cho chức năng chung, tên agent cho
  hành động cụ thể, và điều kiện theo khả năng cho chức năng chuyên
  biệt. Demo cần nhiều agent với dữ liệu giả có nguồn rõ ràng.
- **Nếu bỏ qua:** sản phẩm tự phủ nhận hỗ trợ multi-agent đã có; người
  dùng agent khác được dẫn sang thao tác không phù hợp. Không đổi nhãn
  quota/đổi tài khoản Claude thành quota chung khi chưa có dữ liệu.

### 13. Shutdown chưa lưu phần dữ liệu đang thay đổi

- **Chỗ liên quan:** `server/index.mjs:238`, `server/index.mjs:2654`,
  `server/trophies.mjs:109`, `server/prefs.mjs:17`.
- **Vấn đề và bằng chứng:** state được lưu theo chu kỳ nhưng shutdown
  thoát ngay; server thử nghiệm kết thúc sau vài giây chưa có state.json.
  Một số JSON ghi trực tiếp lên file đích và bỏ qua lỗi ghi. Trên Windows
  kill có thể là dừng cưỡng bức, nên kết quả đó không riêng chứng minh
  xử lý tín hiệu; mã xử lý SIGTERM/SIGINT cũng không có bước lưu cuối.
- **Sửa nhỏ nhất:** lưu khi dừng có kiểm soát, ghi file tạm rồi đổi tên,
  báo lỗi lưu và chỉ xóa dấu cần lưu sau khi ghi thành công.
- **Nếu bỏ qua:** mất thống kê/feed gần nhất; lỗi ghi hoặc dừng giữa chừng
  có thể biến dữ liệu thành trạng thái mặc định sau restart. Thread,
  running task và card hiện còn nằm trong RAM, chưa có cơ chế khôi phục.

### 14. Service không lưu lại port cấu hình

- **Chỗ liên quan:** `bin/service.mjs:16` đến `bin/service.mjs:18`.
- **Vấn đề và bằng chứng:** factory nhận port tùy chỉnh, health check dùng
  port đó nhưng môi trường ghi vào launchd/systemd/Startup không có
  `OFFICE_PORT`. Ở lần đăng nhập sau hoặc service không kế thừa shell,
  server trở về 4310 trong khi hook có thể đang gửi tới port đã cấu hình.
  Kết luận từ mã tạo cấu hình; không cài lại service máy thật để thử.
- **Sửa nhỏ nhất:** ghi OFFICE_PORT vào môi trường service như OFFICE_HOST.
- **Nếu bỏ qua:** cài bridge theo port riêng có thể chạy khi thử trong
  terminal nhưng ngừng cập nhật sau khi restart hoặc đăng nhập lại.

### 15. Cài đặt và doctor chưa có một đường đi độc lập với Claude

- **Chỗ liên quan:** `bin/cli.mjs:69`, `bin/cli.mjs:92`,
  `bin/cli.mjs:252`, `docs/multi-agent.md`.
- **Vấn đề và bằng chứng:** các installer khác return trước phần xử lý
  `--service`; doctor dùng bộ sự kiện, status line, loop và câu hỏi của
  Claude ngay cả khi đã chọn `--agent`. Tài liệu đã thừa nhận hạn chế
  của doctor; đây là khoảng trống onboarding, không phải hỗ trợ bị giấu.
- **Sửa nhỏ nhất:** tách kiểm tra/cài runtime chung khỏi bridge từng
  agent; doctor kiểm tra đúng bridge được chọn và nói rõ giới hạn.
- **Nếu bỏ qua:** người dùng Codex-only/OpenCode-only gặp cảnh báo Claude
  không liên quan hoặc tưởng `--service` đã được áp dụng cho họ.

### 16. CI chưa bảo vệ đường đi multi-agent trên trình duyệt

- **Chỗ liên quan:** `.github/workflows/ci.yml:72`,
  `tests/e2e/multi-agent.spec.ts`, các test CLI giả trong `tests/unit`.
- **Vấn đề và bằng chứng:** CI chỉ chạy `@smoke`, bài kiểm tra chọn agent
  hiện không có tag đó. Các test task dựng CLI giả theo chính args và
  JSON dự kiến; chúng có ích cho routing nhưng không tự xác minh schema
  native hoặc khả năng tương thích phiên bản CLI. 63 bài vẫn qua trong
  khi các lỗi chuẩn hóa và permission ở trên tái hiện được.
- **Sửa nhỏ nhất:** đưa bài routing multi-agent nhẹ vào CI bắt buộc;
  thêm fixture native cho permission/tool/failure/history và test các
  bất biến ở trên. Đối chiếu phiên bản CLI trong một kiểm tra riêng,
  không cần gọi model có phí trong mọi PR.
- **Nếu bỏ qua:** CI xanh chưa đủ phát hiện regressions đúng ở phần đang
  được phát triển mạnh nhất. `checkJs: false` còn khiến phần lớn lõi JS
  nằm ngoài phạm vi kiểm tra kiểu dù lệnh typecheck đạt.

### 17. Bản đồ module làm CI hiện tại thất bại

- **Chỗ liên quan:** `docs/ARCHITECTURE.md`, `scripts/module-map.mjs`,
  `.github/workflows/ci.yml:29`.
- **Vấn đề và bằng chứng:** chạy trực tiếp
  `node scripts/module-map.mjs --check` trả exit code 1 và báo tài liệu
  lỗi thời trong working tree này.
- **Sửa nhỏ nhất:** cập nhật bằng script có sẵn, đưa tài liệu vào cùng
  thay đổi module; không bỏ kiểm tra chỉ để CI xanh.
- **Nếu bỏ qua:** bước check bắt buộc chặn những job phụ thuộc, dù build,
  lint, types và unit tests đã qua.

## Ưu tiên thấp hơn

### 18. API timeline bỏ sót ngày giữa khoảng 48 giờ

- **Chỗ liên quan:** `server/index.mjs:2446`.
- **Vấn đề và bằng chứng:** API chấp nhận khoảng tối đa hai ngày nhưng
  chỉ mở file ngày đầu/cuối. Fixture có hoạt động giữa ngày hôm qua
  không xuất hiện trong kết quả truy vấn 48 giờ.
- **Sửa nhỏ nhất:** duyệt mọi ngày trong khoảng hoặc thu hẹp hợp đồng
  API nếu chỉ định hỗ trợ một ngày. Cách đầu phù hợp code hiện tại hơn.
- **Nếu bỏ qua:** caller dùng khoảng thời gian rộng nhận thống kê thiếu.
  Ưu tiên thấp vì UI hiện chỉ có 1 giờ, 3 giờ, hôm nay và hôm qua.

## Nhận xét kiến trúc và hướng phát triển

### Nền tảng nên giữ

- CLI giữ credential/provider của nó. Office quan sát và gọi CLI, không
  tự gom khóa API của mọi nhà cung cấp.
- Tách server Node, shell Next và cảnh Three.js phù hợp công cụ cục bộ.
- Dedupe session theo namespace agent đã tồn tại; nên giữ và áp dụng
  xuyên suốt thay vì quay lại dùng tên hiển thị ở downstream.
- Có kiểm tra đường dẫn transcript Codex, so ID metadata và loại bỏ
  private reasoning; không nên đổi nó thành endpoint đọc file tự do.
- PIN có khóa thử sai, phân biệt tunnel với loopback, action trên máy
  có kiểm tra PID/start time. Không bỏ các lớp này khi gom code.
- Gộp mesh, giảm frame khi không tương tác, preset chất lượng và local
  assets là tối ưu có mục đích. Không cần viết lại cảnh 3D để sửa domain.

### Chỗ sở hữu đang chưa rõ

`server/index.mjs` đang cùng sở hữu HTTP, domain session, dịch, permission,
tài khoản, task, persistence và tunnel. Danh sách agent và quy tắc của
chúng còn lặp ở installer, normalizer, task runner, model discovery,
session API, worker, chat và tài liệu.

Hệ quả đã thấy là permission không dùng cùng chuẩn hóa với event, hỗ trợ
tool không đồng đều và chức năng Claude lọt vào session khác. Nên gom quy
tắc danh tính/khả năng có người dùng thực sự vào một nơi, còn chuyển đổi
payload, args và output để ở adapter của từng CLI. Không cần tạo framework
plugin hoặc interface tổng quát cho những khả năng chưa có.

Các khái niệm nên tách rõ khi phát triển tiếp:

1. **Loại CLI:** Claude Code, Codex, OpenCode, Antigravity, ZCode.
2. **Session/hội thoại:** native ID, nguồn, nhánh office và lịch sử.
3. **Task/run:** yêu cầu nào, chạy ở đâu, bởi session nào, đang chờ gì,
   thành công/thất bại/ngắt và kết quả.
4. **Model/provider:** giá trị đã chọn hoặc đã quan sát; nếu không biết
   thì để không biết. Tên CLI không xác định nhà cung cấp model.
5. **Vai trò trong đội:** builder/reviewer/researcher nếu người dùng
   thật sự muốn điều phối; không đồng nhất vai trò với tên CLI.

Với tải cục bộ hiện tại, khóa theo hội thoại, dữ liệu ghi nguyên vẹn và
lưu những tham chiếu cần khôi phục là bước vừa sức. Chưa có bằng chứng
cần database phân tán hay message broker. Nếu thêm phối hợp nhiều agent,
cần xác định quyền sửa cùng file/worktree, điều kiện bàn giao, dừng và
khôi phục run trước khi thêm nhiều hoạt ảnh hay lời thoại cho đội.

Việc bổ sung telemetry nhiều provider nên chỉ làm khi có nguồn đáng tin.
Quản lý process/RAM của agent khác cũng cần ánh xạ process thật; không đổi
tên danh sách Claude hiện tại thành danh sách mọi agent rồi coi là xong.
Ảnh task hiện được ghi vào `data/task-images` mà chưa thấy retention;
nên có chính sách giữ/xóa trước khi dùng lâu dài nhiều ảnh. Chưa đo tốc
độ tăng dữ liệu thực tế nên không xếp nó thành lỗi gây đầy ổ đã xác nhận.

## Thứ tự sửa đề xuất

1. **An toàn:** permission Codex, che trước dịch, guard `/event`.
2. **Tính đúng khi chạy:** thứ tự sự kiện, khóa hội thoại, failure status,
   danh tính timeline, đúng nhánh lịch sử.
3. **Trải nghiệm nhiều agent:** lời dẫn theo khả năng, unknown khác zero,
   demo hỗn hợp, onboarding/doctor độc lập Claude, fallback không WebGL.
4. **Độ bền và phát hành:** lưu dữ liệu, service port, CI regression và
   bản đồ kiến trúc.
5. **Sau đó mới mở rộng điều phối:** task/run lưu được, vai trò, bàn giao
   và bảo vệ tài nguyên chung theo workflow mà người dùng muốn.

Không đề xuất đổi toàn bộ tên biến `claude` hay role lịch sử đang lưu chỉ
để làm đẹp mã. Chúng cần thay khi gây sai ngữ nghĩa hoặc khi có migration
giữ tương thích, không phải bằng thay chuỗi hàng loạt.

## Bằng chứng chạy kiểm tra

Môi trường local: Windows, Node 26.8.1. Matrix CI của repo dùng Node 20/22;
chưa chạy lại cả hai phiên bản Node đó trong máy này.

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` | 63/63 đạt |
| `npm run lint` | Đạt |
| `npm run typecheck` | Đạt; không bao phủ lỗi kiểu trong phần lớn JS |
| Production build riêng `.next-review` | Đạt |
| `node scripts/module-map.mjs --check` | Không đạt, exit 1 |
| E2E mặc định, 6 bài chọn lọc | Không khởi chạy được browser: thiếu Chromium headless 1194 |
| Cùng 6 bài, đổi sang Chrome đã cài | 5 đạt, cảnh Pro timeout khi chạy song song |
| Chạy lại riêng cảnh Pro, một worker | Đạt; không xóa kết quả timeout trước đó |
| Self-check backend/domain | Tái hiện #1–9 ở các lớp tương ứng, trừ #6 dùng CLI giả và #5 dùng thao tác park giả |
| Probe Chrome riêng | Xác nhận không WebGL mất lite, demo toàn Claude, `/rc` ở Codex và tổng chi phí unknown thành zero |
| Self-check replay/shutdown | Xác nhận ngày giữa bị bỏ sót và chưa có state.json khi dừng trước chu kỳ lưu |

Đã đối chiếu trợ giúp CLI: Codex 0.169.0, OpenCode 2.2.7, Antigravity
1.4.12. Không gửi prompt tới model/provider thật, không đổi hook/tài khoản
hay cài lại service máy người dùng. Không thực thi chuỗi lệnh nguy hiểm;
chỉ truyền nó như dữ liệu trong yêu cầu permission rồi từ chối.

Harness và kết quả chạy nằm trong `test-results-review/` (git-ignored).
Build riêng không thay `.next` đang có. Next có tự sửa tsconfig khi build;
thay đổi đó đã được khôi phục sau khi kiểm tra không có thay đổi khác để
tránh để lại sửa cấu hình ngoài phạm vi review.

## Giới hạn của review

Chưa chạy mọi E2E, không đo FPS/điện năng/RAM qua soak test dài, không thử
push trên điện thoại thật, không mở tunnel internet thật, không thử quyền
của từng provider thật và không kiểm chứng lại native schema bằng phiên
agent trả phí. Không thử thao tác xóa cache/tắt app/service trên máy thật.
Những phần đó không được coi là đã đạt chỉ vì unit test hoặc build qua.

**Đánh giá cuối:** nền tảng có giá trị và đã có multi-CLI thực thi được,
nhưng chưa nhất quán để xem là một hệ multi-agent hoàn chỉnh, đáng tin
trong mọi luồng. Ưu tiên các lỗi an toàn và danh tính/trạng thái/lịch sử;
đổi câu chữ là một phần của công việc, không phải toàn bộ giải pháp.

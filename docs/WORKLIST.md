# My Office — danh sách công việc và bàn giao

Cập nhật: 14/11/2026.

Mục đích: gom toàn bộ việc còn lại từ review kỹ thuật, hướng multi-agent và
đề xuất UI/UX vào một nơi để tiếp tục ở đợt làm việc khác. Đây là backlog;
không đồng nghĩa mọi đề xuất thiết kế đã được duyệt để triển khai.

## 1. Đọc phần này trước khi tiếp tục

- Repo đang có nhiều thay đổi chưa commit của người dùng. Kiểm tra diff
  trước khi sửa; không reset, checkout đè hoặc xóa các file chưa theo dõi.
- Mục tiêu hiện tại là hỗ trợ Claude Code, Codex, OpenCode, Antigravity và
  ZCode đúng khả năng thực tế. Không đồng nhất tên CLI với model/provider.
- Không thay toàn bộ chữ hoặc biến `claude` bằng `agent`: một số tính năng
  thực sự chỉ hỗ trợ Claude, một số tên nằm trong dữ liệu đã lưu.
- Giữ mỗi CLI tự quản lý credential/provider. Không gom khóa API của các
  CLI vào office và không suy đoán quota/chi phí của provider khác.
- Đọc `AGENTS.md` nếu có; tuân thủ hướng dẫn môi trường cục bộ. Chỉ dùng CodeGraph nếu repo có `.codegraph/`.
- Không tự triển khai các việc trong file này khi nhiệm vụ chỉ là review
  hoặc chuẩn bị tài liệu. Chọn nhóm việc cụ thể cho đợt triển khai tiếp.

Tài liệu nền:

| Tài liệu | Dùng để làm gì |
| --- | --- |
| `docs/reviews/2026-11-14-project-multi-agent-review.md` | 18 phát hiện, bằng chứng, tác động và vị trí mã |
| `docs/multi-agent.md` | Mức hỗ trợ và giới hạn tích hợp từng CLI hiện tại |
| `docs/multi-agent-experience-design.md` | Đề xuất trải nghiệm multi-agent; vẫn là bản nháp |
| `docs/ARCHITECTURE.md` | Kiến trúc và bản đồ module; hiện cần cập nhật |

## 2. Đã làm và phần còn chờ áp dụng

- [x] M01 — Sửa lỗi đường dẫn project Windows dạng `~\Documents\...`.
  `/api/models` và `/api/tasks` trước đây chỉ mở rộng `~/...`, nên đường
  dẫn chính API trả về có thể bị từ chối với HTTP 400. Đã sửa hai chỗ trong
  `server/index.mjs` để nhận cả dấu `/` và `\` sau `~`.

- [x] M02 — Thêm test hồi quy tại `tests/unit/model-project-path.test.mjs`.
  Kiểm tra OpenCode và Antigravity lấy model/giao việc bằng đường dẫn
  project API trả về; project chưa được biết tới vẫn bị từ chối.

- [x] M03 — Kiểm tra sau sửa: 64/64 test đạt; lint đạt. CLI/API thật đã trả
  216 model OpenCode và 18 model Antigravity ở lần kiểm tra gần nhất.
  Số model có thể đổi theo cấu hình/provider; không hardcode các số này.

- [ ] M04 — Áp dụng bản sửa vào server My Office đang chạy.
  Xác định đúng tiến trình/cách khởi động, kiểm tra task và permission đang
  chờ trước khi restart. Sau restart, thử project dưới home Windows cho cả
  hai agent rồi tải lại trang. Chưa xác nhận bước này đã được thực hiện.

- [x] M05 — Kiểm tra tác dụng phụ của test/build lên `tsconfig.json`.
  Đã thêm `OFFICE_NO_NEXT=1` cho unit test server để các test chạy song song không mở Next `--dev` gây đua sửa/hỏng `tsconfig.json`; giữ `tsconfig.json` sạch sau build và test.

Không sửa parser model chỉ vì dropdown không hiện: đã xác nhận parser đọc
được output thật của hai CLI. Lỗi Windows ở M01 là một nguyên nhân đã tái
hiện; trạng thái loading/error bị ẩn trên UI là việc khác ở UX03.

## 3. Ưu tiên triển khai

| Mức | Nhóm việc | Điều kiện chuyển sang nhóm sau |
| --- | --- | --- |
| P0 | An toàn quyền duyệt và dữ liệu: R01–R03 | Có test từ chối đúng ở trust boundary |
| P1 | Trạng thái, đồng thời, danh tính, lịch sử: R04–R10 | Không trộn run/session; kết quả và lịch sử đúng |
| P1 | Độ bền dữ liệu và vận hành: R13–R15, M04–M05 | Khởi động lại an toàn, cấu hình và dữ liệu nhất quán |
| P2 | Trải nghiệm multi-agent và UI/UX | Dựa trên dữ liệu/capability đã đúng, không hứa tính năng chưa có |
| P2 | CI và phát hành: R16–R17 | Các luồng quan trọng được kiểm tra bắt buộc |
| P3 | Khoảng thời gian rộng, bảo trì, điều phối nâng cao | Chỉ làm khi phạm vi tương ứng được chọn |

## 4. Công việc kỹ thuật từ review

Giữ nguyên ID R01–R18 tương ứng phát hiện 1–18 trong báo cáo review.

- [x] R01 / P0 — Chuẩn hóa permission Codex trước khi phân loại nguy hiểm.
  Đã chuẩn hóa tool/input qua `normalizeTool` trong `onPermission` và `runAgent`, nhận diện shell/dangerKey trước duyệt quyền (`tests/unit/agent-office.test.mjs`, `tests/unit/codex-live.test.mjs`).

- [x] R02 / P0 — Che bí mật trước khi gọi dịch.
  `toVi` gọi `redact(...)` ở đầu hàm trước tra cache/gửi Google Translate và `ensureSub` redact trước khi gọi `toVi` (`tests/unit/security-boundaries.test.mjs`).

- [x] R03 / P0 — Thống nhất kiểm tra Host/Origin của `/event` với hook khác.
  `POST /event` đã áp dụng `isLoopback(req)`, từ chối `Origin` (HTTP 403) và kiểm tra `hostAllowed(req)` (HTTP 421) (`tests/unit/security-boundaries.test.mjs`).

- [ ] R04 / P1 — Tách chuyển trạng thái khỏi chờ dịch.
  `PreToolUse` cũ không được đổi session về `work` sau `Stop`. Có test dịch
  chậm/lỗi, nhiều sự kiện liên tiếp và hai session độc lập.

- [ ] R05 / P1 — Giữ chỗ theo hội thoại trước thao tác bất đồng bộ.
  Hai request cùng hội thoại không được cùng vượt qua bước park/start;
  request thứ hai nhận busy, chỗ giữ được giải phóng khi khởi chạy lỗi.

- [ ] R06 / P1 — Viewer đọc đúng nhánh hội thoại office đang tiếp tục.
  Phần liên quan: `threads`, task completion, API log và chat viewer.
  Phân biệt phiên nguồn với nhánh office; prompt/kết quả vừa gửi phải xuất
  hiện đúng lịch sử, giữ nguyên phiên gốc và kiểm tra an toàn transcript.

- [ ] R07 / P1 — Chuẩn hóa cả tên tool lẫn cấu trúc tham số từng CLI.
  Ví dụ: Codex `cmd` → trường command dùng chung; Antigravity tìm kiếm →
  trường pattern phù hợp. Fixture phải theo payload native để nhãn hoạt
  động, nhận diện test, đếm thao tác và kiểm tra quyền không đọc sai trường.

- [ ] R08 / P1 — Bỏ tên hiển thị khỏi vai trò khóa danh tính timeline.
  Phần liên quan: `src/shared/timeline.js`, `server/wrapped.mjs`.
  Hai agent cùng tên vẫn là hai hàng; nối phiên qua restart bằng danh tính
  ổn định, không gộp mọi session trùng tên.

- [x] R09 / P1 — Giữ nghĩa success/failure/interrupted của OpenCode 2.
  `hooks/opencode.mjs` tách `session.execution.succeeded` → `Stop`, `session.execution.failed` → `StopFailure`, `session.execution.interrupted` → `Interrupt` (`tests/unit/opencode-plugin.test.mjs`).

- [ ] R10 / P1 — Cho chế độ danh sách hoạt động khi WebGL thất bại.
  Phần liên quan: boot, renderer, lite và live connection. Có test không
  WebGL nhưng vẫn xem được session, đọc hội thoại và thao tác được những
  chức năng không cần 3D. Không tiếp tục gọi module cần renderer bị thiếu.

- [ ] R11 / P2 — Phân biệt chưa có số liệu, tổng một phần và số 0.
  Phần liên quan: HUD, kế toán, Wrapped và session stats. Codex-only chưa
  đo chi phí không được hiện tổng như đã biết là $0.00; hiển thị phạm vi
  bao phủ của tổng khi chỉ một số session có dữ liệu.

- [ ] R12 / P2 — Đồng bộ nội dung và thao tác theo agent/capability.
  Bao gồm Việt/Anh, chat, giao việc, empty state, notification, drawer,
  README, metadata, mô tả package và alt text. Không hiện `/rc` của Claude
  ở session khác. Demo có đủ loại agent với dữ liệu giả được gắn đúng.
  Quota, account switching, cache và các khả năng chỉ có ở Claude giữ nhãn
  Claude rõ ràng; không đổi tên thành khả năng chung khi chưa hỗ trợ.

- [x] R13 / P1 — Làm bền dữ liệu khi ghi file và shutdown.
  `state.json`, `totals.json`, `prefs.json` ghi qua file tạm rồi rename, chỉ xóa dấu `dirty` khi thành công và flush đồng bộ `saveStateSync()` + `trophies.saveSync()` khi thoát (`tests/unit/persistence-service.test.mjs`).

- [x] R14 / P1 — Ghi OFFICE_PORT vào cấu hình service.
  `bin/service.mjs` xuất `serviceEnv` gồm `OFFICE_PORT` cho launchd/systemd/Windows Startup (`tests/unit/persistence-service.test.mjs`).

- [ ] R15 / P2 — Tách runtime chung và bridge từng agent trong CLI.
  `install --agent ... --service` không bị bỏ qua im lặng; `doctor --agent`
  kiểm tra đúng bridge, CLI, trạng thái sự kiện và giới hạn hỗ trợ.
  Người dùng Codex-only/OpenCode-only không phải cài hook Claude để bắt đầu.

- [ ] R16 / P2 — Đưa regression multi-agent vào CI bắt buộc.
  Có bài routing UI nhẹ, fixture native cho permission/tool/failure,
  fork/resume/history, path Windows và unknown data. Test CLI giả kiểm tra
  được routing nhưng không được xem là bằng chứng CLI/provider thật đã qua.

- [x] R17 / P2 — Cập nhật và giữ bản đồ module đồng bộ.
  `node scripts/module-map.mjs --check` đạt.

- [ ] R18 / P3 — Đọc đủ mọi ngày trong khoảng truy vấn timeline.
  Có fixture 48 giờ với dữ liệu ở ngày giữa; API không bỏ mất hoạt động đó.

## 5. Công việc UI/UX

Hướng hình ảnh đề xuất: giữ văn phòng 3D sinh động; các phần điều khiển cần
rõ, đồng bộ và ít lớp. Không thay thư viện/font hoặc thêm hiệu ứng chỉ để
làm mới giao diện. Các bố cục sau cần được xem như đề xuất, chưa triển khai.

- [ ] UX01 / P2 — Thiết kế Giao việc theo Project → Agent → Model.
  Bỏ danh sách tích project × agent. Chọn project một lần, chọn agent riêng,
  rồi chọn model và chế độ tạo mới/tiếp tục nếu agent hỗ trợ. Model phải
  đúng agent/project; nội dung đã nhập không mất khi đổi lựa chọn.

- [ ] UX02 / P2 — Làm form giao việc luôn dễ thao tác.
  Giữ phần nhập việc và nút gửi trong tầm nhìn; nút ghi đúng agent đích.
  Thông tin thêm, ảnh và lựa chọn chuyên biệt không chiếm hết khung. Khi
  lỗi, giữ prompt/ảnh/model để thử lại; không ngụ ý đã giao khi start thất bại.

- [ ] UX03 / P2 — Hiện rõ vòng đời tải danh sách model.
  Có trạng thái đang tải, thành công, rỗng và lỗi; có nút thử lại. Không
  ẩn lỗi thành một dropdown biến mất, không giữ lần fetch lỗi mãi theo key.
  Tìm kiếm model theo tên/ID; nhóm provider chỉ khi có nguồn dữ liệu đúng.
  Giữ tùy chọn mặc định CLI, không tự chọn model khác mà không báo.

- [ ] UX04 / P2 — Giảm popup chồng nhau trên desktop.
  Đề xuất: trái là project/session, giữa là văn phòng hoặc danh sách, phải
  là panel chi tiết theo ngữ cảnh. Dùng lại vùng bên phải cho hội thoại,
  hoạt động và giao việc thay vì nhiều lớp cửa sổ cùng che cảnh. Khi đổi
  panel vẫn biết session đang chọn và có đường quay lại rõ ràng.

- [ ] UX05 / P2 — Đưa việc cần người dùng xử lý lên đầu.
  Ưu tiên chờ duyệt, câu hỏi và task lỗi trước quota/RAM/trang trí. Các số
  tổng quan bấm được để lọc. Cảnh báo không tự cướp focus khi đang nhập;
  trạng thái không chỉ thể hiện bằng màu.

- [ ] UX06 / P2 — Rõ danh tính và ngữ cảnh trên mỗi session.
  Hiện tên agent, việc đang làm, project, trạng thái và độ mới của dữ liệu.
  Tên/đường dẫn dài có cách xem đủ. Hiện phiên nguồn/nhánh office khi liên
  quan; không ngụ ý model/provider đã biết khi backend chưa có dữ liệu.

- [ ] UX07 / P2 — Đồng bộ màu, chữ và component giữa dashboard/chat/form.
  Giữ nền xanh than và accent thương hiệu hiện có; quy định riêng màu
  trạng thái, logo agent và hành động chính. Chat trắng/ô nhập tối cần được
  chỉnh để hòa với theme. Tận dụng Be Vietnam Pro/JetBrains Mono đã có;
  chữ nội dung desktop khoảng 14–15px, phụ 12–13px, số liệu không nhảy độ
  rộng, đường dẫn/code dễ đọc. Khoảng cách, viền, bo góc và focus nhất quán.

- [ ] UX08 / P2 — Hiện lựa chọn Văn phòng / Danh sách có nhãn rõ.
  Bỏ việc phải đoán icon nhỏ. Giữ nguyên phiên chọn và bộ lọc giữa hai chế
  độ; cảnh 3D giảm chuyển động khi đang đọc/nhập. Tôn trọng reduced motion,
  tránh nhấp nháy và animation thu hút chú ý liên tục.

- [ ] UX09 / P2 — Tối ưu mobile cho việc đọc, duyệt và giao việc.
  Giữ thanh tab dưới, làm các luồng chính thành màn dễ quay lại. Nút gửi
  nằm trên bàn phím/vùng an toàn, vùng chạm khoảng 44px trở lên, ô nhập đủ
  lớn. Giữ draft khi đổi tab, thử bàn phím mở và cả hai hướng màn hình.
  Danh sách cần bạn được ưu tiên và phần 3D không cản trở thao tác.

- [ ] UX10 / P2 — Onboarding theo từng agent.
  Chọn agent → kiểm tra CLI/bridge → mở phiên đầu tiên. Phân biệt đã sẵn
  sàng, thiếu CLI, chưa có bridge và chưa nhận sự kiện. Hướng dẫn tiếp theo
  phải đúng agent/hệ điều hành; không chỉ nói mở Claude Code.

- [ ] UX11 / P2 — Kiểm tra accessibility xuyên suốt các luồng vừa đổi.
  Dùng được bàn phím; focus nhìn thấy; mở/đóng dialog quản lý và trả focus
  đúng; Escape/Quay lại nhất quán; label của control đầy đủ; độ tương phản
  đủ; lỗi/loading có thông báo đọc được. Kiểm tra chọn model và permission
  trước, không chỉ các nút trang trí.

Thứ tự UI/UX đề xuất: UX01–UX03 → UX04–UX06 → UX07–UX08 → UX09–UX11.
Các phần liên quan quyền/lịch sử/số liệu phụ thuộc R01, R06 và R11.

## 6. Kiến trúc và bảo trì có mục đích

- [ ] A01 — Gom quy tắc danh tính/khả năng đang bị lặp ở nhiều lớp.
  Dựa trên nhu cầu thật của năm CLI; không tạo framework plugin tổng quát.
  Dữ liệu capability cho UI không thay thế authorization trong API.

- [ ] A02 — Tách trách nhiệm khỏi `server/index.mjs` khi sửa các nhóm trên.
  Ưu tiên event/session, permission, task và persistence theo nơi sở hữu
  bất biến. Giữ nguyên validation và xử lý lỗi; không chỉ chia file theo
  số dòng hoặc tạo wrapper không có trách nhiệm riêng.

- [ ] A03 — Bổ sung kiểm tra kiểu dần cho module JS quan trọng.
  Bắt đầu từ payload chuẩn hóa, permission, task và dữ liệu public bằng
  JSDoc/checkJs có phạm vi. Không yêu cầu đổi toàn bộ repo sang TypeScript.

- [ ] A04 — Có chính sách giữ/xóa ảnh task và state có vòng đời.
  `data/task-images` chưa thấy retention. Đo dữ liệu thực tế trước khi đặt
  giới hạn; không xóa ảnh đang được task dùng hoặc dữ liệu lịch sử cần giữ.

- [ ] A05 — Hiển thị giới hạn telemetry và quản lý process trung thực.
  RAM/process của agent khác cần ánh xạ process thật và guard an toàn;
  không đổi tên danh sách process Claude thành danh sách mọi agent.

## 7. Kiểm chứng tích hợp thật còn thiếu

- [ ] V01 — Đối chiếu fixture với native schema/version CLI đang hỗ trợ.
  Bao phủ event bắt đầu/kết thúc, tool, lỗi, ngắt, permission và kết quả;
  không viết fixture chỉ để khớp parser hiện có.

- [ ] V02 — Kiểm chứng trọn luồng từng CLI/provider trong phạm vi được chọn.
  Tạo mới, chọn model, trả kết quả, tiếp tục ngữ cảnh, lỗi, ngắt và giới hạn
  approval. Với OpenCode thử fork/resume; với Antigravity phân biệt hội
  thoại office tạo với phiên đang mở bên ngoài. Không tự gọi model có phí
  khi nhiệm vụ chỉ yêu cầu liệt kê model hoặc review.

- [ ] V03 — Kiểm tra platform/runtime và background service.
  Node 20/22 theo CI; Windows/macOS/Linux theo phần thay đổi. Có port riêng,
  đường dẫn có dấu cách, home Windows và trường hợp thiếu CLI.

- [ ] V04 — Kiểm tra browser và thiết bị thật.
  Browser đúng phiên bản Playwright cho CI; Chrome fallback chỉ là bằng
  chứng bổ sung. Mobile thật, notification, tunnel và thao tác duyệt quyền
  cần kiểm tra riêng; không suy đã đạt từ desktop giả lập.

- [ ] V05 — Đo hiệu năng và phục hồi dài hạn khi luồng chính đã ổn.
  Thời gian mở trang, khả năng dùng UI khi 3D lỗi, CPU/RAM/FPS, nhiều
  session, reconnect, restart và kích thước dữ liệu. Chỉ tối ưu nơi có số đo.

## 8. Điều phối đội agent — phần cần chốt thiết kế riêng

Các việc dưới đây là hướng mở rộng, chưa phải tính năng được duyệt để xây.

- [ ] F01 — Chốt workflow hợp tác mong muốn bằng một ví dụ thực tế:
  người dùng phân công thủ công hay một agent điều phối tự giao việc.
- [ ] F02 — Phân biệt CLI, model/provider, session/branch, task/run và vai
  trò builder/reviewer/researcher trong mô hình dữ liệu và UI.
- [ ] F03 — Thiết kế quyền sở hữu task, trạng thái, điều kiện bàn giao,
  quan hệ phụ thuộc và cách tổng hợp kết quả.
- [ ] F04 — Thiết kế cách bảo vệ file/worktree/tài nguyên khi nhiều agent
  cùng sửa, cùng chạy lệnh hoặc cùng tiếp tục ngữ cảnh.
- [ ] F05 — Thiết kế dừng/hủy/khôi phục, run bị mất kết nối hoặc server
  restart; không khôi phục quyền duyệt cũ như thể vẫn còn hiệu lực.
- [ ] F06 — Chỉ sau khi chốt workflow mới chọn phạm vi triển khai nhỏ nhất;
  chưa có bằng chứng cần microservice, database phân tán hay message broker.

## 9. Tiêu chí hoàn thành một đợt công việc

- [ ] Chọn rõ các ID được xử lý, nêu caller/UI/test/config bị ảnh hưởng.
- [ ] Có regression test cho bất biến bị lỗi; giữ validation, authorization
  và compatibility của hook/session/dữ liệu đang lưu.
- [ ] Chạy kiểm tra nhỏ nhất đủ chứng minh; chạy các gate gần phần đổi.
- [ ] Nếu đổi module, cập nhật bản đồ kiến trúc; nếu đổi hỗ trợ agent,
  cập nhật cả Việt/Anh, README và ma trận hỗ trợ.
- [ ] So diff để không ghi đè thay đổi của người dùng và không để lại sửa
  cấu hình do test/build hay thư mục tạm không cần thiết.
- [ ] Ghi riêng: đã sửa trong mã, đã áp dụng lên server, đã thử với CLI
  thật và chỉ mới qua test giả. Không gộp chúng thành một trạng thái xong.
- [ ] Cập nhật checkbox trong file này cùng kết quả kiểm tra và phần chưa
  xác minh; không đánh dấu hoàn thành chỉ vì build/lint qua.

## 10. Bằng chứng hiện có và giới hạn

- Lượt review ban đầu: 63 test đạt, lint/typecheck và build production
  riêng đạt; module-map check không đạt.
- Sau sửa đường dẫn model: 64 test đạt, lint đạt. Xem M01–M05 trước khi
  khẳng định thay đổi đã có trên server đang chạy.
- E2E mặc định thiếu Chromium headless 1194. Chạy sáu bài chọn lọc bằng
  Chrome: năm qua ngay, cảnh Pro timeout khi song song rồi qua khi chạy
  riêng. Chưa chạy toàn bộ E2E và chưa kết luận nguyên nhân timeout.
- CLI help đã đối chiếu: Codex 0.169.0, OpenCode 2.2.7, Antigravity 1.4.12.
  Model enumeration thật thành công không chứng minh inference/fork/resume
  thật đã đạt. Nhiều test task hiện dùng CLI giả.
- Harness/ảnh/log ở `test-results-review/` là dữ liệu cục bộ git-ignored,
  không phải nguồn bàn giao bắt buộc. Dùng báo cáo review và test repo để
  tái hiện nếu những artifact đó không còn.
- Chưa kiểm mọi E2E, tác vụ provider thật, điện thoại thật, push/tunnel thật,
  thao tác service/cleanup thật hoặc soak test dài. Không coi các mục này
  là đã qua kiểm tra.

Điểm bắt đầu đề xuất cho đợt tiếp theo: áp dụng/xác minh M04–M05, sau đó xử
lý R01–R03; nếu chọn đợt thiết kế UI trước, bắt đầu UX01–UX03 và giữ các
tính năng chưa hỗ trợ được diễn đạt trung thực.

# Arduino 3D Việt Nam — authored breadboard hole-link: local candidate QA

**Ngày kiểm chứng:** 2026-10-30 (Asia/Ho_Chi_Minh).

**Workspace bắt buộc:** `C:\Work\Arduino3DVietnam` (CoS: `/arduino3dvietnam`).
**Nhánh phát triển:** `feature/post-v16-interactive-breadboard-wiring`.
**HEAD đã nghiệm thu trước pha này:** `c745aa5ddadd8e200234f70013511ddda33ad604`.
Các kết quả bên dưới là kiểm chứng **source candidate mới chưa commit** trên nền
HEAD đó. Không được quy chúng cho production hoặc dùng các CI run cũ thay bằng
chứng cứ của candidate.

## Mục tiêu và quyền hạn

Người học cần chủ động **Gán** hai terminal canonical vào hai lỗ breadboard
`A1..J63` của đúng lesson/profile/session hiện tại, bật 3D hole-picker, chọn
hai lỗ bằng native HTML hoặc chọn một lỗ rồi kéo pointer trên 3D đến lỗ thứ
hai, thấy ghost/READY **chỉ mang tính xem trước**, sau đó tự bấm **Xác nhận**.

Controller tái xác minh chính xác lesson, terminal ownership, profile và
placement revision. Chỉ Confirm mới gửi frozen metadata
`source:"authored-hole-confirm",physicalVerified:false` đến
`LabEditor.connectAuthoredHoleTerminals()`, rồi qua `connectTerminals()` và
`src/circuit-router.js` để tạo learner graph. Scene, contact group, ghost,
hole selection, SVG/Inspector, history và checkpoint guide không có quyền tự
thêm dây hoặc xác nhận tiến độ/bài học. Giao diện 3D/2D/Explorer và Undo/Redo
chiếu cùng một graph canonical hiện có.

**Không xác minh** vị trí lỗ mm/CAD, contact vật lý, điện áp, công suất hay
compiler cho Sketch đang sửa. Bài 10/14 chỉ có phạm vi tín hiệu, checkpoint
manual bài 10 không được auto-mastered. Giữ nguyên 16 bài tiếng Việt và 48
authored checkpoints.

## Bằng chứng nghiệm thu local sau source freeze

| Cổng | Kết quả quan sát thực tế |
| --- | --- |
| Bun pure model/UI | **929/929 PASS**, 37 suites. Bao gồm native scene-hole bridge **24/24**, LabEditor precision **6/6** |
| Three.js source và native raycast | **16/16 source/lifecycle** và **2/2 InstancedMesh raycast** bằng Bun; full browser suite kiểm tra chính xác **280/280** scene lifecycle checks |
| Python unit | `python -m unittest discover -s tests -q`: **100/100 PASS** sau sửa cuối |
| Release unit | `python -m unittest tests.test_release -q`: **29/29 PASS** sau sửa cuối |
| Packaging | `python scripts/build_site.py` PASS; `dist/` có **137 file** (gồm marker), không thêm toolchain hay dependency bên ngoài |
| Syntax/whitespace | Node --check trên app/scene; Python `py_compile` E2E; `git diff --check`: PASS |
| Exclusive Windows Chrome / real Playwright E2E | **511/511 PASS, failed 0** trên candidate cuối, gồm chuột/touch/pen contract, real Three.js drag C32→H32, Confirm, projection 2D/Explorer, Undo/Redo, focus và mobile 375 px |
| Browser runtime diagnostics | **0** console errors, **0** unexpected warnings, **0** GPU diagnostics theo JSON receipt |
| Historical regressions | Python AST đối chiếu **362/362** static `check()` callsites tại HEAD; candidate có **379** static calls (17 mới), **không mất** một callsite lịch sử và không trùng tên tĩnh |
| Independent P0/P1 source audits | Worker21 và worker31 báo **0 P0/0 P1** sau sửa focus và review lại re-arm; đây là read-only source review, **không** thay cho browser tests |

**Receipt cuối (chỉ tạo sau full browser PASS):**

- `screenshots/post-c745-hole-link-fourth-local-20261030.json`
- SHA-256: `f5884e09254d81be924d73adf60c693066c6acebf63a9a0cb939b530b546ed44`
- Tổng: 511 PASS / 511, FAILED=0; console errors / unexpected warnings /
  GPU diagnostics đều 0.
- `screenshots/` là artifacts kiểm thử local, **không** stage lên branch.

Các lần chạy candidate trước đó **không được tính là PASS**:

1. Lần một: source contract kiểm tra vị trí logic cũ của
   `finishBreadboardHoleStudyTap()` sau khi worker refactor. Sửa test kiểm
   tra helper tại vị trí mới với đầy đủ negative stale/layout/lesson/instance.
2. Lần hai: một context mobile 375 px không đạt 3D readiness trong full run;
   tách biệt sau đó đã kiểm chứng Chrome khởi tạo Three.js tại
   **375/768/1024 px** không có JS/request error. Tăng cường chẩn đoán E2E,
   **không tăng timeout hay bỏ gate**.
3. Lần ba: flow thực tế đã qua drag→Confirm→2D/Explorer→Undo/Redo, nhưng
   sau 2D→3D, bật lại hole-picker chưa cập nhật disabled state của native
   Enable. Sửa `src/app.js` để gọi `breadboardUI.update()` sau explicit
   toggle, trước scene projection. Chrome targeted xác minh nút được mở lại,
   Cancel qua Enter phục hồi focus và learner graph giữ nguyên. E2E mới có
   assertion riêng cho re-arm và hai placement còn nguyên.
4. Lần bốn: toàn bộ **511/511 PASS** như receipt ở trên.

Lỗi focus accessibility trước đó cũng đã được sửa tại controller: khi
Confirm/Cancel đang được keyboard focus chuyển từ READY/active sang OFF,
focus chỉ chuyển đến Enable nếu Enable thực sự visible, connected và enabled;
denied Confirm giữ focus ở nút Confirm. Browser và fake/native contract đều
kiểm tra hành vi đó, không che lỗi bằng cách nới assertion.

## Ranh giới phát hành

Tại thời điểm lập ledger local này, code feature **chưa được commit/push** và
**chưa có GitHub Actions trên SHA mới**. Điều kiện tiếp theo là review
diff+staging đúng danh sách source/test/docs, commit và non-force push **chỉ
feature branch**, rồi xác minh cả ba manual workflows trên **cùng full SHA**:

1. `arduino-compile-manual.yml` — **16 reference Sketches**, tuyệt đối
   không tuyên bố compile learner-edited draft;
2. `browser-e2e-manual.yml` — Ubuntu Chromium và offline/PWA;
3. `release-gates-manual.yml` — read-only preflight **chỉ sau hai workflow
   trước cùng SHA hoàn tất/success**.

CI run IDs/artifact hashes và protected production verification phải được
đọc từ kết quả thực, không được suy từ ledger này. Không merge, deploy Pages,
   force push, tạo/tag/release, thay đổi firmware/backup/LICENSE hay kích hoạt phần
cứng. Production `main`/`v1.6.0` ở
`341449b12d50c681be3f04d6e291965bf6015d99` vẫn là mốc cần
kiểm tra read-only trước và sau khi push.

# QA release/PWA — ứng viên v1.3.0

Tài liệu này bổ sung các gate phát hành có thể chạy hoàn toàn offline bằng Python. Trọng tâm là tính toàn vẹn của `dist/`, cache Service Worker theo nội dung, GitHub Pages project subpath và đường CI thực sự được deploy.

## Gate tự động

Chạy từ thư mục gốc dự án:

```powershell
python -m unittest discover -s tests -v
python scripts/build_site.py
```

`tests/test_release.py` hiện kiểm tra **10 hợp đồng**, gồm:

1. Danh sách precache của `sw.js` phải khớp chính xác các tệp release trong `scripts/build_site.py`, cộng route `./`, không có URL tuyệt đối hoặc mục trùng.
2. Build cùng input phải tạo cùng cache ID; thay đổi một release asset phải đổi cache ID; `dist/` chỉ chứa allowlist release và marker của builder.
3. PWA phải dùng đường dẫn tương đối (`./`) cho manifest scope/start URL, đăng ký Service Worker và navigation fallback để chạy dưới GitHub Pages project subpath như `/Arduino3DVietnam/`.
4. Workflow Pages phải chạy unit tests trước build, chuyển đúng artifact `dist` sang deploy job và dùng Pages deployment action.
5. Máy chủ local phải trả MIME phù hợp cho JavaScript module, Web App Manifest và SVG.

Các thử nghiệm bổ sung chặn đường dẫn ra ngoài workspace/symlink, nguồn avr8js hoặc giấy phép sai provenance/checksum, sai manifest/Sketch/HEX/flash và nguồn bài học không khớp, cùng việc thiếu những module AVR/solver và license trong release. Đóng gói không dựa vào giá trị hash tự công bố mà còn kiểm tra source, Sketch và Intel HEX thực. Tổng bản xuất website có 54 file cố định và marker, không chứa toàn bộ thư mục development.

Kết quả cũ v1.2: `test_release.py` **5/5** và toàn suite ban đầu **22/22** là bằng chứng lịch sử. Kết quả ứng viên v1.3 ngày 28/10/2026: `test_release.py` **10/10**; toàn bộ `python -m unittest discover -s tests -q` **67/67 PASS**, `python scripts/build_site.py` PASS; 16 HEX trong `dist/assets/firmware/` cũng được xác minh trực tiếp với `export_firmware.py`. Test content-addressed build dùng fixture trong thư mục tạm; bản build thật chỉ thay `dist/` có marker được cho phép.

Bộ Chrome E2E hiện có trong `tests/e2e_browser.py` đã kiểm tra bản `dist/` được Service Worker điều khiển, sau đó ngắt mạng và reload thành công. Vì vậy không thêm `tests/offline-contracts.js`: một test JavaScript riêng sẽ lặp lại bằng chứng end-to-end hiện có nhưng không tăng độ tin cậy khi môi trường không có Node.

## Hợp đồng triển khai GitHub Pages

Bản phát hành không giả định website nằm ở `/`. `index.html`, `site.webmanifest`, đăng ký `./sw.js` và toàn bộ precache đều là đường dẫn tương đối. Điều này cho phép cùng `dist/` chạy ở root domain hoặc project subpath mà không cần sửa base URL trong build.

Repository hiện là **Private**: https://github.com/xuan2261/Arduino3DVietnam. Đẩy mã lên nhánh main chỉ chạy build/check, không tự triển khai Pages. Job release-gates trong Pages workflow có quyền đọc GitHub Actions và chỉ chạy thủ công; scripts/verify_release_gates.py yêu cầu cả hai workflow biên dịch C++ và Chrome E2E đều có status completed, conclusion success và workflow_dispatch cho **đúng head_sha hiện tại**. Ngoài ra, **16 firmware HEX** phải trùng byte với artifact GitHub Actions cụ thể, còn hạn, sau khi kiểm tra ancestor của commit nguồn compile, hash bài học/Sketch/flash, manifest, toolchain và artifact digest. Một run cũ hoặc thất bại mới hơn không được phép vượt qua cổng. Script chỉ đọc và không thay đổi repository.

Để xác minh cổng phát hành mà **không xuất bản website**, có workflow riêng `.github/workflows/release-gates-manual.yml` (chỉ `workflow_dispatch`, quyền đọc, không deploy). Chạy sau khi hai workflow kiểm chứng khác đã PASS trên cùng SHA, lưu log PASS của script. Trong Pages workflow, `check` chỉ test/build; `release-gates` phải PASS trước job `package` tạo/upload artifact rồi mới được `deploy`. Chi tiết chứng cứ và quy tắc hết hạn nằm trong [FIRMWARE_RELEASE_GATE.md](FIRMWARE_RELEASE_GATE.md). Chỉ khi chủ repository chủ động quyết định công bố mới chạy Pages workflow thủ công.

Builder tạo cache name dạng `arduino3d-viet-static-<16 hex>` từ tên và byte của tất cả release assets trừ chính `sw.js`. Khi bài học, CSS, module, tài liệu hoặc vendor asset đổi, browser nhận Service Worker mới với cache ID mới; activation xóa các cache cũ có prefix của ứng dụng.

## Gate còn cần khi có URL phát hành thật

Các mục dưới đây cần hostname HTTPS thật hoặc thiết bị/AT để có bằng chứng đáng tin, nên không giả lập thành PASS trong unit test:

- Khi chủ repository quyết định công bố website: kiểm tra quyền và visibility Pages, mở URL GitHub Pages thật ở project subpath, cài/activate Service Worker, reload khi offline, sau đó deploy một bản có asset đổi và xác nhận cache ID mới được kích hoạt.
- Xác nhận response thực của host có MIME đúng cho `.js`, `.webmanifest`, `.svg` và không có redirect làm thoát khỏi project subpath.
- Chạy Lighthouse/DevTools trên bản publish để ghi nhận LCP, CLS, tổng byte JavaScript và cache behavior; số liệu localhost không đại diện CDN Pages.
- Kiểm tra bàn phím, focus, zoom 200%, reduced motion và screen reader trên bản publish. E2E hiện kiểm tra drawer focus và không scroll ngang ở các breakpoint, nhưng chưa thay thế kiểm tra AT.

## Hardening không chặn release hiện tại

Workflow đã thu hẹp quyền: cấp `contents: read` ở cấp workflow; chỉ job `deploy` nhận `pages: write` và `id-token: write`. Không cần quyền xuất bản trong job `check`.

Các action GitHub đang được pin theo major tag (`@v4`, `@v5`, `@v3`) thay vì commit SHA. Nếu dự án cần supply-chain pinning nghiêm ngặt, chuyển chúng sang SHA đã xác minh và cập nhật qua Dependabot/Renovate.

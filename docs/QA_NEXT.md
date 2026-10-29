# QA release/PWA — v1.5.0 công khai và ứng viên nguồn v1.6.0

Tài liệu này bổ sung các gate phát hành có thể chạy hoàn toàn offline bằng Python. Trọng tâm là tính toàn vẹn của `dist/`, cache Service Worker theo nội dung, GitHub Pages project subpath và đường CI thực sự được deploy.

## Gate tự động

Chạy từ thư mục gốc dự án:

```powershell
python -m unittest discover -s tests -v
python scripts/build_site.py
```

`tests/test_release.py` có các hợp đồng versioned và được mở rộng khi thay đổi allowlist; số phép kiểm và tình trạng pass của phiên bản đang phát triển phải lấy từ lần chạy gần nhất, không dùng số cố định từ bản cũ:

1. Danh sách precache của `sw.js` phải khớp chính xác các tệp release trong `scripts/build_site.py`, cộng route `./`, không có URL tuyệt đối hoặc mục trùng.
2. Build cùng input phải tạo cùng cache ID; thay đổi một release asset phải đổi cache ID; `dist/` chỉ chứa allowlist release và marker của builder.
3. PWA phải dùng đường dẫn tương đối (`./`) cho manifest scope/start URL, đăng ký Service Worker và navigation fallback để chạy dưới GitHub Pages project subpath như `/Arduino3DVietnam/`.
4. Workflow Pages phải chạy unit tests trước build, chuyển đúng artifact `dist` sang deploy job và dùng Pages deployment action.
5. Máy chủ local phải trả MIME phù hợp cho JavaScript module, Web App Manifest và SVG.

Các thử nghiệm bổ sung chặn đường dẫn ra ngoài workspace/symlink, nguồn avr8js hoặc giấy phép sai provenance/checksum, sai manifest/Sketch/HEX/flash và nguồn bài học không khớp, cùng việc thiếu những module AVR/solver và license trong release. Đóng gói không dựa vào giá trị hash tự công bố mà còn kiểm tra source, Sketch và Intel HEX thực. Allowlist v1.4 có **61 file cố định + marker**; v1.5 đã phát hành **70 file cố định + marker**. Ứng viên v1.6 bổ sung inspector, schematic/minimap, mô hình breadboard, Timer2, DC network standalone và tài liệu theo allowlist phiên bản mới. Builder bắt buộc parity chính xác với precache SW; không đóng gói thư mục development, tests, `sources/` hoặc Git histories.

Kết quả cũ v1.2: `test_release.py` **5/5** và toàn suite ban đầu **22/22** là bằng chứng lịch sử. Kết quả ứng viên v1.3 ngày 28/10/2026: `test_release.py` **11/11**; toàn bộ `python -m unittest discover -s tests -q` **68/68 PASS**, `python scripts/build_site.py` PASS; 16 HEX trong `dist/assets/firmware/` cũng được xác minh trực tiếp với `export_firmware.py`. Bản CI ứng viên đầu đã phát hiện checkout Git đổi byte `CRLF` sang `LF`; `.gitattributes` mới đánh dấu `assets/firmware/*.hex binary`, có regression và đối chiếu byte trong Git index. **GitHub push check trên commit `b313b530` đã PASS** sau sửa lỗi này (run `40652449937`). Test content-addressed build dùng fixture trong thư mục tạm; bản build thật chỉ thay `dist/` có marker được cho phép.

Bộ Chrome E2E trong `tests/e2e_browser.py` đã kiểm tra bản `dist/` được Service Worker điều khiển, sau đó ngắt mạng và reload thành công. Tại checkpoint local mã v1.4 ngày 28/10/2026, bộ E2E **167/167 PASS**, gồm tải SHA-verified firmware khi đã offline và ngoại vi AVR D13 có trạng thái thực từ thanh ghi CPU, cùng việc cô lập phép kiểm tra trợ năng khỏi state của trang chính. Kết quả này cần đối chiếu với GitHub Chromium trên **đúng commit phát hành**; không tự động thay thế CI. Không thêm `tests/offline-contracts.js` vì một test JavaScript riêng sẽ lặp lại bằng chứng E2E.

**Cổng mới v1.5:** ba nguồn dữ liệu phải độc lập (layout khái niệm, topology điện, firmware AVR). Bộ kiểm thử mở rộng kiểm tra việc chọn/kéo/xoay linh kiện 3D không thay đổi netlist; chọn hai terminal 3D thực sự gọi circuit-router rồi xuất hiện trên bảng 2D; bài 10/14 tiếp tục chặn custom activation; điều khiển HTML/bàn phím/cảm ứng và lesson 01–16; cache offline tất cả module v1.5. Timer1 chỉ được chạy hợp đồng đơn vị **WGM0 Normal** (không attach firmware Arduino stock vì mode khởi tạo khác, không tuyên bố PWM/Servo parity). Giữ nguyên toàn bộ 167 phép kiểm thử đã có; **chưa nhận là PASS phát hành khi full CI exact SHA chưa chạy**.

Đợt P1 29/10/2026: tách mạch mẫu tham khảo khỏi bản tự đấu, đồng bộ chọn/bỏ chọn linh kiện với HTML, đặt ngưỡng tap/drag phù hợp cảm ứng, giới hạn A0 0..5000 mV theo VREF mặc định và neo SHA vendor avr8js độc lập với manifest. Lượt local đầu của đợt này đạt Python **80/80**, Chromium **219/219**; sau đó đổi badge bản ứng viên thành 1.5 và nâng kiểm thử lên **220/220**. Kiểm toán tiếp phát hiện các tình huống thao tác 2D bị hủy hoặc pointerId chéo, cũng như kích hoạt mạch tự đấu sau khi topology đổi. Bản cập nhật source cùng E2E mới nhất đạt **230/230 Chromium PASS** (0 console error, 0 unexpected warning) và 16 HEX **PASS**; giữ nguyên gate cũ chặn restart mạch sai. Bộ hợp đồng scene 3D có 41 phép thử; negative case sửa đồng thời vendor JS + PROVENANCE.json vẫn bị chặn. Quy trình Pages artifact nay giữ marker bằng `include-hidden-files: true`; backup phải kiểm chứng trên SHA cuối cùng và không đưa upstream snapshots vào source ZIP.

**Các số trên là bằng chứng local trước commit ứng viên**; chưa thay thế Python gate cuối, compiler/Chromium GitHub Actions và release gate trên cùng SHA. Tất cả thay đổi sau checkpoint, kể cả file tài liệu nằm trong allowlist, cần build/test lại trước khi chốt SHA và phát hành.

## Đợt v1.6 · tiêu chí kiểm chứng trước công bố

**Baseline phát hành không đổi:** tag v1.5.0 và SHA `7828efaa267007f189b0d2f891fff1d323637940`. Compiler 16/16, Chromium 230/230 trên GitHub, Pages run `40771559128`, HTTPS 70/70 byte parity và backup v1.5 đã có bằng chứng, không cần chạy lại nếu byte nguồn không đổi. Source v1.6 đang được tích hợp **khác SHA** và chưa được nhận là bản đã phát hành.

Các gate mới cần chạy thật khi code ổn định:

- Scene quality/LOD/focus: giữ nguyên scene 25 + lab 41 và hợp đồng v1.6 riêng; WebGL context lost/restored, disposal, camera-only focus, desktop/mobile reduced-detail, nhãn không map lỗ/chân vật lý.
- Lab Explorer: inspector/schematic/minimap phải đọc **cùng** learner netlist từ `circuit-router`; reference overlay mặc định tắt, chỉ hiện rõ nguồn tham khảo, không gỡ/đánh dấu đúng nhầm mạch mẫu. Selection/terminal/focus giữa canvas, SVG và HTML đồng bộ; chỉ focus camera không chuyển thành edit/move.
- Breadboard topology: default five-hole strips và E/F gap; generic rails unknown, BB830 rails theo profile; không map cảm tính chân 3D vào hole. Browser UI kiểm tra known/unknown/invalid holes, không thay circuit state.
- AVR Timer2: chỉ Normal WGM0 standalone, CPU clock/prescaler, flags/interrupt và negative WGM1 của **HEX thật**; không attach mặc định hoặc claim PWM/Servo/tone parity.
- DC resistor network: network nguồn/nút/điện trở lý tưởng khai báo tường minh, negative floating/short/nonlinear/giới hạn; giao diện divider không đọc dây 3D và không hiển thị số đo thật.
- 16 lesson navigation, HTML keyboard/ARIA focus, mobile375 no overflow, touch gestures, PWA offline imports đầy đủ CSS/ESM mới và firmware SHA checks. Giữ nguyên toàn bộ **230** Chromium gates v1.5, chỉ thêm regression, không gỡ hoặc giảm assertions.

Chỉ khi unit, package/precache, browser/WebGL/offline và negative cases **PASS trên cùng commit SHA cuối**, workflow compiler + Chromium của GitHub và release preflight cũng PASS trên SHA đó, mới được tag/backup/mở Pages workflow thủ công. Nếu có P0/P1 hoặc chứng cứ chưa đầy đủ, giữ production v1.5.

## Hợp đồng triển khai GitHub Pages

Bản phát hành không giả định website nằm ở `/`. `index.html`, `site.webmanifest`, đăng ký `./sw.js` và toàn bộ precache đều là đường dẫn tương đối. Điều này cho phép cùng `dist/` chạy ở root domain hoặc project subpath mà không cần sửa base URL trong build.

Repository hiện là **Public**: https://github.com/xuan2261/Arduino3DVietnam, website công khai tại https://xuan2261.github.io/Arduino3DVietnam/. Đẩy mã lên `main` chỉ chạy build/check, không tự động deploy Pages. Job release-gates trong Pages workflow có quyền đọc GitHub Actions và chỉ chạy thủ công; scripts/verify_release_gates.py yêu cầu hai workflow biên dịch C++ và Chrome E2E đều có status completed, conclusion success và workflow_dispatch cho **đúng head_sha hiện tại**. Ngoài ra, **16 firmware HEX** phải trùng byte với artifact GitHub Actions cụ thể, còn hạn, sau khi kiểm tra ancestor của commit nguồn compile, hash bài học/Sketch/flash, manifest, toolchain và artifact digest. Run cũ hoặc thất bại mới hơn không được vượt cổng. Script chỉ đọc và không thay đổi repository.

Để xác minh cổng phát hành mà **không deploy**, có workflow riêng `.github/workflows/release-gates-manual.yml` (chỉ `workflow_dispatch`, quyền đọc, không deploy). Chạy sau khi hai workflow kiểm chứng khác đã PASS trên cùng SHA và lưu log. Trong Pages workflow, `check` chỉ test/build; `release-gates` phải PASS trước job `package` tạo/upload artifact rồi mới được `deploy`. Đợt deploy công khai đầu tiên run `40701485044` trên SHA `cc95d818…` đã **PASS** và được xác minh bằng HTTPS 200, asset firmware trùng SHA-256. Chi tiết bằng chứng và quy tắc hết hạn nằm trong [FIRMWARE_RELEASE_GATE.md](FIRMWARE_RELEASE_GATE.md). Các lần deploy sau vẫn phải chạy workflow thủ công.

Builder tạo cache name dạng `arduino3d-viet-static-<16 hex>` từ tên và byte của tất cả release assets trừ chính `sw.js`. Khi bài học, CSS, module, tài liệu hoặc vendor asset đổi, browser nhận Service Worker mới với cache ID mới; activation xóa các cache cũ có prefix của ứng dụng.

## Gate bổ sung trên host HTTPS thật

Các mục dưới đây cần hostname HTTPS thật hoặc thiết bị/AT để có bằng chứng đáng tin, nên không giả lập thành PASS trong unit test:

- Host Public đã được xác minh HTTP 200 cho trang chủ, JS, `sw.js`, firmware manifest/HEX; bản cập nhật tiếp theo cần test nâng cache ID khi asset đổi, Service Worker activate, reload offline và giữ draft người học.
- Xác nhận response thực của host có MIME đúng cho `.js`, `.webmanifest`, `.svg` và không có redirect làm thoát khỏi project subpath.
- Chạy Lighthouse/DevTools trên bản publish để ghi nhận LCP, CLS, tổng byte JavaScript và cache behavior; số liệu localhost không đại diện CDN Pages.
- Kiểm tra bàn phím, focus, zoom 200%, reduced motion và screen reader trên bản publish. E2E hiện kiểm tra drawer focus và không scroll ngang ở các breakpoint, nhưng chưa thay thế kiểm tra AT.

## Hardening không chặn release hiện tại

Workflow đã thu hẹp quyền: cấp `contents: read` ở cấp workflow; chỉ job `deploy` nhận `pages: write` và `id-token: write`. Không cần quyền xuất bản trong job `check`.

Các GitHub Actions trong workflow compile, browser E2E, firmware export, preflight và Pages đã được **pin đầy đủ SHA 40 ký tự**, có comment phiên bản để kiểm tra ngược. Danh sách tag và commit từ GitHub REST được ghi tại [FIRMWARE_RELEASE_GATE.md](FIRMWARE_RELEASE_GATE.md). Khi cập nhật action, phải xác thực lại tag/release từ upstream, cập nhật SHA và chạy negative/release tests trước khi sử dụng bản mới; không tự chuyển về thẻ major có thể di chuyển.

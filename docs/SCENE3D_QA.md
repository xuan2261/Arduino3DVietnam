# QA vòng đời và truy cập mô hình 3D

Phạm vi này kiểm tra riêng `src/scene3d.js` với Three.js r180 đã vendored trong dự án. API công khai vẫn là `mountScene(host, onSelect)` và controller trả về vẫn có `setLesson`, `update`, `control`, `resize`, `dispose`.

## Hành vi được bảo vệ

- Renderer tiếp tục **render theo nhu cầu**. Nhiều thay đổi trước cùng một frame chỉ xếp một `requestAnimationFrame`; sau khi vẽ không có vòng lặp thường trực.
- Khi nhận `webglcontextlost`, frame đang chờ bị hủy và không tạo frame mới trong lúc context mất. Three.js r180 tự khôi phục renderer nội bộ; sau `webglcontextrestored`, scene chạy `resize()` và yêu cầu một frame mới để hiện trạng thái CPU mới nhất.
- `dispose()` ngắt observer/listener, hủy RAF, kết thúc pointer capture, giải phóng geometry/material/texture và gỡ canvas. Context WebGL do scene sở hữu được chủ động mất trước khi phát các `dispose` CPU-side. Thứ tự này tránh các dispose listener cũ của Three r180 cố xóa WebGL handle thuộc context trước lần restore.
- Material dùng chung được tạo theo từng lần `mountScene`, vì vậy một scene đã dispose không để lại material đã giải phóng cho lần mount kế tiếp.
- Canvas có thể focus bằng bàn phím. Mũi tên xoay góc nhìn, `+`/`-` thu phóng, `Home` đặt lại, `Enter`/`Space` kích hoạt lựa chọn bo mạch. Các phím được xử lý chỉ khi canvas đang focus.
- Trên màn hình cảm ứng, CSS `touch-action: pan-y` được giữ nguyên để vuốt dọc vẫn cuộn trang; kéo ngang vẫn dùng pointer để xoay. `pointercancel` và `lostpointercapture` chỉ kết thúc thao tác, không phát sinh lựa chọn giả.

## Contract browser

Chạy ứng dụng bằng server của dự án để `.js` có MIME phù hợp:

```powershell
python scripts/serve.py --port 8091
```

Sau đó mở trang trong Chrome/Edge và chạy:

```js
import('/tests/scene3d-contracts.js').then(m => m.runScene3DContracts())
```

Contract tạo scene thử riêng, đi qua `setLesson()` như production và kiểm tra 25 điều kiện: host hợp lệ, semantics/focus bàn phím, phím điều khiển, mobile pointer cancel/tap, gộp RAF, không có render loop, context lost/restore thật khi `WEBGL_lose_context` khả dụng, dispose sau restore, dispose ngay khi context vẫn lost và remount.

## Kết quả thực tế ngày 28/10/2026

| Gate | Kết quả |
| --- | --- |
| Scene 3D contracts trong Chrome/WebGL2 | **25/25 PASS** |
| `WEBGL_lose_context` loss → restore → render → dispose | **PASS**, không có WebGL warning sau teardown cuối |
| Browser contracts nền | **74/74 PASS** |
| `python -m unittest discover -s tests -v` | **34/34 PASS** |
| `git diff --check` | **PASS** |
| Node syntax check | Không chạy: máy hiện tại không có `node`; module mới đã được Chrome import/thực thi thành công |

Trong khi cô lập teardown, một scene Three.js r180 tối thiểu cũng tái hiện cảnh báo `delete: object does not belong to this context` nếu dispose geometry/material **sau** một lần restore mà chưa mất context hiện tại. Đổi thứ tự thành mất context do renderer sở hữu trước, rồi mới giải phóng các object CPU-side, loại bỏ cảnh báo trong cùng Chrome.

## Giới hạn

Các contract pointer dùng sự kiện trình duyệt và kiểm tra CSS thực tế, nhưng chưa thay thế kiểm thử trên điện thoại/máy tính bảng vật lý. Chưa chạy NVDA, JAWS, VoiceOver hoặc TalkBack; `role`, nhãn, focus và keyboard behavior đã được kiểm tra bằng DOM/browser contract. Context-loss contract dùng extension chuẩn `WEBGL_lose_context` khi Chrome cung cấp, nên nó kiểm tra vòng đời WebGL thật của tab thử nhưng không mô phỏng mọi nguyên nhân GPU reset/driver crash ngoài thực tế.

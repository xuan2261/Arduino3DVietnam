# Lớp netlist 3D mang tính khái niệm

`src/scene3d.js` không còn dựng các dây màu dựa trên số dòng mô tả `lesson.wiring`. Những dây đó không có quan hệ với netlist và dễ làm người học hiểu nhầm rằng chúng đang cắm đúng vào lỗ breadboard.

Thay vào đó controller trả về từ `mountScene(host, onSelect)` có thêm method tùy chọn:

```js
scene.setWiring?.(circuit, terminals, analysis)
```

Nên gọi `setWiring()` **sau** `setLesson()`, vì đổi bài sẽ xóa lớp net của bài trước.

## Dữ liệu đầu vào

- `circuit`: state netlist hiện tại; chỉ `circuit.wires[]` được dùng để quyết định dây nào tồn tại.
- `terminals`: metadata từ `listTerminals(lessonId)`. Một đầu dây không có trong danh sách này sẽ bị bỏ qua thay vì tự tạo vị trí giả.
- `analysis`: kết quả từ `analyzeCircuit(lessonId, circuit)`. `analysis.nets` cung cấp net ID đã được engine topology nhận diện; `analysis.issues` quyết định màu lỗi/cảnh báo.
- `setWiring(null)` xóa lớp netlist.

Ví dụ tích hợp với facade hiện tại:

```js
const terminals = listTerminals(lesson.id);
const analysis = analyzeCircuit(lesson.id, circuit);
state.scene?.setWiring?.(circuit, terminals, analysis);
```

Method trả về summary để app hoặc QA có thể quan sát mà không cần truy cập Three.js internals:

```js
{
  mode: "conceptual-netlist",
  shownWires: 3,
  omittedWires: 0,
  netCount: 3,
  status: "checked", // checked | warning | error | unverified
  analysisSupported: true,
  physicalMapping: "none"
}
```

Nếu `circuit.lessonId` hoặc `analysis.lessonId` thuộc bài khác với bài đang hiển thị, method fail-closed bằng `RangeError` và không giữ lớp net cũ trên màn hình.

## Ý nghĩa hình ảnh

Lớp này là một **panel netlist khái niệm** tách khỏi bo Arduino, breadboard và mô-đun 3D. Nó có nhãn trực tiếp:

> SƠ ĐỒ NET KHÁI NIỆM · KHÔNG PHẢI VỊ TRÍ LỖ BREADBOARD

Các node mang terminal ID thật từ netlist, nhưng tọa độ của node trên panel chỉ là layout để đọc quan hệ. Hiện chưa có bảng ánh xạ terminal → lỗ breadboard hoặc terminal → vị trí vật lý trên linh kiện, vì vậy API luôn báo `physicalMapping: "none"`.

Màu dây biểu diễn trạng thái topology, không biểu diễn dòng điện, điện áp hay hoạt động vật lý:

- xanh lục: net được `analysis.nets` nhận diện và không có warning/error liên quan;
- vàng: net hoặc toàn mạch có cảnh báo topology;
- đỏ: net liên quan tới issue mức `error`;
- xám: dây hiện có nhưng chưa có `analysis.nets` để gắn trạng thái.

Một net label như `net-1 · ĐÃ KIỂM TRA` chỉ nói rằng topology engine đã nhận diện/kiểm tra net đó. Nó **không** có nghĩa là mạch đã được giải SPICE, đo dòng/áp, hoặc xác nhận an toàn phần cứng ngoài các rule đã khai báo.

## Bounds và lifecycle

Scene chỉ nhận tối đa 48 dây, 32 terminal và 16 net label trực quan. Đây là bound hiển thị; dây có terminal metadata thiếu hoặc vượt bound được tính vào `omittedWires` thay vì đoán tọa độ.

`setWiring()` chỉ gọi `invalidate()` một lần và tiếp tục dùng renderer on-demand, không tạo animation loop. Thay wiring sẽ dispose geometry/material/texture của lớp cũ. Khi WebGL context bị mất, scene giải phóng cache GPU của r180 trong lúc context cũ đã mất nhưng giữ object CPU; sau restore cùng scene được upload lại và có thể thay wiring mà không gọi delete lên handle của context cũ.

Keyboard/mobile behavior của scene không đổi: canvas vẫn focus được, phím mũi tên/+/-/Home/Enter/Space hoạt động như trước và `touch-action: pan-y` vẫn cho phép cuộn dọc trang.

## Contract browser

Khởi động server MIME-safe của dự án:

```powershell
python scripts/serve.py --port 8091
```

Trong Chrome/Edge:

```js
import('/tests/scene-wiring-contracts.js').then(m => m.runSceneWiringContracts())
```

Contract kiểm tra API optional, không còn invented net layer sau `setLesson`, sample circuit đã phân tích, error highlighting, terminal thiếu metadata, trạng thái unverified, on-demand RAF, context lost/restore, replace wiring sau restore, toàn bộ sample của các lesson có wiring engine, cross-lesson rejection, clear và dispose.

Kết quả browser thực ngày 28/10/2026: **39/39 PASS**, bao gồm `WEBGL_lose_context` loss → restore → replace wiring và sample của tất cả 15 lesson được wiring facade hỗ trợ; Chrome console không có WebGL warning sau lượt kiểm tra cuối.

Regression cùng phiên: scene lifecycle **25/25**, browser contracts nền **74/74**, circuit contracts **29/29**, extended circuit contracts **75/75**, Python unittest **55/55**, `git diff --check` PASS.

## Giới hạn hiện tại

Lớp này chưa ánh xạ các lỗ breadboard vật lý, chưa vẽ chân linh kiện theo package/datasheet thật và chưa mô phỏng điện trường/dòng điện. Khi cần bước tiếp theo, nên bổ sung một bảng tọa độ vật lý có nguồn cho từng hardware model rồi chỉ bật `physicalMapping` cho các terminal thực sự có mapping đã kiểm chứng.

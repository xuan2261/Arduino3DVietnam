# Scene 3D committed-wire inspection next

## Mục tiêu và authority

Phase này chỉ cải thiện cách **dây đã tồn tại trong canonical wiring model** được trình bày trong conceptual lab 3D và cho phép UI bên ngoài đánh dấu một wire đã có. `circuit-router`/circuit state vẫn là nguồn graph duy nhất. Scene không tạo, xoá, sửa hoặc xác nhận wire điện; không suy dòng/áp, không đo chiều dài dây, không định tuyến CAD và không chứng nhận đường đi vật lý trên breadboard.

Pending first-terminal ghost từ phase trước vẫn là một affordance khác: ghost chưa commit và không làm tăng `data-lab-wire-count`. Committed route chỉ được dựng từ `lastWiringModel.wires` đã nhận qua `setWiring()`.

## Committed route mới

Committed lab wire trước đây dùng ba điểm `start -> mid -> end`. Renderer mới dùng `LAB_COMMITTED_WIRE_ROUTE_POINTS = 8`, tương đương bảy đoạn:

1. exact terminal marker world position ở đầu A;
2. đi thẳng lên một lane cao hơn component;
3. một đoạn lead ngắn;
4. đi tới lane X giữa hai đầu;
5. đổi trục trong mặt phẳng elevated;
6. lead về phía đầu B;
7. nằm ngay phía trên đầu B;
8. exact terminal marker world position ở đầu B.

Lane có offset nhỏ theo thứ tự wire chỉ để các đường trùng nhau dễ đọc hơn. Các offset/lift là **render-space heuristic**, không phải chiều dài, clearance, độ cao dây thật hay routing rule.

Mỗi committed line có metadata:

- `kind:"lab-conceptual-wire"`;
- `routeModel:"elevated-multisegment"`;
- `routePointCount:8`;
- `physicalLocation:false`;
- `physicalVerified:false`.

Canvas diagnostic:

- `data-lab-wire-route-mode="elevated-multisegment" | "none"`;
- `data-lab-wire-route-point-count="8" | "0"`;
- `data-lab-wire-geometry-revision`: revision counter của committed-route geometry trong **một active lab-layout session**. Mỗi lần route thực sự được recompute thì tăng 1; same-lesson `setLabLayout(non-null)` rebuild không reset counter giữa chừng, nên move rồi rotate phải cho chuỗi tăng nghiêm ngặt (ví dụ `n -> n+1 -> n+2`).

`updateLabWireGeometry()` luôn đọc lại world position của canonical terminal marker, vì vậy endpoint được recompute khi component logical transform thay đổi. `setLabVisualTransform()` gọi lại geometry update cho move/rotate; LOD refresh cũng gọi lại update. Đây chỉ chứng minh renderer bám terminal marker hiện tại, không chứng minh marker là vị trí header/hole thật.

## API highlight additive

Object trả về từ `mountScene()` có thêm:

`setHighlightedLabWire(wireId|null)`

`null` luôn clear và trả:

`{ wireId:null, active:false, mode:"none", physicalVerified:false }`

Wire ID khác `null` phải:

- là string exact/canonical, không rỗng và không có whitespace thừa;
- dài tối đa 80 ký tự;
- có conceptual lab layout đang mount;
- có `lastWiringModel` hiện tại;
- tồn tại exact trong `lastWiringModel.wires`;
- có committed lab route thực sự được render trong `labWireObjects`.

Nếu bất kỳ điều kiện nào sai, API fail-closed bằng `TypeError`/`RangeError` **trước khi thay state**, nên highlight hợp lệ trước đó không bị mất.

Thành công trả:

`{ wireId, active:true, mode:"committed-wire-highlight", physicalVerified:false }`

Canvas đặt `data-lab-highlighted-wire=<wireId>`. Highlight là một overlay line màu vàng sáng dùng cùng geometry với committed route, có:

- `kind:"lab-conceptual-wire-highlight"`;
- `committed:true`;
- `visualOnly:true`;
- `physicalLocation:false`;
- `physicalVerified:false`;
- `electricalAuthority:false`.

Overlay không được thêm như một canonical wire mới và không tăng `data-lab-wire-count`.

## Khác với pending ghost

Hai hệ thống cố ý độc lập:

| Trạng thái | Nguồn | Geometry | Wire count | Dataset chính |
| --- | --- | --- | --- | --- |
| Pending first terminal | Lab Editor controller | ghost 3-point tạm thời khi hover terminal thứ hai | Không đổi | `data-lab-pending-wire-*` |
| Committed route | `lastWiringModel.wires` | elevated 8-point route | Có trong `data-lab-wire-count` | `data-lab-wire-route-*` |
| Committed highlight | exact committed wire ID | overlay trên cùng committed route | Không đổi | `data-lab-highlighted-wire` |

`setHighlightedLabWire()` không gọi `setWiring()`, `onTerminalSelect`, `onMoveComponent`, không đổi selected/focused component, không đổi camera và không chạm firstTerminal/pending ghost.

## Lifecycle

Highlight tự clear khi:

- conceptual lab layout bị clear (`setLabLayout(null)`), bao gồm stage rời 3D;
- lesson đổi;
- WebGL context bị mất/reset;
- scene dispose;
- `setWiring(null)`;
- một canonical `setWiring()` mới không còn exact wire identity đang highlight.

`setLabLayout(non-null)` cho **cùng lesson hiện tại** là một rebuild display geometry, không phải graph replacement. Vì vậy highlight của committed edge được giữ qua teardown/rebuild của lab layer nếu canonical `lastWiringModel` vẫn chứa và render được edge đó; elevated 8-point route sau đó được tính lại từ terminal marker của layout mới. Điều này bao phủ component move/rotate được controller phản ánh bằng một layout object mới mà không làm mất wire inspection.

Trong rebuild này, `clearLabWireLayer()` được gọi ở chế độ preserve revision. Dataset có thể tạm về `route-mode="none"` trong teardown, nhưng `data-lab-wire-geometry-revision` vẫn giữ giá trị trước rebuild; `refreshLabWireLayer()` sau đó cũng preserve counter và `updateLabWireGeometry()` tăng revision đúng một bước khi committed route mới được dựng. Revision không được dùng làm electrical version, graph version hay bằng chứng vật lý; nó chỉ cho QA biết geometry đã được tính lại.

Với `setWiring()`, chỉ trùng `wireId` là **không đủ** để giữ highlight. Scene lưu descriptor của wire đang highlight trước khi thay model và chỉ giữ selection khi model mới có cùng `wireId` **và cùng unordered endpoint pair**. Ví dụ `w1: D13↔R1:A` bị thay bằng `w1: D13↔GND` phải clear highlight, dù chuỗi ID `w1` vẫn tồn tại. Guard này ngăn selection cũ chuyển nghĩa sang một edge mới khi controller thay nguyên graph/sample nhưng bộ đếm wire ID được khởi tạo lại.

Nếu `setWiring()` refresh canonical model với cùng exact identity (ID + unordered endpoints) và route vẫn render được trong layout hiện tại, highlight được giữ qua wire-layer rebuild. Điều này tránh nhấp nháy selection khi cùng một committed edge chỉ được phân tích/render lại.

WebGL restore không tự resurrect highlight đã bị clear lúc context loss.

`data-lab-wire-geometry-revision` reset về `0` ở các boundary thật sự kết thúc/reset session geometry: `setLabLayout(null)`/stage clear, lesson change, WebGL context loss/reset và `dispose()`. Vì vậy counter chỉ monotonic trong một active conceptual-layout session, không phải số đếm toàn vòng đời ứng dụng.

## Prime/App linkage

Scene không phụ thuộc 2D Inspector. Prime có thể mirror một 2D wire selection sang 3D bằng:

`scene?.setHighlightedLabWire?.(wireId)`

chỉ khi conceptual lab 3D đang mount. Khi deselect, đổi stage/lesson hoặc 2D selection không còn canonical, gọi:

`scene?.setHighlightedLabWire?.(null)`

Scene vẫn tự clear ở các lifecycle boundary trên, nên explicit `null` là cleanup phòng thủ chứ không phải authority graph.

## Regression coverage

`tests/scene3d-contracts.js` bổ sung:

- source guard cho exact/trim/length/model/render membership;
- source guard rằng highlight API không gọi graph/edit/camera mutation;
- committed route source guard cho elevated multi-segment geometry;
- reject highlight khi chưa có canonical wiring;
- route DOM metadata 8 điểm và wire count;
- visual-only highlight không đổi camera/selection/wire count/pending state;
- whitespace/oversize/unknown ID fail transactionally;
- same-lesson `setLabLayout()` move/rotate rebuild giữ highlight và dựng lại elevated route;
- revision trước move < revision sau move < revision sau rotate trong cùng active layout session;
- canonical `setWiring()` refresh chỉ giữ highlight khi ID + unordered endpoints không đổi;
- same ID nhưng endpoints khác phải clear highlight transactionally;
- canonical wire removal tự clear highlight;
- layout/stage, lesson, context loss và dispose cleanup.

`tests/scene3d-visual-fidelity-contracts.js` bổ sung focused geometry checks:

- committed 8-point route tách khỏi pending 3-point ghost;
- geometry revision tăng khi component move/rotate;
- geometry revision tăng trên LOD refresh;
- highlighted committed route và pending ghost cùng tồn tại nhưng không làm thay canonical wire count;
- clearing lab loại bỏ route/highlight diagnostics.

Worker-14 không chạy Chromium trong phase này. Browser execution thuộc prime/CI; static source checks không được coi là bằng chứng WebGL rendering thực tế.

## Giới hạn tuyên bố

Không có phần nào của phase này cho phép gọi route là:

- CAD/1:1 routing;
- measured wire length;
- breadboard contact path vật lý;
- electrical current path;
- proof mạch thật hoạt động hoặc an toàn.

Các dataset/overlay đều là diagnostic/UI state. `physicalVerified:false`, `breadboardHoleMapping:false`, `electricalPower:false` và `sceneElectricalAuthority="none"` tiếp tục là ranh giới bắt buộc.

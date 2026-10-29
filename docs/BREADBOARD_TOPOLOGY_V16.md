# Breadboard topology v1.6 — node graph có profile, fail-closed

Module <code>src/breadboard-topology.js</code> chỉ mô hình hóa các nhóm tiếp điểm dẫn điện bên trong breadboard khi selected profile có bằng chứng kỹ thuật phù hợp. Module không tự đặt linh kiện, không suy hole từ tọa độ 3D, không chèn edge vào circuit-router và không biến layout conceptual thành bằng chứng mạch vật lý.

## Nguồn kỹ thuật và giả định

Đối chiếu ngày 2026-10-29:

- SparkFun Learn, **How to Use a Breadboard — Anatomy of a Breadboard**: mô tả strip kim loại điển hình có năm clip; hàng mười lỗ bị khe giữa breadboard chia thành hai nhóm năm lỗ không nối điện với nhau.
  https://learn.sparkfun.com/tutorials/how-to-use-a-breadboard/anatomy-of-a-breadboard
- Digilent, **Solderless Breadboard Kit: Small Solderless Breadboard with Two Power Rails**: mô tả vùng 630 tie-point được cấu hình thành các **5 point nodes**.
  https://digilent.com/shop/solderless-breadboard-kit-small-solderless-breadboard-with-two-power-rails/
- BusBoard Prototype Systems, **BB830** và datasheet Rev 7: mô tả 630 tie-point IC-circuit area cùng **four 50 tie-point power rails**. Profile <code>busboard-bb830-rev7</code> vì vậy chỉ coi từng rail 50 lỗ là một node riêng; không nối rail distribution strip thứ nhất sang strip thứ hai.
  https://www.busboard.com/BB830
  https://www.busboard.com/documents/datasheets/BPS-DAT-%28BB830%29-Datasheet.pdf
- Adafruit, **Breadboard Tips & Tricks**: cảnh báo full-size breadboard có thể có rail liên tục hoặc bị split và khuyến nghị xác minh continuity khi không biết model cụ thể. Đây là lý do profile mặc định không mô hình hóa power rails.
  https://learn.adafruit.com/breadboards-for-beginners/breadboard-tips-and-tricks

Không ảnh, sơ đồ hoặc asset của các nguồn trên được sao chép vào repository.

### Suy luận hình học có giới hạn

Vùng terminal strip dùng 63 cột: 630 tie points chia cho 10 lỗ terminal mỗi cột (A–E và F–J) bằng 63. Mỗi cột có hai node độc lập:

~~~text
A B C D E   || center gap ||   F G H I J
└ one node ┘                  └ one node ┘
~~~

Ví dụ <code>A12</code> nối <code>E12</code>, nhưng không nối <code>A13</code> và không nối <code>F12</code>.

## Profiles

### Default: generic-63x10-terminal-strips

- A–E và F–J, cột 1..63.
- Mỗi nhóm năm lỗ cùng cột là một node.
- Center gap E/F tách hai node.
- Power rail ID có thể parse theo dạng <code>P1+1</code>, <code>P1-1</code>, <code>P2+1</code>, <code>P2-1</code>…, nhưng node rail trả <code>null</code>; connectivity rail trả <code>false</code>. Điều đó nghĩa là **profile chưa chứng minh connectivity**, không phải tuyên bố đo thực tế chắc chắn hở mạch.

### busboard-bb830-rev7

- Cùng terminal strip 63 × (5 + 5).
- Bốn rail độc lập: <code>P1+</code>, <code>P1-</code>, <code>P2+</code>, <code>P2-</code>, mỗi rail 50 lỗ.
- <code>P1/P2</code> là canonical software labels cho hai distribution-strip groups trong profile, không phải tuyên bố rằng nhà sản xuất in đúng các ký hiệu đó trên breadboard.
- <code>P1+1</code> nối <code>P1+50</code>.
- <code>P1+50</code> không tự nối sang <code>P2+1</code>; đó là hai rail riêng trong profile.
- Dấu <code>+/-</code> chỉ được ghi là legend; module không suy đó là điện áp hoặc polarity thực.

Không profile nào được tạo từ object tùy ý. Chỉ profile ID allowlist hoặc topology object thực sự do module tạo được chấp nhận; object forged/lookalike fail-closed.

## API

~~~js
import {
  createBreadboardTopology,
  breadboardNode,
  areBreadboardHolesConnected,
  mapCircuitTerminalToHole,
} from "./src/breadboard-topology.js";

const generic = createBreadboardTopology();
const bb830 = createBreadboardTopology("busboard-bb830-rev7");

breadboardNode("A12");
breadboardNode("P1+12");
breadboardNode("P1+12", bb830);

areBreadboardHolesConnected("A12", "E12");
areBreadboardHolesConnected("E12", "F12");
areBreadboardHolesConnected("P1+1", "P1+50");
areBreadboardHolesConnected("P1+1", "P1+50", bb830);
~~~

<code>false</code> từ <code>areBreadboardHolesConnected()</code> có nghĩa **không có node chung được profile chứng minh**. Với rail unmodeled, nó không phải tuyên bố continuity thật.

## Explicit circuit-terminal placement

<code>mapCircuitTerminalToHole(layout, terminalId)</code> cố ý trả <code>null</code> cho layout v1.5 hiện tại vì <code>lab-layout.js</code> dùng anchor model conceptual và <code>claims.breadboardHoleMapping === false</code>.

Một mapping chỉ được đọc khi layout tương lai chứa object explicit:

~~~js
layout.claims.breadboardHoleMapping = true;
layout.breadboardPlacement = {
  schemaVersion: 1,
  model: "explicit-validated-breadboard-placement-v1",
  validatedBy: "breadboard-topology-v1",
  profileId: "busboard-bb830-rev7",
  terminalToHole: {
    "R1:A": "A12",
    "R1:B": "F12",
  },
};
~~~

Hàm kiểm tra lại toàn bộ mapping: terminal phải tồn tại trong <code>layout.terminals</code>, profile phải allowlisted, hole phải là node được profile chứng minh, terminal lạ bị từ chối và hai terminal không được chiếm cùng một physical hole. Hai terminal vẫn có thể dùng hai hole khác nhau trong cùng node, ví dụ <code>A12</code> và <code>B12</code>.

Các field như <code>terminalMap</code>, <code>x/z</code>, conceptual anchor, proximity hoặc một flag <code>physicalVerified</code> tự gắn không được dùng để suy placement. Marker <code>validatedBy</code> chỉ là một phần schema; sự hợp lệ được tính lại từ profile, terminal list và hole IDs.

## Giới hạn an toàn

- Node graph không tính điện áp, dòng, short-circuit safety hoặc chất lượng tiếp xúc.
- Không tự thêm edge vào circuit-router; caller phải giữ topology vật lý và circuit logic là hai lớp riêng.
- Không map chân Arduino Uno hoặc module terminal sang breadboard. Tất cả placement vẫn conceptual/unmapped cho đến khi có explicit placement mapping được kiểm tra.
- Không đoán split/continuous power rail từ màu, ảnh 3D hoặc hình dạng chung.
- Nếu breadboard thực tế không đúng profile đã chọn, kết quả không phải bằng chứng phần cứng.
- Profile mới phải có provenance kỹ thuật riêng trước khi được đưa vào allowlist.

## Contract tests

<code>tests/breadboard-topology-contracts.js</code> có hơn 25 checks, bao phủ:

- five-hole nodes, split adjacent columns và center trench;
- default rails unknown và BB830 four-rail behavior;
- rail boundary/seam không tự nối;
- forged/unknown profile, malformed/out-of-range holes;
- conceptual/nonphysical anchor không tạo mapping;
- explicit mapping positive, unmapped terminal, foreign terminal, unproven rail và exact-hole collision.

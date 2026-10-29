# Resistive Visual Study — candidate presentation

## Mục tiêu

`src/resistive-study-ui.js` giữ nguyên trải nghiệm nhập ba giá trị của study hiện có:

- nguồn DC lý tưởng `VCC` trong `0..5 V`;
- `R1` từ `VCC → MID`;
- `R2` từ `MID → GND`.

App vẫn gọi API hiện hữu:

```js
state.resistiveUI = mountResistiveStudy();
```

Không cần thay đổi `src/app.js`, `index.html`, `styles/*`, build, Service Worker
hay circuit-router để dùng phần trình bày mới. Sau khi người học bấm **Tính theo mô hình**,
UI gửi đúng divider khai báo vào `solveResistiveDC()` rồi chỉ render số nếu kết quả solver
đạt toàn bộ kiểm tra provenance và numeric.

## Sơ đồ khái niệm

Kết quả hợp lệ có một SVG responsive biểu diễn đúng topology study:

```text
VCC ── R1 ── MID ── R2 ── GND
```

SVG có `role="img"`, accessible label chứa VCC, R1, MID, R2, GND cùng các số đã
được solver xác nhận. `viewBox`, `width="100%"`, `max-width:100%` và chiều cao tự
động giúp hình co theo container ở mobile; bảng chi tiết hiện hữu tiếp tục nằm trong
`#resistiveDetails`, nơi CSS hiện tại quản lý overflow ngang của bảng.

SVG là **sơ đồ khái niệm toán học**. Nó không biểu diễn breadboard, chân Arduino, dây 3D,
điểm đo hoặc phần cứng thật.

## Nguồn của từng con số

Trước khi dựng SVG/table, UI yêu cầu:

1. `analysis.supported === true` và `analysis.calculated === true`;
2. `analysis.issues` rỗng;
3. `boundaries.origin === "ideal-dc-resistor-model"`;
4. `boundaries.model === "linear-ideal-dc-resistor-network"`;
5. `physicalVerified === false`, `measured === false`, `educationalOnly === true`;
6. node `VCC`, `MID`, `GND` đều là số hữu hạn, với VCC khớp giá trị người học
   khai báo và GND bằng 0 V;
7. đúng hai branch solver `R1: VCC → MID` và `R2: MID → GND`;
8. resistance của branch khớp R1/R2 khai báo;
9. voltage drop, current và power của từng branch đều hữu hạn, provenance từng branch
   vẫn là `ideal-dc-resistor-model`, `physicalVerified:false`, `measured:false`;
10. các số hữu hạn còn phải tự nhất quán với declaration bằng phương trình divider/Ohm/KCL:
    - `V(MID) = VCC × R2 / (R1 + R2)`;
    - `Vdrop(R1) = VCC - V(MID)`, `Vdrop(R2) = V(MID) - GND`;
    - `I_mA = 1000 × Vdrop / R` cho từng branch;
    - `absI = |I|`;
    - `P_mW = I_mA² × R / 1000`;
    - dòng R1 và R2 phải bằng nhau trong tolerance của kết quả solver đã round.

So sánh dùng absolute/relative tolerance `1e-9`, tương ứng với output solver được round
đến 9 chữ số thập phân. Corner `VCC = 0 V` được kiểm tra riêng: midpoint, drop, current,
abs current và power đều phải nhất quán với 0; một số finite khác 0 không được chấp nhận
chỉ vì provenance string đúng.

Vì vậy UI phân biệt rõ:

| Dữ liệu | Nguồn |
| --- | --- |
| VCC, R1, R2 | Người học khai báo trong form |
| GND = 0 V | Điều kiện biên của model |
| V(MID) | `dc-resistor-network` tính |
| Dòng R1/R2 (mA) | `dc-resistor-network` tính |
| Công suất R1/R2 (mW) | `dc-resistor-network` tính |

UI không tự tính một “số vật lý” khác từ lesson/router/3D. Nó chỉ kiểm tra consistency
rồi trình bày kết quả đã trả về từ solver.

## HTML/tabular equivalent

SVG không phải nơi duy nhất chứa thông tin. Bảng `.resistive-study-table` vẫn có đúng
**hai tbody rows** — R1 và R2 — để giữ compatibility với E2E v1.6. Caption của bảng
ghi VCC khai báo, V(MID) từ solver, GND và dòng lý tưởng. Mỗi row ghi:

- ID điện trở;
- hướng branch;
- điện trở khai báo (Ω);
- dòng lý tưởng từ solver (mA);
- công suất lý tưởng từ solver (mW).

Đoạn assumptions sau bảng tiếp tục ghi rõ nguồn `ideal-dc-resistor-model`, nguồn DC
lý tưởng, GND = 0 V, điện trở tuyến tính/không phụ thuộc nhiệt độ, và nhấn mạnh các số
không phải phần cứng Arduino hoặc phép đo.

## Fail-closed

UI xóa nội dung kết quả cũ **trước** mỗi lần tính. Không render SVG/table số khi:

- input form rỗng, không phải số hữu hạn hoặc ngoài giới hạn;
- solver trả `supported:false` hoặc `calculated:false`;
- result có issue;
- result bị giả provenance, claim `physicalVerified:true` / `measured:true`;
- node/branch chứa `NaN`, `Infinity` hoặc số không khớp declaration;
- node/branch đều finite nhưng MID, voltage drop, current, absolute current hoặc power
  không thỏa divider/Ohm/KCL equations từ VCC/R1/R2 khai báo;
- topology result không còn đúng R1/R2 của divider.

Các result thật của solver với `FLOATING_COMPONENT` hoặc
`SINGULAR_OR_ILL_CONDITIONED` đều bị renderer từ chối trước khi có bất kỳ numeric
presentation nào.

Study cố định hiện tại luôn khai báo VCC/GND và hai điện trở hữu hạn nên người học không
tạo floating/singular topology qua ba input UI. Guard renderer vẫn tồn tại để một result
không-calculated từ solver không thể bị trình bày như kết quả số nếu caller thay đổi sau này.

## Ranh giới với ứng dụng

Module chỉ import `./dc-resistor-network.js`. Nó không đọc hoặc ghi:

- `circuit-router` / learner netlist;
- lab layout / breadboard placement;
- Three.js scene;
- AVR runtime, firmware hoặc Serial;
- lesson completion / quiz / progress;
- sensor, motor, servo hoặc LED state.

Nó cũng không suy ra giới hạn an toàn phần cứng, datasheet rating, nhiệt độ, tolerance,
contact resistance hay source impedance Arduino. Dòng/công suất mang nghĩa **ideal-model**
trong solver đã mô tả, không phải khuyến nghị thao tác với mạch thật.

## API

`mountResistiveStudy()` giữ nguyên API và lifecycle:

```text
calculate()
snapshot()
dispose()
```

Renderer kiểm chứng được tách thành export bổ sung
`renderResistiveStudyDetails(document, analysis, declared)` để contract test có thể đưa
trực tiếp result calculated/floating/singular của solver vào đúng presentation boundary.
App production không cần gọi export bổ sung này.

## Contract mới

`tests/resistive-study-ui-contracts.js` kiểm tra:

- SVG responsive/accessibility và topology VCC—R1—MID—R2—GND;
- table equivalent vẫn đúng hai tbody rows;
- label rõ declared vs solver-computed;
- provenance giả hoặc claim vật lý bị từ chối;
- numeric không hữu hạn bị từ chối;
- forged **finite** MID bị từ chối bởi divider equation;
- forged **finite** voltage drop bị từ chối bởi Ohm consistency;
- forged **finite** signed current bị từ chối;
- forged **finite** absolute current bị từ chối;
- forged **finite** power bị từ chối;
- result thật của solver ở VCC = 0 V vẫn pass với MID/I/P bằng 0;
- result `FLOATING_COMPONENT` thật từ solver không render;
- result `SINGULAR_OR_ILL_CONDITIONED` thật từ solver không render;
- renderer không mutate solver result/declaration;
- `mountResistiveStudy()` giữ `calculate/snapshot/dispose`;
- default 5 V / 1 kΩ / 1 kΩ render V(MID)=2,5 V, I=2,5 mA;
- input nonnumeric xóa SVG/table cũ;
- dispose gỡ click listener.

Quan sát local hiện tại sau correctness hardening: **18/18 PASS** bằng Bun.

## Handoff cho prime

Source runtime `src/resistive-study-ui.js` đã nằm trong release allowlist v1.6 từ trước,
nên enhancement này đi theo cùng module khi prime build candidate. Tài liệu
`docs/RESISTIVE_VISUAL_STUDY_NEXT.md` và contract mới chưa được worker này thêm vào
release/build/E2E allowlist theo phân quyền.

Prime có thể thêm doc vào allowlist nếu muốn public artifact và bổ sung E2E để khóa:

- SVG/accessible label xuất hiện sau tính hợp lệ;
- caption/table vẫn tương đương;
- input lỗi xóa cả SVG lẫn table;
- viewport 375 không document-overflow;
- learner 2D/3D circuit, AVR/Serial và progress không đổi trước/sau study.

Không dùng kết quả contract local này để tuyên bố feature đã phát hành trên GitHub Pages;
release status cần final-SHA evidence riêng.

# Resistive Branch Study — R1 series (R2 || R3)

## Mục tiêu

Phase này mở rộng Resistive Study bằng một topology lý tưởng thứ hai:

```text
VCC ── R1 ── MID ──┬── R2 ── GND
                   └── R3 ── GND
```

Nguồn toán học duy nhất vẫn là `solveResistiveDC()` trong
`src/dc-resistor-network.js`. Solver không bị sửa.

Module mới:

```text
src/resistive-branch-study.js
```

chỉ xây network ba điện trở, gọi solver hiện hữu, sau đó **độc lập kiểm lại** toàn bộ
giá trị trả về bằng các phương trình từ V/R đã khai báo trước khi UI được phép hiển thị.

Đây là mô hình điện trở DC tuyến tính lý tưởng phục vụ học tập. Nó không phải Arduino
compiler, firmware/AVR execution, circuit-router, lesson wiring, breadboard/3D model,
phép đo phần cứng hoặc xác nhận an toàn vật lý.

## Control contract cho prime

Prime tạo hai control optional:

```html
<select id="resistiveTopology">
  <option value="divider">R1 series R2</option>
  <option value="branch">R1 series (R2 || R3)</option>
</select>

<input id="resistiveR3" ...>
```

Contract:

1. `#resistiveTopology` chỉ nhận đúng hai value:
   - `divider`
   - `branch`
2. `#resistiveR3` chứa resistance Ω.
3. Nếu **cả hai control không tồn tại**, `mountResistiveStudy()` chạy đúng legacy
   divider như trước.
4. Nếu chỉ tồn tại một trong hai control, mount fail closed để tránh partial integration.
5. Khi topology là `divider`, R3 không được đọc và không ảnh hưởng kết quả.
6. Khi topology là `branch`, R3 phải là số hữu hạn trong `1..1,000,000 Ω`.
7. Nguồn vẫn dùng `#resistiveV` trong `0..5 V`; R1/R2 giữ
   `1..1,000,000 Ω`.
8. Các control/result cũ giữ nguyên:
   - `#resistiveV`
   - `#resistiveR1`
   - `#resistiveR2`
   - `#resistiveSolve`
   - `#resistiveResult`
   - `#resistiveDetails`

Không cần thay signature:

```js
mountResistiveStudy()
```

và API divider testable cũ vẫn nguyên:

```js
renderResistiveStudyDetails(document, analysis, declared)
```

API này tiếp tục chỉ render two-resistor divider để không phá caller/tests hiện có.

## Pure branch model API

```js
solveResistiveBranchStudy({
  voltageVolts,
  r1Ohms,
  r2Ohms,
  r3Ohms,
})
```

Kết quả:

```text
{
  analysis,   // exact frozen result from unchanged solveResistiveDC
  verified    // independent verified branch result, or null if solver did not calculate
}
```

Verifier testable:

```js
verifyResistiveBranchAnalysis({
  declared: { voltageVolts, r1Ohms, r2Ohms, r3Ohms },
  analysis
})
```

Verifier không tin một report chỉ vì có các origin string đúng.

## Mathematical verification

Với:

```text
Rp = R2 || R3 = (R2 × R3) / (R2 + R3)
```

model recompute:

```text
Vmid = VCC × Rp / (R1 + Rp)

Vdrop1 = VCC - Vmid
Vdrop2 = Vmid
Vdrop3 = Vmid

I1_mA = 1000 × Vdrop1 / R1
I2_mA = 1000 × Vdrop2 / R2
I3_mA = 1000 × Vdrop3 / R3

|I1|, |I2|, |I3|

P1_mW = I1_mA² × R1 / 1000
P2_mW = I2_mA² × R2 / 1000
P3_mW = I3_mA² × R3 / 1000

KCL at MID:
I1 = I2 + I3
```

Absolute tolerance là `3e-9`, relative tolerance là `1e-9`. Absolute tolerance lớn
hơn divider một chút vì KCL cộng hai branch output đã được solver round đến 9 chữ số
thập phân.

## Topology/provenance checks

Verifier yêu cầu:

- analysis có exact top-level solver fields;
- `supported:true`, `calculated:true`, `issues:[]`;
- boundary origin `ideal-dc-resistor-model`;
- model `linear-ideal-dc-resistor-network`;
- `physicalVerified:false`, `measured:false`, `educationalOnly:true`;
- source limits vẫn `0..5 V` và solver hỗ trợ ít nhất 3 resistor;
- branch study dùng solver default guards, không nhận một report được tạo với guard
  configuration khác;
- đúng ba node: `VCC`, `MID`, `GND`;
- đúng ba resistor IDs:
  - `R1: VCC → MID`
  - `R2: MID → GND`
  - `R3: MID → GND`;
- resistance result phải khớp declaration;
- từng resistor result có exact current/drop/power/provenance fields;
- mọi numeric field phải hữu hạn;
- mọi equation phía trên phải pass.

Final provenance hardening: all required report/input/branch/node fields must
be **own data properties** of a plain or null-prototype record, not inherited
from a crafted prototype or supplied by accessor getters. Nested
`boundaries`, `limits` and `configuredGuards` require their own data fields;
symbol properties are rejected. An `Object.create(realSolverReport)` clone
with inherited origin, guards, 0-V values or resistor results is never a
verified solver result, even if the inherited finite math happens to be
consistent. This is a structural input and mathematical consistency verifier,
not proof of where arbitrary caller-owned data originated outside the module.

Một report finite nhìn có vẻ hợp lý nhưng không khớp declaration vẫn bị từ chối.

## Zero-V corner

`VCC = 0 V` là input hợp lệ.

Verifier yêu cầu:

```text
Vmid = 0
Vdrop1 = Vdrop2 = Vdrop3 = 0
I1 = I2 = I3 = 0
abs currents = 0
P1 = P2 = P3 = 0
```

Không dùng truthiness của số để suy trạng thái, nên zero không bị coi là “missing”.

## Verified result boundary

`verified` là deep-frozen và chứa:

```text
schemaVersion: 1
topology: "r1-series-r2-parallel-r3"
declared
nodeVoltages
equivalentParallelOhms
resistors.R1/R2/R3
currents
provenance
claims
```

Claims bắt buộc:

```text
measured: false
physicalVerified: false
hardwareValidated: false
firmwareExecuted: false
compilerOutput: false
circuitRouterIntegrated: false
```

## UI presentation

Branch mode render:

- responsive SVG có `role="img"`;
- explicit topology `R1 series (R2 || R3)`;
- VCC/MID/GND;
- R1/R2/R3;
- I1/I2/I3;
- KCL disclosure `I1 = I2 + I3`;
- table có đúng ba resistor rows;
- mỗi row có R, voltage drop, current và power;
- caption ghi `R2 || R3` equivalent resistance;
- assumptions ghi rõ `ideal-dc-resistor-model` và không phải firmware/hardware/measurement.

Stable additive selectors:

```text
[data-resistive-topology="branch"]
[data-resistive-branch-visual]
[data-resistive-branch-table]
```

Result status có:

```text
data-result="calculated|error"
data-topology="branch|divider"   // chỉ tồn tại sau successful calculation
```

Mỗi lần calculate, old details và old topology metadata được xóa trước. Input/topology
lỗi không để lại SVG/table/số cũ.

## Negative contracts

`tests/resistive-branch-study-contracts.js` kiểm tra:

- exact input bounds/shape;
- real solver result cho symmetric và asymmetric branch;
- equivalent parallel resistance;
- Vmid;
- ba drops;
- I1/I2/I3 và KCL;
- abs currents;
- three powers;
- zero-V;
- boundary/branch provenance;
- finite forged MID/drop/current/absCurrent/power;
- finite “consistent-looking” forged report;
- wrong topology/extra node;
- foreign configured guard report;
- deep-freeze và no input mutation;
- mọi hardware/compiler/firmware/router claim vẫn false.

`tests/resistive-study-ui-contracts.js` giữ nguyên 18 legacy divider checks và thêm:

- branch controls render 3-row accessible SVG/table;
- enhanced controls vẫn chạy divider và bỏ qua invalid inactive R3;
- invalid R3 xóa stale branch output;
- partial control pair fail closed;
- unsupported topology fail closed.

## Current narrow validation

Tại thời điểm implementation trước final freeze:

- legacy divider tests: **18/18 PASS** trước khi thêm branch UI checks;
- branch model contracts: **15/15 PASS**;
- combined resistive UI contracts: **23/23 PASS**, trong đó 18 checks đầu là legacy
  divider checks được giữ nguyên.

Final freeze cần chạy lại các narrow Bun checks này. Worker không chạy Chrome/E2E,
không sửa app/index/styles/build/SW và không claim release/Pages.

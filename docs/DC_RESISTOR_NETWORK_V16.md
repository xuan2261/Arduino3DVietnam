# DC resistor network v1.6 — linear nodal solver, fail-closed

<code>src/dc-resistor-network.js</code> là solver toán học độc lập cho **mạng điện trở DC tuyến tính lý tưởng**. Nó không thay thế <code>src/electrical-solver.js</code>, không đọc lesson/router/breadboard tự động và không suy diễn output Arduino, LED, motor hoặc sensor.

API duy nhất:

~~~js
solveResistiveDC({ ground, voltageNodes, resistors }, options?)
~~~

Kết quả luôn có dạng frozen:

~~~js
{
  supported,
  calculated,
  nodeVoltages,
  resistorResults,
  issues,
  boundaries
}
~~~

## Input contract

### Ground

<code>ground</code> là một node ID explicit và được solver cố định bằng <code>0 V</code>.

~~~js
ground: "GND"
~~~

Không lặp lại ground trong <code>voltageNodes</code>. Nếu khai báo lại ở <code>0 V</code>, solver báo duplicate; nếu khai báo non-zero, solver báo contradiction.

### Fixed-voltage nodes

<code>voltageNodes</code> chỉ là các nguồn điện áp DC lý tưởng, cố định trong <code>0..5 V</code>:

~~~js
voltageNodes: [
  { node: "VCC", voltageVolts: 5 },
  { node: "BIAS", voltageVolts: 2.5 }
]
~~~

Mỗi node chỉ được khai báo một lần. Hai khai báo cùng tên — dù cùng điện áp — đều fail-closed để tránh ambiguity. Hai giá trị khác nhau trên cùng tên node là contradiction.

Nguồn được giả định có **zero source impedance**. Đây là điều kiện biên toán học, không phải mô hình chân Arduino thật.

### Resistors

~~~js
resistors: [
  { id: "R1", a: "VCC", b: "MID", ohms: 1000 },
  { id: "R2", a: "MID", b: "GND", ohms: 1000 }
]
~~~

- <code>id</code> phải unique.
- <code>a</code> và <code>b</code> là node IDs; cùng một node ID có nghĩa cùng một electrical node trong model.
- <code>a === b</code> bị từ chối.
- <code>ohms</code> phải là số hữu hạn <code>&gt; 0</code>.
- Hai resistor khác ID được phép có cùng cặp endpoints; đó là parallel branches hợp lệ.
- Zero-ohm ideal wire không được biểu diễn bằng resistor. Nếu hai điểm thực sự là cùng node, caller phải dùng cùng node ID.

Solver không nhận danh sách wire riêng. Connectivity được biểu diễn trực tiếp bằng **node identity**.

## Mathematical model

Với mỗi node chưa biết điện áp, solver lập phương trình KCL bằng conductance:

~~~text
Σ (Vi - Vj) / Rij = 0
~~~

Các node fixed-voltage và ground đi vào vế phải. Ma trận conductance được giải bằng **Gaussian elimination với partial pivoting**.

Trước khi giải:

- graph được chia thành connected components;
- mỗi component chứa unknown node phải có ít nhất một ground/fixed-voltage reference;
- floating components bị từ chối;
- số node tối đa 32;
- số fixed-voltage nodes tối đa 16;
- số resistor branches tối đa 64.

Solver cũng fail-closed nếu pivot nhỏ hơn ngưỡng tương đối của ma trận, thay vì trả kết quả từ một hệ singular hoặc quá ill-conditioned.

## Output values

Ví dụ divider 5 V, 1 kΩ + 1 kΩ:

~~~js
const result = solveResistiveDC({
  ground: "GND",
  voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
  resistors: [
    { id: "R1", a: "VCC", b: "MID", ohms: 1000 },
    { id: "R2", a: "MID", b: "GND", ohms: 1000 }
  ]
});
~~~

<code>nodeVoltages.MID</code> là <code>2.5 V</code>.

Mỗi resistor result chứa:

~~~js
{
  id: "R1",
  a: "VCC",
  b: "MID",
  resistanceOhms: 1000,
  voltageDropVolts: 2.5,
  currentMilliAmps: 2.5,
  absoluteCurrentMilliAmps: 2.5,
  powerMilliWatts: 6.25,
  origin: "ideal-dc-resistor-model",
  physicalVerified: false,
  measured: false
}
~~~

<code>currentMilliAmps</code> có dấu theo chiều khai báo <code>a → b</code>. <code>absoluteCurrentMilliAmps</code> dùng cho limit checks.

Kết quả được sắp resistor theo ID và node theo ID để cùng một network không phụ thuộc thứ tự branches trong input.

## Optional current / power guards

Caller có thể đặt:

~~~js
{
  maxCurrentMilliAmps: 20,
  maxPowerMilliWatts: 125
}
~~~

Nếu bất kỳ branch nào vượt guard:

- solver vẫn dùng math nội bộ để phát hiện;
- trả <code>supported: true</code>;
- trả <code>calculated: false</code>;
- **không phát hành** <code>nodeVoltages</code> hay <code>resistorResults</code>;
- <code>issues</code> chứa <code>CURRENT_BOUND_EXCEEDED</code> hoặc <code>POWER_BOUND_EXCEEDED</code>.

Guard là policy do caller cung cấp. Nó **không** được diễn giải thành datasheet rating, giới hạn Arduino hoặc hardware-safety threshold.

## Fail-closed boundaries

Các trường hợp sau bị từ chối:

- floating component;
- duplicate resistor ID;
- duplicate hoặc contradictory fixed-voltage node;
- ground được khai báo lại;
- source ngoài <code>0..5 V</code>;
- zero/negative/non-finite resistance;
- resistor nối node với chính nó;
- quá 32 nodes hoặc 64 branches;
- singular / numerically ill-conditioned conductance matrix;
- unknown schema fields;
- LED, diode, motor, sensor, capacitor, inductor, transistor, current source hoặc Arduino-output fields.

Module không hỗ trợ nonlinear elements bằng cách xấp xỉ chúng thành resistor. Unknown/nonlinear fields trả <code>supported:false</code>.

## Boundary metadata

Mọi result có:

~~~js
boundaries: {
  origin: "ideal-dc-resistor-model",
  model: "linear-ideal-dc-resistor-network",
  physicalVerified: false,
  measured: false,
  educationalOnly: true,
  ...
}
~~~

Các assumptions được ghi rõ:

- ideal fixed-voltage sources;
- explicit ground = 0 V;
- resistor tuyến tính, time-invariant, không thermal/tolerance model;
- không contact resistance;
- không physical safety verification.

## Không tự tích hợp vào lesson/router

Module **không**:

- đọc <code>circuit-router</code>;
- đọc <code>breadboard-topology</code>;
- gán resistance cho lesson component;
- giả định điện trở từ hình ảnh, màu, 3D placement hoặc tên component;
- tạo Arduino pin voltage;
- biến kết quả thành LED brightness/motor speed/sensor value.

Một integration tương lai chỉ được phép khi component resistance/source values có evidence explicit riêng.

## Contract coverage

<code>tests/dc-resistor-network-contracts.js</code> có hơn 25 checks:

- 1:1 và unequal divider;
- 3-resistor series;
- parallel branches;
- shared rail/node merge;
- multiple fixed sources;
- signed current orientation;
- deterministic order / no input mutation;
- floating components;
- duplicate/contradictory nodes;
- zero-ohm/self-loop/negative/non-finite resistance;
- nonlinear/unknown fields;
- node/branch bounds;
- partial-pivot ill-conditioning guard;
- current/power guard pass and block paths.

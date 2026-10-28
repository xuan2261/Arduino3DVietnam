// Netlist mở rộng có giới hạn cho các bài Arduino cơ bản.
// Chỉ xác minh topology đã khai báo; không tính dòng/áp và không phải SPICE.

export const SUPPORTED_EXTENDED_LESSONS = Object.freeze([4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

export const EXTENDED_CIRCUIT_LIMITS = Object.freeze({
  maxWires: 48,
  maxTerminals: 32,
  maxFunctionalPaths: 12,
});

const terminal = (id, label, kind, component, polarity = null) =>
  Object.freeze({ id, label, kind, component, polarity });

const PIANO_KEY_PINS = Object.freeze(["D2", "D3", "D4", "D5", "D6", "D7", "D8"]);
const pianoKeyTerminals = Object.freeze(PIANO_KEY_PINS.flatMap((pin, index) => [
  terminal("KEY" + (index + 1) + ":A", "Nút " + (index + 1) + " · đầu A", "button", "KEY" + (index + 1)),
  terminal("KEY" + (index + 1) + ":B", "Nút " + (index + 1) + " · đầu B", "button", "KEY" + (index + 1)),
]));
const pianoComponents = Object.freeze(Object.fromEntries(PIANO_KEY_PINS.map((_, index) => [
  "KEY" + (index + 1),
  Object.freeze(["KEY" + (index + 1) + ":A", "KEY" + (index + 1) + ":B"]),
])));

const CONFIGS = Object.freeze({
  4: Object.freeze({
    terminals: Object.freeze([
      terminal("5V", "Arduino 5V", "power", "arduino"),
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("A0", "Arduino A0", "input", "arduino"),
      terminal("D9", "Arduino D9 (PWM)", "output", "arduino"),
      terminal("POT:A", "Biến trở · đầu ngoài A", "passive", "POT"),
      terminal("POT:B", "Biến trở · đầu ngoài B", "passive", "POT"),
      terminal("POT:WIPER", "Biến trở · chân giữa", "signal", "POT"),
      terminal("R_LED:A", "Điện trở LED 220 Ω · đầu A", "passive", "R_LED"),
      terminal("R_LED:B", "Điện trở LED 220 Ω · đầu B", "passive", "R_LED"),
      terminal("LED:A", "LED · anode (+)", "led", "LED", "anode"),
      terminal("LED:K", "LED · cathode (−)", "led", "LED", "cathode"),
    ]),
    components: Object.freeze({ R_LED: Object.freeze(["R_LED:A", "R_LED:B"]) }),
  }),
  6: Object.freeze({
    terminals: Object.freeze([
      terminal("5V", "Arduino 5V", "power", "arduino"),
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("A0", "Arduino A0", "input", "arduino"),
      terminal("D13", "Arduino D13", "output", "arduino"),
      terminal("LDR:A", "LDR · đầu A", "sensor", "LDR"),
      terminal("LDR:B", "LDR · đầu B", "sensor", "LDR"),
      terminal("R_DIV:A", "Điện trở chia áp 10 kΩ · đầu A", "passive", "R_DIV"),
      terminal("R_DIV:B", "Điện trở chia áp 10 kΩ · đầu B", "passive", "R_DIV"),
      terminal("R_LED:A", "Điện trở LED 220 Ω · đầu A", "passive", "R_LED"),
      terminal("R_LED:B", "Điện trở LED 220 Ω · đầu B", "passive", "R_LED"),
      terminal("LED:A", "LED báo tối · anode (+)", "led", "LED", "anode"),
      terminal("LED:K", "LED báo tối · cathode (−)", "led", "LED", "cathode"),
    ]),
    components: Object.freeze({
      LDR: Object.freeze(["LDR:A", "LDR:B"]),
      R_DIV: Object.freeze(["R_DIV:A", "R_DIV:B"]),
      R_LED: Object.freeze(["R_LED:A", "R_LED:B"]),
    }),
  }),
  7: Object.freeze({
    terminals: Object.freeze([
      terminal("5V", "Arduino 5V", "power", "arduino"),
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("D7", "Arduino D7", "output", "arduino"),
      terminal("D8", "Arduino D8", "input", "arduino"),
      terminal("D13", "Arduino D13", "output", "arduino"),
      terminal("SONAR:VCC", "HC-SR04 VCC", "power-input", "SONAR", "positive"),
      terminal("SONAR:GND", "HC-SR04 GND", "ground-input", "SONAR", "negative"),
      terminal("SONAR:TRIG", "HC-SR04 Trig", "signal", "SONAR"),
      terminal("SONAR:ECHO", "HC-SR04 Echo", "signal", "SONAR"),
      terminal("R_LED:A", "Điện trở LED 220 Ω · đầu A", "passive", "R_LED"),
      terminal("R_LED:B", "Điện trở LED 220 Ω · đầu B", "passive", "R_LED"),
      terminal("LED:A", "LED cảnh báo · anode (+)", "led", "LED", "anode"),
      terminal("LED:K", "LED cảnh báo · cathode (−)", "led", "LED", "cathode"),
    ]),
    components: Object.freeze({ R_LED: Object.freeze(["R_LED:A", "R_LED:B"]) }),
  }),
  8: Object.freeze({
    terminals: Object.freeze([
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("D8", "Arduino D8", "output", "arduino"),
      terminal("BUZZ:+", "Buzzer thụ động · cực (+)", "buzzer", "BUZZ", "positive"),
      terminal("BUZZ:-", "Buzzer thụ động · cực (−)", "buzzer", "BUZZ", "negative"),
    ]),
    components: Object.freeze({}),
  }),
  9: Object.freeze({
    terminals: Object.freeze([
      terminal("GND", "Arduino GND", "ground", "arduino"),
      ...PIANO_KEY_PINS.map(pin => terminal(pin, "Arduino " + pin + " · INPUT_PULLUP", "input", "arduino")),
      terminal("D9", "Arduino D9 · buzzer", "output", "arduino"),
      ...pianoKeyTerminals,
      terminal("BUZZ:+", "Buzzer · cực (+)", "buzzer", "BUZZ", "positive"),
      terminal("BUZZ:-", "Buzzer · cực (−)", "buzzer", "BUZZ", "negative"),
    ]),
    components: pianoComponents,
  }),
  10: Object.freeze({
    terminals: Object.freeze([
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("D7", "Arduino D7", "output", "arduino"),
      terminal("D8", "Arduino D8", "output", "arduino"),
      terminal("D9", "Arduino D9 (PWM)", "output", "arduino"),
      terminal("DRV:ENA", "Driver cầu H · ENA", "driver-input", "DRV"),
      terminal("DRV:IN1", "Driver cầu H · IN1", "driver-input", "DRV"),
      terminal("DRV:IN2", "Driver cầu H · IN2", "driver-input", "DRV"),
      terminal("DRV:GND", "Driver cầu H · GND logic", "ground-input", "DRV", "negative"),
    ]),
    components: Object.freeze({}),
  }),
  11: Object.freeze({
    terminals: Object.freeze([
      terminal("5V", "Arduino 5V", "power", "arduino"),
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("A0", "Arduino A0", "input", "arduino"),
      terminal("D13", "Arduino D13", "output", "arduino"),
      terminal("LM35:VS", "LM35 Vs", "power-input", "LM35", "positive"),
      terminal("LM35:VOUT", "LM35 Vout", "signal", "LM35"),
      terminal("LM35:GND", "LM35 GND", "ground-input", "LM35", "negative"),
      terminal("R_LED:A", "Điện trở LED 220 Ω · đầu A", "passive", "R_LED"),
      terminal("R_LED:B", "Điện trở LED 220 Ω · đầu B", "passive", "R_LED"),
      terminal("LED:A", "LED cảnh báo · anode (+)", "led", "LED", "anode"),
      terminal("LED:K", "LED cảnh báo · cathode (−)", "led", "LED", "cathode"),
    ]),
    components: Object.freeze({ R_LED: Object.freeze(["R_LED:A", "R_LED:B"]) }),
  }),
  12: Object.freeze({
    terminals: Object.freeze([
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("D9", "Arduino D9", "output", "arduino"),
      terminal("SERVO_SUPPLY:+", "Nguồn riêng phù hợp servo (+)", "power", "supply", "positive"),
      terminal("SERVO_SUPPLY:-", "Mass nguồn servo (−)", "ground", "supply", "negative"),
      terminal("SERVO:SIG", "Servo · tín hiệu", "signal", "SERVO"),
      terminal("SERVO:VCC", "Servo · VCC", "power-input", "SERVO", "positive"),
      terminal("SERVO:GND", "Servo · GND", "ground-input", "SERVO", "negative"),
    ]),
    components: Object.freeze({}),
  }),
  13: Object.freeze({
    terminals: Object.freeze([
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("D2", "Arduino D2 · STEP", "output", "arduino"),
      terminal("D3", "Arduino D3 · DIR", "output", "arduino"),
      terminal("MOTOR:+", "Nguồn động cơ riêng · (+)", "external-power", "MOTOR_SUPPLY", "positive"),
      terminal("MOTOR:-", "Nguồn động cơ riêng · (−)", "external-ground", "MOTOR_SUPPLY", "negative"),
      terminal("DRV:STEP", "Driver bước · STEP", "driver-input", "DRV"),
      terminal("DRV:DIR", "Driver bước · DIR", "driver-input", "DRV"),
      terminal("DRV:GND", "Driver bước · GND", "ground-input", "DRV", "negative"),
      terminal("DRV:VMOT", "Driver bước · VMOT", "power-input", "DRV", "positive"),
    ]),
    components: Object.freeze({}),
  }),
  14: Object.freeze({
    terminals: Object.freeze([
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("A0", "Arduino A0", "input", "arduino"),
      terminal("D8", "Arduino D8", "output", "arduino"),
      terminal("SOIL:SIG", "Cảm biến độ ẩm · tín hiệu", "signal", "SOIL"),
      terminal("SOIL:GND", "Cảm biến độ ẩm · GND tín hiệu", "ground-input", "SOIL", "negative"),
      terminal("PUMP:IN", "Driver/relay bơm · tín hiệu điều khiển", "driver-input", "PUMP"),
      terminal("PUMP:GND", "Driver/relay bơm · GND logic", "ground-input", "PUMP", "negative"),
    ]),
    components: Object.freeze({}),
  }),
  15: Object.freeze({
    terminals: Object.freeze([
      terminal("5V", "Arduino 5V", "power", "arduino"),
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("A0", "Arduino A0", "input", "arduino"),
      terminal("D13", "Arduino D13", "output", "arduino"),
      terminal("FSR:A", "FSR · đầu A", "sensor", "FSR"),
      terminal("FSR:B", "FSR · đầu B", "sensor", "FSR"),
      terminal("R_DIV:A", "Điện trở chia áp · đầu A", "passive", "R_DIV"),
      terminal("R_DIV:B", "Điện trở chia áp · đầu B", "passive", "R_DIV"),
      terminal("R_LED:A", "Điện trở LED 220 Ω · đầu A", "passive", "R_LED"),
      terminal("R_LED:B", "Điện trở LED 220 Ω · đầu B", "passive", "R_LED"),
      terminal("LED:A", "LED báo lực · anode (+)", "led", "LED", "anode"),
      terminal("LED:K", "LED báo lực · cathode (−)", "led", "LED", "cathode"),
    ]),
    components: Object.freeze({
      FSR: Object.freeze(["FSR:A", "FSR:B"]),
      R_DIV: Object.freeze(["R_DIV:A", "R_DIV:B"]),
      R_LED: Object.freeze(["R_LED:A", "R_LED:B"]),
    }),
  }),
  16: Object.freeze({
    terminals: Object.freeze([
      terminal("5V", "Arduino 5V", "power", "arduino"),
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("A0", "Arduino A0 · ánh sáng", "input", "arduino"),
      terminal("A1", "Arduino A1 · nhiệt độ", "input", "arduino"),
      terminal("D2", "Arduino D2 · nút INPUT_PULLUP", "input", "arduino"),
      terminal("D8", "Arduino D8 · buzzer", "output", "arduino"),
      terminal("D13", "Arduino D13 · LED", "output", "arduino"),
      terminal("LDR:A", "LDR · đầu A", "sensor", "LDR"),
      terminal("LDR:B", "LDR · đầu B", "sensor", "LDR"),
      terminal("R_LDR:A", "Điện trở chia áp LDR 10 kΩ · đầu A", "passive", "R_LDR"),
      terminal("R_LDR:B", "Điện trở chia áp LDR 10 kΩ · đầu B", "passive", "R_LDR"),
      terminal("LM35:VS", "LM35 Vs", "power-input", "LM35", "positive"),
      terminal("LM35:VOUT", "LM35 Vout", "signal", "LM35"),
      terminal("LM35:GND", "LM35 GND", "ground-input", "LM35", "negative"),
      terminal("BTN:1", "Nút nhấn · đầu 1", "button", "BTN"),
      terminal("BTN:2", "Nút nhấn · đầu 2", "button", "BTN"),
      terminal("R_LED:A", "Điện trở LED 220 Ω · đầu A", "passive", "R_LED"),
      terminal("R_LED:B", "Điện trở LED 220 Ω · đầu B", "passive", "R_LED"),
      terminal("LED:A", "LED · anode (+)", "led", "LED", "anode"),
      terminal("LED:K", "LED · cathode (−)", "led", "LED", "cathode"),
      terminal("BUZZ:+", "Buzzer · cực (+)", "buzzer", "BUZZ", "positive"),
      terminal("BUZZ:-", "Buzzer · cực (−)", "buzzer", "BUZZ", "negative"),
    ]),
    components: Object.freeze({
      LDR: Object.freeze(["LDR:A", "LDR:B"]),
      R_LDR: Object.freeze(["R_LDR:A", "R_LDR:B"]),
      BTN: Object.freeze(["BTN:1", "BTN:2"]),
      R_LED: Object.freeze(["R_LED:A", "R_LED:B"]),
    }),
  }),
});

const SAMPLE_WIRES = Object.freeze({
  4: Object.freeze([["5V","POT:A"],["GND","POT:B"],["A0","POT:WIPER"],["D9","R_LED:A"],["R_LED:B","LED:A"],["LED:K","GND"]]),
  6: Object.freeze([["5V","LDR:A"],["LDR:B","A0"],["A0","R_DIV:A"],["R_DIV:B","GND"],["D13","R_LED:A"],["R_LED:B","LED:A"],["LED:K","GND"]]),
  7: Object.freeze([["5V","SONAR:VCC"],["GND","SONAR:GND"],["D7","SONAR:TRIG"],["D8","SONAR:ECHO"],["D13","R_LED:A"],["R_LED:B","LED:A"],["LED:K","GND"]]),
  8: Object.freeze([["D8","BUZZ:+"],["GND","BUZZ:-"]]),
  9: Object.freeze([
    ["D2","KEY1:A"],["KEY1:B","GND"],["D3","KEY2:A"],["KEY2:B","GND"],
    ["D4","KEY3:A"],["KEY3:B","GND"],["D5","KEY4:A"],["KEY4:B","GND"],
    ["D6","KEY5:A"],["KEY5:B","GND"],["D7","KEY6:A"],["KEY6:B","GND"],
    ["D8","KEY7:A"],["KEY7:B","GND"],["D9","BUZZ:+"],["BUZZ:-","GND"],
  ]),
  10: Object.freeze([["D9","DRV:ENA"],["D7","DRV:IN1"],["D8","DRV:IN2"],["GND","DRV:GND"]]),
  11: Object.freeze([["5V","LM35:VS"],["A0","LM35:VOUT"],["GND","LM35:GND"],["D13","R_LED:A"],["R_LED:B","LED:A"],["LED:K","GND"]]),
  12: Object.freeze([
    ["D9","SERVO:SIG"],
    ["SERVO_SUPPLY:+","SERVO:VCC"],
    ["SERVO_SUPPLY:-","SERVO:GND"],
    ["GND","SERVO_SUPPLY:-"],
  ]),
  13: Object.freeze([["D2","DRV:STEP"],["D3","DRV:DIR"],["GND","DRV:GND"],["MOTOR:+","DRV:VMOT"],["MOTOR:-","DRV:GND"]]),
  14: Object.freeze([["A0","SOIL:SIG"],["D8","PUMP:IN"],["GND","SOIL:GND"],["GND","PUMP:GND"]]),
  15: Object.freeze([["5V","FSR:A"],["FSR:B","A0"],["A0","R_DIV:A"],["R_DIV:B","GND"],["D13","R_LED:A"],["R_LED:B","LED:A"],["LED:K","GND"]]),
  16: Object.freeze([
    ["5V","LDR:A"],["LDR:B","A0"],["A0","R_LDR:A"],["R_LDR:B","GND"],
    ["5V","LM35:VS"],["A1","LM35:VOUT"],["GND","LM35:GND"],
    ["D2","BTN:1"],["BTN:2","GND"],
    ["D13","R_LED:A"],["R_LED:B","LED:A"],["LED:K","GND"],
    ["D8","BUZZ:+"],["BUZZ:-","GND"],
  ]),
});

function lessonNumber(lessonId) {
  const id = Number(lessonId);
  if (!Number.isInteger(id) || id < 1) throw new TypeError("lessonId phải là số nguyên dương");
  return id;
}

function configFor(lessonId) {
  return CONFIGS[lessonNumber(lessonId)] ?? null;
}

export function getExtendedSampleWires(lessonId) {
  const sample = SAMPLE_WIRES[lessonNumber(lessonId)];
  return sample ? sample.map(pair => [...pair]) : [];
}

export function createExtendedCircuit(lessonId) {
  const id = lessonNumber(lessonId);
  return {
    version: 1,
    engine: "extended-v1",
    lessonId: id,
    supported: Boolean(CONFIGS[id]),
    wires: [],
    nextWireId: 1,
  };
}

export function listExtendedTerminals(lessonId) {
  const config = configFor(lessonId);
  return config ? config.terminals.map(item => ({ ...item })) : [];
}

function edgeKey(from, to) {
  return from < to ? from + "\u0000" + to : to + "\u0000" + from;
}

function validateState(state, lessonId, config) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new TypeError("state mạch mở rộng không hợp lệ");
  if (state.version !== 1 || state.engine !== "extended-v1") throw new RangeError("Phiên bản state mạch mở rộng không được hỗ trợ");
  if (Number(state.lessonId) !== lessonId) throw new RangeError("state thuộc bài học khác");
  if (!state.supported) throw new RangeError("Bài học này chưa hỗ trợ engine mạch mở rộng");
  if (!Array.isArray(state.wires)) throw new TypeError("state.wires phải là mảng");
  if (state.wires.length > EXTENDED_CIRCUIT_LIMITS.maxWires) throw new RangeError("Vượt giới hạn số dây nối");
  if (!Number.isInteger(state.nextWireId) || state.nextWireId < 1) throw new TypeError("nextWireId không hợp lệ");

  const allowed = new Set(config.terminals.map(item => item.id));
  const ids = new Set();
  const edges = new Set();
  let greatestId = 0;
  for (const wire of state.wires) {
    if (!wire || typeof wire !== "object") throw new TypeError("Dây nối không hợp lệ");
    if (typeof wire.id !== "string" || !/^w\d+$/.test(wire.id) || ids.has(wire.id)) throw new TypeError("ID dây nối không hợp lệ");
    if (!allowed.has(wire.from) || !allowed.has(wire.to)) throw new RangeError("Dây nối dùng terminal ngoài bài học");
    if (wire.from === wire.to) throw new RangeError("Không thể nối terminal với chính nó");
    const key = edgeKey(wire.from, wire.to);
    if (edges.has(key)) throw new RangeError("Dây nối bị trùng");
    ids.add(wire.id);
    edges.add(key);
    greatestId = Math.max(greatestId, Number(wire.id.slice(1)));
  }
  if (state.nextWireId <= greatestId) throw new RangeError("nextWireId phải lớn hơn các ID dây đã dùng");
  return { allowed, edges };
}

function cloneState(state, wires = state.wires) {
  return {
    version: 1,
    engine: "extended-v1",
    lessonId: Number(state.lessonId),
    supported: Boolean(state.supported),
    wires: wires.map(wire => ({ ...wire })),
    nextWireId: state.nextWireId,
  };
}

export function connectExtendedCircuit(state, from, to) {
  const id = lessonNumber(state?.lessonId);
  const config = CONFIGS[id];
  if (!config) throw new RangeError("Bài học này chưa hỗ trợ engine mạch mở rộng");
  const checked = validateState(state, id, config);
  if (typeof from !== "string" || typeof to !== "string") throw new TypeError("Terminal phải là chuỗi ID");
  if (!checked.allowed.has(from) || !checked.allowed.has(to)) throw new RangeError("Terminal không thuộc bài học");
  if (from === to) throw new RangeError("Không thể nối terminal với chính nó");
  if (checked.edges.has(edgeKey(from, to))) throw new RangeError("Kết nối đã tồn tại");
  if (state.wires.length >= EXTENDED_CIRCUIT_LIMITS.maxWires) throw new RangeError("Đã đạt giới hạn số dây nối");

  const next = cloneState(state);
  next.wires.push({ id: "w" + state.nextWireId, from, to });
  next.nextWireId += 1;
  return next;
}

export function disconnectExtendedCircuit(state, indexOrId) {
  const id = lessonNumber(state?.lessonId);
  const config = CONFIGS[id];
  if (!config) throw new RangeError("Bài học này chưa hỗ trợ engine mạch mở rộng");
  validateState(state, id, config);
  let index = -1;
  if (Number.isInteger(indexOrId)) index = indexOrId;
  else if (typeof indexOrId === "string") index = state.wires.findIndex(wire => wire.id === indexOrId);
  else throw new TypeError("Cần chỉ số dây hoặc ID dây");
  if (index < 0 || index >= state.wires.length) throw new RangeError("Không tìm thấy dây cần ngắt");
  return cloneState(state, state.wires.filter((_, wireIndex) => wireIndex !== index));
}

function buildNets(config, wires) {
  const ids = config.terminals.map(item => item.id);
  const parent = new Map(ids.map(id => [id, id]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let current = id;
    while (parent.get(current) !== current) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const join = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  wires.forEach(wire => join(wire.from, wire.to));
  const groups = new Map();
  ids.forEach(id => {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  });
  return {
    same: (a, b) => find(a) === find(b),
    connected: id => wires.some(wire => wire.from === id || wire.to === id),
    nets: [...groups.values()]
      .filter(items => items.length > 1)
      .map((items, index) => ({ id: "net-" + (index + 1), terminals: items })),
  };
}

function issue(code, severity, message, terminals = []) {
  return { code, severity, message, terminals: [...terminals] };
}

function path(id, label, complete) {
  return { id, label, complete: Boolean(complete) };
}

function bridge(config, nets, component, left, right) {
  const ends = config.components[component];
  if (!ends || nets.same(ends[0], ends[1])) return false;
  return (nets.same(left, ends[0]) && nets.same(right, ends[1])) ||
    (nets.same(left, ends[1]) && nets.same(right, ends[0]));
}

function componentBypassed(config, nets, component) {
  const ends = config.components[component];
  return Boolean(ends && nets.same(ends[0], ends[1]) && (nets.connected(ends[0]) || nets.connected(ends[1])));
}

function hasTerminal(config, id) {
  return config.terminals.some(item => item.id === id);
}

function commonShortChecks(config, nets, outputPins = []) {
  const issues = [];
  if (hasTerminal(config, "5V") && hasTerminal(config, "GND") && nets.same("5V", "GND") && nets.connected("5V")) {
    issues.push(issue("SHORT_5V_GND", "error", "5V đang nối tắt trực tiếp với GND.", ["5V", "GND"]));
  }
  for (const pin of outputPins) {
    if (hasTerminal(config, "GND") && nets.same(pin, "GND") && nets.connected(pin)) {
      issues.push(issue("SHORT_" + pin + "_GND", "error", pin + " đang nối tắt trực tiếp với GND.", [pin, "GND"]));
    }
    if (hasTerminal(config, "5V") && nets.same(pin, "5V") && nets.connected(pin)) {
      issues.push(issue("SHORT_" + pin + "_5V", "error", pin + " đang nối trực tiếp với 5V; mức LOW trên output có thể gây xung đột.", [pin, "5V"]));
    }
  }
  for (let i = 0; i < outputPins.length; i += 1) {
    for (let j = i + 1; j < outputPins.length; j += 1) {
      if (nets.same(outputPins[i], outputPins[j]) && nets.connected(outputPins[i])) {
        issues.push(issue("OUTPUT_PINS_SHORTED", "error", outputPins[i] + " và " + outputPins[j] + " đang bị nối chung trực tiếp.", [outputPins[i], outputPins[j]]));
      }
    }
  }
  return issues;
}

function boardPinConflicts(config, nets) {
  const pins = config.terminals.filter(item => item.component === "arduino");
  const issues = [];
  for (let i = 0; i < pins.length; i += 1) {
    for (let j = i + 1; j < pins.length; j += 1) {
      if (nets.same(pins[i].id, pins[j].id) && nets.connected(pins[i].id)) {
        issues.push(issue("BOARD_PINS_DIRECTLY_TIED", "error",
          `Chân ${pins[i].id} và ${pins[j].id} đang nối chung bằng dây, trái topology riêng của bài học. Hãy tháo dây tắt giữa hai chân Arduino.`,
          [pins[i].id, pins[j].id]));
      }
    }
  }
  return issues;
}

// Restrict direct-wire nets to the *component roles* which may share a node
// in this particular lesson's vetted teaching schematic. A connection that
// merges unrelated subcircuits (e.g. LM35 output onto the LED anode net)
// must not be described as a correct circuit just because all required
// source-to-target paths still exist.
//
// Treat each Arduino pin as its own role, and each passive part as one role:
// flipping the two ends of a resistor/button still yields an equivalent
// valid example. This is deliberately conservative, not a physics solver.
function unexpectedNetMerges(config, circuit, samplePairs) {
  const byId = new Map(config.terminals.map(t => [
    t.id, t.component === "arduino" ? `arduino:${t.id}` : `part:${t.component}`
  ]));
  const reference = buildNets(config, samplePairs.map(([from,to]) => ({from,to})));
  const actual = buildNets(config, circuit.wires);
  const allowed = new Set();
  const pairKey = (left,right) => left < right ? left + "\u0000" + right : right + "\u0000" + left;
  for (const net of reference.nets) {
    for (let i=0;i<net.terminals.length;i++) {
      for (let j=i+1;j<net.terminals.length;j++) {
        allowed.add(pairKey(byId.get(net.terminals[i]),byId.get(net.terminals[j])));
      }
    }
  }
  const issues = [],reported = new Set();
  for (const net of actual.nets) {
    const terms=net.terminals;
    for (let i=0;i<terms.length;i++) {
      for (let j=i+1;j<terms.length;j++) {
        const roles=pairKey(byId.get(terms[i]),byId.get(terms[j]));
        if (!allowed.has(roles) && !reported.has(roles)) {
          reported.add(roles);
          issues.push(issue(
            "UNEXPECTED_NET_MERGE", "error",
            "Dây đang nối chung các nhóm chân không liên quan theo sơ đồ bài học; có thể gây sai cảm biến hoặc xung đột đầu ra.",
            [terms[i],terms[j]]
          ));
        }
      }
    }
  }
  return issues;
}

function adcRailIssues(config, nets, pin, prefix) {
  const issues = [];
  if (hasTerminal(config, "5V") && nets.same(pin, "5V") && nets.connected(pin)) {
    issues.push(issue(prefix + "_FIXED_5V", "error", pin + " đang nối trực tiếp 5V nên không còn là tín hiệu cảm biến biến thiên.", [pin, "5V"]));
  }
  if (hasTerminal(config, "GND") && nets.same(pin, "GND") && nets.connected(pin)) {
    issues.push(issue(prefix + "_FIXED_GND", "error", pin + " đang nối trực tiếp GND nên không còn là tín hiệu cảm biến biến thiên.", [pin, "GND"]));
  }
  return issues;
}

function analyzeLed(config, nets, source, resistor, prefix, label) {
  const issues = [];
  const resistorOk = bridge(config, nets, resistor, source, "LED:A");
  const cathodeGround = nets.same("LED:K", "GND");
  const reversed = (bridge(config, nets, resistor, source, "LED:K") || nets.same(source, "LED:K")) && nets.same("LED:A", "GND");
  const direct = nets.same(source, "LED:A") || nets.same(source, "LED:K");
  const bypassed = componentBypassed(config, nets, resistor);
  const ledShorted = nets.same("LED:A", "LED:K") &&
    (nets.connected("LED:A") || nets.connected("LED:K"));
  if (bypassed) issues.push(issue(prefix + "_RESISTOR_BYPASSED", "error", label + ": điện trở hạn dòng đang bị nối tắt qua.", config.components[resistor]));
  if (direct) issues.push(issue(prefix + "_RESISTOR_MISSING", "error", label + ": LED đang nối trực tiếp với " + source + "; cần điện trở hạn dòng nối tiếp.", [source, "LED:A", "LED:K"]));
  if (ledShorted) issues.push(issue(prefix + "_LED_BYPASSED", "error", label + ": hai cực LED đang nằm trên cùng một net, đèn bị nối tắt.", ["LED:A", "LED:K"]));
  if (reversed) issues.push(issue(prefix + "_POLARITY_REVERSED", "warning", label + ": anode/cathode LED đang bị đảo.", ["LED:A", "LED:K"]));
  if (!cathodeGround) issues.push(issue(prefix + "_GROUND_MISSING", "warning", label + ": cathode LED chưa nối về GND.", ["LED:K", "GND"]));
  if (!resistorOk && !direct && !reversed) issues.push(issue(prefix + "_PATH_MISSING", "warning", label + ": thiếu đường " + source + " → điện trở → anode LED.", [source, ...config.components[resistor], "LED:A"]));
  return { issues, complete: resistorOk && cathodeGround && !reversed && !direct && !bypassed && !ledShorted };
}

function analyzeDivider(config, nets, sensor, fixed, sensePin, prefix, label) {
  const issues = [];
  const top = bridge(config, nets, sensor, "5V", sensePin);
  const bottom = bridge(config, nets, fixed, sensePin, "GND");
  const reversed = bridge(config, nets, fixed, "5V", sensePin) && bridge(config, nets, sensor, sensePin, "GND");
  const sensorBypassed = componentBypassed(config, nets, sensor);
  const resistorBypassed = componentBypassed(config, nets, fixed);
  if (sensorBypassed) issues.push(issue(prefix + "_SENSOR_BYPASSED", "error", label + ": cảm biến đang bị nối tắt qua.", config.components[sensor]));
  if (resistorBypassed) issues.push(issue(prefix + "_RESISTOR_BYPASSED", "error", label + ": điện trở chia áp đang bị nối tắt qua.", config.components[fixed]));
  if (reversed) issues.push(issue(prefix + "_DIVIDER_REVERSED", "warning", label + ": vị trí cảm biến và điện trở cố định bị đảo so với chiều ADC của bài học.", ["5V", sensePin, "GND"]));
  if (!top || !bottom) issues.push(issue(prefix + "_DIVIDER_INCOMPLETE", "warning", label + ": cần đủ 5V → cảm biến → " + sensePin + " → điện trở cố định → GND.", ["5V", sensePin, "GND"]));
  issues.push(...adcRailIssues(config, nets, sensePin, prefix));
  return { issues, complete: top && bottom && !reversed && !sensorBypassed && !resistorBypassed && !nets.same(sensePin, "5V") && !nets.same(sensePin, "GND") };
}

function analyzePoweredDevice(nets, source, ground, vcc, deviceGround, prefix, label) {
  const issues = [];
  const correct = nets.same(source, vcc) && nets.same(ground, deviceGround);
  const reversed = nets.same(source, deviceGround) && nets.same(ground, vcc);
  if (reversed) issues.push(issue(prefix + "_POWER_REVERSED", "error", label + ": VCC và GND đang bị đảo.", [source, ground, vcc, deviceGround]));
  if (nets.same(vcc, deviceGround) && (nets.connected(vcc) || nets.connected(deviceGround))) {
    issues.push(issue(prefix + "_POWER_PINS_SHORTED", "error", label + ": chân nguồn và GND của thiết bị đang nằm trên cùng một net.", [vcc, deviceGround]));
  }
  if (!correct && !reversed) issues.push(issue(prefix + "_POWER_INCOMPLETE", "warning", label + ": thiếu đường cấp nguồn/GND đúng cực.", [source, ground, vcc, deviceGround]));
  return { issues, complete: correct && !reversed && !nets.same(vcc, deviceGround) };
}

function analyzeBuzzer(nets, source, prefix = "BUZZER") {
  const issues = [];
  const correct = nets.same(source, "BUZZ:+") && nets.same("GND", "BUZZ:-");
  const reversed = nets.same(source, "BUZZ:-") && nets.same("GND", "BUZZ:+");
  if (reversed) issues.push(issue(prefix + "_POLARITY_REVERSED", "warning", "Cực (+)/(−) của buzzer đang bị đảo so với sơ đồ bài.", [source, "GND", "BUZZ:+", "BUZZ:-"]));
  if (nets.same("BUZZ:+", "BUZZ:-") && (nets.connected("BUZZ:+") || nets.connected("BUZZ:-"))) {
    issues.push(issue(prefix + "_TERMINALS_SHORTED", "error", "Hai cực buzzer đang bị nối chung trực tiếp.", ["BUZZ:+", "BUZZ:-"]));
  }
  if (!correct && !reversed) issues.push(issue(prefix + "_PATH_MISSING", "warning", "Thiếu đường " + source + " → buzzer (+), buzzer (−) → GND.", [source, "GND", "BUZZ:+", "BUZZ:-"]));
  return { issues, complete: correct && !reversed && !nets.same("BUZZ:+", "BUZZ:-") };
}

function analyzeLesson4(config, nets) {
  const issues = commonShortChecks(config, nets, ["D9"]);
  const potPowered = (nets.same("5V", "POT:A") && nets.same("GND", "POT:B")) ||
    (nets.same("5V", "POT:B") && nets.same("GND", "POT:A"));
  const wiper = nets.same("A0", "POT:WIPER");
  if (nets.same("POT:A", "POT:B") && (nets.connected("POT:A") || nets.connected("POT:B"))) issues.push(issue("POT_OUTER_PINS_SHORTED", "error", "Hai đầu ngoài của biến trở đang bị nối chung trực tiếp.", ["POT:A", "POT:B"]));
  if (!potPowered) issues.push(issue("POT_POWER_INCOMPLETE", "warning", "Hai đầu ngoài biến trở cần nối giữa 5V và GND.", ["5V", "GND", "POT:A", "POT:B"]));
  if (!wiper) issues.push(issue("POT_WIPER_MISSING", "warning", "Chân giữa biến trở chưa nối A0.", ["POT:WIPER", "A0"]));
  issues.push(...adcRailIssues(config, nets, "A0", "POT_ADC"));
  const led = analyzeLed(config, nets, "D9", "R_LED", "LED", "LED PWM");
  issues.push(...led.issues);
  return {
    issues,
    paths: [
      path("potentiometer", "5V ↔ biến trở ↔ GND, chân giữa → A0", potPowered && wiper && !nets.same("POT:A", "POT:B") && !nets.same("A0", "5V") && !nets.same("A0", "GND")),
      path("pwm-led", "D9 → điện trở → LED đúng cực → GND", led.complete),
    ],
  };
}

function analyzeLesson6(config, nets) {
  const issues = commonShortChecks(config, nets, ["D13"]);
  const divider = analyzeDivider(config, nets, "LDR", "R_DIV", "A0", "LDR", "Mạch chia áp LDR");
  const led = analyzeLed(config, nets, "D13", "R_LED", "LED", "LED báo tối");
  issues.push(...divider.issues, ...led.issues);
  return { issues, paths: [path("ldr-divider", "5V → LDR → A0 → 10 kΩ → GND", divider.complete), path("dark-led", "D13 → điện trở → LED → GND", led.complete)] };
}

function analyzeLesson7(config, nets) {
  const issues = commonShortChecks(config, nets, ["D7", "D13"]);
  const power = analyzePoweredDevice(nets, "5V", "GND", "SONAR:VCC", "SONAR:GND", "SONAR", "HC-SR04");
  const trig = nets.same("D7", "SONAR:TRIG");
  const echo = nets.same("D8", "SONAR:ECHO");
  const swapped = nets.same("D7", "SONAR:ECHO") && nets.same("D8", "SONAR:TRIG");
  const echoRailTie = (nets.same("D8", "5V") || nets.same("D8", "GND")) && nets.connected("D8");
  const trigEchoShort = nets.same("D7", "D8") && nets.connected("D7");
  if (swapped) issues.push(issue("SONAR_TRIG_ECHO_SWAPPED", "warning", "Trig và Echo đang bị đấu chéo so với sketch.", ["D7", "D8", "SONAR:TRIG", "SONAR:ECHO"]));
  if (echoRailTie) issues.push(issue("SONAR_ECHO_RAIL_TIE", "error", "D8/Echo đang bị nối cứng vào rail nguồn hoặc GND.", ["D8", "5V", "GND", "SONAR:ECHO"]));
  if (trigEchoShort) issues.push(issue("SONAR_TRIG_ECHO_SHORTED", "error", "D7 Trig và D8 Echo đang bị nối chung trực tiếp.", ["D7", "D8"]));
  if (!trig && !swapped) issues.push(issue("SONAR_TRIG_MISSING", "warning", "D7 chưa nối Trig.", ["D7", "SONAR:TRIG"]));
  if (!echo && !swapped) issues.push(issue("SONAR_ECHO_MISSING", "warning", "D8 chưa nối Echo.", ["D8", "SONAR:ECHO"]));
  const led = analyzeLed(config, nets, "D13", "R_LED", "LED", "LED cảnh báo");
  issues.push(...power.issues, ...led.issues);
  return { issues, paths: [
    path("sonar-power", "5V/GND → HC-SR04 đúng cực", power.complete),
    path("sonar-trig", "D7 → Trig", trig && !swapped),
    path("sonar-echo", "Echo → D8", echo && !swapped && !echoRailTie && !trigEchoShort),
    path("alarm-led", "D13 → điện trở → LED → GND", led.complete),
  ] };
}

function analyzeLesson8(config, nets) {
  const issues = commonShortChecks(config, nets, ["D8"]);
  const buzzer = analyzeBuzzer(nets, "D8");
  issues.push(...buzzer.issues);
  return { issues, paths: [path("buzzer", "D8 → buzzer (+), buzzer (−) → GND", buzzer.complete)] };
}

function analyzeLesson9(config, nets) {
  const issues = commonShortChecks(config, nets, ["D9"]);
  const paths = [];
  for (let i = 0; i < PIANO_KEY_PINS.length; i += 1) {
    const pin = PIANO_KEY_PINS[i];
    const component = "KEY" + (i + 1);
    const correct = bridge(config, nets, component, pin, "GND");
    const directLow = nets.same(pin, "GND") && nets.connected(pin);
    const bypassed = componentBypassed(config, nets, component);
    if (directLow) issues.push(issue("PIANO_" + pin + "_STUCK_LOW", "error", pin + " đang nối trực tiếp GND; INPUT_PULLUP chỉ nên xuống LOW qua nút khi nhấn.", [pin, "GND"]));
    if (bypassed) issues.push(issue("PIANO_KEY_BYPASSED", "error", "Hai đầu nút của " + pin + " đang bị nối tắt bằng dây.", config.components[component]));
    if (!correct) issues.push(issue("PIANO_" + pin + "_PATH_MISSING", "warning", "Thiếu đường " + pin + " → nút → GND.", [pin, ...config.components[component], "GND"]));
    paths.push(path("key-" + pin.toLowerCase(), pin + " → nút INPUT_PULLUP → GND", correct && !directLow && !bypassed));
  }
  for (let i = 0; i < PIANO_KEY_PINS.length; i += 1) {
    for (let j = i + 1; j < PIANO_KEY_PINS.length; j += 1) {
      if (nets.same(PIANO_KEY_PINS[i], PIANO_KEY_PINS[j]) && nets.connected(PIANO_KEY_PINS[i])) {
        issues.push(issue("PIANO_KEYS_SHORTED", "error", PIANO_KEY_PINS[i] + " và " + PIANO_KEY_PINS[j] + " đang nối chung, hai phím không còn độc lập.", [PIANO_KEY_PINS[i], PIANO_KEY_PINS[j]]));
      }
    }
  }
  const buzzer = analyzeBuzzer(nets, "D9");
  issues.push(...buzzer.issues);
  paths.push(path("piano-buzzer", "D9 → buzzer đúng cực → GND", buzzer.complete));
  return { issues, paths };
}

function analyzeLesson10(config, nets) {
  const issues = commonShortChecks(config, nets, ["D9", "D7", "D8"]);
  const expected = [["D9","DRV:ENA","enable"],["D7","DRV:IN1","in1"],["D8","DRV:IN2","in2"],["GND","DRV:GND","ground"]];
  const targets = ["DRV:ENA", "DRV:IN1", "DRV:IN2"];
  const signalPins = ["D9", "D7", "D8"];
  const paths = [];
  for (const [source, target, id] of expected) {
    const complete = nets.same(source, target);
    if (!complete) issues.push(issue("DRIVER_" + id.toUpperCase() + "_MISSING", "warning", source + " chưa nối đúng " + target + ".", [source, target]));
    paths.push(path("driver-" + id, source + " → " + target, complete));
  }
  for (let i = 0; i < signalPins.length; i += 1) {
    for (let j = 0; j < targets.length; j += 1) {
      if (i !== j && nets.same(signalPins[i], targets[j])) issues.push(issue("DRIVER_SIGNAL_MISMATCH", "warning", signalPins[i] + " đang nối vào " + targets[j] + " thay vì chân driver tương ứng.", [signalPins[i], targets[j]]));
    }
  }
  return { issues, paths };
}

function analyzeLesson11(config, nets) {
  const issues = commonShortChecks(config, nets, ["D13"]);
  const power = analyzePoweredDevice(nets, "5V", "GND", "LM35:VS", "LM35:GND", "LM35", "LM35");
  const signal = nets.same("A0", "LM35:VOUT");
  if (!signal) issues.push(issue("LM35_SIGNAL_MISSING", "warning", "A0 chưa nối Vout của LM35.", ["A0", "LM35:VOUT"]));
  issues.push(...adcRailIssues(config, nets, "A0", "LM35_ADC"));
  const led = analyzeLed(config, nets, "D13", "R_LED", "LED", "LED cảnh báo");
  issues.push(...power.issues, ...led.issues);
  return { issues, paths: [
    path("lm35-power", "5V/GND → LM35 đúng cực", power.complete),
    path("lm35-signal", "LM35 Vout → A0", signal && !nets.same("A0", "5V") && !nets.same("A0", "GND")),
    path("temp-led", "D13 → điện trở → LED → GND", led.complete),
  ] };
}

function analyzeLesson12(config, nets) {
  const issues = commonShortChecks(config, nets, ["D9"]);
  const power = analyzePoweredDevice(
    nets, "SERVO_SUPPLY:+", "SERVO_SUPPLY:-",
    "SERVO:VCC", "SERVO:GND", "SERVO", "Servo"
  );
  const signal = nets.same("D9", "SERVO:SIG");
  const commonGround = nets.same("GND", "SERVO_SUPPLY:-");
  const outputToSupply = nets.same("D9", "SERVO_SUPPLY:+");
  if (!signal) issues.push(issue("SERVO_SIGNAL_MISSING", "warning", "D9 chưa nối dây tín hiệu servo.", ["D9", "SERVO:SIG"]));
  if (!commonGround) issues.push(issue("SERVO_COMMON_GND_MISSING", "warning",
    "Nguồn riêng của servo và Arduino phải có GND chung để tín hiệu D9 có tham chiếu.", ["GND", "SERVO_SUPPLY:-"]));
  if (outputToSupply) issues.push(issue("SERVO_SIGNAL_TO_SUPPLY", "error",
    "D9 đang bị nối trực tiếp với cực (+) nguồn servo; chân tín hiệu không được nối vào nguồn cấp.", ["D9", "SERVO_SUPPLY:+"]));
  issues.push(...power.issues);
  return { issues, paths: [
    path("servo-power", "Nguồn riêng phù hợp → Servo VCC/GND đúng cực", power.complete && !outputToSupply),
    path("servo-common-gnd", "Arduino GND → GND nguồn servo", commonGround),
    path("servo-signal", "D9 → tín hiệu servo", signal && !outputToSupply),
  ] };
}

function analyzeLesson13(config, nets) {
  const issues = commonShortChecks(config, nets, ["D2", "D3"]);
  const step = nets.same("D2", "DRV:STEP");
  const direction = nets.same("D3", "DRV:DIR");
  const swapped = nets.same("D2", "DRV:DIR") && nets.same("D3", "DRV:STEP");
  const outputToMotorSupply = ["D2", "D3"].filter(pin =>
    (nets.same(pin, "MOTOR:+") || nets.same(pin, "DRV:VMOT")) && nets.connected(pin)
  );
  if (swapped) issues.push(issue("STEPPER_STEP_DIR_SWAPPED", "warning", "STEP và DIR đang bị đấu chéo so với sketch.", ["D2", "D3", "DRV:STEP", "DRV:DIR"]));
  for (const pin of outputToMotorSupply) {
    issues.push(issue("STEPPER_OUTPUT_TO_VMOT", "error", pin + " đang bị nối trực tiếp vào rail VMOT/nguồn động cơ riêng.", [pin, "MOTOR:+", "DRV:VMOT"]));
  }
  if (!step && !swapped) issues.push(issue("STEPPER_STEP_MISSING", "warning", "D2 chưa nối STEP của driver.", ["D2", "DRV:STEP"]));
  if (!direction && !swapped) issues.push(issue("STEPPER_DIR_MISSING", "warning", "D3 chưa nối DIR của driver.", ["D3", "DRV:DIR"]));

  const logicGround = nets.same("GND", "DRV:GND");
  if (!logicGround) issues.push(issue("STEPPER_COMMON_GROUND_MISSING", "warning", "Arduino và driver chưa có GND chung.", ["GND", "DRV:GND"]));

  const supplyCorrect = nets.same("MOTOR:+", "DRV:VMOT") && nets.same("MOTOR:-", "DRV:GND");
  const supplyReversed = nets.same("MOTOR:+", "DRV:GND") && nets.same("MOTOR:-", "DRV:VMOT");
  if (supplyReversed) issues.push(issue("STEPPER_POWER_REVERSED", "error", "Nguồn động cơ riêng đang bị đảo cực tại VMOT/GND.", ["MOTOR:+", "MOTOR:-", "DRV:VMOT", "DRV:GND"]));
  if (nets.same("MOTOR:+", "MOTOR:-") && nets.connected("MOTOR:+")) issues.push(issue("STEPPER_SUPPLY_SHORTED", "error", "Hai cực nguồn động cơ riêng đang bị nối tắt.", ["MOTOR:+", "MOTOR:-"]));
  if (nets.same("DRV:VMOT", "DRV:GND") && (nets.connected("DRV:VMOT") || nets.connected("DRV:GND"))) issues.push(issue("STEPPER_DRIVER_POWER_SHORTED", "error", "VMOT và GND driver đang nằm trên cùng một net.", ["DRV:VMOT", "DRV:GND"]));
  if (!supplyCorrect && !supplyReversed) issues.push(issue("STEPPER_POWER_INCOMPLETE", "warning", "Thiếu nguồn động cơ riêng đúng cực tới VMOT và GND driver.", ["MOTOR:+", "MOTOR:-", "DRV:VMOT", "DRV:GND"]));

  return { issues, paths: [
    path("step", "D2 → STEP", step && !swapped && !outputToMotorSupply.includes("D2")),
    path("direction", "D3 → DIR", direction && !swapped && !outputToMotorSupply.includes("D3")),
    path("logic-ground", "Arduino GND ↔ driver GND", logicGround),
    path("motor-supply", "Nguồn riêng (+) → VMOT, (−) → driver GND", supplyCorrect && !supplyReversed && !nets.same("MOTOR:+", "MOTOR:-") && !nets.same("DRV:VMOT", "DRV:GND")),
  ] };
}

function analyzeLesson14(config, nets) {
  const issues = commonShortChecks(config, nets, ["D8"]);
  const sensorSignal = nets.same("A0", "SOIL:SIG");
  const sensorGround = nets.same("GND", "SOIL:GND");
  const pumpSignal = nets.same("D8", "PUMP:IN");
  const pumpGround = nets.same("GND", "PUMP:GND");
  const sensorStuckGround = nets.same("A0", "GND") && nets.connected("A0");
  if (!sensorSignal) issues.push(issue("SOIL_SIGNAL_MISSING", "warning", "A0 chưa nối tín hiệu cảm biến độ ẩm.", ["A0", "SOIL:SIG"]));
  if (!sensorGround) issues.push(issue("SOIL_GROUND_MISSING", "warning", "Thiếu GND chung cho tín hiệu cảm biến độ ẩm.", ["GND", "SOIL:GND"]));
  if (!pumpSignal) issues.push(issue("PUMP_DRIVER_SIGNAL_MISSING", "warning", "D8 chưa nối đầu vào điều khiển driver/relay bơm.", ["D8", "PUMP:IN"]));
  if (!pumpGround) issues.push(issue("PUMP_DRIVER_GROUND_MISSING", "warning", "Thiếu GND logic chung cho driver/relay bơm.", ["GND", "PUMP:GND"]));
  if (sensorStuckGround) issues.push(issue("SOIL_INPUT_STUCK_GND", "error", "A0 đang bị nối trực tiếp GND nên tín hiệu độ ẩm bị giữ cố định.", ["A0", "GND"]));
  if (nets.same("A0", "D8") && nets.connected("A0")) issues.push(issue("SOIL_INPUT_PUMP_OUTPUT_SHORTED", "error", "A0 và D8 đang bị nối chung trực tiếp.", ["A0", "D8"]));
  return { issues, paths: [
    path("soil-signal", "Cảm biến độ ẩm → A0 với GND chung", sensorSignal && sensorGround && !sensorStuckGround),
    path("pump-driver", "D8 → driver/relay bơm với GND chung", pumpSignal && pumpGround),
  ] };
}

function analyzeLesson15(config, nets) {
  const issues = commonShortChecks(config, nets, ["D13"]);
  const divider = analyzeDivider(config, nets, "FSR", "R_DIV", "A0", "FSR", "Mạch chia áp FSR");
  const led = analyzeLed(config, nets, "D13", "R_LED", "LED", "LED báo lực");
  issues.push(...divider.issues, ...led.issues);
  return { issues, paths: [path("fsr-divider", "5V → FSR → A0 → điện trở → GND", divider.complete), path("force-led", "D13 → điện trở → LED → GND", led.complete)] };
}

function analyzeButtonPullup(config, nets) {
  const issues = [];
  const correct = bridge(config, nets, "BTN", "D2", "GND");
  if (nets.same("D2", "GND") && nets.connected("D2")) issues.push(issue("BUTTON_D2_STUCK_LOW", "warning", "D2 đang nối trực tiếp GND; nút INPUT_PULLUP phải tạo kết nối này chỉ khi nhấn.", ["D2", "GND"]));
  if (nets.same("D2", "5V") && nets.connected("D2")) issues.push(issue("BUTTON_D2_STUCK_HIGH", "warning", "D2 đang nối trực tiếp 5V; INPUT_PULLUP đã cung cấp mức HIGH nội bộ khi nút thả.", ["D2", "5V"]));
  if (componentBypassed(config, nets, "BTN")) issues.push(issue("BUTTON_BYPASSED", "error", "Hai đầu nút nhấn đang bị nối chung bằng dây, nên nút không còn tác dụng.", config.components.BTN));
  if (!correct) issues.push(issue("BUTTON_PATH_MISSING", "warning", "Thiếu đường D2 → nút nhấn → GND cho INPUT_PULLUP.", ["D2", ...config.components.BTN, "GND"]));
  return { issues, complete: correct && !nets.same("D2", "GND") && !nets.same("D2", "5V") && !componentBypassed(config, nets, "BTN") };
}

function analyzeLesson16(config, nets) {
  const issues = commonShortChecks(config, nets, ["D8", "D13"]);
  const divider = analyzeDivider(config, nets, "LDR", "R_LDR", "A0", "LDR", "Mạch chia áp ánh sáng");
  const lm35Power = analyzePoweredDevice(nets, "5V", "GND", "LM35:VS", "LM35:GND", "LM35", "LM35");
  const lm35Signal = nets.same("A1", "LM35:VOUT");
  if (!lm35Signal) issues.push(issue("LM35_SIGNAL_MISSING", "warning", "A1 chưa nối Vout của LM35.", ["A1", "LM35:VOUT"]));
  issues.push(...adcRailIssues(config, nets, "A1", "LM35_ADC"));
  const button = analyzeButtonPullup(config, nets);
  const led = analyzeLed(config, nets, "D13", "R_LED", "LED", "LED tự động");
  const buzzer = analyzeBuzzer(nets, "D8");
  issues.push(...divider.issues, ...lm35Power.issues, ...button.issues, ...led.issues, ...buzzer.issues);
  return { issues, paths: [
    path("light-divider", "5V → LDR → A0 → 10 kΩ → GND", divider.complete),
    path("lm35-power", "5V/GND → LM35 đúng cực", lm35Power.complete),
    path("lm35-signal", "LM35 Vout → A1", lm35Signal && !nets.same("A1", "5V") && !nets.same("A1", "GND")),
    path("override-button", "D2 → nút → GND (INPUT_PULLUP)", button.complete),
    path("auto-led", "D13 → điện trở → LED → GND", led.complete),
    path("temp-buzzer", "D8 → buzzer đúng cực → GND", buzzer.complete),
  ] };
}

function unsupportedResult(lessonId) {
  return {
    lessonId,
    supported: false,
    ok: false,
    functional: false,
    issues: [issue("UNSUPPORTED_EXTENDED_LESSON", "info", "Bài " + lessonId + " chưa có định nghĩa netlist mở rộng.")],
    paths: [],
    nets: [],
    stats: {
      wireCount: 0,
      maxWires: EXTENDED_CIRCUIT_LIMITS.maxWires,
      terminalCount: 0,
      maxTerminals: EXTENDED_CIRCUIT_LIMITS.maxTerminals,
      functionalPathCount: 0,
      maxFunctionalPaths: EXTENDED_CIRCUIT_LIMITS.maxFunctionalPaths,
    },
  };
}

export function analyzeExtendedCircuit(lessonId, state = undefined) {
  const id = lessonNumber(lessonId);
  const config = CONFIGS[id];
  if (!config) return unsupportedResult(id);
  if (config.terminals.length > EXTENDED_CIRCUIT_LIMITS.maxTerminals) throw new RangeError("Cấu hình bài học vượt giới hạn terminal");
  const circuit = state === undefined ? createExtendedCircuit(id) : state;
  validateState(circuit, id, config);
  const nets = buildNets(config, circuit.wires);
  const analyzers = {
    4: analyzeLesson4, 6: analyzeLesson6, 7: analyzeLesson7, 8: analyzeLesson8,
    9: analyzeLesson9, 10: analyzeLesson10, 11: analyzeLesson11, 12: analyzeLesson12,
    13: analyzeLesson13, 14: analyzeLesson14, 15: analyzeLesson15, 16: analyzeLesson16,
  };
  const analysis = analyzers[id](config, nets);
  if (analysis.paths.length > EXTENDED_CIRCUIT_LIMITS.maxFunctionalPaths) throw new RangeError("Cấu hình bài học vượt giới hạn functional path");
  const functional = analysis.paths.length > 0 && analysis.paths.every(item => item.complete);
  const allIssues = [
    ...analysis.issues,
    ...boardPinConflicts(config, nets),
    ...unexpectedNetMerges(config, circuit, SAMPLE_WIRES[id]),
  ];
  const hasError = allIssues.some(item => item.severity === "error");
  return {
    lessonId: id,
    supported: true,
    ok: functional && !hasError,
    functional,
    issues: allIssues,
    paths: analysis.paths,
    nets: nets.nets,
    stats: {
      wireCount: circuit.wires.length,
      maxWires: EXTENDED_CIRCUIT_LIMITS.maxWires,
      terminalCount: config.terminals.length,
      maxTerminals: EXTENDED_CIRCUIT_LIMITS.maxTerminals,
      functionalPathCount: analysis.paths.length,
      maxFunctionalPaths: EXTENDED_CIRCUIT_LIMITS.maxFunctionalPaths,
    },
  };
}

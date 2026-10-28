// Engine netlist có giới hạn cho các bài thực hành đấu dây tương tác.
// Đây không phải bộ giải SPICE: engine chỉ kiểm tra topology đã khai báo cho từng bài.

export const SUPPORTED_CIRCUIT_LESSONS = Object.freeze([2, 3, 5]);

export const CIRCUIT_LIMITS = Object.freeze({
  maxWires: 24,
  maxTerminals: 16,
  maxFunctionalPaths: 4,
});

const terminal = (id, label, kind, component, polarity = null) =>
  Object.freeze({ id, label, kind, component, polarity });

const CONFIGS = Object.freeze({
  2: Object.freeze({
    terminals: Object.freeze([
      terminal("D13", "Arduino D13", "output", "arduino"),
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("R1:A", "Điện trở 220 Ω · đầu A", "passive", "R1"),
      terminal("R1:B", "Điện trở 220 Ω · đầu B", "passive", "R1"),
      terminal("LED:A", "LED đỏ · anode (+)", "led", "LED", "anode"),
      terminal("LED:K", "LED đỏ · cathode (−)", "led", "LED", "cathode"),
    ]),
    resistors: Object.freeze({ R1: Object.freeze(["R1:A", "R1:B"]) }),
  }),
  3: Object.freeze({
    terminals: Object.freeze([
      terminal("5V", "Arduino 5V", "power", "arduino"),
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("D2", "Arduino D2", "input", "arduino"),
      terminal("D13", "Arduino D13", "output", "arduino"),
      terminal("BTN:1", "Nút nhấn · đầu 1", "button", "BTN"),
      terminal("BTN:2", "Nút nhấn · đầu 2", "button", "BTN"),
      terminal("R_PULL:A", "Điện trở kéo xuống 10 kΩ · đầu A", "passive", "R_PULL"),
      terminal("R_PULL:B", "Điện trở kéo xuống 10 kΩ · đầu B", "passive", "R_PULL"),
      terminal("R_LED:A", "Điện trở LED 220 Ω · đầu A", "passive", "R_LED"),
      terminal("R_LED:B", "Điện trở LED 220 Ω · đầu B", "passive", "R_LED"),
      terminal("LED:A", "LED đỏ · anode (+)", "led", "LED", "anode"),
      terminal("LED:K", "LED đỏ · cathode (−)", "led", "LED", "cathode"),
    ]),
    resistors: Object.freeze({
      R_PULL: Object.freeze(["R_PULL:A", "R_PULL:B"]),
      R_LED: Object.freeze(["R_LED:A", "R_LED:B"]),
    }),
  }),
  5: Object.freeze({
    terminals: Object.freeze([
      terminal("D9", "Arduino D9 (PWM)", "output", "arduino"),
      terminal("D10", "Arduino D10 (PWM)", "output", "arduino"),
      terminal("D11", "Arduino D11 (PWM)", "output", "arduino"),
      terminal("GND", "Arduino GND", "ground", "arduino"),
      terminal("R_R:A", "Điện trở kênh đỏ · đầu A", "passive", "R_R"),
      terminal("R_R:B", "Điện trở kênh đỏ · đầu B", "passive", "R_R"),
      terminal("R_G:A", "Điện trở kênh xanh lá · đầu A", "passive", "R_G"),
      terminal("R_G:B", "Điện trở kênh xanh lá · đầu B", "passive", "R_G"),
      terminal("R_B:A", "Điện trở kênh xanh dương · đầu A", "passive", "R_B"),
      terminal("R_B:B", "Điện trở kênh xanh dương · đầu B", "passive", "R_B"),
      terminal("RGB:R", "LED RGB · chân R", "rgb", "RGB", "anode"),
      terminal("RGB:G", "LED RGB · chân G", "rgb", "RGB", "anode"),
      terminal("RGB:B", "LED RGB · chân B", "rgb", "RGB", "anode"),
      terminal("RGB:K", "LED RGB · cathode chung", "rgb", "RGB", "cathode"),
    ]),
    resistors: Object.freeze({
      R_R: Object.freeze(["R_R:A", "R_R:B"]),
      R_G: Object.freeze(["R_G:A", "R_G:B"]),
      R_B: Object.freeze(["R_B:A", "R_B:B"]),
    }),
  }),
});

const REFERENCE_WIRES = Object.freeze({
  2: [["D13","R1:A"],["R1:B","LED:A"],["LED:K","GND"]],
  3: [["5V","BTN:1"],["BTN:2","D2"],["D2","R_PULL:A"],["R_PULL:B","GND"],
      ["D13","R_LED:A"],["R_LED:B","LED:A"],["LED:K","GND"]],
  5: [["D9","R_R:A"],["R_R:B","RGB:R"],["D10","R_G:A"],["R_G:B","RGB:G"],
      ["D11","R_B:A"],["R_B:B","RGB:B"],["RGB:K","GND"]]
});

function lessonNumber(lessonId) {
  const id = Number(lessonId);
  if (!Number.isInteger(id) || id < 1) throw new TypeError("lessonId phải là số nguyên dương");
  return id;
}

function configFor(lessonId) {
  return CONFIGS[lessonNumber(lessonId)] ?? null;
}

function baseState(lessonId, supported) {
  return { version: 1, lessonId, supported, wires: [], nextWireId: 1 };
}

export function createCircuit(lessonId) {
  const id = lessonNumber(lessonId);
  return baseState(id, Boolean(CONFIGS[id]));
}

export function listTerminals(lessonId) {
  const config = configFor(lessonId);
  return config ? config.terminals.map(item => ({ ...item })) : [];
}

function terminalSet(config) {
  return new Set(config.terminals.map(item => item.id));
}

function edgeKey(from, to) {
  return from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
}

function validateState(state, expectedLessonId, config) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new TypeError("state mạch không hợp lệ");
  if (state.version !== 1) throw new RangeError("Phiên bản state mạch không được hỗ trợ");
  if (Number(state.lessonId) !== expectedLessonId) throw new RangeError("state thuộc bài học khác");
  if (!state.supported) throw new RangeError("Bài học này chưa hỗ trợ đấu dây tương tác");
  if (!Array.isArray(state.wires)) throw new TypeError("state.wires phải là mảng");
  if (state.wires.length > CIRCUIT_LIMITS.maxWires) throw new RangeError("Vượt giới hạn số dây nối");
  if (!Number.isInteger(state.nextWireId) || state.nextWireId < 1) throw new TypeError("nextWireId không hợp lệ");

  const allowed = terminalSet(config);
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
    version: state.version,
    lessonId: Number(state.lessonId),
    supported: Boolean(state.supported),
    wires: wires.map(wire => ({ ...wire })),
    nextWireId: state.nextWireId,
  };
}

export function connectCircuit(state, from, to) {
  const id = lessonNumber(state?.lessonId);
  const config = CONFIGS[id];
  if (!config) throw new RangeError("Bài học này chưa hỗ trợ đấu dây tương tác");
  const checked = validateState(state, id, config);
  if (typeof from !== "string" || typeof to !== "string") throw new TypeError("Terminal phải là chuỗi ID");
  if (!checked.allowed.has(from) || !checked.allowed.has(to)) throw new RangeError("Terminal không thuộc bài học");
  if (from === to) throw new RangeError("Không thể nối terminal với chính nó");
  if (checked.edges.has(edgeKey(from, to))) throw new RangeError("Kết nối đã tồn tại");
  if (state.wires.length >= CIRCUIT_LIMITS.maxWires) throw new RangeError("Đã đạt giới hạn số dây nối");

  const next = cloneState(state);
  next.wires.push({ id: `w${state.nextWireId}`, from, to });
  next.nextWireId += 1;
  return next;
}

export function disconnectCircuit(state, indexOrId) {
  const id = lessonNumber(state?.lessonId);
  const config = CONFIGS[id];
  if (!config) throw new RangeError("Bài học này chưa hỗ trợ đấu dây tương tác");
  validateState(state, id, config);
  let index = -1;
  if (Number.isInteger(indexOrId)) index = indexOrId;
  else if (typeof indexOrId === "string") index = state.wires.findIndex(wire => wire.id === indexOrId);
  else throw new TypeError("Cần chỉ số dây hoặc ID dây");
  if (index < 0 || index >= state.wires.length) throw new RangeError("Không tìm thấy dây cần ngắt");
  const next = cloneState(state, state.wires.filter((_, wireIndex) => wireIndex !== index));
  return next;
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
  const same = (a, b) => find(a) === find(b);
  const connected = id => wires.some(wire => wire.from === id || wire.to === id);
  const nets = [...groups.values()]
    .filter(items => items.length > 1)
    .map((items, index) => ({ id: `net-${index + 1}`, terminals: items }));
  return { same, connected, nets };
}

function issue(code, severity, message, terminals = []) {
  return { code, severity, message, terminals: [...terminals] };
}

function path(id, label, complete) {
  return { id, label, complete: Boolean(complete) };
}

function resistorBridge(config, nets, component, left, right) {
  const ends = config.resistors[component];
  if (!ends || nets.same(ends[0], ends[1])) return false;
  return (nets.same(left, ends[0]) && nets.same(right, ends[1])) ||
    (nets.same(left, ends[1]) && nets.same(right, ends[0]));
}

function resistorBypassed(config, nets, component) {
  const ends = config.resistors[component];
  return Boolean(ends && nets.same(ends[0], ends[1]) && (nets.connected(ends[0]) || nets.connected(ends[1])));
}

function addDisconnected(issues, nets, terminalId, code, label) {
  if (!nets.connected(terminalId)) issues.push(issue(code, "warning", `${label} chưa được nối dây.`, [terminalId]));
}

// Course netlists never require two distinct Arduino board pins to share the
// same direct-wire net. This catches extra wires that bypass the intended
// sensor/button/resistor path even when every required example path remains.
function boardPinConflicts(config, nets) {
  const pins = config.terminals.filter(item => item.component === "arduino");
  const issues = [];
  for (let i = 0; i < pins.length; i += 1) {
    for (let j = i + 1; j < pins.length; j += 1) {
      if (nets.same(pins[i].id, pins[j].id) && nets.connected(pins[i].id)) {
        issues.push(issue("BOARD_PINS_DIRECTLY_TIED", "error",
          `Chân ${pins[i].id} và ${pins[j].id} đang nối chung bằng dây. Các bài này không cho phép bỏ qua mạch linh kiện giữa các chân Arduino.`,
          [pins[i].id, pins[j].id]));
      }
    }
  }
  return issues;
}

// The bounded lessons only allow direct-wire nets between component roles
// found together in the verified sample; resistor and button endpoints may
// swap freely because each passive component shares one role. A wire between
// the button's sensing node and LED load node must not silently pass just
// because the other required paths remain connected.
function unexpectedNetMerges(config, circuit, samplePairs) {
  const roles = new Map(config.terminals.map(t => [
    t.id, t.component === "arduino" ? `arduino:${t.id}` : `part:${t.component}`
  ]));
  const reference = buildNets(config, samplePairs.map(([from,to]) => ({from,to})));
  const actual = buildNets(config, circuit.wires);
  const pairKey = (a,b)=>a<b ? a+"\u0000"+b : b+"\u0000"+a;
  const allowed = new Set();
  for (const net of reference.nets) {
    for (let i=0;i<net.terminals.length;i++) {
      for (let j=i+1;j<net.terminals.length;j++) {
        allowed.add(pairKey(roles.get(net.terminals[i]),roles.get(net.terminals[j])));
      }
    }
  }
  const issues=[],reported=new Set();
  for (const net of actual.nets) {
    for (let i=0;i<net.terminals.length;i++) {
      for (let j=i+1;j<net.terminals.length;j++) {
        const rolePair=pairKey(roles.get(net.terminals[i]),roles.get(net.terminals[j]));
        if (!allowed.has(rolePair) && !reported.has(rolePair)) {
          reported.add(rolePair);
          issues.push(issue("UNEXPECTED_NET_MERGE","error",
            "Dây đang nối chung các nhóm chân không liên quan theo sơ đồ bài; hãy tháo kết nối tắt giữa các phần mạch.",
            [net.terminals[i],net.terminals[j]]));
        }
      }
    }
  }
  return issues;
}

function analyzeOutputLed(config, nets, source, resistor, prefix, label) {
  const issues = [];
  const resistorOk = resistorBridge(config, nets, resistor, source, "LED:A");
  const cathodeGround = nets.same("LED:K", "GND");
  const reversed = (resistorBridge(config, nets, resistor, source, "LED:K") || nets.same(source, "LED:K")) && nets.same("LED:A", "GND");
  const directToLed = nets.same(source, "LED:A") || nets.same(source, "LED:K");

  if (resistorBypassed(config, nets, resistor)) {
    issues.push(issue(`${prefix}_RESISTOR_BYPASSED`, "error", `${label}: điện trở hạn dòng đang bị dây nối tắt qua.`, config.resistors[resistor]));
  }
  if (directToLed) {
    issues.push(issue(`${prefix}_RESISTOR_MISSING`, "error", `${label}: LED đang nối trực tiếp với ${source}, cần điện trở hạn dòng nối tiếp.`, [source, "LED:A", "LED:K"]));
  }
  if (reversed) {
    issues.push(issue(`${prefix}_REVERSED`, "warning", `${label}: cực LED bị đảo; anode (+) phải ở phía ${source} qua điện trở và cathode (−) về GND.`, ["LED:A", "LED:K"]));
  }
  if (nets.same("LED:A", "LED:K") && (nets.connected("LED:A") || nets.connected("LED:K"))) {
    issues.push(issue(`${prefix}_LED_BYPASSED`, "error", `${label}: hai cực LED đang nằm trên cùng một net dây.`, ["LED:A", "LED:K"]));
  }
  return { issues, complete: resistorOk && cathodeGround && !reversed && !directToLed && !resistorBypassed(config, nets, resistor) };
}

function analyzeLesson2(config, nets) {
  const issues = [];
  addDisconnected(issues, nets, "D13", "D13_DISCONNECTED", "D13");
  addDisconnected(issues, nets, "GND", "GND_DISCONNECTED", "GND");
  if (nets.same("D13", "GND") && nets.connected("D13")) {
    issues.push(issue("SHORT_D13_GND", "error", "D13 đang nối tắt trực tiếp với GND; khi D13 ở HIGH có thể gây quá dòng.", ["D13", "GND"]));
  }
  const led = analyzeOutputLed(config, nets, "D13", "R1", "LED", "Mạch LED");
  issues.push(...led.issues);
  return { issues, paths: [path("led", "D13 → điện trở 220 Ω → LED đúng cực → GND", led.complete)] };
}

function buttonPath(nets, left, right) {
  return (nets.same("5V", left) && nets.same("D2", right)) || (nets.same("5V", right) && nets.same("D2", left));
}

function analyzeLesson3(config, nets) {
  const issues = [];
  addDisconnected(issues, nets, "5V", "5V_DISCONNECTED", "5V");
  addDisconnected(issues, nets, "GND", "GND_DISCONNECTED", "GND");
  addDisconnected(issues, nets, "D2", "D2_DISCONNECTED", "D2");
  addDisconnected(issues, nets, "D13", "D13_DISCONNECTED", "D13");

  if (nets.same("5V", "GND") && nets.connected("5V")) {
    issues.push(issue("SHORT_5V_GND", "error", "5V đang nối tắt trực tiếp với GND.", ["5V", "GND"]));
  }
  if (nets.same("D13", "GND") && nets.connected("D13")) {
    issues.push(issue("SHORT_D13_GND", "error", "D13 đang nối tắt trực tiếp với GND.", ["D13", "GND"]));
  }
  if (nets.same("D13", "5V") && nets.connected("D13")) {
    issues.push(issue("SHORT_D13_5V", "error", "D13 đang nối trực tiếp với 5V; khi D13 ở LOW sẽ xung đột mức điện áp.", ["D13", "5V"]));
  }
  if (nets.same("D2", "5V") && nets.connected("D2")) {
    issues.push(issue("D2_STUCK_HIGH", "error", "D2 đang nối trực tiếp với 5V nên không thể về LOW khi thả nút; phải ngắt dây tắt này để nút hoạt động.", ["D2", "5V"]));
  }
  if (nets.same("D2", "GND") && nets.connected("D2")) {
    issues.push(issue("D2_STUCK_LOW", "warning", "D2 đang nối trực tiếp với GND; điện trở kéo xuống phải nằm nối tiếp giữa D2 và GND.", ["D2", "GND"]));
  }

  const pullDown = resistorBridge(config, nets, "R_PULL", "D2", "GND");
  const pullUp = resistorBridge(config, nets, "R_PULL", "D2", "5V");
  if (resistorBypassed(config, nets, "R_PULL")) {
    issues.push(issue("PULLDOWN_BYPASSED", "error", "Điện trở kéo xuống 10 kΩ đang bị nối tắt qua.", config.resistors.R_PULL));
  }
  if (pullUp && !pullDown) {
    issues.push(issue("PULLDOWN_TO_5V", "warning", "Điện trở 10 kΩ đang kéo D2 lên 5V thay vì kéo xuống GND theo bài học.", ["D2", "5V", ...config.resistors.R_PULL]));
  } else if (!pullDown) {
    issues.push(issue("PULLDOWN_MISSING", "warning", "Thiếu đường D2 → điện trở 10 kΩ → GND; D2 có thể floating khi thả nút.", ["D2", "GND", ...config.resistors.R_PULL]));
  }

  const highPath = buttonPath(nets, "BTN:1", "BTN:2");
  const buttonSupplyShort = (nets.same("5V", "BTN:1") && nets.same("GND", "BTN:2")) ||
    (nets.same("5V", "BTN:2") && nets.same("GND", "BTN:1"));
  if (buttonSupplyShort) {
    issues.push(issue("SHORT_5V_GND_WHEN_PRESSED", "error", "Hai phía nút đang nối lần lượt với 5V và GND; khi nhấn sẽ tạo đường nối tắt nguồn.", ["5V", "BTN:1", "BTN:2", "GND"]));
  }
  if (!highPath) {
    const buttonToGround = (nets.same("GND", "BTN:1") && nets.same("D2", "BTN:2")) ||
      (nets.same("GND", "BTN:2") && nets.same("D2", "BTN:1"));
    issues.push(issue(
      buttonToGround ? "BUTTON_WRONG_SUPPLY" : "BUTTON_PATH_MISSING",
      "warning",
      buttonToGround ? "Nút đang đưa D2 về GND; bài này cần 5V → nút → D2." : "Thiếu đường 5V → nút nhấn → D2.",
      ["5V", "BTN:1", "BTN:2", "D2"],
    ));
  }

  const led = analyzeOutputLed(config, nets, "D13", "R_LED", "OUTPUT_LED", "LED đầu ra");
  issues.push(...led.issues);
  return {
    issues,
    paths: [
      path("button-high", "5V → nút nhấn → D2 (khi nhấn)", highPath),
      path("pull-down", "D2 → điện trở 10 kΩ → GND", pullDown),
      path("output-led", "D13 → điện trở 220 Ω → LED đúng cực → GND", led.complete),
    ],
  };
}

const RGB_CHANNELS = Object.freeze([
  Object.freeze({ id: "red", pin: "D9", resistor: "R_R", led: "RGB:R", label: "đỏ" }),
  Object.freeze({ id: "green", pin: "D10", resistor: "R_G", led: "RGB:G", label: "xanh lá" }),
  Object.freeze({ id: "blue", pin: "D11", resistor: "R_B", led: "RGB:B", label: "xanh dương" }),
]);

function analyzeLesson5(config, nets) {
  const issues = [];
  addDisconnected(issues, nets, "GND", "GND_DISCONNECTED", "GND");
  for (const channel of RGB_CHANNELS) addDisconnected(issues, nets, channel.pin, `${channel.pin}_DISCONNECTED`, channel.pin);

  const outputs = RGB_CHANNELS.map(channel => channel.pin);
  for (let i = 0; i < outputs.length; i += 1) {
    if (nets.same(outputs[i], "GND") && nets.connected(outputs[i])) {
      issues.push(issue(`SHORT_${outputs[i]}_GND`, "error", `${outputs[i]} đang nối tắt trực tiếp với GND.`, [outputs[i], "GND"]));
    }
    for (let j = i + 1; j < outputs.length; j += 1) {
      if (nets.same(outputs[i], outputs[j]) && nets.connected(outputs[i])) {
        issues.push(issue("OUTPUT_PINS_SHORTED", "error", `${outputs[i]} và ${outputs[j]} đang bị nối chung trực tiếp.`, [outputs[i], outputs[j]]));
      }
    }
  }

  const cathodeGround = nets.same("RGB:K", "GND");
  if (!cathodeGround) {
    issues.push(issue("RGB_CATHODE_GND_MISSING", "warning", "Cathode chung của LED RGB chưa nối về GND.", ["RGB:K", "GND"]));
  }

  for (let i = 0; i < RGB_CHANNELS.length; i += 1) {
    for (let j = i + 1; j < RGB_CHANNELS.length; j += 1) {
      const left = RGB_CHANNELS[i], right = RGB_CHANNELS[j];
      if (nets.same(left.led, right.led) && nets.connected(left.led)) {
        issues.push(issue("RGB_CHANNELS_TIED", "error",
          "Hai kênh LED RGB đang bị nối chung tại chân màu, không thể điều khiển độc lập.",
          [left.led, right.led]));
      }
    }
  }
  const paths = [];
  for (const channel of RGB_CHANNELS) {
    const bridge = resistorBridge(config, nets, channel.resistor, channel.pin, channel.led);
    const bypassed = resistorBypassed(config, nets, channel.resistor);
    const direct = nets.same(channel.pin, channel.led);
    const ledBypassed = nets.same(channel.led, "RGB:K") && nets.connected(channel.led);
    if (bypassed) {
      issues.push(issue(`RGB_${channel.id.toUpperCase()}_RESISTOR_BYPASSED`, "error", `Điện trở kênh ${channel.label} đang bị nối tắt qua.`, config.resistors[channel.resistor]));
    }
    if (direct) {
      issues.push(issue(`RGB_${channel.id.toUpperCase()}_RESISTOR_MISSING`, "error", `Kênh ${channel.label} đang nối ${channel.pin} trực tiếp vào LED RGB; cần điện trở hạn dòng nối tiếp.`, [channel.pin, channel.led]));
    }
    if (ledBypassed) {
      issues.push(issue(`RGB_${channel.id.toUpperCase()}_LED_BYPASSED`, "error",
        `Kênh ${channel.label} của LED RGB đang nối thẳng về cathode/GND nên bị bỏ qua.`,
        [channel.led, "RGB:K", "GND"]));
    }
    if (!bridge && !direct && nets.connected(channel.pin) && nets.connected(channel.led)) {
      issues.push(issue(`RGB_${channel.id.toUpperCase()}_PATH_WRONG`, "warning", `Đường kênh ${channel.label} chưa đi đúng ${channel.pin} → điện trở của kênh → ${channel.led}.`, [channel.pin, ...config.resistors[channel.resistor], channel.led]));
    }
    paths.push(path(`rgb-${channel.id}`, `${channel.pin} → điện trở → kênh ${channel.label} → cathode chung → GND`, bridge && cathodeGround && !bypassed && !direct && !ledBypassed));
  }
  return { issues, paths };
}

function unsupportedResult(lessonId) {
  return {
    lessonId,
    supported: false,
    ok: false,
    functional: false,
    issues: [issue("UNSUPPORTED_LESSON", "info", `Bài ${lessonId} chưa có mô hình netlist tương tác.`)],
    paths: [],
    nets: [],
    stats: {
      wireCount: 0,
      maxWires: CIRCUIT_LIMITS.maxWires,
      terminalCount: 0,
      maxTerminals: CIRCUIT_LIMITS.maxTerminals,
      functionalPathCount: 0,
      maxFunctionalPaths: CIRCUIT_LIMITS.maxFunctionalPaths,
    },
  };
}

export function analyzeCircuit(lessonId, state = undefined) {
  const id = lessonNumber(lessonId);
  const config = CONFIGS[id];
  if (!config) return unsupportedResult(id);
  if (config.terminals.length > CIRCUIT_LIMITS.maxTerminals) throw new RangeError("Cấu hình bài học vượt giới hạn terminal");
  const circuit = state === undefined ? createCircuit(id) : state;
  validateState(circuit, id, config);
  const nets = buildNets(config, circuit.wires);
  const analysis = id === 2 ? analyzeLesson2(config, nets) : id === 3 ? analyzeLesson3(config, nets) : analyzeLesson5(config, nets);
  if (analysis.paths.length > CIRCUIT_LIMITS.maxFunctionalPaths) throw new RangeError("Cấu hình bài học vượt giới hạn functional path");
  const functional = analysis.paths.length > 0 && analysis.paths.every(item => item.complete);
  const allIssues = [
    ...analysis.issues,
    ...boardPinConflicts(config, nets),
    ...unexpectedNetMerges(config, circuit, REFERENCE_WIRES[id]),
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
      maxWires: CIRCUIT_LIMITS.maxWires,
      terminalCount: config.terminals.length,
      maxTerminals: CIRCUIT_LIMITS.maxTerminals,
      functionalPathCount: analysis.paths.length,
      maxFunctionalPaths: CIRCUIT_LIMITS.maxFunctionalPaths,
    },
  };
}

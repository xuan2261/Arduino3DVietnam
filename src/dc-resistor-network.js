/**
 * Bounded deterministic DC linear-resistor network solver.
 *
 * Model scope:
 * - one explicit ground node fixed to 0 V;
 * - zero or more additional ideal fixed-voltage nodes in [0, 5] V;
 * - positive finite ideal resistors only;
 * - no LED/diode, motor, sensor, capacitor, inductor, transistor, Arduino-pin
 *   drive model, source impedance, temperature, tolerance, or hardware claims.
 *
 * The solver is intentionally standalone. It does not consume circuit-router,
 * lesson metadata or breadboard topology automatically.
 */

const ORIGIN = "ideal-dc-resistor-model";
const MAX_NODES = 32;
const MAX_VOLTAGE_NODES = 16;
const MAX_RESISTORS = 64;
const MAX_NODE_ID_LENGTH = 64;
const MAX_RESISTOR_ID_LENGTH = 64;
const MAX_SOURCE_VOLTS = 5;
const PIVOT_RELATIVE_EPSILON = 1e-12;
const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,63}$/;
const RESISTOR_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,63}$/;
const INPUT_KEYS = new Set(["ground", "voltageNodes", "resistors"]);
const VOLTAGE_NODE_KEYS = new Set(["node", "voltageVolts"]);
const RESISTOR_KEYS = new Set(["id", "a", "b", "ohms"]);
const OPTION_KEYS = new Set(["maxCurrentMilliAmps", "maxPowerMilliWatts"]);
const NONLINEAR_FIELDS = new Set([
  "elements",
  "leds",
  "diodes",
  "motors",
  "sensors",
  "capacitors",
  "inductors",
  "transistors",
  "currentSources",
  "arduinoOutputs",
]);

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function issue(code, message, extra = {}) {
  return Object.freeze({
    code,
    severity: "error",
    message,
    ...extra,
  });
}

function round(value, digits = 9) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  const result = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

function boundaries(options = {}) {
  return deepFreeze({
    origin: ORIGIN,
    model: "linear-ideal-dc-resistor-network",
    physicalVerified: false,
    measured: false,
    educationalOnly: true,
    sourceAssumption: "Fixed-voltage nodes are ideal zero-impedance DC sources.",
    groundAssumption: "The declared ground node is exactly 0 V in the mathematical model.",
    resistorAssumption: "Resistors are ideal, linear, time-invariant and temperature-independent.",
    unsupported: Object.freeze([
      "LED/diode/nonlinear devices",
      "motors/servos/sensors",
      "capacitors/inductors/transistors",
      "current sources",
      "Arduino GPIO/source impedance",
      "real breadboard/contact resistance",
      "physical safety or hardware verification",
    ]),
    units: Object.freeze({
      voltage: "V",
      resistance: "ohm",
      current: "mA",
      power: "mW",
    }),
    limits: Object.freeze({
      maxNodes: MAX_NODES,
      maxVoltageNodes: MAX_VOLTAGE_NODES,
      maxResistors: MAX_RESISTORS,
      sourceVoltageMinVolts: 0,
      sourceVoltageMaxVolts: MAX_SOURCE_VOLTS,
      maxNodeIdLength: MAX_NODE_ID_LENGTH,
      maxResistorIdLength: MAX_RESISTOR_ID_LENGTH,
    }),
    configuredGuards: Object.freeze({
      maxCurrentMilliAmps: options.maxCurrentMilliAmps ?? null,
      maxPowerMilliWatts: options.maxPowerMilliWatts ?? null,
    }),
  });
}

function result({ supported, calculated, nodeVoltages = {}, resistorResults = [], issues = [], options = {} }) {
  return deepFreeze({
    supported,
    calculated,
    nodeVoltages,
    resistorResults,
    issues,
    boundaries: boundaries(options),
  });
}

function validateId(value, regex, label) {
  if (typeof value !== "string" || !regex.test(value)) {
    return issue("INVALID_IDENTIFIER", label + " phải là ID ASCII an toàn, không rỗng.");
  }
  return null;
}

function extraKeys(record, allowed) {
  return Object.keys(record).filter(key => !allowed.has(key)).sort();
}

function normalizeOptions(options) {
  if (options === undefined) {
    return { ok: true, value: { maxCurrentMilliAmps: null, maxPowerMilliWatts: null }, issues: [] };
  }
  if (!isRecord(options)) {
    return {
      ok: false,
      value: { maxCurrentMilliAmps: null, maxPowerMilliWatts: null },
      issues: [issue("INVALID_OPTIONS", "options phải là object.")],
    };
  }
  const extras = extraKeys(options, OPTION_KEYS);
  if (extras.length) {
    return {
      ok: false,
      value: { maxCurrentMilliAmps: null, maxPowerMilliWatts: null },
      issues: [issue("UNSUPPORTED_OPTION", "Tùy chọn không được hỗ trợ: " + extras.join(", ") + ".")],
    };
  }
  const value = { maxCurrentMilliAmps: null, maxPowerMilliWatts: null };
  const issues = [];
  for (const key of OPTION_KEYS) {
    const raw = options[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      issues.push(issue(
        "INVALID_BOUND",
        key + " phải là số hữu hạn > 0 khi được cấu hình.",
        { option: key },
      ));
    } else {
      value[key] = raw;
    }
  }
  return { ok: issues.length === 0, value, issues };
}

function normalizeInput(network) {
  if (!isRecord(network)) {
    return {
      supported: false,
      issues: [issue("INVALID_NETWORK", "network phải là object.")],
    };
  }

  const unknown = extraKeys(network, INPUT_KEYS);
  if (unknown.length) {
    const nonlinear = unknown.filter(key => NONLINEAR_FIELDS.has(key));
    return {
      supported: false,
      issues: [issue(
        nonlinear.length ? "UNSUPPORTED_NONLINEAR_ELEMENT" : "UNSUPPORTED_MODEL_FIELD",
        nonlinear.length
          ? "Mô hình chỉ hỗ trợ điện trở tuyến tính; field nonlinear/unsupported: " + nonlinear.join(", ") + "."
          : "Field network không được hỗ trợ: " + unknown.join(", ") + ".",
        { fields: unknown },
      )],
    };
  }

  const issues = [];
  let supported = true;
  const groundProblem = validateId(network.ground, NODE_ID_RE, "ground");
  if (groundProblem) issues.push(groundProblem);
  const ground = groundProblem ? null : network.ground;

  if (!Array.isArray(network.voltageNodes)) {
    issues.push(issue("INVALID_VOLTAGE_NODES", "voltageNodes phải là array."));
  } else if (network.voltageNodes.length > MAX_VOLTAGE_NODES) {
    issues.push(issue(
      "TOO_MANY_VOLTAGE_NODES",
      "voltageNodes vượt giới hạn " + MAX_VOLTAGE_NODES + ".",
    ));
  }

  if (!Array.isArray(network.resistors)) {
    issues.push(issue("INVALID_RESISTORS", "resistors phải là array."));
  } else if (network.resistors.length < 1 || network.resistors.length > MAX_RESISTORS) {
    issues.push(issue(
      "RESISTOR_COUNT_OUT_OF_RANGE",
      "resistors phải có 1.." + MAX_RESISTORS + " branches.",
    ));
  }

  if (issues.length) return { supported: true, issues };

  const fixedVoltages = new Map();
  if (ground !== null) fixedVoltages.set(ground, 0);
  const voltageRows = [];
  for (let index = 0; index < network.voltageNodes.length; index += 1) {
    const row = network.voltageNodes[index];
    if (!isRecord(row)) {
      issues.push(issue("INVALID_VOLTAGE_NODE", "voltageNodes[" + index + "] phải là object."));
      continue;
    }
    const extras = extraKeys(row, VOLTAGE_NODE_KEYS);
    if (extras.length) {
      supported = false;
      issues.push(issue(
        "UNSUPPORTED_VOLTAGE_NODE_FIELD",
        "voltageNodes[" + index + "] có field không hỗ trợ: " + extras.join(", ") + ".",
      ));
      continue;
    }
    const idProblem = validateId(row.node, NODE_ID_RE, "voltageNodes[" + index + "].node");
    if (idProblem) {
      issues.push(idProblem);
      continue;
    }
    if (typeof row.voltageVolts !== "number" || !Number.isFinite(row.voltageVolts)) {
      issues.push(issue(
        "INVALID_FIXED_VOLTAGE",
        "voltageNodes[" + index + "].voltageVolts phải là số hữu hạn.",
        { node: row.node },
      ));
      continue;
    }
    if (row.voltageVolts < 0 || row.voltageVolts > MAX_SOURCE_VOLTS) {
      issues.push(issue(
        "FIXED_VOLTAGE_OUT_OF_RANGE",
        "Fixed voltage phải nằm trong 0.." + MAX_SOURCE_VOLTS + " V.",
        { node: row.node, voltageVolts: row.voltageVolts },
      ));
      continue;
    }
    if (row.node === ground) {
      issues.push(issue(
        row.voltageVolts === 0 ? "DUPLICATE_GROUND_NODE" : "CONTRADICTORY_GROUND_VOLTAGE",
        row.voltageVolts === 0
          ? "ground đã cố định 0 V và không được lặp lại trong voltageNodes."
          : "ground=0 V mâu thuẫn với fixed voltage khác 0 V.",
        { node: row.node, voltageVolts: row.voltageVolts },
      ));
      continue;
    }
    if (fixedVoltages.has(row.node)) {
      const prior = fixedVoltages.get(row.node);
      issues.push(issue(
        prior === row.voltageVolts ? "DUPLICATE_VOLTAGE_NODE" : "CONTRADICTORY_FIXED_VOLTAGE",
        prior === row.voltageVolts
          ? "Fixed-voltage node bị khai báo trùng: " + row.node + "."
          : "Fixed-voltage node có hai điện áp mâu thuẫn: " + row.node + ".",
        { node: row.node, priorVoltageVolts: prior, voltageVolts: row.voltageVolts },
      ));
      continue;
    }
    fixedVoltages.set(row.node, row.voltageVolts);
    voltageRows.push({ node: row.node, voltageVolts: row.voltageVolts });
  }

  const resistorIds = new Set();
  const resistors = [];
  const allNodes = new Set(ground === null ? [] : [ground]);
  for (const row of voltageRows) allNodes.add(row.node);
  for (let index = 0; index < network.resistors.length; index += 1) {
    const row = network.resistors[index];
    if (!isRecord(row)) {
      issues.push(issue("INVALID_RESISTOR", "resistors[" + index + "] phải là object."));
      continue;
    }
    const extras = extraKeys(row, RESISTOR_KEYS);
    if (extras.length) {
      supported = false;
      issues.push(issue(
        "UNSUPPORTED_RESISTOR_FIELD",
        "resistors[" + index + "] có field không hỗ trợ: " + extras.join(", ") + ".",
        { resistorId: typeof row.id === "string" ? row.id : null },
      ));
      continue;
    }
    const idProblem = validateId(row.id, RESISTOR_ID_RE, "resistors[" + index + "].id");
    const aProblem = validateId(row.a, NODE_ID_RE, "resistors[" + index + "].a");
    const bProblem = validateId(row.b, NODE_ID_RE, "resistors[" + index + "].b");
    if (idProblem) issues.push(idProblem);
    if (aProblem) issues.push(aProblem);
    if (bProblem) issues.push(bProblem);
    if (idProblem || aProblem || bProblem) continue;
    if (resistorIds.has(row.id)) {
      issues.push(issue(
        "DUPLICATE_RESISTOR_ID",
        "Resistor ID bị trùng: " + row.id + ".",
        { resistorId: row.id },
      ));
      continue;
    }
    resistorIds.add(row.id);
    if (row.a === row.b) {
      issues.push(issue(
        "SELF_LOOP_RESISTOR",
        "Resistor " + row.id + " nối hai đầu vào cùng một node; branch bị từ chối.",
        { resistorId: row.id, node: row.a },
      ));
      continue;
    }
    if (typeof row.ohms !== "number" || !Number.isFinite(row.ohms) || row.ohms <= 0) {
      issues.push(issue(
        "INVALID_RESISTANCE",
        "Resistor " + row.id + " phải có ohms hữu hạn > 0.",
        { resistorId: row.id },
      ));
      continue;
    }
    const conductance = 1 / row.ohms;
    if (!Number.isFinite(conductance) || conductance <= 0) {
      issues.push(issue(
        "RESISTANCE_NUMERIC_RANGE",
        "Resistor " + row.id + " nằm ngoài miền số ổn định của solver.",
        { resistorId: row.id },
      ));
      continue;
    }
    allNodes.add(row.a);
    allNodes.add(row.b);
    resistors.push({
      id: row.id,
      a: row.a,
      b: row.b,
      ohms: row.ohms,
      conductance,
    });
  }

  if (allNodes.size > MAX_NODES) {
    issues.push(issue(
      "TOO_MANY_NODES",
      "Network có " + allNodes.size + " nodes, vượt giới hạn " + MAX_NODES + ".",
    ));
  }
  if (issues.length) return { supported, issues };

  return {
    supported: true,
    issues: [],
    ground,
    fixedVoltages,
    resistors: resistors.sort((left, right) => (
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    )),
    allNodes: [...allNodes].sort(),
  };
}

function floatingComponents(normalized) {
  const adjacency = new Map(normalized.allNodes.map(node => [node, new Set()]));
  for (const resistor of normalized.resistors) {
    adjacency.get(resistor.a).add(resistor.b);
    adjacency.get(resistor.b).add(resistor.a);
  }
  const visited = new Set();
  const floating = [];
  for (const start of normalized.allNodes) {
    if (visited.has(start)) continue;
    const stack = [start];
    const component = [];
    let anchored = false;
    while (stack.length) {
      const node = stack.pop();
      if (visited.has(node)) continue;
      visited.add(node);
      component.push(node);
      if (normalized.fixedVoltages.has(node)) anchored = true;
      const neighbors = [...adjacency.get(node)].sort().reverse();
      neighbors.forEach(neighbor => {
        if (!visited.has(neighbor)) stack.push(neighbor);
      });
    }
    component.sort();
    if (!anchored && component.length) floating.push(component);
  }
  return floating;
}

function buildLinearSystem(normalized) {
  const unknownNodes = normalized.allNodes.filter(node => !normalized.fixedVoltages.has(node));
  const index = new Map(unknownNodes.map((node, position) => [node, position]));
  const matrix = Array.from(
    { length: unknownNodes.length },
    () => Array(unknownNodes.length).fill(0),
  );
  const rhs = Array(unknownNodes.length).fill(0);

  for (const resistor of normalized.resistors) {
    const g = resistor.conductance;
    const aUnknown = index.get(resistor.a);
    const bUnknown = index.get(resistor.b);
    if (aUnknown !== undefined) {
      matrix[aUnknown][aUnknown] += g;
      if (bUnknown !== undefined) {
        matrix[aUnknown][bUnknown] -= g;
      } else {
        rhs[aUnknown] += g * normalized.fixedVoltages.get(resistor.b);
      }
    }
    if (bUnknown !== undefined) {
      matrix[bUnknown][bUnknown] += g;
      if (aUnknown !== undefined) {
        matrix[bUnknown][aUnknown] -= g;
      } else {
        rhs[bUnknown] += g * normalized.fixedVoltages.get(resistor.a);
      }
    }
  }
  return { unknownNodes, matrix, rhs };
}

function gaussianSolvePartialPivot(matrixInput, rhsInput) {
  const size = rhsInput.length;
  if (size === 0) return { ok: true, values: [] };
  const matrix = matrixInput.map(row => [...row]);
  const rhs = [...rhsInput];
  let globalScale = 0;
  for (const row of matrix) {
    for (const value of row) globalScale = Math.max(globalScale, Math.abs(value));
  }
  if (!Number.isFinite(globalScale) || globalScale === 0) {
    return { ok: false, reason: "zero-conductance matrix" };
  }
  const threshold = globalScale * PIVOT_RELATIVE_EPSILON;

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    let pivotAbs = Math.abs(matrix[column][column]);
    for (let row = column + 1; row < size; row += 1) {
      const candidate = Math.abs(matrix[row][column]);
      if (candidate > pivotAbs) {
        pivotAbs = candidate;
        pivotRow = row;
      }
    }
    if (!Number.isFinite(pivotAbs) || pivotAbs <= threshold) {
      return { ok: false, reason: "singular-or-ill-conditioned pivot at column " + column };
    }
    if (pivotRow !== column) {
      [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];
      [rhs[column], rhs[pivotRow]] = [rhs[pivotRow], rhs[column]];
    }
    const pivot = matrix[column][column];
    for (let row = column + 1; row < size; row += 1) {
      const factor = matrix[row][column] / pivot;
      if (!Number.isFinite(factor)) {
        return { ok: false, reason: "non-finite elimination factor" };
      }
      matrix[row][column] = 0;
      for (let inner = column + 1; inner < size; inner += 1) {
        matrix[row][inner] -= factor * matrix[column][inner];
      }
      rhs[row] -= factor * rhs[column];
    }
  }

  const values = Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let total = rhs[row];
    for (let column = row + 1; column < size; column += 1) {
      total -= matrix[row][column] * values[column];
    }
    const pivot = matrix[row][row];
    if (!Number.isFinite(pivot) || Math.abs(pivot) <= threshold) {
      return { ok: false, reason: "singular back-substitution pivot" };
    }
    values[row] = total / pivot;
    if (!Number.isFinite(values[row])) {
      return { ok: false, reason: "non-finite node voltage" };
    }
  }
  return { ok: true, values };
}

function calculatedResults(normalized, solved) {
  const voltages = new Map(normalized.fixedVoltages);
  solved.unknownNodes.forEach((node, index) => voltages.set(node, solved.values[index]));
  const nodeVoltages = {};
  for (const node of normalized.allNodes) nodeVoltages[node] = round(voltages.get(node));
  const rawResistorResults = normalized.resistors.map(resistor => {
    const voltageDropVolts = voltages.get(resistor.a) - voltages.get(resistor.b);
    const currentMilliAmps = voltageDropVolts / resistor.ohms * 1000;
    const powerMilliWatts = voltageDropVolts * voltageDropVolts / resistor.ohms * 1000;
    return {
      id: resistor.id,
      a: resistor.a,
      b: resistor.b,
      resistanceOhms: resistor.ohms,
      voltageDropVolts,
      currentMilliAmps,
      absoluteCurrentMilliAmps: Math.abs(currentMilliAmps),
      powerMilliWatts,
    };
  });
  const resistorResults = rawResistorResults.map(resistor => {
    return {
      id: resistor.id,
      a: resistor.a,
      b: resistor.b,
      resistanceOhms: resistor.resistanceOhms,
      voltageDropVolts: round(resistor.voltageDropVolts),
      currentMilliAmps: round(resistor.currentMilliAmps),
      absoluteCurrentMilliAmps: round(resistor.absoluteCurrentMilliAmps),
      powerMilliWatts: round(resistor.powerMilliWatts),
      origin: ORIGIN,
      physicalVerified: false,
      measured: false,
    };
  });
  return { nodeVoltages, resistorResults, rawResistorResults };
}

function boundIssues(calculated, options) {
  const issues = [];
  for (const resistor of calculated.rawResistorResults) {
    if (
      options.maxCurrentMilliAmps !== null &&
      resistor.absoluteCurrentMilliAmps > options.maxCurrentMilliAmps
    ) {
      issues.push(issue(
        "CURRENT_BOUND_EXCEEDED",
        "Resistor " + resistor.id + " vượt configured current bound.",
        {
          resistorId: resistor.id,
          observedMilliAmps: round(resistor.absoluteCurrentMilliAmps),
          maxCurrentMilliAmps: options.maxCurrentMilliAmps,
        },
      ));
    }
    if (
      options.maxPowerMilliWatts !== null &&
      resistor.powerMilliWatts > options.maxPowerMilliWatts
    ) {
      issues.push(issue(
        "POWER_BOUND_EXCEEDED",
        "Resistor " + resistor.id + " vượt configured power bound.",
        {
          resistorId: resistor.id,
          observedMilliWatts: round(resistor.powerMilliWatts),
          maxPowerMilliWatts: options.maxPowerMilliWatts,
        },
      ));
    }
  }
  return issues;
}

/**
 * Solve an explicit ideal DC linear-resistor network.
 *
 * Input:
 * - ground: node ID fixed to 0 V;
 * - voltageNodes: [{ node, voltageVolts }] for additional ideal fixed nodes;
 * - resistors: [{ id, a, b, ohms }] using node IDs;
 *
 * Options:
 * - maxCurrentMilliAmps: optional positive branch-current guard;
 * - maxPowerMilliWatts: optional positive branch-power guard.
 */
export function solveResistiveDC(network, options = undefined) {
  const optionState = normalizeOptions(options);
  if (!optionState.ok) {
    return result({
      supported: false,
      calculated: false,
      issues: optionState.issues,
      options: optionState.value,
    });
  }

  const normalized = normalizeInput(network);
  if (normalized.issues.length) {
    return result({
      supported: normalized.supported,
      calculated: false,
      issues: normalized.issues,
      options: optionState.value,
    });
  }

  const floating = floatingComponents(normalized);
  if (floating.length) {
    return result({
      supported: true,
      calculated: false,
      issues: floating.map(nodes => issue(
        "FLOATING_COMPONENT",
        "Connected component không có ground/fixed-voltage reference.",
        { nodes },
      )),
      options: optionState.value,
    });
  }

  const system = buildLinearSystem(normalized);
  const linear = gaussianSolvePartialPivot(system.matrix, system.rhs);
  if (!linear.ok) {
    return result({
      supported: true,
      calculated: false,
      issues: [issue(
        "SINGULAR_OR_ILL_CONDITIONED",
        "Conductance matrix không giải được an toàn: " + linear.reason + ".",
      )],
      options: optionState.value,
    });
  }

  const calculated = calculatedResults(normalized, {
    unknownNodes: system.unknownNodes,
    values: linear.values,
  });
  const guards = boundIssues(calculated, optionState.value);
  if (guards.length) {
    return result({
      supported: true,
      calculated: false,
      issues: guards,
      options: optionState.value,
    });
  }

  return result({
    supported: true,
    calculated: true,
    nodeVoltages: calculated.nodeVoltages,
    resistorResults: calculated.resistorResults,
    issues: [],
    options: optionState.value,
  });
}

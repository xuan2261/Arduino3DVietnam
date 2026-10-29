/**
 * In-session authored terminal -> breadboard-hole study state.
 *
 * The caller supplies the current lesson's canonical terminal vocabulary. This
 * module records only explicit user choices and delegates every hole/profile
 * decision to breadboard-placement. It never reads scene coordinates or writes
 * circuit-router state.
 */
import {
  createBreadboardPlacement,
  validateBreadboardPlacement,
} from "./breadboard-placement.js";
import { groupBreadboardAuthoredPlacement } from "./breadboard-authored-groups.js";

const DEFAULT_PROFILE_ID = "generic-63x10-terminal-strips";

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function normalizeLessonId(lessonId) {
  if (!Number.isInteger(lessonId) || lessonId < 1 || lessonId > 16) {
    throw new RangeError("lessonId authored breadboard phải nằm trong 1..16.");
  }
  return lessonId;
}

function normalizeContext(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Breadboard placement session context phải là object.");
  }
  const lessonId = normalizeLessonId(input.lessonId ?? 1);
  const profileId = input.profileId ?? DEFAULT_PROFILE_ID;
  const terminals = input.terminals ?? [];
  const probe = createBreadboardPlacement({
    profileId,
    terminals,
    terminalToHole: {},
  });
  const validation = validateBreadboardPlacement(probe, terminals);
  if (!validation.ok) {
    throw new RangeError(
      "Terminal/profile context không hợp lệ: " + validation.errors.join("; "),
    );
  }
  return freezeDeep({
    lessonId,
    profileId: probe.profileId,
    enabled: lessonId !== 1,
    terminals: probe.terminals.map(terminal => ({ ...terminal })),
  });
}

function terminalSignature(terminals) {
  return JSON.stringify(terminals.map(terminal => [terminal.id, terminal.component]));
}

function mappingObject(terminals, mapping) {
  const result = Object.create(null);
  for (const terminal of terminals) {
    if (mapping.has(terminal.id)) result[terminal.id] = mapping.get(terminal.id);
  }
  return result;
}

function changeReason(previous, next) {
  if (!previous) return "initial";
  if (previous.lessonId !== next.lessonId) return "lesson";
  if (previous.profileId !== next.profileId) return "profile";
  if (terminalSignature(previous.terminals) !== terminalSignature(next.terminals)) {
    return "terminals";
  }
  return null;
}

export function createBreadboardPlacementSession(initial = {}) {
  let context = null;
  let mapping = new Map();
  let placement = null;
  let revision = 0;

  const buildPlacement = candidate => {
    if (candidate.size === 0) return null;
    const built = createBreadboardPlacement({
      profileId: context.profileId,
      terminals: context.terminals,
      terminalToHole: mappingObject(context.terminals, candidate),
    });
    const validation = validateBreadboardPlacement(built, context.terminals);
    if (!validation.ok) {
      throw new RangeError(
        "Authored breadboard placement bị từ chối: " + validation.errors.join("; "),
      );
    }
    return built;
  };

  const snapshot = () => freezeDeep({
    lessonId: context.lessonId,
    profileId: context.profileId,
    enabled: context.enabled,
    revision,
    terminals: context.terminals.map(terminal => ({ ...terminal })),
    terminalToHole: mappingObject(context.terminals, mapping),
    mapped: mapping.size,
  });

  const sync = nextInput => {
    const next = normalizeContext(nextInput);
    const reason = changeReason(context, next);
    const reset = Boolean(context && reason);
    context = next;
    if (reset) {
      mapping = new Map();
      placement = null;
      revision += 1;
    }
    return freezeDeep({ reset, reason, state: snapshot() });
  };

  const assertEnabledTerminal = terminalId => {
    if (!context.enabled) {
      throw new RangeError("Bài 01 dùng phần cứng tích hợp; authored breadboard placement bị vô hiệu.");
    }
    if (typeof terminalId !== "string" || !terminalId.trim()) {
      throw new TypeError("terminalId phải là chuỗi không rỗng.");
    }
    const canonical = terminalId.trim();
    if (!context.terminals.some(terminal => terminal.id === canonical)) {
      throw new RangeError("Terminal không thuộc bài học hiện tại: " + canonical);
    }
    return canonical;
  };

  const assign = (terminalId, holeId) => {
    const canonicalTerminal = assertEnabledTerminal(terminalId);
    const candidate = new Map(mapping);
    candidate.set(canonicalTerminal, holeId);
    const built = buildPlacement(candidate);
    mapping = new Map(
      built.terminals
        .filter(terminal => Object.hasOwn(built.terminalToHole, terminal.id))
        .map(terminal => [terminal.id, built.terminalToHole[terminal.id]]),
    );
    placement = built;
    revision += 1;
    return placement;
  };

  const remove = terminalId => {
    const canonicalTerminal = assertEnabledTerminal(terminalId);
    if (!mapping.has(canonicalTerminal)) {
      return freezeDeep({ removed: false, placement, state: snapshot() });
    }
    const candidate = new Map(mapping);
    candidate.delete(canonicalTerminal);
    const built = buildPlacement(candidate);
    mapping = candidate;
    placement = built;
    revision += 1;
    return freezeDeep({ removed: true, placement, state: snapshot() });
  };

  const reset = () => {
    const changed = mapping.size > 0 || placement !== null;
    mapping = new Map();
    placement = null;
    if (changed) revision += 1;
    return snapshot();
  };

  sync({
    lessonId: initial.lessonId ?? 1,
    terminals: initial.terminals ?? [],
    profileId: initial.profileId ?? DEFAULT_PROFILE_ID,
  });

  return Object.freeze({
    sync,
    assign,
    remove,
    reset,
    snapshot,
    getPlacement: () => placement,
    getAuthoredGroups: () => placement
      ? groupBreadboardAuthoredPlacement(placement, context.terminals)
      : null,
  });
}

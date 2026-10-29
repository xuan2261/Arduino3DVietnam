# Lab Explorer v1.6 — Inspector + Schematic + Plan View

Lab Explorer là bề mặt UX phối hợp ba góc nhìn trên **cùng state canonical** của phòng thực hành:

1. **Inspector** — component đang chọn, thuộc tính logical layout, terminal canonical và issue topology liên quan.
2. **Schematic 2D** — SVG khái niệm của **bản tự đấu người học** từ `circuit-router` + `listTerminals()`; không sở hữu graph điện riêng.
3. **Plan view minimap** — bản đồ X/Z logic của `lab-layout`, selection/focus và terminal anchor khái niệm.

Explorer không tính điện, không quyết định topology đúng/sai, không tạo rail/lỗ breadboard và không trực tiếp sửa circuit/layout/scene. Mọi mutation được callback về controller hiện hữu.

## 1. API mount

```js
import { mountLabExplorer } from "./src/lab-explorer-ui.js";

const explorer = mountLabExplorer(host, {
  getSnapshot,
  onSelectComponent,
  onSelectTerminal,
  onConnect,
  onDisconnect,
  onFocus,
});

explorer.update();          // đọc getSnapshot()
explorer.update(snapshot);  // hoặc render snapshot explicit
explorer.dispose();
```

Contract:

- `getSnapshot` bắt buộc và phải là function.
- Các callback còn lại tùy chọn; nếu có phải là function.
- `update()` chỉ đọc snapshot và render. Nó **không** tự gọi lại `update()` sau callback, vì prime/app là owner của vòng cập nhật state.
- `dispose()` gỡ listeners và root Explorer; không dispose scene/lab editor/circuit.

### Callback semantics

| Callback | Ý nghĩa | Owner thực tế |
| --- | --- | --- |
| `onSelectComponent(componentId)` | Chọn component canonical | prime → `labEditorUI.selectComponent()` |
| `onSelectTerminal(terminalId)` | Chọn terminal exact ID | prime → `labEditorUI.selectTerminal()` |
| `onConnect(from, to)` | Yêu cầu nối hai terminal | prime/lab editor → `circuit-router` |
| `onDisconnect(wireId)` | Yêu cầu gỡ **learner wire** theo ID | prime → canonical disconnect path |
| `onFocus(componentId)` | Tập trung camera đọc-only | prime → `scene.focusLabComponent()` |

Explorer không import `connectCircuit`, `disconnectCircuit`, `moveLabComponent`, `rotateLabComponent` hay `scene3d`.

## 2. Snapshot input

Prime cung cấp dạng:

```js
{
  lessonId,
  lesson,
  stage,
  editing,
  selectedComponentId,
  selectedTerminalId,   // exact firstTerminal từ lab editor, hoặc null
  layout,
  circuit,             // learner circuit: rỗng cho đến khi learner sửa
  referenceCircuit,    // teaching sample / displayed reference
  hasLearnerDraft,
  analysis,            // analysis của learner circuit
  referenceAnalysis,
  source: "learner-empty" | "learner-draft",
  evidence: {
    origin: "learner-empty" | "learner-draft",
    reference: "reference-sample",
    physicalVerified: false,
  },
  sceneView,           // optional scene.getLabViewState()
  claims,
}
```

Lesson 01 dùng:

```js
{
  lessonId: 1,
  layout: null,
  circuit: null,
  analysis: null,
}
```

và Explorer hiển thị explicit state “không có external netlist”. Không tạo wiring controls giả cho bài 01.

## 3. Pure model

`src/lab-explorer.js` export:

```js
createLabExplorerModel(snapshot)
explorerTerminalPosition(model, terminalId, surface = "minimap")
LAB_EXPLORER_LIMITS
```

Model trả object frozen:

```js
{
  schemaVersion: 1,
  lessonId,
  lessonTitle,
  supported,
  stage,
  editing,
  source,
  scope,
  inspector,
  schematic,
  minimap,
  reference,
  boundaries,
}
```

### Hard limits

- lesson: 01..16;
- terminal: tối đa 32;
- wire: tối đa 48;
- component: tối đa 20;
- issue: tối đa 96.

Input sai lesson, terminal lạ trong wire, duplicate wire endpoint/ID, layout mismatch hoặc claim `physicalVerified=true` đều fail closed.

## 4. Inspector

Inspector đọc selection từ `selectedComponentId` rồi đối chiếu `layout.components` và exact `listTerminals(lessonId)`.

Nó hiển thị:

- canonical component ID;
- label + `visualKind`;
- logical X/Z;
- `quarterTurns`;
- logical footprint;
- fixed/movable;
- `anchorModel`;
- terminal exact IDs, kind, polarity;
- issue severity liên quan terminal/component;
- source label `learner-empty` / `learner-draft`.

Không gọi X/Z là mm, không gọi anchor là chân package thật và không suy phần cứng đã đúng.

## 5. Schematic learner và reference overlay

### Learner schematic là authority hiển thị chính

Schematic SVG được dựng từ:

```text
listTerminals(lessonId)
snapshot.circuit.wires
snapshot.analysis
```

Nó không dựng một graph điện mới có state riêng. Endpoint dùng exact terminal IDs của circuit-router. Wire chỉ là projection read-only; connect/delete phải callback về controller canonical.

Quan trọng: khi lesson chưa được learner sửa:

```text
source = learner-empty
schematic.wires = []
```

dù `referenceCircuit` có đầy đủ mạch mẫu. Vì vậy mạch mẫu không thể biến thành false-green “learner đã hoàn thành”.

### Reference overlay

Nếu có `referenceCircuit`, UI cung cấp nút **“Xem mạch mẫu tham khảo”**. Overlay:

- mặc định **tắt**;
- line nét đứt;
- ghi rõ **“mạch mẫu tham khảo (không phải bản tự đấu)”**;
- không có `onDisconnect`;
- không đi vào learner issue/checker;
- không đổi `data-explorer-source` khỏi learner source;
- không bao giờ được dùng để activation/completion.

Reference overlay chỉ giúp người mới so sánh visual.

### Lesson 10/14

Nếu `analysis.scope === "signal-only"`, Explorer giữ marker `signal-only` và cảnh báo rằng chỉ đường tín hiệu/GND được mô hình; nguồn công suất và tải motor/bơm chưa được xác nhận.

Không gọi reference sample của 10/14 là functional circuit.

## 6. Accessible HTML equivalent

SVG không phải nguồn thông tin duy nhất.

Schematic luôn có HTML equivalent:

- danh sách learner wires;
- nút gỡ chỉ với learner wire editable;
- danh sách reference wires riêng khi overlay bật;
- issue list dạng text;
- connector `<select>` + button dùng exact terminal IDs.

Terminal/component SVG nodes có `role="button"`, `tabindex="0"`, accessible name và nhận Enter/Space.

## 7. Plan view minimap

Minimap lấy duy nhất:

```text
layout.bounds
layout.components
labTerminalAnchor(layout, terminalId)
sceneView.focusedComponentId (nếu có)
selectedComponentId
```

Nó chuyển X/Z logic về viewBox `100 × 70` để render overview. Component footprint được xoay width/depth theo `quarterTurns`.

Interaction:

- component minimap: `onSelectComponent(id)`;
- cùng activation đó có thể gọi `onFocus(id)` để prime forward tới `scene.focusLabComponent(id)`;
- terminal marker: `onSelectTerminal(exactId)`;
- HTML equivalent liệt kê component + logical X/Z + nút focus riêng.

`scene.focusLabComponent()` là camera/read-only action; không tự thay netlist hay selection state trong Explorer model.

Minimap không biểu diễn:

- rail breadboard;
- hole row/column;
- đường dòng điện;
- kích thước cơ khí;
- khoảng cách thật;
- physical safety.

## 8. Stable QA selectors

```text
[data-lab-explorer]
[data-explorer-panel="inspector"]
[data-explorer-panel="schematic"]
[data-explorer-panel="minimap"]
[data-explorer-source="learner-empty|learner-draft|none"]
[data-explorer-scope="topology|signal-only|none"]
[data-explorer-component="<canonical-id>"]
[data-explorer-terminal="<exact-terminal-id>"]
[data-explorer-wire="wN"]
[data-explorer-disconnect="wN"]
[data-explorer-connect-from]
[data-explorer-connect-to]
[data-explorer-connect]
[data-explorer-focus="<component-id>"]
[data-explorer-reference-toggle]
[data-explorer-reference-view="on|off"]
[data-explorer-reference-wire="wN"]
[data-explorer-empty="lesson-01"]
```

## 9. Circular-update guard

Explorer không tự refresh sau các callback. Flow đúng:

```text
Explorer interaction
  -> prime/lab-editor/circuit-router/scene callback
  -> canonical state thay đổi
  -> prime gọi explorer.update()
  -> Explorer dựng model mới
```

Reference toggle là **local presentation-only state**, không chạm app state và có thể rerender ngay trong Explorer.

## 10. Contract coverage

`tests/lab-explorer-contracts.js` bao phủ:

- lesson 01 explicit no-netlist;
- lesson 02..16 learner-empty tách reference sample;
- exact terminal IDs trên schematic + minimap;
- learner draft là graph duy nhất có delete;
- reference overlay luôn read-only;
- 10/14 signal-only;
- inspector canonical LM35/terminal order;
- selection + focused component trên minimap;
- cross-lesson/physical-claim/unknown-terminal negative cases;
- DOM three-surface selectors;
- reference toggle mặc định off;
- Enter/Space keyboard delegation;
- connect callback;
- learner-only disconnect callback;
- dispose cleanup.

Browser contract chỉ được chạy khi prime cấp slot, để tránh tranh chấp Chrome với worker khác trong shared workspace.
## Follow-up P1 semantics
Explorer nhận selectedTerminalId từ snapshot canonical của lab editor (firstTerminal). Pure model kiểm tra ID phải thuộc exact listTerminals(lessonId); ID lạ fail closed. Selection được phản chiếu sang schematic, minimap, inspector, visible status và aria-pressed.
Root SVG schematic/minimap dùng role="group" để descendant role="button"/tabindex="0" không bị flatten. Schematic có HTML exact-terminal actions riêng nên SVG không phải đường duy nhất để chọn terminal.
Reference overlay là presentation-only state nhưng luôn reset OFF khi lessonId thay đổi, kể cả lesson mới cũng có reference sample.
Focus camera chỉ được expose khi editing=true. Ngoài edit mode, focus-only controls bị disabled, minimap SVG không mang data-explorer-focus, và UI giải thích selection/inspection vẫn hoạt động mà không đổi netlist.
Follow-up contracts thêm pure/DOM regressions cho selected-terminal propagation + foreign-ID rejection, SVG role group, aria-pressed + HTML terminal equivalent, lesson-switch reference reset và focus gate. 26 contract baseline vẫn được giữ nguyên.
Follow-up candidate có 31 contract khi tính các loop lesson hiện có. Turn follow-up này chỉ chạy static/diff checks theo yêu cầu; worker3 sẽ là browser authority cho contract + integrated E2E.

### Kết quả v1.6 candidate ngày 29/10/2026

- `tests/lab-explorer-contracts.js`: **26/26 PASS** trong Chrome thật.
- Mount tích hợp của prime: lesson 01 có đủ ba panel và marker `lesson-01`; lesson 02 bắt đầu với `source=learner-empty`, **0 learner wire**, reference toggle có mặt, connect bị disable khi chưa vào edit mode.
- Khi bật reference overlay ở lesson 02: hiển thị **6 reference wire**, learner wire vẫn **0**, không xuất hiện nút disconnect và source vẫn `learner-empty`.
- Browser console sau contract + mounted smoke: **0 error / 0 warning**.
- Tab và local server được đóng ngay sau lượt kiểm để trả Chrome slot cho worker khác.

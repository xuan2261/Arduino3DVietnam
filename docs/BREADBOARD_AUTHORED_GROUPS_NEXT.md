# Breadboard authored groups — nhóm tiếp xúc từ placement tường minh

Phase này thêm một lớp **read-only educational projection** trên authored placement đã có.
Nó không tạo placement mới và không thay đổi semantics của hole picker.

Nguồn dữ liệu duy nhất của projection là một `breadboard-placement-v2` đã qua
`validateBreadboardPlacement()` trong session hiện tại.

## Pure API

Module mới:

```js
import {
  groupBreadboardAuthoredPlacement,
} from "../src/breadboard-authored-groups.js";

const grouped = groupBreadboardAuthoredPlacement(placement, terminals);
```

Session API additive:

```js
session.getAuthoredGroups();
```

UI API additive:

```js
breadboardUI.getAuthoredGroups();
```

Khi chưa có authored placement, hai API session/UI trả `null`.

## Result model

Top-level model:

```text
schemaVersion: 1
model: "explicit-session-authored-contact-groups-v1"
profileId
placementModel
mappedTerminalCount
groupCount
knownGroupCount
unknownGroupCount
groups[]
claims
```

Mỗi group chứa:

```text
order
status: "known" | "unknown"
nodeId
nodeKind
label
region
terminalIds[]
holeIds[]
members[]
placements[]
provenance
evidence
```

`placements[]` chỉ sao chép ba field cần cho projection:

```text
terminalId
component
holeId
```

Không có tọa độ scene/CAD, voltage, current, wire graph hay simulation state trong model này.

## Terminal strips A–E / F–J

Với terminal strip đã được profile chứng minh:

- `A12` và `E12` cùng node `strip:12:left`;
- label: `Cột 12 · dải A–E`;
- members: `A12, B12, C12, D12, E12`.

Tương tự:

- `F12` đến `J12` thuộc `strip:12:right`;
- label: `Cột 12 · dải F–J`.

Khe giữa E/F luôn tách hai group. Hai hole cùng số cột nhưng khác phía khe giữa không bị merge.

Đây chỉ là quan hệ **internal contact node của selected profile**. Placement vẫn là
khai báo của người dùng trong phiên; model không chứng minh terminal thực tế đã cắm,
không chứng minh mechanical fit và không suy circuit-router wire.

## BB830 signed rails

Profile `busboard-bb830-rev7` giữ đúng bốn rail đã được model hiện tại xác nhận:

```text
P1+
P1-
P2+
P2-
```

Mỗi rail là một node độc lập 50 hole trong **profile BB830 cụ thể**:

```text
rail:P1+
rail:P1-
rail:P2+
rail:P2-
```

Ví dụ `P1+1` và `P1+50` được group cùng `rail:P1+`; `P1-1` vẫn là group khác.
Dấu `+/-` là signed rail label; projection không suy rằng rail đang được cấp điện.

Nguồn profile giữ nguyên từ topology hiện có:

- BusBoard BB830 product page: `https://www.busboard.com/BB830`;
- BusBoard BB830 Rev 7 datasheet: `https://www.busboard.com/documents/datasheets/BPS-DAT-%28BB830%29-Datasheet.pdf`;
- BusBoard SB830 matching-pattern page cho terminal-field/pitch boundary;
- Digilent breadboard documentation cho common 5-point terminal group.

### Không thêm split-rail profile suy đoán

Phase này **không** thêm bất kỳ profile split-rail nào dựa trên FAQ chung hoặc pattern của
một sản phẩm khác. Một số breadboard trên thị trường có rail split, nhưng nếu chưa có
SKU/profile cụ thể và nguồn nhà sản xuất xác nhận đúng topology đó thì không được model
thành `known`.

Generic profile tiếp tục dùng:

```text
railModel: "unknown-unmodeled"
```

Do authored placement validator đã fail-closed generic rail, mapping như `P1+1` trên
generic profile bị từ chối **trước** khi có thể xuất hiện trong authored-group projection.
`status:"unknown"` vẫn tồn tại trong result contract như display boundary fail-closed cho
profile schema tương lai; nó không phải đường vòng để chấp nhận generic rail hiện nay.

## Security / forged mapping boundary

`groupBreadboardAuthoredPlacement()` không tin object có shape gần giống placement.

Trước khi group, module:

1. gọi `validateBreadboardPlacement()` với terminal set được xác nhận;
2. yêu cầu `terminalToHole` là plain/null-prototype object, không custom prototype;
3. từ chối symbol key và non-enumerable mapping key;
4. từ chối terminal IDs mang tên prototype như `constructor`, `toString`, `__proto__`;
5. yêu cầu mỗi placement record có terminal mapping own-property tương ứng;
6. từ chối duplicate terminal/hole;
7. re-inspect từng hole theo selected profile và yêu cầu `nodeId` khớp record đã validate.

Mọi output được deep-freeze.

## Claims bắt buộc fail-closed

```text
explicitSessionPlacementOnly = true
profileInternalGroupingOnly = true
automaticHoleMapping = false
automaticWireCreation = false
circuitRouterMutated = false
sceneCoordinateMapped = false
physicalPlacementVerified = false
mechanicalFitVerified = false
voltageInferred = false
currentInferred = false
electricalSafetyVerified = false
```

Hai terminal cùng authored group không được dùng để khẳng định một mạch thật đã hoạt động,
đã an toàn, đã có điện áp/dòng hay người học đã hoàn thành thao tác vật lý.

## DOM projection bên dưới `#bbPlacedList`

Không thêm HTML control mới. `breadboard-topology-ui.js` append projection sau danh sách
terminal→hole hiện hữu.

Root:

```text
[data-bb-authored-groups]
role="region"
data-profile
data-group-count
```

Boundary note:

```text
[data-bb-authored-groups-boundary]
```

Group row:

```text
[data-bb-authored-group="N"]
data-bb-authored-group-status="known|unknown"
data-bb-authored-group-node="..."
data-bb-authored-group-kind="terminal-strip|power-rail|unknown"
data-bb-authored-group-region="A-E|F-J|P1+|P1-|P2+|P2-|unknown"
data-bb-authored-group-terminal-count="N"
tabindex="0"
```

Nội dung con:

```text
[data-bb-authored-group-label]
[data-bb-authored-group-status-label]
[data-bb-authored-group-mappings]
[data-bb-authored-group-members]
[data-bb-authored-group-provenance]
```

Rows focusable bằng keyboard để đọc nội dung dài qua assistive technology, nhưng **không có
button và không có keyboard/click mutation handler**. Tất cả dynamic text dùng `textContent`.

## Reset lifecycle

Projection không có storage riêng.

- lesson change → placement session reset → `getAuthoredGroups() === null`;
- profile change → placement session reset → groups bị xóa;
- terminal vocabulary change → placement reset → groups bị xóa;
- remove mapping → projection được derive lại từ placement còn lại;
- duplicate/invalid assign thất bại → projection hợp lệ trước đó được giữ nguyên;
- bad lesson context → placement fail-closed → không còn stale groups.

## Contract coverage

`tests/breadboard-authored-groups-contracts.js` kiểm:

- A–E và F–J five-hole grouping;
- center-gap/different-column separation;
- BB830 same-rail endpoints và bốn signed rail độc lập;
- generic rail bị từ chối trước projection;
- deep-freeze và negative claims;
- null/forged placement;
- prototype terminal IDs, custom mapping prototype, symbol key;
- duplicate hole, forged node ID, foreign terminal, mismatched terminal set;
- selected-profile provenance.

`tests/breadboard-placement-session-contracts.js` bổ sung additive checks cho:

- `getAuthoredGroups()`;
- lesson/profile reset;
- BB830 signed rail separation;
- DOM region/group hooks, tabindex và no-action semantics;
- duplicate assignment không làm hỏng group projection trước đó.

`tests/breadboard-hole-grid-contracts.js` giữ nguyên toàn bộ picker/contact-explorer contracts;
authored grouping không thay đổi selection/assignment gate của picker.

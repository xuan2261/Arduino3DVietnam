# Breadboard hole picker — chọn lỗ canonical trước khi gán

Phase này bổ sung một bộ chọn lỗ trực quan cho **authored terminal-to-hole study**. Bộ chọn chỉ giúp người học điền một hole ID canonical vào `#bbPlaceHole`; nó không tạo placement, không thêm wire vào `circuit-router`, không mô phỏng tiếp xúc vật lý và không suy tọa độ từ scene 3D.

## Ranh giới hành vi

Luồng thao tác cố ý có hai bước tách biệt:

1. Người dùng chọn một lỗ trong grid hoặc rail picker. UI chỉ cập nhật `#bbPlaceHole` và status.
2. Người dùng phải bấm **Gán lỗ trong bản nháp** (`#bbAssignHole`). Chỉ lúc này authored-placement session mới gọi `createBreadboardPlacement()` / `validateBreadboardPlacement()` để tạo state placement.

Do đó một click vào hole picker không mang nghĩa “đã cắm chân”, “đã nối điện”, “đã tiếp xúc vật lý” hay “đã nối dây”. `circuit-router` vẫn là nguồn sự thật duy nhất cho netlist bài học.

## Model `src/breadboard-hole-grid.js`

Module picker chỉ biểu diễn identity của hole/profile. Không có `x/y/z`, transform, mm-coordinate, CAD origin hoặc scene coordinate.

### Terminal-strip grid

~~~js
createBreadboardHoleGridPage({
  profileId: "generic-63x10-terminal-strips",
  page: 1,
});
~~~

Contract:

- hàng canonical: `A` đến `J`;
- cột canonical: `1` đến `63`;
- mỗi trang tối đa **8 cột số**;
- trang 1 = cột 1–8, trang 2 = 9–16, ..., trang 8 = 57–63;
- tối đa 80 hole buttons trên một trang; trang cuối có 70;
- hole ID luôn dạng `A1` ... `J63`;
- page phải là integer trong 1..8; string/fraction/out-of-range bị từ chối.

`pickBreadboardGridHole({profileId,page,holeId})` chỉ chấp nhận một terminal-strip hole nằm trong **đúng trang đang hiển thị**. Kết quả mang `inputValueOnly:true`, `placementCreated:false`, `circuitRouterMutated:false`, `physicalContactSimulated:false`.

### Contact-group explorer

Picker nay có thêm hai API thuần chỉ đọc:

~~~js
inspectBreadboardContactGroup({ profileId, holeId });
compareBreadboardContactHoles({ profileId, firstHoleId, secondHoleId });
~~~

`inspectBreadboardContactGroup()` trả `status`, `profileId/profileLabel`, `nodeId/nodeKind`, `members`, `neighbors`, `contactRegion`, `provenance`, `evidence` và các claim fail-closed. Với terminal strip, node chỉ có đúng năm hole cùng cột và cùng phía rãnh giữa: A–E hoặc F–J. Với generic rail, kết quả là `unknown`, `nodeId:null`, `members:[]`, không bịa rail topology. Với BB830, một signed rail là một internal node 50 hole riêng biệt; bốn signed rail không bị suy nối với nhau.

`compareBreadboardContactHoles()` chỉ so sánh **internal node của selected profile** và trả `same-node`, `different-node` hoặc `unknown`. Nó luôn giữ `externalWireInspected:false`, `circuitRouterInspected:false`, `physicalContactSimulated:false`.

UI giữ `contactInspection` tách khỏi authored placement. `getContactInspection()` chỉ trả snapshot inspection hiện tại; nó không ghi progress/netlist/scene.

## Rail picker BB830

`listBreadboardRailChoices(profileId)` giữ fail-closed boundary hiện có:

- profile generic: `enabled:false`, không cung cấp rail option và không suy split/continuous;
- `busboard-bb830-rev7`: đúng bốn rail `P1+`, `P1-`, `P2+`, `P2-`;
- mỗi rail có 50 hole và được mô hình hóa như một internal profile node liên tục từ 1 đến 50;
- dấu `+/-` là signed rail label trong schema, không phải bằng chứng rail đang có điện;
- bốn rail không bị suy là nối với nhau.

Nguồn bằng chứng giữ nguyên từ `BREADBOARD_PHYSICAL_MAPPING_NEXT.md`:

- BusBoard BB830 product page: https://www.busboard.com/BB830
- BusBoard BB830 Rev 7 datasheet: https://www.busboard.com/documents/datasheets/BPS-DAT-%28BB830%29-Datasheet.pdf
- BusBoard FAQ, power rails không split: https://www.busboard.com/faq/power-rail-split

Product page + Rev 7 datasheet xác nhận bốn power rails 50 tie points; FAQ xác nhận power rails của breadboard BusBoard không split ở giữa. Claim này chỉ áp dụng profile BB830 đã chọn, không lan sang breadboard generic.

`pickBreadboardRailHole({profileId,railId,index})` chỉ nhận rail ID thuộc allowlist trên và index integer canonical 1..50. Các dạng `0`, `51`, `2.5`, `01`, `1e1`, rail thiếu dấu hoặc rail lạ đều bị từ chối.

## Wiring UI

Prime cung cấp các control HTML/CSS sau; `breadboard-topology-ui.js` chỉ wire hành vi:

- `#bbHoleGrid`
- `#bbGridPrev`
- `#bbGridNext`
- `#bbGridPage`
- `#bbGridRail`
- `#bbGridRailHole`
- `#bbPickRail`
- `#bbGridStatus`

### Grid terminal-strip

Grid dùng 8 numeric columns theo CSS của owning surface. Trước hàng A có một **header row số cột**: mỗi cột thật là `span` text, mang `data-bb-grid-column="N"`, không phải button/hole và không có mutation handler. Trang 1 hiển thị 1..8, trang 2 hiển thị 9..16; trang cuối chỉ có heading thật 57..63 và một `aria-hidden` placeholder không tương tác để vẫn đủ tám grid cells mà không bịa cột 64.

Sau header row, DOM được render theo hàng để trang 1 có `A1..A8`, rồi `B1..B8` ... `J1..J8`; giữa E và F có một separator/trench marker span toàn grid. Mỗi hole là `<button type="button">` native với:

- text và accessible label chứa đúng hole ID;
- `min-width:44px`, `min-height:44px` ở JS safety layer; CSS owning surface tiếp tục chịu trách nhiệm layout responsive;
- không custom `tabindex`, không custom Arrow-key emulation; keyboard activation dùng semantics native của button;
- `aria-pressed` chỉ phản ánh hole ID hiện nằm trong `#bbPlaceHole`;
- click chỉ set `#bbPlaceHole`, clear `aria-invalid` của input và phát status “chưa tạo placement”.

Khi chọn một terminal-strip hole, explorer đánh dấu đúng năm button cùng node bằng `data-bb-contact-member="true"`; hole được chọn có thêm `data-bb-contact-selected="true"`. Mỗi button luôn có `data-bb-contact-side="left|right"`, còn separator có `data-bb-contact-boundary="center-gap"`. JS tăng `border-width` cho các member và underline hole đang chọn để visualization vẫn có ý nghĩa ngay cả trước khi prime bổ sung style riêng; kích thước tối thiểu 44px không đổi. Accessible label của member nói rõ cùng node profile và vẫn nhắc “chưa tạo placement”.

`#bbHoleGrid` công bố `data-bb-contact-state`, `data-bb-contact-profile`, `data-bb-contact-hole`, `data-bb-contact-node`, `data-bb-contact-kind`. `#bbGridStatus` là live region chứa node ID, profile ID, provenance scope/source authority, danh sách neighbor hoặc phạm vi rail, và kết quả so sánh read-only với giá trị hiện tại của `#bbHoleA/#bbHoleB` qua `data-bb-contact-compare-a/b`. Input compare sai chỉ cho `invalid-input`; explorer không sửa hai input và không chạy authored assignment.

`#bbHoleGrid` bị giới hạn `max-width:100%` ở JS safety layer. Owning CSS đặt grid `min-width` theo tám touch-target columns và bọc nó trong `.breadboard-hole-grid-scroller { overflow-x:auto; max-width:100% }`, nên viewport hẹp cuộn **bên trong panel** thay vì làm document/page rộng ra.

### Pagination

`Prev/Next` chỉ chuyển state trang picker. Không có hole nào ngoài 1..63 được tạo. Ở trang 1 `Prev` disabled; ở trang 8 `Next` disabled. Page label công bố cả khoảng cột và số trang.

### Rail controls

Với profile generic, rail select/index/button đều disabled và status không cho phép suy topology rail.

Với BB830, select được build lại từ đúng bốn rail canonical. Chọn rail + index rồi bấm `#bbPickRail` chỉ điền hole như `P2-50` vào `#bbPlaceHole`; vẫn cần `#bbAssignHole` để tạo placement.

## Reset và fail-closed lifecycle

- đổi lesson: authored placement session reset như trước; picker về trang 1 và transient hole input về giá trị mặc định;
- đổi profile: authored placement reset; picker về trang 1; rail picker rebuild theo profile mới;
- đổi trang picker xóa contact inspection/highlight để không giữ highlight cho một node không còn nhìn thấy, nhưng giữ nguyên `#bbPlaceHole` theo contract picker cũ;
- sửa `#bbPlaceHole` thủ công xóa contact inspection/highlight stale; muốn xem group phải chọn lại một hole canonical từ picker;
- bài 01: grid có thể hiển thị vocabulary tham khảo nhưng tất cả hole buttons/navigation/rail controls bị disabled vì không có external breadboard placement;
- invalid profile hoặc callback context không hợp lệ: grid bị clear, navigation/rail controls disabled, status `error`, không giữ stale placement;
- partial HTML picker (chỉ có một số ID bắt buộc): mount fail-fast để không tạo UI nửa hoạt động;
- `dispose()` tháo listener của navigation, rail picker và tất cả generated hole buttons.

## Không thay đổi các contract cũ

Phase này không thay đổi:

- compare A1/E1 = same internal group;
- compare A1/F1 = separate groups qua center gap;
- generic rail pair = `unknown`;
- authored placement collision validation;
- lesson/profile authored-session reset;
- `getAuthoredPlacement()` semantics;
- circuit-router/netlist authority;
- scene 3D vẫn không phải physical-hole map.

## QA contract

`tests/breadboard-hole-grid-contracts.js` bao phủ model và fake-DOM integration, gồm:

- trang đầu/cuối, bounded DOM count và page boundaries;
- không có CAD/scene coordinate fields;
- generic rail disabled, BB830 exact four signed rails × 50;
- invalid profile/page/hole/off-page selection;
- invalid rail name/index, fraction/scientific/leading-zero input;
- native buttons, minimum 44px, scoped overflow và live status;
- picker click chỉ fill input, explicit assign mới tạo placement;
- contact-group model A–E/F–J, center-gap separation, neighbor/provenance output và safe compare;
- highlight đúng năm member trên cả tám trang, BB830 rail 50-hole independent status, generic rail unknown;
- manual input/page/lesson/profile reset contact inspection mà không làm thay đổi authored placement;
- pagination, lesson/profile reset, lesson01 disable;
- invalid profile/partial DOM fail closed;
- dispose listener cleanup.

Contract `tests/breadboard-placement-session-contracts.js` vẫn giữ toàn bộ 22 authored-session checks trước phase này.

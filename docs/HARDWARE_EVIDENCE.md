# Review evidence phần cứng — Arduino3DVietnam

`scripts/validate_hardware_evidence.py` review một tệp JSON local do educator thu thập thủ công cho 16 bài Arduino3DVietnam. Công cụ chỉ đọc JSON và kiểm tra evidence đã ghi; nó không kết nối Arduino, USB/serial, compiler, uploader, firmware flasher, trình duyệt, mạng hoặc dịch vụ ngoài.

Kết quả `consistent` chỉ có nghĩa là evidence đáp ứng schema, có đủ 16 bài, các timestamp/provenance bắt buộc nhất quán, và mọi cặp `EXPECTED`/`OBSERVED` đã khai báo đều so sánh được và khớp. Kết quả này không chứng nhận mạch điện, nguồn, dòng, nhiệt, cơ khí, phần cứng hay Sketch là an toàn. Trường `collector_role: "qualified_educator"` là metadata do người tạo file tự khai; script không thể xác minh danh tính hoặc năng lực của người thu thập evidence.

## Chạy offline

```powershell
python scripts/validate_hardware_evidence.py --verify C:\path\to\hardware-evidence.json
python scripts/validate_hardware_evidence.py --verify C:\path\to\hardware-evidence.json --json
```

Mã thoát:

- `0`: evidence hợp schema, đủ 16 bài và không có issue.
- `1`: JSON hợp schema nhưng review phát hiện evidence thiếu, trùng, sai tên bài, timestamp không nhất quán, thiếu EXPECTED/OBSERVED hoặc mismatch.
- `2`: đường dẫn, JSON hoặc schema không hợp lệ.

## Schema v1

Top-level bắt buộc:

| Trường | Quy tắc |
| --- | --- |
| `schema_version` | Phải là `1` |
| `project` | Phải là `Arduino3DVietnam` |
| `board` | Phải là `Arduino Uno R3` |
| `report_id` | 1–80 ký tự ASCII: chữ, số, `.`, `_`, `-` |
| `report_created_at` | ISO-8601 có timezone hoặc `Z` |
| `provenance` | Metadata nguồn evidence |
| `lessons` | Tối đa 16 record; review yêu cầu đủ ID `1..16` |

`provenance` bắt buộc có `collector_name`, `collector_role: "qualified_educator"`, `collection_method: "manual_hardware_observation"`, `source_revision` dạng hex 7–64 ký tự và `evidence_set_ref`. `source_revision` giúp gắn evidence với phiên bản nội dung/firmware được educator dùng; validator không truy cập Git để kiểm tra revision đó.

Mỗi lesson record bắt buộc có:

- `lesson_id`: `1..16`.
- `lesson_title`: phải trùng tên canonical hiện tại của bài.
- `reviewed_at`: ISO-8601 có timezone, không được sau `report_created_at`.
- `evidence_refs`: danh sách tối đa 16 tham chiếu local/log/photo/video/lab-note; review yêu cầu ít nhất một mục nhưng không mở các tham chiếu này.
- `measurements`: tối đa 32 record; review yêu cầu ít nhất một mục.

Mỗi measurement bắt buộc có `name`, `unit`, `source_ref`. Có thể khai báo `expected`, `observed`, `observed_at` và `notes`. Khi có `observed`, review yêu cầu `observed_at`; timestamp này không được sau `reviewed_at` của lesson.

`expected` hỗ trợ ba phép so sánh:

```json
{"operator": "eq", "value": "visible"}
{"operator": "between", "min": 100, "max": 200}
{"operator": "approx", "value": 1000, "tolerance": 25}
```

`eq` hỗ trợ chuỗi, boolean và số; `between`/`approx` chỉ so sánh số hữu hạn. Validator chỉ thực hiện comparison khi cùng measurement có cả `expected` và `observed`. Thiếu một phía được ghi thành issue và không được suy diễn giá trị còn lại. EXPECTED do người lập evidence cung cấp; validator không tạo ngưỡng điện học, không kiểm tra dây nối và không thay thế tài liệu phần cứng chính thức.

Ví dụ dưới đây là một record minh họa. File thực tế phải có đủ 16 lesson ID; ví dụ không mô tả thao tác đấu dây:

```json
{
  "schema_version": 1,
  "project": "Arduino3DVietnam",
  "board": "Arduino Uno R3",
  "report_id": "educator-run-20261028-a",
  "report_created_at": "2026-10-28T10:30:00+07:00",
  "provenance": {
    "collector_name": "Educator name",
    "collector_role": "qualified_educator",
    "collection_method": "manual_hardware_observation",
    "source_revision": "cfb9ba05",
    "evidence_set_ref": "lab-notebook-20261028"
  },
  "lessons": [
    {
      "lesson_id": 1,
      "lesson_title": "Làm quen với Arduino Uno R3",
      "reviewed_at": "2026-10-28T09:30:00+07:00",
      "evidence_refs": ["photo-set-lesson-01"],
      "measurements": [
        {
          "name": "built-in-led-visible",
          "unit": "state",
          "source_ref": "observation-lesson-01-a",
          "expected": {"operator": "eq", "value": true},
          "observed": true,
          "observed_at": "2026-10-28T09:15:00+07:00"
        }
      ]
    }
  ]
}
```

## Giới hạn và hành vi bảo vệ

Tệp phải là `.json` regular file local, không phải symbolic link, UNC/network share hoặc Windows device path; đường dẫn tối đa 1024 ký tự và kích thước tối đa 512 KiB. Các dạng UNC/device bị từ chối trước khi script gọi `stat()` hoặc đọc file. JSON từ chối duplicate key, `NaN`/`Infinity`, chuỗi quá dài, cấu trúc quá sâu/quá lớn và trường schema không được khai báo. Số đo bị giới hạn ở giá trị hữu hạn có độ lớn tối đa `1e12`.

Output không chấp nhận hay sao chép trường `PASS/status` do người thu thập tự gắn. Trạng thái được tính từ schema và issue list. Khi cần đưa evidence này vào QA/release gate, nên dùng JSON output và giữ nguyên file evidence gốc cùng provenance của nó; việc quyết định một bài học đã được hardware-verified ở mức sản phẩm vẫn thuộc quy trình review của dự án.

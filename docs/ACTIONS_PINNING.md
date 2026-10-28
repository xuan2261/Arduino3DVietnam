# GitHub Actions pinning

Các workflow tạo bằng chứng compiler, browser E2E và firmware dùng **commit SHA 40 ký tự bất biến** cho mọi reusable action. Comment cạnh mỗi `uses:` giữ version/tag dễ đọc; version không được dùng làm locator thực thi.

Lần xác minh này được thực hiện ngày **28/10/2026** bằng GitHub Git Database API trên đúng repository upstream. Với lightweight tag, tag ref trỏ thẳng tới commit. Với annotated tag, phải resolve thêm tag object rồi mới lấy commit đích.

| Action | Tag/version kiểm tra | GitHub ref/tag object | Commit SHA được pin |
| --- | --- | --- | --- |
| `actions/checkout` | `v4`, `v4.4.0` | cả `refs/tags/v4` và `refs/tags/v4.4.0` trỏ trực tiếp tới commit | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-python` | `v5`, `v5.6.0` | cả `refs/tags/v5` và `refs/tags/v5.6.0` trỏ trực tiếp tới commit | `a26af69be951a213d495a4c3e4e4022e16d87065` |
| `actions/upload-artifact` | `v4`, `v4.6.2` | cả `refs/tags/v4` và `refs/tags/v4.6.2` trỏ trực tiếp tới commit | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| `arduino/setup-arduino-cli` | `v2.0.0` | annotated tag object `7ef629dcdf0f458ab7ae83149d629443deac6eac` resolve tới commit; GitHub trả `verification.verified=true` | `81d310742121c928ea9c8bbd407b4217b432ae02` |

`arduino/setup-arduino-cli` hiện không có lightweight/moving `refs/tags/v2` tại API Git refs; vì vậy workflow và tài liệu dùng release tag cụ thể `v2.0.0` làm nguồn đối chiếu thay vì suy đoán một major tag không tồn tại.

Các commit đích ở bảng trên cũng được đọc trực tiếp từ `/repos/<owner>/<repo>/git/commits/<sha>` của repository upstream tương ứng. GitHub trả object commit đúng SHA cho cả bốn pin; các commit hiện đều có `verification.verified=true` trong phản hồi API.

## Same-SHA evidence

Ba workflow bằng chứng đều là `workflow_dispatch`. Checkout được khóa thêm bằng:

```yaml
with:
  ref: ${{ github.sha }}
  persist-credentials: false
```

Như vậy compiler/E2E/firmware chạy trên đúng immutable `github.sha` của workflow run thay vì phụ thuộc vào việc resolve lại một branch name có thể dịch chuyển trong khi job chờ runner. `release-gates-manual.yml` và các checkout trong `pages.yml` cũng sử dụng `ref: ${{ github.sha }}` và `persist-credentials:false`; các job check/release-gates/package/deploy Pages sử dụng runner `ubuntu-24.04`. Release gate vẫn là nơi kiểm tra run `head_sha`, event `workflow_dispatch`, `status=completed` và `conclusion=success` cho commit phát hành. **Phiên bản Python/Arduino/Playwright được pin nhưng tải về từ nguồn bên ngoài khi chạy**, do đó đây là pinning code/workflow, chưa phải image/byte-level reproducibility hoàn toàn.

Toolchain ứng dụng giữ nguyên các pin hiện có: Python `3.11`; Arduino CLI `1.5.1`; Arduino AVR core `1.8.6`; Servo `1.3.0`; Playwright `1.57.0`. Việc pin reusable action không thay đổi các version này.

## Cách cập nhật pin

Khi nâng action, không thay trực tiếp sang `@vN`. Trước tiên đọc official tag ref từ repository upstream; nếu `object.type` là `tag`, resolve tag object cho tới `object.type=commit`. Sau đó dùng **đúng commit SHA 40 ký tự** trong `uses:` và giữ tag/version đã kiểm tra ở comment. Moving major tag có thể thay đổi theo thời gian, nên cần xác minh lại trước mỗi lần nâng cấp; SHA đã commit trong workflow không tự dịch chuyển.

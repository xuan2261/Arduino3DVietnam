# Safe Backup v1.5

<code>scripts/package_safe_backup.py</code> tạo một bộ backup cục bộ, tái lập và fail-closed cho một release đã chốt. Chỉ chạy script sau khi prime có final commit SHA và release gate đã tạo hoặc xác minh dist tương ứng.

Script không tạo Git tag, không push, không deploy, không gọi GitHub API, không cài phần mềm và không nạp Arduino. Nó không dùng <code>sources/</code>, backup cũ trong <code>releases/</code>, hay working-tree <code>dist/</code> làm nguồn của source ZIP.

## Contract đầu vào

Ví dụ sau chỉ mô tả cú pháp; không chạy trước khi có final SHA:

~~~powershell
python scripts/package_safe_backup.py --version-date v1.5.0-20261028 --head <FINAL_40_HEX_SHA> --dist-dir releases/ci-evidence/final-pages-dist --firmware-dir assets/firmware
~~~

Hoặc dùng đúng ZIP artifact từ release gate:

~~~powershell
python scripts/package_safe_backup.py --version-date v1.5.0-20261028 --head <FINAL_40_HEX_SHA> --dist-artifact releases/ci-evidence/final-pages-artifact.zip --dist-sha256 <EXACT_ARTIFACT_SHA256> --firmware-dir assets/firmware
~~~

Các điều kiện bắt buộc:

- <code>--head</code> phải là full 40-hex SHA và phải bằng HEAD hiện tại. Source ZIP đọc byte trực tiếp từ Git object tree của SHA này, nên file mới, untracked hoặc dirty không lọt vào backup. File mới chỉ xuất hiện sau khi đã commit vào HEAD.
- Source chỉ dùng các root cố định của dự án: <code>.github</code>, <code>assets</code>, <code>docs</code>, <code>scripts</code>, <code>src</code>, <code>styles</code>, <code>tests</code> và các file root được liệt kê trong script. <code>sources/</code>, <code>releases/</code>, <code>dist/</code>, nested <code>.git</code>, symlink, submodule, special file và tên credential phổ biến bị từ chối.
- Có hai tập byte khác nhau có chủ đích: **pinned HEAD verification blobs** giữ toàn bộ tracked byte cần để kiểm tra dist; **source ZIP** loại riêng subtree upstream snapshot <code>assets/vendor/avr/avr8js-0.21.1-source/</code>. Vì build website hiện phát hành ba file TypeScript upstream đó, verifier vẫn cần byte gốc từ Git để chứng minh dist parity, nhưng ba snapshot này không được chép vào source backup. Vendored runtime JavaScript, license và provenance của ứng dụng vẫn tuân theo tracked source/release allowlist riêng.
- Dist directory phải có marker <code>.arduino-3d-viet-generated</code>, file set phải khớp chính xác danh sách ASSETS trong Service Worker, mọi asset ngoại trừ <code>sw.js</code> phải byte-for-byte bằng pinned HEAD. <code>sw.js</code> phải đúng deterministic cache ID mà <code>scripts/build_site.py</code> tạo.
- Với <code>--dist-artifact</code>, SHA-256 từ release gate là bắt buộc. Script giữ nguyên byte ZIP artifact sau khi xác minh digest và nội dung; không tự recompress rồi gọi đó là exact artifact.
- Firmware directory phải có đúng <code>manifest.json</code> cùng <code>lesson_01.hex</code> đến <code>lesson_16.hex</code>, byte-for-byte bằng pinned HEAD. Manifest phải có đúng schema, board, source và toolchain đã pin; <code>source_sha256</code> phải khớp <code>src/lessons.js</code> ở HEAD; <code>manifest.git_sha</code> phải là ancestor của HEAD. Backup verifier dùng chính owning parser/extractor của <code>scripts/verify_sketches.py</code> và <code>scripts/export_firmware.py</code> trên byte lesson đã pin để recompute slug + Sketch SHA, parse strict Intel HEX, rồi recompute parsed flash SHA. Một manifest tự sửa SHA cho “khớp chính nó” vẫn bị từ chối.
- Mọi filesystem input phải nằm bên trong repo root. Symlink và Windows reparse point hoặc junction bị từ chối trước khi đọc nội dung.

## Output

Script chỉ tạo một thư mục mới:

~~~text
releases/<version-date>/
  Arduino3DVietnam-source-<version-date>.zip
  Arduino3DVietnam-dist-<version-date>.zip
  Arduino3DVietnam-firmware-<version-date>.zip
  backup-metadata.json
  SHA256SUMS
~~~

Nếu <code>releases/&lt;version-date&gt;</code> đã tồn tại, script dừng và không ghi đè. Vì vậy backup v1.3/v1.4 hiện có không bị sửa.

Script v1.5 cũng từ chối mọi <code>version-date</code> nhỏ hơn v1.5.0, nên không thể dùng nó để tạo hoặc thay thế target v1.3/v1.4.

Source ZIP và firmware ZIP dùng thứ tự path cố định, ZIP timestamp 1980-01-01, permission chuẩn hóa và DEFLATE level 9. Cùng một HEAD và cùng input hợp lệ tạo cùng byte archive. Dist ZIP từ directory cũng deterministic; dist ZIP từ release artifact giữ nguyên byte artifact gốc.

<code>backup-metadata.json</code> ghi HEAD SHA và commit time, số file cùng tree SHA-256 cho source/dist/firmware, mode của dist, manifest firmware source commit/source hash và SHA-256 của ba ZIP. Phần source còn ghi <code>verification_blob_count</code> và <code>excluded_upstream_prefixes</code> để reviewer thấy rõ số byte HEAD dùng cho verification có thể lớn hơn tập file thực sự được đưa vào source ZIP.

<code>SHA256SUMS</code> chứa SHA-256 của ba ZIP và <code>backup-metadata.json</code>, theo thứ tự tên file ổn định.

## API Python

~~~python
from pathlib import Path
from scripts.package_safe_backup import create_backup

result = create_backup(
    repo_root=Path(r"C:\Work\Arduino3DVietnam"),
    version_date="v1.5.0-20261028",
    head_sha="<FINAL_40_HEX_SHA>",
    dist_dir=Path("releases/ci-evidence/final-pages-dist"),
    firmware_dir=Path("assets/firmware"),
)
~~~

<code>create_backup(...)</code> trả về <code>BackupResult</code> với path của source/dist/firmware ZIP, metadata, <code>SHA256SUMS</code> và SHA đã pin. Mọi mismatch, escape hoặc tamper dùng <code>BackupError</code> và không tạo backup hoàn chỉnh.

## Giới hạn bằng chứng

Backup này chứng minh tính nhất quán byte giữa pinned Git HEAD, dist được xác minh và bundle firmware đã pin. SHA-256 là integrity check, không phải chữ ký nguồn gốc. Script không thay thế release gate GitHub, không chứng minh phần cứng Arduino và không tự xuất bản backup ra Internet.

# Firmware release gate

## Mục tiêu

Pages chỉ được đi tiếp tới bước tạo/upload artifact triển khai khi có đủ ba nhóm bằng chứng:

1. workflow compile Arduino C++ thủ công thành công trên **đúng final application SHA**;
2. workflow Chromium/WebGL/offline E2E thủ công thành công trên **đúng final application SHA**;
3. 16 firmware Intel HEX trong `assets/firmware/` được chứng minh là byte đã xuất từ một artifact GitHub Actions cụ thể, còn hạn, của workflow firmware thật.

Firmware không bị ép compile trên final application SHA. Điều đó tạo vòng phụ thuộc không cần thiết: commit final có thể cần chứa chính `.hex`, runtime hoặc tài liệu được tạo sau lần compile. Thay vào đó, `assets/firmware/manifest.json` ghi `git_sha` của revision nguồn đã compile; revision này phải là **ancestor hoặc cùng commit** với final app SHA, và `src/lessons.js` không được thay đổi nội dung so với manifest.

## Chuỗi bằng chứng fail-closed

`scripts/verify_release_gates.py` kiểm tra theo thứ tự sau:

```text
final app SHA
  ├─ arduino-compile-manual.yml: latest manual run trên exact final SHA phải success
  ├─ browser-e2e-manual.yml: latest manual run trên exact final SHA phải success
  └─ assets/firmware/manifest.json
       ├─ local bundle: current lessons SHA + 16 HEX + Intel HEX checksums/flash hashes hợp lệ
       ├─ manifest.git_sha là ancestor (hoặc bằng) final app SHA
       ├─ GitHub src/lessons.js@manifest.git_sha SHA-256 == manifest.source_sha256
       └─ pinned firmware proof
            ├─ exact workflow run id/attempt/path/head_sha/event/status/conclusion
            ├─ exact artifact id/name/size/digest
            ├─ artifact expired == false và expires_at > thời điểm gate chạy
            ├─ artifact.workflow_run id/head_sha khớp run + manifest
            ├─ tải đúng artifact ZIP bằng GitHub REST read-only
            ├─ SHA-256 ZIP == artifact.digest
            └─ manifest.json + lesson_01.hex..lesson_16.hex trong ZIP
               giống byte-for-byte assets/firmware/ trong checkout
```

Việc kiểm ZIP là phần quan trọng: manifest local không được tự chứng minh chỉ bằng các hash do chính manifest chứa. Local bundle phải trùng byte với artifact GitHub đã được pin.

## Firmware proof hiện được pin

Gate hiện chấp nhận duy nhất proof đã review sau:

| Trường | Giá trị |
| --- | --- |
| Workflow | `.github/workflows/firmware-hex-manual.yml` |
| Run | `40648560140`, attempt `1` |
| Run source SHA | `8a3b6727638be13d674ed37d5ca2853fc6e7dcf6` |
| Artifact ID | `12798453179` |
| Artifact name | `arduino-uno-avr-hex-files` |
| Artifact size metadata | `34588` bytes |
| Artifact digest | `sha256:a18a7ec088a4c2098b018f5352233510724648d8d5891800e37aefeff732f026` |
| Artifact expires | `2027-01-26T07:12:16Z` |

Metadata trên được đọc lại từ GitHub trong mỗi lần gate chạy. Nếu artifact hết hạn, bị xóa, digest thay đổi, run bị rerun thành attempt khác, hoặc artifact metadata không còn đúng, gate **BLOCK**.

Kiểm tra read-only trực tiếp bằng GitHub CLI `gh api` trên workspace ngày 28/10/2026 cũng tải được artifact `12798453179` mà không in token: ZIP có `34588` byte, SHA-256 `a18a7ec088a4c2098b018f5352233510724648d8d5891800e37aefeff732f026`, đúng 17 file root-level (`manifest.json` + `lesson_01.hex` … `lesson_16.hex`). Kết quả này độc lập với test mock của Python và khớp `artifact.digest` từ GitHub Actions metadata.

## Khi nào cần compile firmware lại

Không cần compile lại chỉ vì final app có commit mới về UI, docs hoặc runtime, miễn là:

- `manifest.git_sha` vẫn là ancestor của final SHA;
- current `src/lessons.js` vẫn khớp `manifest.source_sha256` và sketch hashes;
- 16 HEX local vẫn khớp manifest và pinned artifact;
- artifact remote vẫn còn hạn.

Phải tạo proof firmware mới nếu nội dung `src/lessons.js` thay đổi, firmware/toolchain cần đổi, artifact cũ hết hạn/bị xóa, hoặc muốn thay bundle HEX. Sau một firmware export thành công mới, cần review run/artifact metadata rồi cập nhật binding `FIRMWARE_PROOF` trong verifier cùng tài liệu này. Gate cố ý không tự chọn “latest successful firmware run”.

Compiler và browser E2E thì khác: chúng kiểm tra toàn bộ final app nên vẫn bắt buộc chạy thành công trên **đúng final app SHA** sau commit cuối cần phát hành.

## Thứ tự Pages

`.github/workflows/pages.yml` giữ push vào `main` ở chế độ test/build-only. Với `workflow_dispatch`:

```text
check tests + validation build
    ↓
release-gates (read-only)
    ↓
package rebuild + actions/upload-artifact
    ↓
download artifact → upload-pages-artifact → deploy-pages
```

Không có deployable site artifact nào được upload trước khi release gate PASS. `release-gates-manual.yml` cho phép chạy cùng verifier như một preflight read-only và không có action deploy/publication.

## GitHub Actions được pin theo full SHA

Hai workflow release có quyền đọc Actions hoặc quyền Pages/`id-token` không thực thi floating tag. Ngày 28/10/2026, các ref major hiện hành được đọc từ GitHub REST `git/ref/tags/vN` và đối chiếu với `git/matching-refs/tags/vN.` để ánh xạ về release cụ thể:

| Action chính thức | Major giữ nguyên | Release tag | Full commit SHA |
| --- | --- | --- | --- |
| `actions/checkout` | `v4` | `v4.4.0` | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-python` | `v5` | `v5.6.0` | `a26af69be951a213d495a4c3e4e4022e16d87065` |
| `actions/upload-artifact` | `v4` | `v4.6.2` | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| `actions/download-artifact` | `v4` | `v4.3.0` | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |
| `actions/configure-pages` | `v5` | `v5.0.0` | `983d7736d9b0ae728b81ab479565c72886d7745b` |
| `actions/upload-pages-artifact` | `v3` | `v3.0.1` | `56afc609e74202658d3ffba0e8f6dda462b719fa` |
| `actions/deploy-pages` | `v4` | `v4.0.5` | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` |

Các SHA trên là object commit mà official GitHub REST metadata trả cho floating major ref tại thời điểm kiểm tra, đồng thời trùng SHA của release tag cụ thể liệt kê trong bảng. YAML giữ comment `# vX.Y.Z` để người review biết provenance con người đọc được, nhưng runtime Actions dùng SHA 40 ký tự.

## Giới hạn

- Gate phụ thuộc GitHub REST và quyền `contents: read`, `actions: read`; API lỗi hoặc response không đúng schema làm gate đóng.
- Trên máy Windows hiện tại, Python `urllib` gặp `SSLCertVerificationError: unable to get local issuer certificate` khi gọi `https://api.github.com`, trong khi GitHub CLI `gh api` và GitHub connector vẫn xác minh TLS thành công. Không được tắt certificate verification hoặc thêm CA bypass; full provenance gate nên chạy trên GitHub Actions Ubuntu hoặc máy có OS/Python CA trust đã được xác minh.
- Mọi request có bearer token phải bắt đầu tại `https://api.github.com`; khi GitHub redirect artifact download sang blob host HTTPS khác, verifier bỏ header `Authorization` trước khi theo redirect để không chuyển token ra ngoài GitHub API host.
- Artifact GitHub có retention. Proof hiện tại sẽ tự hết hiệu lực khi artifact hết hạn; đây là hành vi chủ ý.
- `artifact.digest` chứng minh ZIP tải về; verifier còn so từng file trong ZIP với checkout để liên kết digest đó tới 16 HEX đang chuẩn bị phát hành.
- Gate chứng minh provenance/compile artifact, không chứng minh phần cứng vật lý, an toàn điện hoặc parity đầy đủ của AVR peripheral runtime.
- Gate không chạy workflow, không upload firmware, không flash USB/serial và không triển khai Pages; các effect đó thuộc workflow riêng sau khi gate PASS.

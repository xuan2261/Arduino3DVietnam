/**
 * Fail-closed loader for 16 bundled, *compiled* AVR Intel HEX files.
 * No external URLs, compilation, eval(), USB or hardware access. SHA-256
 * detects mismatches against the provenance manifest and lesson source.
 * Hashes alone are integrity checks, not authenticity signatures.
 */
const FILE_ROOT = new URL("../assets/firmware/", import.meta.url);
const SOURCE_URL = new URL("./lessons.js", import.meta.url);
const SHA256_HEX = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const MAX_MANIFEST_BYTES = 65536;
const MAX_HEX_BYTES = 262144;
const MAX_SOURCE_BYTES = 131072;

function lessonNumber(value) {
  if (!Number.isInteger(value) || value < 1 || value > 16) {
    throw new RangeError("Chỉ hỗ trợ firmware bài học 01–16.");
  }
  return value;
}

function assertManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      manifest.schema_version !== 1 || manifest.format !== "arduino-uno-intel-hex" ||
      manifest.board !== "arduino:avr:uno" || !GIT_SHA.test(manifest.git_sha) ||
      !SHA256_HEX.test(manifest.source_sha256) || !Array.isArray(manifest.lessons) ||
      manifest.lessons.length !== 16 ||
      JSON.stringify(manifest.toolchain) !== JSON.stringify({
        arduino_cli: "1.5.1", arduino_avr_core: "1.8.6", servo_library: "1.3.0"
      })) {
    throw new Error("Manifest firmware không hợp lệ hoặc sai toolchain.");
  }
  for (let id = 1; id <= 16; id++) {
    const entry = manifest.lessons[id - 1];
    const filename = "lesson_" + String(id).padStart(2, "0") + ".hex";
    if (!entry || typeof entry !== "object" || entry.id !== id ||
        entry.file !== filename ||
        !SHA256_HEX.test(entry.hex_sha256) || !SHA256_HEX.test(entry.flash_sha256) ||
        !SHA256_HEX.test(entry.sketch_sha256) ||
        !Number.isInteger(entry.hex_bytes) || entry.hex_bytes < 11 || entry.hex_bytes > MAX_HEX_BYTES) {
      throw new Error("Manifest firmware bài " + id + " bị sai hoặc thiếu SHA.");
    }
  }
  return manifest;
}

async function hexDigest(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Không có SHA-256 trong trình duyệt; không thể xác minh firmware.");
  const checksum = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(checksum), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function getBytes(response, limit, label) {
  if (!response || !response.ok) throw new Error("Không đọc được " + label + " từ website.");
  const hint = response.headers?.get?.("content-length");
  if (hint && Number(hint) > limit) throw new Error(label + " vượt giới hạn tải.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error(label + " vượt giới hạn kích thước.");
  return bytes;
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function decodeAscii(bytes) {
  if (bytes.some(byte => byte > 127)) throw new Error("Firmware Intel HEX không phải ASCII.");
  return new TextDecoder("ascii", { fatal: true }).decode(bytes);
}

/** Validate externally downloaded bytes without executing them. */
export async function verifyFirmwareBytes(manifest, lessonId, hexBytes, sourceBytes) {
  const id = lessonNumber(lessonId);
  assertManifest(manifest);
  if (!(hexBytes instanceof Uint8Array) || !(sourceBytes instanceof Uint8Array) ||
      hexBytes.byteLength > MAX_HEX_BYTES || sourceBytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("Kích thước hoặc định dạng bytes firmware/nguồn không hợp lệ.");
  }
  const entry = manifest.lessons[id - 1];
  if (hexBytes.length !== entry.hex_bytes || await hexDigest(hexBytes) !== entry.hex_sha256) {
    throw new Error("Firmware bài " + id + " không khớp SHA-256.");
  }
  if (await hexDigest(sourceBytes) !== manifest.source_sha256) {
    throw new Error("Mã bài học khác phiên bản dùng biên dịch firmware.");
  }
  return Object.freeze({
    lessonId: id,
    hexText: decodeAscii(hexBytes),
    sourceCommit: manifest.git_sha,
    sourceSha256: manifest.source_sha256,
    firmwareSha256: entry.hex_sha256,
    // This is the manifest's declared parsed-flash digest. Browser verification
    // here covers the RAW downloaded HEX bytes and lesson source, not an
    // independently parsed flash image; the release builder validates all 3.
    flashSha256: entry.flash_sha256,
    toolchain: Object.freeze({ ...manifest.toolchain }),
    verification: "sha256-match",
  });
}

/** Fetch only current-origin files selected from the fixed lesson ID list. */
export async function loadVerifiedFirmware(lessonId, fetchImpl = fetch) {
  const id = lessonNumber(lessonId);
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl phải là function.");
  const firmwareUrl = new URL("lesson_" + String(id).padStart(2, "0") + ".hex", FILE_ROOT);
  const manifestUrl = new URL("manifest.json", FILE_ROOT);
  const urls = [manifestUrl, SOURCE_URL, firmwareUrl];
  if (urls.some(url => url.origin !== location.origin)) {
    throw new Error("Không cho phép mã nguồn/firmware ngoài website.");
  }
  const responses = await Promise.all(urls.map(url => fetchImpl(url.href, { cache: "no-store" })));
  const [manifestBytes, sourceBytes, hexBytes] = await Promise.all([
    getBytes(responses[0], MAX_MANIFEST_BYTES, "manifest"),
    getBytes(responses[1], MAX_SOURCE_BYTES, "src/lessons.js"),
    getBytes(responses[2], MAX_HEX_BYTES, "firmware bài " + id),
  ]);
  let manifest;
  try {
    manifest = JSON.parse(decodeUtf8(manifestBytes));
  } catch {
    throw new Error("Manifest không phải JSON UTF-8 hợp lệ.");
  }
  return verifyFirmwareBytes(manifest, id, hexBytes, sourceBytes);
}

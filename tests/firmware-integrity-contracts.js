// Browser only; exercises real 16 Intel HEX files and mutating-byte negatives.
import {
  loadVerifiedFirmware,
  verifyFirmwareBytes,
} from "../src/firmware-integrity.js";

export async function runFirmwareIntegrityContracts() {
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push(name);
  };
  const fails = async (callback, text) => {
    try { await callback(); } catch (error) {
      return String(error?.message || error).includes(text);
    }
    return false;
  };

  for (let lessonId = 1; lessonId <= 16; lessonId++) {
    const verified = await loadVerifiedFirmware(lessonId);
    check("lesson-" + lessonId + "-sha-validated",
      verified.lessonId === lessonId &&
      verified.verification === "sha256-match" &&
      verified.hexText.startsWith(":") &&
      /^[a-f0-9]{64}$/.test(verified.firmwareSha256) &&
      verified.toolchain.arduino_cli === "1.5.1");
  }

  const base = new URL("../assets/firmware/", import.meta.url);
  const [manifestResponse, sourceResponse, hexResponse] = await Promise.all([
    fetch(new URL("manifest.json", base)),
    fetch(new URL("../src/lessons.js", import.meta.url)),
    fetch(new URL("lesson_02.hex", base)),
  ]);
  const manifest = await manifestResponse.json();
  const source = new Uint8Array(await sourceResponse.arrayBuffer());
  const hex = new Uint8Array(await hexResponse.arrayBuffer());

  const tamperedHex = hex.slice();
  tamperedHex[8] ^= 1;
  check("changed-firmware-bytes-rejected",
    await fails(() => verifyFirmwareBytes(manifest, 2, tamperedHex, source), "SHA-256"));

  const staleSource = new Uint8Array(source.length + 1);
  staleSource.set(source);
  staleSource[source.length] = 0x20;
  check("different-lesson-source-rejected",
    await fails(() => verifyFirmwareBytes(manifest, 2, hex, staleSource), "khác phiên bản"));

  const alteredManifest = JSON.parse(JSON.stringify(manifest));
  alteredManifest.lessons[1].file = "../outside.hex";
  check("traversal-filename-rejected",
    await fails(() => verifyFirmwareBytes(alteredManifest, 2, hex, source), "Manifest firmware"));

  const wrongToolchain = JSON.parse(JSON.stringify(manifest));
  wrongToolchain.toolchain.arduino_cli = "unknown";
  check("unpinned-toolchain-rejected",
    await fails(() => verifyFirmwareBytes(wrongToolchain, 2, hex, source), "toolchain"));

  check("invalid-lesson-id-blocked",
    await fails(() => loadVerifiedFirmware(0), "01–16") &&
    await fails(() => loadVerifiedFirmware(17), "01–16"));

  check("same-origin-only-loader",
    await fails(() => loadVerifiedFirmware(1, () => {
      throw new Error("mock refused network");
    }), "mock refused network"));

  return Object.freeze({ total: results.length, passed: results.length, checks: Object.freeze(results) });
}

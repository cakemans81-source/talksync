const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function fail(message) {
  throw new Error(message);
}

function normalizeThumbprint(value) {
  if (!value || !String(value).trim()) {
    fail("TALKSYNC_WIN_CERT_THUMBPRINT is required for electron-builder signing.");
  }

  const normalized = String(value).replace(/\s/g, "").toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(normalized)) {
    fail("TALKSYNC_WIN_CERT_THUMBPRINT must be a 40-character SHA-1 hex string.");
  }

  return normalized;
}

function findSignTool() {
  const explicit = process.env.TALKSYNC_SIGNTOOL_PATH || process.env.SIGNTOOL_PATH;
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      fail(`signtool.exe was not found at ${explicit}`);
    }
    return explicit;
  }

  const roots = [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
  ].filter(Boolean);

  const candidates = [];
  for (const root of roots) {
    const binRoot = path.join(root, "Windows Kits", "10", "bin");
    if (!fs.existsSync(binRoot)) {
      continue;
    }

    for (const version of fs.readdirSync(binRoot)) {
      for (const arch of ["x64", "x86"]) {
        const candidate = path.join(binRoot, version, arch, "signtool.exe");
        if (fs.existsSync(candidate)) {
          candidates.push(candidate);
        }
      }
    }
  }

  candidates.sort((a, b) => {
    const aX64 = /\\x64\\signtool\.exe$/i.test(a) ? 1 : 0;
    const bX64 = /\\x64\\signtool\.exe$/i.test(b) ? 1 : 0;
    if (aX64 !== bX64) {
      return bX64 - aX64;
    }
    return b.localeCompare(a);
  });

  if (candidates.length === 0) {
    fail("signtool.exe was not found. Install Windows SDK or set TALKSYNC_SIGNTOOL_PATH.");
  }

  return candidates[0];
}

exports.sign = async function sign(configuration) {
  const file = configuration.path;
  if (!file || !fs.existsSync(file)) {
    fail(`Signing target not found: ${file}`);
  }

  const thumbprint = normalizeThumbprint(process.env.TALKSYNC_WIN_CERT_THUMBPRINT);
  const timestampUrl = process.env.TALKSYNC_WIN_TIMESTAMP_URL || "http://timestamp.digicert.com";
  if (!timestampUrl.trim()) {
    fail("TALKSYNC_WIN_TIMESTAMP_URL cannot be empty.");
  }

  const signTool = findSignTool();
  const args = [
    "sign",
    "/sha1", thumbprint,
    "/fd", "SHA256",
    "/tr", timestampUrl,
    "/td", "SHA256",
    "/v",
    file,
  ];

  if (process.env.TALKSYNC_WIN_SIGN_DRY_RUN === "1") {
    console.log(`[DRY-RUN] ${signTool} ${args.join(" ")}`);
    return;
  }

  console.log(`TalkSync custom signer: ${file}`);
  execFileSync(signTool, args, { stdio: "inherit" });
};

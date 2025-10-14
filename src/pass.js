// src/pass.js
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pass } from "@walletpass/pass-js";
dotenv.config();

/* ==== ENV (Added trim() to prevent hidden whitespace issues) ==== */
const {
  PASS_TYPE_IDENTIFIER: RAW_PTI,
  TEAM_IDENTIFIER: RAW_TI,
  ORG_NAME: RAW_ON,
  TEMPLATE_DIR,

  // PEM
  WWDR_PATH, CERT_PEM_PATH, KEY_PEM_PATH, KEY_PASSPHRASE,
  WWDR_PEM_BASE64, CERT_PEM_BASE64, KEY_PEM_BASE64,

  // P12
  P12_PATH, P12_PASSWORD, P12_BASE64,
} = process.env;

const PASS_TYPE_IDENTIFIER = RAW_PTI ? RAW_PTI.trim() : null;
const TEAM_IDENTIFIER      = RAW_TI ? RAW_TI.trim() : null;
const ORG_NAME             = RAW_ON ? RAW_ON.trim() : "Klub Osmijeha";
// END ENV

/* ==== HELPERS ==== */
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function b64ToFile(filePath, b64) {
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
  return filePath;
}
function abs(p) {
  return path.isAbsolute(p) ? p : path.resolve(p);
}

/** Vrati putanje do certifikata – podržava PEM i P12, fajl ili BASE64 */
function getCertificateFiles() {
  const tmp = "/tmp/certs";
  ensureDir(tmp);

  let wwdrFile = WWDR_PATH ? abs(WWDR_PATH) : null;
  if (!wwdrFile || !fs.existsSync(wwdrFile)) {
    if (!WWDR_PEM_BASE64) throw new Error("WWDR missing: set WWDR_PATH or WWDR_PEM_BASE64");
    wwdrFile = path.join(tmp, "wwdr.pem");
    b64ToFile(wwdrFile, WWDR_PEM_BASE64);
  }

  const havePemFiles = CERT_PEM_PATH && KEY_PEM_PATH && fs.existsSync(abs(CERT_PEM_PATH)) && fs.existsSync(abs(KEY_PEM_PATH));
  const havePemB64 = CERT_PEM_BASE64 && KEY_PEM_BASE64;

  if (havePemFiles || havePemB64) {
    const certFile = havePemFiles ? abs(CERT_PEM_PATH) : path.join(tmp, "cert.pem");
    const keyFile  = havePemFiles ? abs(KEY_PEM_PATH)  : path.join(tmp, "key.pem");
    if (!havePemFiles) {
      b64ToFile(certFile, CERT_PEM_BASE64);
      b64ToFile(keyFile,  KEY_PEM_BASE64);
    }
    return { type: "PEM", wwdrFile, certFile, keyFile, keyPass: KEY_PASSPHRASE || "" };
  }

  const haveP12File = P12_PATH && fs.existsSync(abs(P12_PATH));
  const haveP12B64  = !!P12_BASE64;
  if (haveP12File || haveP12B64) {
    const p12File = haveP12File ? abs(P12_PATH) : path.join(tmp, "signer.p12");
    if (!haveP12File) b64ToFile(p12File, P12_BASE64);
    return { type: "P12", wwdrFile, p12File, p12Pass: P12_PASSWORD || "" };
  }

  throw new Error("No certificate configuration found (provide PEM pair or P12).");
}

/** Učitaj template direktorij (za slike) */
function loadTemplateDir() {
  const preferred = TEMPLATE_DIR ? abs(TEMPLATE_DIR) : abs("./templates/klub-osmijeha");
  if (fs.existsSync(preferred)) return preferred;
  const fallback = "/app/templates/klub-osmijeha";
  if (fs.existsSync(fallback)) return fallback;
  throw new Error(`Template dir not found. Checked: ${preferred} and ${fallback}`);
}

/* ==== PUBLIC ==== */
export async function createStoreCardPass({ fullName, memberId, serialNumber }) {
  if (!fullName || !memberId) throw new Error("fullName and memberId are required");
  if (!PASS_TYPE_IDENTIFIER) throw new Error("Missing PASS_TYPE_IDENTIFIER env");
  if (!TEAM_IDENTIFIER)      throw new Error("Missing TEAM_IDENTIFIER env");

  // 0) Certifikati
  const certs = getCertificateFiles();
  const certificates =
    certs.type === "PEM"
      ? {
          wwdr: fs.readFileSync(certs.wwdrFile),
          signerCert: fs.readFileSync(certs.certFile),
          signerKey: { keyFile: certs.keyFile, passphrase: certs.keyPass },
        }
      : {
          wwdr: fs.readFileSync(certs.wwdrFile),
          signerCert: fs.readFileSync(certs.p12File),
          signerKeyPassphrase: certs.p12Pass,
        };

  // 1) Priprema modela na disku: novi pass.json + kopiraj slike
  const templateDir = loadTemplateDir();
  const tmpModelDir = fs.mkdtempSync(path.join("/tmp", "model-"));
  ensureDir(tmpModelDir);

  const images = [
      { name: "icon.png", required: true },
      { name: "icon@2x.png", required: true },
      { name: "logo.png", required: true },
      { name: "strip.png", required: false },
      { name: "strip@2x.png", required: false },
  ];

  for (const img of images) {
    const src = path.join(templateDir, img.name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(tmpModelDir, img.name));
    } else if (img.required) {
      throw new Error(`Missing required image: ${img.name} in ${templateDir}`);
    }
  }
  
  // 2) Kreiraj pass.json objekt
  const passJson = {
    formatVersion: 1,
    description: "Loyalty kartica",
    organizationName: ORG_NAME,
    passTypeIdentifier: PASS_TYPE_IDENTIFIER,
    teamIdentifier: TEAM_IDENTIFIER,
    backgroundColor: "rgb(255,255,255)",
    foregroundColor: "rgb(31,41,55)",
    labelColor: "rgb(31,41,55)",
    suppressStripShine: true,
    barcode: {
      message: String(memberId),
      format: "PKBarcodeFormatCode128",
      messageEncoding: "utf-8",
      altText: String(memberId),
    },
    storeCard: {
      primaryFields: [
        { key: "member", label: "ČLAN", value: String(fullName).toUpperCase() }
      ],
      secondaryFields: [
        { key: "leftSpacer", label: "", value: "", textAlignment: "PKTextAlignmentLeft",  labelColor: "rgb(255,255,255)" },
        { key: "memberFullName", label: "", value: String(fullName), textAlignment: "PKTextAlignmentCenter" },
        { key: "rightSpacer", label: "", value: "", textAlignment: "PKTextAlignmentRight", labelColor: "rgb(255,255,255)" },
      ],
    },
    backFields: [
      { key: "info", label: "Informacije", value: "Kartica je vlasništvo Klub Osmijeha.\nBesplatna info linija: 0800 50243" },
    ],
  };

  // 3) Upiši finalni JSON (sa serialNumberom) na disk
  const serial = serialNumber || `KOS-${memberId}`;
  const merged = { ...passJson, serialNumber: serial };
  const finalPassPath = path.join(tmpModelDir, "pass.json");

  fs.writeFileSync(finalPassPath, JSON.stringify(merged, null, 2));

  // --- CRITICAL DEBUG LOGGING ---
  const recheck = JSON.parse(fs.readFileSync(finalPassPath, "utf8"));
  console.log("[pass] recheck.description:", recheck.description, "| serial:", recheck.serialNumber);

  try {
      const stats = fs.statSync(finalPassPath);
      console.log(`[pass] DEBUG: Final pass.json size: ${stats.size} bytes at ${finalPassPath}`);
  } catch (error) {
      // If this error shows up in your deployment logs, the problem is file permissions.
      console.error(`[pass] DEBUG: ERROR accessing final pass.json at ${finalPassPath}:`, error.message);
      throw new Error("File access error: Cannot read final pass.json. Check permissions.");
  }
  // --- END DEBUG LOGGING ---

  // 4) Kreiraj Pass objekt (uses spread to ensure required fields are in constructor)
  const pass = new Pass({
      ...merged, // This satisfies the constructor's mandatory fields
      model: tmpModelDir, // This loads the images and all assets
      certificates,
  });

  // 5) Sačuvaj pkpass fajl
  const outDir = abs("./output");
  ensureDir(outDir);
  const outPath = path.join(outDir, `${serial}.pkpass`);
  fs.writeFileSync(outPath, await pass.asBuffer());
  
  // 6) Očisti temp dir (optional, but good practice)
  try {
    fs.rmSync(tmpModelDir, { recursive: true, force: true });
  } catch (e) {
    console.error("[pass] Cleanup failed:", e.message);
  }

  return outPath;
}

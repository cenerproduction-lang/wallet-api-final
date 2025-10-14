// src/pass.js
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pass } from "@walletpass/pass-js";
dotenv.config();

/* ==== ENV ==== */
const {
  PASS_TYPE_IDENTIFIER,
  TEAM_IDENTIFIER,
  ORG_NAME,
  TEMPLATE_DIR,          // npr. /app/templates/klub-osmijeha

  // PEM (file ili BASE64)
  WWDR_PATH,
  CERT_PEM_PATH,
  KEY_PEM_PATH,
  KEY_PASSPHRASE,
  WWDR_PEM_BASE64,
  CERT_PEM_BASE64,
  KEY_PEM_BASE64,

  // P12 (file ili BASE64)
  P12_PATH,
  P12_PASSWORD,
  P12_BASE64,
} = process.env;

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

  // WWDR
  let wwdrFile = WWDR_PATH ? abs(WWDR_PATH) : null;
  if (!wwdrFile || !fs.existsSync(wwdrFile)) {
    if (!WWDR_PEM_BASE64) throw new Error("WWDR missing: set WWDR_PATH or WWDR_PEM_BASE64");
    wwdrFile = path.join(tmp, "wwdr.pem");
    b64ToFile(wwdrFile, WWDR_PEM_BASE64);
  }

  // PEM set?
  const havePemFiles =
    CERT_PEM_PATH && KEY_PEM_PATH && fs.existsSync(abs(CERT_PEM_PATH)) && fs.existsSync(abs(KEY_PEM_PATH));
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

  // P12 set?
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

  // 1) Model: novi pass.json + kopiraj slike
  const templateDir = loadTemplateDir();

  const tmpModelDir = fs.mkdtempSync(path.join("/tmp", "model-"));
  ensureDir(tmpModelDir);

  const requiredImgs = ["icon.png", "icon@2x.png", "logo.png"];
  const optionalImgs = ["strip.png", "strip@2x.png"];

  for (const img of requiredImgs) {
    const src = path.join(templateDir, img);
    if (!fs.existsSync(src)) throw new Error(`Missing required image: ${img} in ${templateDir}`);
    fs.copyFileSync(src, path.join(tmpModelDir, img));
  }
  for (const img of optionalImgs) {
    const src = path.join(templateDir, img);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpModelDir, img));
  }

  const passJson = {
    formatVersion: 1,
    description: "Loyalty kartica",
    organizationName: ORG_NAME || "Klub Osmijeha",
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
      primaryFields: [{ key: "member", label: "ČLAN", value: String(fullName).toUpperCase() }],
      secondaryFields: [
        { key: "leftSpacer", label: "", value: "", textAlignment: "PKTextAlignmentLeft",  labelColor: "rgb(255,255,255)" },
        { key: "memberFullName", label: "", value: String(fullName), textAlignment: "PKTextAlignmentCenter" },
        { key: "rightSpacer", label: "", value: "", textAlignment: "PKTextAlignmentRight", labelColor: "rgb(255,255,255)" },
      ],
      backFields: [
        { key: "info", label: "Informacije", value: "Kartica je vlasništvo Klub Osmijeha.\nBesplatna info linija: 0800 50243" },
      ],
    },
  };
  fs.writeFileSync(path.join(tmpModelDir, "pass.json"), JSON.stringify(passJson, null, 2));
    console.log("[pass] v3 | modelDir:", tmpModelDir);
  const check = JSON.parse(fs.readFileSync(path.join(tmpModelDir,"pass.json"), "utf8"));
  console.log("[pass] description:", check.description);
  if (!check.description) throw new Error("INTERNAL: description missing before Pass()");

    // 2) Kreiraj i snimi — koristi FULL overrides
    const serial = serialNumber || `KOS-${memberId}`;

    // Napravi overrides kao kompletan pass.json + serialNumber
    const overrides = { ...passJson, serialNumber: serial };

    const pass = new Pass({
      model: tmpModelDir,
      certificates,
      overrides, // ključni dio: cijeli pass JSON ide ovdje
    });

    const outDir = abs("./output");
    ensureDir(outDir);
    const outPath = path.join(outDir, `${serial}.pkpass`);
    fs.writeFileSync(outPath, await pass.asBuffer());
    return outPath;
}

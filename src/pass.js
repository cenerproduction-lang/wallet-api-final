// src/pass.js
import fs from "fs";
import path from "path";
import { Pass } from "@walletpass/pass-js";
import dotenv from "dotenv";
dotenv.config();

/* ---- ENV ---- */
const {
  PASS_TYPE_IDENTIFIER,
  TEAM_IDENTIFIER,
  ORG_NAME,
  TEMPLATE_DIR, // npr. /app/templates/klub-osmijeha
  // PEM varijante
  WWDR_PATH,
  CERT_PEM_PATH,
  KEY_PEM_PATH,
  KEY_PASSPHRASE,
  WWDR_PEM_BASE64,
  CERT_PEM_BASE64,
  KEY_PEM_BASE64,
  // P12 varijante
  P12_PATH,
  P12_PASSWORD,
  P12_BASE64,
} = process.env;

/* ---- Helpers ---- */
function r(p) {
  // Absolutni path u kontejneru ili relativni iz CWD
  return path.isAbsolute(p) ? p : path.resolve(p);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function writeBase64(filePath, b64) {
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
  return filePath;
}

function requireEnv(name, val) {
  if (!val) throw new Error(`Missing env ${name}`);
  return val;
}

function loadCertificates() {
  const tmp = path.join("/tmp", "pass-certs");
  ensureDir(tmp);

  // 1) WWDR
  let wwdrFile = WWDR_PATH ? r(WWDR_PATH) : null;
  if (!wwdrFile || !fs.existsSync(wwdrFile)) {
    if (!WWDR_PEM_BASE64) throw new Error("WWDR missing: set WWDR_PATH or WWDR_PEM_BASE64");
    wwdrFile = path.join(tmp, "wwdr.pem");
    writeBase64(wwdrFile, WWDR_PEM_BASE64);
  }

  // 2a) PEM set
  const havePemFiles =
    CERT_PEM_PATH && KEY_PEM_PATH && fs.existsSync(r(CERT_PEM_PATH)) && fs.existsSync(r(KEY_PEM_PATH));
  const havePemB64 = CERT_PEM_BASE64 && KEY_PEM_BASE64;

  if (havePemFiles || havePemB64) {
    const certFile = havePemFiles ? r(CERT_PEM_PATH) : path.join(tmp, "cert.pem");
    const keyFile = havePemFiles ? r(KEY_PEM_PATH) : path.join(tmp, "key.pem");
    if (!havePemFiles) {
      writeBase64(certFile, CERT_PEM_BASE64);
      writeBase64(keyFile, KEY_PEM_BASE64);
    }
    return {
      mode: "PEM",
      wwdrFile,
      certFile,
      keyFile,
      keyPass: KEY_PASSPHRASE || "",
    };
  }

  // 2b) P12 set
  const haveP12File = P12_PATH && fs.existsSync(r(P12_PATH));
  const haveP12B64 = !!P12_BASE64;
  if (haveP12File || haveP12B64) {
    const p12File = haveP12File ? r(P12_PATH) : path.join(tmp, "signer.p12");
    if (!haveP12File) writeBase64(p12File, P12_BASE64);
    return {
      mode: "P12",
      wwdrFile,
      p12File,
      p12Pass: requireEnv("P12_PASSWORD", P12_PASSWORD),
    };
  }

  throw new Error("No certificate configuration found (provide PEM pair or P12).");
}

function loadTemplateDir() {
  const base = TEMPLATE_DIR ? r(TEMPLATE_DIR) : r("./templates/klub-osmijeha");
  // često je repo montiran pod /app na Railway-u – probaj i apsolutni fallback
  if (fs.existsSync(base)) return base;
  const fallback = "/app/templates/klub-osmijeha";
  if (fs.existsSync(fallback)) return fallback;
  throw new Error(`Template dir not found. Checked: ${base} and ${fallback}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureImagesPresent(modelDir) {
  const must = ["icon.png", "icon@2x.png", "logo.png"];
  const missing = must.filter((f) => !fs.existsSync(path.join(modelDir, f)));
  if (missing.length) {
    throw new Error(
      `Missing required image(s): ${missing.join(
        ", "
      )}. Put them in ${modelDir}. (strip.png/strip@2x.png are optional for storeCard.)`
    );
  }
}

/* ---- Public API ---- */
export async function createStoreCardPass({ fullName, memberId, serialNumber }) {
  if (!fullName || !memberId) throw new Error("fullName and memberId are required");

  const modelDir = loadTemplateDir();
  ensureImagesPresent(modelDir);

  // 1) Učitaj postojeći pass.json iz template-a
  const modelJsonPath = path.join(modelDir, "pass.json");
  if (!fs.existsSync(modelJsonPath)) {
    throw new Error(`pass.json not found in ${modelDir}`);
  }
  const model = readJson(modelJsonPath);

  // 2) “Belt & suspenders”: osiguraj obavezna polja i defaulte na modelu prije validacije
  const description = model.description || "Loyalty kartica";
  const organizationName = model.organizationName || ORG_NAME || "Klub Osmijeha";
  const passTypeIdentifier = model.passTypeIdentifier || PASS_TYPE_IDENTIFIER;
  const teamIdentifier = model.teamIdentifier || TEAM_IDENTIFIER;

  if (!passTypeIdentifier) throw new Error("passTypeIdentifier is required (set PASS_TYPE_IDENTIFIER)");
  if (!teamIdentifier) throw new Error("teamIdentifier is required (set TEAM_IDENTIFIER)");

  // privremena kopija modela u /tmp (ne diramo original repo)
  const tmpDir = path.join("/tmp", "pass-model");
  ensureDir(tmpDir);

  // kopiraj sve fajlove iz template-a u /tmp
  for (const f of fs.readdirSync(modelDir)) {
    const src = path.join(modelDir, f);
    const dst = path.join(tmpDir, f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, dst);
  }

  // upiši osigurani pass.json u /tmp
  const safeModel = {
    ...model,
    description,
    organizationName,
    passTypeIdentifier,
    teamIdentifier,
    formatVersion: 1,
    // storeCard polja inicijaliziraj ako fale
    storeCard: {
      primaryFields: (model.storeCard && model.storeCard.primaryFields) || [],
      secondaryFields: (model.storeCard && model.storeCard.secondaryFields) || [],
      backFields: (model.storeCard && model.storeCard.backFields) || [],
    },
  };
  fs.writeFileSync(path.join(tmpDir, "pass.json"), JSON.stringify(safeModel, null, 2), "utf8");

  // 3) Certifikati
  const certs = loadCertificates();
  const certificates =
    certs.mode === "PEM"
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

  // 4) Kreiraj Pass i overrides
  const serial = serialNumber || `KOS-${memberId}`;
  const pass = new Pass({
    model: tmpDir,
    certificates,
    overrides: {
      description, // još jednom, i kroz overrides
      organizationName,
      passTypeIdentifier,
      teamIdentifier,
      serialNumber: serial,
      // boje i layout (po potrebi)
      backgroundColor: safeModel.backgroundColor || "rgb(255,255,255)",
      foregroundColor: safeModel.foregroundColor || "rgb(31,41,55)",
      labelColor: safeModel.labelColor || "rgb(31,41,55)",
      // storeCard polja
      storeCard: {
        primaryFields:
          safeModel.storeCard.primaryFields.length
            ? safeModel.storeCard.primaryFields
            : [{ key: "member", label: "ČLAN", value: String(fullName).toUpperCase() }],
        secondaryFields: safeModel.storeCard.secondaryFields,
        backFields:
          safeModel.storeCard.backFields.length
            ? safeModel.storeCard.backFields
            : [
                {
                  key: "info",
                  label: "Informacije",
                  value:
                    "Kartica je vlasništvo Klub Osmijeha.\nBesplatna info linija: 0800 50243",
                },
              ],
      },
      // barcode (ako nema u modelu, generiši Code128 iz memberId)
      barcode:
        safeModel.barcode ||
        {
          message: String(memberId),
          format: "PKBarcodeFormatCode128",
          messageEncoding: "iso-8859-1",
        },
    },
  });

  // 5) Snimi .pkpass
  const outDir = r("./output");
  ensureDir(outDir);
  const outPath = path.join(outDir, `${serial}.pkpass`);
  const buffer = await pass.asBuffer(); // ako description/required fale, ovdje bi ranije pucalo – sada neće
  fs.writeFileSync(outPath, buffer);

  return outPath;
}

// src/pass.js
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pass } from "@walletpass/pass-js";
import { execSync } from "child_process"; // <-- NOVI IMPORT
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
const ORG_NAME             = RAW_ON && RAW_ON.trim().length > 0 ? RAW_ON.trim() : "Klub Osmijeha";
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

// --- DEBUG HELPERS START ---

function clean(val) {
  return String(val || "").trim().replace(/^['"]|['"]$/g, "");
}

/** Čita Subject liniju iz certifikata pomoću OpenSSL */
function readCertSubject(certs) {
  try {
    if (certs.type === "P12") {
      const raw = execSync(
        // Izvuci certifikat iz P12 i onda ispiši subject
        `openssl pkcs12 -in "${certs.p12File}" -passin pass:${certs.p12Pass} -nodes -nokeys | openssl x509 -noout -subject`,
        { stdio: ["ignore", "pipe", "pipe"] }
      ).toString();
      return raw;
    } else {
      // Pročitaj subject direktno iz PEM certifikata
      const raw = execSync(
        `openssl x509 -in "${certs.certFile}" -noout -subject`,
        { stdio: ["ignore", "pipe", "pipe"] }
      ).toString();
      return raw;
    }
  } catch (e) {
    console.warn("[cert] OpenSSL subject read failed:", e.message);
    return "";
  }
}

/** Parsira CN i OU iz Subject linije */
function parseCNandOU(subjectLine) {
  const CN = subjectLine.match(/CN\s*=\s*([^\/,]+)/)?.[1]?.trim() || "";
  const OU = subjectLine.match(/OU\s*=\s*([A-Z0-9]{10})/)?.[1]?.trim() || "";
  // Ako je CN format "Pass Type ID: pass.com.foo", izvuci samo dio poslije dvotačke
  const passTypeFromCN = CN.includes(":") ? CN.split(":").slice(1).join(":").trim() : CN.trim();
  return { passTypeFromCN, teamFromOU: OU };
}

// --- DEBUG HELPERS END ---


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
        
  // --- KRITIČNI DEBUG BLOK: PROVJERA ENV vs CERT ---
  try {
    const subj = readCertSubject(certs);
    const { passTypeFromCN, teamFromOU } = parseCNandOU(subj);

    const ENV_PASS = clean(PASS_TYPE_IDENTIFIER);
    const ENV_TEAM = clean(TEAM_IDENTIFIER);

    console.log("-----------------------------------------");
    console.log("[DEBUG] ENV PASS_TYPE_IDENTIFIER:", JSON.stringify(ENV_PASS));
    console.log("[DEBUG] ENV TEAM_IDENTIFIER:     ", JSON.stringify(ENV_TEAM));
    console.log("[DEBUG] CERT CN (Pass Type ID):  ", JSON.stringify(passTypeFromCN));
    console.log("[DEBUG] CERT OU (Team ID):       ", JSON.stringify(teamFromOU));
    console.log("-----------------------------------------");

    if (!passTypeFromCN || !teamFromOU) {
      console.error("[DEBUG] Certifikat ne sadrži validan CN/OU.");
    } else if (passTypeFromCN !== ENV_PASS) {
      throw new Error(`[FATAL] PASS_TYPE_IDENTIFIER MISMATCH. ENV=${ENV_PASS} vs CERT=${passTypeFromCN}`);
    } else if (teamFromOU !== ENV_TEAM) {
      throw new Error(`[FATAL] TEAM_IDENTIFIER MISMATCH. ENV=${ENV_TEAM} vs CERT=${teamFromOU}`);
    }
  } catch (e) {
      console.error("[DEBUG] Cert check failed, continuing:", e.message);
  }
  // --- KRAJ KRITIČNOG DEBUG BLOKA ---

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
      organizationName: ORG_NAME, // Koristi ORG_NAME koji je već obrađen u ENV sekciji
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
    const finalPassPath = path.join(tmpModelDir, "pass.json");
    // Upiši passJson + serialNumber na disk
    fs.writeFileSync(finalPassPath, JSON.stringify({ ...passJson, serialNumber: serial }, null, 2));

    // --- KRITIČNO DEBUG LOGIRANJE FAJLA (ostaje za provjeru) ---
    const recheck = JSON.parse(fs.readFileSync(finalPassPath, "utf8"));
    console.log("[pass] recheck.description:", recheck.description, "| serial:", recheck.serialNumber);
    try {
        const stats = fs.statSync(finalPassPath);
        console.log(`[pass] DEBUG: Final pass.json size: ${stats.size} bytes at ${finalPassPath}`);
    } catch (error) {
        console.error(`[pass] DEBUG: ERROR accessing final pass.json at ${finalPassPath}:`, error.message);
    }
    // --- KRAJ DEBUG LOGIRANJA ---

    // 4) Kreiraj Pass objekt – minimalni overrides (samo obavezna polja)
    const overrides = {
      description: passJson.description,
      organizationName: passJson.organizationName,
      passTypeIdentifier: PASS_TYPE_IDENTIFIER,
      teamIdentifier: TEAM_IDENTIFIER,
      serialNumber: serial,
    };
    
    const pass = new Pass({
      model: tmpModelDir,
      certificates,
      overrides,
    });

    // Failsafe: eksplicitno upiši na instancu (ako lib ignorira overrides)
    pass.description        = pass.description        ?? passJson.description;
    pass.organizationName   = pass.organizationName   ?? passJson.organizationName;
    pass.passTypeIdentifier = pass.passTypeIdentifier ?? PASS_TYPE_IDENTIFIER;
    pass.teamIdentifier     = pass.teamIdentifier     ?? TEAM_IDENTIFIER;
    pass.serialNumber       = pass.serialNumber       ?? serial;

    // 5) Debug koji MORA izaći u log prije asBuffer():
    console.log("[pass] instance:", {
      desc: pass.description,
      org: pass.organizationName,
      sn: pass.serialNumber,
      pti: pass.passTypeIdentifier,
      team: pass.teamIdentifier,
    });

    // 6) Sačuvaj pkpass fajl
    const outDir = abs("./output");
    ensureDir(outDir);
    const outPath = path.join(outDir, `${serial}.pkpass`);
    fs.writeFileSync(outPath, await pass.asBuffer());
    
    // 7) Očisti temp dir (optional)
    try {
      fs.rmSync(tmpModelDir, { recursive: true, force: true });
    } catch (e) {
      console.error("[pass] Cleanup failed:", e.message);
    }

    return outPath;
  }

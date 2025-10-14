import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pass } from "@walletpass/pass-js";
dotenv.config();

const {
  PASS_TYPE_IDENTIFIER,
  TEAM_IDENTIFIER,
  ORG_NAME,
  WWDR_PATH,
  CERT_PEM_PATH,
  KEY_PEM_PATH,
  KEY_PASSPHRASE,
  P12_PATH,
  P12_PASSWORD,
  TEMPLATE_DIR,
  WWDR_PEM_BASE64,
  P12_BASE64,
} = process.env;

/** Vrati putanje do wwdr i signer cert/key – koristi postojeće fajlove ili materijalizuj iz BASE64 u /tmp/certs */
function getCertificateFiles() {
  const dir = "/tmp/certs";
  fs.mkdirSync(dir, { recursive: true });

  // WWDR: koristi WWDR_PATH ako postoji i fajl je tu; inače iz BASE64
  let wwdrFile = WWDR_PATH ? path.resolve(WWDR_PATH) : null;
  if (!wwdrFile || !fs.existsSync(wwdrFile)) {
    if (!WWDR_PEM_BASE64) throw new Error("WWDR missing: set WWDR_PATH to existing file or provide WWDR_PEM_BASE64");
    wwdrFile = path.join(dir, "wwdr.pem");
    fs.writeFileSync(wwdrFile, Buffer.from(WWDR_PEM_BASE64, "base64"));
  }

  // (A) PEM par ako oba postoje
  if (CERT_PEM_PATH && KEY_PEM_PATH && fs.existsSync(CERT_PEM_PATH) && fs.existsSync(KEY_PEM_PATH)) {
    return {
      type: "PEM",
      wwdrFile,
      certFile: path.resolve(CERT_PEM_PATH),
      keyFile: path.resolve(KEY_PEM_PATH),
      keyPass: KEY_PASSPHRASE || "",
    };
  }

  // (B) P12: koristi P12_PATH ako postoji; inače iz BASE64
  let p12File = (P12_PATH && fs.existsSync(P12_PATH)) ? path.resolve(P12_PATH) : null;
  if (!p12File) {
    if (!P12_BASE64) throw new Error("P12 missing: set P12_PATH to existing file or provide P12_BASE64");
    p12File = path.join(dir, "cert.p12");
    fs.writeFileSync(p12File, Buffer.from(P12_BASE64, "base64"));
  }

  return { type: "P12", wwdrFile, p12File, p12Pass: P12_PASSWORD || "" };
}

export async function createStoreCardPass({ fullName, memberId, serialNumber }) {
  if (!fullName || !memberId) throw new Error("fullName and memberId are required");

  // 1) Certifikati (PEM ili P12; PATH ili BASE64)
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

  const serial = serialNumber || `KOS-${memberId}`;

  // 2) Runtime guard za model: kopiraj template i osiguraj pass.json
  const baseModelDir = path.resolve(TEMPLATE_DIR || "./templates/klub-osmijeha");

  const tmpModelDir = fs.mkdtempSync(path.join("/tmp", "model-"));
  (function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const e of fs.readdirSync(src)) {
      const s = path.join(src, e), d = path.join(dest, e);
      const st = fs.statSync(s);
      if (st.isDirectory()) copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  })(baseModelDir, tmpModelDir);

  const passJsonPath = path.join(tmpModelDir, "pass.json");
  let passJson = {};
  if (fs.existsSync(passJsonPath)) {
    try { passJson = JSON.parse(fs.readFileSync(passJsonPath, "utf8")); }
    catch { passJson = {}; }
  }
  passJson.formatVersion        = passJson.formatVersion ?? 1;
  passJson.description          = passJson.description ?? "Loyalty kartica";
  passJson.organizationName     = passJson.organizationName ?? (ORG_NAME || "Klub Osmijeha");
  passJson.passTypeIdentifier   = passJson.passTypeIdentifier ?? PASS_TYPE_IDENTIFIER;
  passJson.teamIdentifier       = passJson.teamIdentifier ?? TEAM_IDENTIFIER;
  passJson.backgroundColor      = passJson.backgroundColor ?? "rgb(255,255,255)";
  passJson.foregroundColor      = passJson.foregroundColor ?? "rgb(31,41,55)";
  passJson.labelColor           = passJson.labelColor ?? "rgb(31,41,55)";
  passJson.suppressStripShine   = passJson.suppressStripShine ?? true;
  passJson.storeCard            = passJson.storeCard || { primaryFields: [], secondaryFields: [], backFields: [] };
  fs.writeFileSync(passJsonPath, JSON.stringify(passJson, null, 2));

  const modelDir = tmpModelDir; // koristimo “očvrsnuti” model

  // 3) Napravi pass
  const pass = new Pass({
    model: modelDir,
    certificates,
    overrides: {
      description: passJson.description,
      organizationName: passJson.organizationName,
      passTypeIdentifier: passJson.passTypeIdentifier,
      teamIdentifier: passJson.teamIdentifier,
      serialNumber: serial,

      backgroundColor: passJson.backgroundColor,
      foregroundColor: passJson.foregroundColor,
      labelColor: passJson.labelColor,
      suppressStripShine: passJson.suppressStripShine,

      barcode: {
        message: String(memberId),
        format: "PKBarcodeFormatCode128",
        messageEncoding: "utf-8",
        altText: String(memberId),
      },

      storeCard: {
        primaryFields: passJson.storeCard.primaryFields || [],
        secondaryFields: [
          { key: "leftSpacer",  label: "", value: "", textAlignment: "PKTextAlignmentLeft",  labelColor: "rgb(255,255,255)" },
          { key: "memberFullName", label: "ČLAN", value: String(fullName), textAlignment: "PKTextAlignmentCenter" },
          { key: "rightSpacer", label: "", value: "", textAlignment: "PKTextAlignmentRight", labelColor: "rgb(255,255,255)" },
        ],
        backFields: passJson.storeCard.backFields || [
          { key: "info", label: "Informacije", value: "Kartica je vlasništvo Klub Osmijeha.\nBesplatna info linija: 0800 50243" }
        ],
      },
    },
  });

  // 4) Snimi .pkpass
  const outDir = "./output";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outPath = path.join(outDir, `${serial}.pkpass`);
  await fs.promises.writeFile(outPath, await pass.asBuffer());
  return outPath;
}

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

  const modelDir = path.resolve(TEMPLATE_DIR || "./templates/klub-osmijeha");
  const certs = getCertificateFiles();

  // @walletpass/pass-js očekuje wwdr + signer (PEM ili P12)
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

  // ✅ koristi konstruktor (tvoja verzija nema Pass.from)
  const pass = new Pass({
    model: modelDir,
    certificates,
    overrides: {
      description: "Loyalty kartica",
      organizationName: ORG_NAME || "Klub Osmijeha",
      passTypeIdentifier: PASS_TYPE_IDENTIFIER,
      teamIdentifier: TEAM_IDENTIFIER,
      serialNumber: serial,

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
        primaryFields: [],
        secondaryFields: [
          { key: "leftSpacer", label: "", value: "", textAlignment: "PKTextAlignmentLeft", labelColor: "rgb(255,255,255)" },
          { key: "memberFullName", label: "ČLAN", value: String(fullName), textAlignment: "PKTextAlignmentCenter" },
          { key: "rightSpacer", label: "", value: "", textAlignment: "PKTextAlignmentRight", labelColor: "rgb(255,255,255)" },
        ],
        backFields: [
          { key: "info", label: "Informacije", value: "Kartica je vlasništvo Klub Osmijeha.\nBesplatna info linija: 0800 50243" },
        ],
      },
    },
  });

  // Snimi .pkpass
  const outDir = "./output";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outPath = path.join(outDir, `${serial}.pkpass`);
  await fs.promises.writeFile(outPath, await pass.asBuffer());
  return outPath;
}

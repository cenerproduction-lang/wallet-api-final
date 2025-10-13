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
} = process.env;

export async function createStoreCardPass({ fullName, memberId, serialNumber }) {
  const model = path.resolve(TEMPLATE_DIR);

  const certificates = { wwdr: fs.readFileSync(path.resolve(WWDR_PATH)) };

  if (CERT_PEM_PATH && KEY_PEM_PATH && fs.existsSync(CERT_PEM_PATH) && fs.existsSync(KEY_PEM_PATH)) {
    certificates.signerCert = fs.readFileSync(path.resolve(CERT_PEM_PATH));
    certificates.signerKey = { keyFile: path.resolve(KEY_PEM_PATH), passphrase: KEY_PASSPHRASE || "" };
  } else if (P12_PATH && fs.existsSync(P12_PATH)) {
    certificates.signerCert = fs.readFileSync(path.resolve(P12_PATH));
    certificates.signerKey = { keyFile: path.resolve(P12_PATH), passphrase: P12_PASSWORD || "" };
  } else {
    throw new Error("Missing signer certificates: provide CERT_PEM_PATH/KEY_PEM_PATH or P12_PATH.");
  }

  const pass = new Pass({
    model,
    certificates,
    overrides: {
      passTypeIdentifier: PASS_TYPE_IDENTIFIER,
      teamIdentifier: TEAM_IDENTIFIER,
      organizationName: ORG_NAME,
      serialNumber,

      backgroundColor: "rgb(255,255,255)",
      foregroundColor: "rgb(31,41,55)",
      labelColor: "rgb(31,41,55)",
      suppressStripShine: true,

      barcode: {
        message: String(memberId),
        format: "PKBarcodeFormatCode128",
        messageEncoding: "utf-8",
        altText: String(memberId)
      },

      storeCard: {
        primaryFields: [],
        secondaryFields: [
          { key: "leftSpacer", label: "", value: "", textAlignment: "PKTextAlignmentLeft", labelColor: "rgb(255,255,255)" },
          { key: "memberFullName", label: "ČLAN", value: String(fullName), textAlignment: "PKTextAlignmentCenter" },
          { key: "rightSpacer", label: "", value: "", textAlignment: "PKTextAlignmentRight", labelColor: "rgb(255,255,255)" }
        ],
        backFields: [
          { key: "info", label: "Informacije", value: "Kartica je vlasništvo Klub Osmijeha.\nBesplatna info linija: 0800 50243" }
        ]
      }
    }
  });

  if (!fs.existsSync("./output")) fs.mkdirSync("./output");
  const outPath = `./output/${serialNumber}.pkpass`;
  await fs.promises.writeFile(outPath, await pass.asBuffer());
  return outPath;
}
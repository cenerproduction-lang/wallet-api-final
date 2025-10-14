export async function createStoreCardPass({ fullName, memberId, serialNumber }) {
  if (!fullName || !memberId) throw new Error("fullName and memberId are required");

  // --- 0) Certifikati
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

  // --- 1) Napravi SVJEŽI model u /tmp: novi pass.json + kopiraj SLIKE iz template-a
  const templateDir = path.resolve(TEMPLATE_DIR || "./templates/klub-osmijeha");
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template dir not found: ${templateDir}`);
  }

  const tmpModelDir = fs.mkdtempSync(path.join("/tmp", "model-"));
  fs.mkdirSync(tmpModelDir, { recursive: true });

  // 1a) Kopiraj slike (icon, icon@2x, logo, strip* ako postoje)
  const requiredImgs = ["icon.png", "icon@2x.png", "logo.png"];
  const optionalImgs = ["strip.png", "strip@2x.png"];

  for (const img of requiredImgs) {
    const src = path.join(templateDir, img);
    const dst = path.join(tmpModelDir, img);
    if (!fs.existsSync(src)) throw new Error(`Missing required image: ${img} in ${templateDir}`);
    fs.copyFileSync(src, dst);
  }
  for (const img of optionalImgs) {
    const src = path.join(templateDir, img);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpModelDir, img));
  }

  // 1b) Kreiraj potpuno novi pass.json (NE koristi postojeći)
  const safePassJson = {
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
        { key: "leftSpacer", label: "", value: "", textAlignment: "PKTextAlignmentLeft", labelColor: "rgb(255,255,255)" },
        { key: "memberFullName", label: "", value: String(fullName), textAlignment: "PKTextAlignmentCenter" },
        { key: "rightSpacer", label: "", value: "", textAlignment: "PKTextAlignmentRight", labelColor: "rgb(255,255,255)" },
      ],
      backFields: [
        {
          key: "info",
          label: "Informacije",
          value: "Kartica je vlasništvo Klub Osmijeha.\nBesplatna info linija: 0800 50243",
        },
      ],
    },
  };

  if (!safePassJson.passTypeIdentifier) throw new Error("Missing PASS_TYPE_IDENTIFIER");
  if (!safePassJson.teamIdentifier) throw new Error("Missing TEAM_IDENTIFIER");

  fs.writeFileSync(
    path.join(tmpModelDir, "pass.json"),
    JSON.stringify(safePassJson, null, 2),
    "utf8"
  );

  // --- 2) Kreiraj Pass (overrides po želji, ali nisu potrebni za opis)
  const pass = new Pass({
    model: tmpModelDir,
    certificates,
    overrides: {
      serialNumber: serial,
      // Po želji možeš dodati overrides.description = "Loyalty kartica"
    },
  });

  // --- 3) Izvezi .pkpass
  const outDir = "./output";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outPath = path.join(outDir, `${serial}.pkpass`);
  const buf = await pass.asBuffer();
  await fs.promises.writeFile(outPath, buf);
  return outPath;
}

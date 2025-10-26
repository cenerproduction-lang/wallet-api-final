import express from "express";
import { allRegistrationsForSerials, listSerialsForDevice, saveDeviceRegistration, getMappingBySerial } from "./pushStore.js";
import { sendPasskitPush } from "./pushApns.js";
import { createStoreCardPass } from "./pass.js";

const router = express.Router();

router.post("/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber", async (req, res) => {
  const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
  const { pushToken } = req.body || {};
  if (!pushToken) return res.status(400).json({ error: "pushToken required" });
  await saveDeviceRegistration({ deviceLibraryIdentifier, passTypeIdentifier, serialNumber, pushToken });
  return res.status(201).send();
});

router.get("/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier", async (req, res) => {
  const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
  const serialNumbers = await listSerialsForDevice(deviceLibraryIdentifier, passTypeIdentifier);
  return res.json({ lastUpdated: new Date().toISOString(), serialNumbers });
});

router.get("/v1/passes/:passTypeIdentifier/:serialNumber", async (req, res) => {
  const { serialNumber } = req.params;
  const map = getMappingBySerial(serialNumber);
  if (!map) return res.status(404).json({ error: "serial not found" });
  const { memberId, fullName } = map;
  try {
    const pkpassBuffer = await createStoreCardPass({ fullName, memberId, serialNumber });
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader("Last-Modified", new Date().toUTCString());
    return res.status(200).send(pkpassBuffer);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post("/admin/push-updates", async (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token !== process.env.AUTH_SECRET) return res.status(401).json({ error: "unauthorized" });
  const { serials = [] } = req.body || {};
  const regs = allRegistrationsForSerials(serials);
  const topic = process.env.PASS_TYPE_IDENTIFIER;
  const results = [];
  for (const r of regs) {
    try { await sendPasskitPush({ pushToken: r.pushToken, topic }); results.push({ serial: r.serialNumber, ok: true }); }
    catch (e) { results.push({ serial: r.serialNumber, ok: false, err: String(e?.message || e) }); }
  }
  res.json({ pushed: results.length, results });
});

export default router;

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createStoreCardPass } from "./pass.js";
import { startWorker } from "./worker.js";

const app = express();
app.use(express.json());

// health check
app.get("/", (_req, res) => res.send("Wallet API OK"));

// POST /passes { fullName, memberId, serialNumber? }
app.post("/passes", async (req, res) => {
  try {
    const { fullName, memberId, serialNumber } = req.body || {};
    if (!fullName || !memberId) {
      return res.status(400).json({ error: "fullName and memberId are required" });
    }
    const sn = serialNumber || `KOS-${memberId}`;
    await createStoreCardPass({ fullName, memberId, serialNumber: sn });
    const url = `/download/${encodeURIComponent(sn)}.pkpass`;
    res.json({ ok: true, serialNumber: sn, url });
  } catch (e) {
    console.error("PASS ERROR:", e);
    res.status(500).json({ error: "Pass generation failed", details: String(e.message || e) });
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/download", express.static(path.resolve(__dirname, "../output")));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Wallet API listening on :", port));

if (String(process.env.ENABLE_WORKER || "true").toLowerCase() === "true") {
  startWorker();
} else {
  console.log("[worker] Disabled (ENABLE_WORKER!=true)");
}

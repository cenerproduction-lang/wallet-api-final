import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createStoreCardPass } from "./pass.js";
import { startWorker } from "./worker.js";

const app = express();
app.use(express.json());

// health check
app.get("/", (_req, res) => res.send("Wallet API OK"));


app.post("/passes", async (req, res) => {
  try {
    const { fullName, memberId, serialNumber } = req.body || {};
    if (!fullName || !memberId) {
      return res.status(400).json({ ok: false, error: "fullName and memberId are required" });
    }
    const outPath = await createStoreCardPass({ fullName, memberId, serialNumber });
    const fileName = path.basename(outPath);
    return res.status(200).json({
      ok: true,
      url: `/download/${encodeURIComponent(fileName)}`,
      serialNumber: fileName.replace(/\.pkpass$/i, "")
    });
  } catch (e) {
    console.error("POST /passes error:", e);
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
      stack: String(e?.stack || "")
    });
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

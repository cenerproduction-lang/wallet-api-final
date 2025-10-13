import Papa from "papaparse";
import path from "path";
import { createStoreCardPass } from "./pass.js";

const SHEET_CSV_URL = process.env.SHEET_CSV_URL;
const POLL_SEC = Number(process.env.POLL_SEC || 60);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const BASE_URL = (process.env.BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const WRITEBACK_WEBHOOK_URL = process.env.WRITEBACK_WEBHOOK_URL || "";

const norm = v => (v ?? "").toString().trim();
const normalizeRow = row => {
  const fullName = norm(row.full_name || row.fullName);
  const memberId = norm(row.barcode_value || row.memberId);
  const email = norm(row.email || row.Email);
  const status = norm(row.status).toUpperCase() || "PENDING";
  const serial = norm(row.serial) || (memberId ? `KOS-${memberId}` : "");
  const tier = norm(row.tier || row.Tier);
  return { fullName, memberId, email, status, serial, tier, _raw: row };
};

async function fetchCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);
  return await res.text();
}

async function mapLimited(items, limit, worker) {
  const out = []; let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

async function processOnce() {
  if (!SHEET_CSV_URL) return console.warn("[worker] SHEET_CSV_URL not set");
  try {
    const csvText = await fetchCSV(SHEET_CSV_URL);
    const parsed = Papa.parse(csvText, { header: true });
    const rows = parsed.data.map(normalizeRow);
    const pending = rows.filter(r => r.status === "PENDING" && r.fullName && r.memberId);
    if (!pending.length) return console.log(`[worker] Nema PENDING redova. (poll ${POLL_SEC}s)`);

    console.log(`[worker] Obrada ${pending.length} PENDING redova...`);
    await mapLimited(pending, CONCURRENCY, async (r) => {
      try {
        await createStoreCardPass({ fullName: r.fullName, memberId: r.memberId, serialNumber: r.serial });
        const url = `${BASE_URL}/download/${encodeURIComponent(r.serial)}.pkpass`;
        console.log(`✅ ${r.fullName} (${r.memberId}) -> ${url}`);

        if (WRITEBACK_WEBHOOK_URL) {
          await fetch(WRITEBACK_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              barcode_value: r.memberId,
              pass_url: url,
              status: "DONE",
              serial: r.serial,
              sent_at: new Date().toISOString()
            })
          }).catch(e => console.error("Write-back error:", e.message || e));
        }
      } catch (e) {
        console.error(`❌ Greška za ${r.fullName} (${r.memberId}):`, e.message || e);
        if (WRITEBACK_WEBHOOK_URL) {
          await fetch(WRITEBACK_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ barcode_value: r.memberId, status: "ERROR", error: String(e.message || e) })
          }).catch(() => {});
        }
      }
    });
  } catch (e) {
    console.error("[worker] Fatal:", e.message || e);
  }
}

export function startWorker() {
  console.log(`[worker] Start (poll each ${POLL_SEC}s)`);
  processOnce();
  setInterval(processOnce, POLL_SEC * 1000);
}
// scripts/fromSheet.js (Finalna, ispravljena verzija)

import Papa from "papaparse";

const API_URL = process.env.API_URL || "http://localhost:8080";
const SHEET_CSV_URL = process.env.SHEET_CSV_URL;
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);

const norm = v => (v ?? "").toString().trim();
const normalizeRow = r => {
  // KORISTIMO VAŠE NAZIVE KOLONA: full_name, email, barcode_value, serial, status
  const fullName = norm(r.full_name);
  const memberId = norm(r.barcode_value);
  const status = norm(r.status).toUpperCase() || "PENDING";
  const serialNumber = norm(r.serial) || (memberId ? `KOS-${memberId}` : "");
  const email = norm(r.email); // KLJUČNO: Učitavamo email
  
  // Ovdje možete dodati i druge kolone kao npr. tier ako želite:
  // const tier = norm(r.tier);
  
  return { fullName, memberId, status, serialNumber, email }; // Vraćamo i email
};

async function mapLimited(items, limit, worker) {
  const out = []; let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

async function main() {
  if (!SHEET_CSV_URL) throw new Error("SHEET_CSV_URL not set");
  const csvText = await (await fetch(SHEET_CSV_URL)).text();
  const rows = Papa.parse(csvText, { header: true }).data.map(normalizeRow);
  
  // Filtriramo PENDING redove koji imaju fullName, memberId I email
  const pending = rows.filter(r => r.status === "PENDING" && r.fullName && r.memberId && r.email);

  await mapLimited(pending, CONCURRENCY, async (r) => {
    const res = await fetch(`${API_URL}/passes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Šaljemo sve potrebne podatke, UKLJUČUJUĆI email
      body: JSON.stringify({ fullName: r.fullName, memberId: r.memberId, serialNumber: r.serialNumber, email: r.email })
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    console.log(r.memberId, res.ok ? "OK" : "ERR", json.url || json);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exit(1); });
}

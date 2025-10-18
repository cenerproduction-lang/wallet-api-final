// src/index.js (Novi, kompletan sadržaj)
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createStoreCardPass } from "./pass.js";
import nodemailer from "nodemailer"; // <-- NOVO: Nodemailer

// Uklanjamo import { startWorker } from "./worker.js"; jer worker.js brišemo.

const app = express();
app.use(express.json());

// --- ENV ZA EMAIL (Dodano) ---
const { PUBLIC_URL, SENDER_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

// Nodemailer Transporter
const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT),
    secure: false, // Koristite 'false' za port 587 (STARTTLS)
    requireTLS: true,
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
    },
});

// --- FUNKCIJA ZA SLANJE EMAILA (Dodano) ---
async function sendPassEmail(toEmail, fullName, passPath, passUrl) {
    const mailOptions = {
        from: SENDER_EMAIL,
        to: toEmail,
        subject: `Vaša Klub Osmijeha - Loyalty kartica je spremna!`,
        html: `
            <p>Poštovani/a ${fullName},</p>
            <p>Vaša kartica **Klub Osmijeha** je u prilogu. Molimo Vas da preuzmete **.pkpass** fajl.</p>
            <p>Klikom na fajl, automatski ćete je dodati u Apple Wallet (ili kompatibilni Google Pay/Wallet na Androidu).</p>
            <p>Hvala Vam na lojalnosti.</p>
            <p>S poštovanjem,<br>Klub Osmijeha</p>
        `,
        attachments: [{
            filename: path.basename(passPath),
            path: passPath,
            contentType: 'application/vnd.apple.pkpass' // Ključni MIME tip
        }]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[mail] Email uspješno poslan na: ${toEmail} sa prilogom.`);
        // Vratite URL kako biste ga mogli zapisati u Sheets (ako je potrebno)
        return true;
    } catch (error) {
        console.error(`[mail] Greška pri slanju e-maila na ${toEmail}:`, error.message);
        return false;
    }
}


// health check
app.get("/", (_req, res) => res.send("Wallet API OK"));


app.post("/passes", async (req, res) => {
  try {
    // NOVO: Dodajemo 'email' u destrukciju
    const { fullName, memberId, serialNumber, email } = req.body || {};
    
    // NOVO: Provjera email-a
    if (!fullName || !memberId || !email) {
      return res.status(400).json({ ok: false, error: "fullName, memberId, and email are required" });
    }
    
    // 1. Kreiraj Pass
    const outPath = await createStoreCardPass({ fullName, memberId, serialNumber });
    const fileName = path.basename(outPath);
    const passUrl = `${PUBLIC_URL}/download/${encodeURIComponent(fileName)}`; // Koristimo PUBLIC_URL
    
    // 2. Pošalji e-mail
    const emailSent = await sendPassEmail(email, fullName, outPath, passUrl);

    if (!emailSent) {
      // Ako e-mail ne ode, ne želimo da fromSheet misli da je sve u redu
      throw new Error("Pass generated, but email sending failed.");
    }
    
    // 3. Pošalji odgovor natrag fromSheet.js
    return res.status(200).json({
      ok: true,
      url: passUrl, // Koristimo full URL ovdje
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

// Koristimo /download endpoint za služenje pkpass fajlova
app.use("/download", express.static(path.resolve(__dirname, "../output")));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Wallet API listening on :", port));

// UKLANJAMO startWorker() jer je bio referenca na nepostojeći worker.js
// Uklonili smo:
// if (String(process.env.ENABLE_WORKER || "true").toLowerCase() === "true") {
//   startWorker();
// } else {
//   console.log("[worker] Disabled (ENABLE_WORKER!=true)");
// }

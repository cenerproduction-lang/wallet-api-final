import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createStoreCardPass } from "./pass.js";
import nodemailer from "nodemailer";

const app = express();
app.use(express.json());

// --- ENV ZA EMAIL ---
const { PUBLIC_URL, SENDER_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

// --- NODEMAILER TRANSPORTER (POJAČANO) ---
const effPort = Number(SMTP_PORT || 587); // Efektivni port

const transporter = nodemailer.createTransport({
    host: SMTP_HOST || "smtp.gmail.com",
    port: effPort,
    // secure = true samo ako je port 465 (Gmail SSL)
    secure: effPort === 465,
    // requireTLS = true samo ako je port 587 (Gmail STARTTLS)
    requireTLS: effPort === 587,
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
    },
});

// LOG: verifikacija konekcije (pomoći će nam da vidimo tačan razlog ako ne radi)
transporter.verify((err) => {
    if (err) {
        console.error("[smtp] verify FAILED:", err.code || "", err.message || "", err.response || "");
    } else {
        console.log("[smtp] verify OK");
    }
});
// ------------------------------------------

// --- FUNKCIJA ZA SLANJE EMAILA (POJAČANO LOGIRANJE I HTML) ---
async function sendPassEmail(toEmail, fullName, passPath) {
    try {
        await transporter.sendMail({
            from: SENDER_EMAIL,
            to: toEmail,
            subject: "Vaša Klub Osmijeha - Loyalty kartica je spremna!",
            html: `
                <p>Poštovani/a ${fullName},</p>
                <p>Vaša kartica <strong>Klub Osmijeha</strong> je u prilogu. Preuzmite <strong>.pkpass</strong> fajl i otvorite ga na iPhoneu (Apple Wallet).</p>
                <p>Napomena: Na Androidu koristite aplikaciju za .pkpass (npr. WalletPasses).</p>
                <p>Hvala Vam na lojalnosti.</p>
                <p>S poštovanjem,<br>Klub Osmijeha</p>
            `,
            attachments: [{
                filename: path.basename(passPath),
                path: passPath,
                contentType: 'application/vnd.apple.pkpass' // Ključni MIME tip
            }]
        });
        console.log(`[mail] OK -> ${toEmail}`);
        return true;
    } catch (e) {
        // Pojačano logiranje greške pri slanju
        console.error("[mail] FAIL:", e.code || "", e.message || "", e.response || "");
        return false;
    }
}


// health check
app.get("/", (_req, res) => res.send("Wallet API OK"));


app.post("/passes", async (req, res) => {
    // 1. Validacija (POJAČANA)
    const body = req.body || {};
    const missing = ["fullName", "memberId", "email"].filter(k => !body[k] || String(body[k]).trim() === "");
    if (missing.length) return res.status(400).json({ ok: false, error: "missing_fields", missing });

    const badEmail = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email);
    if (badEmail) return res.status(400).json({ ok: false, error: "invalid_email", email: body.email });
    
    // Podaci su čisti
    const { fullName, memberId, serialNumber, email } = body;

    try {
        // 2. Kreiraj Pass
        const outPath = await createStoreCardPass({ fullName, memberId, serialNumber });
        const fileName = path.basename(outPath);
        const passUrl = `${PUBLIC_URL || ''}/download/${encodeURIComponent(fileName)}`;
        
        // 3. Pošalji e-mail
        const emailSent = await sendPassEmail(email, fullName, outPath);

        if (!emailSent) {
            // Bacamo grešku koju će uhvatiti donji catch blok
            throw new Error("Pass generated, but email sending failed. Check SMTP settings.");
        }
        
        // 4. Pošalji odgovor natrag fromSheet.js
        return res.status(200).json({
            ok: true,
            url: passUrl,
            serialNumber: fileName.replace(/\.pkpass$/i, "")
        });
    } catch (e) {
        // Ovaj catch blok će uhvatiti i grešku iz sendPassEmail
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

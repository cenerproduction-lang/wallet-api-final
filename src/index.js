import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createStoreCardPass } from "./pass.js";
import webservice from "./webservice.js"; // <-- NOVI IMPORT
// Nodemailer i logika za slanje e-maila su uklonjeni
// jer slanje preuzima Google Apps Script.

const app = express();
app.use(express.json());

// --- ENV ZA SKIP EMAIL I PUBLIC_URL ---
const { PUBLIC_URL } = process.env;
const SKIP_EMAIL_ENV = process.env.SKIP_EMAIL === "true";

// Čisti URL bazu i uklanja eventualnu duplu kosu crtu
const baseUrl = (PUBLIC_URL || "").replace(/\/+$/, "");

// health check
app.get("/", (_req, res) => res.send("Wallet API OK"));


app.post("/passes", async (req, res) => {
    const body = req.body || {};
    
    // Provjerava ENV ili 'noEmail' u tijelu zahtjeva (podržava true/string 'true')
    const skipEmail = SKIP_EMAIL_ENV || body.noEmail === true || body.noEmail === "true";

    // 1. Validacija (POJAČANA)
    const missing = ["fullName", "memberId", "email"].filter(k => !body[k] || String(body[k]).trim() === "");
    if (missing.length) {
        return res.status(400).json({ ok: false, error: "missing_fields", missing });
    }

    const badEmail = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email);
    if (badEmail) {
        return res.status(400).json({ ok: false, error: "invalid_email", email: body.email });
    }
    
    // Podaci su čisti
    const { fullName, memberId, serialNumber } = body;

    try {
        // 2. Kreiraj Pass
        const outPath = await createStoreCardPass({ fullName, memberId, serialNumber });
        const fileName = path.basename(outPath);
        
        // Formiranje URL-a s čistom bazom
        const passUrl = `${baseUrl}/download/${encodeURIComponent(fileName)}`;
        
        // 3. Provjera da klijent ne pokušava poslati mail (što je sada isključeno)
        if (!skipEmail) {
            // Vraća 501 (Not Implemented/Disabled) da bude jasnije
            console.error("GRESKA: API je postavljen da preskoči slanje e-maila, ali klijent to nije zatražio.");
            return res.status(501).json({ ok: false, error: "email_sending_disabled" });
        }
        
        // 4. Pošalji odgovor natrag Apps Scriptu
        return res.status(200).json({
            ok: true,
            url: passUrl,
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

// NEW: Mountaj PassKit web-service router
app.use(webservice); // <--- NOVO

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Koristimo /download endpoint za služenje pkpass fajlova
app.use("/download", express.static(path.resolve(__dirname, "../output")));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Wallet API listening on :", port));

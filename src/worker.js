import path from "path";
import dotenv from "dotenv";
import Papa from "papaparse";
import fs from "fs";
import { GoogleSheet } from "./sheet.js";
import { createStoreCardPass } from "./pass.js";
import nodemailer from "nodemailer"; // <-- NOVO

dotenv.config();

/* ==== ENV KONFIGURACIJA ==== */
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SA_CREDENTIALS = process.env.GOOGLE_SA_CREDENTIALS;
const PUBLIC_URL = process.env.PUBLIC_URL; // npr. https://wallet-api-final-production.up.railway.app

// SMTP Konfiguracija za Gmail
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT || '587';
const SENDER_EMAIL = process.env.SENDER_EMAIL; // cenerproduction@gmail.com

// Provjera minimalne konfiguracije
if (!GOOGLE_SHEET_ID || !GOOGLE_SA_CREDENTIALS || !PUBLIC_URL) {
    console.error("FATAL: Missing GOOGLE_SHEET_ID, GOOGLE_SA_CREDENTIALS, or PUBLIC_URL in ENV.");
    process.exit(1);
}

// Nodemailer Transporter (prilagođen za port 587/STARTTLS)
const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT),
    secure: false, // Port 587 koristi STARTTLS, ne SSL
    requireTLS: true,
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
    },
});

/* ==== E-MAIL FUNKCIJA ==== */

/** Šalje e-mail sa linkom na generisani .pkpass fajl. */
async function sendPassEmail(toEmail, fullName, passUrl) {
    const mailOptions = {
        from: SENDER_EMAIL,
        to: toEmail,
        subject: `Vaša Klub Osmijeha - Loyalty kartica`,
        html: `
            <p>Poštovani/a ${fullName},</p>
            <p>Vaša kartica **Klub Osmijeha** sada je dostupna. Ulaskom na link dodajete karticu u Apple Wallet (ili Google Pay, ako imate instaliranu podršku za PKPASS):</p>
            <p><a href="${passUrl}"><strong>KLIKNITE OVDJE DA DODATE KARTICU U WALLET</strong></a></p>
            <p>Hvala Vam na lojalnosti.</p>
            <p>S poštovanjem,<br>Klub Osmijeha</p>
            <hr>
            <p style="font-size: 10px; color: #999;">Link: ${passUrl}</p>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[mail] Email uspješno poslan na: ${toEmail}`);
        return true;
    } catch (error) {
        console.error(`[mail] Greška pri slanju e-maila na ${toEmail}:`, error.message);
        return false;
    }
}

/* ==== GLAVNA LOGIKA RADNIKA (WORKER-a) ==== */

/** Učitava redove, pronalazi one s 'PENDING' statusom i obrađuje ih. */
async function processPendingRows(sheet) {
    console.log("[worker] Učitavanje redova...");
    const rows = await sheet.readRows();

    // Redovi se parsiraju s naslovima: E-MAIL, FULL NAME, MEMBER ID, SERIAL, STATUS, PASS REF
    const pendingRows = rows.filter(row => row.status && row.status.toUpperCase() === 'PENDING');
    
    console.log(`[worker] Pronađeno ${pendingRows.length} PENDING redova za obradu.`);

    for (const row of pendingRows) {
        const {
            email,
            'full name': fullName,
            'member id': memberId,
            serial,
            rowNumber // Koristi se za ažuriranje Sheet-a
        } = row;

        // Ključna provjera
        if (!email || email.trim() === '') {
            console.error(`❌ Greška za ${fullName} (${memberId}): Nema navedenog emaila.`);
            continue;
        }

        try {
            // 1. KREIRAJ PKPASS FAJL
            const passPath = await createStoreCardPass({
                fullName: fullName,
                memberId: memberId,
                serialNumber: serial
            });
            
            // Kreiranje javnog URL-a za link u mailu
            const passUrl = `${PUBLIC_URL}/${path.basename(passPath)}`;
            
            console.log(`[pass] PKPASS kreiran: ${passPath}`);

            // 2. POŠALJI E-MAIL
            const emailSent = await sendPassEmail(email, fullName, passUrl);

            if (emailSent) {
                // 3. AŽURIRAJ STATUS u Sheet-u ako je e-mail USPJEŠNO poslan
                await sheet.updateRow(rowNumber, {
                    status: 'DONE',
                    'pass ref': passUrl,
                    'sent at': new Date().toLocaleDateString('hr-BA'),
                });
                console.log(`✅ ${fullName} (${memberId}): Obrada GOTOVA. Link: ${passUrl}. Email poslan.`);
            } else {
                // Ako e-mail nije poslan, samo logujemo grešku (može se pokušati ponovo)
                console.error(`❌ Greška za ${fullName} (${memberId}): PKPASS generisan, ali email NIJE poslan. Status nije promijenjen.`);
            }

        } catch (e) {
            console.error(`❌ FATAL Greška za ${fullName} (${memberId}): ${e.message}`);
            // Ovdje možete dodati logiku za postavljanje statusa na FAILED ako želite
        }
    }
}

/** Glavna funkcija za inicijalizaciju i pokretanje radnika. */
export async function runWorker() {
    try {
        const sheet = new GoogleSheet(GOOGLE_SHEET_ID, GOOGLE_SA_CREDENTIALS);
        await processPendingRows(sheet);
        console.log("[worker] Radnik završio obradu.");
    } catch (error) {
        console.error("[worker] FATAL error u radniku:", error);
    }
}

runWorker(); // Pokreće radnika odmah

// Možete dodati setInterval ako želite da se Worker ponavlja
// setInterval(runWorker, 300000); // Ponovi svakih 5 minuta (300000 ms)

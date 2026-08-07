const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const path = require('path');
const archiver = require('archiver');
const stream = require('stream');
const QRCode = require('qrcode');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { buildVerifyURL, registerCertificateInTurso, updateCertificateInTurso, updateTursoLogbookEntry } = require('../utils/certEncryption');
require('dotenv').config();

// Correctly import your database pool from your db.js file
// Note: You may need to adjust this path based on your folder structure
const dbPool = require('../db');

// --- Helper Functions ---
// Helper: Execute Turso Sync via HTTP
const executeTurso = async (sql, args) => {
  const dbUrl = process.env.TURSO_DB_URL?.replace(/^libsql:/, 'https:');
  const authToken = process.env.TURSO_AUTH_TOKEN;
  
  if (!dbUrl || !authToken) {
    return null;
  }
 
  const hranaArgs = args.map(arg => {
    if (arg === null || arg === undefined) return { type: "null" };
    if (typeof arg === 'number') return { type: "float", value: arg };
    return { type: "text", value: String(arg) };
  });
 
  const body = {
    requests: [
      { type: "execute", stmt: { sql, args: hranaArgs } },
      { type: "close" }
    ]
  };
 
  try {
    const response = await fetch(`${dbUrl}/v2/pipeline`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloud Database Sync Error: ${response.status} ${errorText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('Cloud Database Error:', err.message);
    return null;
  }
};

// ─── Helper: Insert into Cloud Database logbook and return the formatted REFERENCE_NUMBER ───
// Throws error if Turso is unavailable or generation fails - no fallback to UUID
const getTursoRefNumber = async (particulars, addressee, transmitterName, encodedBy) => {
  try {
    const insertResult = await executeTurso(
      "INSERT INTO Digital_Logbook (PARTICULARS, ADDRESSE, TRANSMITTER, SECTION, MODE_OF_TRANSMITTAL, ENCODED_BY, REMARKS) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [particulars, addressee, transmitterName || '', 'Admin', 'Walk-in', encodedBy || '', '']
    );
    const rowId = insertResult?.results?.[0]?.response?.result?.last_insert_rowid;
    if (!rowId) {
      throw new Error('Failed to insert into Cloud Database Digital_Logbook: no row ID returned');
    }

    // ✅ ADD RETRY LOGIC: Wait for Turso to generate REFERENCE_NUMBER
    let refNumber = null;
    let retries = 0;
    const maxRetries = 5;
    const retryDelay = 100; // milliseconds

    while (!refNumber && retries < maxRetries) {
      try {
        const fetchResult = await executeTurso(
          "SELECT REFERENCE_NUMBER FROM Digital_Logbook WHERE id = ?",
          [rowId]
        );
        const rows = fetchResult?.results?.[0]?.response?.result?.rows;
        if (rows && rows.length > 0 && rows[0][0]) {
          refNumber = rows[0][0].value;
          break; // Success, exit retry loop
        }
      } catch (fetchErr) {
        // Fetch attempt failed, will retry
      }

      retries++;
      if (!refNumber && retries < maxRetries) {
        // Wait before next retry
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    if (!refNumber) {
      throw new Error(`[getTursoRefNumber] Could not fetch REFERENCE_NUMBER after ${maxRetries} retries for row ID ${rowId}. Cloud Database may be unavailable or slow.`);
    }

    return refNumber;
  } catch (err) {
    console.error('[getTursoRefNumber] Fatal error:', err.message);
    throw new Error(`Failed to generate reference number from Cloud Database: ${err.message}`);
  }
};

const formatDate = (dateString) => {
if (!dateString) return '';
const date = new Date(dateString);
if (isNaN(date.getTime())) return dateString || ''; // Return original string or empty if invalid
return new Intl.DateTimeFormat('en-US', {
 year: 'numeric',
 month: 'long',
 day: 'numeric',
}).format(date);
};

const getOrdinalSuffix = (day) => {
if (day > 3 && day < 21) return 'th';
switch (day % 10) {
 case 1: return "st";
 case 2: return "nd";
 case 3: return "rd";
 default: return "th";
}
};

// --- Main Drawing Function for a Single Certificate ---
const drawCertificate = (doc, data) => {
const timesBold = 'Times-Bold';
const timesRoman = 'Times-Roman';
const timesItalic = 'Times-Italic'

try {
 const topDesignPath = path.join(__dirname, '../assets/Top.png');
 const psaLogoPath = path.join(__dirname, '../assets/logo.png');
 const bagoLogoPath = path.join(__dirname, '../assets/Bagong.png');
 const bottomDesignPath = path.join(__dirname, '../assets/Bottom.png');

 doc.image(psaLogoPath, 30, 30, { width: 80 });
 doc.image(bagoLogoPath, 120, 30, { width: 80 });
 doc.image(topDesignPath, doc.page.width - 357, 0, { width: 357 });
 doc.image(bottomDesignPath, 0, doc.page.height - 357, { width: 361 });
} catch (err) {
 console.error("Error embedding images, please check file paths:", err.message);
}

// --- Top Section ---
doc.font(timesRoman).fontSize(16).text('This', 72, 150, { align: 'center' });
doc.moveDown(1);
const typeText = data.certType || 'Participation';
doc.font(timesBold).fontSize(32).text(`Certificate of ${typeText}`, { align: 'center' });
doc.moveDown(0.5);
doc.font(timesRoman).fontSize(16).text('is presented to', { align: 'center' });

// --- Recipient Name Block ---
const nameY = 280;
const nameMaxWidth = doc.page.width - (2 * 60);
let nameFontSize = 38;
const minNameFontSize = 18;
doc.font(timesBold);
while (nameFontSize > minNameFontSize) {
 const currentWidth = doc.fontSize(nameFontSize).widthOfString(data.name);
 if (currentWidth <= nameMaxWidth) break;
 nameFontSize--;
}
doc.fontSize(nameFontSize).text(data.name, 60, nameY, { width: nameMaxWidth, align: 'center', lineBreak: false });

// --- Position subsequent text ---
const afterNameY = nameY + 50;
let descriptiveText = '';
switch(typeText) {
    case 'Completion':
        descriptiveText = 'for successfully completing the';
        break;
    case 'Appreciation':
        descriptiveText = 'in grateful and sincere appreciation of the invaluable services rendered as resource person in the';
        break;
    case 'Participation':
    default:
        descriptiveText = 'for actively participating in the';
        break;
}
doc.font(timesRoman).fontSize(16).text(descriptiveText, 60, afterNameY, { align: 'center' });

// --- Training Title Block ---
const titleY = afterNameY + 40;
const titleWidth = doc.page.width - (2 * 60);
const titleHeight = 120;
let titleFontSize = 42;
const minTitleFontSize = 14;
doc.font(timesRoman);
while (titleFontSize > minTitleFontSize) {
 doc.fontSize(titleFontSize);
 const currentHeight = doc.heightOfString(data.trainingTitle, { width: titleWidth });
 if (currentHeight <= titleHeight) break;
 titleFontSize--;
}
doc.fontSize(titleFontSize).text(data.trainingTitle, 60, titleY, { width: titleWidth, height: titleHeight, align: 'center', valign: 'center' });
doc.moveDown(0.5);

// --- Date/Venue Block ---
let dateText = (typeText === 'Appreciation') ? 'held' : `for ${data.thours} hours`;
if (data.startDate && data.endDate) {
 const startDate = new Date(data.startDate);
 const endDate = new Date(data.endDate);
 if (!isNaN(startDate) && !isNaN(endDate)) {
 const startDay = startDate.getDate();
 const endDay = endDate.getDate();
 const startMonth = startDate.getMonth();
 const endMonth = endDate.getMonth();
 const startYear = startDate.getFullYear();
 const endYear = endDate.getFullYear();
 if (startYear === endYear && startMonth === endMonth && startDay === endDay) {
  dateText += ` on ${formatDate(data.startDate)}`;
 } else if (startYear === endYear && startMonth === endMonth) {
  const monthName = startDate.toLocaleString('en-US', { month: 'long' });
  dateText += ` on ${monthName} ${startDay}-${endDay}, ${startYear}`;
 } else {
  dateText += ` from ${formatDate(data.startDate)} to ${formatDate(data.endDate)}`;
 }
 }
}
doc.font(timesRoman).fontSize(16);
doc.text(dateText, { align: 'center' });
doc.moveDown(0.5);
doc.text(`at ${data.venue}`, { align: 'center' });
doc.moveDown(0.5);
const givenDate = new Date(data.endDate);
const day = givenDate.getDate();
const month = givenDate.toLocaleString('en-US', { month: 'long' });
const year = givenDate.getFullYear();
const givenDateText = `Given this ${day}${getOrdinalSuffix(day)} day of ${month} ${year}.`;
doc.text(givenDateText, { align: 'center' });

// --- Signature Section ---
const signatureY = doc.page.height - 200;
const leftMargin = 72;
const writableWidth = doc.page.width - (leftMargin * 2);

doc.font(timesBold).fontSize(22).text('MARIBEL M. DALAYDAY', leftMargin, signatureY, { width: writableWidth, align: 'center' });

const sigLineWidth = 260;
const sigLineX = (doc.page.width - sigLineWidth) / 2;
doc.moveTo(sigLineX, signatureY + 25).lineTo(sigLineX + sigLineWidth, signatureY + 25).stroke();

doc.font(timesRoman).fontSize(14).text('Chief Statistical Specialist', leftMargin, signatureY + 30, { width: writableWidth, align: 'center' });

// --- QR Code Validation Section ---
if (data.qrCodeDataUrl) {
  const qrSize = 90;
  const rightMargin = 60;
  const bottomPos = 135;
  const padding = 4;
  const qrX = doc.page.width - rightMargin - qrSize;
  const qrY = doc.page.height - bottomPos;

  // Temporarily disable bottom margin to allow printing in the footer area
  const originalBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  doc.rect(qrX - padding, qrY - padding, qrSize + padding * 2, qrSize + padding * 2).fill('#ffffff');
  doc.fillColor('#000000');
  doc.image(data.qrCodeDataUrl, qrX, qrY, { width: qrSize });
  doc.font(timesRoman).fontSize(8).text(`Certificate No: ${data.refNumber}`, doc.page.width - rightMargin - 200, qrY + qrSize + 5, { width: 200, align: 'right' });
  doc.text('Scan to verify details', doc.page.width - rightMargin - 200, qrY + qrSize + 15, { width: 200, align: 'right' });

  doc.page.margins.bottom = originalBottomMargin;
}
};


// =================================================================
// === YOUR EXISTING ROUTES ========================================
// =================================================================
router.post('/generate-certificate', async (req, res) => {
const data = req.body;

const startFmt = formatDate(data.startDate);
const endFmt = formatDate(data.endDate);
const dateString = (startFmt === endFmt) ? startFmt : `${startFmt} - ${endFmt}`;

// --- Turso Logging + get formatted REFERENCE_NUMBER as certificate number ---
const refNumber = await getTursoRefNumber('Training Certificate', data.name, data.transmitterName, data.encodedBy);

// Generate encrypted QR verification URL
const qrUrl = buildVerifyURL(refNumber, 'training', data.name);
const qrToken = qrUrl.split('?t=')[1]; // preserve token so regenerations produce identical QR
const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
  errorCorrectionLevel: 'M',
  width: 512
});

// --- Local DB Logging (certificate_registry) ---
try {
    const recipientNameLocal = `${data.first_name} ${data.middle_initial || ''} ${data.last_name} ${data.suffix || ''}`.replace(/\s+/g, ' ').trim();
    await dbPool.query(
        "INSERT IGNORE INTO certificate_registry (reference_number, certificate_type, recipient_name, details, issued_at) VALUES (?, ?, ?, ?, ?)",
        [refNumber, 'training', recipientNameLocal, JSON.stringify({ training_title: data.trainingTitle, training_dates: dateString, training_hours: data.hours || data.thours, qr_token: qrToken, source: 'employee', venue: data.venue }), new Date().toISOString()]
    );
} catch (localDbErr) {
    console.error("Failed to log generated training certificate locally:", localDbErr.message);
}

// --- Turso Certificate Registry (for online validation) ---
await registerCertificateInTurso(executeTurso, {
  refNumber,
  certType: 'training',
  recipientName: data.name,
  details: { trainingTitle: data.trainingTitle, dates: dateString, hours: data.hours || data.thours, venue: data.venue },
});

if (data.type !== 'Training') {
 return res.status(400).send('This endpoint only supports Training certificates.');
}
const doc = new PDFDocument({
  size: 'A4',
  margin: 72,
  ownerPassword: process.env.PDF_OWNER_PASSWORD,
  pdfVersion: '1.7ext3',
  encryption: {
    v: 4,
    r: 4,
    length: 128
  },
  permissions: {
    printing: 'highResolution',
    modifying: false,
    copying: false,
    annotating: false,
    fillingForms: false,
    contentAccessibility: false,
    documentAssembly: false
  }
});
res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', `attachment; filename="Certificate-${data.name}.pdf"`);
doc.pipe(res);
drawCertificate(doc, { ...data, qrCodeDataUrl, refNumber });
doc.end();
});

router.post('/generate-batch-training-certificate', async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: "Request body is missing." });
    }

    // --- NEW: Handle Batch for Multiple Temporary Employees (from CSV) ---
    if (req.body.certificates && Array.isArray(req.body.certificates)) {
      const { certificates, transmitterName, encodedBy, certType } = req.body;

      try {
        const duplicateErrors = [];
        for (const cert of certificates) {
          const recipientNameLocal = `${cert.first_name || ''} ${cert.middle_initial || ''} ${cert.last_name || ''} ${cert.suffix || ''}`.replace(/\s+/g, ' ').trim() || cert.name;
          const [existingUser] = await dbPool.query(
            "SELECT id FROM certificate_registry WHERE certificate_type = 'training' AND recipient_name = ? AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.training_title')) = ? LIMIT 1",
            [recipientNameLocal, cert.trainingTitle]
          );
          if (existingUser.length > 0) {
            duplicateErrors.push({ name: recipientNameLocal, title: cert.trainingTitle });
          }
        }
        if (duplicateErrors.length > 0) {
          return res.status(409).json({ message: JSON.stringify({ type: 'DUPLICATES', duplicates: duplicateErrors }) });
        }
      } catch (innerErr) {
        console.error('[generate-batch-training-certificate] individual duplicate check failed:', innerErr.message);
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 72,
        ownerPassword: process.env.PDF_OWNER_PASSWORD,
        pdfVersion: '1.7ext3',
        encryption: { v: 4, r: 4, length: 128 },
        permissions: {
          printing: 'highResolution', modifying: false, copying: false,
          annotating: false, fillingForms: false, contentAccessibility: false, documentAssembly: false
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Batch-Certificates-${Date.now()}.pdf"`);
      doc.pipe(res);

      for (let i = 0; i < certificates.length; i++) {
        const cert = certificates[i];

        const startFmt = formatDate(cert.startDate);
        const endFmt = formatDate(cert.endDate);
        const dateString = (startFmt === endFmt) ? startFmt : `${startFmt} - ${endFmt}`;

        // --- Turso Logging + get formatted REFERENCE_NUMBER as certificate number ---
        const refNumber = await getTursoRefNumber('Training Certificate', cert.name, transmitterName, encodedBy);

        // Generate encrypted QR verification URL
        const qrUrl = buildVerifyURL(refNumber, 'training', cert.name);
        const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
          errorCorrectionLevel: 'M',
          width: 512
        });

        // Local DB Log
        try {
          const recipientNameLocal = `${cert.first_name || ''} ${cert.middle_initial || ''} ${cert.last_name || ''} ${cert.suffix || ''}`.replace(/\s+/g, ' ').trim();
          await dbPool.query(
            "INSERT IGNORE INTO certificate_registry (reference_number, certificate_type, recipient_name, details, issued_at) VALUES (?, ?, ?, ?, ?)",
            [refNumber, 'training', recipientNameLocal, JSON.stringify({ training_title: cert.trainingTitle, training_dates: dateString, training_hours: cert.hours || cert.thours, source: 'external_partner', venue: cert.venue }), new Date().toISOString()]
          );
        } catch (localDbErr) {
          console.error("Failed to log generated temp certificate locally:", localDbErr.message);
        }

        // Turso Certificate Registry (for online validation)
        await registerCertificateInTurso(executeTurso, {
          refNumber,
          certType: 'training',
          recipientName: cert.name,
          details: { trainingTitle: cert.trainingTitle, dates: dateString, hours: cert.hours || cert.thours, venue: cert.venue },
        });

        drawCertificate(doc, { ...cert, qrCodeDataUrl, refNumber, thours: cert.hours || cert.thours, certType });
        if (i < certificates.length - 1) doc.addPage();
      }
      doc.end();
      return;
    }

    const { name, trainings, first_name, middle_initial, last_name, suffix } = req.body;
    
    if (!trainings || !Array.isArray(trainings)) {
       return res.status(400).json({ error: "Invalid request: 'trainings' array is required for single-employee batch generation." });
    }

    if (!trainings || !Array.isArray(trainings) || trainings.length === 0) {
      return res.status(400).send('No training data provided for batch generation.');
    }
    const doc = new PDFDocument({
      size: 'A4',
      margin: 72,
      ownerPassword: process.env.PDF_OWNER_PASSWORD,
      pdfVersion: '1.7ext3',
      encryption: {
        v: 4,
        r: 4,
        length: 128
      },
      permissions: {
        printing: 'highResolution',
        modifying: false,
        copying: false,
        annotating: false,
        fillingForms: false,
        contentAccessibility: false,
        documentAssembly: false
      }
    });
    const safeName = (name || 'employee').replace(/[<>:"/\\|?*]+/g, "_");
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Batch-Training-Certificates-${safeName}.pdf"`);
    doc.pipe(res);

    // Use for...of loop to handle async QR generation
    for (let i = 0; i < trainings.length; i++) {
      const training = trainings[i];
      const startFmt = formatDate(training.startDate);
      const endFmt = formatDate(training.endDate);
      const dateString = (startFmt === endFmt) ? startFmt : `${startFmt} - ${endFmt}`;

      // --- Turso Logging + get formatted REFERENCE_NUMBER as certificate number ---
      const refNumber = await getTursoRefNumber('Training Certificate', name, req.body.transmitterName, req.body.encodedBy);

      // Generate encrypted QR verification URL
      const qrUrl = buildVerifyURL(refNumber, 'training', name);
      const qrToken = qrUrl.split('?t=')[1];
      const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'M',
        width: 512
      });

      // --- Local DB Logging (certificate_registry) ---
      try {
          const recipientNameLocal = `${first_name} ${middle_initial || ''} ${last_name} ${suffix || ''}`.replace(/\s+/g, ' ').trim();
          await dbPool.query(
              "INSERT IGNORE INTO certificate_registry (reference_number, certificate_type, recipient_name, details, issued_at) VALUES (?, ?, ?, ?, ?)",
              [refNumber, 'training', recipientNameLocal, JSON.stringify({ training_title: training.trainingTitle, training_dates: dateString, training_hours: training.hours || training.thours, source: 'employee', qr_token: qrToken, venue: training.venue }), new Date().toISOString()]
          );
      } catch (localDbErr) {
          console.error("Failed to log generated batch training certificate locally:", localDbErr.message);
      }

      // Turso Certificate Registry (for online validation)
      await registerCertificateInTurso(executeTurso, {
        refNumber,
        certType: 'training',
        recipientName: name,
        details: { trainingTitle: training.trainingTitle, dates: dateString, hours: training.hours || training.thours, venue: training.venue },
      });

      const certificateData = { 
        name: name, 
        ...training,
        thours: training.hours || training.thours
      };
      drawCertificate(doc, { ...certificateData, qrCodeDataUrl, refNumber });
      if (i < trainings.length - 1) {
        doc.addPage();
      }
    }
    doc.end();
  } catch (err) {
    console.error('Error generating batch training certificates:', err);
    res.status(500).send('Failed to generate batch certificates.');
  }
});


// =================================================================
// === NEW ROUTE FOR BATCH GENERATION BY TRAINING TITLE ===========
// =================================================================
router.post('/generate-certificates-by-training', async (req, res) => {
  const { trainingTitle, transmitterName, encodedBy } = req.body;
  if (!trainingTitle) {
    return res.status(400).json({ message: "Training title is required." });
  }

  // --- ONE-DOWNLOAD RESTRICTION ---
  try {
    const [existingBatch] = await dbPool.query(
      "SELECT id FROM certificate_registry WHERE certificate_type = 'training' AND recipient_name = '__BATCH__' AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.training_title')) = ? LIMIT 1",
      [trainingTitle]
    );
    if (existingBatch.length > 0) {
      return res.status(409).json({ message: `Certificates for "${trainingTitle}" have already been generated and can only be downloaded once.` });
    }
  } catch (checkErr) {
    console.error('[generate-certificates-by-training] Batch check failed:', checkErr.message);
    // Non-fatal — proceed even if the check cannot be completed
  }

  try {
    // STEP 1: Query database (This part is unchanged)
    const query = `
      SELECT 
        e.first_name, e.middle_initial, e.last_name, e.suffix,
        t.hours, t.start_date, t.end_date, t.venue
      FROM trainings t
      JOIN employees e ON t.employee_id = e.id
      JOIN training_titles tt ON t.training_title_id = tt.id
      WHERE tt.title = ?
    `;
    const [participants] = await dbPool.query(query, [trainingTitle]);

    if (participants.length === 0) {
      return res.status(404).json({ message: "No participants found for this training." });
    }

    // --- MODIFICATION START ---

    // STEP 2: Set headers for a single PDF file, not a zip file.
    const safeTitle = trainingTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Certificates by Training-${safeTitle}.pdf"`);

    // STEP 3: Create ONE PDF document that will contain all pages.
    const doc = new PDFDocument({
      size: 'A4',
      margin: 72,
      ownerPassword: process.env.PDF_OWNER_PASSWORD,
      pdfVersion: '1.7ext3',
      encryption: {
        v: 4,
        r: 4,
        length: 128
      },
      permissions: {
        printing: 'highResolution',
        modifying: false,
        copying: false,
        annotating: false,
        fillingForms: false,
        contentAccessibility: false,
        documentAssembly: false
      }
    });
    doc.pipe(res); // Pipe the document directly to the response.

    // STEP 4: Loop through each participant and add their certificate to the document.
    for (let index = 0; index < participants.length; index++) {
      const participant = participants[index];
      const fullName = `${participant.first_name} ${participant.middle_initial || ''} ${participant.last_name} ${participant.suffix || ''}`.replace(/\s+/g, ' ').trim();
      const startFmt = formatDate(participant.start_date);
      const endFmt = formatDate(participant.end_date);
      const dateString = (startFmt === endFmt) ? startFmt : `${startFmt} - ${endFmt}`;

      // --- Turso Logging + get formatted REFERENCE_NUMBER as certificate number ---
      const refNumber = await getTursoRefNumber('Training Certificate', fullName, transmitterName, encodedBy);

      // Generate encrypted QR verification URL
      const qrUrl = buildVerifyURL(refNumber, 'training', fullName);
      const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'M',
        width: 512
      });

      // Turso Certificate Registry (for online validation)
      registerCertificateInTurso(executeTurso, {
        refNumber,
        certType: 'training',
        recipientName: fullName,
        details: { trainingTitle, dates: dateString, hours: participant.hours },
      }).catch(err => console.error(`Registry failed for ${fullName}:`, err.message));

      const certificateData = {
        name: fullName,
        trainingTitle: trainingTitle,
        thours: participant.hours,
        startDate: participant.start_date,
        endDate: participant.end_date,
        venue: participant.venue
      };
      
      // Draw the current participant's certificate on the current page.
      drawCertificate(doc, { ...certificateData, qrCodeDataUrl, refNumber });

      // Add a new page for the next certificate, BUT NOT for the very last one.
      if (index < participants.length - 1) {
        doc.addPage();
      }

      // --- Local DB Logging (certificate_registry) for each participant ---
      dbPool.query(
          "INSERT IGNORE INTO certificate_registry (reference_number, certificate_type, recipient_name, details, issued_at) VALUES (?, ?, ?, ?, ?)",
          [refNumber, 'training', `${participant.first_name} ${participant.middle_initial || ''} ${participant.last_name} ${participant.suffix || ''}`.replace(/\s+/g, ' ').trim(), JSON.stringify({ training_title: trainingTitle, training_dates: dateString, training_hours: participant.hours || participant.thours, venue: participant.venue }), new Date().toISOString()]
      ).catch(err => {
          console.error(`Failed to log training cert for ${participant.last_name}:`, err.message);
      });
    }

    // STEP 5: Finalize the single PDF document.
    doc.end();

    // --- Mark this training title as batch-generated (one-download enforcement) ---
    dbPool.query(
      "INSERT IGNORE INTO certificate_registry (reference_number, certificate_type, recipient_name, details, issued_at) VALUES (?, ?, ?, ?, ?)",
      [crypto.randomUUID(), 'training', '__BATCH__', JSON.stringify({ source: 'by-title', training_title: trainingTitle }), new Date().toISOString()]
    ).catch(err => console.error('Failed to log batch-by-title marker:', err.message));

    // --- MODIFICATION END ---

  } catch (error) {
    console.error("Batch Certificate Generation by Title Error:", error);
    if (!res.headersSent) {
      res.status(500).send('An error occurred during PDF file generation.');
    }
  }
});

// =================================================================
// === VALIDATION ROUTE ============================================
// =================================================================
// =================================================================
// === REGENERATE ROUTE (fix misspellings, no new logbook entry) ===
// =================================================================
router.post('/regenerate-training-certificate', async (req, res) => {
  const data = req.body;
  const { refNumber } = data;
  if (!refNumber) return res.status(400).json({ message: 'Reference number is required.' });

  try {
    const recipientName = (data.name || '').trim();
    if (!recipientName) return res.status(400).json({ message: 'Recipient name is required.' });

    // Build a dateString for DB storage; try raw dates first, fall back to provided string
    let dateString = data.formattedDates || '';
    if (data.startDate || data.endDate) {
      const startFmt = formatDate(data.startDate);
      const endFmt   = formatDate(data.endDate);
      dateString = (startFmt === endFmt) ? startFmt : `${startFmt} - ${endFmt}`;
    }
    const hours = data.thours || data.hours || '';

    // --- Retrieve original QR token + existing values for diff BEFORE overwriting ---
    let storedQrToken    = null;
    let existingName     = '';
    let existingDetails  = {};
    try {
      const [existingRows] = await dbPool.query(
        'SELECT details, recipient_name FROM certificate_registry WHERE reference_number = ?',
        [refNumber]
      );
      if (existingRows.length > 0) {
        existingDetails  = JSON.parse(existingRows[0].details || '{}');
        existingName     = existingRows[0].recipient_name || '';
        storedQrToken    = existingDetails.qr_token || null;
      }
    } catch (lookupErr) {
      console.error('[regenerate-training] Could not fetch existing row:', lookupErr.message);
    }

    // --- Resolve editor name from JWT ---
    let editorName = 'Unknown';
    try {
      const authHeader = req.headers['authorization'] || '';
      const token      = authHeader.split(' ')[1];
      const decoded    = token ? jwt.decode(token) : null;
      if (decoded?.id) {
        const [userRows] = await dbPool.query(
          'SELECT first_name, middle_initial, last_name FROM users WHERE id = ?',
          [decoded.id]
        );
        if (userRows.length > 0) {
          const u = userRows[0];
          editorName = `${u.first_name}${u.middle_initial ? ' ' + u.middle_initial + '.' : ''} ${u.last_name}`.trim();
        }
      }
    } catch (_) { /* non-critical */ }

    // --- Update local DB (carry the original qr_token forward) ---
    try {
      await dbPool.query(
        'UPDATE certificate_registry SET recipient_name = ?, details = ? WHERE reference_number = ?',
        [
          recipientName,
          JSON.stringify({ training_title: data.trainingTitle, training_dates: dateString, training_hours: hours, qr_token: storedQrToken, venue: data.venue }),
          refNumber,
        ]
      );
    } catch (localDbErr) {
      console.error('[regenerate-training] Local DB update failed:', localDbErr.message);
    }

    // --- Update Turso certificate_registry ---
    await updateCertificateInTurso(executeTurso, {
      refNumber,
      recipientName,
      details: { trainingTitle: data.trainingTitle, dates: dateString, hours, venue: data.venue },
    });

    // --- Update Turso Digital_Logbook: TRANSMITTER → editor, REMARKS → changed fields ---
    {
      const changes = [];
      const norm    = (v) => (v || '').toString().trim();
      if (norm(existingName)                   !== norm(recipientName))      changes.push('Recipient Name');
      if (norm(existingDetails.training_title) !== norm(data.trainingTitle)) changes.push('Training Title');
      if (norm(existingDetails.training_dates) !== norm(dateString))         changes.push('Training Dates');
      if (norm(existingDetails.training_hours) !== norm(hours))              changes.push('Training Hours');
      const editDate    = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });
      const remarkText  = changes.length
        ? `${editDate}: ${changes.join(', ')} corrected.`
        : `Re-printed on ${editDate} (no data changes).`;
      await updateTursoLogbookEntry(executeTurso, { refNumber, editorName, remarks: remarkText, recipientName });
    }

    // --- Reuse the original QR token so the QR image is identical to the first-issued cert ---
    let qrCodeDataUrl;
    if (storedQrToken) {
      const verifyBase = (process.env.VERCEL_VERIFY_URL || 'https://cert-verify.is-a.dev').replace(/\/$/, '');
      qrCodeDataUrl = await QRCode.toDataURL(`${verifyBase}/verify?t=${storedQrToken}`, { errorCorrectionLevel: 'M', width: 512 });
    } else {
      // Fallback for certificates issued before token storage was added
      qrCodeDataUrl = await QRCode.toDataURL(buildVerifyURL(refNumber, 'training', recipientName), { errorCorrectionLevel: 'M', width: 512 });
    }

    // --- Generate PDF ---
    const doc = new PDFDocument({
      size: 'A4',
      margin: 72,
      ownerPassword: process.env.PDF_OWNER_PASSWORD,
      pdfVersion: '1.7ext3',
      encryption: { v: 4, r: 4, length: 128 },
      permissions: {
        printing: 'highResolution', modifying: false, copying: false,
        annotating: false, fillingForms: false, contentAccessibility: false, documentAssembly: false,
      },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Certificate-${recipientName}.pdf"`);
    doc.pipe(res);
    drawCertificate(doc, { ...data, name: recipientName, qrCodeDataUrl, refNumber });
    doc.end();
  } catch (err) {
    console.error('[regenerate-training] Error:', err);
    if (!res.headersSent) res.status(500).send('Failed to regenerate certificate.');
  }
});

// Returns an array of training titles that have already been batch-generated by title
router.get('/batch-generated-titles', async (req, res) => {
  try {
    const [rows] = await dbPool.query(
      "SELECT details FROM certificate_registry WHERE certificate_type = 'training' AND recipient_name = '__BATCH__'"
    );
    const titles = rows.map(row => {
      try { return JSON.parse(row.details || '{}').training_title || ''; }
      catch (_) { return ''; }
    }).filter(Boolean);
    res.json(titles);
  } catch (err) {
    console.error('batch-generated-titles error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/validate-training-certificate/:refNumber', async (req, res) => {
  try {
    const { refNumber } = req.params;
    const [rows] = await dbPool.query("SELECT * FROM certificate_registry WHERE reference_number = ? AND certificate_type = 'training'", [refNumber]);
    if (rows.length > 0) {
      const row = rows[0];
      const details = JSON.parse(row.details || '{}');
      res.json({ valid: true, data: { recipient_name: row.recipient_name, reference_number: row.reference_number, ...details } });
    } else {
      res.json({ valid: false, message: "Certificate not found." });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.post('/send-email-training-certificate', async (req, res) => {
  const data = req.body;
  const { refNumber, emailAddress, name } = data;
  if (!refNumber || !emailAddress) return res.status(400).json({ message: 'Reference number and email address are required.' });

  try {
    let storedQrToken = null;
    let qrCodeDataUrl = null;
    try {
      const [existingRows] = await dbPool.query(
        'SELECT details FROM certificate_registry WHERE reference_number = ?',
        [refNumber]
      );
      if (existingRows.length > 0) {
        const existingDetails = JSON.parse(existingRows[0].details || '{}');
        storedQrToken = existingDetails.qr_token || null;
      }
    } catch (lookupErr) {
      console.error('[send-email-training] Could not fetch existing row:', lookupErr.message);
    }
    
    if (storedQrToken) {
      const verifyURL = buildVerifyURL(storedQrToken);
      qrCodeDataUrl = await QRCode.toDataURL(verifyURL, { errorCorrectionLevel: 'M', margin: 2, width: 90 });
    } else {
      return res.status(400).json({ message: 'QR Token not found for this certificate.' });
    }

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 0,
      info: { Title: 'Training Certificate', Author: 'Philippine Statistics Authority Kalinga' },
      userPassword: process.env.PDF_OWNER_PASSWORD,
      ownerPassword: process.env.PDF_OWNER_PASSWORD,
      pdfVersion: '1.7ext3',
      encryption: { v: 4, r: 4, length: 128 },
      permissions: { printing: 'highResolution', modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: false, documentAssembly: false }
    });

    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', async () => {
      let pdfBuffer = Buffer.concat(buffers);
      const { sendCertificateEmail } = require('../utils/emailService');
      try {
        await sendCertificateEmail(emailAddress, name || 'Employee', pdfBuffer, 'Certificate.pdf');
        res.json({ message: 'Email sent successfully!' });
      } catch (emailErr) {
        console.error('Failed to send email:', emailErr);
        res.status(500).json({ message: 'Failed to send email' });
      }
    });

    drawCertificate(doc, { ...data, qrCodeDataUrl, refNumber });
    doc.end();

  } catch (error) {
    console.error('Error in send-email-certificate:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

module.exports = router;
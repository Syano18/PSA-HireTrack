const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const path = require('path');
const archiver = require('archiver');
const stream = require('stream');

// Correctly import your database pool from your db.js file
// Note: You may need to adjust this path based on your folder structure
const dbPool = require('../db');

// --- Helper Functions ---
const formatDate = (dateString) => {
if (!dateString) return '';
const date = new Date(dateString);
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
doc.font(timesBold).fontSize(32).text('Certificate of Participation', { align: 'center' });
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
doc.fontSize(nameFontSize).text(data.name, 60, nameY, { width: nameMaxWidth, align: 'center' });

// --- Position subsequent text ---
const afterNameY = nameY + 50;
doc.font(timesRoman).fontSize(16).text('for actively participating in the', 60, afterNameY, { align: 'center' });

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
let dateText = `for ${data.thours} hours`;
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
};


// =================================================================
// === YOUR EXISTING ROUTES ========================================
// =================================================================
router.post('/generate-certificate', (req, res) => {
const data = req.body;
if (data.type !== 'Training') {
 return res.status(400).send('This endpoint only supports Training certificates.');
}
const doc = new PDFDocument({ size: 'A4', margin: 72 });
res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', `attachment; filename="Certificate-${data.name}.pdf"`);
doc.pipe(res);
drawCertificate(doc, data);
doc.end();
});

router.post('/generate-batch-training-certificate', (req, res) => {
  try {
    const { name, trainings } = req.body;
    if (!trainings || !Array.isArray(trainings) || trainings.length === 0) {
      return res.status(400).send('No training data provided for batch generation.');
    }
    const doc = new PDFDocument({ size: 'A4', margin: 72 });
    const safeName = (name || 'employee').replace(/[<>:"/\\|?*]+/g, "_");
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Batch-Training-Certificates-${safeName}.pdf"`);
    doc.pipe(res);
    trainings.forEach((training, index) => {
      const certificateData = { name: name, ...training };
      drawCertificate(doc, certificateData);
      if (index < trainings.length - 1) {
        doc.addPage();
      }
    });
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
  const { trainingTitle } = req.body;
  if (!trainingTitle) {
    return res.status(400).json({ message: "Training title is required." });
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
    const doc = new PDFDocument({ size: 'A4', margin: 72 });
    doc.pipe(res); // Pipe the document directly to the response.

    // STEP 4: Loop through each participant and add their certificate to the document.
    participants.forEach((participant, index) => {
      const certificateData = {
        name: `${participant.first_name} ${participant.middle_initial || ''} ${participant.last_name} ${participant.suffix || ''}`.replace(/\s+/g, ' ').trim(),
        trainingTitle: trainingTitle,
        thours: participant.hours,
        startDate: participant.start_date,
        endDate: participant.end_date,
        venue: participant.venue
      };
      
      // Draw the current participant's certificate on the current page.
      drawCertificate(doc, certificateData);

      // Add a new page for the next certificate, BUT NOT for the very last one.
      if (index < participants.length - 1) {
        doc.addPage();
      }
    });

    // STEP 5: Finalize the single PDF document.
    doc.end();

    // --- MODIFICATION END ---

  } catch (error) {
    console.error("Batch Certificate Generation by Title Error:", error);
    if (!res.headersSent) {
      res.status(500).send('An error occurred during PDF file generation.');
    }
  }
});

module.exports = router;
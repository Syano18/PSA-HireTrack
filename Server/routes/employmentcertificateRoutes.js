const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const path = require('path');
const dbPool = require('../db');
const crypto = require('crypto');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const { buildVerifyURL, registerCertificateInTurso, updateCertificateInTurso, updateTursoLogbookEntry } = require('../utils/certEncryption');
require('dotenv').config();

// --- GLOBAL FONT CONSTANTS ---
const timesBold = 'Times-Bold';
const timesRoman = 'Times-Roman';
const timesItalic = 'Times-Italic';
// -----------------------------

// --- Helper Functions ---
const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date)) return '';
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
};

// Converts stored rating "2.67 — Satisfactory" → "2.67/5.0 (Satisfactory)"
const formatRatingForCertificate = (rating) => {
    if (!rating) return rating;
    const match = String(rating).match(/^(\d+(?:\.\d+)?)\s*[—\-]\s*(.+)$/);
    if (match) return `${parseFloat(match[1]).toFixed(2)}/5.0 (${match[2].trim()})`;
    return rating;
};

const formatDateRange = (startDateString, endDateString) => {
    if (!startDateString || !endDateString) return '[Date Range Missing]';
    const startDate = new Date(startDateString);
    const endDate = new Date(endDateString);
    if (isNaN(startDate) || isNaN(endDate)) return '[Invalid Date Range]';
    const startMonth = startDate.toLocaleString('en-US', { month: 'long' });
    const endMonth = endDate.toLocaleString('en-US', { month: 'long' });
    const startDay = startDate.getDate();
    const endDay = endDate.getDate();
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    if (startDate.getTime() === endDate.getTime()) return formatDate(startDateString);
    if (startMonth === endMonth && startYear === endYear) return `${startMonth} ${startDay}-${endDay}, ${startYear}`;
    return `${formatDate(startDateString)} to ${formatDate(endDateString)}`;
};

const getOrdinalSuffix = (day) => {
    const j = day % 10, k = day % 100;
    if (j == 1 && k != 11) return "st";
    if (j == 2 && k != 12) return "nd";
    if (j == 3 && k != 13) return "rd";
    return "th";
};

// Helper: Execute Turso Sync via HTTP
const executeTurso = async (sql, args) => {
  const dbUrl = process.env.TURSO_DB_URL?.replace(/^libsql:/, 'https:');
  const authToken = process.env.TURSO_AUTH_TOKEN;
  
  if (!dbUrl || !authToken) {
    throw new Error("Turso DB URL or Token is not configured.");
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
      throw new Error(`Turso Sync Error: ${response.status} ${errorText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('Turso DB Error:', err.message);
    throw err;
  }
};

// --- Footer Drawing Function (Re-added for Multi-Cert) ---
const drawFooterImages = (doc, leftMargin, writableWidth) => {
    try {
        const footlogo = path.join(__dirname, '../assets/footer.png');
        const footerY = doc.page.height - 100;

        doc.strokeColor('gray')
            .moveTo(leftMargin, footerY + 15)
            .lineTo(doc.page.width - leftMargin, footerY + 15)
            .stroke();

        doc.image(footlogo, leftMargin + (writableWidth - 400) / 2, footerY + 20, { width: 400 });
    } catch (err) {
        console.error("Error embedding images:", err.message);
    }
};

// --- Drawing Function for Single Employment Certificate ---
const drawEmploymentCertificate = (doc, data) => {
    const leftMargin = 72;
    const writableWidth = doc.page.width - (leftMargin * 2);
    const getArticle = (word) => {
      if (!word) return 'a';
      const firstLetter = word.trim().charAt(0).toLowerCase();
      return ['a', 'e', 'i', 'o', 'u'].includes(firstLetter) ? 'an' : 'a';
    };

    // --- Header Logos ---
    try {
        const psaLogoPath = path.join(__dirname, '../assets/logo.png');
        const kalogo = path.join(__dirname, '../assets/text.png');
        const bagoLogoPath = path.join(__dirname, '../assets/Bagong.png');
        doc.image(psaLogoPath, leftMargin, 20, { width: 70 });
        doc.image(kalogo, leftMargin + 70, 20, { width: 300 });
        doc.image(bagoLogoPath, leftMargin + 380, 20, { width: 70 });
    } catch (err) {
        console.error("Error embedding images:", err.message);
    }    // --- Reference Number ---
    const today = new Date();
    let refNumberText;
    if (data.fullRefNumber) {
        refNumberText = `Reference No.: ${data.fullRefNumber}`;
    } else {
        const last2 = today.getFullYear().toString().slice(-2);
        refNumberText = `Reference No.: ${last2}CAR32-`;
    }
    doc.font(timesRoman).fontSize(10).text(refNumberText, leftMargin, 105);

    // --- Title ---
    doc.font(timesBold).fontSize(18).text(
        'CERTIFICATION OF EMPLOYMENT',
        leftMargin,
        160,
        { align: 'center', width: writableWidth }
    );
    doc.moveDown(2.5);
    doc.font(timesRoman).fontSize(12).text('TO WHOM IT MAY CONCERN:', { align: 'left' });
    doc.moveDown(2.5);

    // In your drawEmployment-certificate function

    // --- Body Text ---
    const title = data.sex === 'Male' ? 'Mr.' : 'Ms.';

    // 1. Build the entire paragraph as one single string.
    const bodyText = `This is to certify that ${title} ${data.name} ` +
                    `of ${data.barangay}, ${data.municipality}, Kalinga, has rendered service with the ` +
                    `Philippine Statistics Authority - Kalinga Provincial Statistical Office ` +
                    `as ${getArticle(data.position)} ${data.position} under the ${data.project_name} ` +
                    `for the period of ${formatDateRange(data.contract_start_date, data.contract_end_date)}.`;

    // 2. Draw the entire string with one command.
    doc.font(timesRoman) 
       .fontSize(12)
       .text(bodyText, {
            align: 'justify',
            indent: 36,
            lineGap: 4
        });

    doc.moveDown(1.5);
    const possessivePronoun = data.sex === 'Male' ? 'his' : 'her';
    doc.font(timesRoman).text(
        `An evaluation for ${possessivePronoun} service during this period is on record as follows:`,
        { align: 'justify', indent: 36, lineGap: 4 }
    );

    doc.moveDown(1.5);
    doc.font(timesBold).text('Performance Rating: ', { continued: true, indent: 50 });
    doc.font(timesRoman).text(formatRatingForCertificate(data.performance_rating));
    doc.moveDown(0.5);
    doc.font(timesBold).text('Notes/Commendations: ', { continued: true, indent: 50 });
    doc.font(timesRoman).text(data.remarks);

    doc.moveDown(2);
    doc.font(timesRoman).text(
        `This certification is issued upon the request of ${title} ${data.last_name} for whatever legal purpose it may serve.`,
        { align: 'justify', indent: 36, lineGap: 4 }
    );

    doc.moveDown(2);
    const day = today.getDate();
    const monthYear = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const dateIssuedText = `Issued this ${day}${getOrdinalSuffix(day)} day of ${monthYear} at the Kalinga Provincial Statistical Office, Bulanao, Tabuk City, Kalinga.`;
    doc.font(timesRoman).text(dateIssuedText, { align: 'justify', indent: 36, lineGap: 4 });

    // --- Signatory Section ---
    doc.moveDown(6); // add spacing before signatory

    const signatoryName = data.signatoryName || 'MARIBEL M. DALAYDAY';
    const signatoryTitle = data.signatoryTitle || 'Chief Statistical Specialist';

    // Draw signatory name (right aligned)
    doc.font(timesBold).fontSize(14);
    const signNameY = doc.y;
    doc.text(signatoryName, leftMargin, signNameY, { width: writableWidth, align: 'right' });

    // Draw underline under signatory name
    const textWidth = doc.widthOfString(signatoryName);
    const rightX = doc.page.width - leftMargin;
    const lineStartX = rightX - textWidth;
    const lineY = signNameY + 15; // adjust offset to font size
    doc.moveTo(lineStartX, lineY).lineTo(rightX, lineY).stroke();

    // Add signatory title below line
    doc.font(timesRoman).fontSize(12).text(signatoryTitle, leftMargin - 10, lineY + 5, {
        width: writableWidth,
        align: 'right'
    });

    // --- QR Code Validation Section ---
    if (data.qrCodeDataUrl) {
        const qrSize = 90;
        const qrX = 60;
        const qrY = doc.page.height - 215;
        const padding = 4;
        const originalBottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.rect(qrX - padding, qrY - padding, qrSize + padding * 2, qrSize + padding * 2).fill('#ffffff');
        doc.fillColor('#000000');
        doc.image(data.qrCodeDataUrl, qrX, qrY, { width: qrSize });
        doc.font(timesRoman).fontSize(8)
           .text(`Ref No: ${data.fullRefNumber}`, qrX, qrY + qrSize + 5, { width: 200, align: 'left' })
           .text('Scan to verify online', qrX, qrY + qrSize + 15, { width: 200, align: 'left' });
        doc.page.margins.bottom = originalBottomMargin;
    }

    // --- Footer Section ---
    // This function already contained the footer image and line drawing.
    drawFooterImages(doc, leftMargin, writableWidth);
};

// --- Table Drawing Function for Multi-Certificate ---
const drawEmploymentTable = (doc, employments) => {
    const tableTopY = doc.y;
    const leftMargin = 60;
    const rowFontSize = 12;
    const headerFontSize = 12;
    const cellPadding = 5;

    const columns = [
        { header: 'Period of Employment', key: 'period', width: 99 },
        { header: 'Position', key: 'position', width: 75 },
        { header: 'Name of Project', key: 'project_name', width: 105 },
        { header: 'Performance Rating', key: 'performance_rating', width: 87 },
        { header: 'Notes &\nCommendations', key: 'remarks', width: 105 }
    ];

    // Calculate X positions of columns
    let currentX = leftMargin;
    columns.forEach(col => {
        col.x = currentX;
        currentX += col.width;
    });

    const tableWidth = columns.reduce((acc, col) => acc + col.width, 0);

    // ---- Draw Header ----
    doc.font(timesBold).fontSize(headerFontSize);

    let maxHeaderHeight = 0;
    columns.forEach(col => {
        const h = doc.heightOfString(col.header, { width: col.width - (cellPadding * 2) });
        if (h > maxHeaderHeight) maxHeaderHeight = h;
    });

    const headerHeight = maxHeaderHeight + (cellPadding * 2);
    doc.rect(leftMargin, tableTopY, tableWidth, headerHeight).stroke();

    columns.forEach(col => {
        const textHeight = doc.heightOfString(col.header, { width: col.width - (cellPadding * 2) });
        const textY = tableTopY + (headerHeight - textHeight) / 2;

        doc.text(col.header, col.x + cellPadding, textY, {
            width: col.width - (cellPadding * 2),
            align: 'center'
        });
    });

    // ---- Draw Rows ----
    let currentY = tableTopY + headerHeight;
    doc.font(timesRoman).fontSize(rowFontSize);

    employments.forEach(job => {
        const rowData = {
            period: formatDateRange(job.contract_start_date, job.contract_end_date),
            position: job.position,
            project_name: job.project_name,
            performance_rating: job.performance_rating,
            remarks: job.remarks
        };

        // Find row height based on tallest cell
        let maxRowHeight = 0;
        columns.forEach(col => {
            const text = rowData[col.key] || '';
            const cellHeight = doc.heightOfString(text, { width: col.width - (cellPadding * 2) });
            if (cellHeight > maxRowHeight) maxRowHeight = cellHeight;
        });
        const rowHeight = maxRowHeight + (cellPadding * 2);

        // Handle page break
        if (currentY + rowHeight > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            currentY = doc.y; // continue below header/footer
        }

        // Draw each cell text centered vertically
        columns.forEach(col => {
            const text = rowData[col.key] || '';
            const textHeight = doc.heightOfString(text, { width: col.width - (cellPadding * 2) });
            const textY = currentY + (rowHeight - textHeight) / 2;

            doc.text(text, col.x + cellPadding, textY, {
                width: col.width - (cellPadding * 2),
                align: 'center'
            });
        });

        // Draw row bottom line
        doc.moveTo(leftMargin, currentY + rowHeight)
           .lineTo(leftMargin + tableWidth, currentY + rowHeight)
           .stroke();

        currentY += rowHeight;
    });

    // ---- Draw column lines ----
    const tableBottomY = currentY;
    columns.forEach((col, i) => {
        if (i > 0) {
            doc.moveTo(col.x, tableTopY).lineTo(col.x, tableBottomY).stroke();
        }
    });
    doc.rect(leftMargin, tableTopY, tableWidth, tableBottomY - tableTopY).stroke();

    // Move cursor below table
    doc.y = tableBottomY + 20;
};

// --- Main Drawing Function for Multi-Certificate ---
const drawMultiEmploymentCertificate = (doc, data) => {
    const leftMargin = 60;
    const writableWidth = doc.page.width - (leftMargin * 2);
    const RESERVED_FOOTER_HEIGHT = 120;

    const drawHeader = () => {
        try {
            const psaLogoPath = path.join(__dirname, '../assets/logo.png');
            const kalogo = path.join(__dirname, '../assets/text.png');
            const bagoLogoPath = path.join(__dirname, '../assets/Bagong.png');
            doc.image(psaLogoPath, leftMargin, 20, { width: 70 });
            doc.image(kalogo, leftMargin + 70, 20, { width: 300 });
            doc.image(bagoLogoPath, doc.page.width - leftMargin - 70, 20, { width: 70 });
        } catch (err) {
            console.error("Error embedding header images:", err.message);
        }
    };

    // 1. Initial call for the first page
    drawFooterImages(doc, leftMargin, writableWidth);

    doc.on('pageAdded', () => {
        drawHeader();
        drawFooterImages(doc, leftMargin, writableWidth); // FIX: Draw footer on subsequent pages
        doc.y = 160;
    });

    drawHeader();
    // Removed call to drawFooter();

    const today = new Date();
    let refNumberText;
    if (data.fullRefNumber) {
        refNumberText = `Reference No.: ${data.fullRefNumber}`;
    } else {
        const last2 = today.getFullYear().toString().slice(-2);
        refNumberText = `Reference No.: ${last2}CAR32-`;
    }
    doc.font(timesRoman).fontSize(10).text(refNumberText, leftMargin, 105);
    doc.y = 160;
    doc.font(timesBold).fontSize(18).text('CERTIFICATION OF EMPLOYMENT', { align: 'center' });
    doc.moveDown(2);
    doc.font(timesRoman).fontSize(12).text('TO WHOM IT MAY CONCERN:', { align: 'left' });
    doc.moveDown(2);

    const title = data.sex === 'Male' ? 'Mr.' : 'Ms.';
    const pronoun = data.sex === 'Male' ? 'His' : 'Her';

    // 1. Build the entire paragraph into a single string.
    const bodyText = `This is to certify that ${title} ${data.name} ` +
                    `of ${data.barangay}, ${data.municipality}, Kalinga, has rendered service with the ` +
                    `Philippine Statistics Authority - Kalinga Provincial Statistical Office. ` +
                    `${pronoun} service record, including performance evaluation, is detailed below.`;

    // 2. Draw it all with one command for perfect formatting.
    doc.font(timesRoman)
       .fontSize(12)
       .text(bodyText, {
            align: 'justify',
            indent: 36,
            width: writableWidth,
            lineGap: 4
        });

    doc.moveDown(2);

    drawEmploymentTable(doc, data.employments);
    
    const CLOSING_CONTENT_ESTIMATED_HEIGHT = 150; 
    
    if (doc.y + CLOSING_CONTENT_ESTIMATED_HEIGHT > doc.page.height - RESERVED_FOOTER_HEIGHT) {
        doc.addPage();
    }
    
    doc.x = leftMargin;
    doc.font(timesRoman).fontSize(12)
        .text(`This certification is issued upon the request of ${title} ${data.lastName} for whatever legal purpose it may serve.`, {
            width: writableWidth,
            align: 'justify',
            indent: 36,
            lineGap: 4
        });
    doc.moveDown(2);

    const day = today.getDate();
    const monthYear = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const dateIssuedText = `Issued this ${day}${getOrdinalSuffix(day)} day of ${monthYear} at the Kalinga Provincial Statistical Office, Bulanao, Tabuk City, Kalinga.`;

    doc.x = leftMargin;
    doc.font(timesRoman).fontSize(12)
        .text(dateIssuedText, {
            width: writableWidth,
            align: 'justify',
            indent: 36,
            lineGap: 4
        });

    const signatoryName = data.signatoryName || 'MARIBEL M. DALAYDAY';
    const signatoryTitle = data.signatoryTitle || 'Chief Statistical Specialist';
    const signatureBlockHeight = 60;

    if (doc.y + signatureBlockHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
    }

    doc.moveDown(4);
    doc.font(timesBold).fontSize(14).text(signatoryName, {
        width: writableWidth,
        align: 'right'
    });

    const lineY = doc.y;
    doc.moveTo(doc.page.width - leftMargin - 160, lineY)
       .lineTo(doc.page.width - leftMargin, lineY)
       .stroke();
    doc.font(timesRoman).fontSize(12).text(signatoryTitle, leftMargin - 10, lineY + 5, { width: writableWidth, align: 'right' });

    // --- QR Code Validation Section (last page) ---
    if (data.qrCodeDataUrl) {
        const qrSize = 90;
        const qrX = 60;
        const qrY = doc.page.height - 215;
        const padding = 4;
        const originalBottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.rect(qrX - padding, qrY - padding, qrSize + padding * 2, qrSize + padding * 2).fill('#ffffff');
        doc.fillColor('#000000');
        doc.image(data.qrCodeDataUrl, qrX, qrY, { width: qrSize });
        doc.font(timesRoman).fontSize(8)
           .text('Scan to verify online', qrX, qrY + qrSize + 15, { width: 200, align: 'left' });
        doc.page.margins.bottom = originalBottomMargin;
    }
};

// --- Drawing function variant used when re-generating (accepts pre-formatted duration) ---
const drawEmploymentCertificateForRegenerate = (doc, data) => {
    const leftMargin   = 72;
    const writableWidth = doc.page.width - (leftMargin * 2);
    const getArticle = (word) => {
        if (!word) return 'a';
        const firstLetter = word.trim().charAt(0).toLowerCase();
        return ['a', 'e', 'i', 'o', 'u'].includes(firstLetter) ? 'an' : 'a';
    };



    // Header Logos
    try {
        const psaLogoPath  = path.join(__dirname, '../assets/logo.png');
        const kalogo       = path.join(__dirname, '../assets/text.png');
        const bagoLogoPath = path.join(__dirname, '../assets/Bagong.png');
        doc.image(psaLogoPath,  leftMargin,        20, { width: 70 });
        doc.image(kalogo,       leftMargin + 70,   20, { width: 300 });
        doc.image(bagoLogoPath, leftMargin + 380,  20, { width: 70 });
    } catch (err) {
        console.error('Error embedding images:', err.message);
    }

    // Reference number
    doc.font(timesRoman).fontSize(10).text(`Reference No.: ${data.fullRefNumber}`, leftMargin, 105);

    // Title
    doc.font(timesBold).fontSize(18)
       .text('CERTIFICATION OF EMPLOYMENT', leftMargin, 160, { align: 'center', width: writableWidth });
    doc.moveDown(2.5);
    doc.font(timesRoman).fontSize(12).text('TO WHOM IT MAY CONCERN:', { align: 'left' });
    doc.moveDown(2.5);

    // Body – use pre-formatted duration if raw dates are absent
    const title     = data.sex === 'Male' ? 'Mr.' : 'Ms.';
    const duration  = data._preFormattedDuration ||
                      (data.contract_start_date && data.contract_end_date
                        ? formatDateRange(data.contract_start_date, data.contract_end_date)
                        : data.contract_duration || '');
    const address   = data.address || `${data.barangay || ''}, ${data.municipality || ''}, Kalinga`.replace(/^,\s*/, '');

    const bodyText = `This is to certify that ${title} ${data.name} ` +
        `of ${address}, has rendered service with the ` +
        `Philippine Statistics Authority - Kalinga Provincial Statistical Office ` +
        `as ${getArticle(data.position)} ${data.position} under the ${data.project_name} ` +
        `for the period of ${duration}.`;

    doc.font(timesRoman).fontSize(12).text(bodyText, { align: 'justify', indent: 36, lineGap: 4 });

    doc.moveDown(1.5);
    const possessivePronoun = data.sex === 'Male' ? 'his' : 'her';
    doc.font(timesRoman).text(
        `An evaluation for ${possessivePronoun} service during this period is on record as follows:`,
        { align: 'justify', indent: 36, lineGap: 4 }
    );

    doc.moveDown(1.5);
    doc.font(timesBold).text('Performance Rating: ',    { continued: true, indent: 50 });
    doc.font(timesRoman).text(formatRatingForCertificate(data.performance_rating) || '');
    doc.moveDown(0.5);
    doc.font(timesBold).text('Notes/Commendations: ', { continued: true, indent: 50 });
    doc.font(timesRoman).text(data.remarks || '');

    doc.moveDown(2);
    doc.font(timesRoman).text(
        `This certification is issued upon the request of ${title} ${data.last_name} for whatever legal purpose it may serve.`,
        { align: 'justify', indent: 36, lineGap: 4 }
    );

    doc.moveDown(2);
    const today     = new Date();
    const day       = today.getDate();
    const monthYear = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    doc.font(timesRoman).text(
        `Issued this ${day}${getOrdinalSuffix(day)} day of ${monthYear} at the Kalinga Provincial Statistical Office, Bulanao, Tabuk City, Kalinga.`,
        { align: 'justify', indent: 36, lineGap: 4 }
    );

    // Signatory
    doc.moveDown(6);
    const signatoryName  = data.signatoryName  || 'MARIBEL M. DALAYDAY';
    const signatoryTitle = data.signatoryTitle || 'Chief Statistical Specialist';

    doc.font(timesBold).fontSize(14);
    const signNameY  = doc.y;
    doc.text(signatoryName, leftMargin, signNameY, { width: writableWidth, align: 'right' });
    const textWidth  = doc.widthOfString(signatoryName);
    const rightX     = doc.page.width - leftMargin;
    const lineStartX = rightX - textWidth;
    const lineY      = signNameY + 15;
    doc.moveTo(lineStartX, lineY).lineTo(rightX, lineY).stroke();
    doc.font(timesRoman).fontSize(12).text(signatoryTitle, leftMargin - 10, lineY + 5, { width: writableWidth, align: 'right' });

    // QR Code
    if (data.qrCodeDataUrl) {
        const qrSize    = 90;
        const qrX       = 60;
        const qrY       = doc.page.height - 215;
        const padding   = 4;
        const origBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.rect(qrX - padding, qrY - padding, qrSize + padding * 2, qrSize + padding * 2).fill('#ffffff');
        doc.fillColor('#000000');
        doc.image(data.qrCodeDataUrl, qrX, qrY, { width: qrSize });
        doc.font(timesRoman).fontSize(8)
           .text(`Ref No: ${data.fullRefNumber}`, qrX, qrY + qrSize + 5, { width: 200, align: 'left' })
           .text('Scan to verify online',          qrX, qrY + qrSize + 15, { width: 200, align: 'left' });
        doc.page.margins.bottom = origBottom;
    }

    drawFooterImages(doc, leftMargin, writableWidth);
};

// --- API ROUTES ---

// --- 2. DEFINE YOUR PDF OPTIONS ONCE ---
const pdfOptions = {
    size: 'A4',
    margin: 72,
    // Set the password from the .env file
    ownerPassword: process.env.PDF_OWNER_PASSWORD,
    // Set permissions to prevent editing (this is the "flatten" part)
    permissions: {
        printing: 'highResolution', // Allow users to print
        modifying: false,           // Disallow editing
        copying: false,             // Disallow copying text/images
        annotating: false,          // Disallow adding comments or form fields
        fillForms: false,
        contentAccessibility: false,
        documentAssembly: false
    }
};


router.post('/generate-employment-certificate', async (req, res) => {
    const data = req.body;
    if ( !data.performance_rating || String(data.performance_rating).toLowerCase() === 'n/a' ) {
        return res.status(400).json({ message: "Cannot generate certificate: Performance Rating is blank or n/a" });
    }

    try {
        let fullRefNumber = ''; // The single source of truth.
        if (data.withReference) {
            const particulars = `Certificate of Employment`;
            let refNum; // Will hold the Turso ID
            try {
                // Step 1: Insert with a placeholder remark to get the ID
                const tursoInsertResult = await executeTurso(
                    "INSERT INTO Digital_Logbook (PARTICULARS, ADDRESSE, TRANSMITTER, SECTION, MODE_OF_TRANSMITTAL, ENCODED_BY, REMARKS) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [particulars, data.name, data.transmitterName || '', 'Admin', 'Walk-in', data.encodedBy || '', '']
                );
                refNum = tursoInsertResult?.results?.[0]?.response?.result?.last_insert_rowid;

                if (refNum) {
                    // Step 2: Fetch the actual REFERENCE_NUMBER from Turso
                    const fetchRefResult = await executeTurso(
                        "SELECT REFERENCE_NUMBER FROM Digital_Logbook WHERE id = ?",
                        [refNum]
                    );
                    
                    const rows = fetchRefResult?.results?.[0]?.response?.result?.rows;
                    if (rows && rows.length > 0 && rows[0][0]) {
                        fullRefNumber = rows[0][0].value;
                    }
                } else {
                    console.error("Failed to get reference number from Turso:", JSON.stringify(tursoInsertResult));
                }
            } catch (tursoError) {
                console.error("Turso database operation failed:", tursoError.message);
            }
        }

        if (!fullRefNumber) {
            fullRefNumber = crypto.randomUUID();
        }

        // --- Generate encrypted QR code for online validation (computed first so token can be stored) ---
        const recipientName = `${data.first_name} ${data.middle_initial || ''} ${data.last_name} ${data.suffix || ''}`.replace(/\s+/g, ' ').trim();
        const qrUrl = buildVerifyURL(fullRefNumber, 'employment', recipientName);
        const qrToken = qrUrl.split('?t=')[1]; // capture token to preserve it across regenerations
        const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', width: 512 });

        // --- Local DB Logging (certificate_registry) ---
        try {
            const duration = formatDateRange(data.contract_start_date, data.contract_end_date);
            await dbPool.query(
                "INSERT IGNORE INTO certificate_registry (reference_number, certificate_type, recipient_name, details, issued_at) VALUES (?, ?, ?, ?, ?)",
                [fullRefNumber, 'employment', recipientName, JSON.stringify({ employment_titles: data.project_name, position: data.position, contract_duration: duration, performance_rating: data.performance_rating || null, remarks: data.remarks || null, qr_token: qrToken, source: 'employee' }), new Date().toISOString()]
            );
        } catch (localDbErr) {
            console.error("Failed to log generated employment certificate locally:", localDbErr.message);
        }

        // --- Turso Certificate Registry (for online validation) ---
        await registerCertificateInTurso(executeTurso, {
            refNumber: fullRefNumber,
            certType: 'employment',
            recipientName,
            details: { position: data.position, project: data.project_name, duration: formatDateRange(data.contract_start_date, data.contract_end_date), performance_rating: data.performance_rating || null, remarks: data.remarks || null },
        });

        const doc = new PDFDocument(pdfOptions);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="preview_train.pdf"');
        doc.pipe(res);
        drawEmploymentCertificate(doc, { ...data, fullRefNumber, qrCodeDataUrl });
        doc.end();
    } catch (error) {
        console.error("PDF Generation Error:", error);
        if (!res.headersSent) {
            res.status(500).send('An internal server error occurred during PDF generation.');
        }
    }
});

router.post('/generate-multi-employment-certificate', async (req, res) => {
    const data = req.body;
    const hasMissingRating = data.employments && data.employments.some(job =>
        !job.performance_rating || String(job.performance_rating).toLowerCase() === 'n/a'
    );
    if (hasMissingRating) {
        return res.status(400).json({ message: "Cannot generate certificate: At least one employment record has a missing or 'N/A' Overall Performance Rating." });
   }

    try {
        let fullRefNumber = ''; // The single source of truth.
        if (data.withReference) {
            const particulars = `Certificate of Employment`;
            let refNum; // Will hold the Turso ID
            try {
                // Step 1: Insert with a placeholder remark to get the ID
                const tursoInsertResult = await executeTurso(
                    "INSERT INTO Digital_Logbook (PARTICULARS, ADDRESSE, TRANSMITTER, SECTION, MODE_OF_TRANSMITTAL, ENCODED_BY, REMARKS) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [particulars, data.name, data.transmitterName || '', 'Admin', 'Walk-in', data.encodedBy || '', '']
                );
                refNum = tursoInsertResult?.results?.[0]?.response?.result?.last_insert_rowid;

                if (refNum) {
                    // Step 2: Fetch the actual REFERENCE_NUMBER from Turso
                    const fetchRefResult = await executeTurso(
                        "SELECT REFERENCE_NUMBER FROM Digital_Logbook WHERE id = ?",
                        [refNum]
                    );
                    
                    const rows = fetchRefResult?.results?.[0]?.response?.result?.rows;
                    if (rows && rows.length > 0 && rows[0][0]) {
                        fullRefNumber = rows[0][0].value;
                    }
                } else {
                    console.error("Failed to get reference number from Turso:", JSON.stringify(tursoInsertResult));
                }
            } catch (tursoError) {
                console.error("Turso database operation failed:", tursoError.message);
            }
        }

        if (!fullRefNumber) {
            fullRefNumber = crypto.randomUUID();
        }

        // --- Local DB Logging (certificate_registry) ---
        try {
            const employmentTitles = data.employments.map(e => e.project_name).join(', ');
            const positions = data.employments.map(e => e.position).join(', ');
            const employmentDurations = data.employments.map(e => formatDateRange(e.contract_start_date, e.contract_end_date)).join('; ');
            const comboKey = data.employments.map(e => `${e.position}||${e.project_name}`).sort().join(',');
            const recipientNameLocal = `${data.first_name} ${data.middle_initial || ''} ${data.last_name} ${data.suffix || ''}`.replace(/\s+/g, ' ').trim();
            await dbPool.query(
                "INSERT IGNORE INTO certificate_registry (reference_number, certificate_type, recipient_name, details, issued_at) VALUES (?, ?, ?, ?, ?)",
                [fullRefNumber, 'employment', recipientNameLocal, JSON.stringify({ source: 'multi-employee', combo_key: comboKey, employment_titles: employmentTitles, position: positions, contract_duration: employmentDurations, performance_rating: data.employments.map(e => e.performance_rating).filter(Boolean).join(', ') || null, remarks: data.employments.map(e => e.remarks).filter(Boolean).join('; ') || null }), new Date().toISOString()]
            );
        } catch (localDbErr) {
            console.error("Failed to log generated multi-employment certificate locally:", localDbErr.message);
        }

        // --- Generate encrypted QR code for online validation ---
        const recipientName = `${data.first_name} ${data.middle_initial || ''} ${data.last_name} ${data.suffix || ''}`.replace(/\s+/g, ' ').trim();
        const qrUrl = buildVerifyURL(fullRefNumber, 'employment', recipientName);
        const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', width: 512 });

        // --- Turso Certificate Registry (for online validation) ---
        await registerCertificateInTurso(executeTurso, {
            refNumber: fullRefNumber,
            certType: 'employment',
            recipientName,
            details: {
                positions: data.employments.map(e => e.position).join(', '),
                projects: data.employments.map(e => e.project_name).join(', '),
                durations: data.employments.map(e => formatDateRange(e.contract_start_date, e.contract_end_date)).join('; '),
                performance_rating: data.employments.map(e => e.performance_rating).filter(Boolean).join(', ') || null,
                remarks: data.employments.map(e => e.remarks).filter(Boolean).join('; ') || null,
            },
        });

        const doc = new PDFDocument(pdfOptions);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="preview_multi.pdf"');
        doc.pipe(res);
        drawMultiEmploymentCertificate(doc, { ...data, fullRefNumber, qrCodeDataUrl });
        doc.end();
    } catch (error) {
        console.error("PDF Generation Error:", error);
        if (!res.headersSent) {
            res.status(500).send('An internal server error occurred during PDF generation.');
        }
    }
});

router.get('/check-generated', async (req, res) => {
    const { recipient_name } = req.query;
    if (!recipient_name) return res.status(400).json({ error: 'recipient_name is required' });
    try {
        const [rows] = await dbPool.query(
            "SELECT reference_number, certificate_type, details, issued_at FROM certificate_registry WHERE recipient_name = ?",
            [recipient_name.trim()]
        );
        res.json(rows.map(r => ({
            type: r.certificate_type,
            reference_number: r.reference_number,
            issued_at: r.issued_at,
            details: (() => { try { return JSON.parse(r.details || '{}'); } catch (_) { return {}; } })()
        })));
    } catch (err) {
        console.error('check-generated error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

router.get('/certificate-stats', async (req, res) => {
    try {
        const [employmentRows] = await dbPool.query("SELECT COUNT(*) as count FROM certificate_registry WHERE certificate_type = 'employment'");
        const [trainingRows] = await dbPool.query("SELECT COUNT(*) as count FROM certificate_registry WHERE certificate_type = 'training'");

        res.json({
            employment_certs: employmentRows[0].count,
            training_certs: trainingRows[0].count
        });

    } catch (error) {
        console.error("Failed to fetch certificate stats:", error);
        res.status(500).json({ error: 'Failed to fetch certificate statistics.' });
    }
});

// =================================================================
// === VALIDATION ROUTES ===========================================
// =================================================================
router.get('/validate-certificate/:refNumber', async (req, res) => {
  try {
    const { refNumber } = req.params;
    const [rows] = await dbPool.query("SELECT * FROM certificate_registry WHERE reference_number = ?", [refNumber]);
    if (rows.length > 0) {
      const row = rows[0];
      const details = JSON.parse(row.details || '{}');
      res.json({ valid: true, data: { recipient_name: row.recipient_name, reference_number: row.reference_number, certificate_type: row.certificate_type, ...details } });
    } else {
      res.json({ valid: false, message: "No certificate found with this reference number." });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/validate-employment-certificate/:refNumber', async (req, res) => {
  try {
    const { refNumber } = req.params;
    const [rows] = await dbPool.query("SELECT * FROM certificate_registry WHERE reference_number = ? AND certificate_type = 'employment'", [refNumber]);
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

// =================================================================
// === REGENERATE CERTIFICATE ROUTE ================================
// =================================================================
// Regenerates an employment certificate using the same reference number.
// Updates local DB + Turso with corrected data. No new logbook entry.
router.post('/regenerate-employment-certificate', async (req, res) => {
  const data      = req.body;
  const refNumber = data.refNumber;

  if (!refNumber) return res.status(400).json({ error: 'Reference number is required for regeneration.' });

  try {
    // Confirm the certificate exists and grab the original QR token in one query
    const [rows] = await dbPool.query(
      "SELECT * FROM certificate_registry WHERE reference_number = ? AND certificate_type = 'employment'",
      [refNumber]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Employment certificate not found.' });

    // Retrieve the original QR token + existing values for diff before overwriting
    const existingDetails = JSON.parse(rows[0].details || '{}');
    const storedQrToken   = existingDetails.qr_token || null;
    const existingName    = rows[0].recipient_name || '';

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

    // Build derived values
    const recipientName = `${data.first_name || ''} ${data.middle_initial || ''} ${data.last_name || ''} ${data.suffix || ''}`.replace(/\s+/g, ' ').trim();

    // Use raw dates if provided, otherwise fall back to the stored formatted string
    let duration;
    if (data.contract_start_date && data.contract_end_date) {
      duration = formatDateRange(data.contract_start_date, data.contract_end_date);
    } else {
      duration = data.contract_duration || '';
    }

    // --- Update local MariaDB (carry original qr_token forward so future regenerations stay identical) ---
    try {
      await dbPool.query(
        'UPDATE certificate_registry SET recipient_name = ?, details = ? WHERE reference_number = ?',
        [
          recipientName,
          JSON.stringify({
            employment_titles    : data.project_name,
            position             : data.position,
            contract_duration    : duration,
            performance_rating   : data.performance_rating || null,
            remarks              : data.remarks || null,
            qr_token             : storedQrToken,
          }),
          refNumber,
        ]
      );
    } catch (localDbErr) {
      console.error('[regenerate-employment] Local DB update failed:', localDbErr.message);
    }

    // --- Update Turso certificate_registry ---
    await updateCertificateInTurso(executeTurso, {
      refNumber,
      recipientName,
      details: {
        position           : data.position,
        project            : data.project_name,
        duration,
        performance_rating : data.performance_rating || null,
        remarks            : data.remarks || null,
      },
    });

    // --- Update Turso Digital_Logbook: TRANSMITTER → editor, REMARKS → changed fields ---
    {
      const changes = [];
      const norm    = (v) => (v || '').toString().trim();
      if (norm(existingName)                       !== norm(recipientName))       changes.push('Recipient Name');
      if (norm(existingDetails.position)           !== norm(data.position))       changes.push('Position');
      if (norm(existingDetails.employment_titles)  !== norm(data.project_name))   changes.push('Project/Assignment');
      if (norm(existingDetails.contract_duration)  !== norm(duration))            changes.push('Duration');
      if (norm(existingDetails.performance_rating) !== norm(data.performance_rating)) changes.push('Performance Rating');
      if (norm(existingDetails.remarks)            !== norm(data.remarks))        changes.push('Notes/Commendations');
      const editDate   = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });
      const remarkText = changes.length
        ? `${editDate}: ${changes.join(', ')} corrected.`
        : `Re-printed on ${editDate} (no data changes).`;
      await updateTursoLogbookEntry(executeTurso, { refNumber, editorName, remarks: remarkText });
    }

    // --- Reuse the original QR token so the QR image is identical to the first-issued cert ---
    let qrCodeDataUrl;
    if (storedQrToken) {
      const verifyBase = (process.env.VERCEL_VERIFY_URL || 'https://cert-verify.is-a.dev').replace(/\/$/, '');
      qrCodeDataUrl = await QRCode.toDataURL(`${verifyBase}/verify?t=${storedQrToken}`, { errorCorrectionLevel: 'M', width: 512 });
    } else {
      // Fallback for certificates issued before token storage was added
      qrCodeDataUrl = await QRCode.toDataURL(buildVerifyURL(refNumber, 'employment', recipientName), { errorCorrectionLevel: 'M', width: 512 });
    }

    // Build the data object for the drawing function.
    // If raw dates are absent, patch the formatDateRange call by replacing contract dates
    // with sentinel values and pre-supplying the duration as a passthrough.
    const certData = {
      ...data,
      name           : recipientName,
      fullRefNumber  : refNumber,
      qrCodeDataUrl,
      // Ensure formatDateRange inside drawEmploymentCertificate has valid inputs;
      // if the caller didn't send raw dates, we inject them as null so the function
      // returns an empty string, then we pass contract_duration for the body text.
      contract_start_date : data.contract_start_date || null,
      contract_end_date   : data.contract_end_date   || null,
      // passthrough for situations where raw dates are absent
      contract_duration   : duration,
    };

    const doc = new PDFDocument(pdfOptions);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Certificate-${recipientName}.pdf"`);
    doc.pipe(res);

    // If raw dates are missing, patch the drawing function by supplying a modified data
    // object so the body text uses the pre-formatted duration string.
    if (!data.contract_start_date || !data.contract_end_date) {
      // Inject dummy equal dates so formatDateRange produces an empty string,
      // then override via a pre-built bodyText workaround.
      // Easier: pass a special flag the drawing function can check.
      certData._preFormattedDuration = duration;
    }

    drawEmploymentCertificateForRegenerate(doc, certData);
    doc.end();
  } catch (error) {
    console.error('[regenerate-employment] Error:', error);
    if (!res.headersSent) res.status(500).send('Failed to regenerate certificate.');
  }
});

module.exports = router;
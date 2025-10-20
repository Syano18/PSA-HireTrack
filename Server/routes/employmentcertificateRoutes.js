const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const path = require('path');

// --- Helper Functions ---
const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date)) return '';
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
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

// --- Drawing Function for Single Employment Certificate ---
const drawEmploymentCertificate = (doc, data) => {
    const timesBold = 'Helvetica-Bold';
    const timesRoman = 'Helvetica';
    const leftMargin = 72;
    const writableWidth = doc.page.width - (leftMargin * 2);
    const timesItalic = 'Helvetica-Oblique';
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
    }

    // --- Reference Number ---
    const today = new Date();
    const last2 = today.getFullYear().toString().slice(-2);
    const refNumber = `Reference No.: ${last2}CAR32-`;
    doc.font(timesRoman).fontSize(10).text(refNumber, leftMargin, 105);

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
                   `Philippine Statistics Authority - Provincial Statistical Office - Kalinga ` +
                   `as ${getArticle(data.position)} ${data.position} under the ${data.project_name} ` +
                   `for the period of ${formatDateRange(data.contract_start_date, data.contract_end_date)}.`;

    // 2. Draw the entire string with one command.
    doc.font(timesRoman) // Set the font for the whole paragraph
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
    doc.font(timesRoman).text(data.performance_rating);
    doc.moveDown(0.5);
    doc.font(timesBold).text('Notes/Commendations: ', { continued: true, indent: 50 });
    doc.font(timesRoman).text(data.remarks);

    doc.moveDown(2);
    doc.font(timesRoman).text(
        `This certification is issued upon the request of ${title} ${data.last_name} for employment purposes.`,
        { align: 'justify', indent: 36, lineGap: 4 }
    );

    doc.moveDown(2);
    const day = today.getDate();
    const monthYear = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const dateIssuedText = `Issued this ${day}${getOrdinalSuffix(day)} day of ${monthYear} at the Provincial Statistical Office - Kalinga, Bulanao, Tabuk City, Kalinga.`;
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

    // --- Footer Section ---
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

// --- Table Drawing Function for Multi-Certificate ---
const drawEmploymentTable = (doc, employments) => {
    const tableTopY = doc.y;
    const leftMargin = 60;
    const rowFontSize = 12;
    const headerFontSize = 12;
    const font = 'Helvetica';
    const boldFont = 'Helvetica-Bold';
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
    doc.font(boldFont).fontSize(headerFontSize);

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
    doc.font(font).fontSize(rowFontSize);

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
    const timesBold = 'Helvetica-Bold';
    const timesRoman = 'Helvetica';
    const leftMargin = 60;
    const writableWidth = doc.page.width - (leftMargin * 2);

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
    
    const drawFooter = () => {
        const timesItalic = 'Helvetica-Oblique';
        const notesed = data.warnotes || 'This is a system-generated document and is not valid without an authorized signature.';
        const footerY = doc.page.height - 90;

        try {
            const footlogo = path.join(__dirname, '../assets/footer.png');
            doc.save();
            doc.fillColor('gray').font(timesItalic).fontSize(10).text(notesed, leftMargin, footerY, { width: writableWidth, align: 'left' });
            doc.strokeColor('gray').moveTo(leftMargin, footerY + 15).lineTo(doc.page.width - leftMargin, footerY + 15).stroke();
            doc.image(footlogo, leftMargin + (writableWidth - 400) / 2, footerY + 20, { width: 400 });
            doc.restore();
        } catch (err) {
            console.error("Error embedding footer images:", err.message);
        }
    };

    doc.on('pageAdded', () => {
        drawHeader();
        drawFooter();
        doc.y = 160;
    });

    drawHeader();
    drawFooter();

    const today = new Date();
    const last2 = today.getFullYear().toString().slice(-2);
    const refNumber = `Reference No.: ${last2}CAR32-`;
    doc.font(timesRoman).fontSize(10).text(refNumber, leftMargin, 105);
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
                   `Philippine Statistics Authority - Provincial Statistical Office - Kalinga. ` +
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

    doc.x = leftMargin;
    doc.font(timesRoman).fontSize(12)
        .text(`This certification is issued upon the request of ${title} ${data.lastName} for employment purposes.`, {
            width: writableWidth,
            align: 'justify',
            indent: 36,
            lineGap: 4
        });
    doc.moveDown(2);

    const day = today.getDate();
    const monthYear = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const dateIssuedText = `Issued this ${day}${getOrdinalSuffix(day)} day of ${monthYear} at the PSA-Kalinga Provincial Statistical Office, Bulanao, Tabuk City, Kalinga.`;
    
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
};

// --- API ROUTES ---
router.post('/generate-employment-certificate', (req, res) => {
    const data = req.body;
    if ( !data.performance_rating || String(data.performance_rating).toLowerCase === 'n/a' ) {
        return res.status(400).json({ message: "Cannot generate certificate: Performance Rating is blank or n/a" });
    }

    try {
        const doc = new PDFDocument({ size: 'A4', margin: 72 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="preview_train.pdf"');
        doc.pipe(res);
        drawEmploymentCertificate(doc, data);
        doc.end();
    } catch (error) {
        console.error("PDF Generation Error:", error);
        if (!res.headersSent) {
            res.status(500).send('An internal server error occurred during PDF generation.');
        } else {
            res.end();
        }
    }
});

router.post('/preview-employment-certificate', (req, res) => {
    const data = req.body;
    if ( !data.performance_rating || String(data.performance_rating).toLowerCase === 'n/a' ) {
        return res.status(400).json({ message: "Cannot generate certificate: Performance Rating is blank or n/a" });
    }

    try {
        const doc = new PDFDocument({ size: 'A4', margin: 72 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="preview_train.pdf"');
        doc.pipe(res);
        drawEmploymentCertificate(doc, data);
        doc.end();
    } catch (error) {
        console.error("PDF Generation Error:", error);
        if (!res.headersSent) {
            res.status(500).send('An internal server error occurred during PDF generation.');
        } else {
            res.end();
        }
    }
});

router.post('/generate-multi-employment-certificate', (req, res) => {
    const data = req.body;
    const hasMissingRating = data.employments && data.employments.some(job =>
        !job.performance_rating || String(job.performance_rating).toLowerCase() === 'n/a'
    );
    if (hasMissingRating) {
        return res.status(400).json({ message: "Cannot generate certificate: At least one employment record has a missing or 'N/A' Overall Performance Rating." });
    }

    try {
        const doc = new PDFDocument({ size: 'A4', margin: 72 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="preview_multi.pdf"');
        doc.pipe(res);
        drawMultiEmploymentCertificate(doc, data);
        doc.end();
    } catch (error) {
        console.error("PDF Generation Error:", error);
        if (!res.headersSent) {
            res.status(500).send('An internal server error occurred during PDF generation.');
        } else {
            res.end();
        }
    }
});

router.post('/preview-multi-employment-certificate', (req, res) => {
    const data = req.body;
    const hasMissingRating = data.employments && data.employments.some(job =>
        !job.performance_rating || String(job.performance_rating).toLowerCase() === 'n/a'
    );
    if (hasMissingRating) {
        return res.status(400).json({ message: "Cannot generate certificate: At least one employment record has a missing or 'N/A' Overall Performance Rating." });
    }

    try {
        const doc = new PDFDocument({ size: 'A4', margin: 72 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="preview_multi.pdf"');
        doc.pipe(res);
        drawMultiEmploymentCertificate(doc, data);
        doc.end();
    } catch (error) {
        console.error("PDF Generation Error:", error);
        if (!res.headersSent) {
            res.status(500).send('An internal server error occurred during PDF generation.');
        } else {
            res.end();
        }
    }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { sendCertificateEmail } = require('../utils/emailService');

// Use memory storage for the uploaded file so it doesn't get saved to disk permanently
const upload = multer({ storage: multer.memoryStorage() });

router.post('/send-email-upload', upload.single('certificate'), async (req, res) => {
  try {
    const { emailAddress, name } = req.body;
    const file = req.file;

    if (!emailAddress) {
      return res.status(400).json({ message: 'Email address is required.' });
    }
    
    if (!file) {
      return res.status(400).json({ message: 'Certificate PDF file is required.' });
    }

    const fileName = file.originalname || `Certificate-${name || 'PSA'}.pdf`;

    await sendCertificateEmail(emailAddress, name || 'Employee', file.buffer, fileName);
    
    res.json({ message: 'Email sent successfully with the uploaded certificate!' });
  } catch (error) {
    console.error('Error in send-email-upload:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

module.exports = router;

require('dotenv').config();
global.TextDecoder = require('text-encoding').TextDecoder;
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
const port = 3001;

app.use(cors());

// --- MIDDLEWARE ---
app.use(express.json({ limit: '10mb' }));

// IP Whitelist - Allow only local network (192.168.169.x) and VPN users
const ipWhitelistMiddleware = require('./middleware/ipWhitelist');
app.use(ipWhitelistMiddleware);

// --- IMPORT ROUTE FILES ---
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const locationRoutes = require('./routes/locations');
const employeeRoutes = require('./routes/employees');
const trainingRoutes = require('./routes/trainings');
const employmentRoutes = require('./routes/employments');
const trainingcertificateRoutes = require('./routes/trainingcertificateRoutes');
const employmentcertificateRoutes = require('./routes/employmentcertificateRoutes');
const dashboardRoutes = require('./routes/dashboard'); // This is the one we're fixing
const databaseRoutes = require('./routes/database');
const applicantRoutes = require('./routes/applicants');

// --- USE ROUTES ---
app.use('/api', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', locationRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/trainings', trainingRoutes);
app.use('/api/employments', employmentRoutes);
app.use('/api', trainingcertificateRoutes);
app.use('/api', employmentcertificateRoutes);
app.use('/api', dashboardRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/applicants', applicantRoutes);

// --- GLOBAL ERROR HANDLER ---
// This should be the last 'use' middleware. It catches any unhandled errors from routes.
app.use((err, req, res, next) => {
    console.error('[GLOBAL UNHANDLED ERROR]', err);
    // Send a generic message to the client to avoid leaking implementation details.
    res.status(500).json({ message: 'An internal server error occurred.' });
});

// --- START SERVER ---
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
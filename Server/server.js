require('dotenv').config();
global.TextDecoder = require('text-encoding').TextDecoder;
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const port = 80;

app.use(cors());

// --- MIDDLEWARE ---
app.use(express.json({ limit: '10mb' }));

// IP Whitelist - Allow only local network (192.168.169.x) and VPN users
const ipWhitelistMiddleware = require('./middleware/ipWhitelist');
app.use(ipWhitelistMiddleware);

// --- HEALTH CHECK ENDPOINT (for network diagnostics) ---
// This endpoint allows clients to verify server is reachable and responsive
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    message: 'Server is running and responsive',
    timestamp: new Date().toISOString()
  });
});

// --- IMPORT ROUTE FILES ---
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const locationRoutes = require('./routes/locations');
const employeeRoutes = require('./routes/employees');
const trainingRoutes = require('./routes/trainings');
const employmentRoutes = require('./routes/employments');
const emailRoutes = require('./routes/emailRoutes');
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
app.use('/api', emailRoutes);
app.use('/api', trainingcertificateRoutes);
app.use('/api', employmentcertificateRoutes);
app.use('/api', dashboardRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/applicants', applicantRoutes);

// --- SERVE FRONTEND ---
// Base path should be the directory of the executable if running via pkg, otherwise __dirname
const basePath = process.pkg ? path.dirname(process.execPath) : __dirname;

// Serve static files from the React app
app.use(express.static(path.join(basePath, 'client_build')));

// For any other GET request not starting with /api, send back React's index.html
app.use((req, res, next) => {
    if (req.method !== 'GET' || req.url.startsWith('/api')) {
        return next();
    }
    res.sendFile(path.join(basePath, 'client_build', 'index.html'));
});


// --- GLOBAL ERROR HANDLER ---
// This should be the last 'use' middleware. It catches any unhandled errors from routes.
app.use((err, req, res, next) => {
    console.error('[GLOBAL UNHANDLED ERROR]', err);
    // Send a generic message to the client to avoid leaking implementation details.
    res.status(500).json({ message: 'An internal server error occurred.' });
});

// --- START SERVER ---
const certPath = path.join(basePath, 'cert.pem');
const keyPath = path.join(basePath, 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    console.log('SSL certificates found! Starting HTTPS server on port 443...');
    const options = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
    };
    
    // Start HTTPS Server
    https.createServer(options, app).listen(443, () => {
        console.log('Secure HTTPS Server is running on port 443');
    });

    // Start HTTP Server to redirect all traffic to HTTPS
    http.createServer((req, res) => {
        const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
        res.writeHead(301, { "Location": "https://" + host + req.url });
        res.end();
    }).listen(80, () => {
        console.log('HTTP Server is running on port 80 (Redirecting to HTTPS)');
    });
} else {
    console.log('No SSL certificates (cert.pem, key.pem) found. Starting standard HTTP server...');
    app.listen(port, () => {
        console.log(`HTTP Server running on port ${port}`);
    });
}
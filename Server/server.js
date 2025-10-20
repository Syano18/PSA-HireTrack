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
const auditRoutes = require('./routes/audit');
const databaseRoutes = require('./routes/database');




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
app.use('/api/audit', auditRoutes);
app.use('/api/database', databaseRoutes);

// --- START SERVER ---
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
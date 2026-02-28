// your_auth_routes_file.js

const express = require('express');
const jwt = require('jsonwebtoken');
const dbPool = require('../db');
const logError = require('../utils/logger');
const admin = require('../firebaseAdmin');
require('dotenv').config();

const router = express.Router();

router.post('/login', async (req, res) => {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'ID Token is required.' });

    try {
        // --- 1. VERIFY FIREBASE TOKEN ---
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const email = decodedToken.email;

        // --- 2. CHECK LOCAL USER EXISTENCE ---
        // We assume the local 'email_address' field matches the Firebase email
        const [results] = await dbPool.query('SELECT * FROM users WHERE email_address = ?', [email]);
        
        if (results.length > 0) {
            const user = results[0];

            if (user.status === 'Inactive') {
                return res.status(403).json({ message: 'Your account is Inactive. Please contact the administrator.' });
            }

            // Map hiretrack_role to role for frontend compatibility
            user.role = user.hiretrack_role;
            const { password_hash, hiretrack_role, ...userResponse } = user;

            // --- 3. CREATE THE APP JWT (Keep existing logic for internal auth) ---
            const token = jwt.sign(
                { id: user.id, email: user.email_address, role: user.role }, // user.role is now populated from hiretrack_role
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            // --- 4. INVALIDATE OLD TOKEN AND SAVE THE NEW ONE ---
            const connection = await dbPool.getConnection();
            try {
                await connection.beginTransaction();
                // Delete any existing token for this user
                await connection.query('DELETE FROM active_jwts WHERE user_id = ?', [user.id]);
                // Insert the new token as the only valid one
                await connection.query('INSERT INTO active_jwts (user_id, token) VALUES (?, ?)', [user.id, token]);
                await connection.commit();
            } catch (dbError) {
                await connection.rollback();
                throw dbError; // Forward the error to the main catch block
            } finally {
                connection.release();
            }

            // --- 3. SEND TOKEN AND USER DATA ---
            res.json({ message: 'Login successful', token, user: userResponse });
        } else {
            res.status(401).json({ message: 'User not found in system.' });
        }
    } catch (err) {
        console.error(`Login error: ${err.message}`);
        logError(`Login error: ${err.message}`, 'auth');
        res.status(401).json({ message: 'Authentication failed.' });
    }
});

module.exports = router;
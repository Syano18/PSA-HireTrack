// your_auth_routes_file.js

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dbPool = require('../db');
const logError = require('../utils/logger');
require('dotenv').config();

const router = express.Router();

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' });

    try {
        const [results] = await dbPool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (results.length === 0) return res.status(401).json({ message: 'Invalid credentials.' });

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        
        if (isMatch) {
            const { password_hash, ...userResponse } = user;

            // --- 1. CREATE THE NEW TOKEN ---
            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            // --- 2. INVALIDATE OLD TOKEN AND SAVE THE NEW ONE ---
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
            res.status(401).json({ message: 'Invalid credentials.' });
        }
    } catch (err) {
        console.error(`Database error during login: ${err.message}`);
        logError(`Database error during login: ${err.message}`, 'auth');
        res.status(500).json({ message: 'Internal server error.' });
    }
});

module.exports = router;
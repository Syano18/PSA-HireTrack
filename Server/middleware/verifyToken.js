const jwt = require('jsonwebtoken');
const dbPool = require('../db');
require('dotenv').config();

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(403).json({ message: 'A token is required for authentication.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(403).json({ message: 'Token not found or malformed.' });
    }

    try {
        if (!process.env.JWT_SECRET) {
            // This is a good check to prevent silent failures if the .env is missing
            console.error('JWT_SECRET not configured in .env file');
            return res.status(500).json({ message: 'Server configuration error.' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check if this token is the currently active one in the database
        const [rows] = await dbPool.query(
            'SELECT user_id FROM active_jwts WHERE user_id = ? AND token = ?',
            [decoded.id, token]
        );

        // If no rows are found, the token is valid but has been replaced by a new login
        if (rows.length === 0) {
            return res.status(401).json({ message: 'Session expired. Please log in again.' });
        }

        // Token is valid and active, attach user info to the request
        req.user = decoded;
        
        // Proceed to the next middleware or route handler
        return next();

    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired. Please log in again.' });
        }
        // Catches other errors like invalid signature
        return res.status(401).json({ message: 'Invalid token.' });
    }
};

module.exports = verifyToken;
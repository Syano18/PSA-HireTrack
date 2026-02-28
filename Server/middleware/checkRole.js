// middleware/checkRole.js
const dbPool = require('../db'); // Use the same database connection

/**
 * Middleware to restrict access to certain roles.
 * @param {Array} allowedRoles - Roles allowed to access the route
 */
const checkRole = (allowedRoles = []) => {
    return async (req, res, next) => {
        try {
            const actingUserId = req.user.id;

            // Get role directly from database
            const [rows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [actingUserId]);
            const actingUser = rows[0];

            if (!actingUser || !allowedRoles.includes(actingUser.role)) {
                return res.status(403).json({ error: 'You do not have permission to access this resource.' });
            }

            next();
        } catch (err) {
            console.error('Role check failed:', err);
            res.status(500).json({ error: 'Server error during role validation.' });
        }
    };
};

module.exports = checkRole;
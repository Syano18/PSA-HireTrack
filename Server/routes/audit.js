const express = require('express');
const router = express.Router();
const dbPool = require('../db');

// GET /api/audit - fetch latest audit logs
router.get('/', async (req, res) => {
  try {
    const [rows] = await dbPool.query(`
      SELECT 
        a.id,
        a.user_id,
        a.action,
        a.entity,
        a.entity_id,
        a.old_data,
        a.new_data,
        a.created_at,
        CONCAT(u.first_name, ' ', u.last_name) AS user_name,
        u.role AS user_role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching audit logs:', err.message);
    res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
});

module.exports = router;
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dbPool = require('../db');
const verifyToken = require('../middleware/verifyToken');
const checkRole = require('../middleware/checkRole');
const { logAudit } = require('../utils/auditLogger');

const router = express.Router();
const saltRounds = 10;

// Helper: Safe audit log
const safeLogAudit = async (...args) => {
  try {
    await logAudit(...args);
  } catch (auditErr) {
    console.error('Audit log failed:', auditErr.message);
  }
};

// Helper: Get user role
const getUserWithRole = async (userId) => {
  const [rows] = await dbPool.query('SELECT role FROM users WHERE id = ?', [userId]);
  return rows[0];
};

// GET /api/users
router.get('/', verifyToken, checkRole(['Super_Admin', 'Admin', 'PACD']), async (req, res) => {
  try {
    const [results] = await dbPool.query(
      "SELECT id, first_name, middle_initial, suffix, last_name, username, role, created_at, force_password_change FROM users ORDER BY last_name, first_name"
    );
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve data.' });
  }
});

// POST /api/users (Create user)
router.post('/', verifyToken, checkRole(['Super_Admin', 'Admin', 'PACD']), async (req, res) => {
  const actingUserId = req.user?.id;
  const { first_name, middle_initial, last_name, suffix, username, role } = req.body;

  if (!actingUserId || !first_name || !middle_initial || !last_name || !username || !role) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    const actingUser = await getUserWithRole(actingUserId);
    if (!actingUser) return res.status(403).json({ error: 'Permission denied.' });

    const [existingUsers] = await dbPool.query(
      'SELECT id FROM users WHERE username = ? OR (first_name <=> ? AND middle_initial <=> ? AND last_name <=> ? AND suffix <=> ?)',
      [username, first_name, middle_initial, last_name, suffix || null]
    );
    if (existingUsers.length > 0) return res.status(409).json({ error: 'User already exists.' });

    const allowedByAdmin = ['Focal Person', 'PACD', 'User'];
    if (actingUser.role === 'Admin' && !allowedByAdmin.includes(role)) return res.status(403).json({ error: 'Admins can only create certain roles.' });
    if (actingUser.role === 'PACD' && !['User', 'Focal Person'].includes(role)) return res.status(403).json({ error: 'PACD can only create User or Focal Person roles.' });
    if (['Focal Person', 'User'].includes(actingUser.role)) return res.status(403).json({ error: 'Permission denied.' });

    const temporaryPassword = crypto.randomBytes(5).toString('hex');
    const hash = await bcrypt.hash(temporaryPassword, saltRounds);

    const [result] = await dbPool.query(
      'INSERT INTO users (first_name, middle_initial, last_name, suffix, username, password_hash, role, force_password_change) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)',
      [first_name, middle_initial || null, last_name, suffix || null, username, hash, role]
    );

    await safeLogAudit(
      actingUserId,
      'CREATE',
      'user',
      result.insertId,
      null,
      {
        ...req.body,
        temporaryPassword
      }
    );

    res.status(201).json({ message: 'User created successfully', userId: result.insertId, temporaryPassword });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error.' });
  }
});

// PUT /api/users/:id (Update user)
router.put('/:id', verifyToken, checkRole(['Super_Admin', 'Admin', 'PACD']), async (req, res) => {
  const { id } = req.params;
  const actingUserId = req.user?.id;
  const { first_name, middle_initial, last_name, suffix, username, role } = req.body;

  if (!actingUserId || !first_name || !last_name || !username || !role) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    const actingUser = await getUserWithRole(actingUserId);

    const [targetUserRows] = await dbPool.query(
      'SELECT first_name, middle_initial, last_name, suffix, username, role FROM users WHERE id = ?',
      [id]
    );
    if (!actingUser || targetUserRows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const targetUser = targetUserRows[0];

    const [existingUsers] = await dbPool.query(
      'SELECT id FROM users WHERE (username = ? OR (first_name <=> ? AND middle_initial <=> ? AND last_name <=> ? AND suffix <=> ?)) AND id != ?',
      [username, first_name, middle_initial, last_name, suffix || null, id]
    );
    if (existingUsers.length > 0) return res.status(409).json({ error: 'Another user with this username or full name already exists.' });

    // Permission rules
    if (actingUser.role === 'Admin' && targetUser.role === 'Super_Admin') return res.status(403).json({ error: 'Admins cannot edit Super_Admins.' });
    const allowedByAdmin = ['Focal Person', 'PACD', 'User'];
    if (actingUser.role === 'Admin' && !allowedByAdmin.includes(targetUser.role)) return res.status(403).json({ error: 'Admins can only edit certain roles.' });
    if (actingUser.role === 'PACD' && !['User', 'Focal Person'].includes(targetUser.role)) return res.status(403).json({ error: 'PACD can only edit User or Focal Person roles.' });
    if (['Focal Person', 'User'].includes(actingUser.role) && actingUser.id !== Number(id)) return res.status(403).json({ error: 'Permission denied.' });

    const updatedUser = { first_name, middle_initial, last_name, suffix, username, role };

    const [result] = await dbPool.query(
      'UPDATE users SET first_name = ?, middle_initial = ?, last_name = ?, suffix = ?, username = ?, role = ? WHERE id = ?',
      [first_name, middle_initial || null, last_name, suffix || null, username, role, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found.' });

    await safeLogAudit(
      actingUserId,
      'UPDATE',
      'user',
      id,
      targetUser,
      updatedUser
    );

    res.json({ message: 'User updated successfully' });
  } catch (err) {
    console.error(`Database error during user update: ${err.message}`);
    return res.status(500).json({ error: 'Database error.' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', verifyToken, checkRole(['Super_Admin', 'Admin', 'PACD']), async (req, res) => {
  const { id } = req.params;
  const actingUserId = req.user?.id;

  if (!actingUserId) return res.status(400).json({ error: 'Action requires authentication.' });

  try {
    const actingUser = await getUserWithRole(actingUserId);
    const [targetUserRows] = await dbPool.query('SELECT role, first_name, middle_initial, last_name, suffix, username FROM users WHERE id = ?', [id]);
    if (!actingUser || targetUserRows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const targetUser = targetUserRows[0];

    if (actingUser.role === 'Admin' && targetUser.role === 'Super_Admin') return res.status(403).json({ error: 'Admins cannot delete Super_Admins.' });
    if (actingUser.role === 'PACD' && !['User', 'Focal Person'].includes(targetUser.role)) return res.status(403).json({ error: 'PACD can only edit User or Focal Person roles.' })
    if (['Focal Person', 'User'].includes(actingUser.role)) return res.status(403).json({ error: 'Permission denied.' });

    const [result] = await dbPool.query('DELETE FROM users WHERE id = ?', [id]);

    await safeLogAudit(
      actingUserId,
      'DELETE',
      'user',
      id,
      targetUser,
      null
    );

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error.' });
  }
});

// PUT /api/users/:id/change-password
router.put('/:id/change-password', verifyToken, async (req, res) => {
  const { id } = req.params;
  const actingUserId = req.user?.id;
  const { newPassword } = req.body;

  if (!actingUserId || !newPassword) return res.status(400).json({ error: 'New password is required.' });

  try {
    const hash = await bcrypt.hash(newPassword, saltRounds);
    await dbPool.query('UPDATE users SET password_hash = ?, force_password_change = FALSE WHERE id = ?', [hash, id]);

    await safeLogAudit(
      actingUserId,
      'UPDATE',
      'user_password',
      id,
      null,
      {timestamp: new Date().toISOString() }
    );

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error during password change.' });
  }
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', verifyToken, checkRole(['Super_Admin', 'Admin', 'PACD']), async (req, res) => {
  const { id } = req.params;
  const actingUserId = req.user?.id;

  if (!actingUserId) return res.status(403).json({ error: 'Action requires authentication.' });

  const temporaryPassword = crypto.randomBytes(5).toString('hex');

  try {
    const [targetUserRows] = await dbPool.query(
      'SELECT first_name, middle_initial, last_name, suffix, username FROM users WHERE id = ?',
      [id]
    );
    if (targetUserRows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const targetUser = targetUserRows[0];

    const hash = await bcrypt.hash(temporaryPassword, saltRounds);
    await dbPool.query(
      'UPDATE users SET password_hash = ?, force_password_change = TRUE WHERE id = ?',
      [hash, id]
    );

    await logAudit(
      actingUserId,
      'RESET_PASSWORD',
      'user',
      id,
      null,
      {
        temporaryPassword,
        targetUser: `${targetUser.first_name} ${targetUser.middle_initial || ''} ${targetUser.last_name} ${targetUser.suffix || ''}`.trim(),
        username: targetUser.username
      }
    );

    res.json({ message: 'Password has been reset.', temporaryPassword });
  } catch (err) {
    console.error(`Database error during password reset: ${err.message}`);
    res.status(500).json({ error: 'Database error during password reset.' });
  }
});

module.exports = router;
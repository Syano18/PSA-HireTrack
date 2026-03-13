const express = require('express');
const crypto = require('crypto');
const dbPool = require('../db');
const verifyToken = require('../middleware/verifyToken');
const checkRole = require('../middleware/checkRole');
const admin = require('../firebaseAdmin');

const router = express.Router();

// Helper: Get user role
const getUserWithRole = async (userId) => {
  const [rows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
  return rows[0];
};

// Helper: Execute Turso Sync via HTTP (Avoids pkg build issues with @libsql/client)
const executeTurso = async (sql, args) => {
  const dbUrl = process.env.TURSO_DB_URL?.replace(/^libsql:/, 'https:');
  const authToken = process.env.TURSO_AUTH_TOKEN;
  
  if (!dbUrl || !authToken) return;
 
  const hranaArgs = args.map(arg => {
    if (arg === null || arg === undefined) return { type: "null" };
    if (typeof arg === 'number') return { type: "float", value: arg };
    return { type: "text", value: String(arg) };
  });
 
  const body = {
    requests: [
      { type: "execute", stmt: { sql, args: hranaArgs } },
      { type: "close" }
    ]
  };
 
  try {
    const response = await fetch(`${dbUrl}/v2/pipeline`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Turso Sync Error: ${response.status} ${errorText}`);
    }
  } catch (err) {
    // Re-throw to be caught by the transactional logic
    throw err;
  }
};

// GET /api/users
router.get('/', verifyToken, checkRole(['Super_Admin', 'Admin', 'PACD']), async (req, res) => {
  try {
    const [results] = await dbPool.query(
      "SELECT id, first_name, middle_initial, suffix, last_name, email_address AS email, hiretrack_role AS role, opshub_role, position, salary, salary_grade, status, created_at FROM users ORDER BY last_name, first_name"
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
  const { first_name, middle_initial, last_name, suffix, email, role, opshub_role, position, salary, salary_grade, status } = req.body;

  if (!actingUserId || !first_name || !middle_initial || !last_name || !email || !role || !status) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const connection = await dbPool.getConnection();

  try {
    // --- Pre-transaction checks ---
    const actingUser = await getUserWithRole(actingUserId);
    if (!actingUser) throw new Error('Permission denied.');

    const [existingUsers] = await dbPool.query(
      'SELECT id FROM users WHERE email_address = ? OR (first_name <=> ? AND middle_initial <=> ? AND last_name <=> ? AND suffix <=> ?)',
      [email, first_name, middle_initial, last_name, suffix || null]
    );
    if (existingUsers.length > 0) {
      return res.status(409).json({ error: 'User with this email or name already exists.' });
    }

    const allowedByAdmin = ['Focal Person', 'PACD', 'User'];
    if (actingUser.role === 'Admin' && !allowedByAdmin.includes(role)) {
      throw new Error('Admins can only create certain roles.');
    }
    if (actingUser.role === 'PACD' && !['User', 'Focal Person'].includes(role)) {
      throw new Error('PACD can only create User or Focal Person roles.');
    }
    if (['Focal Person', 'User'].includes(actingUser.role)) {
      throw new Error('Permission denied.');
    }

    // --- Start Transaction ---
    await connection.beginTransaction();

    // 1. INSERT into local DB
    const [result] = await connection.query(
      'INSERT INTO users (first_name, middle_initial, last_name, suffix, email_address, hiretrack_role, opshub_role, position, salary, salary_grade, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [first_name, middle_initial || null, last_name, suffix || null, email, role, opshub_role || null, position || null, salary || null, salary_grade || null, status || 'Active']
    );
    const newUserId = result.insertId;

    // 2. CREATE in Firebase
    const temporaryPassword = crypto.randomBytes(16).toString('hex');
    let resetLink = null;
    try {
      await admin.auth().createUser({
        email: email,
        password: temporaryPassword,
        displayName: `${first_name} ${last_name}`,
        emailVerified: true
      });
      resetLink = await admin.auth().generatePasswordResetLink(email);
    } catch (fbErr) {
      await connection.rollback(); // Rollback local DB insert
      console.error('Firebase Create Error:', fbErr);
      throw new Error(`Firebase Error: ${fbErr.message}`); // Throw to be caught by main handler
    }

    // 3. SYNC to Turso
    try {
      await executeTurso(
        "INSERT INTO User_Permissions (Email, First_Name, Middle_Name, Last_Name, Suffix, Role, Position, Salary, Salary_Grade, Status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [email, first_name, middle_initial || null, last_name, suffix || null, opshub_role || null, position || null, salary || null, salary_grade || null, status || 'Active']
      );
    } catch (tursoErr) {
      await connection.rollback(); // Rollback local DB insert
      // Also delete the user from Firebase to keep systems in sync
      try {
        const fbUser = await admin.auth().getUserByEmail(email);
        if (fbUser) await admin.auth().deleteUser(fbUser.uid);
      } catch (fbDeleteErr) {
        console.error('CRITICAL: Failed to rollback Firebase user creation after Turso failure:', fbDeleteErr);
      }
      console.error('Turso Sync Error:', tursoErr);
      throw new Error(`Turso Sync Error: ${tursoErr.message}`); // Throw to be caught
    }

    // --- Commit Transaction ---
    await connection.commit();

    // --- Post-transaction actions ---
    res.status(201).json({ message: 'User created successfully', userId: newUserId, resetLink });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err);
    if (err.message.includes('Permission denied') || err.message.includes('Admins can only create')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.startsWith('Firebase Error:') || err.message.startsWith('Turso Sync Error:')) {
      return res.status(500).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Database error.' });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/users/:id (Update user)
router.put('/:id', verifyToken, checkRole(['Super_Admin', 'Admin', 'PACD']), async (req, res) => {
  const { id } = req.params;
  const actingUserId = req.user?.id;
  const { first_name, middle_initial, last_name, suffix, email, role, opshub_role, position, salary, salary_grade, status } = req.body;

  if (!actingUserId || !first_name || !middle_initial || !last_name || !email || !role || !status) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const connection = await dbPool.getConnection();

  try {
    await connection.beginTransaction();

    const actingUser = await getUserWithRole(actingUserId);

    const [targetUserRows] = await connection.query(
      'SELECT first_name, middle_initial, last_name, suffix, email_address, hiretrack_role AS role, opshub_role, position, salary, salary_grade, status FROM users WHERE id = ?',
      [id]
    );
    if (!actingUser || targetUserRows.length === 0) {
      throw new Error('User not found.');
    }

    const targetUser = targetUserRows[0];
    const oldEmail = targetUser.email_address;

    const [existingUsers] = await connection.query(
      'SELECT id FROM users WHERE (email_address = ? OR (first_name <=> ? AND middle_initial <=> ? AND last_name <=> ? AND suffix <=> ?)) AND id != ?',
      [email, first_name, middle_initial, last_name, suffix || null, id]
    );
    if (existingUsers.length > 0) {
      throw new Error('Another user with this email or full name already exists.');
    }

    // Permission rules
    if (actingUser.role === 'Admin' && targetUser.role === 'Super_Admin') {
      throw new Error('Admins cannot edit Super_Admins.');
    }
    const allowedByAdmin = ['Focal Person', 'PACD', 'User'];
    if (actingUser.role === 'Admin' && !allowedByAdmin.includes(targetUser.role)) {
      throw new Error('Admins can only edit certain roles.');
    }
    if (actingUser.role === 'PACD' && !['User', 'Focal Person'].includes(targetUser.role)) {
      throw new Error('PACD can only edit User or Focal Person roles.');
    }
    if (['Focal Person', 'User'].includes(actingUser.role) && actingUser.id !== Number(id)) {
      throw new Error('Permission denied.');
    }

    // --- UPDATE FIREBASE IF EMAIL CHANGED ---
    if (oldEmail !== email) {
      try {
        const fbUser = await admin.auth().getUserByEmail(oldEmail);
        await admin.auth().updateUser(fbUser.uid, { email: email });
      } catch (fbErr) {
        console.error('Firebase Update Error:', fbErr);
        throw new Error(`Failed to update email in Firebase: ${fbErr.message}`);
      }
    }

    const updatedUser = { first_name, middle_initial, last_name, suffix, email, role, opshub_role, position, salary, salary_grade, status };

    // 1. UPDATE local DB
    await connection.query(
      'UPDATE users SET first_name = ?, middle_initial = ?, last_name = ?, suffix = ?, email_address = ?, hiretrack_role = ?, opshub_role = ?, position = ?, salary = ?, salary_grade = ?, status = ? WHERE id = ?',
      [first_name, middle_initial || null, last_name, suffix || null, email, role, opshub_role || null, position || null, salary || null, salary_grade || null, status, id]
    );

    // 2. SYNC to Turso
    try {
      await executeTurso(
        `UPDATE User_Permissions SET Email = ?, First_Name = ?, Middle_Name = ?, Last_Name = ?, Suffix = ?, Role = ?, Position = ?, Salary = ?, Salary_Grade = ?, Status = ? WHERE Email = ?`,
        [email, first_name, middle_initial || null, last_name, suffix || null, opshub_role || null, position || null, salary || null, salary_grade || null, status, oldEmail]
      );
    } catch (tursoErr) {
      // If Turso fails, try to revert Firebase email change
      if (oldEmail !== email) {
        try {
          const fbUser = await admin.auth().getUserByEmail(email);
          await admin.auth().updateUser(fbUser.uid, { email: oldEmail });
        } catch (fbRevertErr) {
          console.error('CRITICAL: Failed to revert Firebase email after Turso failure:', fbRevertErr);
        }
      }
      throw tursoErr; // re-throw to trigger rollback
    }

    await connection.commit();
    
    res.json({ message: 'User updated successfully' });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error(`User update transaction failed: ${err.message}`);
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Permission denied') || err.message.includes('cannot edit')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message || 'Database transaction failed.' });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/users/:id
router.delete('/:id', verifyToken, checkRole(['Super_Admin', 'Admin', 'PACD']), async (req, res) => {
  const { id } = req.params;
  const actingUserId = req.user?.id;

  if (!actingUserId) return res.status(400).json({ error: 'Action requires authentication.' });

  try {
    const actingUser = await getUserWithRole(actingUserId);
    const [targetUserRows] = await dbPool.query('SELECT hiretrack_role AS role, first_name, middle_initial, last_name, suffix, email_address FROM users WHERE id = ?', [id]);
    if (!actingUser || targetUserRows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const targetUser = targetUserRows[0];

    if (actingUser.role === 'Admin' && targetUser.role === 'Super_Admin') return res.status(403).json({ error: 'Admins cannot delete Super_Admins.' });
    if (actingUser.role === 'PACD' && !['User', 'Focal Person'].includes(targetUser.role)) return res.status(403).json({ error: 'PACD can only edit User or Focal Person roles.' })
    if (['Focal Person', 'User'].includes(actingUser.role)) return res.status(403).json({ error: 'Permission denied.' });

    // --- DELETE FROM FIREBASE ---
    try {
      const fbUser = await admin.auth().getUserByEmail(targetUser.email_address);
      await admin.auth().deleteUser(fbUser.uid);
    } catch (fbErr) {
      // Proceed to delete from local DB even if FB fails (to clean up zombies)
    }

    // Sync to Turso DB (Delete)
    await executeTurso(
      "DELETE FROM User_Permissions WHERE Email = ?",
      [targetUser.email_address]
    );

    const [result] = await dbPool.query('DELETE FROM users WHERE id = ?', [id]);

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
    // --- UPDATE FIREBASE PASSWORD ---
    const [userRows] = await dbPool.query('SELECT email_address FROM users WHERE id = ?', [id]);
    if (userRows.length > 0) {
      try {
        const fbUser = await admin.auth().getUserByEmail(userRows[0].email_address);
        await admin.auth().updateUser(fbUser.uid, { password: newPassword });
      } catch (fbErr) {
        console.error('Firebase Password Change Error:', fbErr);
      }
    }

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

  // Generate a random temporary password
  const temporaryPassword = crypto.randomBytes(16).toString('hex');

  try {
    const [targetUserRows] = await dbPool.query(
      'SELECT first_name, middle_initial, last_name, suffix, email_address FROM users WHERE id = ?',
      [id]
    );
    if (targetUserRows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const targetUser = targetUserRows[0];

    // --- RESET FIREBASE PASSWORD ---
    let resetLink = null;
    try {
      const fbUser = await admin.auth().getUserByEmail(targetUser.email_address);
      await admin.auth().updateUser(fbUser.uid, { password: temporaryPassword });
      resetLink = await admin.auth().generatePasswordResetLink(targetUser.email_address);
    } catch (fbErr) {
      console.error('Firebase Password Reset Error:', fbErr);
      return res.status(500).json({ error: 'Failed to reset password in authentication system.' });
    }

    // Return success with reset link, NO temporary password
    res.json({ message: 'Password has been reset.', resetLink });
  } catch (err) {
    console.error(`Database error during password reset: ${err.message}`);
    res.status(500).json({ error: 'Database error during password reset.' });
  }
});

module.exports = router;
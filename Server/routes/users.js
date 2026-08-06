const express = require('express');
const crypto = require('crypto');
const dbPool = require('../db');
const verifyToken = require('../middleware/verifyToken');
const checkRole = require('../middleware/checkRole');
const { createClerkClient } = require('@clerk/clerk-sdk-node');
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const router = express.Router();
const path = require('path');
const fs = require('fs');

const basePath = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const profilePicDir = path.join(basePath, 'assets', 'profile_pictures');
if (!fs.existsSync(profilePicDir)) {
  fs.mkdirSync(profilePicDir, { recursive: true });
}

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
router.get('/', verifyToken, checkRole(['Super_Admin', 'Admin']), async (req, res) => {
  try {
    const [results] = await dbPool.query(
      "SELECT id, first_name, middle_initial, suffix, last_name, email_address AS email, hiretrack_role AS role, status, created_at FROM users ORDER BY last_name, first_name"
    );
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve data.' });
  }
});

// POST /api/users (Create user)
router.post('/', verifyToken, checkRole(['Super_Admin', 'Admin']), async (req, res) => {
  const actingUserId = req.user?.id;
  const { first_name, middle_initial, last_name, suffix, email, role, status } = req.body;

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
      'INSERT INTO users (first_name, middle_initial, last_name, suffix, email_address, hiretrack_role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [first_name, middle_initial || null, last_name, suffix || null, email, role || null, status || 'Active']
    );
    const newUserId = result.insertId;

    // 2. CREATE in Clerk
    const temporaryPassword = crypto.randomBytes(6).toString('hex');
    let resetLink = null;
    try {
      await clerkClient.users.createUser({
        emailAddress: [email],
        password: temporaryPassword,
        firstName: first_name,
        lastName: last_name,
        skipPasswordChecks: true
      });
      // We don't generate a native reset link easily in Clerk for this flow, so we'll just return the temp password.
    } catch (fbErr) {
      await connection.rollback(); // Rollback local DB insert
      console.error('Clerk Create Error:', fbErr);
      throw new Error(`Clerk Error: ${fbErr.message || JSON.stringify(fbErr)}`); // Throw to be caught by main handler
    }

    // 3. SYNC to Turso
    try {
      await executeTurso(
        "INSERT INTO User_Permissions (Email, First_Name, Middle_Name, Last_Name, Suffix, Role, Status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [email, first_name, middle_initial || null, last_name, suffix || null, role || null, status || 'Active']
      );
    } catch (tursoErr) {
      await connection.rollback(); // Rollback local DB insert
      // Also delete the user from Clerk to keep systems in sync
      try {
        const fbUsers = await clerkClient.users.getUserList({ emailAddress: [email] });
        if (fbUsers.data.length > 0) await clerkClient.users.deleteUser(fbUsers.data[0].id);
      } catch (fbDeleteErr) {
        console.error('CRITICAL: Failed to rollback Clerk user creation after Turso failure:', fbDeleteErr);
      }
      console.error('Turso Sync Error:', tursoErr);
      throw new Error(`Turso Sync Error: ${tursoErr.message}`); // Throw to be caught
    }

    // --- Commit Transaction ---
    await connection.commit();

    // --- Send Email ---
    try {
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        const nodemailer = require('nodemailer');
        const transportOptions = {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        };
        
        if (process.env.SMTP_HOST) {
          transportOptions.host = process.env.SMTP_HOST;
          transportOptions.port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
        } else {
          transportOptions.service = 'gmail';
        }
        
        const transporter = nodemailer.createTransport(transportOptions);
        const fromAddress = process.env.SMTP_FROM || `"HireTrack" <${process.env.SMTP_USER}>`;

        await transporter.sendMail({
          from: fromAddress,
          to: email,
          subject: 'Welcome to HireTrack System - Your Account Details',
          html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #0d9488;">Welcome to PSA HireTrack!</h2>
            <p>Hello ${first_name} ${last_name},</p>
            <p>An administrator has created an account for you with the role of <strong>${role}</strong>.</p>
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Your Login Email:</strong> ${email}</p>
              <p style="margin: 0;"><strong>Your Temporary Password:</strong> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${temporaryPassword}</span></p>
            </div>
            <p>Please log in and change your password as soon as possible.</p>
            <p>Best regards,<br>HireTrack System Admin</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #64748b; margin-bottom: 4px;"><strong>Please do not reply to this email.</strong></p>
            <p style="font-size: 12px; color: #64748b;">This is an automated notification from HireTrack System.</p>
          </div>
        `
        });
        console.log(`Email sent successfully to ${email}`);
      } else {
        console.warn('SMTP credentials not found in .env, skipping welcome email.');
      }
    } catch (emailErr) {
      console.error('Failed to send welcome email:', emailErr);
    }

    // --- Post-transaction actions ---
    res.status(201).json({ message: 'User created successfully', userId: newUserId, resetLink });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err);
    if (err.message.includes('Permission denied') || err.message.includes('Admins can only create')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.startsWith('Clerk Error:') || err.message.startsWith('Turso Sync Error:')) {
      return res.status(500).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Database error.' });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/users/:id (Update user)
router.put('/:id', verifyToken, checkRole(['Super_Admin', 'Admin']), async (req, res) => {
  const { id } = req.params;
  const actingUserId = req.user?.id;
  const { first_name, middle_initial, last_name, suffix, email, role, status } = req.body;

  if (!actingUserId || !first_name || !middle_initial || !last_name || !email || !role || !status) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const connection = await dbPool.getConnection();

  try {
    await connection.beginTransaction();

    const actingUser = await getUserWithRole(actingUserId);

    const [targetUserRows] = await connection.query(
      'SELECT first_name, middle_initial, last_name, suffix, email_address, hiretrack_role AS role, status FROM users WHERE id = ?',
      [id]
    );
    if (!actingUser || targetUserRows.length === 0) {
      throw new Error('User not found.');
    }

    const targetUser = targetUserRows[0];
    const oldEmail = targetUser.email_address;
    const oldStatus = targetUser.status;

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

    // --- UPDATE CLERK IF EMAIL CHANGED ---
    if (oldEmail !== email) {
      try {
        const fbUsers = await clerkClient.users.getUserList({ emailAddress: [oldEmail] });
        if (fbUsers.data.length > 0) {
            // Note: updating email in clerk is more complex (creating an email address, setting it as primary, deleting old).
            // For this admin panel, we'll log it as a pending enhancement.
            console.warn('Clerk email update not implemented yet. User will still login with old email in Clerk.');
        }
      } catch (fbErr) {
        console.error('Clerk Update Error:', fbErr);
        throw new Error(`Failed to update email in Clerk: ${fbErr.message}`);
      }
    }

    const updatedUser = { first_name, middle_initial, last_name, suffix, email, role, status };

    // 1. UPDATE local DB
    await connection.query(
      'UPDATE users SET first_name = ?, middle_initial = ?, last_name = ?, suffix = ?, email_address = ?, hiretrack_role = ?, status = ? WHERE id = ?',
      [first_name, middle_initial || null, last_name, suffix || null, email, role || null, status, id]
    );

    // 2. SYNC to Turso
    try {
      await executeTurso(
        `UPDATE User_Permissions SET Email = ?, First_Name = ?, Middle_Name = ?, Last_Name = ?, Suffix = ?, Role = ?, Status = ? WHERE Email = ?`,
        [email, first_name, middle_initial || null, last_name, suffix || null, role || null, status, oldEmail]
      );
    } catch (tursoErr) {
      // If Turso fails, try to revert Clerk email change (skipped for now as email update is not implemented)
      if (oldEmail !== email) {
        try {
          const fbUsers = await clerkClient.users.getUserList({ emailAddress: [email] });
          if (fbUsers.data.length > 0) {
              console.warn('Clerk email revert skipped.');
          }
        } catch (fbRevertErr) {
          console.error('CRITICAL: Failed to revert Clerk email after Turso failure:', fbRevertErr);
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
router.delete('/:id', verifyToken, checkRole(['Super_Admin', 'Admin']), async (req, res) => {
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

    // --- DELETE FROM CLERK ---
    try {
      const fbUsers = await clerkClient.users.getUserList({ emailAddress: [targetUser.email_address] });
      if (fbUsers.data.length > 0) {
          await clerkClient.users.deleteUser(fbUsers.data[0].id);
      }
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
    // --- UPDATE CLERK PASSWORD ---
    const [userRows] = await dbPool.query('SELECT email_address FROM users WHERE id = ?', [id]);
    if (userRows.length > 0) {
      try {
        const fbUsers = await clerkClient.users.getUserList({ emailAddress: [userRows[0].email_address] });
        if (fbUsers.data.length > 0) {
            await clerkClient.users.updateUser(fbUsers.data[0].id, { password: newPassword, skipPasswordChecks: true });
        }
      } catch (fbErr) {
        console.error('Clerk Password Change Error:', fbErr);
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

    // --- RESET CLERK PASSWORD ---
    let resetLink = null;
    try {
      const fbUsers = await clerkClient.users.getUserList({ emailAddress: [targetUser.email_address] });
      if (fbUsers.data.length > 0) {
          await clerkClient.users.updateUser(fbUsers.data[0].id, { password: temporaryPassword, skipPasswordChecks: true });
      }
      // Cannot natively generate reset link in Clerk the same way. We'll just return success.
    } catch (fbErr) {
      console.error('Clerk Password Reset Error:', fbErr);
      return res.status(500).json({ error: 'Failed to reset password in authentication system.' });
    }

    // Return success with reset link, NO temporary password
    res.json({ message: 'Password has been reset.', resetLink });
  } catch (err) {
    console.error(`Database error during password reset: ${err.message}`);
    res.status(500).json({ error: 'Database error during password reset.' });
  }
});

// POST /api/users/profile-picture
router.post('/profile-picture', verifyToken, async (req, res) => {
    try {
        const { email, base64Data } = req.body;
        if (!email || !base64Data) return res.status(400).json({ error: 'Missing email or image data.' });
        
        const base64Image = base64Data.split(';base64,').pop();
        const safeEmail = email.replace(/[^a-zA-Z0-9@.-]/g, '_');
        const filePath = path.join(profilePicDir, `${safeEmail}.png`);
        
        fs.writeFileSync(filePath, base64Image, {encoding: 'base64'});
        res.json({ message: 'Profile picture saved successfully.' });
    } catch (err) {
        console.error('Save Profile Pic Error:', err);
        res.status(500).json({ error: 'Failed to save profile picture.' });
    }
});

// GET /api/users/profile-picture/:email
router.get('/profile-picture/:email', verifyToken, async (req, res) => {
    try {
        const safeEmail = req.params.email.replace(/[^a-zA-Z0-9@.-]/g, '_');
        const filePath = path.join(profilePicDir, `${safeEmail}.png`);
        
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, { encoding: 'base64' });
            res.json({ base64Data: `data:image/png;base64,${data}` });
        } else {
            res.status(404).json({ error: 'Profile picture not found.' });
        }
    } catch (err) {
        console.error('Get Profile Pic Error:', err);
        res.status(500).json({ error: 'Failed to get profile picture.' });
    }
});

module.exports = router;
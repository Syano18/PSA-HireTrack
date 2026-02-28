const express = require('express');
const router = express.Router();
const dbPool = require('../db');
const getUserWithRole = async (userId) => {
    const [rows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    return rows[0];
};

// This parseDate function is a utility and does not need changes.
const parseDate = (dateInput) => {
    if (!dateInput || String(dateInput).trim() === '') return null;
    const dateStr = String(dateInput).trim();
    if (/^\d{5}$/.test(dateStr)) {
        const serial = parseInt(dateStr, 10);
        const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        if (year > 1900 && year < 2100) return `${year}-${month}-${day}`;
    }
    const parts = dateStr.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/) || dateStr.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (parts) {
        let year, month, day;
        if (parts[1].length === 4) {
            year = parseInt(parts[1], 10); month = parseInt(parts[2], 10); day = parseInt(parts[3], 10);
        } else {
            month = parseInt(parts[1], 10); day = parseInt(parts[2], 10); year = parseInt(parts[3], 10);
        }
        if (year > 1900 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }
    return null;
};


const getTrainingNames = async (employeeId, trainingTitleId) => {
    const [employeeRows] = await dbPool.query('SELECT first_name, last_name, suffix, middle_initial FROM employees WHERE id = ?', [employeeId]);
    const employeeName = employeeRows[0] ? `${employeeRows[0].first_name} ${employeeRows[0].last_name}`.trim() : 'Unknown Employee';

    const [titleRows] = await dbPool.query('SELECT title FROM training_titles WHERE id = ?', [trainingTitleId]);
    const trainingTitle = titleRows[0] ? titleRows[0].title : 'Unknown Title';

    return { employeeName, trainingTitle };
};

// =================================================================
// --- NEW: Endpoints to manage the training_titles lookup table ---
// =================================================================

// GET /api/trainings/titles (For populating dropdowns)
// GET /api/trainings/titles (For populating dropdowns and getting defaults)
router.get('/titles', async (req, res) => {
  try {
    // ✅ SELECT ALL the new columns
    const [titles] = await dbPool.query(
      'SELECT id, title, start_date, end_date, hours, venue FROM training_titles ORDER BY title ASC'
    );
    res.json(titles);
  } catch (err) {
    console.error(`Database error fetching training titles: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve training titles.' });
  }
});

// POST /api/trainings/titles
router.post('/titles', async (req, res) => {
  // ✅ Destructure ALL new fields from the request body
  const { title, start_date, end_date, hours, venue, actingUserId } = req.body;

  if (!actingUserId) {
    return res.status(403).json({ error: 'Authentication required.' });
  }

  try {
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title cannot be empty.' });
    }
    
    // ✅ Include ALL new fields in the INSERT statement
    const [result] = await dbPool.query(
      'INSERT INTO training_titles (title, start_date, end_date, hours, venue) VALUES (?, ?, ?, ?, ?)', 
      [title.trim(), start_date || null, end_date || null, hours || null, venue || null]
    );
    
    // Log the complete new record
    const newData = { id: result.insertId, title, start_date, end_date, hours, venue };

    res.status(201).json({ message: 'Title created successfully', ...newData });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'The training title already exists.' });
    }
    console.error('Error creating training title:', err);
    res.status(500).json({ error: 'Failed to create training title.' });
  }
});

// PUT /api/trainings/titles/:id
router.put('/titles/:id', async (req, res) => {
    const { id } = req.params;
    // ✅ Destructure ALL new fields
    const { title, start_date, end_date, hours, venue, actingUserId } = req.body; 

    if (!actingUserId) {
        return res.status(403).json({ error: 'Authentication required.' });
    }
    
    try {
        const [oldRecord] = await dbPool.query('SELECT * FROM training_titles WHERE id = ?', [id]);
        if (oldRecord.length === 0) return res.status(404).json({ error: 'Title not found.' });

        // ✅ Include ALL new fields in the UPDATE statement
        await dbPool.query(
            'UPDATE training_titles SET title = ?, start_date = ?, end_date = ?, hours = ?, venue = ? WHERE id = ?', 
            [title.trim(), start_date || null, end_date || null, hours || null, venue || null, id]
        );
        
        const newData = { title, start_date, end_date, hours, venue };
        
        res.json({ message: 'Training title updated successfully' });
    } catch (err) {
        console.error('Error updating training title:', err);
        res.status(500).json({ error: 'Database error updating title.' });
    }
});

// DELETE /api/trainings/titles/:id
router.delete('/titles/:id', async (req, res) => {
    const { id } = req.params;
    // --- CHANGE HERE ---
    const { actingUserId } = req.body; // Get actingUserId from the body

    // --- AND HERE ---
    if (!actingUserId) {
        return res.status(403).json({ error: 'Authentication required.' });
    }

    try {
        const [oldRecord] = await dbPool.query('SELECT * FROM training_titles WHERE id = ?', [id]);
        if (oldRecord.length === 0) return res.status(404).json({ error: 'Title not found.' });
        
        await dbPool.query('DELETE FROM training_titles WHERE id = ?', [id]);
        
        res.json({ message: 'Training title deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Cannot delete: Training Title was assigned to multiple employees' });
    }
});


// =========================================================================
// --- MODIFIED: Existing endpoints are updated to use training_title_id ---
// =========================================================================

// GET /api/trainings (Main list)
router.get('/', async (req, res) => {
  try {
    const sqlQuery = `
      SELECT 
        t.id, t.employee_id, t.start_date, t.end_date, t.hours, t.venue,
        t.training_title_id,
        tt.title AS training_title,
        e.first_name, e.last_name, e.suffix, e.middle_initial, 
        e.employee_id AS employee_identifier
      FROM trainings t
      JOIN employees e ON t.employee_id = e.id
      JOIN training_titles tt ON t.training_title_id = tt.id
      ORDER BY t.start_date DESC
    `;
    const [results] = await dbPool.query(sqlQuery);
    res.json(results);
  } catch (err) {
    console.error(`Database error fetching trainings: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve training data.' });
  }
});

// POST /api/trainings (Create a new training record)
router.post('/', async (req, res) => {
    const { actingUserId, ...trainingData } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission to add training records.' });
        }
        
        const { employee_id, training_title_id, start_date, end_date, hours, venue } = trainingData;
        if (!employee_id || !training_title_id || !start_date || !end_date || !hours || !venue) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }
        if (new Date(end_date) < new Date(start_date)) {
            return res.status(400).json({ error: 'End date cannot be earlier than the start date.' });
        }
        
        const [existing] = await dbPool.query(
            'SELECT id FROM trainings WHERE employee_id = ? AND training_title_id = ? AND DATE(start_date) = ?',
            [employee_id, training_title_id, start_date]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'An employment record with this employee, title, and start date already exists.' });
        }

        const columns = ['employee_id', 'training_title_id', 'start_date', 'end_date', 'hours', 'venue'];
        const values = [employee_id, training_title_id, start_date, end_date, hours, venue.trim()];
        
        const [result] = await dbPool.query(`INSERT INTO trainings (${columns.join(', ')}) VALUES (?, ?, ?, ?, ?, ?)`, values);

        res.status(201).json({ message: 'Training record created successfully', trainingId: result.insertId });
    } catch (dbErr) {
        console.error(`Database error during training creation: ${dbErr.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// POST /api/trainings/import (REVISED to auto-populate details)
router.post('/import', async (req, res) => {
    const { actingUserId, trainings } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    if (!Array.isArray(trainings) || trainings.length === 0) return res.status(400).json({ error: 'No training data provided.' });

    const connection = await dbPool.getConnection();
    try {
        await connection.beginTransaction();

        // --- Fetch all master data for validation and lookup ---
        const [existingEmployees] = await connection.query("SELECT id, employee_id FROM employees");
        const employeeIdMap = new Map(existingEmployees.map(emp => [String(emp.employee_id).trim(), emp.id]));
        
        // ✅ Fetch the FULL training title records, including the details to auto-populate
        const [officialTitles] = await connection.query("SELECT id, title, start_date, end_date, hours, venue FROM training_titles");
        const titleMap = new Map(officialTitles.map(t => [t.title.trim().toLowerCase(), t]));

        const [dbTrainings] = await connection.query("SELECT employee_id, training_title_id, DATE_FORMAT(start_date, '%Y-%m-%d') AS formatted_start_date FROM trainings");
        const existingDbKeys = new Set(dbTrainings.map(t => `${t.employee_id}-${t.training_title_id}-${t.formatted_start_date}`));
        
        const errors = [];
        const validTrainings = [];
        const requiredFields = ['employee_id', 'training_title']; // 🖊️ Simplified required fields

        for (let i = 0; i < trainings.length; i++) {
            const record = trainings[i];
            const rowNum = i + 2;
            let hasError = false;

            const missingFields = requiredFields.filter(field => !record[field] || String(record[field]).trim() === '');
            if (missingFields.length > 0) {
                errors.push(`Row ${rowNum}: Missing required fields: ${missingFields.join(', ')}.`);
                hasError = true;
            }

            const db_employee_id = employeeIdMap.get(String(record.employee_id || '').trim());
            if (record.employee_id && !db_employee_id) {
                errors.push(`Row ${rowNum}: Employee ID "${record.employee_id}" not found.`);
                hasError = true;
            }
            
            // ✅ Find the full title object from the map
            const titleObject = titleMap.get(String(record.training_title || '').trim().toLowerCase());
            if (record.training_title && !titleObject) {
                errors.push(`Row ${rowNum}: Training title "${record.training_title}" not found.`);
                hasError = true;
            }

            if (hasError) continue;
            const date = new Date(titleObject.start_date);
            const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const uniqueKey = `${db_employee_id}-${titleObject.id}-${formattedDate}`;

            if (existingDbKeys.has(uniqueKey)) {
                errors.push(`Row ${rowNum}: This training record already exists in the database.`);
                continue;
            }
            
            // ✅ Push the looked-up details into the record to be inserted
            validTrainings.push({
                employee_id: db_employee_id,
                training_title_id: titleObject.id,
                start_date: titleObject.start_date,
                end_date: titleObject.end_date,
                hours: titleObject.hours,
                venue: titleObject.venue
            });
        }

        if (errors.length > 0) {
            await connection.rollback();
            const message = `Import failed. ${errors.length} error(s) found. First error: ${errors[0]}`;
            return res.status(400).json({ message, errors });
        }

        if (validTrainings.length > 0) {
            const insertQuery = `INSERT INTO trainings (employee_id, training_title_id, start_date, end_date, hours, venue) VALUES ?`;
            const valuesToInsert = validTrainings.map(t => [t.employee_id, t.training_title_id, t.start_date, t.end_date, t.hours, t.venue]);
            await connection.query(insertQuery, [valuesToInsert]);
        }
        
        await connection.commit();
        res.status(201).json({ message: `Successfully imported ${validTrainings.length} training records.` });

    } catch (dbErr) {
        await connection.rollback();
        console.error(`Database error during training import: ${dbErr.message}`);
        return res.status(500).json({ error: dbErr.message });
    } finally {
        if (connection) connection.release();
    }
});

// PUT /api/trainings/:id (Update a training record)
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { actingUserId, ...trainingData } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission to edit training records.' });
        }

        const { employee_id, training_title_id, start_date, end_date, hours, venue } = trainingData;
        if (!employee_id || !training_title_id || !start_date || !end_date || !hours || !venue) {
            return res.status(400).json({ error: 'All fields are required.' });
        }
        if (new Date(end_date) < new Date(start_date)) {
            return res.status(400).json({ error: 'End date cannot be earlier than the start date.' });
        }

        const [existing] = await dbPool.query(
            'SELECT id FROM trainings WHERE employee_id = ? AND training_title_id = ? AND DATE(start_date) = ? AND id != ?',
            [employee_id, training_title_id, start_date, id]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Another training record with these details (Employee, Title, Start Date) already exists.' });
        }

        const [oldRecord] = await dbPool.query('SELECT * FROM trainings WHERE id = ?', [id]);

        const columns = ['employee_id', 'training_title_id', 'start_date', 'end_date', 'hours', 'venue'];
        const values = [employee_id, training_title_id, start_date, end_date, hours, venue.trim()];
        
        const [result] = await dbPool.query(`UPDATE trainings SET ${columns.map(col => `${col} = ?`).join(', ')} WHERE id = ?`, [...values, id]);
        
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Training record not found.' });

        res.json({ message: 'Training record updated successfully' });
    } catch (err) {
        console.error(`Database error during training update: ${err.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// DELETE /api/trainings/:id (No changes needed)
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { actingUserId } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission to delete training records.' });
        }

        const [oldRecord] = await dbPool.query('SELECT * FROM trainings WHERE id = ?', [id]);
        
        const [result] = await dbPool.query('DELETE FROM trainings WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Training record not found.' });
        }

        res.json({ message: 'Training record deleted successfully' });
    } catch (err) {
        console.error(`Database error during training deletion: ${err.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

module.exports = router;
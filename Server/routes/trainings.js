const express = require('express');
const router = express.Router();
const dbPool = require('../db');
const getUserWithRole = async (userId) => {
    const [rows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    return rows[0];
};

// --- Helper: Levenshtein Distance for Fuzzy Matching ---
const levenshtein = (a, b) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
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

  // Validate required fields
  const missingFields = [];
  if (!title || !String(title).trim()) missingFields.push('title');
  if (!start_date || !String(start_date).trim()) missingFields.push('start_date');
  if (!end_date || !String(end_date).trim()) missingFields.push('end_date');
  if (hours === undefined || hours === null || hours === '') missingFields.push('hours');
  if (!venue || !String(venue).trim()) missingFields.push('venue');
  if (missingFields.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
  }
  // Validate date order: start_date must be on or before end_date
  const parsedStart = new Date(start_date);
  const parsedEnd = new Date(end_date);
  if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    return res.status(400).json({ error: 'Invalid date format for start_date or end_date.' });
  }
  if (parsedStart > parsedEnd) {
    return res.status(400).json({ error: 'start_date cannot be after end_date.' });
  }

  try {
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title cannot be empty.' });
    }
    
    // ✅ Check for duplicate training title (case-insensitive)
    const [existing] = await dbPool.query(
      'SELECT id FROM training_titles WHERE LOWER(title) = LOWER(?)',
      [title.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'This training title already exists.' });
    }
    
    // ✅ Check for fuzzy matches (similar titles)
    const [allTitles] = await dbPool.query('SELECT id, title FROM training_titles');
    const lowercaseInput = title.trim().toLowerCase();
    for (const item of allTitles) {
      const distance = levenshtein(lowercaseInput, item.title.toLowerCase());
      if (distance <= 2 && distance > 0) {
        return res.status(409).json({ 
          error: `Did you mean "${item.title}"? If not, you can proceed with caution.`,
          suggestion: item.title,
          code: 'FUZZY_MATCH'
        });
      }
    }
    
    // ✅ Include ALL new fields in the INSERT statement
    const [result] = await dbPool.query(
      'INSERT INTO training_titles (title, start_date, end_date, hours, venue) VALUES (?, ?, ?, ?, ?)', 
      [title.trim(), start_date || null, end_date || null, hours || null, venue || null]
    );
    
    res.status(201).json({ message: 'Title created successfully', id: result.insertId });
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
    // Validate required fields for update
    const missingFields = [];
    if (!title || !String(title).trim()) missingFields.push('title');
    if (!start_date || !String(start_date).trim()) missingFields.push('start_date');
    if (!end_date || !String(end_date).trim()) missingFields.push('end_date');
    if (hours === undefined || hours === null || hours === '') missingFields.push('hours');
    if (!venue || !String(venue).trim()) missingFields.push('venue');
    if (missingFields.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }
    // Validate date order: start_date must be on or before end_date
    const parsedStart = new Date(start_date);
    const parsedEnd = new Date(end_date);
    if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
      return res.status(400).json({ error: 'Invalid date format for start_date or end_date.' });
    }
    if (parsedStart > parsedEnd) {
      return res.status(400).json({ error: 'start_date cannot be after end_date.' });
    }
    
    try {
        const [oldRecord] = await dbPool.query('SELECT * FROM training_titles WHERE id = ?', [id]);
        if (oldRecord.length === 0) return res.status(404).json({ error: 'Title not found.' });

        // ✅ Check for duplicate training title (excluding current record)
        const [existing] = await dbPool.query(
            'SELECT id FROM training_titles WHERE LOWER(title) = LOWER(?) AND id != ?',
            [title.trim(), id]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'This training title already exists.' });
        }

        // ✅ Check for fuzzy matches (similar titles, excluding current record)
        const [allTitles] = await dbPool.query('SELECT id, title FROM training_titles WHERE id != ?', [id]);
        const lowercaseInput = title.trim().toLowerCase();
        for (const item of allTitles) {
          const distance = levenshtein(lowercaseInput, item.title.toLowerCase());
          if (distance <= 2 && distance > 0) {
            return res.status(409).json({ 
              error: `Did you mean "${item.title}"? If not, you can proceed with caution.`,
              suggestion: item.title,
              code: 'FUZZY_MATCH'
            });
          }
        }

        // ✅ Include ALL new fields in the UPDATE statement
        await dbPool.query(
            'UPDATE training_titles SET title = ?, start_date = ?, end_date = ?, hours = ?, venue = ? WHERE id = ?', 
            [title.trim(), start_date || null, end_date || null, hours || null, venue || null, id]
        );
        
        res.json({ message: 'Training title updated successfully' });
    } catch (err) {
        console.error('Error updating training title:', err);
        res.status(500).json({ error: 'Database error updating title.' });
    }
});

// GET /api/trainings/titles/:id/usage (Check if training title is used)
router.get('/titles/:id/usage', async (req, res) => {
    const { id } = req.params;
    try {
        const [usage] = await dbPool.query('SELECT COUNT(*) as count FROM trainings WHERE training_title_id = ?', [id]);
        res.json({ count: usage[0].count });
    } catch (err) {
        console.error(`Database error checking usage: ${err.message}`);
        res.status(500).json({ error: 'Failed to check usage.' });
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
        const [result] = await dbPool.query('DELETE FROM training_titles WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Title not found.' });
        }
        
        res.json({ message: 'Training title deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Cannot delete: Training Title was assigned to multiple employees' });
    }
});


// =========================================================================
// --- MODIFIED: Existing endpoints are updated to use training_title_id ---
// =========================================================================

// GET /api/trainings/search?first_name=&last_name= (Search by employee name)
router.get('/search', async (req, res) => {
  const { first_name, last_name } = req.query;
  if (!first_name && !last_name) {
    return res.status(400).json({ error: 'Please provide at least first_name or last_name.' });
  }
  try {
    const conditions = [];
    const params = [];
    if (first_name) { conditions.push('e.first_name LIKE ?'); params.push(`%${first_name}%`); }
    if (last_name)  { conditions.push('e.last_name LIKE ?');  params.push(`%${last_name}%`); }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sqlQuery = `
      SELECT 
        t.id, t.start_date, t.end_date, t.hours, t.venue,
        tt.title AS training_title,
        e.first_name, e.last_name, e.suffix, e.middle_initial,
        e.employee_id AS employee_identifier
      FROM trainings t
      JOIN employees e ON t.employee_id = e.id
      JOIN training_titles tt ON t.training_title_id = tt.id
      ${whereClause}
      ORDER BY t.start_date DESC
    `;
    const [results] = await dbPool.query(sqlQuery, params);
    res.json(results);
  } catch (err) {
    console.error(`Database error searching trainings: ${err.message}`);
    res.status(500).json({ error: 'Failed to search training data.' });
  }
});

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

// POST /api/trainings (Assign training to an employee)
router.post('/', async (req, res) => {
    const { actingUserId, ...trainingData } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission to assign training records.' });
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
            return res.status(409).json({ error: 'A training record with this employee, title, and start date already exists.' });
        }

        const columns = ['employee_id', 'training_title_id', 'start_date', 'end_date', 'hours', 'venue'];
        const values = [employee_id, training_title_id, start_date, end_date, hours, venue.trim()];
        
        const [result] = await dbPool.query(`INSERT INTO trainings (${columns.join(', ')}) VALUES (?, ?, ?, ?, ?, ?)`, values);

        res.status(201).json({ message: 'Training assigned successfully', trainingId: result.insertId });
    } catch (dbErr) {
        console.error(`Database error during training assignment: ${dbErr.message}`);
        return res.status(500).json({ error: 'Database error.' });
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

// GET /api/trainings/unsynced-titles (Get training titles to sync if there are any Synced Employees)
router.get('/unsynced-titles', async (req, res) => {
  try {
    // 1. Check if there are any Synced Employees at all
    const [syncedEmployees] = await dbPool.query(
      "SELECT COUNT(id) as count FROM profile_entries WHERE interview_status = 'Synced Employees'"
    );

    if (syncedEmployees[0].count === 0) {
      return res.json([]);
    }

    // 2. Return all available training titles so the user can choose which one to sync them to
    const [allTitles] = await dbPool.query(
      `SELECT id, title FROM training_titles ORDER BY title ASC`
    );

    res.json(allTitles);
  } catch (err) {
    console.error(`Database error fetching unsynced training titles: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve unsynced training titles.' });
  }
});

// GET /api/trainings/sync-filter-options (Get surveys and positions for Synced Employees, plus training titles)
router.get('/sync-filter-options', async (req, res) => {
  try {
    const survey = req.query.survey;
    
    if (!survey) {
      // Return all surveys and training titles for Synced Employees
      const [surveys] = await dbPool.query(`
        SELECT DISTINCT s.name
        FROM surveys s
        WHERE s.id IN (
          SELECT DISTINCT survey_id FROM profile_entries 
          WHERE interview_status = 'Synced Employees' AND survey_id IS NOT NULL
        )
        ORDER BY s.name
      `);

      const [titles] = await dbPool.query(`
        SELECT id, title FROM training_titles ORDER BY title ASC
      `);

      const [pendingCount] = await dbPool.query(`
        SELECT COUNT(*) as count FROM profile_entries 
        WHERE interview_status = 'Synced Employees' AND assessment_remarks = 'Hired'
      `);

      res.json({
        surveys: surveys.map(s => s.name),
        positions: [],
        titles: titles,
        pendingCount: pendingCount[0].count
      });
    } else {
      // Return positions for the selected survey
      const [positions] = await dbPool.query(`
        SELECT DISTINCT p.title as title
        FROM positions p
        WHERE p.id IN (
          SELECT DISTINCT position_id FROM profile_entries
          WHERE interview_status = 'Synced Employees' AND survey_id IN (
            SELECT id FROM surveys WHERE name = ?
          ) AND position_id IS NOT NULL AND assessment_remarks = 'Hired'
        )
        ORDER BY p.title
      `, [survey]);

      res.json({
        surveys: [],
        positions: positions.map(p => p.title),
        titles: []
      });
    }
  } catch (err) {
    console.error(`Database error fetching sync filter options: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve filter options.' });
  }
});

// POST /api/trainings/sync-bulk-update (Update profile_entries with training_title_id for selected survey and position)
router.post('/sync-bulk-update', async (req, res) => {
  const { actingUserId, surveyName, position, trainingTitleId } = req.body;

  if (!actingUserId) {
    return res.status(403).json({ error: 'Authentication required.' });
  }

  if (!surveyName || !position || !trainingTitleId) {
    return res.status(400).json({ error: 'Survey, Position, and Training Title are required.' });
  }

  try {
    const actingUser = await getUserWithRole(actingUserId);
    if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
      return res.status(403).json({ error: 'You do not have permission to sync training data.' });
    }

    // Update profile_entries with training_title_id (do not change interview status)
    const [result] = await dbPool.query(`
      UPDATE profile_entries SET 
        training_title_id = ?
      WHERE interview_status = 'Synced Employees'
      AND survey_id IN (SELECT id FROM surveys WHERE name = ?)
      AND position_id IN (SELECT id FROM positions WHERE title = ?)
      AND assessment_remarks = 'Hired'
    `, [trainingTitleId, surveyName, position]);

    // Fetch the updated applicants to return for preview/duplicate validation
    const [updatedApplicants] = await dbPool.query(`
      SELECT 
        pe.id, pe.first_name, pe.middle_initial, pe.last_name, pe.suffix, pe.assessment_remarks,
        pe.email_address, pe.phone_number, DATE_FORMAT(pe.date_of_birth, '%Y-%m-%d') as date_of_birth,
        s.name as survey_name, pos.title as position
      FROM profile_entries pe
      JOIN surveys s ON pe.survey_id = s.id
      JOIN positions pos ON pe.position_id = pos.id
      WHERE pe.training_title_id = ? 
      AND pe.interview_status = 'Synced Employees'
      AND s.name = ?
      AND pos.title = ?
    `, [trainingTitleId, surveyName, position]);

    res.json({
      message: `Successfully updated ${result.affectedRows} applicant(s) with training title.`,
      updatedCount: result.affectedRows,
      applicants: updatedApplicants,
      trainingTitleId: trainingTitleId
    });
  } catch (err) {
    console.error(`Database error updating training titles: ${err.message}`);
    res.status(500).json({ error: 'Failed to update training data.' });
  }
});

// POST /api/trainings/sync-finalize (Finalize training sync to trainings table)
router.post('/sync-finalize', async (req, res) => {
  const { actingUserId, applicantIds, trainingTitleId } = req.body;

  if (!actingUserId) {
    return res.status(403).json({ error: 'Authentication required.' });
  }

  if (!applicantIds || !Array.isArray(applicantIds) || applicantIds.length === 0 || !trainingTitleId) {
    return res.status(400).json({ error: 'Missing applicant list or training title identification.' });
  }

  const connection = await dbPool.getConnection();
  try {
    await connection.beginTransaction();

    const actingUser = await getUserWithRole(actingUserId);
    if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ error: 'Permission denied.' });
    }

    // 1. Get training title details
    const [titleRows] = await connection.query(
      'SELECT id, start_date, end_date, hours, venue FROM training_titles WHERE id = ?',
      [trainingTitleId]
    );
    if (titleRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Training title not found.' });
    }
    const trainingDetails = titleRows[0];

    // 2. Fetch or Match existing employees for these applicants 
    // We expect applicants to exist in employees table if they are being synced to trainings
    // If they aren't employees yet, we search for them by name/dob
    const [applicants] = await connection.query(
      `SELECT id, first_name, last_name, DATE_FORMAT(date_of_birth, '%Y-%m-%d') as dob 
       FROM profile_entries WHERE id IN (?)`,
      [applicantIds]
    );

    const createdTrainings = [];
    const skippedApplicants = [];

    for (const app of applicants) {
      // Find matching employee ID
      const [empRows] = await connection.query(
        "SELECT id FROM employees WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND DATE(date_of_birth) = ?",
        [app.first_name, app.last_name, app.dob]
      );

      if (empRows.length > 0) {
        const employeeId = empRows[0].id;
        
        // Check if training record already exists for this employee/title
        const [existing] = await connection.query(
          'SELECT id FROM trainings WHERE employee_id = ? AND training_title_id = ? AND DATE(start_date) = ?',
          [employeeId, trainingTitleId, trainingDetails.start_date]
        );

        if (existing.length === 0) {
          // Insert into trainings table
          await connection.query(
            'INSERT INTO trainings (employee_id, training_title_id, start_date, end_date, hours, venue) VALUES (?, ?, ?, ?, ?, ?)',
            [
              employeeId, 
              trainingTitleId, 
              trainingDetails.start_date, 
              trainingDetails.end_date, 
              trainingDetails.hours, 
              trainingDetails.venue
            ]
          );
          createdTrainings.push(app.id);
        } else {
          skippedApplicants.push({ name: `${app.first_name} ${app.last_name}`, reason: 'Already exists in trainings' });
        }
      } else {
        skippedApplicants.push({ name: `${app.first_name} ${app.last_name}`, reason: 'Not found in employees table' });
      }
    }

    // 3. Update status to 'Prospective Employees' for those successfully synced to trainings
    if (createdTrainings.length > 0) {
      await connection.query(
        "UPDATE profile_entries SET interview_status = 'Synced Trainings' WHERE id IN (?)",
        [createdTrainings]
      );
    }

    await connection.commit();
    res.json({
      message: `Successfully finalized sync for ${createdTrainings.length} applicant(s).`,
      syncedCount: createdTrainings.length,
      skipped: skippedApplicants
    });
  } catch (err) {
    await connection.rollback();
    console.error(`Error finalizing training sync: ${err.message}`);
    res.status(500).json({ error: 'Failed to finalize training sync.' });
  } finally {
    connection.release();
  }
});

// POST /api/trainings/sync-titles (Sync selected training titles from profile_entries) [DEPRECATED - kept for compatibility]
router.post('/sync-titles', async (req, res) => {
  const { actingUserId, trainingTitleIds } = req.body;

  if (!actingUserId) {
    return res.status(403).json({ error: 'Authentication required.' });
  }

  if (!trainingTitleIds || !Array.isArray(trainingTitleIds) || trainingTitleIds.length === 0) {
    return res.status(400).json({ error: 'No training titles selected for sync.' });
  }

  try {
    const actingUser = await getUserWithRole(actingUserId);
    if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
      return res.status(403).json({ error: 'You do not have permission to sync training titles.' });
    }

    // Get details of selected training titles from profile_entries
    const [titlesToSync] = await dbPool.query(
      `SELECT DISTINCT 
        tt.id,
        tt.title,
        tt.start_date,
        tt.end_date,
        tt.hours,
        tt.venue
       FROM training_titles tt
       WHERE tt.id IN (?)`,
      [trainingTitleIds]
    );

    if (titlesToSync.length === 0) {
      return res.status(404).json({ error: 'No training titles found to sync.' });
    }

    // For now, training titles are already in the training_titles table
    // The "sync" here represents confirming/acknowledging these titles are in use
    // In a future enhancement, this could create training records in profile_entries for applicants

    res.json({
      message: `Successfully synced ${titlesToSync.length} training title(s).`,
      syncedCount: titlesToSync.length,
      titles: titlesToSync
    });
  } catch (err) {
    console.error(`Database error syncing training titles: ${err.message}`);
    res.status(500).json({ error: 'Failed to sync training titles.' });
  }
});

module.exports = router;
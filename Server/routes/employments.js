const express = require('express');
const router = express.Router();
const dbPool = require('../db');
require('dotenv').config();

// --- HELPER FUNCTIONS ---

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

const parseDate = (dateInput) => {
    if (!dateInput || String(dateInput).trim() === '') return null;
    const dateStr = String(dateInput).trim();

    // Case 1: Handle Excel serial number (a 5-digit number for modern dates)
    if (/^\d{5}$/.test(dateStr)) {
        const serial = parseInt(dateStr, 10);
        // Excel's epoch starts on 1900-01-01, but it has a bug treating 1900 as a leap year.
        // The serial number 25569 corresponds to 1970-01-01.
        const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        
        if (year > 1900 && year < 2100) {
            return `${year}-${month}-${day}`;
        }
    }

    // Case 2: Handle standard date strings (e.g., YYYY-MM-DD or MM/DD/YYYY)
    const parts = dateStr.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/) || dateStr.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (parts) {
        let year, month, day;
        if (parts[1].length === 4) { // YYYY-MM-DD format
            year = parseInt(parts[1], 10);
            month = parseInt(parts[2], 10);
            day = parseInt(parts[3], 10);
        } else { // MM/DD/YYYY format
            month = parseInt(parts[1], 10);
            day = parseInt(parts[2], 10);
            year = parseInt(parts[3], 10);
        }

        if (year > 1900 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }

    return null; // Return null if parsing fails
};

// At the top of routes/employments.js, after the other helper functions

// --- Helper: Execute Turso Sync via HTTP ---
const executeTurso = async (sql, args = []) => {
    const dbUrl = process.env.TURSO_DB_URL?.replace(/^libsql:/, 'https:');
    const authToken = process.env.TURSO_AUTH_TOKEN;
    
    if (!dbUrl || !authToken) {
      return null;
    }
   
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
        console.error(`[Turso] Sync Failed (${response.status}): ${errorText}`);
        throw new Error(`Turso Sync Error: ${response.status} ${errorText}`);
      }
      const result = await response.json();
      
      // Check for SQL errors inside the response
      const errors = result.results?.filter(r => r.type === 'error');
      if (errors && errors.length > 0) {
          console.error('[Turso] SQL Execution Failed:', JSON.stringify(errors, null, 2));
          throw new Error(`Turso SQL Error: ${errors[0].error.message}`);
      }

      //console.log('[Turso] Sync Success. Result:', JSON.stringify(result));
      return result;
    } catch (err) {
      console.error('Turso DB Error:', err.message);
      return null;
    }
};

// =================================================================
// --- Employment Record Endpoints ---
// =================================================================

// GET /api/employments/search?first_name=&last_name= (Search by employee name)
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
        emp.id,
        DATE_FORMAT(emp.contract_start_date, '%m/%d/%Y') AS contract_start_date,
        DATE_FORMAT(emp.contract_end_date, '%m/%d/%Y') AS contract_end_date,
        emp.rating, emp.remarks,
        e.first_name, e.middle_initial, e.last_name, e.suffix, e.employee_id as emp_id_str,
        p.title AS position_title,
        s.name AS survey_name,
        CONCAT(u.first_name, ' ', u.last_name) AS focal_person_name
      FROM employments emp
      JOIN employees e ON emp.employee_id = e.id
      JOIN positions p ON emp.position_id = p.id
      LEFT JOIN surveys s ON emp.survey_id = s.id
      LEFT JOIN users u ON emp.focal_person_id = u.id
      ${whereClause}
      ORDER BY emp.contract_start_date DESC
    `;
    const [results] = await dbPool.query(sqlQuery, params);
    res.json(results);
  } catch (err) {
    console.error(`Database error searching employments: ${err.message}`);
    res.status(500).json({ error: 'Failed to search employment data.' });
  }
});

// GET all employment records
router.get('/', async (req, res) => {
    try {
        const sqlQuery = `
          SELECT
            emp.id, emp.employee_id, emp.position_id, emp.survey_id,
            emp.focal_person_id,
            DATE_FORMAT(emp.contract_start_date, '%Y-%m-%d') AS contract_start_date,
            DATE_FORMAT(emp.contract_end_date, '%Y-%m-%d') AS contract_end_date,
            emp.rating, emp.remarks,
            e.first_name, e.middle_initial, e.last_name, e.suffix, e.employee_id as emp_id_str,
            p.title AS position_title,
            s.name AS survey_name,
            CONCAT(u.first_name, ' ' ,u.middle_initial, ' ', u.last_name, ' ', u.suffix) AS focal_person_name
          FROM employments emp
          JOIN employees e ON emp.employee_id = e.id
          JOIN positions p ON emp.position_id = p.id
          LEFT JOIN surveys s ON emp.survey_id = s.id
          LEFT JOIN users u ON emp.focal_person_id = u.id
          ORDER BY e.last_name, e.first_name, emp.contract_start_date DESC
        `;
        const [results] = await dbPool.query(sqlQuery);
        res.json(results);
    } catch (err) {
        console.error(`Database error fetching employment records: ${err.message}`);
        res.status(500).json({ error: 'Failed to retrieve employment data.' });
    }
});

// GET all focal persons for dropdowns
router.get('/focal-persons', async (req, res) => {
    try {
        const [results] = await dbPool.query("SELECT id, first_name, middle_initial ,last_name, suffix FROM users WHERE hiretrack_role = 'Focal Person' ORDER BY last_name");
        res.json(results);
    } catch (err) {
        console.error(`Database error fetching focal persons: ${err.message}`);
        res.status(500).json({ error: 'Failed to retrieve focal persons.' });
    }
});

// Check for duplicate employment records
router.post('/check-duplicate', async (req, res) => {
    const { employee_id, position_id, contract_start_date, excludingId } = req.body;
    if (!employee_id || !position_id || !contract_start_date) {
        return res.status(400).json({ error: 'Missing fields for duplicate check.' });
    }
    try {
        let sqlQuery = 'SELECT id FROM employments WHERE employee_id = ? AND position_id = ? AND contract_start_date = ?';
        const params = [employee_id, position_id, contract_start_date];
        if (excludingId) {
            sqlQuery += ' AND id != ?';
            params.push(excludingId);
        }
        const [rows] = await dbPool.query(sqlQuery, params);
        res.status(200).json({ isDuplicate: rows.length > 0 });
    } catch (err) {
        console.error(`Database error during duplicate check: ${err.message}`);
        res.status(500).json({ error: 'Database error during duplicate check.' });
    }
});

// --- SYNC FUNCTIONALITY ENDPOINTS ---

// GET /api/employments/sync-filter-options
router.get('/sync-filter-options', async (req, res) => {
    try {
        const survey = req.query.survey;
        // Filter: Hired AND Synced Trainings
        const baseWhere = `
            WHERE (
                (pe.assessment_remarks = 'Hired' AND pe.interview_status = 'Synced Trainings')
                OR
                (pe.assessment_remarks LIKE 'REPLACED%' AND pe.interview_status = 'Synced Employees')
            )
        `;

        if (!survey) {
            const [surveys] = await dbPool.query(`
                SELECT DISTINCT s.name
                FROM profile_entries pe
                JOIN surveys s ON pe.survey_id = s.id
                ${baseWhere}
                ORDER BY s.name
            `);
            const [pendingCount] = await dbPool.query(`
                SELECT COUNT(*) as count FROM profile_entries pe
                ${baseWhere}
            `);
            res.json({ surveys: surveys.map(s => s.name), positions: [], pendingCount: pendingCount[0].count });
        } else {
            const [positions] = await dbPool.query(`
                SELECT DISTINCT p.title
                FROM profile_entries pe
                JOIN surveys s ON pe.survey_id = s.id
                JOIN positions p ON pe.position_id = p.id
                ${baseWhere} AND s.name = ?
                ORDER BY p.title
            `, [survey]);
            res.json({ surveys: [], positions: positions.map(p => p.title) });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch filter options' });
    }
});

// POST /api/employments/sync-preview
router.post('/sync-preview', async (req, res) => {
    const { surveyName, position } = req.body;
    try {
        const [applicants] = await dbPool.query(`
            SELECT 
                pe.id, pe.first_name, pe.middle_initial, pe.last_name, pe.suffix,
                pe.employee_id, pe.survey_id, pe.position_id, pe.assessment_remarks,
                s.name as survey_name, p.title as position_title,
                s.contract_start_date, s.contract_end_date, s.focal_person_id
            FROM profile_entries pe
            JOIN surveys s ON pe.survey_id = s.id
            JOIN positions p ON pe.position_id = p.id
            WHERE (
                (pe.assessment_remarks = 'Hired' AND pe.interview_status = 'Synced Trainings')
                OR
                (pe.assessment_remarks LIKE 'REPLACED%' AND pe.interview_status = 'Synced Employees')
            )
            AND s.name = ? AND p.title = ?
        `, [surveyName, position]);

        const results = [];
        for (const app of applicants) {
            // Check if employment record already exists
            const [existing] = await dbPool.query(`
                SELECT id FROM employments 
                WHERE employee_id = ? AND survey_id = ? AND position_id = ?
            `, [app.employee_id, app.survey_id, app.position_id]);
            
            results.push({
                ...app,
                isDuplicate: existing.length > 0
            });
        }
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Preview failed' });
    }
});

// POST /api/employments/sync-finalize
router.post('/sync-finalize', async (req, res) => {
    const { applicantIds, actingUserId } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    if (!applicantIds || !Array.isArray(applicantIds) || applicantIds.length === 0) {
        return res.status(400).json({ error: 'No applicants selected.' });
    }

    const connection = await dbPool.getConnection();
    try {
        await connection.beginTransaction();

        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            throw new Error('Permission denied.');
        }

        let createdCount = 0;
        const skipped = [];

        // Fetch details for selected applicants
        const [applicants] = await connection.query(`
            SELECT 
                pe.id, pe.employee_id, pe.survey_id, pe.position_id, pe.assessment_remarks,
                s.contract_start_date, s.contract_end_date, s.focal_person_id
            FROM profile_entries pe
            JOIN surveys s ON pe.survey_id = s.id
            WHERE pe.id IN (?)
        `, [applicantIds]);

        for (const app of applicants) {
            if (!app.employee_id) {
                skipped.push(`Applicant ID ${app.id}: Missing Employee ID`);
                continue;
            }

            // Double check duplicate inside transaction
            const [existing] = await connection.query(`
                SELECT id FROM employments 
                WHERE employee_id = ? AND survey_id = ? AND position_id = ?
            `, [app.employee_id, app.survey_id, app.position_id]);

            if (existing.length === 0) {
                const remarks = (app.assessment_remarks && app.assessment_remarks.startsWith('REPLACED')) ? app.assessment_remarks : null;
                await connection.query(`
                    INSERT INTO employments (employee_id, position_id, survey_id, focal_person_id, contract_start_date, contract_end_date, remarks)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [app.employee_id, app.position_id, app.survey_id, app.focal_person_id, app.contract_start_date, app.contract_end_date, remarks]);
                createdCount++;
            }
        }

        if (createdCount > 0) {
            // Update status
            await connection.query(`
                UPDATE profile_entries 
                SET interview_status = 'Synced Employments' 
                WHERE id IN (?)
            `, [applicantIds]);
        }

        await connection.commit();
        res.json({ message: `Successfully created ${createdCount} employment records.`, createdCount });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ error: 'Sync failed: ' + err.message });
    } finally {
        connection.release();
    }
});

// POST a new employment record
router.post('/', async (req, res) => {
    const { actingUserId, ...employmentData } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission to add records.' });
        }
        
        if (actingUser.role === 'PACD') {
            delete employmentData.rating;
            delete employmentData.remarks;
        }
        
        const { employee_id, position_id, survey_id, contract_start_date, contract_end_date } = employmentData;
        if (!employee_id || !position_id || !survey_id || !contract_start_date || !contract_end_date) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        // --- ✅ ADD THIS DUPLICATE CHECK BLOCK ---
        const [existing] = await dbPool.query(
            'SELECT id FROM employments WHERE employee_id = ? AND position_id = ? AND contract_start_date = ?',
            [employee_id, position_id, contract_start_date]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'An employment record with this employee, position, and start date already exists.' });
        }
        // --- END OF DUPLICATE CHECK ---

        const columns = ['employee_id', 'position_id', 'survey_id', 'focal_person_id', 'contract_start_date', 'contract_end_date', 'rating', 'remarks'];
        const values = columns.map(col => employmentData[col] || null);
        const [result] = await dbPool.query(`INSERT INTO employments (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, values);
        
        res.status(201).json({ message: 'Employment record created successfully', employmentId: result.insertId });

    } catch (dbErr) {
        console.error(`Database error during employment creation: ${dbErr.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

router.put('/batch-update', async (req, res) => {
    const { ids, updates, actingUserId } = req.body;

    // 1. --- VALIDATION ---
    if (!actingUserId) {
        return res.status(403).json({ message: 'Permission denied. User not specified.' });
    }
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Invalid input. An array of record IDs is required.' });
    }
    // Check that at least one valid date field is provided in the updates object
    if (!updates || (!updates.contract_start_date && !updates.contract_end_date)) {
        return res.status(400).json({ message: 'Invalid input. At least one date (start or end) is required.' });
    }

    const connection = await dbPool.getConnection();
    try {
        // 2. --- PERMISSION CHECK ---
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser?.role)) {
            connection.release();
            return res.status(403).json({ message: 'You do not have permission to perform this batch operation.' });
        }

        await connection.beginTransaction();

        // 3. --- FETCH OLD DATA FOR AUDIT LOG ---
        // Get the state of the records *before* the update for accurate logging.
        const [oldRecords] = await connection.query(
            'SELECT id, contract_start_date, contract_end_date FROM employments WHERE id IN (?)',
            [ids]
        );

        // 4. --- DYNAMICALLY BUILD THE UPDATE QUERY ---
        const fieldsToUpdate = [];
        const values = [];

        if (updates.contract_start_date) {
            fieldsToUpdate.push('contract_start_date = ?');
            values.push(updates.contract_start_date);
        }
        if (updates.contract_end_date) {
            fieldsToUpdate.push('contract_end_date = ?');
            values.push(updates.contract_end_date);
        }

        // If for some reason both fields were empty strings, fieldsToUpdate would be empty.
        if (fieldsToUpdate.length === 0) {
             await connection.rollback(); // No actual update to perform, so we stop.
             connection.release();
             return res.status(400).json({ message: 'No valid date values provided for update.' });
        }

        // Add the array of IDs to the end of the values array for the WHERE clause
        values.push(ids);

        const sqlQuery = `UPDATE employments SET ${fieldsToUpdate.join(', ')} WHERE id IN (?)`;
        const [result] = await connection.query(sqlQuery, values);


        await connection.commit();

        // 6. --- SEND SUCCESS RESPONSE ---
        res.json({ message: `Successfully updated ${result.affectedRows} employment records.` });

    } catch (dbErr) {
        await connection.rollback();
        console.error(`Database error during employment batch update: ${dbErr.message}`);
        return res.status(500).json({ message: 'Database transaction failed during batch update.' });
    } finally {
        if (connection) connection.release();
    }
});

// PUT (Update) an employment record
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { actingUserId, ...employmentData } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!actingUser) return res.status(403).json({ error: 'Invalid user.' });

        const [oldRecordRows] = await dbPool.query('SELECT * FROM employments WHERE id = ?', [id]);
        if (oldRecordRows.length === 0) return res.status(404).json({ error: 'Record not found.' });
        const oldRecord = oldRecordRows[0];
        
        let sqlQuery;
        let values;
        let newData;

        if (['Super_Admin', 'Admin'].includes(actingUser.role)) {
            const { employee_id, position_id, survey_id, contract_start_date, contract_end_date } = employmentData;
            if (!employee_id || !position_id || !survey_id || !contract_start_date || !contract_end_date) {
                return res.status(400).json({ error: 'Missing required fields.' });
            }

            // --- ✅ ADD THIS DUPLICATE CHECK BLOCK ---
            const [existing] = await dbPool.query(
                'SELECT id FROM employments WHERE employee_id = ? AND position_id = ? AND contract_start_date = ? AND id != ?',
                [employee_id, position_id, contract_start_date, id]
            );
            if (existing.length > 0) {
                return res.status(409).json({ error: 'Another employment record with this employee, position, and start date already exists.' });
            }
            // --- END OF DUPLICATE CHECK ---

            // Only Super_Admin can overwrite an already-saved rating
            const ratingIsLocked = oldRecord.rating && oldRecord.rating.trim() !== '';
            if (ratingIsLocked && actingUser.role !== 'Super_Admin') {
                // Strip rating/remarks from the update — leave them untouched
                const columns = ['employee_id', 'position_id', 'survey_id', 'focal_person_id', 'contract_start_date', 'contract_end_date'];
                values = [...columns.map(col => employmentData[col] || null), id];
                sqlQuery = `UPDATE employments SET ${columns.map(col => `${col} = ?`).join(', ')} WHERE id = ?`;
                newData = Object.fromEntries(columns.map(c => [c, employmentData[c]]));
            } else {
                const columns = ['employee_id', 'position_id', 'survey_id', 'focal_person_id', 'contract_start_date', 'contract_end_date', 'rating', 'remarks'];
                values = [...columns.map(col => employmentData[col] || null), id];
                sqlQuery = `UPDATE employments SET ${columns.map(col => `${col} = ?`).join(', ')} WHERE id = ?`;
                newData = employmentData;
            }

        } else if (actingUser.role === 'PACD') {
            const { employee_id, position_id, survey_id, contract_start_date, contract_end_date } = employmentData;
            if (!employee_id || !position_id || !survey_id || !contract_start_date || !contract_end_date) {
                return res.status(400).json({ error: 'Missing required fields.' });
            }
            
            // --- ✅ ADD THIS DUPLICATE CHECK BLOCK HERE AS WELL ---
            const [existing] = await dbPool.query(
                'SELECT id FROM employments WHERE employee_id = ? AND position_id = ? AND contract_start_date = ? AND id != ?',
                [employee_id, position_id, contract_start_date, id]
            );
            if (existing.length > 0) {
                return res.status(409).json({ error: 'Another employment record with this employee, position, and start date already exists.' });
            }
            // --- END OF DUPLICATE CHECK ---

            const columns = ['employee_id', 'position_id', 'survey_id', 'focal_person_id', 'contract_start_date', 'contract_end_date'];
            values = [...columns.map(col => employmentData[col] || null), id];
            sqlQuery = `UPDATE employments SET ${columns.map(col => `${col} = ?`).join(', ')} WHERE id = ?`;
            newData = Object.fromEntries(columns.map(c => [c, employmentData[c]]));

        } else if (actingUser.role === 'Focal Person') {
            if (oldRecord.focal_person_id !== actingUserId) {
                return res.status(403).json({ error: 'You are not the assigned focal person for this record.' });
            }
            // Block if rating is already saved
            if (oldRecord.rating && oldRecord.rating.trim() !== '') {
                return res.status(403).json({ error: 'Performance rating has already been submitted and cannot be changed.' });
            }
            const { rating, remarks } = employmentData;
            values = [rating || null, remarks || null, id];
            sqlQuery = 'UPDATE employments SET rating = ?, remarks = ? WHERE id = ?';
            newData = { rating, remarks };
        
        } else {
            return res.status(403).json({ error: 'You do not have permission to edit records.' });
        }
        
        const [result] = await dbPool.query(sqlQuery, values);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Record not found during update.' });

        return res.json({ message: 'Employment record updated successfully' });

    } catch (err) {
        console.error(`Database error during employment update: ${err.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// DELETE an employment record
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { actingUserId } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission to delete records.' });
        }

        const [oldRecordRows] = await dbPool.query('SELECT * FROM employments WHERE id = ?', [id]);
        if (oldRecordRows.length === 0) return res.status(404).json({ error: 'Record not found.' });
        
        const [result] = await dbPool.query('DELETE FROM employments WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Record not found during deletion.' });

        res.json({ message: 'Employment record deleted successfully' });
    } catch (err) {
        console.error(`Database error during employment deletion: ${err.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// in routes/employment.js

// =================================================================
// --- Utilities: Positions & Surveys Endpoints ---
// =================================================================

// GET all positions
router.get('/positions', async (req, res) => {
    try {
        const sqlQuery = "SELECT id, title AS position_title, created_at FROM positions ORDER BY position_title ASC";
        const [results] = await dbPool.query(sqlQuery);
        res.json(results);
    } catch (err) {
        console.error(`Database error fetching positions: ${err.message}`);
        res.status(500).json({ error: 'Failed to retrieve positions.' });
    }
});

// POST (Create) a new position
router.post('/positions', async (req, res) => {
    const { position_title, actingUserId } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    if (!position_title || position_title.trim() === '') return res.status(400).json({ error: 'Position Title is required.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission.' });
        }
        const [existing] = await dbPool.query('SELECT id FROM positions WHERE title = ?', [position_title.trim()]);
        if (existing.length > 0) return res.status(409).json({ error: 'This position title already exists.' });

        // ✅ Check for fuzzy matches (similar position titles)
        const [allPositions] = await dbPool.query('SELECT id, title FROM positions');
        const lowercaseInput = position_title.trim().toLowerCase();
        for (const item of allPositions) {
          const distance = levenshtein(lowercaseInput, item.title.toLowerCase());
          if (distance <= 2 && distance > 0) {
            return res.status(409).json({ 
              error: `Did you mean "${item.title}"? If not, you can proceed with caution.`,
              suggestion: item.title,
              code: 'FUZZY_MATCH'
            });
          }
        }

        const [result] = await dbPool.query('INSERT INTO positions (title) VALUES (?)', [position_title.trim()]);
        
        res.status(201).json({ message: 'Position created successfully', positionId: result.insertId });
    } catch (dbErr) {
        console.error(`Database error creating position: ${dbErr.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// PUT (Update) an existing position
router.put('/positions/:id', async (req, res) => {
    const { id } = req.params;
    const { position_title, actingUserId } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    if (!position_title || position_title.trim() === '') return res.status(400).json({ error: 'Position Title is required.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission.' });
        }

        const [existing] = await dbPool.query('SELECT id FROM positions WHERE title = ? AND id != ?', [position_title.trim(), id]);
        if (existing.length > 0) return res.status(409).json({ error: 'This position title already exists.' });

        // ✅ Check for fuzzy matches (similar position titles, excluding current record)
        const [allPositions] = await dbPool.query('SELECT id, title FROM positions WHERE id != ?', [id]);
        const lowercaseInput = position_title.trim().toLowerCase();
        for (const item of allPositions) {
          const distance = levenshtein(lowercaseInput, item.title.toLowerCase());
          if (distance <= 2 && distance > 0) {
            return res.status(409).json({ 
              error: `Did you mean "${item.title}"? If not, you can proceed with caution.`,
              suggestion: item.title,
              code: 'FUZZY_MATCH'
            });
          }
        }

        const [oldRecordRows] = await dbPool.query('SELECT * FROM positions WHERE id = ?', [id]);
        if (oldRecordRows.length === 0) return res.status(404).json({ error: 'Position not found.' });

        const [result] = await dbPool.query('UPDATE positions SET title = ? WHERE id = ?', [position_title.trim(), id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Position not found during update.' });
        
        res.json({ message: 'Position updated successfully' });
    } catch (dbErr) {
        console.error(`Database error updating position: ${dbErr.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// GET a position's usage count
router.get('/positions/:id/usage', async (req, res) => {
    const { id } = req.params;
    try {
        const [usage] = await dbPool.query('SELECT COUNT(*) as count FROM employments WHERE position_id = ?', [id]);
        res.json({ count: usage[0].count });
    } catch (err) {
        console.error(`Database error checking position usage: ${err.message}`);
        res.status(500).json({ error: 'Failed to check usage.' });
    }
});

// DELETE a position
router.delete('/positions/:id', async (req, res) => {
    const { id } = req.params;
    const { actingUserId } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission.' });
        }
        const [usage] = await dbPool.query('SELECT id FROM employments WHERE position_id = ? LIMIT 1', [id]);
        if (usage.length > 0) {
            return res.status(409).json({ error: 'Cannot delete: Position was assigned to multiple employees.' });
        }

        const [oldRecordRows] = await dbPool.query('SELECT * FROM positions WHERE id = ?', [id]);
        if (oldRecordRows.length === 0) return res.status(404).json({ error: 'Position not found.' });
        
        const [result] = await dbPool.query('DELETE FROM positions WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Position not found during deletion.' });
        
        res.json({ message: 'Position deleted successfully' });
    } catch (dbErr) {
        console.error(`Database error deleting position: ${dbErr.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// --- UPDATED SURVEYS SECTION ---

// GET all surveys with new fields
router.get('/surveys', async (req, res) => {
    try {
        const [results] = await dbPool.query(
          "SELECT id, name, contract_start_date, contract_end_date, focal_person_id, hiring_date, positions FROM surveys ORDER BY name ASC"
        );
        // Parse positions JSON if it exists
        const parsedResults = results.map(survey => ({
            ...survey,
            positions: survey.positions ? JSON.parse(survey.positions) : null
        }));
        res.json(parsedResults);
    } catch (err) {
        console.error(`Database error fetching surveys: ${err.message}`);
        res.status(500).json({ error: 'Failed to retrieve surveys.' });
    }
});

// POST (Create) a new survey with new fields
router.post('/surveys', async (req, res) => {
    const { name, contract_start_date, contract_end_date, focal_person_id, actingUserId, rating_criteria, hiring_date, positions } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Survey name is required.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission.' });
        }

        // ✅ ADD a check for duplicates before inserting
        const [existing] = await dbPool.query('SELECT id FROM surveys WHERE name = ?', [name.trim()]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'This survey name already exists.' });
        }
        
        // ✅ Check for fuzzy matches (similar survey names)
        const [allSurveys] = await dbPool.query('SELECT id, name FROM surveys');
        const lowercaseInput = name.trim().toLowerCase();
        for (const item of allSurveys) {
          const distance = levenshtein(lowercaseInput, item.name.toLowerCase());
          if (distance <= 2 && distance > 0) {
            return res.status(409).json({ 
              error: `Did you mean "${item.name}"? If not, you can proceed with caution.`,
              suggestion: item.name,
              code: 'FUZZY_MATCH'
            });
          }
        }
        
        const [result] = await dbPool.query(
            'INSERT INTO surveys (name, contract_start_date, contract_end_date, focal_person_id, rating_criteria, hiring_date, positions) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name.trim(), contract_start_date || null, contract_end_date || null, focal_person_id || null, rating_criteria || null, hiring_date || null, positions ? JSON.stringify(positions) : null]
        );
        
        // Sync to Turso only if we have hiring_date and positions (ongoing/upcoming surveys)
        if (hiring_date && positions && Array.isArray(positions) && positions.length > 0) {
            try {
                const tursoSurveyName = JSON.stringify({ id: result.insertId, name: name.trim() });
                const positionsJson = JSON.stringify(positions);
                await executeTurso(
                    "INSERT INTO name_of_surveys (survey_name, hiring_end_date, position) VALUES (?, ?, ?)",
                    [tursoSurveyName, hiring_date, positionsJson]
                );
            } catch (e) {
                // Turso sync skipped
                console.error('Turso sync failed:', e);
            }
        }

        res.status(201).json({ message: 'Survey created successfully', surveyId: result.insertId });

    } catch (dbErr) {
        // ✅ CATCH the specific duplicate error code from the database
        if (dbErr.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'The survey name already exists' });
        }
        console.error(`Database error creating survey: ${dbErr.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// PUT (Update) an existing survey with new fields
router.put('/surveys/:id', async (req, res) => {
    const { id } = req.params;
    const { name, contract_start_date, contract_end_date, focal_person_id, actingUserId, hiring_date, positions } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    
    const trimmedName = (typeof name === 'string') ? name.trim() : '';
    if (!trimmedName) {
        return res.status(400).json({ error: 'Survey name is required.' });
    }

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission.' });
        }
        
        // ✅ IMPROVED duplicate check: make sure the name doesn't already exist on a *different* record
        const [existing] = await dbPool.query('SELECT id FROM surveys WHERE name = ? AND id != ?', [trimmedName, id]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'This survey name is already in use by another record.' });
        }
        
        // ✅ Check for fuzzy matches (similar survey names, excluding current record)
        const [allSurveys] = await dbPool.query('SELECT id, name FROM surveys WHERE id != ?', [id]);
        const lowercaseInput = trimmedName.toLowerCase();
        for (const item of allSurveys) {
          const distance = levenshtein(lowercaseInput, item.name.toLowerCase());
          if (distance <= 2 && distance > 0) {
            return res.status(409).json({ 
              error: `Did you mean "${item.name}"? If not, you can proceed with caution.`,
              suggestion: item.name,
              code: 'FUZZY_MATCH'
            });
          }
        }
        
        const [oldRecordRows] = await dbPool.query('SELECT * FROM surveys WHERE id = ?', [id]);
        if (oldRecordRows.length === 0) return res.status(404).json({ error: 'Survey not found.' });

        const [result] = await dbPool.query(
            'UPDATE surveys SET name = ?, contract_start_date = ?, contract_end_date = ?, focal_person_id = ?, hiring_date = ?, positions = ? WHERE id = ?',
            [trimmedName, contract_start_date || null, contract_end_date || null, focal_person_id || null, hiring_date || null, positions ? JSON.stringify(positions) : null, id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Survey not found during update.' });
        
        // ✅ CASCADE contract date changes to all employment records (Option 1)
        if (contract_start_date || contract_end_date) {
            try {
                const updateParams = [];
                let updateQuery = 'UPDATE employments SET ';
                
                if (contract_start_date && contract_end_date) {
                    updateQuery += 'contract_start_date = ?, contract_end_date = ? WHERE survey_id = ?';
                    updateParams.push(contract_start_date, contract_end_date, id);
                } else if (contract_start_date) {
                    updateQuery += 'contract_start_date = ? WHERE survey_id = ?';
                    updateParams.push(contract_start_date, id);
                } else if (contract_end_date) {
                    updateQuery += 'contract_end_date = ? WHERE survey_id = ?';
                    updateParams.push(contract_end_date, id);
                }
                
                const [cascadeResult] = await dbPool.query(updateQuery, updateParams);
            } catch (e) {
                // Cascade failed silently
            }
        }
        
        // Sync to Turso
        if (hiring_date && positions && Array.isArray(positions) && positions.length > 0) {
            try {
                const tursoSurveyName = JSON.stringify({ id: Number(id), name: trimmedName });
                const positionsJson = JSON.stringify(positions);
                
                // Use survey id to update exactly the matching record (json_extract works in Turso/SQLite)
                // We'll try to update first. If rows affected = 0, we can insert.
                const tursoResult = await executeTurso(
                    "UPDATE name_of_surveys SET survey_name = ?, hiring_end_date = ?, position = ? WHERE json_extract(survey_name, '$.id') = ?",
                    [tursoSurveyName, hiring_date, positionsJson, Number(id)]
                );
                
                if (tursoResult && tursoResult.rowsAffected === 0) {
                    // Fallback: If it wasn't found using json_extract, maybe it was stored as a raw string name before the update
                    const oldSurveyName = oldRecordRows[0].name;
                    const fallbackResult = await executeTurso(
                        "UPDATE name_of_surveys SET survey_name = ?, hiring_end_date = ?, position = ? WHERE survey_name = ?",
                        [tursoSurveyName, hiring_date, positionsJson, oldSurveyName]
                    );

                    if (fallbackResult && fallbackResult.rowsAffected === 0) {
                         // If not exists, insert it
                         await executeTurso(
                             "INSERT INTO name_of_surveys (survey_name, hiring_end_date, position) VALUES (?, ?, ?)",
                             [tursoSurveyName, hiring_date, positionsJson]
                         );
                    }
                }
            } catch (e) {
                // Turso sync skipped
                console.error('Turso sync failed on edit:', e);
            }
        }

        // ✅ No need to update profile_entries - it uses survey_id (foreign key), not survey_name
        // The survey name change in the surveys table doesn't affect profile_entries entries
        // which are linked by survey_id, not by name
        
        res.json({ message: 'Survey updated successfully' });
    } catch (dbErr) {
        // ✅ CATCH the specific duplicate error code from the database
        if (dbErr.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'This survey name is already in use.' });
        }
        console.error(`Database error updating survey: ${dbErr.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// GET a survey's usage count (checks both employments and applicants)
router.get('/surveys/:id/usage', async (req, res) => {
    const { id } = req.params;
    try {
        // Check usage in employments table
        const [employmentUsage] = await dbPool.query('SELECT COUNT(*) as count FROM employments WHERE survey_id = ?', [id]);
        const employmentCount = employmentUsage[0].count;
        
        // Check usage in profile_entries table (applicants assigned to this survey)
        const [applicantUsage] = await dbPool.query('SELECT COUNT(*) as count FROM profile_entries WHERE survey_id = ?', [id]);
        const applicantCount = applicantUsage[0].count;
        
        // Total count includes both employees and applicants
        const totalCount = employmentCount + applicantCount;
        
        res.json({ count: totalCount });
    } catch (err) {
        console.error(`Database error checking survey usage: ${err.message}`);
        res.status(500).json({ error: 'Failed to check usage.' });
    }
});

// DELETE a survey
router.delete('/surveys/:id', async (req, res) => {
    const { id } = req.params;
    const { actingUserId } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    
    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission.' });
        }
        
        const [usage] = await dbPool.query('SELECT id FROM employments WHERE survey_id = ? LIMIT 1', [id]);
        if (usage.length > 0) return res.status(409).json({ error: 'Cannot delete: Census/Survey Name was assigned to multiple employees.' });

        const [oldRecordRows] = await dbPool.query('SELECT * FROM surveys WHERE id = ?', [id]);
        if (oldRecordRows.length === 0) return res.status(404).json({ error: 'Survey not found.' });
        
        const surveyName = oldRecordRows[0].name;
        
        const [result] = await dbPool.query('DELETE FROM surveys WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Survey not found during deletion.' });
        
        // Delete corresponding Turso record if it exists
        try {
            await executeTurso("DELETE FROM name_of_surveys WHERE survey_name = ?", [surveyName]);
        } catch (e) {
            // Turso cleanup skipped
        }

        // ✅ CLEANUP profile_entries records associated with this survey (by survey_id)
        try {
            await dbPool.query("DELETE FROM profile_entries WHERE survey_id = ?", [id]);
        } catch (e) {
            // Cleanup failed silently
        }
        
        res.json({ message: 'Survey deleted successfully' });
    } catch (dbErr) {
        console.error(`Database error deleting survey: ${dbErr.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// --- GET /api/employments/history ---
// Fetch employment history by name (for Interview page)
router.get('/history', async (req, res) => {
    const { first_name, last_name } = req.query;
    if (!first_name || !last_name) {
        return res.status(400).json({ error: 'First name and last name are required.' });
    }

    try {
        const sqlQuery = `
          SELECT
            emp.id,
            DATE_FORMAT(emp.contract_start_date, '%m/%d/%Y') AS contract_start_date,
            DATE_FORMAT(emp.contract_end_date, '%m/%d/%Y') AS contract_end_date,
            emp.rating, emp.remarks,
            p.title AS position_title,
            s.name AS survey_name
          FROM employments emp
          JOIN employees e ON emp.employee_id = e.id
          JOIN positions p ON emp.position_id = p.id
          LEFT JOIN surveys s ON emp.survey_id = s.id
          WHERE e.first_name = ? AND e.last_name = ?
          ORDER BY emp.contract_start_date DESC
        `;
        const [results] = await dbPool.query(sqlQuery, [first_name, last_name]);
        res.json(results);
    } catch (err) {
        console.error(`Database error fetching employment history: ${err.message}`);
        res.status(500).json({ error: 'Failed to retrieve employment history.' });
    }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const dbPool = require('../db');
require('dotenv').config();

// --- HELPER FUNCTIONS ---

const getUserWithRole = async (userId) => {
    const [rows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    return rows[0];
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

const getSurveyDetailsForLog = async (surveyData) => {
    if (!surveyData) return {};
    
    // Create a copy to avoid modifying the original object
    const details = { ...surveyData };
    
    if (details.focal_person_id) {
        try {
            const [rows] = await dbPool.query(
                "SELECT CONCAT(first_name, ' ', last_name) as name FROM users WHERE id = ?",
                [details.focal_person_id]
            );
            // Add the name and remove the ID for a cleaner log
            details.focal_person = rows.length > 0 ? rows[0].name : `ID: ${details.focal_person_id}`;
            delete details.focal_person_id;
        } catch (e) {
            console.error("Failed to look up focal person name for audit log:", e.message);
            details.focal_person = `ID: ${details.focal_person_id}`;
        }
    }
    return details;
};

const getEmploymentDetails = async (data) => {
    if (!data) return null;

    const { employee_id, position_id, survey_id, focal_person_id, ...rest } = data;

    // Concurrently run all necessary lookup queries.
    const queries = [
        employee_id ? dbPool.query("SELECT CONCAT(first_name, ' ', middle_initial, ' ', last_name, ' ', suffix) as name FROM employees WHERE id = ?", [employee_id]) : Promise.resolve([[]]),
        position_id ? dbPool.query("SELECT title FROM positions WHERE id = ?", [position_id]) : Promise.resolve([[]]),
        survey_id ? dbPool.query("SELECT name FROM surveys WHERE id = ?", [survey_id]) : Promise.resolve([[]]),
        focal_person_id ? dbPool.query("SELECT CONCAT(last_name, ', ', first_name) as name FROM users WHERE id = ?", [focal_person_id]) : Promise.resolve([[]]),
    ];

    try {
        const [employeeRes, positionRes, surveyRes, focalPersonRes] = await Promise.all(queries);

        // Build the detailed object for the audit log. Fallback to showing the ID if a name isn't found.
        return {
            ...rest, // Keep other fields like rating, remarks, dates
            employee: employeeRes[0][0]?.name || (employee_id ? `ID: ${employee_id}` : 'N/A'),
            position: positionRes[0][0]?.title || (position_id ? `ID: ${position_id}` : 'N/A'),
            survey: surveyRes[0][0]?.name || (survey_id ? `ID: ${survey_id}` : 'N/A'),
            focal_person: focalPersonRes[0][0]?.name || (focal_person_id ? `ID: ${focal_person_id}` : 'N/A'),
        };
    } catch (error) {
        console.error("Error fetching employment details for audit log:", error);
        return data; // Fallback to original data with IDs on error to ensure logging still occurs.
    }
};

// --- Helper: Execute Turso Sync via HTTP ---
const executeTurso = async (sql, args = []) => {
    const dbUrl = process.env.TURSO_DB_URL?.replace(/^libsql:/, 'https:');
    const authToken = process.env.TURSO_AUTH_TOKEN;
    
    if (!dbUrl || !authToken) {
      console.warn("Turso DB URL or Token is not configured. Skipping Turso sync.");
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
      console.log(`[Turso] Attempting Sync: ${sql}`, args);
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


        // 5. --- LOG THE BATCH ACTION ---
        const oldDataForLog = oldRecords.map(rec => ({
            id: rec.id,
            start_date: rec.contract_start_date,
            end_date: rec.contract_end_date
        }));
        
        const newDataForLog = {
            changes: updates, // Log the changes that were sent
            affected_ids: ids
        };

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

        const [detailedOldData, detailedNewData] = await Promise.all([
            getEmploymentDetails(oldRecord),
            getEmploymentDetails(newData)
        ]);
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
        
        // --- ✅ GET DETAILED NAMES FOR AUDIT LOG BEFORE DELETING ---
        const detailedOldData = await getEmploymentDetails(oldRecordRows[0]);

        const [result] = await dbPool.query('DELETE FROM employments WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Record not found during deletion.' });

        res.json({ message: 'Employment record deleted successfully' });
    } catch (err) {
        console.error(`Database error during employment deletion: ${err.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// in routes/employment.js

router.post('/import', async (req, res) => {
    const { actingUserId, employments } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    if (!Array.isArray(employments) || employments.length === 0) {
        return res.status(400).json({ error: 'No employment data provided.' });
    }

    const connection = await dbPool.getConnection();
    try {
        await connection.beginTransaction();

        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            connection.release();
            return res.status(403).json({ error: 'You do not have permission to import records.' });
        }
        
        // --- 1. Fetch lookup data (including existing employments) ---
        const [existingEmployees] = await connection.query("SELECT id, employee_id FROM employees");
        const employeeIdMap = new Map(existingEmployees.map(emp => [emp.employee_id, emp.id]));
        
        const [existingPositions] = await connection.query("SELECT id, title FROM positions");
        const positionTitleMap = new Map(existingPositions.map(pos => [pos.title.toLowerCase(), pos.id]));

        const [existingSurveys] = await connection.query("SELECT id, name, contract_start_date, contract_end_date, focal_person_id FROM surveys");
        const surveyMap = new Map(existingSurveys.map(s => [s.name.toLowerCase(), s]));

        // Fetch valid users to validate focal_person_id
        const [existingUsers] = await connection.query("SELECT id, first_name, middle_initial, last_name, suffix FROM users");
        const validUserIds = new Set(existingUsers.map(u => u.id));
        const userMap = new Map();
        existingUsers.forEach(u => {
            const fullName = [u.first_name, u.middle_initial, u.last_name, u.suffix]
                .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
            userMap.set(fullName, u.id);
        });

        // ✅ PRE-FETCH existing employments for duplicate check
        const [dbEmployments] = await connection.query("SELECT employee_id, position_id, DATE_FORMAT(contract_start_date, '%Y-%m-%d') as start_date FROM employments");
        const existingDbKeys = new Set(dbEmployments.map(e => `${e.employee_id}-${e.position_id}-${e.start_date}`));

        const errors = [];
        const validRecords = [];
        const seenInCsv = new Set(); // ✅ Set to track duplicates within the CSV

        // --- 2. Validate each row ---
        for (let i = 0; i < employments.length; i++) {
            const record = employments[i];
            const rowNum = i + 2;
            const { employee_id, position_title, survey_name, focal_person_name } = record;
            let hasError = false;

            if (!employee_id || !position_title || !survey_name) {
                errors.push(`Row ${rowNum}: Missing required fields: employee_id, position_title, and survey_name.`);
                hasError = true;
            }

            const db_employee_id = employeeIdMap.get(employee_id);
            if (employee_id && !db_employee_id) {
                errors.push(`Row ${rowNum}: Employee ID "${employee_id}" not found.`);
                hasError = true;
            }
            
            const db_position_id = positionTitleMap.get(position_title?.toLowerCase());
            if (position_title && !db_position_id) {
                errors.push(`Row ${rowNum}: Position Title "${position_title}" not found.`);
                hasError = true;
            }

            const surveyData = surveyMap.get(survey_name?.toLowerCase());
            if (survey_name && !surveyData) {
                errors.push(`Row ${rowNum}: Survey Name "${survey_name}" not found.`);
                hasError = true;
            } else if (surveyData && (!surveyData.contract_start_date || !surveyData.contract_end_date)) {
                errors.push(`Row ${rowNum}: The survey "${survey_name}" is missing default contract dates.`);
                hasError = true;
            }

            if (hasError) continue;
            
            // --- ✅ STEP 2: CHECK FOR DUPLICATES ---
            const startDate = new Date(surveyData.contract_start_date).toISOString().split('T')[0];
            const uniqueKey = `${db_employee_id}-${db_position_id}-${startDate}`;

            if (existingDbKeys.has(uniqueKey)) {
                errors.push(`Row ${rowNum}: This employment record already exists in the database.`);
                continue;
            }
            if (seenInCsv.has(uniqueKey)) {
                errors.push(`Row ${rowNum}: This is a duplicate record from earlier in the same file.`);
                continue;
            }
            seenInCsv.add(uniqueKey);
            // --- END OF DUPLICATE CHECK ---
            
            record.db_employee_id = db_employee_id;
            record.db_position_id = db_position_id;
            record.surveyData = surveyData;

            // Determine Focal Person ID (Prioritize CSV input, fallback to Survey default)
            let targetFocalPersonId = null;
            if (focal_person_name) {
                const normalizedName = String(focal_person_name).replace(/\s+/g, ' ').trim().toLowerCase();
                if (userMap.has(normalizedName)) {
                    targetFocalPersonId = userMap.get(normalizedName);
                }
            }
            if (!targetFocalPersonId && surveyData) {
                targetFocalPersonId = surveyData.focal_person_id;
            }

            // Validate focal_person_id against existing users to prevent FK errors
            if (targetFocalPersonId && validUserIds.has(targetFocalPersonId)) {
                record.safe_focal_person_id = targetFocalPersonId;
            } else {
                record.safe_focal_person_id = null;
            }

            validRecords.push(record);
        }

        // --- 3. Handle errors or insert ---
        if (errors.length > 0) {
            await connection.rollback();
            const message = `Import failed. ${errors.length} error(s) found. First error: ${errors[0]}`;
            return res.status(400).json({ message, errors });
        }
        
        if (validRecords.length > 0) {
            const insertQuery = `INSERT INTO employments (employee_id, position_id, survey_id, focal_person_id, contract_start_date, contract_end_date, rating, remarks) VALUES ?`;
            const valuesToInsert = validRecords.map(rec => [
                rec.db_employee_id,
                rec.db_position_id,
                rec.surveyData.id,
                rec.safe_focal_person_id,
                rec.surveyData.contract_start_date,
                rec.surveyData.contract_end_date,
                null,
                null
            ]);
            await connection.query(insertQuery, [valuesToInsert]);
        }
        
        await connection.commit();
        res.status(201).json({ message: `Successfully imported ${validRecords.length} employment records.` });

    } catch (dbErr) {
        await connection.rollback();
        console.error(`Database error during employment import: ${dbErr.message}`);
        return res.status(500).json({ error: dbErr.message });
    } finally {
        if (connection) connection.release();
    }
});

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
          "SELECT id, name, contract_start_date, contract_end_date, focal_person_id FROM surveys ORDER BY name ASC"
        );
        res.json(results);
    } catch (err) {
        console.error(`Database error fetching surveys: ${err.message}`);
        res.status(500).json({ error: 'Failed to retrieve surveys.' });
    }
});

// POST (Create) a new survey with new fields
router.post('/surveys', async (req, res) => {
    const { name, contract_start_date, contract_end_date, focal_person_id, hiring_positions, actingUserId, hiring_end_date } = req.body;
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
        
        const [result] = await dbPool.query(
            'INSERT INTO surveys (name, contract_start_date, contract_end_date, focal_person_id) VALUES (?, ?, ?, ?)',
            [name.trim(), contract_start_date || null, contract_end_date || null, focal_person_id || null]
        );
        
        // Check if survey is ongoing or upcoming
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = contract_end_date ? new Date(contract_end_date) : null;
        const isOngoingOrUpcoming = endDate && endDate >= today;

        if (isOngoingOrUpcoming) {
            // Sync Hiring Positions to Turso if provided
            if (hiring_positions && Array.isArray(hiring_positions) && hiring_positions.length > 0) {
                // 1. Get titles from local DB
                const [posRows] = await dbPool.query('SELECT title FROM positions WHERE id IN (?)', [hiring_positions]);
                
                // 2. Sync each title to Turso (Create a row for each position with the survey name)
                for (const row of posRows) {
                    // We use a try-catch per insert to avoid stopping if one fails (e.g. duplicate)
                    try {
                        await executeTurso("INSERT INTO name_of_surveys (survey_name, hiring_end_date, position) VALUES (?, ?, ?)", [name.trim(), hiring_end_date || null, row.title]);
                    } catch (e) { console.warn(`Turso sync skipped for position ${row.title}:`, e.message); }
                }
            } else {
                // Sync to Turso (No positions, just survey info)
                await executeTurso("INSERT INTO name_of_surveys (survey_name, hiring_end_date) VALUES (?, ?)", [name.trim(), hiring_end_date || null]);
            }
        }

        const newDataForLog = { name: name.trim(), contract_start_date, contract_end_date, focal_person_id };
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
    const { name, contract_start_date, contract_end_date, focal_person_id, actingUserId } = req.body;
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
        
        const [oldRecordRows] = await dbPool.query('SELECT * FROM surveys WHERE id = ?', [id]);
        if (oldRecordRows.length === 0) return res.status(404).json({ error: 'Survey not found.' });

        const [result] = await dbPool.query(
            'UPDATE surveys SET name = ?, contract_start_date = ?, contract_end_date = ?, focal_person_id = ? WHERE id = ?',
            [trimmedName, contract_start_date || null, contract_end_date || null, focal_person_id || null, id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Survey not found during update.' });
        
        const newDataForLog = { name: trimmedName, contract_start_date, contract_end_date, focal_person_id };
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
        
        const [result] = await dbPool.query('DELETE FROM surveys WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Survey not found during deletion.' });
        
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
const express = require('express');
const router = express.Router();
const dbPool = require('../db');
require('dotenv').config();
const verifyToken = require('../middleware/verifyToken');

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
      throw new Error(`Turso Sync Error: ${response.status} ${errorText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('Turso DB Error:', err.message);
    return null;
  }
};

// --- Helper: Format Turso DB Response ---
const formatTursoResponse = (tursoResult) => {
    if (!tursoResult || !tursoResult.results || !tursoResult.results[0] || tursoResult.results[0].type !== 'ok') {
        return [];
    }
    const { cols, rows } = tursoResult.results[0].response.result;
    const columnNames = cols.map(c => c.name);
    
    return rows.map(row => {
        const obj = {};
        row.forEach((value, i) => {
            // The actual value is nested inside the value object from Turso
            obj[columnNames[i]] = value.value;
        });
        return obj;
    });
};

// Whitelist of columns that can be updated via the generic PUT /:id endpoint.
// Using a whitelist prevents SQL injection through dynamic column names.
const ALLOWED_UPDATE_COLUMNS = new Set([
  'first_name', 'middle_initial', 'last_name', 'suffix',
  'email_address', 'phone_number', 'date_of_birth',
  'highest_grade_completed', 'address', 'barangay',
  'city_municipality', 'province', 'position',
  'survey_name', 'focal_name', 'training_title_id',
]);

// --- GET /api/applicants ---
router.get('/', verifyToken, async (req, res) => {
  try {
    const [results] = await dbPool.query(`
      SELECT 
        pe.*,
        s.name as survey_name,
        p.title as position
      FROM profile_entries pe
      LEFT JOIN surveys s ON pe.survey_id = s.id
      LEFT JOIN positions p ON pe.position_id = p.id
      ORDER BY pe.last_name, pe.first_name
    `);
    res.json(results);
  } catch (err) {
    console.error(`Local DB error fetching applicants: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve applicant data from local database.' });
  }
});

// --- GET /api/applicants/assigned-to-me ---
router.get('/assigned-to-me', verifyToken, async (req, res) => {
  const actingUserId = req.user?.id;
  if (!actingUserId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    // 1. Get the full name of the logged-in user
    const [userRows] = await dbPool.query(
      "SELECT first_name, middle_initial, last_name, suffix FROM users WHERE id = ?",
      [actingUserId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Interviewer profile not found.' });
    }

    const u = userRows[0];
    const interviewerName = [u.first_name, u.middle_initial, u.last_name, u.suffix].filter(Boolean).join(' ');

    // 2. Fetch applicants assigned to this interviewer
    //    only those that are still pending interview work (For Interview or Ongoing Interview).
    //    JOIN with surveys to include survey_name for criteria lookup
    const [applicants] = await dbPool.query(
      `SELECT 
        pe.*,
        s.name as survey_name,
        p.title as position
      FROM profile_entries pe
      LEFT JOIN surveys s ON pe.survey_id = s.id
      LEFT JOIN positions p ON pe.position_id = p.id
      WHERE pe.interviewer = ? AND pe.interview_status IN ('For Interview','Ongoing Interview') 
      ORDER BY pe.last_name, pe.first_name`,
      [interviewerName]
    );

    res.json(applicants);
  } catch (err) {
    console.error(`Local DB error fetching assigned applicants: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve assigned applicant data.' });
  }
});

// --- POST /api/applicants/sync ---
// Syncs profile_entries from Turso to local MariaDB, updating only matching fields
router.post('/sync', verifyToken, async (req, res) => {
  try {
    // Fetch all records from Turso profile_entries
    const tursoQuery = `
      SELECT id, first_name, middle_initial, last_name, suffix, email_address, phone_number, 
             date_of_birth, sex, tin, barangay, city_municipality, highest_grade_completed, 
             created_at, survey_id, interviewer, position_id 
      FROM profile_entries
    `;
    const tursoResult = await executeTurso(tursoQuery);
    if (!tursoResult) {
      return res.status(500).json({ error: 'Failed to fetch from Turso database.' });
    }
    const applicants = formatTursoResponse(tursoResult);
    if (!applicants || applicants.length === 0) {
      return res.json({ message: 'No applicants found in Turso.' });
    }

    const connection = await dbPool.getConnection();
    try {
      await connection.beginTransaction();

      let inserted = 0;
      let updated = 0;

      for (const app of applicants) {
        // Process name fields: uppercase and format middle initial
        let firstName = app.first_name ? app.first_name.trim().toUpperCase() : null;
        let lastName = app.last_name ? app.last_name.trim().toUpperCase() : null;
        let suffix = app.suffix ? app.suffix.trim().toUpperCase() : null;
        let middleInitial = app.middle_initial ? app.middle_initial.trim().toUpperCase() : null;

        // Format middle initial: if >2 chars, take first, ensure ends with period
        if (middleInitial) {
          if (middleInitial.length > 2) {
            middleInitial = middleInitial.charAt(0);
          }
          if (!middleInitial.endsWith('.')) {
            middleInitial += '.';
          }
        }

        // Insert or update record (exclude created_at from sync)
        await connection.query(`
          INSERT INTO profile_entries (
            id, first_name, middle_initial, last_name, suffix,
            email_address, phone_number, date_of_birth, sex,
            tin, barangay, city_municipality, highest_grade_completed,
            survey_id, interviewer, position_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            first_name = VALUES(first_name), middle_initial = VALUES(middle_initial),
            last_name = VALUES(last_name), suffix = VALUES(suffix),
            email_address = VALUES(email_address), phone_number = VALUES(phone_number),
            date_of_birth = VALUES(date_of_birth), sex = VALUES(sex),
            tin = VALUES(tin), barangay = VALUES(barangay),
            city_municipality = VALUES(city_municipality), highest_grade_completed = VALUES(highest_grade_completed),
            survey_id = VALUES(survey_id), interviewer = VALUES(interviewer), position_id = VALUES(position_id)
        `, [
          app.id, firstName, middleInitial, lastName, suffix,
          app.email_address, app.phone_number, app.date_of_birth, app.sex,
          app.tin, app.barangay, app.city_municipality, app.highest_grade_completed,
          app.survey_id, app.interviewer, app.position_id
        ]);
        // Note: We can't easily count inserted vs updated without checking affectedRows
      }

      await connection.commit();
      res.json({ 
        message: `Sync completed. ${applicants.length} records processed.`,
        processed: applicants.length
      });
    } catch (dbErr) {
      await connection.rollback();
      console.error('Database error during sync:', dbErr);
      res.status(500).json({ error: 'Database error during sync.' });
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Failed to sync data.' });
  }
});

// --- POST /api/applicants/comprehensive-sync ---
// Syncs assessed applicants into employees, trainings, and employments tables
// Returns counts of newly created/updated records only (not checked records)
router.post('/comprehensive-sync', verifyToken, async (req, res) => {
  const connection = await dbPool.getConnection();
  const fs = require('fs');
  const path = require('path');
  
  try {
    await connection.beginTransaction();

    // 1. Fetch all assessed applicants with training_title_id
    const [assessedApplicants] = await connection.query(`
      SELECT 
        pe.id, pe.first_name, pe.middle_initial, pe.last_name, pe.suffix,
        pe.date_of_birth, pe.sex,
        pe.survey_id, s.name as survey_name,
        pe.position_id, p.title as position,
        pe.training_title_id,
        COALESCE(pe.contract_start_date, CURDATE()) as contract_start_date
      FROM profile_entries pe
      LEFT JOIN surveys s ON pe.survey_id = s.id
      LEFT JOIN positions p ON pe.position_id = p.id
      WHERE pe.interview_status = 'Assessed' AND pe.training_title_id IS NOT NULL
      ORDER BY pe.id
    `);

    if (!assessedApplicants || assessedApplicants.length === 0) {
      await connection.commit();
      return res.json({ 
        message: 'No assessed applicants to sync.',
        created: { employees: 0, trainings: 0, employments: 0 },
        updated: { employees: 0 },
        reportPath: null
      });
    }

    const stats = {
      created: { employees: 0, trainings: 0, employments: 0 },
      updated: { employees: 0 }
    };

    // Track sync results for CSV report
    const syncResults = [];

    // 2. Fetch all existing employees and trainings for duplicate checking
    const [existingEmployees] = await connection.query('SELECT id, first_name, last_name, date_of_birth FROM employees');
    const [existingTrainings] = await connection.query('SELECT employee_id, training_title_id, start_date FROM trainings');
    const [existingEmployments] = await connection.query('SELECT employee_id, position_id, survey_id FROM employments');

    // 3. Process each applicant
    for (const applicant of assessedApplicants) {
      const normalize = (str) => {
        if (!str) return '';
        return `${str}`.toLowerCase().trim();
      };

      const applicantFullName = [applicant.first_name, applicant.middle_initial, applicant.last_name, applicant.suffix]
        .filter(Boolean).join(' ');
      const applicantNameLower = normalize([applicant.first_name, applicant.last_name].filter(Boolean).join(' '));

      let syncStatus = 'Success';
      let syncMessage = '';
      let employeeId = null;

      try {
        // Find matching employee using exact or fuzzy matching
        let matchedEmployee = null;
        let matchType = null;

        for (const emp of existingEmployees) {
          const empNameLower = normalize([emp.first_name, emp.last_name].filter(Boolean).join(' '));

          // Exact match: first + last names (case-insensitive) + DOB exact
          if (applicantNameLower === empNameLower && applicant.date_of_birth === emp.date_of_birth) {
            matchedEmployee = emp;
            matchType = 'Exact Match';
            break;
          }

          // Fuzzy match: Levenshtein ≤ 2 on first/last names, DOB within ±1 day
          if (Math.abs(applicantNameLower.length - empNameLower.length) <= 3) {
            const distance = levenshtein(applicantNameLower, empNameLower);
            if (distance <= 2) {
              // Check DOB tolerance: ±1 day
              if (applicant.date_of_birth && emp.date_of_birth) {
                const appDob = new Date(applicant.date_of_birth);
                const empDob = new Date(emp.date_of_birth);
                const dayDiff = Math.abs((appDob - empDob) / (1000 * 60 * 60 * 24));
                if (dayDiff <= 1) {
                  matchedEmployee = emp;
                  matchType = 'Fuzzy Match';
                  break;
                }
              }
            }
          }
        }

        if (matchedEmployee) {
          employeeId = matchedEmployee.id;
          // Employee exists - no update needed since email/phone are not available
          syncMessage = `Employee already exists (${matchType})`;
        } else {
          // Create new employee
          // Generate employee_id: PSAKLG-YY-XXXX format
          const idPrefix = 'PSAKLG';
          const currentYear = new Date().getFullYear().toString().slice(-2);
          const [latestEmployee] = await connection.query(
            "SELECT employee_id FROM employees WHERE employee_id LIKE ? ORDER BY id DESC LIMIT 1",
            [`${idPrefix}-%`]
          );
          let newSequenceNumber = 1;
          if (latestEmployee.length > 0) {
            const lastIdParts = latestEmployee[0].employee_id.split('-');
            const lastSequence = parseInt(lastIdParts[lastIdParts.length - 1], 10);
            newSequenceNumber = lastSequence + 1;
          }
          const newEmployeeId = `${idPrefix}-${currentYear}-${String(newSequenceNumber).padStart(4, '0')}`;

          const [insertResult] = await connection.query(
            `INSERT INTO employees 
             (employee_id, first_name, middle_initial, last_name, suffix, date_of_birth, sex)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [newEmployeeId, applicant.first_name, applicant.middle_initial, applicant.last_name, applicant.suffix,
             applicant.date_of_birth, applicant.sex]
          );
          employeeId = insertResult.insertId;
          stats.created.employees++;
          syncMessage = `Created new employee (${newEmployeeId})`;
        }

        // 4. Create training record if doesn't exist
        if (employeeId && applicant.training_title_id) {
          // Check if training record already exists
          const trainingExists = existingTrainings.some(t => 
            t.employee_id === employeeId && 
            t.training_title_id === applicant.training_title_id &&
            t.start_date === applicant.contract_start_date
          );

          if (!trainingExists) {
            // Get training title details
            const [trainingTitle] = await connection.query(
              'SELECT start_date, end_date, hours, venue FROM training_titles WHERE id = ?',
              [applicant.training_title_id]
            );

            if (trainingTitle.length > 0) {
              const tt = trainingTitle[0];
              await connection.query(
                `INSERT INTO trainings (employee_id, training_title_id, start_date, end_date, hours, venue)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [employeeId, applicant.training_title_id, tt.start_date, tt.end_date, tt.hours, tt.venue]
              );
              stats.created.trainings++;
              syncMessage += '; Training record created';
            }
          } else {
            syncMessage += '; Training already exists';
          }
        }

        // 5. Create employment record if doesn't exist
        if (employeeId && applicant.survey_id && applicant.position_id) {
          const employmentExists = existingEmployments.some(e =>
            e.employee_id === employeeId &&
            e.position_id === applicant.position_id &&
            e.survey_id === applicant.survey_id
          );

          if (!employmentExists) {
            await connection.query(
              `INSERT INTO employments (employee_id, position_id, survey_id, contract_start_date)
               VALUES (?, ?, ?, ?)`,
              [employeeId, applicant.position_id, applicant.survey_id, applicant.contract_start_date]
            );
            stats.created.employments++;
            syncMessage += '; Employment record created';
          } else {
            syncMessage += '; Employment already exists';
          }
        }
      } catch (error) {
        syncStatus = 'Failed';
        syncMessage = error.message;
      }

      // Add to sync results for CSV report
      syncResults.push({
        applicantId: applicant.id,
        name: applicantFullName,
        surveyName: applicant.survey_name || '',
        position: applicant.position || '',
        dateOfBirth: applicant.date_of_birth ? new Date(applicant.date_of_birth).toISOString().split('T')[0] : '',
        status: syncStatus,
        message: syncMessage
      });
    }

    await connection.commit();

    res.json({
      message: `Sync complete. Employees created: ${stats.created.employees}, updated: ${stats.updated.employees}. Trainings created: ${stats.created.trainings}. Employments created: ${stats.created.employments}.`,
      created: stats.created,
      updated: stats.updated,
      totalProcessed: syncResults.length,
      successCount: syncResults.filter(r => r.status === 'Success').length,
      failedCount: syncResults.filter(r => r.status === 'Failed').length
    });

  } catch (err) {
    await connection.rollback();
    console.error(`Comprehensive sync error: ${err.message}`);
    res.status(500).json({ error: 'Failed to sync data: ' + err.message });
  } finally {
    connection.release();
  }
});

// --- PUT /api/applicants/:id/assign ---
router.put('/:id/assign', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { interviewer_id } = req.body;

  if (!interviewer_id) {
    return res.status(400).json({ error: 'Interviewer ID is required.' });
  }

  try {
    // 1. Get Interviewer Name from Users table
    const [userRows] = await dbPool.query(
      "SELECT first_name, middle_initial, last_name, suffix FROM users WHERE id = ?",
      [interviewer_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Interviewer not found.' });
    }

    const u = userRows[0];
    const interviewerName = [u.first_name, u.middle_initial, u.last_name, u.suffix].filter(Boolean).join(' ');

    // 2. Update profile_entries locally
    await dbPool.query("UPDATE profile_entries SET interviewer = ?, interview_status = 'For Interview' WHERE id = ?", [interviewerName, id]);

    res.json({ message: 'Interviewer assigned successfully.', interviewer: interviewerName });
  } catch (err) {
    console.error(`Error assigning interviewer: ${err.message}`);
    res.status(500).json({ error: 'Failed to assign interviewer.' });
  }
});

// --- GET /api/applicants/transmit-options ---
// Fetch distinct surveys from profile_entries that have completed interviews, joined with focal person info
router.get('/transmit-options', verifyToken, async (req, res) => {
  try {
      const query = `
          SELECT DISTINCT s.name as survey_name, s.focal_person_id, CONCAT(u.first_name, ' ', u.last_name) as focal_person_name, p.title as position
          FROM profile_entries pe
          LEFT JOIN surveys s ON pe.survey_id = s.id
          LEFT JOIN positions p ON pe.position_id = p.id
          LEFT JOIN users u ON s.focal_person_id = u.id
          WHERE pe.interview_status = 'Done Interview' 
            AND pe.pre_assessment IS NOT NULL
            AND pe.pre_assessment != 'null'
            /* ensure JSON has all five rating fields */
            AND JSON_EXTRACT(pe.pre_assessment,'$.educational_attainment') IS NOT NULL
            AND JSON_EXTRACT(pe.pre_assessment,'$.relevant_training') IS NOT NULL
            AND JSON_EXTRACT(pe.pre_assessment,'$.relevant_work_experience') IS NOT NULL
            AND JSON_EXTRACT(pe.pre_assessment,'$.written_examination') IS NOT NULL
            AND JSON_EXTRACT(pe.pre_assessment,'$.interview_average') IS NOT NULL
            AND pe.focal_id IS NULL
            AND s.name IS NOT NULL 
            AND s.name != ''
          ORDER BY s.name
      `;
      const [rows] = await dbPool.query(query);
      res.json(rows);
  } catch (err) {
      console.error(`Error fetching transmit options: ${err.message}`);
      res.status(500).json({ error: 'Failed to fetch survey options.' });
  }
});

// --- POST /api/applicants/transmit ---
// Transmit applicants of a specific survey to a focal person
router.post('/transmit', verifyToken, async (req, res) => {
  const { survey_name, position, focal_id } = req.body;
  if (!survey_name || !position || !focal_id) return res.status(400).json({ error: 'Missing survey, position, or focal person information.' });

  try {
      // Get the survey_id from the survey name
      const [surveyRows] = await dbPool.query('SELECT id, rating_criteria FROM surveys WHERE name = ?', [survey_name]);
      if (!surveyRows.length) return res.status(404).json({ error: 'Survey not found.' });
      const survey_id = surveyRows[0].id;

      // Get the position_id from the position title
      const [positionRows] = await dbPool.query('SELECT id FROM positions WHERE title = ?', [position]);
      if (!positionRows.length) return res.status(404).json({ error: 'Position not found.' });
      const position_id = positionRows[0].id;
      
      // Get the enabled pre_assessment criteria for this survey
      let enabledCriteria = ['educational_attainment', 'relevant_training', 'relevant_work_experience', 'written_examination', 'interview_average'];
      const rc = surveyRows[0].rating_criteria;
      if (rc) {
        try {
          const parsed = typeof rc === 'string' ? JSON.parse(rc) : rc;
          if (parsed.pre_assessment && Array.isArray(parsed.pre_assessment)) {
            // Only require criteria that are in the survey's pre_assessment list
            enabledCriteria = parsed.pre_assessment.concat(['interview_average']);
          }
        } catch (e) {
          console.error('Error parsing rating_criteria:', e);
          // Use all criteria as fallback
        }
      }

      // Build the WHERE clause to check only enabled criteria
      let whereConditions = [
        'pre_assessment IS NULL',
        "pre_assessment = 'null'"
      ];
      enabledCriteria.forEach(c => {
        whereConditions.push(`JSON_EXTRACT(pre_assessment,'$.${c}') IS NULL`);
      });
      const whereClause = whereConditions.join(' OR ');

      // Check for applicants missing a pre-assessment score
      const [unscored] = await dbPool.query(
          `SELECT first_name, last_name FROM profile_entries
           WHERE survey_id = ? AND position_id = ?
             AND interview_status = 'Done Interview'
             AND focal_id IS NULL
             AND (${whereClause})`,
          [survey_id, position_id]
      );
      if (unscored.length > 0) {
          const names = unscored.map(r => `${r.first_name} ${r.last_name}`).join(', ');
          return res.status(400).json({ error: `Cannot transmit — the following applicants have not been pre-assessed: ${names}` });
      }

      const [result] = await dbPool.query(
          "UPDATE profile_entries SET focal_id = ?, interview_status = 'Transmitted to Focal Person' WHERE survey_id = ? AND position_id = ? AND interview_status = 'Done Interview' AND focal_id IS NULL",
          [focal_id, survey_id, position_id]
      );
      res.json({ message: `Successfully transmitted ${result.affectedRows} applicant(s).` });
  } catch (err) {
      console.error(`Error transmitting applicants: ${err.message}`);
      res.status(500).json({ error: 'Failed to transmit applicants.' });
  }
});

// --- PUT /api/applicants/:id/interview-status ---
// Update only the interview_status field
router.put('/:id/interview-status', verifyToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const [userRows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    const userRole = userRows[0]?.role;

    // Only allow interview status updates for admin roles and Focal Persons
    if (!['Super_Admin', 'Admin', 'PACD', 'Focal Person'].includes(userRole)) {
      return res.status(403).json({ error: 'Access denied. Only authorized personnel can update interview status.' });
    }

    const { id } = req.params;
    const { interview_status } = req.body;
    if (!interview_status) return res.status(400).json({ error: 'interview_status is required.' });
    
    await dbPool.query("UPDATE profile_entries SET interview_status = ? WHERE id = ?", [interview_status, id]);
    res.json({ message: 'Status updated successfully.' });
  } catch (err) {
    console.error(`Error updating interview status: ${err.message}`);
    res.status(500).json({ error: 'Failed to update interview status.' });
  }
});

// --- GET /api/surveys/:name/rating-criteria ---
// Retrieve evaluation criteria for a survey
router.get('/surveys/:name/rating-criteria', verifyToken, async (req, res) => {
  const { name } = req.params;
  try {
    const [rows] = await dbPool.query('SELECT rating_criteria FROM surveys WHERE name = ?', [name]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Survey not found.' });
    }
    
    const rc = rows[0].rating_criteria;
    let parsed = { pre_assessment: [], interview: [] };
    
    if (rc) {
      try { 
        parsed = typeof rc === 'string' ? JSON.parse(rc) : rc; 
        // Ensure the structure is valid
        if (!parsed.interview) parsed.interview = [];
        if (!parsed.pre_assessment) parsed.pre_assessment = [];
      } catch (e) { 
        console.error('Error parsing rating_criteria:', e);
        parsed = { pre_assessment: [], interview: [] };
      }
    }
    res.json(parsed);
  } catch (err) {
    console.error(`Error fetching rating criteria: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch rating criteria.' });
  }
});

// --- GET /api/surveys/without-criteria ---
// Return survey names which have no evaluation criteria set yet.
router.get('/surveys/without-criteria', verifyToken, async (req, res) => {
  try {
    // return surveys where rating_criteria is null or empty
    const [rows] = await dbPool.query('SELECT name, rating_criteria FROM surveys WHERE rating_criteria IS NULL OR rating_criteria = ""');
    const names = rows.map(r => r.name).filter(Boolean);
    res.json(names);
  } catch (err) {
    console.error(`Error fetching surveys without criteria: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch survey list.' });
  }
});

// --- PUT /api/surveys/:name/rating-criteria ---
// Saves selected evaluation criteria JSON into rating_criteria column of surveys
router.put('/surveys/:name/rating-criteria', verifyToken, async (req, res) => {
  const { name } = req.params;
  const { rating_criteria } = req.body;
  if (!rating_criteria) return res.status(400).json({ error: 'rating_criteria is required.' });
  try {
    const json = JSON.stringify(rating_criteria);
    const [result] = await dbPool.query(
      'UPDATE surveys SET rating_criteria = ? WHERE name = ?',
      [json, name]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Survey not found.' });
    res.json({ message: 'Rating criteria saved successfully.' });
  } catch (err) {
    console.error(`Error saving rating criteria: ${err.message}`);
    res.status(500).json({ error: 'Failed to save rating criteria.' });
  }
});

// --- PUT /api/applicants/:id/interview-result ---
// Save interview assessment: criteria -> interview_rating JSON, average -> pre_assessment JSON
router.put('/:id/interview-result', verifyToken, async (req, res) => {
  const { id } = req.params;
  const {
    professionalism, interpersonal, organization,
    written_communication, oral_communication, digital_literacy,
    average_score, remarks, interview_status
  } = req.body;

  try {
    // Build interview_rating JSON (all criteria scores + remarks, no average)
    const interviewRating = JSON.stringify({
      professionalism,
      interpersonal,
      organization,
      written_communication,
      oral_communication,
      digital_literacy,
      remarks: remarks || ''
    });

    // Merge interview_average into the existing pre_assessment JSON
    const [rows] = await dbPool.query("SELECT pre_assessment FROM profile_entries WHERE id = ?", [id]);
    const existingPA = rows.length > 0 && rows[0].pre_assessment
      ? (typeof rows[0].pre_assessment === 'string' ? JSON.parse(rows[0].pre_assessment) : rows[0].pre_assessment)
      : {};
    existingPA.interview_average = (average_score !== undefined && average_score !== null)
      ? parseFloat(average_score)
      : null;
    const updatedPA = JSON.stringify(existingPA);

    await dbPool.query(
      "UPDATE profile_entries SET interview_rating = ?, pre_assessment = ?, interview_status = ? WHERE id = ?",
      [interviewRating, updatedPA, interview_status, id]
    );
    res.json({ message: 'Interview results saved successfully.' });
  } catch (err) {
    console.error(`Error saving interview results: ${err.message}`);
    res.status(500).json({ error: 'Failed to save interview results.' });
  }
});

// --- PUT /api/applicants/:id ---
router.put('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    // 1. Fetch current local record to identify it in Turso (before update)
    const [rows] = await dbPool.query("SELECT * FROM profile_entries WHERE id = ?", [id]);
    if (rows.length === 0) {
        return res.status(404).json({ error: 'Applicant not found.' });
    }
    const currentRecord = rows[0];

    // 2. Update Local DB — only allow pre-approved column names to prevent SQL injection
    const columns = Object.keys(updates).filter(k => ALLOWED_UPDATE_COLUMNS.has(k));
    if (columns.length > 0) {
        const setClause = columns.map(col => `${col} = ?`).join(', ');
        const values = columns.map(col => updates[col]);
        values.push(id);
        await dbPool.query(`UPDATE profile_entries SET ${setClause} WHERE id = ?`, values);
    }

    // 3. Update Turso (Best Effort Match)
    const matchFields = ['first_name', 'last_name', 'middle_initial', 'date_of_birth'];
    const whereConditions = [];
    const whereArgs = [];
    
    matchFields.forEach(field => {
        if (currentRecord[field]) {
            whereConditions.push(`${field} = ?`);
            let val = currentRecord[field];
            if (field === 'date_of_birth' && val instanceof Date) val = val.toISOString().split('T')[0];
            whereArgs.push(val);
        } else {
            whereConditions.push(`${field} IS NULL`);
        }
    });

    // Only attempt Turso update if we have conditions to match
    if (whereConditions.length > 0 && columns.length > 0) {
        const setClauseTurso = columns.map(col => `${col} = ?`).join(', ');
        const setArgsTurso = columns.map(col => updates[col]);
        const sql = `UPDATE profile_entries SET ${setClauseTurso} WHERE ${whereConditions.join(' AND ')}`;
        await executeTurso(sql, [...setArgsTurso, ...whereArgs]);
    }

    res.json({ message: 'Applicant updated successfully.' });
  } catch (err) {
    console.error(`Error updating applicant: ${err.message}`);
    res.status(500).json({ error: 'Failed to update applicant.' });
  }
});

// --- DELETE /api/applicants/:id ---
// Deletes from local DB only
router.delete('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    await dbPool.query("DELETE FROM profile_entries WHERE id = ?", [id]);
    res.json({ message: 'Applicant deleted from local database.' });
  } catch (err) {
    console.error(`Error deleting applicant: ${err.message}`);
    res.status(500).json({ error: 'Failed to delete applicant.' });
  }
});

// --- GET /api/applicants/for-assessment ---
// Returns transmitted applicants for the Assessment page.
// Super_Admin / Admin / PACD: all transmitted; Focal Person: only their own.
router.get('/for-assessment', verifyToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const [userRows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    const userRole = userRows[0]?.role;
    let sql, params;
    if (['Super_Admin', 'Admin', 'PACD'].includes(userRole)) {
      // Include survey contract_end_date and positions for assessment requirements
      sql = `SELECT 
        pe.*,
        s.name as survey_name,
        s.contract_end_date,
        s.positions,
        s.hiring_date,
        p.title as position
      FROM profile_entries pe
      LEFT JOIN surveys s ON pe.survey_id = s.id
      LEFT JOIN positions p ON pe.position_id = p.id
      ORDER BY pe.last_name, pe.first_name`;
      params = [];
    } else if (userRole === 'Focal Person') {
      // For Focal person, also include survey information
      sql = `SELECT 
        pe.*,
        s.name as survey_name,
        s.contract_end_date,
        s.positions,
        s.hiring_date,
        p.title as position
      FROM profile_entries pe
      LEFT JOIN surveys s ON pe.survey_id = s.id
      LEFT JOIN positions p ON pe.position_id = p.id
      ORDER BY pe.last_name, pe.first_name`;
      params = [];
    } else {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const [results] = await dbPool.query(sql, params);
    res.json(results);
  } catch (err) {
    console.error(`Error fetching for-assessment: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve assessment records.' });
  }
});

// --- PUT /api/applicants/:id/assessment ---
// Saves assessment_remarks and grand_total to dedicated columns.
router.put('/:id/assessment', verifyToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const [userRows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    const userRole = userRows[0]?.role;

    // Only allow assessment updates for admin roles and Focal Persons
    if (!['Super_Admin', 'Admin', 'PACD', 'Focal Person'].includes(userRole)) {
      return res.status(403).json({ error: 'Access denied. Only authorized personnel can update assessments.' });
    }

    const { id } = req.params;
    const { assessment_remarks, grand_total, assistant_id } = req.body;

    // Ignore any attempt to set grand_total via this endpoint — grand totals
    // should only be managed via the weights endpoint or dedicated flows.
    if (grand_total !== undefined) {
      console.warn(`Ignored grand_total update attempt for profile_entries id=${id}`);
    }

    // Build dynamic update: always update assessment_remarks; update assistant_id
    // only if it's provided in the request body to avoid overwriting with null.
    const updates = ['assessment_remarks = ?'];
    const params = [assessment_remarks ?? null];
    if (Object.prototype.hasOwnProperty.call(req.body, 'assistant_id')) {
      updates.push('assistant_id = ?');
      params.push(assistant_id ?? null);
    }

    const sql = `UPDATE profile_entries SET ${updates.join(', ')} WHERE id = ?`;
    params.push(id);
    const [result] = await dbPool.query(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Applicant not found.' });
    res.json({ message: 'Assessment saved.' });
  } catch (err) {
    console.error(`Error saving assessment: ${err.message}`);
    res.status(500).json({ error: 'Failed to save assessment.' });
  }
});

// --- PUT /api/applicants/:id/pre-assessment ---
router.put('/:id/pre-assessment', verifyToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const [userRows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    const userRole = userRows[0]?.role;

    // Only allow pre-assessment updates for admin roles and Focal Persons
    if (!['Super_Admin', 'Admin', 'PACD', 'Focal Person'].includes(userRole)) {
      return res.status(403).json({ error: 'Access denied. Only authorized personnel can update pre-assessments.' });
    }

    const { id } = req.params;
    const { educational_attainment, relevant_training, relevant_work_experience, written_examination } = req.body;
    // fetch existing JSON so we don't overwrite interview_average or other fields
    const [rows] = await dbPool.query('SELECT pre_assessment FROM profile_entries WHERE id = ?', [id]);
    let existing = {};
    if (rows.length > 0 && rows[0].pre_assessment) {
      existing = typeof rows[0].pre_assessment === 'string'
        ? JSON.parse(rows[0].pre_assessment)
        : rows[0].pre_assessment;
    }

    const assessment = {
      ...existing,
      educational_attainment: educational_attainment ?? existing.educational_attainment ?? null,
      relevant_training: relevant_training ?? existing.relevant_training ?? null,
      relevant_work_experience: relevant_work_experience ?? existing.relevant_work_experience ?? null,
      written_examination: written_examination ?? existing.written_examination ?? null,
    };

    await dbPool.query(
      "UPDATE profile_entries SET pre_assessment = ? WHERE id = ?",
      [JSON.stringify(assessment), id]
    );
    res.json({ message: 'Pre-assessment saved.' });
  } catch (err) {
    console.error('Pre-assessment save error:', err.message);
    res.status(500).json({ error: 'Failed to save pre-assessment.' });
  }
});

// --- GET /api/applicants/weights/:survey/:position ---
// Fetch saved weights for a specific survey and position combination
router.get('/weights/:survey/:position', verifyToken, async (req, res) => {
  const { survey, position } = req.params;
  try {
    // First, get survey_id and position_id from their respective tables
    const [surveyRows] = await dbPool.query('SELECT id FROM surveys WHERE name = ?', [survey]);
    const [positionRows] = await dbPool.query('SELECT id FROM positions WHERE title = ?', [position]);
    
    if (surveyRows.length === 0 || positionRows.length === 0) {
      res.json(null); // Survey or position not found
      return;
    }
    
    const surveyId = surveyRows[0].id;
    const positionId = positionRows[0].id;
    
    // Query using survey_id and position_id
    const [rows] = await dbPool.query(
      'SELECT educational_attainment, relevant_training, relevant_work_experience, written_examination, interview_average FROM assessment_weights WHERE survey_id = ? AND position_id = ?',
      [surveyId, positionId]
    );
    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.json(null); // No saved weights for this combination
    }
  } catch (err) {
    console.error('Error fetching weights:', err.message);
    res.status(500).json({ error: 'Failed to fetch weights.' });
  }
});

// --- POST /api/applicants/weights ---
// Save weights for a specific survey and position combination and update grand totals for all applicants in that group
router.post('/weights', verifyToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const [userRows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    const userRole = userRows[0]?.role;

    // Only allow weights management for admin roles and Focal Persons
    if (!['Super_Admin', 'Admin', 'PACD', 'Focal Person'].includes(userRole)) {
      return res.status(403).json({ error: 'Access denied. Only authorized personnel can manage assessment weights.' });
    }

    const { survey_name, position, educational_attainment, relevant_training, relevant_work_experience, written_examination, interview_average, applicant_totals } = req.body;
    // Get survey_id and position_id from their respective tables
    const [surveyRows] = await dbPool.query('SELECT id FROM surveys WHERE name = ?', [survey_name]);
    const [positionRows] = await dbPool.query('SELECT id FROM positions WHERE title = ?', [position]);
    
    if (surveyRows.length === 0 || positionRows.length === 0) {
      res.status(400).json({ error: 'Survey or position not found.' });
      return;
    }
    
    const surveyId = surveyRows[0].id;
    const positionId = positionRows[0].id;
    
    // Save weights using survey_id and position_id only
    await dbPool.query(
      `INSERT INTO assessment_weights (survey_id, position_id, educational_attainment, relevant_training, relevant_work_experience, written_examination, interview_average)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       educational_attainment = VALUES(educational_attainment),
       relevant_training = VALUES(relevant_training),
       relevant_work_experience = VALUES(relevant_work_experience),
       written_examination = VALUES(written_examination),
       interview_average = VALUES(interview_average)`,
      [surveyId, positionId, educational_attainment, relevant_training, relevant_work_experience, written_examination, interview_average]
    );

    // Update grand totals and weighted scores for all applicants
    if (applicant_totals && Array.isArray(applicant_totals) && applicant_totals.length > 0) {
      for (const { id, grand_total } of applicant_totals) {
        // Fetch the applicant's pre_assessment scores
        const [appRows] = await dbPool.query('SELECT pre_assessment FROM profile_entries WHERE id = ?', [id]);
        if (appRows.length > 0) {
          const preAssessment = typeof appRows[0].pre_assessment === 'string'
            ? JSON.parse(appRows[0].pre_assessment)
            : appRows[0].pre_assessment;

          // Calculate weighted scores
          const ed_att = parseFloat(preAssessment?.educational_attainment) || 0;
          const rel_train = parseFloat(preAssessment?.relevant_training) || 0;
          const rel_work = parseFloat(preAssessment?.relevant_work_experience) || 0;
          const written = parseFloat(preAssessment?.written_examination) || 0;
          const interview = parseFloat(preAssessment?.interview_average) || 0;

          const weightedScores = {
            educational_attainment: ed_att ? parseFloat((ed_att * educational_attainment / 100).toFixed(2)) : null,
            relevant_training: rel_train ? parseFloat((rel_train * relevant_training / 100).toFixed(2)) : null,
            relevant_work_experience: rel_work ? parseFloat((rel_work * relevant_work_experience / 100).toFixed(2)) : null,
            written_examination: written ? parseFloat((written * written_examination / 100).toFixed(2)) : null,
            interview_average: interview ? parseFloat((interview * interview_average / 100).toFixed(2)) : null,
          };

          await dbPool.query(
            'UPDATE profile_entries SET grand_total = ?, weighted_scores = ? WHERE id = ?',
            [grand_total, JSON.stringify(weightedScores), id]
          );
        }
      }
    }

    res.json({ message: 'Weights and grand totals saved successfully.' });
  } catch (err) {
    console.error('Error saving weights:', err.message);
    res.status(500).json({ error: 'Failed to save weights.' });
  }
});

// --- GET /api/applicants/reviewed ---
// Returns applicants with completed pre-assessments (marked as "Assessed")
// Accessible only to Super_Admin, Admin, and PACD
// --- Get Assessed Applicants (for Employee Sync) ---
router.get('/assessed', verifyToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const [userRows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    const userRole = userRows[0]?.role;

    // Check if user has permission (Super_Admin, Admin, or PACD)
    if (!['Super_Admin', 'Admin', 'PACD'].includes(userRole)) {
      return res.status(403).json({ error: 'Access denied. Only Admin, Super Admin, or PACD can view assessed applicants.' });
    }

    // Fetch applicants with interview_status = 'Assessed'
    const [results] = await dbPool.query(`
      SELECT
        pe.*,
        s.name as survey_name,
        p.title as position
      FROM profile_entries pe
      LEFT JOIN surveys s ON pe.survey_id = s.id
      LEFT JOIN positions p ON pe.position_id = p.id
      WHERE pe.interview_status = 'Assessed'
      ORDER BY pe.last_name, pe.first_name
    `);
    
    res.json(results);
  } catch (err) {
    console.error(`Error fetching assessed applicants: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve assessed applicant data.' });
  }
});

router.get('/reviewed', verifyToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const [userRows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    const userRole = userRows[0]?.role;

    // Check if user has permission (Super_Admin, Admin, or PACD)
    if (!['Super_Admin', 'Admin', 'PACD'].includes(userRole)) {
      return res.status(403).json({ error: 'Access denied. Only Admin, Super Admin, or PACD can view reviewed applicants.' });
    }

    // Fetch applicants with completed pre-assessments (non-null and non-'null' string)
    const [results] = await dbPool.query(`
      SELECT 
        pe.*,
        s.name as survey_name,
        p.title as position
      FROM profile_entries pe
      LEFT JOIN surveys s ON pe.survey_id = s.id
      LEFT JOIN positions p ON pe.position_id = p.id
      WHERE pe.pre_assessment IS NOT NULL 
        AND pe.pre_assessment != 'null'
        AND pe.pre_assessment != ''
        AND JSON_EXTRACT(pe.pre_assessment, '$.educational_attainment') IS NOT NULL
        AND JSON_EXTRACT(pe.pre_assessment, '$.relevant_training') IS NOT NULL
        AND JSON_EXTRACT(pe.pre_assessment, '$.relevant_work_experience') IS NOT NULL
        AND JSON_EXTRACT(pe.pre_assessment, '$.written_examination') IS NOT NULL
      ORDER BY pe.last_name, pe.first_name
    `);
    res.json(results);
  } catch (err) {
    console.error(`Error fetching reviewed applicants: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve reviewed applicant data.' });
  }
});

router.post('/update-interview-status', verifyToken, async (req, res) => {
  const { applicantIds, newStatus, actingUserId } = req.body;

  if (!applicantIds || !Array.isArray(applicantIds) || applicantIds.length === 0) {
    return res.status(400).json({ error: 'applicantIds must be a non-empty array' });
  }

  if (!newStatus) {
    return res.status(400).json({ error: 'newStatus is required' });
  }

  try {
    // Update interview_status for all provided applicant IDs
    const placeholders = applicantIds.map(() => '?').join(',');
    const query = `UPDATE profile_entries SET interview_status = ? WHERE id IN (${placeholders})`;
    const params = [newStatus, ...applicantIds];

    const [result] = await dbPool.query(query, params);

    if (result.affectedRows > 0) {
      res.status(200).json({ 
        message: `Successfully updated interview status for ${result.affectedRows} applicant(s) to "${newStatus}"`,
        updatedCount: result.affectedRows 
      });
    } else {
      res.status(200).json({ 
        message: 'No applicants were updated',
        updatedCount: 0 
      });
    }
  } catch (err) {
    console.error(`Error updating interview status: ${err.message}`);
    res.status(500).json({ error: 'Failed to update interview status.' });
  }
});

module.exports = router;
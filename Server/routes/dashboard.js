const express = require('express');
const router = express.Router();
const dbPool = require('../db');
const verifyToken = require('../middleware/verifyToken'); // Import the security guard

// Add 'verifyToken' here to protect the route
router.get('/dashboard-summary', verifyToken, async (req, res) => {
    // The user ID is now SECURELY available from the token payload
    const loggedInUserId = req.user.id;

    try {
        // --- Admin & HR View Queries ---
        const adminQueries = [
            dbPool.query("SELECT COUNT(*) as count FROM employees"),
            dbPool.query("SELECT COUNT(*) as count FROM employments WHERE contract_end_date >= CURDATE()"),
            dbPool.query("SELECT COUNT(*) as count FROM trainings WHERE start_date >= CURDATE()"),
            dbPool.query("SELECT COUNT(DISTINCT focal_person_id) as count FROM employments"),
            dbPool.query("SELECT sex, COUNT(*) as count FROM employees GROUP BY sex"),
            dbPool.query("SELECT COUNT(*) as count FROM employments WHERE contract_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)"),
            dbPool.query("SELECT COUNT(*) as count FROM employments WHERE contract_end_date BETWEEN DATE_ADD(CURDATE(), INTERVAL 31 DAY) AND DATE_ADD(CURDATE(), INTERVAL 60 DAY)"),
            dbPool.query("SELECT COUNT(*) as count FROM employments WHERE contract_end_date BETWEEN DATE_ADD(CURDATE(), INTERVAL 61 DAY) AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)"),
        ];

        // --- Focal Person View Queries (uses the secure ID) ---
        const focalPersonQueries = [
            dbPool.query(`
                SELECT CONCAT(e.first_name, ' ', e.last_name) as name, p.title as position 
                FROM employments emp
                JOIN employees e ON emp.employee_id = e.id
                JOIN positions p ON emp.position_id = p.id
                WHERE emp.focal_person_id = ? 
                GROUP BY e.id
                ORDER BY e.last_name;
            `, [loggedInUserId]),
            dbPool.query(`
                SELECT CONCAT(e.first_name, ' ', e.last_name) as name, emp.contract_end_date as endDate
                FROM employments emp
                JOIN employees e ON emp.employee_id = e.id
                WHERE emp.focal_person_id = ? AND emp.contract_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                ORDER BY emp.contract_end_date;
            `, [loggedInUserId])
        ];

        const [adminResults, focalPersonResults] = await Promise.all([
            Promise.all(adminQueries),
            Promise.all(focalPersonQueries)
        ]);

        const adminView = {
            totalEmployees: adminResults[0][0][0].count,
            activeContracts: adminResults[1][0][0].count,
            upcomingTrainings: adminResults[2][0][0].count,
            totalFocalPersons: adminResults[3][0][0].count,
            genderBreakdown: adminResults[4][0],
            expiringContracts: [
                { range: "Next 30 Days", count: adminResults[5][0][0].count },
                { range: "31-60 Days", count: adminResults[6][0][0].count },
                { range: "61-90 Days", count: adminResults[7][0][0].count },
            ]
        };

        const focalPersonView = {
            myTeam: focalPersonResults[0][0],
            expiringContractsInTeam: focalPersonResults[1][0]
        };

        res.json({
            adminView,
            focalPersonView
        });

    } catch (error) {
        console.error("Error fetching dashboard summary:", error);
        res.status(500).json({ message: "Failed to fetch dashboard data." });
    }
});

module.exports = router;
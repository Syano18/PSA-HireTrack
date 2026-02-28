import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FaUsers, FaBriefcase, FaGraduationCap } from 'react-icons/fa';
import DemographicsRechart from '../components/DemographicsRechart';
import { motion } from 'framer-motion';
import MunicipalityBarChart from '../components/MunicipalityBarChart';
import PerformanceRatingsChart from '../components/PerformanceRatingsChart';
import Cover from '../assets/cover.jpg';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';


const Dashboard = ({ user, isDarkMode }) => {
    const { serverIp, isLoading: isSettingsLoading } = useSettings();
    const [isLoading, setIsLoading] = useState(true);
    const [employees, setEmployees] = useState([]);
    const [employments, setEmployments] = useState([]);
    const [certCounts, setCertCounts] = useState({ employment_certs: 0, training_certs: 0 });
    const [error, setError] = useState(null);

    const fetchData = useCallback(async () => {
        if (!serverIp) return;
        setIsLoading(true);
        setError(null);
        try {
            const [employeesData, employmentsData, certsData] = await Promise.all([
                apiFetch('employees', serverIp),
                apiFetch('employments', serverIp),
                apiFetch('certificate-stats', serverIp),
            ]);

            setEmployees(employeesData);
            setEmployments(employmentsData);
            setCertCounts(certsData);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [serverIp]);

    useEffect(() => {
        if (!isSettingsLoading) {
            fetchData();
        }
    }, [isSettingsLoading, fetchData]);

    const dashboardData = useMemo(() => {
        const totalEmployees = new Set(employees.map(e => e.employee_id)).size;

        const demographics = employees.reduce((acc, emp) => {
            acc[emp.sex] = (acc[emp.sex] || 0) + 1;
            return acc;
        }, {});

        const municipalityCounts = employees.reduce((acc, emp) => {
            if (emp.city) {
                acc[emp.city] = (acc[emp.city] || 0) + 1;
            }
            return acc;
        }, {});
        
        const performanceRatings = employments.reduce((acc, emp) => {
            const rating = emp.rating || "Not Rated";
            acc[rating] = (acc[rating] || 0) + 1;
            return acc;
        }, {});

        return {
            totalEmployees,
            totalEmployments: certCounts.employment_certs,
            totalTrainings: certCounts.training_certs,
            demographics,
            municipalityCounts,
            performanceRatings,
        };
    }, [employees, employments, certCounts]);

    if (isLoading || isSettingsLoading) {
        return <div className="p-8 text-center dark:text-gray-300">Loading dashboard...</div>;
    }

    if (error) {
        return <div className="p-8 text-center text-red-500">Error: {error}</div>;
    }

    return (
        <div className="bg-gray-100 dark:bg-gray-900">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Dashboard Overview</h1>
            <div className="mb-6">
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4"
                    whileHover={{ scale: 1.01 }}
                    transition={{ type: "spring", stiffness: 300 }}
                >
                    <img src={Cover} alt="System Icon" className="h-full w-full object-contain rounded-lg" />
                </motion.div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 flex items-center justify-between"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 300 }}
                >
                    <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Employees</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{dashboardData.totalEmployees}</p>
                    </div>
                    <FaUsers className="text-4xl text-blue-500" />
                </motion.div>
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 flex items-center justify-between"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 300 }}
                >
                    <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Employment Certificate Generated</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{dashboardData.totalEmployments}</p>
                    </div>
                    <FaBriefcase className="text-4xl text-green-500" />
                </motion.div>
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 flex items-center justify-between"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 300 }}
                >
                    <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Training Certificate Generated</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{dashboardData.totalTrainings}</p>
                    </div>
                    <FaGraduationCap className="text-4xl text-yellow-500" />
                </motion.div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6"
                    whileHover={{ scale: 1.02 }}
                >
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Employees by City/Municipality</h2>
                    <div className="h-64 flex items-center justify-center">
                        <MunicipalityBarChart data={dashboardData.municipalityCounts} isDarkMode={isDarkMode} />
                    </div>
                </motion.div>
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6"
                    whileHover={{ scale: 1.02 }}
                >
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Employees by Sex</h2>
                    <div className="h-64 flex items-center justify-center">
                       <DemographicsRechart data={dashboardData.demographics} isDarkMode={isDarkMode} />
                    </div>
                </motion.div>
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6"
                    whileHover={{ scale: 1.02 }}
                >
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Performance Ratings</h2>
                    <div className="h-64 flex items-center justify-center">
                        <PerformanceRatingsChart data={dashboardData.performanceRatings} isDarkMode={isDarkMode} />
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

export default Dashboard;
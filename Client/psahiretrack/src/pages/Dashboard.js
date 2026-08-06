import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FaUsers, FaBriefcase, FaGraduationCap, FaClipboardList } from 'react-icons/fa';
import DemographicsRechart from '../components/DemographicsRechart';
import { motion } from 'framer-motion';
import MunicipalityBarChart from '../components/MunicipalityBarChart';
import PerformanceRatingsChart from '../components/PerformanceRatingsChart';
import { apiFetch } from '../components/API';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';
import { useSettings } from '../context/SettingsContext';

const Cover = require('../assets/cover.jpg');

const Dashboard = ({ user, isDarkMode }) => {
    const { serverIp, isLoading: isSettingsLoading } = useSettings();
    const { toasts, showToast, removeToast } = useToast();
    const [isLoading, setIsLoading] = useState(true);
    const [applicants, setApplicants] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [employments, setEmployments] = useState([]);
    const [certCounts, setCertCounts] = useState({ employment_certs: 0, training_certs: 0 });

    const fetchData = useCallback(async () => {
        if (!serverIp) return;
        setIsLoading(true);
        try {
            const [applicantsData, employeesData, employmentsData, certsData] = await Promise.all([
                apiFetch('applicants', serverIp),
                apiFetch('employees', serverIp),
                apiFetch('employments', serverIp),
                apiFetch('certificate-stats', serverIp),
            ]);

            setApplicants(applicantsData);
            setEmployees(employeesData);
            setEmployments(employmentsData);
            setCertCounts(certsData);
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [serverIp, showToast]);

    useEffect(() => {
        if (!isSettingsLoading) {
            fetchData();
        }
    }, [isSettingsLoading, fetchData]);

    const dashboardData = useMemo(() => {
        const totalApplicants = applicants.length;
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
            let rating = emp.rating || "Not Rated";
            if (rating !== "Not Rated") {
                // Split by any type of dash (hyphen, en-dash, em-dash)
                rating = rating.split(/[-—–]/).pop().trim();
            }
            acc[rating] = (acc[rating] || 0) + 1;
            return acc;
        }, {});

        return {
            totalApplicants,
            totalEmployees,
            totalEmployments: certCounts.employment_certs,
            totalTrainings: certCounts.training_certs,
            demographics,
            municipalityCounts,
            performanceRatings,
        };
    }, [applicants, employees, employments, certCounts]);

    if (isLoading || isSettingsLoading) {
        return <div className="p-8 text-center dark:text-gray-300">Loading dashboard...</div>;
    }

    return (
        <div className="bg-gray-100 dark:bg-gray-900 flex-1 w-full flex flex-col min-h-0">
            <ToastContainer toasts={toasts} onClose={removeToast} />
            <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white mb-2">Dashboard Overview</h1>
            <div className="mb-4 lg:mb-6 h-28 sm:h-32 lg:h-48 flex-shrink-0">
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-2 lg:p-4 h-full"
                    whileHover={{ scale: 1.01 }}
                    transition={{ type: "spring", stiffness: 300 }}
                >
                    <img src={Cover} alt="System Icon" className="h-full w-full object-contain rounded-lg" />
                </motion.div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-4 lg:mb-6 flex-shrink-0">
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 lg:p-6 flex items-center justify-between h-full w-full"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 300 }}
                >
                    <div>
                        <p className="text-xs lg:text-sm font-medium text-gray-500 dark:text-gray-400">Total Applicants</p>
                        <p className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">{dashboardData.totalApplicants}</p>
                    </div>
                    <FaClipboardList className="text-3xl lg:text-4xl text-purple-500 flex-shrink-0 ml-2" />
                </motion.div>
                
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 lg:p-6 flex items-center justify-between h-full w-full"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 300 }}
                >
                    <div>
                        <p className="text-xs lg:text-sm font-medium text-gray-500 dark:text-gray-400">Total Employees</p>
                        <p className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">{dashboardData.totalEmployees}</p>
                    </div>
                    <FaUsers className="text-3xl lg:text-4xl text-blue-500 flex-shrink-0 ml-2" />
                </motion.div>
                
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 lg:p-6 flex items-center justify-between h-full w-full"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 300 }}
                >
                    <div>
                        <p className="text-xs lg:text-sm font-medium text-gray-500 dark:text-gray-400 break-words">Employment Certificates</p>
                        <p className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">{dashboardData.totalEmployments}</p>
                    </div>
                    <FaBriefcase className="text-3xl lg:text-4xl text-green-500 flex-shrink-0 ml-2" />
                </motion.div>
                
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 lg:p-6 flex items-center justify-between h-full w-full"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 300 }}
                >
                    <div>
                        <p className="text-xs lg:text-sm font-medium text-gray-500 dark:text-gray-400 break-words">Training Certificates</p>
                        <p className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">{dashboardData.totalTrainings}</p>
                    </div>
                    <FaGraduationCap className="text-3xl lg:text-4xl text-yellow-500 flex-shrink-0 ml-2" />
                </motion.div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 flex-1 min-h-0">
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 lg:p-6 flex flex-col h-full"
                    whileHover={{ scale: 1.02 }}
                >
                    <h2 className="text-base lg:text-lg font-semibold text-gray-800 dark:text-white mb-2 lg:mb-4 flex-shrink-0">Employees by City/Municipality</h2>
                    <div className="flex-1 w-full min-h-0 flex items-center justify-center">
                        <MunicipalityBarChart data={dashboardData.municipalityCounts} isDarkMode={isDarkMode} />
                    </div>
                </motion.div>
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 lg:p-6 flex flex-col h-full"
                    whileHover={{ scale: 1.02 }}
                >
                    <h2 className="text-base lg:text-lg font-semibold text-gray-800 dark:text-white mb-2 lg:mb-4 flex-shrink-0">Employees by Sex</h2>
                    <div className="flex-1 w-full min-h-0 flex items-center justify-center">
                       <DemographicsRechart data={dashboardData.demographics} isDarkMode={isDarkMode} />
                    </div>
                </motion.div>
                <motion.div
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 lg:p-6 flex flex-col h-full"
                    whileHover={{ scale: 1.02 }}
                >
                    <h2 className="text-base lg:text-lg font-semibold text-gray-800 dark:text-white mb-2 lg:mb-4 flex-shrink-0">Performance Ratings</h2>
                    <div className="flex-1 w-full min-h-0 flex items-center justify-center">
                        <PerformanceRatingsChart data={dashboardData.performanceRatings} isDarkMode={isDarkMode} />
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

export default Dashboard;

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { motion } from 'framer-motion';
import {
    FiLogOut, FiUser, FiLayout, FiMessageSquare,
    FiUsers, FiTool, FiBriefcase, FiBook, FiAward, FiFileText, FiUserPlus, FiClipboard
} from 'react-icons/fi';
import { FaSun, FaMoon } from 'react-icons/fa';
import PSALogo from '../assets/iconat.png';

const Sidebar = ({ onLogout, user }) => {
    const location = useLocation();
    const { isDarkMode, setIsDarkMode } = useTheme();

    const ThemeIcon = isDarkMode ? FaSun : FaMoon;

    const navLinks = [
        { name: 'Dashboard', icon: FiLayout, path: '/dashboard' },
        { name: 'Applicants', icon: FiUserPlus, path: '/applicants' },
        { name: 'Interview', icon: FiMessageSquare, path: '/interview' },
        { name: 'Assessment', icon: FiClipboard, path: '/assessment' },
        { name: 'Employees', icon: FiUsers, path: '/employees' },
        { name: 'Training', icon: FiBook, path: '/trainings' },
        { name: 'Employment', icon: FiBriefcase, path: '/employments' },
        { name: 'Certificate', icon: FiAward, path: '/certificates' },
        { name: 'External Partners', icon: FiFileText, path: '/temp-certificates' },
        { name: 'Utilities', icon: FiTool, path: '/utilities' },
        { name: 'Account', icon: FiUser, path: '/accounts' },
    ];

    const visibleLinks = navLinks.filter(link => {
        if (['Account', 'Utilities', 'Certificate', 'External Partners'].includes(link.name)) {
            return ['Super_Admin', 'Admin', 'PACD'].includes(user.role);
        }
        if (['Applicants', 'Assessment', 'Interview'].includes(link.name)) {
            return ['Super_Admin'].includes(user.role);
        }
        return true;
    });

    return (
        <aside className={`h-full overflow-y-auto bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 flex flex-col flex-shrink-0 transition-all duration-300 w-64`}>

            {/* --- Top Section: Header and Navigation --- */}
            <div className="flex-grow">
                {/* Logo Section */}
                <div className="px-4 py-2 xl:py-2 flex flex-col items-center justify-center border-b border-gray-200 dark:border-gray-700 mb-1 xl:mb-2">
                    <img src={PSALogo} alt="PSA Logo" className="w-[100px] h-[100px] xl:w-[150px] xl:h-[150px] object-contain drop-shadow-md" />
                </div>

                {/* Navigation Links */}
                <nav className="px-4 mt-2 xl:mt-2">
                    <ul>
                        {visibleLinks.map((link) => {
                            const NavLinkIcon = link.icon;
                            const isActive = location.pathname.startsWith(link.path);
                            const linkClasses = `flex items-center p-2 rounded-lg transition-colors ${isActive
                                ? "bg-blue-600 text-white"
                                : "hover:bg-blue-500 hover:text-white"
                                }`;

                            return (
                                <motion.li
                                    key={link.name}
                                    className="mb-1 xl:mb-2"
                                    whileHover={{ scale: 1.05 }}
                                >
                                    <Link to={link.path} className={linkClasses}>
                                        <NavLinkIcon className="w-5 h-5 xl:w-6 xl:h-6 flex-shrink-0" />
                                        <span className="text-sm xl:text-lg ml-3 xl:ml-4 whitespace-nowrap">{link.name}</span>
                                    </Link>
                                </motion.li>
                            );
                        })}
                    </ul>
                </nav>
            </div>

            {/* --- Bottom Section: Theme Toggle and Logout Button --- */}
            <div className="p-4 space-y-2 xl:space-y-3">
                <button
                    onClick={() => setIsDarkMode(!isDarkMode)}
                    className="w-full flex items-center justify-between py-2 px-3 xl:py-3 xl:px-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <ThemeIcon className={`w-5 h-5 ${isDarkMode ? 'text-gray-300' : 'text-yellow-500'}`} />
                        <span className="font-medium text-gray-700 dark:text-gray-200 text-sm">
                            {isDarkMode ? 'Dark Mode' : 'Light Mode'}
                        </span>
                    </div>
                    <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isDarkMode ? 'bg-blue-600' : 'bg-gray-300'}`}>
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isDarkMode ? 'translate-x-5' : 'translate-x-1'}`} />
                    </div>
                </button>

                <button
                    onClick={onLogout}
                    className="w-full flex items-center gap-3 py-2 px-3 xl:py-3 xl:px-4 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                    <FiLogOut className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    <span className="font-medium text-sm">Logout</span>
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;

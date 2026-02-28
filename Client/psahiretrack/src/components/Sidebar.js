import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import SysIcon from '../assets/iconat.png';
import { motion } from 'framer-motion';
import { 
    FiLogOut, FiChevronLeft, FiChevronRight, FiUser, FiLayout, FiMessageSquare,
    FiUsers, FiTool, FiBriefcase, FiBook, FiAward, FiFileText, FiUserPlus, FiClipboard
} from 'react-icons/fi';
import { FaSun, FaMoon } from 'react-icons/fa';

const Sidebar = ({ onLogout, user }) => {
    const location = useLocation();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const { isDarkMode, setIsDarkMode } = useTheme();
    
    const ThemeIcon = isDarkMode ? FaSun : FaMoon;
    const CollapseIcon = isCollapsed ? FiChevronRight : FiChevronLeft;

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
        { name: 'Utilities', icon: FiTool, path: '/utilities'},
        { name: 'Account', icon: FiUser, path: '/accounts' },
    ];

    const visibleLinks = navLinks.filter(link => {
        if (['Account', 'Utilities', 'Applicants'].includes(link.name)) {
            return ['Super_Admin', 'Admin', 'PACD'].includes(user.role);
        }
        if (['Assessment'].includes(link.name)) {
            return ['Super_Admin', 'Focal Person'].includes(user.role);
        }
        if (['Certificate', 'Interview'].includes(link.name)) {
            return ['Super_Admin', 'Admin', 'PACD', 'User'].includes(user.role);
        }
        return true;
    });

    return (
        <aside className={`min-h-screen bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 flex flex-col flex-shrink-0 transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-64'}`}>
            
            {/* --- Top Section: Header and Navigation --- */}
            <div className="flex-grow">
                {/* Header with Theme and Collapse Buttons */}
                <div className="px-4 pt-4 flex justify-between items-center">
                    <motion.button 
                        onClick={() => setIsDarkMode(!isDarkMode)} 
                        className="p-2 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                        <ThemeIcon className="w-6 h-6" />
                    </motion.button>
                    <motion.button 
                        onClick={() => setIsCollapsed(!isCollapsed)} 
                        className="p-2 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                        <CollapseIcon className="w-6 h-6" />
                    </motion.button>
                </div>

                {/* Navigation Links */}
                <nav className="px-4 mt-8">
                    <ul>
                        {visibleLinks.map((link) => {
                            const NavLinkIcon = link.icon;
                            const isActive = location.pathname.startsWith(link.path);
                            const linkClasses = `flex items-center p-2 rounded-lg transition-colors ${
                                isActive 
                                ? "bg-blue-600 text-white" 
                                : "hover:bg-blue-500 hover:text-white"
                            }`;

                            return (
                                <motion.li 
                                    key={link.name} 
                                    className="mb-2"
                                    whileHover={{ scale: 1.05 }}
                                >
                                    <Link to={link.path} className={linkClasses}>
                                        <NavLinkIcon className="w-6 h-6 flex-shrink-0" />
                                        {!isCollapsed && <span className="text-lg ml-4 whitespace-nowrap">{link.name}</span>}
                                    </Link>
                                </motion.li>
                            );
                        })}
                    </ul>
                </nav>
            </div>

            {/* --- Bottom Section: Logo and Logout Button --- */}
            <div className="p-4">
                <div className="mb-4 flex justify-center">
                    {!isCollapsed && <img src={SysIcon} alt="System Icon" className="w-48" />}
                </div>
                <motion.button 
                    onClick={onLogout} 
                    className="group w-full h-12 flex justify-center items-center py-3 px-4 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                    whileHover={{ scale: 1.05 }}
                >
                    <FiLogOut className="w-6 h-6 flex-shrink-0" />
                    {!isCollapsed && <span className="font-medium ml-2">Logout</span>}
                </motion.button>
            </div>
        </aside>
    );
};

export default Sidebar;
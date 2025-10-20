import React, { createContext, useState, useEffect, useContext } from 'react';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
    const [isDarkMode, setIsDarkMode] = useState(() => {
        // Get the theme from localStorage or default to false (light mode)
        return localStorage.getItem('theme') === 'dark';
    });

    useEffect(() => {
        // This effect runs whenever isDarkMode changes
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    }, [isDarkMode]);

    const value = { isDarkMode, setIsDarkMode };

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// Custom hook to easily access the theme context
export const useTheme = () => {
    return useContext(ThemeContext);
};
import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext'; // 1. IMPORT THE HOOK
import PSALogo from '../assets/logo.png';
import { FaSun, FaMoon, FaEye, FaEyeSlash, FaCog } from 'react-icons/fa';

const appVersion = "v1.0.0";

const LoginPage = () => {
    const { isDarkMode, setIsDarkMode } = useTheme();
    const { serverIp, updateServerIp } = useSettings(); // 2. USE THE HOOK

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [showRestartModal, setShowRestartModal] = useState(false);

    // This state is temporary for the input field in the modal
    const [tempServerIp, setTempServerIp] = useState(serverIp); 
    const [localIp, setLocalIp] = useState('Fetching...');

    const ThemeIcon = isDarkMode ? FaSun : FaMoon;
    const PasswordIcon = showPassword ? FaEyeSlash : FaEye;

    // Update the temporary IP when the modal opens or the real IP changes
    useEffect(() => {
        if (isSettingsOpen) {
            setTempServerIp(serverIp);
        }
    }, [isSettingsOpen, serverIp]);

    // This useEffect is now only for the local IP
    useEffect(() => {
        const fetchLocalIp = async () => {
            try {
                const currentLocalIp = await window.electronAPI.getLocalIP();
                setLocalIp(currentLocalIp || 'Unavailable');
            } catch (err) {
                console.error("Could not get local IP:", err);
                setLocalIp('Error');
            }
        };
        fetchLocalIp();
    }, []);

    useEffect(() => {
        // This function will be called when the backend sends the message
        const handleShowRestartPrompt = () => {
            setIsSettingsOpen(false); // Close the settings modal first
            setShowRestartModal(true); // Then show the restart modal
        };

        window.electronAPI.onShowRestartPrompt(handleShowRestartPrompt);
        
        // Cleanup function to prevent memory leaks
        return () => {
            // It's good practice to have a way to remove the listener,
            // though for this simple case it's less critical.
            // You would need to add an 'offShowRestartPrompt' in your preload.js
        };
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            const response = await window.electronAPI.login({ username, password });
            if (response.error) {
                setError(response.error);
            }
        } catch (err) {
            setError('An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // 3. UPDATE the handleSaveSettings function
    const handleSaveSettings = async () => {
        // This now calls the global update function from our context
        await updateServerIp(tempServerIp);
        // The app will restart automatically from the backend, so we don't need to close the modal
    };

    const handleRestartApp = () => {
        window.electronAPI.restartApp();
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 transition-colors duration-300">
            <div className="w-full max-w-md p-8 space-y-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg">
                <div className="relative text-center">
                    <div className="absolute top-0 right-0 flex items-center gap-x-1">
                        <button
                            type="button"
                            onClick={() => setIsSettingsOpen(true)}
                            className="p-2 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-transform duration-300 hover:scale-110 hover:rotate-45"
                        >
                            <FaCog className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => setIsDarkMode(!isDarkMode)}
                            className="p-2 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-transform duration-300 hover:scale-110 hover:rotate-12"
                        >
                            <ThemeIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <img src={PSALogo} alt="PSA Logo" className="w-16 h-16 mx-auto" />
                    <h2 className="mt-6 text-3xl font-bold text-gray-900 dark:text-white">PSA KALINGA <br /> Hired Tracking System</h2>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Please sign in to continue</p>
                </div>

                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    {error && <div className="text-center p-3 bg-red-100 text-red-700 rounded-lg dark:bg-red-900/50 dark:text-red-300">{error}</div>}
                    <div className="space-y-4">
                        <div className="relative">
                            <input
                                id="username"
                                name="username"
                                type="text"
                                required
                                className="block px-3 pt-6 pb-2 w-full text-gray-900 bg-transparent rounded-lg border-2 border-gray-300 appearance-none dark:text-white dark:border-gray-600 focus:outline-none focus:ring-0 focus:border-blue-600 peer"
                                placeholder=" "
                                value={username}
                                onChange={(e) => { setUsername(e.target.value); setError(''); }}
                            />
                            <label
                                htmlFor="username"
                                className="absolute text-gray-500 dark:text-gray-400 duration-300 transform -translate-y-4 scale-75 top-4 z-10 origin-[0] start-3 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4 peer-focus:text-blue-600 dark:peer-focus:text-blue-500"
                            >
                                Username
                            </label>
                        </div>
                        
                        <div className="relative">
                            <input
                                id="password"
                                name="password"
                                type={showPassword ? 'text' : 'password'}
                                required
                                className="block px-3 pt-6 pb-2 w-full text-gray-900 bg-transparent rounded-lg border-2 border-gray-300 appearance-none dark:text-white dark:border-gray-600 focus:outline-none focus:ring-0 focus:border-blue-600 peer"
                                placeholder=" "
                                value={password}
                                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                            />
                            <label
                                htmlFor="password"
                                className="absolute text-gray-500 dark:text-gray-400 duration-300 transform -translate-y-4 scale-75 top-4 z-10 origin-[0] start-3 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4 peer-focus:text-blue-600 dark:peer-focus:text-blue-500"
                            >
                                Password
                            </label>
                            <button type="button" className="absolute inset-y-0 right-0 z-20 flex items-center px-3 text-gray-500" onClick={() => setShowPassword(!showPassword)}>
                                <PasswordIcon className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center justify-end text-sm">
                        <button type="button" onClick={() => setShowInfoModal(true)} className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">
                            Forgot password?
                        </button>
                    </div>
                    <div>
                        <button type="submit" disabled={isLoading} className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                            {isLoading ? 'Signing In...' : 'Sign in'}
                        </button>
                    </div>
                    <div>
                        <p className="text-right text-sm text-gray-600 dark:text-gray-400">{appVersion}</p>
                    </div>
                </form>
            </div>

            {showInfoModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 w-full max-w-sm z-50 text-center">
                        <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-white">Password Reset</h2>
                        <p className="text-gray-600 dark:text-gray-300 mb-6">To reset your password, please contact the system administrator.</p>
                        <button onClick={() => setShowInfoModal(false)} className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">Got it</button>
                    </div>
                </div>
            )}

            {isSettingsOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 w-full max-w-sm z-50 space-y-6">
                        <h2 className="text-xl font-bold text-gray-800 dark:text-white text-center">Connection Settings</h2>
                        
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Your Local IP Address</label>
                            <p className="p-3 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-md">{localIp}</p>
                        </div>

                        <div className="relative">
                            <input
                                id="serverIp"
                                name="serverIp"
                                type="text"
                                className="block px-3 pt-6 pb-2 w-full text-gray-900 bg-transparent rounded-lg border-2 border-gray-300 appearance-none dark:text-white dark:border-gray-600 focus:outline-none focus:ring-0 focus:border-blue-600 peer"
                                placeholder=" "
                                value={tempServerIp}
                                onChange={(e) => setTempServerIp(e.target.value)}
                            />
                            <label
                                htmlFor="serverIp"
                                className="absolute text-gray-500 dark:text-gray-400 duration-300 transform -translate-y-4 scale-75 top-4 z-10 origin-[0] start-3 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4"
                            >
                                Server IP Address
                            </label>
                        </div>
                        
                        <div className="flex gap-4">
                            <button onClick={() => setIsSettingsOpen(false)} className="w-full px-4 py-2 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600">Cancel</button>
                            <button onClick={handleSaveSettings} className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">Save</button>
                        </div>
                    </div>
                </div>
            )}
            {showRestartModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="w-full max-w-sm p-6 text-center bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                        <div className="flex items-center justify-center w-12 h-12 mx-auto bg-blue-100 rounded-full dark:bg-blue-900/50">
                            <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h5M20 20v-5h-5M20 4h-5v5M4 20h5v-5"></path></svg>
                        </div>
                        <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">Restart Required</h2>
                        <p className="mt-2 text-gray-600 dark:text-gray-300">
                            The server IP has been updated. The app must restart to apply the new settings.
                        </p>
                        <div className="mt-6">
                            <button 
                                onClick={handleRestartApp} 
                                className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700"
                            >
                                Restart Now
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LoginPage;
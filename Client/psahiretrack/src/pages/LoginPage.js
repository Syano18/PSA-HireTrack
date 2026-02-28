import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import PSALogo from '../assets/logo.png';
import { FaSun, FaMoon, FaEye, FaEyeSlash, FaCog, FaInfoCircle, FaGoogle } from 'react-icons/fa';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithCredential, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase";

// const appVersion = "v1.0.0"; // This will now be fetched from the main process

const LoginPage = () => {
    const { isDarkMode, setIsDarkMode } = useTheme();
    const { serverIp, updateServerIp } = useSettings();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [showRestartModal, setShowRestartModal] = useState(false);

    const [appVersion, setAppVersion] = useState('v?.?.?');
    const [updateStatus, setUpdateStatus] = useState('');
    const [isUpdateChecking, setIsUpdateChecking] = useState(false);
    const [isUpdateDownloaded, setIsUpdateDownloaded] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);

    const [showResetModal, setShowResetModal] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [resetLoading, setResetLoading] = useState(false);
    const [resetMessage, setResetMessage] = useState({ type: '', text: '' });
    const [tempServerIp, setTempServerIp] = useState(serverIp); 
    const [localIp, setLocalIp] = useState('Fetching...');

    const ThemeIcon = isDarkMode ? FaSun : FaMoon;
    const PasswordIcon = showPassword ? FaEyeSlash : FaEye;

    useEffect(() => {
        if (isSettingsOpen) {
            setTempServerIp(serverIp);
        }
    }, [isSettingsOpen, serverIp]);

    useEffect(() => {
        const getAppVersion = async () => {
            try {
                const version = await window.electronAPI.getAppVersion();
                setAppVersion(version || 'v?.?.?');
            } catch (err) {
                console.error("Could not get app version:", err);
                setAppVersion('Error');
            }
        };
        getAppVersion();
    }, []);

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
        const handleShowRestartPrompt = () => {
            setIsSettingsOpen(false);
            setShowRestartModal(true);
        };

        window.electronAPI.onShowRestartPrompt(handleShowRestartPrompt);

        return () => {
        };
    }, []);

    useEffect(() => {
        const handleUpdateAvailable = (info) => {
            setIsUpdateChecking(false);
            setIsDownloading(true);
            setUpdateStatus(`New version ${info.version} is available. Initializing download...`);
        };

        const handleUpdateNotAvailable = () => {
            setIsUpdateChecking(false);
            setIsDownloading(false);
            setUpdateStatus('You are on the latest version.');
        };

        const handleUpdateError = (err) => {
            setIsUpdateChecking(false);
            setIsDownloading(false);
            setUpdateStatus(`Error checking for updates. Please try again.`);
            console.error('Update Error:', err);
        };

        const handleUpdateProgress = (progressObj) => {
            setDownloadProgress(progressObj.percent);
            setUpdateStatus(`Downloading update... ${Math.floor(progressObj.percent)}%`);
        };

        const handleUpdateDownloaded = (info) => {
            setIsUpdateChecking(false);
            setIsDownloading(false);
            setIsUpdateDownloaded(true);
            setUpdateStatus(`Update ${info.version} has been downloaded. Restart to install.`);
        };

        const cleanupAvailable = window.electronAPI.onUpdateAvailable(handleUpdateAvailable);
        const cleanupNotAvailable = window.electronAPI.onUpdateNotAvailable(handleUpdateNotAvailable);
        const cleanupError = window.electronAPI.onUpdateError(handleUpdateError);
        const cleanupProgress = window.electronAPI.onUpdateProgress(handleUpdateProgress);
        const cleanupDownloaded = window.electronAPI.onUpdateDownloaded(handleUpdateDownloaded);

        return () => {
            cleanupAvailable();
            cleanupNotAvailable();
            cleanupError();
            cleanupProgress();
            cleanupDownloaded();
        };
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        if (!navigator.onLine) {
            setError('No internet connection. Please check your network and try again.');
            setIsLoading(false);
            return;
        }

        try {
            // 1. Authenticate with Firebase
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const idToken = await userCredential.user.getIdToken();

            // 2. Send token to backend to get app session
            const response = await fetch(`http://${serverIp}:3001/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Login failed.');
            }

            // 3. Save session state via Electron bridge
            await window.electronAPI.setLoginState(data);
        } catch (err) {
            console.error("Login Error:", err);
            
            // Map Firebase error codes to user-friendly messages
            let userFriendlyError = 'An unexpected error occurred. Please try again.';
            
            if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
                userFriendlyError = 'Incorrect Password or Email Address';
            } else if (err.code === 'auth/invalid-email') {
                userFriendlyError = 'Invalid email address';
            } else if (err.code === 'auth/user-disabled') {
                userFriendlyError = 'This account has been disabled';
            } else if (err.code === 'auth/too-many-requests') {
                userFriendlyError = 'Too many login attempts. Please try again later.';
            } else if (err.message) {
                userFriendlyError = err.message;
            }
            
            if (userFriendlyError.includes('Failed to fetch')) {
                userFriendlyError = 'Check the Server IP Address';
            }
            
            setError(userFriendlyError);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setError('');
        setIsLoading(true);

        if (!navigator.onLine) {
            setError('No internet connection. Please check your network and try again.');
            setIsLoading(false);
            return;
        }

        try {
            // 1. Try Silent Login first (using stored Refresh Token)
            let result = await window.electronAPI.loginGoogleSilent();
            
            // 2. If silent login fails (no token or expired), fall back to Browser Loopback
            if (result.error) {
                result = await window.electronAPI.loginGoogleLoopback();
            }

            if (result.error) throw new Error(result.error);

            // 2. Use the returned Google ID Token to sign in to Firebase
            const credential = GoogleAuthProvider.credential(result.idToken);
            const userCredential = await signInWithCredential(auth, credential);
            const idToken = await userCredential.user.getIdToken();

            // Send token to backend to get app session
            const response = await fetch(`http://${serverIp}:3001/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Google Login failed.');
            }

            // Save session state via Electron bridge
            await window.electronAPI.setLoginState(data);
        } catch (err) {
            console.error("Google Login Error:", err);
            let errorMessage = err.message || 'An unexpected error occurred during Google Sign-In.';
            if (errorMessage.includes('Failed to fetch')) {
                errorMessage = 'Check the Server IP Address';
            }
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasswordReset = async (e) => {
        e.preventDefault();
        setResetLoading(true);
        setResetMessage({ type: '', text: '' });

        if (!navigator.onLine) {
            setResetMessage({ type: 'error', text: 'No internet connection.' });
            setResetLoading(false);
            return;
        }

        try {
            await sendPasswordResetEmail(auth, resetEmail);
            setResetMessage({ type: 'success', text: 'Password reset link sent! Please check your email.' });
        } catch (err) {
            let errorMessage = 'Failed to send reset email. Please check the address and try again.';
            if (err.code === 'auth/user-not-found') {
                errorMessage = 'No user found with this email address.';
            }
            setResetMessage({ type: 'error', text: errorMessage });
        } finally {
            setResetLoading(false);
        }
    };

    const openResetModal = () => {
        setResetEmail('');
        setResetMessage({ type: '', text: '' });
        setShowResetModal(true);
    };

    const closeResetModal = () => {
        setShowResetModal(false);
    };

    const handleCheckForUpdate = () => {
        setIsUpdateChecking(true);
        setIsUpdateDownloaded(false);
        setUpdateStatus('Checking for updates...');
        window.electronAPI.checkForUpdates();
    };

    const handleSaveSettings = async () => {
        await updateServerIp(tempServerIp);
    };

    const handleRestartApp = () => {
        window.electronAPI.restartApp();
    };

    const handleRestartAndInstall = () => {
        // Reset status in case user re-opens settings
        setUpdateStatus('');
        setIsUpdateDownloaded(false);
        window.electronAPI.quitAndInstall();
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
                        <div className="relative group">
                            <button
                                type="button"
                                className="p-2 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-transform duration-300 hover:scale-110"
                            >
                                <FaInfoCircle className="w-5 h-5" />
                            </button>
                            <div className="absolute top-10 right-0 w-64 p-3 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-lg shadow-lg text-left text-sm text-gray-700 dark:text-gray-200 z-50 hidden group-hover:block transition-all duration-300 opacity-0 group-hover:opacity-100">
                                <h4 className="font-bold mb-1 text-gray-900 dark:text-white">About This App</h4>
                                <p className="mb-2">
                                    The PSA Kalinga Hired Tracking System streamlines personnel management for Contract of Service Workers (COSWs). It centralizes monitoring, automates employment and training certificates, and features a performance evaluation tool. Supervisor ratings are used as a reference for future hiring, ensuring a fair, transparent, and efficient system that reduces paperwork and speeds up hiring for field surveys.
                                </p>
                                <hr className="my-1 border-gray-300 dark:border-gray-600" />
                                <p>Developer: Chano, ISA II</p>
                            </div>
                        </div>
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
                                id="email"
                                name="email"
                                type="text"
                                required
                                className="block px-3 pt-6 pb-2 w-full text-gray-900 bg-transparent rounded-lg border-2 border-gray-300 appearance-none dark:text-white dark:border-gray-600 focus:outline-none focus:ring-0 focus:border-blue-600 peer"
                                placeholder=" "
                                value={email}
                                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                            />
                            <label
                                htmlFor="email"
                                className="absolute text-gray-500 dark:text-gray-400 duration-300 transform -translate-y-4 scale-75 top-4 z-10 origin-[0] start-3 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4 peer-focus:text-blue-600 dark:peer-focus:text-blue-500"
                            >
                                Email Address
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
                        <button type="button" onClick={openResetModal} className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">
                            Forgot password?
                        </button>
                    </div>
                    <div>
                        <button type="submit" disabled={isLoading} className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                            {isLoading ? 'Signing In...' : 'Sign in'}
                        </button>
                    </div>

                    <div className="relative my-4">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-2 bg-white dark:bg-gray-800 text-gray-500">Or continue with</span>
                        </div>
                    </div>

                    <div>
                        <button
                            type="button"
                            onClick={handleGoogleSignIn}
                            disabled={isLoading}
                            className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-sm font-medium text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                        >
                            <FaGoogle className="w-5 h-5 text-red-500" />
                            <span>Sign in with Google</span>
                        </button>
                    </div>
                </form>
            </div>

            {showResetModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 w-full max-w-sm z-50">
                        <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-white text-center">Reset Password</h2>
                        {resetMessage.text && (
                            <div className={`p-3 mb-4 text-sm rounded-lg ${resetMessage.type === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'}`}>
                                {resetMessage.text}
                            </div>
                        )}
                        {resetMessage.type !== 'success' && (
                            <form onSubmit={handlePasswordReset}>
                                <p className="text-gray-600 dark:text-gray-300 mb-4">Enter your email address and we will send you a link to reset your password.</p>
                                <div className="relative">
                                    <input
                                        id="reset-email"
                                        name="reset-email"
                                        type="email"
                                        required
                                        className="block px-3 pt-6 pb-2 w-full text-gray-900 bg-transparent rounded-lg border-2 border-gray-300 appearance-none dark:text-white dark:border-gray-600 focus:outline-none focus:ring-0 focus:border-blue-600 peer"
                                        placeholder=" "
                                        value={resetEmail}
                                        onChange={(e) => setResetEmail(e.target.value)}
                                    />
                                    <label
                                        htmlFor="reset-email"
                                        className="absolute text-gray-500 dark:text-gray-400 duration-300 transform -translate-y-4 scale-75 top-4 z-10 origin-[0] start-3 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4 peer-focus:text-blue-600 dark:peer-focus:text-blue-500"
                                    >
                                        Email Address
                                    </label>
                                </div>
                                <div className="flex gap-4 mt-6">
                                    <button type="button" onClick={closeResetModal} className="w-full px-4 py-2 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600">Cancel</button>
                                    <button type="submit" disabled={resetLoading} className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">
                                        {resetLoading ? 'Sending...' : 'Send Reset Link'}
                                    </button>
                                </div>
                            </form>
                        )}
                        {resetMessage.type === 'success' && (
                            <div className="mt-6">
                                <button onClick={closeResetModal} className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">Close</button>
                            </div>
                        )}
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

                        <div className="border-t border-gray-300 dark:border-gray-600 my-6"></div>

                        <div>
                            <h3 className="text-lg font-medium text-center text-gray-800 dark:text-white mb-2">Application Update</h3>
                            <p className="text-center text-sm text-gray-500 dark:text-gray-400 mb-4">Current Version: {appVersion}</p>
                            
                            {updateStatus && (
                                <p className={`text-center text-sm mb-3 ${isUpdateDownloaded ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'}`}>
                                    {updateStatus}
                                </p>
                            )}

                            {isDownloading && (
                                <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 mb-3 overflow-hidden">
                                    <div 
                                        className={`h-2.5 rounded-full transition-all duration-300 ease-out ${downloadProgress <= 0 ? 'bg-blue-300 dark:bg-blue-500 animate-pulse w-full' : 'bg-blue-600'}`}
                                        style={{ width: downloadProgress <= 0 ? '100%' : `${downloadProgress}%` }}
                                    ></div>
                                </div>
                            )}

                            {!isUpdateDownloaded ? (
                                <button 
                                    onClick={handleCheckForUpdate} 
                                    disabled={isUpdateChecking || isDownloading}
                                    className="w-full px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    {isUpdateChecking ? 'Checking...' : (isDownloading ? 'Downloading...' : 'Check for Updates')}
                                </button>
                            ) : (
                                <button onClick={handleRestartAndInstall} className="w-full px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700">
                                    Restart & Install Now
                                </button>
                            )}
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
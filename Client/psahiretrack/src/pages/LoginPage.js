import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import PSALogo from '../assets/logo.png';
import { FaSun, FaMoon, FaEye, FaEyeSlash, FaCog, FaInfoCircle, FaGoogle, FaDownload } from 'react-icons/fa';
import { getAuth, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

const LoginPage = () => {
    const { isDarkMode, setIsDarkMode } = useTheme();
    const { login } = useAuth();
    const { serverIp, updateServerIp } = useSettings();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [showRestartModal, setShowRestartModal] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [resetStatus, setResetStatus] = useState('idle');
    const [resetFeedback, setResetFeedback] = useState('');

    const [updateInfo, setUpdateInfo] = useState(null);
    const [showUpdateModal, setShowUpdateModal] = useState(false);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

    const [tempServerIp, setTempServerIp] = useState(serverIp); 
    const [localIp, setLocalIp] = useState('Fetching...');
    const [appVersion, setAppVersion] = useState('');

    const ThemeIcon = isDarkMode ? FaSun : FaMoon;
    const PasswordIcon = showPassword ? FaEyeSlash : FaEye;

    useEffect(() => {
        if (isSettingsOpen) {
            setTempServerIp(serverIp);
        }
    }, [isSettingsOpen, serverIp]);

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
        const fetchAppVersion = async () => {
            try {
                const version = await window.electronAPI.getAppVersion();
                setAppVersion(`v${version}`);
            } catch (err) {
                console.error("Could not get app version:", err);
            }
        };
        fetchAppVersion();
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            const response = await login(email, password);
            if (response.error) {
                setError(response.error);
            }
        } catch (err) {
            setError('An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveSettings = async () => {
        await updateServerIp(tempServerIp);
    };

    const handleRestartApp = () => {
        window.electronAPI.restartApp();
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();
        if (!resetEmail) return;
        
        setResetStatus('loading');
        setResetFeedback('');
        
        try {
            const auth = getAuth();
            await sendPasswordResetEmail(auth, resetEmail);
            setResetStatus('success');
            setResetFeedback('Password reset email sent! Please check your inbox.');
        } catch (err) {
            console.error("Reset password error:", err);
            setResetStatus('error');
            setResetFeedback(err.code === 'auth/user-not-found' ? 'No account found with this email.' : 'Failed to send reset email. Please try again.');
        }
    };

    const handleGoogleLogin = async () => {
        setError('');
        setIsLoading(true);
        try {
            const auth = getAuth();
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
        } catch (err) {
            console.error("Google login error:", err);
            if (err.code === 'auth/popup-closed-by-user') {
                setError('Sign-in popup was closed.');
            } else {
                setError('Failed to sign in with Google. Please check your connection.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleCheckForUpdate = async () => {
        setIsCheckingUpdate(true);
        try {
            const result = await window.electronAPI.checkForUpdates();
            if (result.updateAvailable) {
                setUpdateInfo(result);
                setShowUpdateModal(true);
            } else if (result.error) {
                alert(`Error checking for updates: ${result.error}`);
            } else {
                alert('You are using the latest version.');
            }
        } catch (err) {
            console.error(err);
            alert('Failed to check for updates.');
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    const handleConfirmUpdate = async () => {
        if (!updateInfo || !updateInfo.downloadUrl) return;
        
        setIsLoading(true); // Reuse main loading state or create specific one
        try {
            await window.electronAPI.downloadAndInstallUpdate(updateInfo.downloadUrl);
            // App will quit automatically if successful
        } catch (err) {
            alert('Failed to download update: ' + err.message);
            setIsLoading(false);
        }
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
                                <p><strong>Developer:</strong> Christian A. Dacpano</p>
                                <p><strong>Contact:</strong> officialchano18@gmail.com</p>
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
                                type="email"
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
                        <button type="button" onClick={() => { setShowInfoModal(true); setResetStatus('idle'); setResetEmail(''); setResetFeedback(''); }} className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">
                            Forgot password?
                        </button>
                    </div>
                    <div>
                        <button type="submit" disabled={isLoading} className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                            {isLoading ? 'Signing In...' : 'Sign in'}
                        </button>
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">Or continue with</span>
                        </div>
                    </div>

                    <div>
                        <button
                            type="button"
                            onClick={handleGoogleLogin}
                            disabled={isLoading}
                            className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-sm font-medium text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors duration-200"
                        >
                            <FaGoogle className="text-red-500" />
                            Sign in with Google
                        </button>
                    </div>
                    <div>
                        <div className="flex justify-between items-center text-sm text-gray-600 dark:text-gray-400">
                            <button type="button" onClick={handleCheckForUpdate} disabled={isCheckingUpdate} className="hover:text-blue-600 dark:hover:text-blue-400 underline disabled:opacity-50">
                                {isCheckingUpdate ? 'Checking...' : 'Check for Update'}
                            </button>
                            <p>{appVersion}</p>
                        </div>
                    </div>
                </form>
            </div>

            {showInfoModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 w-full max-w-sm z-50">
                        <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-white text-center">Reset Password</h2>
                        
                        {resetStatus === 'success' ? (
                            <div className="text-center">
                                <div className="mb-4 text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 p-3 rounded-lg">
                                    {resetFeedback}
                                </div>
                                <button 
                                    onClick={() => setShowInfoModal(false)} 
                                    className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
                                >
                                    Close
                                </button>
                            </div>
                        ) : (
                            <form onSubmit={handleResetPassword} className="space-y-4">
                                <p className="text-sm text-gray-600 dark:text-gray-300 text-center">
                                    Enter your email address and we'll send you a link to reset your password.
                                </p>
                                
                                {resetStatus === 'error' && (
                                    <div className="text-sm text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 p-2 rounded text-center">
                                        {resetFeedback}
                                    </div>
                                )}

                                <div>
                                    <label htmlFor="resetEmail" className="sr-only">Email Address</label>
                                    <input
                                        id="resetEmail"
                                        type="email"
                                        required
                                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        placeholder="Enter your email"
                                        value={resetEmail}
                                        onChange={(e) => setResetEmail(e.target.value)}
                                    />
                                </div>

                                <div className="flex gap-3">
                                    <button 
                                        type="button" 
                                        onClick={() => setShowInfoModal(false)} 
                                        className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        type="submit" 
                                        disabled={resetStatus === 'loading'}
                                        className="flex-1 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        {resetStatus === 'loading' ? 'Sending...' : 'Send Link'}
                                    </button>
                                </div>
                            </form>
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

            {showUpdateModal && updateInfo && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="w-full max-w-md p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                        <div className="text-center">
                            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-blue-100 rounded-full dark:bg-blue-900/50">
                                <FaDownload className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <h2 className="mt-4 text-xl font-bold text-gray-900 dark:text-white">Update Available</h2>
                            <p className="mt-2 text-gray-600 dark:text-gray-300">
                                A new version ({updateInfo.version}) is available. Would you like to download and install it now?
                            </p>
                            {updateInfo.releaseNotes && (
                                <div className="mt-4 p-3 text-left bg-gray-50 dark:bg-gray-700 rounded-md max-h-32 overflow-y-auto text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                    {updateInfo.releaseNotes}
                                </div>
                            )}
                        </div>
                        <div className="mt-6 flex gap-3">
                            <button onClick={() => setShowUpdateModal(false)} className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">Later</button>
                            <button onClick={handleConfirmUpdate} className="flex-1 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">Update Now</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LoginPage;
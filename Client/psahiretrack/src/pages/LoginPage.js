import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';
import PSALogo from '../assets/logo.png';
import { FaSun, FaMoon, FaEye, FaEyeSlash, FaInfoCircle, FaGoogle } from 'react-icons/fa';
import { useSignIn, useAuth as useClerkAuth } from '@clerk/clerk-react';
import { useAuth } from '../context/AuthContext';

// const appVersion = "v1.0.0"; // This will now be fetched from the main process

const LoginPage = () => {
    const { isDarkMode, setIsDarkMode } = useTheme();
    const { serverIp } = useSettings();
    const { toasts, showToast, removeToast } = useToast();

    const { isLoaded, signIn, setActive } = useSignIn();
    const { getToken, isSignedIn } = useClerkAuth();
    const { setLoginState } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const ThemeIcon = isDarkMode ? FaSun : FaMoon;
    const PasswordIcon = showPassword ? FaEyeSlash : FaEye;

    // useEffect(() => {
    //     setEmail("officialchano18@gmail.com");
    //     setPassword("admin123");
    // }, []);



    // Handle restoring session from Clerk (e.g. after Google OAuth redirect)
    useEffect(() => {
        if (isSignedIn && isLoaded) {
            setIsLoading(true);
            getToken().then(idToken => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                
                const protocol = window.location.protocol;
                const port = protocol === 'https:' ? 443 : 80;
                fetch(`${protocol}//${serverIp}:${port}/api/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                    signal: controller.signal
                })
                .then(res => res.json())
                .then(data => {
                    if (data.user) {
                        setLoginState(data);
                    }
                })
                .catch(err => {
                    console.error("Auto-login error:", err);
                    showToast("Session restored from Clerk but backend login failed.", "error");
                })
                .finally(() => {
                    clearTimeout(timeoutId);
                    setIsLoading(false);
                });
            });
        }
    }, [isSignedIn, isLoaded, getToken, serverIp, setLoginState, showToast]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);

        if (!navigator.onLine) {
            showToast('No internet connection. Please check your network and try again.', 'error');
            setIsLoading(false);
            return;
        }

        if (!isLoaded) {
            setIsLoading(false);
            return;
        }

        try {
            // Unconditionally clear any stale Clerk session before signing in again to avoid "You're already signed in" errors.
            await setActive({ session: null });

            // 1. Authenticate with Clerk
            const result = await signIn.create({
                identifier: email,
                password,
            });

            if (result.status !== "complete") {
                throw new Error("Additional authentication steps are required.");
            }

            await setActive({ session: result.createdSessionId });

            // Wait for Clerk to make the session active and token available
            // Let's use window.Clerk.session to get the token directly if useAuth is stale.
            const activeSession = window.Clerk?.session;
            const idToken = activeSession ? await activeSession.getToken() : await getToken();

            // 2. Send token to backend to get app session
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const protocol = window.location.protocol;
            const port = protocol === 'https:' ? 443 : 80;
            const response = await fetch(`${protocol}//${serverIp}:${port}/api/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Login failed.');
            }

            // 3. Save session state to our app context
            setLoginState(data);
        } catch (err) {
            console.error("Login Error:", err);

            let userFriendlyError = 'An unexpected error occurred. Please try again.';

            if (err.errors && err.errors.length > 0) {
                const clerkError = err.errors[0].code;
                if (clerkError === 'form_password_incorrect' || clerkError === 'form_identifier_not_found') {
                    userFriendlyError = 'Incorrect email or password. Please try again.';
                } else if (clerkError === 'session_exists' || err.message?.includes('already signed in')) {
                    userFriendlyError = 'A previous session was detected. Restarting app to clear it...';
                    setTimeout(async () => {
                        try { await window.Clerk?.signOut(); } catch(e) {}
                        window.location.reload();
                    }, 1500);
                } else {
                    userFriendlyError = err.errors[0].longMessage || err.message;
                }
            } else if (err.message?.includes('already signed in')) {
                userFriendlyError = 'A previous session was detected. Restarting app to clear it...';
                setTimeout(async () => {
                    try { await window.Clerk?.signOut(); } catch(e) {}
                    window.location.reload();
                }, 1500);
            } else if (err.name === 'AbortError') {
                userFriendlyError = `Connection timeout to server at ${serverIp}:80. Server may be offline or unreachable.`;
            } else if (err.message?.includes('Failed to fetch')) {
                userFriendlyError = `Cannot reach server at ${serverIp}:80. Check IP address, server status, and network connection.`;
            } else if (err.message) {
                userFriendlyError = err.message;
            }

            showToast(userFriendlyError, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        if (!navigator.onLine) {
            showToast('No internet connection. Please check your network and try again.', 'error');
            return;
        }

        if (!isLoaded) return;

        try {
            await setActive({ session: null });
            await signIn.authenticateWithRedirect({
                strategy: 'oauth_google',
                redirectUrl: '/login',
                redirectUrlComplete: '/login'
            });
        } catch (err) {
            console.error("Google Login Error:", err);
            showToast(err.message || 'An unexpected error occurred during Google Sign-In.', 'error');
        }
    };





    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 transition-colors duration-300">
            <div className="w-full max-w-md p-8 space-y-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg">
                <div className="relative text-center">
                    <div className="absolute top-0 right-0 flex items-center gap-x-1">

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
                                    The PSA Kalinga HireTrack System streamlines personnel management for Contract of Service Workers (COSWs). It centralizes monitoring, automates employment and training certificates, and features a performance evaluation tool. Supervisor ratings are used as a reference for future hiring, ensuring a fair, transparent, and efficient system that reduces paperwork and speeds up hiring for field surveys.
                                </p>
                                <hr className="my-1 border-gray-300 dark:border-gray-600" />
                                <p>TechCraft by Chano</p>
                            </div>
                        </div>
                    </div>
                    <img src={PSALogo} alt="PSA Logo" className="w-16 h-16 mx-auto" />
                    <h2 className="mt-6 text-3xl font-bold text-gray-900 dark:text-white">PSA KALINGA <br /> HireTrack System</h2>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Please sign in to continue</p>
                </div>

                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    <ToastContainer toasts={toasts} onClose={removeToast} />
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
                                onChange={(e) => { setEmail(e.target.value); }}
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
                                onChange={(e) => { setPassword(e.target.value); }}
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

                    <div>
                        <button type="submit" disabled={isLoading} title={isLoading ? 'Signing in...' : 'Sign in to account'} className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
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
                            title={isLoading ? 'Signing in...' : 'Sign in with Google'}
                        >
                            <FaGoogle className="w-5 h-5 text-red-500" />
                            <span>Sign in with Google</span>
                        </button>
                    </div>
                </form>
            </div>


        </div>
    );
};

export default LoginPage;

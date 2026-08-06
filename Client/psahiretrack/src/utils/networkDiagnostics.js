/**
 * Network Diagnostics Utilities
 * Helps diagnose internet and server connectivity issues
 */

/**
 * Check if the device has internet connectivity
 * @returns {Promise<{hasInternet: boolean, error?: string}>}
 */
export const checkInternetConnectivity = async () => {
    try {
        // Try to fetch from a reliable public endpoint
        const response = await fetch('https://www.google.com/generate_204', {
            method: 'HEAD',
            mode: 'no-cors',
            signal: AbortSignal.timeout(3000)
        });
        return { hasInternet: true };
    } catch (err) {
        return { 
            hasInternet: false, 
            error: 'No internet connectivity detected' 
        };
    }
};

/**
 * Check if the server is reachable
 * @param {string} serverIp - Server IP address
 * @param {number} port - Server port (default: 80)
 * @returns {Promise<{reachable: boolean, statusCode?: number, error?: string, errorType?: string}>}
 */
export const checkServerReachability = async (serverIp, port = 80) => {
    const url = `http://${serverIp}:${port}/api/health`;
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
        });
        
        return { 
            reachable: true, 
            statusCode: response.status,
            message: 'Server is reachable'
        };
    } catch (err) {
        let errorType = 'UNKNOWN';
        let errorMessage = 'Server connection failed';
        
        if (err.name === 'AbortError') {
            errorType = 'TIMEOUT';
            errorMessage = `Connection timeout to ${serverIp}:${port}. Server may be offline or responding slowly.`;
        } else if (err.message.includes('Failed to fetch')) {
            // This is a browser CORS or network error
            errorType = 'FETCH_ERROR';
            errorMessage = `Cannot reach server at ${serverIp}:${port}. DNS resolution or network connectivity issue.`;
        } else if (err.message.includes('NetworkError')) {
            errorType = 'NETWORK_ERROR';
            errorMessage = `Network error connecting to ${serverIp}:${port}. Check your connection.`;
        }
        
        return { 
            reachable: false, 
            error: errorMessage,
            errorType,
            errorDetails: err.message
        };
    }
};

/**
 * Perform full network diagnosis
 * @param {string} serverIp - Server IP address
 * @param {number} serverPort - Server port (default: 80)
 * @returns {Promise<{summary: string, details: object}>}
 */
export const performNetworkDiagnostics = async (serverIp, serverPort = 80) => {
    const results = {
        timestamp: new Date().toISOString(),
        serverIp,
        serverPort,
        tests: {}
    };
    
    // Test 1: Internet Connectivity
    const internetTest = await checkInternetConnectivity();
    results.tests.internet = {
        name: 'Internet Connectivity',
        passed: internetTest.hasInternet,
        message: internetTest.hasInternet ? 'Device has internet access' : internetTest.error
    };
    
    // Test 2: Server Reachability
    const serverTest = await checkServerReachability(serverIp, serverPort);
    results.tests.server = {
        name: 'Server Reachability',
        passed: serverTest.reachable,
        message: serverTest.error || serverTest.message,
        statusCode: serverTest.statusCode,
        errorType: serverTest.errorType
    };
    
    // Generate summary
    let summary = 'Network Diagnosis Results:\n';
    
    if (results.tests.internet.passed && results.tests.server.passed) {
        summary += '✓ All systems operational\n';
    } else if (!results.tests.internet.passed) {
        summary += '✗ No internet connectivity\n';
        summary += '  - Check your network connection\n';
        summary += '  - Try connecting to WiFi or mobile hotspot\n';
    } else if (!results.tests.server.passed) {
        summary += `✗ Cannot reach server at ${serverIp}:${serverPort}\n`;
        summary += '  - Check the Server IP Address in Settings\n';
        summary += '  - Ensure the server is running\n';
        summary += `  - Error: ${results.tests.server.errorType}\n`;
    }
    
    results.summary = summary;
    return results;
};

/**
 * Get human-readable error description
 * @param {string} errorCode - Error code from server
 * @param {string} serverIp - Server IP for context
 * @returns {string} - User-friendly error description
 */
export const getErrorDescription = (errorCode, serverIp) => {
    const descriptions = {
        DNS_FAILED: `Cannot resolve server address '${serverIp}'. Check if the IP address is correct.`,
        CONNECTION_REFUSED: `Server at ${serverIp}:80 is not accepting connections. Server may be offline.`,
        TIMEOUT: `Server at ${serverIp}:80 is not responding (timeout). Network may be slow or server is busy.`,
        HOST_UNREACHABLE: `Host ${serverIp} is unreachable. Check your network connection and IP address.`,
        NETWORK_UNREACHABLE: 'Your network is unreachable. Check your internet connection.',
        REQUEST_TIMEOUT: `Request to server ${serverIp}:80 timed out. Server is not responding.`,
        CONNECTION_ERROR: `Connection to server ${serverIp}:80 failed. Check IP address and server status.`,
        UNKNOWN: 'An unknown connection error occurred. Check your network and server settings.'
    };
    
    return descriptions[errorCode] || descriptions.UNKNOWN;
};

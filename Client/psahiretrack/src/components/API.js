// src/components/API.js

const API_PORT = 3001;

export const apiFetch = async (endpoint, serverIp, options = {}) => {
  if (!serverIp) {
    throw new Error("Server IP has not been configured or provided.");
  }
  
  const session = await window.electronAPI.getLoginState();
  const token = session?.token;
  
  const url = `http://${serverIp}:${API_PORT}/api/${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, { ...options, headers });

    // --- HANDLE ALL NON-OK RESPONSES (4xx, 5xx) ---
    if (!response.ok) {
      // Special-case: if the survey criteria endpoint returns 404, treat as empty result
      if (response.status === 404 && endpoint.includes('/rating-criteria')) {
        return {};
      }

      // Handle session expired as a special case
      if (response.status === 401) {
        await window.electronAPI.handleSessionExpired();
      }

      let errorData = {};
      try {
        // Try to get the detailed error message from the JSON body
        errorData = await response.json();
      } catch (e) {
        // If the body isn't JSON, use the status text as a fallback
        throw new Error(response.statusText || `HTTP Error ${response.status}`);
      }
      
      // ✅ LOOK FOR 'error' FIRST, then 'message', then fallback.
      // This directly fixes your problem.
      const thrownError = new Error(errorData.error || errorData.message || `HTTP Error ${response.status}`);
      thrownError.data = errorData; // attach full payload so callers can inspect errors/warnings arrays
      throw thrownError;
    }

    // --- HANDLE SUCCESSFUL RESPONSES ---

    // Handle '204 No Content' success case (e.g., after a DELETE)
    if (response.status === 204) {
      return null;
    }

    // For all other successful responses (200, 201), return the JSON body
    return response.json();

  } catch (error) {
    console.error(`API fetch to '${endpoint}' failed:`, error.message);
    // Re-throw the error so the calling component can handle it
    throw error;
  }
};
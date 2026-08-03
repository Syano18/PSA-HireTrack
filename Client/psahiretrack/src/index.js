import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './PSAHireTrack';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext'; // ✅ Import ThemeProvider
import { ClerkProvider } from '@clerk/clerk-react';

// Import your publishable key
const PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  console.error("Missing Publishable Key");
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <ThemeProvider> {/* ✅ Wrap everything with ThemeProvider */}
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </ClerkProvider>
  </React.StrictMode>
);
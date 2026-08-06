import React, { createContext, useState, useContext, useEffect } from 'react';

const SettingsContext = createContext();

export const SettingsProvider = ({ children }) => {
  const [serverIp, setServerIp] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadInitialIp = async () => {
      try {
        const savedIp = localStorage.getItem('serverIp');
        const defaultIp = window.location.hostname || '127.0.0.1';
        setServerIp(savedIp || defaultIp);
      } catch (error) {
        console.error('Failed to load server IP:', error);
        setServerIp(window.location.hostname || '127.0.0.1');
      } finally {
        setIsLoading(false);
      }
    };
    loadInitialIp();
  }, []);

  const updateServerIp = async (newIp) => {
    localStorage.setItem('serverIp', newIp);
    setServerIp(newIp);
  };

  const value = { serverIp, updateServerIp, isLoading };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  return useContext(SettingsContext);
};

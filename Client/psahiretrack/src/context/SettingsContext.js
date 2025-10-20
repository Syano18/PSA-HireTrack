import React, { createContext, useState, useContext, useEffect } from 'react';

const SettingsContext = createContext();

export const SettingsProvider = ({ children }) => {
  const [serverIp, setServerIp] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadInitialIp = async () => {
      try {
        const savedIp = await window.electronAPI.getServerIp();
        setServerIp(savedIp || '127.0.0.1');
      } catch (error) {
        console.error('Failed to load server IP:', error);
        setServerIp('127.0.0.1');
      } finally {
        setIsLoading(false);
      }
    };
    loadInitialIp();
  }, []);

  const updateServerIp = async (newIp) => {
    await window.electronAPI.setServerIp(newIp);
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
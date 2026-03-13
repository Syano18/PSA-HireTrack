import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import ManageTrainings from '../components/ManageTrainings';
import ManagePositions from '../components/ManagePositions';
import ManageEmployments from '../components/ManageEmployments';
import BackRes from '../components/BackRes';

const Utilities = () => {
    const location = useLocation();
    const [sessionState, setSessionState] = useState(null);
    const [activeTab, setActiveTab] = useState('trainings');

    useEffect(() => {
        const getSession = async () => {
            const state = await window.electronAPI.getLoginState();
            setSessionState(state);
        };
        getSession();
    }, []);

    // Set active tab from navigation state if available
    useEffect(() => {
        if (location.state && location.state.activeTab) {
            setActiveTab(location.state.activeTab);
        }
    }, [location.state]);

    const TabButton = ({ tabName, label }) => {
        const isActive = activeTab === tabName;
        const baseClasses = "px-4 py-3 text-base font-semibold border-b-2 transition-colors duration-200 focus:outline-none";
        const activeClasses = "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400";
        const inactiveClasses = "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600";

        return (
            <button
                onClick={() => setActiveTab(tabName)}
                className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses}`}
            >
                {label}
            </button>
        );
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'trainings':
            case 'manageTraining': // Handling both potential names
                return <ManageTrainings session={sessionState} />;
            case 'positions':
                return <ManagePositions session={sessionState} />;
            case 'survey':
                return <ManageEmployments session={sessionState} />;
            case 'backres':
                return <BackRes session={sessionState} />;
            default:
                return <ManageTrainings session={sessionState} />;
        }
    };

    if (!sessionState) {
        return <div className="p-8 text-center">Loading user session...</div>;
    }

    return (
        <div>
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-6">System Utilities</h1>
            
            {/* --- MODIFIED: The tab navigation container --- */}
            <div className="border-b border-gray-200 dark:border-gray-700">
                <TabButton tabName="trainings" label="Training Titles" />
                <TabButton tabName="positions" label="Positions" />
                <TabButton tabName="survey" label="Survey/Census" />
                <TabButton tabName="backres" label="Backup and Restore" />
                {/* Add more TabButtons here for future utilities */}
            </div>

            {/* Content for the active tab is rendered below the menu */}
            <div className="mt-6">
                {renderTabContent()}
            </div>
        </div>
    );
};

export default Utilities;
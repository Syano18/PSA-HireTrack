import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { FiBook, FiBriefcase, FiClipboard, FiDatabase } from 'react-icons/fi';
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
            const state = (JSON.parse(localStorage.getItem('loginState')) || null);
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

    const TabButton = ({ tabName, label, icon: Icon }) => {
        const isActive = activeTab === tabName;

        return (
            <button
                onClick={() => setActiveTab(tabName)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
            >
                {Icon && <Icon className="w-4 h-4" />}
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
        <div className="flex-1 w-full flex flex-col min-h-0">
            {/* Header and Tabs */}
            <div className="mb-6 flex flex-col gap-4 flex-shrink-0">
                <h1 className="text-3xl font-bold text-gray-800 dark:text-white">System Utilities</h1>
                
                <div className="inline-flex flex-wrap bg-gray-100 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 rounded-lg p-1 self-start gap-1">
                    <TabButton tabName="trainings" label="Training Titles" icon={FiBook} />
                    <TabButton tabName="positions" label="Positions" icon={FiBriefcase} />
                    <TabButton tabName="survey" label="Survey/Census" icon={FiClipboard} />
                    <TabButton tabName="backres" label="Backup and Restore" icon={FiDatabase} />
                </div>
            </div>

            {/* Content for the active tab is rendered below the menu */}
            <div className="flex-1 flex flex-col min-h-0">
                {renderTabContent()}
            </div>
        </div>
    );
};

export default Utilities;

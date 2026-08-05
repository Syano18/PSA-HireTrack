import React from 'react';
import { useUser } from '@clerk/clerk-react';

const Header = ({ onLogout, user }) => {
    const { user: clerkUser } = useUser();

    return (
        <header className="bg-white dark:bg-gray-800 sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700">
            <div className="px-6">
                <div className="flex items-center justify-end h-14">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">
                            Hello, {user?.first_name || 'User'}
                        </h2>
                        {clerkUser?.imageUrl ? (
                            <img 
                                src={clerkUser.imageUrl} 
                                alt="Profile" 
                                className="w-8 h-8 rounded-full object-cover border border-gray-300 dark:border-gray-600 shadow-sm"
                            />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    {user?.first_name?.charAt(0) || 'U'}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Header;
import React from 'react';
import PSALogo from '../assets/logo.png';

const Header = ({ onLogout, user }) => (
    <header className="bg-white dark:bg-gray-800 sticky top-0 z-10">
        <div className="px-2">
            <div className="flex items-center justify-between h-12">
				<div className="flex items-center"> 
                    <img src={PSALogo} alt="PSA Logo" className="h-8 w-8"/>
                    <h1 className="ml-3 text-xl font-bold text-gray-900 dark:text-white">Philippine Statistics Authority</h1>
                </div>
                <div>
                    <h2 className="mr-3 text-lg font-bold text-gray-900 dark:text-white">Hello, {user.first_name}</h2>
                </div>
            </div>
        </div>
    </header>
);

export default Header;
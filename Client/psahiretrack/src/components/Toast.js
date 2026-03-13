import React, { useEffect } from 'react';
import { FiCheckCircle, FiAlertCircle, FiX, FiInfo } from 'react-icons/fi';

const Toast = ({ id, type, message, onClose, duration = 3000 }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, duration);
    return () => clearTimeout(timer);
  }, [id, onClose, duration]);

  const colors = {
    success: 'bg-green-200 border-green-300 dark:bg-green-800 dark:border-green-900',
    error: 'bg-red-200 border-red-300 dark:bg-red-900 dark:border-red-800',
    warning: 'bg-yellow-200 border-yellow-300 dark:bg-yellow-800 dark:border-yellow-900',
    info: 'bg-blue-200 border-blue-300 dark:bg-blue-800 dark:border-blue-900'
  };

  const textColors = {
    success: 'text-green-800 dark:text-green-300',
    error: 'text-red-800 dark:text-red-300',
    warning: 'text-yellow-800 dark:text-yellow-300',
    info: 'text-blue-800 dark:text-blue-300'
  };

  const icons = {
    success: <FiCheckCircle className="w-5 h-5" />,
    error: <FiAlertCircle className="w-5 h-5" />,
    warning: <FiAlertCircle className="w-5 h-5" />,
    info: <FiInfo className="w-5 h-5" />
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${colors[type]} ${textColors[type]} shadow-lg`}>
      <span className="flex-shrink-0">{icons[type]}</span>
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        onClick={() => onClose(id)}
        className="flex-shrink-0 hover:opacity-70 transition-opacity"
      >
        <FiX className="w-5 h-5" />
      </button>
    </div>
  );
};

export default Toast;

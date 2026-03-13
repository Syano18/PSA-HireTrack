import React, { useEffect } from 'react';

const ProgressModal = ({ isOpen, onClose, progress, statusMessage, isComplete, filePath }) => {
  // Auto-close the modal after 2 seconds when complete
  useEffect(() => {
    if (isComplete && isOpen) {
      const timer = setTimeout(() => {
        onClose();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isComplete, isOpen, onClose]);

  if (!isOpen) return null;

  // Function to handle opening the file
  const handleOpenFile = () => {
    if (filePath) {
      window.electronAPI.openFile(filePath);
    }
    onClose(); // Also close the modal after opening
  };

  return (
    // Modal Overlay
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black bg-opacity-70">
      <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl dark:bg-gray-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {isComplete ? 'Download Status' : 'Processing Request'}
        </h3>
        
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 min-h-[40px]">
          {statusMessage}
        </p>

        {/* Conditionally render progress bar or nothing */}
        {isComplete && (
          <div className="flex justify-end gap-3 mt-5">
            {/* "Close" Button */}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600"
            >
              Close
            </button>
            
            {/* "Open File" Button */}
            {filePath && (
              <button
                onClick={handleOpenFile}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Open File
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProgressModal;
import React from 'react';
import Toast from './Toast';

const ToastContainer = ({ toasts, onClose }) => {
  return (
    <div className="fixed top-4 right-4 z-[200] space-y-2 max-w-md">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          type={toast.type}
          message={toast.message}
          onClose={onClose}
          duration={toast.duration || 3000}
        />
      ))}
    </div>
  );
};

export default ToastContainer;

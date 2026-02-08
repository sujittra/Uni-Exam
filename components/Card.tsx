import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  action?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ children, className = '', title, action }) => {
  return (
    <div className={`bg-white rounded-xl shadow-lg border border-purple-100 overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="px-6 py-4 border-b border-purple-50 flex justify-between items-center bg-purple-50/30">
          {title && <h3 className="text-lg font-bold text-purple-900">{title}</h3>}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-6">
        {children}
      </div>
    </div>
  );
};
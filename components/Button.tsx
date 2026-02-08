import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  ...props 
}) => {
  const baseStyle = "font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-1";
  
  const variants = {
    primary: "bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-200 focus:ring-purple-500",
    secondary: "bg-purple-100 hover:bg-purple-200 text-purple-800 focus:ring-purple-300",
    danger: "bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-200 focus:ring-red-500",
    outline: "border-2 border-purple-200 hover:border-purple-600 text-purple-600 hover:bg-purple-50 focus:ring-purple-400"
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-5 py-2.5 text-base",
    lg: "px-6 py-3 text-lg"
  };

  return (
    <button 
      className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className} disabled:opacity-50 disabled:cursor-not-allowed`}
      {...props}
    >
      {children}
    </button>
  );
};
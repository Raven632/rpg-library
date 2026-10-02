import React from 'react';

const Toast = ({ message, type, visible }) => {
  // CSS-классы уже есть в твоем style.css (toast, show, success, error)
  return (
    <div className={`toast ${type} ${visible ? 'show' : ''}`}>
      {message}
    </div>
  );
};

export default Toast;

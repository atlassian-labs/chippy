import React from 'react';

export function HelloButton({ label = 'Hello words', onClick, ...props }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: '1px solid #111827',
        borderRadius: 20,
        padding: '0.75rem 1rem',
        background: '#111827',
        color: '#ffffff',
        fontSize: '1rem',
        cursor: 'pointer',
      }}
      {...props}
    >
      {label}
    </button>
  );
}

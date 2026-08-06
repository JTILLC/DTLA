import React from 'react';

// Wrap occurrences of `searchTerm` inside `text` in a <mark> highlight.
export default function HighlightText({ text, searchTerm }) {
  if (!searchTerm || !text) return <>{text}</>;

  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.toString().split(regex);

  return (
    <>
      {parts.map((part, index) =>
        regex.test(part) ? (
          <mark key={index} style={{
            backgroundColor: '#fef08a',
            padding: '1px 2px',
            borderRadius: '2px',
            fontWeight: '600'
          }}>
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

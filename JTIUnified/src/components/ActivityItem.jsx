import React from 'react';
import { ExternalLink } from 'lucide-react';

  const ActivityItem = ({ item, colors }) => {
    const typeColors = {
      job: '#3b82f6',
      downtime: '#ef4444',
      timesheet: '#10b981',
      issue: '#f59e0b'
    };

    return (
      <div
        onClick={() => item.url && window.open(item.url, '_blank')}
        style={{
          display: 'flex',
          gap: '12px',
          borderBottom: `1px solid ${colors?.border || '#f3f4f6'}`,
          cursor: item.url ? 'pointer' : 'default',
          transition: 'background 0.2s',
          margin: '0 -8px',
          padding: '12px 8px',
          borderRadius: '6px'
        }}
        onMouseEnter={(e) => {
          if (item.url) e.currentTarget.style.background = colors?.hover || '#f9fafb';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: typeColors[item.type],
          marginTop: '6px',
          flexShrink: 0
        }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', color: colors?.text || '#111827', marginBottom: '4px' }}>
            {item.message}
          </div>
          <div style={{ fontSize: '12px', color: colors?.textSecondary || '#9ca3af' }}>
            {item.time}
          </div>
        </div>
        {item.url && (
          <ExternalLink size={14} style={{ color: colors?.textSecondary || '#9ca3af', marginTop: '4px' }} />
        )}
      </div>
    );
  };

export default ActivityItem;

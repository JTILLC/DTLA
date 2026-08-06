import React from 'react';
import { ExternalLink } from 'lucide-react';

  const AppCard = ({ app, colors }) => (
    <div style={{
      background: colors.cardBg,
      borderRadius: '12px',
      padding: '24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      cursor: 'pointer',
      transition: 'all 0.2s',
      border: '2px solid transparent'
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      e.currentTarget.style.borderColor = app.color;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      e.currentTarget.style.borderColor = 'transparent';
    }}
    onClick={() => window.open(app.url, '_blank')}>
      <div style={{ display: 'flex', alignItems: 'start', gap: '16px' }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '12px',
          background: `${app.color}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: app.color,
          flexShrink: 0
        }}>
          {app.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: colors.text }}>
              {app.name}
            </h3>
            <ExternalLink size={16} style={{ color: colors.textSecondary }} />
          </div>
          <p style={{ fontSize: '14px', color: colors.textSecondary, lineHeight: '1.5' }}>
            {app.description}
          </p>
        </div>
      </div>
    </div>
  );

export default AppCard;

import React from 'react';
import { TrendingUp } from 'lucide-react';

  const StatCard = ({ icon, title, value, color, trend, onClick, colors }) => (
    <div
      onClick={onClick}
      style={{
        background: colors.cardBg,
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.2s, box-shadow 0.2s'
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '10px',
          background: `${color}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: color
        }}>
          {icon}
        </div>
        {trend && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: trend > 0 ? '#10b981' : '#ef4444',
            fontSize: '14px',
            fontWeight: '500'
          }}>
            <TrendingUp size={16} style={{ transform: trend < 0 ? 'rotate(180deg)' : 'none' }} />
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div>
        <div style={{ fontSize: '14px', color: colors.textSecondary, marginBottom: '4px' }}>{title}</div>
        <div style={{ fontSize: '28px', fontWeight: '700', color: colors.text }}>{value}</div>
      </div>
    </div>
  );

export default StatCard;

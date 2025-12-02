// Offline Status Indicator Component
import React, { useState, useEffect } from 'react';
import syncManager from '../utils/syncManager';
import offlineQueue from '../utils/offlineQueue';

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState({ syncing: false, error: null });

  useEffect(() => {
    // Update online status
    const handleOnline = () => {
      console.log('[OfflineIndicator] Connection restored');
      setIsOnline(true);
      // Trigger sync when back online
      setTimeout(() => syncManager.syncAll(), 1000);
    };

    const handleOffline = () => {
      console.log('[OfflineIndicator] Connection lost');
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listen for sync status changes
    syncManager.onSyncStatusChange((status) => {
      setSyncStatus(status);
      updateQueueCount();
    });

    // Update queue count periodically
    const interval = setInterval(updateQueueCount, 2000);
    updateQueueCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const updateQueueCount = async () => {
    try {
      const count = await offlineQueue.getCount();
      setQueueCount(count);
    } catch (error) {
      console.error('[OfflineIndicator] Error getting queue count:', error);
    }
  };

  const handleManualSync = async () => {
    if (isOnline && queueCount > 0) {
      await syncManager.syncAll();
    }
  };

  if (isOnline && queueCount === 0 && !syncStatus.syncing) {
    return null; // Hide when online and no queue
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '60px',
        right: '10px',
        zIndex: 1040,
        maxWidth: '300px'
      }}
    >
      {!isOnline && (
        <div
          className="alert alert-warning d-flex align-items-center"
          style={{
            padding: '10px 15px',
            marginBottom: '8px',
            fontSize: '14px'
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ marginRight: '8px', flexShrink: 0 }}
          >
            <path d="M1 1l6 6m0 0l6 6m-6-6l6-6m-6 6l-6 6" />
          </svg>
          <span>
            <strong>Offline Mode</strong>
            <br />
            Changes will sync when online
          </span>
        </div>
      )}

      {queueCount > 0 && (
        <div
          className={`alert ${isOnline ? 'alert-info' : 'alert-secondary'} d-flex align-items-center justify-content-between`}
          style={{
            padding: '10px 15px',
            fontSize: '14px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            {syncStatus.syncing ? (
              <>
                <div
                  className="spinner-border spinner-border-sm"
                  role="status"
                  style={{ marginRight: '8px' }}
                >
                  <span className="visually-hidden">Syncing...</span>
                </div>
                <span>Syncing {queueCount} change{queueCount !== 1 ? 's' : ''}...</span>
              </>
            ) : (
              <>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ marginRight: '8px', flexShrink: 0 }}
                >
                  <path d="M12 2v20M17 7l-5-5-5 5" />
                </svg>
                <span>{queueCount} change{queueCount !== 1 ? 's' : ''} pending</span>
              </>
            )}
          </div>
          {isOnline && !syncStatus.syncing && (
            <button
              onClick={handleManualSync}
              className="btn btn-sm btn-primary"
              style={{ marginLeft: '10px', padding: '4px 8px', fontSize: '12px' }}
            >
              Sync Now
            </button>
          )}
        </div>
      )}

      {syncStatus.error && (
        <div
          className="alert alert-danger"
          style={{
            padding: '10px 15px',
            fontSize: '14px',
            marginTop: '8px'
          }}
        >
          <strong>Sync Error:</strong> {syncStatus.error}
        </div>
      )}
    </div>
  );
}

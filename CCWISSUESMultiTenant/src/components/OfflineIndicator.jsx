// Offline status indicator.
//
// Firestore's own persistence handles offline DATA writes and replays them on
// reconnect, so there's no queue for this component to manage. Firebase Storage
// has no equivalent, so photos taken without signal are parked in IndexedDB by
// photoQueue and uploaded by photoSync — `pendingPhotos` is that backlog, shown
// here so a tech never walks away believing a photo reached the cloud when it's
// still only on the phone.
import { useState, useEffect } from 'react';

export default function OfflineIndicator({ pendingPhotos = 0 }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (isOnline && pendingPhotos === 0) return null;

  const photoLine =
    pendingPhotos > 0
      ? `${pendingPhotos} photo${pendingPhotos === 1 ? '' : 's'} waiting to upload`
      : null;

  return (
    <div style={{ position: 'fixed', top: '60px', right: '10px', zIndex: 1040, maxWidth: '300px' }}>
      <div
        className={`alert ${isOnline ? 'alert-info' : 'alert-warning'} d-flex align-items-center`}
        style={{ padding: '10px 15px', fontSize: '14px' }}
      >
        <span>
          {!isOnline ? (
            <>
              <strong>Offline</strong>
              <br />
              Your changes are saved on this device and sync when you&apos;re back online.
              {photoLine && (
                <>
                  <br />
                  {photoLine}.
                </>
              )}
            </>
          ) : (
            <>
              <strong>Uploading photos</strong>
              <br />
              {photoLine} — keep the app open until this clears.
            </>
          )}
        </span>
      </div>
    </div>
  );
}

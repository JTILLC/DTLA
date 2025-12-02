# Offline Support for CCW Issues App

## Overview
The CCW Issues App now supports full offline functionality. You can:
- Launch it as a webapp on iOS
- Use it without internet connection
- Make changes while offline
- Automatically sync when connection is restored

## How It Works

### 1. **Service Worker** (`/public/service-worker.js`)
- Caches app files for offline loading
- Allows the app to load even without internet
- Handles background sync when connection is restored

### 2. **Firestore Offline Persistence**
- Firebase automatically caches all your data locally
- Reads work offline using cached data
- Writes are queued and automatically synced when back online
- No manual intervention needed!

### 3. **IndexedDB Queue** (`/src/utils/offlineQueue.js`)
- Backup queue for operations if needed
- Stores operation history
- Can be used for custom offline operations

### 4. **Sync Manager** (`/src/utils/syncManager.js`)
- Processes queued operations when back online
- Retries failed operations
- Provides sync status updates

### 5. **Offline Indicator** (`/src/components/OfflineIndicator.jsx`)
- Shows "Offline Mode" banner when no connection
- Displays pending changes count
- Provides manual "Sync Now" button
- Shows sync progress and errors

## Using the App Offline

### iOS Installation:
1. Open the app in Safari
2. Tap the Share button
3. Select "Add to Home Screen"
4. The app will now work offline!

### When Offline:
1. You'll see an "Offline Mode" warning banner at the top
2. Continue using the app normally:
   - View customers and visits (cached data)
   - Create new visits
   - Update head statuses
   - Add notes
3. All changes are queued locally

### When Back Online:
1. The app automatically detects connection
2. Queued changes sync automatically
3. Or click "Sync Now" to manually trigger sync
4. Success message shows when complete

## Technical Details

### Firestore Persistence
```javascript
firebase.firestore().enablePersistence({ synchronizeTabs: true })
```
- Enables local caching and offline writes
- Works across multiple tabs
- Automatically syncs when online

### Service Worker Registration
```javascript
navigator.serviceWorker.register('/service-worker.js')
```
- Registered on app load
- Caches essential app files
- Intercepts network requests

### Online/Offline Detection
```javascript
window.addEventListener('online', handleOnline);
window.addEventListener('offline', handleOffline);
```
- Listens for connection changes
- Triggers auto-sync when back online
- Updates UI indicator

## Troubleshooting

### App won't load offline
- Make sure you visited the app while online first
- Service worker needs to cache files on first visit
- Try closing and reopening the app

### Changes not syncing
- Check the offline indicator for error messages
- Click "Sync Now" to manually trigger sync
- Check browser console for error details

### Multiple tabs open
- Firestore persistence works best with single tab
- If you see warnings, close other tabs

## Browser Support

**Full Support:**
- Safari (iOS)
- Chrome (Desktop & Mobile)
- Firefox (Desktop & Mobile)
- Edge

**Partial Support:**
- Older browsers may not support service workers
- App will still work but won't cache for offline use

## Developer Notes

### Adding New Offline Operations
If you need custom offline operations beyond Firestore:

```javascript
import offlineQueue from './utils/offlineQueue';

// Queue an operation
await offlineQueue.addOperation({
  type: 'CUSTOM_OPERATION',
  data: { /* your data */ }
});

// Process in syncManager.js
case 'CUSTOM_OPERATION':
  // Handle your operation
  break;
```

### Testing Offline Mode
1. Open browser DevTools
2. Go to Network tab
3. Select "Offline" from throttling dropdown
4. Test app functionality

### Clearing Offline Data
```javascript
// Clear IndexedDB queue
await offlineQueue.clearAll();

// Clear Firestore cache
await firebase.firestore().clearPersistence();
```

## Future Enhancements

- Background sync for better iOS support
- Conflict resolution for simultaneous edits
- Offline data export/backup
- Custom sync schedules

// Sync Manager for processing offline queue
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import offlineQueue from './offlineQueue';

class SyncManager {
  constructor() {
    this.isSyncing = false;
    this.syncCallbacks = [];
  }

  // Register callback for sync status updates
  onSyncStatusChange(callback) {
    this.syncCallbacks.push(callback);
  }

  // Notify all listeners
  notifyListeners(status) {
    this.syncCallbacks.forEach(cb => cb(status));
  }

  // Process all queued operations
  async syncAll() {
    if (this.isSyncing) {
      console.log('[SyncManager] Sync already in progress');
      return;
    }

    this.isSyncing = true;
    this.notifyListeners({ syncing: true, error: null });

    try {
      const operations = await offlineQueue.getAllOperations();
      console.log(`[SyncManager] Processing ${operations.length} queued operations`);

      if (operations.length === 0) {
        this.isSyncing = false;
        this.notifyListeners({ syncing: false, error: null, completed: 0 });
        return;
      }

      let completed = 0;
      let failed = 0;

      for (const operation of operations) {
        try {
          await this.processOperation(operation);
          await offlineQueue.removeOperation(operation.id);
          completed++;
          console.log(`[SyncManager] Processed operation ${completed}/${operations.length}`);
        } catch (error) {
          console.error('[SyncManager] Failed to process operation:', error);
          failed++;
          // Keep failed operations in queue for retry
        }
      }

      this.isSyncing = false;
      this.notifyListeners({
        syncing: false,
        error: failed > 0 ? `${failed} operations failed` : null,
        completed
      });

      console.log(`[SyncManager] Sync complete: ${completed} succeeded, ${failed} failed`);
    } catch (error) {
      console.error('[SyncManager] Sync error:', error);
      this.isSyncing = false;
      this.notifyListeners({ syncing: false, error: error.message });
    }
  }

  // Process a single operation
  async processOperation(operation) {
    const { type, data } = operation;
    const db = firebase.firestore();

    switch (type) {
      case 'CREATE_VISIT':
        await db.collection('user_files')
          .doc(data.userId)
          .collection('customers')
          .doc(data.customerId)
          .collection('visits')
          .doc(data.visitId)
          .set(data.visitData);
        break;

      case 'UPDATE_VISIT':
        await db.collection('user_files')
          .doc(data.userId)
          .collection('customers')
          .doc(data.customerId)
          .collection('visits')
          .doc(data.visitId)
          .update(data.updates);
        break;

      case 'DELETE_VISIT':
        await db.collection('user_files')
          .doc(data.userId)
          .collection('customers')
          .doc(data.customerId)
          .collection('visits')
          .doc(data.visitId)
          .delete();
        break;

      case 'CREATE_CUSTOMER':
        await db.collection('user_files')
          .doc(data.userId)
          .collection('customers')
          .doc(data.customerId)
          .set(data.customerData);
        break;

      case 'UPDATE_CUSTOMER':
        await db.collection('user_files')
          .doc(data.userId)
          .collection('customers')
          .doc(data.customerId)
          .update(data.updates);
        break;

      case 'DELETE_CUSTOMER':
        await db.collection('user_files')
          .doc(data.userId)
          .collection('customers')
          .doc(data.customerId)
          .delete();
        break;

      default:
        console.warn('[SyncManager] Unknown operation type:', type);
    }
  }
}

// Singleton instance
const syncManager = new SyncManager();
export default syncManager;

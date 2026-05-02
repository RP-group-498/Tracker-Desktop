import Store from 'electron-store';
import { PythonBridge } from './python-bridge';
import { EventEmitter } from 'events';

interface OfflineStoreSchema {
    pendingEvents: any[];
}

export class ActivitySyncService extends EventEmitter {
    private store: Store<OfflineStoreSchema>;
    private pythonBridge: PythonBridge;
    private isSyncing = false;
    private syncInterval: NodeJS.Timeout | null = null;
    private readonly SYNC_PERIOD = 30000; // Try to sync every 30 seconds

    constructor(pythonBridge: PythonBridge) {
        super();
        this.pythonBridge = pythonBridge;
        this.store = new Store<OfflineStoreSchema>({
            name: 'activity-offline-store',
            defaults: {
                pendingEvents: []
            }
        });

        console.log(`[ActivitySync] Initialized. Pending events: ${this.getPendingCount()}`);
    }

    /**
     * Start the background sync timer
     */
    start(): void {
        if (this.syncInterval) return;
        
        // Initial sync attempt after 5 seconds
        setTimeout(() => this.syncPendingEvents(), 5000);
        
        this.syncInterval = setInterval(() => {
            this.syncPendingEvents();
        }, this.SYNC_PERIOD);
        
        console.log('[ActivitySync] Background sync started');
    }

    /**
     * Stop the background sync timer
     */
    stop(): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    /**
     * Submit activity events. 
     * Tries to send to backend first, if fails, stores locally.
     */
    async submitActivity(events: any[]): Promise<{ success: boolean; storedLocally: boolean }> {
        if (!events || events.length === 0) return { success: true, storedLocally: false };

        try {
            const response = await this.pythonBridge.submitActivityBatch(events);
            
            if (response.success) {
                // Success! If we were offline, we might want to trigger a flush of other pending events
                if (this.getPendingCount() > 0) {
                    this.syncPendingEvents();
                }
                return { success: true, storedLocally: false };
            } else {
                console.warn(`[ActivitySync] Backend failed to process batch: ${response.error}. Storing locally.`);
                this.storeLocally(events);
                return { success: true, storedLocally: true };
            }
        } catch (error) {
            console.error('[ActivitySync] Network/Bridge error submitting activity. Storing locally.', error);
            this.storeLocally(events);
            return { success: true, storedLocally: true };
        }
    }

    /**
     * Store events in electron-store for later sync
     */
    private storeLocally(events: any[]): void {
        const pending = this.store.get('pendingEvents');
        this.store.set('pendingEvents', [...pending, ...events]);
        this.emit('offlineEventsStored', events.length);
        console.log(`[ActivitySync] Stored ${events.length} events locally. Total pending: ${this.getPendingCount()}`);
    }

    /**
     * Attempt to sync all pending events to the backend
     */
    async syncPendingEvents(): Promise<void> {
        if (this.isSyncing) return;
        
        const pending = this.store.get('pendingEvents');
        if (pending.length === 0) return;

        this.isSyncing = true;
        console.log(`[ActivitySync] Attempting to sync ${pending.length} pending events...`);

        try {
            // Send in batches of 50 to avoid huge payloads
            const batchSize = 50;
            const remaining = [...pending];
            const successfullySyncedIds: string[] = [];

            while (remaining.length > 0) {
                const batch = remaining.slice(0, batchSize);
                const response = await this.pythonBridge.submitActivityBatch(batch);

                if (response.success) {
                    // Remove these events from our local list
                    const syncedIds = (response.data as any)?.received_ids || [];
                    // If backend didn't return IDs, we assume the whole batch was processed
                    // But usually it returns received_ids.
                    
                    // For simplicity, we'll just remove the batch from the list if success
                    remaining.splice(0, batch.length);
                    console.log(`[ActivitySync] Successfully synced ${batch.length} events`);
                } else {
                    console.error(`[ActivitySync] Sync failed for batch: ${response.error}`);
                    // Stop trying this cycle if we hit an error
                    break;
                }
            }

            // Update the store with what's left
            this.store.set('pendingEvents', remaining);
            
            if (pending.length > remaining.length) {
                this.emit('syncSuccess', pending.length - remaining.length);
            }
        } catch (error) {
            console.error('[ActivitySync] Error during sync:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    getPendingCount(): number {
        return this.store.get('pendingEvents').length;
    }

    clearStorage(): void {
        this.store.set('pendingEvents', []);
        console.log('[ActivitySync] Local storage cleared');
    }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimal sync engine for POS state synchronization across tabs/windows.
 */

type Listener = () => void;

interface SyncState {
  lastSynced: string | null;
  online: boolean;
  pendingChanges: number;
}

class SyncEngine {
  private listeners: Set<Listener> = new Set();
  private syncState: SyncState = {
    lastSynced: null,
    online: true,
    pendingChanges: 0,
  };

  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  sync(): void {
    this.syncState.lastSynced = new Date().toISOString();
    this.syncState.pendingChanges = 0;
    this.notify();
  }

  markPending(): void {
    this.syncState.pendingChanges++;
    this.notify();
  }

  setOnline(online: boolean): void {
    this.syncState.online = online;
    this.notify();
  }
}

export const syncEngine = new SyncEngine();

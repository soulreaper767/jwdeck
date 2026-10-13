// Runtime sync state. A "node" is a desktop install with its own database that syncs to a hub.
export const isNode = () => process.env.JW_NODE === '1';

export const state = {
  online: false,      // hub reachable on the last attempt
  lastSync: null,     // ISO time of last successful sync
  lastError: null,
  pending: 0,         // local documents not yet accepted by the hub
  running: false,
  conflicts: 0,
};

// Desktop install that cannot reach the hub right now
export const offlineNode = () => isNode() && !state.online;

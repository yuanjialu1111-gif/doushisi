window.STANDALONE_CONFIG = {
  apiBase: location.origin,
  wsUrl: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/original',
  protocolVersion: 2,
  storageNamespace: 'doushisi-standalone-v1:'
};

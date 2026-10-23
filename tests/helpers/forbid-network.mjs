// Preload only for synthetic synchronization tests, never for browser/CDP tests.
// Fail before opening any socket, even if a test accidentally uses a real SDK.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const denied = () => {
  const error = new Error('Network access is forbidden in synthetic Lucas synchronization tests.');
  error.code = 'LUCAS_TEST_NETWORK_FORBIDDEN';
  throw error;
};
globalThis.fetch = async () => denied();
for (const module of [http, https]) {
  module.request = denied;
  module.get = denied;
}
net.connect = denied;
net.createConnection = denied;
net.Socket.prototype.connect = denied;
tls.connect = denied;
syncBuiltinESMExports();

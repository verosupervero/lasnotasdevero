import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, get as httpGet } from 'node:http';
import { request as httpsRequest, get as httpsGet } from 'node:https';
import { connect, createConnection, Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

test('synthetic synchronization suite refuses fetch and socket transports before network IO', async () => {
  const denied = { code: 'LUCAS_TEST_NETWORK_FORBIDDEN' };
  await assert.rejects(fetch('https://example.invalid/'), denied);
  for (const attempt of [
    () => httpRequest('http://example.invalid/'),
    () => httpGet('http://example.invalid/'),
    () => httpsRequest('https://example.invalid/'),
    () => httpsGet('https://example.invalid/'),
    () => connect(443, 'example.invalid'),
    () => createConnection(443, 'example.invalid'),
    () => new Socket().connect(443, 'example.invalid'),
    () => tlsConnect(443, 'example.invalid')
  ]) assert.throws(attempt, denied);
});

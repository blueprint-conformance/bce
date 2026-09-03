/**
 * Test-only Node runtime network denial. Imported before a BCE entrypoint.
 * It fails synchronously on socket, DNS, HTTP(S), or global fetch use.
 */
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

const deny = (surface) => {
  const error = new Error(`BCE_NETWORK_DENIED:${surface}`);
  error.code = 'BCE_NETWORK_DENIED';
  throw error;
};
net.connect = (..._args) => deny('net.connect');
net.createConnection = (..._args) => deny('net.createConnection');
tls.connect = (..._args) => deny('tls.connect');
http.request = (..._args) => deny('http.request');
http.get = (..._args) => deny('http.get');
https.request = (..._args) => deny('https.request');
https.get = (..._args) => deny('https.get');
dns.lookup = (..._args) => deny('dns.lookup');
dns.resolve = (..._args) => deny('dns.resolve');
if (dns.promises) {
  dns.promises.lookup = (..._args) => deny('dns.promises.lookup');
  dns.promises.resolve = (..._args) => deny('dns.promises.resolve');
}
globalThis.fetch = async (..._args) => deny('fetch');
syncBuiltinESMExports();
process.env.BCE_NETWORK_DENY_ACTIVE = '1';

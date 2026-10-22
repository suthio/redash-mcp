import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import axios from 'axios';

// Exercise the exact transitive copy used by Axios, not a new direct dependency.
const requireFromProject = createRequire(resolve('package.json'));
const requireFromAxios = createRequire(requireFromProject.resolve('axios'));
const { http: redirectHttp } = requireFromAxios('follow-redirects');

describe('cross-origin redirect credential removal', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    })));
  });

  it('removes authorization/cookie array headers', async () => {
    const { source, received } = await endpoints();
    await follow(source, { headers: ['Authorization', 'test-token', 'Cookie', 'test-cookie', 'X-Ordinary', 'keep'] });
    expect(received()).toMatchObject({ 'x-ordinary': 'keep' });
    expect(received()?.authorization).toBeUndefined();
    expect(received()?.cookie).toBeUndefined();
  });

  it('escapes custom sensitive header names with valid regexp metacharacters', async () => {
    const { source, received } = await endpoints();
    await follow(source, {
      headers: { 'X^Review': 'test-secret', 'X|Review': 'test-secret', 'X-Ordinary': 'keep' },
      sensitiveHeaders: ['X^Review', 'X|Review'],
    });
    expect(received()?.['x^review']).toBeUndefined();
    expect(received()?.['x|review']).toBeUndefined();
    expect(received()?.['x-ordinary']).toBe('keep');
  });

  it('also removes default credential headers through the real Axios adapter', async () => {
    const { source, received } = await endpoints();
    await axios.get(source, { proxy: false, headers: { Authorization: 'test-token', Cookie: 'test-cookie', 'X-Ordinary': 'keep' } });
    expect(received()?.authorization).toBeUndefined();
    expect(received()?.cookie).toBeUndefined();
    expect(received()?.['x-ordinary']).toBe('keep');
  });

  async function endpoints() {
    let headers: IncomingHttpHeaders | undefined;
    const destination = createServer((request, response) => {
      headers = request.headers;
      response.end('{}');
    });
    const destinationUrl = await listen(destination);
    const redirect = createServer((_request, response) => {
      response.writeHead(302, { Location: destinationUrl }); response.end();
    });
    return { source: await listen(redirect), received: () => headers };
  }
  async function listen(server: Server) {
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }
  function follow(url: string, options: Record<string, unknown>) {
    return new Promise<void>((resolve, reject) => {
      const request = redirectHttp.get(url, options, (response: any) => {
        response.resume(); response.on('end', resolve);
      });
      request.on('error', reject);
    });
  }
});

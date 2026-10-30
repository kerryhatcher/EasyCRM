const UPSTREAM = 'https://wgfpbkwjrejnlliznfdu.supabase.co';
const PUBLIC = 'https://crm-api.kerryhatcher.com';
const MCP = '/functions/v1/crm-mcp';
const CARDDAV = '/functions/v1/carddav/';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/.well-known/carddav') {
      return new Response(null, { status: 307, headers: {
        Location: PUBLIC + CARDDAV, 'Cache-Control': 'no-store',
      } });
    }

    // Keep the resource on the public hostname and the existing Auth issuer.
    const metadataPaths = [
      MCP + '/oauth-protected-resource',
      MCP + '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource' + MCP,
    ];
    if (metadataPaths.includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) {
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({
        resource: PUBLIC + MCP,
        authorization_servers: [UPSTREAM + '/auth/v1'],
        bearer_methods_supported: ['header'],
      }), { headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      } });
    }
    if (!url.pathname.startsWith('/functions/v1/')) {
      return new Response('Not found', { status: 404 });
    }

    // The origin is fixed; callers cannot turn this into an arbitrary proxy.
    const upstreamUrl = new URL(UPSTREAM);
    upstreamUrl.pathname = url.pathname;
    upstreamUrl.search = url.search;
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('cookie');
    headers.delete('forwarded');
    headers.delete('x-forwarded-host');
    headers.set('x-forwarded-proto', 'https');
    try {
      const upstream = await fetch(new Request(upstreamUrl, {
        method: request.method, headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual', duplex: 'half',
      }), { cf: { cacheTtl: 0, cacheEverything: false } });
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('Cache-Control', 'no-store');
      responseHeaders.delete('set-cookie');
      for (const name of ['www-authenticate', 'location']) {
        const value = responseHeaders.get(name);
        if (value) responseHeaders.set(name, value.replaceAll(UPSTREAM + '/functions/v1/', PUBLIC + '/functions/v1/'));
      }
      return new Response(upstream.body, { status: upstream.status,
        statusText: upstream.statusText, headers: responseHeaders });
    } catch {
      return new Response('EasyCRM upstream unavailable', {
        status: 502, headers: { 'Cache-Control': 'no-store' },
      });
    }
  },
};

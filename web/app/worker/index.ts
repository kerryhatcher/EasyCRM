const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ImageKind = 'contacts' | 'organizations';

function message(status: number, text: string): Response {
  return Response.json({ error: text }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isImage(bytes: Uint8Array, type: string): boolean {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  if (type === 'image/webp') return bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
  return false;
}

async function limitedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

async function canReadRecord(env: Env, token: string, kind: ImageKind, id: string): Promise<boolean> {
  const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` };
  const recordUrl = `${env.SUPABASE_URL}/rest/v1/${kind}?id=eq.${id}&select=id&limit=1`;
  const recordResponse = await fetch(recordUrl, { headers });
  if (!recordResponse.ok) return false;
  const records: unknown = await recordResponse.json();
  return Array.isArray(records) && records.length === 1;
}

async function imageRequest(request: Request, env: Env, kind: ImageKind, id: string): Promise<Response> {
  if (!ID_PATTERN.test(id)) return message(400, 'Invalid record ID.');
  if (!['GET', 'PUT', 'DELETE'].includes(request.method)) return message(405, 'Method not allowed.');
  const match = /^Bearer (\S+)$/i.exec(request.headers.get('Authorization') || '');
  if (!match) return message(401, 'Sign in to access images.');
  let authorized = false;
  try { authorized = await canReadRecord(env, match[1], kind, id); }
  catch { return message(502, 'Could not verify record access.'); }
  if (!authorized) return message(403, 'Record unavailable.');

  const key = `profile-images/${kind}/${id}`;
  if (request.method === 'GET') {
    const object = await env.MEDIA.get(key);
    if (!object) return message(404, 'No image for this record.');
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Length': String(object.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (request.method === 'DELETE') {
    await env.MEDIA.delete(key);
    return new Response(null, { status: 204 });
  }

  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!IMAGE_TYPES.has(type)) return message(415, 'Use a JPEG, PNG, or WebP image.');
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (declaredLength > MAX_IMAGE_BYTES) return message(413, 'Image must be 5 MB or smaller.');
  const bytes = await limitedBody(request);
  if (!bytes || !bytes.length) return message(413, 'Image must be 5 MB or smaller.');
  if (!isImage(bytes, type)) return message(415, 'The file does not match its image type.');
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/api\/profile-images\/(contacts|organizations)\/([^/]+)$/.exec(url.pathname);
    if (match) return imageRequest(request, env, match[1] as ImageKind, match[2]);
    if (url.pathname.startsWith('/api/')) return message(404, 'API route not found.');
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

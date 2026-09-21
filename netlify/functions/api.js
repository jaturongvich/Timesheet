const { EventEmitter } = require('events');
const { api, bootstrap } = require('../../server');

let bootstrapPromise;
function ensureBootstrap() {
  if (!bootstrapPromise) bootstrapPromise = bootstrap();
  return bootstrapPromise;
}

exports.handler = async function handler(event) {
  try {
    await ensureBootstrap();
    const rawUrl = event.rawUrl || `https://${event.headers?.host || 'localhost'}${event.path || '/'}`;
    const parsed = new URL(rawUrl);
    let pathname = parsed.pathname.replace(/^\/\.netlify\/functions\/api/, '');
    if (!pathname) pathname = '/';
    const req = new EventEmitter();
    req.method = event.httpMethod || 'GET';
    req.url = pathname + parsed.search;
    req.headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const response = { statusCode: 200, headers: {}, body: '' };
    const res = {
      writeHead(code, headers) { response.statusCode = code; Object.assign(response.headers, headers); },
      setHeader(name, value) { response.headers[name] = value; },
      end(body = '') { response.body = body; }
    };
    process.nextTick(() => {
      if (event.body) req.emit('data', Buffer.from(event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body));
      req.emit('end');
    });
    await api(req, res, pathname);
    return { statusCode: response.statusCode, headers: response.headers, body: response.body };
  } catch (error) {
    console.error('Netlify API error:', error && error.message ? error.message : 'Request failed.');
    return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Server error.' }) };
  }
};

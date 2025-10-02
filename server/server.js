const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONCURRENT_PROVIDER_REQUESTS = 5;
const USER_AGENT = 'MultiMapSearch/0.1 (+https://example.com)';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const cache = new Map();
let activeProviderRequests = 0;

function log(...args) {
  console.log(new Date().toISOString(), '-', ...args);
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  });
  res.end(payload);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function serveStatic(req, res, url) {
  let pathname = url.pathname;
  if (pathname === '/') {
    pathname = '/index.html';
  }
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname.replace(/^\/+/, '')));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }
    const ext = path.extname(filePath);
    const type = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

function normalizePoi(element, queryLabel) {
  const tags = element.tags || {};
  const lat = element.lat || (element.center && element.center.lat);
  const lon = element.lon || (element.center && element.center.lon);
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return null;
  }
  const id = `${element.type}/${element.id}`;
  const name = tags.name || queryLabel;
  const phone = tags.phone || tags['contact:phone'] || null;
  const website = tags.website || tags.url || null;
  const categories = [];
  ['amenity', 'shop', 'tourism', 'leisure', 'office', 'craft', 'sport'].forEach((key) => {
    if (tags[key]) {
      categories.push(`${key}:${tags[key]}`);
    }
  });
  const addressParts = [
    tags['addr:full'],
    [tags['addr:city'], tags['addr:district'], tags['addr:suburb']].filter(Boolean).join(' '),
    [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
    tags['addr:postcode'],
  ].filter(Boolean);
  const address = addressParts.join(', ') || null;

  return {
    id,
    name,
    lat,
    lng: lon,
    address,
    sourceId: id,
    categories,
    rating: tags.rating ? Number(tags.rating) : null,
    openNow: null,
    openingHours: tags.opening_hours || null,
    phone,
    website,
    queryLabel,
  };
}

async function fetchFromOverpass(bbox, queryLabel) {
  const key = `overpass:${bbox}:${queryLabel}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return cached.value;
  }

  if (activeProviderRequests >= MAX_CONCURRENT_PROVIDER_REQUESTS) {
    const error = new Error('Provider busy');
    error.status = 429;
    throw error;
  }

  activeProviderRequests += 1;
  try {
    const [south, west, north, east] = bbox.split(',').map((v) => parseFloat(v));
    if ([south, west, north, east].some((v) => Number.isNaN(v))) {
      const error = new Error('Invalid bounding box');
      error.status = 400;
      throw error;
    }
    const bboxClause = `${south},${west},${north},${east}`;
    const escaped = queryLabel.replace(/"/g, '');
    const query = `
      [out:json][timeout:25];
      (
        node["name"~"${escaped}", i](${bboxClause});
        way["name"~"${escaped}", i](${bboxClause});
        relation["name"~"${escaped}", i](${bboxClause});
        node["amenity"~"${escaped}", i](${bboxClause});
        way["amenity"~"${escaped}", i](${bboxClause});
        node["shop"~"${escaped}", i](${bboxClause});
        way["shop"~"${escaped}", i](${bboxClause});
      );
      out center tags 40;
    `;

    const body = new URLSearchParams({ data: query });
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body,
    });

    if (!response.ok) {
      const error = new Error(`Overpass error: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    const pois = (payload.elements || [])
      .map((element) => normalizePoi(element, queryLabel))
      .filter(Boolean);

    const result = { provider: 'overpass', query: queryLabel, items: pois };
    cache.set(key, { value: result, expires: now + CACHE_TTL_MS });
    return result;
  } finally {
    activeProviderRequests -= 1;
  }
}

function handleSearch(req, res, url) {
  const params = url.searchParams;
  const bbox = params.get('bbox');
  const queryLabel = params.get('q');
  if (!bbox || !queryLabel) {
    return sendError(res, 400, 'Missing bbox or q parameter');
  }
  fetchFromOverpass(bbox, queryLabel)
    .then((result) => {
      sendJson(res, 200, result);
    })
    .catch((error) => {
      const status = error.status || 500;
      log('Search error', status, error.message);
      sendError(res, status, '結果が取得できませんでした');
    });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/search') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    handleSearch(req, res, url);
    return;
  }

  serveStatic(req, res, url);
});

if (require.main === module) {
  server.listen(PORT, () => {
    log(`Server listening on http://localhost:${PORT}`);
  });
}

module.exports = server;

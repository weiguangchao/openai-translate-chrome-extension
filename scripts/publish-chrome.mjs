import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const API = 'https://chromewebstore.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const POLL_MS = 5_000;
const POLL_LIMIT = 60;

const [zip] = process.argv.slice(2);
const { GCP_SA_KEY, CHROME_PUBLISHER_ID, CHROME_EXTENSION_ID } = process.env;
if (!zip || !GCP_SA_KEY || !CHROME_PUBLISHER_ID || !CHROME_EXTENSION_ID) {
  console.error(
    'Usage: GCP_SA_KEY=... CHROME_PUBLISHER_ID=... CHROME_EXTENSION_ID=... node scripts/publish-chrome.mjs <zip>',
  );
  process.exit(1);
}
const item = `publishers/${CHROME_PUBLISHER_ID}/items/${CHROME_EXTENSION_ID}`;

async function request(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url}: ${JSON.stringify(body)}`);
  return body;
}

async function accessToken() {
  const key = JSON.parse(GCP_SA_KEY);
  const now = Math.floor(Date.now() / 1000);
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = {
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const body = await request(key.token_uri, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  return body.access_token;
}

const auth = { Authorization: `Bearer ${await accessToken()}` };

const uploaded = await request(`${API}/upload/v2/${item}:upload`, {
  method: 'POST',
  headers: { ...auth, 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-File-Name': 'extension.zip' },
  body: await readFile(zip),
});
console.log('Uploaded:', JSON.stringify(uploaded));

let state = uploaded.uploadState;
for (let polls = 0; state === 'IN_PROGRESS' && polls < POLL_LIMIT; polls++) {
  await sleep(POLL_MS);
  state = (await request(`${API}/v2/${item}:fetchStatus`, { headers: auth })).lastAsyncUploadState;
}
if (state !== 'SUCCEEDED') throw new Error(`Upload ended in ${state}`);

const published = await request(`${API}/v2/${item}:publish`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
});
console.log('Submitted for review:', JSON.stringify(published));

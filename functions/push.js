// Cloudflare Pages Function: /push
// Handles VAPID JWT signing and RFC 8291 AES-128-GCM payload encryption
// Env vars required: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

export async function onRequest(context) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    try {
        return await handle(context, corsHeaders);
    } catch (e) {
        return new Response(JSON.stringify({ error: 'unhandled', message: String(e && e.message || e), stack: String(e && e.stack || '') }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}

async function handle(context, corsHeaders) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    if (request.method === 'GET') {
        return new Response(JSON.stringify({ key: env.VAPID_PUBLIC_KEY || '' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let payload;
    try { payload = await request.json(); }
    catch { return new Response('Bad Request', { status: 400 }); }

    const { title, body, subscription } = payload;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
        return new Response(JSON.stringify({ error: 'Missing subscription' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const VAPID_PUBLIC_KEY = env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = env.VAPID_PRIVATE_KEY;
    const VAPID_SUBJECT = env.VAPID_SUBJECT || 'mailto:admin@example.com';

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let stage = 'start';
    try {
        stage = 'jwt';
        const jwt = await createVapidJwt(new URL(subscription.endpoint).origin, VAPID_SUBJECT, VAPID_PRIVATE_KEY);
        stage = 'encrypt';
        const encBody = await encryptPayload(subscription, { title, body });
        stage = 'fetch';
        const result = await fetch(subscription.endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
                'Content-Type': 'application/octet-stream',
                'Content-Encoding': 'aes128gcm',
                'TTL': '86400',
            },
            body: encBody,
        });
        const respText = await result.text().catch(() => '');
        const ok = result.status === 201 || result.status === 200 || result.status === 202;
        return new Response(JSON.stringify({ ok, status: result.status, pushBody: respText.slice(0, 200) }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'caught', stage, message: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 500) }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}

// ── Utility ────────────────────────────────────────────────────────────────

function b64urlDecode(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const bin = atob(padded);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function b64urlEncode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── VAPID JWT ──────────────────────────────────────────────────────────────

async function createVapidJwt(audience, subject, privateKeyPkcs8B64) {
    const header = b64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const now = Math.floor(Date.now() / 1000);
    const claims = b64urlEncode(new TextEncoder().encode(JSON.stringify({ aud: audience, exp: now + 43200, sub: subject })));
    const sigInput = `${header}.${claims}`;

    const privateKeyBytes = b64urlDecode(privateKeyPkcs8B64);
    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        privateKeyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        new TextEncoder().encode(sigInput)
    );
    return `${sigInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

// ── RFC 8291 Payload Encryption ────────────────────────────────────────────

async function hkdfExpand(prk, info, length) {
    const prkKey = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info },
        prkKey,
        length * 8
    );
    return new Uint8Array(bits);
}

async function hkdfExtractExpand(salt, ikm, info, length) {
    const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm));
    return hkdfExpand(prk, info, length);
}

async function encryptPayload(subscription, message) {
    const { p256dh, auth } = subscription.keys;
    const receiverPublicKeyBytes = b64urlDecode(p256dh);
    const authSecret = b64urlDecode(auth);
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Generate sender ECDH key pair
    const senderKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
    );

    // Export sender public key as uncompressed point (65 bytes: 0x04 || x || y)
    const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKeyPair.publicKey));

    // Import receiver public key
    const receiverCryptoKey = await crypto.subtle.importKey(
        'raw',
        receiverPublicKeyBytes,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
    );

    // ECDH shared secret
    const ecdhBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: receiverCryptoKey },
        senderKeyPair.privateKey,
        256
    );
    const ecdhSecret = new Uint8Array(ecdhBits);

    // RFC 8291 key derivation
    // ikm = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info\x00" || recv_pub || sender_pub, len=32)
    const infoIkm = concat(
        new TextEncoder().encode('WebPush: info\x00'),
        receiverPublicKeyBytes,
        senderPubRaw
    );
    const ikm = await hkdfExtractExpand(authSecret, ecdhSecret, infoIkm, 32);

    // CEK = HKDF(salt=salt, ikm=ikm, info="Content-Encoding: aes128gcm\x00", len=16)
    const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\x00');
    const cek = await hkdfExtractExpand(salt, ikm, cekInfo, 16);

    // Nonce = HKDF(salt=salt, ikm=ikm, info="Content-Encoding: nonce\x00", len=12)
    const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\x00');
    const nonce = await hkdfExtractExpand(salt, ikm, nonceInfo, 12);

    // Plaintext + record delimiter (0x02)
    const plaintext = new TextEncoder().encode(JSON.stringify(message));
    const paddedPlaintext = concat(plaintext, new Uint8Array([0x02]));

    // AES-128-GCM encrypt
    const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, paddedPlaintext)
    );

    // Build content body: salt(16) || rs(4, big-endian, 4096) || idlen(1, =65) || sender_pub(65) || ciphertext
    const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00]); // 4096
    const idlen = new Uint8Array([65]);
    return concat(salt, rs, idlen, senderPubRaw, ciphertext);
}

function concat(...arrays) {
    const total = arrays.reduce((acc, a) => acc + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
}

// ── Send ───────────────────────────────────────────────────────────────────

async function sendWebPush(subscription, message, vapidPublicKey, vapidPrivateKey, vapidSubject) {
    const endpoint = subscription.endpoint;
    const audience = new URL(endpoint).origin;

    const [jwt, body] = await Promise.all([
        createVapidJwt(audience, vapidSubject, vapidPrivateKey),
        encryptPayload(subscription, message)
    ]);

    return fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `vapid t=${jwt},k=${vapidPublicKey}`,
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            'TTL': '86400',
        },
        body,
    });
}

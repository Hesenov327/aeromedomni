/**
 * AERO-MED OMNI // Mission Control Authentication Controller
 * Supports Login (login.html), Sign Up (signup.html), and Dashboard Session UI.
 * Syncs with EN / RU / AZ trilingual settings and supports both offline localStorage & Python backend.
 */

const DEFAULT_USERS = [
    {
        id: 'USR-MD02',
        fullName: 'Dr. Leyla Mammadova',
        callsign: 'MD-02',
        roleKey: 'auth_role_surgeon',
        email: 'leyla@aeromed.nasa.gov',
        plainDemo: 'AeroMed2026!'
    },
    {
        id: 'USR-EV01',
        fullName: 'Cmdr. Aydin Karimov',
        callsign: 'EV-01',
        roleKey: 'auth_role_commander',
        email: 'aydin@aeromed.nasa.gov',
        plainDemo: 'Orbit2026!'
    }
];

let authBackendOffline = false;

function isFileProtocol() {
    return typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';
}

function showAuthOfflineBanner() {
    authBackendOffline = true;
    const banner = document.getElementById('auth-offline-banner');
    if (banner) banner.classList.remove('hidden');
}

async function detectAuthBackend() {
    if (isFileProtocol()) {
        showAuthOfflineBanner();
        return false;
    }
    try {
        const res = await fetch('/api/equipment', { method: 'GET' });
        if (!res.ok) {
            showAuthOfflineBanner();
            return false;
        }
        return true;
    } catch (_) {
        showAuthOfflineBanner();
        return false;
    }
}

function getAuthSettings() {
    return loadFromStorage(STORAGE_KEYS.SETTINGS, { lang: 'az', rateMs: 1000, tempUnit: 'C', reducedMotion: false, toasts: true, audio: false });
}

function getAuthLang() {
    const s = getAuthSettings();
    return ['en', 'ru', 'az'].includes(s.lang) ? s.lang : 'az';
}

function authT(key) {
    const lang = getAuthLang();
    return (I18N[lang] && I18N[lang][key]) || (I18N.en && I18N.en[key]) || key;
}

// ==================== CRYPTOGRAPHIC SALTED PBKDF2-HMAC-SHA256 ====================
const CLIENT_PBKDF2_PREFIX = 'pbkdf2_sha256';
const CLIENT_PBKDF2_WEBCRYPTO_ITERS = 100000;
const CLIENT_PBKDF2_FALLBACK_ITERS = 5000;

function bytesToHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function generateSaltBytes(len = 16) {
    const buf = new Uint8Array(len);
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(buf);
    } else {
        for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    return buf;
}

function utf8Bytes(str) {
    return new TextEncoder().encode(str);
}

// Pure-JS SHA-256 fallback (for file:// contexts where crypto.subtle may be disabled)
function sha256Bytes(data) {
    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const bitLen = data.length * 8;
    const padLen = ((data.length + 9 + 63) >> 6) << 6;
    const msg = new Uint8Array(padLen);
    msg.set(data);
    msg[data.length] = 0x80;
    const dv = new DataView(msg.buffer);
    dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
    dv.setUint32(padLen - 4, bitLen >>> 0, false);

    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < padLen; i += 64) {
        for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
        for (let t = 16; t < 64; t++) {
            const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
            const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let t = 0; t < 64; t++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ ((~e) & g);
            const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const outDv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outDv.setUint32(i * 4, H[i], false);
    return out;
}

function hmacSha256Bytes(keyBytes, msgBytes) {
    let k = keyBytes.length > 64 ? sha256Bytes(keyBytes) : keyBytes;
    const ipad = new Uint8Array(64).fill(0x36);
    const opad = new Uint8Array(64).fill(0x5c);
    for (let i = 0; i < k.length; i++) {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    const innerInput = new Uint8Array(64 + msgBytes.length);
    innerInput.set(ipad);
    innerInput.set(msgBytes, 64);
    const innerHash = sha256Bytes(innerInput);
    const outerInput = new Uint8Array(64 + 32);
    outerInput.set(opad);
    outerInput.set(innerHash, 64);
    return sha256Bytes(outerInput);
}

function pbkdf2Sha256Sync(password, saltBytes, iterations) {
    const pwBytes = utf8Bytes(password);
    const block1 = new Uint8Array(saltBytes.length + 4);
    block1.set(saltBytes);
    block1[saltBytes.length + 3] = 1;
    let u = hmacSha256Bytes(pwBytes, block1);
    const dk = new Uint8Array(u);
    for (let i = 1; i < iterations; i++) {
        u = hmacSha256Bytes(pwBytes, u);
        for (let j = 0; j < 32; j++) dk[j] ^= u[j];
    }
    return bytesToHex(dk);
}

async function derivePbkdf2Hex(password, saltBytes, iterations) {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
        try {
            const keyMat = await window.crypto.subtle.importKey(
                'raw',
                utf8Bytes(password),
                'PBKDF2',
                false,
                ['deriveBits']
            );
            const bits = await window.crypto.subtle.deriveBits(
                { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
                keyMat,
                256
            );
            return bytesToHex(new Uint8Array(bits));
        } catch (_) {}
    }
    return pbkdf2Sha256Sync(password, saltBytes, iterations);
}

async function hashClientPassword(pw) {
    const salt = generateSaltBytes(16);
    const hasWebCrypto = !!(typeof window !== 'undefined' && window.crypto && window.crypto.subtle);
    const iters = hasWebCrypto ? CLIENT_PBKDF2_WEBCRYPTO_ITERS : CLIENT_PBKDF2_FALLBACK_ITERS;
    const hex = await derivePbkdf2Hex(pw, salt, iters);
    return `${CLIENT_PBKDF2_PREFIX}$${iters}$${bytesToHex(salt)}$${hex}`;
}

function legacySimpleHash(pw) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < pw.length; i++) {
        const ch = pw.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

async function verifyClientPassword(pw, storedHash) {
    if (!storedHash) return { valid: false, needsRehash: false };
    if (storedHash.startsWith(`${CLIENT_PBKDF2_PREFIX}$`)) {
        const parts = storedHash.split('$');
        if (parts.length !== 4) return { valid: false, needsRehash: false };
        const iters = parseInt(parts[1], 10);
        const saltBytes = hexToBytes(parts[2]);
        const expected = parts[3];
        if (!Number.isFinite(iters) || iters <= 0) return { valid: false, needsRehash: false };
        const derived = await derivePbkdf2Hex(pw, saltBytes, iters);
        // Constant-time comparison
        let diff = derived.length ^ expected.length;
        for (let i = 0; i < Math.min(derived.length, expected.length); i++) {
            diff |= derived.charCodeAt(i) ^ expected.charCodeAt(i);
        }
        return { valid: diff === 0, needsRehash: false };
    }
    const valid = legacySimpleHash(pw) === storedHash;
    return { valid, needsRehash: valid };
}

async function ensureSeedUsers() {
    let users = loadFromStorage(STORAGE_KEYS.USERS, null);
    if (!Array.isArray(users) || users.length === 0) {
        users = [];
        for (const u of DEFAULT_USERS) {
            users.push({
                id: u.id,
                fullName: u.fullName,
                callsign: u.callsign,
                roleKey: u.roleKey,
                email: u.email.toLowerCase(),
                passwordHash: await hashClientPassword(u.plainDemo)
            });
        }
        saveToStorage(STORAGE_KEYS.USERS, users);
    }
    return users;
}

function getUsersList() {
    const users = loadFromStorage(STORAGE_KEYS.USERS, null);
    return Array.isArray(users) ? users : [];
}

function getActiveSession() {
    return loadFromStorage(STORAGE_KEYS.SESSION, null);
}

function setActiveSession(user) {
    const session = {
        id: user.id,
        fullName: user.fullName,
        callsign: user.callsign,
        roleKey: user.roleKey || 'auth_role_specialist',
        email: user.email,
        loginAt: new Date().toISOString()
    };
    saveToStorage(STORAGE_KEYS.SESSION, session);
    return session;
}

function clearActiveSession() {
    try {
        localStorage.removeItem(STORAGE_KEYS.SESSION);
    } catch (_) {}
}

function applyAuthLanguage() {
    const s = getAuthSettings();
    document.body.classList.toggle('theme-light', s.theme === 'light');
    const lang = getAuthLang();
    document.documentElement.lang = lang;

    const langSelect = document.getElementById('auth-lang-select');
    if (langSelect) langSelect.value = lang;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = authT(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.setAttribute('placeholder', authT(key));
    });

    // Update strength indicator text if on signup page
    const pwInput = document.getElementById('signup-password');
    if (pwInput) updatePasswordStrength(pwInput.value);
}

function updatePasswordStrength(pw) {
    const bar = document.getElementById('pw-strength-bar');
    const lbl = document.getElementById('pw-strength-label');
    if (!bar || !lbl) return;

    if (!pw) {
        bar.style.width = '0%';
        bar.style.background = 'transparent';
        lbl.textContent = '';
        return;
    }

    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 1) {
        bar.style.width = '33%';
        bar.style.background = 'var(--red)';
        lbl.textContent = authT('auth_pw_weak');
        lbl.style.color = 'var(--red)';
    } else if (score <= 2) {
        bar.style.width = '66%';
        bar.style.background = 'var(--amber)';
        lbl.textContent = authT('auth_pw_medium');
        lbl.style.color = 'var(--amber)';
    } else {
        bar.style.width = '100%';
        bar.style.background = 'var(--green)';
        lbl.textContent = authT('auth_pw_strong');
        lbl.style.color = 'var(--green)';
    }
}

function showAuthError(msgKey) {
    const errBox = document.getElementById('auth-error-box');
    if (!errBox) return;
    errBox.textContent = authT(msgKey);
    errBox.classList.remove('hidden');
}

function hideAuthError() {
    document.getElementById('auth-error-box')?.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', async () => {
    // Only bind auth page listeners if we are on login.html or signup.html
    const isLoginPage = !!document.getElementById('login-form');
    const isSignupPage = !!document.getElementById('signup-form');
    if (!isLoginPage && !isSignupPage) return;

    // Seed default users & detect offline/file:// mode
    await ensureSeedUsers();
    applyAuthLanguage();
    detectAuthBackend();

    // Language switch on Auth pages
    document.getElementById('auth-lang-select')?.addEventListener('change', (e) => {
        const s = getAuthSettings();
        s.lang = e.target.value;
        saveToStorage(STORAGE_KEYS.SETTINGS, s);
        applyAuthLanguage();
        hideAuthError();
    });

    // Show/Hide password toggles
    document.querySelectorAll('.pw-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (!input) return;
            const isPw = input.type === 'password';
            input.type = isPw ? 'text' : 'password';
            btn.textContent = isPw ? '🙈' : '👁';
        });
    });

    // ==================== LOGIN PAGE HANDLERS ====================
    if (isLoginPage) {
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            hideAuthError();

            const identifier = document.getElementById('login-identifier').value.trim();
            const password = document.getElementById('login-password').value;

            if (!identifier || !password) {
                showAuthError('auth_err_required');
                return;
            }

            const users = await ensureSeedUsers();
            const lowerId = identifier.toLowerCase();
            const upperId = identifier.toUpperCase();

            let matched = null;
            const candidate = users.find(u =>
                u.email.toLowerCase() === lowerId || u.callsign.toUpperCase() === upperId
            );
            if (candidate) {
                const check = await verifyClientPassword(password, candidate.passwordHash);
                if (check.valid) {
                    if (check.needsRehash) {
                        candidate.passwordHash = await hashClientPassword(password);
                        saveToStorage(STORAGE_KEYS.USERS, users);
                    }
                    matched = candidate;
                }
            }

            // Optional backend auth check if server.py is active (skipped cleanly on file://)
            if (!matched && !isFileProtocol() && !authBackendOffline) {
                try {
                    const res = await fetch('/api/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ identifier, password })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.user) matched = data.user;
                    }
                } catch (_) {
                    showAuthOfflineBanner();
                }
            }

            if (!matched) {
                showAuthError('auth_err_invalid_creds');
                return;
            }

            setActiveSession(matched);
            window.location.href = 'index.html';
        });

        // 1-Click Judge / Demo Access
        document.getElementById('btn-demo-login')?.addEventListener('click', async () => {
            const users = await ensureSeedUsers();
            const demoUser = users[0];
            setActiveSession(demoUser);
            window.location.href = 'index.html';
        });
    }

    // ==================== SIGN UP PAGE HANDLERS ====================
    if (isSignupPage) {
        const pwInput = document.getElementById('signup-password');
        pwInput?.addEventListener('input', (e) => updatePasswordStrength(e.target.value));

        document.getElementById('signup-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            hideAuthError();

            const fullName = document.getElementById('signup-fullname').value.trim();
            const callsign = document.getElementById('signup-callsign').value.trim().toUpperCase();
            const roleKey = document.getElementById('signup-role').value;
            const email = document.getElementById('signup-email').value.trim().toLowerCase();
            const password = document.getElementById('signup-password').value;
            const confirmPw = document.getElementById('signup-confirm').value;
            const termsChecked = document.getElementById('signup-terms').checked;

            if (!fullName || !callsign || !email || !password || !confirmPw) {
                showAuthError('auth_err_required');
                return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showAuthError('auth_err_email_fmt');
                return;
            }
            if (password.length < 6) {
                showAuthError('auth_err_pw_len');
                return;
            }
            if (password !== confirmPw) {
                showAuthError('auth_err_pw_match');
                return;
            }
            if (!termsChecked) {
                showAuthError('auth_err_terms');
                return;
            }

            const users = await ensureSeedUsers();
            const exists = users.some(u => u.email.toLowerCase() === email || u.callsign.toUpperCase() === callsign);
            if (exists) {
                showAuthError('auth_err_exists');
                return;
            }

            const saltedHash = await hashClientPassword(password);
            const newUser = {
                id: `USR-${Date.now().toString().slice(-5)}`,
                fullName,
                callsign,
                roleKey,
                email,
                passwordHash: saltedHash
            };
            users.push(newUser);
            saveToStorage(STORAGE_KEYS.USERS, users);

            // Optional backend SQLite registration (skipped cleanly on file://)
            if (!isFileProtocol() && !authBackendOffline) {
                try {
                    const res = await fetch('/api/auth/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fullName, callsign, roleKey, email, password })
                    });
                    if (!res.ok && res.status >= 500) {
                        showAuthOfflineBanner();
                    }
                } catch (_) {
                    showAuthOfflineBanner();
                }
            }

            setActiveSession(newUser);
            window.location.href = 'index.html';
        });
    }
});

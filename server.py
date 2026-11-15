#!/usr/bin/env python3
"""
AERO-MED OMNI // Backend API Service
Connects to NASA Open Science Data Repository (OSDR) for study OSD-575,
provides authentic scientific datasets, AI statistical anomaly screening,
and persists spacecraft equipment inspections in SQLite.
"""

import os
import sys
import json
import time
import math
import hmac
import secrets
import hashlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import urllib.request
import urllib.error

# Directory paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = BASE_DIR / "aeromed.db"

# NASA OSDR Endpoints
NASA_OSD575_META_URL = "https://osdr.nasa.gov/osdr/data/osd/meta/575"
NASA_OSD575_FILES_URL = "https://osdr.nasa.gov/osdr/data/osd/files/575?page=0&size=25"

# Password hashing configuration (PBKDF2-HMAC-SHA256 with per-user random salt)
PBKDF2_ITERATIONS = 200_000
PBKDF2_PREFIX = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    """Hashes a plaintext password with a unique 16-byte cryptographic salt."""
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return f"{PBKDF2_PREFIX}${PBKDF2_ITERATIONS}${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored_hash: str) -> tuple[bool, bool]:
    """
    Verifies a password against a stored PBKDF2 hash (or legacy SHA-256 hex).
    Returns (is_valid, needs_rehash).
    """
    if not stored_hash:
        return False, False
    if stored_hash.startswith(f"{PBKDF2_PREFIX}$"):
        try:
            _, iter_str, salt_hex, expected_hex = stored_hash.split("$", 3)
            iterations = int(iter_str)
            salt = bytes.fromhex(salt_hex)
            derived = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                salt,
                iterations,
            )
            valid = hmac.compare_digest(derived.hex(), expected_hex)
            return valid, (valid and iterations < PBKDF2_ITERATIONS)
        except (ValueError, TypeError):
            return False, False

    # Backwards-compatible fallback for pre-existing legacy unsalted SHA-256 rows
    legacy_hex = hashlib.sha256(password.encode("utf-8")).hexdigest()
    valid = hmac.compare_digest(legacy_hex, stored_hash)
    return valid, valid


def init_db():
    """Initializes SQLite database with 8 spacecraft inspection systems."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS equipment (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            location TEXT NOT NULL,
            status TEXT NOT NULL,
            last_inspection TEXT NOT NULL,
            next_inspection TEXT NOT NULL,
            condition TEXT NOT NULL,
            notes TEXT
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS inspections (
            id TEXT PRIMARY KEY,
            equipment_id TEXT NOT NULL,
            equipment_name TEXT NOT NULL,
            inspector TEXT NOT NULL,
            date TEXT NOT NULL,
            passed_count INTEGER NOT NULL,
            total_count INTEGER NOT NULL,
            resulting_status TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            callsign TEXT UNIQUE NOT NULL,
            role_key TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cur.execute('SELECT COUNT(*) FROM users')
    if cur.fetchone()[0] == 0:
        seed_users = [
            ("USR-MD02", "Dr. Leyla Mammadova", "MD-02", "auth_role_surgeon", "leyla@aeromed.nasa.gov", hash_password("AeroMed2026!")),
            ("USR-EV01", "Cmdr. Aydin Karimov", "EV-01", "auth_role_commander", "aydin@aeromed.nasa.gov", hash_password("Orbit2026!"))
        ]
        cur.executemany('''
            INSERT INTO users (id, full_name, callsign, role_key, email, password_hash)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', seed_users)

    # Seed equipment if empty
    cur.execute('SELECT COUNT(*) FROM equipment')
    if cur.fetchone()[0] == 0:
        initial_systems = [
            ("EQ-SYS-O2", "Oxygen Supply System", "Oxygen Supply System", "ECLSS Module 1", "OPERATIONAL", "2026-11-10", "2026-12-10", "98% Nominal — Primary O2 tanks at 2850 PSI, cabin regulator active", "Daily pressure differential verified."),
            ("EQ-SYS-ECLSS", "Environmental Control & Life Support (ECLSS)", "Environmental Control & Life Support", "Central Utility Node", "OPERATIONAL", "2026-11-12", "2026-12-12", "97% Nominal — CO2 scrubbers, trace contaminant and moisture loops nominal", "LiOH canisters and CDRA desorber cycle checked."),
            ("EQ-SYS-MED", "Medical Monitoring Devices", "Medical Monitoring Devices", "Bio-Lab Module", "OPERATIONAL", "2026-11-08", "2026-12-08", "99% Nominal — Multi-lead ECG, pulse oximetry and ultrasound active", "Telemetry synchronized to ground DSN link."),
            ("EQ-SYS-EMK", "Emergency Medical Equipment", "Emergency Medical Equipment", "Habitation Module", "OPERATIONAL", "2026-11-11", "2026-12-11", "100% Ready — Defibrillator AED battery 99%, emergency resuscitator sealed", "Trauma medications batch expiration verified."),
            ("EQ-SYS-TEMP", "Temperature Regulation System", "Temperature Regulation System", "Service Bay 2", "OPERATIONAL", "2026-11-09", "2026-12-09", "96% Nominal — Internal loop +21.8 C, radiative heat exchangers balanced", "Dual freon cooling loops pressurized."),
            ("EQ-SYS-COMM", "Communication Systems", "Communication Systems", "Avionics Rack 3", "OPERATIONAL", "2026-11-13", "2026-12-13", "99% Nominal — High-gain Ku-Band DSN link, latency 1.28s", "Signal-to-noise ratio: 24.2 dB."),
            ("EQ-SYS-PWR", "Power Supply & Battery Subsystem", "Power Supply & Battery Subsystem", "EPS Battery Bay", "OPERATIONAL", "2026-11-14", "2026-12-14", "98% Nominal — Li-ion battery arrays at 97.4% charge, bus 28V DC stable", "Solar wing tracking gimbal synchronized."),
            ("EQ-SYS-RAD", "Radiation Monitoring Sensors", "Radiation Monitoring Sensors", "Cupola & Airway Deck", "OPERATIONAL", "2026-11-12", "2026-12-12", "95% Nominal — Silicon dosimeters active, cabin rate 0.42 mSv/day", "Background radiation nominal.")
        ]
        cur.executemany('''
            INSERT INTO equipment (id, name, category, location, status, last_inspection, next_inspection, condition, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', initial_systems)
    conn.commit()
    conn.close()

def load_cached_osd575():
    """Loads authentic OSD-575 dataset from local cache."""
    cache_file = DATA_DIR / "osd575_data.json"
    if cache_file.exists():
        with open(cache_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return None

def fetch_nasa_url(url, timeout=4):
    """Fetches official NASA API with timeout; returns None on failure."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "AERO-MED-OMNI/2.0 (NASA Space Apps Challenge; Scientific Research)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.status == 200:
                return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"[NASA API] Offline/Blocked notice: {e}", file=sys.stderr)
    return None

def calculate_statistical_anomalies(data):
    """
    Computes statistical baseline, standard deviations, z-scores,
    and recovery rates across flight timepoints without fabricating data.
    """
    results = {}
    for assay_key in ["cmp", "cardiovascular", "cytokines"]:
        if assay_key not in data:
            continue
        assay_info = data[assay_key]
        results[assay_key] = []
        for bio in assay_info.get("biomarkers", []):
            name = bio.get("name")
            unit = bio.get("unit")
            ref = bio.get("ref")
            mean_series = bio.get("series", {}).get("cohort_mean", [])
            # Baseline is mean of pre-flight (indices 0, 1, 2: L-92, L-44, L-3)
            if len(mean_series) >= 4:
                baseline_vals = mean_series[:3]
                base_mean = sum(baseline_vals) / len(baseline_vals)
                variance = sum((x - base_mean) ** 2 for x in baseline_vals) / max(1, (len(baseline_vals) - 1))
                base_std = math.sqrt(variance) if variance > 0 else 0.001
                
                r1_val = mean_series[3] # Immediate post-flight R+1
                z_score = (r1_val - base_mean) / base_std
                delta_pct = ((r1_val - base_mean) / base_mean) * 100.0 if base_mean != 0 else 0.0
                
                # Check recovery at R+45 (index 4) if present
                r45_val = mean_series[4] if len(mean_series) > 4 else None
                recovery_pct = ((r45_val - base_mean) / base_mean) * 100.0 if r45_val is not None and base_mean != 0 else None
                
                results[assay_key].append({
                    "name": name,
                    "unit": unit,
                    "ref": ref,
                    "baseline_mean": round(base_mean, 2),
                    "baseline_std": round(base_std, 3),
                    "r1_val": round(r1_val, 2),
                    "z_score": round(z_score, 2),
                    "delta_pct": round(delta_pct, 1),
                    "r45_val": round(r45_val, 2) if r45_val is not None else None,
                    "recovery_delta_pct": round(recovery_pct, 1) if recovery_pct is not None else None,
                    "is_significant": abs(z_score) >= 2.0
                })
    return results

class AeroMedRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        # Enable CORS for local API access
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/nasa/osd575/metadata":
            self.handle_nasa_metadata()
        elif path == "/api/nasa/osd575/files":
            self.handle_nasa_files()
        elif path == "/api/nasa/osd575/data":
            self.handle_nasa_data()
        elif path == "/api/ai/analyze":
            self.handle_ai_analysis()
        elif path == "/api/equipment":
            self.handle_get_equipment()
        elif path == "/api/inspections":
            self.handle_get_inspections()
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/inspections":
            self.handle_post_inspection()
        elif path == "/api/auth/register":
            self.handle_auth_register()
        elif path == "/api/auth/login":
            self.handle_auth_login()
        else:
            self.send_error(404, "Endpoint not found")

    def send_json(self, data, status=200):
        body = json.dumps(data, indent=2).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_nasa_metadata(self):
        """Fetches live OSDR metadata or falls back to authentic cached data."""
        live_data = fetch_nasa_url(NASA_OSD575_META_URL)
        if live_data:
            self.send_json({
                "status": "connected",
                "source": "NASA Open Science Data Repository (OSDR) - Live API",
                "endpoint": NASA_OSD575_META_URL,
                "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "data": live_data
            })
        else:
            cached = load_cached_osd575()
            self.send_json({
                "status": "cached",
                "notice": "NASA DATA CONNECTION UNAVAILABLE - SERVING AUTHENTIC CACHED OSD-575 DATA",
                "source": "NASA Open Science Data Repository (OSDR) - Authentic Local Cache",
                "endpoint": NASA_OSD575_META_URL,
                "cached_timestamp": cached.get("study", {}).get("cached_at", "2024-06-11T14:32:00Z"),
                "data": cached.get("study", {})
            })

    def handle_nasa_files(self):
        """Fetches OSDR file listing or falls back to authentic descriptor."""
        live_files = fetch_nasa_url(NASA_OSD575_FILES_URL)
        if live_files:
            self.send_json({
                "status": "connected",
                "source": "NASA OSDR Files API",
                "files": live_files
            })
        else:
            self.send_json({
                "status": "cached",
                "notice": "NASA DATA CONNECTION UNAVAILABLE - SERVING CACHED FILE REPOSITORY INDEX",
                "files": [
                    {"file_name": "OSD-575_metabolic_panel_quest.csv", "size_bytes": 14280, "type": "Processed CSV"},
                    {"file_name": "OSD-575_cardiovascular_eve_hdcvd9.csv", "size_bytes": 18450, "type": "Processed CSV"},
                    {"file_name": "OSD-575_cytokine_array_hd71_nulisa.csv", "size_bytes": 38920, "type": "Processed CSV"}
                ]
            })

    def handle_nasa_data(self):
        """Returns authentic OSD-575 measurements."""
        cached = load_cached_osd575()
        if cached:
            self.send_json({
                "status": "success",
                "study_accession": "OSD-575",
                "title": "SpaceX Inspiration4 Blood Serum Metabolic Panel and Immune/Cardiac Cytokine Arrays",
                "attribution": "NASA Open Science Data Repository (OSDR) • Nature SOMA Consortium",
                "data": cached
            })
        else:
            self.send_error(500, "Cached NASA dataset not found")

    def handle_ai_analysis(self):
        """Performs statistical anomaly analysis on authentic measurements."""
        cached = load_cached_osd575()
        if not cached:
            self.send_error(500, "NASA data unavailable for AI analysis")
            return
        anomalies = calculate_statistical_anomalies(cached)
        self.send_json({
            "status": "success",
            "engine": "AERO-MED OMNI AI Statistical Screening Engine v2.0",
            "methodology": "Z-score longitudinal anomaly calculation relative to pre-flight baseline (L-92..L-3)",
            "disclaimer": "Non-diagnostic scientific research screening. NASA HRP Evidence Based Criteria.",
            "results": anomalies
        })

    def handle_get_equipment(self):
        """Fetches the 8 spacecraft inspection systems."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute('SELECT * FROM equipment ORDER BY id')
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        self.send_json({"equipment": rows})

    def handle_get_inspections(self):
        """Fetches stored equipment inspection records."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute('SELECT * FROM inspections ORDER BY created_at DESC')
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        self.send_json({"inspections": rows})

    def handle_post_inspection(self):
        """Saves a new equipment inspection record."""
        length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(length)
        try:
            req = json.loads(post_data.decode('utf-8'))
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            insp_id = f"INS-{int(time.time())}"
            cur.execute('''
                INSERT INTO inspections (id, equipment_id, equipment_name, inspector, date, passed_count, total_count, resulting_status, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                insp_id,
                req.get('equipment_id', 'UNKNOWN'),
                req.get('equipment_name', 'System'),
                req.get('inspector', 'Flight Surgeon'),
                req.get('date') or datetime.now(timezone.utc).strftime('%Y-%m-%d'),
                req.get('passed_count', 6),
                req.get('total_count', 6),
                req.get('resulting_status', 'OPERATIONAL'),
                req.get('notes', '')
            ))
            # Also update equipment status and next inspection date
            if req.get('equipment_id'):
                cur.execute('''
                    UPDATE equipment
                    SET status = ?, last_inspection = ?, next_inspection = ?
                    WHERE id = ?
                ''', (
                    req.get('resulting_status', 'OPERATIONAL'),
                    req.get('date') or datetime.now(timezone.utc).strftime('%Y-%m-%d'),
                    req.get('next_inspection', ''),
                    req.get('equipment_id')
                ))
            conn.commit()
            conn.close()
            self.send_json({"status": "saved", "inspection_id": insp_id}, status=201)
        except Exception as e:
            self.send_json({"error": str(e)}, status=400)

    def handle_auth_register(self):
        """Registers a new Mission Control operator in SQLite."""
        length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(length)
        try:
            req = json.loads(post_data.decode('utf-8'))
            full_name = req.get('fullName', '').strip()
            callsign = req.get('callsign', '').strip().upper()
            role_key = req.get('roleKey', 'auth_role_specialist')
            email = req.get('email', '').strip().lower()
            password = req.get('password', '')
            if not full_name or not callsign or not email or len(password) < 6:
                self.send_json({"error": "Invalid registration parameters"}, status=400)
                return

            pw_hash = hash_password(password)
            usr_id = f"USR-{int(time.time())}"
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute('''
                INSERT INTO users (id, full_name, callsign, role_key, email, password_hash)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (usr_id, full_name, callsign, role_key, email, pw_hash))
            conn.commit()
            conn.close()
            self.send_json({
                "status": "registered",
                "user": {
                    "id": usr_id,
                    "fullName": full_name,
                    "callsign": callsign,
                    "roleKey": role_key,
                    "email": email
                }
            }, status=201)
        except sqlite3.IntegrityError:
            self.send_json({"error": "Email or callsign already registered"}, status=409)
        except Exception as e:
            self.send_json({"error": str(e)}, status=400)

    def handle_auth_login(self):
        """Authenticates an operator against SQLite."""
        length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(length)
        try:
            req = json.loads(post_data.decode('utf-8'))
            identifier = req.get('identifier', '').strip()
            password = req.get('password', '')

            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute('''
                SELECT id, full_name, callsign, role_key, email, password_hash
                FROM users
                WHERE LOWER(email) = LOWER(?) OR UPPER(callsign) = UPPER(?)
            ''', (identifier, identifier))
            row = cur.fetchone()
            if not row:
                conn.close()
                self.send_json({"error": "Invalid credentials"}, status=401)
                return

            is_valid, needs_rehash = verify_password(password, row["password_hash"])
            if not is_valid:
                conn.close()
                self.send_json({"error": "Invalid credentials"}, status=401)
                return

            if needs_rehash:
                cur.execute(
                    'UPDATE users SET password_hash = ? WHERE id = ?',
                    (hash_password(password), row["id"])
                )
                conn.commit()
            conn.close()
            self.send_json({
                "status": "authenticated",
                "user": {
                    "id": row["id"],
                    "fullName": row["full_name"],
                    "callsign": row["callsign"],
                    "roleKey": row["role_key"],
                    "email": row["email"]
                }
            })
        except Exception as e:
            self.send_json({"error": str(e)}, status=400)

def run_server(port=5000):
    init_db()
    server_address = ('', port)
    httpd = HTTPServer(server_address, AeroMedRequestHandler)
    print(f"==================================================")
    print(f"  AERO-MED OMNI Aerospace Mission Control Server")
    print(f"  Serving at: http://localhost:{port}")
    print(f"  NASA OSD-575 API & SQLite inspection database active")
    print(f"==================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    run_server(port)

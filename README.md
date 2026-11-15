# AERO-MED OMNI // Aerospace Medical Monitoring & Spacecraft Inspection Platform

> **NASA Space Apps Challenge Presentation Prototype**  
> Centralized mission-control platform combining authentic **NASA Open Science Data Repository (OSDR OSD-575)** multi-omics astronaut research, real-time physiological telemetry simulation, statistical AI anomaly screening, and spacecraft critical systems inspection.

---

## Key Features

### 1. Official NASA OSDR Integration (Study OSD-575)
- **Dataset:** `OSD-575` — *SpaceX Inspiration4 Blood Serum Metabolic Panel and Immune/Cardiac Cytokine Arrays*.
- **Authentic Scientific Preservation:** Real subject IDs (`C001`, `C002`, `C003`, `C004`), flight collection timepoints (`L-92`, `L-44`, `L-3`, `R+1`, `R+45`, `R+82`), clinical units (`mg/dL`, `U/L`, `ug/mL`, `ng/mL`, `pg/mL`), and assay platforms (*Quest Diagnostics CMP*, *Eve Technologies HDCVD9*, *Eve Technologies HD71 / Alamar NULISA*).
- **Live + Graceful Offline Fallback:** Queries official NASA OSDR REST endpoints (`/osdr/data/osd/meta/575`, `/osdr/data/osd/files/575`) when online and falls back to the verified local authentic dataset cache (`data/osd575_data.json` and `.csv` tables) when offline or CORS-restricted, never fabricating missing data.

### 2. NASA Scientific Data Center
- Interactive longitudinal Plotly.js visualization across all flight phases (`L-92` through `R+82`) with automatic offline Canvas fallback.
- Research categories:
  - **A. Comprehensive Metabolic Panel (CMP)**
  - **B. Cardiovascular Biomarkers (HDCVD9)**
  - **C. Immune & Cytokine Biomarkers (HD71 / NULISA)**
  - **D. Historical Research Analysis** (pre-flight baseline, immediate reentry R+1 surge, and R+45/R+82 recovery).

### 3. Real-Time Crew Health Monitoring
- Monitors 4 crew members with individual heart rate, SpO2, blood pressure, core temperature, and radiation exposure.
- Real-time multi-channel physiological oscilloscope (ECG, SpO2 photoplethysmogram, Respiration) running at 25 mm/s.
- Interactive simulation scenarios: **Nominal Orbit**, **EVA Exertion**, **Hypoxia Alert**, and **Thermal/BP Spike**, plus manual slider overrides.
- Strictly distinguished as **SIMULATED LIVE TELEMETRY**.

### 4. AI Medical Research Analysis Engine
- Statistical Z-score anomaly screening computing pre-flight baseline means, standard deviations, and R+1 post-flight deltas across OSD-575 cohorts.
- Dynamic operational astronaut risk scoring and non-diagnostic flight surgeon recommendations mapped to NASA Human Research Program (HRP) 5 hazards.

### 5. Spacecraft Equipment Inspection (8 Critical Systems)
Monitors and audits 8 mission-critical systems:
1. Oxygen Supply System (`EQ-SYS-O2`)
2. Environmental Control and Life Support (`EQ-SYS-ECLSS`)
3. Medical Monitoring Devices (`EQ-SYS-MED`)
4. Emergency Medical Equipment (`EQ-SYS-EMK`)
5. Temperature Regulation System (`EQ-SYS-TEMP`)
6. Communication Systems (`EQ-SYS-COMM`)
7. Power Supply and Battery Subsystem (`EQ-SYS-PWR`)
8. Radiation Monitoring Sensors (`EQ-SYS-RAD`)

Includes a 6-point digital verification checklist, maintenance logging, SQLite API persistence (`server.py`), and browser `localStorage` persistence.

### 6. 6-Screen Mission Control Presentation Mode (For Judges)
Launch via **★ Presentation Mode** in the top navigation bar or Settings:
- **Keyboard Controls:** `ArrowRight` / `Space` (Next), `ArrowLeft` (Previous), `Escape` (Exit).
- Walks judges sequentially through Project Architecture, NASA OSDR Integration, Health Monitoring, AI Screening Engine, Equipment Inspection, and Hackathon Impact.

### 7. Complete Trilingual Localization (EN / RU / AZ)
Real-time switching between **English (EN)**, **Russian (RU)**, and **Azerbaijani (AZ)** across every menu, chart, badge, alert, checklist, report, and presentation slide.

---

## Project Architecture

```text
astronaut-health-monitor/
├── index.html                 # Main Mission Control shell & 8 functional modules + Presentation Mode
├── style.css                  # Aerospace dark navy UI, responsive grid & presentation styles
├── data.js                    # Authentic OSD-575 cohort JSON, 8 systems, crew & EN/RU/AZ i18n
├── app.js                     # Application controller, Plotly/Canvas charts, AI engine, checklists
├── server.py                  # Python HTTP + SQLite API server + live NASA OSDR fetcher
├── requirements.txt           # Optional Python data-science packages
├── README.md                  # Documentation
└── data/
    ├── osd575_metadata.json   # Study metadata & subject descriptors
    ├── osd575_data.json       # Consolidated scientific dataset
    ├── osd575_cmp.csv         # Quest Diagnostics Comprehensive Metabolic Panel CSV
    ├── osd575_cardio.csv      # Eve Tech HDCVD9 Cardiovascular Biomarkers CSV
    └── osd575_cytokines.csv   # Eve Tech HD71 / NULISA Immune Cytokines CSV
```

---

## Setup & Execution

### Option A: Instant Standalone Launch (Zero Dependencies)
Simply double-click `index.html` (or serve via any static server). All authentic NASA OSD-575 data, statistical analysis, Plotly/Canvas fallback charts, and interactive checklists work 100% offline.

### Option B: Run with Python Backend & SQLite Database
Requires Python 3.8+. Optional packages in `requirements.txt`.
```bash
# Start backend server on port 5000
python server.py
```
Then open `http://localhost:5000` in your browser.

---

## Data Attribution & Ethics
- **NASA Scientific Data:** Sourced from NASA Open Science Data Repository study **OSD-575** (Space Omics and Medical Atlas / Inspiration4).
- **Non-Diagnostic Notice:** AI screening calculations and physiological simulations are designed exclusively for operational telemetry research and hackathon demonstration purposes, not clinical diagnosis.

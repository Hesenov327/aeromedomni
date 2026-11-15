/**
 * AERO-MED OMNI // Application Controller
 * Features:
 * - Full Trilingual Engine (EN / RU / AZ) with 0 untranslated strings
 * - NASA Scientific Data Center (OSDR OSD-575) with Plotly.js + Offline Canvas fallback
 * - Real-time Telemetry Simulation, ECG/SpO2 Oscilloscope & 3D Orbit Canvas
 * - AI Medical Research Screening Engine (Z-Score Longitudinal + Operational)
 * - 8-System Spacecraft Inspection Workflow (SQLite API + localStorage persistence)
 * - 6-Screen Mission Control Presentation Mode for Judges (ArrowLeft/ArrowRight/Escape)
 */

// ==================== APPLICATION STATE ====================
let settings = loadFromStorage(STORAGE_KEYS.SETTINGS, {
    lang: 'az',
    theme: 'dark',
    rateMs: 1000,
    tempUnit: 'C',
    reducedMotion: false,
    toasts: true,
    audio: false,
    volume: 60
});

let crewMembers = cloneDeep(INITIAL_CREW);
let equipmentList = loadFromStorage(STORAGE_KEYS.EQUIPMENT, INITIAL_EQUIPMENT);
let inspectionRecords = loadFromStorage(STORAGE_KEYS.INSPECTIONS, INITIAL_INSPECTIONS);
let activityLogs = loadFromStorage(STORAGE_KEYS.ACTIVITIES, [
    {
        time: 'T+42:18:05',
        level: 'INFO',
        msgEn: 'NASA OSDR OSD-575 longitudinal cohort cache verified (4 subjects, 6 timepoints).',
        msgRu: 'Локальный кэш NASA OSDR OSD-575 проверен (4 участника, 6 временных точек).',
        msgAz: 'NASA OSDR OSD-575 elmi məlumat keşi təsdiqləndi (4 iştirakçı, 6 zaman nöqtəsi).'
    },
    {
        time: 'T+42:17:40',
        level: 'WARN',
        msgEn: 'EQ-SYS-RAD (Radiation Monitoring Sensors): Node 2 calibration drift flagged (+0.08 mSv).',
        msgRu: 'EQ-SYS-RAD (Датчики радиации): зафиксирован дрейф калибровки узла 2 (+0.08 мЗв).',
        msgAz: 'EQ-SYS-RAD (Radiasiya Sensorları): Node 2 kalibrləmə sapması qeydə alınıb (+0.08 mSv).'
    },
    {
        time: 'T+42:16:12',
        level: 'INFO',
        msgEn: 'Eng. Tural Aliyev (ASN-9043) commenced Airlock-2 EVA preparation.',
        msgRu: 'Инж. Турал Алиев (ASN-9043) начал подготовку к выходу ВКД в шлюзе-2.',
        msgAz: 'Müh. Tural Əliyev (ASN-9043) Şlyuz-2 EVA hazırlığına başladı.'
    }
]);

let activeSection = 'sec-overview';
let selectedCrewId = crewMembers[0].id;
let selectedAiCrewId = crewMembers[0].id;
let aiAlertFilter = 'ALL';
let activeNasaTab = 'cmp';
let activeNasaBioId = NASA_OSD575_DATA.cmp.biomarkers[0].id;
let activeNasaSubject = 'cohort_mean';
let activeReportTab = 'health';

let streamPaused = false;
let speStormActive = false;
let lastRadiationStatus = 'NORMAL'; // State Change Flag: 'NORMAL' | 'CRITICAL'
let telemetryTimer = null;
let animFrameId = null;
let oscPhase = 0;
let orbitAngle = 0;
let presIndex = 0;
let alarmMuteUntil = Number(localStorage.getItem('aeromed_alarm_mute_until') || 0);
let muteCountdownTimer = null;
let sharedAudioCtx = null;
let speShieldPct = 100;
let speShelterEndsAt = 0;
let isOfflineFallbackMode = false;
let offlineNoticeShown = false;

// ==================== TRILINGUAL HELPER FUNCTIONS ====================
function getLang() {
    return ['en', 'ru', 'az'].includes(settings.lang) ? settings.lang : 'az';
}

function t(key) {
    const lang = getLang();
    return (I18N[lang] && I18N[lang][key]) || (I18N.en && I18N.en[key]) || key;
}

function trLang(enStr, ruStr, azStr) {
    const lang = getLang();
    if (lang === 'ru') return ruStr || enStr;
    if (lang === 'az') return azStr || enStr;
    return enStr;
}

function trField(obj, baseField) {
    if (!obj) return '';
    const lang = getLang();
    const suffix = lang === 'ru' ? 'Ru' : (lang === 'az' ? 'Az' : 'En');
    return obj[baseField + suffix] || obj[baseField + 'En'] || obj[baseField] || '';
}

function trStatus(status) {
    const map = {
        'OPERATIONAL': 'st_OPERATIONAL',
        'WARNING': 'st_WARNING',
        'MAINTENANCE REQUIRED': 'st_MAINTENANCE',
        'OFFLINE': 'st_OFFLINE',
        'NOMINAL': 'st_NOMINAL',
        'CAUTION': 'st_CAUTION',
        'CRITICAL': 'st_CRITICAL',
        'LOW': 'st_LOW',
        'MEDIUM': 'st_MEDIUM',
        'HIGH': 'st_HIGH',
        'NORMAL': 'st_NORMAL',
        'ELEVATED': 'st_ELEVATED',
        'ALERT': 'st_ALERT'
    };
    return map[status] ? t(map[status]) : status;
}

function trCategory(cat) {
    if (!cat) return '';
    const key = 'cat_' + cat.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/_$/, '');
    const translated = t(key);
    return translated !== key ? translated : cat;
}

function formatTemp(tempC) {
    if (settings.tempUnit === 'F') {
        return ((tempC * 9 / 5) + 32).toFixed(1);
    }
    return tempC.toFixed(1);
}

function getTempUnit() {
    return settings.tempUnit === 'F' ? '°F' : '°C';
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function addActivityLog(level, msgEn, msgRu, msgAz) {
    const clock = document.getElementById('met-clock')?.textContent?.replace('T+ ', 'T+') || 'T+42:18:15';
    activityLogs.unshift({
        time: clock.slice(0, 11),
        level,
        msgEn,
        msgRu: msgRu || msgEn,
        msgAz: msgAz || msgEn
    });
    if (activityLogs.length > 40) activityLogs.pop();
    saveToStorage(STORAGE_KEYS.ACTIVITIES, activityLogs);
}

function showToast(title, message, level = 'low') {
    if (!settings.toasts) return;
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast-item ${level}`;
    el.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>`;
    stack.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.25s ease';
        setTimeout(() => el.remove(), 260);
    }, 3800);
}

function isAlarmMuted() {
    if (alarmMuteUntil > Date.now()) return true;
    if (alarmMuteUntil > 0) {
        alarmMuteUntil = 0;
        localStorage.removeItem('aeromed_alarm_mute_until');
    }
    return false;
}

function updateMuteButtonsUI() {
    const muted = isAlarmMuted();
    const btns = [
        { id: 'mute-alarm-btn', defaultKey: 'btn_mute_5m' },
        { id: 'alerts-mute-btn', defaultKey: 'btn_mute_5m' },
        { id: 'settings-mute-btn', defaultKey: 'btn_mute_alarm_full' }
    ];
    let textSuffix = '';
    if (muted) {
        const secLeft = Math.max(1, Math.ceil((alarmMuteUntil - Date.now()) / 1000));
        const mm = String(Math.floor(secLeft / 60)).padStart(2, '0');
        const ss = String(secLeft % 60).padStart(2, '0');
        textSuffix = ` (${mm}:${ss})`;
    }
    btns.forEach(({ id, defaultKey }) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.toggle('is-muted', muted);
        btn.textContent = muted ? `${t('btn_mute_active_prefix')}${textSuffix}` : t(defaultKey);
    });
}

function toggleAlarmMute() {
    if (isAlarmMuted()) {
        alarmMuteUntil = 0;
        localStorage.removeItem('aeromed_alarm_mute_until');
        addActivityLog(
            'INFO',
            'Critical alarm audio mute cancelled manually; emergency siren armed.',
            'Ручное отключение звука тревог снято; сирена снова активна.',
            'Kritik siqnalların susdurulması ləğv edildi; fövqəladə siren yenidən aktivdir.'
        );
        showToast(t('toast_unmuted_title'), t('toast_unmuted_body'), 'low');
    } else {
        alarmMuteUntil = Date.now() + 5 * 60 * 1000;
        localStorage.setItem('aeromed_alarm_mute_until', String(alarmMuteUntil));
        addActivityLog(
            'WARN',
            'Critical audio alarms muted for 5:00 minutes by operator.',
            'Критические звуковые тревоги заглушены оператором на 5:00 мин.',
            'Kritik səsli siqnallar operator tərəfindən 5:00 dəqiqəliyə susduruldu.'
        );
        showToast(t('toast_muted_title'), t('toast_muted_body'), 'medium');
    }
    updateMuteButtonsUI();
}

function startMuteCountdownLoop() {
    if (muteCountdownTimer) clearInterval(muteCountdownTimer);
    muteCountdownTimer = setInterval(() => {
        updateMuteButtonsUI();
        if (speStormActive) {
            speShieldPct = Math.max(42, +(speShieldPct - 0.35).toFixed(1));
        }
        updateSpeHudUI();
    }, 1000);
    updateMuteButtonsUI();
    updateSpeHudUI();
}

function playBeep(options = {}) {
    const isTest = !!(options && (options.isTest || typeof options.preventDefault === 'function'));
    if (!isTest && isAlarmMuted()) return;

    const volPct = Math.max(0, Math.min(100, Number(settings.volume ?? 60)));
    if (volPct <= 0) return;

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
        if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});

        const ctx = sharedAudioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const peak = (volPct / 100) * 0.25;

        osc.type = options && options.siren ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        if (options && options.siren) {
            osc.frequency.setValueAtTime(660, ctx.currentTime + 0.14);
        }

        gain.gain.setValueAtTime(peak, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.32);
    } catch (_) {}
}

// ==================== CREW RISK EVALUATION ====================
function evaluateAstronaut(astro) {
    const v = astro.vitals;
    const b = astro.baseline;
    const hrDelta = Math.round(v.hr - b.hr);

    let score = 100;
    const reasonsEn = [];
    const reasonsRu = [];
    const reasonsAz = [];
    const actionsEn = [];
    const actionsRu = [];
    const actionsAz = [];

    if (v.spo2 < 90) {
        score -= 42;
        reasonsEn.push(`Critical blood oxygen drop: SpO2 at ${v.spo2.toFixed(1)}% (hypoxia threshold < 90%).`);
        reasonsRu.push(`Критическое снижение кислорода: SpO2 ${v.spo2.toFixed(1)}% (порог гипоксии < 90%).`);
        reasonsAz.push(`Kritik oksigen düşməsi: SpO2 ${v.spo2.toFixed(1)}% (hipoksiya həddi < 90%).`);
        actionsEn.push('Administer immediate supplemental 100% O2 and verify cabin ECLSS pCO2.');
        actionsRu.push('Немедленно подать 100% кислород и проверить уровень pCO2 в системе СОЖ.');
        actionsAz.push('Dərhal əlavə 100% O2 verin və kabin ECLSS pCO2 səviyyəsini yoxlayın.');
    } else if (v.spo2 < 95) {
        score -= 18;
        reasonsEn.push(`Mild SpO2 reduction (${v.spo2.toFixed(1)}%) below 95% nominal band.`);
        reasonsRu.push(`Умеренное снижение SpO2 (${v.spo2.toFixed(1)}%) ниже нормы 95%.`);
        reasonsAz.push(`SpO2 göstəricisinin 95% normasından yüngül aşağı düşməsi (${v.spo2.toFixed(1)}%).`);
        actionsEn.push('Monitor respiratory rate and check cabin O2 partial pressure.');
        actionsRu.push('Контролировать частоту дыхания и парциальное давление O2.');
        actionsAz.push('Tənəffüs tezliyini izləyin və kabin O2 təzyiqini yoxlayın.');
    }

    if (v.hr > 125 || v.hr < 48) {
        score -= 28;
        reasonsEn.push(`Severe heart rate deviation (${Math.round(v.hr)} BPM vs baseline ${b.hr} BPM).`);
        reasonsRu.push(`Выраженное отклонение пульса (${Math.round(v.hr)} уд/мин при норме ${b.hr}).`);
        reasonsAz.push(`Ürək döyüntüsünün kəskin kənarlaşması (${Math.round(v.hr)} BPM, baza ${b.hr} BPM).`);
        actionsEn.push('Switch bio-monitor to continuous 12-lead ECG telemetry & reduce physical workload.');
        actionsRu.push('Переключить биомонитор на непрерывную ЭКГ и снизить физическую нагрузку.');
        actionsAz.push('Bio-monitoru fasiləsiz EKQ rejiminə keçirin və fiziki yükü azaldın.');
    } else if (Math.abs(hrDelta) >= 20) {
        score -= 14;
        reasonsEn.push(`Elevated workload heart rate (${Math.round(v.hr)} BPM, ${hrDelta > 0 ? '+' : ''}${hrDelta} BPM above baseline).`);
        reasonsRu.push(`Повышенная ЧСС при нагрузке (${Math.round(v.hr)} уд/мин, ${hrDelta > 0 ? '+' : ''}${hrDelta} от базы).`);
        reasonsAz.push(`Yüklənmə zamanı yüksəlmiş nəbz (${Math.round(v.hr)} BPM, bazadan ${hrDelta > 0 ? '+' : ''}${hrDelta}).`);
        actionsEn.push('Verify hydration status and LCVG cooling loop if in EVA prep.');
        actionsRu.push('Проверить гидратацию и контур охлаждения LCVG при подготовке к ВКД.');
        actionsAz.push('EVA hazırlığı zamanı maye balansını və LCVG soyutma sistemini yoxlayın.');
    }

    if (v.temp >= 38.2) {
        score -= 24;
        reasonsEn.push(`Elevated core temperature (${v.temp.toFixed(1)} °C) suggesting febrile/thermal stress.`);
        reasonsRu.push(`Повышенная температура тела (${v.temp.toFixed(1)} °C): термический или инфекционный стресс.`);
        reasonsAz.push(`Yüksək bədən temperaturu (${v.temp.toFixed(1)} °C): termal və ya febril stress əlaməti.`);
        actionsEn.push('Conduct flight surgeon immune cytokine panel check (referencing OSD-575 IL-6/CRP bounds).');
        actionsRu.push('Провести проверку цитокинов (согласно референсам OSD-575 ИЛ-6/СРБ).');
        actionsAz.push('Uçuş həkimi tərəfindən sitokin yoxlaması aparın (OSD-575 IL-6/CRP əsasında).');
    } else if (v.temp >= 37.3) {
        score -= 8;
        reasonsEn.push(`Slight thermal elevation (${v.temp.toFixed(1)} °C) consistent with suit/EVA exertion.`);
        reasonsRu.push(`Небольшой подъём температуры (${v.temp.toFixed(1)} °C) при работе в скафандре.`);
        reasonsAz.push(`Skafandr iş yükünə uyğun yüngül hərarət artımı (${v.temp.toFixed(1)} °C).`);
    }

    if (v.sys >= 145) {
        score -= 18;
        reasonsEn.push(`Hypertensive blood pressure spike (${Math.round(v.sys)}/${Math.round(v.dia)} mmHg).`);
        reasonsRu.push(`Гипертензивный скачок АД (${Math.round(v.sys)}/${Math.round(v.dia)} мм рт. ст.).`);
        reasonsAz.push(`Yüksək qan təzyiqi sıçrayışı (${Math.round(v.sys)}/${Math.round(v.dia)} mmHg).`);
        actionsEn.push('Halt physical workload and contact Flight Surgeon for blood pressure stabilization.');
        actionsRu.push('Снизить нагрузку и согласовать стабилизацию АД с врачом полёта.');
        actionsAz.push('Fiziki yükü dayandırın və qan təzyiqini sabitləşdirmək üçün uçuş həkimi ilə əlaqə saxlayın.');
    } else if (v.sys < 90) {
        score -= 28;
        reasonsEn.push(`Critical hypotension detected (${Math.round(v.sys)}/${Math.round(v.dia)} mmHg).`);
        reasonsRu.push(`Критическая гипотензия (${Math.round(v.sys)}/${Math.round(v.dia)} мм рт. ст.).`);
        reasonsAz.push(`Kritik hipotenziya aşkarlandı (${Math.round(v.sys)}/${Math.round(v.dia)} mmHg).`);
        actionsEn.push('Administer 200 mL IV normal saline bolus and place crew member supine.');
        actionsRu.push('Выполнить В/в инфузию 200 мл физраствора и придать горизонтальное положение.');
        actionsAz.push('Tövsiyə olunan tədbir: 200 ml İV maye köçürülməsi (fizioloji məhlul) və horizontal istirahət.');
    } else if (v.sys < 96) {
        score -= 14;
        reasonsEn.push(`Low systolic blood pressure (${Math.round(v.sys)}/${Math.round(v.dia)} mmHg).`);
        reasonsRu.push(`Пониженное систолическое АД (${Math.round(v.sys)}/${Math.round(v.dia)} мм рт. ст.).`);
        reasonsAz.push(`Aşağı sistolik qan təzyiqi (${Math.round(v.sys)}/${Math.round(v.dia)} mmHg).`);
        actionsEn.push('Initiate 200 mL IV rehydration protocol and monitor orthostatic stability.');
        actionsRu.push('Начать В/в регидратацию (200 мл) и контролировать гемодинамику.');
        actionsAz.push('Tövsiyə olunan tədbir: 200 ml İV maye köçürülməsi və hemodinamik nəzarət.');
    }

    if (astro.radiation.rate >= 2.0) {
        score -= 25;
        reasonsEn.push(`High solar particle event radiation dose rate (${astro.radiation.rate.toFixed(2)} mSv/day).`);
        reasonsRu.push(`Высокий уровень радиации от солнечной бури (${astro.radiation.rate.toFixed(2)} мЗв/сут).`);
        reasonsAz.push(`Günəş hissəcik hadisəsi nəticəsində yüksək radiasiya (${astro.radiation.rate.toFixed(2)} mSv/gün).`);
        actionsEn.push('Direct crew to shielded storm shelter inside Command Module immediately.');
        actionsRu.push('Немедленно укрыть экипаж в радиационном убежище командного отсека.');
        actionsAz.push('Ekipajı dərhal Komanda Modulunun radiasiya sığınacağına yönəldin.');
    }

    score = Math.max(5, Math.min(100, score));
    let risk = 'LOW';
    let status = 'NOMINAL';
    if (score < 60) {
        risk = 'HIGH';
        status = 'CRITICAL';
    } else if (score < 85) {
        risk = 'MEDIUM';
        status = 'CAUTION';
    }

    if (reasonsEn.length === 0) {
        reasonsEn.push('All biometric telemetry channels remain tightly coupled to personal pre-flight baseline.');
        reasonsRu.push('Все биометрические каналы находятся в строгом соответствии с предполетной нормой.');
        reasonsAz.push('Bütün biometrik telemetriya kanalları fərdi uçuş bazası daxilində tam stabildir.');
        actionsEn.push('Continue standard 1 Hz orbital biometric monitoring.');
        actionsRu.push('Продолжать штатный орбитальный биомониторинг на частоте 1 Гц.');
        actionsAz.push('Standart 1 Hz orbital biometrik monitorinqi davam etdirin.');
    }

    return {
        score,
        risk,
        status,
        hrDelta,
        explanation: trLang(reasonsEn.join(' '), reasonsRu.join(' '), reasonsAz.join(' ')),
        followups: trLang(actionsEn, actionsRu, actionsAz)
    };
}

// ==================== OFFLINE / FILE:// MODE DETECTION ====================
function isFileProtocol() {
    return typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';
}

function activateOfflineMode(withToast = true) {
    isOfflineFallbackMode = true;
    const banner = document.getElementById('offline-mode-banner');
    if (banner) banner.classList.remove('hidden');

    if (withToast && !offlineNoticeShown) {
        offlineNoticeShown = true;
        addActivityLog(
            'INFO',
            'Switched gracefully to localStorage offline mode (backend unavailable or opened via file://).',
            'Система переведена в автономный режим localStorage (сервер недоступен или открыто через file://).',
            'Sistem zərif şəkildə localStorage oflayn rejiminə keçdi (Flask serveri aktiv deyil və ya file:// ilə açılıb).'
        );
        showToast(t('offline_toast_title'), t('offline_toast_body'), 'low');
        if (activeSection === 'sec-overview') renderOverview();
    }
}

async function checkBackendConnectivity() {
    document.getElementById('offline-banner-close')?.addEventListener('click', () => {
        document.getElementById('offline-mode-banner')?.classList.add('hidden');
    });

    if (isFileProtocol()) {
        activateOfflineMode(true);
        return false;
    }

    try {
        const res = await fetch('/api/equipment', { method: 'GET' });
        if (!res.ok) {
            activateOfflineMode(true);
            return false;
        }
        return true;
    } catch (_) {
        activateOfflineMode(true);
        return false;
    }
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    bindNavigation();
    bindSettingsControls();
    bindCrewControls();
    bindNasaDataCenter();
    bindInspectionControls();
    bindAiControls();
    bindEnvironmentControls();
    bindReportsControls();
    bindPresentationMode();
    bindModalControls();

    // Sync initial language & theme across UI
    applyTheme();
    applyLanguage();
    renderAllViews();
    checkBackendConnectivity();

    startTelemetryLoop();
    startAnimations();
});

// ==================== NAVIGATION & LANGUAGE SYNC ====================
function bindNavigation() {
    const sidebar = document.getElementById('sidebar');
    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => sidebar.classList.add('open'));
    document.getElementById('sidebar-close-btn')?.addEventListener('click', () => sidebar.classList.remove('open'));

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-section');
            switchSection(target);
            sidebar.classList.remove('open');
        });
    });

    document.querySelectorAll('[data-goto]').forEach(btn => {
        btn.addEventListener('click', () => {
            switchSection(btn.getAttribute('data-goto'));
        });
    });
}

function switchSection(sectionId) {
    if (!sectionId) return;
    activeSection = sectionId;

    document.querySelectorAll('.nav-item').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-section') === sectionId);
    });
    document.querySelectorAll('.view-section').forEach(sec => {
        sec.classList.toggle('active', sec.id === sectionId);
    });

    updatePageHeader();

    if (sectionId === 'sec-nasa-data') {
        renderNasaDataCenter();
    } else if (sectionId === 'sec-ai') {
        renderAISection();
    } else if (sectionId === 'sec-environment') {
        renderEnvironmentSection();
        requestAnimationFrame(() => resizeOrbitThree());
    } else if (sectionId === 'sec-reports') {
        renderReports();
    }
}

function updatePageHeader() {
    const map = {
        'sec-overview': ['sec_overview_title', 'sec_overview_sub'],
        'sec-crew': ['sec_crew_title', 'sec_crew_sub'],
        'sec-nasa-data': ['sec_nasa_data_title', 'sec_nasa_data_sub'],
        'sec-ai': ['sec_ai_title', 'sec_ai_sub'],
        'sec-inspection': ['sec_inspection_title', 'sec_inspection_sub'],
        'sec-environment': ['sec_environment_title', 'sec_environment_sub'],
        'sec-reports': ['sec_reports_title', 'sec_reports_sub'],
        'sec-settings': ['sec_settings_title', 'sec_settings_sub']
    };
    const [titleKey, subKey] = map[activeSection] || ['sec_overview_title', 'sec_overview_sub'];
    const headEl = document.getElementById('page-heading');
    const subEl = document.getElementById('page-subheading');
    if (headEl) headEl.textContent = t(titleKey);
    if (subEl) subEl.textContent = t(subKey);
}

function bindSettingsControls() {
    const topLang = document.getElementById('topbar-lang-select');
    const setLang = document.getElementById('set-lang');

    const handleLangChange = (newLang) => {
        settings.lang = newLang;
        saveToStorage(STORAGE_KEYS.SETTINGS, settings);
        applyLanguage();
        renderAllViews();
        showToast(
            trLang('Language Updated', 'Язык обновлён', 'Dil Dəyişdirildi'),
            trLang('Entire interface switched to English.', 'Интерфейс полностью переключён на русский.', 'Bütün proqram Azərbaycan dilinə keçirildi.')
        );
    };

    topLang?.addEventListener('change', (e) => handleLangChange(e.target.value));
    setLang?.addEventListener('change', (e) => handleLangChange(e.target.value));

    const themeSel = document.getElementById('set-theme');
    const topThemeBtn = document.getElementById('topbar-theme-btn');
    const setThemeMode = (nextTheme) => {
        settings.theme = nextTheme === 'light' ? 'light' : 'dark';
        saveToStorage(STORAGE_KEYS.SETTINGS, settings);
        applyTheme();
        if (activeSection === 'sec-nasa-data') renderNasaDataCenter();
        if (activeSection === 'sec-ai') renderAISection();
    };
    if (themeSel) {
        themeSel.value = settings.theme === 'light' ? 'light' : 'dark';
        themeSel.addEventListener('change', (e) => setThemeMode(e.target.value));
    }
    topThemeBtn?.addEventListener('click', () => {
        setThemeMode(settings.theme === 'light' ? 'dark' : 'light');
    });

    const rateSel = document.getElementById('set-rate');
    if (rateSel) {
        rateSel.value = String(settings.rateMs);
        rateSel.addEventListener('change', (e) => {
            settings.rateMs = Number(e.target.value) || 1000;
            saveToStorage(STORAGE_KEYS.SETTINGS, settings);
            startTelemetryLoop();
        });
    }

    const tempSel = document.getElementById('set-temp-unit');
    if (tempSel) {
        tempSel.value = settings.tempUnit;
        tempSel.addEventListener('change', (e) => {
            settings.tempUnit = e.target.value;
            saveToStorage(STORAGE_KEYS.SETTINGS, settings);
            renderAllViews();
        });
    }

    const motionChk = document.getElementById('set-reduced-motion');
    if (motionChk) {
        motionChk.checked = !!settings.reducedMotion;
        document.body.classList.toggle('reduced-motion', !!settings.reducedMotion);
        motionChk.addEventListener('change', (e) => {
            settings.reducedMotion = e.target.checked;
            document.body.classList.toggle('reduced-motion', settings.reducedMotion);
            saveToStorage(STORAGE_KEYS.SETTINGS, settings);
        });
    }

    const toastChk = document.getElementById('set-toasts');
    if (toastChk) {
        toastChk.checked = settings.toasts !== false;
        toastChk.addEventListener('change', (e) => {
            settings.toasts = e.target.checked;
            saveToStorage(STORAGE_KEYS.SETTINGS, settings);
        });
    }

    const audioChk = document.getElementById('set-audio');
    if (audioChk) {
        audioChk.checked = !!settings.audio;
        audioChk.addEventListener('change', (e) => {
            settings.audio = e.target.checked;
            saveToStorage(STORAGE_KEYS.SETTINGS, settings);
        });
    }

    const volSlider = document.getElementById('set-volume');
    const volLabel = document.getElementById('lbl-volume');
    const initVol = Math.max(0, Math.min(100, Number(settings.volume ?? 60)));
    if (volSlider) {
        volSlider.value = String(initVol);
        if (volLabel) volLabel.textContent = `${initVol}%`;
        volSlider.addEventListener('input', (e) => {
            const val = Math.max(0, Math.min(100, Number(e.target.value)));
            settings.volume = val;
            if (volLabel) volLabel.textContent = `${val}%`;
            saveToStorage(STORAGE_KEYS.SETTINGS, settings);
        });
    }

    ['mute-alarm-btn', 'alerts-mute-btn', 'settings-mute-btn'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', toggleAlarmMute);
    });
    startMuteCountdownLoop();

    document.getElementById('test-sound-btn')?.addEventListener('click', () => playBeep({ isTest: true, siren: true }));
    document.getElementById('set-start-demo-btn')?.addEventListener('click', () => openPresentationModal(0));
    document.getElementById('reset-all-btn')?.addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEYS.EQUIPMENT);
        localStorage.removeItem(STORAGE_KEYS.INSPECTIONS);
        localStorage.removeItem(STORAGE_KEYS.ACTIVITIES);
        crewMembers = cloneDeep(INITIAL_CREW);
        equipmentList = cloneDeep(INITIAL_EQUIPMENT);
        inspectionRecords = cloneDeep(INITIAL_INSPECTIONS);
        renderAllViews();
        showToast(
            trLang('Reset Complete', 'Сброс выполнен', 'Sıfırlama Tamamlandı'),
            trLang('All crew, equipment, and logs restored.', 'Данные экипажа, систем и журналов восстановлены.', 'Bütün ekipaj, avadanlıq və qeydlər bərpa olundu.')
        );
    });
}

function isLightTheme() {
    return settings.theme === 'light' || (typeof document !== 'undefined' && document.body.classList.contains('theme-light'));
}

function applyTheme() {
    const isLight = settings.theme === 'light';
    document.body.classList.toggle('theme-light', isLight);
    const themeSel = document.getElementById('set-theme');
    if (themeSel) themeSel.value = isLight ? 'light' : 'dark';
    const topBtn = document.getElementById('topbar-theme-btn');
    if (topBtn) {
        topBtn.textContent = isLight ? '🌙' : '☀️';
        topBtn.title = isLight ? t('opt_theme_dark') : t('opt_theme_light');
    }
}

function applyLanguage() {
    const lang = getLang();
    document.documentElement.lang = lang;

    const topLang = document.getElementById('topbar-lang-select');
    const setLang = document.getElementById('set-lang');
    if (topLang) topLang.value = lang;
    if (setLang) setLang.value = lang;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.setAttribute('placeholder', t(key));
    });

    updatePageHeader();
    updateGlobalStatusPill();
    updateSidebarStreamBadge();
    updateMuteButtonsUI();
    updateSpeHudUI();
    applyTheme();
}

function updateSidebarStreamBadge() {
    const badge = document.getElementById('sidebar-stream-badge');
    if (!badge) return;
    badge.textContent = streamPaused ? t('lbl_paused') : t('lbl_live_1hz');
    badge.className = streamPaused ? 'warn-text mono' : 'ok-text mono';
}

function updateGlobalStatusPill() {
    const pill = document.getElementById('global-status-pill');
    if (!pill) return;
    let worst = 'NOMINAL';
    let riskCls = 'low';

    crewMembers.forEach(c => {
        const evalRes = evaluateAstronaut(c);
        if (evalRes.risk === 'HIGH') {
            worst = 'CRITICAL';
            riskCls = 'high';
        } else if (evalRes.risk === 'MEDIUM' && riskCls !== 'high') {
            worst = 'CAUTION';
            riskCls = 'medium';
        }
    });

    pill.className = `mission-pill ${riskCls}`;
    pill.textContent = `${t('status_prefix')} ${trStatus(worst)}`;
}

function renderOperatorProfile() {
    const box = document.getElementById('operator-profile-box');
    if (!box) return;
    const session = typeof getActiveSession === 'function' ? getActiveSession() : null;
    if (session && session.fullName) {
        const initials = session.fullName
            .split(/\s+/)
            .filter(p => /^[A-Za-zƏəÖöÜüÇçŞşĞğİıА-Яа-я]/.test(p))
            .slice(-2)
            .map(p => p[0].toUpperCase())
            .join('') || 'OP';
        const roleLabel = session.roleKey ? t(session.roleKey) : t('auth_role_specialist');
        box.innerHTML = `
            <div class="op-row">
                <div class="avatar-sm">${escapeHtml(initials)}</div>
                <div class="op-info">
                    <strong>${escapeHtml(session.fullName)}</strong>
                    <span>${escapeHtml(session.callsign || 'OP')} • ${escapeHtml(roleLabel)}</span>
                </div>
            </div>
            <div class="op-actions">
                <button type="button" class="btn btn-sm btn-danger" id="btn-logout">${escapeHtml(t('auth_btn_logout'))}</button>
            </div>
        `;
        document.getElementById('btn-logout')?.addEventListener('click', () => {
            if (typeof clearActiveSession === 'function') clearActiveSession();
            window.location.href = 'login.html';
        });
    } else {
        box.innerHTML = `
            <div class="op-row">
                <div class="avatar-sm">OP</div>
                <div class="op-info">
                    <strong>${escapeHtml(t('auth_guest_name'))}</strong>
                    <span>${escapeHtml(t('auth_guest_role'))}</span>
                </div>
            </div>
            <div class="op-actions">
                <a href="login.html" class="btn btn-sm btn-cyan">${escapeHtml(t('auth_btn_login_short'))}</a>
                <a href="signup.html" class="btn btn-sm">${escapeHtml(t('auth_btn_signup_short'))}</a>
            </div>
        `;
    }
}

// ==================== RENDER ALL VIEWS ====================
function renderAllViews() {
    renderOperatorProfile();
    renderOverview();
    renderCrewSection();
    renderNasaDataCenter();
    renderAISection();
    renderInspectionSection();
    renderEnvironmentSection();
    renderReports();
    if (!document.getElementById('presentation-modal')?.classList.contains('hidden')) {
        renderPresentationSlide();
    }
}

// ==================== 1. OVERVIEW RENDERER ====================
function renderOverview() {
    let nominalCrew = 0;
    let alertCount = 0;
    crewMembers.forEach(c => {
        const ev = evaluateAstronaut(c);
        if (ev.risk === 'LOW') nominalCrew++;
        else alertCount++;
    });

    const opEq = equipmentList.filter(e => e.status === 'OPERATIONAL').length;
    const warnEq = equipmentList.length - opEq;
    alertCount += warnEq;

    const dashCrewTotal = document.getElementById('dash-crew-total');
    const dashCrewSub = document.getElementById('dash-crew-sub');
    const dashEqStatus = document.getElementById('dash-eq-status');
    const dashEqSub = document.getElementById('dash-eq-sub');
    const dashAlertCount = document.getElementById('dash-alert-count');
    const navEqWarn = document.getElementById('nav-eq-warn-badge');
    const navAiBadge = document.getElementById('nav-ai-badge');

    if (dashCrewTotal) dashCrewTotal.textContent = `${nominalCrew} / ${crewMembers.length}`;
    if (dashCrewSub) {
        dashCrewSub.textContent = `${nominalCrew} ${trStatus('NOMINAL')} • ${crewMembers.length - nominalCrew} ${trStatus('CAUTION')}`;
    }
    if (dashEqStatus) dashEqStatus.textContent = `${opEq} / ${equipmentList.length}`;
    if (dashEqSub) {
        dashEqSub.textContent = `${opEq} ${trStatus('OPERATIONAL')} • ${warnEq} ${trStatus('WARNING')}`;
    }
    if (dashAlertCount) dashAlertCount.textContent = String(alertCount);
    if (navEqWarn) navEqWarn.textContent = String(warnEq);
    renderAdvisorPanel('overview-ai-advisor-panel', 'overview-advisor-badge', 'overview-ai-advisor-body', crewMembers);

    // Worst AI risk
    let worstRisk = 'LOW';
    crewMembers.forEach(c => {
        const r = evaluateAstronaut(c).risk;
        if (r === 'HIGH') worstRisk = 'HIGH';
        else if (r === 'MEDIUM' && worstRisk !== 'HIGH') worstRisk = 'MEDIUM';
    });
    if (navAiBadge) {
        navAiBadge.className = `nav-badge ${worstRisk.toLowerCase()}`;
        navAiBadge.textContent = trStatus(worstRisk);
    }

    const dashMission = document.getElementById('dash-mission-status');
    if (dashMission) {
        dashMission.textContent = `${trStatus(worstRisk === 'HIGH' ? 'CRITICAL' : worstRisk === 'MEDIUM' ? 'CAUTION' : 'NOMINAL')} • FD-42`;
        dashMission.className = `kpi-val ${worstRisk === 'HIGH' ? 'crit-text' : worstRisk === 'MEDIUM' ? 'warn-text' : 'ok-text'}`;
    }

    // Crew Overview Cards
    const crewListEl = document.getElementById('dash-crew-list');
    if (crewListEl) {
        crewListEl.innerHTML = crewMembers.map(c => {
            const ev = evaluateAstronaut(c);
            const cls = ev.risk === 'HIGH' ? 'high' : ev.risk === 'MEDIUM' ? 'medium' : 'low';
            return `
                <div class="dash-crew-card" data-select-crew="${c.id}">
                    <div class="dcc-top">
                        <div class="dcc-id">
                            <div class="avatar-sm">${escapeHtml(c.initials)}</div>
                            <div>
                                <strong>${escapeHtml(c.name)}</strong>
                                <span class="muted">${escapeHtml(trField(c, 'role'))}</span>
                            </div>
                        </div>
                        <span class="risk-pill ${cls}">${trStatus(ev.status)}</span>
                    </div>
                    <div class="dcc-vitals mono">
                        <span>HR <b>${Math.round(c.vitals.hr)}</b></span>
                        <span>SpO₂ <b>${c.vitals.spo2.toFixed(1)}%</b></span>
                        <span>T° <b>${formatTemp(c.vitals.temp)}${getTempUnit()}</b></span>
                    </div>
                </div>
            `;
        }).join('');

        crewListEl.querySelectorAll('[data-select-crew]').forEach(card => {
            card.addEventListener('click', () => {
                selectedCrewId = card.getAttribute('data-select-crew');
                switchSection('sec-crew');
                renderCrewSection();
            });
        });
    }

    // Equipment Summary Bars
    const eqBarsEl = document.getElementById('dash-eq-bars');
    if (eqBarsEl) {
        eqBarsEl.innerHTML = equipmentList.map(eq => {
            const pct = eq.status === 'OPERATIONAL' ? 98 : eq.status === 'WARNING' ? 84 : eq.status === 'MAINTENANCE REQUIRED' ? 68 : 0;
            const barCol = eq.status === 'OPERATIONAL' ? 'var(--green)' : eq.status === 'WARNING' ? 'var(--amber)' : 'var(--red)';
            const fixBtn = eq.status !== 'OPERATIONAL'
                ? `<button type="button" class="btn btn-xs btn-recal" data-recal-eq="${eq.id}">${escapeHtml(t('btn_recalibrate_short'))}</button>`
                : '';
            return `
                <div class="eq-bar-row">
                    <div class="eq-bar-top">
                        <span>${escapeHtml(trField(eq, 'name'))}</span>
                        <div style="display:flex;align-items:center;gap:6px;">
                            ${fixBtn}
                            <span class="mono" style="color:${barCol}">${trStatus(eq.status)}</span>
                        </div>
                    </div>
                    <div class="eq-bar-track"><div class="eq-bar-fill" style="width:${pct}%;background:${barCol};"></div></div>
                </div>
            `;
        }).join('');
    }

    // Recent Activities
    const actEl = document.getElementById('dash-activity-list');
    if (actEl) {
        actEl.innerHTML = activityLogs.slice(0, 5).map(log => {
            const cls = log.level === 'CRIT' ? 'crit' : log.level === 'WARN' ? 'warn' : 'info';
            return `
                <div class="activity-row ${cls}">
                    <span class="mono muted">${escapeHtml(log.time)}</span>
                    <p>${escapeHtml(trField(log, 'msg'))}</p>
                </div>
            `;
        }).join('');
    }
}

// ==================== 2. CREW HEALTH SECTION ====================
function bindCrewControls() {
    document.getElementById('stream-pause-btn')?.addEventListener('click', () => {
        streamPaused = !streamPaused;
        const btn = document.getElementById('stream-pause-btn');
        if (btn) btn.textContent = streamPaused ? t('btn_resume_stream') : t('btn_pause_stream');
        updateSidebarStreamBadge();
    });

    document.querySelectorAll('.scen-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const astro = crewMembers.find(c => c.id === selectedCrewId);
            if (!astro) return;
            astro.mode = btn.getAttribute('data-mode');
            astro.manual = false;
            const chk = document.getElementById('manual-override-chk');
            if (chk) chk.checked = false;
            document.getElementById('sliders-group')?.classList.add('disabled');

            const prof = SCENARIO_PROFILES[astro.mode];
            if (prof) {
                astro.vitals.hr = prof.hr;
                astro.vitals.sys = prof.sys;
                astro.vitals.dia = prof.dia;
                astro.vitals.spo2 = prof.spo2;
                astro.vitals.temp = prof.temp;
                astro.radiation.rate = prof.rad;
            }
            addActivityLog('INFO',
                `${astro.name}: Simulation profile switched to ${astro.mode.toUpperCase()}.`,
                `${astro.name}: Сценарий симуляции переключён на ${astro.mode.toUpperCase()}.`,
                `${astro.name}: Simulyasiya rejimi ${astro.mode.toUpperCase()} olaraq dəyişdirildi.`
            );
            renderAllViews();
        });
    });

    const manualChk = document.getElementById('manual-override-chk');
    manualChk?.addEventListener('change', (e) => {
        const astro = crewMembers.find(c => c.id === selectedCrewId);
        if (!astro) return;
        astro.manual = e.target.checked;
        document.getElementById('sliders-group')?.classList.toggle('disabled', !astro.manual);
    });

    const bindSlider = (id, key, lblId, decimals = 0) => {
        document.getElementById(id)?.addEventListener('input', (e) => {
            const astro = crewMembers.find(c => c.id === selectedCrewId);
            if (!astro) return;
            astro.manual = true;
            if (manualChk) manualChk.checked = true;
            document.getElementById('sliders-group')?.classList.remove('disabled');
            const val = Number(e.target.value);
            astro.vitals[key] = val;
            if (key === 'sys') astro.vitals.dia = Math.round(val * 0.64);
            const lbl = document.getElementById(lblId);
            if (lbl) lbl.textContent = decimals > 0 ? val.toFixed(decimals) : String(Math.round(val));
            renderCrewMetricsOnly(astro);
            renderOverview();
        });
    };

    bindSlider('rng-hr', 'hr', 'lbl-hr', 0);
    bindSlider('rng-spo2', 'spo2', 'lbl-spo2', 1);
    bindSlider('rng-sys', 'sys', 'lbl-sys', 0);
    bindSlider('rng-temp', 'temp', 'lbl-temp', 1);
}

function renderCrewSection() {
    const bar = document.getElementById('crew-selector-bar');
    if (bar) {
        bar.innerHTML = crewMembers.map(c => {
            const ev = evaluateAstronaut(c);
            const cls = ev.risk === 'HIGH' ? 'high' : ev.risk === 'MEDIUM' ? 'medium' : 'low';
            return `
                <button class="crew-chip ${c.id === selectedCrewId ? 'active' : ''}" data-crew-id="${c.id}">
                    <div class="avatar-sm">${escapeHtml(c.initials)}</div>
                    <div style="text-align:left;min-width:0;">
                        <strong style="display:block;font-size:0.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.name)}</strong>
                        <span class="muted" style="font-size:0.7rem;">${escapeHtml(trField(c, 'role'))}</span>
                    </div>
                    <span class="risk-pill ${cls}" style="margin-left:auto;font-size:0.6rem;">${trStatus(ev.status)}</span>
                </button>
            `;
        }).join('');

        bar.querySelectorAll('.crew-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedCrewId = btn.getAttribute('data-crew-id');
                renderCrewSection();
            });
        });
    }

    const astro = crewMembers.find(c => c.id === selectedCrewId) || crewMembers[0];
    if (!astro) return;

    document.getElementById('crew-avatar').textContent = astro.initials;
    document.getElementById('crew-name').textContent = astro.name;
    document.getElementById('crew-id').textContent = astro.id;
    document.getElementById('crew-meta').textContent = `${trField(astro, 'role')} • ${trField(astro, 'location')} • ${t('lbl_blood_type')}: ${astro.bloodType}`;

    renderCrewMetricsOnly(astro);

    // Sync sliders & scenarios
    document.querySelectorAll('.scen-btn').forEach(b => {
        b.classList.toggle('active', !astro.manual && b.getAttribute('data-mode') === astro.mode);
    });
    const manualChk = document.getElementById('manual-override-chk');
    if (manualChk) manualChk.checked = !!astro.manual;
    document.getElementById('sliders-group')?.classList.toggle('disabled', !astro.manual);

    const setS = (id, lblId, val, dec) => {
        const el = document.getElementById(id);
        const lb = document.getElementById(lblId);
        if (el) el.value = val;
        if (lb) lb.textContent = dec > 0 ? Number(val).toFixed(dec) : String(Math.round(val));
    };
    setS('rng-hr', 'lbl-hr', astro.vitals.hr, 0);
    setS('rng-spo2', 'lbl-spo2', astro.vitals.spo2, 1);
    setS('rng-sys', 'lbl-sys', astro.vitals.sys, 0);
    setS('rng-temp', 'lbl-temp', astro.vitals.temp, 1);

    // History list
    const histEl = document.getElementById('crew-history-list');
    if (histEl) {
        histEl.innerHTML = astro.history.map(h => `
            <li>
                <span class="mono muted">${escapeHtml(h.date)}</span>
                <p>${escapeHtml(trField(h, 'note'))}</p>
            </li>
        `).join('');
    }
}

function renderCrewMetricsOnly(astro) {
    const ev = evaluateAstronaut(astro);
    const pill = document.getElementById('crew-status-pill');
    if (pill) {
        pill.className = `risk-pill ${ev.risk === 'HIGH' ? 'high' : ev.risk === 'MEDIUM' ? 'medium' : 'low'}`;
        pill.textContent = trStatus(ev.status);
    }

    const v = astro.vitals;
    document.getElementById('val-hr').textContent = Math.round(v.hr);
    document.getElementById('base-hr').textContent = astro.baseline.hr;
    document.getElementById('val-hrv').textContent = `${Math.round(v.hrv)} ms`;

    document.getElementById('val-spo2').textContent = v.spo2.toFixed(1);
    document.getElementById('val-co2').textContent = `${v.co2.toFixed(1)} mmHg`;

    document.getElementById('val-bp').textContent = `${Math.round(v.sys)}/${Math.round(v.dia)}`;
    const mapVal = Math.round((v.sys + 2 * v.dia) / 3);
    document.getElementById('val-map').textContent = `${mapVal} mmHg`;
    document.getElementById('val-rr').textContent = `${Math.round(v.rr)}/m`;

    document.getElementById('val-temp').textContent = formatTemp(v.temp);
    document.getElementById('unit-temp').textContent = getTempUnit();
    document.getElementById('val-rad').textContent = `${astro.radiation.rate.toFixed(2)} mSv/d`;

    // State badges
    const setBadge = (id, stateKey) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.className = `badge-state ${stateKey === 'ALERT' ? 'crit' : stateKey === 'ELEVATED' ? 'warn' : 'ok'}`;
        el.textContent = trStatus(stateKey);
    };
    setBadge('vstate-hr', (v.hr > 125 || v.hr < 48) ? 'ALERT' : Math.abs(v.hr - astro.baseline.hr) >= 20 ? 'ELEVATED' : 'NORMAL');
    setBadge('vstate-spo2', v.spo2 < 90 ? 'ALERT' : v.spo2 < 95 ? 'ELEVATED' : 'NORMAL');
    setBadge('vstate-bp', (v.sys >= 145 || v.sys < 90) ? 'ALERT' : (v.sys >= 132 || v.sys < 96) ? 'ELEVATED' : 'NORMAL');
    setBadge('vstate-temp', v.temp >= 38.2 ? 'ALERT' : v.temp >= 37.3 ? 'ELEVATED' : 'NORMAL');

    renderAdvisorPanel('crew-ai-advisor-panel', 'crew-advisor-badge', 'crew-ai-advisor-body', [astro]);
    updateCrewMannequin(astro);

    drawSparkline('spark-hr', astro.series.hr, '#00e5ff');
    drawSparkline('spark-spo2', astro.series.spo2, '#10b981');
    drawSparkline('spark-bp', astro.series.sys, '#38bdf8');
    drawSparkline('spark-temp', astro.series.temp, '#f59e0b');
}

function resolveCrewGender(astro) {
    if (astro?.gender === 'female' || astro?.gender === 'male') {
        return astro.gender;
    }
    const rawName = String(astro?.name || '').toLowerCase();
    const femaleHints = ['leyla', 'nargiz', 'nərgiz', 'aysel', 'gunel', 'sevinc', 'laman', 'sabina', 'fidan', 'elena', 'anna', 'sarah'];
    if (femaleHints.some(hint => rawName.includes(hint)) || /(ova|eva|ina)\b/.test(rawName)) {
        return 'female';
    }
    return 'male';
}

function bindMannequinInteractiveTilt() {
    if (bindMannequinInteractiveTilt._bound) return;
    const stage = document.getElementById('mannequin-stage');
    const wrap = document.getElementById('mannequin-figure-wrap');
    if (!stage || !wrap) return;
    bindMannequinInteractiveTilt._bound = true;

    stage.addEventListener('pointermove', (e) => {
        const rect = stage.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        wrap.style.transform = `rotateY(${(nx * 14).toFixed(1)}deg) rotateX(${(-ny * 8).toFixed(1)}deg)`;
    });
    stage.addEventListener('pointerleave', () => {
        wrap.style.transform = 'rotateY(0deg) rotateX(0deg)';
    });
}

function updateCrewMannequin(astro) {
    if (!astro) return;
    bindMannequinInteractiveTilt();

    const panel = document.getElementById('crew-mannequin-panel');
    const maleEl = document.getElementById('mannequin-model-male');
    const femaleEl = document.getElementById('mannequin-model-female');
    const genderBadge = document.getElementById('mannequin-gender-badge');
    const subjectLbl = document.getElementById('mannequin-subject-lbl');
    const riskChip = document.getElementById('mannequin-risk-chip');
    if (!panel || !maleEl || !femaleEl) return;

    const gender = resolveCrewGender(astro);
    const isFemale = gender === 'female';
    panel.setAttribute('data-gender', gender);
    maleEl.classList.toggle('hidden', isFemale);
    femaleEl.classList.toggle('hidden', !isFemale);

    if (genderBadge) {
        const gKey = isFemale ? 'mannequin_gender_female' : 'mannequin_gender_male';
        genderBadge.setAttribute('data-i18n', gKey);
        genderBadge.textContent = t(gKey);
        genderBadge.className = `badge-state mono ${isFemale ? 'warn' : 'ok'}`;
    }
    if (subjectLbl) subjectLbl.textContent = `${astro.name} • ${astro.id}`;

    const ev = evaluateAstronaut(astro);
    if (riskChip) riskChip.textContent = trStatus(ev.status);

    const v = astro.vitals;
    const hrLevel = (v.hr > 125 || v.hr < 48) ? 'crit' : Math.abs(v.hr - astro.baseline.hr) >= 20 ? 'warn' : 'ok';
    const spo2Level = v.spo2 < 90 ? 'crit' : v.spo2 < 95 ? 'warn' : 'ok';
    const bpLevel = (v.sys >= 145 || v.sys < 90) ? 'crit' : (v.sys >= 132 || v.sys < 96) ? 'warn' : 'ok';
    const tempLevel = v.temp >= 38.2 ? 'crit' : v.temp >= 37.3 ? 'warn' : 'ok';

    const syncNode = (nodeId, pillId, svgTxtId, chipId, valueText, level) => {
        const node = document.getElementById(nodeId);
        const pill = document.getElementById(pillId);
        const svgTxt = document.getElementById(svgTxtId);
        const chip = document.getElementById(chipId);
        if (node) {
            node.classList.toggle('is-warn', level === 'warn');
            node.classList.toggle('is-crit', level === 'crit');
        }
        if (pill) pill.className = `mq-pill ${level}`;
        if (svgTxt) svgTxt.textContent = valueText;
        if (chip) chip.textContent = valueText;
    };

    syncNode('mq-node-hr', 'mq-pill-hr', 'mq-val-hr', 'mq-chip-hr', `${Math.round(v.hr)} BPM`, hrLevel);
    syncNode('mq-node-spo2', 'mq-pill-spo2', 'mq-val-spo2', 'mq-chip-spo2', `${v.spo2.toFixed(1)}%`, spo2Level);
    syncNode('mq-node-bp', 'mq-pill-bp', 'mq-val-bp', 'mq-chip-bp', `${Math.round(v.sys)}/${Math.round(v.dia)}`, bpLevel);
    syncNode('mq-node-temp', 'mq-pill-temp', 'mq-val-temp', 'mq-chip-temp', `${formatTemp(v.temp)}${getTempUnit()}`, tempLevel);

    panel.style.setProperty('--hr-dur', `${Math.max(0.38, 60 / Math.max(40, v.hr)).toFixed(2)}s`);
}

function drawSparkline(canvasId, series, color) {
    const cvs = document.getElementById(canvasId);
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const w = cvs.width = cvs.clientWidth || 180;
    const h = cvs.height = 46;
    ctx.clearRect(0, 0, w, h);

    if (!series || series.length < 2) return;
    const min = Math.min(...series) - 1;
    const max = Math.max(...series) + 1;
    const range = max - min || 1;

    ctx.beginPath();
    series.forEach((val, idx) => {
        const x = (idx / (series.length - 1)) * w;
        const y = h - 6 - ((val - min) / range) * (h - 12);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
}

// ==================== 3. NASA SCIENTIFIC DATA CENTER ====================
function bindNasaDataCenter() {
    document.querySelectorAll('[data-nasa-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            activeNasaTab = btn.getAttribute('data-nasa-tab');
            document.querySelectorAll('[data-nasa-tab]').forEach(b => b.classList.toggle('active', b === btn));
            if (activeNasaTab !== 'historical') {
                const list = NASA_OSD575_DATA[activeNasaTab]?.biomarkers || [];
                if (list.length > 0) activeNasaBioId = list[0].id;
            }
            renderNasaDataCenter();
        });
    });

    document.getElementById('nasa-biomarker-select')?.addEventListener('change', (e) => {
        activeNasaBioId = e.target.value;
        renderNasaBiomarkerView();
    });

    document.getElementById('nasa-subject-select')?.addEventListener('change', (e) => {
        activeNasaSubject = e.target.value;
        renderNasaBiomarkerView();
    });

    document.getElementById('btn-query-nasa-live')?.addEventListener('click', queryLiveNasaOsd575);
}

async function queryLiveNasaOsd575() {
    const badge = document.getElementById('nasa-conn-badge');
    if (badge) {
        badge.textContent = '...';
    }
    try {
        // First try local Python backend if available, else direct OSDR endpoint
        let res = null;
        if (!isFileProtocol() && !isOfflineFallbackMode) {
            res = await fetch('/api/nasa/osd575/metadata').catch(() => null);
            if (!res) activateOfflineMode(true);
        }
        if (!res || !res.ok) {
            res = await fetch('https://osdr.nasa.gov/osdr/data/osd/meta/575');
        }
        if (res && res.ok) {
            const payload = await res.json();
            const isLive = payload.status === 'connected' || !!payload.study || !!payload['OSD-575'];
            if (badge) {
                badge.textContent = isLive ? t('status_connected_live') : t('status_cached_authentic');
                badge.style.color = isLive ? 'var(--green)' : 'var(--cyan)';
            }
            showToast(
                'NASA OSDR OSD-575',
                isLive
                    ? trLang('Connected to live NASA OSDR OSD-575 endpoint.', 'Подключено к живому API NASA OSDR OSD-575.', 'Canlı NASA OSDR OSD-575 API-sinə qoşuldu.')
                    : trLang('Serving verified cached OSD-575 dataset.', 'Используется проверенный кэш данных OSD-575.', 'Təsdiqlənmiş OSD-575 keşi istifadə olunur.')
            );
            return;
        }
        throw new Error('Offline');
    } catch (_) {
        if (badge) {
            badge.textContent = t('status_unavailable');
            badge.style.color = 'var(--amber)';
        }
        showToast(
            'NASA OSDR OSD-575',
            trLang(
                'Live NASA API unreachable (CORS/offline). Showing authentic cached OSD-575 dataset.',
                'Живой API NASA недоступен (CORS/офлайн). Отображаются подлинные кэшированные данные OSD-575.',
                'Canlı NASA API əlçatmazdır (CORS/oflayn). Rəsmi keşlənmiş OSD-575 məlumatları göstərilir.'
            ),
            'medium'
        );
    }
}

function renderNasaDataCenter() {
    const study = NASA_OSD575_DATA.study;
    const titleEl = document.getElementById('nasa-study-title');
    const metaEl = document.getElementById('nasa-study-meta');
    const connBadge = document.getElementById('nasa-conn-badge');

    if (titleEl) titleEl.textContent = trField(study, 'title');
    if (metaEl) {
        metaEl.textContent = `${study.mission} (${study.spacecraft}) • ${trField(study, 'flight_duration')} • ${study.apogee_km} km • DOI: ${study.doi}`;
    }
    if (connBadge && connBadge.textContent === 'RƏSMİ KEŞ') {
        connBadge.textContent = t('status_cached_authentic');
    }

    const chartView = document.getElementById('nasa-chart-view');
    const histView = document.getElementById('nasa-historical-view');

    if (activeNasaTab === 'historical') {
        chartView?.classList.add('hidden');
        histView?.classList.remove('hidden');
        renderNasaHistoricalTab();
    } else {
        chartView?.classList.remove('hidden');
        histView?.classList.add('hidden');
        populateNasaDropdowns();
        renderNasaBiomarkerView();
    }
}

function populateNasaDropdowns() {
    const assay = NASA_OSD575_DATA[activeNasaTab] || NASA_OSD575_DATA.cmp;
    const bioSel = document.getElementById('nasa-biomarker-select');
    const subSel = document.getElementById('nasa-subject-select');

    if (bioSel) {
        bioSel.innerHTML = assay.biomarkers.map(b =>
            `<option value="${b.id}" ${b.id === activeNasaBioId ? 'selected' : ''}>${escapeHtml(trField(b, 'name'))} (${escapeHtml(b.unit)})</option>`
        ).join('');
    }
    if (subSel) {
        const opts = [`<option value="cohort_mean" ${activeNasaSubject === 'cohort_mean' ? 'selected' : ''}>${escapeHtml(t('opt_all_subjects'))}</option>`];
        NASA_OSD575_DATA.study.subjects.forEach(s => {
            opts.push(`<option value="${s.id}" ${activeNasaSubject === s.id ? 'selected' : ''}>${escapeHtml(trField(s, 'label'))}</option>`);
        });
        subSel.innerHTML = opts.join('');
    }
}

function renderNasaBiomarkerView() {
    const assay = NASA_OSD575_DATA[activeNasaTab] || NASA_OSD575_DATA.cmp;
    const bio = assay.biomarkers.find(b => b.id === activeNasaBioId) || assay.biomarkers[0];
    if (!bio) return;

    document.getElementById('nasa-bio-platform').textContent = assay.platform;
    document.getElementById('nasa-bio-ref').textContent = bio.ref;
    document.getElementById('nasa-bio-desc').textContent = trField(bio, 'desc');

    const values = bio.series[activeNasaSubject] || bio.series.cohort_mean;
    const baseMean = (values[0] + values[1] + values[2]) / 3;
    const r1Val = values[3];
    const r82Val = values[5];
    const pctDelta = ((r1Val - baseMean) / baseMean) * 100;

    document.getElementById('nasa-stat-base').textContent = `${baseMean.toFixed(2)} ${bio.unit}`;
    document.getElementById('nasa-stat-r1').textContent = `${r1Val.toFixed(2)} ${bio.unit} (${pctDelta >= 0 ? '+' : ''}${pctDelta.toFixed(1)}%)`;
    document.getElementById('nasa-stat-r82').textContent = `${r82Val.toFixed(2)} ${bio.unit}`;

    const timepoints = NASA_OSD575_DATA.study.timepoints;

    // Render Plotly if available, else fallback canvas
    const plotDiv = document.getElementById('nasa-plotly-chart');
    const fallbackCvs = document.getElementById('nasa-fallback-canvas');

    if (typeof window.Plotly !== 'undefined' && plotDiv) {
        plotDiv.classList.remove('hidden');
        fallbackCvs?.classList.add('hidden');

        const traces = [];
        if (activeNasaSubject === 'cohort_mean') {
            const colors = ['#38bdf8', '#10b981', '#f59e0b', '#a855f7'];
            NASA_OSD575_DATA.study.subjects.forEach((s, idx) => {
                traces.push({
                    x: timepoints,
                    y: bio.series[s.id],
                    name: trField(s, 'label'),
                    mode: 'lines+markers',
                    line: { width: 2, dash: 'dot', color: colors[idx] },
                    marker: { size: 6 }
                });
            });
            traces.push({
                x: timepoints,
                y: bio.series.cohort_mean,
                name: t('opt_all_subjects'),
                mode: 'lines+markers',
                line: { width: 3.5, color: '#00e5ff' },
                marker: { size: 9, color: '#00e5ff' }
            });
        } else {
            traces.push({
                x: timepoints,
                y: values,
                name: activeNasaSubject,
                mode: 'lines+markers',
                line: { width: 3.5, color: isLightTheme() ? '#0284c7' : '#00e5ff' },
                marker: { size: 9, color: isLightTheme() ? '#0284c7' : '#00e5ff' }
            });
        }

        const light = isLightTheme();
        const layout = {
            title: {
                text: `${trField(bio, 'name')} (${bio.unit}) — OSD-575`,
                font: { color: light ? '#0f172a' : '#f1f5f9', size: 14, family: 'Inter, sans-serif' }
            },
            paper_bgcolor: light ? '#ffffff' : '#090e18',
            plot_bgcolor: light ? '#f8fafc' : '#090e18',
            font: { color: light ? '#334155' : '#a6b7d0', family: 'JetBrains Mono, monospace', size: 11 },
            xaxis: {
                title: trLang('Mission Timepoint', 'Точка миссии', 'Missiya Zaman Nöqtəsi'),
                gridcolor: light ? 'rgba(15, 23, 42, 0.1)' : 'rgba(148, 163, 184, 0.14)'
            },
            yaxis: {
                title: bio.unit,
                gridcolor: light ? 'rgba(15, 23, 42, 0.1)' : 'rgba(148, 163, 184, 0.14)'
            },
            legend: { orientation: 'h', y: -0.22, font: { size: 10 } },
            margin: { t: 45, r: 20, b: 60, l: 55 }
        };

        window.Plotly.newPlot(plotDiv, traces, layout, { responsive: true, displayModeBar: false });
    } else if (fallbackCvs) {
        plotDiv?.classList.add('hidden');
        fallbackCvs.classList.remove('hidden');
        drawNasaFallbackChart(fallbackCvs, timepoints, values, `${trField(bio, 'name')} (${bio.unit})`);
    }

    // Data table below chart
    const tblWrap = document.getElementById('nasa-data-table-wrap');
    if (tblWrap) {
        tblWrap.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>${escapeHtml(trLang('Participant ID', 'Участник', 'İştirakçı ID'))}</th>
                        ${timepoints.map(tp => `<th>${tp}</th>`).join('')}
                        <th>${escapeHtml(t('lbl_assay_platform').replace(':', ''))}</th>
                    </tr>
                </thead>
                <tbody>
                    ${NASA_OSD575_DATA.study.subjects.map(s => `
                        <tr>
                            <td class="mono"><b>${s.id}</b> (${escapeHtml(trField(s, 'label'))})</td>
                            ${bio.series[s.id].map((val, idx) => `<td class="mono ${idx === 3 ? 'warn-text' : ''}">${val} ${escapeHtml(bio.unit)}</td>`).join('')}
                            <td class="muted">${escapeHtml(assay.platform)}</td>
                        </tr>
                    `).join('')}
                    <tr style="background:rgba(0,229,255,0.06);">
                        <td class="mono"><b>${escapeHtml(t('opt_all_subjects'))}</b></td>
                        ${bio.series.cohort_mean.map((val, idx) => `<td class="mono ${idx === 3 ? 'warn-text' : 'ok-text'}"><b>${val} ${escapeHtml(bio.unit)}</b></td>`).join('')}
                        <td class="muted">NASA OSDR OSD-575</td>
                    </tr>
                </tbody>
            </table>
        `;
    }
}

function drawNasaFallbackChart(cvs, labels, values, title) {
    const ctx = cvs.getContext('2d');
    const w = cvs.width = cvs.parentElement?.clientWidth - 24 || 600;
    const h = cvs.height = 340;
    const light = isLightTheme();
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = light ? '#f8fafc' : '#090e18';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = light ? '#0f172a' : '#f1f5f9';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(title, 20, 26);

    const padL = 55, padR = 25, padT = 48, padB = 45;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const min = Math.min(...values) * 0.85;
    const max = Math.max(...values) * 1.12;
    const range = max - min || 1;

    ctx.strokeStyle = light ? 'rgba(15, 23, 42, 0.1)' : 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padT + (i / 4) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        const labelVal = (max - (i / 4) * range).toFixed(1);
        ctx.fillStyle = light ? '#475569' : '#a6b7d0';
        ctx.font = '10px monospace';
        ctx.fillText(labelVal, 10, y + 4);
    }

    ctx.beginPath();
    const pts = values.map((val, idx) => {
        const x = padL + (idx / (labels.length - 1)) * plotW;
        const y = padT + plotH - ((val - min) / range) * plotH;
        return { x, y, val, label: labels[idx] };
    });

    pts.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = light ? '#0284c7' : '#00e5ff';
    ctx.lineWidth = 3;
    ctx.stroke();

    pts.forEach((p, idx) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, idx === 3 ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = idx === 3 ? '#f59e0b' : (light ? '#0284c7' : '#00e5ff');
        ctx.fill();
        ctx.fillStyle = light ? '#0f172a' : '#e2e8f0';
        ctx.font = '11px monospace';
        ctx.fillText(p.label, p.x - 14, h - 18);
        ctx.fillText(p.val.toFixed(1), p.x - 12, p.y - 10);
    });
}

function renderNasaHistoricalTab() {
    const sumEl = document.getElementById('nasa-hist-summary');
    const gridEl = document.getElementById('nasa-milestones-grid');
    if (sumEl) sumEl.textContent = trField(NASA_OSD575_DATA.historical, 'summary');
    if (gridEl) {
        gridEl.innerHTML = NASA_OSD575_DATA.historical.milestones.map(m => `
            <div class="milestone-card">
                <span class="milestone-phase">${escapeHtml(m.phase)}</span>
                <h4>${escapeHtml(trField(m, 'title'))}</h4>
                <p>${escapeHtml(trField(m, 'text'))}</p>
            </div>
        `).join('');
    }
}

// ==================== 4. AI MEDICAL ANALYSIS SECTION ====================
function bindAiControls() {
    document.getElementById('ai-crew-select')?.addEventListener('change', (e) => {
        selectedAiCrewId = e.target.value;
        renderAISection();
    });
    document.getElementById('ai-alert-filter')?.addEventListener('change', (e) => {
        aiAlertFilter = e.target.value;
        renderAISection();
    });
}

function renderAISection() {
    const sel = document.getElementById('ai-crew-select');
    if (sel) {
        sel.innerHTML = crewMembers.map(c =>
            `<option value="${c.id}" ${c.id === selectedAiCrewId ? 'selected' : ''}>${escapeHtml(c.name)} (${c.id})</option>`
        ).join('');
    }

    const astro = crewMembers.find(c => c.id === selectedAiCrewId) || crewMembers[0];
    if (astro) {
        const ev = evaluateAstronaut(astro);
        const riskEl = document.getElementById('ai-risk-pill');
        if (riskEl) {
            riskEl.className = `risk-pill ${ev.risk.toLowerCase()}`;
            riskEl.textContent = trStatus(ev.risk);
        }
        document.getElementById('ai-stability-score').textContent = `${ev.score} / 100`;
        document.getElementById('ai-hr-delta').textContent = `${ev.hrDelta >= 0 ? '+' : ''}${ev.hrDelta} BPM`;
        document.getElementById('ai-explanation-text').textContent = ev.explanation;
        document.getElementById('ai-followup-list').innerHTML = ev.followups.map(f => `<li>${escapeHtml(f)}</li>`).join('');
        drawAiComparisonChart(astro);
    }

    // Active Alerts Feed
    const alertsFeed = document.getElementById('ai-alerts-feed');
    if (alertsFeed) {
        const items = [];
        crewMembers.forEach(c => {
            const ev = evaluateAstronaut(c);
            if (ev.risk !== 'LOW') {
                items.push({
                    prio: ev.risk,
                    title: `${c.name} (${c.id})`,
                    text: ev.explanation,
                    attr: `data-recal-crew="${c.id}"`
                });
            }
        });
        equipmentList.filter(e => e.status !== 'OPERATIONAL').forEach(eq => {
            items.push({
                prio: eq.status === 'OFFLINE' || eq.status === 'MAINTENANCE REQUIRED' ? 'HIGH' : 'MEDIUM',
                title: `${trField(eq, 'name')} (${eq.id})`,
                text: `${trStatus(eq.status)}: ${trField(eq, 'cond')}`,
                attr: `data-recal-eq="${eq.id}"`
            });
        });

        const filtered = aiAlertFilter === 'ALL' ? items : items.filter(i => i.prio === aiAlertFilter);
        alertsFeed.innerHTML = filtered.length === 0
            ? `<div class="activity-row info"><p>${escapeHtml(trLang('No active medical or equipment alerts.', 'Активных медицинских или системных тревог нет.', 'Aktiv tibbi və ya avadanlıq xəbərdarlığı yoxdur.'))}</p></div>`
            : filtered.map(it => `
                <div class="activity-row ${it.prio === 'HIGH' ? 'crit' : 'warn'} alert-with-action">
                    <span class="risk-pill ${it.prio.toLowerCase()}" style="font-size:0.62rem;">${trStatus(it.prio)}</span>
                    <div style="flex:1;min-width:0;">
                        <div class="alert-head-row">
                            <strong style="font-size:0.8rem;">${escapeHtml(it.title)}</strong>
                            <button type="button" class="btn btn-xs btn-recal" ${it.attr}>${escapeHtml(t('btn_recalibrate'))}</button>
                        </div>
                        <p>${escapeHtml(it.text)}</p>
                    </div>
                </div>
            `).join('');
    }

    // NASA Sources
    const srcEl = document.getElementById('nasa-sources-list');
    if (srcEl) {
        srcEl.innerHTML = NASA_CSA_SOURCES.map(s => `
            <a class="source-link-card" href="${s.url}" target="_blank" rel="noopener">
                <strong>${escapeHtml(trField(s, 'title'))} ↗</strong>
                <p class="muted">${escapeHtml(trField(s, 'desc'))}</p>
            </a>
        `).join('');
    }

    // Statistical Z-score table from authentic OSD-575 data
    const zWrap = document.getElementById('ai-osd-zscore-table');
    if (zWrap) {
        const targets = [
            NASA_OSD575_DATA.cmp.biomarkers[0],
            NASA_OSD575_DATA.cmp.biomarkers[3],
            NASA_OSD575_DATA.cardiovascular.biomarkers[0],
            NASA_OSD575_DATA.cardiovascular.biomarkers[1],
            NASA_OSD575_DATA.cytokines.biomarkers[0],
            NASA_OSD575_DATA.cytokines.biomarkers[1]
        ];
        zWrap.innerHTML = `
            <table class="data-table compact-table">
                <thead>
                    <tr>
                        <th>${escapeHtml(trLang('Biomarker (OSD-575)', 'Биомаркер (OSD-575)', 'Biomarker (OSD-575)'))}</th>
                        <th>${escapeHtml(trLang('L-Baseline', 'L-База', 'L-Baza'))}</th>
                        <th>R+1</th>
                        <th>${escapeHtml(trLang('Z-Score', 'Z-оценка', 'Z-Skor'))}</th>
                        <th>${escapeHtml(trLang('Delta %', 'Изм. %', 'Fərq %'))}</th>
                    </tr>
                </thead>
                <tbody>
                    ${targets.map(b => {
                        const s = b.series.cohort_mean;
                        const base = (s[0] + s[1] + s[2]) / 3;
                        const variance = ((s[0] - base) ** 2 + (s[1] - base) ** 2 + (s[2] - base) ** 2) / 2;
                        const sd = Math.sqrt(variance) || 0.1;
                        const z = (s[3] - base) / sd;
                        const delta = ((s[3] - base) / base) * 100;
                        return `
                            <tr>
                                <td><b>${escapeHtml(trField(b, 'name'))}</b> <small class="muted">(${escapeHtml(b.unit)})</small></td>
                                <td class="mono">${base.toFixed(2)}</td>
                                <td class="mono warn-text">${s[3].toFixed(2)}</td>
                                <td class="mono ${Math.abs(z) >= 2 ? 'crit-text' : 'ok-text'}"><b>${z >= 0 ? '+' : ''}${z.toFixed(1)}σ</b></td>
                                <td class="mono warn-text">+${delta.toFixed(1)}%</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    // 5 NASA HRP Risks
    const hrpEl = document.getElementById('ai-hrp-risks-list');
    if (hrpEl) {
        const risks = [
            { en: 'Space Radiation', ru: 'Космическая радиация', az: 'Kosmik Radiasiya' },
            { en: 'Isolation & Confinement', ru: 'Изоляция', az: 'Təcrid və Qapalı Mühit' },
            { en: 'Distance from Earth', ru: 'Удалённость от Земли', az: 'Yerdən Məsafə' },
            { en: 'Gravity Fields (Microgravity)', ru: 'Гравитация (Микрогравитация)', az: 'Qravitasiya Sahələri' },
            { en: 'Hostile Closed Environments', ru: 'Враждебная замкнутая среда', az: 'Qapalı Hostil Mühit' }
        ];
        hrpEl.innerHTML = risks.map(r => `<span class="hrp-pill">${escapeHtml(trLang(r.en, r.ru, r.az))}</span>`).join('');
    }

    // 3-Tier Distinction
    const tierEl = document.getElementById('data-tiers-list');
    if (tierEl) {
        tierEl.innerHTML = `
            <div class="tier-row">
                <span class="badge-ref">${escapeHtml(t('badge_nasa_official'))}</span>
                <p>${escapeHtml(trLang('Authentic longitudinal Inspiration4 measurements from NASA OSDR OSD-575.', 'Подлинные лонгитюдные данные Inspiration4 из NASA OSDR OSD-575.', 'NASA OSDR OSD-575 bazasından rəsmi SpaceX Inspiration4 ölçmələri.'))}</p>
            </div>
            <div class="tier-row">
                <span class="badge-sim">${escapeHtml(t('badge_sim_ai'))}</span>
                <p>${escapeHtml(trLang('Statistical Z-score outlier screening and baseline models (non-diagnostic).', 'Статистический скрининг по Z-оценке и базовое моделирование (не диагноз).', 'Statistik Z-skor anomaliya skrininqi və baza modelləri (diaqnostik deyil).'))}</p>
            </div>
            <div class="tier-row">
                <span class="badge-sim">${escapeHtml(t('badge_sim_telemetry'))}</span>
                <p>${escapeHtml(trLang('Live spacecraft operational biometric streams and simulation scenario injectors.', 'Оперативная телеметрия корабля и сценарии симуляции (ВКД, гипоксия).', 'Canlı kosmik gəmi biometrik axını və simulyasiya ssenariləri.'))}</p>
            </div>
        `;
    }
}

function drawAiComparisonChart(astro) {
    const cvs = document.getElementById('ai-comparison-canvas');
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const w = cvs.width = cvs.parentElement?.clientWidth - 20 || 480;
    const h = cvs.height = 175;
    ctx.clearRect(0, 0, w, h);

    const metrics = [
        { label: trLang('HR', 'ЧСС', 'Nəbz'), base: astro.baseline.hr, cur: astro.vitals.hr, max: 160 },
        { label: 'SpO2%', base: astro.baseline.spo2, cur: astro.vitals.spo2, max: 100 },
        { label: trLang('Sys BP', 'АД Сист', 'Sist. Təz'), base: astro.baseline.sys, cur: astro.vitals.sys, max: 170 },
        { label: 'HRV', base: astro.baseline.hrv, cur: astro.vitals.hrv, max: 80 }
    ];

    const colW = w / metrics.length;
    metrics.forEach((m, i) => {
        const cx = i * colW + colW * 0.25;
        const barW = colW * 0.22;
        const maxH = h - 42;

        const baseH = (m.base / m.max) * maxH;
        const curH = (m.cur / m.max) * maxH;

        // Baseline bar
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.fillRect(cx, h - 24 - baseH, barW, baseH);

        // Current bar
        const diff = Math.abs(m.cur - m.base) / m.base;
        ctx.fillStyle = diff > 0.18 ? '#ef4444' : diff > 0.08 ? '#f59e0b' : '#00e5ff';
        ctx.fillRect(cx + barW + 4, h - 24 - curH, barW, curH);

        ctx.fillStyle = isLightTheme() ? '#475569' : '#a6b7d0';
        ctx.font = '11px monospace';
        ctx.fillText(m.label, cx, h - 7);
        ctx.fillStyle = isLightTheme() ? '#0f172a' : '#f1f5f9';
        ctx.fillText(Math.round(m.cur), cx + barW + 2, h - 28 - curH);
    });
}

// ==================== 5. SPACECRAFT EQUIPMENT INSPECTION (8 SYSTEMS) ====================
function bindInspectionControls() {
    const dInput = document.getElementById('insp-date');
    const nInput = document.getElementById('insp-next-date');
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    if (dInput) dInput.value = today;
    if (nInput) nInput.value = nextMonth;

    document.getElementById('insp-mark-all-pass')?.addEventListener('click', () => {
        document.querySelectorAll('.chk-radio-pass').forEach(r => { r.checked = true; });
    });

    document.getElementById('insp-generate-report-btn')?.addEventListener('click', () => {
        activeReportTab = 'inspections';
        switchSection('sec-reports');
    });

    document.getElementById('inspection-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errBox = document.getElementById('insp-form-error');
        const eqId = document.getElementById('insp-eq-select').value;
        const inspector = document.getElementById('insp-inspector').value.trim();
        const date = document.getElementById('insp-date').value;
        const nextDate = document.getElementById('insp-next-date').value;
        const resultingStatus = document.getElementById('insp-result-status').value;
        const notes = document.getElementById('insp-notes').value.trim();

        if (!inspector || !date || !nextDate || !notes) {
            if (errBox) {
                errBox.textContent = trLang('Please fill in all required fields.', 'Пожалуйста, заполните все обязательные поля.', 'Zəhmət olmasa bütün tələb olunan xanaları doldurun.');
                errBox.classList.remove('hidden');
            }
            return;
        }
        errBox?.classList.add('hidden');

        let passedCount = 0;
        CHECKLIST_TEMPLATE.forEach(item => {
            const passEl = document.querySelector(`input[name="${item.id}"][value="PASS"]`);
            if (passEl && passEl.checked) passedCount++;
        });

        const eq = equipmentList.find(x => x.id === eqId);
        if (eq) {
            eq.status = resultingStatus;
            eq.lastInspection = date;
            eq.nextInspection = nextDate;
            eq.maintenanceHistory.unshift(`${date}: ${notes} (${inspector})`);
        }

        const newRec = {
            id: `INS-${Math.floor(2402 + Math.random() * 500)}`,
            equipmentId: eqId,
            inspector,
            date,
            passedCount,
            totalCount: CHECKLIST_TEMPLATE.length,
            resultingStatus,
            notesEn: notes,
            notesRu: notes,
            notesAz: notes
        };
        inspectionRecords.unshift(newRec);

        saveToStorage(STORAGE_KEYS.EQUIPMENT, equipmentList);
        saveToStorage(STORAGE_KEYS.INSPECTIONS, inspectionRecords);

        // Attempt optional backend persistence when Flask server is reachable
        if (!isFileProtocol() && !isOfflineFallbackMode) {
            fetch('/api/inspections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    equipment_id: eqId,
                    equipment_name: eq ? trField(eq, 'name') : eqId,
                    inspector,
                    date,
                    next_inspection: nextDate,
                    passed_count: passedCount,
                    total_count: CHECKLIST_TEMPLATE.length,
                    resulting_status: resultingStatus,
                    notes
                })
            }).catch(() => activateOfflineMode(true));
        }

        addActivityLog('INFO',
            `Inspection saved for ${eqId} (${resultingStatus}) by ${inspector}.`,
            `Проверка ${eqId} (${resultingStatus}) сохранена инспектором ${inspector}.`,
            `${eqId} üzrə yoxlama qeydi saxlanıldı (${resultingStatus}) — ${inspector}.`
        );

        document.getElementById('insp-notes').value = '';
        renderAllViews();
        showToast(
            trLang('Inspection Saved', 'Проверка сохранена', 'Yoxlama Saxlanıldı'),
            `${eqId}: ${trStatus(resultingStatus)}`
        );
    });
}

function renderInspectionSection() {
    const eqSelect = document.getElementById('insp-eq-select');
    if (eqSelect) {
        const cur = eqSelect.value;
        eqSelect.innerHTML = equipmentList.map(eq =>
            `<option value="${eq.id}" ${eq.id === cur ? 'selected' : ''}>[${eq.id}] ${escapeHtml(trField(eq, 'name'))}</option>`
        ).join('');
    }

    const chkContainer = document.getElementById('checklist-items');
    if (chkContainer) {
        chkContainer.innerHTML = CHECKLIST_TEMPLATE.map(item => `
            <div class="chk-item-row">
                <div>
                    <strong>${escapeHtml(trField(item, 'label'))}</strong>
                    ${item.critical ? `<span class="badge-crit-tag">${escapeHtml(t('lbl_critical'))}</span>` : ''}
                </div>
                <div class="chk-radios">
                    <label><input type="radio" class="chk-radio-pass" name="${item.id}" value="PASS" checked> ${escapeHtml(t('lbl_pass'))}</label>
                    <label><input type="radio" name="${item.id}" value="FAIL"> ${escapeHtml(t('lbl_fail'))}</label>
                </div>
            </div>
        `).join('');
    }

    const countLbl = document.getElementById('insp-count-lbl');
    if (countLbl) countLbl.textContent = String(inspectionRecords.length);

    const savedList = document.getElementById('saved-inspections-list');
    if (savedList) {
        savedList.innerHTML = inspectionRecords.map(rec => {
            const eqObj = equipmentList.find(x => x.id === rec.equipmentId);
            const eqTitle = eqObj ? trField(eqObj, 'name') : rec.equipmentId;
            const stCls = rec.resultingStatus === 'OPERATIONAL' ? 'ok' : rec.resultingStatus === 'WARNING' ? 'warn' : 'crit';
            return `
                <div class="saved-insp-card">
                    <div class="sic-top">
                        <strong>${escapeHtml(eqTitle)}</strong>
                        <span class="badge-state ${stCls}">${trStatus(rec.resultingStatus)}</span>
                    </div>
                    <div class="sic-meta mono muted">${rec.id} • ${rec.date} • ${escapeHtml(rec.inspector)} • ${t('lbl_passed')}: ${rec.passedCount}/${rec.totalCount}</div>
                    <p>${escapeHtml(trField(rec, 'notes'))}</p>
                </div>
            `;
        }).join('');
    }

    const eqGrid = document.getElementById('equipment-grid');
    if (eqGrid) {
        eqGrid.innerHTML = equipmentList.map(eq => {
            const stCls = eq.status === 'OPERATIONAL' ? 'ok' : eq.status === 'WARNING' ? 'warn' : 'crit';
            const recalBtn = eq.status !== 'OPERATIONAL'
                ? `<button type="button" class="btn btn-xs btn-recal" style="margin-top:10px;width:100%;" data-recal-eq="${eq.id}">${escapeHtml(t('btn_recalibrate'))}</button>`
                : '';
            return `
                <div class="panel eq-card">
                    <div class="eq-top">
                        <span class="id-chip mono">${eq.id}</span>
                        <span class="badge-state ${stCls}">${trStatus(eq.status)}</span>
                    </div>
                    <h4 style="margin:8px 0 4px;">${escapeHtml(trField(eq, 'name'))}</h4>
                    <span class="muted" style="font-size:0.74rem;">${escapeHtml(trCategory(eq.category))} • ${escapeHtml(trField(eq, 'location'))}</span>
                    <p style="font-size:0.78rem;margin:10px 0;">${escapeHtml(trField(eq, 'cond'))}</p>
                    <div class="eq-dates-grid">
                        <div class="inset-tile"><span>${escapeHtml(t('lbl_last_insp'))}</span><strong class="mono">${eq.lastInspection}</strong></div>
                        <div class="inset-tile"><span>${escapeHtml(t('lbl_next_due'))}</span><strong class="mono">${eq.nextInspection}</strong></div>
                    </div>
                    ${recalBtn}
                </div>
            `;
        }).join('');
    }
}

// ==================== 6. MISSION ENVIRONMENT & RADIATION ====================
function getCurrentRadiationStatus() {
    const maxRadRate = crewMembers.reduce((max, c) => Math.max(max, Number(c?.radiation?.rate || 0)), 0);
    return (speStormActive || maxRadRate >= 2.0) ? 'CRITICAL' : 'NORMAL';
}

function syncRadiationActivityGuard() {
    const nextStatus = getCurrentRadiationStatus();
    if (nextStatus === lastRadiationStatus) {
        return false; // State unchanged: do not emit duplicate logs inside loops
    }

    const prevStatus = lastRadiationStatus;
    lastRadiationStatus = nextStatus;

    if (prevStatus === 'NORMAL' && nextStatus === 'CRITICAL') {
        addActivityLog(
            'CRIT',
            'Solar Particle Event (SPE) Alert! Radiation flux > 3.8 mSv/day (NORMAL -> CRITICAL).',
            'Тревога солнечной бури (СПС)! Поток радиации > 3.8 мЗв/сут (NORMAL -> CRITICAL).',
            'Günəş Hissəcik Hadisəsi (SPE)! Radiasiya > 3.8 mSv/gün (NORMAL -> CRITICAL).'
        );
        return true;
    }

    if (prevStatus === 'CRITICAL' && nextStatus === 'NORMAL') {
        addActivityLog(
            'INFO',
            'Solar Particle Event ended; radiation returned to GCR baseline (CRITICAL -> NORMAL).',
            'Солнечная буря завершена; радиация вернулась к норме (CRITICAL -> NORMAL).',
            'SPE hadisəsi sona çatdı; radiasiya normal fon səviyyəsinə qayıtdı (CRITICAL -> NORMAL).'
        );
        return true;
    }

    return false;
}

function bindEnvironmentControls() {
    lastRadiationStatus = getCurrentRadiationStatus();
    document.getElementById('spe-storm-btn')?.addEventListener('click', () => {
        speStormActive = !speStormActive;
        if (speStormActive) {
            speShieldPct = 94;
            speShelterEndsAt = Date.now() + 180 * 1000;
        } else {
            speShieldPct = 100;
            speShelterEndsAt = 0;
        }

        const btn = document.getElementById('spe-storm-btn');
        if (btn) btn.textContent = speStormActive ? t('btn_spe_stop') : t('btn_spe_start');

        crewMembers.forEach(c => {
            c.radiation.rate = speStormActive ? 3.85 : 0.42;
        });

        syncRadiationActivityGuard();
        updateSpeHudUI();
        renderAllViews();
    });

    document.getElementById('mc-activity-search')?.addEventListener('input', renderEnvironmentSection);
}

function updateSpeHudUI() {
    const hud = document.getElementById('spe-shield-hud');
    const banner = document.getElementById('global-spe-banner');
    if (hud) hud.classList.toggle('hidden', !speStormActive);
    if (banner) banner.classList.toggle('hidden', !speStormActive);
    if (!speStormActive) return;

    const pct = Math.max(0, Math.min(100, Math.round(speShieldPct)));
    const barColor = pct >= 75 ? '#38bdf8' : pct >= 55 ? '#f59e0b' : '#ef4444';

    const secLeft = speShelterEndsAt > Date.now()
        ? Math.ceil((speShelterEndsAt - Date.now()) / 1000)
        : 0;
    const mm = String(Math.floor(secLeft / 60)).padStart(2, '0');
    const ss = String(secLeft % 60).padStart(2, '0');
    const timerText = `${mm}:${ss}`;

    const shieldValEl = document.getElementById('spe-shield-val');
    const shieldBarEl = document.getElementById('spe-shield-bar');
    const countdownEl = document.getElementById('spe-shelter-countdown');
    const pillEl = document.getElementById('spe-hud-timer-pill');
    const noteEl = document.getElementById('spe-hud-note');
    const gShieldEl = document.getElementById('global-spe-shield');
    const gTimerEl = document.getElementById('global-spe-timer');

    if (shieldValEl) shieldValEl.textContent = `${pct}%`;
    if (shieldBarEl) {
        shieldBarEl.style.width = `${pct}%`;
        shieldBarEl.style.background = barColor;
    }
    if (countdownEl) countdownEl.textContent = timerText;
    if (pillEl) pillEl.textContent = timerText;
    if (noteEl) {
        noteEl.textContent = secLeft === 0 ? t('spe_shelter_urgent') : t('spe_shelter_active_note');
    }
    if (gShieldEl) gShieldEl.textContent = `${pct}%`;
    if (gTimerEl) gTimerEl.textContent = timerText;
}

function renderEnvironmentSection() {
    const feed = document.getElementById('mc-activity-feed');
    const q = (document.getElementById('mc-activity-search')?.value || '').toLowerCase();
    if (feed) {
        const filtered = activityLogs.filter(a => trField(a, 'msg').toLowerCase().includes(q) || a.time.toLowerCase().includes(q));
        feed.innerHTML = filtered.map(log => `
            <div class="activity-row ${log.level === 'CRIT' ? 'crit' : log.level === 'WARN' ? 'warn' : 'info'}">
                <span class="mono muted">${escapeHtml(log.time)}</span>
                <p>${escapeHtml(trField(log, 'msg'))}</p>
            </div>
        `).join('');
    }

    const speBtn = document.getElementById('spe-storm-btn');
    if (speBtn) speBtn.textContent = speStormActive ? t('btn_spe_stop') : t('btn_spe_start');
    updateSpeHudUI();
}

// ==================== 7. REPORTS & EXPORTS ====================
function bindReportsControls() {
    document.querySelectorAll('#report-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeReportTab = btn.getAttribute('data-report');
            document.querySelectorAll('#report-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
            renderReports();
        });
    });

    document.getElementById('rep-pdf-btn')?.addEventListener('click', () => window.print());
    document.getElementById('rep-csv-btn')?.addEventListener('click', exportReportCSV);
    document.getElementById('rep-json-btn')?.addEventListener('click', exportReportJSON);
}

function renderReports() {
    const area = document.getElementById('report-content-area');
    if (!area) return;

    if (activeReportTab === 'health') {
        area.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>${escapeHtml(trLang('Astronaut', 'Астронавт', 'Astronavt'))}</th>
                        <th>${escapeHtml(t('vital_hr'))}</th>
                        <th>SpO₂</th>
                        <th>${escapeHtml(t('vital_bp'))}</th>
                        <th>${escapeHtml(t('vital_temp'))}</th>
                        <th>${escapeHtml(t('lbl_mon_status'))}</th>
                    </tr>
                </thead>
                <tbody>
                    ${crewMembers.map(c => {
                        const ev = evaluateAstronaut(c);
                        return `
                            <tr>
                                <td class="mono">${c.id}</td>
                                <td><b>${escapeHtml(c.name)}</b><br><small class="muted">${escapeHtml(trField(c, 'role'))}</small></td>
                                <td class="mono">${Math.round(c.vitals.hr)} BPM</td>
                                <td class="mono">${c.vitals.spo2.toFixed(1)}%</td>
                                <td class="mono">${Math.round(c.vitals.sys)}/${Math.round(c.vitals.dia)} mmHg</td>
                                <td class="mono">${formatTemp(c.vitals.temp)} ${getTempUnit()}</td>
                                <td><span class="risk-pill ${ev.risk.toLowerCase()}">${trStatus(ev.status)}</span></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    } else if (activeReportTab === 'inspections') {
        area.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>${escapeHtml(t('lbl_target_eq').replace(' *', ''))}</th>
                        <th>${escapeHtml(t('lbl_inspector_name').replace(' *', ''))}</th>
                        <th>${escapeHtml(t('lbl_insp_date').replace(' *', ''))}</th>
                        <th>${escapeHtml(t('lbl_passed'))}</th>
                        <th>${escapeHtml(t('lbl_result_status').replace(' *', ''))}</th>
                    </tr>
                </thead>
                <tbody>
                    ${inspectionRecords.map(r => {
                        const eq = equipmentList.find(x => x.id === r.equipmentId);
                        return `
                            <tr>
                                <td class="mono">${r.id}</td>
                                <td><b>${escapeHtml(eq ? trField(eq, 'name') : r.equipmentId)}</b></td>
                                <td>${escapeHtml(r.inspector)}</td>
                                <td class="mono">${r.date}</td>
                                <td class="mono">${r.passedCount}/${r.totalCount}</td>
                                <td><b>${trStatus(r.resultingStatus)}</b></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    } else if (activeReportTab === 'maintenance') {
        area.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>${escapeHtml(t('lbl_target_eq').replace(' *', ''))}</th>
                        <th>${escapeHtml(t('lbl_last_insp'))}</th>
                        <th>${escapeHtml(t('lbl_next_due'))}</th>
                        <th>${escapeHtml(t('lbl_result_status').replace(' *', ''))}</th>
                    </tr>
                </thead>
                <tbody>
                    ${equipmentList.map(eq => `
                        <tr>
                            <td class="mono">${eq.id}</td>
                            <td><b>${escapeHtml(trField(eq, 'name'))}</b><br><small class="muted">${escapeHtml(trField(eq, 'cond'))}</small></td>
                            <td class="mono">${eq.lastInspection}</td>
                            <td class="mono">${eq.nextInspection}</td>
                            <td><b>${trStatus(eq.status)}</b></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else {
        area.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>MET</th>
                        <th>${escapeHtml(trLang('Level', 'Уровень', 'Səviyyə'))}</th>
                        <th>${escapeHtml(trLang('Message', 'Сообщение', 'Mesaj'))}</th>
                    </tr>
                </thead>
                <tbody>
                    ${activityLogs.slice(0, 15).map(l => `
                        <tr>
                            <td class="mono">${escapeHtml(l.time)}</td>
                            <td class="mono"><b>${l.level}</b></td>
                            <td>${escapeHtml(trField(l, 'msg'))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
}

function exportReportCSV() {
    const rows = [['ID', 'Name', 'HR_BPM', 'SpO2_Pct', 'BP_mmHg', 'Temp', 'Status']];
    crewMembers.forEach(c => {
        const ev = evaluateAstronaut(c);
        rows.push([c.id, `"${c.name}"`, Math.round(c.vitals.hr), c.vitals.spo2.toFixed(1), `${Math.round(c.vitals.sys)}/${Math.round(c.vitals.dia)}`, formatTemp(c.vitals.temp), trStatus(ev.status)]);
    });
    const csvContent = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
    downloadBlob(csvContent, 'aero-med-omni-report.csv', 'text/csv;charset=utf-8;');
}

function exportReportJSON() {
    const payload = {
        exportedAt: new Date().toISOString(),
        language: getLang(),
        nasaDataset: 'OSDR OSD-575 (SpaceX Inspiration4)',
        crewTelemetry: crewMembers,
        spacecraftSystems: equipmentList,
        inspectionRecords
    };
    downloadBlob(JSON.stringify(payload, null, 2), 'aero-med-omni-report.json', 'application/json');
}

function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== 8. 6-SCREEN JUDGE PRESENTATION MODE ====================
function bindPresentationMode() {
    document.getElementById('presentation-mode-btn')?.addEventListener('click', () => openPresentationModal(0));
    document.getElementById('pres-exit-btn')?.addEventListener('click', closePresentationModal);
    document.getElementById('pres-prev-btn')?.addEventListener('click', () => changePresentationSlide(-1));
    document.getElementById('pres-next-btn')?.addEventListener('click', () => changePresentationSlide(1));

    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('presentation-modal');
        if (!modal || modal.classList.contains('hidden')) return;
        if (e.key === 'ArrowRight' || e.key === ' ') {
            e.preventDefault();
            changePresentationSlide(1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            changePresentationSlide(-1);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closePresentationModal();
        }
    });
}

function openPresentationModal(idx = 0) {
    presIndex = idx;
    document.getElementById('presentation-modal')?.classList.remove('hidden');
    renderPresentationSlide();
}

function closePresentationModal() {
    document.getElementById('presentation-modal')?.classList.add('hidden');
}

function changePresentationSlide(delta) {
    const next = presIndex + delta;
    if (next >= 0 && next < PRESENTATION_SCREENS.length) {
        presIndex = next;
        renderPresentationSlide();
    }
}

function renderPresentationSlide() {
    const slide = PRESENTATION_SCREENS[presIndex];
    if (!slide) return;

    document.getElementById('pres-counter').textContent = `${t('pres_screen_of')} ${slide.index} / ${PRESENTATION_SCREENS.length}`;
    document.getElementById('pres-slide-badge').textContent = trField(slide, 'badge');
    document.getElementById('pres-title').textContent = trField(slide, 'title');
    document.getElementById('pres-sub').textContent = trField(slide, 'sub');

    const kpiGrid = document.getElementById('pres-kpi-grid');
    if (kpiGrid) {
        kpiGrid.innerHTML = slide.kpi.map(k => `
            <div class="pres-kpi-card">
                <span>${escapeHtml(trField(k, 'label'))}</span>
                <strong>${escapeHtml(k.val)}</strong>
            </div>
        `).join('');
    }

    const ptsList = document.getElementById('pres-points-list');
    if (ptsList) {
        const pts = trField(slide, 'points') || [];
        ptsList.innerHTML = pts.map(p => `<li>${escapeHtml(p)}</li>`).join('');
    }

    const dotsWrap = document.getElementById('pres-dots');
    if (dotsWrap) {
        dotsWrap.innerHTML = PRESENTATION_SCREENS.map((_, idx) =>
            `<button class="pres-step-dot ${idx === presIndex ? 'active' : ''}" data-pres-idx="${idx}" aria-label="Slide ${idx + 1}"></button>`
        ).join('');
        dotsWrap.querySelectorAll('[data-pres-idx]').forEach(dot => {
            dot.addEventListener('click', () => {
                presIndex = Number(dot.getAttribute('data-pres-idx'));
                renderPresentationSlide();
            });
        });
    }

    const prevBtn = document.getElementById('pres-prev-btn');
    const nextBtn = document.getElementById('pres-next-btn');
    if (prevBtn) prevBtn.disabled = presIndex === 0;
    if (nextBtn) nextBtn.disabled = presIndex === PRESENTATION_SCREENS.length - 1;
}

// ==================== MODAL HELPERS ====================
function bindModalControls() {
    document.getElementById('modal-close-btn')?.addEventListener('click', () => {
        document.getElementById('app-modal')?.classList.add('hidden');
    });
}

// ==================== REAL-TIME TELEMETRY & ANIMATION LOOPS ====================
function startTelemetryLoop() {
    if (telemetryTimer) clearInterval(telemetryTimer);
    telemetryTimer = setInterval(() => {
        if (streamPaused) return;
        updateMetClock();

        let highAlert = false;
        crewMembers.forEach(c => {
            if (!c.manual) {
                const target = SCENARIO_PROFILES[c.mode] || SCENARIO_PROFILES.normal;
                c.vitals.hr += (target.hr - c.vitals.hr) * 0.25 + (Math.random() - 0.5) * 2.2;
                c.vitals.spo2 += (target.spo2 - c.vitals.spo2) * 0.25 + (Math.random() - 0.5) * 0.2;
                c.vitals.sys += (target.sys - c.vitals.sys) * 0.25 + (Math.random() - 0.5) * 1.5;
                c.vitals.dia += (target.dia - c.vitals.dia) * 0.25 + (Math.random() - 0.5) * 1.0;
                c.vitals.temp += (target.temp - c.vitals.temp) * 0.2 + (Math.random() - 0.5) * 0.04;
                c.vitals.spo2 = Math.min(100, Math.max(80, c.vitals.spo2));
            }
            c.series.hr.push(c.vitals.hr); if (c.series.hr.length > 28) c.series.hr.shift();
            c.series.spo2.push(c.vitals.spo2); if (c.series.spo2.length > 28) c.series.spo2.shift();
            c.series.sys.push(c.vitals.sys); if (c.series.sys.length > 28) c.series.sys.shift();
            c.series.temp.push(c.vitals.temp); if (c.series.temp.length > 28) c.series.temp.shift();

            if (evaluateAstronaut(c).risk === 'HIGH') highAlert = true;
        });

        if ((highAlert || speStormActive) && settings.audio) playBeep({ siren: true });

        // State Change Flag guard: log strictly once on NORMAL <-> CRITICAL transitions
        if (syncRadiationActivityGuard() && activeSection === 'sec-environment') {
            renderEnvironmentSection();
        }

        updateGlobalStatusPill();
        if (activeSection === 'sec-overview') renderOverview();
        if (activeSection === 'sec-crew') {
            const astro = crewMembers.find(c => c.id === selectedCrewId);
            if (astro) renderCrewMetricsOnly(astro);
        }
    }, settings.rateMs);
}

let metSeconds = 42 * 86400 + 18 * 3600 + 14 * 60 + 9;
function updateMetClock() {
    metSeconds++;
    const d = Math.floor(metSeconds / 86400);
    const h = Math.floor((metSeconds % 86400) / 3600);
    const m = Math.floor((metSeconds % 3600) / 60);
    const s = metSeconds % 60;
    const pad = n => String(n).padStart(2, '0');
    const el = document.getElementById('met-clock');
    if (el) el.textContent = `T+ ${String(d).padStart(3, '0')}:${pad(h)}:${pad(m)}:${pad(s)}`;
}

function startAnimations() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    const loop = () => {
        if (!streamPaused) {
            oscPhase += 0.09;
            orbitAngle += 0.008;
        }
        if (activeSection === 'sec-crew') drawOscilloscope();
        if (activeSection === 'sec-environment') renderOrbitScene();
        animFrameId = requestAnimationFrame(loop);
    };
    animFrameId = requestAnimationFrame(loop);
}

function drawOscilloscope() {
    const cvs = document.getElementById('osc-canvas');
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const w = cvs.width = cvs.parentElement?.clientWidth - 28 || 600;
    const h = cvs.height = 150;
    const light = isLightTheme();
    ctx.fillStyle = light ? '#f8fafc' : '#070b14';
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = light ? 'rgba(2, 132, 199, 0.14)' : 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 28) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 25) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const astro = crewMembers.find(c => c.id === selectedCrewId) || crewMembers[0];
    const hrFactor = (astro?.vitals.hr || 72) / 72;

    // ECG Line
    ctx.beginPath();
    for (let x = 0; x < w; x += 2) {
        const t = (x * 0.035 * hrFactor) - oscPhase;
        const cycle = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        let yOff = 0;
        if (cycle > 1.2 && cycle < 1.5) yOff = -6;
        else if (cycle > 2.0 && cycle < 2.2) yOff = 8;
        else if (cycle >= 2.2 && cycle < 2.45) yOff = -34;
        else if (cycle >= 2.45 && cycle < 2.7) yOff = 12;
        else if (cycle > 3.3 && cycle < 4.1) yOff = -9 * Math.sin((cycle - 3.3) * 3.9);
        const y = 45 + yOff;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = isLightTheme() ? '#0284c7' : '#00e5ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // SpO2 Pleth
    ctx.beginPath();
    for (let x = 0; x < w; x += 2) {
        const t = (x * 0.035 * hrFactor) - oscPhase;
        const y = 98 - Math.sin(t) * 10 - Math.sin(t * 2) * 4;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Resp Wave
    ctx.beginPath();
    for (let x = 0; x < w; x += 2) {
        const t = (x * 0.012) - oscPhase * 0.3;
        const y = 130 + Math.sin(t) * 8;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.4;
    ctx.stroke();
}

// ==================== 3D INTERACTIVE THREE.JS EARTH & ORBIT ENGINE ====================
let orbitThreeState = {
    initialized: false,
    failed: false,
    renderer: null,
    scene: null,
    camera: null,
    worldGroup: null,
    earthMesh: null,
    cloudsMesh: null,
    atmoMat: null,
    orbitMat: null,
    orbitGroup: null,
    craftGroup: null,
    craftMat: null,
    shieldMesh: null,
    shieldMat: null,
    stars: null,
    planets: [],
    solarOrbitMats: [],
    earthSystemGroup: null,
    earthOrbitAngle: 0.35,
    earthOrbitRadius: 8.6,
    focusPos: null,
    smoothZoom: 3.45,
    moonPivot: null,
    moonMesh: null,
    rotY: 0.45,
    rotX: 0.28,
    zoom: 3.45,
    dragging: false,
    lastX: 0,
    lastY: 0
};

function bindOrbitZoomControls() {
    if (bindOrbitZoomControls._bound) return;
    bindOrbitZoomControls._bound = true;

    const zoomOutBtn = document.getElementById('orbit-zoom-out');
    const zoomInBtn = document.getElementById('orbit-zoom-in');
    const zoomResetBtn = document.getElementById('orbit-zoom-reset');

    zoomOutBtn?.addEventListener('click', () => {
        if (orbitThreeState.initialized && !orbitThreeState.failed) {
            orbitThreeState.zoom = Math.min(38.0, orbitThreeState.zoom * 1.48);
        } else {
            orbitFallbackState.zoom = Math.max(0.11, orbitFallbackState.zoom * 0.65);
        }
    });
    zoomInBtn?.addEventListener('click', () => {
        if (orbitThreeState.initialized && !orbitThreeState.failed) {
            orbitThreeState.zoom = Math.max(2.1, orbitThreeState.zoom / 1.48);
        } else {
            orbitFallbackState.zoom = Math.min(1.45, orbitFallbackState.zoom / 0.65);
        }
    });
    zoomResetBtn?.addEventListener('click', () => {
        orbitThreeState.zoom = 3.45;
        orbitThreeState.rotY = 0.45;
        orbitThreeState.rotX = 0.28;
        orbitFallbackState.zoom = 1.0;
        orbitFallbackState.rotY = 0.2;
        orbitFallbackState.rotX = 0.36;
    });
}

function createPlanetCanvasTexture(palette, kind) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, palette[0]);
    g.addColorStop(0.5, palette[1]);
    g.addColorStop(1, palette[2] || palette[0]);
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 128);

    if (kind === 'banded') {
        for (let y = 8; y < 120; y += 11) {
            x.fillStyle = y % 22 === 8 ? 'rgba(255,255,255,0.22)' : 'rgba(120,53,15,0.25)';
            x.fillRect(0, y, 256, 5);
        }
        x.fillStyle = 'rgba(220,38,38,0.45)';
        x.beginPath();
        x.ellipse(155, 78, 18, 9, 0, 0, Math.PI * 2);
        x.fill();
    } else if (kind === 'crater') {
        for (let i = 0; i < 24; i++) {
            const cx = (i * 53 + 17) % 240 + 8;
            const cy = (i * 37 + 19) % 104 + 12;
            const r = 3 + (i % 5) * 2.2;
            x.fillStyle = 'rgba(15,23,42,0.22)';
            x.beginPath();
            x.arc(cx, cy, r, 0, Math.PI * 2);
            x.fill();
        }
    } else if (kind === 'sun') {
        for (let i = 0; i < 40; i++) {
            const cx = (i * 61) % 256;
            const cy = (i * 29) % 128;
            x.fillStyle = 'rgba(254,240,138,0.35)';
            x.beginPath();
            x.arc(cx, cy, 8 + (i % 4) * 3, 0, Math.PI * 2);
            x.fill();
        }
    }
    const tex = new window.THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
}

function createEarthCanvasTexture() {
    const texCvs = document.createElement('canvas');
    texCvs.width = 1024;
    texCvs.height = 512;
    const tctx = texCvs.getContext('2d');

    // Deep orbital ocean gradient
    const ocean = tctx.createLinearGradient(0, 0, 0, 512);
    ocean.addColorStop(0, '#0c3559');
    ocean.addColorStop(0.5, '#074678');
    ocean.addColorStop(1, '#092c4c');
    tctx.fillStyle = ocean;
    tctx.fillRect(0, 0, 1024, 512);

    // Stylized continents (North/South America, Eurasia, Africa, Australia)
    const landShapes = [
        // North America
        [[140, 110], [260, 95], [295, 165], [235, 225], [185, 200], [130, 155]],
        // South America
        [[255, 255], [320, 275], [340, 355], [295, 430], [265, 390], [245, 305]],
        // Europe + Asia
        [[465, 95], [640, 82], [815, 108], [860, 178], [790, 240], [665, 232], [565, 205], [475, 175]],
        // Africa
        [[470, 205], [565, 215], [600, 285], [555, 395], [500, 385], [455, 285]],
        // Australia
        [[765, 315], [855, 310], [875, 375], [790, 395]]
    ];
    tctx.fillStyle = '#157f73';
    tctx.strokeStyle = '#38bdf8';
    tctx.lineWidth = 2;
    landShapes.forEach(poly => {
        tctx.beginPath();
        poly.forEach(([x, y], idx) => (idx === 0 ? tctx.moveTo(x, y) : tctx.lineTo(x, y)));
        tctx.closePath();
        tctx.fill();
        tctx.stroke();
    });

    // Polar ice caps
    tctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
    tctx.fillRect(0, 0, 1024, 34);
    tctx.fillRect(0, 478, 1024, 34);

    // Subtle telemetry lat/lon grid
    tctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    tctx.lineWidth = 1;
    for (let x = 0; x < 1024; x += 64) {
        tctx.beginPath(); tctx.moveTo(x, 0); tctx.lineTo(x, 512); tctx.stroke();
    }
    for (let y = 0; y < 512; y += 64) {
        tctx.beginPath(); tctx.moveTo(0, y); tctx.lineTo(1024, y); tctx.stroke();
    }

    const texture = new window.THREE.CanvasTexture(texCvs);
    texture.needsUpdate = true;
    return texture;
}

function initOrbitThreeScene() {
    if (orbitThreeState.initialized || orbitThreeState.failed) return;
    if (typeof window.THREE === 'undefined') {
        orbitThreeState.failed = true;
        bindOrbitZoomControls();
        return;
    }

    const mount = document.getElementById('orbit-3d-mount');
    const fallbackCvs = document.getElementById('orbit-3d-canvas');
    if (!mount) return;

    try {
        const THREE = window.THREE;
        const w = mount.clientWidth || 560;
        const h = mount.clientHeight || 270;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h);
        mount.innerHTML = '';
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(44, w / h, 0.1, 220);
        camera.position.set(0, 0.4, orbitThreeState.zoom);

        // Lighting (Solar PointLight at Sun (0,0,0) + soft ambient space fill)
        scene.add(new THREE.AmbientLight(0x94a3b8, 0.85));
        const sunPointLight = new THREE.PointLight(0xfffbeb, 1.9, 130);
        sunPointLight.position.set(0, 0, 0);
        scene.add(sunPointLight);
        const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
        rimLight.position.set(6, 5, 6);
        scene.add(rimLight);

        // Deep Space Starfield
        const starCount = 720;
        const starPos = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount * 3; i++) {
            starPos[i] = (Math.random() - 0.5) * 120;
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const stars = new THREE.Points(
            starGeo,
            new THREE.PointsMaterial({ color: 0xe2e8f0, size: 0.11, transparent: true, opacity: 0.82 })
        );
        scene.add(stars);

        const worldGroup = new THREE.Group();
        scene.add(worldGroup);

        // Earth's Heliocentric Orbit Plane around Sun (0,0,0)
        const solarOrbitMats = [];
        const earthHelioPivot = new THREE.Group();
        earthHelioPivot.rotation.x = 0.24;
        worldGroup.add(earthHelioPivot);

        const earthHelioOrbitMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0 });
        const earthHelioRing = new THREE.Mesh(
            new THREE.TorusGeometry(orbitThreeState.earthOrbitRadius, 0.028, 6, 160),
            earthHelioOrbitMat
        );
        earthHelioRing.rotation.x = Math.PI / 2;
        earthHelioPivot.add(earthHelioRing);
        solarOrbitMats.push(earthHelioOrbitMat);

        // Earth System Group (Earth + Clouds + Atmo + Spacecraft LEO + Shield + Moon)
        const earthSystemGroup = new THREE.Group();
        earthSystemGroup.position.set(
            Math.cos(orbitThreeState.earthOrbitAngle) * orbitThreeState.earthOrbitRadius,
            0,
            Math.sin(orbitThreeState.earthOrbitAngle) * orbitThreeState.earthOrbitRadius
        );
        earthHelioPivot.add(earthSystemGroup);

        // 3D Earth Globe
        const earthTex = createEarthCanvasTexture();
        const earthMesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 48, 48),
            new THREE.MeshPhongMaterial({ map: earthTex, shininess: 22, specular: 0x38bdf8 })
        );
        earthSystemGroup.add(earthMesh);

        // Wireframe Orbital Cloud / Shield Lattice
        const cloudsMesh = new THREE.Mesh(
            new THREE.SphereGeometry(1.022, 32, 32),
            new THREE.MeshBasicMaterial({ color: 0xe2e8f0, wireframe: true, transparent: true, opacity: 0.07 })
        );
        earthSystemGroup.add(cloudsMesh);

        // Atmosphere Glow Halo
        const atmoMat = new THREE.MeshBasicMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: 0.14,
            side: THREE.BackSide
        });
        const atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(1.11, 40, 40), atmoMat);
        earthSystemGroup.add(atmoMesh);

        // Inclined LEO Orbit Track (51.6 deg)
        const orbitGroup = new THREE.Group();
        orbitGroup.rotation.z = 0.38;
        orbitGroup.rotation.x = 0.42;
        earthSystemGroup.add(orbitGroup);

        const orbitMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.75 });
        const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(1.56, 0.011, 12, 96), orbitMat);
        orbitRing.rotation.x = Math.PI / 2;
        orbitGroup.add(orbitRing);

        // 3D Spacecraft Model (Pressurized Module + Docking Cone + Dual Solar Arrays + Ion Thruster + Nav Beacon)
        const craftGroup = new THREE.Group();
        const craftMat = new THREE.MeshStandardMaterial({
            color: 0xe2e8f0,
            emissive: 0x0284c7,
            emissiveIntensity: 0.45,
            roughness: 0.25,
            metalness: 0.78
        });
        // Main hull oriented along +Z (orbital flight tangent)
        const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.068, 0.24, 16), craftMat);
        hull.rotation.x = Math.PI / 2;
        // Forward docking nose cone (+Z)
        const noseMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x0ea5e9, emissiveIntensity: 0.65, metalness: 0.6, roughness: 0.2 });
        const noseCone = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.09, 16), noseMat);
        noseCone.rotation.x = Math.PI / 2;
        noseCone.position.z = 0.165;
        // Aft engine nozzle + glowing ion plume (-Z)
        const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.85, roughness: 0.3 });
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.052, 0.06, 14), nozzleMat);
        nozzle.rotation.x = Math.PI / 2;
        nozzle.position.z = -0.145;
        const thrusterMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.88 });
        const thruster = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 12), thrusterMat);
        thruster.position.z = -0.185;
        // Photovoltaic solar array truss & dual wings along X
        const trussMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.8, roughness: 0.35 });
        const solarTruss = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.58, 10), trussMat);
        solarTruss.rotation.z = Math.PI / 2;
        const solarMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0369a1, emissiveIntensity: 0.5, metalness: 0.55, roughness: 0.25 });
        const solarWingL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.008, 0.11), solarMat);
        solarWingL.position.x = -0.18;
        const solarWingR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.008, 0.11), solarMat);
        solarWingR.position.x = 0.18;
        // Dorsal antenna mast & strobe beacon
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.07, 8), nozzleMat);
        mast.position.set(0, 0.065, 0.02);
        const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.95 });
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 10), beaconMat);
        beacon.position.set(0, 0.105, 0.02);

        craftGroup.add(hull, noseCone, nozzle, thruster, solarTruss, solarWingL, solarWingR, mast, beacon);
        orbitGroup.add(craftGroup);

        // SPE Radiation Shield Sphere (visible during Solar Particle Event)
        const shieldMat = new THREE.MeshBasicMaterial({
            color: 0xef4444,
            wireframe: true,
            transparent: true,
            opacity: 0
        });
        const shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(1.72, 24, 24), shieldMat);
        shieldMesh.visible = false;
        earthSystemGroup.add(shieldMesh);

        // 3D Moon orbiting Earth
        const moonPivot = new THREE.Group();
        moonPivot.rotation.z = 0.24;
        earthSystemGroup.add(moonPivot);
        const moonOrbitMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.22 });
        const moonOrbitRing = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.006, 8, 96), moonOrbitMat);
        moonOrbitRing.rotation.x = Math.PI / 2;
        moonPivot.add(moonOrbitRing);
        const moonMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.24, 24, 24),
            new THREE.MeshStandardMaterial({
                map: createPlanetCanvasTexture(['#cbd5e1', '#94a3b8', '#64748b'], 'crater'),
                roughness: 0.85,
                metalness: 0.08
            })
        );
        moonMesh.position.set(2.65, 0, 0);
        moonPivot.add(moonMesh);

        // 3D Solar System Center: Sun at (0,0,0) with all planets (including Earth!) orbiting it
        const planets = [];
        const sunPos = new THREE.Vector3(0, 0, 0);

        // Glowing 3D Sun
        const sunTex = createPlanetCanvasTexture(['#fef08a', '#f59e0b', '#ea580c'], 'sun');
        const sunMesh = new THREE.Mesh(
            new THREE.SphereGeometry(1.55, 36, 36),
            new THREE.MeshBasicMaterial({ map: sunTex })
        );
        sunMesh.position.copy(sunPos);
        const sunGlow = new THREE.Mesh(
            new THREE.SphereGeometry(2.05, 28, 28),
            new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.26, side: THREE.BackSide })
        );
        sunMesh.add(sunGlow);
        worldGroup.add(sunMesh);
        planets.push({ mesh: sunMesh, spin: 0.004, orbitRadius: 0, angle: 0, speed: 0 });

        const planetSpecs = [
            { name: 'mercury', r: 0.28, orbitR: 2.8,  angle: -0.45, speed: 0.0055, spin: 0.010, tiltY: 0.12,  palette: ['#cbd5e1', '#94a3b8', '#475569'], tex: 'crater', ring: null },
            { name: 'venus',   r: 0.48, orbitR: 5.0,  angle: 1.15,  speed: 0.0038, spin: 0.008, tiltY: -0.08, palette: ['#fde68a', '#f59e0b', '#b45309'], tex: 'smooth', ring: null },
            { name: 'mars',    r: 0.46, orbitR: 11.6, angle: -0.95, speed: 0.0018, spin: 0.011, tiltY: 0.09,  palette: ['#fca5a5', '#ea580c', '#9a3412'], tex: 'crater', ring: null },
            { name: 'jupiter', r: 1.08, orbitR: 15.0, angle: 0.65,  speed: 0.0012, spin: 0.018, tiltY: -0.05, palette: ['#fef3c7', '#d97706', '#92400e'], tex: 'banded', ring: null },
            { name: 'saturn',  r: 0.88, orbitR: 18.2, angle: -2.25, speed: 0.0009, spin: 0.015, tiltY: 0.12,  palette: ['#fef9c3', '#eab308', '#a16207'], tex: 'banded', ring: { inner: 1.18, outer: 2.02, color: 0xfde68a, opacity: 0.74 } },
            { name: 'uranus',  r: 0.58, orbitR: 20.8, angle: 2.15,  speed: 0.0007, spin: 0.012, tiltY: 0.16,  palette: ['#a5f3fc', '#22d3ee', '#0e7490'], tex: 'smooth', ring: { inner: 0.78, outer: 1.02, color: 0x67e8f9, opacity: 0.48 } },
            { name: 'neptune', r: 0.56, orbitR: 23.2, angle: -0.15, speed: 0.0005, spin: 0.013, tiltY: -0.10, palette: ['#93c5fd', '#2563eb', '#1e3a8a'], tex: 'smooth', ring: null }
        ];

        planetSpecs.forEach((spec) => {
            const solarPivot = new THREE.Group();
            solarPivot.position.copy(sunPos);
            solarPivot.rotation.x = 0.24;
            solarPivot.rotation.z = spec.tiltY;
            worldGroup.add(solarPivot);

            const pGeo = new THREE.SphereGeometry(spec.r, 28, 28);
            const pMat = new THREE.MeshStandardMaterial({
                map: createPlanetCanvasTexture(spec.palette, spec.tex),
                roughness: 0.58,
                metalness: 0.14,
                emissive: new THREE.Color(spec.palette[1]),
                emissiveIntensity: 0.18
            });
            const pMesh = new THREE.Mesh(pGeo, pMat);
            if (spec.ring) {
                const ringGeo = new THREE.RingGeometry(spec.ring.inner, spec.ring.outer, 48);
                const ringMat = new THREE.MeshBasicMaterial({
                    color: spec.ring.color,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: spec.ring.opacity
                });
                const ringMesh = new THREE.Mesh(ringGeo, ringMat);
                ringMesh.rotation.x = Math.PI / 2 - 0.36;
                ringMesh.rotation.y = 0.22;
                pMesh.add(ringMesh);
            }
            pMesh.position.set(Math.cos(spec.angle) * spec.orbitR, 0, Math.sin(spec.angle) * spec.orbitR);
            solarPivot.add(pMesh);

            // Heliocentric orbit arc around Sun (revealed as camera zooms out)
            const sOrbitMat = new THREE.MeshBasicMaterial({
                color: 0x38bdf8,
                transparent: true,
                opacity: 0
            });
            const sOrbitRing = new THREE.Mesh(new THREE.TorusGeometry(spec.orbitR, 0.024, 6, 160), sOrbitMat);
            sOrbitRing.rotation.x = Math.PI / 2;
            solarPivot.add(sOrbitRing);
            solarOrbitMats.push(sOrbitMat);

            planets.push({
                mesh: pMesh,
                spin: spec.spin,
                orbitRadius: spec.orbitR,
                angle: spec.angle,
                speed: spec.speed
            });
        });

        // Pointer drag + wheel zoom interactivity
        mount.addEventListener('pointerdown', (e) => {
            orbitThreeState.dragging = true;
            orbitThreeState.lastX = e.clientX;
            orbitThreeState.lastY = e.clientY;
            mount.setPointerCapture?.(e.pointerId);
        });
        mount.addEventListener('pointermove', (e) => {
            if (!orbitThreeState.dragging) return;
            const dx = e.clientX - orbitThreeState.lastX;
            const dy = e.clientY - orbitThreeState.lastY;
            orbitThreeState.lastX = e.clientX;
            orbitThreeState.lastY = e.clientY;
            orbitThreeState.rotY += dx * 0.008;
            orbitThreeState.rotX = Math.max(-1.2, Math.min(1.2, orbitThreeState.rotX + dy * 0.008));
        });
        const stopDrag = () => { orbitThreeState.dragging = false; };
        mount.addEventListener('pointerup', stopDrag);
        mount.addEventListener('pointercancel', stopDrag);
        mount.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.12 : 0.89;
            orbitThreeState.zoom = Math.max(2.1, Math.min(38.0, orbitThreeState.zoom * factor));
        }, { passive: false });

        window.addEventListener('resize', resizeOrbitThree);
        bindOrbitZoomControls();

        const initialFocus = new THREE.Vector3();
        earthSystemGroup.updateMatrixWorld(true);
        earthSystemGroup.getWorldPosition(initialFocus);

        Object.assign(orbitThreeState, {
            initialized: true,
            renderer,
            scene,
            camera,
            worldGroup,
            earthSystemGroup,
            focusPos: initialFocus,
            smoothZoom: orbitThreeState.zoom,
            earthMesh,
            cloudsMesh,
            atmoMat,
            orbitMat,
            orbitGroup,
            craftGroup,
            craftMat,
            beaconMat,
            thrusterMat,
            shieldMesh,
            shieldMat,
            stars,
            planets,
            solarOrbitMats,
            moonPivot,
            moonMesh
        });

        fallbackCvs?.classList.add('hidden');
        mount.classList.remove('hidden');
        const badge = document.getElementById('orbit-mode-badge');
        if (badge) badge.textContent = '3D WEBGL • LEO 418.4 km';
    } catch (_) {
        orbitThreeState.failed = true;
        mount?.classList.add('hidden');
        fallbackCvs?.classList.remove('hidden');
        bindOrbitZoomControls();
        const badge = document.getElementById('orbit-mode-badge');
        if (badge) badge.textContent = '3D CANVAS • LEO 418.4 km';
    }
}

function resizeOrbitThree() {
    if (!orbitThreeState.initialized || !orbitThreeState.renderer) return;
    const mount = document.getElementById('orbit-3d-mount');
    if (!mount || mount.clientWidth === 0) return;
    const w = mount.clientWidth;
    const h = mount.clientHeight || 270;
    orbitThreeState.camera.aspect = w / h;
    orbitThreeState.camera.updateProjectionMatrix();
    orbitThreeState.renderer.setSize(w, h);
}

function renderOrbitScene() {
    if (!orbitThreeState.initialized && !orbitThreeState.failed) {
        initOrbitThreeScene();
    }
    if (orbitThreeState.failed || !orbitThreeState.initialized) {
        drawOrbitCanvasFallback();
        return;
    }

    const st = orbitThreeState;
    if (!streamPaused) {
        st.earthMesh.rotation.y += 0.0025;
        st.cloudsMesh.rotation.y += 0.0032;
        st.stars.rotation.y -= 0.0004;
        if (st.moonPivot) st.moonPivot.rotation.y += 0.0045;
        if (st.moonMesh) st.moonMesh.rotation.y += 0.008;
        if (st.earthSystemGroup) {
            st.earthOrbitAngle += 0.0022;
            st.earthSystemGroup.position.set(
                Math.cos(st.earthOrbitAngle) * st.earthOrbitRadius,
                0,
                Math.sin(st.earthOrbitAngle) * st.earthOrbitRadius
            );
        }
        if (st.planets) {
            st.planets.forEach((p) => {
                p.mesh.rotation.y += p.spin;
                if (p.orbitRadius > 0) {
                    p.angle += p.speed;
                    p.mesh.position.set(
                        Math.cos(p.angle) * p.orbitRadius,
                        0,
                        Math.sin(p.angle) * p.orbitRadius
                    );
                }
            });
        }
    }

    // Track moving Earth when zoomed in (LEO), smoothly pull focus to Sun (0,0,0) when zooming out
    const earthWPos = new window.THREE.Vector3();
    if (st.earthSystemGroup) {
        st.earthSystemGroup.updateMatrixWorld(true);
        st.earthSystemGroup.getWorldPosition(earthWPos);
    }
    st.smoothZoom += (st.zoom - st.smoothZoom) * 0.15;
    const solarFactor = Math.min(1, Math.max(0, (st.smoothZoom - 5.2) / 10.5));
    const desiredFocus = earthWPos.clone().multiplyScalar(1 - solarFactor);
    if (!st.focusPos) st.focusPos = desiredFocus.clone();
    else st.focusPos.lerp(desiredFocus, 0.14);

    const elev = Math.max(-1.25, Math.min(1.25, st.rotX + solarFactor * 0.28));
    st.camera.position.set(
        st.focusPos.x + st.smoothZoom * Math.cos(elev) * Math.sin(st.rotY),
        st.focusPos.y + st.smoothZoom * Math.sin(elev),
        st.focusPos.z + st.smoothZoom * Math.cos(elev) * Math.cos(st.rotY)
    );
    st.camera.lookAt(st.focusPos);
    st.stars.position.copy(st.focusPos);

    if (st.solarOrbitMats) {
        const solarAlpha = Math.min(0.42, Math.max(0, (st.smoothZoom - 4.8) * 0.05));
        st.solarOrbitMats.forEach(mat => { mat.opacity = solarAlpha; });
    }
    const badge = document.getElementById('orbit-mode-badge');
    if (badge) {
        badge.textContent = st.smoothZoom > 5.8
            ? '3D WEBGL • SOLAR SYSTEM'
            : '3D WEBGL • LEO 418.4 km';
    }

    // Position spacecraft along 3D circular LEO path
    const r = 1.56;
    st.craftGroup.position.set(Math.cos(orbitAngle) * r, 0, Math.sin(orbitAngle) * r);
    st.craftGroup.rotation.y = -orbitAngle;

    // Update SPE storm colors, spacecraft strobe, & radiation shield sphere
    const pulse = 0.55 + Math.sin(oscPhase * 2.4) * 0.45;
    if (speStormActive) {
        st.atmoMat.color.setHex(0xef4444);
        st.atmoMat.opacity = 0.24 + Math.sin(oscPhase * 1.5) * 0.06;
        st.orbitMat.color.setHex(0xf87171);
        st.craftMat.emissive.setHex(0xef4444);
        if (st.beaconMat) { st.beaconMat.color.setHex(0xef4444); st.beaconMat.opacity = pulse; }
        if (st.thrusterMat) { st.thrusterMat.color.setHex(0xfb923c); st.thrusterMat.opacity = 0.65 + pulse * 0.35; }
        st.shieldMesh.visible = true;
        st.shieldMesh.rotation.y -= 0.006;
        st.shieldMat.opacity = Math.max(0.08, (speShieldPct / 100) * 0.34);
        st.shieldMat.color.setHex(speShieldPct >= 70 ? 0x38bdf8 : 0xef4444);
    } else {
        st.atmoMat.color.setHex(0x00e5ff);
        st.atmoMat.opacity = 0.14;
        st.orbitMat.color.setHex(0x00e5ff);
        st.craftMat.emissive.setHex(0x0284c7);
        if (st.beaconMat) { st.beaconMat.color.setHex(0x00e5ff); st.beaconMat.opacity = pulse; }
        if (st.thrusterMat) { st.thrusterMat.color.setHex(0x38bdf8); st.thrusterMat.opacity = 0.6 + pulse * 0.35; }
        st.shieldMesh.visible = false;
    }

    st.renderer.render(st.scene, st.camera);
}

const orbitFallbackState = {
    bound: false,
    dragging: false,
    lastX: 0,
    lastY: 0,
    rotY: 0.2,
    rotX: 0.36,
    zoom: 1,
    planetSpin: 0
};

function drawOrbitCanvasFallback() {
    const cvs = document.getElementById('orbit-3d-canvas');
    if (!cvs) return;
    cvs.classList.remove('hidden');
    const mount = document.getElementById('orbit-3d-mount');
    mount?.classList.add('hidden');
    bindOrbitZoomControls();
    const badge = document.getElementById('orbit-mode-badge');
    if (badge) {
        badge.textContent = orbitFallbackState.zoom < 0.72
            ? '3D CANVAS • SOLAR SYSTEM'
            : '3D CANVAS • LEO 418.4 km';
    }

    if (!orbitFallbackState.bound) {
        orbitFallbackState.bound = true;
        cvs.addEventListener('pointerdown', (e) => {
            orbitFallbackState.dragging = true;
            orbitFallbackState.lastX = e.clientX;
            orbitFallbackState.lastY = e.clientY;
            cvs.setPointerCapture?.(e.pointerId);
        });
        cvs.addEventListener('pointermove', (e) => {
            if (!orbitFallbackState.dragging) return;
            const dx = e.clientX - orbitFallbackState.lastX;
            const dy = e.clientY - orbitFallbackState.lastY;
            orbitFallbackState.lastX = e.clientX;
            orbitFallbackState.lastY = e.clientY;
            orbitFallbackState.rotY += dx * 0.008;
            orbitFallbackState.rotX = Math.max(-1.15, Math.min(1.15, orbitFallbackState.rotX + dy * 0.008));
        });
        const stop = () => { orbitFallbackState.dragging = false; };
        cvs.addEventListener('pointerup', stop);
        cvs.addEventListener('pointercancel', stop);
        cvs.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.89 : 1.12;
            orbitFallbackState.zoom = Math.max(0.11, Math.min(1.45, orbitFallbackState.zoom * factor));
        }, { passive: false });
    }

    if (!streamPaused) {
        orbitFallbackState.planetSpin += 0.012;
    }

    const ctx = cvs.getContext('2d');
    const w = cvs.width = (cvs.parentElement?.clientWidth || 548) - 28;
    const h = cvs.height = 270;
    const cx = w / 2;
    const cy = h / 2;
    const focal = 460;
    const zScale = orbitFallbackState.zoom;
    const earthR = 54 * zScale;
    const orbitR = 132 * zScale;
    const tilt = 0.44; // 51.6 deg ISS-like inclination

    // Deep space background & starfield
    const bgGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.7);
    bgGrad.addColorStop(0, '#091529');
    bgGrad.addColorStop(1, '#040812');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 65; i++) {
        const sx = ((Math.sin(i * 127.1 + orbitFallbackState.rotY * 0.6) * 0.5 + 0.5) * w);
        const sy = ((Math.cos(i * 311.7 + orbitFallbackState.rotX * 0.6) * 0.5 + 0.5) * h);
        const alpha = 0.25 + (i % 5) * 0.14;
        ctx.fillStyle = `rgba(226, 232, 240, ${alpha.toFixed(2)})`;
        ctx.fillRect(sx, sy, (i % 4 === 0 ? 2 : 1.2), (i % 4 === 0 ? 2 : 1.2));
    }

    const rotX = orbitFallbackState.rotX;
    const rotY = orbitFallbackState.rotY;
    const cosRX = Math.cos(rotX), sinRX = Math.sin(rotX);
    const cosRY = Math.cos(rotY), sinRY = Math.sin(rotY);

    function rotateVec(x, y, z) {
        const x1 = x * cosRY - z * sinRY;
        const z1 = x * sinRY + z * cosRY;
        const y2 = y * cosRX - z1 * sinRX;
        const z2 = y * sinRX + z1 * cosRX;
        return { x: x1, y: y2, z: z2 };
    }

    const unitPx = earthR;
    const solarTime = orbitFallbackState.planetSpin * 0.22;
    const earthHelioR = 8.6;
    const earthHelioAng = 0.35 + solarTime * 0.45;
    const earthW = {
        x: Math.cos(earthHelioAng) * earthHelioR,
        y: Math.sin(earthHelioAng) * earthHelioR * 0.14,
        z: Math.sin(earthHelioAng) * earthHelioR * 0.92
    };
    const solarBlend = Math.min(1, Math.max(0, (0.82 - zScale) / 0.44));
    const focusW = {
        x: earthW.x * (1 - solarBlend),
        y: earthW.y * (1 - solarBlend),
        z: earthW.z * (1 - solarBlend)
    };

    function projectPt(x, y, z) {
        const denom = Math.max(80, focal - z);
        const scale = focal / denom;
        return { px: cx + x * scale, py: cy + y * scale, z, scale };
    }

    function worldToScreen(wx, wy, wz) {
        const rv = rotateVec((wx - focusW.x) * unitPx, (wy - focusW.y) * unitPx, (wz - focusW.z) * unitPx);
        return projectPt(rv.x, rv.y, rv.z);
    }

    const earthScreen = worldToScreen(earthW.x, earthW.y, earthW.z);
    const earthScrR = earthR * earthScreen.scale;

    function orbitPoint3D(theta) {
        const leoRWorld = 2.44;
        const ox = Math.cos(theta) * leoRWorld;
        const oz = Math.sin(theta) * leoRWorld;
        const ix = ox * Math.cos(tilt);
        const iy = ox * Math.sin(tilt);
        return worldToScreen(earthW.x + ix, earthW.y + iy, earthW.z + oz);
    }

    // Sample full 3D LEO orbit ring around moving Earth
    const segs = 72;
    const ringPts = [];
    for (let i = 0; i <= segs; i++) {
        ringPts.push(orbitPoint3D((i / segs) * Math.PI * 2));
    }

    const drawOrbitHalf = (isFront) => {
        ctx.lineWidth = isFront ? 1.8 : 1.2;
        ctx.setLineDash(isFront ? [] : [4, 5]);
        ctx.strokeStyle = speStormActive
            ? (isFront ? 'rgba(248, 113, 113, 0.85)' : 'rgba(239, 68, 68, 0.28)')
            : (isFront ? 'rgba(0, 229, 255, 0.8)' : 'rgba(56, 189, 248, 0.24)');
        for (let i = 0; i < segs; i++) {
            const p1 = ringPts[i];
            const p2 = ringPts[i + 1];
            const midZ = (p1.z + p2.z) * 0.5;
            if ((isFront && midZ >= earthScreen.z) || (!isFront && midZ < earthScreen.z)) {
                ctx.beginPath();
                ctx.moveTo(p1.px, p1.py);
                ctx.lineTo(p2.px, p2.py);
                ctx.stroke();
            }
        }
        ctx.setLineDash([]);
    };

    const craftNow = orbitPoint3D(orbitAngle);
    const craftNext = orbitPoint3D(orbitAngle + 0.08);
    const drawSpacecraft3D = () => {
        const dx = craftNext.px - craftNow.px;
        const dy = craftNext.py - craftNow.py;
        const angle = Math.atan2(dy, dx);
        const sc = craftNow.scale * zScale;

        ctx.save();
        ctx.translate(craftNow.px, craftNow.py);

        // Ion thruster flame & strobe aura
        const pulse = 0.65 + Math.sin(oscPhase * 3) * 0.35;
        ctx.save();
        ctx.rotate(angle);
        ctx.scale(sc, sc);

        // Dual wide photovoltaic solar arrays (perpendicular to hull)
        ctx.fillStyle = '#0284c7';
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 0.9;
        ctx.fillRect(-3.5, -24, 7, 17);
        ctx.strokeRect(-3.5, -24, 7, 17);
        ctx.fillRect(-3.5, 7, 7, 17);
        ctx.strokeRect(-3.5, 7, 7, 17);
        // Gold truss spar
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(0, 8);
        ctx.stroke();

        // Ion thruster glow (-X)
        const flameGrad = ctx.createRadialGradient(-13, 0, 1, -13, 0, 9);
        flameGrad.addColorStop(0, speStormActive ? `rgba(251, 146, 60, ${pulse})` : `rgba(56, 189, 248, ${pulse})`);
        flameGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');
        ctx.fillStyle = flameGrad;
        ctx.beginPath();
        ctx.arc(-13, 0, 9, 0, Math.PI * 2);
        ctx.fill();

        // Main pressurized cylinder hull
        const hullGrad = ctx.createLinearGradient(0, -4.5, 0, 4.5);
        hullGrad.addColorStop(0, '#f8fafc');
        hullGrad.addColorStop(0.6, '#cbd5e1');
        hullGrad.addColorStop(1, '#475569');
        ctx.fillStyle = hullGrad;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-10, -4.2, 18, 8.4, 2) : ctx.rect(-10, -4.2, 18, 8.4);
        ctx.fill();

        // Forward docking nose cone (+X)
        ctx.fillStyle = speStormActive ? '#ef4444' : '#00e5ff';
        ctx.beginPath();
        ctx.moveTo(8, -3.8);
        ctx.lineTo(15, 0);
        ctx.lineTo(8, 3.8);
        ctx.closePath();
        ctx.fill();

        // Navigation beacon
        ctx.fillStyle = speStormActive ? `rgba(239, 68, 68, ${pulse})` : `rgba(0, 229, 255, ${pulse})`;
        ctx.beginPath();
        ctx.arc(1, 0, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Callout label
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 10px monospace';
        ctx.fillText('AERO-MED LEO', 14 * sc, -8 * sc);
        ctx.restore();
    };

    // Compute 3D Moon (attached to moving Earth) + Sun at (0,0,0) + Solar System Planets
    const moonAng = orbitAngle * 0.32 + 1.1;
    const bodySpecs = [
        {
            name: 'MOON', r: 0.24, c1: '#e2e8f0', c2: '#94a3b8', c3: '#334155',
            wx: earthW.x + Math.cos(moonAng) * 2.65,
            wy: earthW.y + Math.sin(moonAng) * 0.45,
            wz: earthW.z + Math.sin(moonAng) * 2.65
        },
        { name: 'SUN', r: 1.5, c1: '#fef08a', c2: '#f59e0b', c3: '#ea580c', wx: 0, wy: 0, wz: 0, isSun: true },
        { name: 'MERCURY', r: 0.28, c1: '#cbd5e1', c2: '#64748b', c3: '#334155', orbitSun: 2.8,  a0: -0.45 + solarTime * 1.4,  tilt: 0.12 },
        { name: 'VENUS',   r: 0.48, c1: '#fde68a', c2: '#f59e0b', c3: '#92400e', orbitSun: 5.0,  a0: 1.15 + solarTime * 0.9,   tilt: -0.08 },
        { name: 'MARS',    r: 0.46, c1: '#fca5a5', c2: '#ea580c', c3: '#7c2d12', orbitSun: 11.6, a0: -0.95 + solarTime * 0.36, tilt: 0.09 },
        { name: 'JUPITER', r: 1.05, c1: '#fef3c7', c2: '#d97706', c3: '#78350f', orbitSun: 15.0, a0: 0.65 + solarTime * 0.24,  tilt: -0.05, bands: true },
        { name: 'SATURN',  r: 0.85, c1: '#fef9c3', c2: '#eab308', c3: '#713f12', orbitSun: 18.2, a0: -2.25 + solarTime * 0.18, tilt: 0.12,  ringColor: 'rgba(253, 230, 138, 0.74)' },
        { name: 'URANUS',  r: 0.56, c1: '#a5f3fc', c2: '#22d3ee', c3: '#155e75', orbitSun: 20.8, a0: 2.15 + solarTime * 0.14,  tilt: 0.16,  ringColor: 'rgba(103, 232, 249, 0.48)' },
        { name: 'NEPTUNE', r: 0.55, c1: '#93c5fd', c2: '#2563eb', c3: '#1e3a8a', orbitSun: 23.2, a0: -0.15 + solarTime * 0.11, tilt: -0.10 }
    ];

    // Faint heliocentric 3D orbit tracks around Sun when zooming out (including Earth's cyan track!)
    if (solarBlend > 0.04) {
        const trackSpecs = [
            { r: 2.8, tilt: 0.12, isEarth: false },
            { r: 5.0, tilt: -0.08, isEarth: false },
            { r: earthHelioR, tilt: 0.14, isEarth: true },
            { r: 11.6, tilt: 0.09, isEarth: false },
            { r: 15.0, tilt: -0.05, isEarth: false },
            { r: 18.2, tilt: 0.12, isEarth: false },
            { r: 20.8, tilt: 0.16, isEarth: false },
            { r: 23.2, tilt: -0.10, isEarth: false }
        ];
        trackSpecs.forEach((tr) => {
            ctx.beginPath();
            for (let i = 0; i <= 64; i++) {
                const a = (i / 64) * Math.PI * 2;
                const pt = worldToScreen(
                    Math.cos(a) * tr.r,
                    Math.sin(a) * tr.r * tr.tilt,
                    Math.sin(a) * tr.r * 0.92
                );
                if (i === 0) ctx.moveTo(pt.px, pt.py);
                else ctx.lineTo(pt.px, pt.py);
            }
            ctx.strokeStyle = tr.isEarth
                ? `rgba(0, 229, 255, ${(0.45 * solarBlend).toFixed(2)})`
                : `rgba(148, 163, 184, ${(0.22 * solarBlend).toFixed(2)})`;
            ctx.lineWidth = tr.isEarth ? 1.4 : 0.9;
            ctx.stroke();
        });
    }

    const projectedBodies = bodySpecs.map((b) => {
        let wx = b.wx, wy = b.wy, wz = b.wz;
        if (b.orbitSun) {
            wx = Math.cos(b.a0) * b.orbitSun;
            wy = Math.sin(b.a0) * b.orbitSun * b.tilt;
            wz = Math.sin(b.a0) * b.orbitSun * 0.92;
        }
        const pt = worldToScreen(wx, wy, wz);
        return { ...b, px: pt.px, py: pt.py, z: pt.z, pr: Math.max(2.5, b.r * unitPx * pt.scale) };
    }).sort((a, b) => a.z - b.z);

    const drawPlanetBody = (p) => {
        if (p.px + p.pr * 2.5 < -20 || p.px - p.pr * 2.5 > w + 20 || p.py + p.pr * 2.5 < -20 || p.py - p.pr * 2.5 > h + 20) return;
        ctx.save();
        if (p.isSun) {
            const sg = ctx.createRadialGradient(p.px, p.py, p.pr * 0.4, p.px, p.py, p.pr * 2.1);
            sg.addColorStop(0, 'rgba(253, 224, 71, 0.58)');
            sg.addColorStop(1, 'rgba(245, 158, 11, 0)');
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.arc(p.px, p.py, p.pr * 2.1, 0, Math.PI * 2);
            ctx.fill();
        }
        const g = ctx.createRadialGradient(p.px - p.pr * 0.32, p.py - p.pr * 0.32, p.pr * 0.12, p.px, p.py, p.pr);
        g.addColorStop(0, p.c1);
        g.addColorStop(0.55, p.c2);
        g.addColorStop(1, p.c3);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.px, p.py, p.pr, 0, Math.PI * 2);
        ctx.fill();

        if (p.bands && p.pr > 6) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(p.px, p.py, p.pr, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = 'rgba(120, 53, 15, 0.25)';
            ctx.fillRect(p.px - p.pr, p.py - p.pr * 0.35, p.pr * 2, p.pr * 0.22);
            ctx.fillRect(p.px - p.pr, p.py + p.pr * 0.15, p.pr * 2, p.pr * 0.18);
            ctx.restore();
        }

        if (p.ringColor) {
            ctx.strokeStyle = p.ringColor;
            ctx.lineWidth = Math.max(1.2, p.pr * 0.22);
            ctx.beginPath();
            ctx.ellipse(p.px, p.py, p.pr * 2.05, p.pr * 0.56, -0.32, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (zScale < 0.78 || p.name === 'MOON') {
            ctx.fillStyle = '#cbd5e1';
            ctx.font = 'bold 9px monospace';
            ctx.fillText(p.name, p.px + p.pr + 4, p.py + 3);
        }
        ctx.restore();
    };

    // 1. Back-half planets, orbit & spacecraft (when behind Earth)
    projectedBodies.filter(b => b.z < earthScreen.z).forEach(drawPlanetBody);
    drawOrbitHalf(false);
    if (craftNow.z < earthScreen.z) drawSpacecraft3D();

    // 2. Rotating 3D shaded Earth globe (orbiting Sun at earthScreen)
    const ex = earthScreen.px;
    const ey = earthScreen.py;
    ctx.save();
    const atmoGlow = ctx.createRadialGradient(ex, ey, earthScrR * 0.88, ex, ey, earthScrR * 1.24);
    atmoGlow.addColorStop(0, speStormActive ? 'rgba(239, 68, 68, 0.34)' : 'rgba(0, 229, 255, 0.28)');
    atmoGlow.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = atmoGlow;
    ctx.beginPath();
    ctx.arc(ex, ey, earthScrR * 1.24, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ex, ey, earthScrR, 0, Math.PI * 2);
    ctx.clip();

    const oceanGrad = ctx.createRadialGradient(ex - earthScrR * 0.34, ey - earthScrR * 0.34, earthScrR * 0.12, ex, ey, earthScrR * 1.05);
    oceanGrad.addColorStop(0, '#38bdf8');
    oceanGrad.addColorStop(0.45, '#0284c7');
    oceanGrad.addColorStop(0.85, '#0c4a6e');
    oceanGrad.addColorStop(1, '#041428');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(ex - earthScrR, ey - earthScrR, earthScrR * 2, earthScrR * 2);

    const spin = orbitFallbackState.planetSpin;
    const spherePt = (lat, lon) => {
        const cLat = Math.cos(lat);
        const x = earthScrR * cLat * Math.sin(lon + spin);
        const y = -earthScrR * Math.sin(lat);
        const z = earthScrR * cLat * Math.cos(lon + spin);
        const yTilt = y * cosRX - z * sinRX;
        const zTilt = y * sinRX + z * cosRX;
        return { px: ex + x, py: ey + yTilt, z: zTilt };
    };

    // Stylized 3D landmass blobs projected onto sphere
    const landPatches = [
        { lat: 0.45, lon: -1.6, r: 15 }, { lat: 0.2, lon: -1.1, r: 11 },
        { lat: 0.55, lon: 0.3, r: 14 }, { lat: 0.1, lon: 0.4, r: 16 },
        { lat: -0.35, lon: -1.0, r: 13 }, { lat: 0.6, lon: 1.8, r: 18 },
        { lat: -0.4, lon: 2.3, r: 12 }
    ];
    landPatches.forEach(lp => {
        const p = spherePt(lp.lat, lp.lon);
        if (p.z > 0) {
            const foreshorten = Math.max(0.2, p.z / earthScrR);
            ctx.fillStyle = 'rgba(34, 197, 94, 0.42)';
            ctx.beginPath();
            ctx.ellipse(p.px, p.py, lp.r * foreshorten * zScale * earthScreen.scale, lp.r * 0.78 * zScale * earthScreen.scale, 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    // 3D wireframe meridians & parallels on visible hemisphere
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.18)';
    ctx.lineWidth = 0.8;
    for (let lon = 0; lon < Math.PI * 2; lon += Math.PI / 4) {
        ctx.beginPath();
        let pen = false;
        for (let lat = -Math.PI / 2; lat <= Math.PI / 2; lat += 0.16) {
            const p = spherePt(lat, lon);
            if (p.z > 0) {
                if (!pen) { ctx.moveTo(p.px, p.py); pen = true; }
                else ctx.lineTo(p.px, p.py);
            } else { pen = false; }
        }
        ctx.stroke();
    }
    for (let lat = -Math.PI / 3; lat <= Math.PI / 3; lat += Math.PI / 6) {
        ctx.beginPath();
        let pen = false;
        for (let lon = 0; lon <= Math.PI * 2 + 0.2; lon += 0.16) {
            const p = spherePt(lat, lon);
            if (p.z > 0) {
                if (!pen) { ctx.moveTo(p.px, p.py); pen = true; }
                else ctx.lineTo(p.px, p.py);
            } else { pen = false; }
        }
        ctx.stroke();
    }
    ctx.restore();

    if (solarBlend > 0.25) {
        ctx.fillStyle = '#00e5ff';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('EARTH', ex + earthScrR + 4, ey + 3);
    }

    // 3. SPE Shield sphere overlay (when active)
    if (speStormActive) {
        ctx.strokeStyle = speShieldPct >= 70 ? 'rgba(56, 189, 248, 0.35)' : 'rgba(239, 68, 68, 0.42)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(ex, ey, earthScrR * 1.48, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 4. Front-half orbit, spacecraft & foreground planets (when in front of Earth)
    drawOrbitHalf(true);
    if (craftNow.z >= earthScreen.z) drawSpacecraft3D();
    projectedBodies.filter(b => b.z >= earthScreen.z).forEach(drawPlanetBody);
}

// ==================== AUTO-RESTART & CALIBRATION RECOVERY ====================
function recalibrateEquipment(eqId) {
    const eq = equipmentList.find(x => x.id === eqId);
    if (!eq) return;

    const today = new Date().toISOString().slice(0, 10);
    eq.status = 'OPERATIONAL';
    eq.lastInspection = today;
    eq.condEn = 'System restarted & calibrated — 100% nominal';
    eq.condRu = 'Система перезапущена и откалибрована — 100% норма';
    eq.condAz = 'Sistem yenidən başladıldı və kalibrləndi — 100% nominal';
    if (!Array.isArray(eq.maintenanceHistory)) eq.maintenanceHistory = [];
    eq.maintenanceHistory.unshift(`${today}: Restart & Calibration -> OPERATIONAL`);

    saveToStorage(STORAGE_KEYS.EQUIPMENT, equipmentList);

    if (!isFileProtocol() && !isOfflineFallbackMode) {
        fetch('/api/inspections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                equipment_id: eq.id,
                equipment_name: trField(eq, 'name'),
                inspector: 'AERO-MED AUTO-CAL',
                date: today,
                next_inspection: eq.nextInspection || today,
                passed_count: CHECKLIST_TEMPLATE.length,
                total_count: CHECKLIST_TEMPLATE.length,
                resulting_status: 'OPERATIONAL',
                notes: eq.condEn
            })
        }).catch(() => activateOfflineMode(true));
    }

    addActivityLog(
        'INFO',
        `${eq.id} (${eq.nameEn}) restarted & calibrated -> ${t('st_RESOLVED')}.`,
        `${eq.id} (${eq.nameRu}) перезапущен и откалиброван -> ${t('st_RESOLVED')}.`,
        `${eq.id} (${eq.nameAz}) yenidən başladıldı və kalibrləndi -> ${t('st_RESOLVED')}.`
    );

    showToast(trField(eq, 'name'), t('st_RESOLVED'), 'low');
    updateGlobalStatusPill();
    renderAllViews();
}

function recalibrateCrewSystem(crewId) {
    const astro = crewMembers.find(c => c.id === crewId);
    if (!astro) return;

    const base = INITIAL_CREW.find(c => c.id === crewId);
    astro.mode = 'normal';
    astro.manual = false;
    astro.vitals = base && base.vitals
        ? cloneDeep(base.vitals)
        : cloneDeep(SCENARIO_PROFILES.normal);
    if (astro.radiation) {
        astro.radiation.rate = base?.radiation?.rate ?? 0.42;
    }
    if (!crewMembers.some(c => c.radiation && c.radiation.rate > 1.5)) {
        speStormActive = false;
        speShieldPct = 100;
        speShelterEndsAt = 0;
        syncRadiationActivityGuard();
        updateSpeHudUI();
    }

    addActivityLog(
        'INFO',
        `${astro.name} (${astro.id}) biometric sensors calibrated -> ${t('st_RESOLVED')}.`,
        `${astro.name} (${astro.id}) биометрические датчики откалиброваны -> ${t('st_RESOLVED')}.`,
        `${astro.name} (${astro.id}) biometrik sensorları kalibrləndi -> ${t('st_RESOLVED')}.`
    );

    showToast(astro.name, t('st_RESOLVED'), 'low');
    updateGlobalStatusPill();
    renderAllViews();
}

// ==================== AI CLINICAL MEDICAL ADVISOR ====================
function getClinicalAdvisory(astro) {
    const v = astro.vitals;
    const directives = [];

    if (v.sys < 96 || (v.hr > 110 && v.sys <= 102)) {
        directives.push({
            prio: v.sys < 90 || v.hr > 125 ? 'HIGH' : 'MEDIUM',
            trigger: `BP ${Math.round(v.sys)}/${Math.round(v.dia)} mmHg • HR ${Math.round(v.hr)} BPM`,
            actionEn: 'Recommended Action: Administer 200 mL IV fluid bolus (0.9% NaCl), lower-extremity compression, and horizontal rest.',
            actionRu: 'Рекомендуемое действие: В/в введение 200 мл физраствора (0.9% NaCl), компрессия ног и горизонтальный покой.',
            actionAz: 'Tövsiyə olunan tədbir: 200 ml İV maye köçürülməsi (0.9% NaCl fizioloji məhlul) və horizontal istirahət.'
        });
    } else if (v.hr > 115) {
        directives.push({
            prio: v.hr > 125 ? 'HIGH' : 'MEDIUM',
            trigger: `HR ${Math.round(v.hr)} BPM (Base ${astro.baseline.hr} BPM)`,
            actionEn: 'Recommended Action: Stop physical workload, administer 200 mL IV electrolyte replenishment, and engage continuous ECG.',
            actionRu: 'Рекомендуемое действие: Прекратить нагрузку, выполнить инфузию 200 мл В/в раствора электролитов и включить ЭКГ.',
            actionAz: 'Tövsiyə olunan tədbir: Fiziki yükü dayandırın, 200 ml İV maye/elektrolit köçürülməsi və fasiləsiz EKQ tətbiq edin.'
        });
    } else if (v.hr < 50) {
        directives.push({
            prio: 'HIGH',
            trigger: `HR ${Math.round(v.hr)} BPM (Bradycardia)`,
            actionEn: 'Recommended Action: Capture 12-lead ECG trace immediately and alert Flight Surgeon for atropine readiness.',
            actionRu: 'Рекомендуемое действие: Снять 12-канальную ЭКГ и уведомить врача полёта (протокол брадикардии).',
            actionAz: 'Tövsiyə olunan tədbir: Dərhal 12-kanal EKQ qeydiyyatı aparın və bradikardiya protokolu üzrə uçuş həkiminə bildirin.'
        });
    }

    if (v.sys >= 140 || v.dia >= 92) {
        directives.push({
            prio: v.sys >= 150 ? 'HIGH' : 'MEDIUM',
            trigger: `BP ${Math.round(v.sys)}/${Math.round(v.dia)} mmHg`,
            actionEn: 'Recommended Action: Reduce workload, start paced breathing protocol, and verify antihypertensive clearance with Flight Surgeon.',
            actionRu: 'Рекомендуемое действие: Снизить нагрузку, начать управляемое дыхание и согласовать контроль АД с врачом полёта.',
            actionAz: 'Tövsiyə olunan tədbir: Yükü azaldın, sakit tənəffüs protokolu və uçuş həkimi nəzarəti ilə təzyiq tənzimlənməsi tətbiq edin.'
        });
    }

    if (v.spo2 < 94) {
        directives.push({
            prio: v.spo2 < 90 ? 'HIGH' : 'MEDIUM',
            trigger: `SpO2 ${v.spo2.toFixed(1)}% • pCO2 ${v.co2.toFixed(1)} mmHg`,
            actionEn: 'Recommended Action: Supply 100% O2 via emergency mask (4–6 L/min) and check cabin ECLSS oxygen loop.',
            actionRu: 'Рекомендуемое действие: Подать 100% O2 через маску (4–6 л/мин) и проверить контур кислорода СОЖ.',
            actionAz: 'Tövsiyə olunan tədbir: Dərhal maska ilə 100% O2 verin (4–6 L/dəq) və kabin ECLSS oksigen dövrəsini yoxlayın.'
        });
    }

    if (v.temp >= 37.8) {
        directives.push({
            prio: v.temp >= 38.2 ? 'HIGH' : 'MEDIUM',
            trigger: `Temp ${formatTemp(v.temp)} ${getTempUnit()}`,
            actionEn: 'Recommended Action: Activate LCVG thermal cooling, give 200 mL IV chilled hydration, and run inflammatory marker panel.',
            actionRu: 'Рекомендуемое действие: Включить охлаждение LCVG, провести 200 мл В/в регидратацию и проверить маркеры воспаления.',
            actionAz: 'Tövsiyə olunan tədbir: LCVG aktiv soyutmanı işə salın, 200 ml İV maye dəstəyi və iltihab marker skrininqi aparın.'
        });
    }

    if (astro.radiation && astro.radiation.rate >= 2.0) {
        directives.push({
            prio: 'HIGH',
            trigger: `Radiation ${astro.radiation.rate.toFixed(2)} mSv/d`,
            actionEn: 'Recommended Action: Relocate crew immediately to shielded Command Module storm shelter.',
            actionRu: 'Рекомендуемое действие: Немедленно эвакуировать экипаж в радиационное укрытие командного отсека.',
            actionAz: 'Tövsiyə olunan tədbir: Ekipajı dərhal Komanda Modulunun radiasiya sığınacağına köçürün.'
        });
    }

    return directives;
}

function renderAdvisorPanel(panelId, badgeId, bodyId, targets) {
    const panel = document.getElementById(panelId);
    const badge = document.getElementById(badgeId);
    const body = document.getElementById(bodyId);
    if (!panel || !body) return;

    const entries = [];
    targets.forEach(astro => {
        getClinicalAdvisory(astro).forEach((d, advIdx) => {
            entries.push({ ...d, advIdx, astroId: astro.id, astroName: astro.name });
        });
    });

    const hasCrit = entries.some(e => e.prio === 'HIGH');
    panel.classList.toggle('advisor-alert', entries.length > 0);
    if (badge) {
        badge.className = `badge-state ${hasCrit ? 'crit' : entries.length > 0 ? 'warn' : 'ok'}`;
        badge.textContent = entries.length > 0 ? t('ai_advisor_badge_active') : t('ai_advisor_badge_standby');
    }

    if (entries.length === 0) {
        body.innerHTML = `<div class="advisor-nominal">${escapeHtml(t('ai_advisor_nominal'))}</div>`;
        return;
    }

    body.innerHTML = entries.map(item => `
        <div class="advisor-card ${item.prio === 'HIGH' ? 'crit' : 'warn'}">
            <div class="advisor-card-head">
                <strong>${escapeHtml(item.astroName)} (${escapeHtml(item.astroId)})</strong>
                <span class="advisor-trigger">${escapeHtml(item.trigger)}</span>
            </div>
            <div class="advisor-directive">${escapeHtml(trField(item, 'action'))}</div>
            <div class="advisor-actions">
                <button type="button" class="btn btn-xs btn-advisor-apply" data-log-advisory="${escapeHtml(item.astroId)}" data-adv-idx="${item.advIdx}">${escapeHtml(t('ai_advisor_apply_btn'))}</button>
                <button type="button" class="btn btn-xs btn-recal" data-recal-crew="${escapeHtml(item.astroId)}">${escapeHtml(t('btn_recalibrate_short'))}</button>
            </div>
        </div>
    `).join('');
}

document.addEventListener('click', (e) => {
    const advBtn = e.target.closest('[data-log-advisory]');
    if (advBtn) {
        const cid = advBtn.getAttribute('data-log-advisory');
        const idx = Number(advBtn.getAttribute('data-adv-idx') || 0);
        const astro = crewMembers.find(c => c.id === cid);
        if (!astro) return;
        const dirs = getClinicalAdvisory(astro);
        const chosen = dirs[idx] || dirs[0];
        const msgEn = chosen ? `${astro.name}: ${chosen.actionEn}` : `${astro.name}: Clinical intervention logged.`;
        const msgRu = chosen ? `${astro.name}: ${chosen.actionRu}` : `${astro.name}: Медицинское вмешательство записано.`;
        const msgAz = chosen ? `${astro.name}: ${chosen.actionAz}` : `${astro.name}: Tibbi tədbir qeydə alındı.`;
        addActivityLog('INFO', msgEn, msgRu, msgAz);
        showToast(t('ai_advisor_title'), trLang(msgEn, msgRu, msgAz), 'low');
        renderOverview();
        renderEnvironmentSection();
        return;
    }
    const eqBtn = e.target.closest('[data-recal-eq]');
    if (eqBtn) {
        recalibrateEquipment(eqBtn.getAttribute('data-recal-eq'));
        return;
    }
    const crewBtn = e.target.closest('[data-recal-crew]');
    if (crewBtn) {
        recalibrateCrewSystem(crewBtn.getAttribute('data-recal-crew'));
    }
});

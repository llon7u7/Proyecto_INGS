// ══════════════════════════════════════════
//  CONSTANTS & STATE
// ══════════════════════════════════════════
const CFG_KEY            = 'ine_cfg_v1';
const SESSION_KEY        = 'ine_session';
const ENCRYPT_PASS       = 'INE_SCANNER_AES_SECRET_2024';
const OCR_TIMEOUT_MS     = 15000;
const CONFIDENCE_THRESHOLD = 85;

// ── SUPABASE ─────────────────────────────
const supabaseUrl = 'https://irshnqkotnquwawlohlj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlyc2hucWtvdG5xdXdhd2xvaGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMDY0ODQsImV4cCI6MjA5Mzc4MjQ4NH0.KbJI-gfQYYwN6Sansc_pGiE4WRVDElCPkjh7aX0kxVs';
const clienteSupabase = window.supabase.createClient(supabaseUrl, supabaseKey);
window.supabase = clienteSupabase;

const DEFAULT_ADMIN_HASH = CryptoJS.SHA256('admin:admin123').toString();

// ── ESTADO GLOBAL ────────────────────────
// Cada lado (frente / reverso) tiene su propio estado
const state = {
  frente: {
    image: null,        // base64 sin prefijo
    dataURL: null,      // dataURL completo para mostrar
    data: null,         // datos extraídos por OCR
    scanned: false
  },
  reverso: {
    image: null,
    dataURL: null,
    data: null,         // sólo contiene folio + imagenReverso
    scanned: false
  }
};

let currentData    = null;  // datos combinados listos para guardar
let allRecords     = [];
let page           = 1;
const PAGE_SIZE    = 10;

// mediaStreams separados por lado
const streams = { frente: null, reverso: null };

// ── CONFIG ───────────────────────────────
function getCfg() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return {};
    return JSON.parse(CryptoJS.AES.decrypt(raw, ENCRYPT_PASS).toString(CryptoJS.enc.Utf8));
  } catch { return {}; }
}
function saveCfg(cfg) {
  localStorage.setItem(CFG_KEY,
    CryptoJS.AES.encrypt(JSON.stringify(cfg), ENCRYPT_PASS).toString());
}

// ── AUTH (Supabase) ──────────────────────
async function doLogin() {
  const email = document.getElementById('loginUser').value.trim();
  const pass  = document.getElementById('loginPass').value;
  if (!email || !pass) {
    showLoginErr('Por favor ingresa tu correo y contraseña.');
    return;
  }
  showLoginErr('', false);
  const { error } = await clienteSupabase.auth.signInWithPassword({ email, password: pass });
  if (error) {
    showLoginErr('Error: ' + error.message);
  } else {
    setTab('admin');
  }
}
function showLoginErr(msg, show = true) {
  const el = document.getElementById('loginErr');
  el.textContent = msg;
  el.style.display = show ? 'block' : 'none';
}
async function isLoggedIn() {
  const { data } = await clienteSupabase.auth.getSession();
  return data.session !== null;
}
async function logout() {
  await clienteSupabase.auth.signOut();
  setTab('scanner');
}

// ── NAVIGATION ───────────────────────────
async function setTab(tab) {
  ['viewScanner','viewLogin','viewAdmin'].forEach(id =>
    document.getElementById(id).classList.remove('active'));
  if (tab === 'scanner') {
    document.getElementById('viewScanner').classList.add('active');
  } else if (tab === 'admin') {
    if (!await isLoggedIn()) {
      document.getElementById('viewLogin').classList.add('active');
    } else {
      document.getElementById('viewAdmin').classList.add('active');
      loadAdminView();
    }
  } else if (tab === 'login') {
    document.getElementById('viewLogin').classList.add('active');
  }
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
}

// ══════════════════════════════════════════
//  STEPPER — manejo de pasos
// ══════════════════════════════════════════
function goToStep(n) {
  // Actualiza clases del stepper
  const s1 = document.getElementById('step1');
  const s2 = document.getElementById('step2');
  const pF = document.getElementById('panelFrente');
  const pR = document.getElementById('panelReverso');

  if (n === 1) {
    s1.className = 'step active';
    s2.className = 'step';
    pF.classList.add('active');
    pR.classList.remove('active');
  } else {
    s1.className = 'step done';
    s2.className = 'step active';
    pF.classList.remove('active');
    pR.classList.add('active');
  }
}

// Avanza automáticamente al paso 2 después de escanear frente con éxito
function advanceToReverso() {
  goToStep(2);
  document.getElementById('emptyMsg').innerHTML =
    'Frente escaneado ✓<br>Ahora sube el <strong>reverso</strong> para extraer el folio.';
}

// ══════════════════════════════════════════
//  INPUT DE IMAGEN (compartido por ambos lados)
// ══════════════════════════════════════════
function switchInputTab(which, side, btn) {
  const prefix = side.charAt(0).toUpperCase() + side.slice(1);
  document.querySelectorAll(`#tabs${prefix} .tab`).forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`uploadSection${prefix}`).style.display = which === 'upload' ? 'block' : 'none';
  document.getElementById(`cameraSection${prefix}`).style.display = which === 'camera' ? 'block' : 'none';
  if (which === 'camera') startCamera(side);
  else stopCamera(side);
}

function onFileSelect(e, side) {
  const file = e.target.files[0];
  if (!file) return;
  if (!['image/jpeg','image/png','image/heic','image/heif'].includes(file.type)) {
    showSideStatus(side, 'Solo se permiten archivos JPG o PNG.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    state[side].image  = ev.target.result.split(',')[1];
    state[side].dataURL = ev.target.result;
    showPreview(side, ev.target.result);
  };
  reader.readAsDataURL(file);
}

function showPreview(side, src) {
  const prefix = side.charAt(0).toUpperCase() + side.slice(1);
  const img = document.getElementById(`previewImg${prefix}`);
  img.src = src;
  img.style.display = 'block';
  document.getElementById(`btnScan${prefix}`).disabled = false;
  document.getElementById(`btnClear${prefix}`).style.display = 'inline-flex';
}

function clearSide(side) {
  const prefix = side.charAt(0).toUpperCase() + side.slice(1);
  state[side].image  = null;
  state[side].dataURL = null;
  state[side].data   = null;
  state[side].scanned = false;
  const img = document.getElementById(`previewImg${prefix}`);
  img.style.display = 'none';
  img.src = '';
  document.getElementById(`btnScan${prefix}`).disabled = true;
  document.getElementById(`btnClear${prefix}`).style.display = 'none';
  document.getElementById(`fileInput${prefix}`).value = '';
  hideSideStatus(side);

  // Si limpiamos frente, reseteamos todo
  if (side === 'frente') {
    clearSide('reverso');
    currentData = null;
    document.getElementById('extractedData').style.display = 'none';
    document.getElementById('emptyExtracted').style.display = 'block';
    document.getElementById('emptyMsg').innerHTML =
      'Sube el <strong>frente</strong> de la INE<br>y presiona «Escanear frente» para comenzar.';
    goToStep(1);
  }
}

// ── Drag & Drop (frente y reverso) ───────
['Frente','Reverso'].forEach(P => {
  const side = P.toLowerCase();
  const dz = document.getElementById(`dropZone${P}`);
  if (!dz) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = ev => {
        state[side].image  = ev.target.result.split(',')[1];
        state[side].dataURL = ev.target.result;
        showPreview(side, ev.target.result);
      };
      r.readAsDataURL(f);
    }
  });
});

// ── CÁMARA ───────────────────────────────
async function startCamera(side) {
  const prefix = side.charAt(0).toUpperCase() + side.slice(1);
  try {
    streams[side] = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    document.getElementById(`video${prefix}`).srcObject = streams[side];
  } catch(err) {
    showSideStatus(side, 'No se pudo acceder a la cámara: ' + err.message, 'error');
  }
}
function stopCamera(side) {
  if (streams[side]) {
    streams[side].getTracks().forEach(t => t.stop());
    streams[side] = null;
  }
}
function capturePhoto(side) {
  const prefix = side.charAt(0).toUpperCase() + side.slice(1);
  const video  = document.getElementById(`video${prefix}`);
  const canvas = document.getElementById(`captureCanvas${prefix}`);
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataURL = canvas.toDataURL('image/jpeg', 0.9);
  state[side].image  = dataURL.split(',')[1];
  state[side].dataURL = dataURL;
  showPreview(side, dataURL);
  stopCamera(side);
  document.getElementById(`cameraSection${prefix}`).style.display = 'none';
  document.getElementById(`uploadSection${prefix}`).style.display = 'block';
  document.querySelectorAll(`#tabs${prefix} .tab`).forEach(t => t.classList.remove('active'));
  document.querySelectorAll(`#tabs${prefix} .tab`)[0].classList.add('active');
}

// ══════════════════════════════════════════
//  NORMALIZACIÓN (RF-03)
// ══════════════════════════════════════════
function normalizeText(str) {
  if (!str) return '';
  return str.toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÜÑ0-9\s\-.,/#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeRecord(data) {
  const out = {};
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (key === 'seccion') {
      out[key] = String(val || '').replace(/\D/g, '').slice(0, 4);
    } else if (key === 'curp' || key === 'claveElector' || key === 'clave_Elector') {
      out[key] = String(val || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
    } else {
      out[key] = normalizeText(String(val || ''));
    }
  }
  return out;
}

// ── CÁLCULO DE CONFIANZA (RF-04) ─────────
function calcConfidence(data) {
  const critical = ['nombre','apellidoPaterno','curp','claveElector','seccion','estado','domicilio'];
  const filled   = critical.filter(f => data[f] && data[f].trim().length > 0).length;
  let fmt = 100;
  const curp  = data.curp  || '';
  const clave = data.claveElector || data.clave_Elector || '';
  const sec   = data.seccion || '';
  if (curp.length  > 0 && !/^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9]{2}$/.test(curp))  fmt -= 20;
  if (clave.length > 0 && clave.length !== 18) fmt -= 15;
  if (sec.length   > 0 && !/^\d{4}$/.test(sec)) fmt -= 10;
  return Math.min(100, Math.max(0, Math.round((filled / critical.length * 100) * 0.6 + fmt * 0.4)));
}

// ── FETCH CON TIMEOUT (RNF-01) ───────────
function fetchWithTimeout(url, options, ms) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ══════════════════════════════════════════
//  PROMPTS OCR
// ══════════════════════════════════════════
const PROMPT_FRENTE = `Eres un sistema OCR especializado en credenciales INE/IFE de México.
Analiza el FRENTE de la credencial y extrae TODOS los datos visibles.
Responde ÚNICAMENTE con un objeto JSON válido, sin markdown ni texto extra.

{
  "nombre": "",
  "apellidoPaterno": "",
  "apellidoMaterno": "",
  "curp": "",
  "clave_Elector": "",
  "fecha_Nacimiento": "",
  "sexo": "",
  "estado": "",
  "municipio": "",
  "seccion": "",
  "vigencia": "",
  "domicilio": "",
  "anioRegistro": "",
  "confianzaOCR": 0
}

Reglas:
- "confianzaOCR": 0-100 según claridad de la imagen.
- "curp" y "clave_Elector": exactamente 18 caracteres alfanuméricos si visibles.
- "seccion": solo dígitos (hasta 4).
- "sexo": "H" hombre, "M" mujer.
- Campos no visibles: cadena vacía "".
- Solo el JSON, sin bloques de código.`;

const PROMPT_REVERSO = `Eres un sistema OCR especializado en credenciales INE/IFE de México.
Analiza el REVERSO de la credencial. Tu objetivo principal es extraer el FOLIO.
Responde ÚNICAMENTE con un objeto JSON válido, sin markdown ni texto extra.

{
  "folio": "",
  "codigoBarras": "",
  "emision": "",
  "confianzaOCR": 0
}

Reglas:
- "folio": número de folio impreso en el reverso (típicamente alfanumérico, cerca del código de barras o en la parte superior).
- "codigoBarras": texto del código de barras si es legible.
- "emision": año o fecha de emisión si aparece en el reverso.
- "confianzaOCR": 0-100 según claridad.
- Solo el JSON, sin bloques de código.`;

// ══════════════════════════════════════════
//  ESCANEAR UN LADO (frente o reverso)
// ══════════════════════════════════════════
async function scanSide(side) {
  if (!state[side].image) return;
  const prefix = side.charAt(0).toUpperCase() + side.slice(1);
  const btn    = document.getElementById(`btnScan${prefix}`);
  btn.disabled = true;

  const label  = side === 'frente' ? 'frente' : 'reverso';
  showSideStatus(side, `Analizando ${label} con Grok (IA)…`, 'loading');

  const prompt = side === 'frente' ? PROMPT_FRENTE : PROMPT_REVERSO;

  try {
    const res = await fetchWithTimeout(
      '/api/grok',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: state[side].image, prompt })
      },
      OCR_TIMEOUT_MS
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || err.error || 'Error en el servidor (' + res.status + ')');
    }

    const data    = await res.json();
    const text    = data.choices?.[0]?.message?.content || '';
    const clean   = text.replace(/```json|```/g, '').trim();
    const rawData = JSON.parse(clean);

    const normalized   = normalizeRecord(rawData);
    const apiConf      = parseInt(rawData.confianzaOCR) || 0;
    const calcConf     = calcConfidence(normalized);
    const finalConf    = Math.min(apiConf || calcConf, calcConf);

    normalized.confianzaOCR     = finalConf;
    normalized.requiereRevision = finalConf < CONFIDENCE_THRESHOLD;

    state[side].data    = normalized;
    state[side].scanned = true;

    if (side === 'frente') {
      // Mostrar resultados parciales del frente y avanzar al paso 2
      mergeAndShowData();
      showSideStatus(side,
        `✓ Frente escaneado · Confianza: ${finalConf}% · Ahora escanea el reverso para el folio`,
        finalConf < CONFIDENCE_THRESHOLD ? 'warn' : 'success');
      advanceToReverso();
    } else {
      // Reverso: combinar folio con datos del frente
      mergeAndShowData();
      const folio = normalized.folio || '(no detectado)';
      showSideStatus(side,
        `✓ Reverso escaneado · Folio: ${folio} · Confianza: ${finalConf}%`,
        finalConf < CONFIDENCE_THRESHOLD ? 'warn' : 'success');
      // Marcar paso 2 como listo
      document.getElementById('step2').className = 'step done';
    }

  } catch(err) {
    const msg = err.name === 'AbortError'
      ? '⏱ Tiempo agotado. Intenta con una imagen más clara o de menor peso.'
      : 'Error: ' + err.message;
    showSideStatus(side, msg, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Omitir reverso ────────────────────────
function skipReverso() {
  if (!state.frente.scanned) {
    alert('Primero escanea el frente de la INE.');
    return;
  }
  state.reverso.data = { folio: '', codigoBarras: '', emision: '', confianzaOCR: 0 };
  state.reverso.scanned = false; // no escaneado, omitido
  mergeAndShowData();
  document.getElementById('step2').className = 'step done';
  showSideStatus('reverso', 'Reverso omitido. El folio quedará vacío.', 'warn');
}

// ══════════════════════════════════════════
//  COMBINAR DATOS FRENTE + REVERSO
// ══════════════════════════════════════════
function mergeAndShowData() {
  const f = state.frente.data || {};
  const r = state.reverso.data || {};

  // Combinar: reverso aporta folio, codigoBarras, emision
  const combined = {
    nombre:          f.nombre          || '',
    apellidoPaterno: f.apellidoPaterno  || '',
    apellidoMaterno: f.apellidoMaterno  || '',
    curp:            f.curp             || '',
    claveElector:    f.clave_Elector    || f.claveElector || '',
    fechaNacimiento: f.fecha_Nacimiento || f.fechaNacimiento || '',
    sexo:            f.sexo             || '',
    estado:          f.estado           || '',
    municipio:       f.municipio        || '',
    seccion:         f.seccion          || '',
    folio:           r.folio            || f.folio || '', // Reverso tiene prioridad
    codigoBarras:    r.codigoBarras     || '',
    vigencia:        f.vigencia         || '',
    domicilio:       f.domicilio        || '',
    anioRegistro:    f.anioRegistro     || r.emision || '',
    confianzaOCR:    f.confianzaOCR     || 0,
    requiereRevision: f.requiereRevision || false,
  };

  currentData = combined;
  showExtracted(combined);

  // Mostrar banner de combinación solo si ambas caras escaneadas
  const banner = document.getElementById('combinedBanner');
  if (state.frente.scanned && (state.reverso.scanned || state.reverso.data)) {
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

// ══════════════════════════════════════════
//  MOSTRAR DATOS EXTRAÍDOS
// ══════════════════════════════════════════
const FIELD_LABELS = {
  nombre:          'Nombre(s)',
  apellidoPaterno: 'Apellido paterno',
  apellidoMaterno: 'Apellido materno',
  curp:            'CURP',
  claveElector:    'Clave de elector',
  fechaNacimiento: 'Fecha de nacimiento',
  sexo:            'Sexo',
  estado:          'Estado',
  municipio:       'Municipio',
  seccion:         'Sección',
  folio:           'Folio',           // ← del reverso
  codigoBarras:    'Código de barras', // ← del reverso
  vigencia:        'Vigencia',
  domicilio:       'Domicilio',
  anioRegistro:    'Año registro'
};

function showExtracted(data) {
  const grid  = document.getElementById('dataGrid');
  const conf  = data.confianzaOCR || 0;
  const rev   = data.requiereRevision;
  const color = conf >= 85 ? '#6ee7b7' : conf >= 60 ? '#fbbf24' : '#fca5a5';

  grid.innerHTML = `
    <div class="data-item confidence-card"
      style="grid-column:1/-1;border-color:${color}33;background:${color}0d;">
      <div class="data-label">Índice de confianza OCR · RF-04</div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:6px;">
        <div class="confidence-bar-bg">
          <div class="confidence-bar-fill" style="width:${conf}%;background:${color};"></div>
        </div>
        <span style="font-size:1rem;font-weight:700;color:${color};min-width:42px;">${conf}%</span>
        ${rev
          ? '<span class="revision-badge">⚠ REVISIÓN MANUAL</span>'
          : '<span class="ok-badge">✓ Confianza aceptable</span>'}
      </div>
    </div>`;

  Object.entries(FIELD_LABELS).forEach(([key, label]) => {
    const val  = data[key] || '';
    // Destacar visualmente el folio (viene del reverso)
    const extra = (key === 'folio' || key === 'codigoBarras') ? ' folio-highlight' : '';
    grid.innerHTML += `
      <div class="data-item${extra}">
        <div class="data-label">${label}${key === 'folio' ? ' 🔁' : ''}</div>
        <input class="data-value editable" data-key="${key}"
          value="${escapeHtml(val)}" placeholder="—">
      </div>`;
  });

  document.getElementById('extractedData').style.display = 'block';
  document.getElementById('emptyExtracted').style.display = 'none';
}

function getEditedData() {
  const data = {};
  document.querySelectorAll('.data-value.editable').forEach(inp => {
    data[inp.dataset.key] = inp.value;
  });
  return data;
}

// Reset completo
function resetAll() {
  clearSide('frente'); // clearSide('frente') ya limpia reverso en cadena
  currentData = null;
  goToStep(1);
  document.getElementById('combinedBanner').style.display = 'none';
}

// ══════════════════════════════════════════
//  GUARDAR EN SUPABASE (RF-05)
// ══════════════════════════════════════════
async function saveRecord() {
  if (!currentData) return;
  if (!state.frente.scanned) {
    alert('Debes escanear al menos el frente de la INE.');
    return;
  }

  showSideStatus('frente', 'Guardando en la base de datos...', 'loading');

  const edited     = getEditedData();
  const normalized = normalizeRecord(edited);

  try {
    // ── Valores seguros para campos NOT NULL ──────────────────────────────
    const curpVal     = normalized.curp      || 'SIN-CURP';
    const nombreVal   = normalized.nombre    || 'SIN-NOMBRE';
    const claveVal    = (normalized.claveElector || normalized.clave_Elector || 'SIN-CLAVE').slice(0,18);
    const seccionVal  = parseInt(normalized.seccion) || 0;
    // imagen_url NOT NULL: usamos frente; si no hay, placeholder vacío
    const imagenVal   = state.frente.dataURL || '';

    // ── Mapeo exacto contra esquema de Supabase ───────────────────────────
    // Columnas con comillas en Postgres: apellidoPaterno, apellidoMaterno,
    // fechaNacimiento, anioRegistro  →  el cliente JS de Supabase las acepta
    // con el nombre exacto (case-sensitive) sin comillas adicionales.
    const recordToSave = {
      // NOT NULL
      curp:              curpVal,
      nombre:            nombreVal,
      clave_elector:     claveVal,
      seccion:           seccionVal,
      imagen_url:        imagenVal,
      // Nullable — nombres exactos del schema (case-sensitive)
      apellidoPaterno:   normalized.apellidoPaterno   || null,
      apellidoMaterno:   normalized.apellidoMaterno   || null,
      fechaNacimiento:   normalized.fechaNacimiento   || null,
      sexo:              normalized.sexo              || null,
      estado:            normalized.estado            || null,
      municipio:         normalized.municipio         || null,
      folio:             normalized.folio             || null,
      vigencia:          normalized.vigencia          || null,
      direccion:         normalized.domicilio         || null,
      anioRegistro:      normalized.anioRegistro      || null,
      confianza_ocr:     currentData.confianzaOCR     || 0,
      requiere_revision: currentData.requiereRevision || false,
      // imagen_url ya asignado arriba (NOT NULL)
      // ⚠ imagen_reverso_url y codigo_barras NO existen en la tabla actual
      //   → se omiten para evitar el error 400
    };

    const { error } = await clienteSupabase
      .from('registros_ine')
      .insert([recordToSave]);

    if (error) throw error;

    showSideStatus('frente', '✓ Registro guardado en la nube con folio incluido', 'success');
    setTimeout(() => { resetAll(); hideSideStatus('frente'); }, 2500);

  } catch(err) {
    console.error('Error Supabase:', err);
    showSideStatus('frente', 'Error al guardar: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════
//  STATUS BARS (una por lado)
// ══════════════════════════════════════════
function showSideStatus(side, msg, type) {
  const prefix = side.charAt(0).toUpperCase() + side.slice(1);
  const bar    = document.getElementById(`statusBar${prefix}`);
  if (!bar) return;
  bar.style.display = 'flex';
  const map = { loading:'status-loading', success:'status-success', error:'status-error', warn:'status-warn' };
  bar.className = 'status-bar ' + (map[type] || 'status-loading');
  bar.innerHTML = type === 'loading'
    ? `<div class="spinner"></div><span>${msg}</span>`
    : `<span>${msg}</span>`;
}
function hideSideStatus(side) {
  const prefix = side.charAt(0).toUpperCase() + side.slice(1);
  const bar    = document.getElementById(`statusBar${prefix}`);
  if (bar) bar.style.display = 'none';
}
// Compatibilidad con llamadas antiguas (login)
function showStatus(msg, type) { showSideStatus('frente', msg, type); }
function hideStatus()          { hideSideStatus('frente'); }

// ── CONFIG ───────────────────────────────
function openConfig() {
  document.getElementById('newAdminPass').value = '';
  openModal('configModal');
}
function saveConfig() {
  const cfg     = getCfg();
  const newPass = document.getElementById('newAdminPass').value;
  if (newPass) cfg.adminHash = CryptoJS.SHA256('admin:' + newPass).toString();
  saveCfg(cfg);
  closeModal('configModal');
}

// ══════════════════════════════════════════
//  ADMIN — CARGAR DE SUPABASE
// ══════════════════════════════════════════
async function loadAdminView() {
  document.getElementById('tableBody').innerHTML =
    '<tr><td colspan="11" style="text-align:center;">Cargando registros desde la nube... ☁️</td></tr>';

  try {
    const { data, error } = await clienteSupabase
      .from('registros_ine')
      .select('*')
      .order('fecha_registro', { ascending: false });

    if (error) throw error;

    allRecords = (data || []).map(row => ({
      ...row,
      claveElector:       row.clave_elector      || "",
      confianzaOCR:       Number(row.confianza_ocr) || 0,
      requiereRevision:   row.requiere_revision  || false,
      savedAt:            row.fecha_registro     || "",
      domicilio:          row.direccion          || "",
      apellidoPaterno:    row.apellidoPaterno     || "",
      apellidoMaterno:    row.apellidoMaterno     || "",
      fechaNacimiento:    row.fechaNacimiento     || "",
      anioRegistro:       row.anioRegistro        || "",
      codigoBarras:       "",
      // imagen_reverso_url: no existe en DB — se resuelve en viewRecord con || null
    }));
    renderStats();
    renderTable();
  } catch(err) {
    console.error('Error al cargar registros:', err);
    document.getElementById('tableBody').innerHTML =
      `<tr><td colspan="11" style="color:red;">Error de carga: ${err.message}</td></tr>`;
  }
}


function renderStats() {
  const total   = allRecords.length;
  const rev     = allRecords.filter(r => r.requiereRevision).length;
  const today   = new Date().toDateString();
  const hoy     = allRecords.filter(r => new Date(r.savedAt).toDateString() === today).length;
  const avgConf = total
    ? Math.round(allRecords.reduce((s, r) => s + (r.confianzaOCR || 0), 0) / total)
    : 0;

  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-num stat-accent">${total}</div><div class="stat-label">Total registros</div></div>
    <div class="stat-card"><div class="stat-num stat-gold">${hoy}</div><div class="stat-label">Hoy</div></div>
    <div class="stat-card"><div class="stat-num ${rev > 0 ? 'stat-red' : 'stat-green'}">${rev}</div><div class="stat-label">En revisión manual</div></div>
    <div class="stat-card"><div class="stat-num stat-green">${avgConf}%</div><div class="stat-label">Confianza promedio</div></div>`;
}

// ── RF-06/07: FILTROS MULTICRITERIO + LIKE ─
function getFilteredRecords() {
  const q      = (document.getElementById('searchInput')?.value  || '').trim().toLowerCase();
  const sex    =  document.getElementById('filterSexo')?.value   || '';
  const estado = (document.getElementById('filterEstado')?.value || '').trim().toLowerCase();
  const sec    = (document.getElementById('filterSeccion')?.value|| '').trim();
  const rev    =  document.getElementById('filterRevision')?.value|| '';

  return allRecords.filter(r => {
    if (q) {
      const hay = [
        r.nombre, r.apellidoPaterno, r.apellidoMaterno,
        r.curp, r.claveElector, r.folio, r.municipio, r.domicilio, r.vigencia, r.codigoBarras
      ].map(v => (v || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    if (sex    && !(r.sexo   || '').toUpperCase().startsWith(sex))           return false;
    if (estado && !(r.estado || '').toLowerCase().includes(estado))          return false;
    if (sec    && !String(r.seccion || '').includes(sec))                    return false;
    if (rev === '1' && !r.requiereRevision)                                  return false;
    if (rev === '0' &&  r.requiereRevision)                                  return false;
    return true;
  });
}

function renderTable() {
  const filtered = getFilteredRecords();
  const total    = filtered.length;
  const pages    = Math.ceil(total / PAGE_SIZE) || 1;
  page = Math.min(page, pages);
  const slice    = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const tbody = document.getElementById('tableBody');
  const empty = document.getElementById('tableEmpty');

  if (!slice.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    tbody.innerHTML = slice.map((r, i) => {
      const conf  = r.confianzaOCR || 0;
      const color = conf >= 85 ? '#6ee7b7' : conf >= 60 ? '#fbbf24' : '#fca5a5';
      const badge = r.requiereRevision
        ? `<span style="font-size:.68rem;background:rgba(239,68,68,.15);color:#fca5a5;border:1px solid rgba(239,68,68,.3);padding:1px 5px;border-radius:4px;white-space:nowrap;">⚠ Revisión</span>`
        : '';
      return `
      <tr>
        <td>${(page - 1) * PAGE_SIZE + i + 1}</td>
        <td>
          ${escapeHtml([r.nombre, r.apellidoPaterno, r.apellidoMaterno].filter(Boolean).join(' ') || '—')}
          ${badge}
        </td>
        <td><code style="font-size:.75rem;color:var(--accent3)">${escapeHtml(r.curp || '—')}</code></td>
        <td style="font-size:.75rem">${escapeHtml(r.claveElector || '—')}</td>
        <td style="font-size:.75rem;color:var(--gold2);font-weight:600;">${escapeHtml(r.folio || '—')}</td>
        <td style="font-size:.78rem">${escapeHtml(String(r.seccion || '—'))}</td>
        <td>${escapeHtml(r.estado || '—')}</td>
        <td>${escapeHtml(r.sexo || '—')}</td>
        <td style="font-size:.75rem;color:var(--text3)">${formatDate(r.savedAt)}</td>
        <td><span style="font-size:.78rem;font-weight:700;color:${color};">${conf}%</span></td>
        <td>
          <div class="btn-group">
            <button class="btn btn-secondary btn-sm" onclick="viewRecord('${r.id}')">Ver</button>
            <button class="btn btn-danger btn-sm"    onclick="deleteRecord('${r.id}')">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  document.getElementById('pager').innerHTML = `
    <button onclick="page=Math.max(1,page-1);renderTable()" ${page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <span>Página ${page} de ${pages} · ${total} registros</span>
    <button onclick="page=Math.min(${pages},page+1);renderTable()" ${page >= pages ? 'disabled' : ''}>Siguiente ›</button>`;
}

// ── RF-08: VER REGISTRO CON AMBAS IMÁGENES ─
function viewRecord(id) {
  const r = allRecords.find(x => x.id === id);
  if (!r) return;

  const conf  = r.confianzaOCR || 0;
  const color = conf >= 85 ? '#6ee7b7' : conf >= 60 ? '#fbbf24' : '#fca5a5';

  // Imágenes: frente y reverso
  const makeImg = (src, label) => src
    ? `<div>
        <div class="data-label" style="margin-bottom:.4rem;">${label}</div>
        <img src="${src}" alt="${label}"
          style="width:100%;border-radius:8px;border:1px solid var(--border);
                 object-fit:contain;max-height:180px;background:#000;">
       </div>`
    : `<div style="color:var(--text3);font-size:.8rem;padding:1rem;
                   background:var(--bg2);border-radius:8px;">Sin imagen (${label.toLowerCase()})</div>`;

  // imagen_url = frente (existe en DB)
  // imagen_reverso_url no existe en la tabla actual → se omite si es null
  const hasReverso = r.imagen_reverso_url && r.imagen_reverso_url.length > 10;
  const imgRow = hasReverso
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem;">
        ${makeImg(r.imagen_url,         'Frente de la INE')}
        ${makeImg(r.imagen_reverso_url, 'Reverso de la INE')}
       </div>`
    : `<div style="margin-bottom:1rem;">${makeImg(r.imagen_url, 'Imagen de la INE')}</div>`;

  const confSection = `
    <div class="data-item" style="margin-bottom:.75rem;border-color:${color}33;background:${color}0d;grid-column:1/-1;">
      <div class="data-label">Confianza OCR</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:4px;">
        <div class="confidence-bar-bg" style="flex:1;">
          <div class="confidence-bar-fill" style="width:${conf}%;background:${color};"></div>
        </div>
        <span style="color:${color};font-weight:700;">${conf}%</span>
        ${r.requiereRevision
          ? '<span class="revision-badge">⚠ REVISIÓN MANUAL</span>'
          : '<span class="ok-badge">✓ OK</span>'}
      </div>
    </div>`;

  const fields = Object.entries(FIELD_LABELS).map(([k, label]) => {
    const val   = r[k] || r[k === 'claveElector' ? 'clave_elector' : k] || '';
    const extra = (k === 'folio' || k === 'codigoBarras') ? ' folio-highlight' : '';
    return `
      <div class="data-item${extra}" style="margin-bottom:.4rem;">
        <div class="data-label">${label}${k === 'folio' ? ' 🔁' : ''}</div>
        <div class="data-value">${escapeHtml(String(val || '—'))}</div>
      </div>`;
  }).join('');

  const meta = `
    <div class="data-item" style="margin-bottom:.4rem;">
      <div class="data-label">Fecha de registro</div>
      <div class="data-value">${formatDate(r.savedAt)}</div>
    </div>`;

  document.getElementById('modalContent').innerHTML =
    imgRow +
    `<div class="data-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.6rem;">
      ${confSection}${fields}${meta}
     </div>`;

  document.getElementById('modalDeleteBtn').onclick = () => {
    deleteRecord(id);
    closeModal('detailModal');
  };
  openModal('detailModal');
}

// ── ELIMINAR ─────────────────────────────
async function deleteRecord(id) {
  if (!confirm('¿Eliminar este registro permanentemente de la base de datos?')) return;
  try {
    const { error } = await clienteSupabase.from('registros_ine').delete().eq('id', id);
    if (error) throw error;
    allRecords = allRecords.filter(r => r.id !== id);
    renderStats();
    renderTable();
  } catch(err) {
    console.error(err);
    alert('Error al eliminar el registro.');
  }
}

async function confirmClear() {
  if (!confirm('¿Eliminar TODOS los registros de la nube? Esta acción es irreversible.')) return;
  try {
    const { error } = await clienteSupabase
      .from('registros_ine')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
    allRecords = [];
    renderStats();
    renderTable();
  } catch(err) {
    console.error(err);
    alert('Error al vaciar la base de datos.');
  }
}

// ── EXPORTACIÓN RF-09 ────────────────────
function exportCSV() {
  const filtered = getFilteredRecords();
  if (!filtered.length) { alert('No hay registros para exportar.'); return; }

  const cols = ['id', ...Object.keys(FIELD_LABELS), 'confianzaOCR', 'requiereRevision', 'savedAt'];
  const uniq = [...new Set(cols)];
  const csv  = [uniq.join(','),
    ...filtered.map(r => uniq.map(c => {
      const v = c === 'requiereRevision' ? (r[c] ? 'SÍ' : 'NO') : (r[c] || '');
      return `"${String(v).replace(/"/g,'""')}"`;
    }).join(','))
  ].join('\n');
  downloadBlob('\ufeff' + csv, 'text/csv;charset=utf-8;',
    'registros_ine_' + new Date().toISOString().slice(0, 10) + '.csv');
}

function exportExcel() {
  const filtered = getFilteredRecords();
  if (!filtered.length) { alert('No hay registros para exportar.'); return; }

  const cols = ['id', ...Object.keys(FIELD_LABELS), 'confianzaOCR', 'requiereRevision', 'savedAt'];
  const uniq = [...new Set(cols)];
  const hdrs = {
    id:'ID', nombre:'Nombre(s)', apellidoPaterno:'Apellido Paterno',
    apellidoMaterno:'Apellido Materno', curp:'CURP', claveElector:'Clave Elector',
    fechaNacimiento:'Fecha Nacimiento', sexo:'Sexo', estado:'Estado',
    municipio:'Municipio', seccion:'Sección', folio:'Folio',
    vigencia:'Vigencia', domicilio:'Domicilio',
    anioRegistro:'Año Registro', confianzaOCR:'Confianza OCR %',
    requiereRevision:'Requiere Revisión', savedAt:'Fecha Registro'
  };

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="h"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2563EB" ss:Pattern="Solid"/></Style>
  <Style ss:ID="f"><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/></Style>
  <Style ss:ID="w"><Interior ss:Color="#FFFF00" ss:Pattern="Solid"/></Style>
</Styles>
<Worksheet ss:Name="Registros INE"><Table>\n<Row>`;

  uniq.forEach(c => {
    xml += `<Cell ss:StyleID="h"><Data ss:Type="String">${escapeXml(hdrs[c] || c)}</Data></Cell>`;
  });
  xml += '</Row>\n';

  filtered.forEach(r => {
    xml += '<Row>';
    uniq.forEach(c => {
      let val  = r[c];
      if (c === 'requiereRevision') val = val ? 'SÍ' : 'NO';
      const st = c === 'folio' ? ' ss:StyleID="f"'
               : (c === 'requiereRevision' && r[c]) ? ' ss:StyleID="w"' : '';
      xml += `<Cell${st}><Data ss:Type="String">${escapeXml(String(val || ''))}</Data></Cell>`;
    });
    xml += '</Row>\n';
  });

  xml += '</Table></Worksheet></Workbook>';
  downloadBlob(xml, 'application/vnd.ms-excel',
    'registros_ine_' + new Date().toISOString().slice(0, 10) + '.xls');
}

// ── HELPERS ──────────────────────────────
function escapeXml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;');
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX',
    { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function downloadBlob(content, mime, filename) {
  const a  = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(new Blob([content], { type: mime })),
    download: filename
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

// ── MODAL ────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
window.addEventListener('click', e => {
  ['detailModal','configModal'].forEach(id => {
    if (e.target === document.getElementById(id)) closeModal(id);
  });
});

// ── INIT ─────────────────────────────────
(function init() {
  document.querySelectorAll('#viewScanner .nav-btn')[0]?.classList.add('active');
})();
// ══════════════════════════════════════════
//  CONSTANTS & STATE
// ══════════════════════════════════════════
const CFG_KEY      = 'ine_cfg_v1';
const SESSION_KEY  = 'ine_session';
const ENCRYPT_PASS = 'INE_SCANNER_AES_SECRET_2024';
const OCR_TIMEOUT_MS = 15000;
const CONFIDENCE_THRESHOLD = 85;

// ── SUPABASE SETUP ──────
// ── SUPABASE SETUP ──────
const supabaseUrl = 'https://irshnqkotnquwawlohlj.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlyc2hucWtvdG5xdXdhd2xvaGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMDY0ODQsImV4cCI6MjA5Mzc4MjQ4NH0.KbJI-gfQYYwN6Sansc_pGiE4WRVDElCPkjh7aX0kxVs'; // (Tu llave larga)

// 1. Creamos la conexión con un nombre distinto para que no choque
const clienteSupabase = window.supabase.createClient(supabaseUrl, supabaseKey);

window.supabase = clienteSupabase;

const DEFAULT_ADMIN_HASH = CryptoJS.SHA256('admin:admin123').toString();

let currentImage   = null;
let currentData    = null;
let allRecords     = [];
let page           = 1;
const PAGE_SIZE    = 10;
let mediaStream    = null;
let currentImageDataURL = null;

// ── CONFIG (Solo para contraseña de Admin) ──
function getCfg() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return {};
    return JSON.parse(CryptoJS.AES.decrypt(raw, ENCRYPT_PASS).toString(CryptoJS.enc.Utf8));
  } catch { return {}; }
}
function saveCfg(cfg) {
  const enc = CryptoJS.AES.encrypt(JSON.stringify(cfg), ENCRYPT_PASS).toString();
  localStorage.setItem(CFG_KEY, enc);
}

// ── AUTH ─────────────────────────────────
function getAdminHash() { return getCfg().adminHash || DEFAULT_ADMIN_HASH; }

async function doLogin() {
  const email = document.getElementById('loginUser').value.trim(); // Ahora pedimos email
  const pass = document.getElementById('loginPass').value;
  
  showStatus('Verificando credenciales...', 'loading');

  const { data, error } = await clienteSupabase.auth.signInWithPassword({
    email: email,
    password: pass,
  });

  if (error) {
    document.getElementById('loginErr').textContent = "Error: " + error.message;
    document.getElementById('loginErr').style.display = 'block';
    hideStatus();
  } else {
    document.getElementById('loginErr').style.display = 'none';
    setTab('admin');
  }
}

async function isLoggedIn() {
  const { data } = await clienteSupabase.auth.getSession();
  return data.session !== null;
}

async function logout() {
  await clienteSupabase.auth.signOut();
  setTab('scanner');
}



// ── NAVIGATION ACTUALIZADA ───────────────────────────
async function setTab(tab) {
  ['viewScanner','viewLogin','viewAdmin'].forEach(id => {
    document.getElementById(id).classList.remove('active');
  });
  
  if (tab === 'scanner') {
    document.getElementById('viewScanner').classList.add('active');
  } else if (tab === 'admin') {
    // 💡 AHORA SÍ ESPERA LA CONFIRMACIÓN REAL DE SUPABASE
    const tieneSesion = await isLoggedIn(); 
    
    if (!tieneSesion) {
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
// ── IMAGE INPUT ──────────────────────────
function switchInputTab(which, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('uploadSection').style.display = which === 'upload' ? 'block' : 'none';
  document.getElementById('cameraSection').style.display = which === 'camera' ? 'block' : 'none';
  if (which === 'camera') startCamera();
  else stopCamera();
}

function onFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!['image/jpeg','image/png','image/heic','image/heif'].includes(file.type)) {
    showStatus('Solo se permiten archivos JPG o PNG.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    currentImage = ev.target.result.split(',')[1];
    currentImageDataURL = ev.target.result;
    showPreview(ev.target.result);
  };
  reader.readAsDataURL(file);
}

function showPreview(src) {
  const img = document.getElementById('previewImg');
  img.src = src; img.style.display = 'block';
  document.getElementById('btnScan').disabled = false;
  document.getElementById('btnClear').style.display = 'inline-flex';
}

function clearImage() {
  currentImage = null; currentData = null; currentImageDataURL = null;
  document.getElementById('previewImg').style.display = 'none';
  document.getElementById('btnScan').disabled = true;
  document.getElementById('btnClear').style.display = 'none';
  document.getElementById('fileInput').value = '';
  hideStatus();
  document.getElementById('extractedData').style.display = 'none';
  document.getElementById('emptyExtracted').style.display = 'block';
}

// ── DRAG & DROP ──────────────────────────
const dz = document.getElementById('dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) {
    const r = new FileReader();
    r.onload = ev => {
      currentImage = ev.target.result.split(',')[1];
      currentImageDataURL = ev.target.result;
      showPreview(ev.target.result);
    };
    r.readAsDataURL(f);
  }
});

// ── CAMERA ───────────────────────────────
async function startCamera() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    document.getElementById('video').srcObject = mediaStream;
  } catch(err) {
    showStatus('No se pudo acceder a la cámara: ' + err.message, 'error');
  }
}
function stopCamera() {
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
}
function capturePhoto() {
  const video = document.getElementById('video');
  const canvas = document.getElementById('captureCanvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataURL = canvas.toDataURL('image/jpeg', 0.9);
  currentImage = dataURL.split(',')[1];
  currentImageDataURL = dataURL;
  showPreview(dataURL);
  stopCamera();
  document.getElementById('cameraSection').style.display = 'none';
  document.getElementById('uploadSection').style.display = 'block';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab')[0].classList.add('active');
}

// ── NORMALIZACIÓN DE DATOS ────────
function normalizeText(str) {
  if (!str) return '';
  return str.toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÜÑ0-9\s\-.,/#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRecord(data) {
  const normalized = {};
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (key === 'seccion') {
      normalized[key] = String(val || '').replace(/\D/g, '').slice(0, 4);
    } else if (key === 'curp' || key === 'claveElector') {
      normalized[key] = String(val || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
    } else {
      normalized[key] = normalizeText(String(val || ''));
    }
  }
  return normalized;
}

function calcConfidence(data) {
  const criticalFields = ['nombre','apellidoPaterno','curp','claveElector','seccion','estado','domicilio'];
  const filledCritical = criticalFields.filter(f => data[f] && data[f].trim().length > 0).length;

  let formatScore = 100;
  const curp = data.curp || '';
  const clave = data.claveElector || '';
  const seccion = data.seccion || '';

  if (curp.length > 0 && !/^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9]{2}$/.test(curp)) formatScore -= 20;
  if (clave.length > 0 && clave.length !== 18) formatScore -= 15;
  if (seccion.length > 0 && !/^\d{4}$/.test(seccion)) formatScore -= 10;

  const fieldScore = (filledCritical / criticalFields.length) * 100;
  const confidence = Math.round((fieldScore * 0.6) + (formatScore * 0.4));
  return Math.min(100, Math.max(0, confidence));
}

function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ── RF-02: PROCESAMIENTO OCR (GROK VIA VERCEL) ─────────────
async function scanINE() {
  if (!currentImage) return;

  document.getElementById('btnScan').disabled = true;
  showStatus('Analizando credencial con Grok (IA)…', 'loading');

  const prompt = `Eres un sistema OCR especializado en credenciales INE/IFE de México.
Analiza la imagen con máxima precisión y extrae TODOS los datos visibles.
Responde ÚNICAMENTE con un objeto JSON válido, sin markdown, sin texto adicional.

Formato exacto requerido:
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
  "folio": "",
  "vigencia": "",
  "domicilio": "",
  "anioRegistro": "",
  "confianzaOCR": 0
}

Reglas:
- "confianzaOCR": número del 0 al 100 indicando qué tan claramente pudiste leer los datos.
- "curp" y "claveElector": exactamente 18 caracteres alfanuméricos.
- "seccion": solo dígitos numéricos.
- "sexo": "H" para hombre, "M" para mujer.
- Si un campo no es visible, deja la cadena vacía "".
- Responde ÚNICAMENTE con el objeto JSON, sin bloque de código (\`\`\`).`;

  try {
    const res = await fetchWithTimeout(
      '/api/grok',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: currentImage, prompt: prompt })
      },
      OCR_TIMEOUT_MS
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || err.error || 'Error en el servidor (' + res.status + ')');
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const rawData = JSON.parse(clean);

    const normalizedData = normalizeRecord(rawData);
    const apiConfidence = parseInt(rawData.confianzaOCR) || 0;
    const calcConfidenceScore = calcConfidence(normalizedData);
    
    const finalConfidence = Math.min(apiConfidence || calcConfidenceScore, calcConfidenceScore);
    normalizedData.confianzaOCR = finalConfidence;
    normalizedData.requiereRevision = finalConfidence < CONFIDENCE_THRESHOLD;

    currentData = normalizedData;
    showExtracted(currentData);

    if (normalizedData.requiereRevision) {
      showStatus(`⚠️ Confianza OCR: ${finalConfidence}% — Registro marcado para REVISIÓN MANUAL`, 'warn');
    } else {
      showStatus(`✓ Datos extraídos correctamente · Confianza: ${finalConfidence}%`, 'success');
    }

  } catch(err) {
    if (err.name === 'AbortError') {
      showStatus('⏱ Tiempo de espera agotado. Intenta con una imagen de menor peso.', 'error');
    } else {
      showStatus('Error: ' + err.message, 'error');
    }
  } finally {
    document.getElementById('btnScan').disabled = false;
  }
}

const FIELD_LABELS = {
  nombre: 'Nombre(s)', apellidoPaterno: 'Apellido paterno', apellidoMaterno: 'Apellido materno',
  curp: 'CURP', claveElector: 'Clave de elector', fechaNacimiento: 'Fecha de nacimiento',
  sexo: 'Sexo', estado: 'Estado', municipio: 'Municipio', seccion: 'Sección',
  folio: 'Folio', vigencia: 'Vigencia', domicilio: 'Domicilio', anioRegistro: 'Año registro'
};

function showExtracted(data) {
  const grid = document.getElementById('dataGrid');
  grid.innerHTML = '';

  const conf = data.confianzaOCR || 0;
  const revFlag = data.requiereRevision;
  const confColor = conf >= 85 ? '#6ee7b7' : conf >= 60 ? '#fbbf24' : '#fca5a5';
  grid.innerHTML += `
    <div class="data-item confidence-card" style="grid-column:1/-1; border-color:${confColor}33; background:${confColor}0d;">
      <div class="data-label">Índice de confianza OCR · RF-04</div>
      <div style="display:flex; align-items:center; gap:12px; margin-top:6px;">
        <div class="confidence-bar-bg">
          <div class="confidence-bar-fill" style="width:${conf}%; background:${confColor};"></div>
        </div>
        <span style="font-size:1rem; font-weight:700; color:${confColor}; min-width:42px;">${conf}%</span>
        ${revFlag ? `<span class="revision-badge">⚠ REVISIÓN MANUAL</span>` : `<span class="ok-badge">✓ Confianza aceptable</span>`}
      </div>
    </div>`;

  Object.entries(FIELD_LABELS).forEach(([key, label]) => {
    const val = data[key] || '';
    grid.innerHTML += `
      <div class="data-item">
        <div class="data-label">${label}</div>
        <input class="data-value editable" data-key="${key}" value="${escapeHtml(val)}" placeholder="—">
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

function resetExtracted() { clearImage(); }


// ── GUARDAR EN SUPABASE ──────
// ── GUARDAR EN SUPABASE ───────────
async function saveRecord() {
  if (!currentData) return;
  
  showStatus('Guardando en la base de datos...', 'loading');
  const edited = getEditedData();
  const normalized = normalizeRecord(edited);

  try {
    // Aquí hacemos el "mapeo" exacto para tu base de datos
    const recordToSave = {
      nombre: normalized.nombre,
      apellidoPaterno: normalized.apellidoPaterno, 
      apellidoMaterno: normalized.apellidoMaterno, 
      curp: normalized.curp,
      clave_elector: normalized.claveElector,      // DB usa guion bajo
      fechaNacimiento: normalized.fechaNacimiento, 
      sexo: normalized.sexo,
      estado: normalized.estado,
      municipio: normalized.municipio,
      seccion: parseInt(normalized.seccion) || null, // DB espera un número (int4)
      folio: normalized.folio,
      vigencia: normalized.vigencia,
      direccion: normalized.domicilio,             // DB le llama 'direccion'
      anioRegistro: normalized.anioRegistro,
      confianza_ocr: currentData.confianzaOCR || 0, // DB usa guion bajo
      requiere_revision: currentData.requiereRevision || false, // DB usa guion bajo
      imagen_url: currentImageDataURL ? currentImageDataURL : null
    };

    // Usamos clienteSupabase, que es como lo definiste arriba en tu script
    const { data, error } = await clienteSupabase
      .from('registros_ine')
      .insert([recordToSave])
      .select();

    if (error) throw error;

    showStatus('✓ Registro guardado en la nube exitosamente', 'success');
    setTimeout(() => { clearImage(); hideStatus(); }, 2500);

  } catch (err) {
    console.error("Error Supabase:", err);
    showStatus('Error al guardar en base de datos: ' + err.message, 'error');
  }
}
// ── STATUS BAR ────────────────────────────
function showStatus(msg, type) {
  const bar = document.getElementById('statusBar');
  bar.style.display = 'flex';
  const types = { loading:'status-loading', success:'status-success', error:'status-error', warn:'status-warn' };
  bar.className = 'status-bar ' + (types[type] || 'status-loading');
  bar.innerHTML = type === 'loading'
    ? `<div class="spinner"></div><span>${msg}</span>`
    : `<span>${msg}</span>`;
}
function hideStatus() { document.getElementById('statusBar').style.display = 'none'; }

// ── CONFIG ADMIN ───────────────────────────────
function openConfig() {
  document.getElementById('newAdminPass').value = '';
  openModal('configModal');
}
function saveConfig() {
  const cfg = getCfg();
  const newPass = document.getElementById('newAdminPass').value;
  if (newPass) cfg.adminHash = CryptoJS.SHA256('admin:' + newPass).toString();
  saveCfg(cfg);
  closeModal('configModal');
}

// ── ADMIN VIEW (CARGAR DE SUPABASE) ─
async function loadAdminView() {
  document.getElementById('tableBody').innerHTML = '<tr><td colspan="9" style="text-align:center;">Cargando registros desde la nube... ☁️</td></tr>';
  
  try {
    const { data, error } = await clienteSupabase
      .from('registros_ine')
      .select('*')
      .order('fecha_registro', { ascending: false });

    if (error) throw error;
    
    // Si data llega pero está vacío, Supabase nos bloqueó
    if (!data || data.length === 0) {
        console.warn("Supabase devolvió 0 registros. Revisa el RLS.");
    }
    
    // Mapeo (traducir de base de datos a HTML)
    allRecords = (data || []).map(row => ({
      ...row,
      claveElector: row.clave_elector,
      confianzaOCR: row.confianza_ocr,
      requiereRevision: row.requiere_revision,
      savedAt: row.fecha_registro
    }));

    renderStats();
    renderTable();
  } catch (err) {
    console.error("Error al cargar registros:", err);
    document.getElementById('tableBody').innerHTML = `<tr><td colspan="9" style="color:red;">Error de carga: ${err.message}</td></tr>`;
  }
}


function renderStats() {
  const total = allRecords.length;
  const revision = allRecords.filter(r => r.requiereRevision).length;
  const today = new Date().toDateString();
  const hoy = allRecords.filter(r => new Date(r.savedAt).toDateString() === today).length;
  const avgConf = total ? Math.round(allRecords.reduce((s,r) => s+(r.confianzaOCR||0), 0) / total) : 0;

  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-num stat-accent">${total}</div><div class="stat-label">Total registros</div></div>
    <div class="stat-card"><div class="stat-num stat-gold">${hoy}</div><div class="stat-label">Hoy</div></div>
    <div class="stat-card"><div class="stat-num ${revision > 0 ? 'stat-red' : 'stat-green'}">${revision}</div><div class="stat-label">En revisión manual</div></div>
    <div class="stat-card"><div class="stat-num stat-green">${avgConf}%</div><div class="stat-label">Confianza promedio</div></div>
  `;
}

function getFilteredRecords() {
  const q       = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const sex     = document.getElementById('filterSexo')?.value || '';
  const estado  = (document.getElementById('filterEstado')?.value || '').trim().toLowerCase();
  const seccion = (document.getElementById('filterSeccion')?.value || '').trim();
  const rev     = document.getElementById('filterRevision')?.value || '';

  return allRecords.filter(r => {
    if (q) {
      const haystack = [
        r.nombre, r.apellidoPaterno, r.apellidoMaterno,
        r.curp, r.claveElector, r.folio, r.municipio, r.domicilio, r.vigencia
      ].map(v => (v||'').toLowerCase()).join(' ');
      if (!haystack.includes(q)) return false;
    }
    if (sex && !(r.sexo||'').toUpperCase().startsWith(sex)) return false;
    if (estado && !(r.estado||'').toLowerCase().includes(estado)) return false;      
    if (seccion && !(r.seccion||'').includes(seccion)) return false;                 
    if (rev === '1' && !r.requiereRevision) return false;                            
    if (rev === '0' && r.requiereRevision) return false;
    return true;
  });
}

function renderTable() {
  const filtered = getFilteredRecords();
  const total  = filtered.length;
  const pages  = Math.ceil(total / PAGE_SIZE) || 1;
  page = Math.min(page, pages);
  const slice  = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);

  const tbody = document.getElementById('tableBody');
  const empty = document.getElementById('tableEmpty');

  if (!slice.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    tbody.innerHTML = slice.map((r, i) => {
      const conf = r.confianzaOCR || 0;
      const confColor = conf >= 85 ? '#6ee7b7' : conf >= 60 ? '#fbbf24' : '#fca5a5';
      const revBadge = r.requiereRevision
        ? `<span style="font-size:.68rem; background:rgba(239,68,68,.15); color:#fca5a5; border:1px solid rgba(239,68,68,.3); padding:1px 5px; border-radius:4px; white-space:nowrap;">⚠ Revisión</span>`
        : '';
      return `
      <tr>
        <td>${(page-1)*PAGE_SIZE + i + 1}</td>
        <td>
          ${escapeHtml([r.nombre, r.apellidoPaterno, r.apellidoMaterno].filter(Boolean).join(' ') || '—')}
          ${revBadge}
        </td>
        <td><code style="font-size:.75rem; color:var(--accent3)">${escapeHtml(r.curp||'—')}</code></td>
        <td style="font-size:.75rem">${escapeHtml(r.claveElector||'—')}</td>
        <td style="font-size:.78rem">${escapeHtml(r.seccion||'—')}</td>
        <td>${escapeHtml(r.estado||'—')}</td>
        <td>${escapeHtml(r.sexo||'—')}</td>
        <td style="font-size:.75rem; color:var(--text3)">${formatDate(r.savedAt)}</td>
        <td>
          <span style="font-size:.78rem; font-weight:700; color:${confColor};">${conf}%</span>
        </td>
        <td>
          <div class="btn-group">
            <button class="btn btn-secondary btn-sm" onclick="viewRecord('${r.id}')">Ver</button>
            <button class="btn btn-danger btn-sm" onclick="deleteRecord('${r.id}')">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  document.getElementById('pager').innerHTML = `
    <button onclick="page=Math.max(1,page-1);renderTable()" ${page<=1?'disabled':''}>‹ Anterior</button>
    <span>Página ${page} de ${pages} · ${total} registros</span>
    <button onclick="page=Math.min(${pages},page+1);renderTable()" ${page>=pages?'disabled':''}>Siguiente ›</button>
  `;
}

function viewRecord(id) {
  const r = allRecords.find(x => x.id === id);
  if (!r) return;

  const conf = r.confianzaOCR || 0;
  const confColor = conf >= 85 ? '#6ee7b7' : conf >= 60 ? '#fbbf24' : '#fca5a5';

  const imgSection = r.imagen_url
    ? `<div style="margin-bottom:1rem;">
        <div class="data-label" style="margin-bottom:.5rem;">Imagen original (Supabase Storage)</div>
        <img src="${r.imagen_url}" alt="INE original"
          style="width:100%; border-radius:8px; border:1px solid var(--border); object-fit:contain; max-height:220px; background:#000;">
       </div>`
    : `<div style="color:var(--text3); font-size:.82rem; margin-bottom:1rem; padding:1rem; background:var(--bg2); border-radius:8px;">
        Sin imagen adjunta
       </div>`;

  const confSection = `
    <div class="data-item" style="margin-bottom:.75rem; border-color:${confColor}33; background:${confColor}0d; grid-column:1/-1;">
      <div class="data-label">Confianza OCR</div>
      <div style="display:flex; align-items:center; gap:10px; margin-top:4px;">
        <div class="confidence-bar-bg" style="flex:1;">
          <div class="confidence-bar-fill" style="width:${conf}%; background:${confColor};"></div>
        </div>
        <span style="color:${confColor}; font-weight:700;">${conf}%</span>
        ${r.requiereRevision ? '<span class="revision-badge">⚠ REVISIÓN MANUAL</span>' : '<span class="ok-badge">✓ OK</span>'}
      </div>
    </div>`;

  const fields = Object.entries(FIELD_LABELS).map(([k, label]) => `
    <div class="data-item" style="margin-bottom:.4rem;">
      <div class="data-label">${label}</div>
      <div class="data-value">${escapeHtml(r[k]||'—')}</div>
    </div>`).join('');

  const meta = `
    <div class="data-item" style="margin-bottom:.4rem;">
      <div class="data-label">Fecha de registro</div>
      <div class="data-value">${formatDate(r.savedAt)}</div>
    </div>`;

  document.getElementById('modalContent').innerHTML =
    imgSection +
    `<div class="data-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:.6rem;">
      ${confSection}${fields}${meta}
    </div>`;

  document.getElementById('modalDeleteBtn').onclick = () => {
    deleteRecord(id); closeModal('detailModal');
  };
  openModal('detailModal');
}

// ── ELIMINAR DE SUPABASE ─────────────────
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
    alert("Error al eliminar el registro.");
  }
}

async function confirmClear() {
  if (!confirm('¿Eliminar TODOS los registros de la nube? Esta acción es irreversible.')) return;
  try {
    const { error } = await clienteSupabase.from('registros_ine').delete().neq('id', '00000000-0000-0000-0000-000000000000'); 
    if (error) throw error;
    
    allRecords = [];
    renderStats();
    renderTable();
  } catch (err) {
    console.error(err);
    alert("Error al vaciar la base de datos.");
  }
}

// ── EXPORTACIÓN ───────────────────
function exportCSV() {
  const filtered = getFilteredRecords(); 
  if (!filtered.length) { alert('No hay registros para exportar con los filtros actuales.'); return; }

  const cols = ['id', ...Object.keys(FIELD_LABELS), 'seccion', 'confianzaOCR', 'requiereRevision', 'savedAt'];
  const uniqueCols = [...new Set(cols)];
  const header = uniqueCols.join(',');
  const rows = filtered.map(r =>
    uniqueCols.map(c => {
      const val = c === 'requiereRevision' ? (r[c] ? 'SÍ' : 'NO') : (r[c] || '');
      return `"${String(val).replace(/"/g,'""')}"`;
    }).join(',')
  );
  const csv = [header, ...rows].join('\n');
  downloadBlob('\ufeff' + csv, 'text/csv;charset=utf-8;',
    'registros_ine_' + new Date().toISOString().slice(0,10) + '.csv');
}

function exportExcel() {
  const filtered = getFilteredRecords();
  if (!filtered.length) { alert('No hay registros para exportar con los filtros actuales.'); return; }

  const cols = ['id', ...Object.keys(FIELD_LABELS), 'confianzaOCR', 'requiereRevision', 'savedAt'];
  const uniqueCols = [...new Set(cols)];

  const headers = {
    id:'ID', nombre:'Nombre(s)', apellidoPaterno:'Apellido Paterno',
    apellidoMaterno:'Apellido Materno', curp:'CURP', claveElector:'Clave Elector',
    fechaNacimiento:'Fecha Nacimiento', sexo:'Sexo', estado:'Estado',
    municipio:'Municipio', seccion:'Sección', folio:'Folio',
    vigencia:'Vigencia', domicilio:'Domicilio', anioRegistro:'Año Registro',
    confianzaOCR:'Confianza OCR %', requiereRevision:'Requiere Revisión', savedAt:'Fecha Registro'
  };

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:x="urn:schemas-microsoft-com:office:excel">
<Styles>
  <Style ss:ID="h"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2563EB" ss:Pattern="Solid"/></Style>
  <Style ss:ID="w"><Interior ss:Color="#FFFF00" ss:Pattern="Solid"/></Style>
</Styles>
<Worksheet ss:Name="Registros INE">
<Table>
<Row>`;

  uniqueCols.forEach(c => {
    xml += `<Cell ss:StyleID="h"><Data ss:Type="String">${escapeXml(headers[c]||c)}</Data></Cell>`;
  });
  xml += '</Row>\n';

  filtered.forEach(r => {
    xml += '<Row>';
    uniqueCols.forEach(c => {
      let val = r[c];
      if (c === 'requiereRevision') val = val ? 'SÍ' : 'NO';
      const styleAttr = (c === 'requiereRevision' && r[c]) ? ' ss:StyleID="w"' : '';
      xml += `<Cell${styleAttr}><Data ss:Type="String">${escapeXml(String(val||''))}</Data></Cell>`;
    });
    xml += '</Row>\n';
  });

  xml += '</Table></Worksheet></Workbook>';
  downloadBlob(xml, 'application/vnd.ms-excel', 'registros_ine_' + new Date().toISOString().slice(0,10) + '.xls');
}

function escapeXml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// ── MODAL ────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
window.addEventListener('click', e => {
  ['detailModal','configModal'].forEach(id => {
    const el = document.getElementById(id);
    if (e.target === el) closeModal(id);
  });
});

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

(function init() {
  document.querySelectorAll('#viewScanner .nav-btn')[0].classList.add('active');
})();
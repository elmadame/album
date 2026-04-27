const API_URL = 'https://script.google.com/macros/s/AKfycbzlMlnCIvUU6xwCTxBuogTqPsF1689oYIl-RV8PFDex9xu7v2oQ81kyiHl8TaFj2YNgrA/exec';

const USER_STORAGE_KEY = 'ogn_album_prod_user';
const BOOSTER_CODE_STORAGE_KEY = 'ogn_album_used_extra_booster_codes_v2';
const LOCAL_EXTRA_COLLECTION_STORAGE_KEY = 'ogn_album_extra_booster_collection_v1';
const DAILY_EXCHANGE_LIMIT = 2;

const EXTRA_BOOSTER_CODES = Object.freeze([
  'OGN-UXUZ-Y7AY-PMMN', 'OGN-NYEJ-A44T-LQ7T', 'OGN-9G8Z-BP5A-N559',
  'OGN-FVMP-UC24-ZS84', 'OGN-5D2L-8FGV-SB4X', 'OGN-L8X2-A95Y-DS5V',
  'OGN-7PDB-JA74-KYLP', 'OGN-G2HU-3L6K-F59Y', 'OGN-YS9L-8T4S-HXFH',
  'OGN-VZX5-24E7-4TJV', 'OGN-4DHC-SPEP-JZHZ', 'OGN-CTGW-D94N-3G4Z',
  'OGN-QQY9-P3HM-X4GY', 'OGN-A6J6-CR7F-4RFS', 'OGN-N4F9-JZRK-4L8M',
  'OGN-GUAY-D5FC-CU3Y', 'OGN-R2XQ-82RY-A9DN', 'OGN-454F-9ARV-272F',
  'OGN-N53B-FQJG-6KWB', 'OGN-E37T-VCY9-R9YT', 'OGN-W2MN-U5MN-QGNK',
  'OGN-LDHA-66NR-CZED', 'OGN-K33Y-Y7K4-CUYE', 'OGN-CMA5-F498-JHHV',
  'OGN-YNED-9Z3Y-HDKQ', 'OGN-TEDE-JJH7-XLUG', 'OGN-WAWH-PST7-GKHF',
  'OGN-XTT9-3XDK-W49A', 'OGN-J72Q-BFNS-VPB2', 'OGN-FRL5-BARG-N5NH'
]);

const placeholderSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 800 1100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1B4298"/>
      <stop offset="58%" stop-color="#009DDC"/>
      <stop offset="100%" stop-color="#CDA349"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1100" rx="40" fill="url(#g)"/>
  <circle cx="630" cy="190" r="140" fill="#ffffff" fill-opacity="0.14"/>
  <circle cx="230" cy="880" r="160" fill="#ffffff" fill-opacity="0.08"/>
  <text x="400" y="500" fill="#ffffff" font-family="Montserrat, Arial, sans-serif" font-size="96" text-anchor="middle" font-weight="900">OGN</text>
  <text x="400" y="610" fill="#ffffff" font-family="Montserrat, Arial, sans-serif" font-size="34" text-anchor="middle">PHOTO URL PENDING</text>
</svg>`);
const PLACEHOLDER_IMAGE = `data:image/svg+xml;charset=UTF-8,${placeholderSvg}`;

const state = {
  currentUser: null,
  cards: [],
  serverCollection: {},
  collection: {},
  stats: { uniqueCount: 0, totalCount: 0, duplicateCount: 0, progressPercent: 0 },
  cooldownUntil: null,
  exchangeStatus: {
    usedToday: 0,
    dailyLimit: DAILY_EXCHANGE_LIMIT,
    remaining: DAILY_EXCHANGE_LIMIT,
    resetAt: null,
    history: []
  }
};

function byId(id) { return document.getElementById(id); }

function safeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setStatus(message, type = 'ok') {
  const box = byId('statusBox');
  if (!box) return;
  box.className = `status status--${type}`;
  box.textContent = message;
}

function clearStatus() {
  const box = byId('statusBox');
  if (!box) return;
  box.className = 'status status--hidden';
  box.textContent = '';
}

function normalizeBoosterCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function getCardById(cardId) {
  return state.cards.find(card => card.cardId === cardId) || null;
}

function getLocalExtraCollectionKey(email) {
  return `${LOCAL_EXTRA_COLLECTION_STORAGE_KEY}:${String(email || 'anonymous').trim().toLowerCase()}`;
}

function readUsedBoosterCodes() {
  try {
    const raw = localStorage.getItem(BOOSTER_CODE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function markBoosterCodeUsed(code) {
  const normalized = normalizeBoosterCode(code);
  const used = new Set(readUsedBoosterCodes());
  used.add(normalized);
  localStorage.setItem(BOOSTER_CODE_STORAGE_KEY, JSON.stringify([...used]));
}

function readLocalExtraCollection(email) {
  try {
    const raw = localStorage.getItem(getLocalExtraCollectionKey(email));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalExtraCollection(email, collection) {
  localStorage.setItem(getLocalExtraCollectionKey(email), JSON.stringify(collection || {}));
}

function mergeCollections(baseCollection = {}, extraCollection = {}) {
  const merged = { ...(baseCollection || {}) };
  Object.entries(extraCollection || {}).forEach(([cardId, count]) => {
    const safeCount = Number(count) || 0;
    if (safeCount > 0) merged[cardId] = (merged[cardId] || 0) + safeCount;
  });
  return merged;
}

function refreshMergedCollection(email) {
  const localExtraCollection = readLocalExtraCollection(email);
  state.collection = mergeCollections(state.serverCollection || {}, localExtraCollection);
}

function addCardsToLocalExtraCollection(email, cards) {
  const extraCollection = readLocalExtraCollection(email);
  cards.forEach(card => {
    if (!card?.cardId) return;
    extraCollection[card.cardId] = (extraCollection[card.cardId] || 0) + 1;
  });
  saveLocalExtraCollection(email, extraCollection);
}

function getCardWeight(card) {
  const parsed = Number(card?.weight);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function pickWeightedCard(cards) {
  const safeCards = cards.filter(Boolean);
  const totalWeight = safeCards.reduce((sum, card) => sum + getCardWeight(card), 0);
  let roll = Math.random() * totalWeight;

  for (const card of safeCards) {
    roll -= getCardWeight(card);
    if (roll <= 0) return card;
  }

  return safeCards[safeCards.length - 1];
}

function generateExtraBoosterCards(count = 3) {
  if (!state.cards.length) throw new Error('Primero carga tu colección para poder abrir un booster extra.');
  return Array.from({ length: count }, () => pickWeightedCard(state.cards));
}

function getUserData(strict = true) {
  const name = byId('userName')?.value.trim() || '';
  const email = byId('userEmail')?.value.trim().toLowerCase() || '';
  if (strict && (!name || !email)) throw new Error('Nombre y correo son obligatorios.');
  return { name, email };
}

function saveUserLocally(user) {
  if (!user?.email || !user?.name) return;
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.email || !parsed?.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readUserFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const email = (params.get('email') || '').trim().toLowerCase();
  const name = (params.get('name') || '').trim();
  if (!email || !name) return null;
  return { email, name };
}

function prefillUser(user) {
  if (!user) return;
  if (byId('userName')) byId('userName').value = user.name || '';
  if (byId('userEmail')) byId('userEmail').value = user.email || '';
  state.currentUser = user;
}

async function apiGet(query) {
  const res = await fetch(`${API_URL}?${query}`);
  return await res.json();
}

async function apiPost(payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

function computeStats(cards, collection) {
  const uniqueCount = cards.filter(card => (collection[card.cardId] || 0) > 0).length;
  const totalCount = Object.values(collection || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const duplicateCount = Object.values(collection || {}).reduce((sum, n) => sum + Math.max(0, (Number(n) || 0) - 1), 0);
  const progressPercent = Math.round((uniqueCount / Math.max(1, cards.length)) * 100);
  return { uniqueCount, totalCount, duplicateCount, progressPercent };
}

function updateStats(stats) {
  const cardTotal = state.cards.length || 103;
  if (byId('uniqueCount')) byId('uniqueCount').textContent = `${stats.uniqueCount} / ${cardTotal}`;
  if (byId('totalCount')) byId('totalCount').textContent = stats.totalCount;
  if (byId('duplicateCount')) byId('duplicateCount').textContent = stats.duplicateCount;
  if (byId('progressPercent')) byId('progressPercent').textContent = `${stats.progressPercent}%`;
  if (byId('albumSubtitle')) byId('albumSubtitle').textContent = `Visualización de ${cardTotal} cards.`;
}

function normalizePhoto(url) {
  return url && String(url).trim() ? String(url).trim() : PLACEHOLDER_IMAGE;
}

function renderCardTemplate(card, ownedCount = 0, options = {}) {
  const owned = ownedCount > 0;
  const number = String(card.number || '').padStart(3, '0');
  const displayName = owned || options.forceReveal ? (card.name || `OGN Card ${number}`) : 'Carta pendiente';
  const displayTeam = owned || options.forceReveal ? (card.team || 'OGN Team') : '';
  const rarity = card.rarity || 'standard';

  return `
    <article class="card-template ${owned ? '' : 'is-missing'} ${options.compact ? 'card-template--compact' : ''}">
      <div class="card-template__shell">
        <div class="card-template__top">
          <div class="card-template__number">#${safeText(number)}</div>
          <div class="card-template__rarity">${safeText(rarity)}</div>
        </div>
        <div class="card-template__brand">OGN</div>
        <div class="card-template__photo">
          <img src="${safeText(normalizePhoto(card.photoUrl))}" alt="${safeText(card.name || 'OGN card')}" loading="lazy" referrerpolicy="no-referrer" />
        </div>
        <div class="card-template__bottom">
          <div class="card-template__name">${safeText(displayName)}</div>
          <div class="card-template__meta">
            <span>${safeText(displayTeam)}</span>
            <span>${safeText(card.cardId || '')}</span>
          </div>
        </div>
      </div>
      ${owned ? `<div class="card-template__count">Obtenida · x${ownedCount}</div>` : `<div class="card-template__pending">No obtenida</div>`}
    </article>
  `;
}

function renderAlbum() {
  const root = byId('albumGrid');
  if (!root) return;

  const query = byId('searchInput')?.value.trim().toLowerCase() || '';
  const ownershipFilter = byId('ownershipFilter')?.value || 'all';
  const filtered = state.cards.filter(card => {
    const ownedCount = state.collection[card.cardId] || 0;
    const matchesOwnership =
      ownershipFilter === 'all' ||
      (ownershipFilter === 'owned' && ownedCount > 0) ||
      (ownershipFilter === 'missing' && ownedCount === 0) ||
      (ownershipFilter === 'duplicates' && ownedCount > 1);
    const haystack = `${card.cardId} ${card.number} ${card.name || ''} ${card.team || ''} ${card.rarity || ''}`.toLowerCase();
    return matchesOwnership && (!query || haystack.includes(query));
  });

  root.innerHTML = filtered.length
    ? filtered.map(card => renderCardTemplate(card, state.collection[card.cardId] || 0)).join('')
    : '<div class="empty-state">No hay cartas que coincidan con el filtro.</div>';
}

function updateCooldown() {
  const btn = byId('openBoosterBtn');
  const text = byId('cooldownText');
  if (!btn || !text) return;

  if (!state.currentUser) {
    text.textContent = 'Cargar usuario';
    btn.disabled = true;
    return;
  }

  const target = state.cooldownUntil ? new Date(state.cooldownUntil).getTime() : 0;
  const now = Date.now();
  if (!target || now >= target) {
    text.textContent = 'Disponible ahora';
    btn.disabled = false;
    return;
  }

  const diff = target - now;
  const totalSeconds = Math.floor(diff / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  text.textContent = `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  btn.disabled = true;
}

function createFlipSlots(cards) {
  return cards.map((card, index) => `
    <div class="reveal-slot">
      <div class="flip-card" id="flipCard${index}">
        <div class="flip-card__face flip-card__face--back"></div>
        <div class="flip-card__face flip-card__face--front">
          ${renderCardTemplate(card, state.collection[card.cardId] || 1, { forceReveal: true })}
        </div>
      </div>
    </div>
  `).join('');
}

function animateBoosterReveal(cards) {
  const root = byId('boosterReveal');
  if (!root) return;
  root.innerHTML = createFlipSlots(cards);
  cards.forEach((_, index) => {
    setTimeout(() => {
      const slot = byId(`flipCard${index}`);
      if (slot) slot.classList.add('is-flipped');
    }, 650 + (index * 340));
  });
}

function renderExchangeOptions() {
  const select = byId('exchangeGiveCard');
  if (!select) return;

  const duplicates = state.cards.filter(card => (state.serverCollection[card.cardId] || 0) > 1);

  if (!state.currentUser) {
    select.innerHTML = '<option value="">Carga tu colección primero</option>';
    return;
  }

  if (!duplicates.length) {
    select.innerHTML = '<option value="">No tienes duplicadas disponibles</option>';
    return;
  }

  select.innerHTML = duplicates.map(card => {
    const count = state.serverCollection[card.cardId] || 0;
    const number = String(card.number || '').padStart(3, '0');
    return `<option value="${safeText(card.cardId)}">#${safeText(number)} · ${safeText(card.name || card.cardId)} · ${safeText(card.rarity || 'standard')} · x${count}</option>`;
  }).join('');
}

function normalizeExchangeStatus(status = {}) {
  const dailyLimit = Number(status.dailyLimit || DAILY_EXCHANGE_LIMIT);
  const usedToday = Math.max(0, Number(status.usedToday || 0));
  return {
    usedToday,
    dailyLimit,
    remaining: Math.max(0, Number(status.remaining ?? (dailyLimit - usedToday))),
    resetAt: status.resetAt || null,
    history: Array.isArray(status.history) ? status.history : []
  };
}

function formatExchangeReset(resetAt) {
  if (!resetAt) return 'Mañana';
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return 'Mañana';
  return date.toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}

function updateExchangePanel() {
  state.exchangeStatus = normalizeExchangeStatus(state.exchangeStatus);
  const status = state.exchangeStatus;
  const duplicateCount = state.cards.filter(card => (state.serverCollection[card.cardId] || 0) > 1).length;

  if (byId('exchangeLimitText')) byId('exchangeLimitText').textContent = `${status.usedToday} / ${status.dailyLimit}`;
  if (byId('exchangeResetText')) byId('exchangeResetText').textContent = formatExchangeReset(status.resetAt);

  const btn = byId('exchangeCardBtn');
  if (btn) {
    btn.disabled = !state.currentUser || duplicateCount === 0 || status.remaining <= 0;
    btn.textContent = status.remaining <= 0 ? 'Límite diario alcanzado' : 'Intercambiar ahora';
  }

  renderExchangeHistory(status.history);
  updateExchangePreview();
}

function renderExchangeHistory(history = []) {
  const root = byId('exchangeHistoryList');
  if (!root) return;

  if (!history.length) {
    root.innerHTML = '<div class="empty-row">Sin movimientos todavía.</div>';
    return;
  }

  root.innerHTML = history.slice(0, 5).map(item => {
    const giveCard = getCardById(item.giveCardId || item.give || '');
    const receiveCard = getCardById(item.receiveCardId || item.receive || '');
    return `
      <div class="exchange-history__item">
        <div><span>Entregó</span><strong>${safeText(giveCard?.name || item.giveCardId || item.give || '-')}</strong></div>
        <div><span>Recibió</span><strong>${safeText(receiveCard?.name || item.receiveCardId || item.receive || '-')}</strong></div>
      </div>
    `;
  }).join('');
}

function updateExchangePreview(receivedCard = null, givenCard = null) {
  const root = byId('exchangePreview');
  if (!root) return;

  if (receivedCard) {
    root.innerHTML = `
      <div class="exchange-result">
        <div>
          <span class="exchange-result__label">Recibiste</span>
          <h3>${safeText(receivedCard.name || receivedCard.cardId)}</h3>
          <p>${safeText(receivedCard.team || '')} · ${safeText(receivedCard.rarity || 'standard')}</p>
        </div>
        ${renderCardTemplate(receivedCard, state.collection[receivedCard.cardId] || 1, { compact: true, forceReveal: true })}
      </div>
    `;
    return;
  }

  const selectedId = byId('exchangeGiveCard')?.value || '';
  const selectedCard = getCardById(selectedId);
  if (!selectedCard) {
    root.innerHTML = `
      <div class="exchange-preview__empty">
        <strong>Exchange Machine</strong>
        <span>Selecciona una duplicada para iniciar el intercambio.</span>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="exchange-preview__ready">
      <span>Lista para entregar</span>
      <strong>${safeText(selectedCard.name || selectedCard.cardId)}</strong>
      <small>Conservas una copia; solo se descuenta una duplicada.</small>
    </div>
  `;
}

async function loadExchangeStatus(user, options = {}) {
  if (!user?.email) return;
  try {
    const data = await apiGet(`action=getExchangeStatus&email=${encodeURIComponent(user.email)}`);
    if (data?.success) {
      state.exchangeStatus = normalizeExchangeStatus(data.exchangeStatus || data);
    } else if (!options.silent) {
      setStatus('El panel cargó, pero el backend de intercambios aún no está activado.', 'warning');
    }
  } catch {
    if (!options.silent) setStatus('El backend de intercambios aún no está activado. Agrega el archivo Apps Script incluido.', 'warning');
  }
}

async function loadCollection(options = {}) {
  try {
    if (!options.silent) clearStatus();
    const user = options.user || getUserData(true);
    state.currentUser = user;
    saveUserLocally(user);

    const data = await apiGet(`action=getCollection&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name)}`);
    if (!data.success) throw new Error(data.message || 'No fue posible cargar la colección.');

    state.cards = data.cards || [];
    state.serverCollection = data.collection || {};
    refreshMergedCollection(user.email);
    state.stats = computeStats(state.cards, state.collection);
    state.cooldownUntil = data.cooldownUntil || null;

    if (data.exchangeStatus) {
      state.exchangeStatus = normalizeExchangeStatus(data.exchangeStatus);
    } else {
      await loadExchangeStatus(user, { silent: true });
    }

    updateStats(state.stats);
    renderAlbum();
    renderExchangeOptions();
    updateExchangePanel();
    updateCooldown();

    if (!options.silent) setStatus('Colección cargada correctamente.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function openBooster() {
  const pack = byId('openBoosterBtn');
  try {
    clearStatus();
    const user = state.currentUser || getUserData(true);
    state.currentUser = user;
    saveUserLocally(user);
    if (pack) pack.classList.add('is-opening');

    const data = await apiPost({ action: 'openBooster', email: user.email, name: user.name });
    if (!data.success) throw new Error(data.message || 'No fue posible abrir el booster.');

    setTimeout(() => {
      state.cards = data.cards || state.cards;
      state.serverCollection = data.collection || state.serverCollection;
      refreshMergedCollection(user.email);
      state.stats = computeStats(state.cards, state.collection);
      state.cooldownUntil = data.cooldownUntil || null;

      updateStats(state.stats);
      renderAlbum();
      renderExchangeOptions();
      updateExchangePanel();
      animateBoosterReveal(data.boosterCards || []);
      updateCooldown();
      setStatus('Booster abierto correctamente.', 'ok');
      if (pack) pack.classList.remove('is-opening');
    }, 850);
  } catch (error) {
    if (pack) pack.classList.remove('is-opening');
    setStatus(error.message, 'error');
  }
}

async function openExtraBoosterWithCode() {
  const input = byId('boosterCodeInput');
  const trigger = byId('redeemBoosterCodeBtn');

  try {
    clearStatus();
    const user = state.currentUser || getUserData(true);
    state.currentUser = user;
    saveUserLocally(user);

    const code = normalizeBoosterCode(input?.value);
    if (!code) throw new Error('Ingresa un código de booster extra.');
    if (!EXTRA_BOOSTER_CODES.includes(code)) throw new Error('Código inválido. Revisa mayúsculas, guiones y caracteres.');
    if (readUsedBoosterCodes().includes(code)) throw new Error('Este código ya fue utilizado en este navegador.');

    if (!state.cards.length) await loadCollection({ user, silent: true });
    if (trigger) trigger.disabled = true;

    const boosterCards = generateExtraBoosterCards(3);
    addCardsToLocalExtraCollection(user.email, boosterCards);
    refreshMergedCollection(user.email);
    state.stats = computeStats(state.cards, state.collection);

    updateStats(state.stats);
    renderAlbum();
    renderExchangeOptions();
    updateExchangePanel();
    animateBoosterReveal(boosterCards);
    markBoosterCodeUsed(code);
    if (input) input.value = '';
    updateCooldown();
    setStatus('Código válido. Booster extra abierto. Nota: este booster extra vive en este navegador si no se registra en backend.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    if (trigger) trigger.disabled = false;
  }
}

async function exchangeCard() {
  const trigger = byId('exchangeCardBtn');
  try {
    clearStatus();
    const user = state.currentUser || getUserData(true);
    const giveCardId = byId('exchangeGiveCard')?.value || '';
    const mode = byId('exchangeMode')?.value || 'missing';
    if (!giveCardId) throw new Error('Selecciona una carta duplicada para intercambiar.');

    const ownedInDatabase = Number(state.serverCollection[giveCardId] || 0);
    if (ownedInDatabase < 2) throw new Error('Esta carta no tiene duplicado validado en la base. Solo se pueden cambiar duplicadas reales.');

    if (trigger) trigger.disabled = true;

    const data = await apiPost({ action: 'exchangeCard', email: user.email, name: user.name, giveCardId, mode });
    if (!data.success) throw new Error(data.message || 'No fue posible completar el intercambio.');

    state.cards = data.cards || state.cards;
    state.serverCollection = data.collection || state.serverCollection;
    refreshMergedCollection(user.email);
    state.stats = computeStats(state.cards, state.collection);
    state.exchangeStatus = normalizeExchangeStatus(data.exchangeStatus || state.exchangeStatus);

    updateStats(state.stats);
    renderAlbum();
    renderExchangeOptions();
    updateExchangePanel();
    updateExchangePreview(data.receivedCard || null, data.givenCard || null);

    setStatus('Intercambio completado. Se descontó 1 duplicada y se agregó una nueva carta a tu colección.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    updateExchangePanel();
  }
}

function bootstrapProductionUser() {
  const queryUser = readUserFromQuery();
  const storedUser = readStoredUser();
  const chosenUser = queryUser || storedUser;
  if (!chosenUser) {
    updateStats(state.stats);
    renderAlbum();
    renderExchangeOptions();
    updateExchangePanel();
    updateCooldown();
    return;
  }
  prefillUser(chosenUser);
  saveUserLocally(chosenUser);
  loadCollection({ user: chosenUser, silent: true });
}

function bindEvents() {
  byId('loadCollectionBtn')?.addEventListener('click', () => loadCollection());
  byId('openBoosterBtn')?.addEventListener('click', openBooster);
  byId('redeemBoosterCodeBtn')?.addEventListener('click', openExtraBoosterWithCode);
  byId('boosterCodeInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') openExtraBoosterWithCode();
  });
  byId('exchangeCardBtn')?.addEventListener('click', exchangeCard);
  byId('exchangeGiveCard')?.addEventListener('change', () => updateExchangePreview());
  byId('exchangeMode')?.addEventListener('change', () => updateExchangePreview());
  byId('searchInput')?.addEventListener('input', renderAlbum);
  byId('ownershipFilter')?.addEventListener('change', renderAlbum);
}

setInterval(updateCooldown, 1000);
bindEvents();
updateStats(state.stats);
renderAlbum();
bootstrapProductionUser();
(function initFloatingNavigation() {
  function setupFloatingNavigation() {
    const toggle = document.getElementById('floatingNavToggle');
    const menu = document.getElementById('floatingNavMenu');
    const navItems = Array.from(document.querySelectorAll('.floating-nav__item'));
    const sections = navItems
      .map(item => document.getElementById(item.dataset.section))
      .filter(Boolean);

    if (!toggle || !menu || !navItems.length) return;

    function closeMenu() {
      toggle.classList.remove('is-open');
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }

    function openMenu() {
      toggle.classList.add('is-open');
      menu.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
    }

    function toggleMenu() {
      const isOpen = menu.classList.contains('is-open');
      if (isOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    }

    toggle.addEventListener('click', toggleMenu);

    navItems.forEach(item => {
      item.addEventListener('click', () => {
        closeMenu();
      });
    });

    document.addEventListener('click', event => {
      const clickedInsideMenu = event.target.closest('.floating-nav');
      if (!clickedInsideMenu) closeMenu();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu();
    });

    if ('IntersectionObserver' in window && sections.length) {
      const observer = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;

            navItems.forEach(item => {
              item.classList.toggle(
                'is-active',
                item.dataset.section === entry.target.id
              );
            });
          });
        },
        {
          root: null,
          threshold: 0.34,
          rootMargin: '-18% 0px -58% 0px'
        }
      );

      sections.forEach(section => observer.observe(section));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupFloatingNavigation);
  } else {
    setupFloatingNavigation();
  }
})();

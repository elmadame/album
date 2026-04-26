/**
 * OGN Album · Exchange System Patch
 * Goal: add a daily exchange system WITHOUT changing the Google Sheets database schema.
 *
 * How it works:
 * - Reuses the existing collection persistence.
 * - Reuses the existing logs table by writing exchange rows in this format:
 *   EXCHANGE|give=CARD_ID|receive=CARD_ID|mode=missing
 * - Enforces 3 exchanges per user per calendar day on the server.
 *
 * IMPORTANT:
 * This file is written as an integration patch because your current Code.gs was not included.
 * Wire the two actions below into your existing doGet/doPost dispatcher:
 * - GET  action=getExchangeStatus&email=user@organon.com
 * - POST { action:'exchangeCard', email, name, giveCardId, mode }
 */

const EXCHANGE_DAILY_LIMIT = 3;
const EXCHANGE_LOG_PREFIX = 'EXCHANGE|';

/**
 * Add this inside your existing doGet(e) dispatcher:
 *
 * if (action === 'getExchangeStatus') {
 *   return json_(getExchangeStatus_(String(e.parameter.email || '').toLowerCase()));
 * }
 */
function getExchangeStatus_(email) {
  if (!email) return { success: false, message: 'Email requerido.' };

  const logs = getAlbumLogs_();
  const todayKey = getDateKey_(new Date());
  const userExchangeLogs = logs
    .filter(log => String(log.email || '').toLowerCase() === email)
    .filter(log => String(log.cards || '').startsWith(EXCHANGE_LOG_PREFIX));

  const usedToday = userExchangeLogs.filter(log => getDateKey_(new Date(log.openedAt)) === todayKey).length;
  const history = userExchangeLogs
    .slice(-10)
    .reverse()
    .map(log => ({
      openedAt: log.openedAt,
      ...parseExchangeCardsText_(log.cards)
    }));

  return {
    success: true,
    exchangeStatus: {
      usedToday,
      dailyLimit: EXCHANGE_DAILY_LIMIT,
      remaining: Math.max(0, EXCHANGE_DAILY_LIMIT - usedToday),
      resetAt: getTomorrowStartIso_(),
      history
    }
  };
}

/**
 * Add this inside your existing doPost(e) dispatcher after parsing payload:
 *
 * if (payload.action === 'exchangeCard') {
 *   return json_(exchangeCard_(payload));
 * }
 */
function exchangeCard_(payload) {
  const email = String(payload.email || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  const giveCardId = String(payload.giveCardId || '').trim();
  const mode = String(payload.mode || 'missing').trim();

  if (!email || !name) return { success: false, message: 'Nombre y correo son obligatorios.' };
  if (!giveCardId) return { success: false, message: 'Selecciona una carta duplicada.' };

  const status = getExchangeStatus_(email).exchangeStatus;
  if (status.remaining <= 0) {
    return { success: false, message: 'Límite diario alcanzado. Puedes hacer máximo 3 intercambios por día.' };
  }

  const cards = getAlbumCards_();
  const giveCard = cards.find(card => String(card.cardId) === giveCardId);
  if (!giveCard) return { success: false, message: 'La carta a entregar no existe en el catálogo.' };

  const collection = getAlbumCollection_(email, name);
  const currentCount = Number(collection[giveCardId] || 0);
  if (currentCount < 2) {
    return { success: false, message: 'Solo puedes intercambiar cartas duplicadas. Las cartas únicas están protegidas.' };
  }

  const receiveCard = pickExchangeReceiveCard_(cards, collection, giveCard, mode);
  if (!receiveCard) {
    return { success: false, message: 'No hay cartas faltantes disponibles para este modo de intercambio.' };
  }

  collection[giveCardId] = currentCount - 1;
  collection[receiveCard.cardId] = Number(collection[receiveCard.cardId] || 0) + 1;

  saveAlbumCollection_(email, name, collection);
  appendAlbumLog_(email, new Date(), `${EXCHANGE_LOG_PREFIX}give=${giveCardId}|receive=${receiveCard.cardId}|mode=${mode}`);

  const updatedStatus = getExchangeStatus_(email).exchangeStatus;

  return {
    success: true,
    cards,
    collection,
    givenCard: giveCard,
    receivedCard: receiveCard,
    exchangeStatus: updatedStatus,
    message: 'Intercambio completado correctamente.'
  };
}

function pickExchangeReceiveCard_(cards, collection, giveCard, mode) {
  const missingCards = cards.filter(card => Number(collection[card.cardId] || 0) <= 0);
  if (!missingCards.length) return null;

  let pool = missingCards;

  if (mode === 'sameRarity') {
    const sameRarity = missingCards.filter(card => String(card.rarity || '').toLowerCase() === String(giveCard.rarity || '').toLowerCase());
    if (sameRarity.length) pool = sameRarity;
  }

  return pickWeightedCard_(pool);
}

function pickWeightedCard_(cards) {
  const totalWeight = cards.reduce((sum, card) => sum + getCardWeight_(card), 0);
  let roll = Math.random() * totalWeight;

  for (const card of cards) {
    roll -= getCardWeight_(card);
    if (roll <= 0) return card;
  }

  return cards[cards.length - 1];
}

function getCardWeight_(card) {
  const parsed = Number(card && card.weight);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseExchangeCardsText_(text) {
  const result = { giveCardId: '', receiveCardId: '', mode: '' };
  String(text || '').split('|').forEach(part => {
    const pieces = part.split('=');
    const key = pieces[0];
    const value = pieces.slice(1).join('=');
    if (key === 'give') result.giveCardId = value;
    if (key === 'receive') result.receiveCardId = value;
    if (key === 'mode') result.mode = value;
  });
  return result;
}

function getDateKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getTomorrowStartIso_() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  return tomorrow.toISOString();
}

/**
 * Adapter functions below.
 * Replace the internals with calls to the helpers that already exist in your current Code.gs.
 * Keep the input/output contracts exactly as shown.
 */

function getAlbumCards_() {
  // Must return: [{ number, cardId, name, team, photoUrl, rarity, weight }, ...]
  // Example integration: return getCards_();
  throw new Error('Map getAlbumCards_() to your existing cards master reader.');
}

function getAlbumCollection_(email, name) {
  // Must return an object like: { CARD_001: 2, CARD_002: 1 }
  // Example integration: return getCollectionForUser_(email, name).collection;
  throw new Error('Map getAlbumCollection_() to your existing collection reader.');
}

function saveAlbumCollection_(email, name, collection) {
  // Must persist the full collection object for the user in your current collection storage.
  // Example integration: saveCollectionForUser_(email, name, collection);
  throw new Error('Map saveAlbumCollection_() to your existing collection writer.');
}

function getAlbumLogs_() {
  // Must return: [{ email, openedAt, cards }, ...]
  // Example integration: return getLogs_();
  throw new Error('Map getAlbumLogs_() to your existing logs reader.');
}

function appendAlbumLog_(email, openedAt, cardsText) {
  // Must append one row to the same logs sheet used for boosters.
  // Existing columns expected by admin: email, openedAt, cards.
  // Example integration: appendLog_(email, openedAt, cardsText);
  throw new Error('Map appendAlbumLog_() to your existing log writer.');
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

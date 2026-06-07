const SH = {
  CARDS: 'Cards',
  USERS: 'Users',
  USER_CARDS: 'UserCards',
  BOOSTER_LOG: 'BoosterLog',
  CONFIG: 'Config'
};

function doGet(e) {
  try {
    const action = e.parameter.action || 'ping';
    if (action === 'getCollection') return out_(getCollectionResponse_(e.parameter.email, e.parameter.name || ''));
    if (action === 'adminUsers') return out_({ success: true, users: adminUsers_() });
    if (action === 'adminCards') return out_({ success: true, cards: getCards_() });
    if (action === 'adminLogs') return out_({ success: true, logs: adminLogs_() });
    return out_({ success: true, message: 'OGN Album API active' });
  } catch (err) {
    return out_({ success: false, message: err.message });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (data.action === 'openBooster') return out_(openBooster_(data.email, data.name || ''));
    return out_({ success: false, message: 'Unsupported action' });
  } catch (err) {
    return out_({ success: false, message: err.message });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function setupOGNAlbumV2() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  mk_(ss, SH.CARDS, ['cardId','number','name','team','photoUrl','rarity','weight','active']);
  mk_(ss, SH.USERS, ['email','name','createdAt','lastOpenAt','uniqueCount','totalCount']);
  mk_(ss, SH.USER_CARDS, ['email','cardId','count','firstObtainedAt','lastObtainedAt']);
  mk_(ss, SH.BOOSTER_LOG, ['email','openedAt','cards']);
  mk_(ss, SH.CONFIG, ['key','value']);
  formatAll_();
  seedConfig_();
  seedCards100Template_();
}

function seedConfig_() {
  const sh = sheet_(SH.CONFIG);
  const rows = sh.getDataRange().getValues();
  const keys = rows.slice(1).map(function(r){ return r[0]; });
  const seed = [
    ['cooldownMinutes', 60],
    ['boosterSize', 3],
    ['duplicatePenalty', 0.55],
    ['sameBoosterUnique', 'true']
  ];
  seed.forEach(function(row){ if (keys.indexOf(row[0]) === -1) sh.appendRow(row); });
}

function seedCards100Template_() {
  const sh = sheet_(SH.CARDS);
  if (sh.getLastRow() > 1) return;
  const rows = [];
  for (var i = 1; i <= 100; i++) {
    var rarity = i <= 72 ? 'common' : i <= 94 ? 'rare' : 'ultra rare';
    var weight = rarity === 'common' ? 64 : rarity === 'rare' ? 24 : 7;
    rows.push([
      'OGN-' + ('000' + i).slice(-3),
      i,
      'OGN Name ' + ('000' + i).slice(-3),
      'OGN Team ' + ('00' + (((i - 1) % 12) + 1)).slice(-2),
      '',
      rarity,
      weight,
      'true'
    ]);
  }
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function getCollectionResponse_(email, name) {
  if (!email) throw new Error('Email required');
  upsertUser_(email, name);
  const cards = getPublicCards_();
  const collection = getUserCollectionMap_(email);
  const stats = computeStats_(cards, collection);
  const cooldownUntil = getCooldownUntil_(email);
  return { success: true, cards: cards, collection: collection, stats: stats, cooldownUntil: cooldownUntil };
}

function openBooster_(email, name) {
  if (!email) throw new Error('Email required');
  upsertUser_(email, name);

  const cooldownUntil = getCooldownUntil_(email);
  if (cooldownUntil && new Date(cooldownUntil).getTime() > new Date().getTime()) {
    throw new Error('Todavía no puedes abrir un nuevo booster.');
  }

  const allCards = getCards_();
  const publicCards = sanitizeCards_(allCards);
  const collection = getUserCollectionMap_(email);
  const boosterSize = Number(getConfig_('boosterSize', 3));
  const duplicatePenalty = Number(getConfig_('duplicatePenalty', 0.55));
  const sameBoosterUnique = String(getConfig_('sameBoosterUnique', 'true')) === 'true';

  const selected = pickBoosterCards_(allCards, collection, boosterSize, duplicatePenalty, sameBoosterUnique);
  grantCards_(email, selected);
  logBooster_(email, selected);
  setLastOpen_(email, new Date());

  const updatedCollection = getUserCollectionMap_(email);
  const stats = computeStats_(publicCards, updatedCollection);
  updateUserStats_(email, stats);
  const nextOpen = getCooldownUntil_(email);

  return {
    success: true,
    cards: publicCards,
    collection: updatedCollection,
    stats: stats,
    boosterCards: sanitizeCards_(selected),
    cooldownUntil: nextOpen
  };
}

function pickBoosterCards_(cards, collection, boosterSize, duplicatePenalty, sameBoosterUnique) {
  const selected = [];
  const used = {};
  for (var i = 0; i < boosterSize; i++) {
    const pool = cards.filter(function(card) {
      if (String(card.active) !== 'true') return false;
      if (sameBoosterUnique && used[card.cardId]) return false;
      return true;
    }).map(function(card) {
      var baseWeight = Number(card.weight || 1);
      var owned = Number(collection[card.cardId] || 0);
      var weight = owned > 0 ? baseWeight * duplicatePenalty : baseWeight;
      return { card: card, weight: weight };
    });

    const chosen = weightedPick_(pool);
    selected.push(chosen);
    used[chosen.cardId] = true;
  }
  return selected;
}

function weightedPick_(pool) {
  const total = pool.reduce(function(sum, item){ return sum + Number(item.weight); }, 0);
  var rnd = Math.random() * total;
  var acc = 0;
  for (var i = 0; i < pool.length; i++) {
    acc += Number(pool[i].weight);
    if (rnd <= acc) return pool[i].card;
  }
  return pool[pool.length - 1].card;
}

function grantCards_(email, cards) {
  const sh = sheet_(SH.USER_CARDS);
  const values = sh.getDataRange().getValues();
  cards.forEach(function(card) {
    var idx = values.findIndex(function(r, i) {
      return i > 0 && String(r[0]).toLowerCase() === String(email).toLowerCase() && String(r[1]) === String(card.cardId);
    });
    var now = new Date();
    if (idx > -1) {
      var count = Number(values[idx][2] || 0) + 1;
      sh.getRange(idx + 1, 3).setValue(count);
      sh.getRange(idx + 1, 5).setValue(now);
    } else {
      sh.appendRow([email, card.cardId, 1, now, now]);
    }
  });
}

function logBooster_(email, cards) {
  sheet_(SH.BOOSTER_LOG).appendRow([email, new Date(), cards.map(function(card){ return card.cardId; }).join(', ')]);
}

function getCards_() {
  const sh = sheet_(SH.CARDS);
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).filter(function(r){ return r[0] !== ''; }).map(function(r){ return map_(headers, r); });
}

function getPublicCards_() {
  return sanitizeCards_(getCards_());
}

function sanitizeCards_(cards) {
  return cards.map(function(card) {
    return {
      cardId: card.cardId,
      number: card.number,
      name: card.name,
      team: card.team,
      photoUrl: card.photoUrl,
      active: card.active
    };
  });
}

function getUserCollectionMap_(email) {
  const sh = sheet_(SH.USER_CARDS);
  const rows = sh.getDataRange().getValues();
  const out = {};
  rows.slice(1).forEach(function(r) {
    if (String(r[0]).toLowerCase() === String(email).toLowerCase()) out[r[1]] = Number(r[2] || 0);
  });
  return out;
}

function computeStats_(cards, collection) {
  const uniqueCount = cards.filter(function(card){ return Number(collection[card.cardId] || 0) > 0; }).length;
  const totalCount = Object.keys(collection).reduce(function(sum, key){ return sum + Number(collection[key] || 0); }, 0);
  const duplicateCount = Object.keys(collection).reduce(function(sum, key){ return sum + Math.max(0, Number(collection[key]) - 1); }, 0);
  const progressPercent = Math.round((uniqueCount / Math.max(1, cards.length)) * 100);
  return { uniqueCount: uniqueCount, totalCount: totalCount, duplicateCount: duplicateCount, progressPercent: progressPercent };
}

function upsertUser_(email, name) {
  const sh = sheet_(SH.USERS);
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex(function(r, i){ return i > 0 && String(r[0]).toLowerCase() === String(email).toLowerCase(); });
  const now = new Date();
  if (idx > -1) {
    if (name) sh.getRange(idx + 1, 2).setValue(name);
  } else {
    sh.appendRow([email, name || '', now, '', 0, 0]);
  }
}

function updateUserStats_(email, stats) {
  const sh = sheet_(SH.USERS);
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex(function(r, i){ return i > 0 && String(r[0]).toLowerCase() === String(email).toLowerCase(); });
  if (idx > -1) {
    sh.getRange(idx + 1, 5).setValue(stats.uniqueCount);
    sh.getRange(idx + 1, 6).setValue(stats.totalCount);
  }
}

function setLastOpen_(email, dateObj) {
  const sh = sheet_(SH.USERS);
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex(function(r, i){ return i > 0 && String(r[0]).toLowerCase() === String(email).toLowerCase(); });
  if (idx > -1) sh.getRange(idx + 1, 4).setValue(dateObj);
}

function getCooldownUntil_(email) {
  const sh = sheet_(SH.USERS);
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex(function(r, i){ return i > 0 && String(r[0]).toLowerCase() === String(email).toLowerCase(); });
  if (idx === -1) return null;
  const lastOpen = rows[idx][3];
  if (!lastOpen) return null;
  const cooldownMinutes = Number(getConfig_('cooldownMinutes', 60));
  return new Date(new Date(lastOpen).getTime() + cooldownMinutes * 60000).toISOString();
}

function adminUsers_() {
  const sh = sheet_(SH.USERS);
  const rows = sh.getDataRange().getValues();
  return rows.slice(1).filter(function(r){ return r[0] !== ''; }).map(function(r){
    return { email:r[0], name:r[1], createdAt:r[2], lastOpenAt:r[3], uniqueCount:r[4], totalCount:r[5] };
  });
}

function adminLogs_() {
  const sh = sheet_(SH.BOOSTER_LOG);
  const rows = sh.getDataRange().getValues();
  return rows.slice(1).filter(function(r){ return r[0] !== ''; }).slice(-150).reverse().map(function(r){
    return { email:r[0], openedAt:r[1], cards:r[2] };
  });
}

function getConfig_(key, fallback) {
  const sh = sheet_(SH.CONFIG);
  const rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) if (String(rows[i][0]) === String(key)) return rows[i][1];
  return fallback;
}

function mk_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function formatAll_() {
  [SH.CARDS, SH.USERS, SH.USER_CARDS, SH.BOOSTER_LOG, SH.CONFIG].forEach(function(name){
    const sh = sheet_(name);
    sh.getRange(1,1,1,sh.getLastColumn()).setBackground('#103a5d').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, sh.getLastColumn());
  });
}

function sheet_(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
function map_(headers, row) { const obj = {}; headers.forEach(function(h, i){ obj[h] = row[i]; }); return obj; }

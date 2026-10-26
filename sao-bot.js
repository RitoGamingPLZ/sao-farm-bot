// =============================================================================
//  Snored Art Online bot
// =============================================================================
//  How to use: open the game tab (dev-sao.potato-proxy.com), press F12, go to
//  the Console tab, paste this whole file and press Enter. See README.md.
//
//  The bot talks to the game over the same WebSocket the page uses (/api/ws)
//  and sends the same commands the buttons send.
//
//  File layout:
//    1. CONFIG          <- the only part you normally need to edit
//    2. Game data       (level formulas, area names; change only if the game changes)
//    3. Connection      (WebSocket hook, state mirror, sending commands)
//    4. Helpers         (inventory, HP, travel, hunting)
//    5. Safety          (healing / teleport, always running)
//    6. Mode "level"    (quests + story + grind + floor bosses)
//    7. Mode "farm"     (repeat bosses for their drops)
//    8. Mode "secret"   (EXP farm in a secret area, with miasma reset trips)
//    9. Skill cycler    (puts the best ready skill in slot 1)
//   10. Controls, status, start-up
// =============================================================================
(async () => {

// =============================================================================
//  1. CONFIG — edit the values below to suit your character
// =============================================================================
// Every value can also be changed while the bot runs, from the console, e.g.
//   __bot.cfg.level.targetLevel = 90
const CONFIG = {

  // What to start right after pasting the script:
  //   'secret' = EXP farm in the secret area     (section "secret" below)
  //   'level'  = quests + story + grinding       (section "level" below)
  //   'farm'   = farm boss drops                 (section "farm" below)
  //   'none'   = install only; start later with __bot.start('level') etc.
  autostart: 'secret',

  // Stop the page from reloading itself when the server pushes an update.
  // A reload removes the bot, so leave this on.
  blockReload: true,

  // ---- Healing (runs every 0.5 s in every mode) ----------------------------
  heal: {
    // 'bot'     - the bot drinks potions, uses the emergency heal and teleports out,
    //             using the HP percentages below.
    // 'crystal' - the game's own auto-drink (game Settings: potion + percent) does the
    //             normal healing. The bot only uses a full-heal crystal below `crystalAt`
    //             (or a teleport crystal when you have no full-heal crystals left).
    // 'auto'    - 'crystal' in secret mode, 'bot' in every other mode.
    // 'off'     - the bot never heals you.
    mode: 'auto',

    // HP fractions (0.50 = 50 %) used by 'bot' mode during normal fights.
    teleportAt: 0.20,   // use a teleport crystal
    emergencyAt: 0.40,  // use the instant emergency heal
    potionAt: 0.50,     // drink a potion
    // Same thing but during boss fights.
    boss: { teleportAt: 0.20, emergencyAt: 0.40, potionAt: 0.70 },

    // 'crystal' mode: use a full-heal crystal below this HP fraction.
    crystalAt: 0.20,

    // After a teleport, wait up to this long for HP to reach `resumeAt` before going back out.
    afterTeleportWaitMs: 60 * 1000,
    resumeAt: 0.95,

    // Max HP is read from the screen. This is only used if it can't be read.
    maxHpFallback: 18000,
  },

  // ---- Item ids the bot uses ------------------------------------------------
  items: {
    potion: 'potion-2d',            // potion bought when restocking in 'level' mode
    teleport: 'crystal-teleport',
    fullHeal: 'crystal-heal',
    instant: 'instant-2',           // instant heal potion bought in 'secret' mode
  },

  // ---- Mode 'level': quests -> story -> grind -> floor bosses ---------------
  level: {
    targetLevel: 80,     // stop when this level is reached
    maxFloor: 40,        // never go above this floor
    bossMargin: 2,       // only fight a floor boss when it is at least this many levels below you
    bossStartHp: 0.97,   // only start a floor boss at this HP fraction or more
    potionMin: 100,      // restock potions when you have fewer than this...
    potionBuy: 300,      // ...and buy this many
  },

  // ---- Mode 'farm': repeat bosses until you own enough of each drop -------
  farm: {
    minHp: 0.80,         // only start a boss fight at this HP fraction or more
    priorityFloor: 32,   // when several bosses are ready, do this floor first
    // f    = floor of the boss
    // id   = item id of the drop you want (counts inventory + equipped gear)
    // need = stop farming this boss when you own this many
    // name = only a label for the status line
    targets: [
      { f: 32, id: 'boss-f32',   name: '晶心戒指',         need: 10 },
      { f: 35, id: 'boss-f35',   name: '冰霜頭虧',         need: 3 },
      { f: 36, id: 'boss-f36',   name: '胡郎巨腐',         need: 3 },
      { f: 38, id: 'boss-f38-b', name: '德古拉拿鐵的鎧假', need: 3 },
      { f: 39, id: 'boss-f39-b', name: '荊棘女王的跑邪',   need: 3 },
    ],
  },

  // ---- Mode 'secret': EXP farm in the secret area ---------------------------
  // The secret area gives a miasma debuff: +15 % damage taken per 20 minutes inside.
  // The timer only resets while standing in the town of that floor, so the bot walks
  // to town every `resetEveryMin` minutes and comes straight back.
  secret: {
    floor: 40,
    area: 'f40-secret',
    town: 'f40-town',
    pathToTown: ['f40-field', 'f40-outskirts', 'f40-town'],  // walked in this order from the secret area
    pathToSecret: ['f40-field', 'f40-secret'],               // walked in this order from town
    nextToSecret: ['f40-depths'],                            // areas that connect straight to the secret area
    resetEveryMin: 15,   // go reset the miasma after this many minutes inside
    restAt: 0.70,        // when in town, wait until HP is at least this fraction
    targetLevel: 70,     // stop when this level is reached
    instantMin: 500,     // restock the instant potion when you have fewer than this...
    instantRestockTo: 3000, // ...up to this many
    shopFloor: 16,       // floor whose town shop sells the instant potion
  },

  // ---- Skill cycler ---------------------------------------------------------
  // In normal fights it reorders your skill slots so the best READY skill is first.
  // Only skills listed here are moved; other skills in your slots keep any leftover slots.
  cycler: {
    useIn: ['secret'],   // modes that use it, e.g. ['secret', 'level']; [] = off
    // Higher score = preferred. Rough damage per cast including splash.
    // Put your own skill ids here.
    score: {
      'dynamic-smash': 17.5, annihilation: 15, earthquake: 13,
      'grand-destruct': 8.2, rampage: 5.9, lumber: 3.85, whirlwind: 3.8,
    },
  },
};

// =============================================================================
//  2. Game data (change only if the game itself changes)
// =============================================================================
const GAME = {
  // Monster level offset of each area type, on top of the floor's base level.
  areaOffset: { field: 1, outskirts: 1, depths: 3, labyrinth: 4, wilds: 4 },
  bossOffset: 6,   // floor boss level = floor base level + 6
  // Monster / quest id letter -> area type, e.g. 'f12-c-...' lives in f12-labyrinth.
  letterArea: { a: 'field', b: 'field', e: 'wilds', f: 'wilds', g: 'wilds', r: 'wilds',
                c: 'labyrinth', d: 'labyrinth', h: 'depths', i: 'depths', j: 'outskirts', k: 'outskirts' },
};

// =============================================================================
//  3. Connection: hook the page's WebSocket and mirror the game state
// =============================================================================
const sleep = ms => new Promise(r => setTimeout(r, ms));
const B = (window.__bot = window.__bot || {});
B.cfg = CONFIG;
B.mode = 'none';
B.log = B.log || [];
B.pending = B.pending || {};          // command id -> resolve function
B.nextId = B.nextId || 960000;
B.questsAccepted = B.questsAccepted || {};   // floor -> 1 once we accepted its quests
B.bossRetryAt = B.bossRetryAt || {};         // floor -> time we may try its boss again
B.questProgress = {};

B.note = text => {
  B.log.push(new Date().toTimeString().slice(0, 8) + ' ' + text);
  if (B.log.length > 300) B.log.shift();
};

// Apply a state patch from the server: each op is [path, value] (or [path] = delete).
B.applyPatch = ops => {
  for (const op of ops) {
    const [path, value] = op;
    let obj = B.S;
    for (let i = 0; i < path.length - 1; i++) {
      if (obj[path[i]] == null) obj[path[i]] = {};
      obj = obj[path[i]];
    }
    const last = path[path.length - 1];
    if (op.length < 2) delete obj[last]; else obj[last] = value;
  }
};

B.onMessage = e => {
  let msg;
  try { msg = JSON.parse(e.data); } catch (_) { return; }
  if (msg.t === 'init') B.S = structuredClone(msg.state);
  else if (msg.t === 'patch' && B.S) B.applyPatch(msg.ops || []);
  if (msg.id != null && B.pending[msg.id]) { B.pending[msg.id](msg); delete B.pending[msg.id]; }
};
B.handler = B.onMessage;   // name used by older versions of this script

// Wrap WebSocket.send so the first time the page sends on /api/ws we grab that socket.
if (!B.hooked) {
  B.hooked = true;
  const originalSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (this.url.includes('/api/ws') && !this.__bh) {
      this.__bh = true;
      B.ws = this;
      this.addEventListener('message', e => B.onMessage(e));
      this.addEventListener('close', () => B.note('ws closed'));
    }
    return originalSend.call(this, data);
  };
}

// Send a game command and wait (max 8 s) for the reply.
B.cmd = cmd => {
  if (!B.ws || B.ws.readyState !== WebSocket.OPEN) return Promise.resolve({ error: 'noSocket' });
  const id = ++B.nextId;
  B.ws.send(JSON.stringify({ t: 'cmd', id, cmd }));
  return new Promise(resolve => {
    B.pending[id] = resolve;
    setTimeout(() => { if (B.pending[id]) { delete B.pending[id]; resolve({ timeout: true }); } }, 8000);
  });
};
const ok = r => !!(r && r.result && r.result.ok);
const failed = r => !!(r && r.result && !r.result.ok);

// =============================================================================
//  4. Helpers
// =============================================================================
B.P = () => B.S.player;
const act = p => (p.activity && p.activity.type) || 'idle';
const hasEnemies = p => (p.enemies || []).length > 0;
const isTown = area => (area || '').endsWith('-town');

B.inv = id => B.P().inventory[id] || 0;
B.potions = () => Object.entries(B.P().inventory)
  .filter(([id]) => id.startsWith('potion-')).reduce((sum, [, n]) => sum + n, 0);
// Copies of an item you own, counting equipped gear.
B.cnt = id => { const p = B.P(); return B.inv(id) + Object.values(p.gear || {}).filter(g => g.base === id).length; };

B.baseLv = f => Math.round(1 + (f - 1) * 1.25);          // base monster level of floor f
B.fl = area => +area.match(/^f(\d+)/)[1];                 // 'f12-field' -> 12
B.town = f => `f${f}-town`;
B.areaLv = area => B.baseLv(B.fl(area)) + (GAME.areaOffset[area.split('-')[1]] ?? 9);
B.monArea = id => {                                       // 'f12-c' -> 'f12-labyrinth'
  const m = (id || '').match(/^f(\d+)-([a-z0-9]+)$/);
  return m && GAME.letterArea[m[2]] ? `f${m[1]}-${GAME.letterArea[m[2]]}` : null;
};
B.topFloor = () => Math.min(B.cfg.level.maxFloor, Math.max(...B.P().clearedFloors) + 1);

B.readMaxHp = () => {
  const m = document.body.innerText.match(/HP\s*\n\s*([\d,]+)\s*\/\s*([\d,]+)/);
  if (m) B.maxHp = +m[2].replace(/,/g, '');
  return B.maxHp || B.cfg.heal.maxHpFallback;
};

const stopHunting = async () => { if (act(B.P()) === 'hunting') await B.cmd({ type: 'stopHunt' }); };

// Walk to an area. Goes through the town when the area is not adjacent.
B.goTo = async area => {
  for (let i = 0; i < 12 && B.P().areaId !== area; i++) {
    const r = await B.cmd({ type: 'travel', areaId: area });
    await sleep(1800);
    if (!failed(r)) continue;
    const err = r.result.error;
    if (err === 'bossNoMove') return false;
    if (err === 'tooFast') { await sleep(1500); continue; }
    if (err === 'notAdjacent') {
      const cur = B.P().areaId;
      const targetTown = B.town(B.fl(area));
      const curTown = /^f\d+/.test(cur) ? B.town(B.fl(cur)) : null;
      const via = (curTown && cur !== curTown && B.fl(cur) === B.fl(area)) ? curTown
                : (cur !== targetTown ? targetTown : null);
      if (via) { await B.cmd({ type: 'travel', areaId: via }); await sleep(2200); }
    } else B.note('travel fail ' + area + ' ' + err);
  }
  return B.P().areaId === area;
};

// Walk a fixed list of areas one by one.
B.hop = async path => {
  for (const area of path) {
    for (let i = 0; i < 6 && B.P().areaId !== area; i++) {
      const r = await B.cmd({ type: 'travel', areaId: area });
      await sleep(2200);
      if (failed(r) && r.result.error !== 'tooFast') B.note('hop fail ' + area + ' ' + r.result.error);
    }
    if (B.P().areaId !== area) return false;
  }
  return true;
};

// Go to an area and start hunting there.
B.hunt = async area => {
  if (B.P().areaId !== area) { await stopHunting(); if (!(await B.goTo(area))) return; }
  const p = B.P();
  if (act(p) !== 'hunting' && !hasEnemies(p)) {
    const r = await B.cmd({ type: 'startHunt' });
    if (failed(r)) B.note('startHunt fail ' + r.result.error);
  }
};

// Highest-level area whose monsters are still below your level.
B.bestArea = onlyFloor => {
  const p = B.P();
  let best = null;
  for (let f = onlyFloor || 1; f <= (onlyFloor || B.topFloor()); f++) {
    for (const kind of Object.keys(GAME.areaOffset)) {
      const lv = B.baseLv(f) + GAME.areaOffset[kind];
      if (lv < p.level && (!best || lv > best.lv || (lv === best.lv && kind === 'labyrinth'))) best = { id: `f${f}-${kind}`, lv, f };
    }
  }
  return best;
};

// =============================================================================
//  5. Safety: heal / teleport (every 0.5 s, in every mode)
// =============================================================================
B.healMode = () => {
  const m = B.cfg.heal.mode;
  return m === 'auto' ? (B.mode === 'secret' ? 'crystal' : 'bot') : m;
};

B.safety = () => {
  const p = B.P(), H = B.cfg.heal, I = B.cfg.items;
  const pct = p.hp / B.readMaxHp();
  B.pct = pct;
  B.minPct = Math.min(B.minPct == null ? 1 : B.minPct, pct);
  const now = Date.now();
  const inBoss = act(p) === 'boss';
  const inTown = isTown(p.areaId);
  const inFight = hasEnemies(p) || inBoss;
  const mode = B.healMode();
  if (mode === 'off') return;

  if (mode === 'crystal') {
    if (pct < H.crystalAt && !inTown && now - (B.tpAt || 0) > 3000) {
      B.tpAt = now;
      if (B.inv(I.fullHeal) > 0) { B.note('CRYSTAL-HEAL ' + Math.round(pct * 100)); B.cmd({ type: 'use', itemId: I.fullHeal }); }
      else if (B.inv(I.teleport) > 0) { B.note('TELEPORT (no heal crystal) ' + Math.round(pct * 100)); B.cmd({ type: 'use', itemId: I.teleport }); }
    }
    return;
  }

  const T = inBoss ? H.boss : H;
  if (pct < T.teleportAt && !inTown && now - (B.tpAt || 0) > 4000 && B.inv(I.teleport) > 0) {
    B.tpAt = now; B.note('TELEPORT ' + Math.round(pct * 100));
    B.cmd({ type: 'use', itemId: I.teleport });
  } else if (pct < T.emergencyAt && (p.instantCdMs || 0) <= 0 && now - (B.emAt || 0) > 2500 && inFight) {
    B.emAt = now; B.note('EMERGENCY ' + Math.round(pct * 100));
    B.cmd({ type: 'emergency' });
  } else if (pct < T.potionAt && !inTown && inFight && now - (B.drAt || 0) > 1500) {
    B.drAt = now; B.note('POTION ' + Math.round(pct * 100));
    B.cmd({ type: 'drink', kind: 'potion' });
  }
};

// =============================================================================
//  6. Mode 'level': quests first, then story, then grind / floor bosses
// =============================================================================
B.restockPotions = async () => {
  const L = B.cfg.level;
  B.note('restock');
  await B.cmd({ type: 'stopHunt' });
  // Try towns from the highest floor down until one sells the potion.
  for (let f = Math.max(...B.P().clearedFloors) + 1; f > 1; f--) {
    if (!(await B.goTo(B.town(f)))) continue;
    await sleep(800);
    const r = await B.cmd({ type: 'buy', itemId: B.cfg.items.potion, qty: L.potionBuy });
    B.note('buy f' + f + ' ' + JSON.stringify(r.result));
    if (ok(r)) return;
  }
  B.noShopUntil = Date.now() + 10 * 60 * 1000;   // nothing found: don't retry for 10 min
};

// ---- Quests ----
B.qFloor = id => { const m = id.match(/^f(\d+)-/); return m ? +m[1] : null; };
// Area where a quest's monsters live. Generic quests rotate through safe areas every 4 min.
B.qArea = id => {
  const m = id.match(/^f(\d+)-([a-z])-/);
  if (m && GAME.letterArea[m[2]]) return `f${m[1]}-${GAME.letterArea[m[2]]}`;
  const f = B.qFloor(id);
  if (!f) return null;
  const kinds = ['field', 'outskirts', 'wilds', 'labyrinth', 'depths']
    .filter(k => B.baseLv(f) + GAME.areaOffset[k] < B.P().level);
  if (!kinds.length) return null;
  return `f${f}-${kinds[Math.floor(Date.now() / 240000) % kinds.length]}`;
};
B.safeQ = id => { const a = B.qArea(id); return !!a && B.areaLv(a) < B.P().level; };

B.questStep = async () => {
  const p = B.P(), quests = p.quests || {}, ids = Object.keys(quests), now = Date.now();

  // Abandon quests that are too dangerous.
  for (const id of ids) if (!B.safeQ(id)) {
    B.note('abandon ' + id);
    await stopHunting();
    await B.goTo(B.town(B.fl(p.areaId)));
    await B.cmd({ type: 'abandonQuest', questId: id });
    return;
  }

  // Track progress; a quest whose counter hasn't moved for 60 s is probably done.
  for (const id of ids) {
    const e = B.questProgress[id];
    if (!e || e.n !== quests[id]) B.questProgress[id] = { n: quests[id], t: now };
  }
  const stale = ids.filter(id => now - B.questProgress[id].t > 60000 && now - (B.qTry || 0) > 100000);
  if (stale.length) {
    B.qTry = now;
    await stopHunting();
    await B.goTo(B.town(B.fl(B.qArea(stale[0]))));
    for (const id of stale) {
      const r = await B.cmd({ type: 'completeQuest', questId: id });
      B.note('complete ' + id + ' ' + JSON.stringify(r.result));
      B.questProgress[id] = { n: quests[id], t: Date.now() };
    }
    return;
  }

  const id = ids.find(i => /bounty/.test(i)) || ids[0];   // bounties first
  return B.hunt(B.qArea(id));
};

// ---- Story: goals are read out of the game's own JavaScript bundle ----
B.loadGoals = async () => {
  const src = [...document.scripts].map(s => s.src).find(s => /main-/.test(s));
  const text = await (await fetch(src)).text();
  const G = {};
  let chapter = null;
  const re = /Y\("(\w+)",\d+|\{id:"(\w+)",floor:\d+,needFloor|goal:\{([^{}]*)\}/g;
  re.lastIndex = Math.max(0, text.indexOf('Y("s1"'));
  let x;
  while ((x = re.exec(text))) {
    if (x[1] || x[2]) { chapter = x[1] || x[2]; G[chapter] = G[chapter] || []; continue; }
    if (!chapter) continue;
    const g = x[3];
    const get = rx => (g.match(rx) || [])[1];
    const kind = get(/kind:"(\w+)"/);
    const ar = g.match(/areaId:(?:"([^"]+)"|\w+\((\d+)\))/) || [];
    const area = ar[1] || (ar[2] ? B.town(ar[2]) : null);
    const goals = {
      visit:   { k: 'visit', a: area },
      kill:    { k: 'kill', a: B.monArea(get(/monsterId:"([^"]+)"/)) },
      collect: { k: 'collect', a: B.monArea(get(/from:"([^"]+)"/)) },
      boss:    { k: 'boss', f: +(get(/floor:(\d+)/) || 0) },
      fight:   { k: 'fight', a: area },
      level:   { k: 'level', lv: +(get(/level:(\d+)/) || 0) },
    };
    G[chapter].push(goals[kind] || { k: '?' });
  }
  B.G = G;
  B.note('goals ' + Object.keys(G).length + ' chapters');
};

// True when the bot can't (or shouldn't) do this story goal yet.
B.blocked = (g, p) => {
  if (!g || g.k === '?' || g.k === 'fight') return true;
  if (g.k === 'level') return p.level < g.lv;
  if (g.k === 'boss') return B.baseLv(g.f) + GAME.bossOffset > p.level - B.cfg.level.bossMargin;
  if (g.k === 'visit') return !g.a;
  if (g.k === 'kill' || g.k === 'collect') return g.a ? B.areaLv(g.a) >= p.level : false;
  return true;
};

B.storyStep = async () => {
  const p = B.P(), s = p.story;
  if (!s) { B.phase = 'grind'; return; }
  const g = (B.G[s.ch] || [])[s.step];
  const key = s.ch + ':' + s.step;
  if (key !== B.lastKey) { B.lastKey = key; B.visitTries = 0; B.note('story ' + key + ' ' + JSON.stringify(g)); }
  if (B.blocked(g, p) || g.k === 'level' || g.k === 'boss') { B.phase = 'grind'; return; }

  if (g.k === 'visit') {
    await stopHunting();
    await B.goTo(g.a);
    await sleep(1500);
    const now = B.P().story || {};
    if (now.step === s.step && now.ch === s.ch && ++B.visitTries > 4) {   // stuck: claim manually
      B.note('claimAll ' + JSON.stringify((await B.cmd({ type: 'storyClaimAll' })).result));
      B.visitTries = 0;
    }
    return;
  }
  if (g.a) return B.hunt(g.a);
  const best = B.bestArea();
  if (best) return B.hunt(best.id);
};

// ---- Grind: accept quests on every floor, beat the next floor boss, hunt ----
B.grindStep = async () => {
  const p = B.P(), L = B.cfg.level, top = B.topFloor();
  const s = p.story, g = s ? (B.G[s.ch] || [])[s.step] : null;
  if (g && g.k !== 'boss' && !B.blocked(g, p)) { B.phase = 'story'; return; }

  // Accept all quests once on every reachable floor.
  const f = Array.from({ length: top }, (_, i) => i + 1).find(x => !B.questsAccepted[x]);
  if (f) {
    await stopHunting();
    if (!(await B.goTo(B.town(f)))) return;
    B.questsAccepted[f] = 1;
    const r = await B.cmd({ type: 'acceptAllQuests' });
    B.note('accept f' + f + ' ' + JSON.stringify(r.result));
    return;
  }

  // Challenge the next floor boss when it is weak enough and HP is full.
  const bossLv = B.baseLv(top) + GAME.bossOffset;
  if (!p.clearedFloors.includes(top) && bossLv <= p.level - L.bossMargin && B.pct > L.bossStartHp
      && !hasEnemies(p) && Date.now() > (B.bossRetryAt[top] || 0)) {
    await stopHunting();
    await sleep(1500);
    if (B.pct < L.bossStartHp) return;
    if (!(await B.goTo('f' + top + '-bossroom'))) return;
    const r = await B.cmd({ type: 'challengeBoss' });
    B.note('boss f' + top + ' ' + JSON.stringify(r.result));
    if (failed(r)) B.bossRetryAt[top] = Date.now() + 120000;
    await sleep(3000);
    return;
  }

  const best = B.bestArea();
  if (best) return B.hunt(best.id);
};

B.levelStep = async () => {
  if (B.mode !== 'level' || B.busy || !B.S) return;
  B.busy = true;
  try {
    const p = B.P(), H = B.cfg.heal;
    if (p.dead) { B.note('DEAD'); B.mode = 'none'; return; }
    if (p.level >= B.cfg.level.targetLevel) { B.note('target reached'); B.mode = 'none'; await B.cmd({ type: 'stopHunt' }); return; }
    if (B.lastLv && p.level !== B.lastLv) B.note('LEVEL UP ' + p.level);
    B.lastLv = p.level;
    if (act(p) === 'boss') return;
    if (p.storyCard) { await B.cmd({ type: 'storyCardSeen' }); await sleep(1200); }
    // Just teleported: rest until HP is back.
    if (Date.now() - (B.tpAt || 0) < H.afterTeleportWaitMs && B.pct < H.resumeAt) {
      if (act(p) === 'hunting' && !hasEnemies(p)) await B.cmd({ type: 'stopHunt' });
      return;
    }
    if (B.potions() < B.cfg.level.potionMin && Date.now() > (B.noShopUntil || 0)) { await B.restockPotions(); return; }
    if (Object.keys(p.quests || {}).length) return B.questStep();
    if (B.phase === 'story') return B.storyStep();
    return B.grindStep();
  } catch (e) { B.note('level err ' + e); } finally { B.busy = false; }
};

// =============================================================================
//  7. Mode 'farm': repeat bosses for their drops (uses the game's boss cooldowns)
// =============================================================================
B.farmState = B.farmState || { next: {}, runs: {}, fails: 0 };
B.farmStatus = () => B.cfg.farm.targets
  .map(t => `${t.name} ${B.cnt(t.id)}/${t.need} (f${t.f} runs ${B.farmState.runs[t.f] || 0})`).join('; ');

B.farmStep = async () => {
  if (B.mode !== 'farm' || B.farmBusy || !B.S) return;
  B.farmBusy = true;
  try {
    const F = B.cfg.farm, st = B.farmState, p = B.P();
    if (p.dead) { B.mode = 'none'; B.note('FARM stop: dead'); return; }
    if (act(p) === 'boss') return;

    const left = F.targets.filter(t => B.cnt(t.id) < t.need);
    if (!left.length) { B.mode = 'none'; B.note('FARM DONE ' + B.farmStatus()); await B.cmd({ type: 'stopHunt' }); return; }

    const now = Date.now(), cd = p.bossCd || {};
    const ready = left.filter(t => (cd[t.f] || 0) <= 0 && now >= (st.next[t.f] || 0));
    if (!ready.length) {   // nothing ready: hunt until a boss cooldown ends
      const cur = B.P();
      if (act(cur) !== 'hunting' && !isTown(cur.areaId) && !/bossroom/.test(cur.areaId)) await B.cmd({ type: 'startHunt' });
      else if (act(cur) !== 'hunting') { const best = B.bestArea(); if (best) await B.hunt(best.id); }
      return;
    }

    const t = ready.find(x => x.f === F.priorityFloor) || ready[0];
    if (B.pct < F.minHp || hasEnemies(p)) {   // let HP recover / finish the current fight
      await stopHunting();
      await sleep(3000);
      if (B.pct < F.minHp || hasEnemies(B.P())) return;
    }
    await stopHunting();
    await sleep(800);
    if (B.fl(B.P().areaId) !== t.f) {
      const g = await B.cmd({ type: 'gate', floor: t.f });
      B.note('gate f' + t.f + ' ' + JSON.stringify(g.result));
      await sleep(2500);
    }
    if (!(await B.goTo('f' + t.f + '-bossroom'))) { st.next[t.f] = Date.now() + 15000; return; }

    const r = await B.cmd({ type: 'challengeBoss' });
    st.runs[t.f] = (st.runs[t.f] || 0) + 1;
    B.note('FARM boss f' + t.f + ' ' + JSON.stringify(r.result));
    if (!ok(r)) { st.next[t.f] = Date.now() + 20000; st.fails++; return; }
    st.next[t.f] = Date.now() + 8000;
    await sleep(4000);
  } catch (e) { B.note('farm err ' + e); } finally { B.farmBusy = false; }
};

// =============================================================================
//  8. Mode 'secret': EXP farm in the secret area with miasma reset trips
// =============================================================================
// Time spent in miasma. It counts up inside the secret area and resets in the town.
B.miasmaMs = () => {
  const p = B.P();
  return (p.miasmaMs || 0) + (p.miasmaSince != null ? Math.max(0, B.S.time - p.miasmaSince) : 0);
};
B.secretTrips = B.secretTrips || 0;

B.restockInstant = async () => {
  const S = B.cfg.secret, id = B.cfg.items.instant;
  B.note('RESTOCK ' + id + ' -> ' + S.instantRestockTo);
  await B.cmd({ type: 'stopHunt' });
  await sleep(800);
  if (!isTown(B.P().areaId) && !(await B.hop(S.pathToTown))) return false;
  // The floor gate only works from a town.
  if (B.fl(B.P().areaId) !== S.shopFloor) { await B.cmd({ type: 'gate', floor: S.shopFloor }); await sleep(2500); }
  if (B.P().areaId !== B.town(S.shopFloor)) return false;
  let left = S.instantRestockTo - B.inv(id);
  while (left > 0) {   // the shop sells at most 500 per purchase
    const qty = Math.min(500, left);
    if (!ok(await B.cmd({ type: 'buy', itemId: id, qty }))) break;
    left -= qty;
    await sleep(600);
  }
  await B.cmd({ type: 'gate', floor: S.floor });
  await sleep(2500);
  return true;
};

B.secretStep = async () => {
  if (B.mode !== 'secret' || B.secBusy || !B.S) return;
  const S = B.cfg.secret, p = B.P();
  if (p.level >= S.targetLevel) { B.mode = 'none'; B.note('SECRET target reached'); await B.cmd({ type: 'stopHunt' }); return; }
  B.secBusy = true;
  try {
    if (p.dead) { B.mode = 'none'; B.note('SECRET stop: dead'); return; }
    if (act(p) === 'boss') return;

    if (B.inv(B.cfg.items.instant) < S.instantMin && Date.now() > (B.noInstantShopUntil || 0)) {
      const done = await B.restockInstant();
      if (!done || B.inv(B.cfg.items.instant) < S.instantMin) B.noInstantShopUntil = Date.now() + 10 * 60 * 1000;
      return;
    }

    const cur = p.areaId;
    if (cur === S.area) {
      if (B.miasmaMs() >= S.resetEveryMin * 60 * 1000) {   // time to reset the miasma
        B.note('SECRET miasma reset trip');
        await B.cmd({ type: 'stopHunt' });
        await sleep(800);
        await B.hop(S.pathToTown);
        B.secretTrips++;
        return;
      }
      if (act(p) !== 'hunting' && !hasEnemies(p)) await B.cmd({ type: 'startHunt' });
      return;
    }

    if (isTown(cur) && B.pct < S.restAt) { await sleep(3000); return; }   // rest in town

    await B.cmd({ type: 'stopHunt' });
    const path = S.nextToSecret.includes(cur) ? [S.area] : S.pathToSecret;
    if (await B.hop(path)) { await B.cmd({ type: 'startHunt' }); B.note('SECRET back in secret area'); }
  } catch (e) { B.note('secret err ' + e); } finally { B.secBusy = false; }
};

// =============================================================================
//  9. Skill cycler: put the best READY skill in slot 1 (normal fights only;
//     switching slots is instant outside boss fights and resets the rotation)
// =============================================================================
B.cyc = B.cyc || { last: 0, swaps: 0 };
B.cycStep = async () => {
  const C = B.cyc, cfg = B.cfg.cycler;
  if (!cfg.useIn.includes(B.mode) || C.busy || !B.S) return;
  const p = B.P();
  if (act(p) !== 'hunting' || !hasEnemies(p) || p.cast || p.swap) return;
  const now = Date.now();
  if (now - C.last < 1100) return;
  C.busy = true;
  try {
    const cds = p.skillCooldowns || {}, score = cfg.score, slots = p.skillSlots;
    const known = Object.keys(score).filter(k => p.learnedSkills.includes(k));
    const ready = known.filter(k => (cds[k] || 0) <= 250).sort((a, b) => score[b] - score[a]);
    if (!ready.length) return;
    const waiting = known.filter(k => !ready.includes(k)).sort((a, b) => (cds[a] || 0) - (cds[b] || 0));
    const others = slots.filter(k => !known.includes(k));   // skills not in the score list stay
    const want = [...ready, ...waiting, ...others].slice(0, slots.length);
    if (want.join() === slots.join()) return;
    C.last = now;
    if (ok(await B.cmd({ type: 'setSkillSlots', skillIds: want }))) C.swaps++;
  } finally { C.busy = false; }
};

// =============================================================================
// 10. Controls, status, timers, start-up
// =============================================================================
const MODES = ['level', 'farm', 'secret'];
B.start = mode => {
  if (!MODES.includes(mode)) return `unknown mode "${mode}". Use one of: ${MODES.join(', ')}`;
  if (!B.S) return 'no game state yet, wait a few seconds and try again';
  B.mode = mode;
  if (mode === 'level') B.phase = 'grind';
  B.note('START ' + mode);
  return window.__bot_status();
};
B.stop = () => { const was = B.mode; B.mode = 'none'; B.note('STOP ' + was); return 'stopped (' + was + ')'; };

window.__bot_status = () => {
  if (!B.S) return 'BOT MISSING (no game state)';
  const p = B.P();
  const s = {
    mode: B.mode, heal: B.healMode(), lv: p.level, cleared: Math.max(...p.clearedFloors),
    area: p.areaId, act: act(p), hp: Math.round((B.pct || 0) * 100), minHp: Math.round((B.minPct || 0) * 100),
    potions: B.potions(),
  };
  if (B.mode === 'farm') s.farm = B.farmStatus();
  if (B.mode === 'secret') Object.assign(s, {
    miasmaMin: Math.round(B.miasmaMs() / 60000), trips: B.secretTrips, instant: B.inv(B.cfg.items.instant), swaps: B.cyc.swaps });
  s.log = B.log.slice(-4);
  return JSON.stringify(s);
};

// Stop timers left over from an earlier paste (this version and older ones).
for (const t of Object.values(B.timers || {})) clearInterval(t);
for (const k of ['safetyIv', 'stepIv', 'noReload', 'farmIv', 'secIv', 'cycIv']) if (B[k]) { clearInterval(B[k]); B[k] = null; }
for (const k of ['running', 'farm', 'sec']) delete B[k];   // old on/off switches, replaced by B.mode

B.timers = {
  safety: setInterval(() => { try { if (B.S) B.safety(); } catch (_) {} }, 500),
  level:  setInterval(() => B.levelStep(), 2000),
  farm:   setInterval(() => B.farmStep(), 3000),
  secret: setInterval(() => B.secretStep(), 3000),
  cycler: setInterval(() => B.cycStep(), 500),
  // Strip the "reload" flag from server params messages so the page doesn't reload.
  noReload: setInterval(() => {
    try {
      const ws = B.ws;
      if (!B.cfg.blockReload || !ws || ws.__nr || typeof ws.onmessage !== 'function') return;
      const orig = ws.onmessage;
      ws.__nr = 1;
      ws.onmessage = function (e) {
        try {
          if (B.cfg.blockReload && typeof e.data === 'string' && e.data.indexOf('"reload"') >= 0) {
            const m = JSON.parse(e.data);
            if (m.t === 'params' && m.reload) {
              delete m.reload;
              B.note('blocked reload');
              return orig.call(this, new MessageEvent('message', { data: JSON.stringify(m) }));
            }
          }
        } catch (_) {}
        return orig.call(this, e);
      };
    } catch (_) {}
  }, 1000),
};
B.phase = 'grind';

await B.loadGoals();

// No state yet: wait for the page's socket, then close it once so the game
// reconnects and re-sends its full state (which we then catch).
if (!B.S) {
  for (let i = 0; i < 60 && !B.ws; i++) await sleep(500);
  if (!B.ws) return 'bot installed, but the game socket was not seen yet. Click anything in the game, then run: __bot.ws.close()';
  B.ws.close();
  B.note('bootstrap: ws closed to resync');
  for (let i = 0; i < 60 && !B.S; i++) await sleep(500);
  if (!B.S) return 'bot installed, but no state arrived yet. Wait a few seconds, then run __bot_status()';
}

if (MODES.includes(CONFIG.autostart)) B.start(CONFIG.autostart);
return 'bot installed' + (B.mode !== 'none' ? ', started mode: ' + B.mode : ' (idle, run __bot.start("level") etc.)')
  + ' | ' + window.__bot_status();
})();

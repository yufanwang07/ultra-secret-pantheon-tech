// ==UserScript==
// @name         ultra secret pantheon tech
// @namespace    prominence-chan/cambc
// @version      2026-10-30.1
// @description  Detects champion kills in Cambridge Battlecode replays (credited to the champion that landed the last hit, League-style execute assists), shows League kill banners with the champions' art plus a kill feed, and plays the League of Legends announcer with every take of each line: first blood, slain, double..hexa (45-round decay; Cassi & Issac dying together count as two), ace, victory/defeat. Works in the platform visualiser and the local `cambc view`, on engine v1 and v2 replays.
// @match        https://2026a.battlecode.co.uk/service/tools/visualiser/*
// @match        https://*.battlecode.co.uk/service/tools/visualiser/*
// @match        http://127.0.0.1:*/*
// @match        http://localhost:*/*
// @updateURL    https://raw.githubusercontent.com/yufanwang07/ultra-secret-pantheon-tech/main/ultra_secret_pantheon_tech.user.js
// @downloadURL  https://raw.githubusercontent.com/yufanwang07/ultra-secret-pantheon-tech/main/ultra_secret_pantheon_tech.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==
// Created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games.
// Riot Games does not endorse or sponsor this project. Free and non-commercial.

(function () {
    // a second installed copy of this script would double every line: only the first one to load runs
    if (window.__cbcAnnouncerLoaded) return;
    window.__cbcAnnouncerLoaded = true;
    'use strict';

    const MY_TEAM_NAME = 'Pantheon'; // fallback when the platform can't tell us which team is ours
    const MULTIKILL_WINDOW = 15;     // rounds between kills to keep a multikill going
    const ASSIST_WINDOW = 30;        // a camp/monster kill goes to the last enemy champion that hit the victim this many rounds before
    const MAX_FORWARD_ROUNDS = 3;    // bigger jumps than this between frames count as a seek (no announcements)
    const MAX_PLAY_ROUNDS = 40;      // ... unless the viewer is playing: then forward jumps up to this are still playback
    const STALE_MS = 9000;
    const BANNER_MIN_MS = 1700;  // a banner stays up at least this long before the next line replaces it
    const LINE_GAP_MS = 250;     // breath between lines           // drop queued lines that are older than this (fast playback)
    const LS = 'cbc-announcer:';

    // --- announcer lines: League wiki, classic female announcer (CORS: *) -------------------
    // Every take the wiki has for each line (Announcer/Classic), plus the same voice's spectator lines
    // ("Blue team double kill!", "A champion has been slain.") mixed in; `blue`/`red` takes are used when the
    // team the line is about has that colour in the viewer (engine team 0 = blue, 1 = red).
    const WIKI = 'https://wiki.leagueoflegends.com/en-us/images/Announcer_Female1_';
    const T = (id, text) => ({ id, text });
    const slain = [T('009', 'A champion has been slain.'), T('010', 'A champion has been slain.'), T('011', 'A champion has been slain.')];
    const LINES = {
        firstBlood: { banner: 'First Blood', takes: [T('052', 'First blood!')] },
        enemySlain: { banner: 'An enemy has been slain', takes: [T('014', 'An enemy has been slain.'), T('015', 'An enemy has been slain.'), T('016', 'An enemy has been slain.')], spec: slain },
        allySlain: { banner: 'An ally has been slain', takes: [T('012', 'An ally has been slain.'), T('013', 'An ally has been slain.')], spec: slain },
        shutdown: { banner: 'Shutdown', takes: [T('054', 'Shutdown!'), T('055', 'Shutdown!')] },
        killingSpree: { banner: 'Killing Spree', takes: [T('059', 'Killing spree!'), T('060', 'Killing spree!')] },
        rampage: { banner: 'Rampage', takes: [T('064', 'Rampage!'), T('065', 'Rampage!')] },
        unstoppable: { banner: 'Unstoppable', takes: [T('070', 'Unstoppable!')] },
        dominating: { banner: 'Dominating', takes: [T('073', 'Dominating!')] },
        godlike: { banner: 'Godlike', takes: [T('078', 'Godlike!'), T('079', 'Godlike!')] },
        legendary: { banner: 'Legendary', takes: [T('084', 'Legendary!'), T('085', 'Legendary!'), T('086', 'Legendary!')] },
        enemyKillingSpree: { banner: 'Enemy Killing Spree', takes: [T('056', 'Enemy killing spree!'), T('057', 'Enemy killing spree!')] },
        enemyRampage: { banner: 'Enemy Rampage', takes: [T('061', 'Enemy rampage!')] },
        enemyUnstoppable: { banner: 'An enemy is unstoppable', takes: [T('066', 'An enemy is unstoppable!'), T('067', 'An enemy is unstoppable!')] },
        enemyDominating: { banner: 'An enemy is dominating', takes: [T('071', 'An enemy is dominating!')] },
        enemyGodlike: { banner: 'An enemy is godlike', takes: [T('074', 'An enemy is godlike!'), T('075', 'An enemy is godlike.')] },
        enemyLegendary: { banner: 'An enemy is legendary', takes: [T('080', 'An enemy is legendary!'), T('081', 'An enemy is legendary!')] },
        executed: { banner: 'Executed', takes: [T('021', 'Executed!'), T('022', 'Executed!'), T('023', 'Executed!')] },
        double: { banner: 'Double Kill', takes: [T('006', 'Double kill!'), T('007', 'Double kill!'), T('008', 'Double kill!')], blue: [T('141', 'Blue team double kill!')], red: [T('143', 'Red team double kill!')] },
        triple: { banner: 'Triple Kill', takes: [T('036', 'Triple kill!'), T('037', 'Triple kill!')], blue: [T('150', 'Blue team triple kill!')], red: [T('152', 'Red team triple kill!')] },
        quadra: { banner: 'Quadra Kill', takes: [T('032', 'Quadrakill!'), T('033', 'Quadrakill!')], blue: [T('147', 'Blue team quadrakill!')], red: [T('149', 'Red team quadrakill!')] },
        penta: { banner: 'Pentakill', takes: [T('029', 'Pentakill!'), T('030', 'Pentakill!')], blue: [T('144', 'Blue team pentakill!')], red: [T('146', 'Red team pentakill!')] },
        hexa: { banner: 'Hexakill', takes: [T('126', 'Hexakill!')], blue: [T('123', 'Blue team hexakill!')], red: [T('125', 'Red team hexakill!')] },
        enemyDouble: { banner: 'Enemy Double Kill', takes: [T('004', 'Enemy double kill!'), T('005', 'Enemy double kill!')], blue: [T('141', 'Blue team double kill!')], red: [T('143', 'Red team double kill!')] },
        enemyTriple: { banner: 'Enemy Triple Kill', takes: [T('034', 'Enemy triple kill!'), T('035', 'Enemy triple kill!')], blue: [T('150', 'Blue team triple kill!')], red: [T('152', 'Red team triple kill!')] },
        enemyQuadra: { banner: 'Enemy Quadra Kill', takes: [T('031', 'Enemy quadrakill!')], blue: [T('147', 'Blue team quadrakill!')], red: [T('149', 'Red team quadrakill!')] },
        enemyPenta: { banner: 'Enemy Pentakill', takes: [T('027', 'Enemy pentakill!'), T('028', 'Enemy pentakill!')], blue: [T('144', 'Blue team pentakill!')], red: [T('146', 'Red team pentakill!')] },
        enemyHexa: { banner: 'Enemy Hexakill', takes: [T('124', 'Enemy hexakill!')], blue: [T('123', 'Blue team hexakill!')], red: [T('125', 'Red team hexakill!')] },
        ace: { banner: 'Ace', takes: [T('002', 'Aced.'), T('003', 'Aced.')], blue: [T('138', 'Blue team has scored an ace!')], red: [T('140', 'Red team has scored an ace!')] },
        aced: { banner: 'Aced', takes: [T('002', 'Aced.'), T('003', 'Aced.')], blue: [T('138', 'Blue team has scored an ace!')], red: [T('140', 'Red team has scored an ace!')] },
        welcome: { banner: "Welcome to Summoner's Rift", takes: [T('117', "Welcome to Summoner's Rift!"), T('118', "Welcome to Summoner's Rift.")] },
        victory: { banner: 'Victory', takes: [T('114', 'Victory!')], blue: [T('193', 'Blue team victory!')], red: [T('195', 'Red team victory!')] },
        defeat: { banner: 'Defeat', takes: [T('051', 'Defeat!')], blue: [T('193', 'Blue team victory!')], red: [T('195', 'Red team victory!')] },
    };
    const MULTI = [null, null, 'double', 'triple', 'quadra', 'penta', 'hexa'];
    // kills without dying -> spree line (3+), as in League
    const SPREE = [null, null, null, 'killingSpree', 'rampage', 'unstoppable', 'dominating', 'godlike', 'legendary'];
    // Player mode (default): the lines a player hears. Spectator mode (toggle): the caster lines only
    // ("A champion has been slain.", "Blue team double kill!"), falling back to the player take where there's none.
    const spectatorMode = () => localStorage.getItem(LS + 'spectator') === '1';
    const takesFor = (line, team) => {
        const L = LINES[line];
        if (!spectatorMode()) return L.takes;
        const spec = L.spec ?? (team === 0 ? L.blue : team === 1 ? L.red : null);
        return spec?.length ? spec : L.takes;
    };

    // Shuffle-cycle per line: go through every take in random order, reshuffle when the bag is empty,
    // and never play the same take twice in a row.
    const bags = new Map();
    let lastSaid = null;
    function pickPlain(line) { // a player-mode take regardless of the spectator toggle
        const pool = LINES[line].takes, t = pool[Math.floor(Math.random() * pool.length)];
        return t;
    }
    function pickTake(line, team) {
        const pool = takesFor(line, team);
        const key = line + ':' + team + ':' + spectatorMode();
        let b = bags.get(key);
        if (!b) bags.set(key, b = { bag: [], last: null });
        if (!b.bag.length) {
            b.bag = pool.slice();
            for (let i = b.bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b.bag[i], b.bag[j]] = [b.bag[j], b.bag[i]]; }
            if (b.bag.length > 1 && b.bag[b.bag.length - 1].id === b.last) b.bag.unshift(b.bag.pop());
        }
        const t = b.bag.pop();
        b.last = t.id;
        return t;
    }

    // Champion entity types in the engine snapshot (Cassi & Issac are two entities).
    const CHAMPS = ['Ryth', 'Vesper Vale', 'Vendetta', 'Cassi', 'Issac', 'Stellar', 'Prism', 'Marcella', 'Willow', 'Ren', 'Varg', 'Tavi', 'Heart of Ruin'];
    const ART_KEYS = ['ryth', 'vesper_vale', 'vendetta', 'cassi', 'issac', 'stellar', 'prism', 'marcella', 'willow', 'ren', 'varg', 'tavi', 'heart_of_ruin'];
    const isDuo = t => t === 3 || t === 4;

    // --- timeline snapshot layout (Game_Visualiser_ReadTimelineState, 40152 bytes; v2 below) ---
    // Header: the step that produced this state (kind @68, actor {kind @72, index @76}); champions @196 (stride 252):
    // entity index @+4, team @+8, type @+12, health f32 @+24, alive @+32, kills @+44; spells @23764 (stride 16):
    // entity {kind, index}, owner {kind, index}. Step kinds: 5 attack, 6 ability, 3 tick. Actor kinds: 1 champion, 2 camp, 4 spell.
    // Engine v2 (42840 bytes) has the same header and champion fields, but each champion carries 84 item slots
    // instead of 42 (+168 per champion), so the champion stride grows to 420 and every table after it moves by 16 * 168.
    const SNAP = { size: 40152, round: 8, phase: 24, outcome: 28, timeline: 48, input: 56, stepKind: 68, actorKind: 72, actorIndex: 76, substep: 104, abilitySlot: 108, abilityType: 112, champCount: 172, champs: 196, stride: 252, maxChamps: 16, spellCount: 192, spells: 23764, spellStride: 16, maxSpells: 1024 };
    const SNAPS = new Map([[40152, SNAP], [42840, { ...SNAP, size: 42840, stride: 420, spells: 23764 + 2688 }]]);
    const CH = { index: 4, team: 8, type: 12, x: 16, y: 20, health: 24, alive: 32, kills: 44 };

    function decode(buffer, ptr) {
        const dv = new DataView(buffer);
        if (ptr <= 0 || ptr + 8 > buffer.byteLength) return null;
        const SNAP = SNAPS.get(dv.getUint32(ptr + 4, true));
        if (!SNAP || ptr + SNAP.size > buffer.byteLength) return null;
        const u = o => dv.getUint32(ptr + o, true);
        const n = u(SNAP.champCount);
        if (n > SNAP.maxChamps) return null;
        const champs = new Array(n);
        for (let i = 0; i < n; i++) {
            const b = SNAP.champs + i * SNAP.stride;
            champs[i] = {
                idx: u(b + CH.index), team: u(b + CH.team), type: u(b + CH.type), hp: dv.getFloat32(ptr + b + CH.health, true),
                alive: u(b + CH.alive) !== 0, kills: u(b + CH.kills),
                x: dv.getInt32(ptr + b + CH.x, true), y: dv.getInt32(ptr + b + CH.y, true),
                maxHp: dv.getFloat32(ptr + b + 28, true), gold: u(b + 36), gems: u(b + 40),
            };
        }
        // Who acted in this step; a spell entity acts for its owner.
        let actor = { kind: u(SNAP.actorKind), index: u(SNAP.actorIndex) };
        if (actor.kind === 4) {
            const ns = Math.min(u(SNAP.spellCount), SNAP.maxSpells);
            for (let i = 0; i < ns; i++) {
                const b = SNAP.spells + i * SNAP.spellStride;
                if (u(b) === 4 && u(b + 4) === actor.index) { actor = { kind: u(b + 8), index: u(b + 12) }; break; }
            }
        }
        const input = u(SNAP.input), substep = u(SNAP.substep), stepKind0 = u(SNAP.stepKind);
        // shop (13) / sell (25) steps: the buyer's inventory, a count per item id (42 ids v1, 84 v2), plus consumables
        let shopInv = null;
        if ((stepKind0 === 13 || stepKind0 === 25) && actor.kind === 1) {
            const v2 = SNAP.stride === 420, NI = v2 ? 84 : 42, xo = v2 ? 168 : 0;
            for (let i = 0; i < n; i++) { const b = SNAP.champs + i * SNAP.stride; if (u(b + CH.index) !== actor.index) continue;
                shopInv = { idx: actor.index, items: Array.from({ length: NI }, (_, k) => u(b + 48 + 4 * k)), cons: [0, 1, 2, 3].map(k => u(b + xo + 216 + 4 * k)) }; break; }
        }
        return {
            phase: u(SNAP.phase), shopInv, round: u(SNAP.round), outcome: u(SNAP.outcome), stepKind: u(SNAP.stepKind), actor, scores: [u(32), u(40)], // tributed gems per team
            slot: u(SNAP.abilitySlot), atype: u(SNAP.abilityType), // ability slot (0/1) and kind: 1 attack reset, 6 dash, ...
            timeline: dv.getBigUint64(ptr + SNAP.timeline, true), input, substep, key: input + Math.min(substep, 9999) / 1e4, champs,
        };
    }

    // Header of the full display snapshot (Game_Visualiser_ReadState): same leading fields, no champion table we rely on.
    function decodeHeader(buffer, ptr) {
        if (ptr <= 0 || ptr + 120 > buffer.byteLength) return null;
        const dv = new DataView(buffer);
        if (dv.getUint32(ptr, true) !== 1 || dv.getUint32(ptr + 4, true) < 120) return null;
        const input = dv.getUint32(ptr + SNAP.input, true), substep = dv.getUint32(ptr + SNAP.substep, true);
        return {
            round: dv.getUint32(ptr + SNAP.round, true), outcome: dv.getUint32(ptr + SNAP.outcome, true),
            timeline: dv.getBigUint64(ptr + SNAP.timeline, true), input, substep, key: input + Math.min(substep, 9999) / 1e4, champs: null,
        };
    }

    const who = c => ({ idx: c.idx, team: c.team, type: c.type, name: CHAMPS[c.type] ?? 'Champion' });

    // What happened between two consecutive snapshots: victims, who got the kill credit, aces.
    // `hits` (victim idx -> {round, by}) remembers the last enemy champion that damaged each champion, for execute assists.
    function diff(prev, cur, hits) {
        if (!prev || !cur || prev.champs.length !== cur.champs.length) return null;
        const before = new Map(prev.champs.map(c => [c.idx, c]));
        if (hits && cur.actor.kind === 1) {
            const by = cur.champs.find(c => c.idx === cur.actor.index);
            if (by) for (const c of cur.champs) {
                const p = before.get(c.idx);
                if (p?.alive && c.team !== by.team && c.hp < p.hp - 1e-3) hits.set(c.idx, { round: cur.round, by });
            }
        }
        const victims = cur.champs.filter(c => !c.alive && before.get(c.idx)?.alive);
        if (!victims.length) return null;
        const credit = cur.champs.map(c => ({ c, left: c.kills - (before.get(c.idx)?.kills ?? c.kills) })).filter(x => x.left > 0);
        const kills = [];
        const duoDone = new Set();
        for (const v of victims) {
            if (isDuo(v.type)) { if (duoDone.has(v.team)) continue; duoDone.add(v.team); }
            const k = credit.find(x => x.left > 0 && x.c.team !== v.team);
            if (k) k.left--;
            let killer = k ? who(k.c) : null, assist = false;
            if (!killer && hits) {
                // No champion got the last hit (camp/monster): League gives it to the last enemy champion that hit them recently.
                const mates = isDuo(v.type) ? cur.champs.filter(o => isDuo(o.type) && o.team === v.team) : [v];
                const h = mates.map(o => hits.get(o.idx)).filter(h => h?.by && cur.round - h.round <= ASSIST_WINDOW).sort((a, b) => b.round - a.round)[0];
                if (h) { killer = who(cur.champs.find(c => c.idx === h.by.idx) ?? h.by); assist = true; }
            }
            const both = isDuo(v.type) && victims.filter(o => isDuo(o.type) && o.team === v.team).length > 1;
            // Cassi & Issac going down together is two champions: worth two kills toward multikills and sprees.
            kills.push({ victim: { ...who(v), name: both ? 'Cassi & Issac' : CHAMPS[v.type] ?? 'Champion', duo: both }, killer, assist, worth: both ? 2 : 1 });
        }
        if (hits) for (const v of victims) hits.delete(v.idx);
        const aces = [0, 1].filter(t => victims.some(v => v.team === t) && cur.champs.some(c => c.team === t) && cur.champs.every(c => c.team !== t || !c.alive));
        return { key: cur.key, round: cur.round, kills, aces };
    }

    // --- per-replay state ------------------------------------------------------------------
    let game = null;
    function newGame(handle) {
        game = {
            handle, index: [], steps: [], stepIdx: 0, indexPrev: null, indexMaxKey: -1, mainTimeline: null, indexHits: new Map(), playHits: new Map(),
            play: null, hw: -1, ally: 0, allyKnown: false, streak: new Map(), spree: new Map(), anyKill: false, finishedAnnounced: false,
        };
        resolveAlly(game);
        fetchLocal('music/sr_victory_s4.m4a'); fetchLocal('music/sr_defeat_s4.m4a');
        feed.clear();
        art.load();
        return game;
    }

    // Which engine team is "us": the platform tells us team names per side; fall back to the left team.
    async function resolveAlly(g) {
        try {
            const m = (parent !== window ? parent.location.pathname : location.pathname).match(/\/visualiser\/([0-9a-f-]{36})/i);
            if (!m) return;
            const [nav, me] = await Promise.all([
                fetch(`/api/v1/match-groups/for-match/${m[1]}`, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null),
                fetch('/api/v1/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null),
            ]);
            const n = nav?.navigation;
            if (!n) return;
            const teamASide = n.matches?.find(x => x.id === n.currentMatchId)?.teamASide;
            const engine0 = teamASide === 'b' ? n.teamBName : n.teamAName;
            const engine1 = teamASide === 'b' ? n.teamAName : n.teamBName;
            const mine = me?.currentTeam?.name || MY_TEAM_NAME;
            if (g !== game) return;
            g.names = [engine0, engine1];
            if (engine1 === mine && engine0 !== mine) g.ally = 1;
            g.allyKnown = engine0 === mine || engine1 === mine;
            feed.title();
        } catch { /* local viewer or not signed in: left team is ally */ }
    }
    const override = () => { const v = localStorage.getItem(LS + 'side'); return v === '0' || v === '1' ? Number(v) : null; };
    const allyTeam = () => override() ?? game.ally;

    // Multikill bookkeeping; returns the line to announce for one kill.
    function applyKill(g, k, round) {
        const ally = allyTeam();
        // Cassi & Issac are one champion for streaks and sprees (either half's kills count for the pair)
        const unit = c => isDuo(c.type) ? 'duo' + c.team : c.idx;
        const victimSpree = g.spree.get(unit(k.victim)) ?? 0;
        g.spree.delete(unit(k.victim));
        if (!k.killer) return { line: 'executed', first: false, k }; // camps/monsters don't take first blood
        const worth = k.worth ?? 1;
        const spree = (g.spree.get(unit(k.killer)) ?? 0) + worth;
        g.spree.set(unit(k.killer), spree);
        const first = !g.anyKill;
        g.anyKill = true;
        const s = g.streak.get(unit(k.killer));
        const count = (s && round - s.round <= MULTIKILL_WINDOW ? s.count : 0) + worth;
        g.streak.set(unit(k.killer), { count, round });
        const allyKill = k.killer.team === ally;
        let line;
        if (count >= 2) {
            const m = MULTI[Math.min(count, 6)];
            line = allyKill ? m : 'enemy' + m[0].toUpperCase() + m.slice(1);
        } else if (first) line = 'firstBlood';
        else if (victimSpree >= 3) line = 'shutdown';
        else if (spree >= 3) {
            const sp = SPREE[Math.min(spree, 8)];
            line = allyKill ? sp : 'enemy' + sp[0].toUpperCase() + sp.slice(1);
        } else line = allyKill ? 'enemySlain' : 'allySlain';
        return { line, first, k, count };
    }

    // Rebuild streaks silently after a seek, from the indexed events before `key`.
    function resync(g, key) {
        g.streak.clear();
        g.spree.clear();
        g.anyKill = false;
        for (const ev of g.index) {
            if (ev.key > key) break;
            for (const k of ev.kills) applyKill(g, k, ev.round);
        }
    }

    function announceEvent(g, ev) {
        let last = null;
        for (const k of ev.kills) {
            const r = applyKill(g, k, ev.round);
            feed.push(k, r, ev.round);
            { soundAt = lastPos(g, k.victim.idx, ev.key); sfx('c' + k.victim.type + 'death', { vol: 0.75 }); soundAt = null; }
            // where they fell: their tile at the end of the round before (the last place they stood alive)
            for (const v of k.victim.duo ? (g.roster || []).filter(o => isDuo(o.type) && o.team === k.victim.team) : [k.victim]) {
                const i = g.cam?.order.indexOf(v.idx) ?? -1, a = i >= 0 ? trackAt(g.cam, ev.round - 1) : null;
                const at = a && a[i * 3 + 2] === 1 ? { x: a[i * 3], y: a[i * 3 + 1] } : lastPos(g, v.idx, ev.key);
                if (at) addDeathFx(k.victim.team, at.x, at.y);
            }
            // the chime lands with the kill; the voice line follows in the queue
            if (k.killer) {
                const n = Math.min(5, r.count || 1), name = ['First', 'First', 'Double', 'Triple', 'Quadra', 'Penta'][n];
                // spectating there's no "our" side: every kill gets the full chime
                if (spectatorMode() || k.killer.team === allyTeam()) { sfx(n >= 2 ? 'kill' + n : 'kill', { vol: 1, loud: true }); sfx('melody' + name, { vol: 1, loud: true }); }
                else { sfx('enemyKill', { vol: 0.95, loud: true }); if (n >= 2) sfx('melody' + name, { vol: 0.6, loud: true }); }
            } else sfx('assist', { vol: 0.8, loud: true });
            // the ace covers it: no "enemy slain" for the kill that wiped the team
            const slain = r.line === 'enemySlain' || r.line === 'allySlain';
            if (!(slain && ev.aces.includes(k.victim.team))) say(r.line, k.killer?.team ?? k.victim.team, { killer: k.killer, victim: k.victim, count: r.count });
            if (k.killer) last = k.killer;
        }
        for (const t of ev.aces) {
            const scorer = 1 - t, ours = t !== allyTeam();
            say(ours ? 'ace' : 'aced', scorer, { killer: last && last.team === scorer ? last : null, team: scorer });
            feed.note(ours ? 'ACE' : 'ACED', scorer);
        }
    }

    // Called for every snapshot the viewer reads outside indexing, i.e. what's on screen.
    // `hw` is the furthest position already announced, so tiny back-and-forth jitter never repeats a line.
    // Welcome line when the draft ends. The draft has rounds of its own, so go by the viewer's label instead:
    // the timeline reads "Draft round N" during picks and "Round N / M" once the game is on.
    let phase = null, phaseEl = null, phaseSearchAt = 0;
    function viewerPhase() {
        if (!phaseEl?.isConnected) {
            // finding the label walks every span: only while a replay is loaded, and at most every 2s
            if (!game || performance.now() - phaseSearchAt < 2000) return null;
            phaseSearchAt = performance.now();
            phaseEl = [...document.querySelectorAll('span')].find(e => !e.children.length && /^(Draft round|Round)$/.test(e.textContent.trim())) || null;
            if (!phaseEl) return null;
        }
        return phaseEl.textContent.trim() === 'Draft round' ? 'draft' : 'game';
    }
    setInterval(() => {
        const now = viewerPhase();
        if (!now) return;
        if (game && phase === 'draft' && now === 'game' && (game.play?.round ?? 0) <= 60) { finishNativeDraft(game); say('welcome', allyTeam(), { team: allyTeam() }); }
        if (now === 'draft' && phase !== 'draft') { seenLocks.clear(); lockQ.length = 0; nativeDraftSeen = false; }
        phase = now;
        if (now === 'draft' && game?.roster && !game.draftShown && !draft.on && draftShowOn() && isPlaying()) startDraft(game);
    }, 400);
    function onPlayback(g, snap) {
        const prev = g.play;
        g.play = snap;
        const reset = (why) => { g.resets = (g.resets || 0) + 1; g.lastReset = [why, prev?.round, snap.round]; resync(g, snap.key); g.hw = snap.key; g.finishedAnnounced = snap.outcome !== 0; g.playHits.clear(); };
        if (!prev || snap.timeline !== prev.timeline) return reset('timeline');
        if (snap.key === prev.key) return;
        const dr = snap.round - prev.round;
        // Seek / jump: resync quietly. While the viewer is playing, slow frames or x2/x4 speed can move several rounds
        // per frame, so allow bigger forward steps then.
        if (dr < 0 || dr > (isPlaying() ? MAX_PLAY_ROUNDS : MAX_FORWARD_ROUNDS)) return reset('jump');
        if (snap.key <= g.hw) return;
        const from = g.hw;
        g.hw = snap.key;
        const onMain = g.mainTimeline === null || snap.timeline === g.mainTimeline;
        if (onMain && g.indexMaxKey >= snap.key) {
            for (const ev of g.index) if (ev.key > from && ev.key <= snap.key) announceEvent(g, ev);
            const now = performance.now();
            if (rpsRound != null && now - rpsAt > 250 && now - rpsAt < 3000 && snap.round > rpsRound && snap.round - rpsRound < 60) roundsPerSec = roundsPerSec * 0.7 + 0.3 * (snap.round - rpsRound) / ((now - rpsAt) / 1000);
            if (now - rpsAt > 250 || rpsRound == null) { rpsAt = now; rpsRound = snap.round; }
            playSteps(g, from, snap.key);
        } else if (prev.champs && snap.champs) {
            const ev = diff(prev, snap, g.playHits);
            if (ev) announceEvent(g, ev);
        }
        if (snap.outcome !== 0 && !g.finishedAnnounced) {
            g.finishedAnnounced = true;
            if (snap.outcome === 1 || snap.outcome === 2) {
                const winner = snap.outcome - 1;
                say(winner === allyTeam() ? 'victory' : 'defeat', winner, { team: winner, big: true });
                feed.note(winner === allyTeam() ? 'VICTORY' : 'DEFEAT', winner);
            }
        }
    }

    let playingAt = 0, playing = false;
    function isPlaying() {
        const now = performance.now();
        if (now - playingAt > 200) {
            playingAt = now;
            playing = !!document.querySelector('button[aria-label="Pause"], button[title^="Pause"]');
        }
        return playing;
    }

    function onIndexed(g, snap) {
        if (g.mainTimeline === null) g.mainTimeline = snap.timeline;
        const before = g.indexPrev;
        const ev = diff(g.indexPrev, snap, g.indexHits);
        g.indexPrev = snap;
        if (snap.key > g.indexMaxKey) g.indexMaxKey = snap.key;
        if (ev) g.index.push(ev);
        if (!g.roster && snap.champs?.length) { g.roster = snap.champs.map(c => ({ idx: c.idx, team: c.team, type: c.type })); preloadLocal(g.roster.map(c => c.type)); }
        if (snap.timeline === g.mainTimeline) camRecord(g, before, snap);
        if (STEP_SFX.has(snap.stepKind) && (snap.actor?.kind === 1 || snap.stepKind === 2) && snap.timeline === g.mainTimeline) {
            const c = snap.champs?.find(x => x.idx === snap.actor.index);
            const last = g.steps.at(-1);
            // did this step hurt an enemy champion? (abilities on camps get thinned out)
            let vc = false;
            if (c && before?.champs) for (const o of snap.champs) { const p = before.champs.find(x => x.idx === o.idx); if (p && o.team !== c.team && o.hp < p.hp - 1e-3) { vc = true; break; } }
            if (!last || last.key < snap.key) g.steps.push({ key: snap.key, round: snap.round, kind: snap.stepKind, actor: snap.actor.index, type: c?.type, vc,
                slot: snap.stepKind === 6 && snap.slot < 4 ? snap.slot : -1, atype: snap.stepKind === 6 ? snap.atype : 0, x: c?.x ?? -1, y: c?.y ?? -1 });
        }
    }

    // --- wasm hook: wrap the visualiser's exports -------------------------------------------
    const desc = Object.getOwnPropertyDescriptor(WebAssembly.Instance.prototype, 'exports');
    const wrapped = new WeakMap();
    let inspecting = false;
    Object.defineProperty(WebAssembly.Instance.prototype, 'exports', {
        configurable: true, enumerable: desc.enumerable,
        get() {
            const real = desc.get.call(this);
            if (!real || typeof real.Game_Visualiser_ReadTimelineState !== 'function') return real;
            if (wrapped.has(this)) return wrapped.get(this);
            const w = Object.create(null);
            for (const k of Object.keys(real)) w[k] = real[k];
            const wrap = (name, after) => { const f = real[name]; if (typeof f === 'function') w[name] = function (...a) { const r = f.apply(this, a); try { after(a, r); } catch (e) { warn(e); } return r; }; };
            wrap('Game_Visualiser_Timeline_BeginInspection', () => { inspecting = true; });
            wrap('Game_Visualiser_Timeline_ResumeInspection', () => { inspecting = true; });
            wrap('Game_Visualiser_Timeline_SuspendInspection', () => { inspecting = false; });
            wrap('Game_Visualiser_Timeline_EndInspection', () => { inspecting = false; });
            // Indexing walks every step of the main timeline with ReadTimelineState: that's where kills are found.
            wrap('Game_Visualiser_ReadTimelineState', (a) => {
                const handle = a[0], ptr = a[a.length - 1];
                // Playback re-reads the same step many times per frame: skip the full decode when nothing moved.
                if (!inspecting && game && game.handle === handle && game.play) {
                    const hd = decodeHeader(real.memory.buffer, ptr);
                    if (hd && hd.key === game.play.key && hd.timeline === game.play.timeline) return;
                }
                const snap = decode(real.memory.buffer, ptr);
                if (!snap) return;
                const g = game && game.handle === handle ? game : newGame(handle);
                if (inspecting) onIndexed(g, snap); else onPlayback(g, snap);
            });
            // What's on screen is read with ReadState(handle, perspective, snapshot): use it as the playhead.
            wrap('Game_Visualiser_ReadState', (a) => {
                if (inspecting || !game || game.handle !== a[0]) return;
                const snap = decodeHeader(real.memory.buffer, a[2]);
                if (!snap) return;
                onPlayback(game, snap);
            });
            wrap('Game_FromReplayFileBytes', () => { game = null; });
            Object.freeze(w);
            wrapped.set(this, w);
            ui.ensure();
            return w;
        },
    });
    const warn = e => { if (!warn.n) { warn.n = 1; console.warn('[cbc-announcer]', e); } };

    // --- champion art from the visualiser's own bundle --------------------------------------
    // The viewer ships a portrait atlas (champion-icons-atlas-*.png + coordinates in its JS) and 1920x1080 splash
    // arts (ryth-*.png, cassi_issac-*.png, ...). File names are hashed per release, so read them out of the loaded JS.
    const art = {
        state: 'idle', atlas: null, icons: {}, splash: {}, hor: null,
        async load() {
            if (this.state !== 'idle') return;
            this.state = 'loading';
            try {
                const urls = new Set([...document.querySelectorAll('script[src]')].map(s => s.src));
                for (const e of performance.getEntriesByType('resource')) if (/\.js(\?|$)/.test(e.name) && new URL(e.name).origin === location.origin) urls.add(e.name);
                for (const u of urls) {
                    if (this.atlas && Object.keys(this.splash).length) break;
                    let src;
                    try { src = await (await fetch(u)).text(); } catch { continue; }
                    if (!src.includes('champion-icons-atlas') && !src.includes('cassi_issac-')) continue;
                    const file = src.match(/`(champion-icons-atlas-[\w-]+\.png)`/);
                    // (the camp icon atlas has the same shape, so take the one that lists champions)
                    const meta = [...src.matchAll(/\{width:(\d+),height:(\d+),icons:\{((?:\w+:\{[^{}]*\},?)+)\}\}/g)].find(m => /\bryth:\{/.test(m[3]));
                    if (file && meta && !this.atlas) {
                        this.atlas = { url: new URL(file[1], u).href, w: +meta[1], h: +meta[2] };
                        for (const m of meta[3].matchAll(/(\w+):\{[^{}]*?x:(\d+),y:(\d+),size:(\d+)\}/g)) this.icons[m[1]] = { x: +m[2], y: +m[3], size: +m[4] };
                    }
                    const hor = src.match(/`(heart-of-ruin-icon-[\w-]+\.png)`/);
                    if (hor && !this.hor) this.hor = new URL(hor[1], u).href;
                    for (const m of src.matchAll(/`((ryth|vesper_vale|vendetta|cassi_issac|stellar|prism|marcella|willow|ren|varg|tavi|heart_of_ruin)-[\w-]+\.png)`/g)) this.splash[m[2]] ??= new URL(m[1], u).href;
                }
                this.state = this.atlas ? 'ok' : 'missing';
                for (const s of Object.values(this.splash)) { const i = new Image(); i.decoding = 'async'; i.src = s; }
            } catch (e) { this.state = 'missing'; warn(e); }
        },
        // CSS for a square portrait of champion `type` (atlas crop), or null.
        icon(type) {
            const key = ART_KEYS[type];
            if (key === 'heart_of_ruin' && this.hor) return `background:url("${this.hor}") 50% 50%/101% 101% no-repeat`;
            const i = this.icons[key];
            if (!this.atlas || !i) return null;
            const a = this.atlas;
            return `background:url("${a.url}") ${i.x / (a.w - i.size) * 100}% ${i.y / (a.h - i.size) * 100}%/${a.w / i.size * 100}% ${a.h / i.size * 100}% no-repeat`;
        },
        splashOf(type) { return this.splash[isDuo(type) ? 'cassi_issac' : ART_KEYS[type]] ?? null; },
    };

    // --- audio + banner queue ----------------------------------------------------------------
    const audioCache = new Map();
    const queue = [];
    let speaking = false;
    const muted = () => localStorage.getItem(LS + 'muted') === '1';
    const bannersOn = () => localStorage.getItem(LS + 'banner') !== '0';
    const volume = () => Number(localStorage.getItem(LS + 'volume') ?? 0.8);
    function clip(id) {
        if (!audioCache.has(id)) {
            const a = new Audio();
            a.preload = 'auto';
            a.src = WIKI + id + '.ogg';
            a.dataset.state = 'loading';
            a.addEventListener('canplaythrough', () => { a.dataset.state = 'ok'; }, { once: true });
            a.addEventListener('error', () => { a.dataset.state = 'error'; }, { once: true });
            audioCache.set(id, a);
        }
        return audioCache.get(id);
    }
    function preload() { for (const l of Object.values(LINES)) for (const t of [...l.takes, ...l.spec ?? [], ...l.blue ?? [], ...l.red ?? []]) clip(t.id); }
    const isAce = line => line === 'ace' || line === 'aced';
    function say(line, team, info = {}) {
        // spectating there's no "enemy": the enemy multikill / spree lines become the team's own (voiced "Blue team
        // double kill!" where there's a caster take, the plain "Dominating!" where there isn't)
        if (spectatorMode() && /^enemy[A-Z]/.test(line) && line !== 'enemySlain') line = line.replace(/^enemy(.)/, (_, c) => c.toLowerCase());
        const entry = { t: Date.now(), line, team, round: game?.play?.round, via: muted() ? 'muted' : 'queued' };
        log.push(entry);
        if (log.length > 200) log.shift();
        if (muted() && !bannersOn()) return;
        const item = { line, team, info, at: Date.now(), entry };
        // a bigger multikill from the same champion replaces its smaller lines still waiting to be said
        const rank = l => { const m = l.replace(/^enemy(.)/, (_, c) => c.toLowerCase()); const i = MULTI.indexOf(m); return i > 0 ? i : ['enemySlain', 'allySlain', 'firstBlood'].includes(l) || SPREE.includes(m) ? 1 : 0; };
        const unitOf = c => c ? (isDuo(c.type) ? 'duo' + c.team : c.idx) : null;
        if (rank(line) >= 2 && info.killer) {
            for (let qi = queue.length - 1; qi >= 0; qi--) {
                const q = queue[qi];
                const same = q.info.killer && unitOf(q.info.killer) === unitOf(info.killer);
                const genericSlain = spectatorMode() && (q.line === 'enemySlain' || q.line === 'allySlain'); // "a champion has been slain"
                if ((same || genericSlain) && rank(q.line) > 0 && rank(q.line) < rank(line) && q.line !== 'firstBlood') { q.entry.via = 'skipped'; queue.splice(qi, 1); }
            }
        }
        // aces wait behind every other line queued so far
        const firstAce = isAce(line) ? -1 : queue.findIndex(q => isAce(q.line));
        if (firstAce < 0) queue.push(item); else queue.splice(firstAce, 0, item);
        pump();
    }
    function pump() {
        if (speaking) return;
        while (queue.length && Date.now() - queue[0].at > STALE_MS * (isAce(queue[0].line) ? 2 : 1)) queue.shift().entry.via = 'stale';
        const next = queue.shift();
        if (!next) return;
        speaking = true;
        // spectator: when the line before (one that was actually said) was for the same team, don't repeat "Blue team":
        // use the plain take ("Blue team double kill!", "Double kill!", "Triple kill!", "Red team double kill!", ...)
        const L = LINES[next.line], plain = next.line.replace(/^enemy(.)/, (_, c) => c.toLowerCase());
        const teamTake = spectatorMode() && !L.spec && (L.blue || L.red) && next.line !== 'victory' && next.line !== 'defeat'; // the end always names the team
        const repeat = teamTake && lastSaid && lastSaid.team === next.team && lastSaid.teamTake && Date.now() - lastSaid.at < 15000;
        const take = repeat && LINES[plain] ? pickPlain(plain) : pickTake(next.line, next.team);
        lastSaid = { team: next.team, teamTake: !!teamTake, at: Date.now() };
        next.entry.take = take.id;
        if (bannersOn()) banner.show(next, take);
        // Each item finishes once: its own clip/tts end (or fallback) and at least BANNER_MIN_MS of its banner on screen.
        // (Fallback timers are tied to this item, so a stale one can't end the next line early.)
        const shownAt = Date.now();
        let finished = false;
        const done = () => {
            if (finished) return;
            finished = true;
            const wait = Math.max(0, (bannersOn() ? BANNER_MIN_MS : 0) - (Date.now() - shownAt));
            setTimeout(() => { speaking = false; pump(); }, wait + LINE_GAP_MS);
        };
        if (muted()) { setTimeout(done, 1800); return; }
        const a = clip(take.id);
        const tts = () => {
            next.entry.via = 'tts';
            if (!('speechSynthesis' in window)) return void setTimeout(done, 1500);
            const u = new SpeechSynthesisUtterance(take.text);
            u.rate = 1.05; u.pitch = 0.9; u.volume = volume();
            u.onend = u.onerror = done;
            speechSynthesis.speak(u);
            setTimeout(done, 4500);
        };
        if (a.dataset.state === 'error') return tts();
        a.currentTime = 0;
        a.volume = volume();
        a.onended = () => { a.onended = null; done(); };
        a.play().then(() => { next.entry.via = 'clip'; }, () => { a.onended = null; tts(); });
        const dur = isFinite(a.duration) && a.duration > 0 ? a.duration * 1000 : 4000;
        setTimeout(() => { if (!finished && a.paused) { a.onended = null; done(); } }, dur + 1500);
    }
    const log = [];

    // --- League-style kill banner ------------------------------------------------------------
    // Killer portrait over a ribbon with the line underneath. Big moments (first blood, multikills, aces) also get the
    // killer's splash art faded in behind it; solo kills, sprees, shutdowns and executes don't. Ally kills are framed
    // blue, enemy kills red (the viewer's own team blue/red).
    const BLUE = '#3388ff', RED = '#ff4444';
    // Solo kills, sprees and shutdowns read like League's small line: [killer] x has slain y [victim]
    const DUEL_LINES = new Set(['enemySlain', 'allySlain', 'shutdown', ...SPREE.filter(Boolean).flatMap(l => [l, 'enemy' + l[0].toUpperCase() + l.slice(1)])]);
    const PLAIN_LINES = new Set([...DUEL_LINES, 'executed']);
    const SPREE_TEXT = { killingSpree: 'is on a killing spree', rampage: 'is on a rampage', unstoppable: 'is unstoppable', dominating: 'is dominating', godlike: 'is godlike', legendary: 'is legendary' };
    const duelText = (line, k, v) => {
        const spree = SPREE_TEXT[line.replace(/^enemy(.)/, (_, c) => c.toLowerCase())];
        return line === 'shutdown' ? `${k.name} has shut down ${v.name}!` : spree ? `${k.name} ${spree}!` : `${k.name} has slain ${v.name}!`;
    };
    // --- pick phase show ---------------------------------------------------------------------------------------
    // cambc drafts both teams at once; this stages it like League's draft instead: the viewer pauses, picks lock in
    // one at a time in snake order (blue, red, red, blue, blue, red, ...), each with the lock-in sound, the
    // champion's pick sound and its pick voice line, over the champ select music. Then the replay carries on.
    const CD_CS = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-champ-select/global/default/sounds/';
    const CD_GD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/';
    const draftShowOn = () => localStorage.getItem(LS + 'draftshow') !== '0';
    const draft = { on: false, el: null, abort: null, music: null, layers: [], outro: null };
    const sleepMs = ms => new Promise(r => { const t = setTimeout(r, ms); draft.abort?.signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
    function playOnce(url, vol) {
        if (muted()) return Promise.resolve();
        return new Promise(res => {
            const a = new Audio(url); a.volume = Math.max(0, Math.min(1, volume() * vol));
            const done = () => res(); a.onended = done; a.onerror = done;
            a.play().catch(done);
            setTimeout(done, 4500);
            draft.abort?.signal.addEventListener('abort', () => { a.pause(); done(); }, { once: true });
        });
    }
    const viewerButton = label => document.querySelector(`button[aria-label="${label}"]`);
    // League flashes the champion's splash when a pick locks in: it swells in bright, then settles back. In the pick
    // show it stays dimmed behind the board until the next pick; over the plain viewer it fades away.
    function pulseSplash(type, host, stay) {
        art.load();
        const url = art.splashOf(type); if (!url) return;
        if (!host) {
            host = document.getElementById('cbc-splash-host');
            if (!host) { host = document.createElement('div'); host.id = 'cbc-splash-host'; document.body.append(host); }
            const cv = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
            Object.assign(host.style, cv && cv.width > 300 ? { left: cv.left + 'px', top: cv.top + 'px', width: cv.width + 'px', height: cv.height + 'px' } : { left: '0', top: '0', width: '100%', height: '100%' });
        }
        for (const o of host.querySelectorAll(':scope > .cbc-splash')) { o.classList.add('gone'); setTimeout(() => o.remove(), 700); }
        const d = document.createElement('div');
        d.className = 'cbc-splash' + (stay ? ' stay' : '');
        d.style.backgroundImage = `url("${url}")`;
        host.prepend(d);
        if (!stay) setTimeout(() => d.remove(), 1600);
    }
    // The viewer's own draft (pick show off): both teams lock a champion each draft turn. Play the lock-in for each
    // pick, one after the other (left team then right), and flash its splash. The last turn's picks never show
    // "Locked in" before the game starts, so those come from the roster.
    const lockQ = [], seenLocks = new Map(); let lockBusy = false, nativeDraftSeen = false; // seenLocks: 'side:slot' -> champion type let lockBusy = false, nativeDraftSeen = false;
    function nameToType(n) { if (/cassi|issac/i.test(n)) return 3; const i = CHAMPS.findIndex(c => c.toLowerCase() === n.trim().toLowerCase()); return i < 0 ? null : i; }
    function pumpLocks() {
        if (lockBusy) return;
        while (lockQ.length && performance.now() - lockQ[0].at > 3000) lockQ.shift(); // way behind (fast playback): drop
        const q = lockQ.shift(); if (!q) return;
        lockBusy = true;
        if (sfxOn() && !muted()) playOnce(CD_CS + (q.side ? 'sfx-cs-draft-right-pick-single.ogg' : 'sfx-cs-draft-left-pick-single.ogg'), 0.55);
        if (bannersOn() && q.type != null) pulseSplash(q.type, null, false);
        setTimeout(() => { lockBusy = false; pumpLocks(); }, Math.max(130, 300 / Math.max(1, viewerSpeed()))); // the viewer's whole draft takes ~1.5 s at 1x
    }
    function watchNativeDraft() {
        if (phase !== 'draft' || draft.on || game?.draftShown || !isPlaying()) return;
        const leaves = [...document.querySelectorAll('small,div,span,p')].filter(e => !e.children.length && e.textContent.trim() === 'Locked in');
        if (!leaves.length) return;
        const slots = leaves.map(e => e.closest('li')).filter(x => x?.parentElement); // each team is an <ol> of pick <li>s
        const cols = [...new Set(slots.map(x => x.parentElement))].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        const fresh = [];
        for (const sl of slots) {
            const side = Math.max(0, cols.indexOf(sl.parentElement)), i = [...sl.parentElement.children].indexOf(sl);
            const key = side + ':' + i; if (seenLocks.has(key)) continue;
            const type = nameToType(sl.innerText.replace(/Locked in/i, ''));
            seenLocks.set(key, type); nativeDraftSeen = true;
            fresh.push({ side, i, type, at: performance.now() });
        }
        fresh.sort((a, b) => a.i - b.i || a.side - b.side);
        lockQ.push(...fresh); pumpLocks();
    }
    function finishNativeDraft(g) {
        if (!nativeDraftSeen || !g?.roster) return;
        nativeDraftSeen = false;
        // whatever the viewer flashed past without a "Locked in" (the last turn, or turns skipped at speed)
        const missing = [0, 1].map(t => {
            const seen = [...seenLocks].filter(([k]) => k.startsWith(t + ':')).map(([, ty]) => ty);
            return g.roster.filter(c => c.team === t && !(c.type === 4 && g.roster.some(o => o.team === t && o.type === 3)))
                .map(c => c.type).filter(ty => { const j = seen.indexOf(ty); if (j < 0) return true; seen.splice(j, 1); return false; });
        });
        for (let i = 0; i < Math.max(missing[0].length, missing[1].length); i++) for (const t of [0, 1]) if (missing[t][i] != null) lockQ.push({ side: t, i, type: missing[t][i], at: performance.now() });
        pumpLocks();
        seenLocks.clear();
    }
    setInterval(watchNativeDraft, 120);
    async function startDraft(g) {
        g.draftShown = true;
        draft.on = true; draft.abort = new AbortController();
        viewerButton('Pause')?.click();
        // picks per team; Cassi & Issac are one pick
        const picks = [0, 1].map(t => {
            const mine = g.roster.filter(c => c.team === t), out = [];
            for (const c of mine) { if (c.type === 4 && mine.some(o => o.type === 3)) continue; out.push(c.type); }
            return out;
        });
        const names = [0, 1].map(t => game?.names?.[t] || (t ? 'Red team' : 'Blue team'));
        const el = document.createElement('div');
        el.id = 'cbc-draft';
        const col = t => `<div class="side s${t}"><div class="tn">${t ? 'RED' : 'BLUE'} · ${names[t].replace(/[<>&]/g, '')}</div>${picks[t].map((_, i) => `<div class="slot" data-t="${t}" data-i="${i}"><div class="pic"></div><div class="nm">pick ${i + 1}</div></div>`).join('')}</div>`;
        el.innerHTML = `${col(0)}<div class="mid"><div class="ttl">PICK PHASE</div><div class="turn"></div><button class="skip">skip ›</button></div>${col(1)}`;
        el.querySelector('.skip').onclick = () => draft.abort.abort();
        (document.body).append(el);
        draft.el = el;
        requestAnimationFrame(() => el.classList.add('in'));
        if (!muted()) {
            // the champ select score: a base layer plus intensity layers that come in as the picks fill up, like the client
            const m = new Audio(CD_CS + 'music-cs-draft-pick-base-layer-01.ogg'); m.loop = true; m.volume = 0; draft.music = m;
            draft.layers = [1, 2, 3, 4].map(n => { const a = new Audio(CD_CS + `music-cs-draft-pick-intensity-layer-0${n}.ogg`); a.loop = true; a.volume = 0; return a; });
            Promise.all([m, ...draft.layers].map(a => a.play().catch(() => { }))).then(() => { const t = m.currentTime; for (const a of draft.layers) a.currentTime = t; });
            fadeTo(m, volume() * 0.6, 1500);
            playOnce(CD_CS + 'sfx-cs-draft-pick-intro.ogg', 0.6);
        }
        const total = picks[0].length + picks[1].length; let done = 0; const voiced = new Set();
        const order = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0]; // snake: B R R B B R R B B R (padded)
        const next = [0, 0];
        for (const t of order) {
            if (draft.abort.signal.aborted) break;
            if (next[t] >= picks[t].length) continue;
            const i = next[t]++, type = picks[t][i];
            const slot = el.querySelector(`.slot[data-t="${t}"][data-i="${i}"]`);
            el.querySelector('.turn').textContent = `${t ? 'red' : 'blue'} is picking…`;
            el.querySelector('.turn').className = 'turn t' + t;
            slot.classList.add('picking');
            await sleepMs(1300);
            const css = art.icon(type);
            const pic = slot.querySelector('.pic');
            if (css) pic.style.cssText = css;
            slot.querySelector('.nm').textContent = type === 3 ? 'Cassi & Issac' : CHAMPS[type] || 'Champion';
            slot.classList.remove('picking'); slot.classList.add('locked');
            pulseSplash(type, el, true);
            done++; draft.layers.forEach((a, k) => { if (done / total >= (k + 1) / 5 && !a.dataset.on) { a.dataset.on = '1'; fadeTo(a, volume() * 0.45, 1200); } });
            const id = CHAMP_SFX[type]?.id;
            playOnce(CD_CS + (t ? 'sfx-cs-draft-right-pick-single.ogg' : 'sfx-cs-draft-left-pick-single.ogg'), 0.7);
            // a champion both teams picked only gets its pick sound and voice line the first time; the repeat just locks
            if (voiced.has(type)) { await sleepMs(450); continue; }
            voiced.add(type);
            if (id) { setTimeout(() => !draft.abort.signal.aborted && playOnce(CD_GD + `champion-sfx-audios/${id}.ogg`, 0.55), 150); await sleepMs(500); await playOnce(CD_GD + `champion-choose-vo/${id}.ogg`, 0.9); }
            await sleepMs(550);
        }
        // all locked: the pick music hands over to the finalization theme, which then carries into the game and
        // crossfades into the Rift music and ambience (see tickBgm) instead of stopping dead
        if (!muted()) {
            const fin = new Audio(CD_CS + 'music-cs-draft-finalization-01.ogg'); fin.volume = 0; draft.outro = fin;
            fin.play().then(() => fadeTo(fin, volume() * 0.6, 900)).catch(() => { });
            fin.onended = () => { if (draft.outro === fin) draft.outro = null; };
        }
        for (const a of [draft.music, ...draft.layers]) if (a) fadeOut(a, 1100);
        draft.layers = [];
        if (!draft.abort.signal.aborted) { el.querySelector('.turn').textContent = 'locked in'; el.querySelector('.turn').className = 'turn'; await sleepMs(2200); }
        el.classList.remove('in'); el.classList.add('out');
        handoff.at = performance.now();
        setTimeout(() => el.remove(), 700);
        draft.on = false; draft.el = null;
        viewerButton('Play')?.click();
    }

    const banner = {
        el: null, timer: 0,
        show(item, take) {
            if (!ui.stage) return;
            const { line, info } = item;
            const ally = allyTeam();
            const subjectTeam = info.killer?.team ?? info.team ?? (info.victim ? 1 - info.victim.team : item.team);
            // player mode: blue = good for us, red = bad. Spectating: the colour of the team it's about (team 0 blue,
            // team 1 red), so a red team double kill is red
            const sideTeam = spectatorMode() ? 0 : ally;
            const allySide = line === 'executed' ? info.victim?.team !== sideTeam : subjectTeam === sideTeam;
            const color = allySide ? BLUE : RED;
            const main = info.killer ?? (line === 'executed' ? info.victim : null);
            // splash art is for the big moments only: first blood, multikills, aces
            const splash = main && !PLAIN_LINES.has(line) ? art.splashOf(main.type) : null;
            const duel = DUEL_LINES.has(line) && info.killer && info.victim;
            const el = document.createElement('div');
            el.className = 'cbc-ban' + (info.big ? ' big' : '') + (line === 'executed' ? ' exec' : '') + (line === 'welcome' ? ' wel' : '') + (main ? '' : ' plain') + (duel ? ' duel' : '');
            el.style.setProperty('--c', color);
            const portrait = (c, cls) => {
                const d = document.createElement('div');
                d.className = 'pt ' + cls;
                const css = art.icon(c.type);
                if (css) d.style.cssText = css; else d.textContent = c.name.slice(0, 2);
                d.title = c.name;
                return d;
            };
            el.innerHTML = `<div class="sp"></div><div class="rib"></div><div class="row"></div><div class="txw"><div class="tx"></div></div><div class="sub"></div>`;
            if (splash) el.querySelector('.sp').style.backgroundImage = `url("${splash}")`;
            const row = el.querySelector('.row');
            const teamColor = t => t === (spectatorMode() ? 0 : ally) ? BLUE : RED;
            if (duel) {
                const k = portrait(info.killer, 'side'), v = portrait(info.victim, 'side');
                k.style.setProperty('--tc', teamColor(info.killer.team));
                v.style.setProperty('--tc', teamColor(info.victim.team));
                const mid = document.createElement('div');
                mid.className = 'hs';
                mid.textContent = duelText(line, info.killer, info.victim);
                row.append(k, mid, v);
            } else if (info.killer) {
                row.append(portrait(info.killer, 'killer'));

            } else if (line === 'executed' && info.victim) row.append(portrait(info.victim, 'killer dead'));
            const teamWord = spectatorMode() && (LINES[line].blue || LINES[line].red) && line !== 'victory' && line !== 'defeat' && item.team != null
                ? (item.team === 0 ? 'Blue Team ' : 'Red Team ') : '';
            el.querySelector('.tx').textContent = teamWord + LINES[line].banner;
            el.querySelector('.sub').textContent = info.killer ? info.killer.name
                : line === 'executed' && info.victim ? `${info.victim.name} was executed` : line === 'welcome' ? '' : (game?.names?.[info.team] ?? '');
            // Anything still on screen gets out of the way fast.
            if (this.el) this.hide(this.el, true);
            this.place();
            ui.stage.append(el);
            this.el = el;
            requestAnimationFrame(() => el.classList.add('in'));
            // If the page is too busy to run the fade-in (slow frames), show it without animation.
            setTimeout(() => { if (!el.dataset.out && Number(getComputedStyle(el).opacity) < .5) { el.classList.add('in'); el.style.transition = 'none'; } }, 350);
            clearTimeout(this.timer);
            const hold = info.big ? 4200 : queue.length ? 1900 : 2600;
            this.timer = setTimeout(() => this.hide(el, queue.length > 0), hold);
        },
        // Centre over the map canvas (the biggest canvas in the viewer), not the whole frame.
        place() {
            const cv = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
            const st = ui.stage.style;
            if (cv && cv.width > 300) { st.left = cv.left + 'px'; st.width = cv.width + 'px'; st.top = (cv.top + Math.min(90, cv.height * .1)) + 'px'; }
            else { st.left = '0'; st.width = '100%'; st.top = '11%'; }
        },
        hide(el, fast) {
            if (el.dataset.out) return;
            el.dataset.out = '1';
            el.classList.add(fast ? 'out-fast' : 'out');
            if (el.style.transition === 'none') el.style.display = 'none';
            setTimeout(() => el.remove(), fast ? 260 : 900);
            if (this.el === el) this.el = null;
        },
    };

    // --- kill feed + controls ----------------------------------------------------------------
    const COLORS = ['#59a5e8', '#e8615a']; // engine team 0 (left, blue), team 1 (right, red)
    const ui = {
        root: null, list: null, head: null, stage: null,
        ensure() {
            if (this.root) return;
            const mount = () => {
                if (this.root || !document.body) return;
                const st = document.createElement('style');
                st.textContent = `
#cbc-ann { position: fixed; top: 230px; right: 14px; z-index: 2147483000; width: 300px; font: 12px/1.3 Archivo, system-ui, sans-serif; color: #eee; pointer-events: none; }
#cbc-ann .hd { pointer-events: auto; display: flex; flex-wrap: wrap; gap: 4px 6px; justify-content: flex-end; align-items: center; margin-bottom: 4px; opacity: .55; transition: opacity .2s; }
#cbc-ann:hover .hd { opacity: 1; }
#cbc-ann .hd span { font: 10px 'IBM Plex Mono', monospace; color: #bbb; text-shadow: 0 1px 2px #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1 0 100%; text-align: right; }
#cbc-ann .hd button { white-space: nowrap; flex: none; }
#cbc-ann button { pointer-events: auto; font: 10px 'IBM Plex Mono', monospace; color: #ddd; background: rgba(20,24,26,.75); border: 1px solid rgba(255,255,255,.18); border-radius: 3px; padding: 1px 6px; cursor: pointer; }
#cbc-ann .it { display: flex; gap: 6px; align-items: center; justify-content: flex-end; background: rgba(15,18,20,.78); border: 1px solid rgba(255,255,255,.1); border-radius: 3px; padding: 3px 8px; margin-top: 3px; transition: opacity .6s, transform .3s; }
#cbc-ann .it.old { opacity: 0; transform: translateX(10px); }
#cbc-ann .it b { font-weight: 600; white-space: nowrap; } #cbc-ann .it i { font-style: normal; opacity: .6; font-size: 11px; }
#cbc-ann .it .ic { width: 18px; height: 18px; border-radius: 3px; flex: none; box-shadow: 0 0 0 1px var(--c); }
#cbc-ann .it .tag { font: 600 10px 'IBM Plex Mono', monospace; letter-spacing: .05em; color: #f3c74f; }
#cbc-ann .it .rd { font: 10px 'IBM Plex Mono', monospace; opacity: .5; }
#cbc-ann .ban { text-align: right; font: 700 15px Archivo, sans-serif; letter-spacing: .08em; text-shadow: 0 2px 6px #000; margin-top: 4px; }
#cbc-stage { position: fixed; left: 0; width: 100%; top: 11%; z-index: 2147482999; display: flex; justify-content: center; pointer-events: none; }
.cbc-ban { --c: #3388ff; position: absolute; width: 560px; height: 196px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
  opacity: 0; transform: scale(1.18); transition: opacity .18s ease-out, transform .28s cubic-bezier(.2,.9,.25,1.2); font-family: Archivo, system-ui, sans-serif; }
.cbc-ban.in { opacity: 1; transform: none; }
.cbc-ban.out { opacity: 0; transform: translateY(-8px) scale(.97); transition: opacity .85s ease-in, transform .85s ease-in; }
.cbc-ban.out-fast { opacity: 0; transform: scale(.94); transition: opacity .22s ease-in, transform .22s ease-in; }
.cbc-ban .sp { position: absolute; left: 0; right: 0; top: 18px; height: 118px; background: center 28%/cover no-repeat;
  -webkit-mask: radial-gradient(ellipse 50% 50% at 50% 50%, #000 45%, transparent 100%); mask: radial-gradient(ellipse 50% 50% at 50% 50%, #000 45%, transparent 100%); opacity: .9; filter: saturate(1.1); }
.cbc-ban.exec .sp { filter: grayscale(.85) brightness(.8); }
.cbc-ban .rib { position: absolute; left: 40px; right: 40px; top: 60px; height: 40px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--c) 55%, #000) 22%, color-mix(in srgb, var(--c) 55%, #000) 78%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--c) 80%, #fff); border-bottom: 1px solid color-mix(in srgb, var(--c) 80%, #fff); opacity: .85;
  -webkit-mask: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); mask: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); }
.cbc-ban .row { position: absolute; top: 22px; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 8px; }
.cbc-ban .pt { flex: none; border-radius: 50%; background-color: #111; color: #fff; display: grid; place-items: center; font-weight: 700; }
.cbc-ban .pt.killer { width: 104px; height: 104px; box-shadow: 0 0 0 3px #d9b65f, 0 0 0 6px var(--c), 0 0 26px 6px color-mix(in srgb, var(--c) 70%, transparent), 0 6px 16px #000; }
.cbc-ban .pt.victim { width: 58px; height: 58px; margin-left: -2px; filter: grayscale(.6) brightness(.85); box-shadow: 0 0 0 2px #8a7a55, 0 0 0 4px #444, 0 4px 10px #000; position: relative; }
.cbc-ban .pt.victim::after, .cbc-ban .pt.dead::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: linear-gradient(45deg, transparent 46%, #d33 46%, #d33 54%, transparent 54%), linear-gradient(-45deg, transparent 46%, #d33 46%, #d33 54%, transparent 54%); }
.cbc-ban .pt.dead { position: relative; filter: grayscale(.9) brightness(.8); }
.cbc-ban .sw { font-size: 22px; color: #e8d39a; text-shadow: 0 0 8px #000, 0 2px 4px #000; margin: 0 2px; }
.cbc-ban .tx { position: relative; margin-top: 0; font: 800 30px/1 Archivo, system-ui, sans-serif; letter-spacing: .09em; text-transform: uppercase; color: #f3e2b0;
  background: linear-gradient(#fff6d8, #d9b65f 70%, #a5823a); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 2px 2px #000) drop-shadow(0 0 10px color-mix(in srgb, var(--c) 80%, transparent)); white-space: nowrap; }
.cbc-ban .sub { position: relative; margin-top: 5px; font: 600 12px/1.2 Archivo, system-ui, sans-serif; letter-spacing: .06em; color: #e9e9e9; text-shadow: 0 1px 3px #000, 0 0 6px #000; min-height: 15px; }
.cbc-ban.plain { height: 120px; } .cbc-ban.plain .rib, .cbc-ban.plain .sp { display: none; }
/* no portrait: the ribbon sits right behind the text so it lines up whatever the font size */
.cbc-ban .txw { position: relative; display: flex; justify-content: center; }
.cbc-ban.plain .txw { padding: 0 24px; }
.cbc-ban.plain .txw::before { content: ''; position: absolute; left: -160px; right: -160px; top: -10px; bottom: -10px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--c) 55%, #000) 22%, color-mix(in srgb, var(--c) 55%, #000) 78%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--c) 80%, #fff); border-bottom: 1px solid color-mix(in srgb, var(--c) 80%, #fff); opacity: .85;
  -webkit-mask: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); mask: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); }
.cbc-ban.plain .sub { margin-top: 12px; }
.cbc-ban.wel .tx { font-size: 24px; }
.cbc-ban.duel { width: 720px; }
.cbc-ban.duel .sp, .cbc-ban.duel .rib, .cbc-ban.duel .tx, .cbc-ban.duel .sub { display: none; }
.cbc-ban.duel .row { top: 72px; height: 56px; gap: 12px; padding: 0 60px; background: radial-gradient(ellipse 50% 70% at 50% 50%, rgba(1,10,19,.72), rgba(1,10,19,.45) 60%, transparent 100%); }
.cbc-ban.duel .row::after { content: ''; position: absolute; left: 30%; right: 30%; bottom: 4px; height: 2px; border-radius: 1px;
  background: linear-gradient(90deg, transparent, var(--c), transparent); box-shadow: 0 0 8px var(--c); }
.cbc-ban .pt.side { width: 38px; height: 38px; font-size: 12px; box-shadow: 0 0 0 1px #785a28, 0 0 0 3px var(--tc), 0 2px 6px #000; }
.cbc-ban .hs { font: 600 21px/1 Archivo, system-ui, sans-serif; letter-spacing: .01em; color: #f0e6d2; white-space: nowrap; text-shadow: 0 1px 2px #000, 0 0 6px rgba(0,0,0,.9); }
#cbc-draft { position: fixed; inset: 0; z-index: 2147483001; display: grid; grid-template-columns: 1fr 260px 1fr; align-items: center; gap: 30px; padding: 0 6vw;
  background: radial-gradient(ellipse at center, rgba(4,8,14,.72), rgba(2,4,8,.92)); opacity: 0; transition: opacity .5s; font-family: Archivo, system-ui, sans-serif; color: #f0e6d2; }
#cbc-draft.in { opacity: 1; } #cbc-draft.out { opacity: 0; transition: opacity .6s; }
#cbc-draft .side { display: flex; flex-direction: column; gap: 10px; }
#cbc-draft .tn { font: 700 13px/1 Archivo, sans-serif; letter-spacing: .14em; margin-bottom: 6px; color: #c8aa6e; }
#cbc-draft .s0 .tn { color: #6fa8ff; } #cbc-draft .s1 { align-items: flex-end; } #cbc-draft .s1 .tn { color: #ff7a6e; text-align: right; }
#cbc-draft .slot { display: flex; align-items: center; gap: 14px; width: min(100%, 360px); height: 64px; padding: 0 12px; border: 1px solid rgba(200,170,110,.25);
  background: linear-gradient(90deg, rgba(10,20,30,.85), rgba(10,20,30,.4)); transition: border-color .3s, box-shadow .3s, background .3s; }
#cbc-draft .s1 .slot { flex-direction: row-reverse; text-align: right; background: linear-gradient(270deg, rgba(30,10,10,.85), rgba(30,10,10,.4)); }
#cbc-draft .pic { width: 48px; height: 48px; flex: none; border-radius: 50%; background: #0b0e13; box-shadow: 0 0 0 2px rgba(200,170,110,.35); transform: scale(.85); opacity: .5; transition: transform .35s cubic-bezier(.2,1.6,.4,1), opacity .25s; }
#cbc-draft .nm { font-size: 15px; font-weight: 600; letter-spacing: .03em; opacity: .45; }
#cbc-draft .slot.picking { border-color: #c8aa6e; box-shadow: 0 0 18px rgba(200,170,110,.45), inset 0 0 18px rgba(200,170,110,.15); animation: cbcpulse 1s ease-in-out infinite; }
#cbc-draft .s0 .slot.locked { border-color: #3d7fe0; } #cbc-draft .s1 .slot.locked { border-color: #e0483d; }
#cbc-draft .slot.locked .pic { transform: scale(1.12); opacity: 1; box-shadow: 0 0 0 2px #c8aa6e, 0 0 16px rgba(200,170,110,.6); }
#cbc-draft .slot.locked .nm { opacity: 1; font-size: 17px; }
#cbc-ov { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147482996; pointer-events: none; }
#cbc-ov .lines { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; }
#cbc-ov .ptr { position: absolute; left: 0; top: 0; width: 0; height: 0; }
#cbc-ov .ptr .pic { position: absolute; left: -15px; top: -15px; width: 30px; height: 30px; border-radius: 50%; background-color: #0b0e13;
  box-shadow: 0 0 0 2px var(--tc), 0 0 0 3px #000, 0 2px 6px rgba(0,0,0,.6); }
#cbc-ov .ptr .ar { position: absolute; left: -6px; top: -6px; width: 0; height: 0; border-left: 9px solid var(--tc); border-top: 6px solid transparent; border-bottom: 6px solid transparent;
  transform-origin: 6px 6px; filter: drop-shadow(0 0 1px #000); }
#cbc-ov .rring { position: absolute; left: 0; top: 0; display: none; }
#cbc-ov .rring i { position: absolute; inset: 0; border-radius: 50%; border: 3px solid rgba(74,168,255,.25);
  border-top-color: #e6f4ff; border-right-color: #5ab4ff; box-shadow: 0 0 10px rgba(74,168,255,.8), inset 0 0 8px rgba(74,168,255,.6); animation: cbcspin 1s linear infinite; }
#cbc-ov .rring i.b { inset: -4px; border-width: 2px; border-color: transparent; border-bottom-color: rgba(120,190,255,.8); animation-duration: 1.6s; animation-direction: reverse; box-shadow: none; }
@keyframes cbcspin { to { transform: rotate(360deg); } }
#cbc-score { position: fixed; transform: translateX(-50%); display: flex; align-items: stretch; gap: 0; pointer-events: none; z-index: 2147482997;
  font: 600 13px Archivo, system-ui, sans-serif; color: #f0e6d2; filter: drop-shadow(0 2px 6px rgba(0,0,0,.6)); }
#cbc-score .t { display: flex; align-items: center; gap: 10px; padding: 0 12px; height: 38px; background: linear-gradient(#10141c, #0a0d12); border: 1px solid #785a28; }
#cbc-score .t0 { border-right: none; border-radius: 4px 0 0 4px; } #cbc-score .t1 { border-left: none; border-radius: 0 4px 4px 0; }
#cbc-score .nm { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; max-width: 130px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#cbc-score .t0 .nm { color: #6fa8ff; } #cbc-score .t1 .nm { color: #ff7a6e; }
#cbc-score .k { font: 800 22px Archivo, sans-serif; min-width: 24px; text-align: center; }
#cbc-score .mid { display: flex; flex-direction: column; justify-content: center; gap: 3px; padding: 3px 12px; background: linear-gradient(#141923, #0c1016); border-top: 1px solid #785a28; border-bottom: 1px solid #785a28; min-width: 230px; }
#cbc-score .gold { display: flex; align-items: center; justify-content: center; gap: 8px; font: 700 13px 'IBM Plex Mono', monospace; color: #e8c66a; }
#cbc-score .gold i { width: 9px; height: 9px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #fff2b0, #c8962a); display: inline-block; }
#cbc-score .lead { font-size: 11px; color: #9a937f; min-width: 52px; text-align: center; } #cbc-score .lead.l0 { color: #6fa8ff; } #cbc-score .lead.l1 { color: #ff7a6e; }
#cbc-score .gems { display: flex; align-items: center; gap: 6px; font: 600 10px 'IBM Plex Mono', monospace; color: #c9c2ae; }
#cbc-score .gems .bar { position: relative; flex: 1; height: 5px; background: #222833; border-radius: 3px; overflow: hidden; }
#cbc-score .gems .b0 { position: absolute; right: 50%; top: 0; bottom: 0; background: #3d8bff; } #cbc-score .gems .b1 { position: absolute; left: 50%; top: 0; bottom: 0; background: #ff4a3d; }
#cbc-score .gems .h0 { position: absolute; right: 50%; top: 0; bottom: 0; background: rgba(61,139,255,.35); } #cbc-score .gems .h1 { position: absolute; left: 50%; top: 0; bottom: 0; background: rgba(255,74,61,.35); }
#cbc-score .gems em { font-style: normal; color: #8a8576; margin: 0 2px; }
#cbc-score .gems .bar::after { content: ''; position: absolute; left: 50%; top: -1px; bottom: -1px; width: 1px; background: #e8c66a; }
#cbc-inv .col { position: fixed; width: 34px; display: flex; flex-wrap: wrap; gap: 2px; pointer-events: none; z-index: 2147482997; }
#cbc-inv i { position: relative; width: 16px; height: 16px; background-size: 100% 100%; image-rendering: pixelated; box-shadow: 0 0 0 1px #000, 0 0 0 2px #5b4a2a; border-radius: 2px; }
#cbc-inv i.new { box-shadow: 0 0 0 1px #000, 0 0 0 2px #e8c66a, 0 0 6px #e8c66a; }
#cbc-inv s { position: absolute; right: -2px; bottom: -3px; font: 700 8px 'IBM Plex Mono', monospace; color: #fff; text-decoration: none; text-shadow: 0 0 2px #000, 0 0 2px #000; }
#cbc-ov .tparrow { position: absolute; left: 0; top: 0; image-rendering: pixelated; filter: drop-shadow(0 0 4px rgba(0,0,0,.6)); }
#cbc-fx { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147482997; pointer-events: none; }
.cbc-death { position: absolute; left: 0; top: 0; will-change: transform; }
.cbc-death canvas { position: absolute; image-rendering: pixelated; left: 0; top: 0; }
.cbc-death .beam { width: calc(var(--t) * 21 / 40); height: calc(var(--t) * 5); transform: translate(-50%, -100%); }
.cbc-death .skull { width: calc(var(--t) * .95); height: calc(var(--t) * .95); opacity: 0; }
.cbc-death .puff { width: calc(var(--t) * .7); height: auto; opacity: 0; }
#cbc-splash-host { position: fixed; z-index: 2147482998; pointer-events: none; overflow: hidden; }
.cbc-splash { position: absolute; inset: 0; background: center 22%/cover no-repeat; opacity: 0; pointer-events: none;
  -webkit-mask-image: radial-gradient(ellipse 75% 70% at center, #000 45%, transparent 100%); mask-image: radial-gradient(ellipse 75% 70% at center, #000 45%, transparent 100%);
  animation: cbcsplash 1.5s ease-out forwards; }
.cbc-splash.stay { z-index: -1; animation: cbcsplashstay 1.6s ease-out forwards; }
.cbc-splash.gone { transition: opacity .6s; opacity: 0 !important; animation: none; }
@keyframes cbcsplash { 0% { opacity: 0; transform: scale(1.08); filter: brightness(1.8); } 15% { opacity: .75; filter: brightness(1.35); } 45% { opacity: .55; transform: scale(1.02); filter: brightness(1); } 100% { opacity: 0; transform: scale(1); } }
@keyframes cbcsplashstay { 0% { opacity: 0; transform: scale(1.08); filter: brightness(1.8); } 15% { opacity: .85; filter: brightness(1.35); } 50% { opacity: .5; transform: scale(1.02); filter: brightness(1); } 100% { opacity: .28; transform: scale(1); } }
@keyframes cbcpulse { 50% { box-shadow: 0 0 6px rgba(200,170,110,.2), inset 0 0 6px rgba(200,170,110,.05); } }
#cbc-draft .mid { text-align: center; }
#cbc-draft .ttl { font: 800 30px/1 Archivo, sans-serif; letter-spacing: .14em; background: linear-gradient(#fff6d8, #c8aa6e); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
#cbc-draft .turn { margin-top: 12px; font: 600 13px Archivo, sans-serif; letter-spacing: .1em; text-transform: uppercase; color: #c8aa6e; min-height: 18px; }
#cbc-draft .turn.t0 { color: #6fa8ff; } #cbc-draft .turn.t1 { color: #ff7a6e; }
#cbc-draft .skip { margin-top: 22px; font: 11px 'IBM Plex Mono', monospace; color: #c8aa6e; background: none; border: 1px solid rgba(200,170,110,.4); padding: 3px 10px; cursor: pointer; }
#cbc-board { position: fixed; right: 20px; top: 60px; bottom: 20px; width: 560px; overflow-y: auto; z-index: 2147483002; padding: 12px 14px;
  background: rgba(12,14,18,.96); border: 1px solid rgba(200,170,110,.35); border-radius: 6px; color: #e8e2d0; font: 12px Archivo, system-ui, sans-serif; }
#cbc-board .top { display: flex; gap: 10px; align-items: baseline; margin-bottom: 6px; } #cbc-board .top span { color: #9a937f; flex: 1; font-size: 11px; }
#cbc-board h4 { margin: 10px 0 5px; font: 600 11px 'IBM Plex Mono', monospace; letter-spacing: .06em; text-transform: uppercase; color: #c8aa6e; } #cbc-board h4 small { color: #8a836f; text-transform: none; letter-spacing: 0; }
#cbc-board button { margin: 0 5px 5px 0; padding: 3px 8px; font: 11px 'IBM Plex Mono', monospace; color: #e8e2d0; background: #1d2026; border: 1px solid rgba(200,170,110,.3); border-radius: 3px; cursor: pointer; }
#cbc-board button:hover { background: #2a2e36; border-color: #c8aa6e; }
.cbc-ban.big { margin-top: 170px; } .cbc-ban.big .tx { font-size: 46px; }`;
                document.head.append(st);
                const stage = document.createElement('div');
                stage.id = 'cbc-stage';
                const root = document.createElement('div');
                root.id = 'cbc-ann';
                root.innerHTML = `<div class="hd"><span class="who"></span><button class="side" title="Which team counts as allies">us: left</button><button class="bn" title="League kill banners"></button><button class="spec" title="Spectator announcer lines instead of the player's"></button><button class="sfxb" title="Kill chimes, recall/teleport, gold, champion attack and ability sounds"></button><button class="amb" title="Summoner's Rift ambience while playing"></button><button class="mus" title="Summoner's Rift music while playing"></button><button class="dsh" title="Stage the pick phase League-style (pauses the replay)"></button><button class="board" title="Every sound the script plays, as it plays them">sound board</button><button class="cine" title="Cinematic camera: moves in ahead of fights, kills and big tributes and frames everyone involved"></button><button class="mute"></button></div><div class="ls"></div>`;
                document.body.append(stage, root);
                this.root = root; this.list = root.querySelector('.ls'); this.head = root.querySelector('.who'); this.stage = stage;
                const mute = root.querySelector('.mute'), bn = root.querySelector('.bn');
                const spec = root.querySelector('.spec'), sfxb = root.querySelector('.sfxb'), amb = root.querySelector('.amb');
                const paint = () => { mute.textContent = muted() ? 'announcer off' : 'announcer on'; bn.textContent = bannersOn() ? 'banners on' : 'banners off'; spec.textContent = spectatorMode() ? 'spectator' : 'player';
                    sfxb.textContent = sfxOn() ? 'sfx on' : 'sfx off'; amb.textContent = ambOn() ? 'ambience on' : 'ambience off';
                    root.querySelector('.mus').textContent = musicOn() ? 'music on' : 'music off'; root.querySelector('.dsh').textContent = draftShowOn() ? 'pick show on' : 'pick show off';
                    root.querySelector('.cine').textContent = ['cinema off', 'cinema on', 'cinema fast'][+cinemaMode()]; };
                root.querySelector('.mus').onclick = () => { localStorage.setItem(LS + 'music', musicOn() ? '0' : '1'); paint(); };
                root.querySelector('.board').onclick = () => soundBoard();
                root.querySelector('.cine').onclick = () => { localStorage.setItem(LS + 'cinema', String((+cinemaMode() + 1) % 3)); cine.home = null; cine.shot = null; cine.passive = null; cine.builtVer = -1; cine.frames.clear(); paint(); };
                root.querySelector('.dsh').onclick = () => { localStorage.setItem(LS + 'draftshow', draftShowOn() ? '0' : '1'); paint(); };
                sfxb.onclick = () => { localStorage.setItem(LS + 'sfx', sfxOn() ? '0' : '1'); paint(); };
                amb.onclick = () => { localStorage.setItem(LS + 'amb', ambOn() ? '0' : '1'); paint(); tickAmbience(); };
                spec.onclick = () => { localStorage.setItem(LS + 'spectator', spectatorMode() ? '0' : '1'); paint(); preload(); };
                mute.onclick = () => { localStorage.setItem(LS + 'muted', muted() ? '0' : '1'); paint(); if (!muted()) { preload(); unlockAudio(); } };
                bn.onclick = () => { localStorage.setItem(LS + 'banner', bannersOn() ? '0' : '1'); paint(); };
                paint();
                root.querySelector('.side').onclick = () => {
                    const cur = override();
                    const next = cur === null ? String(1 - (game?.ally ?? 0)) : cur === (game?.ally ?? 0) ? String(1 - cur) : null;
                    if (next === null) localStorage.removeItem(LS + 'side'); else localStorage.setItem(LS + 'side', next);
                    if (game?.play) resync(game, game.play.key);
                    feed.title();
                };
                feed.title();
                preload();
            };
            if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
        },
    };
    // Browsers only let audio start after a user gesture inside this frame; the play button counts.
    // --- sound effects (League wiki SFX, CORS *) --------------------------------------------------------------
    // Kill chimes, recall / teleport channels, gems -> coin jingle, champion attack/cast sounds (each cambc champion is
    // voiced by a League champion of a similar kind), and the Summoner's Rift ambience under it all.
    const SFX_FILES = {"kill":["Killstreak_SFX_Multikill_Point_First"],"kill2":["Killstreak_SFX_Multikill_Point_Double"],"kill3":["Killstreak_SFX_Multikill_Point_Triple"],"kill4":["Killstreak_SFX_Multikill_Point_Quadra"],"kill5":["Killstreak_SFX_Multikill_Point_Penta"],"enemyKill":["Killstreak_SFX_Multikill_Generic"],"assist":["Killstreak_SFX_Assist"],"recall":["Recall_SFX","Recall_SFX_2"],"teleport":["Teleport_SFX","Teleport_SFX_3"],"flash":["Flash_SFX"],"ambience":["Ambience_Summoner's_Rift_Music"],"c0a":["Pantheon_Original_SFX_BasicAttack2_OnCast_0","Pantheon_Original_SFX_BasicAttack2_OnCast_1","Pantheon_Original_SFX_BasicAttack2_OnCast_2"],"c0c":["Pantheon_Original_SFX_Q_missilecast_empowered","Pantheon_Original_SFX_CritAttack_OnCast"],"c1a":["Smolder_Original_SFX_BasicAttack_OnCast_0","Smolder_Original_SFX_BasicAttack_OnCast_2"],"c1c":["Smolder_Original_SFX_Q_OnCast_0","Smolder_Original_SFX_Q_OnCast_2"],"c2a":["Yone_Original_SFX_BasicAttack_OnCast_0","Yone_Original_SFX_BasicAttack_OnCast_2"],"c2c":["Yone_Original_SFX_Q_OnCast_0","Yone_Original_SFX_E_cast","Yone_Original_SFX_R_cast_dash"],"c3a":["Gnar_Original_SFX_BasicAttack_OnCast_0","Gnar_Original_SFX_BasicAttack_OnCast_2","Gnar_Original_SFX_BasicAttack_OnCast_4"],"c3c":["Gnar_Original_SFX_Q_OnCast_0","Gnar_Original_SFX_Q_OnCast_1","Gnar_Original_SFX_E_OnCast_0"],"c4a":["Volibear_Original_SFX_BasicAttack_OnCast_0","Volibear_Original_SFX_BasicAttack_OnCast_1","Volibear_Original_SFX_BasicAttack_OnCast_2"],"c4c":["Volibear_Original_SFX_E_OnCast"],"c5a":["Seraphine_Original_SFX_BasicAttack_OnCast_2"],"c5c":["Seraphine_Original_SFX_W_OnCast","Seraphine_Original_SFX_R_cast"],"c6a":["Hwei_Original_SFX_BasicAttack_OnCast_1"],"c6c":["Hwei_Original_SFX_QQ_OnCast_0","Hwei_Original_SFX_WQ_OnCast_0","Hwei_Original_SFX_WQ_OnCast_1"],"c7a":["Briar_Original_SFX_BasicAttack_OnCast_0","Briar_Original_SFX_BasicAttack_OnCast_1"],"c7c":["Briar_Original_SFX_Q_OnCast","Briar_Original_SFX_W_OnCast","Briar_Original_SFX_E_OnCast"],"c8a":["Mel_Original_SFX_BasicAttack_OnCast_1","Mel_Original_SFX_BasicAttack_OnCast_2"],"c8c":["Mel_Original_SFX_E_OnCast_0","Mel_Original_SFX_E_OnCast_1"],"c9a":["Irelia_Original_SFX_BasicAttack_OnCast_1","Irelia_Original_SFX_BasicAttack_OnCast_3"],"c9c":["Irelia_Original_SFX_EMissile_OnMissileCast_1","Irelia_Original_SFX_EMissile_OnMissileCast_2","Irelia_Original_SFX_R_OnCast"],"c10a":["Darius_Original_SFX_BasicAttack_OnCast_0","Darius_Original_SFX_BasicAttack_OnCast_1","Darius_Original_SFX_BasicAttack_OnCast_2"],"c10c":["Darius_Original_SFX_W_OnCast","Darius_Original_SFX_E_OnCast_0","Darius_Original_SFX_E_OnCast_1"],"c11a":["Milio_Original_SFX_BasicAttack_OnCast_0","Milio_Original_SFX_BasicAttack_OnCast_1"],"c11c":["Milio_Original_SFX_Q_OnCast_0","Milio_Original_SFX_Q_OnCast_1"],"c12a":["Aatrox_Original_SFX_BasicAttack_OnCast_0","Aatrox_Original_SFX_BasicAttack_OnCast_1","Aatrox_Original_SFX_BasicAttack_OnCast_2"],"c12c":["Aatrox_Original_SFX_E_OnCast_0","Aatrox_Original_SFX_W_OnCast_0","Aatrox_Original_SFX_Q2_OnCast_all"]};
    const SFX_BASE = 'https://wiki.leagueoflegends.com/en-us/images/';
    const sfxOn = () => localStorage.getItem(LS + 'sfx') !== '0';
    const ambOn = () => localStorage.getItem(LS + 'amb') !== '0';
    const sfxVolume = () => volume() * 0.55;
    const sfxCache = new Map();
    // Per cambc champion: the League champion it's voiced by (v/va voice lines, pick sounds by Riot id) and the in-game
    // sounds layered for it: a swing, am missile launch, h hit, c cast, cm cast missile/buff, ch ability hit. The wiki has
    // no in-game sounds for Vayne, Akali, Yuumi, Nidalee, Riven, Soraka, Lee Sin or Sejuani, so those borrow a kindred
    // kit's (Smolder, Yasuo, Sona's Crescendo for Final Chapter, Naafiri's leap, Irelia, Milio, K'Sante, Trundle).
    const CHAMP_SFX = {"0":{"a":["Pantheon_Original_SFX_BasicAttack2_OnCast_0","Pantheon_Original_SFX_BasicAttack2_OnCast_1","Pantheon_Original_SFX_BasicAttack2_OnCast_2","Pantheon_Original_SFX_BasicAttack3_OnCast_0","Pantheon_Original_SFX_BasicAttack3_OnCast_1","Pantheon_Original_SFX_BasicAttack3_OnCast_2","Pantheon_Original_SFX_BasicAttack_OnCast_0","Pantheon_Original_SFX_BasicAttack_OnCast_1","Pantheon_Original_SFX_BasicAttack_OnCast_2"],"am":[],"h":[],"c":["Pantheon_Original_SFX_E_OnCast_0","Pantheon_Original_SFX_E_OnCast_1","Pantheon_Original_SFX_R_OnCast","Pantheon_Original_SFX_W_OnCast_0","Pantheon_Original_SFX_W_OnCast_1","Pantheon_Original_SFX_W_OnCast_2"],"cm":[],"ch":["Pantheon_Original_SFX_E_hit_0","Pantheon_Original_SFX_E_hit_1","Pantheon_Original_SFX_E_hit_2","Pantheon_Original_SFX_E_hit_3","Pantheon_Original_SFX_W_hit_0","Pantheon_Original_SFX_W_hit_1","Pantheon_Original_SFX_W_hit_2"],"v":["Pantheon_Original_R_0","Pantheon_Original_R_1","Pantheon_Original_R_2","Pantheon_Original_W_0","Pantheon_Original_W_1"],"va":["Pantheon_Original_Attack_0","Pantheon_Original_Attack_1","Pantheon_Original_Attack_10","Pantheon_Original_Attack_11","Pantheon_Original_Attack_12","Pantheon_Original_Attack_13","Pantheon_Original_Attack_14","Pantheon_Original_Attack_15","Pantheon_Original_Attack_16","Pantheon_Original_Attack_17","Pantheon_Original_Attack_18","Pantheon_Original_Attack_19","Pantheon_Original_Attack_2","Pantheon_Original_Attack_20"],"id":80},"1":{"a":["Smolder_Original_SFX_BasicAttack_OnCast_0","Smolder_Original_SFX_BasicAttack_OnCast_1","Smolder_Original_SFX_BasicAttack_OnCast_2"],"am":["Smolder_Original_SFX_BasicAttack_OnMissileLaunch_0","Smolder_Original_SFX_BasicAttack_OnMissileLaunch_1","Smolder_Original_SFX_BasicAttack_OnMissileLaunch_2"],"h":["Smolder_Original_SFX_BasicAttack_OnHit_0","Smolder_Original_SFX_BasicAttack_OnHit_1","Smolder_Original_SFX_BasicAttack_OnHit_2"],"c":["Smolder_Original_SFX_E_OnCast_0","Smolder_Original_SFX_E_OnCast_1","Smolder_Original_SFX_E_OnCast_2","Smolder_Original_SFX_Q_OnCast_0","Smolder_Original_SFX_Q_OnCast_1","Smolder_Original_SFX_Q_OnCast_2","Smolder_Original_SFX_R_OnCast","Smolder_Original_SFX_W_OnCast_0","Smolder_Original_SFX_W_OnCast_1","Smolder_Original_SFX_W_OnCast_2"],"cm":[],"ch":["Smolder_Original_SFX_Q_OnHit_0","Smolder_Original_SFX_Q_OnHit_1","Smolder_Original_SFX_Q_OnHit_2"],"v":["Vayne_Original_E_0","Vayne_Original_E_1","Vayne_Original_E_2","Vayne_Original_E_3","Vayne_Original_Q_0","Vayne_Original_Q_1","Vayne_Original_Q_2","Vayne_Original_Q_3","Vayne_Original_R_0","Vayne_Original_R_1","Vayne_Original_R_2"],"va":["Vayne_Original_Attack_0","Vayne_Original_Attack_1","Vayne_Original_Attack_2","Vayne_Original_Attack_3","Vayne_Original_Attack_4"],"id":67},"2":{"a":["Yasuo_Original_SFX_BasicAttack2_OnCast_0","Yasuo_Original_SFX_BasicAttack2_OnCast_1","Yasuo_Original_SFX_BasicAttack2_OnCast_2","Yasuo_Original_SFX_BasicAttack2_OnCast_3","Yasuo_Original_SFX_BasicAttack2_OnCast_4","Yasuo_Original_SFX_BasicAttack2_OnCast_5","Yasuo_Original_SFX_BasicAttack2_OnCast_6","Yasuo_Original_SFX_BasicAttack2_OnCast_7","Yasuo_Original_SFX_BasicAttack3_OnCast_0","Yasuo_Original_SFX_BasicAttack3_OnCast_1","Yasuo_Original_SFX_BasicAttack3_OnCast_2","Yasuo_Original_SFX_BasicAttack3_OnCast_3","Yasuo_Original_SFX_BasicAttack3_OnCast_4","Yasuo_Original_SFX_BasicAttack3_OnCast_5"],"am":[],"h":[],"c":["Yasuo_Original_SFX_E_cast_0","Yasuo_Original_SFX_E_cast_1","Yasuo_Original_SFX_E_cast_2","Yasuo_Original_SFX_E_cast_3","Yasuo_Original_SFX_Q2_OnCast_0","Yasuo_Original_SFX_Q2_OnCast_1","Yasuo_Original_SFX_Q2_OnCast_2","Yasuo_Original_SFX_Q2_OnCast_3","Yasuo_Original_SFX_Q2_OnCast_4"],"cm":[],"ch":["Yasuo_Original_SFX_E_hit_0","Yasuo_Original_SFX_E_hit_1","Yasuo_Original_SFX_E_hit_2","Yasuo_Original_SFX_E_hit_3","Yasuo_Original_SFX_Q_hit_0","Yasuo_Original_SFX_Q_hit_1","Yasuo_Original_SFX_Q_hit_2","Yasuo_Original_SFX_Q_hit_3"],"v":["Akali_Original_E_0","Akali_Original_E_1","Akali_Original_E_2","Akali_Original_E_3","Akali_Original_E_4","Akali_Original_E_5","Akali_Original_E_6","Akali_Original_Q_0","Akali_Original_Q_1","Akali_Original_Q_2","Akali_Original_Q_3","Akali_Original_R2_0","Akali_Original_R2_1","Akali_Original_R2_2"],"va":["Akali_Original_Attack_0","Akali_Original_Attack_1","Akali_Original_Attack_10","Akali_Original_Attack_11","Akali_Original_Attack_12","Akali_Original_Attack_13","Akali_Original_Attack_14","Akali_Original_Attack_15","Akali_Original_Attack_16","Akali_Original_Attack_2","Akali_Original_Attack_3","Akali_Original_Attack_4","Akali_Original_Attack_5","Akali_Original_Attack_6"],"id":84},"3":{"a":["Sona_Original_SFX_BasicAttack_OnCast_0","Sona_Original_SFX_BasicAttack_OnCast_1","Sona_Original_SFX_BasicAttack_OnCast_2"],"am":["Sona_Original_SFX_BasicAttack_OnMissileLaunch_0","Sona_Original_SFX_BasicAttack_OnMissileLaunch_1","Sona_Original_SFX_BasicAttack_OnMissileLaunch_2","Sona_Original_SFX_BasicAttack_OnMissileLaunch_3","Sona_Original_SFX_BasicAttack_OnMissileLaunch_4","Sona_Original_SFX_BasicAttack_OnMissileLaunch_5"],"h":["Sona_Original_SFX_BasicAttack_OnHit_0","Sona_Original_SFX_BasicAttack_OnHit_1","Sona_Original_SFX_BasicAttack_OnHit_2"],"c":["Sona_Original_SFX_R_OnCast"],"cm":["Sona_Original_SFX_R_OnMissileLaunch","Sona_Original_SFX_R_OnBuffActivate"],"ch":["Sona_Original_SFX_R_OnHit_0","Sona_Original_SFX_R_OnHit_1","Sona_Original_SFX_R_OnHit_2"],"v":["Yuumi_Original_E_0","Yuumi_Original_E_1","Yuumi_Original_Q_0","Yuumi_Original_Q_1","Yuumi_Original_R_0","Yuumi_Original_R_1","Yuumi_Original_R_2","Yuumi_Original_R_3","Yuumi_Original_R_4","Yuumi_Original_W2_0","Yuumi_Original_W2_1","Yuumi_Original_W2_2","Yuumi_Original_W2_3","Yuumi_Original_W_0"],"va":["Yuumi_Original_Attack_0","Yuumi_Original_Attack_1","Yuumi_Original_Attack_10","Yuumi_Original_Attack_11","Yuumi_Original_Attack_2","Yuumi_Original_Attack_3","Yuumi_Original_Attack_4","Yuumi_Original_Attack_5","Yuumi_Original_Attack_6","Yuumi_Original_Attack_7","Yuumi_Original_Attack_8","Yuumi_Original_Attack_9"],"id":350,"purr":["Yuumi_Original_SFX_purr_0","Yuumi_Original_SFX_purr_1","Yuumi_Original_SFX_purr_2","Yuumi_Original_SFX_purr_3"]},"4":{"a":["Naafiri_Original_SFX_BasicAttack_OnCast_0","Naafiri_Original_SFX_BasicAttack_OnCast_1","Naafiri_Original_SFX_BasicAttack_OnCast_2","Naafiri_Original_SFX_BasicAttack_OnCast_3"],"am":[],"h":["Naafiri_Original_SFX_BasicAttack_OnHit_0","Naafiri_Original_SFX_BasicAttack_OnHit_1","Naafiri_Original_SFX_BasicAttack_OnHit_2","Naafiri_Original_SFX_BasicAttack_OnHit_3"],"c":["Naafiri_Original_SFX_E_OnCast_0","Naafiri_Original_SFX_E_OnCast_1"],"cm":[],"ch":["Naafiri_Original_SFX_E_hit_0","Naafiri_Original_SFX_E_hit_1","Naafiri_Original_SFX_E_hit_2","Naafiri_Original_SFX_E_hit_3"],"v":["Nidalee_Original_E_0","Nidalee_Original_E_1","Nidalee_Original_E_2","Nidalee_Original_E_3","Nidalee_Original_E_4","Nidalee_Original_Q_0","Nidalee_Original_Q_1","Nidalee_Original_Q_2","Nidalee_Original_Q_3","Nidalee_Original_Q_4","Nidalee_Original_Q_5","Nidalee_Original_Q_6","Nidalee_Original_R_0","Nidalee_Original_R_1"],"va":["Nidalee_Original_Attack_0","Nidalee_Original_Attack_1","Nidalee_Original_Attack_10","Nidalee_Original_Attack_11","Nidalee_Original_Attack_12","Nidalee_Original_Attack_13","Nidalee_Original_Attack_14","Nidalee_Original_Attack_2","Nidalee_Original_Attack_3","Nidalee_Original_Attack_4","Nidalee_Original_Attack_5","Nidalee_Original_Attack_6","Nidalee_Original_Attack_7","Nidalee_Original_Attack_8"],"id":76,"reset":["Naafiri_Original_SFX_Q_OnCast_0","Naafiri_Original_SFX_Q_OnCast_1","Naafiri_Original_SFX_Q_OnCast_2"]},"5":{"a":["Seraphine_Original_SFX_BasicAttack_OnCast_0","Seraphine_Original_SFX_BasicAttack_OnCast_1","Seraphine_Original_SFX_BasicAttack_OnCast_2"],"am":["Seraphine_Original_SFX_BasicAttack_OnMissileLaunch_0","Seraphine_Original_SFX_BasicAttack_OnMissileLaunch_1","Seraphine_Original_SFX_BasicAttack_OnMissileLaunch_2"],"h":["Seraphine_Original_SFX_BasicAttack_OnHit_0","Seraphine_Original_SFX_BasicAttack_OnHit_1","Seraphine_Original_SFX_BasicAttack_OnHit_2"],"c":["Seraphine_Original_SFX_E_OnCast_0","Seraphine_Original_SFX_E_OnCast_1","Seraphine_Original_SFX_Q_OnCast_0","Seraphine_Original_SFX_Q_OnCast_1","Seraphine_Original_SFX_Q_OnCast_2","Seraphine_Original_SFX_R_OnCast_0","Seraphine_Original_SFX_R_OnCast_1","Seraphine_Original_SFX_R_OnCast_2","Seraphine_Original_SFX_R_cast","Seraphine_Original_SFX_W_OnCast"],"cm":["Seraphine_Original_SFX_R_OnMissileCast","Seraphine_Original_SFX_R_OnMissileLaunch"],"ch":["Seraphine_Original_SFX_R_hit_0","Seraphine_Original_SFX_R_hit_1","Seraphine_Original_SFX_R_hit_2"],"v":["Seraphine_Original_E_0","Seraphine_Original_E_1","Seraphine_Original_E_2","Seraphine_Original_Q_0","Seraphine_Original_Q_1","Seraphine_Original_Q_2","Seraphine_Original_Q_3","Seraphine_Original_Q_4","Seraphine_Original_R_0","Seraphine_Original_R_1","Seraphine_Original_W_0","Seraphine_Original_W_1","Seraphine_Original_W_2"],"va":["Seraphine_Original_Attack_0","Seraphine_Original_Attack_1","Seraphine_Original_Attack_10","Seraphine_Original_Attack_11","Seraphine_Original_Attack_12","Seraphine_Original_Attack_13","Seraphine_Original_Attack_14","Seraphine_Original_Attack_15","Seraphine_Original_Attack_16","Seraphine_Original_Attack_2","Seraphine_Original_Attack_3","Seraphine_Original_Attack_4","Seraphine_Original_Attack_5","Seraphine_Original_Attack_6"],"id":147},"6":{"a":["Mel_Original_SFX_BasicAttack_OnCast_0","Mel_Original_SFX_BasicAttack_OnCast_1","Mel_Original_SFX_BasicAttack_OnCast_2"],"am":["Mel_Original_SFX_BasicAttack_OnMissileLaunch_0","Mel_Original_SFX_BasicAttack_OnMissileLaunch_1","Mel_Original_SFX_BasicAttack_OnMissileLaunch_2"],"h":["Mel_Original_SFX_BasicAttack_OnHit_0","Mel_Original_SFX_BasicAttack_OnHit_1","Mel_Original_SFX_BasicAttack_OnHit_2"],"c":["Mel_Original_SFX_E_OnCast_0","Mel_Original_SFX_E_OnCast_1","Mel_Original_SFX_Q_OnCast_0","Mel_Original_SFX_Q_OnCast_1","Mel_Original_SFX_Q_OnCast_2","Mel_Original_SFX_R_OnCast_0","Mel_Original_SFX_R_OnCast_1","Mel_Original_SFX_R_OnCast_2","Mel_Original_SFX_W_OnCast_0","Mel_Original_SFX_W_OnCast_1","Mel_Original_SFX_W_OnCast_2","Mel_Original_SFX_W_OnCast_3"],"cm":["Mel_Original_SFX_E_OnMissileCast_0","Mel_Original_SFX_E_OnMissileCast_1","Mel_Original_SFX_Q_missilecast_0","Mel_Original_SFX_Q_missilecast_1","Mel_Original_SFX_Q_missilecast_2","Mel_Original_SFX_Q_missilecast_3","Mel_Original_SFX_Q_missilecast_4","Mel_Original_SFX_Q_missilecast_5"],"ch":["Mel_Original_SFX_Q_hit_0","Mel_Original_SFX_Q_hit_1","Mel_Original_SFX_Q_hit_2","Mel_Original_SFX_Q_hit_3","Mel_Original_SFX_Q_hit_4"],"v":["Mel_Original_E_0","Mel_Original_E_1","Mel_Original_E_2","Mel_Original_E_3","Mel_Original_E_4","Mel_Original_E_5","Mel_Original_E_6","Mel_Original_E_7","Mel_Original_Q_0","Mel_Original_Q_1","Mel_Original_Q_2","Mel_Original_Q_3","Mel_Original_R_0","Mel_Original_R_1"],"va":["Mel_Original_Attack_0","Mel_Original_Attack_1","Mel_Original_Attack_10","Mel_Original_Attack_11","Mel_Original_Attack_12","Mel_Original_Attack_13","Mel_Original_Attack_14","Mel_Original_Attack_15","Mel_Original_Attack_2","Mel_Original_Attack_3","Mel_Original_Attack_4","Mel_Original_Attack_5","Mel_Original_Attack_6","Mel_Original_Attack_7"],"id":800},"7":{"a":["Irelia_Original_SFX_BasicAttack_OnCast_0","Irelia_Original_SFX_BasicAttack_OnCast_1","Irelia_Original_SFX_BasicAttack_OnCast_2","Irelia_Original_SFX_BasicAttack_OnCast_3"],"am":[],"h":[],"c":["Irelia_Original_SFX_Q_OnCast_0","Irelia_Original_SFX_Q_OnCast_1","Irelia_Original_SFX_Q_OnCast_2","Irelia_Original_SFX_Q_OnCast_3","Irelia_Original_SFX_Q_OnCast_4","Irelia_Original_SFX_Q_OnCast_5","Irelia_Original_SFX_Q_OnCast_6","Irelia_Original_SFX_R_OnCast","Irelia_Original_SFX_W2_OnCast_0","Irelia_Original_SFX_W2_OnCast_1","Irelia_Original_SFX_W2_OnCast_10","Irelia_Original_SFX_W2_OnCast_2","Irelia_Original_SFX_W2_OnCast_3","Irelia_Original_SFX_W2_OnCast_4"],"cm":[],"ch":["Irelia_Original_SFX_Q_hit_0","Irelia_Original_SFX_Q_hit_1","Irelia_Original_SFX_Q_hit_2","Irelia_Original_SFX_Q_hit_3","Irelia_Original_SFX_Q_hit_4","Irelia_Original_SFX_Q_hit_5","Irelia_Original_SFX_Q_hit_6","Irelia_Original_SFX_R2_hit_0","Irelia_Original_SFX_R2_hit_1","Irelia_Original_SFX_R2_hit_2","Irelia_Original_SFX_R2_hit_3","Irelia_Original_SFX_R2_hit_4","Irelia_Original_SFX_R2_hit_5","Irelia_Original_SFX_R2_hit_6"],"v":["Riven_Original_E_0","Riven_Original_E_1","Riven_Original_E_2","Riven_Original_E_3","Riven_Original_Q1_0","Riven_Original_Q1_1","Riven_Original_Q1_2","Riven_Original_Q2_0","Riven_Original_Q2_1","Riven_Original_Q2_2","Riven_Original_Q3_0","Riven_Original_Q3_1","Riven_Original_Q3_2","Riven_Original_Q3_3"],"va":["Riven_Original_Attack_0","Riven_Original_Attack_1","Riven_Original_Attack_2","Riven_Original_Attack_3","Riven_Original_Attack_4","Riven_Original_Attack_5","Riven_Original_Attack_6"],"id":92},"8":{"a":["Milio_Original_SFX_BasicAttack_OnCast_0","Milio_Original_SFX_BasicAttack_OnCast_1","Milio_Original_SFX_BasicAttack_OnCast_2","Milio_Original_SFX_BasicAttack_OnCast_3"],"am":["Milio_Original_SFX_BasicAttack_OnMissileLaunch_0","Milio_Original_SFX_BasicAttack_OnMissileLaunch_1","Milio_Original_SFX_BasicAttack_OnMissileLaunch_2","Milio_Original_SFX_BasicAttack_OnMissileLaunch_3"],"h":["Milio_Original_SFX_BasicAttack_OnHit_0","Milio_Original_SFX_BasicAttack_OnHit_1","Milio_Original_SFX_BasicAttack_OnHit_2","Milio_Original_SFX_BasicAttack_OnHit_3"],"c":["Milio_Original_SFX_Q_OnCast_0","Milio_Original_SFX_Q_OnCast_1","Milio_Original_SFX_Q_OnCast_2","Milio_Original_SFX_R_OnCast_0","Milio_Original_SFX_R_OnCast_1","Milio_Original_SFX_R_OnCast_2"],"cm":["Milio_Original_SFX_Q_OnMissileLaunch_0","Milio_Original_SFX_Q_OnMissileLaunch_1","Milio_Original_SFX_Q_OnMissileLaunch_2"],"ch":["Milio_Original_SFX_Q2_hit_0","Milio_Original_SFX_Q2_hit_1","Milio_Original_SFX_Q2_hit_2","Milio_Original_SFX_R_hit_0","Milio_Original_SFX_R_hit_1","Milio_Original_SFX_R_hit_2","Milio_Original_SFX_R_hit_3"],"v":["Soraka_Original_R_0","Soraka_Original_R_1","Soraka_Original_R_2","Soraka_Original_R_3"],"va":["Soraka_Original_Attack_0","Soraka_Original_Attack_1","Soraka_Original_Attack_2","Soraka_Original_Attack_3","Soraka_Original_Attack_4","Soraka_Original_Attack_5","Soraka_Original_Attack_6"],"id":16},"9":{"a":["K'Sante_Original_SFX_BasicAttack_OnCast_0","K'Sante_Original_SFX_BasicAttack_OnCast_1","K'Sante_Original_SFX_BasicAttack_OnCast_2","K'Sante_Original_SFX_BasicAttack_OnCast_3"],"am":[],"h":["K'Sante_Original_SFX_BasicAttack_OnHit_0","K'Sante_Original_SFX_BasicAttack_OnHit_1","K'Sante_Original_SFX_BasicAttack_OnHit_2","K'Sante_Original_SFX_BasicAttack_OnHit_3"],"c":["K'Sante_Original_SFX_E_cast_0","K'Sante_Original_SFX_E_cast_1","K'Sante_Original_SFX_E_cast_2","K'Sante_Original_SFX_Q1_cast_0","K'Sante_Original_SFX_Q1_cast_1","K'Sante_Original_SFX_Q1_cast_2","K'Sante_Original_SFX_Q2_cast","K'Sante_Original_SFX_Q3_cast","K'Sante_Original_SFX_R_cast","K'Sante_Original_SFX_W_OnCast_0","K'Sante_Original_SFX_W_OnCast_1","K'Sante_Original_SFX_W_OnCast_2"],"cm":[],"ch":["K'Sante_Original_SFX_Q3_hit_0","K'Sante_Original_SFX_Q3_hit_1","K'Sante_Original_SFX_Q3_hit_2","K'Sante_Original_SFX_Q_hit_0","K'Sante_Original_SFX_Q_hit_1","K'Sante_Original_SFX_Q_hit_2"],"v":["Lee_Sin_Original_E1_0","Lee_Sin_Original_E1_1","Lee_Sin_Original_E1_2","Lee_Sin_Original_E1_3","Lee_Sin_Original_E2_0","Lee_Sin_Original_E2_1","Lee_Sin_Original_E2_2","Lee_Sin_Original_E2_3","Lee_Sin_Original_Q1_0","Lee_Sin_Original_Q1_1","Lee_Sin_Original_Q1_2","Lee_Sin_Original_Q1_3","Lee_Sin_Original_Q2_0","Lee_Sin_Original_Q2_1"],"va":["Lee_Sin_Original_Attack_0","Lee_Sin_Original_Attack_1","Lee_Sin_Original_Attack_10","Lee_Sin_Original_Attack_11","Lee_Sin_Original_Attack_12","Lee_Sin_Original_Attack_13","Lee_Sin_Original_Attack_14","Lee_Sin_Original_Attack_15","Lee_Sin_Original_Attack_16","Lee_Sin_Original_Attack_17","Lee_Sin_Original_Attack_18","Lee_Sin_Original_Attack_19","Lee_Sin_Original_Attack_2","Lee_Sin_Original_Attack_3"],"id":64},"10":{"a":["Volibear_Original_SFX_BasicAttack_OnCast_0","Volibear_Original_SFX_BasicAttack_OnCast_1","Volibear_Original_SFX_BasicAttack_OnCast_2","Volibear_Original_SFX_BasicAttack_OnCast_3"],"am":[],"h":[],"c":["Volibear_Original_SFX_E_OnCast","Volibear_Original_SFX_Q_OnCast_0","Volibear_Original_SFX_Q_OnCast_1","Volibear_Original_SFX_Q_OnCast_2","Volibear_Original_SFX_R_cast_0","Volibear_Original_SFX_R_cast_1","Volibear_Original_SFX_W_cast_0","Volibear_Original_SFX_W_cast_1","Volibear_Original_SFX_W_cast_2"],"cm":[],"ch":["Volibear_Original_SFX_E_hit","Volibear_Original_SFX_W_hit_0","Volibear_Original_SFX_W_hit_1","Volibear_Original_SFX_W_hit_2"],"v":["Volibear_Original_E_0","Volibear_Original_E_1","Volibear_Original_E_2","Volibear_Original_Q","Volibear_Original_R_0","Volibear_Original_R_1","Volibear_Original_R_2","Volibear_Original_R_3","Volibear_Original_W_0","Volibear_Original_W_1","Volibear_Original_W_2","Volibear_Original_W_3","Volibear_Original_W_4","Volibear_Original_W_5"],"va":["Volibear_Original_Attack_0","Volibear_Original_Attack_1","Volibear_Original_Attack_10","Volibear_Original_Attack_11","Volibear_Original_Attack_12","Volibear_Original_Attack_13","Volibear_Original_Attack_14","Volibear_Original_Attack_15","Volibear_Original_Attack_16","Volibear_Original_Attack_17","Volibear_Original_Attack_18","Volibear_Original_Attack_2","Volibear_Original_Attack_3","Volibear_Original_Attack_4"],"id":106},"11":{"a":["Trundle_Original_SFX_BasicAttack_OnCast_0","Trundle_Original_SFX_BasicAttack_OnCast_1","Trundle_Original_SFX_BasicAttack_OnCast_2","Trundle_Original_SFX_BasicAttack_OnCast_3"],"am":[],"h":[],"c":["Trundle_Original_SFX_E_OnCast_0","Trundle_Original_SFX_E_OnCast_1","Trundle_Original_SFX_E_OnCast_2","Trundle_Original_SFX_E_OnCast_3","Trundle_Original_SFX_Q_OnCast_0","Trundle_Original_SFX_Q_OnCast_1","Trundle_Original_SFX_Q_OnCast_2","Trundle_Original_SFX_Q_OnCast_3","Trundle_Original_SFX_R_OnCast_0","Trundle_Original_SFX_R_OnCast_1","Trundle_Original_SFX_R_OnCast_2","Trundle_Original_SFX_R_OnCast_3","Trundle_Original_SFX_W_OnCast_0","Trundle_Original_SFX_W_OnCast_1"],"cm":[],"ch":["Trundle_Original_SFX_Q_OnHit_0","Trundle_Original_SFX_Q_OnHit_1","Trundle_Original_SFX_Q_OnHit_2","Trundle_Original_SFX_Q_OnHit_3"],"v":["Sejuani_Original_Q_0","Sejuani_Original_Q_1","Sejuani_Original_Q_2","Sejuani_Original_Q_3","Sejuani_Original_Q_4","Sejuani_Original_Q_5","Sejuani_Original_R_0","Sejuani_Original_R_1","Sejuani_Original_W_0","Sejuani_Original_W_1","Sejuani_Original_W_2","Sejuani_Original_W_3","Sejuani_Original_W_4"],"va":["Sejuani_Original_Attack_0","Sejuani_Original_Attack_1","Sejuani_Original_Attack_10","Sejuani_Original_Attack_11","Sejuani_Original_Attack_12","Sejuani_Original_Attack_13","Sejuani_Original_Attack_2","Sejuani_Original_Attack_3","Sejuani_Original_Attack_4","Sejuani_Original_Attack_5","Sejuani_Original_Attack_6","Sejuani_Original_Attack_7","Sejuani_Original_Attack_8","Sejuani_Original_Attack_9"],"id":113},"12":{"a":["Zaahen_Original_SFX_BasicAttack_OnCast_0","Zaahen_Original_SFX_BasicAttack_OnCast_1","Zaahen_Original_SFX_BasicAttack_OnCast_2"],"am":[],"h":[],"c":["Zaahen_Original_SFX_E_OnCast_0","Zaahen_Original_SFX_E_OnCast_1","Zaahen_Original_SFX_Q2_OnCast_0","Zaahen_Original_SFX_Q2_OnCast_1","Zaahen_Original_SFX_Q_OnCast_0","Zaahen_Original_SFX_Q_OnCast_1","Zaahen_Original_SFX_R_OnCast","Zaahen_Original_SFX_W_OnCast_0","Zaahen_Original_SFX_W_OnCast_1"],"cm":["Zaahen_Original_SFX_W_OnMissileLaunch_0","Zaahen_Original_SFX_W_OnMissileLaunch_1"],"ch":["Zaahen_Original_SFX_W_hit_0","Zaahen_Original_SFX_W_hit_1","Zaahen_Original_SFX_W_hit_2"],"v":["Zaahen_Original_E_0","Zaahen_Original_E_1","Zaahen_Original_R_0","Zaahen_Original_R_1","Zaahen_Original_R_2","Zaahen_Original_R_3","Zaahen_Original_R_4","Zaahen_Original_W_0","Zaahen_Original_W_1"],"va":["Zaahen_Original_Attack_0","Zaahen_Original_Attack_1","Zaahen_Original_Attack_10","Zaahen_Original_Attack_11","Zaahen_Original_Attack_12","Zaahen_Original_Attack_13","Zaahen_Original_Attack_14","Zaahen_Original_Attack_15","Zaahen_Original_Attack_16","Zaahen_Original_Attack_17","Zaahen_Original_Attack_18","Zaahen_Original_Attack_19","Zaahen_Original_Attack_2","Zaahen_Original_Attack_3"],"id":904}};
    const GENERIC_HIT = ['Kled_Original_SFX_BasicAttack_OnHit_Flesh_0', 'Kled_Original_SFX_BasicAttack_OnHit_Flesh_1', 'Kled_Original_SFX_BasicAttack_OnHit_Flesh_2'];
    const MELEE = new Set([0, 2, 4, 7, 9, 10, 11, 12]), TANKS = new Set([0, 7]);
    for (const [t, c] of Object.entries(CHAMP_SFX)) {
        for (const k of ['a', 'am', 'c', 'cm', 'ch', 'v', 'va', 'purr', 'reset']) if (c[k]?.length) SFX_FILES['c' + t + k] = c[k];
        SFX_FILES['c' + t + 'h'] = c.h.length ? c.h : MELEE.has(+t) ? GENERIC_HIT : c.ch;
    }
    SFX_FILES.recallEnd = ['Recall_SFX_3']; SFX_FILES.teleportEnd = ['Teleport_SFX_2']; SFX_FILES.omw = ['On_My_Way_ping_SFX'];
    for (const [t, d] of Object.entries({"0":{"death":["Pantheon_Original_Death_0","Pantheon_Original_Death_2","Pantheon_Original_Death_1"],"respawn":["Pantheon_Original_Respawn_1","Pantheon_Original_Respawn_3","Pantheon_Original_Respawn_0","Pantheon_Original_Respawn_5","Pantheon_Original_Respawn_2","Pantheon_Original_Respawn_4"]},"1":{"death":["Vayne_Original_Death_3","Vayne_Original_Death_2","Vayne_Original_Death_0","Vayne_Original_Death_1"],"respawn":[]},"2":{"death":["Akali_Original_Death_2","Akali_Original_Death_1","Akali_Original_Death_0","Akali_Original_Death_3"],"respawn":["Akali_Original_Respawn_2","Akali_Original_Respawn_4","Akali_Original_Respawn_0","Akali_Original_Respawn_3","Akali_Original_Respawn_1"]},"3":{"death":["Yuumi_Original_Death_3","Yuumi_Original_Death_0","Yuumi_Original_Death_2","Yuumi_Original_Death_4","Yuumi_Original_Death_1"],"respawn":["Yuumi_Original_Respawn_0","Yuumi_Original_Respawn_1"]},"4":{"death":["Nidalee_Original_Death_2","Nidalee_Original_Death_3","Nidalee_Original_Death_0","Nidalee_Original_Death_1"],"respawn":["Nidalee_Original_Respawn_4","Nidalee_Original_Respawn_2","Nidalee_Original_Respawn_3","Nidalee_Original_Respawn_0","Nidalee_Original_Respawn_1"]},"5":{"death":["Seraphine_Original_Death_0","Seraphine_Original_Death_2","Seraphine_Original_Death_1"],"respawn":["Seraphine_Original_Respawn_2","Seraphine_Original_Respawn_1","Seraphine_Original_Respawn_4","Seraphine_Original_Respawn_5","Seraphine_Original_Respawn_3","Seraphine_Original_Respawn_0"]},"6":{"death":["Mel_Original_Death_4","Mel_Original_Death_1","Mel_Original_Death_0","Mel_Original_Death_2","Mel_Original_Death_3"],"respawn":["Mel_Original_Respawn_0","Mel_Original_Respawn_1","Mel_Original_Respawn_2","Mel_Original_Respawn_3","Mel_Original_Respawn_5","Mel_Original_Respawn_4"]},"7":{"death":["Riven_Original_Death_1","Riven_Original_Death_3","Riven_Original_Death_0","Riven_Original_Death_2"],"respawn":[]},"8":{"death":["Soraka_Original_Death_0","Soraka_Original_Death_2","Soraka_Original_Death_1","Soraka_Original_Death_3"],"respawn":[]},"9":{"death":["Lee_Sin_Original_Death_6","Lee_Sin_Original_Death_0","Lee_Sin_Original_Death_4","Lee_Sin_Original_Death_5","Lee_Sin_Original_Death_2","Lee_Sin_Original_Death_3","Lee_Sin_Original_Death_1"],"respawn":["Lee_Sin_Original_Respawn_2","Lee_Sin_Original_Respawn_0","Lee_Sin_Original_Respawn_1"]},"10":{"death":["Volibear_Original_Death_1","Volibear_Original_Death_0","Volibear_Original_Death_3","Volibear_Original_Death_2"],"respawn":["Volibear_Original_Respawn_2","Volibear_Original_Respawn_0","Volibear_Original_Respawn_1"]},"11":{"death":["Sejuani_Original_Death_0","Sejuani_Original_Death_1","Sejuani_Original_Death_2","Sejuani_Original_Death_3"],"respawn":[]},"12":{"death":["Zaahen_Original_Death_3","Zaahen_Original_Death_1","Zaahen_Original_Death_2","Zaahen_Original_Death_0"],"respawn":["Zaahen_Original_Respawn_0","Zaahen_Original_Respawn_4","Zaahen_Original_Respawn_3","Zaahen_Original_Respawn_1","Zaahen_Original_Respawn_2"]}})) { if (d.death.length) SFX_FILES['c' + t + 'death'] = d.death; if (d.respawn.length) SFX_FILES['c' + t + 'respawn'] = d.respawn; }
    for (const k of ['First', 'Double', 'Triple', 'Quadra', 'Penta']) SFX_FILES['melody' + k] = ['Killstreak_SFX_Multikill_Melody_' + k];
    for (const [k, n] of Object.entries({ bgmEarly: ["Summoner's_Rift_Bloom_Early_0", "Summoner's_Rift_Bloom_Early_1"], bgmMid: ["Summoner's_Rift_Bloom_Mid"], bgmLate: ["Summoner's_Rift_Bloom_Late_0", "Summoner's_Rift_Bloom_Late_1"] })) SFX_FILES[k] = n;
    // League client sounds from CommunityDragon (CORS *): the in-game gold/shop sounds aren't hosted anywhere, these are
    // Riot's own coin / purchase cues
    const CD = 'https://raw.communitydragon.org/latest/plugins/';
    SFX_FILES.gold = [CD + 'rcp-be-lol-game-data/global/default/assets/ux/tft/troves_ceremonies/default/audio/sfx-treasuretroves-spend-coin-single.ogg'];
    SFX_FILES.goldBig = [CD + 'rcp-be-lol-game-data/global/default/assets/ux/tft/troves_ceremonies/default/audio/sfx-treasuretroves-spend-coin-multi.ogg'];
    SFX_FILES.buy = [CD + 'rcp-fe-lol-clash/global/default/assets/audio/sfx-clash-purchase-click.ogg'];
    const sfxSrc = key => { const l = SFX_FILES[key]; if (!l) return null; const n = l[Math.floor(Math.random() * l.length)];
        return n.startsWith('https://') ? n : SFX_BASE + encodeURIComponent(n) + '.ogg'; };
    const live = new Set();
    function sfx(key, { vol = 1, rate = 1, tag, loud = false, near = false, onscreen = false, src: given } = {}) {
        if (!sfxOn() || muted()) return null;
        const src = given || sfxSrc(key); if (!src) return null;
        if (live.size > 18 && !loud) return null; // never a wall of sound (kill chimes always get through)
        let base = sfxCache.get(src);
        if (!base) { base = new Audio(src); base.preload = 'auto'; sfxCache.set(src, base); }
        const a = base.readyState >= 2 ? base.cloneNode() : base;
        const pg = near ? nearGain(soundAt?.x, soundAt?.y) : soundAt ? posGain(soundAt.x, soundAt.y) : 1;
        // on-screen-only sounds (teleports) start silent off screen, and fade up if the camera arrives while they play
        let g0 = onscreen && soundAt ? (pg > 1 ? pg : 0) : pg;
        // a placed sound starts a bit louder than where it is would say (so its start isn't missed), then the tracker
        // below eases it to its real level over about a second
        if (soundAt && key && /^(recall|teleport|c\d+(death|respawn|v|va)$)/.test(key)) g0 = Math.max(g0, near ? 0.25 : 0.45); // channels and voice lines only: attacks are too short to settle
        a.volume = Math.max(0, Math.min(1, (loud ? volume() : sfxVolume()) * vol * g0));
        // every placed sound follows the camera while it plays: a channel or voice line gets louder as the camera
        // moves onto it (and quieter as it leaves), not just whatever it was when it started
        if (soundAt) a._track = { at: soundAt, vol, loud, mode: near ? 'near' : onscreen ? 'onscreen' : 'pos' };
        a.playbackRate = Math.max(0.5, Math.min(4, rate));
        a.preservesPitch = false;
        a.dataset.tag = tag || '';
        live.add(a);
        a.onended = a.onerror = () => live.delete(a);
        a.play().catch(() => live.delete(a));
        return a;
    }
    // Original League sounds for the champions the wiki lacks, ripped from the game's sound banks and kept in the
    // ultra-secret-pantheon-tech repo's sfx/ (see fetchLocal). Each event is a tree: a number = one sound file, {one: [...]} =
    // pick one, {all: [...]} = layered, played together, the way Wwise does it.
    const LOCAL_SFX = {"0":{"dir":"pantheon","attack":{"cast":["Pantheon_PantheonBasicAttack_OnCast","Pantheon_PantheonBasicAttack2_OnCast","Pantheon_PantheonBasicAttack3_OnCast","Pantheon_PantheonCritAttack_OnCast"],"missile":[],"hit":["Pantheon_PantheonBasicAttack_OnHit","Pantheon_PantheonBasicAttack2_OnHit","Pantheon_PantheonBasicAttack3_OnHit","Pantheon_PantheonCritAttack_OnHit"]},"abilities":[{"cast":["Pantheon_PantheonE_OnBuffActivate","Pantheon_PantheonE_OnCast","Pantheon_PantheonEShieldSlam_OnCast"],"missile":[],"hit":["Pantheon_PantheonE_hit_lua","Pantheon_PantheonEShieldSlam_hit_lua"]},{"cast":["Pantheon_PantheonPassiveReady_OnBuffActivate"],"missile":[],"hit":[]},{"cast":["Pantheon_PantheonQ_buffactivate_empowered_vfx","Pantheon_PantheonQ_buffactivate_vfx","Pantheon_PantheonQ_OnCast","Pantheon_PantheonQTap_cast_empowered_lua","Pantheon_PantheonQTap_cast_lua"],"missile":["Pantheon_PantheonQ_missilecast_empowered_lua","Pantheon_PantheonQMissile_hit_empowered_vfx","Pantheon_PantheonQMissile_hit_vfx","Pantheon_PantheonQMissile_missilecast_lua","Pantheon_PantheonQMissile_OnCast","Pantheon_PantheonQMissile_OnMissileLaunch"],"hit":["Pantheon_PantheonQ_groundhit_vfx","Pantheon_PantheonQTap_hit_empowered_vfx","Pantheon_PantheonQTap_hit_vfx"]},{"cast":["Pantheon_PantheonR_buffactivate_vfx","Pantheon_PantheonR_OnCast","Pantheon_PantheonR_OnCast_blast_stereo_vfx","Pantheon_PantheonR_OnCast_stereo"],"missile":["Pantheon_PantheonRMissile_OnMissileLaunch","Pantheon_PantheonRMissile3_OnMissileLaunch"],"hit":["Pantheon_PantheonR_land_vfx"]},{"cast":["Pantheon_PantheonW_OnCast"],"missile":[],"hit":["Pantheon_PantheonW_hit","Pantheon_PantheonWEmpoweredAttack_hit_vfx"]}],"reset":null,"trees":{"Pantheon_PantheonQ_groundhit_vfx":{"one":[60336224,764949782,686751538]},"Pantheon_PantheonEShieldSlam_hit_lua":{"one":[1069232639,1027135903]},"Pantheon_PantheonR_buffactivate_vfx":685244675,"Pantheon_PantheonCritAttack_OnHit":{"one":[652534336,652534336,652534336,652534336]},"Pantheon_PantheonQTap_hit_vfx":{"one":[159441603,113966397,209183813,52321619]},"Pantheon_PantheonE_OnBuffActivate":216835116,"Pantheon_PantheonRMissile_OnMissileLaunch":67580815,"Pantheon_PantheonQMissile_hit_vfx":{"one":[{"one":[159441603,113966397,209183813,52321619]},{"one":[52321619,113966397,209183813,159441603]}]},"Pantheon_PantheonW_hit":{"one":[1065376863,702608173,58241021]},"Pantheon_PantheonQTap_hit_empowered_vfx":{"one":[1035332353,524410692,28829235]},"Pantheon_PantheonQ_buffactivate_vfx":849927174,"Pantheon_PantheonR_OnCast":941465106,"Pantheon_PantheonBasicAttack3_OnCast":{"one":[925816583,700740698,271153528]},"Pantheon_PantheonR_OnCast_blast_stereo_vfx":840596375,"Pantheon_PantheonR_OnCast_stereo":3911959,"Pantheon_PantheonPassiveReady_OnBuffActivate":1066137298,"Pantheon_PantheonE_hit_lua":{"one":[796636803,575167413,462289838,476998396]},"Pantheon_PantheonQ_missilecast_empowered_lua":303479068,"Pantheon_PantheonBasicAttack2_OnHit":{"one":[{"one":[932774674,416588423,860475167]},{"one":[711924793,154032094,151472812]},{"one":[463979481,988936807,307746730]},{"one":[960111904,648136092,253166563]}]},"Pantheon_PantheonQTap_cast_lua":{"one":[800651771,179240518,31367315]},"Pantheon_PantheonE_OnCast":{"one":[725704520,444555528]},"Pantheon_PantheonQMissile_OnMissileLaunch":{"one":[384655715,760559825,921683591]},"Pantheon_PantheonQMissile_missilecast_lua":{"one":[983799119,984239308,574046849]},"Pantheon_PantheonRMissile3_OnMissileLaunch":1013463044,"Pantheon_PantheonQ_OnCast":{"all":[{"one":[137547784,695403388,377780128]},{"one":[947306085,548517914,765049069]}]},"Pantheon_PantheonQMissile_hit_empowered_vfx":{"one":[524410692,1035332353,28829235]},"Pantheon_PantheonQ_buffactivate_empowered_vfx":373734925,"Pantheon_PantheonBasicAttack3_OnHit":{"one":[{"one":[159928379,15461235,136986521]},{"one":[72523275,53923318,76265310]},{"one":[208197651,106715538,81885346]},{"one":[297592160,118759468,165590441]}]},"Pantheon_PantheonQMissile_OnCast":{"one":[746138356,274577126,110947429]},"Pantheon_PantheonEShieldSlam_OnCast":{"one":[822059435,791165126]},"Pantheon_PantheonR_land_vfx":931137241,"Pantheon_PantheonBasicAttack2_OnCast":{"one":[670184489,679766162,818947808]},"Pantheon_PantheonCritAttack_OnCast":123097416,"Pantheon_PantheonWEmpoweredAttack_hit_vfx":{"one":[53923318,76265310,72523275]},"Pantheon_PantheonW_OnCast":{"one":[1046891786,201023699,215130155]},"Pantheon_PantheonBasicAttack_OnHit":{"one":[{"one":[15461235,136986521,159928379]},{"one":[208197651,106715538,81885346]},{"one":[118759468,165590441,297592160]},{"one":[53923318,72523275,76265310]}]},"Pantheon_PantheonQTap_cast_empowered_lua":{"one":[798699582,181528245,976934516]},"Pantheon_PantheonBasicAttack_OnCast":{"one":[678732111,608615584,674109136]}}},"1":{"dir":"vayne","attack":{"cast":["Vayne_VayneBasicAttack_OnCast","Vayne_VayneBasicAttack2_OnCast","Vayne_VayneCritAttack_OnCast"],"missile":["Vayne_VayneBasicAttack_OnMissileCast","Vayne_VayneBasicAttack_OnMissileLaunch","Vayne_VayneBasicAttack2_OnMissileCast","Vayne_VayneBasicAttack2_OnMissileLaunch","Vayne_VayneCritAttack_OnMissileCast","Vayne_VayneCritAttack_OnMissileLaunch"],"hit":["Vayne_VayneBasicAttack_OnHit","Vayne_VayneBasicAttack2_OnHit","Vayne_VayneCritAttack_OnHit"]},"abilities":[{"cast":["Vayne_VayneCondemn_OnCast"],"missile":[],"hit":[]},{"cast":["Vayne_VayneInquisition_OnBuffActivate","Vayne_VayneInquisition_OnCast"],"missile":[],"hit":[]},{"cast":["Vayne_VayneSilveredBolts_OnBuffActivate"],"missile":[],"hit":["Vayne_VayneSilveredBolts_hit"]},{"cast":["Vayne_VayneTumble_OnCast"],"missile":["Vayne_VayneTumbleAttack_OnMissileCast","Vayne_VayneTumbleAttack_OnMissileLaunch"],"hit":["Vayne_VayneTumbleAttack_OnHit"]},{"cast":["Vayne_VayneTumbleBonus_OnBuffActivate"],"missile":[],"hit":[]},{"cast":["Vayne_VayneTumbleFade_cast","Vayne_VayneTumbleFade_OnBuffActivate"],"missile":[],"hit":[]},{"cast":[],"missile":["Vayne_VayneTumbleUltAttack_OnMissileCast","Vayne_VayneTumbleUltAttack_OnMissileLaunch"],"hit":["Vayne_VayneTumbleUltAttack_OnHit"]},{"cast":[],"missile":["Vayne_VayneUltAttack_OnMissileCast","Vayne_VayneUltAttack_OnMissileLaunch"],"hit":["Vayne_VayneUltAttack_OnHit"]}],"reset":null,"trees":{"Vayne_VayneCritAttack_OnMissileCast":{"one":[858317852,307834028,762469176,1056627444]},"Vayne_VayneTumbleAttack_OnMissileCast":{"one":[37718103,50337729,14246601,13612511]},"Vayne_VayneBasicAttack_OnCast":{"one":[451644541,390348802,936660255,927627729]},"Vayne_VayneInquisition_OnBuffActivate":109391976,"Vayne_VayneTumbleAttack_OnHit":{"one":[83240567,74669178,64817339,88178450]},"Vayne_VayneInquisition_OnCast":{"one":[158680766,182527156]},"Vayne_VayneBasicAttack2_OnCast":{"one":[451644541,390348802,936660255,927627729]},"Vayne_VayneTumbleAttack_OnMissileLaunch":{"one":[255125085,745986705,655846613]},"Vayne_VayneCondemn_OnCast":{"one":[944053877,800132908]},"Vayne_VayneBasicAttack2_OnHit":{"one":[{"one":[186195165,219703034,110515624,81917006]},{"one":[88178450,83240567,74669178,64817339]},{"one":[204963341,215013723,35664379,117258077]},{"one":[114775571,86796252,84063295,169614008]}]},"Vayne_VayneUltAttack_OnMissileLaunch":{"one":[8384792,99351884,21552621]},"Vayne_VayneBasicAttack_OnHit":{"one":[{"one":[186195165,219703034,110515624,81917006]},{"one":[88178450,83240567,74669178,64817339]},{"one":[204963341,215013723,35664379,117258077]},{"one":[114775571,86796252,84063295,169614008]}]},"Vayne_VayneTumbleBonus_OnBuffActivate":{"one":[301657218,860409735,221112918,26378607]},"Vayne_VayneSilveredBolts_hit":{"one":[932090207,922163445,439656909,586981609]},"Vayne_VayneTumbleUltAttack_OnHit":{"one":[83240567,88178450,74669178,64817339]},"Vayne_VayneTumbleFade_OnBuffActivate":422088173,"Vayne_VayneCritAttack_OnMissileLaunch":{"one":[21552621,8384792,99351884]},"Vayne_VayneBasicAttack_OnMissileCast":{"one":[858317852,307834028,762469176,1056627444]},"Vayne_VayneCritAttack_OnHit":{"one":[{"one":[186195165,219703034,110515624,81917006]},{"one":[88178450,83240567,74669178,64817339]},{"one":[204963341,215013723,35664379,117258077]},{"one":[114775571,86796252,84063295,169614008]}]},"Vayne_VayneTumbleFade_cast":17276274,"Vayne_VayneTumbleUltAttack_OnMissileLaunch":{"one":[832725590,750684056,868217415]},"Vayne_VayneUltAttack_OnHit":{"one":[{"one":[117258077,215013723,35664379,204963341]},{"one":[83240567,64817339,88178450,74669178]},{"one":[114775571,84063295,169614008,86796252]},{"one":[186195165,110515624,219703034,81917006]}]},"Vayne_VayneUltAttack_OnMissileCast":{"one":[50337729,14246601,37718103,13612511]},"Vayne_VayneBasicAttack2_OnMissileCast":{"one":[858317852,307834028,762469176,1056627444]},"Vayne_VayneBasicAttack2_OnMissileLaunch":{"one":[21552621,8384792,99351884]},"Vayne_VayneTumbleUltAttack_OnMissileCast":{"one":[37718103,14246601,50337729,13612511]},"Vayne_VayneSilveredBolts_OnBuffActivate":{"one":[710344357,477899570]},"Vayne_VayneCritAttack_OnCast":{"one":[451644541,390348802,936660255,927627729]},"Vayne_VayneTumble_OnCast":{"one":[425809301,777142544]},"Vayne_VayneBasicAttack_OnMissileLaunch":{"one":[21552621,8384792,99351884]}}},"2":{"dir":"akali","attack":{"cast":["Akali_AkaliBasicAttack_OnCast","Akali_AkaliBasicAttack2_OnCast","Akali_AkaliCritAttack_OnCast"],"missile":[],"hit":["Akali_AkaliBasicAttack_OnHit","Akali_AkaliBasicAttack2_OnHit","Akali_AkaliCritAttack_OnHit"]},"abilities":[{"cast":["Akali_AkaliBasicAttackPassive_OnCast"],"missile":[],"hit":["Akali_AkaliBasicAttackPassive_OnHit"]},{"cast":["Akali_AkaliBasicAttackPassiveMelee_OnCast"],"missile":[],"hit":["Akali_AkaliBasicAttackPassiveMelee_OnHit"]},{"cast":["Akali_AkaliE_OnCast","Akali_AkaliEb_leap","Akali_AkaliEb_OnCast","Akali_AkaliEbattack_cast"],"missile":["Akali_AkaliEmis_cloudhit","Akali_AkaliEmis_Hit","Akali_AkaliEmis_land","Akali_AkaliEmis_OnMissileLaunch"],"hit":["Akali_AkaliEbattack_hit"]},{"cast":["Akali_AkaliP_Activate_Enemy"],"missile":[],"hit":[]},{"cast":["Akali_AkaliQ_OnCast"],"missile":[],"hit":["Akali_AkaliQ_hit","Akali_AkaliQ_hitchamp"]},{"cast":["Akali_AkaliR_Cast","Akali_AkaliRb_OnCast"],"missile":[],"hit":["Akali_AkaliR1_hit","Akali_AkaliRb_hit"]},{"cast":["Akali_AkaliW_OnCastSelf"],"missile":[],"hit":[]}],"reset":null,"trees":{"Akali_AkaliCritAttack_OnCast":{"one":[23495922,923067162,321278838,486118859]},"Akali_AkaliE_OnCast":{"all":[82240103,{"one":[{"one":[101861154,975008152]},{"one":[1004237332,141037606]},{"one":[354293603,920677043]},{"one":[1043732125,63313962]}]}]},"Akali_AkaliBasicAttack2_OnHit":{"one":[{"one":[918119877,234456189,831487944]},{"one":[713359089,124899942]},{"one":[385135244,385948444,574041685]},{"one":[519461415,706997427,1029389910]}]},"Akali_AkaliBasicAttackPassive_OnHit":159779918,"Akali_AkaliBasicAttackPassiveMelee_OnHit":{"one":[93029849,667261485,82882657]},"Akali_AkaliEb_OnCast":{"all":[{"one":[134248121,1028774435]},{"one":[{"one":[82186116,577421648,207090715,478284180]},{"one":[49265495,248228862,771960282,208412186]},{"one":[322743681,242449759,581616741]},{"one":[542293077,874018544,275716102]}]}]},"Akali_AkaliBasicAttack_OnHit":{"one":[{"one":[918119877,234456189,831487944]},{"one":[713359089,124899942]},{"one":[385135244,385948444,574041685]},{"one":[519461415,706997427,1029389910]}]},"Akali_AkaliQ_hit":{"one":[1027930554,1009640620,1072578208,265588149]},"Akali_AkaliEb_leap":824285208,"Akali_AkaliEmis_cloudhit":849567779,"Akali_AkaliP_Activate_Enemy":676195672,"Akali_AkaliR1_hit":{"one":[675334627,909588499]},"Akali_AkaliW_OnCastSelf":{"all":[686018435,{"all":[{"all":[173253536,382766537]},446736334,765855400]}]},"Akali_AkaliRb_hit":895445165,"Akali_AkaliBasicAttackPassive_OnCast":645964678,"Akali_AkaliEmis_land":{"one":[842825051,478490523]},"Akali_AkaliEbattack_hit":943091896,"Akali_AkaliR_Cast":{"one":[{"one":[628296178,434544887]},{"one":[732398204,526280895]},{"one":[40571530,1145005]},{"one":[602112401,334120865]}]},"Akali_AkaliEmis_Hit":14071628,"Akali_AkaliEbattack_cast":{"one":[242301384,127540079]},"Akali_AkaliBasicAttack2_OnCast":{"one":[23495922,923067162,321278838,486118859]},"Akali_AkaliRb_OnCast":527355819,"Akali_AkaliBasicAttackPassiveMelee_OnCast":{"one":[188278679,836068361]},"Akali_AkaliQ_hitchamp":{"one":[232190810,1037162262]},"Akali_AkaliCritAttack_OnHit":{"one":[{"one":[918119877,234456189,831487944]},{"one":[713359089,124899942]},{"one":[385135244,385948444,574041685]},{"one":[519461415,706997427,1029389910]}]},"Akali_AkaliEmis_OnMissileLaunch":{"one":[531094658,715318236,431086410]},"Akali_AkaliQ_OnCast":{"one":[195345266,797687864,246249177]},"Akali_AkaliBasicAttack_OnCast":{"one":[23495922,923067162,321278838,486118859]}}},"3":{"dir":"yuumi","attack":{"cast":["Yuumi_YuumiBasicAttack_OnCast","Yuumi_YuumiBasicAttack2_OnCast","Yuumi_YuumiCritAttack_OnCast"],"missile":[],"hit":["Yuumi_YuumiBasicAttack_OnHit","Yuumi_YuumiBasicAttack2_OnHit","Yuumi_YuumiCritAttack_OnHit"]},"abilities":[{"cast":["Yuumi_YuumiE_cast","Yuumi_YuumiE_Cast","Yuumi_YuumiEShield_buffactivate"],"missile":[],"hit":[]},{"cast":["Yuumi_YuumiR_OnCast"],"missile":["Yuumi_YuumiRmissile_OnMissileCast"],"hit":["Yuumi_YuumiRmissile_hit1","Yuumi_YuumiRmissile_OnHit"]}],"reset":null,"trees":{"Yuumi_YuumiRmissile_hit1":{"one":[1041224608,524073350]},"Yuumi_YuumiCritAttack_OnCast":{"one":[511589586,807961678,920984115,767760218]},"Yuumi_YuumiBasicAttack2_OnHit":{"one":[192674043,125257069,896469814,911548260,853979302]},"Yuumi_YuumiEShield_buffactivate":984154951,"Yuumi_YuumiR_OnCast":787763408,"Yuumi_YuumiE_cast":{"one":[276548769,83998200,178577564]},"Yuumi_YuumiRmissile_OnMissileCast":{"one":[758644368,510893932,802612546,494768648]},"Yuumi_YuumiE_Cast":{"one":[276548769,83998200,178577564]},"Yuumi_YuumiBasicAttack2_OnCast":{"one":[511589586,807961678,920984115,767760218]},"Yuumi_YuumiRmissile_OnHit":{"one":[114077466,574358253]},"Yuumi_YuumiBasicAttack_OnCast":{"one":[511589586,807961678,920984115,767760218]},"Yuumi_YuumiCritAttack_OnHit":{"one":[192674043,125257069,896469814,911548260,853979302]},"Yuumi_YuumiBasicAttack_OnHit":{"one":[192674043,125257069,896469814,911548260,853979302]}}},"4":{"dir":"nidalee","attack":{"cast":["NidaleeCougar_NidaleeCougarBasicAttack_OnCast","NidaleeCougar_NidaleeCougarBasicAttack2_OnCast","NidaleeCougar_NidaleeCougarCritAttack_OnCast"],"missile":[],"hit":["NidaleeCougar_NidaleeCougarBasicAttack_OnHit","NidaleeCougar_NidaleeCougarBasicAttack2_OnHit","NidaleeCougar_NidaleeCougarCritAttack_OnHit"]},"abilities":[{"cast":["NidaleeCougar_Pounce_markjump","NidaleeCougar_Pounce_OnCast"],"missile":[],"hit":["NidaleeCougar_Pounce_hit","NidaleeCougar_Pounce_land"]}],"reset":{"cast":["NidaleeCougar_NidaleeTakedownAttack_OnCast","NidaleeCougar_Takedown_OnBuffActivate","NidaleeCougar_Takedown_OnCast"],"missile":[],"hit":["NidaleeCougar_NidaleeTakedownAttack_OnHit"]},"trees":{"NidaleeCougar_NidaleeCougarBasicAttack2_OnCast":{"one":[280658951,123175306,355831079,3505277]},"NidaleeCougar_NidaleeTakedownAttack_OnCast":{"one":[898259801,459397109,515742304,690012534]},"NidaleeCougar_NidaleeTakedownAttack_OnHit":{"one":[354830396,934717786,1001408241,385615812]},"NidaleeCougar_NidaleeCougarBasicAttack_OnCast":{"one":[280658951,123175306,355831079,3505277]},"NidaleeCougar_Pounce_land":{"one":[617650108,451344699,881689960,337585229]},"NidaleeCougar_NidaleeCougarCritAttack_OnHit":{"one":[{"one":[247718094,198883835,98653715,518132936]},{"one":[380821681,285044375,120126054,414125210]},{"one":[53797652,135193943,96315131,82762021]},{"one":[1609643,3782545,3558524,150320671]}]},"NidaleeCougar_NidaleeCougarBasicAttack_OnHit":{"one":[{"one":[285044375,380821681,120126054,414125210]},{"one":[1609643,3558524,150320671,3782545]},{"one":[98653715,247718094,198883835,518132936]},{"one":[82762021,135193943,96315131,53797652]}]},"NidaleeCougar_Pounce_markjump":{"one":[1018287005,361195150,228120898]},"NidaleeCougar_Pounce_OnCast":{"one":[339484361,845063598,247107836,731035274,857424827,1036628791]},"NidaleeCougar_Pounce_hit":{"one":[826520621,76470249,106745466,477372588]},"NidaleeCougar_Takedown_OnBuffActivate":748378560,"NidaleeCougar_NidaleeCougarBasicAttack2_OnHit":{"one":[{"one":[285044375,380821681,120126054,414125210]},{"one":[1609643,3558524,150320671,3782545]},{"one":[98653715,247718094,198883835,518132936]},{"one":[82762021,135193943,96315131,53797652]}]},"NidaleeCougar_NidaleeCougarCritAttack_OnCast":{"one":[123175306,355831079,280658951,3505277]},"NidaleeCougar_Takedown_OnCast":{"one":[666807762,594980186,522414047]}}},"5":{"dir":"seraphine","attack":{"cast":["Seraphine_SeraphineBasicAttack_OnCast","Seraphine_SeraphineBasicAttack2_OnCast","Seraphine_SeraphineCritAttack_OnCast"],"missile":["Seraphine_SeraphineBasicAttack_OnMissileLaunch","Seraphine_SeraphineBasicAttack2_OnMissileLaunch","Seraphine_SeraphineCritAttack_OnMissileLaunch"],"hit":["Seraphine_SeraphineBasicAttack_OnHit","Seraphine_SeraphineBasicAttack2_OnHit","Seraphine_SeraphineCritAttack_OnHit"]},"abilities":[{"cast":["Seraphine_SeraphineE_OnCast","Seraphine_SeraphineECastEcho_OnCast","Seraphine_SeraphineERoot_OnBuffActivate","Seraphine_SeraphineEStun_OnBuffActivate"],"missile":["Seraphine_SeraphineEMissile_OnHit","Seraphine_SeraphineEMissile_OnMissileLaunch"],"hit":[]},{"cast":["Seraphine_SeraphinePassiveAttack_OnCast"],"missile":["Seraphine_SeraphinePassiveAttack_OnMissileLaunch"],"hit":["Seraphine_SeraphinePassiveAttack_OnHit"]},{"cast":["Seraphine_SeraphinePassiveEchoStage2_OnBuffActivate"],"missile":[],"hit":[]},{"cast":["Seraphine_SeraphinePassiveNotesBuff_OnBuffActivate"],"missile":[],"hit":[]},{"cast":["Seraphine_SeraphinePEcho_ready_buffactivate_self"],"missile":[],"hit":[]},{"cast":["Seraphine_SeraphineQ_OnCast","Seraphine_SeraphineQCastEcho_OnCast"],"missile":["Seraphine_SeraphineQInitialMissile_OnHitLocation","Seraphine_SeraphineQInitialMissile_OnMissileLaunch"],"hit":["Seraphine_SeraphineQ_hit_champ"]},{"cast":["Seraphine_SeraphineR_cast","Seraphine_SeraphineR_OnCast"],"missile":["Seraphine_SeraphineR_OnMissileCast","Seraphine_SeraphineR_OnMissileLaunch"],"hit":["Seraphine_SeraphineR_hit","Seraphine_SeraphineRCharm_hit"]},{"cast":["Seraphine_SeraphineW_OnCast","Seraphine_SeraphineW2Warning_OnBuffActivate","Seraphine_SeraphineWCastEcho_OnCast","Seraphine_SeraphineWShield_buffactivate"],"missile":[],"hit":[]},{"cast":["Seraphine_Winddown3D_buffactivate"],"missile":[],"hit":[]}],"reset":null,"trees":{"Seraphine_SeraphinePassiveAttack_OnHit":{"one":[143704395,168066898,92800397]},"Seraphine_SeraphineW2Warning_OnBuffActivate":{"one":[590142079,969414909]},"Seraphine_SeraphineBasicAttack_OnHit":{"one":[92800397,168066898,143704395]},"Seraphine_SeraphineEStun_OnBuffActivate":{"one":[777213724,696729714]},"Seraphine_SeraphineEMissile_OnHit":{"one":[895396987,482080954]},"Seraphine_SeraphinePassiveNotesBuff_OnBuffActivate":806602402,"Seraphine_SeraphinePassiveAttack_OnMissileLaunch":{"one":[133632451,744887014,899040063]},"Seraphine_SeraphineQ_OnCast":{"one":[895481833,36239856,881822493]},"Seraphine_SeraphineBasicAttack_OnMissileLaunch":{"one":[160078753,205931755,240189195]},"Seraphine_SeraphineBasicAttack2_OnCast":{"one":[21600774,49916033,142420705]},"Seraphine_SeraphinePassiveAttack_OnCast":{"one":[21600774,49916033,142420705]},"Seraphine_SeraphineQInitialMissile_OnHitLocation":{"one":[13865021,534677476,613854225]},"Seraphine_SeraphinePassiveEchoStage2_OnBuffActivate":459634749,"Seraphine_SeraphineQ_hit_champ":{"one":[283432514,631737126,1058817475]},"Seraphine_SeraphineERoot_OnBuffActivate":684336140,"Seraphine_SeraphineCritAttack_OnCast":{"one":[21600774,49916033,142420705]},"Seraphine_SeraphineCritAttack_OnMissileLaunch":{"one":[160078753,240189195,205931755]},"Seraphine_SeraphineBasicAttack2_OnHit":{"one":[92800397,168066898,143704395]},"Seraphine_SeraphineR_cast":467035668,"Seraphine_SeraphineBasicAttack2_OnMissileLaunch":{"one":[160078753,205931755,240189195]},"Seraphine_SeraphineR_OnCast":{"all":[{"one":[162389452,528211957,984136618]},254128159]},"Seraphine_SeraphinePEcho_ready_buffactivate_self":{"one":[88512264,228315451]},"Seraphine_SeraphineECastEcho_OnCast":{"one":[1073658154,216489016,893791783,469613952]},"Seraphine_SeraphineEMissile_OnMissileLaunch":{"one":[741203869,626029843,858179131]},"Seraphine_SeraphineWShield_buffactivate":{"one":[399104007,672460553,398854998]},"Seraphine_SeraphineQCastEcho_OnCast":{"one":[252736394,200049444,88467287,1031382302]},"Seraphine_SeraphineR_OnMissileLaunch":717640036,"Seraphine_SeraphineWCastEcho_OnCast":929230822,"Seraphine_SeraphineW_OnCast":655350838,"Seraphine_SeraphineRCharm_hit":92558949,"Seraphine_SeraphineE_OnCast":{"one":[820665655,853214421]},"Seraphine_SeraphineR_OnMissileCast":362475194,"Seraphine_SeraphineR_hit":{"one":[415891848,526232641,82909684]},"Seraphine_Winddown3D_buffactivate":592704382,"Seraphine_SeraphineCritAttack_OnHit":{"one":[92800397,143704395,168066898]},"Seraphine_SeraphineQInitialMissile_OnMissileLaunch":{"one":[490561593,309802858,909002570]},"Seraphine_SeraphineBasicAttack_OnCast":{"one":[21600774,49916033,142420705]}}},"6":{"dir":"mel","attack":{"cast":["Mel_MelBasicAttack_OnCast","Mel_MelCritAttack_OnCast"],"missile":["Mel_MelBasicAttack_OnMissileLaunch","Mel_MelCritAttack_OnMissileLaunch"],"hit":["Mel_MelBasicAttack_OnHit","Mel_MelCritAttack_OnHit"]},"abilities":[{"cast":["Mel_MelBasicAttackEnhanced_OnCast"],"missile":["Mel_MelBasicAttackEnhanced_OnMissileCast"],"hit":["Mel_MelBasicAttackEnhanced_OnHit"]},{"cast":["Mel_MelE_OnCast"],"missile":["Mel_MelE_OnMissileCast","Mel_MelE_OnMissileLaunch"],"hit":["Mel_MelE_hit_edge","Mel_MelE_hit_root_champion_buffactivate"]},{"cast":["Mel_MelMark_buffactivate","Mel_MelMark_execute_ready_buffactivate"],"missile":[],"hit":[]},{"cast":["Mel_MelQ_OnCast"],"missile":["Mel_MelQ_missilecast"],"hit":["Mel_MelQ_hit","Mel_MelQ_hit_fullcombo","Mel_MelQ_hitlocation"]},{"cast":["Mel_MelR_OnCast","Mel_MelR_warning_buffactivate","Mel_MelR_warning_buffactivate_target2D"],"missile":[],"hit":["Mel_MelR_enemy_hit"]},{"cast":["Mel_MelW_OnCast"],"missile":[],"hit":[]},{"cast":["Mel_Winddown3D_buffactivate"],"missile":[],"hit":[]}],"reset":null,"trees":{"Mel_MelQ_hit":{"one":[489366663,67133814,312072310,765326174,25598061]},"Mel_MelE_OnMissileCast":{"one":[906410230,734821735]},"Mel_MelQ_hit_fullcombo":{"one":[260543361,112283412]},"Mel_Winddown3D_buffactivate":835686457,"Mel_MelCritAttack_OnCast":{"one":[200636722,341318335,708090850]},"Mel_MelE_hit_root_champion_buffactivate":{"one":[844098923,561997761]},"Mel_MelQ_missilecast":{"one":[1014016203,1034326865,69906464,633925690,483045749,999450566]},"Mel_MelE_OnCast":{"one":[958790743,466358459]},"Mel_MelQ_hitlocation":{"all":[{"one":[809317032,29626745,865899832,760015025,314346474]},{"one":[291268994,302282541,871924691]}]},"Mel_MelBasicAttack_OnHit":{"one":[132317619,421690043,391813129]},"Mel_MelQ_OnCast":{"one":[452539193,604754762,114306922]},"Mel_MelBasicAttack_OnCast":{"one":[200636722,708090850,341318335]},"Mel_MelBasicAttackEnhanced_OnCast":{"one":[210505607,26761430,188688604]},"Mel_MelMark_execute_ready_buffactivate":{"one":[748343576,222969581]},"Mel_MelE_OnMissileLaunch":{"one":[998231759,898516573]},"Mel_MelE_hit_edge":{"one":[359069756,824260874,16787017]},"Mel_MelW_OnCast":{"one":[580783724,700348529,622514781]},"Mel_MelMark_buffactivate":{"one":[59964004,532995148,531582727]},"Mel_MelBasicAttackEnhanced_OnHit":{"one":[391813129,421690043,132317619]},"Mel_MelCritAttack_OnMissileLaunch":{"one":[673057764,77765864,758728416]},"Mel_MelBasicAttackEnhanced_OnMissileCast":{"one":[378717097,70498840]},"Mel_MelCritAttack_OnHit":{"one":[132317619,421690043,391813129]},"Mel_MelBasicAttack_OnMissileLaunch":{"one":[758728416,77765864,673057764]},"Mel_MelR_enemy_hit":{"one":[270041739,112728814]},"Mel_MelR_warning_buffactivate_target2D":195481522,"Mel_MelR_OnCast":{"one":[1002542283,222109077,854170882]},"Mel_MelR_warning_buffactivate":{"one":[822393296,243105584]}}},"7":{"dir":"riven","attack":{"cast":["Riven_RivenBasicAttack_OnCast","Riven_RivenBasicAttack2_OnCast","Riven_RivenBasicAttack3_OnCast","Riven_RivenCritAttack_OnCast"],"missile":[],"hit":["Riven_RivenBasicAttack_OnHit","Riven_RivenBasicAttack2_OnHit","Riven_RivenBasicAttack3_OnHit","Riven_RivenCritAttack_OnHit"]},"abilities":[{"cast":["Riven_RivenFeint_OnBuffActivate","Riven_RivenFeint_OnCast"],"missile":[],"hit":["Riven_RivenFeint_OnHit"]},{"cast":["Riven_RivenFengShuiEngine_OnBuffActivate","Riven_RivenFengShuiEngine_OnCast"],"missile":[],"hit":[]},{"cast":["Riven_RivenIzunaBlade_OnCast"],"missile":[],"hit":[]},{"cast":["Riven_RivenMartyr_OnCast"],"missile":[],"hit":[]},{"cast":["Riven_RivenTriCleave_OnCast"],"missile":[],"hit":["Riven_RivenTriCleave_hit_a","Riven_RivenTriCleave_hit_b","Riven_RivenTriCleave_hit_ground_lrg","Riven_RivenTriCleave_hit_ground_sml"]}],"reset":null,"trees":{"Riven_RivenBasicAttack2_OnHit":{"one":[{"one":[30710599,816289204,561151624,664122383]},{"one":[672544899,156776483,8980832,799721835]},{"one":[61999722,280615778,619752349,607563522]},{"one":[706047226,58610531,493964780,18596071]}]},"Riven_RivenFeint_OnBuffActivate":{"all":[962414174,{"one":[47688915,415786467,213238539]}]},"Riven_RivenBasicAttack3_OnCast":{"one":[984997526,325736738,760169195,208044608]},"Riven_RivenTriCleave_hit_a":{"one":[1042054942,974985210,990728172,807992497]},"Riven_RivenFengShuiEngine_OnBuffActivate":1068295292,"Riven_RivenFeint_OnHit":{"one":[527362269,150011099,335525536,239874950]},"Riven_RivenCritAttack_OnHit":{"one":[{"one":[30710599,816289204,561151624,664122383]},{"one":[672544899,156776483,8980832,799721835]},{"one":[61999722,280615778,619752349,607563522]},{"one":[706047226,58610531,493964780,18596071]}]},"Riven_RivenCritAttack_OnCast":{"one":[913856567,662439624,157256687]},"Riven_RivenMartyr_OnCast":{"one":[692526259,535055791,656120570]},"Riven_RivenIzunaBlade_OnCast":{"one":[877386398,1063978377,626605547]},"Riven_RivenTriCleave_hit_b":{"one":[797195226,168033260,724705354]},"Riven_RivenBasicAttack2_OnCast":{"one":[984997526,325736738,760169195,208044608]},"Riven_RivenBasicAttack_OnHit":{"one":[{"one":[30710599,816289204,561151624,664122383]},{"one":[672544899,156776483,8980832,799721835]},{"one":[61999722,280615778,619752349,607563522]},{"one":[706047226,58610531,493964780,18596071]}]},"Riven_RivenFengShuiEngine_OnCast":{"one":[710185030,416317847,846226651]},"Riven_RivenBasicAttack_OnCast":{"one":[984997526,325736738,760169195,208044608]},"Riven_RivenTriCleave_OnCast":{"one":[96226650,134623870,797425910,519037612,93723781]},"Riven_RivenTriCleave_hit_ground_lrg":{"one":[67969504,62750226,12382225,92634200]},"Riven_RivenBasicAttack3_OnHit":{"one":[{"one":[30710599,816289204,561151624,664122383]},{"one":[672544899,156776483,8980832,799721835]},{"one":[61999722,280615778,619752349,607563522]},{"one":[706047226,58610531,493964780,18596071]}]},"Riven_RivenTriCleave_hit_ground_sml":{"one":[12382225,92634200,62750226,67969504]},"Riven_RivenFeint_OnCast":{"one":[524108470,68402861,314790952]}}},"8":{"dir":"soraka","attack":{"cast":["Soraka_SorakaBasicAttack_OnCast","Soraka_SorakaBasicAttack2_OnCast","Soraka_SorakaCritAttack_OnCast"],"missile":["Soraka_SorakaBasicAttack_OnMissileLaunch","Soraka_SorakaBasicAttack2_OnMissileLaunch","Soraka_SorakaCritAttack_OnMissileLaunch"],"hit":["Soraka_SorakaBasicAttack_OnHit","Soraka_SorakaBasicAttack2_OnHit","Soraka_SorakaCritAttack_OnHit"]},"abilities":[{"cast":["Soraka_SorakaE_buffactivate","Soraka_SorakaE_OnCast","Soraka_SorakaESnare_OnBuffActivate"],"missile":[],"hit":["Soraka_SorakaE_OnHit"]},{"cast":["Soraka_SorakaPassive_OnBuffActivate"],"missile":[],"hit":[]},{"cast":["Soraka_SorakaQ_OnCast"],"missile":["Soraka_SorakaQMissile_OnHitLocation","Soraka_SorakaQMissile_OnMissileLaunch","Soraka_SorakaQReturnMissile_OnMissileLaunch"],"hit":["Soraka_SorakaQ_hit"]},{"cast":["Soraka_SorakaR_OnCast"],"missile":[],"hit":[]},{"cast":["Soraka_SorakaW_OnCast"],"missile":["Soraka_SorakaWParticleMissile_OnMissileLaunch"],"hit":[]},{"cast":[],"missile":[],"hit":["Soraka_Wish_hit"]}],"reset":null,"trees":{"Soraka_SorakaPassive_OnBuffActivate":{"all":[{"one":[399183643,780480677,999070729]},{"one":[183507773,477690793,42829569]}]},"Soraka_SorakaW_OnCast":{"one":[623968471,960285964,142778807,866763978]},"Soraka_SorakaQMissile_OnHitLocation":{"one":[485294151,493343696,161450082,972096357]},"Soraka_SorakaBasicAttack_OnCast":{"one":[31763818,36533594,532398322,24910182]},"Soraka_SorakaR_OnCast":{"one":[927328648,600122912,532559986,355747677]},"Soraka_SorakaBasicAttack2_OnHit":{"one":[37815644,359393543,478379381,21871799]},"Soraka_SorakaBasicAttack_OnMissileLaunch":{"one":[137397296,87927779,26639426,24053130]},"Soraka_SorakaBasicAttack_OnHit":{"one":[37815644,359393543,478379381,21871799]},"Soraka_SorakaE_OnHit":{"one":[645633735,390401694,380118844,704126651]},"Soraka_SorakaBasicAttack2_OnMissileLaunch":{"one":[137397296,87927779,26639426,24053130]},"Soraka_SorakaQ_hit":138839411,"Soraka_SorakaCritAttack_OnHit":{"one":[359393543,21871799,37815644,478379381]},"Soraka_SorakaESnare_OnBuffActivate":{"one":[352306735,50911345,758612612]},"Soraka_SorakaQ_OnCast":{"one":[1000440161,383551799,318527815,11357559]},"Soraka_Wish_hit":{"one":[937271242,1070182607,215907285,970688485]},"Soraka_SorakaQMissile_OnMissileLaunch":{"one":[690475838,650539772,66256929,721855783]},"Soraka_SorakaWParticleMissile_OnMissileLaunch":{"one":[213618989,953156480,47117345,71977089]},"Soraka_SorakaQReturnMissile_OnMissileLaunch":{"one":[676323971,336939962,869986472,591307540]},"Soraka_SorakaCritAttack_OnCast":{"one":[36533594,24910182,31763818,532398322]},"Soraka_SorakaBasicAttack2_OnCast":{"one":[31763818,36533594,532398322,24910182]},"Soraka_SorakaE_buffactivate":{"one":[523955500,337697022,748224274,262981281]},"Soraka_SorakaE_OnCast":{"one":[656664789,680294722,19021882,805958664]},"Soraka_SorakaCritAttack_OnMissileLaunch":{"one":[24053130,137397296,26639426,87927779]}}},"9":{"dir":"leesin","attack":{"cast":["LeeSin_LeeSinBasicAttack_OnCast","LeeSin_LeeSinBasicAttack2_OnCast","LeeSin_LeeSinBasicAttack3_OnCast","LeeSin_LeeSinBasicAttack4_OnCast","LeeSin_LeeSinCritAttack_OnCast"],"missile":[],"hit":["LeeSin_LeeSinBasicAttack_OnHit","LeeSin_LeeSinBasicAttack2_OnHit","LeeSin_LeeSinBasicAttack3_OnHit","LeeSin_LeeSinBasicAttack4_OnHit","LeeSin_LeeSinCritAttack_OnHit"]},"abilities":[{"cast":["LeeSin_LeeSinEOne_OnBuffActivate","LeeSin_LeeSinEOne_OnCast","LeeSin_LeeSinETwo_OnCast","LeeSin_LeeSinETwoDebuff_buffactivate"],"missile":[],"hit":["LeeSin_LeeSinEOne_hitlocation_ground","LeeSin_LeeSinEOne_OnHitLocation"]},{"cast":["LeeSin_LeeSinQOne_OnBuffActivate","LeeSin_LeeSinQOne_OnCast","LeeSin_LeeSinQTwo_OnCast","LeeSin_LeeSinQTwoDash_buffactivate"],"missile":["LeeSin_LeeSinQOne_OnMissileLaunch"],"hit":["LeeSin_LeeSinQOne_OnHit","LeeSin_LeeSinQTwoDash_hit"]},{"cast":["LeeSin_LeeSinR_OnCast"],"missile":[],"hit":["LeeSin_LeeSinR_hit2","LeeSin_LeeSinR_OnHit"]},{"cast":["LeeSin_LeeSinWOne_OnCast","LeeSin_LeeSinWOneDash_OnBuffActivate","LeeSin_LeeSinWOneShield_OnBuffActivate","LeeSin_LeeSinWTwo_OnCast"],"missile":[],"hit":[]}],"reset":null,"trees":{"LeeSin_LeeSinWTwo_OnCast":{"one":[11087255,523312686]},"LeeSin_LeeSinETwoDebuff_buffactivate":{"all":[{"one":[934077787,982800279]},{"one":[754415019,847830620]}]},"LeeSin_LeeSinQOne_OnBuffActivate":1066525410,"LeeSin_LeeSinBasicAttack4_OnCast":{"one":[238120173,122038869,310890671,155023716]},"LeeSin_LeeSinEOne_OnBuffActivate":{"one":[295413182,104602705]},"LeeSin_LeeSinR_OnHit":693210799,"LeeSin_LeeSinEOne_hitlocation_ground":{"one":[{"one":[17084240,655800313]},{"one":[660926203,1003671613]},{"one":[523890239,914071476]},{"one":[538341176,116819468]}]},"LeeSin_LeeSinWOneShield_OnBuffActivate":{"all":[{"one":[746182880,942938753]},{"one":[475985419,{"one":[620428107,743874467,179987773]}]}]},"LeeSin_LeeSinQTwo_OnCast":{"one":[774945029,612733600,849070038]},"LeeSin_LeeSinR_hit2":{"one":[123063647,589905007,314173866,608808170]},"LeeSin_LeeSinQOne_OnHit":{"one":[989874514,1025397106,148120963]},"LeeSin_LeeSinETwo_OnCast":{"one":[166622118,938522872]},"LeeSin_LeeSinQOne_OnCast":{"one":[120515603,599617392]},"LeeSin_LeeSinEOne_OnCast":{"one":[178665385,2282822]},"LeeSin_LeeSinEOne_OnHitLocation":{"one":[801900457,981569445]},"LeeSin_LeeSinBasicAttack3_OnHit":{"all":[{"one":[1160187,444956214,820221498,358899481]},{"one":[{"one":[638593539,76194989,9567031,85970821]},{"one":[353024557,328866928,17125341,13470672]},{"one":[48019272,11752443,207922867,417296577]},{"one":[79307899,161946793,739974076,216305310]}]}]},"LeeSin_LeeSinBasicAttack_OnCast":{"one":[238120173,122038869,310890671,155023716]},"LeeSin_LeeSinCritAttack_OnHit":{"all":[{"one":[358899481,444956214,820221498,1160187]},{"one":[{"one":[48019272,207922867,11752443,417296577]},{"one":[85970821,638593539,76194989,9567031]},{"one":[79307899,739974076,216305310,161946793]},{"one":[328866928,353024557,13470672,17125341]}]}]},"LeeSin_LeeSinBasicAttack4_OnHit":{"all":[{"one":[1160187,444956214,820221498,358899481]},{"one":[{"one":[638593539,76194989,9567031,85970821]},{"one":[353024557,328866928,17125341,13470672]},{"one":[48019272,11752443,207922867,417296577]},{"one":[79307899,161946793,739974076,216305310]}]}]},"LeeSin_LeeSinBasicAttack_OnHit":{"all":[{"one":[1160187,444956214,820221498,358899481]},{"one":[{"one":[638593539,76194989,9567031,85970821]},{"one":[353024557,328866928,17125341,13470672]},{"one":[48019272,11752443,207922867,417296577]},{"one":[79307899,161946793,739974076,216305310]}]}]},"LeeSin_LeeSinBasicAttack2_OnCast":{"one":[238120173,122038869,310890671,155023716]},"LeeSin_LeeSinBasicAttack2_OnHit":{"all":[{"one":[1160187,444956214,820221498,358899481]},{"one":[{"one":[638593539,76194989,9567031,85970821]},{"one":[353024557,328866928,17125341,13470672]},{"one":[48019272,11752443,207922867,417296577]},{"one":[79307899,161946793,739974076,216305310]}]}]},"LeeSin_LeeSinCritAttack_OnCast":{"one":[238120173,122038869,310890671,155023716]},"LeeSin_LeeSinWOne_OnCast":{"one":[883015674,843270842]},"LeeSin_LeeSinWOneDash_OnBuffActivate":{"one":[285714636,735815335]},"LeeSin_LeeSinBasicAttack3_OnCast":{"one":[238120173,122038869,310890671,155023716]},"LeeSin_LeeSinR_OnCast":196445596,"LeeSin_LeeSinQOne_OnMissileLaunch":{"one":[824760301,873336997,975606017]},"LeeSin_LeeSinQTwoDash_hit":{"one":[148692287,1050242452]},"LeeSin_LeeSinQTwoDash_buffactivate":{"one":[701361064,589904282,990181295]}}},"10":{"dir":"volibear","attack":{"cast":["Volibear_VolibearBasicAttack_OnCast","Volibear_VolibearCritAttack_OnCast"],"missile":[],"hit":["Volibear_VolibearBasicAttack_OnHit","Volibear_VolibearCritAttack_OnHit"]},"abilities":[{"cast":["Volibear_Celebrate_buffactivate"],"missile":[],"hit":[]},{"cast":["Volibear_Roar_cast"],"missile":[],"hit":[]},{"cast":["Volibear_VolibearBasicAttackTower_OnCast"],"missile":[],"hit":["Volibear_VolibearBasicAttackTower_OnHit"]},{"cast":["Volibear_VolibearE_buffactivate","Volibear_VolibearE_enemy_buffactivate","Volibear_VolibearE_OnCast","Volibear_VolibearEShield_OnBuffActivate"],"missile":[],"hit":["Volibear_VolibearE_hit"]},{"cast":["Volibear_VolibearPApplicator_OnBuffActivate"],"missile":[],"hit":[]},{"cast":[],"missile":[],"hit":["Volibear_VolibearPChain_hit"]},{"cast":["Volibear_VolibearQ_OnBuffActivate","Volibear_VolibearQ_OnCast","Volibear_VolibearQAttack_OnCast","Volibear_VolibearQPostAttack_OnCast"],"missile":[],"hit":["Volibear_VolibearQAttack_OnHit","Volibear_VolibearQPostAttack_OnHit"]},{"cast":["Volibear_VolibearR_cast","Volibear_VolibearR_jump","Volibear_VolibearR_OnBuffActivate","Volibear_VolibearRTowerAttack1_OnCast","Volibear_VolibearRTowerAttack2_OnCast","Volibear_VolibearRTransitionAttack_OnCast"],"missile":[],"hit":["Volibear_VolibearR_hit_ground","Volibear_VolibearRSweetSpot_hit","Volibear_VolibearRTowerAttack1_OnHit","Volibear_VolibearRTowerAttack2_OnHit","Volibear_VolibearRTowerDisable_hit","Volibear_VolibearRTransitionAttack_OnHit"]},{"cast":["Volibear_VolibearW_cast","Volibear_VolibearWEmp_cast"],"missile":[],"hit":["Volibear_VolibearW_hit","Volibear_VolibearWEmp_hit"]},{"cast":["Volibear_Winddown3D_buffactivate"],"missile":[],"hit":[]}],"reset":null,"trees":{"Volibear_VolibearRTowerDisable_hit":{"all":[335575231,332180640]},"Volibear_VolibearR_cast":{"all":[158436,12858489]},"Volibear_VolibearR_jump":955555766,"Volibear_Roar_cast":{"one":[936555924,473701972]},"Volibear_VolibearW_hit":{"one":[173269145,3036174,578445288]},"Volibear_VolibearQPostAttack_OnCast":{"one":[{"one":[105620664,519214971,174635762,37151977]},{"one":[83550954,173635602,278593951,101902527]}]},"Volibear_VolibearRTowerAttack1_OnHit":{"one":[434648470,593847335,835371084,155198042]},"Volibear_Winddown3D_buffactivate":90431827,"Volibear_VolibearRSweetSpot_hit":454164689,"Volibear_VolibearQAttack_OnHit":{"one":[930611038,811448405,167734640]},"Volibear_VolibearQAttack_OnCast":{"one":[606104453,364871661,694643438]},"Volibear_VolibearR_hit_ground":{"one":[1022354647,852578646]},"Volibear_VolibearRTowerAttack2_OnHit":{"one":[434648470,593847335,835371084,155198042]},"Volibear_VolibearQ_OnBuffActivate":{"all":[603762692,{"one":[703130472,828442481,796693002]}]},"Volibear_VolibearEShield_OnBuffActivate":339842560,"Volibear_VolibearE_buffactivate":{"all":[{"one":[161351697,864806883]},621849706]},"Volibear_VolibearR_OnBuffActivate":399691499,"Volibear_VolibearE_OnCast":397417325,"Volibear_VolibearQ_OnCast":{"one":[210521734,28408560,539050257]},"Volibear_VolibearBasicAttackTower_OnCast":{"one":[37151977,174635762,519214971,105620664]},"Volibear_VolibearRTowerAttack2_OnCast":{"one":[37151977,174635762,519214971,105620664]},"Volibear_VolibearRTransitionAttack_OnHit":{"one":[{"one":[159400228,359092621,22767451,259376669]},{"one":[17741503,159498544,13487046,298943493]},{"one":[264133733,47700132,294426069,254592555]},{"one":[84916284,108859042,519973800,350764356]}]},"Volibear_VolibearRTowerAttack1_OnCast":{"one":[37151977,174635762,519214971,105620664]},"Volibear_VolibearWEmp_hit":{"one":[798504936,503613658]},"Volibear_VolibearE_hit":601998191,"Volibear_VolibearPChain_hit":{"one":[234786353,1045234702,566391020,988733760,168780973]},"Volibear_Celebrate_buffactivate":116773474,"Volibear_VolibearBasicAttackTower_OnHit":{"one":[434648470,593847335,835371084,155198042]},"Volibear_VolibearW_cast":{"one":[154338573,911878205,1026839781]},"Volibear_VolibearBasicAttack_OnCast":{"one":[{"one":[105620664,519214971,174635762,37151977]},{"one":[83550954,173635602,278593951,101902527]}]},"Volibear_VolibearE_enemy_buffactivate":{"all":[{"one":[388947283,374485034]},621849706]},"Volibear_VolibearPApplicator_OnBuffActivate":{"all":[721802341,520108429]},"Volibear_VolibearQPostAttack_OnHit":{"one":[{"one":[159400228,359092621,22767451,259376669]},{"one":[17741503,159498544,13487046,298943493]},{"one":[264133733,47700132,294426069,254592555]},{"one":[84916284,108859042,519973800,350764356]}]},"Volibear_VolibearCritAttack_OnHit":{"one":[{"one":[47700132,254592555,264133733,294426069]},{"one":[298943493,159498544,17741503,13487046]},{"one":[84916284,350764356,519973800,108859042]},{"one":[159400228,259376669,359092621,22767451]}]},"Volibear_VolibearCritAttack_OnCast":{"one":[173635602,101902527,83550954,278593951]},"Volibear_VolibearWEmp_cast":{"one":[521461474,92961046]},"Volibear_VolibearRTransitionAttack_OnCast":{"one":[{"one":[105620664,519214971,174635762,37151977]},{"one":[83550954,173635602,278593951,101902527]}]},"Volibear_VolibearBasicAttack_OnHit":{"one":[{"one":[159400228,359092621,22767451,259376669]},{"one":[17741503,159498544,13487046,298943493]},{"one":[264133733,47700132,294426069,254592555]},{"one":[84916284,108859042,519973800,350764356]}]}}},"11":{"dir":"sejuani","attack":{"cast":["Sejuani_SejuaniBasicAttack_OnCast","Sejuani_SejuaniBasicAttack2_OnCast","Sejuani_SejuaniBasicAttack3_OnCast","Sejuani_SejuaniCritAttack_OnCast"],"missile":[],"hit":["Sejuani_SejuaniBasicAttack_OnHit","Sejuani_SejuaniBasicAttack2_OnHit","Sejuani_SejuaniBasicAttack3_OnHit","Sejuani_SejuaniCritAttack_OnHit"]},"abilities":[{"cast":["Sejuani_SejuaniBasicAttackW_OnCast"],"missile":[],"hit":["Sejuani_SejuaniBasicAttackW_OnHit"]},{"cast":["Sejuani_SejuaniCritAttack2_OnCast"],"missile":[],"hit":["Sejuani_SejuaniCritAttack2_OnHit"]},{"cast":["Sejuani_SejuaniCritAttack3_OnCast"],"missile":[],"hit":["Sejuani_SejuaniCritAttack3_OnHit"]},{"cast":["Sejuani_SejuaniE2_OnCast"],"missile":["Sejuani_SejuaniE2_OnMissileLaunch","Sejuani_SejuaniEPassiveMissile_OnHit","Sejuani_SejuaniEPassiveMissile_OnMissileCast"],"hit":["Sejuani_SejuaniE2_OnHit","Sejuani_SejuaniEStack4_hit"]},{"cast":[],"missile":[],"hit":["sejuani_SejuaniP_hit","Sejuani_SejuaniP_hit"]},{"cast":["Sejuani_SejuaniPassiveDefense_OnBuffActivate"],"missile":[],"hit":[]},{"cast":["Sejuani_SejuaniQ_OnCast"],"missile":[],"hit":["Sejuani_SejuaniQ_hit"]},{"cast":["Sejuani_SejuaniR_OnCast"],"missile":["Sejuani_SejuaniR_miss","Sejuani_SejuaniRMissile_OnMissileLaunch"],"hit":["Sejuani_SejuaniR_hit","Sejuani_SejuaniR_hit_close","Sejuani_SejuaniR_hit2"]},{"cast":["Sejuani_SejuaniW_OnCast"],"missile":[],"hit":["Sejuani_SejuaniW1_hit","Sejuani_SejuaniW2_hit"]}],"reset":null,"trees":{"Sejuani_SejuaniCritAttack_OnCast":{"one":[102565705,232195293,35571413,44305448]},"Sejuani_SejuaniE2_OnMissileLaunch":{"one":[837900305,477232013,9374572]},"Sejuani_SejuaniQ_OnCast":{"all":[{"one":[380578764,455509882,217390934,809202927]},{"one":[68081152,502145878,523118052,632348105]}]},"Sejuani_SejuaniCritAttack2_OnHit":{"one":[{"one":[822730635,478318255,310561806,140917363]},{"one":[898096371,884697817,491818376,215682810]},{"one":[313812630,297093396,71235010,762115671]},{"one":[11341568,90956301,186216499,272106387]}]},"Sejuani_SejuaniCritAttack3_OnCast":{"one":[102565705,232195293,35571413,44305448]},"Sejuani_SejuaniEPassiveMissile_OnMissileCast":{"one":[99521428,866587781,503757628,828472082]},"Sejuani_SejuaniQ_hit":{"one":[733234595,96526843,846556638,786166350]},"Sejuani_SejuaniW1_hit":{"one":[571510364,624252430,221307032,134318323]},"Sejuani_SejuaniR_hit":{"one":[154357279,376582059,375865538,800421044]},"sejuani_SejuaniP_hit":{"one":[802151484,419930362,837623053,691787529]},"Sejuani_SejuaniBasicAttack2_OnHit":{"one":[{"one":[491818376,898096371,884697817,215682810]},{"one":[140917363,822730635,310561806,478318255]},{"one":[762115671,313812630,297093396,71235010]},{"one":[11341568,186216499,90956301,272106387]}]},"Sejuani_SejuaniR_hit_close":{"one":[376582059,749471198,375865538,800421044]},"Sejuani_SejuaniR_OnCast":{"one":[740106887,299038451,180956134,134326829]},"Sejuani_SejuaniCritAttack3_OnHit":{"one":[{"one":[822730635,478318255,310561806,140917363]},{"one":[898096371,884697817,491818376,215682810]},{"one":[313812630,297093396,71235010,762115671]},{"one":[11341568,90956301,186216499,272106387]}]},"Sejuani_SejuaniRMissile_OnMissileLaunch":{"one":[672507771,231901050,1030719636,993604365]},"Sejuani_SejuaniBasicAttack3_OnCast":{"one":[102565705,232195293,35571413,44305448]},"Sejuani_SejuaniR_hit2":{"one":[72222258,376425795,379262397,153508721]},"Sejuani_SejuaniBasicAttackW_OnHit":{"one":[{"one":[822730635,478318255,310561806,140917363]},{"one":[898096371,884697817,491818376,215682810]},{"one":[313812630,297093396,71235010,762115671]},{"one":[11341568,90956301,186216499,272106387]}]},"Sejuani_SejuaniCritAttack_OnHit":{"one":[{"one":[822730635,478318255,310561806,140917363]},{"one":[898096371,884697817,491818376,215682810]},{"one":[313812630,297093396,71235010,762115671]},{"one":[11341568,90956301,186216499,272106387]}]},"Sejuani_SejuaniP_hit":{"one":[802151484,419930362,837623053,691787529]},"Sejuani_SejuaniEPassiveMissile_OnHit":{"one":[249375172,247630358,7122722,718588437]},"Sejuani_SejuaniBasicAttack2_OnCast":{"one":[35571413,102565705,44305448,232195293]},"Sejuani_SejuaniEStack4_hit":{"one":[795726426,315491060]},"Sejuani_SejuaniW_OnCast":{"all":[{"one":[1066563964,301882331,821524636,555773071]},{"one":[827612929,854302056,199010983,215393615]}]},"Sejuani_SejuaniBasicAttack3_OnHit":{"one":[{"one":[822730635,478318255,310561806,140917363]},{"one":[898096371,884697817,491818376,215682810]},{"one":[313812630,297093396,71235010,762115671]},{"one":[11341568,90956301,186216499,272106387]}]},"Sejuani_SejuaniPassiveDefense_OnBuffActivate":{"one":[753827818,19829084,904917923]},"Sejuani_SejuaniBasicAttack_OnCast":{"one":[35571413,102565705,44305448,232195293]},"Sejuani_SejuaniBasicAttackW_OnCast":{"one":[102565705,232195293,35571413,44305448]},"Sejuani_SejuaniBasicAttack_OnHit":{"one":[{"one":[491818376,898096371,884697817,215682810]},{"one":[140917363,822730635,310561806,478318255]},{"one":[762115671,313812630,297093396,71235010]},{"one":[11341568,186216499,90956301,272106387]}]},"Sejuani_SejuaniW2_hit":{"one":[199755871,330774980,244870930,39325513]},"Sejuani_SejuaniE2_OnCast":{"one":[948255396,899057910,786506686,362398252]},"Sejuani_SejuaniR_miss":{"one":[638587596,32991684,572467555,88510124]},"Sejuani_SejuaniE2_OnHit":{"one":[983927746,120384618,31196920,401333469]},"Sejuani_SejuaniCritAttack2_OnCast":{"one":[102565705,232195293,35571413,44305448]}}},"12":{"dir":"zaahen","attack":{"cast":["Zaahen_ZaahenBasicAttack_OnCast","Zaahen_ZaahenBasicAttack2_OnCast","Zaahen_ZaahenBasicAttack3_OnCast","Zaahen_ZaahenCritAttack_OnCast"],"missile":[],"hit":["Zaahen_ZaahenBasicAttack_OnHit","Zaahen_ZaahenBasicAttack2_OnHit","Zaahen_ZaahenBasicAttack3_OnHit","Zaahen_ZaahenCritAttack_OnHit"]},"abilities":[{"cast":["Zaahen_ZaahenCritAttack2_OnCast"],"missile":[],"hit":["Zaahen_ZaahenCritAttack2_OnHit"]},{"cast":["Zaahen_ZaahenCritAttack3_OnCast"],"missile":[],"hit":["Zaahen_ZaahenCritAttack3_OnHit"]},{"cast":["Zaahen_ZaahenE_OnCast","Zaahen_ZaahenEAttack_aoe_buffactivate","Zaahen_ZaahenEAttack_AoE_buffactivate"],"missile":[],"hit":["Zaahen_ZaahenEAttack_hit_inner","Zaahen_ZaahenEAttack_hit_outer"]},{"cast":["Zaahen_ZaahenP_revive_buffactivate"],"missile":[],"hit":[]},{"cast":["Zaahen_ZaahenQ_OnCast","Zaahen_ZaahenQ1_buffactivate","Zaahen_ZaahenQ2_buffactivate","Zaahen_ZaahenQ2_OnCast","Zaahen_ZaahenQ2_warning_buffactivate","Zaahen_ZaahenQ2Attack_OnCast","Zaahen_ZaahenQAttack_OnCast"],"missile":[],"hit":["Zaahen_ZaahenQ2Attack_OnHit","Zaahen_ZaahenQAttack_OnHit"]},{"cast":["Zaahen_ZaahenR_AoE_buffactivate","Zaahen_ZaahenR_OnCast"],"missile":[],"hit":["Zaahen_ZaahenR_AoE_hit_champion"]},{"cast":["Zaahen_ZaahenW_OnCast","Zaahen_ZaahenW_pull_cast"],"missile":["Zaahen_ZaahenW_OnMissileLaunch"],"hit":["Zaahen_ZaahenW_hit_champion"]}],"reset":null,"trees":{"Zaahen_ZaahenBasicAttack_OnCast":{"one":[150516804,841883242,946425146]},"Zaahen_ZaahenCritAttack_OnCast":{"one":[946425146,841883242,150516804]},"Zaahen_ZaahenCritAttack_OnHit":{"all":[{"one":[{"one":[850967435,878114572,150841008,108191969]},{"one":[1055257121,111988810,565911168,523449571]},{"one":[409706917,387788290,718980404,1038217645]},{"one":[601201424,722264629,816882110,831985809]}]},{"one":[354972143,512676720,452679130]}]},"Zaahen_ZaahenQ2_buffactivate":536353516,"Zaahen_ZaahenEAttack_aoe_buffactivate":{"one":[606452474,282830202]},"Zaahen_ZaahenR_OnCast":1053678216,"Zaahen_ZaahenW_OnMissileLaunch":{"one":[1028303861,288329862]},"Zaahen_ZaahenQ2Attack_OnHit":{"one":[995990725,551944825]},"Zaahen_ZaahenP_revive_buffactivate":1034433012,"Zaahen_ZaahenW_OnCast":{"one":[1041143723,910007722]},"Zaahen_ZaahenBasicAttack2_OnCast":{"one":[150516804,841883242,946425146]},"Zaahen_ZaahenBasicAttack2_OnHit":{"all":[{"one":[{"one":[718980404,409706917,1038217645,387788290]},{"one":[878114572,850967435,108191969,150841008]},{"one":[722264629,601201424,816882110,831985809]},{"one":[111988810,523449571,1055257121,565911168]}]},{"one":[354972143,512676720,452679130]}]},"Zaahen_ZaahenW_pull_cast":781873022,"Zaahen_ZaahenCritAttack3_OnHit":{"all":[{"one":[{"one":[850967435,878114572,150841008,108191969]},{"one":[1055257121,111988810,565911168,523449571]},{"one":[409706917,387788290,718980404,1038217645]},{"one":[601201424,722264629,816882110,831985809]}]},{"one":[354972143,512676720,452679130]}]},"Zaahen_ZaahenCritAttack2_OnHit":{"all":[{"one":[{"one":[850967435,878114572,150841008,108191969]},{"one":[1055257121,111988810,565911168,523449571]},{"one":[409706917,387788290,718980404,1038217645]},{"one":[601201424,722264629,816882110,831985809]}]},{"one":[354972143,512676720,452679130]}]},"Zaahen_ZaahenQAttack_OnCast":75619329,"Zaahen_ZaahenW_hit_champion":{"one":[787309293,573927370,809489398]},"Zaahen_ZaahenQ1_buffactivate":888586455,"Zaahen_ZaahenCritAttack3_OnCast":{"one":[946425146,841883242,150516804]},"Zaahen_ZaahenBasicAttack3_OnHit":{"all":[{"one":[{"one":[718980404,409706917,1038217645,387788290]},{"one":[878114572,850967435,108191969,150841008]},{"one":[722264629,601201424,816882110,831985809]},{"one":[111988810,523449571,1055257121,565911168]}]},{"one":[354972143,512676720,452679130]}]},"Zaahen_ZaahenE_OnCast":{"one":[326242071,613405903]},"Zaahen_ZaahenQ2Attack_OnCast":427907589,"Zaahen_ZaahenEAttack_AoE_buffactivate":{"one":[606452474,282830202]},"Zaahen_ZaahenBasicAttack_OnHit":{"all":[{"one":[{"one":[718980404,409706917,1038217645,387788290]},{"one":[878114572,850967435,108191969,150841008]},{"one":[722264629,601201424,816882110,831985809]},{"one":[111988810,523449571,1055257121,565911168]}]},{"one":[354972143,512676720,452679130]}]},"Zaahen_ZaahenEAttack_hit_inner":{"one":[872074790,44608238]},"Zaahen_ZaahenQAttack_OnHit":{"one":[218716834,1071418180]},"Zaahen_ZaahenQ2_warning_buffactivate":{"all":[536353516,{"one":[967166428,7160776]}]},"Zaahen_ZaahenEAttack_hit_outer":{"one":[523689470,173625502]},"Zaahen_ZaahenQ2_OnCast":{"one":[967166428,7160776]},"Zaahen_ZaahenR_AoE_hit_champion":{"one":[229250042,499557339,18023312]},"Zaahen_ZaahenCritAttack2_OnCast":{"one":[946425146,841883242,150516804]},"Zaahen_ZaahenQ_OnCast":{"one":[24083510,269281099]},"Zaahen_ZaahenBasicAttack3_OnCast":{"one":[150516804,841883242,946425146]},"Zaahen_ZaahenR_AoE_buffactivate":579761646}}};
    const bridge = { pending: new Map(), started: new Map(), url: new Map() };
    window.addEventListener('message', e => {
        const d = e.data;
        if (!d || typeof d.cbcSfxRes !== 'string') return;
        const res = bridge.pending.get(d.cbcSfxRes);
        if (!res) return;
        bridge.pending.delete(d.cbcSfxRes);
        res(d.ok && d.buf ? URL.createObjectURL(new Blob([d.buf], { type: 'audio/mp4' })) : null);
    });
    // The files are fetched straight from the public repo (raw.githubusercontent.com allows any origin), so no
    // companion script is needed (viaBridge is kept only for a page that answers through one).
    const REPO_SFX = 'https://raw.githubusercontent.com/yufanwang07/ultra-secret-pantheon-tech/main/sfx/';
    function viaBridge(path) {
        return new Promise(res => {
            bridge.pending.set(path, res);
            window.postMessage({ cbcSfxReq: path }, '*');
            setTimeout(() => { if (bridge.pending.delete(path)) res(null); }, 10000);
        });
    }
    function fetchLocal(path) {
        if (!bridge.started.has(path)) bridge.started.set(path,
            fetch(REPO_SFX + path).then(r => r.ok ? r.blob() : null)
                .then(b => b ? URL.createObjectURL(new Blob([b], { type: 'audio/mp4' })) : null)
                // a page whose CSP blocks the fetch can still play the file as media, like the wiki's sounds
                .catch(() => REPO_SFX + path)
                .then(u => { if (u) bridge.url.set(path, u); return u; }));
        return bridge.started.get(path);
    }
    function treeFiles(x, out = []) { if (typeof x === 'number') out.push(x); else if (x) for (const v of Object.values(x)) for (const y of v) treeFiles(y, out); return out; }
    function preloadLocal(types) {
        for (const t of new Set(types)) {
            const L = LOCAL_SFX[t]; if (!L) continue;
            for (const tr of Object.values(L.trees)) for (const f of treeFiles(tr)) fetchLocal(`${L.dir}/${f}.m4a`);
        }
    }
    const localReady = t => { const L = LOCAL_SFX[t]; if (!L) return false; const fs = Object.values(L.trees).flatMap(tr => treeFiles(tr));
        return fs.length > 0 && fs.filter(f => bridge.url.has(`${L.dir}/${f}.m4a`)).length >= fs.length * 0.6; };
    function playTree(dir, tr, vol) {
        if (tr == null) return false;
        if (typeof tr === 'number') { const u = bridge.url.get(`${dir}/${tr}.m4a`); return !!(u && sfx(null, { vol, src: u })); }
        if (tr.one) return playTree(dir, tr.one[Math.floor(Math.random() * tr.one.length)], vol);
        let any = false; for (const x of tr.all || []) any = playTree(dir, x, vol) || any; return any;
    }
    // shuffle bags: go through every option before repeating, never the same one twice in a row
    const sfxBags = new Map();
    function fromBag(key, n) {
        let b = sfxBags.get(key);
        if (!b || !b.left.length) {
            const left = [...Array(n).keys()];
            for (let i = left.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [left[i], left[j]] = [left[j], left[i]]; }
            if (b && left.length > 1 && left[left.length - 1] === b.last) [left[0], left[left.length - 1]] = [left[left.length - 1], left[0]];
            b = { left, last: b?.last }; sfxBags.set(key, b);
        }
        return (b.last = b.left.pop());
    }
    // how long each of a champion's longer sound events runs (seconds, only the ones over 1.6 s): buff loops
    // (10-17 s) never play, and a dash only uses short, sudden ones
    const EV_DUR = {"0:Pantheon_PantheonEShieldSlam_hit_lua":2.1,"0:Pantheon_PantheonCritAttack_OnHit":2.2,"0:Pantheon_PantheonE_OnBuffActivate":3.3,"0:Pantheon_PantheonW_hit":2.0,"0:Pantheon_PantheonQTap_hit_empowered_vfx":2.6,"0:Pantheon_PantheonQ_buffactivate_vfx":4.0,"0:Pantheon_PantheonR_OnCast":3.3,"0:Pantheon_PantheonR_OnCast_blast_stereo_vfx":2.7,"0:Pantheon_PantheonR_OnCast_stereo":3.1,"0:Pantheon_PantheonPassiveReady_OnBuffActivate":2.7,"0:Pantheon_PantheonE_OnCast":2.1,"0:Pantheon_PantheonQ_OnCast":2.6,"0:Pantheon_PantheonQMissile_hit_empowered_vfx":2.6,"0:Pantheon_PantheonQ_buffactivate_empowered_vfx":3.9,"0:Pantheon_PantheonEShieldSlam_OnCast":2.2,"0:Pantheon_PantheonR_land_vfx":1.9,"0:Pantheon_PantheonCritAttack_OnCast":1.8,"1:Vayne_VayneInquisition_OnBuffActivate":5.7,"1:Vayne_VayneInquisition_OnCast":3.3,"1:Vayne_VayneTumbleAttack_OnMissileLaunch":1.9,"1:Vayne_VayneTumbleBonus_OnBuffActivate":1.7,"1:Vayne_VayneTumbleFade_OnBuffActivate":2.0,"1:Vayne_VayneTumbleUltAttack_OnMissileLaunch":1.9,"1:Vayne_VayneSilveredBolts_OnBuffActivate":2.3,"2:Akali_AkaliE_OnCast":2.0,"2:Akali_AkaliBasicAttackPassive_OnHit":2.2,"2:Akali_AkaliBasicAttackPassiveMelee_OnHit":2.3,"2:Akali_AkaliEmis_cloudhit":3.5,"2:Akali_AkaliP_Activate_Enemy":3.8,"2:Akali_AkaliW_OnCastSelf":11.2,"2:Akali_AkaliRb_hit":1.7,"2:Akali_AkaliR_Cast":1.8,"2:Akali_AkaliRb_OnCast":1.6,"2:Akali_AkaliEmis_OnMissileLaunch":1.8,"3:Yuumi_YuumiBasicAttack2_OnHit":2.6,"3:Yuumi_YuumiEShield_buffactivate":6.5,"3:Yuumi_YuumiR_OnCast":5.3,"3:Yuumi_YuumiE_cast":5.5,"3:Yuumi_YuumiRmissile_OnMissileCast":2.3,"3:Yuumi_YuumiE_Cast":5.5,"3:Yuumi_YuumiCritAttack_OnHit":2.6,"3:Yuumi_YuumiBasicAttack_OnHit":2.6,"4:NidaleeCougar_NidaleeCougarCritAttack_OnHit":1.7,"4:NidaleeCougar_NidaleeCougarBasicAttack_OnHit":1.7,"4:NidaleeCougar_Takedown_OnBuffActivate":11.3,"4:NidaleeCougar_NidaleeCougarBasicAttack2_OnHit":1.7,"4:NidaleeCougar_Takedown_OnCast":2.0,"5:Seraphine_SeraphineW2Warning_OnBuffActivate":3.5,"5:Seraphine_SeraphineEStun_OnBuffActivate":2.4,"5:Seraphine_SeraphinePassiveNotesBuff_OnBuffActivate":4.7,"5:Seraphine_SeraphineQInitialMissile_OnHitLocation":1.7,"5:Seraphine_SeraphinePassiveEchoStage2_OnBuffActivate":1.7,"5:Seraphine_SeraphineERoot_OnBuffActivate":1.7,"5:Seraphine_SeraphineR_cast":2.3,"5:Seraphine_SeraphineR_OnCast":3.1,"5:Seraphine_SeraphinePEcho_ready_buffactivate_self":2.4,"5:Seraphine_SeraphineECastEcho_OnCast":2.3,"5:Seraphine_SeraphineQCastEcho_OnCast":2.5,"5:Seraphine_SeraphineWCastEcho_OnCast":2.2,"5:Seraphine_SeraphineW_OnCast":2.1,"5:Seraphine_SeraphineRCharm_hit":2.2,"5:Seraphine_SeraphineR_OnMissileCast":2.2,"5:Seraphine_SeraphineR_hit":1.8,"5:Seraphine_Winddown3D_buffactivate":4.4,"6:Mel_MelE_OnMissileCast":2.2,"6:Mel_MelQ_hit_fullcombo":2.6,"6:Mel_Winddown3D_buffactivate":3.8,"6:Mel_MelCritAttack_OnCast":2.0,"6:Mel_MelE_hit_root_champion_buffactivate":2.6,"6:Mel_MelQ_hitlocation":3.5,"6:Mel_MelBasicAttack_OnHit":1.6,"6:Mel_MelQ_OnCast":2.5,"6:Mel_MelBasicAttack_OnCast":2.0,"6:Mel_MelMark_execute_ready_buffactivate":3.0,"6:Mel_MelE_OnMissileLaunch":2.0,"6:Mel_MelE_hit_edge":2.2,"6:Mel_MelW_OnCast":2.1,"6:Mel_MelMark_buffactivate":3.9,"6:Mel_MelBasicAttackEnhanced_OnHit":1.6,"6:Mel_MelBasicAttackEnhanced_OnMissileCast":2.1,"6:Mel_MelCritAttack_OnHit":1.6,"6:Mel_MelR_enemy_hit":2.1,"6:Mel_MelR_warning_buffactivate_target2D":2.1,"6:Mel_MelR_OnCast":4.4,"7:Riven_RivenFengShuiEngine_OnBuffActivate":5.6,"7:Riven_RivenMartyr_OnCast":3.6,"7:Riven_RivenTriCleave_hit_b":1.8,"7:Riven_RivenFengShuiEngine_OnCast":2.9,"8:Soraka_SorakaPassive_OnBuffActivate":6.3,"8:Soraka_SorakaW_OnCast":3.0,"8:Soraka_SorakaQMissile_OnHitLocation":2.2,"8:Soraka_SorakaR_OnCast":2.5,"8:Soraka_SorakaE_OnHit":2.2,"8:Soraka_SorakaESnare_OnBuffActivate":3.8,"8:Soraka_SorakaQ_OnCast":2.4,"8:Soraka_Wish_hit":4.4,"8:Soraka_SorakaQMissile_OnMissileLaunch":2.6,"8:Soraka_SorakaWParticleMissile_OnMissileLaunch":3.7,"8:Soraka_SorakaQReturnMissile_OnMissileLaunch":3.3,"8:Soraka_SorakaE_buffactivate":3.4,"8:Soraka_SorakaE_OnCast":1.9,"9:LeeSin_LeeSinWTwo_OnCast":4.3,"9:LeeSin_LeeSinETwoDebuff_buffactivate":4.3,"9:LeeSin_LeeSinQOne_OnBuffActivate":4.2,"9:LeeSin_LeeSinR_OnHit":2.8,"9:LeeSin_LeeSinEOne_hitlocation_ground":2.2,"9:LeeSin_LeeSinWOneShield_OnBuffActivate":4.2,"9:LeeSin_LeeSinQOne_OnHit":2.4,"9:LeeSin_LeeSinEOne_OnHitLocation":2.5,"9:LeeSin_LeeSinR_OnCast":1.9,"9:LeeSin_LeeSinQOne_OnMissileLaunch":2.2,"9:LeeSin_LeeSinQTwoDash_buffactivate":1.7,"10:Volibear_VolibearRTowerDisable_hit":2.4,"10:Volibear_VolibearR_cast":3.9,"10:Volibear_VolibearR_jump":1.9,"10:Volibear_Roar_cast":3.3,"10:Volibear_Winddown3D_buffactivate":3.1,"10:Volibear_VolibearRSweetSpot_hit":2.1,"10:Volibear_VolibearQAttack_OnHit":2.0,"10:Volibear_VolibearR_hit_ground":2.1,"10:Volibear_VolibearQ_OnBuffActivate":6.4,"10:Volibear_VolibearEShield_OnBuffActivate":3.7,"10:Volibear_VolibearE_buffactivate":3.0,"10:Volibear_VolibearR_OnBuffActivate":6.7,"10:Volibear_VolibearE_OnCast":1.7,"10:Volibear_VolibearQ_OnCast":2.6,"10:Volibear_VolibearE_hit":1.9,"10:Volibear_Celebrate_buffactivate":2.7,"10:Volibear_VolibearE_enemy_buffactivate":3.0,"10:Volibear_VolibearPApplicator_OnBuffActivate":5.9,"11:Sejuani_SejuaniCritAttack_OnCast":2.1,"11:Sejuani_SejuaniQ_OnCast":1.9,"11:Sejuani_SejuaniCritAttack3_OnCast":2.1,"11:Sejuani_SejuaniEPassiveMissile_OnMissileCast":2.1,"11:Sejuani_SejuaniQ_hit":3.1,"11:Sejuani_SejuaniR_hit":4.9,"11:sejuani_SejuaniP_hit":5.5,"11:Sejuani_SejuaniR_hit_close":4.9,"11:Sejuani_SejuaniR_OnCast":2.3,"11:Sejuani_SejuaniBasicAttack3_OnCast":2.1,"11:Sejuani_SejuaniP_hit":5.5,"11:Sejuani_SejuaniEPassiveMissile_OnHit":3.5,"11:Sejuani_SejuaniBasicAttack2_OnCast":2.1,"11:Sejuani_SejuaniEStack4_hit":4.6,"11:Sejuani_SejuaniW_OnCast":1.8,"11:Sejuani_SejuaniPassiveDefense_OnBuffActivate":4.0,"11:Sejuani_SejuaniBasicAttack_OnCast":2.1,"11:Sejuani_SejuaniBasicAttackW_OnCast":2.1,"11:Sejuani_SejuaniE2_OnCast":1.8,"11:Sejuani_SejuaniR_miss":4.9,"11:Sejuani_SejuaniE2_OnHit":2.0,"11:Sejuani_SejuaniCritAttack2_OnCast":2.1,"12:Zaahen_ZaahenBasicAttack_OnCast":2.8,"12:Zaahen_ZaahenCritAttack_OnCast":2.8,"12:Zaahen_ZaahenCritAttack_OnHit":2.4,"12:Zaahen_ZaahenQ2_buffactivate":16.4,"12:Zaahen_ZaahenEAttack_aoe_buffactivate":1.8,"12:Zaahen_ZaahenR_OnCast":2.0,"12:Zaahen_ZaahenW_OnMissileLaunch":2.7,"12:Zaahen_ZaahenQ2Attack_OnHit":3.4,"12:Zaahen_ZaahenP_revive_buffactivate":8.2,"12:Zaahen_ZaahenBasicAttack2_OnCast":2.8,"12:Zaahen_ZaahenBasicAttack2_OnHit":2.4,"12:Zaahen_ZaahenW_pull_cast":2.0,"12:Zaahen_ZaahenCritAttack3_OnHit":2.4,"12:Zaahen_ZaahenCritAttack2_OnHit":2.4,"12:Zaahen_ZaahenQAttack_OnCast":1.7,"12:Zaahen_ZaahenQ1_buffactivate":16.7,"12:Zaahen_ZaahenCritAttack3_OnCast":2.8,"12:Zaahen_ZaahenBasicAttack3_OnHit":2.4,"12:Zaahen_ZaahenEAttack_AoE_buffactivate":1.8,"12:Zaahen_ZaahenBasicAttack_OnHit":2.4,"12:Zaahen_ZaahenQAttack_OnHit":3.2,"12:Zaahen_ZaahenQ2_warning_buffactivate":16.4,"12:Zaahen_ZaahenEAttack_hit_outer":2.2,"12:Zaahen_ZaahenQ2_OnCast":4.1,"12:Zaahen_ZaahenR_AoE_hit_champion":2.0,"12:Zaahen_ZaahenCritAttack2_OnCast":2.8,"12:Zaahen_ZaahenQ_OnCast":5.0,"12:Zaahen_ZaahenBasicAttack3_OnCast":2.8,"12:Zaahen_ZaahenR_AoE_buffactivate":3.0};
    const evLen = (type, ev) => EV_DUR[type + ':' + ev] || 1;
    // projectile flight time (ms at 1x, the viewer's own effect timings) for ranged champions: the impact sound lands
    // when the projectile does
    const FLIGHT_MS = { 1: 300, 3: 435, 5: 650, 6: 650, 8: 750, 11: 565 };
    const pickEv = (L, list, key) => list?.length ? L.trees[list[key ? fromBag(key, list.length) : Math.floor(Math.random() * list.length)]] : null;
    // one attack / ability / attack reset in the champion's own sounds; false if they aren't loaded
    function localChamp(type, what, vol, spd, slot = -1, atype = 0) {
        if (!localReady(type)) return false;
        const L = LOCAL_SFX[type];
        let g, gi = 0;
        const dash = what === 'ability' && atype === 6, maxLen = dash ? 1.6 : 7.5;
        const ok = list => (list || []).filter(ev => evLen(type, ev) <= maxLen);
        if (what === 'attack') g = L.attack;
        else if (what === 'reset') g = L.reset || L.abilities[0];
        else {
            // each ability slot draws from its own share of the champion's abilities (Stellar: all of them), rotating;
            // a dash only from abilities that have a short cast or impact
            const all = L.abilities.map((_, i) => i).filter(i => !dash || ok(L.abilities[i].cast).length || ok(L.abilities[i].hit).length);
            const pool = type === 5 || slot < 0 || all.length < 2 ? all : all.filter(i => i % 2 === slot % 2);
            gi = pool[fromBag(`ab${type}:${type === 5 ? '*' : slot}`, pool.length)];
            g = L.abilities[gi];
        }
        if (!g) return false;
        const k = what === 'attack' ? 0.7 : 1, bk = `${type}:${what}:${gi}${dash ? 'd' : ''}`;
        playTree(L.dir, pickEv(L, ok(g.cast), bk + 'c'), vol * k);
        if (!dash) playTree(L.dir, pickEv(L, ok(g.missile), bk + 'm'), vol * 0.8 * k);
        const hit = pickEv(L, ok(g.hit), bk + 'h');
        const at = soundAt;
        // the hit lands a beat after the swing; for a ranged champion it waits for the projectile to arrive
        const flight = FLIGHT_MS[type] ?? (MELEE.has(type) ? 0 : 400);
        const hitMs = dash ? 90 : what === 'attack' ? (MELEE.has(type) ? 45 : Math.max(130, flight * 0.8)) : (flight ? flight : 120);
        if (hit != null) setTimeout(() => { soundAt = at; playTree(L.dir, hit, vol * 0.9); soundAt = null; }, hitMs / spd);
        return true;
    }
    // --- where it happens: sounds from champions far off screen fade, ones on screen are a touch louder ----
    // The viewer's render backend (found through React) maps screen pixels to tiles; the 4 canvas corners give the
    // visible tile area (a trapezoid under the tilted camera, its bounding box is close enough).
    let backend = null, backendLook = 0, view = null, viewAt = 0;
    function findBackend() {
        if (backend?.screenToTile && backend.htmlRefs?.canvas?.isConnected) return backend;
        if (performance.now() - backendLook < 3000) return null;
        backendLook = performance.now();
        for (const el of document.querySelectorAll('canvas, main *, [aria-label="Map view controls"] *')) {
            const k = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
            for (let f = k && el[k], n = 0; f && n < 40; f = f.return, n++) {
                const b = f.memoizedProps?.backend;
                if (b?.screenToTile) return (backend = b);
            }
        }
        return null;
    }
    // --- dual camera (League's spectator split screen / picture-in-picture) --------------------------------------
    const DUAL = {};
    // dualcam.js - League-style "dual camera" for the Cambridge Battlecode replay viewer (Pixi/WebGL2 backend).
    //
    // Self-contained. Two parts:
    //   createDualCam({ getBackend })   the renderer: draws a second camera view into a 2D overlay canvas over the map,
    //                                   either as a slanted split screen (right pane) or a picture-in-picture inset.
    //   createDualDirector(opts)        the selection logic: given the cinema director's shots, decides when a split or
    //                                   PiP is worth it, and keeps it rare (cooldowns, a budget per window of rounds,
    //                                   minimum overlap / distance / hold, hysteresis).
    //
    // How the second view is rendered: the viewer's frame is driven by Pixi's app.ticker (rAF) -> backend.tick ->
    // backend.render() -> emit('tick') (scene update), camera.update(), pipeline.render() (a dirty-checked render
    // graph that draws straight to the WebGL canvas, preserveDrawingBuffer: false). We shadow backend.render with an
    // instance property. While a second view is shown, each frame we
    //   1. move the camera to view B, pipeline.render(true), and drawImage() the WebGL canvas into our overlay 2D
    //      canvas in the same task (the drawing buffer is still valid until the task ends),
    //   2. restore the camera exactly (so the cinema camTick never sees a "manual" move), and
    //   3. call the original render(), which redraws view A; that is the frame the compositor presents. No flicker.
    // B is drawn before this frame's scene update, so it lags A by one frame (~16 ms), which is invisible.
    // The main camera is never offset: in split mode, camTick should frame its subject into mainPane() instead of the
    // whole canvas, so the main canvas's left side shows view A and everything that projects with the real camera
    // (death skulls, clicks, screenToTile) stays right.
    (function (root) {
        'use strict';
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const ease = k => k * k * (3 - 2 * k);

        function createDualCam({ getBackend, opts: o = {} } = {}) {
            const O = Object.assign({
                slant: 0.05,          // split divider: top end is this much (fraction of width) right of centre, bottom end left
                clearTop: 0.24,       // the viewer's team bars cover the top of the canvas: frame into the clear part below
                clearBottom: 0.08,
                pad: 18,              // px kept clear inside a pane when fitting a frame
                minDist: 12, maxDist: 110, // camera distance limits (same as camTick)
                minPPU: 27,           // never zoom a pane out past this many screen px per tile: the viewer swaps sprites
                                      // for champion icons at ~24 px/tile (d ~ 27 at a 735 px tall canvas)
                splitTight: 0.62,     // split panes are about half as wide: frame only this much of a frame's width
                                      // (keeps the zoom close to the single camera's instead of doubling the distance)
                inMs: 450, outMs: 380, // wipe / pop timings
                pipW: 0.32, pipAspect: 4 / 3, pipMargin: 14, pipCorner: 'br', // PiP inset: fraction of canvas width
                pipZoom: 0.55,        // PiP source region height as a fraction of the canvas: smaller = more zoomed in
                pipEvery: 1,          // render the PiP view every Nth frame (2 = half rate, halves the cost)
                syncTiming: false,    // diagnostics only: gl.finish() inside the timers so stats include GPU time (slower)
                smooth: 0.35,         // seconds: smoothing time constant for the B camera
                divider: '#e8c66a',   // League-ish gold
            }, o);
            let backend = null, orig = null, overlay = null, ctx2d = null, frameNo = 0;
            // requested state (set every frame by the integration) and the animated state actually shown
            const want = { mode: 'off', frame: null, label: null, labelA: null };
        let promo = null; // { t0, cb }: camera 2 taking over, camera 1's pane sliding away
            const show = { mode: 'off', k: 0, t: 0, frame: null, label: null, labelA: null, cam: null, lastAt: 0 };
            const stats = { bMs: [], aMs: [], frameMs: [], lastFrame: 0, renders: 0 };
            const push = (a, v) => { a.push(v); if (a.length > 240) a.shift(); };
            const fin = b => { if (O.syncTiming) try { b.state.app.renderer.gl.finish(); } catch { } };
            function timed(b) { fin(b); const t0 = performance.now(); const r = orig.call(b); fin(b); push(stats.aMs, performance.now() - t0); return r; }

            function hook(b) {
                if (backend === b) return;
                unhook();
                if (!b?.state?.pipeline || !b.camera || !b.htmlRefs?.canvas) return;
                backend = b; orig = Object.getPrototypeOf(b).render;
                b.render = function () { return renderHook.call(this); };
            }
            function unhook() {
                if (backend && Object.prototype.hasOwnProperty.call(backend, 'render')) delete backend.render;
                backend = null; orig = null;
                overlay?.remove(); overlay = null; ctx2d = null;
            }
            function ensureOverlay(cv) {
                if (overlay && overlay.isConnected && overlay.previousSibling === cv) return;
                overlay?.remove();
                overlay = document.createElement('canvas');
                overlay.className = 'cbc-dualcam';
                overlay.setAttribute('aria-hidden', 'true');
                // right after the map canvas, in the same parent: above the map, under the viewer's own UI
                Object.assign(overlay.style, { position: 'absolute', pointerEvents: 'none', display: 'none', zIndex: '0' });
                const par = cv.parentElement;
                if (par && getComputedStyle(par).position === 'static') par.style.position = 'relative';
                cv.after(overlay);
                ctx2d = overlay.getContext('2d', { alpha: true });
            }
            function syncOverlay(cv) {
                if (overlay.width !== cv.width || overlay.height !== cv.height) { overlay.width = cv.width; overlay.height = cv.height; }
                const s = overlay.style, l = cv.offsetLeft + 'px', t = cv.offsetTop + 'px', w = cv.clientWidth + 'px', h = cv.clientHeight + 'px';
                if (s.left !== l) s.left = l; if (s.top !== t) s.top = t; if (s.width !== w) s.width = w; if (s.height !== h) s.height = h;
            }

            // --- geometry, all in the camera's viewport px (app.screen, CSS px of the canvas) ---------------------------
            // Units: lookPosition is in raw world units, but project / unprojectToPlaneZ / screenToTile work in tile units,
            // and world y = K * tile y (K = 1.25 in this build; x is 1:1). K is measured from the camera, not hard-coded.
            let Kc = null, Kfor = null;
            function yScale(c) {
                if (Kfor === c && Kc) return Kc;
                const raw = (sx, sy) => { const u = unit(c, sx, sy); return u && (c.position.y + c._distance * u.y); };
                const H = c.viewportHeight, W = c.viewportWidth, a = raw(W / 2, H * 0.3), b = raw(W / 2, H * 0.9);
                const ta = c.unprojectToPlaneZ(W / 2, H * 0.3, 0), tb = c.unprojectToPlaneZ(W / 2, H * 0.9, 0);
                const k = a != null && b != null && ta && tb && Math.abs(ta.y - tb.y) > 1e-6 ? (a - b) / (ta.y - tb.y) : 1;
                Kc = Number.isFinite(k) && k > 0.2 && k < 5 ? k : 1; Kfor = c;
                return Kc;
            }
            // offset (raw world units) from the look point to the ground point under viewport pixel (sx, sy), for a camera
            // at distance 1 (a copy of the viewer's unprojectToPlaneZ, minus its tile-y scaling). Everything scales
            // linearly with distance about the look point.
            function unit(c, sx, sy) {
                const W = c.viewportWidth, H = c.viewportHeight, r = sx / W * 2 - 1, i = 1 - sy / H * 2;
                const a = r * c._tanHalfVerticalFOV * (W / H), oo = i * c._tanHalfVerticalFOV, s = Math.cos(c._pitch), cc = Math.sin(c._pitch);
                const u = oo * cc + s, dd = oo * s - cc; if (Math.abs(dd) < 1e-10) return null;
                const f = -cc / dd; if (f <= 0) return null; // plane z = 0, camera at z = sin(pitch)
                return { x: a * f, y: -s + u * f };
            }
            // camera (look in raw world units, distance) that puts frame f = {cx, cy, w, h} (tiles) inside rect
            // R = {x0, y0, x1, y1}. `tight` < 1 lets a narrow pane crop the frame's width a little.
            function maxDist(c) { return Math.min(O.maxDist, c.viewportHeight / (2 * c._tanHalfVerticalFOV * O.minPPU)); }
            function fit(c, f, R, tight = 1) {
                const K = yScale(c), xm = (R.x0 + R.x1) / 2, ym = (R.y0 + R.y1) / 2;
                const C = unit(c, xm, ym), L = unit(c, R.x0 + O.pad, ym), Rr = unit(c, R.x1 - O.pad, ym), T = unit(c, xm, R.y0 + O.pad), B = unit(c, xm, R.y1 - O.pad);
                if (!C || !L || !Rr || !T || !B) return null;
                const kw = Math.abs(Rr.x - L.x), kh = Math.abs(B.y - T.y) / K; // tiles per unit of distance
                const d = clamp(Math.max(f.w * tight / kw, f.h / kh), O.minDist, Math.max(O.minDist, maxDist(c)));
                return { x: f.cx - d * C.x, y: K * f.cy - d * C.y, d };
            }
            // divider ends at animation progress e (0 = B pane fully off to the right, 1 = in place)
            function divider(W, H, e) {
                const xt = W * (0.5 + O.slant), xb = W * (0.5 - O.slant), off = (1 - e) * (W - xb + 4);
                return { xt: xt + off, xb: xb + off };
            }
            // Split = two cameras side by side, no overlap: each camera renders the full canvas framed on the middle, and
            // the middle strip of each render is placed in its half (A shifted left, B shifted right). So both panes frame
            // their subject into the same central rect of their own render.
            const cropW = W => W * (0.5 + O.slant), shiftOf = W => (W - cropW(W)) / 2;
            function panes(c) {
                const W = c.viewportWidth, H = c.viewportHeight, y0 = H * O.clearTop, y1 = H * (1 - O.clearBottom);
                const w = W * (0.5 - 2 * O.slant), x0 = (W - w) / 2, R = { x0, y0, x1: x0 + w, y1 };
                return { a: R, b: R };
            }
            // opaque, always: the viewer's own background colour is fully transparent (#00000000), so filling with it let
            // the other camera show through every hole in the map
            const bg = () => '#17181d';
            function pipRects(c, e) {
                const W = c.viewportWidth, H = c.viewportHeight, w = W * O.pipW, h = w / O.pipAspect, m = O.pipMargin;
                const x = O.pipCorner.includes('l') ? m : W - w - m, y = O.pipCorner.includes('t') ? H * O.clearTop + m : H - h - m;
                const sc = 0.82 + 0.18 * e; // pops in from slightly smaller
                const dst = { x: x + w * (1 - sc) / 2, y: y + h * (1 - sc) / 2, w: w * sc, h: h * sc };
                // the region of a full-size render that becomes the inset: centred in the clear area, inset aspect
                const sh = H * O.pipZoom, sw = sh * O.pipAspect, cy = H * (O.clearTop + (1 - O.clearTop - O.clearBottom) / 2);
                const src = { x0: W / 2 - sw / 2, y0: cy - sh / 2, x1: W / 2 + sw / 2, y1: cy + sh / 2 };
                return { dst, src };
            }

            // --- per-frame: animate, render B, composite ------------------------------------------------------------------
            function step(now) {
                const dt = Math.min(0.1, (now - (show.t || now)) / 1000); show.t = now;
                const wantOn = want.mode !== 'off' && want.frame;
                if (wantOn && show.mode !== 'off' && show.mode !== want.mode) { // switching split <-> pip: go out first
                    show.k = Math.max(0, show.k - dt * 1000 / O.outMs);
                    if (show.k === 0) { show.mode = 'off'; }
                } else if (wantOn) {
                    if (show.mode === 'off') { show.mode = want.mode; show.cam = null; }
                    show.k = Math.min(1, show.k + dt * 1000 / O.inMs);
                    show.frame = want.frame; show.label = want.label; show.labelA = want.labelA;
                } else if (show.mode !== 'off') {
                    show.k = Math.max(0, show.k - dt * 1000 / O.outMs);
                    if (show.k === 0) { show.mode = 'off'; show.cam = null; }
                }
                return dt;
            }
            function renderHook() {
                const b = this;
                if (b !== backend) return orig ? orig.call(b) : Object.getPrototypeOf(b).render.call(b);
                const now = performance.now();
                if (stats.lastFrame) push(stats.frameMs, now - stats.lastFrame);
                stats.lastFrame = now;
                const dt = step(now);
                const cv = b.htmlRefs.canvas;
                if (show.mode === 'off') { if (overlay) overlay.style.display = 'none'; return timed(b); }
                let ready = false;
                try { ready = b.isReady() && !b.destroyed; } catch { }
                if (!ready) return orig.call(b);
                ensureOverlay(cv); syncOverlay(cv);
                const c = b.camera, pl = b.state.pipeline, W = c.viewportWidth, H = c.viewportHeight, px = cv.width / W;
                const e = ease(show.k);
                frameNo++;
                const doB = show.mode === 'split' || promo || frameNo % Math.max(1, O.pipEvery) === 0 || !show.cam;
            const pp = promo ? ease(Math.min(1, (now - promo.t0) / 520)) : 0; // promote progress
                if (doB) {
                    // where B's camera should be: fit the frame into its pane (or into the PiP source region), smoothed
                    const R = show.mode === 'split' ? panes(c).b : pipRects(c, 1).src;
                    const tgt = fit(c, show.frame, R, show.mode === 'split' ? O.splitTight : 1);
                    if (tgt) {
                        if (!show.cam) show.cam = { x: tgt.x, y: tgt.y, z: Math.log(tgt.d) };
                        else { const kk = 1 - Math.exp(-dt / O.smooth); show.cam.x += (tgt.x - show.cam.x) * kk; show.cam.y += (tgt.y - show.cam.y) * kk; show.cam.z += (Math.log(tgt.d) - show.cam.z) * kk; }
                    }
                    if (show.cam) {
                        const L = c._lookPosition, save = { x: L.x, y: L.y, z: L.z, d: c._distance };
                        fin(b); const t0 = performance.now();
                        try {
                            L.x = show.cam.x; L.y = show.cam.y; c._distance = Math.exp(show.cam.z); c.invalidateViewport();
                            // a full render pass, scene update included, so screen-space things (health bars, unit icons
                            // and their layering) are laid out for B's camera, not A's
                            orig.call(b); pl.render(true);
                            ctx2d.setTransform(1, 0, 0, 1, 0, 0); ctx2d.clearRect(0, 0, overlay.width, overlay.height);
                            if (show.mode === 'split') {
                                let { xt, xb } = divider(W, H, e);
                                if (promo) { xt -= (xt + 2) * pp; xb -= (xb + W * 0.2) * pp; } // camera 1's pane slides off to the left
                                ctx2d.save(); ctx2d.beginPath();
                                ctx2d.moveTo(xt * px, 0); ctx2d.lineTo(cv.width + 2, 0); ctx2d.lineTo(cv.width + 2, cv.height); ctx2d.lineTo(xb * px, cv.height); ctx2d.closePath(); ctx2d.clip();
                                // the pane slides in with its divider: B's picture moves with it; opaque, so nothing shows through gaps
                                const off = promo ? shiftOf(W) * (1 - pp) * px : (xt - W * (0.5 + O.slant)) * px + shiftOf(W) * px;
                                ctx2d.fillStyle = bg(); ctx2d.fillRect(0, 0, cv.width, cv.height);
                                ctx2d.drawImage(cv, off, 0);
                                ctx2d.restore();
                            } else {
                                let { dst, src } = pipRects(c, e);
                                if (promo) { // the inset grows to fill the screen
                                    const L2 = (a, z) => a + (z - a) * pp;
                                    dst = { x: L2(dst.x, 0), y: L2(dst.y, 0), w: L2(dst.w, W), h: L2(dst.h, H) };
                                    src = { x0: L2(src.x0, 0), y0: L2(src.y0, 0), x1: L2(src.x1, W), y1: L2(src.y1, H) };
                                }
                                ctx2d.globalAlpha = e;
                                ctx2d.fillStyle = bg(); ctx2d.fillRect(dst.x * px, dst.y * px, dst.w * px, dst.h * px);
                                ctx2d.drawImage(cv, src.x0 * px, src.y0 * px, (src.x1 - src.x0) * px, (src.y1 - src.y0) * px, dst.x * px, dst.y * px, dst.w * px, dst.h * px);
                                ctx2d.globalAlpha = 1;
                            }
                        } finally {
                            L.x = save.x; L.y = save.y; L.z = save.z; c._distance = save.d; c.invalidateViewport();
                        }
                        fin(b); push(stats.bMs, performance.now() - t0); stats.renders++;
                        decorate(c, px, e);
                    }
                } // else (PiP at pipEvery > 1): the overlay keeps last frame's inset
                overlay.style.display = '';
                const res = timed(b); // view A, the one actually presented
                if (show.mode === 'split' && show.cam) { // ... and its middle strip, moved into the left pane
                    let { xt, xb } = divider(W, H, e);
                    if (promo) { xt -= (xt + 2) * pp; xb -= (xb + W * 0.2) * pp; }
                    ctx2d.save(); ctx2d.setTransform(1, 0, 0, 1, 0, 0); ctx2d.beginPath();
                    ctx2d.moveTo(-2, 0); ctx2d.lineTo(xt * px, 0); ctx2d.lineTo(xb * px, cv.height); ctx2d.lineTo(-2, cv.height); ctx2d.closePath(); ctx2d.clip();
                    ctx2d.fillStyle = bg(); ctx2d.fillRect(0, 0, cv.width, cv.height);
                    ctx2d.drawImage(cv, -shiftOf(W) * e * px, 0);
                    ctx2d.restore();
                    // the divider sits exactly on the edge between the two panes, wherever that is mid-transition
                    const g = ctx2d; g.save(); g.scale(px, px); g.lineCap = 'butt';
                    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 7; g.beginPath(); g.moveTo(xt, -2); g.lineTo(xb, H + 2); g.stroke();
                    g.strokeStyle = O.divider; g.lineWidth = 3; g.beginPath(); g.moveTo(xt, -2); g.lineTo(xb, H + 2); g.stroke(); g.restore();
                }
                if (promo && pp >= 1) { // done: the main camera jumps to exactly where camera 2 was, and the overlay goes
                    const cb = promo.cb, cam = show.cam; promo = null;
                    show.mode = 'off'; show.k = 0; show.cam = null; want.mode = 'off';
                    if (overlay) overlay.style.display = 'none';
                    try { cb?.(cam); } catch { }
                }
                return res;
            }
            function decorate(c, px, e) {
                const W = c.viewportWidth, H = c.viewportHeight, g = ctx2d;
                g.save(); g.scale(px, px);
                if (show.mode === 'split') {
                    g.restore(); return; // drawn with the left pane, at its real edge
                    const { xt, xb } = divider(W, H, e);
                    g.lineCap = 'butt';
                    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 7; g.beginPath(); g.moveTo(xt, -2); g.lineTo(xb, H + 2); g.stroke();
                    g.strokeStyle = O.divider; g.lineWidth = 3; g.beginPath(); g.moveTo(xt, -2); g.lineTo(xb, H + 2); g.stroke();
                    if (show.label) label(g, show.label, Math.max((xt + xb) / 2 + 30, W * 0.62), H * O.clearTop + 18, e, 'left');
                    if (show.labelA) label(g, show.labelA, 14, H * O.clearTop + 18, e, 'left');
                } else {
                    const { dst } = pipRects(c, e);
                    g.globalAlpha = e;
                    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 5; g.strokeRect(dst.x, dst.y, dst.w, dst.h);
                    g.strokeStyle = O.divider; g.lineWidth = 2; g.strokeRect(dst.x, dst.y, dst.w, dst.h);
                    if (show.label) label(g, show.label, dst.x + 8, dst.y + 8, e, 'left');
                }
                g.restore();
            }
            function label(g, text, x, y, a, align) {
                g.globalAlpha = a; g.font = '600 12px system-ui, sans-serif'; g.textBaseline = 'top'; g.textAlign = align;
                const w = g.measureText(text).width;
                g.fillStyle = 'rgba(10,14,20,0.72)'; g.fillRect(x - 5, y - 3, w + 10, 18);
                g.fillStyle = '#f2e3b3'; g.fillText(text, x, y); g.globalAlpha = 1;
            }

            // keep the hook on the current backend (the viewer can recreate it)
            let raf = 0;
            (function watch() { raf = requestAnimationFrame(watch); try { const b = getBackend?.(); if (b && b !== backend) hook(b); } catch { } })();

            const api = {
                // mode: 'off' | 'split' | 'pip'; frame: {cx, cy, w, h} in tiles (frameShot's output) for the second view
                set(mode, frame, { label = null, labelA = null } = {}) { if (promo) return; want.mode = frame ? mode : 'off'; want.frame = frame || want.frame; want.label = label; want.labelA = labelA; },
                off() { if (!promo) want.mode = 'off'; },
                // camera 2 takes over: camera 1's pane slides away, then cb({x, y, z}) gets camera 2's camera (look in world
                // units, z = log distance) to put the main camera on, so the switch is seamless
                promote(cb) { if (show.mode === 'off' || !show.cam || promo) return false; promo = { t0: performance.now(), cb }; return true; },
                get promoting() { return !!promo; },
                get mode() { return show.mode; },          // what's on screen (stays 'split'/'pip' while animating out)
                get progress() { return show.k; },
                // The client-px rect camTick should frame its own subject into (the full clear area when not split).
                // Mixing by progress makes the main camera glide over as the pane wipes in/out.
                mainPane(rc) {
                    const b = backend, c = b?.camera; if (!c || !rc) return null;
                    const s = rc.width / c.viewportWidth, top = rc.top + rc.height * O.clearTop, bottom = rc.bottom - rc.height * O.clearBottom;
                    if (show.mode !== 'split' && want.mode !== 'split') return { left: rc.left, right: rc.right, top, bottom };
                    const k = want.mode === 'split' ? 1 : ease(show.k), a = panes(c).a; // jump the framing target; camTick's spring smooths it
                    return { left: rc.left + a.x0 * s * k, right: rc.right - (rc.width - a.x1 * s) * k, top, bottom };
                },
                // camera {x, y, d} (look position + distance) that frames f = {cx, cy, w, h} into the main pane (which:
                // 'main', honouring a split) or into the B pane ('b'). Pure: doesn't touch the camera. An alternative to
                // camTick's own screenToWorld-based fit.
                fit(f, which = 'main') {
                    const c = backend?.camera; if (!c || !f) return null;
                    const W = c.viewportWidth, H = c.viewportHeight, P = panes(c);
                    const split = show.mode === 'split' || want.mode === 'split';
                    const R = which === 'b' ? P.b : split ? P.a : { x0: 0, y0: H * O.clearTop, x1: W, y1: H * (1 - O.clearBottom) };
                    return fit(c, f, R, split ? O.splitTight : 1);
                },
                // the furthest a pane camera may zoom out (icon LOD limit); camTick should clamp to this while split
                maxDist() { const c = backend?.camera; return c ? maxDist(c) : O.maxDist; },
                // where a point of the main view (client px, as projected by the real camera) shows on screen while split
                // (the main render is shifted into the left pane), and whether it's visible there
                mapA(x, y) {
                    const b = backend, c = b?.camera; if (!c || show.mode !== 'split') return { x, y, visible: this.mainVisible(x, y) };
                    const rc = b.htmlRefs.canvas.getBoundingClientRect(), s = rc.width / c.viewportWidth, W = c.viewportWidth, H = c.viewportHeight;
                    const nx = x - shiftOf(W) * ease(show.k) * s, vx = (nx - rc.left) / s, vy = (y - rc.top) / s, { xt, xb } = divider(W, H, ease(show.k));
                    return { x: nx, y, visible: vx < xt + (xb - xt) * (vy / H) };
                },
                // is a client point visible in the main view (not under the B pane / PiP inset)?
                mainVisible(x, y) {
                    const b = backend, c = b?.camera; if (!c || show.mode === 'off') return true;
                    const rc = b.htmlRefs.canvas.getBoundingClientRect(), s = c.viewportWidth / rc.width, vx = (x - rc.left) * s, vy = (y - rc.top) * s;
                    const W = c.viewportWidth, H = c.viewportHeight;
                    if (show.mode === 'split') { const { xt, xb } = divider(W, H, ease(show.k)); return vx < xt + (xb - xt) * (vy / H); }
                    const { dst } = pipRects(c, ease(show.k)); return !(vx >= dst.x && vx <= dst.x + dst.w && vy >= dst.y && vy <= dst.y + dst.h);
                },
                // where a world point lands on screen inside the B view (client px), or null; for pinning effects to B
                projectB(p) {
                    const b = backend, c = b?.camera; if (!c || !show.cam || show.mode === 'off') return null;
                    const L = c._lookPosition, save = { x: L.x, y: L.y, z: L.z, d: c._distance };
                    let q; try { L.x = show.cam.x; L.y = show.cam.y; c._distance = Math.exp(show.cam.z); c.invalidateViewport(); q = c.project(p); }
                    finally { L.x = save.x; L.y = save.y; L.z = save.z; c._distance = save.d; c.invalidateViewport(); }
                    if (!q || q.z <= 0) return null;
                    const rc = b.htmlRefs.canvas.getBoundingClientRect(), s = rc.width / c.viewportWidth;
                    if (show.mode === 'split') return { x: rc.left + (q.x + shiftOf(c.viewportWidth)) * s, y: rc.top + q.y * s };
                    const { dst, src } = pipRects(c, ease(show.k)), k = dst.w / (src.x1 - src.x0);
                    return { x: rc.left + (dst.x + (q.x - src.x0) * k) * s, y: rc.top + (dst.y + (q.y - src.y0) * k) * s, scale: k };
                },
                stats() {
                    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0, pct = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)] : 0;
                    return { aRenderMsAvg: +avg(stats.aMs).toFixed(2), aRenderMsP95: +pct(stats.aMs, 0.95).toFixed(2), bRenderMsAvg: +avg(stats.bMs).toFixed(2), bRenderMsP95: +pct(stats.bMs, 0.95).toFixed(2), frameMsAvg: +avg(stats.frameMs).toFixed(2), frameMsP95: +pct(stats.frameMs, 0.95).toFixed(2), fps: +(1000 / (avg(stats.frameMs) || 1)).toFixed(1), renders: stats.renders, mode: show.mode, k: show.k };
                },
                resetStats() { stats.aMs.length = 0; stats.bMs.length = 0; stats.frameMs.length = 0; stats.renders = 0; },
                options: O,
                destroy() { cancelAnimationFrame(raf); unhook(); },
            };
            return api;
        }

        // --- the director: when is a second camera worth it, and keeping it rare ---------------------------------------
        // Works in rounds (playback-speed independent) plus a wall-clock floor so fast playback doesn't flash it.
        function createDualDirector(o = {}) {
            const O = Object.assign({
                splitPri: 100,        // both sides at least this (fights are 100+) ...
                splitRatio: 0.7,      // ... and the weaker at least 70% of the stronger -> "equally important" -> split
                pipMainPri: 100,      // main at least this, second at least pipPri (tributes ~50-60, big trades 40+) -> PiP
                pipPri: 45,
                kinds: ['fight', 'trade', 'tribute', 'try'], // never 'win' (the ending has the screen to itself)
                startDist: 24,        // tiles (Chebyshev) between the two frame centres to start: they don't fit one view
                keepDist: 16,         // ... and to stay (hysteresis); closer -> merge back to one camera
                fitFactor: 1.5,       // ... and a single camera framing both would need to be this much wider than either
                minAhead: 16,         // the second shot must still have this many rounds to run
                minOverlap: 16,       // and overlap the main shot by at least this many rounds from now
                lead: 12,             // the second view can come up this many rounds before its event's approach ...
                tail: 15,             // ... and stays this long after it (and after the main one) ends: context both ways
                minHoldRounds: 20,    // once on, stay on at least this long (no flicker) ...
                minHoldMs: 5000,      // ... and at least this long in wall time
                maxHoldRounds: 45,    // never longer than this
                cooldownAny: 60,      // rounds after any dual view ends before the next one of any kind
                cooldownSplit: 120,   // rounds after a split ends before another split
                cooldownPip: 80,      // rounds after a PiP ends before another PiP
                window: 300,          // budget window (rounds)
                maxSplits: 2,         // at most this many splits ...
                maxPips: 2,           // ... and PiPs per window
                maxShare: 0.12,       // and dual views on screen for at most this share of the window's rounds
                maxSpeed: 40,         // rounds/s above which the director stays single-camera
            }, o);
            const st = { cur: null, since: 0, sinceAt: 0, endedAt: -1e9, endedSplitAt: -1e9, endedPipAt: -1e9, log: [], on: [], lastR: -1 };
            const cheb = (a, b) => Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy));
            function reset() { st.cur = null; st.endedAt = st.endedSplitAt = st.endedPipAt = -1e9; st.log = []; st.on = []; st.lastR = -1; }
            function used(kind, r) { return st.log.filter(x => x.kind === kind && x.r > r - O.window && x.r <= r).length; }
            function share(r) { while (st.on.length && st.on[0] <= r - O.window) st.on.shift(); return st.on.length; }
            function end(r) { if (st.cur) { st.endedAt = r; if (st.cur.mode === 'split') st.endedSplitAt = r; else st.endedPipAt = r; } st.cur = null; }
            function on(r, out) { if (st.on.at(-1) !== r) st.on.push(r); return out; }
            // r: current round; now: performance.now(); main: the shot the main camera is on (or null); shots: cine.shots;
            // frameOf(shot, r): its frame {cx,cy,w,h} at r (e.g. camTick's lerped frameAt); speed: rounds/s
            function update({ r, now, main, shots, frameOf, speed = 1, enabled = true }) {
                if (r < st.lastR - 2 || r > st.lastR + 60) { // seek: forget everything but the budget log
                    st.cur = null; st.endedAt = st.endedSplitAt = st.endedPipAt = -1e9; st.log = st.log.filter(x => x.r < r); st.on = st.on.filter(x => x < r);
                }
                st.lastR = r;
                if (!enabled || !main || main.kind === 'win' || speed > O.maxSpeed) { end(r); return { mode: 'off' }; }
                // keep the current one?
                if (st.cur) {
                    const c = st.cur, sec = c.shot, fa = frameOf(main, r), fb = frameOf(sec, r);
                    const held = r - c.since, heldMs = now - c.sinceAt;
                    const stillOn = shots.includes(sec) && r <= sec.e + O.tail && r <= main.e + O.tail && sec !== main && fa && fb;
                    const minHeld = held >= O.minHoldRounds && heldMs >= O.minHoldMs;
                    const tooClose = fa && fb && cheb(fa, fb) < O.keepDist;
                    const broke = share(r) >= O.maxShare * O.window && minHeld;
                    if (!stillOn || held > O.maxHoldRounds || broke || (minHeld && tooClose) || c.main !== main && minHeld) end(r);
                    else { c.main = main; return on(r, { mode: c.mode, shot: sec, frame: fb }); }
                }
                // pick a new one: only after the global cooldown, and with enough share budget left for a minimum hold
                if (r - st.endedAt < O.cooldownAny || O.maxShare * O.window - share(r) < O.minHoldRounds) return { mode: 'off' };
                const fa = frameOf(main, r); if (!fa) return { mode: 'off' };
                let best = null;
                for (const s of shots) {
                    if (s === main || !O.kinds.includes(s.kind) || r < (s.pre ?? s.s) - O.lead || r > s.e) continue; // from its approach on: context before it starts
                    if (s.e - r < O.minAhead || Math.min(s.e, main.e) - r < O.minOverlap) continue;
                    const fb = frameOf(s, r); if (!fb) continue;
                    const d = cheb(fa, fb); if (d < O.startDist) continue;
                    const bw = Math.max(fa.cx + fa.w / 2, fb.cx + fb.w / 2) - Math.min(fa.cx - fa.w / 2, fb.cx - fb.w / 2);
                    const bh = Math.max(fa.cy + fa.h / 2, fb.cy + fb.h / 2) - Math.min(fa.cy - fa.h / 2, fb.cy - fb.h / 2);
                    if (Math.max(bw / Math.max(fa.w, fb.w), bh / Math.max(fa.h, fb.h)) < O.fitFactor) continue;
                    const hi = Math.max(main.pri, s.pri), lo = Math.min(main.pri, s.pri);
                    let mode = null;
                    if (lo >= O.splitPri && lo >= O.splitRatio * hi) mode = 'split';
                    else if (main.pri >= O.pipMainPri && s.pri >= O.pipPri) mode = 'pip';
                    if (!mode) continue;
                    const pipOk = () => main.pri >= O.pipMainPri && s.pri >= O.pipPri && used('pip', r) < O.maxPips && r - st.endedPipAt >= O.cooldownPip;
                    if (mode === 'split' && (r - st.endedSplitAt < O.cooldownSplit || used('split', r) >= O.maxSplits)) mode = pipOk() ? 'pip' : null; // split spent: a PiP instead
                    else if (mode === 'pip' && !pipOk()) mode = null;
                    if (!mode) continue;
                    const score = (mode === 'split' ? 1000 : 0) + s.pri;
                    if (!best || score > best.score) best = { mode, shot: s, frame: fb, score };
                }
                if (!best) return { mode: 'off' };
                st.cur = { mode: best.mode, shot: best.shot, main, since: r, sinceAt: now };
                st.log.push({ kind: best.mode, r });
                return on(r, { mode: best.mode, shot: best.shot, frame: best.frame });
            }
            return { update, reset, options: O, get state() { return { cur: st.cur && { mode: st.cur.mode, kind: st.cur.shot.kind, s: st.cur.shot.s, since: st.cur.since }, log: [...st.log] }; } };
        }

        root.createDualCam = createDualCam;
        root.createDualDirector = createDualDirector;
    })(DUAL);
    // --- cinematic camera ---------------------------------------------------------------------------------------
    // The whole game is indexed before it's watched, so the camera knows what's coming. It plans "shots" (fights that
    // end in kills, trades with no kill, big tributes, the tribute that wins the game) and drifts in slowly ahead of
    // each one, framing everyone involved, including where they're about to walk and anyone close enough to join.
    // Between shots a passive director keeps it busy: teams closing in on each other, a team moving as a group,
    // champions farming, tabbing between them. Shots close together are joined by a cut instead of a zoom out and
    // back in. The camera itself is a slow critically damped spring chasing a continuously interpolated target, so
    // it eases and glides instead of stepping round to round. Touching the camera hands it back to you for a bit.
    // modes: off, on (slow, cinematic), fast (clip mode: short holds, quick moves, hard cuts between places)
    const dualcam = DUAL.createDualCam({ getBackend: findBackend }), dualDir = DUAL.createDualDirector();
    const cinemaMode = () => ['0', '1', '2'].includes(localStorage.getItem(LS + 'cinema')) ? localStorage.getItem(LS + 'cinema') : '0';
    const cinemaOn = () => cinemaMode() !== '0', cinemaFast = () => cinemaMode() === '2';
    const cine = { shots: [], builtVer: -1, builtAt: 0, shot: null, home: null, wrote: null, manualUntil: 0, last: 0,
        v: { x: 0, y: 0, z: 0 }, tf: null, whip: null, screen: [0, 0], raw: new Map(), round: -1, roundAt: 0, frames: new Map(), framesFor: null, passive: null, passiveCache: new Map() };
    function camRecord(g, before, snap) {
        if (!snap.champs?.length) return;
        const cam = g.cam ||= { track: new Map(), order: snap.champs.map(c => c.idx), team: snap.champs.map(c => c.team), hits: [], starts: [], tribs: [], lastKey: -1, ver: 0 };
        if (snap.key <= cam.lastKey) return; // indexing can revisit steps
        cam.lastKey = snap.key;
        const a = new Int16Array(snap.champs.length * 3), hp = new Float32Array(snap.champs.length);
        snap.champs.forEach((c, i) => { a[i * 3] = c.x; a[i * 3 + 1] = c.y; a[i * 3 + 2] = c.alive ? 1 : 0; hp[i] = c.hp; });
        cam.track.set(snap.round, a); // last write wins: the state at the end of the round
        // team economy, the way the viewer's analytics count it: gold earned = every positive change in a champion's
        // gold (draft excluded); net worth = unspent gold + what their items cost; kills summed per champion
        cam.goldPrev ||= new Map(); cam.earned ||= [0, 0]; cam.inv ||= new Map(); cam.buys ||= []; cam.invHist ||= new Map();
        cam.goldTeam ||= new Map(); cam.worthTeam ||= new Map(); cam.killsTeam ||= new Map();
        if (snap.phase !== 12) for (const c of snap.champs) { const pg = cam.goldPrev.get(c.idx) ?? c.gold; if (c.gold > pg) cam.earned[c.team] += c.gold - pg; cam.goldPrev.set(c.idx, c.gold); }
        if (snap.shopInv) {
            const { idx, items, cons } = snap.shopInv, prev = cam.inv.get(idx);
            const got = items.map((n, id) => n - (prev?.items[id] || 0) > 0 ? id : -1).filter(x => x >= 0);
            const gotC = cons.map((n, k) => n - (prev?.cons[k] || 0) > 0 ? k : -1).filter(x => x >= 0);
            if (snap.stepKind === 13 && (got.length || gotC.length)) cam.buys.push({ round: snap.round, idx, items: got, cons: gotC });
            cam.inv.set(idx, { items, cons });
            let h = cam.invHist.get(idx); if (!h) cam.invHist.set(idx, h = []); h.push({ round: snap.round, items, cons });
        }
        const worth = [0, 0], kills = [0, 0];
        for (const c of snap.champs) { const iv = cam.inv.get(c.idx); worth[c.team] += c.gold + (iv ? itemsValue(iv) : 0); kills[c.team] += c.kills; }
        cam.goldTeam.set(snap.round, [...cam.earned]); cam.worthTeam.set(snap.round, worth); cam.killsTeam.set(snap.round, kills);
        const held = [0, 0]; for (const c of snap.champs) if (c.alive) held[c.team] += c.gems;
        (cam.gemsTeam ||= new Map()).set(snap.round, [...snap.scores, ...held]); cam.gemsAt ||= rr => atRound(cam.gemsTeam, rr) || [0, 0, 0, 0];
        (cam.hp ||= new Map()).set(snap.round, hp);
        if (before?.champs?.length === snap.champs.length && snap.actor.kind === 1) {
            const by = snap.champs.find(c => c.idx === snap.actor.index);
            if (by) snap.champs.forEach((o, i) => { const p = before.champs[i]; if (p.alive && o.team !== by.team && o.hp < p.hp - 1e-3) cam.hits.push({ round: snap.round, a: by.idx, v: o.idx }); });
        }
        if (snap.outcome !== 0 && !cam.end) { // how the game ends: who won, and where (the tributing champion's tile)
            const by = snap.actor.kind === 1 ? snap.champs.find(c => c.idx === snap.actor.index) : null;
            cam.end = { round: snap.round, winner: snap.outcome === 1 || snap.outcome === 2 ? snap.outcome - 1 : null, x: by?.x ?? null, y: by?.y ?? null };
        }
        if (snap.stepKind === 12 && snap.actor.kind === 1) cam.starts.push({ round: snap.round, actor: snap.actor.index });
        if (snap.stepKind === 18 && before?.scores) {
            const t = snap.scores[0] > before.scores[0] ? 0 : snap.scores[1] > before.scores[1] ? 1 : -1;
            if (t >= 0) {
                const st = cam.starts.filter(x => x.actor === snap.actor.index && x.round <= snap.round).at(-1);
                cam.tribs.push({ start: st?.round ?? snap.round - 3, end: snap.round, actor: snap.actor.index, team: t, gems: snap.scores[t] - before.scores[t], win: snap.scores[t] >= 1000 || snap.outcome !== 0 });
            }
        }
        cam.ver++;
    }
    // item costs: shards 30, emblems 150 (Greed, ids 72-77: emblem 750), consumables 10
    const itemCost = id => id % 2 ? (id >= 72 && id <= 77 ? 750 : 150) : 30;
    const itemsValue = iv => iv.items.reduce((t, n, id) => t + n * itemCost(id), 0) + iv.cons.reduce((t, n) => t + n * 10, 0);
    function trackAt(cam, r) { for (let k = 0; k < 40; k++) { const a = cam.track.get(r - k); if (a) return a; } return null; }
    const CUT_GAP = 12;
    function planShots(g) {
        const cam = g.cam, shots = [];
        const P = (...xs) => new Set(xs.filter(x => x != null));
        // 1. fights that end in kills: kill events close together are one fight; pull in everyone trading hits with
        //    the people involved, and start the shot where their fighting started (up to ~25 rounds back)
        const evs = g.index.filter(ev => ev.kills.length);
        const fights = [];
        for (const ev of evs) { const f = fights.at(-1); if (f && ev.round - f.r2 <= 10) { f.r2 = ev.round; f.evs.push(ev); } else fights.push({ r1: ev.round, r2: ev.round, evs: [ev] }); }
        for (const f of fights) {
            const ppl = P(...f.evs.flatMap(ev => ev.kills.flatMap(k => [k.killer?.idx, k.victim.idx])));
            for (const ev of f.evs) for (const k of ev.kills) if (k.victim.duo) for (const r of g.roster || []) if (isDuo(r.type) && r.team === k.victim.team) ppl.add(r.idx);
            const lo = f.r1 - 25;
            let first = f.r1;
            for (let pass = 0; pass < 3; pass++) for (const h of cam.hits) if (h.round >= lo && h.round <= f.r2 && (ppl.has(h.a) || ppl.has(h.v))) { ppl.add(h.a); ppl.add(h.v); first = Math.min(first, h.round); }
            const n = f.evs.reduce((s, ev) => s + ev.kills.reduce((t, k) => t + (k.worth || 1), 0), 0), ace = f.evs.some(ev => ev.aces.length);
            const deaths = new Map(f.evs.flatMap(ev => ev.kills.map(k => [k.victim.idx, ev.round])));
            shots.push({ kind: 'fight', s: Math.min(first, f.r1 - 6) - 8, e: f.r2 + 14, ppl, deaths, pri: 100 + 25 * n + (ace ? 60 : 0) });
        }
        const covered = r => shots.some(s => s.kind === 'fight' && r >= s.s && r <= s.e);
        // 2. trades / exchanges with no kill: bursts of hits both ways, low priority
        let cur = null;
        const flush = () => { if (cur && cur.n >= 4) shots.push({ kind: 'trade', s: cur.r1 - 7, e: cur.r2 + 10, ppl: cur.ppl, deaths: new Map(), pri: (cur.teams.size === 2 ? 20 : 12) + Math.min(30, cur.n) }); cur = null; };
        for (const h of cam.hits) {
            if (covered(h.round)) continue;
            const ai = cam.order.indexOf(h.a);
            if (cur && h.round - cur.r2 <= 5 && h.round - cur.r1 <= 40 && (cur.ppl.has(h.a) || cur.ppl.has(h.v))) { cur.r2 = h.round; cur.n++; cur.ppl.add(h.a); cur.ppl.add(h.v); cur.teams.add(cam.team[ai]); }
            else { flush(); cur = { r1: h.round, r2: h.round, n: 1, ppl: P(h.a, h.v), teams: new Set([cam.team[ai]]) }; }
        }
        flush();
        // 3. tributes: big ones (100+ gems, i.e. 10+ rounds of channel) get a shot; the one that wins the game gets the
        //    biggest priority and stays on until the end
        for (const t of cam.tribs) {
            if (t.win) shots.push({ kind: 'win', s: t.start - 6, e: t.end + 40, ppl: P(t.actor), deaths: new Map(), pri: 1000 });
            else if (t.gems >= 100) shots.push({ kind: 'tribute', s: t.start - 10, e: t.end + 5, ppl: P(t.actor), deaths: new Map(), pri: 40 + t.gems / 10 });
        }
        // tributes that never finished (cancelled, stunned, locked out, killed): bots that start and cancel every turn
        // are one attempt, not dozens
        const tries = [];
        for (const st of cam.starts) {
            if (cam.tribs.some(t => t.actor === st.actor && st.round >= t.start && st.round <= t.end)) continue;
            const last = tries.findLast(x => x.actor === st.actor);
            if (last && st.round - last.r2 <= 15) last.r2 = st.round; else tries.push({ actor: st.actor, r1: st.round, r2: st.round });
        }
        for (const t of tries) shots.push({ kind: 'try', s: t.r1 - 8, e: t.r2 + 10, ppl: P(t.actor), deaths: new Map(), pri: 32 });
        // 4. pacing: a shot with nothing just before it gets a long, slow approach; one that follows closely on
        //    another holds the previous shot through the gap and then cuts straight to it
        const PRE_ROLL = cinemaFast() ? 8 : 18;
        shots.sort((a, b) => a.s - b.s);
        for (let i = 0; i < shots.length; i++) {
            const sh = shots[i], prev = shots.slice(0, i).filter(o => o.e >= sh.s - CUT_GAP - PRE_ROLL).sort((a, b) => b.e - a.e)[0];
            if (!prev) sh.pre = sh.s - PRE_ROLL;
            else if (prev.e < sh.s && sh.s - prev.e <= CUT_GAP) { prev.e = sh.s - 1; sh.cutIn = true; }
            else if (prev.e < sh.s) sh.pre = Math.max(prev.e + 1, sh.s - PRE_ROLL);
        }
        // recalls and teleports, for their on-map indicators (and a couple of teleports as shots)
        cam.recalls = []; cam.tps = [];
        const steps = g.steps, posOf = (idx, r) => { const a = trackAt(cam, r), i = cam.order.indexOf(idx); return a && i >= 0 ? [a[i * 3], a[i * 3 + 1]] : null; };
        for (let i = 0; i < steps.length; i++) {
            const st = steps[i];
            if (st.kind === 11) {
                let end = st.round + RECALL_ROUNDS;
                for (let j = i + 1; j < steps.length && steps[j].round < st.round + RECALL_ROUNDS; j++) {
                    const o = steps[j];
                    if (o.actor === st.actor && [16, 4, 5, 6, 11].includes(o.kind)) { end = o.round; break; }
                }
                // dying ends it too
                for (let rr = st.round + 1; rr < end; rr++) { const a = trackAt(cam, rr), ii = cam.order.indexOf(st.actor); if (a && ii >= 0 && a[ii * 3 + 2] !== 1) { end = rr; break; } }
                const at = posOf(st.actor, st.round);
                if (end - st.round >= 2 && at) cam.recalls.push({ actor: st.actor, r1: st.round, r2: end, x: at[0], y: at[1], done: end === st.round + RECALL_ROUNDS }); // channelled more than one turn
            } else if (st.kind === 21) {
                const done = steps.slice(i + 1, i + 400).find(o => o.actor === st.actor && o.kind === 22 && o.round <= st.round + 8);
                const from = posOf(st.actor, st.round), to = done && posOf(st.actor, done.round);
                if (from && to) cam.tps.push({ actor: st.actor, r1: st.round, r2: done.round, from, to, team: cam.team[cam.order.indexOf(st.actor)] });
            }
        }
        // the best teleports get a shot: far (turns saved) and straight into a fight; most games get none, two at most
        const tpScore = t => { const d = Math.hypot(t.to[0] - t.from[0], t.to[1] - t.from[1]);
            const fight = cam.hits.filter(h => (h.a === t.actor || h.v === t.actor) && h.round >= t.r2 && h.round <= t.r2 + 15).length;
            return d * 0.8 + Math.min(30, fight * 3); };
        for (const t of cam.tps.map(t => ({ t, sc: tpScore(t) })).filter(x => x.sc >= 40).sort((a, b) => b.sc - a.sc).slice(0, 2).map(x => x.t)) {
            shots.push({ kind: 'tp', s: t.r1 - 3, e: t.r2 - 1, ppl: P(t.actor), deaths: new Map(), pri: 45, minW: 11, noLook: true });
            shots.push({ kind: 'tp', s: t.r2, e: t.r2 + 6, ppl: P(t.actor), deaths: new Map(), pri: 45, minW: 13, cutIn: true });
        }
        shots.sort((a, b) => a.s - b.s);
        // champion activity (attacking camps / casting at them) for the passive director
        cam.act = new Map();
        for (const st of g.steps) if ((st.kind === 5 || st.kind === 6) && !st.vc && st.actor != null) { let a = cam.act.get(st.actor); if (!a) cam.act.set(st.actor, a = []); if (a.at(-1) !== st.round) a.push(st.round); }
        return shots;
    }
    const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
    // The box to show at round r: everyone in it over the next few rounds (where they're going, not just where they
    // are), anyone from either team close enough to join, padded, never too tight. `busyOnly` narrows a fight to
    // whoever is hitting or about to die right now.
    function frameShot(cam, shot, r, busyOnly = true) {
        const pts = [], near = new Set();
        if (busyOnly) {
            const busy = new Set();
            for (const h of cam.hits) if (h.round >= r - 6 && h.round <= r + 8 && shot.ppl.has(h.a)) { busy.add(h.a); busy.add(h.v); }
            for (const [idx, d] of shot.deaths) if (d >= r - 3 && d <= r + 10) busy.add(idx);
            if (busy.size) shot = { ...shot, ppl: busy };
        }
        const live = (a, i) => a[i * 3 + 2] === 1;
        for (let rr = r - 1; rr <= r + (shot.noLook ? 0 : 6); rr++) {
            const a = trackAt(cam, rr); if (!a) continue;
            cam.order.forEach((idx, i) => { if (shot.ppl.has(idx) && live(a, i)) pts.push([a[i * 3], a[i * 3 + 1]]); });
            if (rr <= r + 3) cam.order.forEach((idx, i) => { // bystanders joining in: within 6 tiles of someone in the shot
                if (shot.ppl.has(idx) || !live(a, i)) return;
                if (cam.order.some((o, j) => shot.ppl.has(o) && live(a, j) && cheb(a[j * 3], a[j * 3 + 1], a[i * 3], a[i * 3 + 1]) <= 6)) near.add(i);
            });
        }
        for (let rr = r; rr <= r + 3; rr++) { const a = trackAt(cam, rr); if (a) for (const i of near) if (live(a, i)) pts.push([a[i * 3], a[i * 3 + 1]]); }
        if (!pts.length) return null;
        // split action (someone peeling off, or two scraps at once): keep the biggest group, joined at 9 tiles (6 if
        // that still spans most of the map)
        const span = () => { let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; for (const [x, y] of pts) { a0 = Math.min(a0, x); a1 = Math.max(a1, x); b0 = Math.min(b0, y); b1 = Math.max(b1, y); } return Math.max(a1 - a0, b1 - b0); };
        for (const link of [9, 6]) if (pts.length > 2 && (link === 9 || span() > 26)) {
            const grp = pts.map((_, i) => i), find = i => grp[i] === i ? i : (grp[i] = find(grp[i]));
            for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (cheb(pts[i][0], pts[i][1], pts[j][0], pts[j][1]) <= link) grp[find(i)] = find(j);
            const n = new Map(); pts.forEach((_, i) => n.set(find(i), (n.get(find(i)) || 0) + 1));
            const big = [...n].sort((a, b) => b[1] - a[1])[0][0];
            pts.splice(0, pts.length, ...pts.filter((_, i) => find(i) === big));
        }
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        // never wider than ~30 x 20 tiles: past that, centre on where most of them are (not the empty middle)
        if (x1 - x0 > 30 || y1 - y0 > 20) {
            const mx = pts.reduce((t, p) => t + p[0], 0) / pts.length, my = pts.reduce((t, p) => t + p[1], 0) / pts.length;
            if (x1 - x0 > 30) { x0 = mx - 15; x1 = mx + 15; }
            if (y1 - y0 > 20) { y0 = my - 10; y1 = my + 10; }
        }
        return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(shot.minW || 16, x1 - x0 + 7), h: Math.max((shot.minW || 16) * 0.6, y1 - y0 + 7) };
    }
    // --- passive director: what's worth watching when nothing big is happening
    function passiveCandidates(cam, r) {
        const a = trackAt(cam, r), b = trackAt(cam, r + 6), p0 = trackAt(cam, r - 6); if (!a) return [];
        const n = cam.order.length, live = (t, i) => t && t[i * 3 + 2] === 1, out = [];
        const xy = (t, i) => [t[i * 3], t[i * 3 + 1]];
        // teams closing in on each other: the nearest enemy pair within 12 tiles that's getting closer
        let best = null;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            if (cam.team[i] === cam.team[j] || !live(a, i) || !live(a, j)) continue;
            const d = cheb(...xy(a, i), ...xy(a, j)), d2 = live(b, i) && live(b, j) ? cheb(...xy(b, i), ...xy(b, j)) : d;
            if (d <= 12 && d2 <= d && (!best || d < best.d)) best = { d, i, j };
        }
        if (best) {
            const ppl = new Set();
            for (let k = 0; k < n; k++) if (live(a, k) && (cheb(...xy(a, k), ...xy(a, best.i)) <= 5 || cheb(...xy(a, k), ...xy(a, best.j)) <= 5)) ppl.add(cam.order[k]);
            out.push({ kind: 'approach', key: 'ap', ppl, score: 50 + (12 - best.d) * 3, minW: 18 });
        }
        // any champion-on-champion damage around now beats everything else in passive mode
        const clash = new Set(); let hitsNear = 0;
        for (const h of cam.hits) if (h.round >= r - 3 && h.round <= r + 6) { clash.add(h.a); clash.add(h.v); hitsNear++; }
        if (hitsNear) out.push({ kind: 'clash', key: 'c' + [...clash].sort().join(','), ppl: clash, score: 90 + hitsNear * 2, minW: 16 });
        // a team moving as a group: 3+ within 5 tiles of each other whose middle has moved
        for (const t of [0, 1]) {
            const idx = []; for (let i = 0; i < n; i++) if (cam.team[i] === t && live(a, i)) idx.push(i);
            let grp = [];
            for (const i of idx) { const g = idx.filter(j => cheb(...xy(a, i), ...xy(a, j)) <= 5); if (g.length > grp.length) grp = g; }
            if (grp.length < 3) continue;
            const mid = t2 => t2 && grp.every(i => live(t2, i)) ? grp.reduce((s, i) => [s[0] + t2[i * 3] / grp.length, s[1] + t2[i * 3 + 1] / grp.length], [0, 0]) : null;
            const m0 = mid(p0), m1 = mid(b), moving = m0 && m1 && cheb(...m0, ...m1) >= 3;
            out.push({ kind: 'group', team: t, key: 'g' + t + grp.map(i => cam.order[i]).join(','), ppl: new Set(grp.map(i => cam.order[i])), score: (moving ? 30 : 18) + 3 * grp.length, minW: 18 });
        }
        // one champion farming / on the move
        for (let i = 0; i < n; i++) {
            if (!live(a, i)) continue;
            const acts = (cam.act?.get(cam.order[i]) || []).filter(x => x >= r - 4 && x <= r + 10).length;
            const moved = p0 && live(p0, i) ? cheb(...xy(p0, i), ...xy(a, i)) : 0;
            out.push({ kind: 'solo', key: 's' + cam.order[i], team: cam.team[i], ppl: new Set([cam.order[i]]), score: 8 + acts * 3 + Math.min(6, moved), minW: 17 });
        }
        return out;
    }
    function passiveAt(cam, r) {
        // re-decided every few rounds; a subject is kept a while (~30 rounds, ~10 in fast mode) unless something clearly
        // better shows up. Solo subjects rotate, and the camera leans toward the team it hasn't watched lately, so it
        // doesn't spectate one side all game
        const P = cine.passive, fast = cinemaFast(), hold = fast ? 12 : 45, every = fast ? 2 : 5;
        if (P && r >= P.from && r < P.from + every && P.lastR <= r) return P;
        const cands = passiveCandidates(cam, r);
        // screen time so far per team (seconds the camera spent on each side's subjects): the side that's behind gets a
        // boost that grows with the gap, so both teams end up with about the same
        const st = cine.screen;
        const balance = c => c.team == null ? 0 : Math.max(-20, Math.min(30, (st[1 - c.team] - st[c.team]) * (fast ? 2.5 : 1.2)));
        const scoreOf = c => c.score + balance(c)
            - (c.kind === 'solo' && cine.recentSolo?.includes(c.key) ? 14 : 0);
        // "the same subject" = same kind with mostly the same people (a group gaining or losing one member, an
        // approach shifting who's closest, is still the same thing to watch)
        const same = c => P && c.kind === P.kind && [...c.ppl].filter(x => P.ppl?.has(x)).length >= Math.max(1, Math.min(c.ppl.size, P.ppl?.size || 0) * 0.5);
        const cur = P && (cands.find(c => c.key === P.key) || cands.filter(same).sort((a, b) => b.score - a.score)[0]);
        // stay near what's on screen: far subjects need to be clearly better to pull the camera across the map
        const here = P ? frameShot(cam, P, r, false) : null;
        const away = c => { if (!here) return 0; const f = frameShot(cam, c, r, false); return f ? Math.min(30, cheb(f.cx, f.cy, here.cx, here.cy) * 0.7) : 0; };
        const best = cands.reduce((b, c) => !b || scoreOf(c) - away(c) > scoreOf(b) - away(b) ? c : b, null);
        let pick = cur && r - P.since < hold && (!best || scoreOf(best) - away(best) < cur.score + 30) ? cur : best;
        if (cur && pick === cur) pick = { ...cur, since: P.since };
        else if (pick) { pick = { ...pick, since: r }; if (pick.kind === 'solo') cine.recentSolo = [pick.key, ...(cine.recentSolo || [])].slice(0, fast ? 5 : 3); }
        if (pick) { pick.from = r; pick.lastR = r; pick.deaths = new Map(); }
        cine.passive = pick;
        return pick;
    }
    const shotIds = new WeakMap(); let shotSeq = 0;
    const shotId = s => { let id = shotIds.get(s); if (id == null) shotIds.set(s, id = 's' + (++shotSeq)); return id; };
    // --- the target at a fractional round, blended between whole rounds so it never steps
    function frameAt(cam, shot, r) {
        const key = (shot ? shotId(shot) : 'p' + (cine.passive?.key || '')) + '@' + r;
        if (cine.frames.has(key)) return cine.frames.get(key);
        let f = null;
        const smoothShot = rr => { const fs = [-2, -1, 0, 1, 2].map(k => rawFrame(cam, shot, rr + k)).filter(Boolean); if (!fs.length) return null;
            const av = k => fs.reduce((t, x) => t + x[k], 0) / fs.length; return { cx: av('cx'), cy: av('cy'), w: av('w'), h: av('h') }; };
        if (shot) {
            f = smoothShot(r);
            if (shot.pre != null && r < shot.s) { // slow approach: from the passive view toward the shot
                const k = (r - shot.pre) / (shot.s - shot.pre), e = k * k * (3 - 2 * k), pv = passiveFrame(cam, r);
                if (f && pv) f = lerpFrame(pv, f, e);
                else if (f) f = { ...f, w: f.w + (1 - e) * 30, h: f.h + (1 - e) * 18 };
            }
        } else f = passiveFrame(cam, r);
        if (cine.frames.size > 400) cine.frames.clear();
        cine.frames.set(key, f);
        return f;
    }
    function rawFrame(cam, shot, r) { const k = shotId(shot) + '#' + r; if (!cine.raw.has(k)) { if (cine.raw.size > 3000) cine.raw.clear(); cine.raw.set(k, frameShot(cam, shot, r)); } return cine.raw.get(k); }
    function passiveFrame(cam, r) { const p = passiveAt(cam, r); return p ? frameShot(cam, p, r, false) : null; }
    const lerpFrame = (a, b, k) => ({ cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k });
    function activeShot(r) {
        const act = cine.shots.filter(s => (s.pre ?? s.s) <= r && r <= s.e);
        let shot = act.reduce((b, s) => !b || s.pri > b.pri || (s.pri === b.pri && s.s > b.s && r >= s.s) ? s : b, null);
        if (cine.shot && act.includes(cine.shot) && shot && shot.pri < cine.shot.pri + 40 && !(shot.cutIn && r >= shot.s)) shot = cine.shot;
        return shot;
    }
    // --- two-camera plan: decided for the whole game up front, so the cameras never fight -------------------------
    // A segment says: from s to e the main camera is on A and the second camera on B (split for two big fights, a
    // picture-in-picture otherwise). B comes up a while before its event and stays a while after; if A's event ends
    // first, camera 2 takes over (promoteAt) instead of a cut. Segments are rare: picked best-first with a gap between
    // them and a budget per stretch of game.
    const DUAL_PLAN = { lead: 12, tail: 15, minLen: 24, far: 18, gap: 45, perWindow: 3, window: 450, maxShare: 0.18 };
    function planDual(g, shots) {
        const cam = g.cam, D = DUAL_PLAN, last = g.index.at(-1)?.round ?? 2000;
        const ev = shots.filter(s => ['fight', 'trade', 'tribute', 'try', 'tp'].includes(s.kind));
        const covered = r => ev.some(s => r >= (s.pre ?? s.s) && r <= s.e);
        // smaller things worth a second camera that the main camera doesn't plan shots for:
        // 1. light exchanges (a few hits, no kill, too small to be a trade shot)
        let cur = null;
        const flushPoke = () => { if (cur && !covered(cur.r1)) ev.push({ kind: 'poke', s: cur.r1 - 6, e: cur.r2 + 10, ppl: cur.ppl, deaths: new Map(), pri: 18 }); cur = null; };
        for (const h of cam.hits) {
            if (cur && h.round - cur.r2 <= 6 && (cur.ppl.has(h.a) || cur.ppl.has(h.v))) { cur.r2 = h.round; cur.ppl.add(h.a); cur.ppl.add(h.v); }
            else { flushPoke(); cur = { r1: h.round, r2: h.round, ppl: new Set([h.a, h.v]) }; }
        }
        flushPoke();
        // 2. someone getting away at low health (hurt recently, the gap to the nearest enemy growing), caught or not
        const maxHp = new Map();
        for (const [, hp] of cam.hp || []) hp.forEach((v, i) => maxHp.set(i, Math.max(maxHp.get(i) || 0, v)));
        const lastEscape = new Map();
        for (let r = 10; r < last; r += 2) {
            const a = trackAt(cam, r), b = trackAt(cam, r + 8), hp = cam.hp?.get(r); if (!a || !b || !hp) continue;
            cam.order.forEach((idx, i) => {
                if (a[i * 3 + 2] !== 1 || !maxHp.get(i) || hp[i] > 0.3 * maxHp.get(i) || r - (lastEscape.get(i) ?? -99) < 30) return;
                if (!cam.hits.some(h => h.v === idx && h.round >= r - 6 && h.round <= r)) return;
                let near = -1, d0 = 99;
                cam.order.forEach((o, j) => { if (cam.team[j] !== cam.team[i] && a[j * 3 + 2] === 1) { const d = cheb(a[i * 3], a[i * 3 + 1], a[j * 3], a[j * 3 + 1]); if (d < d0) { d0 = d; near = j; } } });
                if (near < 0 || d0 > 8) return;
                const d1 = cheb(b[i * 3], b[i * 3 + 1], b[near * 3], b[near * 3 + 1]);
                if (d1 < d0 + 3) return; // not getting away
                lastEscape.set(i, r);
                ev.push({ kind: 'escape', s: r - 4, e: r + 16, ppl: new Set([idx, cam.order[near]]), deaths: new Map(), pri: 30 });
            });
        }
        // 3. farming is only worth a second camera when it's big: a team grinding one big camp together (golem,
        //    monolith, a packed camp: nearly every member hitting camps nearly every round for the whole stretch), or
        //    one champion working a camp for a long time. Ordinary farming and walking around never get one.
        if (!cam.act) { cam.act = new Map(); for (const st of g.steps) if ((st.kind === 5 || st.kind === 6) && !st.vc && st.actor != null) { let a = cam.act.get(st.actor); if (!a) cam.act.set(st.actor, a = []); if (a.at(-1) !== st.round) a.push(st.round); } }
        const farmRounds = (idx, r0, r1) => (cam.act.get(idx) || []).filter(x => x >= r0 && x <= r1).length;
        for (let r = 20; r < last - 30; r += 15) for (const c of passiveCandidates(cam, r)) {
            if (c.kind !== 'group' || c.team == null) continue;
            const avg = [...c.ppl].reduce((t, idx) => t + farmRounds(idx, r, r + 30), 0) / c.ppl.size;
            if (avg >= 20) ev.push({ kind: 'group', s: r, e: r + 30, ppl: c.ppl, deaths: new Map(), pri: 26, minW: 18 }); // big enough to split for
        }
        for (const [idx, rounds] of cam.act) for (let i = 0; i < rounds.length; i++) {
            const j = rounds.findIndex(x => x > rounds[i] + 40); const n = (j < 0 ? rounds.length : j) - i;
            if (n >= 32) { ev.push({ kind: 'farm', s: rounds[i], e: rounds[i] + 40, ppl: new Set([idx]), deaths: new Map(), pri: 16, minW: 14 }); i += n; }
        }
        const win = s => [s.pre ?? s.s, s.e];
        const cen = new Map(); // shot -> round -> centre, sampled every 3 rounds
        const centre = (s, r) => { let m = cen.get(s); if (!m) cen.set(s, m = new Map()); const k = r - (r % 3); if (!m.has(k)) { const f = frameShot(cam, s, k); m.set(k, f && [f.cx, f.cy]); } return m.get(k); };
        const cands = [];
        for (const A of ev) for (const B of ev) {
            if (A === B || B.pri > A.pri || (B.pri === A.pri && B.s < A.s)) continue; // A is the main (more important) one
            const [a0, a1] = win(A), [b0, b1] = win(B);
            const o0 = Math.max(a0, b0), o1 = Math.min(a1, b1); if (o1 - o0 < 12) continue;
            let far = 0, n = 0;
            for (let r = o0; r <= o1; r += 3) { const ca = centre(A, r), cb = centre(B, r); if (!ca || !cb) continue; n++; if (Math.max(Math.abs(ca[0] - cb[0]), Math.abs(ca[1] - cb[1])) >= D.far) far++; }
            if (!n || far / n < 0.6) continue; // they have to be in different places most of the time
            // two big fights, or two similar mid-size things (escape vs exchange, group vs group): side by side;
            // something big plus something small: picture-in-picture
            // split only when both halves are worth watching: two big fights, or two solid mid-size things (trades,
            // escapes, tributes, big camps); small stuff (light pokes, a solo farmer) only ever gets the corner inset
            const mode = (A.pri >= 100 && B.pri >= 100) || (B.pri >= 25 && B.pri >= 0.55 * A.pri && A.pri < 100) ? 'split' : A.pri >= 25 && B.pri >= 12 ? 'pip' : null; if (!mode) continue;
            const s0 = Math.max(a0, b0 - D.lead);
            let promote = b1 > a1 + 12 && B.kind !== 'group'; // only worth a handoff if camera 2's event really goes on
            let e0 = promote ? a1 : Math.min(a1, b1 + D.tail);
            // camera 2 must never show what the main camera already shows: their boxes (the main one as wide as the
            // camera really sees around it) stay apart the whole time; if they come together, camera 2 closes first
            const clear = r => { const fa = frameShot(cam, A, r), fb2 = frameShot(cam, B, r); if (!fa || !fb2) return true;
                const vw = Math.max(fa.w, 16) * 1.3, vh = Math.max(fa.h, 10) * 1.5;
                return Math.abs(fa.cx - fb2.cx) > vw / 2 + fb2.w / 2 + 2 || Math.abs(fa.cy - fb2.cy) > vh / 2 + fb2.h / 2 + 2; };
            let bad = -1; for (let r = s0; r <= e0; r += 2) if (!clear(r)) { bad = r; break; }
            if (bad >= 0) { e0 = bad - 4; promote = false; }
            if (e0 - s0 < D.minLen || s0 < 45) continue; // never in the opening seconds
            const jitter = (((s0 * 2654435761) >>> 0) % 40); // variety, but the same plan every viewing
            cands.push({ A, B, s: s0, e: e0, promoteAt: promote ? a1 - 2 : null, mode, score: (mode === 'split' ? 120 : 0) + A.pri + B.pri + jitter });
        }
        // best first; no overlap, a gap between them, a budget per window and overall
        cands.sort((x, y) => y.score - x.score);
        const out = [];
        for (const c of cands) {
            if (out.some(o => c.s < o.e + D.gap && o.s < c.e + D.gap)) continue;
            if (out.filter(o => Math.abs(o.s - c.s) < D.window).length >= D.perWindow) continue;
            if (out.reduce((t, o) => t + o.e - o.s, 0) + (c.e - c.s) > D.maxShare * last) continue;
            out.push(c);
        }
        // continuity at both ends: camera 1 keeps whatever it was already showing (the new event joins as camera 2),
        // and if the single camera would go straight to camera 2's scene once the stretch ends, camera 2 takes over
        // instead (camera 1 is the one that leaves)
        const bestAt = r => { let b = null; for (const sh of shots) if ((sh.pre ?? sh.s) <= r && r <= sh.e && (!b || sh.pri > b.pri)) b = sh; return b; };
        const near = (x, y, r) => { if (x === y) return true; const f1 = frameShot(cam, x, r), f2 = frameShot(cam, y, r); return !!(f1 && f2 && cheb(f1.cx, f1.cy, f2.cx, f2.cy) < 12); };
        for (const sg of out) {
            const before = bestAt(sg.s - 1);
            if (before && !near(before, sg.A, sg.s) && near(before, sg.B, sg.s)) {
                [sg.A, sg.B] = [sg.B, sg.A];
                if (sg.promoteAt != null) sg.promoteAt = null; // roles changed: re-decide below
            }
            const after = bestAt(sg.e + 1);
            if (sg.promoteAt == null && after && !near(after, sg.A, sg.e) && near(after, sg.B, sg.e)) sg.promoteAt = Math.max(sg.s + 12, sg.e - 3);
        }
        return out.sort((x, y) => x.s - y.s);
    }
    // Quiet spells: when both teams are grouped up (farming, moving) on opposite sides of the map, now and then show
    // both side by side. Uncommon on purpose: one at most every ~350 rounds, 25-40 rounds long.
    const pdual = { until: -1, next: 0, frameKey: null };
    function passiveDual(r, now, mainF) {
        const cam = game.cam;
        if (r < pdual.until && pdual.frameKey) { const g = passiveCandidates(cam, r).find(c => c.key === pdual.frameKey); const fb = g && frameShot(cam, g, r, false); if (fb) return { mode: 'split', frame: fb }; }
        if (r < pdual.next || !mainF || !cine.passive || cine.passive.kind !== 'group') return null;
        const other = passiveCandidates(cam, r).find(c => c.kind === 'group' && c.team != null && c.team !== cine.passive.team);
        const fb = other && frameShot(cam, other, r, false);
        if (!fb || Math.max(Math.abs(fb.cx - mainF.cx), Math.abs(fb.cy - mainF.cy)) < 24) return null;
        if (Math.random() < 0.6) { pdual.next = r + 60; return null; } // variety: not every time it could
        pdual.until = r + 25 + Math.floor(Math.random() * 15); pdual.next = pdual.until + 350; pdual.frameKey = other.key;
        return { mode: 'split', frame: fb };
    }
    function camTick(now) {
        requestAnimationFrame(camTick);
        const dt = Math.min(0.05, (now - (cine.last || now)) / 1000); cine.last = now;
        tickDeathFx();
        tickOverlays(now);
        tickEnding(now);
        if (!cinemaOn() || !game?.cam || !game.play || phase === 'draft' || draft.on) { cine.wrote = null; dualcam.off(); return; }
        const b = findBackend(), c = b?.camera; if (!c?.lookPosition) return;
        const lp = c.lookPosition, here = { x: lp.x, y: lp.y, d: c._distance };
        // the user moved the camera since our last frame: hand it over for a bit (and remember it as home if idle)
        if (cine.wrote && (Math.abs(here.x - cine.wrote.x) > 0.05 || Math.abs(here.y - cine.wrote.y) > 0.05 || Math.abs(here.d - cine.wrote.d) > 0.05)) {
            cine.manualUntil = now + 5000; cine.home = here; cine.v = { x: 0, y: 0, z: 0 }; cine.tf = null;
        }
        cine.home ||= here;
        if (now < cine.manualUntil) { cine.wrote = null; dualcam.off(); return; }
        if (game.cam.ver !== cine.builtVer && now - cine.builtAt > 1500) { cine.shots = planShots(game); cine.dual = planDual(game, cine.shots); cine.builtVer = game.cam.ver; cine.builtAt = now; cine.frames.clear(); cine.raw.clear(); }
        // fractional round: the playhead only moves in whole rounds, so run a clock between them
        const r = game.play.round, playing = isPlaying();
        if (r !== cine.round) { cine.round = r; cine.roundAt = now; }
        const frac = playing ? Math.min(1, (now - cine.roundAt) / 1000 * Math.max(0.5, roundsPerSec)) : 0;
        const prevShot = cine.shot, prevPassive = cine.passive?.key, fast = cinemaFast();
        // the first seconds of a game: a slow establishing move down from the map overview (no cuts or quick pans)
        if (r <= 3 && !cine.openArmed) { cine.openArmed = true; cine.openStart = now; }
        if (r > 60) cine.openArmed = false;
        const opening = cine.openArmed ? Math.min(1, (now - cine.openStart) / 9000) : 1; // 0 -> 1 over ~9 s
        // two-camera segments are planned; outside them it's one camera
        const seg = !fast && roundsPerSec < 16 ? (cine.dual || []).find(d => r >= d.s && r < d.e) : null;
        const promoted = !!seg && seg.promoteAt != null && r >= seg.promoteAt;
        let shot, second = null;
        if (seg) { shot = promoted ? seg.B : seg.A; second = promoted ? null : seg.B; }
        else {
            shot = activeShot(r);
            // one camera: it never leaves a fight before its kill lands
            const killPending = s => s?.kind === 'fight' && r <= s.e && [...s.deaths.values()].some(d => d >= r - 3);
            if (prevShot && shot && shot !== prevShot && killPending(prevShot) && (cine.shots || []).includes(prevShot)) shot = prevShot;
        }
        // camera 2's event becomes the main one: camera 1 slides away and camera 2 simply is the main camera now
        if (seg && promoted && cine.seg === seg && !cine.segPromoted && dualcam.mode !== 'off' && !dualcam.promoting) {
            cine.segPromoted = true;
            dualcam.promote(cam => { if (!cam) return; lp.x = cam.x; lp.y = cam.y; c._distance = Math.exp(cam.z); c.invalidateViewport();
                cine.v = { x: 0, y: 0, z: 0 }; cine.tf = { x: cam.x, y: cam.y, z: cam.z }; cine.wrote = { x: lp.x, y: lp.y, d: c._distance }; cine.whip = null; });
        }
        if (cine.seg !== seg) {
            const ov = (S, P) => S && P ? [...S.ppl].filter(x => P.ppl?.has(x)).length : 0;
            // into a stretch from the passive director: camera 1 keeps the group it was on, the other one joins
            if (seg && !prevShot && cine.passive && ov(seg.B, cine.passive) > ov(seg.A, cine.passive)) { [seg.A, seg.B] = [seg.B, seg.A]; seg.promoteAt = null; shot = seg.A; second = seg.B; }
            // out of one into the passive director: it carries on with whichever camera stays on screen
            const old = cine.seg;
            if (old && !seg && !activeShot(r)) {
                const keep = cine.segPromoted ? old.B : old.A, cands = passiveCandidates(game.cam, r);
                const best = cands.reduce((b, cc) => ov(keep, cc) > ov(keep, b) ? cc : b, null);
                if (best && ov(keep, best)) cine.passive = { ...best, since: r, from: r, lastR: r, deaths: new Map() };
            }
            if (seg) seg.closed = false;
            cine.seg = seg; cine.segPromoted = promoted;
        }
        if (dualcam.promoting) { cine.shot = shot; cine.wrote = { x: lp.x, y: lp.y, d: c._distance }; return; } // hold still while it slides
        cine.shot = shot;
        const f0 = frameAt(game.cam, shot, r), f1 = frameAt(game.cam, shot, r + 1);
        // nobody left to frame (everyone in it died or left): hold where we were rather than flying back to the map overview
        const f = (f0 && f1 ? lerpFrame(f0, f1, frac) : f0 || f1) || (shot ? cine.lastF : null);
        if (f) { cine.lastF = f; cine.targetView = { x0: f.cx - f.w * 0.65, x1: f.cx + f.w * 0.65, y0: f.cy - f.h * 0.8, y1: f.cy + f.h * 0.6, at: performance.now() }; }
        const fr2 = (s2, rr) => { const a = frameAt(game.cam, s2, rr), z = frameAt(game.cam, s2, rr + 1); return a && z ? lerpFrame(a, z, frac) : a || z; };
        const fb = second && fr2(second, r);
        if (seg && second && fb && !seg.closed) { const v = visibleTiles(); if (v) { const w = v.x1 - v.x0, h = v.y1 - v.y0;
            if (fb.cx > v.x0 + w * 0.12 && fb.cx < v.x1 - w * 0.12 && fb.cy > v.y0 + h * 0.2 && fb.cy < v.y1 - h * 0.08 && dualcam.mode !== 'off' && dualcam.progress >= 1) seg.closed = true; } }
        if (second && fb && !seg.closed) dualcam.set(seg.mode, fb); else if (!dualcam.promoting) dualcam.off();
        cine.bFrame = second && fb ? fb : null;
        // screen geometry at the current distance (all of it scales with distance): the camera is pitched, so the
        // look point isn't mid-screen; the viewer's team bars cover the top, so frame into the clear part below
        const rc = b.htmlRefs.canvas.getBoundingClientRect(), pane = dualcam.mainPane(rc); // the left pane while split
        const top = pane.top, bot = pane.bottom, mx = (pane.left + pane.right) / 2, my = (top + bot) / 2;
        let W, Lp, Rp, Tp, Bp;
        try { W = b.screenToWorld(mx, my); Lp = b.screenToWorld(pane.left + 20, my); Rp = b.screenToWorld(pane.right - 20, my); Tp = b.screenToWorld(mx, top); Bp = b.screenToWorld(mx, bot); } catch { return; }
        if (!W || !Lp || !Rp || !Tp || !Bp) return;
        const kw = Math.abs(Rp.x - Lp.x) / here.d, kh = Math.abs(Bp.y - Tp.y) / here.d, ox = (here.x - W.x) / here.d, oy = (here.y - W.y) / here.d;
        let tgt;
        const split = dualcam.mode === 'split';
        if (f) { const fw = f.w * (split ? dualcam.options.splitTight : 1), td = Math.max(12, Math.min(split ? dualcam.maxDist() : 110, Math.max(fw / kw, f.h / kh))); tgt = { x: f.cx + ox * td, y: f.cy + oy * td, z: Math.log(td) }; }
        else tgt = { x: cine.home.x, y: cine.home.y, z: Math.log(cine.home.d) };
        // a cut: the next shot follows right on from the last, and is somewhere else -> jump, don't fly
        // screen time: a subject that belongs to one team counts for that team
        const subjTeam = shot ? (shot.kind === 'tribute' || shot.kind === 'try' || shot.kind === 'win' ? game.cam.team[game.cam.order.indexOf([...shot.ppl][0])] : null) : cine.passive?.team;
        if (playing && subjTeam != null) cine.screen[subjTeam] += dt;
        // switching somewhere far (a new shot, or a new passive subject): a quick pan instead of a slow drift: a sharp
        // speed-up, a fast straight move, a sharp slow-down, then back to the slow spring
        const switched = (shot !== prevShot && (shot || prevShot)) || (!shot && cine.passive?.key !== prevPassive && prevPassive != null);
        const viewW = Math.abs(Rp.x - Lp.x), far = Math.hypot(tgt.x - here.x, tgt.y - here.y) > (shot?.cutIn || fast ? 0.35 : 0.6) * viewW || Math.abs(tgt.z - Math.log(here.d)) > 0.9;
        // Medium switches: a quick pan (a smooth curve that starts at the camera's current velocity and lands at rest on
        // the live target). Long switches (well over a screen away, or a big zoom change): League's spectator cut:
        // gently build speed toward the new spot, cut to just short of it keeping that speed, then glide to a stop.
        const dist = Math.hypot(tgt.x - here.x, tgt.y - here.y), dz = Math.abs(tgt.z - Math.log(here.d));
        if (switched && f && far && !cine.whip && opening >= 1) {
            const from = { x: here.x, y: here.y, z: Math.log(here.d) };
            if (dist > 1.3 * viewW || dz > 1.4) {
                const dir = { x: (tgt.x - here.x) / (dist || 1e-6), y: (tgt.y - here.y) / (dist || 1e-6) };
                const TA = fast ? 0.35 : 0.55, TB = fast ? 0.55 : 0.85, DB = Math.min(dist * 0.2, viewW * 0.16);
                const v0 = Math.max(0, cine.v.x * dir.x + cine.v.y * dir.y), vp = Math.max(v0, 3 * DB / TB);
                cine.whip = { kind: 'cut', t0: now, TA: TA * 1000, TB: TB * 1000, v0, vp, DB, dir, from, side: { x: cine.v.x - v0 * dir.x, y: cine.v.y - v0 * dir.y } };
            } else cine.whip = { kind: 'pan', t0: now, T: (fast ? 0.4 : 0.6) * 1000, from, v: { ...cine.v } };
        }
        if (cine.whip) {
            const w = cine.whip, t = now - w.t0;
            let done = false;
            if (w.kind === 'pan') { // cubic Hermite per axis: from (here, current velocity) to (target, at rest)
                const u = Math.min(1, t / w.T), T = w.T / 1000, h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2;
                const H = k => h00 * w.from[k] + h10 * T * w.v[k] + h01 * tgt[k];
                lp.x = H('x'); lp.y = H('y'); c._distance = Math.exp(H('z'));
                done = u >= 1;
            } else if (t < w.TA) { // cut, phase A: speed builds smoothly from the current speed (acceleration starts at 0)
                const u = t / w.TA, Ta = w.TA / 1000;
                const s = w.v0 * Ta * u + (w.vp - w.v0) * Ta * u ** 3 / 3; // integral of v0 + (vp - v0) * u^2
                const sd = Ta * (u - u * u / 2) * (1 - u); // sideways drift dies away
                lp.x = w.from.x + w.dir.x * s + w.side.x * sd; lp.y = w.from.y + w.dir.y * s + w.side.y * sd;
                c._distance = Math.exp(w.from.z);
            } else { // cut, phase B: DB short of the (live) target at the same speed, quadratic ease-out to a stop
                const u = Math.min(1, (t - w.TA) / w.TB), left = w.DB * (1 - u) ** 3;
                const D = Math.hypot(tgt.x - w.from.x, tgt.y - w.from.y) || 1e-6, dx = (tgt.x - w.from.x) / D, dy = (tgt.y - w.from.y) / D;
                lp.x = tgt.x - dx * left; lp.y = tgt.y - dy * left;
                const zc = tgt.z + (w.from.z - tgt.z) * 0.12;
                c._distance = Math.exp(tgt.z + (zc - tgt.z) * (1 - u) ** 3);
                done = u >= 1;
            }
            if (done) { cine.whip = null; cine.v = { x: 0, y: 0, z: 0 }; cine.tf = { ...tgt }; }
            c.invalidateViewport(); cine.wrote = { x: lp.x, y: lp.y, d: c._distance };
            return;
        }
        // smooth the target itself, then chase it with a critically damped spring (eases in, glides, eases out)
        const spd = Math.max(1, Math.min(4, roundsPerSec / 4)) * (fast ? 2.5 : 1) * (0.12 + 0.88 * opening * opening);
        cine.tf ||= { x: here.x, y: here.y, z: Math.log(here.d) };
        const kt = 1 - Math.exp(-dt / ((fast ? 0.3 : 0.6) + 2.2 * (1 - opening)));
        for (const k of ['x', 'y', 'z']) cine.tf[k] += (tgt[k] - cine.tf[k]) * kt;
        const cur = { x: here.x, y: here.y, z: Math.log(here.d) };
        for (const k of ['x', 'y', 'z']) {
            const w = (k === 'z' ? 1.1 : 1.3) * Math.sqrt(spd);
            const acc = w * w * (cine.tf[k] - cur[k]) - 2 * w * cine.v[k];
            cine.v[k] += acc * dt; cur[k] += cine.v[k] * dt;
        }
        lp.x = cur.x; lp.y = cur.y; c._distance = Math.exp(cur.z);
        c.invalidateViewport();
        cine.wrote = { x: lp.x, y: lp.y, d: c._distance };
    }
    requestAnimationFrame(camTick);
    // --- death marker: the viewer's own altar-tribute strike (a beam from 5 tiles up onto the tile, held, then
    // dissolved pixel by pixel, with a smoke puff where it lands), recoloured to the dead champion's team, and a
    // pixel skull and crossbones on the tile in the team colour with a black outline. Pinned to the map.
    const TEAM_BANDS = [[[0x163f9e, 2], [0x3d8bff, 4], [0xcfe3ff, 9], [0x3d8bff, 4], [0x163f9e, 2]], [[0x9e1a12, 2], [0xff4a3d, 4], [0xffd6cf, 9], [0xff4a3d, 4], [0x9e1a12, 2]],
        [[0xb9c6d6, 2], [0xe6edf6, 4], [0xffffff, 9], [0xe6edf6, 4], [0xb9c6d6, 2]]]; // 2: white, the altar's own strike
    const TEAM_RGB = ['#3d8bff', '#ff4a3d', '#ffffff'];
    const SKULL = ['.XX..........XX.', 'XXX..........XXX', 'XXXX........XXXX', '..X..XXXXXX..X..', '....XXXXXXXX....', '...XXXXXXXXXX...', '...XX..XX..XX...',
        '...X...XX...X...', '...X...XX...X...', '...XX.XXXX.XX...', '....XXX..XXX....', '...XXXXXXXXXX...', '.....XXXXXX.....', '..X..X.XX.X..X..', 'XXXX........XXXX', 'XXX..........XXX', '.XX..........XX.'];
    const BEAM = { lenPx: 200, thick: 21, travelMs: 150, holdMs: 140, fizzleMs: 260, startFade: 0.4, noise: 0.25 }; // the viewer's tribute strike, at 40 px per tile
    function skullCanvas(team) {
        const rows = SKULL, w = rows[0].length + 2, h = rows.length + 2, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const x = cv.getContext('2d'), on = (i, j) => rows[i - 1]?.[j - 1] === 'X';
        for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
            if (on(i, j)) { x.fillStyle = TEAM_RGB[team]; x.fillRect(j, i, 1, 1); }
            else if ([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]].some(([a, b]) => on(i + a, j + b))) { x.fillStyle = '#000'; x.fillRect(j, i, 1, 1); }
        }
        return cv;
    }
    function beamPixels(team, seed) { // same banding and seeded per-pixel removal order as the viewer's beam sprite
        const { lenPx: L, thick: T, noise: a } = BEAM, bands = TEAM_BANDS[team], tot = bands.reduce((s, b) => s + b[1], 0);
        const col = new Uint32Array(T), order = new Uint8Array(L * T);
        for (let c = 0; c < T; c++) { const f = (c + 0.5) / T; let k = 0, u = bands[0][1]; while (k + 1 < bands.length && f * tot > u) u += bands[++k][1]; col[c] = bands[k][0]; }
        for (let r = 0; r < L; r++) for (let c = 0; c < T; c++) {
            let h = Math.imul(r + c * L ^ seed, 569420461); h = Math.imul(h ^ h >>> 16, 1935289751);
            const rnd = ((h ^ h >>> 15) >>> 0) / 4294967296, f = Math.abs(((c + 0.5) / T) * 2 - 1);
            order[r * T + c] = 1 + Math.round(254 * (f * (1 - a) + rnd * a));
        }
        return { col, order };
    }
    let smokeSprites = null;
    function smokeImgs() { // the viewer's 'smoke' sprites, straight out of its sprite store
        if (smokeSprites) return smokeSprites;
        try {
            const st = findBackend()?.spritestore, at = st?.atlasesByName?.get ? st.atlasesByName.get('smoke') : st?.atlasesByName?.smoke, src = st?.composites?.sources;
            const ids = at?.view?.rows?.flatMap(r => r.sprites) || [];
            smokeSprites = ids.map(id => { const v = src.get ? src.get(id) : src[id]; if (!v?.pixels) return null; const c = document.createElement('canvas'); c.width = v.width; c.height = v.height;
                c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(v.pixels), v.width, v.height), 0, 0); return c; }).filter(Boolean);
        } catch { smokeSprites = []; }
        return smokeSprites;
    }
    const deathFx = [];
    function addDeathFx(team, x, y, { skull: withSkull = true } = {}) {
        if (!bannersOn() || x == null || x < 0) return;
        let host = document.getElementById('cbc-fx');
        if (!host) { host = document.createElement('div'); host.id = 'cbc-fx'; document.body.append(host); }
        const el = document.createElement('div'); el.className = 'cbc-death';
        const beam = document.createElement('canvas'); beam.width = BEAM.thick; beam.height = BEAM.lenPx; beam.className = 'beam';
        const skull = skullCanvas(team); skull.className = 'skull'; if (!withSkull) skull.style.display = 'none';
        const puffs = smokeImgs().length ? Array.from({ length: 7 }, (_, i) => { const img = smokeImgs()[i % smokeImgs().length], c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); c.className = 'puff';
            const ang = (i + Math.random()) / 7 * Math.PI * 2; c.dataset.dx = Math.cos(ang) * (0.35 + Math.random() * 0.4); c.dataset.dy = Math.sin(ang) * (0.35 + Math.random() * 0.4) * 0.6; return c; }) : [];
        el.append(...puffs, beam, skull); host.append(el);
        deathFx.push({ el, beam, skull, puffs, x, y, t0: performance.now(), px: beamPixels(team, (Math.random() * 4294967296) >>> 0), img: beam.getContext('2d').createImageData(BEAM.thick, BEAM.lenPx) });
    }
    function drawBeam(fx, age) {
        const { lenPx: L, thick: T, travelMs, holdMs, fizzleMs, startFade } = BEAM, d = fx.img.data;
        const grow = Math.min(1, age / travelMs), diss = Math.max(0, Math.min(1, (age - travelMs - holdMs) / fizzleMs)) * 255;
        for (let r = 0; r < L; r++) {
            const along = r / L, shown = along <= grow, fade = along < startFade ? along / startFade : 1; // sky end fades in
            for (let c = 0; c < T; c++) {
                const i = (r * T + c) * 4, o = fx.px.order[r * T + c], col = fx.px.col[c];
                const on = shown && o > diss;
                d[i] = col >>> 16; d[i + 1] = col >>> 8 & 255; d[i + 2] = col & 255; d[i + 3] = on ? Math.round(255 * fade) : 0;
            }
        }
        fx.beam.getContext('2d').putImageData(fx.img, 0, 0);
    }
    // --- on-map overlays: off-screen champion pointers, recall rings, teleport line + landing marker ------------------
    function pixelSprite(rows, fill) { // pixel art in a team colour with a black outline (same style as the skull)
        const w = rows[0].length + 2, h = rows.length + 2, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const x = cv.getContext('2d'), on = (i, j) => rows[i - 1]?.[j - 1] === 'X';
        for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
            if (on(i, j)) { x.fillStyle = fill; x.fillRect(j, i, 1, 1); }
            else if ([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]].some(([a, b]) => on(i + a, j + b))) { x.fillStyle = '#000'; x.fillRect(j, i, 1, 1); }
        }
        return cv;
    }
    const ARROW = ['...XXX...', '...XXX...', '...XXX...', '...XXX...', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
    const ov = { root: null, cv: null, pointers: new Map(), rings: new Map(), arrows: new Map(), dots: [], ringTex: null, glow: new Map(), lastRound: -1, roundAt: 0, landed: new Set() };
    function ovRoot() {
        if (ov.root?.isConnected) return ov.root;
        ov.root = document.createElement('div'); ov.root.id = 'cbc-ov'; document.body.append(ov.root);
        ov.cv = document.createElement('canvas'); ov.cv.className = 'lines'; ov.root.append(ov.cv);
        return ov.root;
    }
    function champsNow(cam, r, frac) { // where everyone is, moving smoothly between rounds
        const a = trackAt(cam, r), b = trackAt(cam, r + 1) || a; if (!a) return [];
        return cam.order.map((idx, i) => {
            const al = a[i * 3 + 2] === 1, bl = b[i * 3 + 2] === 1, k = al && bl ? frac : 0;
            return { idx, i, team: cam.team[i], type: game.roster?.find(c => c.idx === idx)?.type, alive: al,
                x: a[i * 3] + (b[i * 3] - a[i * 3]) * k, y: a[i * 3 + 1] + (b[i * 3 + 1] - a[i * 3 + 1]) * k };
        });
    }
    function tickOverlays(now) {
        const g = game, cam = g?.cam, b = findBackend(), c = b?.camera;
        if (!cam || !g.play || !c?.project || phase === 'draft' || draft.on || !bannersOn()) { if (ov.root) ov.root.style.display = 'none'; clearDots(); return; }
        const root = ovRoot(); root.style.display = '';
        const r = g.play.round;
        if (r !== ov.lastRound) { ov.lastRound = r; ov.roundAt = now; }
        const frac = isPlaying() ? Math.min(1, (now - ov.roundAt) / 1000 * Math.max(0.5, roundsPerSec)) : 0;
        const rc = b.htmlRefs.canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
        const P = (x, y) => { try { const p = c.project({ x, y, z: 0 }); if (!p || p.z <= 0) return null; const m = dualcam.mapA(rc.left + p.x, rc.top + p.y); return m.visible ? m : null; } catch { return null; } };
        const p0 = P(24, 24), p1 = P(25, 24), tile = p0 && p1 ? Math.max(4, Math.abs(p1.x - p0.x)) : 20;
        const zoomedOut = tile < 16;
        const champs = champsNow(cam, r, frac);
        // 1. off-screen pointers: a portrait in the team colour pinned to the edge, pointing at the champion
        const m = 26, L = rc.left + m, R = rc.right - m, T = rc.top + m, B = rc.bottom - m, cx = (rc.left + rc.right) / 2, cy = (rc.top + rc.bottom) / 2;
        const seen = new Set();
        for (const ch of champs) {
            if (!ch.alive || ch.type == null) continue;
            const p = P(ch.x, ch.y); if (!p) continue;
            if (p.x >= rc.left && p.x <= rc.right && p.y >= rc.top && p.y <= rc.bottom) continue;
            const dx = p.x - cx, dy = p.y - cy, k = Math.min(dx ? ((dx > 0 ? R : L) - cx) / dx : Infinity, dy ? ((dy > 0 ? B : T) - cy) / dy : Infinity);
            const ex = cx + dx * k, ey = cy + dy * k, ang = Math.atan2(dy, dx);
            let el = ov.pointers.get(ch.idx);
            if (!el) {
                el = document.createElement('div'); el.className = 'ptr'; el.innerHTML = '<i class="ar"></i><b class="pic"></b>';
                const css = art.icon(ch.type); if (css) el.querySelector('.pic').style.cssText = css;
                el.style.setProperty('--tc', TEAM_RGB[ch.team] || '#ccc'); root.append(el); ov.pointers.set(ch.idx, el);
            }
            el.style.transform = `translate(${ex}px, ${ey}px)`; el.querySelector('.ar').style.transform = `rotate(${ang}rad) translateX(19px)`;
            el.style.display = ''; seen.add(ch.idx);
        }
        for (const [idx, el] of ov.pointers) if (!seen.has(idx)) el.style.display = 'none';
        // 1b. League-style health bars: bigger than the viewer's own, drawn over them, team coloured, with a tick every
        //     250 HP and a heavier one every 1000 so different max HPs read at a glance; recent damage shows as a
        //     pale chunk that drains away
        { const cx2 = ov.cv.getContext('2d'); if (ov.cv.width !== Math.round(innerWidth * dpr) || ov.cv.height !== Math.round(innerHeight * dpr)) { ov.cv.width = Math.round(innerWidth * dpr); ov.cv.height = Math.round(innerHeight * dpr); }
          cx2.setTransform(dpr, 0, 0, dpr, 0, 0); cx2.clearRect(0, 0, innerWidth, innerHeight); }
        hookHealthBars(b);
        // 1c. the scoreboard (kills, net worth and the gold lead, gems) and each champion's items under their portrait
        drawScoreboard(root, cam, r, rc);
        drawInventories(root, cam, r);
        // 2. recalls (channelled more than one turn): a rotating ring on the ground around them, or, zoomed out, a
        //    glowing ring cycling around their icon
        const active = (cam.recalls || []).filter(x => r >= x.r1 && r < x.r2);
        const recalling = active.map(rec => champs.find(cc => cc.idx === rec.actor)).filter(ch => ch?.alive);
        // the ground ring stays where they recalled from; once they're gone it fades out there
        const rings = [];
        for (const rec of cam.recalls || []) {
            if (r >= rec.r1 && r < rec.r2) rings.push({ x: rec.x, y: rec.y, a: 1 });
            else if (rec.done && r >= rec.r2 && r < rec.r2 + 3) rings.push({ x: rec.x, y: rec.y, a: Math.max(0, 1 - (r - rec.r2 + frac) / 3) });
            const key = 'r' + rec.actor + ':' + rec.r1;
            if (rec.done && r >= rec.r2 && r <= rec.r2 + 1 && !ov.landed.has(key)) { ov.landed.add(key); addDeathFx(2, rec.x, rec.y, { skull: false }); } // the altar's white strike
            if (r < rec.r1 && ov.landed.has(key)) ov.landed.delete(key);
        }
        groundRings(b, zoomedOut ? [] : rings, now);
        iconGlow(b, zoomedOut ? recalling : [], now);
        // 3. teleports: a thin line on the ground from the champion to where they're going during the channel (under
        //    everyone), a small pixel arrow on the destination tile, and a strike when they land
        const arrowSeen = new Set(), segs = [];
        for (const tp of cam.tps || []) {
            const key = tp.actor + ':' + tp.r1;
            if (r >= tp.r2 && r <= tp.r2 + 1 && !ov.landed.has(key)) { ov.landed.add(key); addDeathFx(tp.team, tp.to[0], tp.to[1], { skull: false }); }
            if (r < tp.r1 && ov.landed.has(key)) ov.landed.delete(key); // seeked back
            if (!(r >= tp.r1 && r < tp.r2)) continue;
            const ch = champs.find(cc => cc.idx === tp.actor), col = TEAM_RGB[tp.team] || '#ccc';
            if (ch) segs.push({ x0: ch.x, y0: ch.y, x1: tp.to[0], y1: tp.to[1], tint: tp.team === 1 ? 0xff4a3d : 0x3d8bff, a: 0.55 + 0.4 * Math.min(1, (r - tp.r1 + frac) / Math.max(1, tp.r2 - tp.r1)) });
            const d = P(tp.to[0], tp.to[1]);
            if (d) {
                let el = ov.arrows.get(key);
                if (!el) { el = pixelSprite(ARROW, col); el.className = 'tparrow'; root.append(el); ov.arrows.set(key, el); }
                const sz = tile * 0.7, bob = Math.sin(now / 180) * sz * 0.1;
                el.style.cssText = `display:block;width:${sz}px;height:${sz}px;transform:translate(${d.x - sz / 2}px, ${d.y - sz * 1.1 + bob}px)`;
                arrowSeen.add(key);
            }
        }
        groundLines(b, segs);
        for (const [k, el] of ov.arrows) if (!arrowSeen.has(k)) { el.remove(); ov.arrows.delete(k); }
    }
    // Recall, zoomed in: a glowing white ring on the ground around them, a bright arc chasing round it. It's a decal in
    // the viewer's own ground layer, so it lies flat on the map in the camera's perspective (squashed, smaller further
    // away) and sits under the champion. The spin is 16 pre-drawn frames.
    // --- League-style top bar over the viewer's gem bar ----------------------------------------------------------------
    const atRound = (m, r) => { if (!m) return null; for (let k = 0; k < 60; k++) { const v = m.get(r - k); if (v) return v; } return null; };
    const kfmt = v => v >= 10000 ? (v / 1000).toFixed(1) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
    function drawScoreboard(root, cam, r, rc) {
        let el = document.getElementById('cbc-score');
        if (!el) { el = document.createElement('div'); el.id = 'cbc-score';
            el.innerHTML = `<div class="t t0"><b class="nm"></b><span class="k"></span></div><div class="mid"><div class="gold"><span class="g0"></span><i></i><span class="lead"></span><i></i><span class="g1"></span></div><div class="gems"><span class="s0"></span><div class="bar"><b class="h0"></b><b class="b0"></b><b class="h1"></b><b class="b1"></b></div><span class="s1"></span></div></div><div class="t t1"><span class="k"></span><b class="nm"></b></div>`;
            root.append(el); }
        const kills = atRound(cam.killsTeam, r) || [0, 0], worth = atRound(cam.worthTeam, r) || [0, 0], snap = game?.play;
        const gems = cam.gemsAt ? cam.gemsAt(r) : [0, 0];
        el.style.left = (rc.left + rc.width / 2) + 'px'; el.style.top = (rc.top + 30) + 'px';
        const nm = t => (game?.names?.[t] || (t ? 'Red' : 'Blue')).slice(0, 18);
        el.querySelector('.t0 .nm').textContent = nm(0); el.querySelector('.t1 .nm').textContent = nm(1);
        el.querySelector('.t0 .k').textContent = kills[0]; el.querySelector('.t1 .k').textContent = kills[1];
        el.querySelector('.g0').textContent = kfmt(worth[0]); el.querySelector('.g1').textContent = kfmt(worth[1]);
        const d = worth[0] - worth[1], lead = el.querySelector('.lead');
        lead.textContent = Math.abs(d) < 50 ? '' : '+' + kfmt(Math.abs(d)); lead.className = 'lead ' + (Math.abs(d) < 50 ? '' : d > 0 ? 'l0' : 'l1');
        // gems: tributed (solid) plus what each team is carrying right now (fainter), out of 1000
        const [dep0, dep1, held0 = 0, held1 = 0] = gems;
        el.querySelector('.s0').innerHTML = `${dep0}${held0 ? `<em>+${held0}</em>` : ''}`; el.querySelector('.s1').innerHTML = `${held1 ? `<em>+${held1}</em>` : ''}${dep1}`;
        el.querySelector('.b0').style.width = Math.min(50, dep0 / 20) + '%'; el.querySelector('.b1').style.width = Math.min(50, dep1 / 20) + '%';
        el.querySelector('.h0').style.width = Math.min(50, (dep0 + held0) / 20) + '%'; el.querySelector('.h1').style.width = Math.min(50, (dep1 + held1) / 20) + '%';
    }
    // --- items under each champion's portrait in the viewer's team bars -----------------------------------------------
    let itemIcons = null, itemIconsLoading = false;
    function loadItemIcons() {
        if (itemIcons || itemIconsLoading) return; itemIconsLoading = true;
        const url = performance.getEntriesByType('resource').map(e => e.name).find(u => /\/items-atlas-(?!v1|export)[\w-]+\.png/.test(u));
        if (!url) { itemIconsLoading = false; return; }
        const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
        img.decode().then(() => {
            const cell = (row, col) => { const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').drawImage(img, col * 16, row * 16, 16, 16, 0, 0, 16, 16); return c.toDataURL(); };
            itemIcons = { items: Array.from({ length: img.naturalWidth >= 192 ? 84 : 42 }, (_, id) => { const f = Math.floor(id / 6); return cell(f % 7, [3, 0, 5, 2, 4, 1][id % 6] + 6 * Math.floor(f / 7)); }),
                cons: [2, 0, 1, 3].map(col => cell(7, col)) };
        }).catch(() => { itemIconsLoading = false; });
    }
    const FAMILIES = ['Monster', 'Power', 'Durability', 'Treasure', 'Jungle', 'Home', 'Bruiser', 'Tribute', 'Capture', 'Prospector', 'Hunter', 'Skirmish', 'Greed', 'Collectors'];
    const KINDS = ['Shard of Strength', 'Emblem of Strength', 'Shard of Focus', 'Emblem of Focus', 'Shard of Health', 'Emblem of Health'];
    const CONS = ['Teleport crystal', 'Control ward', 'Altar lock', 'TP scroll'];
    const itemName = id => FAMILIES[Math.floor(id / 6)] + ' ' + KINDS[id % 6];
    function invAt(cam, idx, r) { const h = cam.invHist?.get(idx); if (!h) return null; let best = null; for (const e of h) { if (e.round <= r) best = e; else break; } return best; }
    function drawInventories(root, cam, r) {
        loadItemIcons(); if (!itemIcons || !game?.roster) return;
        let box = document.getElementById('cbc-inv'); if (!box) { box = document.createElement('div'); box.id = 'cbc-inv'; root.append(box); }
        const now = performance.now(); if (box._at && now - box._at < 300 && box._r === r) return; box._at = now; box._r = r;
        // each portrait in the viewer's team bars has a "Follow <name> with camera" button under it: left half = team 0
        const mapRc = findBackend()?.htmlRefs?.canvas?.getBoundingClientRect(); if (!mapRc) return;
        const mid = mapRc.left + mapRc.width / 2;
        const anchors = [...document.querySelectorAll('button[aria-label^="Follow "][aria-label$=" with camera"]')].map(b => {
            const rr = b.getBoundingClientRect(); return { name: b.getAttribute('aria-label').slice(7, -12), team: rr.left + rr.width / 2 < mid ? 0 : 1, cx: rr.left + rr.width / 2, bottom: rr.bottom }; });
        let html = '';
        for (const c of game.roster) {
            const an = anchors.find(a => a.team === c.team && a.name === CHAMPS[c.type]); if (!an) continue;
            const cx = an.cx, top = an.bottom + 4;
            const inv = invAt(cam, c.idx, r); if (!inv) continue;
            const fresh = new Set((cam.buys || []).filter(b => b.idx === c.idx && b.round <= r && b.round > r - 12).flatMap(b => b.items));
            const owned = inv.items.map((n, id) => ({ id, n })).filter(x => x.n > 0).sort((a, b) => (b.id % 2) - (a.id % 2) || b.n - a.n);
            const cells = owned.slice(0, 6).map(x => `<i class="${fresh.has(x.id) ? 'new' : ''}" title="${itemName(x.id)}${x.n > 1 ? ' x' + x.n : ''}" style="background-image:url(${itemIcons.items[x.id]})">${x.n > 1 ? `<s>${x.n}</s>` : ''}</i>`)
                .concat(inv.cons.map((n, k) => n > 0 ? `<i title="${CONS[k]}${n > 1 ? ' x' + n : ''}" style="background-image:url(${itemIcons.cons[k]})">${n > 1 ? `<s>${n}</s>` : ''}</i>` : '').filter(Boolean)).slice(0, 8);
            if (cells.length) html += `<div class="col" style="left:${cx - 17}px;top:${top}px">${cells.join('')}</div>`;
        }
        box.innerHTML = html;
    }
    const hpLag = new Map();
    function maxHpAt(cam, i, r) {
        const k = i + ':' + (r - r % 10); cam.maxHpCache ||= new Map();
        if (cam.maxHpCache.has(k)) return cam.maxHpCache.get(k);
        let m = 0; for (let rr = r - 120; rr <= r; rr += 2) { const h = cam.hp?.get(rr); if (h && h[i] > m) m = h[i]; }
        cam.maxHpCache.set(k, m); return m;
    }
    // Health bars: the viewer's own champion bars (a background + a fill sprite, screen-space, laid out every frame
    // and tied to each unit) are hidden right after it lays them out, and ours are drawn at exactly those spots in the
    // same frame, so they move with the units. Ours: bigger, team coloured, a tick every 250 HP and a heavy one every
    // 1000 (500/heavy every 2000 on very tanky champions), recent damage as a pale chunk draining away.
    const HP_THICK_PPT = 24; // screen px per tile from which our thick bars replace the viewer's (its icon LOD switch)
    function hookHealthBars(b) {
        if (!b || b.__cbcHp) return; b.__cbcHp = true;
        let cv = null;
        b.on('tick', () => {
            try {
                const sc = b.scene, st = b.spritestore, cam = game?.cam; if (!sc?.uiPixelElements) return;
                const mc = b.htmlRefs.canvas, rc = mc.getBoundingClientRect(), k = rc.width / b.camera.viewportWidth, dpr = devicePixelRatio || 1;
                // thick bars only zoomed in past where the viewer swaps champions for icons (~24 px a tile)
                let ppt = 0; try { const p0 = b.camera.project({ x: 24, y: 24, z: 0 }), p1 = b.camera.project({ x: 25, y: 24, z: 0 }); if (p0 && p1 && p0.z > 0) ppt = Math.abs(p1.x - p0.x); } catch { }
                const r = game?.play?.round ?? 0, tr = cam && trackAt(cam, r);
                const on = bannersOn() && !draft.on && phase !== 'draft' && ppt >= HP_THICK_PPT && !!tr;
                const parts = new Map();
                for (const e of sc.uiPixelElements) {
                    const ref = e.depthReference; if (ref?.unitIcon?.healthFraction === undefined) continue; // units with a bar
                    const sp = st.resolve(e.sprite); if (!sp || sp.width < 30 || sp.height > 12) continue;   // the 44x8 bar sprites
                    let p = parts.get(ref); if (!p) parts.set(ref, p = { ref, sp });
                    if (e.clipInsetPixels != null || e.tint != null) p.fill = e; else p.bg = e;
                }
                // each champion claims the bar nearest it; the rest (monsters) keep the viewer's own thin bars
                const claim = new Map();
                if (on) cam.order.forEach((idx, i) => {
                    let bp = null, bd = 2.5;
                    for (const p of parts.values()) { if (claim.has(p)) continue; const d = Math.hypot(tr[i * 3] - p.ref.position.x, tr[i * 3 + 1] - p.ref.position.y); if (d < bd) { bd = d; bp = p; } }
                    if (bp) claim.set(bp, i);
                });
                for (const [p] of claim) for (const e of [p.fill, p.bg]) if (e) e.opacity = 0;
                if (!cv || !cv.isConnected) { cv = document.createElement('canvas'); cv.id = 'cbc-hp'; mc.after(cv); }
                Object.assign(cv.style, { position: 'absolute', left: mc.offsetLeft + 'px', top: mc.offsetTop + 'px', width: rc.width + 'px', height: rc.height + 'px', pointerEvents: 'none' });
                if (cv.width !== Math.round(rc.width * dpr)) { cv.width = Math.round(rc.width * dpr); cv.height = Math.round(rc.height * dpr); }
                const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, rc.width, rc.height);
                if (!on) return;
                for (const [p, ci] of claim) {
                    const e = p.fill || p.bg; if (!e || (p.ref.opacity ?? 1) <= 0) continue;
                    const sx = e.scale?.x ?? 1, sy = e.scale?.y ?? sx;
                    const cxv = e.position.x + (p.sp.width / 2 - p.sp.anchorX) * sx, cyv = e.position.y + (p.sp.height / 2 - p.sp.anchorY) * sy;
                    const W = Math.max(33, p.sp.width * sx * 1.6) * k, H = Math.max(5, p.sp.height * sy * 1.6) * k;
                    const bx = cxv * k - W / 2, by = cyv * k - H / 2;
                    const frac = Math.max(0, Math.min(1, p.fill ? (p.fill.clipRight ?? 1) : 1));
                    const team = cam.team[ci], max = maxHpAt(cam, ci, r) || 1000;
                    const key = cam.order[ci], lag = hpLag.get(key), shown = lag == null || frac > lag ? frac : lag - (lag - frac) * 0.06; hpLag.set(key, shown);
                    x.fillStyle = 'rgba(0,0,0,.88)'; x.fillRect(bx - 1.5, by - 1.5, W + 3, H + 3);
                    x.fillStyle = '#1b1e24'; x.fillRect(bx, by, W, H);
                    x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(bx, by, W * shown, H);
                    const grd = x.createLinearGradient(0, by, 0, by + H); grd.addColorStop(0, TEAM_RGB[team] || '#ccc'); grd.addColorStop(1, team === 1 ? '#a8261c' : '#1f57b8');
                    x.fillStyle = grd; x.fillRect(bx, by, W * frac, H);
                    const step = max > 4000 ? 500 : 250, heavy = max > 4000 ? 2000 : 1000;
                    for (let v = step; v < max; v += step) { const tx = bx + W * v / max, big = v % heavy === 0; x.fillStyle = 'rgba(0,0,0,.8)'; x.fillRect(Math.round(tx), by, big ? 1.6 : 1, big ? H : H * 0.55); }
                }
            } catch { }
        });
    }
    function groundRings(b, champs, now) {
        const sc = b?.scene, st = b?.spritestore; if (!sc?.tileDecals || !st?.procedural) return;
        if (!ov.ringTex) {
            const N = 16, S = 64, R0 = 24;
            ov.ringTex = Array.from({ length: N }, (_, f) => st.procedural({ width: S, height: S, anchorX: S / 2, anchorY: S / 2, key: 'cbc-recall-' + f, paint(px) {
                const head = f / N * Math.PI * 2;
                for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
                    const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2, d = Math.hypot(dx, dy), off = Math.abs(d - R0), i = (y * S + x) * 4;
                    let ang = Math.atan2(dy, dx) - head; ang = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); // 0..2pi behind the head
                    const arc = Math.max(0, 1 - ang / (Math.PI * 1.2)); // bright head with a fading tail
                    const core = off < 1.6 ? 1 : 0, glow = Math.max(0, 1 - off / 6);
                    const a = Math.min(1, core * (0.55 + 0.45 * arc) + glow * glow * (0.35 + 0.65 * arc));
                    px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = Math.round(255 * a);
                }
            } }));
        }
        while (ov.dots.length < champs.length) { const d = { sprite: ov.ringTex[0].sprite, position: { x: 0, y: 0 }, scale: { x: 1.2, y: 1.5 }, visible: true, tint: 0xffffff, opacity: 1 }; sc.tileDecals.push(d); ov.dots.push(d); }
        while (ov.dots.length > champs.length) { const d = ov.dots.pop(), i = sc.tileDecals.indexOf(d); if (i >= 0) sc.tileDecals.splice(i, 1); }
        const frame = Math.floor(now / 55) % ov.ringTex.length;
        champs.forEach((ch, k) => { const d = ov.dots[k]; d.position.x = ch.x; d.position.y = ch.y; d.sprite = ov.ringTex[frame].sprite; d.opacity = (ch.a ?? 1) * (0.85 + 0.15 * Math.sin(now / 160)); });
    }
    // straight lines on the ground: small squares every 0.12 tiles in the ground-decal layer
    function groundLines(b, segs) {
        const sc = b?.scene, st = b?.spritestore; if (!sc?.tileDecals || !st?.procedural) return;
        ov.lineTex ||= st.procedural({ width: 4, height: 4, anchorX: 2, anchorY: 2, key: 'cbc-line', paint(px) { px.fill(255); } });
        const pts = [];
        for (const g of segs) { const len = Math.hypot(g.x1 - g.x0, g.y1 - g.y0), n = Math.max(2, Math.ceil(len / 0.12));
            for (let i = 0; i <= n; i++) pts.push({ x: g.x0 + (g.x1 - g.x0) * i / n, y: g.y0 + (g.y1 - g.y0) * i / n, tint: g.tint, a: g.a }); }
        ov.lines ||= [];
        while (ov.lines.length < pts.length) { const d = { sprite: ov.lineTex.sprite, position: { x: 0, y: 0 }, scale: { x: 1.9, y: 2.4 }, visible: true, tint: 0xffffff, opacity: 1 }; sc.tileDecals.push(d); ov.lines.push(d); }
        while (ov.lines.length > pts.length) { const d = ov.lines.pop(), i = sc.tileDecals.indexOf(d); if (i >= 0) sc.tileDecals.splice(i, 1); }
        pts.forEach((p, i) => { const d = ov.lines[i]; d.position.x = p.x; d.position.y = p.y; d.tint = p.tint; d.opacity = p.a; });
    }
    function clearDots() { const sc = findBackend()?.scene; for (const d of [...ov.dots, ...(ov.lines || [])]) { const i = sc?.tileDecals.indexOf(d); if (i >= 0) sc.tileDecals.splice(i, 1); } ov.dots = []; ov.lines = []; iconGlow(findBackend(), [], 0); }
    // Recall, zoomed out: the champion's own icon outline glows, cycling white <-> blue. It's the viewer's own icon, so
    // it layers like every other icon (under whoever's icon is on top of it)
    function iconGlow(b, champs, now) {
        const bbs = b?.scene?.billboards || [], want = new Set();
        for (const ch of champs) {
            let best = null, bd = 0.75;
            for (const bb of bbs) { if (!bb.unitIcon || bb.unitIcon.healthFraction === undefined) continue; const d = Math.hypot(bb.position.x - ch.x, bb.position.y - ch.y); if (d < bd) { bd = d; best = bb; } }
            if (!best) continue;
            want.add(best);
            if (!ov.glow.has(best)) ov.glow.set(best, best.unitIcon.outlineColor);
            const k = 0.5 + 0.5 * Math.sin(now / 170), mix = (a, c) => Math.round(a + (c - a) * k);
            best.unitIcon.outlineColor = mix(0x4a, 0xff) << 16 | mix(0xa8, 0xff) << 8 | 0xff;
        }
        for (const [bb, orig] of ov.glow) if (!want.has(bb)) { bb.unitIcon.outlineColor = orig; ov.glow.delete(bb); }
    }
    function tickDeathFx() {
        if (!deathFx.length) return;
        const b = findBackend(), c = b?.camera; if (!c?.project) return;
        const rc = b.htmlRefs.canvas.getBoundingClientRect(), now = performance.now();
        for (let i = deathFx.length - 1; i >= 0; i--) {
            const fx = deathFx[i], age = now - fx.t0;
            if (age > 2300) { fx.el.remove(); deathFx.splice(i, 1); continue; }
            let p, q; try { p = c.project({ x: fx.x, y: fx.y, z: 0 }); q = c.project({ x: fx.x + 1, y: fx.y, z: 0 }); } catch { continue; } // tile centres are whole numbers
            const mp = p && dualcam.mapA(rc.left + p.x, rc.top + p.y);
            if (!p || !q || p.z <= 0 || !mp.visible) { fx.el.style.display = 'none'; continue; }
            const tile = Math.max(6, Math.abs(q.x - p.x));
            fx.el.style.display = '';
            fx.el.style.transform = `translate(${mp.x}px, ${mp.y}px)`;
            fx.el.style.setProperty('--t', tile + 'px');
            const beamDone = BEAM.travelMs + BEAM.holdMs + BEAM.fizzleMs;
            if (age <= beamDone + 20) drawBeam(fx, age); else fx.beam.style.display = 'none';
            // smoke puffs where it lands
            const sm = Math.max(0, Math.min(1, (age - BEAM.travelMs) / 500));
            for (const pf of fx.puffs) { const e = 1 - (1 - sm) ** 3; pf.style.opacity = age < BEAM.travelMs ? 0 : (1 - sm) ** 2;
                pf.style.transform = `translate(calc(var(--t) * ${pf.dataset.dx * e} - 50%), calc(var(--t) * ${pf.dataset.dy * e - 0.15 * sm} - 50%)) scale(${0.9 + 0.5 * e})`; }
            // skull: pops in as the strike lands, holds, then a quick fade
            const s0 = BEAM.travelMs, k = age < s0 ? 0 : age < s0 + 180 ? (age - s0) / 180 : 1;
            const out = Math.max(0, Math.min(1, (age - 1800) / 450));
            fx.skull.style.opacity = k * (1 - out);
            fx.skull.style.transform = `translate(-50%, -50%) scale(${age < s0 + 180 ? 1.35 - 0.35 * k : 1})`;
        }
    }
    // --- the end: League's victory / defeat music, started early so its first big hit lands exactly as the game is won,
    // and on that hit the kill chime plus a bright ring sweeping out from the winning tribute, turning every tile it
    // passes into the winning team's colour. Spectating always gets the victory track.
    // Summoner's Rift - Victory / Defeat (League of Legends: Season 4); `hit` = seconds to the first big hit
    const VD = { victory: { local: 'music/sr_victory_s4.m4a', hit: 3.33, file: "Summoner's_Rift_Bloom_Victory", fhit: 2.97 },
        defeat: { local: 'music/sr_defeat_s4.m4a', hit: 3.74, file: "Summoner's_Rift_Bloom_Defeat", fhit: 0.83 } };
    const ending = { g: null, started: false, track: null, timer: null, fx: null };
    function resetEnding() {
        clearTimeout(ending.timer); ending.timer = null;
        if (ending.track) { fadeOut(ending.track, 400); ending.track = null; }
        if (ending.fx) clearEndFx(ending.fx); ending.fx = null; ending.started = false;
    }
    function tickEnding(now) {
        const g = game, e = g?.cam?.end;
        if (ending.g !== g) { resetEnding(); ending.g = g; }
        if (!e || !g.play) return;
        const r = g.play.round, rps = Math.max(0.5, Math.min(40, roundsPerSec));
        const kind = spectatorMode() || e.winner == null || e.winner === allyTeam() ? 'victory' : 'defeat';
        fetchLocal(VD[kind].local);
        const localUrl = bridge.url.get(VD[kind].local), lead = localUrl ? VD[kind].hit : VD[kind].fhit;
        if (ending.started && r < e.round - lead * rps - 6) resetEnding(); // seeked back before it
        if (!ending.started && isPlaying() && r >= e.round - lead * rps && r <= e.round + 2) {
            ending.started = true;
            const late = Math.max(0, Math.min(lead, lead - (e.round - r) / rps)); // already partway into the run-up
            if (musicOn() && !muted()) {
                for (const a of [bgm.a, draft.outro]) if (a && !a.paused) fadeOut(a, 600);
                const t = new Audio(localUrl || SFX_BASE + encodeURIComponent(VD[kind].file) + '.ogg'); t.volume = Math.min(1, volume() * 0.75);
                t.currentTime = late; t.play().catch(() => { }); ending.track = t;
            }
            ending.timer = setTimeout(() => endBurst(e), (lead - late) * 1000);
        }
        if (ending.fx) drawEndFx(now);
    }
    // the viewer's own map (which tiles are ground / wall / hole), from its React state
    let mapRef = null;
    function viewerMap() {
        if (mapRef?.cells?.size) return mapRef;
        const el = findBackend()?.htmlRefs?.canvas; if (!el) return null;
        const k = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
        for (let f = k && el[k], n = 0; f && n < 60; f = f.return, n++) for (const src of [f.memoizedProps, f.memoizedState?.memoizedState]) if (src?.current?.cells?.size && src.current.isGround) return (mapRef = src.current);
        return null;
    }
    function endBurst(e) {
        ending.timer = null;
        const team = e.winner ?? allyTeam();
        sfx(team === allyTeam() || spectatorMode() ? 'kill' : 'enemyKill', { vol: 1, loud: true });
        sfx('melodyPenta', { vol: 0.8, loud: true });
        // painted into the viewer's own ground-decal layer, so champions, bushes, walls and altars all stay on top;
        // floor tiles only (ground and bush), not holes, walls or altars
        const b = findBackend(), st = b?.spritestore, sc = b?.scene; if (!st?.procedural || !sc?.tileDecals) return;
        const m = viewerMap(), tiles = [];
        if (m) for (const [key, c] of m.cells) { if (c.kind === 'GROUND' || c.kind === 'BUSH') { const [i, j] = key.split(',').map(Number); tiles.push([i, j]); } }
        else for (let j = 0; j < 50; j++) for (let i = 0; i < 50; i++) tiles.push([i, j]);
        const tex = st.procedural({ width: 8, height: 8, anchorX: 4, anchorY: 4, key: 'cbc-end-tile', paint(px) { px.fill(255); } });
        // it starts from the altar the winning gems went into (the one next to the tributing champion)
        let cx = e.x ?? 24, cy = e.y ?? 24;
        const wt = game?.cam?.tribs?.find(t => t.win), wc = wt && game.cam.order.indexOf(wt.actor), wa = wt && trackAt(game.cam, wt.end - 1);
        if (wa && wc >= 0) { cx = wa[wc * 3]; cy = wa[wc * 3 + 1]; } // where the tributing champion stood
        if (m) { let bd = Infinity; for (const [key, c] of m.cells) if (c.kind === 'ALTAR') { const [i, j] = key.split(',').map(Number), d = Math.hypot(i - cx, j - cy); if (d < bd) { bd = d; cx = i; cy = j; } } }
        const decals = tiles.map(([i, j]) => {
            const d = { sprite: tex.sprite, position: { x: i, y: j }, scale: { x: 5.08, y: 6.35 }, visible: false, tint: 0, opacity: 1 };
            sc.tileDecals.push(d);
            return { d, dist: Math.hypot(i - cx, j - cy), shade: ((i * 7 + j * 13) % 5) / 5 };
        });
        ending.fx = { t0: performance.now(), team, decals, tex, sc };
    }
    function clearEndFx(fx) {
        const set = new Set(fx.decals.map(x => x.d));
        for (let i = fx.sc.tileDecals.length - 1; i >= 0; i--) if (set.has(fx.sc.tileDecals[i])) fx.sc.tileDecals.splice(i, 1);
        try { fx.tex.release?.(); } catch { }
    }
    function drawEndFx(now) {
        const fx = ending.fx, R = (now - fx.t0) / 1000 * 14; // ring speed, tiles per second
        if (fx.done) return;
        const base = fx.team === 1 ? [196, 52, 44] : [44, 106, 210], hi = fx.team === 1 ? [255, 120, 100] : [120, 180, 255];
        let pending = false;
        for (const t of fx.decals) {
            const behind = R - t.dist;
            if (behind < -0.9) { t.d.visible = false; pending = true; continue; }
            const ring = Math.max(0, 1 - Math.abs(behind) / 0.9), flash = Math.max(ring, Math.max(0, 1 - behind / 2.5) * 0.5), k = 1 - t.shade * 0.07;
            if (flash > 0) pending = true;
            const col = [0, 1, 2].map(n => Math.round(Math.min(255, base[n] * k + (hi[n] - base[n] * k) * Math.min(1, flash * 1.2) + (255 - hi[n]) * ring * 0.7)));
            t.d.visible = true; t.d.tint = col[0] << 16 | col[1] << 8 | col[2]; t.d.opacity = behind < 0 ? ring : 1;
        }
        if (!pending) fx.done = true; // fully painted: stop touching it
    }
    function visibleTiles() {
        if (view && performance.now() - viewAt < 400) return view;
        viewAt = performance.now();
        const b = findBackend(); if (!b) return (view = null);
        const r = b.htmlRefs.canvas.getBoundingClientRect();
        const pts = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => { try { return b.screenToTile(x, y); } catch { return null; } }).filter(Boolean);
        if (pts.length < 2) return (view = null);
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        return (view = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }
    // For sounds you should only hear up close (recalls): next to silent unless the spot is on screen and the camera
    // is zoomed in on it. Full volume at about 22 tiles across or closer, fading out by about 40.
    // Sound physics: a sound is judged against what's on screen now AND, with the cinema camera on, where the camera
    // is heading (its target framing), so something the camera is about to move onto is already heard properly.
    const aheadView = () => cinemaOn() && cine.targetView && performance.now() - cine.targetView.at < 1000 ? cine.targetView : null;
    function nearGainIn(v, x, y) {
        const faint = 0.04;
        if (x < v.x0 - 1 || x > v.x1 + 1 || y < v.y0 - 1 || y > v.y1 + 1) return 0;
        const w = Math.max(v.x1 - v.x0, (v.y1 - v.y0) * 1.2);
        return faint + (1 - faint) * Math.max(0, Math.min(1, (40 - w) / 18));
    }
    function nearGain(x, y) {
        const faint = 0.04;
        if (x == null || x < 0 || y < 0) return faint;
        const v = visibleTiles(), t = aheadView(); if (!v && !t) return faint;
        return Math.max(v ? nearGainIn(v, x, y) : 0, t ? nearGainIn(t, x, y) : 0);
    }
    function posGainIn(v, x, y) {
        const w = Math.max(4, v.x1 - v.x0), hgt = Math.max(4, v.y1 - v.y0);
        const out = Math.max(0, (v.x0 - x) / w, (x - v.x1) / w, (v.y0 - y) / hgt, (y - v.y1) / hgt);
        return out === 0 ? 1.15 : Math.max(0.12, 1 - out * 1.8);
    }
    function posGain(x, y) {
        if (x == null || x < 0 || y < 0) return 1;
        const v = visibleTiles(), t = aheadView(); if (!v && !t) return 1;
        return Math.max(v ? posGainIn(v, x, y) : 0, t ? posGainIn(t, x, y) : 0);
    }
    let soundAt = null; // position of the sound being played right now (set around champion/step sounds)
    function stopSfx(tag) { for (const a of live) if (a.dataset.tag === tag) { a.pause(); live.delete(a); } }
    let actx = null;
    function coin(vol = 1) { // the gold jingle, synthesized (the wiki has no gold sound)
        if (!sfxOn() || muted()) return;
        try {
            actx ??= new AudioContext();
            const t = actx.currentTime, g = actx.createGain();
            g.connect(actx.destination);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.18 * sfxVolume() * vol, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
            for (const [f, at] of [[1318.5, 0], [1975.5, 0.075]]) { const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); o.start(t + at); o.stop(t + 0.5); }
        } catch { }
    }
    // viewer playback speed (the "1x" label between the ×0.5 / ×2 buttons)
    let speedEl = null;
    function viewerSpeed() {
        if (!speedEl?.isConnected) speedEl = [...document.querySelectorAll('button, span, div')].find(e => !e.children.length && /^[0-9.]+\s*[x×]$/.test(e.textContent.trim())) || null;
        const v = parseFloat(speedEl?.textContent || '1');
        return v > 0 ? v : 1;
    }
    // Champion sounds, layered like League's: swing + missile + hit for attacks, cast + missile/buff + impact for
    // abilities. A generous budget only guards against a wall of noise at high speed.
    let champTokens = 12, champAt = 0;
    const tankSkip = new Map();
    const MAGES = new Set([3, 5, 6]); // ranged spellcasters: their basic attacks mostly stay quiet
    const lastCast = new Map();
    // Sound rate scales with how busy the screen is: the thinning below exists so a big fight isn't a wall of
    // noise, but when only a few things are happening on screen, every on-screen action gets its sound
    const inViewRecent = [];
    function quietness(now) {
        while (inViewRecent.length && now - inViewRecent[0] > 1500) inViewRecent.shift();
        return Math.max(0, Math.min(1, (7 - inViewRecent.length) / 5)); // 1 = near silent on screen, 0 = busy
    }
    function champSfx(type, kind, { vc = true, reset = false, slot = -1, atype = 0 } = {}) {
        const now = performance.now(), sp = viewerSpeed();
        champTokens = Math.min(12, champTokens + (now - champAt) / 1000 * (sp > 2 ? 6 : 14)); champAt = now;
        const onChamp = kind === 5 && vc; // an attack that hit an enemy champion: always heard
        const inView = !!soundAt && posGain(soundAt.x, soundAt.y) > 1, quiet = inView ? quietness(now) : 0;
        if (champTokens < 1 && !onChamp && quiet < 0.6) return;
        if (inView) inViewRecent.push(now);
        const t = 'c' + type, spd = Math.max(1, sp);
        if (kind === 5) {
            let v = 1;
            if (onChamp) {
                champTokens = Math.max(0, champTokens - 1);
                v = 0.68 + Math.random() * 0.17; // still under abilities, but clearly there
                if (localChamp(type, 'attack', 0.5 * v, spd)) { maybeVoice(type, 'va', 0.07); return; }
                if (LOCAL_SFX[type]) return; // its own sounds aren't loaded yet: silence, never another champion's stand-in (Sona for Cassi sounded like Seraphine)
                sfx(t + 'a', { vol: 0.26 * v }); sfx(t + 'am', { vol: 0.3 * v });
                setTimeout(() => sfx(t + 'h', { vol: 0.5 * v }), (MELEE.has(type) ? 45 : 130) / spd);
                maybeVoice(type, 'va', 0.07);
                return;
            }
            // Champions attack every round, which reads as a beat: drop swings at random (not every Nth, which is
            // its own rhythm). Tanks keep about half, mages about a quarter, everyone else about two thirds.
            const keep0 = MAGES.has(type) ? 0.25 : TANKS.has(type) ? 0.5 : 0.65, keep = keep0 + (1 - keep0) * quiet;
            if (Math.random() > keep) return;
            if (TANKS.has(type) || MAGES.has(type)) v = MAGES.has(type) ? 0.8 : 0.85;
            champTokens--;
            v *= 0.45 + Math.random() * 0.25; // attacks sit well under abilities, each at its own loudness (45-70%)
            if (localChamp(type, 'attack', 0.5 * v, spd)) { maybeVoice(type, 'va', 0.07); return; }
                if (LOCAL_SFX[type]) return; // its own sounds aren't loaded yet: silence, never another champion's stand-in (Sona for Cassi sounded like Seraphine)
            sfx(t + 'a', { vol: 0.26 * v });
            sfx(t + 'am', { vol: 0.3 * v });
            setTimeout(() => sfx(t + 'h', { vol: 0.5 * v }), (MELEE.has(type) ? 45 : 130) / spd);
            if (type === 3 && Math.random() < 0.05) sfx(t + 'purr', { vol: 0.6 });
            maybeVoice(type, 'va', 0.07);
        } else {
            // away from champion fights, a recently heard ability often stays quiet
            if (!vc && now - (lastCast.get(type) || -1e9) < 6000 && Math.random() < 0.7 * (1 - quiet) && atype !== 6) return; // dashes always heard
            lastCast.set(type, now);
            champTokens = Math.max(0, champTokens - 1);
            if (reset && (LOCAL_SFX[type]?.reset && localChamp(type, 'reset', 0.75, spd) || SFX_FILES[t + 'reset'] && sfx(t + 'reset', { vol: 0.75 }))) { maybeVoice(type, 'v', 0.3); return; } // e.g. Nidalee's Takedown
            if (localChamp(type, 'ability', 0.7, spd, slot, atype)) { maybeVoice(type, 'v', 0.35); return; }
            if (LOCAL_SFX[type]) return; // not loaded yet: no stand-in
            sfx(t + 'c', { vol: 0.7 });
            sfx(t + 'cm', { vol: 0.5 });
            setTimeout(() => sfx(t + 'ch', { vol: 0.6 }), 120 / spd);
            maybeVoice(type, 'v', 0.35);
        }
    }
    // champion voice lines on attacks/abilities, sparingly: per-champion and global cooldowns
    const voiceAt = new Map(); let voiceAny = 0;
    // --- sound board: a button for every sound, played the way the replay plays it (layered, at the current
    // playback speed for timed ones like recall)
    function soundBoard() {
        let el = document.getElementById('cbc-board');
        if (el) { el.remove(); return; }
        preloadLocal(Object.keys(LOCAL_SFX).map(Number));
        el = document.createElement('div');
        el.id = 'cbc-board';
        const spd = () => Math.max(1, viewerSpeed());
        const sec = (title, buttons) => { const d = document.createElement('div'); d.className = 'sec';
            d.innerHTML = `<h4>${title}</h4>`; for (const [label, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; d.append(b); } return d; };
        el.innerHTML = `<div class="top"><b>sound board</b><span>at ${viewerSpeed()}x · needs sfx on</span><button class="x">close</button></div>`;
        el.querySelector('.x').onclick = () => el.remove();
        el.append(sec('kills', [
            ['first blood chime', () => { sfx('kill', { loud: true }); sfx('melodyFirst', { loud: true }); }],
            ...[2, 3, 4, 5].map(n => [['double', 'triple', 'quadra', 'penta'][n - 2] + ' chime', () => { sfx('kill' + n, { loud: true }); sfx('melody' + ['', '', 'Double', 'Triple', 'Quadra', 'Penta'][n], { loud: true }); }]),
            ['enemy kill', () => sfx('enemyKill', { vol: 0.95, loud: true })],
            ['execute (assist ding)', () => sfx('assist', { vol: 0.8, loud: true })],
        ]));
        el.append(sec('map', [
            ['recall (5 rounds at this speed)', () => sfx('recall', { vol: 0.8, rate: RECALL_SFX_SEC / (RECALL_ROUNDS / Math.max(0.5, roundsPerSec)) })],
            ['recall arrives', () => sfx('recallEnd', { vol: 0.8 })],
            ['teleport', () => sfx('teleport', { vol: 0.8, rate: viewerSpeed() })],
            ['teleport arrives', () => sfx('teleportEnd', { vol: 0.8 })],
            ['camp taken (gold)', () => sfx('gold', { vol: 0.35 })],
            ['gems submitted', () => sfx('goldBig', { vol: 0.9 })],
            ['shop buy', () => sfx('buy', { vol: 0.6 })],
        ]));
        for (let t = 0; t < 13; t++) {
            const L = LOCAL_SFX[t], name = CHAMPS[t] + (CHAMP_SFX[t] ? '' : '');
            const btns = [['attack', () => { if (!localChamp(t, 'attack', 0.5 * (0.35 + Math.random() * 0.3), spd())) { sfx('c' + t + 'a', { vol: 0.2 }); setTimeout(() => sfx('c' + t + 'h', { vol: 0.25 }), (MELEE.has(t) ? 45 : 130) / spd()); } }]];
            if (L) {
                const slots = L.abilities.length > 1 && t !== 5 ? [0, 1] : [-1];
                for (const sl of slots) btns.push([sl < 0 ? 'ability (rotates)' : `ability slot ${sl + 1} (rotates)`, () => localChamp(t, 'ability', 0.7, spd(), sl)]);
                if (L.reset) btns.push(['attack reset', () => localChamp(t, 'reset', 0.75, spd())]);
            } else btns.push(['ability', () => sfx('c' + t + 'c', { vol: 0.7 })]);
            for (const [k, label] of [['v', 'ability voice'], ['va', 'attack voice'], ['death', 'death voice'], ['respawn', 'respawn voice']]) if (SFX_FILES['c' + t + k]) btns.push([label, () => sfx('c' + t + k, { vol: 0.8 })]);
            el.append(sec(`${name} <small>(${['pantheon', 'vayne', 'akali', 'yuumi', 'nidalee', 'seraphine', 'mel', 'riven', 'soraka', 'lee sin', 'volibear', 'sejuani', 'zaahen'][t]})</small>`, btns));
        }
        el.append(sec('announcer', Object.keys(LINES).map(l => [LINES[l].banner.toLowerCase(), () => { const a = clip(pickTake(l, allyTeam()).id); a.currentTime = 0; a.volume = volume(); a.play(); }])));
        document.body.append(el);
    }
    function maybeVoice(type, kind, chance) {
        const now = performance.now();
        if (Math.random() > chance || now - voiceAny < 2500 || now - (voiceAt.get(type) || 0) < 9000) return;
        if (sfx('c' + type + kind, { vol: 0.8 })) { voiceAny = now; voiceAt.set(type, now); }
    }
    const ambience = { a: null };
    // background music: Summoner's Rift "Bloom" (early / mid / late by how far into the game we are)
    const musicOn = () => localStorage.getItem(LS + 'music') !== '0';
    const bgm = { a: null, part: null };
    const handoff = { at: 0 }; // when the pick show ended: the Rift music and ambience swell in under the finalization theme
    const BGM_VOL = 0.32;
    function tickBgm(playing) {
        const want = playing && musicOn() && !draft.on && !ending.started; // the victory / defeat track takes over at the end
        const total = game?.index?.at(-1)?.round || 1500, r = game?.play?.round || 0;
        const part = r < total * 0.35 ? 'bgmEarly' : r < total * 0.7 ? 'bgmMid' : 'bgmLate';
        if (want && (!bgm.a || bgm.part !== part)) {
            const old = bgm.a; if (old) fadeOut(old, 2500);
            const a = new Audio(sfxSrc(part)); a.loop = true; a.volume = 0; bgm.a = a; bgm.part = part;
            const swell = performance.now() - handoff.at < 3000 ? 6000 : 2500;
            a.play().then(() => fadeTo(a, volume() * BGM_VOL, swell)).catch(() => { });
            if (draft.outro && swell > 2500) { const o = draft.outro; setTimeout(() => { if (draft.outro === o) { fadeOut(o, 5000); draft.outro = null; } }, 2500); }
        }
        if (bgm.a) {
            if (!want && !bgm.a.paused) bgm.a.pause();
            else if (want && bgm.a.paused) bgm.a.play().catch(() => { });
            if (want && !bgm.a.dataset.fading) bgm.a.volume = Math.min(1, volume() * BGM_VOL);
        }
    }
    function fadeTo(a, v, ms) { a.dataset.fading = '1'; const v0 = a.volume, t0 = performance.now();
        const f = () => { const k = Math.min(1, (performance.now() - t0) / ms); a.volume = Math.max(0, Math.min(1, v0 + (v - v0) * k)); if (k < 1) requestAnimationFrame(f); else delete a.dataset.fading; }; f(); }
    function fadeOut(a, ms) { fadeTo(a, 0, ms); setTimeout(() => a.pause(), ms + 50); }
    function tickAmbience() {
        const want = ambOn() && !muted() && sfxOn() && !!game && isPlaying();
        if (want && !ambience.a) { const a = new Audio(SFX_BASE + encodeURIComponent(SFX_FILES.ambience[0]) + '.ogg'); a.loop = true; ambience.a = a; a.volume = 0; }
        const a = ambience.a; if (!a) return;
        // fade in rather than cutting in at full level (the first time, and coming out of the pick show)
        if (want && a.paused) { a.volume = 0; a.play().then(() => fadeTo(a, Math.min(1, volume() * 0.32), performance.now() - handoff.at < 3000 ? 6000 : 1500)).catch(() => { }); }
        else if (!a.dataset.fading) a.volume = Math.min(1, volume() * 0.32);
        tickBgm(want);
        if (!want && !a.paused) a.pause();
        if (draft.outro && !draft.on && performance.now() - handoff.at > 9000) { fadeOut(draft.outro, 4000); draft.outro = null; } // music off: still let it go
    }
    setInterval(tickAmbience, 700);
    // zooming onto (or away from) a recalling champion brings its recall up (or down) while it plays
    setInterval(() => { for (const a of live) { const t = a._track; if (!t) continue;
        const g = t.mode === 'near' ? nearGain(t.at.x, t.at.y) : t.mode === 'onscreen' ? (posGain(t.at.x, t.at.y) > 1 ? 1.15 : 0) : posGain(t.at.x, t.at.y);
        const want = Math.max(0, Math.min(1, (t.loud ? volume() : sfxVolume()) * t.vol * g));
        a.volume += (want - a.volume) * 0.5; } }, 200); // eased, so it swells rather than steps
    // Step kinds the viewer names (PanelChrome Cr): 5 Attack, 6 Cast ability, 11 Recall, 12 Submit gems, 13 Shop,
    // 16 Cancel channel, 18 Gems submitted, 21 Teleport channel, 22 Teleport complete
    const STEP_SFX = new Set([1, 2, 4, 5, 6, 11, 13, 16, 18, 21, 22]); // 1 respawn, 2 camp capture, 4 move (only to see recalls broken), 22 teleport arrives
    const RECALL_ROUNDS = 5, RECALL_SFX_SEC = 8;
    let roundsPerSec = 4, rpsAt = 0, rpsRound = null; // playback rate estimate (rounds per second)
    function playSteps(g, from, to) {
        if (!sfxOn() || muted()) return;
        let i = g.stepIdx ?? 0;
        if (i > 0 && g.steps[i - 1]?.key > from) i = 0;
        while (i < g.steps.length && g.steps[i].key <= from) i++;
        let n = 0;
        const lanes = new Map(); // actor -> order of first appearance in this frame
        for (; i < g.steps.length && g.steps[i].key <= to; i++) {
            const st = g.steps[i];
            soundAt = st.x >= 0 ? { x: st.x, y: st.y } : null;
            // recalls that complete: the arrival sound when their 5 rounds are up
            for (let r = recallsDue.length - 1; r >= 0; r--) if (st.round >= recallsDue[r].round) { const d = recallsDue.splice(r, 1)[0]; recallArrive(d); }
            if (++n > 40) continue; // a big jump: don't replay everything
            if (st.kind === 5 || st.kind === 6) {
                if (st.type == null) continue;
                // a cast followed straight away by the same champion's attack was an attack reset
                let reset = false;
                if (st.kind === 6) for (let j = i + 1; j < g.steps.length && j < i + 6 && g.steps[j].round <= st.round + 1; j++) if (g.steps[j].actor === st.actor) { reset = g.steps[j].kind === 5; break; }
                // different champions acting in the same frame get spread out a little (more at slow speeds),
                // so a fight doesn't land as one wall of sound
                // scattered across most of the time one round takes on screen (bigger spread at slow speeds),
                // each champion in its own slice so they don't stack
                const lane = lanes.get(st.actor) ?? lanes.set(st.actor, lanes.size).get(st.actor);
                const roundMs = Math.min(1200, 1000 / Math.max(0.5, roundsPerSec));
                const spread = viewerSpeed() > 2 ? 0 : roundMs * 0.75;
                const slots = Math.max(1, lanes.size);
                const delay = spread ? ((lane + Math.random()) / Math.max(slots, 3)) * spread : 0;
                const at = soundAt, args = [st.type, st.kind, { vc: st.vc, reset: reset || st.atype === 1, slot: st.slot, atype: st.atype }];
                if (delay < 5) champSfx(...args);
                else setTimeout(() => { const prev = soundAt; soundAt = at; champSfx(...args); soundAt = prev; }, delay);
            }
            else if (st.kind === 11) {
                // a real recall: not cancelled within its 5-round channel (some bots start and cancel one every round)
                let cancelled = false;
                // cancelled = the champion cancels, moves, attacks or casts before the channel is done
                for (let j = i + 1; j < g.steps.length && g.steps[j].round < st.round + RECALL_ROUNDS; j++) {
                    const o = g.steps[j];
                    if (o.actor === st.actor && (o.kind === 16 || o.kind === 4 || o.kind === 5 || o.kind === 6 || o.kind === 11)) { cancelled = true; break; }
                }
                if (!cancelled && g.index.some(ev => ev.round >= st.round && ev.round < st.round + RECALL_ROUNDS && ev.kills.some(k => k.victim.idx === st.actor || (k.victim.duo && isDuo(st.type) && k.victim.team === g.roster?.find(c => c.idx === st.actor)?.team)))) cancelled = true; // killed mid-channel
                // stretch the ~8 s League recall over the 5 rounds it takes at the current playback speed
                if (!cancelled) { sfx('recall', { vol: 0.8, near: true, rate: RECALL_SFX_SEC / (RECALL_ROUNDS / Math.max(0.5, roundsPerSec)), tag: 'recall' + st.actor }); recallsDue.push({ round: st.round + RECALL_ROUNDS, at: soundAt, actor: st.actor, loud: nearGain(soundAt?.x, soundAt?.y) > 0.5 }); }
            }
            else if (st.kind === 16) stopSfx('recall' + st.actor);
            else if (st.kind === 18) { if (!sfx('goldBig', { vol: 0.9 })) coin(1); }
            else if (st.kind === 2) { if (!sfx('gold', { vol: 0.35 })) coin(0.35); } // camp taken: the minion-gold clink
            else if (st.kind === 13) { if (!sfx('buy', { vol: 0.6 })) coin(0.6); }
            else if (st.kind === 21) { // channel starts: the channel hum where they stand, an "on my way" ping where they're going
                sfx('teleport', { vol: 0.8, rate: viewerSpeed(), onscreen: true });
                const tp = game?.cam?.tps?.find(t => t.actor === st.actor && t.r1 === st.round);
                if (tp) { const at = soundAt; soundAt = null; sfx('omw', { vol: 0.75 }); soundAt = at; } // the "on my way" ping always plays as if on screen: it's the context for what's coming
            }
            else if (st.kind === 22) sfx('teleportEnd', { vol: 0.9, onscreen: true });
            else if (st.kind === 1 && st.type != null) sfx('c' + st.type + 'respawn', { vol: 0.85 }); // the champion's respawn line
        }
        g.stepIdx = i;
        soundAt = null;
    }
    const recallsDue = [];
    // the arrival sound plays at base: full when the base is on screen up close; if the recall itself was being watched
    // up close but the base isn't in view, a softer version (still louder than an unwatched one)
    function recallArrive(d) {
        const cam = game?.cam, i = cam ? cam.order.indexOf(d.actor) : -1, a = i >= 0 ? trackAt(cam, d.round + 1) : null;
        const base = a ? { x: a[i * 3], y: a[i * 3 + 1] } : d.at;
        const g = nearGain(base?.x, base?.y);
        sfx('recallEnd', { vol: 0.8 * Math.max(g, d.loud ? 0.42 : 0) || 0.8 * 0.04 });
    }
    function lastPos(g, idx, key) { // where a champion last acted before `key`
        for (let j = Math.min(g.steps.length, g.stepIdx ?? g.steps.length) - 1, n = 0; j >= 0 && n < 400; j--, n++) {
            const st = g.steps[j]; if (st.key > key) continue;
            if (st.actor === idx && st.x >= 0) return { x: st.x, y: st.y };
        }
        return null;
    }

    function unlockAudio() { const a = clip('052'); const v = a.volume; a.volume = 0; a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = v; }).catch(() => { a.volume = v; }); }
    document.addEventListener('pointerdown', function once() { unlockAudio(); document.removeEventListener('pointerdown', once, true); }, true);

    const feed = {
        clear() { ui.list?.replaceChildren(); },
        title() {
            if (!ui.root || !game) return;
            const ally = allyTeam();
            const name = game.names?.[ally];
            ui.head.textContent = name ? `allies: ${name}` : '';
            ui.root.querySelector('.side').textContent = `us: ${ally === 0 ? 'left' : 'right'}${override() !== null ? '*' : ''}`;
        },
        add(el, ms = 7000) {
            if (!ui.list) return;
            ui.list.append(el);
            while (ui.list.children.length > 6) ui.list.firstChild.remove();
            setTimeout(() => el.classList.add('old'), ms);
            setTimeout(() => el.remove(), ms + 700);
        },
        push(k, r, round) {
            const el = document.createElement('div');
            el.className = 'it';
            const span = (txt, team, tag = 'b') => { const s = document.createElement(tag); s.textContent = txt; if (team != null) s.style.color = COLORS[team]; return s; };
            const icon = c => { const css = art.icon(c.type); if (!css) return null; const d = document.createElement('span'); d.className = 'ic'; d.style.cssText = css; d.style.setProperty('--c', COLORS[c.team]); return d; };
            const label = { shutdown: 'SHUTDOWN', killingSpree: 'KILLING SPREE', rampage: 'RAMPAGE', unstoppable: 'UNSTOPPABLE', dominating: 'DOMINATING', godlike: 'GODLIKE', legendary: 'LEGENDARY', firstBlood: 'FIRST BLOOD', double: 'DOUBLE KILL', triple: 'TRIPLE KILL', quadra: 'QUADRA KILL', penta: 'PENTAKILL', hexa: 'HEXAKILL', executed: 'EXECUTED' }[r.line.replace(/^enemy(.)/, (_, c) => c.toLowerCase())];
            if (label) { el.append(span(label, null, 'span')); el.lastChild.classList.add('tag'); }
            const parts = k.killer ? [icon(k.killer), span(k.killer.name, k.killer.team)] : [span('camp', null, 'i')];
            if (k.assist) parts.push(span('via camp', null, 'i'));
            el.append(...parts.filter(Boolean), span('⚔', null, 'i'), ...[icon(k.victim), span(k.victim.name, k.victim.team)].filter(Boolean), span('r' + round, null, 'span'));
            el.lastChild.className = 'rd';
            this.add(el);
        },
        note(text, team) {
            const el = document.createElement('div');
            el.className = 'ban';
            el.textContent = text;
            el.style.color = COLORS[team];
            this.add(el, 5000);
        },
    };

    // debugging / tests
    window.__cbcAnnouncer = { get game() { return game; }, invDbg: () => ({ icons: !!itemIcons, hist: game?.cam?.invHist ? [...game.cam.invHist.keys()] : null, buys: game?.cam?.buys?.length, labels: [...document.querySelectorAll("[aria-label]")].map(e => e.getAttribute("aria-label")).filter(l => /Team [AB]$|^Follow /.test(l)).slice(0, 12), atlas: performance.getEntriesByType("resource").map(e => e.name).filter(u => /items-atlas/.test(u)) }), backend: () => findBackend(), bridgeReq: () => [...bridge.started.keys()], bridgeOk: () => [...bridge.url.keys()], localReady, cine, planShots, planDual, ending, dualcam, dualDir, draftDbg: () => ({ phase, playing: isPlaying(), on: draft.on, shown: game?.draftShown, seen: [...seenLocks], q: lockQ.length }), log, sfx, visibleTiles, posGain, LINES, decode, diff, audio: () => Object.fromEntries([...audioCache].map(([k, a]) => [k, a.dataset.state])), applyKill, pickTake, art, banner, say };
})();

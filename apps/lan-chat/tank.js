// 坦克大战联机游戏

function startTankBattle(opponentId, isHost) {
    const peer = peers.get(opponentId);
    const peerName = peer ? peer.name : '对方';

    // ═══════════════════════════════════════════════════════
    //  常量
    // ═══════════════════════════════════════════════════════
    const CELL = 32, COLS = 20, ROWS = 16;
    const CW = COLS * CELL, CH = ROWS * CELL; // 640 × 512
    const EMPTY = 0, BRICK = 1, STEEL = 2, WATER = 3, BUSH = 4;
    const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
    const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
    const TANK_SPEED = 88;   // px/s
    const BULLET_SPEED = 240; // px/s
    const SHOOT_CD = 480;    // ms
    const TANK_R = CELL * 0.40; // collision radius

    // ═══════════════════════════════════════════════════════
    //  地图定义  (20列 × 16行)
    //  ' '=空地  'B'=砖墙  'S'=钢墙  'W'=水  'T'=丛林
    // ═══════════════════════════════════════════════════════
    const MAP_DEFS = [
        {
            name: '经典战场',
            rows: [
                'SSSSSSSSSSSSSSSSSSSS',
                'S    B    SS    B   S',
                'S BB   B      B  BB S',
                'S   BB    BB    BB  S',
                'S B    SS    SS   B S',
                'S  B B    BB    B B S',
                'S    B  B    B  B   S',
                'SS     B  SS  B    SS',
                'S    B  B    B  B   S',
                'S  B B    BB    B B S',
                'S B    SS    SS   B S',
                'S   BB    BB    BB  S',
                'S BB   B      B  BB S',
                'S    B    SS    B   S',
                'S   B          B    S',
                'SSSSSSSSSSSSSSSSSSSS',
            ]
        },
        {
            name: '河流交汇',
            rows: [
                'SSSSSSSSSSSSSSSSSSSS',
                'S  B    B    B    B S',
                'S  B WWWWWWWWWW B  S',
                'S    W  B    B  W  S',
                'S BB W          W  S',
                'S    W  B    B  W  S',
                'S    WWWW    WWWW  S',
                'S  B      BB      BS',
                'S    WWWW    WWWW  S',
                'S    W  B    B  W  S',
                'S BB W          W  S',
                'S    W  B    B  W  S',
                'S  B WWWWWWWWWW B  S',
                'S  B    B    B    B S',
                'S  B  B         B  S',
                'SSSSSSSSSSSSSSSSSSSS',
            ]
        },
        {
            name: '丛林迷宫',
            rows: [
                'SSSSSSSSSSSSSSSSSSSS',
                'S TTTTT B   B TTTTT S',
                'S T   T  B B  T   T S',
                'S T B T       T B T S',
                'S TTTTT  B B  TTTTT S',
                'S   B  BB   BB  B   S',
                'S B   B        B  B S',
                'S  BB    SSSS    BB S',
                'S B   B        B  B S',
                'S   B  BB   BB  B   S',
                'S TTTTT  B B  TTTTT S',
                'S T B T       T B T S',
                'S T   T  B B  T   T S',
                'S TTTTT B   B TTTTT S',
                'S    B          B   S',
                'SSSSSSSSSSSSSSSSSSSS',
            ]
        },
        {
            name: '要塞攻防',
            rows: [
                'SSSSSSSSSSSSSSSSSSSS',
                'S B  B  SSSS  B  B  S',
                'S    B  S  S  B     S',
                'S BB    S  S    BB  S',
                'S       SSSS        S',
                'SSSSS B          SSSS',
                'S       B    B      S',
                'S  B B    SS    B B S',
                'S       B    B      S',
                'SSSSS B          SSSS',
                'S       SSSS        S',
                'S BB    S  S    BB  S',
                'S    B  S  S  B     S',
                'S B  B  SSSS  B  B  S',
                'S   B           B   S',
                'SSSSSSSSSSSSSSSSSSSS',
            ]
        },
        {
            name: '开阔地带',
            rows: [
                'SSSSSSSSSSSSSSSSSSSS',
                'S                   S',
                'S  B             B  S',
                'S     B       B     S',
                'S        SSS        S',
                'S  B              B S',
                'S       B    B      S',
                'S   B         B   B S',
                'S       B    B      S',
                'S  B              B S',
                'S        SSS        S',
                'S     B       B     S',
                'S  B             B  S',
                'S                   S',
                'S  B B         B B  S',
                'SSSSSSSSSSSSSSSSSSSS',
            ]
        },
        {
            name: '岛屿争夺',
            rows: [
                'SSSSSSSSSSSSSSSSSSSS',
                'S  B WWWWWWWWWWW B  S',
                'S B  W  B   B  W  B S',
                'S    W BB   BB W    S',
                'SWWWWW           WWWS',
                'S  B   B  SSS  B    S',
                'S      B  S S  B    S',
                'S  BB     SSS    BB S',
                'S      B  S S  B    S',
                'S  B   B  SSS  B    S',
                'SWWWWW           WWWS',
                'S    W BB   BB W    S',
                'S B  W  B   B  W  B S',
                'S  B WWWWWWWWWWW B  S',
                'S   B           B   S',
                'SSSSSSSSSSSSSSSSSSSS',
            ]
        },
    ];

    function parseMap(rows) {
        return rows.map(row => {
            const s = row.padEnd(COLS, ' ');
            return Array.from(s).map(c => ({ B: BRICK, S: STEEL, W: WATER, T: BUSH }[c] ?? EMPTY));
        });
    }

    // ═══════════════════════════════════════════════════════
    //  游戏状态
    // ═══════════════════════════════════════════════════════
    let mapGrid = null;
    let gameMode = 'pvp';
    let selMap = 0;
    let phase = 'lobby';  // lobby | playing | over
    let myReady = false, oppReady = false;

    const myTank = { x: 0, y: 0, dir: UP, lives: 3, shootCd: 0, dead: false, respawnTimer: 0 };
    const oppTank = { x: 0, y: 0, dir: DOWN, lives: 3, dead: false };

    // AI 坦克（合作模式，host 运算）
    const aiTanks = [];
    let aiIdSeq = 0;
    let coopWave = 0;
    let aiLeft = 0;
    const AI_TYPES = [
        { color: '#9a9', speed: 60,  hp: 1, cd: 2200 },
        { color: '#c66', speed: 95,  hp: 1, cd: 1600 },
        { color: '#66c', speed: 70,  hp: 2, cd: 1400 },
        { color: '#c93', speed: 110, hp: 1, cd: 2800 },
    ];

    const bullets = [];   // {id,x,y,dx,dy,owner:'my'|'opp'|'ai',aiId?}
    const explosions = []; // {x,y,r,maxR,age,maxAge}
    let bulletSeq = 0;

    const keys = {};
    let animId = null, lastTs = 0, frameN = 0;
    let pvpScore = { my: 0, opp: 0 };

    // ═══════════════════════════════════════════════════════
    //  构建 UI
    // ═══════════════════════════════════════════════════════
    const modal = document.createElement('div');
    modal.className = 'tank-modal';
    modal.innerHTML = `
        <div class="tank-content">
            <div class="tank-header">
                <span class="tank-title">🎮 坦克大战</span>
                <span class="tank-vs">vs ${peerName}</span>
                <button class="tank-close-btn">×</button>
            </div>

            <!-- 大厅 -->
            <div id="tankLobby" class="tank-lobby">
                <div class="tank-mode-row">
                    <button class="tank-mode-btn active" data-mode="pvp">⚔️ 对战模式</button>
                    <button class="tank-mode-btn" data-mode="coop">🤝 合作模式</button>
                </div>
                <div class="tank-map-area">
                    <button class="tank-nav-btn" id="tankPrev">‹</button>
                    <div class="tank-map-box">
                        <canvas id="tankPreview" width="200" height="160"></canvas>
                        <div class="tank-map-name" id="tankMapName"></div>
                        <div class="tank-map-index" id="tankMapIndex"></div>
                    </div>
                    <button class="tank-nav-btn" id="tankNext">›</button>
                </div>
                <div class="tank-map-dots" id="tankDots"></div>
                <div class="tank-keys-hint">WASD / 方向键 移动 &nbsp;·&nbsp; 空格 / J 射击 &nbsp;·&nbsp; R 重开</div>
                <div class="tank-ready-area">
                    <div class="tank-ready-status" id="tankReadyStatus">
                        <span id="rstMe">⬜ ${myName}</span>
                        &nbsp;&nbsp;
                        <span id="rstOpp">⬜ ${peerName}</span>
                    </div>
                    <button class="tank-ready-btn" id="tankReadyBtn">✓ 准备</button>
                </div>
            </div>

            <!-- 游戏区 -->
            <div id="tankGame" style="display:none">
                <div class="tank-hud">
                    <div class="tank-hud-left">
                        <span class="tank-hud-name">${myName}</span>
                        <span class="tank-hud-lives" id="hudMyLives">♥♥♥</span>
                    </div>
                    <div class="tank-hud-mid" id="hudMid"></div>
                    <div class="tank-hud-right">
                        <span class="tank-hud-lives" id="hudOppLives">♥♥♥</span>
                        <span class="tank-hud-name">${peerName}</span>
                    </div>
                </div>
                <canvas id="tankCanvas" width="${CW}" height="${CH}" tabindex="0"></canvas>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('show'), 10);

    // ═══════════════════════════════════════════════════════
    //  大厅逻辑
    // ═══════════════════════════════════════════════════════
    buildDots();
    renderPreview();

    modal.querySelectorAll('.tank-mode-btn').forEach(btn => btn.addEventListener('click', () => {
        modal.querySelectorAll('.tank-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        gameMode = btn.dataset.mode;
    }));
    modal.querySelector('#tankPrev').addEventListener('click', () => { selMap = (selMap - 1 + MAP_DEFS.length) % MAP_DEFS.length; renderPreview(); updateDots(); });
    modal.querySelector('#tankNext').addEventListener('click', () => { selMap = (selMap + 1) % MAP_DEFS.length; renderPreview(); updateDots(); });

    function buildDots() {
        const el = modal.querySelector('#tankDots');
        el.innerHTML = MAP_DEFS.map((_, i) => `<span class="tank-dot${i === 0 ? ' active' : ''}" data-i="${i}"></span>`).join('');
        el.querySelectorAll('.tank-dot').forEach(d => d.addEventListener('click', () => { selMap = +d.dataset.i; renderPreview(); updateDots(); }));
    }
    function updateDots() {
        modal.querySelectorAll('.tank-dot').forEach(d => d.classList.toggle('active', +d.dataset.i === selMap));
    }
    function renderPreview() {
        const cv = modal.querySelector('#tankPreview');
        const pc = cv.getContext('2d');
        const grid = parseMap(MAP_DEFS[selMap].rows);
        const pw = cv.width / COLS, ph = cv.height / ROWS;
        pc.fillStyle = '#b8a050'; pc.fillRect(0, 0, cv.width, cv.height);
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            const t = grid[r][c];
            if (!t) continue;
            pc.fillStyle = [,'#b53','#445','#36b','#283'][t];
            pc.fillRect(c * pw + 0.5, r * ph + 0.5, pw - 1, ph - 1);
        }
        // Draw spawn markers
        pc.fillStyle = '#4f8'; pc.fillRect(pw, ph * (ROWS - 2), pw * 1.5, ph * 1.5);
        pc.fillStyle = '#f84'; pc.fillRect(pw * (COLS - 2.5), ph, pw * 1.5, ph * 1.5);
        modal.querySelector('#tankMapName').textContent = MAP_DEFS[selMap].name;
        modal.querySelector('#tankMapIndex').textContent = `${selMap + 1} / ${MAP_DEFS.length}`;
    }

    modal.querySelector('#tankReadyBtn').addEventListener('click', () => {
        if (myReady) return;
        myReady = true;
        modal.querySelector('#tankReadyBtn').textContent = '等待对方...';
        modal.querySelector('#tankReadyBtn').disabled = true;
        modal.querySelector('#rstMe').textContent = `✅ ${myName}`;
        sendTk({ type: 'ready', mapIdx: selMap, mode: gameMode });
        if (oppReady && isHost) launchGame(selMap, gameMode);
    });

    // ═══════════════════════════════════════════════════════
    //  游戏初始化
    // ═══════════════════════════════════════════════════════
    function launchGame(mapIdx, mode) {
        phase = 'playing';
        gameMode = mode;
        mapGrid = parseMap(MAP_DEFS[mapIdx].rows);
        modal.querySelector('#tankLobby').style.display = 'none';
        modal.querySelector('#tankGame').style.display = '';

        const spawnH = { x: CELL * 1.5, y: CELL * 14.5, dir: UP };
        const spawnG = { x: CELL * 18.5, y: CELL * 1.5, dir: DOWN };
        const mySpawn = isHost ? spawnH : spawnG;
        const oppSpawn = isHost ? spawnG : spawnH;

        Object.assign(myTank, mySpawn, { lives: 3, dead: false, shootCd: 0, respawnTimer: 0 });
        Object.assign(oppTank, oppSpawn, { lives: 3, dead: false });
        bullets.length = 0;
        explosions.length = 0;
        aiTanks.length = 0;
        pvpScore = { my: 0, opp: 0 };
        coopWave = 0; aiLeft = 0;

        if (mode === 'coop' && isHost) spawnWave(1);
        updateHUD();

        const cv = modal.querySelector('#tankCanvas');
        cv.focus();
        lastTs = performance.now();
        animId = requestAnimationFrame(loop);
    }

    // ═══════════════════════════════════════════════════════
    //  合作模式 AI
    // ═══════════════════════════════════════════════════════
    function spawnWave(wave) {
        coopWave = wave;
        aiTanks.length = 0;
        const count = Math.min(2 + wave, 6);
        const spawns = [
            { x: CELL * 10.5, y: CELL * 1.5 },
            { x: CELL * 4.5,  y: CELL * 1.5 },
            { x: CELL * 16.5, y: CELL * 1.5 },
            { x: CELL * 1.5,  y: CELL * 1.5 },
            { x: CELL * 18.5, y: CELL * 1.5 },
            { x: CELL * 7.5,  y: CELL * 1.5 },
        ];
        for (let i = 0; i < count; i++) {
            const type = AI_TYPES[(wave - 1 + i) % AI_TYPES.length];
            const sp = spawns[i % spawns.length];
            aiTanks.push({
                id: aiIdSeq++, x: sp.x, y: sp.y, dir: DOWN,
                hp: type.hp, speed: type.speed, cd: type.cd,
                shootTimer: type.cd * Math.random(), moveTimer: 0, type
            });
        }
        aiLeft = count;
        sendTk({ type: 'wave', wave, tanks: aiTanks.map(a => ({ id: a.id, x: a.x, y: a.y, dir: a.dir, hp: a.hp, typeIdx: AI_TYPES.indexOf(a.type) })) });
        updateHUD();
    }

    function updateAI(dt) {
        if (!isHost || gameMode !== 'coop') return;
        const living = aiTanks.filter(a => a.hp > 0);
        living.forEach(ai => {
            // Move toward nearest player
            ai.moveTimer -= dt;
            if (ai.moveTimer <= 0) {
                ai.moveTimer = 0.4 + Math.random() * 1.2;
                const targets = [];
                if (!myTank.dead) targets.push(myTank);
                if (!oppTank.dead) targets.push(oppTank);
                if (targets.length) {
                    const tgt = targets[Math.floor(Math.random() * targets.length)];
                    const dx = tgt.x - ai.x, dy = tgt.y - ai.y;
                    if (Math.random() < 0.72) {
                        ai.dir = (Math.abs(dx) > Math.abs(dy)) ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP);
                    } else {
                        ai.dir = Math.floor(Math.random() * 4);
                    }
                }
            }
            const nx = ai.x + DX[ai.dir] * ai.speed * dt;
            const ny = ai.y + DY[ai.dir] * ai.speed * dt;
            if (!wallCollides(nx, ny)) { ai.x = nx; ai.y = ny; }
            else { ai.moveTimer = 0; }

            // Shoot
            ai.shootTimer -= dt * 1000;
            if (ai.shootTimer <= 0) {
                ai.shootTimer = ai.cd + Math.random() * 800;
                spawnBullet(ai.x, ai.y, ai.dir, 'ai', ai.id);
                sendTk({ type: 'ai_fire', aid: ai.id, x: ai.x, y: ai.y, dir: ai.dir });
            }
        });
        // Sync AI positions every 3 frames
        if (frameN % 3 === 0) {
            sendTk({ type: 'ai_pos', tanks: living.map(a => ({ id: a.id, x: a.x, y: a.y, dir: a.dir })) });
        }
    }

    // ═══════════════════════════════════════════════════════
    //  物理 & 碰撞
    // ═══════════════════════════════════════════════════════
    function wallCollides(cx, cy) {
        const r = TANK_R - 2;
        for (const [ox, oy] of [[-r,-r],[r,-r],[-r,r],[r,r]]) {
            const tc = Math.floor((cx + ox) / CELL), tr = Math.floor((cy + oy) / CELL);
            if (tc < 0 || tc >= COLS || tr < 0 || tr >= ROWS) return true;
            const t = mapGrid[tr][tc];
            if (t === BRICK || t === STEEL || t === WATER) return true;
        }
        return false;
    }

    function spawnBullet(x, y, dir, owner, aiId) {
        bullets.push({ id: bulletSeq++, x, y, dx: DX[dir] * BULLET_SPEED, dy: DY[dir] * BULLET_SPEED, owner, aiId });
    }

    function updateMyTank(dt) {
        if (myTank.dead) {
            if (myTank.respawnTimer > 0) {
                myTank.respawnTimer -= dt;
                if (myTank.respawnTimer <= 0) respawnMe();
            }
            return;
        }
        const u = keys['ArrowUp']    || keys['w'] || keys['W'];
        const d = keys['ArrowDown']  || keys['s'] || keys['S'];
        const l = keys['ArrowLeft']  || keys['a'] || keys['A'];
        const r = keys['ArrowRight'] || keys['d'] || keys['D'];
        const shoot = keys[' '] || keys['j'] || keys['J'];

        let moved = false;
        if (u) { myTank.dir = UP;    const ny = myTank.y - TANK_SPEED * dt; if (!wallCollides(myTank.x, ny)) { myTank.y = ny; moved = true; } }
        else if (d) { myTank.dir = DOWN;  const ny = myTank.y + TANK_SPEED * dt; if (!wallCollides(myTank.x, ny)) { myTank.y = ny; moved = true; } }
        else if (l) { myTank.dir = LEFT;  const nx = myTank.x - TANK_SPEED * dt; if (!wallCollides(nx, myTank.y)) { myTank.x = nx; moved = true; } }
        else if (r) { myTank.dir = RIGHT; const nx = myTank.x + TANK_SPEED * dt; if (!wallCollides(nx, myTank.y)) { myTank.x = nx; moved = true; } }

        myTank.shootCd -= dt * 1000;
        if (shoot && myTank.shootCd <= 0) {
            myTank.shootCd = SHOOT_CD;
            spawnBullet(myTank.x, myTank.y, myTank.dir, 'my');
            sendTk({ type: 'bullet', x: myTank.x, y: myTank.y, dir: myTank.dir });
        }
        // Send position every 2 frames
        if (frameN % 2 === 0) {
            sendTk({ type: 'pos', x: myTank.x, y: myTank.y, dir: myTank.dir });
        }
    }

    function updateBullets(dt) {
        for (let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            b.x += b.dx * dt; b.y += b.dy * dt;

            // Out of bounds
            if (b.x < 0 || b.x >= CW || b.y < 0 || b.y >= CH) { bullets.splice(i, 1); continue; }

            // Wall collision
            const tc = Math.floor(b.x / CELL), tr = Math.floor(b.y / CELL);
            if (tc >= 0 && tc < COLS && tr >= 0 && tr < ROWS) {
                const tile = mapGrid[tr][tc];
                if (tile === BRICK) {
                    addExplosion(b.x, b.y, false);
                    mapGrid[tr][tc] = EMPTY;
                    // Owner sends wall sync
                    if (b.owner === 'my') sendTk({ type: 'wall', r: tr, c: tc });
                    bullets.splice(i, 1); continue;
                }
                if (tile === STEEL) {
                    addExplosion(b.x, b.y, false);
                    bullets.splice(i, 1); continue;
                }
                if (tile === WATER) { bullets.splice(i, 1); continue; }
            }

            // Hit my tank (from opp or AI bullets)
            if ((b.owner === 'opp' || b.owner === 'ai') && !myTank.dead) {
                if (dist2(b.x, b.y, myTank.x, myTank.y) < (TANK_R * 1.1) ** 2) {
                    addExplosion(b.x, b.y, false);
                    bullets.splice(i, 1);
                    myTankHit();
                    continue;
                }
            }

            // Hit opp tank (from my or AI bullets — opp handles their own, we just remove bullet near them)
            if (b.owner === 'my' && !oppTank.dead) {
                if (dist2(b.x, b.y, oppTank.x, oppTank.y) < (TANK_R * 1.2) ** 2) {
                    addExplosion(b.x, b.y, false);
                    bullets.splice(i, 1); continue;
                }
            }

            // AI tank hit (player bullets vs AI)
            if ((b.owner === 'my' || b.owner === 'opp') && isHost) {
                let hit = false;
                for (const ai of aiTanks) {
                    if (ai.hp <= 0) continue;
                    if (dist2(b.x, b.y, ai.x, ai.y) < (TANK_R * 1.1) ** 2) {
                        addExplosion(b.x, b.y, false);
                        ai.hp--;
                        if (ai.hp <= 0) {
                            addExplosion(ai.x, ai.y, true);
                            aiLeft = Math.max(0, aiLeft - 1);
                            const killer = b.owner;
                            if (killer === 'my') pvpScore.my++; else pvpScore.opp++;
                            sendTk({ type: 'ai_dead', aid: ai.id, killer });
                            updateHUD();
                        }
                        hit = true; break;
                    }
                }
                if (hit) { bullets.splice(i, 1); continue; }
            }
        }
    }

    function myTankHit() {
        myTank.lives--;
        addExplosion(myTank.x, myTank.y, true);
        myTank.dead = true;
        sendTk({ type: 'hit_report', lives: myTank.lives });
        updateHUD();
        if (myTank.lives > 0) {
            myTank.respawnTimer = 2.5;
        } else {
            if (gameMode === 'pvp') {
                pvpScore.opp++;
                checkPvpOver();
            } else {
                checkCoopOver();
            }
        }
    }

    function respawnMe() {
        myTank.dead = false;
        myTank.x = isHost ? CELL * 1.5 : CELL * 18.5;
        myTank.y = isHost ? CELL * 14.5 : CELL * 1.5;
        myTank.shootCd = 0;
    }

    // ═══════════════════════════════════════════════════════
    //  胜负判断
    // ═══════════════════════════════════════════════════════
    function checkPvpOver() {
        if (myTank.lives <= 0 && oppTank.lives <= 0) { triggerGameOver('draw'); return; }
        if (myTank.lives <= 0) triggerGameOver('lose');
        else if (oppTank.lives <= 0) triggerGameOver('win');
    }
    function checkCoopOver() {
        if (myTank.lives <= 0 && oppTank.lives <= 0) triggerGameOver('cooplose');
    }
    function checkCoopWin() {
        if (gameMode !== 'coop' || !isHost) return;
        if (aiLeft <= 0 && aiTanks.every(a => a.hp <= 0)) {
            if (coopWave < 3) {
                setTimeout(() => { if (phase === 'playing') spawnWave(coopWave + 1); }, 2200);
            } else {
                triggerGameOver('coopwin');
            }
        }
    }

    function triggerGameOver(result) {
        if (phase !== 'playing') return;
        phase = 'over';
        cancelAnimationFrame(animId);
        renderGameOver(result);
        sendTk({ type: 'over', result });
    }

    function renderGameOver(result) {
        const cv = modal.querySelector('#tankCanvas');
        if (!cv) return;
        const ctx = cv.getContext('2d');
        render(ctx); // draw last frame
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, CW, CH);
        const msgs = { win: '🎉 你赢了！', lose: '😢 你输了！', draw: '🤝 平局！', coopwin: '🎉 合作胜利！', cooplose: '😢 全军覆没！' };
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 40px sans-serif'; ctx.fillStyle = '#fff';
        ctx.fillText(msgs[result] || '游戏结束', CW / 2, CH / 2 - 25);
        ctx.font = '18px sans-serif'; ctx.fillStyle = '#ccc';
        if (gameMode === 'pvp') ctx.fillText(`${myName} ${pvpScore.my} : ${pvpScore.opp} ${peerName}`, CW / 2, CH / 2 + 20);
        ctx.font = '15px sans-serif'; ctx.fillStyle = '#aaa';
        ctx.fillText('按 R 重新开始', CW / 2, CH / 2 + 55);
    }

    // ═══════════════════════════════════════════════════════
    //  渲染
    // ═══════════════════════════════════════════════════════
    const PALETTE = {
        ground: '#c0a84a',
        brick:  '#c04428', brickHi: '#e05533', brickSh: '#882211',
        steel:  '#445566', steelHi: '#667788',
        water1: '#2255cc', water2: '#3366ee',
        bush:   '#1a5c1a', bushHi: '#2a7a2a',
    };

    function drawTile(ctx, c, r, tile) {
        const x = c * CELL, y = r * CELL;
        if (tile === BRICK) {
            ctx.fillStyle = PALETTE.brick;
            ctx.fillRect(x, y, CELL, CELL);
            // Brick pattern
            ctx.fillStyle = PALETTE.brickHi;
            const bw = CELL / 2 - 1, bh = CELL / 4 - 1;
            ctx.fillRect(x + 1, y + 1, bw, bh);
            ctx.fillRect(x + bw + 2, y + bh + 2, bw, bh);
            ctx.fillRect(x + 1, y + bh * 2 + 3, bw, bh);
            ctx.fillRect(x + bw + 2, y + 1, bw, bh);
            ctx.fillStyle = PALETTE.brickSh;
            ctx.fillRect(x, y + CELL - 2, CELL, 2);
            ctx.fillRect(x + CELL - 2, y, 2, CELL);
        } else if (tile === STEEL) {
            ctx.fillStyle = PALETTE.steel;
            ctx.fillRect(x, y, CELL, CELL);
            ctx.fillStyle = PALETTE.steelHi;
            ctx.fillRect(x + 2, y + 2, CELL / 2 - 3, CELL / 2 - 3);
            ctx.fillRect(x + CELL / 2 + 1, y + CELL / 2 + 1, CELL / 2 - 3, CELL / 2 - 3);
        } else if (tile === WATER) {
            const phase2 = ((Date.now() / 500) % 1) > 0.5;
            ctx.fillStyle = phase2 ? PALETTE.water1 : PALETTE.water2;
            ctx.fillRect(x, y, CELL, CELL);
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillRect(x + 3, y + CELL / 2 - 2, CELL - 6, 3);
        } else if (tile === BUSH) {
            ctx.fillStyle = PALETTE.ground; ctx.fillRect(x, y, CELL, CELL);
            ctx.fillStyle = PALETTE.bush; ctx.fillRect(x, y, CELL, CELL);
            ctx.fillStyle = PALETTE.bushHi;
            ctx.fillRect(x + 3, y + 3, 5, 5);
            ctx.fillRect(x + CELL - 9, y + CELL - 9, 5, 5);
            ctx.fillRect(x + CELL / 2 - 3, y + CELL / 2 - 3, 6, 6);
        }
    }

    function drawTank(ctx, tx, ty, dir, color, accent, shield) {
        const r = CELL * 0.38;
        ctx.save(); ctx.translate(tx, ty); ctx.rotate(dir * Math.PI / 2);
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(-r + 2, -r + 2, r * 2, r * 2);
        // Treads
        ctx.fillStyle = '#222';
        ctx.fillRect(-r, -r, r * 0.28, r * 2);
        ctx.fillRect(r * 0.72, -r, r * 0.28, r * 2);
        // Tread marks
        ctx.fillStyle = '#444';
        for (let i = 0; i < 4; i++) {
            ctx.fillRect(-r + 1, -r + i * (r * 0.5), r * 0.22, r * 0.3);
            ctx.fillRect(r * 0.78, -r + i * (r * 0.5), r * 0.22, r * 0.3);
        }
        // Body
        ctx.fillStyle = color;
        ctx.fillRect(-r * 0.72, -r, r * 1.44, r * 2);
        // Body highlight
        ctx.fillStyle = accent;
        ctx.fillRect(-r * 0.55, -r + 2, r * 0.5, r * 0.8);
        // Turret base
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.46, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
        // Barrel
        ctx.fillStyle = '#333';
        ctx.fillRect(-4, -r * 0.1, 8, -r * 1.15);
        ctx.fillStyle = '#555';
        ctx.fillRect(-2, -r * 0.1, 4, -r * 1.15);
        // Shield effect
        if (shield) {
            ctx.strokeStyle = 'rgba(100,200,255,0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
    }

    function drawExplosionFx(ctx, e) {
        const p = e.age / e.maxAge;
        ctx.globalAlpha = 1 - p;
        const grd = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r);
        grd.addColorStop(0, '#fff'); grd.addColorStop(0.3, '#ff9900'); grd.addColorStop(1, 'rgba(180,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }

    function render(ctx) {
        ctx.fillStyle = PALETTE.ground; ctx.fillRect(0, 0, CW, CH);
        // Ground grid
        ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 0.5;
        for (let i = 0; i <= COLS; i++) { ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, CH); ctx.stroke(); }
        for (let i = 0; i <= ROWS; i++) { ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(CW, i * CELL); ctx.stroke(); }

        // Tiles (non-bush first)
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            const t = mapGrid[r][c];
            if (t !== EMPTY && t !== BUSH) drawTile(ctx, c, r, t);
        }
        // Tanks
        if (!myTank.dead) drawTank(ctx, myTank.x, myTank.y, myTank.dir, '#3a7a3a', '#5aba5a', myTank.respawnTimer > 0);
        if (!oppTank.dead) drawTank(ctx, oppTank.x, oppTank.y, oppTank.dir, '#b85020', '#e87040', false);
        aiTanks.forEach(ai => {
            if (ai.hp > 0) drawTank(ctx, ai.x, ai.y, ai.dir, ai.type.color, '#ccc', false);
        });
        // Bullets
        bullets.forEach(b => {
            ctx.fillStyle = b.owner === 'my' ? '#ffe040' : b.owner === 'opp' ? '#ff5555' : '#ffaa20';
            ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
            ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        });
        // Explosions
        explosions.forEach(e => drawExplosionFx(ctx, e));
        // Bush on top
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            if (mapGrid[r][c] === BUSH) drawTile(ctx, c, r, BUSH);
        }
        // Respawn countdown
        if (myTank.dead && myTank.lives > 0 && myTank.respawnTimer > 0) {
            const sec = Math.ceil(myTank.respawnTimer);
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(CW / 2 - 70, CH / 2 - 28, 140, 52);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(`⟳ ${sec}s 后复活`, CW / 2, CH / 2);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  爆炸特效
    // ═══════════════════════════════════════════════════════
    function addExplosion(x, y, big) {
        explosions.push({ x, y, r: 2, maxR: big ? 32 : 18, age: 0, maxAge: big ? 0.5 : 0.3 });
    }
    function updateExplosions(dt) {
        for (let i = explosions.length - 1; i >= 0; i--) {
            const e = explosions[i];
            e.age += dt; e.r = e.maxR * (e.age / e.maxAge);
            if (e.age >= e.maxAge) explosions.splice(i, 1);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  HUD
    // ═══════════════════════════════════════════════════════
    function updateHUD() {
        const lv = n => '♥'.repeat(Math.max(0, n)) + '♡'.repeat(Math.max(0, 3 - n));
        const ml = modal.querySelector('#hudMyLives'), ol = modal.querySelector('#hudOppLives');
        if (ml) ml.textContent = lv(myTank.lives);
        if (ol) ol.textContent = lv(oppTank.lives);
        const mid = modal.querySelector('#hudMid');
        if (mid) {
            mid.textContent = gameMode === 'coop'
                ? `第 ${coopWave} 波 · 剩 ${aiLeft} 辆`
                : `${pvpScore.my} : ${pvpScore.opp}`;
        }
    }

    // ═══════════════════════════════════════════════════════
    //  工具函数
    // ═══════════════════════════════════════════════════════
    function dist2(x1, y1, x2, y2) { return (x2 - x1) ** 2 + (y2 - y1) ** 2; }

    // ═══════════════════════════════════════════════════════
    //  主循环
    // ═══════════════════════════════════════════════════════
    function loop(ts) {
        const dt = Math.min((ts - lastTs) / 1000, 0.05);
        lastTs = ts; frameN++;
        updateMyTank(dt);
        updateBullets(dt);
        updateAI(dt);
        updateExplosions(dt);
        checkCoopWin();

        const cv = modal.querySelector('#tankCanvas');
        if (cv) render(cv.getContext('2d'));
        animId = requestAnimationFrame(loop);
    }

    // ═══════════════════════════════════════════════════════
    //  P2P 通信
    // ═══════════════════════════════════════════════════════
    function sendTk(msg) {
        sendWsMessage({ type: 'game-move', to: opponentId, gameType: 'tankbattle', move: msg, timestamp: Date.now() });
    }

    window.handleTankBattleMove = function(data) {
        if (!data.move) return;
        const mv = data.move;
        switch (mv.type) {
            case 'ready':
                oppReady = true;
                modal.querySelector('#rstOpp').textContent = `✅ ${peerName}`;
                if (isHost && myReady) launchGame(selMap, gameMode);
                break;
            case 'start':
                launchGame(mv.mapIdx, mv.mode);
                break;
            case 'pos':
                oppTank.x += (mv.x - oppTank.x) * 0.55;
                oppTank.y += (mv.y - oppTank.y) * 0.55;
                oppTank.dir = mv.dir;
                break;
            case 'bullet':
                spawnBullet(mv.x, mv.y, mv.dir, 'opp');
                break;
            case 'hit_report':
                oppTank.lives = mv.lives;
                oppTank.dead = oppTank.lives <= 0;
                updateHUD();
                if (gameMode === 'pvp') {
                    if (oppTank.lives <= 0) { pvpScore.my++; checkPvpOver(); }
                }
                break;
            case 'wall':
                if (mapGrid) mapGrid[mv.r][mv.c] = EMPTY;
                break;
            case 'ai_pos':
                mv.tanks.forEach(t => {
                    const ai = aiTanks.find(a => a.id === t.id);
                    if (ai) { ai.x = t.x; ai.y = t.y; ai.dir = t.dir; }
                });
                break;
            case 'ai_fire':
                spawnBullet(mv.x, mv.y, mv.dir, 'ai', mv.aid);
                break;
            case 'ai_dead':
                const ai = aiTanks.find(a => a.id === mv.aid);
                if (ai && ai.hp > 0) {
                    ai.hp = 0; addExplosion(ai.x, ai.y, true);
                    aiLeft = Math.max(0, aiLeft - 1);
                    if (mv.killer === 'opp') pvpScore.my++; else pvpScore.opp++;
                    updateHUD();
                }
                break;
            case 'wave':
                if (!isHost) {
                    coopWave = mv.wave; aiTanks.length = 0; aiLeft = mv.tanks.length;
                    mv.tanks.forEach(t => aiTanks.push({ ...t, type: AI_TYPES[t.typeIdx] ?? AI_TYPES[0], hp: t.hp, moveTimer: 0, shootTimer: 0 }));
                    updateHUD();
                }
                break;
            case 'over':
                const rmap = { win: 'lose', lose: 'win', draw: 'draw', coopwin: 'coopwin', cooplose: 'cooplose' };
                triggerGameOver(rmap[mv.result] ?? mv.result);
                break;
        }
    };

    // ═══════════════════════════════════════════════════════
    //  键盘
    // ═══════════════════════════════════════════════════════
    function onKeyDown(e) {
        keys[e.key] = true;
        if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
        if ((e.key === 'r' || e.key === 'R') && phase === 'over') resetLobby();
    }
    function onKeyUp(e) { delete keys[e.key]; }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    function resetLobby() {
        cancelAnimationFrame(animId);
        phase = 'lobby'; myReady = false; oppReady = false;
        modal.querySelector('#tankGame').style.display = 'none';
        modal.querySelector('#tankLobby').style.display = '';
        modal.querySelector('#tankReadyBtn').disabled = false;
        modal.querySelector('#tankReadyBtn').textContent = '✓ 准备';
        modal.querySelector('#rstMe').textContent = `⬜ ${myName}`;
        modal.querySelector('#rstOpp').textContent = `⬜ ${peerName}`;
    }

    // ═══════════════════════════════════════════════════════
    //  关闭
    // ═══════════════════════════════════════════════════════
    modal.querySelector('.tank-close-btn').addEventListener('click', cleanup);
    function cleanup() {
        cancelAnimationFrame(animId);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
        currentGame = null;
    }
}

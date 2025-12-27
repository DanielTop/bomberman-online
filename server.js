const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Game constants
const TILE = 48;
const COLS = 15;
const ROWS = 13;
const BOMB_TIMER = 3000;
const EXPLOSION_DURATION = 500;

// Cell types
const EMPTY = 0;
const WALL = 1;      // Indestructible
const BRICK = 2;     // Destructible
const POWERUP_BOMB = 3;
const POWERUP_FIRE = 4;
const POWERUP_SPEED = 5;

// Game state
let grid = [];
let players = {};
let bombs = [];
let explosions = [];
let gameLoop = null;
let gameOver = false;
let roundWinner = null;
let scores = { p1: 0, p2: 0 };

function initGrid() {
    grid = [];
    for (let y = 0; y < ROWS; y++) {
        grid[y] = [];
        for (let x = 0; x < COLS; x++) {
            // Border walls
            if (x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1) {
                grid[y][x] = WALL;
            }
            // Pillar pattern (every other cell inside)
            else if (x % 2 === 0 && y % 2 === 0) {
                grid[y][x] = WALL;
            }
            // Player spawn corners - keep clear
            else if ((x <= 2 && y <= 2) || (x >= COLS - 3 && y <= 2) ||
                     (x <= 2 && y >= ROWS - 3) || (x >= COLS - 3 && y >= ROWS - 3)) {
                grid[y][x] = EMPTY;
            }
            // Random bricks elsewhere
            else if (Math.random() < 0.7) {
                grid[y][x] = BRICK;
            }
            else {
                grid[y][x] = EMPTY;
            }
        }
    }
}

function createPlayer(id, num) {
    const positions = [
        { x: 1, y: 1 },           // P1: top-left
        { x: COLS - 2, y: ROWS - 2 }  // P2: bottom-right
    ];
    const pos = positions[num - 1];

    return {
        id,
        num,
        x: pos.x,
        y: pos.y,
        targetX: pos.x,
        targetY: pos.y,
        dir: num === 1 ? 2 : 0,
        color: num === 1 ? '#3498db' : '#e74c3c',
        maxBombs: 1,
        activeBombs: 0,
        fireRadius: 2,
        speed: 0.12,
        alive: true,
        moving: false,
        bombKeyDown: false
    };
}

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    const count = Object.keys(players).length;
    if (count >= 2) {
        socket.emit('spectator');
        return;
    }

    const num = count + 1;
    players[socket.id] = createPlayer(socket.id, num);

    socket.emit('init', {
        id: socket.id,
        num,
        size: { cols: COLS, rows: ROWS, tile: TILE }
    });

    io.emit('scores', scores);

    if (Object.keys(players).length === 2 && !gameLoop) {
        startGame();
    }

    socket.on('input', (input) => {
        const p = players[socket.id];
        if (!p || !p.alive || gameOver) return;
        p.input = input;
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        if (Object.keys(players).length === 0 && gameLoop) {
            clearInterval(gameLoop);
            gameLoop = null;
        }
    });
});

function startGame() {
    initGrid();
    bombs = [];
    explosions = [];
    gameOver = false;
    roundWinner = null;

    let num = 1;
    for (let id in players) {
        players[id] = createPlayer(id, num++);
    }

    io.emit('gameStart');
    gameLoop = setInterval(update, 1000 / 60);
}

function update() {
    const now = Date.now();

    // Update players
    for (let id in players) {
        const p = players[id];
        if (!p.alive || !p.input) continue;

        // Smooth movement toward target
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;

        if (Math.abs(dx) > 0.01) {
            p.x += Math.sign(dx) * Math.min(p.speed, Math.abs(dx));
            p.moving = true;
        } else if (Math.abs(dy) > 0.01) {
            p.y += Math.sign(dy) * Math.min(p.speed, Math.abs(dy));
            p.moving = true;
        } else {
            p.x = p.targetX;
            p.y = p.targetY;
            p.moving = false;

            // Can input new direction only when aligned to grid
            let newTargetX = p.targetX;
            let newTargetY = p.targetY;

            if (p.input.up) { newTargetY--; p.dir = 0; }
            else if (p.input.down) { newTargetY++; p.dir = 2; }
            else if (p.input.left) { newTargetX--; p.dir = 3; }
            else if (p.input.right) { newTargetX++; p.dir = 1; }

            // Check collision
            if (canMoveTo(newTargetX, newTargetY)) {
                p.targetX = newTargetX;
                p.targetY = newTargetY;
            }
        }

        // Place bomb - require key release between bombs
        if (p.input.bomb) {
            if (!p.bombKeyDown && p.activeBombs < p.maxBombs) {
                const bx = Math.round(p.x);
                const by = Math.round(p.y);

                // Check no bomb already there
                if (!bombs.some(b => b.x === bx && b.y === by)) {
                    bombs.push({
                        x: bx,
                        y: by,
                        owner: id,
                        radius: p.fireRadius,
                        timer: now + BOMB_TIMER,
                        planted: now
                    });
                    p.activeBombs++;
                }
            }
            p.bombKeyDown = true;
        } else {
            p.bombKeyDown = false;
        }
    }

    // Update bombs
    const explodedBombs = [];
    bombs.forEach((bomb, idx) => {
        if (now >= bomb.timer) {
            explodedBombs.push(idx);
            explode(bomb);
        }
    });

    // Remove exploded bombs (reverse order to maintain indices)
    explodedBombs.sort((a, b) => b - a).forEach(idx => {
        const bomb = bombs[idx];
        if (players[bomb.owner]) {
            players[bomb.owner].activeBombs--;
        }
        bombs.splice(idx, 1);
    });

    // Update explosions
    explosions = explosions.filter(e => now < e.endTime);

    // Check player-explosion collisions
    for (let id in players) {
        const p = players[id];
        if (!p.alive) continue;

        const px = Math.round(p.x);
        const py = Math.round(p.y);

        if (explosions.some(e => e.x === px && e.y === py)) {
            p.alive = false;
            io.emit('playerDied', { id, num: p.num });
        }
    }

    // Check win condition
    const alivePlayers = Object.values(players).filter(p => p.alive);
    if (alivePlayers.length <= 1 && Object.keys(players).length === 2) {
        gameOver = true;

        if (alivePlayers.length === 1) {
            roundWinner = alivePlayers[0].num;
            if (roundWinner === 1) scores.p1++;
            else scores.p2++;
        } else {
            roundWinner = 0; // Draw
        }

        io.emit('roundEnd', { winner: roundWinner, scores });

        // Restart after delay
        setTimeout(() => {
            if (Object.keys(players).length >= 2) {
                startGame();
            }
        }, 3000);
    }

    broadcast();
}

function canMoveTo(x, y) {
    // Bounds check
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;

    // Wall/brick check
    const cell = grid[y]?.[x];
    if (cell === WALL || cell === BRICK) return false;

    // Bomb check (can't walk through bombs, except the one you're standing on)
    if (bombs.some(b => b.x === x && b.y === y)) return false;

    return true;
}

function explode(bomb) {
    const now = Date.now();
    const endTime = now + EXPLOSION_DURATION;

    // Center explosion
    explosions.push({ x: bomb.x, y: bomb.y, endTime, isCenter: true });

    // Four directions
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];

    dirs.forEach(([dx, dy], dirIdx) => {
        for (let i = 1; i <= bomb.radius; i++) {
            const nx = bomb.x + dx * i;
            const ny = bomb.y + dy * i;

            // Bounds check
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) break;

            const cell = grid[ny][nx];

            // Stop at wall
            if (cell === WALL) break;

            // Destroy brick
            if (cell === BRICK) {
                grid[ny][nx] = EMPTY;
                explosions.push({ x: nx, y: ny, endTime, isBrick: true });

                // Chance to spawn powerup (25% chance, balanced)
                if (Math.random() < 0.25) {
                    // Weighted: more bombs, less speed
                    const roll = Math.random();
                    if (roll < 0.45) grid[ny][nx] = POWERUP_BOMB;      // 45%
                    else if (roll < 0.8) grid[ny][nx] = POWERUP_FIRE;  // 35%
                    else grid[ny][nx] = POWERUP_SPEED;                  // 20%
                }
                break; // Stop at first brick
            }

            // Check for powerup pickup
            if (cell === POWERUP_BOMB || cell === POWERUP_FIRE || cell === POWERUP_SPEED) {
                grid[ny][nx] = EMPTY; // Destroy powerup
            }

            // Chain reaction - detonate other bombs
            const chainBomb = bombs.find(b => b.x === nx && b.y === ny);
            if (chainBomb) {
                chainBomb.timer = now; // Explode next frame
            }

            explosions.push({
                x: nx,
                y: ny,
                endTime,
                dir: dirIdx,
                isEnd: i === bomb.radius
            });
        }
    });

    // Check powerup pickups for all players
    for (let id in players) {
        const p = players[id];
        if (!p.alive) continue;

        const px = Math.round(p.x);
        const py = Math.round(p.y);
        const cell = grid[py]?.[px];

        // Apply powerups with limits
        if (cell === POWERUP_BOMB && p.maxBombs < 5) {
            p.maxBombs++;
            grid[py][px] = EMPTY;
            io.emit('powerup', { type: 'bomb', player: p.num });
        } else if (cell === POWERUP_FIRE && p.fireRadius < 6) {
            p.fireRadius++;
            grid[py][px] = EMPTY;
            io.emit('powerup', { type: 'fire', player: p.num });
        } else if (cell === POWERUP_SPEED && p.speed < 0.18) {
            p.speed += 0.015;
            grid[py][px] = EMPTY;
            io.emit('powerup', { type: 'speed', player: p.num });
        }
    }
}

// Also check powerups during normal movement
function checkPowerups() {
    for (let id in players) {
        const p = players[id];
        if (!p.alive) continue;

        const px = Math.round(p.x);
        const py = Math.round(p.y);
        const cell = grid[py]?.[px];

        // Apply powerups with limits
        if (cell === POWERUP_BOMB && p.maxBombs < 5) {
            p.maxBombs++;
            grid[py][px] = EMPTY;
            io.emit('powerup', { type: 'bomb', player: p.num });
        } else if (cell === POWERUP_FIRE && p.fireRadius < 6) {
            p.fireRadius++;
            grid[py][px] = EMPTY;
            io.emit('powerup', { type: 'fire', player: p.num });
        } else if (cell === POWERUP_SPEED && p.speed < 0.18) {
            p.speed += 0.015;
            grid[py][px] = EMPTY;
            io.emit('powerup', { type: 'speed', player: p.num });
        }
    }
}

function broadcast() {
    checkPowerups();

    io.emit('state', {
        grid,
        players: Object.values(players).map(p => ({
            num: p.num,
            x: p.x,
            y: p.y,
            dir: p.dir,
            color: p.color,
            alive: p.alive,
            moving: p.moving,
            maxBombs: p.maxBombs,
            fireRadius: p.fireRadius
        })),
        bombs: bombs.map(b => ({
            x: b.x,
            y: b.y,
            planted: b.planted,
            timer: b.timer
        })),
        explosions: explosions.map(e => ({
            x: e.x,
            y: e.y,
            isCenter: e.isCenter,
            dir: e.dir,
            isEnd: e.isEnd
        }))
    });
}

const PORT = process.env.PORT || 3456;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Bomberman server running on port ${PORT}`);
});

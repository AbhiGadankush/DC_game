const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const PongResourceManager = require("./PongResourceManager");

const app = express();
const http_server = http.createServer(app);
const io = new Server(http_server);

// Serve static files from the 'public' directory
app.use(express.static("public"));

// Route for the landing page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route for the game page
app.get('/game.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

const resourceManager = new PongResourceManager();

// Game state tracking with mutex locks
const gameStates = {};
const mutexLocks = {};

function initializeGameState(roomCode) {
    // Create mutex lock for this room if it doesn't exist
    if (!mutexLocks[roomCode]) {
        mutexLocks[roomCode] = {
            locked: false,
            queue: [],
            owner: null,
            timeoutId: null
        };
    }
    
    gameStates[roomCode] = {
        ball: { x: 300, y: 200, vx: 0, vy: 0 },
        scores: { p1: 0, p2: 0 },
        lastUpdateTime: Date.now(),
        isGameRunning: false
    };
}

// Mutex lock functions with automatic timeout to prevent deadlocks
function acquireLock(roomCode, requesterId, callback) {
    // Create mutex if it doesn't exist
    if (!mutexLocks[roomCode]) {
        mutexLocks[roomCode] = {
            locked: false,
            queue: [],
            owner: null,
            timeoutId: null
        };
    }
    
    const mutex = mutexLocks[roomCode];
    
    if (!mutex.locked) {
        mutex.locked = true;
        mutex.owner = requesterId;
        
        // Set timeout to automatically release lock after 1 second
        // This prevents deadlocks if release is never called
        mutex.timeoutId = setTimeout(() => {
            console.log(`Auto-releasing lock for ${roomCode} from ${requesterId} due to timeout`);
            releaseLock(roomCode, requesterId);
        }, 1000);
        
        callback(true);
        return true;
    } else {
        // For non-critical operations, proceed anyway to prevent blocking
        if (requesterId === 'gameLoop' || requesterId.startsWith('paddle_')) {
            callback(false); // Signal that lock wasn't acquired but proceed anyway
            return false;
        }
        
        // Add to queue if lock is busy
        mutex.queue.push({ id: requesterId, callback });
        return false;
    }
}

function releaseLock(roomCode, requesterId) {
    const mutex = mutexLocks[roomCode];
    if (!mutex) return false;
    
    // Only the owner can release the lock, or auto-release by timeout
    if (mutex.owner !== requesterId && requesterId !== 'timeout') {
        return false;
    }
    
    // Clear timeout if it exists
    if (mutex.timeoutId) {
        clearTimeout(mutex.timeoutId);
        mutex.timeoutId = null;
    }
    
    // Release the lock
    mutex.locked = false;
    mutex.owner = null;
    
    // Process queue if there are waiting requests
    if (mutex.queue.length > 0) {
        const nextRequest = mutex.queue.shift();
        mutex.locked = true;
        mutex.owner = nextRequest.id;
        
        // Set timeout for next owner too
        mutex.timeoutId = setTimeout(() => {
            console.log(`Auto-releasing lock for ${roomCode} from ${nextRequest.id} due to timeout`);
            releaseLock(roomCode, 'timeout');
        }, 1000);
        
        nextRequest.callback(true);
    }
    
    return true;
}

function updateBallPosition(roomCode) {
    // Non-blocking lock acquisition for game loop
    acquireLock(roomCode, 'gameLoop', (acquired) => {
        const gameState = gameStates[roomCode];
        if (!gameState || !gameState.isGameRunning) {
            if (acquired) releaseLock(roomCode, 'gameLoop');
            return;
        }

        const room = resourceManager.getRoomDetails(roomCode);
        if (!room || !room.gameStarted) {
            if (acquired) releaseLock(roomCode, 'gameLoop');
            return;
        }

        const deltaTime = (Date.now() - gameState.lastUpdateTime) / 16.67;
        const ball = gameState.ball;

        const speedFactor = 2;
        ball.x += ball.vx * speedFactor * deltaTime;
        ball.y += ball.vy * speedFactor * deltaTime;

        // Wall collision
        if (ball.y <= 0 || ball.y >= 400) {
            ball.vy = -ball.vy;
        }

        // Paddle collision
        const players = room.players;
        Object.values(players).forEach((paddle, index) => {
            const xPos = index === 0 ? 10 : 580;
            if (
                ball.x >= xPos && 
                ball.x <= xPos + 10 && 
                ball.y >= paddle.y && 
                ball.y <= paddle.y + 60
            ) {
                ball.vx = -ball.vx * 1.1; // Add slight speed increase on paddle hit
            }
        });

        // Goal detection
        if (ball.x <= 0) {
            gameState.scores.p2++;
            resetBall(roomCode);
        } else if (ball.x >= 600) {
            gameState.scores.p1++;
            resetBall(roomCode);
        }

        gameState.lastUpdateTime = Date.now();

        // Broadcast updates
        io.to(roomCode).emit("updateBall", ball);
        io.to(roomCode).emit("updateScores", gameState.scores);
        
        // Release the lock after operation completes
        if (acquired) releaseLock(roomCode, 'gameLoop');
    });
}

function resetBall(roomCode) {
    const gameState = gameStates[roomCode];
    if (!gameState) return;

    // Set base speed and a small angle variance for random direction
    const baseSpeed = 3;
    const angleVariance = Math.random() * Math.PI / 4 - Math.PI / 8;
    
    gameState.ball = { 
        x: 300, 
        y: 200, 
        vx: baseSpeed * Math.cos(angleVariance) * (Math.random() > 0.5 ? 1 : -1),
        vy: baseSpeed * Math.sin(angleVariance) * (Math.random() > 0.5 ? 1 : -1)
    };
    gameState.lastUpdateTime = Date.now();
    
    io.to(roomCode).emit("updateBall", gameState.ball);
}

// Game loop
setInterval(() => {
    Object.keys(gameStates).forEach(roomCode => {
        updateBallPosition(roomCode);
    });
}, 16); // ~60 FPS

io.on("connection", (socket) => {
    // Room creation
    socket.on("createRoom", () => {
        // Generate a simple 4-digit room code
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        if (resourceManager.createRoom(roomCode)) {
            socket.emit("roomCreated", roomCode);
        }
    });

    // Room joining
    socket.on("joinRoom", (roomCode) => {
        // Initialize game state if it doesn't exist
        if (!gameStates[roomCode]) {
            initializeGameState(roomCode);
        }
        
        const playerNumber = resourceManager.joinRoom(roomCode, socket.id);
        if (playerNumber) {
            socket.join(roomCode);
            
            // Send current paddles state to initialize
            const players = resourceManager.getPlayers(roomCode);
            socket.emit("updatePaddles", players);
            
            socket.emit("joinedRoom", { roomCode, playerNumber });
            
            // Check if room is ready
            if (resourceManager.isRoomReady(roomCode)) {
                io.to(roomCode).emit("roomReady");
            }
        } else {
            socket.emit("roomJoinError", "Unable to join room");
        }
    });

    // Paddle movement - non-blocking for responsiveness
    socket.on("paddleMove", (data) => {
        const { roomCode, y } = data;
        
        // Use a unique ID for paddle movement to avoid contention
        const requesterId = `paddle_${socket.id}`;
        
        // Always update paddle position for responsiveness
        if (resourceManager.updatePlayerPosition(roomCode, socket.id, y)) {
            // Broadcast paddle movement to all players in the room
            io.to(roomCode).emit("updatePaddles", resourceManager.getPlayers(roomCode));
        }
    });

    // Start game - critical section
    socket.on("startGame", (roomCode) => {
        acquireLock(roomCode, socket.id, (acquired) => {
            // Even if lock not acquired, try to start game
            if (resourceManager.startGame(roomCode)) {
                // Initialize game state if not already done
                if (!gameStates[roomCode]) {
                    initializeGameState(roomCode);
                }
                
                // Explicitly set game as running
                const gameState = gameStates[roomCode];
                gameState.isGameRunning = true;
                
                // Set initial ball velocity
                gameState.ball.vx = (Math.random() > 0.5 ? 3 : -3);
                gameState.ball.vy = (Math.random() > 0.5 ? 2 : -2);
                
                // Send game started event and initial ball state
                io.to(roomCode).emit("gameStarted");
                io.to(roomCode).emit("updateBall", gameState.ball);
            }
            
            if (acquired) releaseLock(roomCode, socket.id);
        });
    });

    // Reset game - critical section
    socket.on("resetGame", (roomCode) => {
        acquireLock(roomCode, socket.id, (acquired) => {
            const players = resourceManager.getPlayers(roomCode);
            
            // Reset game state
            const gameState = gameStates[roomCode];
            if (gameState) {
                gameState.scores = { p1: 0, p2: 0 };
                gameState.isGameRunning = false;  // Stop the game
                
                // Reset ball to center with no velocity
                gameState.ball = { 
                    x: 300, 
                    y: 200, 
                    vx: 0, 
                    vy: 0 
                };
            }
            
            // Reset room game state
            const room = resourceManager.getRoomDetails(roomCode);
            if (room) {
                room.gameStarted = false;
            }
            
            // Broadcast reset
            io.to(roomCode).emit("gameReset", { 
                players, 
                ball: gameState.ball,
                scores: gameState.scores 
            });
            
            if (acquired) releaseLock(roomCode, socket.id);
        });
    });

    // Disconnection handling
    socket.on("disconnect", () => {
        // Find and remove player from any rooms
        Object.keys(resourceManager.rooms).forEach(roomCode => {
            if (resourceManager.removePlayer(roomCode, socket.id)) {
                // Force clean up any existing lock this player might have
                if (mutexLocks[roomCode] && mutexLocks[roomCode].owner === socket.id) {
                    releaseLock(roomCode, socket.id);
                }
                
                // If room is now empty, clean up resources
                const players = resourceManager.getPlayers(roomCode);
                if (Object.keys(players).length === 0) {
                    delete gameStates[roomCode];
                    delete mutexLocks[roomCode];
                    resourceManager.closeRoom(roomCode);
                } else {
                    // Notify remaining players
                    io.to(roomCode).emit("playerLeft");
                }
            }
        });
    });
});

http_server.listen(3000, () => console.log("Server running on http://localhost:3000"));
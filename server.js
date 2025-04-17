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

// Route for random matchmaking
app.get('/random', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'random.html'));
});

const resourceManager = new PongResourceManager();

// Game state tracking with mutex locks
const gameStates = {};
const mutexLocks = {};
const WINNING_SCORE = 5; // Define winning score target
const SESSION_TIMEOUT = 120000; // 2 minutes of inactivity
const PAUSE_MAX_DURATION = 300000; // 5 minutes maximum pause time

// Waiting room for random matchmaking
let waitingPlayer = null;

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
        scores: { p1: 0, p2: 0 },  // Start with scores at 0-0
        lastUpdateTime: Date.now(),
        isGameRunning: false,
        isPaused: false,
        pauseStartTime: null,
        totalPauseTime: 0,
        lastActivityTime: Date.now(),
        activityTimeoutId: null,
        pauseTimeoutId: null
    };
    
    // Make sure to broadcast initial scores when game state is initialized
    if (io.sockets.adapter.rooms.has(roomCode)) {
        io.to(roomCode).emit("updateScores", { p1: 0, p2: 0 });
    }
}

// Function to check for session timeout
function setupSessionTimeout(roomCode) {
    const gameState = gameStates[roomCode];
    if (!gameState) return;

    // Clear any existing timeout
    if (gameState.activityTimeoutId) {
        clearTimeout(gameState.activityTimeoutId);
    }

    // Set new timeout
    gameState.activityTimeoutId = setTimeout(() => {
        console.log(`Session timeout for room ${roomCode}`);
        io.to(roomCode).emit("sessionTimeout", "Game ended due to inactivity");
        
        // Clean up room
        Object.keys(resourceManager.getPlayers(roomCode)).forEach(playerId => {
            const playerSocket = io.sockets.sockets.get(playerId);
            if (playerSocket) {
                playerSocket.leave(roomCode);
            }
        });

        delete gameStates[roomCode];
        delete mutexLocks[roomCode];
        resourceManager.closeRoom(roomCode);
    }, SESSION_TIMEOUT);
}

// Function to check for pause timeout
function setupPauseTimeout(roomCode) {
    const gameState = gameStates[roomCode];
    if (!gameState) return;

    // Clear any existing timeout
    if (gameState.pauseTimeoutId) {
        clearTimeout(gameState.pauseTimeoutId);
    }

    // Set new timeout only if game is paused
    if (gameState.isPaused) {
        gameState.pauseTimeoutId = setTimeout(() => {
            console.log(`Pause timeout for room ${roomCode}`);
            io.to(roomCode).emit("pauseTimeout", "Game ended due to extended pause");
            
            // Clean up room
            Object.keys(resourceManager.getPlayers(roomCode)).forEach(playerId => {
                const playerSocket = io.sockets.sockets.get(playerId);
                if (playerSocket) {
                    playerSocket.leave(roomCode);
                }
            });

            delete gameStates[roomCode];
            delete mutexLocks[roomCode];
            resourceManager.closeRoom(roomCode);
        }, PAUSE_MAX_DURATION);
    }
}

// Update activity timestamp
function updateActivity(roomCode) {
    const gameState = gameStates[roomCode];
    if (!gameState) return;
    
    gameState.lastActivityTime = Date.now();
    setupSessionTimeout(roomCode);
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
        if (!gameState || !gameState.isGameRunning || gameState.isPaused) {
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
            checkWinCondition(roomCode);
        } else if (ball.x >= 600) {
            gameState.scores.p1++;
            resetBall(roomCode);
            checkWinCondition(roomCode);
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

// Check if any player has reached the winning score
function checkWinCondition(roomCode) {
    const gameState = gameStates[roomCode];
    if (!gameState) return;

    if (gameState.scores.p1 >= WINNING_SCORE) {
        endGame(roomCode, 1);
    } else if (gameState.scores.p2 >= WINNING_SCORE) {
        endGame(roomCode, 2);
    }
}

// End the game and declare a winner
function endGame(roomCode, winner) {
    const gameState = gameStates[roomCode];
    if (!gameState) return;

    gameState.isGameRunning = false;
    
    // Send game over event with winner
    io.to(roomCode).emit("gameOver", {
        winner,
        finalScore: gameState.scores
    });
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

   // Random matchmaking
socket.on("findRandomMatch", () => {
    // Check if socket is already in a room to avoid duplicated joining
    const playerRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
    if (playerRooms.length > 0) {
        // Player is already in a room, do nothing
        console.log(`Player ${socket.id} tried to find match but is already in room: ${playerRooms[0]}`);
        socket.emit("waitingForMatch");
        return;
    }
    
    // Check if this player was the waiting player (in case of duplicate events)
    if (waitingPlayer === socket.id) {
        console.log(`Player ${socket.id} is already waiting for a match`);
        socket.emit("waitingForMatch");
        return;
    }
    
    if (waitingPlayer) {
        // Get the waiting player's socket
        const waitingSocket = io.sockets.sockets.get(waitingPlayer);
        
        if (waitingSocket) {
            // Generate a room code for the match
            const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
            
            // Create the room
            if (resourceManager.createRoom(roomCode)) {
                console.log(`Created random match room: ${roomCode} between ${waitingPlayer} and ${socket.id}`);
                
                // First player joins
                const player1Number = resourceManager.joinRoom(roomCode, waitingPlayer);
                waitingSocket.join(roomCode);
                
                // Second player joins
                const player2Number = resourceManager.joinRoom(roomCode, socket.id);
                socket.join(roomCode);
                
                // Initialize game state
                initializeGameState(roomCode);
                setupSessionTimeout(roomCode);
                
                // Notify players individually with their player numbers
                waitingSocket.emit("joinedRoom", { roomCode, playerNumber: player1Number });
                socket.emit("joinedRoom", { roomCode, playerNumber: player2Number });
                
                // Notify both players that room is ready
                io.to(roomCode).emit("roomReady");
                
                // Reset waiting player
                waitingPlayer = null;
            }
        } else {
            // If waiting socket no longer exists
            console.log(`Previous waiting player ${waitingPlayer} not found, setting new waiting player: ${socket.id}`);
            waitingPlayer = socket.id;
            socket.emit("waitingForMatch");
        }
    } else {
        // No waiting player, become the waiting player
        console.log(`No waiting player, setting ${socket.id} as waiting player`);
        waitingPlayer = socket.id;
        socket.emit("waitingForMatch");
    }
});

    // Cancel random matchmaking
    socket.on("cancelMatchmaking", () => {
        if (waitingPlayer === socket.id) {
            waitingPlayer = null;
            socket.emit("matchmakingCancelled");
        }
    });

    // Room joining
    socket.on("joinRoom", (roomCode) => {
        // Initialize game state if it doesn't exist
        if (!gameStates[roomCode]) {
            initializeGameState(roomCode);
            setupSessionTimeout(roomCode);
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
            
            // Update activity timestamp
            updateActivity(roomCode);
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
            
            // Update activity timestamp
            updateActivity(roomCode);
        }
    });

    // Pause/Resume game
    socket.on("togglePause", (roomCode) => {
        acquireLock(roomCode, socket.id, (acquired) => {
            const gameState = gameStates[roomCode];
            if (!gameState || !gameState.isGameRunning) {
                if (acquired) releaseLock(roomCode, socket.id);
                return;
            }
            
            if (gameState.isPaused) {
                // Resume game
                const pauseDuration = Date.now() - gameState.pauseStartTime;
                gameState.totalPauseTime += pauseDuration;
                gameState.isPaused = false;
                gameState.lastUpdateTime = Date.now(); // Reset update time
                
                // Clear pause timeout
                if (gameState.pauseTimeoutId) {
                    clearTimeout(gameState.pauseTimeoutId);
                    gameState.pauseTimeoutId = null;
                }
                
                io.to(roomCode).emit("gameResumed");
            } else {
                // Pause game
                gameState.isPaused = true;
                gameState.pauseStartTime = Date.now();
                
                // Set up pause timeout
                setupPauseTimeout(roomCode);
                
                io.to(roomCode).emit("gamePaused");
            }
            
            // Update activity timestamp
            updateActivity(roomCode);
            
            if (acquired) releaseLock(roomCode, socket.id);
        });
    });

    // Start game - critical section
    socket.on("startGame", (roomCode) => {
        acquireLock(roomCode, socket.id, (acquired) => {
            // Even if lock not acquired, try to start game
            if (resourceManager.startGame(roomCode)) {
                // Initialize game state if not already done
                if (!gameStates[roomCode]) {
                    initializeGameState(roomCode);
                } else {
                    // Make sure scores are reset when starting a new game
                    gameStates[roomCode].scores = { p1: 0, p2: 0 };
                    io.to(roomCode).emit("updateScores", gameStates[roomCode].scores);
                }
                
                // Explicitly set game as running
                const gameState = gameStates[roomCode];
                gameState.isGameRunning = true;
                gameState.isPaused = false;
                
                // Set initial ball velocity
                gameState.ball.vx = (Math.random() > 0.5 ? 3 : -3);
                gameState.ball.vy = (Math.random() > 0.5 ? 2 : -2);
                
                // Send game started event and initial ball state
                io.to(roomCode).emit("gameStarted");
                io.to(roomCode).emit("updateBall", gameState.ball);
                
                // Update activity timestamp
                updateActivity(roomCode);
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
                gameState.isPaused = false;
                
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
            
            // Update activity timestamp
            updateActivity(roomCode);
            
            if (acquired) releaseLock(roomCode, socket.id);
        });
    });

    // Disconnection handling
    socket.on("disconnect", () => {
        console.log(`Player ${socket.id} disconnected`);
        
        // If this is the waiting player, clear waiting status
        if (waitingPlayer === socket.id) {
            console.log(`Waiting player ${socket.id} disconnected, clearing waiting status`);
            waitingPlayer = null;
        }
        
        // Find and remove player from any rooms
        Object.keys(resourceManager.rooms).forEach(roomCode => {
            if (resourceManager.removePlayer(roomCode, socket.id)) {
                console.log(`Removed player ${socket.id} from room ${roomCode}`);
                
                // Force clean up any existing lock this player might have
                if (mutexLocks[roomCode] && mutexLocks[roomCode].owner === socket.id) {
                    releaseLock(roomCode, socket.id);
                }
                
                // If room is now empty, clean up resources
                const players = resourceManager.getPlayers(roomCode);
                if (Object.keys(players).length === 0) {
                    console.log(`Room ${roomCode} is now empty, cleaning up resources`);
                    // Clean up timeouts
                    const gameState = gameStates[roomCode];
                    if (gameState) {
                        if (gameState.activityTimeoutId) {
                            clearTimeout(gameState.activityTimeoutId);
                        }
                        if (gameState.pauseTimeoutId) {
                            clearTimeout(gameState.pauseTimeoutId);
                        }
                    }
                    
                    // Delete resources
                    delete gameStates[roomCode];
                    delete mutexLocks[roomCode];
                    resourceManager.closeRoom(roomCode);
                } else {
                    // Notify remaining players
                    console.log(`Notifying remaining players in room ${roomCode} that player ${socket.id} left`);
                    io.to(roomCode).emit("playerLeft");
                }
            }
        });
    });
});
http_server.listen(3000, () => console.log("Server running on http://localhost:3000"));
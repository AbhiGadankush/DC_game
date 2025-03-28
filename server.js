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

// Game state tracking
const gameStates = {};

function initializeGameState(roomCode) {
    gameStates[roomCode] = {
        ball: { x: 300, y: 200, vx: 0, vy: 0 },
        scores: { p1: 0, p2: 0 },
        lastUpdateTime: Date.now(),
        isGameRunning: false  // Add a flag to track game state
    };
}
function updateBallPosition(roomCode) {
    const gameState = gameStates[roomCode];
    if (!gameState || !gameState.isGameRunning) return;

    const room = resourceManager.getRoomDetails(roomCode);
    if (!room || !room.gameStarted) return;

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
        const playerNumber = resourceManager.joinRoom(roomCode, socket.id);
        if (playerNumber) {
            socket.join(roomCode);
            socket.emit("joinedRoom", { roomCode, playerNumber });
            
            // Check if room is ready
            if (resourceManager.isRoomReady(roomCode)) {
                io.to(roomCode).emit("roomReady");
            }
        } else {
            socket.emit("roomJoinError", "Unable to join room");
        }
    });

    // Paddle movement
    socket.on("paddleMove", (data) => {
        const { roomCode, y } = data;
        if (resourceManager.updatePlayerPosition(roomCode, socket.id, y)) {
            // Broadcast paddle movement to other players in the room
            io.to(roomCode).emit("updatePaddles", resourceManager.getPlayers(roomCode));
        }
    });

    // Start game
    socket.on("startGame", (roomCode) => {
        if (resourceManager.startGame(roomCode)) {
            // Initialize game state
            initializeGameState(roomCode);
            
            // Explicitly set game as running
            const gameState = gameStates[roomCode];
            gameState.isGameRunning = true;
            
            io.to(roomCode).emit("gameStarted");
            
            // Set initial ball velocity
            gameState.ball.vx = (Math.random() > 0.5 ? 3 : -3);
            gameState.ball.vy = (Math.random() > 0.5 ? 2 : -2);
            
            io.to(roomCode).emit("updateBall", gameState.ball);
        }
    });

     // Reset game
     socket.on("resetGame", (roomCode) => {
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
    });

    // Disconnection handling
    socket.on("disconnect", () => {
        // Find and remove player from any rooms
        Object.keys(resourceManager.rooms).forEach(roomCode => {
            if (resourceManager.removePlayer(roomCode, socket.id)) {
                // Remove game state for this room
                delete gameStates[roomCode];
                
                io.to(roomCode).emit("playerLeft");
            }
        });
    });
});

http_server.listen(3000, () => console.log("Server running on http://localhost:3000"));
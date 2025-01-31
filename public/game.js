const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("startButton");
const resetButton = document.getElementById("resetButton");

const socket = io();

let playerNumber;
let paddles = {};
let ball = { x: 300, y: 200, vx: 0, vy: 0 };
let scores = { p1: 0, p2: 0 };
let gameStarted = false;

// Listen for player number assignment
socket.on("playerNumber", (num) => {
    playerNumber = num;
    console.log("You are player:", playerNumber);
});

// Handle game full case
socket.on("gameFull", () => {
    alert("Game is full! Try again later.");
});

// Listen for game updates
socket.on("updateGame", (data) => {
    paddles = data.paddles;
    ball = data.ball;
    scores = data.scores;
});

// Draw paddles, ball, and score
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw paddles
    ctx.fillStyle = "white";
    Object.values(paddles).forEach((p, i) => {
        ctx.fillRect(i === 0 ? 10 : 580, p.y, 10, 60);
    });

    // Draw ball
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
    ctx.fill();

    // Draw score
    ctx.font = "20px Arial";
    ctx.fillText(`P1: ${scores.p1}`, 50, 30);
    ctx.fillText(`P2: ${scores.p2}`, 500, 30);

    // Show winner
    if (scores.p1 >= 5) {
        ctx.fillText("Player 1 Wins!", 250, 200);
    } else if (scores.p2 >= 5) {
        ctx.fillText("Player 2 Wins!", 250, 200);
    }

    requestAnimationFrame(draw);
}

// Move paddle with mouse
canvas.addEventListener("mousemove", (event) => {
    let rect = canvas.getBoundingClientRect();
    let y = event.clientY - rect.top;

    if (playerNumber === 1 || playerNumber === 2) {
        paddles[socket.id] = { y: Math.max(0, Math.min(y - 30, 340)) }; // Limit movement
        socket.emit("paddleMove", { y: paddles[socket.id].y });
    }
});

// Start game button
startButton.addEventListener("click", () => {
    socket.emit("startGame");
});

// Reset game button
resetButton.addEventListener("click", () => {
    socket.emit("resetGame");
});

draw();

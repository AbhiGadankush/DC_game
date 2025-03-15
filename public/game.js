document.addEventListener("DOMContentLoaded", () => {
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

    // Simulate a local clock drift for this client (node)
    const clockOffset = Math.floor(Math.random() * 200) - 100;
    function getLocalTime() {
        return Date.now() + clockOffset;
    }

    socket.on("playerNumber", (num) => {
        playerNumber = num;
        console.log("You are player:", playerNumber);
    });

    socket.on("gameFull", () => {
        alert("Game is full! Try again later.");
    });

    socket.on("updateGame", (data) => {
        paddles = data.paddles;
        ball = data.ball;
        scores = data.scores;
    });

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = "white";
        Object.values(paddles).forEach((p, index) => {
            const xPos = index === 0 ? 10 : 580;
            ctx.fillRect(xPos, p.y, 10, 60);
        });

        ctx.beginPath();
        ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = "20px Arial";
        ctx.fillText(`P1: ${scores.p1}`, 50, 30);
        ctx.fillText(`P2: ${scores.p2}`, 500, 30);

        if (scores.p1 >= 5) {
            ctx.fillText("Player 1 Wins!", 250, 200);
        } else if (scores.p2 >= 5) {
            ctx.fillText("Player 2 Wins!", 250, 200);
        }

        requestAnimationFrame(draw);
    }

    canvas.addEventListener("mousemove", (event) => {
        let rect = canvas.getBoundingClientRect();
        let y = event.clientY - rect.top;
        let newY = Math.max(0, Math.min(y - 30, canvas.height - 60));

        paddles[socket.id] = { y: newY };
        socket.emit("paddleMove", { y: newY, timestamp: getLocalTime() });
    });

    startButton.addEventListener("click", () => {
        socket.emit("startGame");
    });

    resetButton.addEventListener("click", () => {
        socket.emit("resetGame");
    });

    draw();
});

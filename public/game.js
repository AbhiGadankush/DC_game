document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const startButton = document.getElementById("startButton");
  const resetButton = document.getElementById("resetButton");
  const pauseButton = document.getElementById("pauseButton");
  const roomDisplay = document.getElementById("roomDisplay");
  const scoreDisplay = document.getElementById("scoreDisplay");
  const gameStatus = document.getElementById("gameStatus");

  const socket = io();
  const WINNING_SCORE = 5; // Match the server value

  let playerNumber;
  let roomCode;
  let paddles = {};
  let ball = { x: 300, y: 200, vx: 0, vy: 0 };
  let scores = { p1: 0, p2: 0 };
  let gameStarted = false;
  let isPaused = false;
  let winner = null;

  // Get room code from URL
  const urlParams = new URLSearchParams(window.location.search);
  roomCode = urlParams.get('roomCode');

  if (roomCode) {
    // Join the room
    socket.emit('joinRoom', roomCode);
    roomDisplay.textContent = `Room Code: ${roomCode}`;
  }

  // Socket event listeners
  socket.on("joinedRoom", (data) => {
    playerNumber = data.playerNumber;
    roomDisplay.textContent = `Room Code: ${roomCode}, Player: ${playerNumber}`;
    
    // Initialize default paddle positions
    if (Object.keys(paddles).length === 0) {
      paddles = {
        1: { y: 150 },
        2: { y: 150 }
      };
    }
  });

  socket.on("matchFound", (roomCode) => {
    console.log("Match found, redirecting to game room:", roomCode);
    window.location.href = `/game.html?roomCode=${roomCode}`;
  });

  socket.on("roomReady", () => {
    console.log("Room is ready, enabling start button");
    startButton.disabled = false;
  });

  socket.on("gameStarted", () => {
    console.log("Game started event received");
    gameStarted = true;
    isPaused = false;
    winner = null;
    gameStatus.textContent = "Game in progress";
    gameStatus.style.color = "white";
    startButton.disabled = true;
    resetButton.disabled = false;
    pauseButton.disabled = false;
    pauseButton.textContent = "Pause Game";
  });

  socket.on("gameReset", (data) => {
    console.log("Game reset event received", data);
    if (data.players) paddles = data.players;
    scores = data.scores;
    ball = data.ball;
    gameStarted = false;
    isPaused = false;
    winner = null;
    gameStatus.textContent = "Game ready";
    gameStatus.style.color = "white";
    startButton.disabled = false;
    resetButton.disabled = true;
    pauseButton.disabled = true;
    pauseButton.textContent = "Pause Game";
  });

  socket.on("updateScores", (newScores) => {
    scores = newScores;
    scoreDisplay.textContent = `${scores.p1} - ${scores.p2}`;
  });

  socket.on("updateBall", (newBall) => {
    ball = newBall;
  });

  socket.on("updatePaddles", (newPaddles) => {
    console.log("Paddle update received:", newPaddles);
    paddles = newPaddles;
  });

  socket.on("gamePaused", () => {
    isPaused = true;
    gameStatus.textContent = "Game paused";
    gameStatus.style.color = "yellow";
    pauseButton.textContent = "Resume Game";
  });

  socket.on("gameResumed", () => {
    isPaused = false;
    gameStatus.textContent = "Game in progress";
    gameStatus.style.color = "white";
    pauseButton.textContent = "Pause Game";
  });

  socket.on("gameOver", (data) => {
    winner = data.winner;
    gameStatus.textContent = `Player ${winner} wins! Final score: ${scores.p1} - ${scores.p2}`;
    gameStatus.style.color = "lime";
    pauseButton.disabled = true;
    startButton.disabled = true;
    resetButton.disabled = false;
  });

  socket.on("sessionTimeout", (message) => {
    alert(message);
    window.location.href = "/";
  });

  socket.on("pauseTimeout", (message) => {
    alert(message);
    window.location.href = "/";
  });

  socket.on("playerLeft", () => {
    console.log("Other player left");
    gameStarted = false;
    isPaused = false;
    resetButton.disabled = true;
    startButton.disabled = true;
    pauseButton.disabled = true;
    gameStatus.textContent = "Other player left the game";
    gameStatus.style.color = "red";
    alert("Other player has left the game");
  });

  // Error handling
  socket.on("gameStartError", (message) => {
    console.error("Game start error:", message);
    alert("Error starting game: " + message);
  });

  socket.on("gameResetError", (message) => {
    console.error("Game reset error:", message);
    alert("Error resetting game: " + message);
  });

  // User activity tracking
  let lastActivityTime = Date.now();
  const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart'];
  
  activityEvents.forEach(eventType => {
    document.addEventListener(eventType, () => {
      lastActivityTime = Date.now();
    });
  });

  // Move paddle with mouse
  canvas.addEventListener("mousemove", (event) => {
    if (!roomCode) return;

    let rect = canvas.getBoundingClientRect();
    let y = event.clientY - rect.top;
    let newY = Math.max(0, Math.min(y - 30, canvas.height - 60));

    socket.emit("paddleMove", { roomCode, y: newY });
  });

  // Start game button
  startButton.addEventListener("click", () => {
    console.log("Start button clicked for room:", roomCode);
    if (roomCode) {
      socket.emit("startGame", roomCode);
    }
  });

  // Reset game button
  resetButton.addEventListener("click", () => {
    console.log("Reset button clicked for room:", roomCode);
    if (roomCode) {
      socket.emit("resetGame", roomCode);
    }
  });

  // Pause/Resume game button
  pauseButton.addEventListener("click", () => {
    console.log("Pause button clicked for room:", roomCode);
    if (roomCode && gameStarted) {
      socket.emit("togglePause", roomCode);
    }
  });

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw center line
    ctx.strokeStyle = 'white';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw paddles
    ctx.fillStyle = "white";
    
    // Convert object to array for iteration
    const paddleArray = Object.values(paddles);
    paddleArray.forEach((paddle, index) => {
      const xPos = index === 0 ? 10 : 580;
      ctx.fillRect(xPos, paddle.y, 10, 60);
    });

    // Draw ball
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
    ctx.fill();

    // Draw score
    ctx.font = "30px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`${scores.p1}`, canvas.width / 2 - 50, 50);
    ctx.fillText(`${scores.p2}`, canvas.width / 2 + 50, 50);

    // Draw winning score target
    ctx.font = "14px Arial";
    ctx.fillText(`First to ${WINNING_SCORE} wins`, canvas.width / 2, 20);

    // Draw pause icon when game is paused
    if (isPaused) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.fillRect(290, 190, 8, 20);
      ctx.fillRect(310, 190, 8, 20);
    }

    // Draw winner message
    if (winner) {
      ctx.font = "24px Arial";
      ctx.fillStyle = "lime";
      ctx.fillText(`Player ${winner} wins!`, canvas.width / 2, canvas.height / 2 - 40);
    }

    requestAnimationFrame(draw);
  }

  // Initial UI setup
  resetButton.disabled = true;
  pauseButton.disabled = true;
  scoreDisplay.textContent = "0 - 0";
  gameStatus.textContent = "Waiting for opponent";

  draw();
});
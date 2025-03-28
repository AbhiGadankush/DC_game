document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const startButton = document.getElementById("startButton");
  const resetButton = document.getElementById("resetButton");
  const createRoomButton = document.getElementById("createRoomButton");
  const joinRoomButton = document.getElementById("joinRoomButton");
  const roomCodeInput = document.getElementById("roomCodeInput");
  const roomDisplay = document.getElementById("roomDisplay");

  const socket = io();

  let playerNumber;
  let roomCode;
  let paddles = {};
  let ball = { x: 300, y: 200, vx: 0, vy: 0 };
  let scores = { p1: 0, p2: 0 };
  let gameStarted = false;

  // Create Room
  createRoomButton.addEventListener("click", () => {
      socket.emit("createRoom");
  });

  // Join Room
  joinRoomButton.addEventListener("click", () => {
      roomCode = roomCodeInput.value.trim();
      if (roomCode) {
          socket.emit("joinRoom", roomCode);
      }
  });

  // Socket event listeners
  socket.on("roomCreated", (code) => {
      roomCode = code;
      roomDisplay.textContent = `Room Code: ${roomCode}`;
      startButton.disabled = true;
  });

  socket.on("joinedRoom", (data) => {
      roomCode = data.roomCode;
      playerNumber = data.playerNumber;
      roomDisplay.textContent = `Room Code: ${roomCode}, Player: ${playerNumber}`;
      startButton.disabled = true;
  });

  socket.on("roomReady", () => {
      startButton.disabled = false;
  });

  socket.on("gameStarted", () => {
      gameStarted = true;
  });

  socket.on("gameReset", (data) => {
      paddles = data.players;
      scores = { p1: 0, p2: 0 };
      gameStarted = false;
  });

  socket.on("updateBall", (newBall) => {
      ball = newBall;
  });

  socket.on("updatePaddles", (newPaddles) => {
      paddles = newPaddles;
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
      if (roomCode) {
          socket.emit("startGame", roomCode);
      }
  });

  // Reset game button
  resetButton.addEventListener("click", () => {
      if (roomCode) {
          socket.emit("resetGame", roomCode);
      }
  });

  function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw paddles
      ctx.fillStyle = "white";
      Object.values(paddles).forEach((p, index) => {
          const xPos = index === 0 ? 10 : 580;
          ctx.fillRect(xPos, p.y, 10, 60);
      });

      // Draw ball
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
      ctx.fill();

      // Draw score
      ctx.font = "20px Arial";
      ctx.fillText(`P1: ${scores.p1}`, 50, 30);
      ctx.fillText(`P2: ${scores.p2}`, 500, 30);

      requestAnimationFrame(draw);
  }

  draw();
});
document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("gameCanvas");
    const ctx = canvas.getContext("2d");
    const startButton = document.getElementById("startButton");
    const resetButton = document.getElementById("resetButton");
    const roomDisplay = document.getElementById("roomDisplay");
  
    const socket = io();
  
    let playerNumber;
    let roomCode;
    let paddles = {};
    let ball = { x: 300, y: 200, vx: 0, vy: 0 };
    let scores = { p1: 0, p2: 0 };
    let gameStarted = false;
  
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
  
    socket.on("roomReady", () => {
      console.log("Room is ready, enabling start button");
      startButton.disabled = false;
    });
  
    socket.on("gameStarted", () => {
      console.log("Game started event received");
      gameStarted = true;
      startButton.disabled = true;
      resetButton.disabled = false;
    });
  
    socket.on("gameReset", (data) => {
      console.log("Game reset event received", data);
      if (data.players) paddles = data.players;
      scores = data.scores;
      ball = data.ball;
      gameStarted = false;
      startButton.disabled = false;
      resetButton.disabled = true;
    });
  
    socket.on("updateScores", (newScores) => {
      scores = newScores;
    });
  
    socket.on("updateBall", (newBall) => {
      ball = newBall;
    });
  
    socket.on("updatePaddles", (newPaddles) => {
      console.log("Paddle update received:", newPaddles);
      paddles = newPaddles;
    });
  
    socket.on("playerLeft", () => {
      console.log("Other player left");
      gameStarted = false;
      resetButton.disabled = true;
      startButton.disabled = true;
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
  
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
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
      ctx.font = "20px Arial";
      ctx.fillText(`P1: ${scores.p1}`, 50, 30);
      ctx.fillText(`P2: ${scores.p2}`, 500, 30);
  
      requestAnimationFrame(draw);
    }
  
    draw();
  });
document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("gameCanvas");
    const ctx = canvas.getContext("2d");
    const startButton = document.getElementById("startButton");
    const resetButton = document.getElementById("resetButton");
    const syncInfoDiv = document.getElementById("syncInfo");
  
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
  
    // Initially disable the start button until both players are ready.
    startButton.disabled = true;
  
    // Listen for player number assignment.
    socket.on("playerNumber", (num) => {
      playerNumber = num;
      console.log("You are player:", playerNumber);
    });
  
    // When both players have joined, enable the start button.
    socket.on("bothPlayersJoined", () => {
      console.log("Both players have joined. Game is ready to start!");
      startButton.disabled = false;
    });
  
    // If a player disconnects, disable the start button.
    socket.on("waitingForPlayer", () => {
      console.log("Waiting for a second player...");
      startButton.disabled = true;
    });
  
    // Listen for game updates (game state broadcast by the server).
    socket.on("updateGame", (data) => {
      paddles = data.paddles;
      ball = data.ball;
      scores = data.scores;
    });
  
    // Listen for the syncClock event to synchronize clocks.
    socket.on("syncClock", (data) => {
      const serverTime = data.serverTime;
      const localTime = Date.now() + clockOffset;
      // Compute offset (a positive offset means the client's clock is ahead).
      const offset = localTime - serverTime;
      if (syncInfoDiv) {
        syncInfoDiv.textContent = "Synchronized with server! Clock offset: " + offset + " ms";
      }
      console.log("Clock sync offset:", offset, "ms");
    });
  
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw paddles.
      ctx.fillStyle = "white";
      Object.values(paddles).forEach((p, index) => {
        const xPos = index === 0 ? 10 : 580;
        ctx.fillRect(xPos, p.y, 10, 60);
      });
  
      // Draw ball.
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
      ctx.fill();
  
      // Draw score.
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
  
    // Move paddle with mouse. Send paddle position along with a local timestamp.
    canvas.addEventListener("mousemove", (event) => {
      let rect = canvas.getBoundingClientRect();
      let y = event.clientY - rect.top;
      let newY = Math.max(0, Math.min(y - 30, canvas.height - 60));
  
      paddles[socket.id] = { y: newY };
      socket.emit("paddleMove", { y: newY, timestamp: getLocalTime() });
    });
  
    // Start game button: only active when both players are connected.
    startButton.addEventListener("click", () => {
      socket.emit("startGame");
    });
  
    resetButton.addEventListener("click", () => {
      socket.emit("resetGame");
    });
  
    draw();
  });
  
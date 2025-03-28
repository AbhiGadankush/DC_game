const EventEmitter = require('events');

class PongResourceManager {
    constructor() {
        // Rooms will be tracked separately
        this.rooms = {};
    }

    // Create a new game room with a unique code
    createRoom(roomCode) {
        if (this.rooms[roomCode]) {
            return false; // Room already exists
        }

        this.rooms[roomCode] = {
            players: {},
            gameStarted: false,
            maxPlayers: 2
        };

        console.log(`Room created: ${roomCode}`);
        return true;
    }

    // Join an existing room
    joinRoom(roomCode, playerId) {
        const room = this.rooms[roomCode];
        if (!room) {
            console.log(`Room ${roomCode} does not exist`);
            return false;
        }

        // Check if room is full
        if (Object.keys(room.players).length >= room.maxPlayers) {
            console.log(`Room ${roomCode} is full`);
            return false;
        }

        // Assign player number based on current players
        const playerNumber = Object.keys(room.players).length + 1;
        
        room.players[playerId] = {
            number: playerNumber,
            y: 150 // Default paddle position
        };

        console.log(`Player ${playerId} joined room ${roomCode} as Player ${playerNumber}`);
        return playerNumber;
    }

    // Get room details
    getRoomDetails(roomCode) {
        return this.rooms[roomCode] || null;
    }

    // Update player paddle position
    updatePlayerPosition(roomCode, playerId, y) {
        const room = this.rooms[roomCode];
        if (room && room.players[playerId]) {
            room.players[playerId].y = y;
            return true;
        }
        return false;
    }

    // Check if room is ready to start (has 2 players)
    isRoomReady(roomCode) {
        const room = this.rooms[roomCode];
        return room && Object.keys(room.players).length === 2;
    }

    // Start game in a specific room
    startGame(roomCode) {
        const room = this.rooms[roomCode];
        if (room) {
            room.gameStarted = true;
            return true;
        }
        return false;
    }

    // Remove a player from a room
    removePlayer(roomCode, playerId) {
        const room = this.rooms[roomCode];
        if (room && room.players[playerId]) {
            delete room.players[playerId];
            
            // Reset game state if a player leaves
            room.gameStarted = false;

            console.log(`Player ${playerId} removed from room ${roomCode}`);
            return true;
        }
        return false;
    }

    // Close and clean up a room
    closeRoom(roomCode) {
        if (this.rooms[roomCode]) {
            delete this.rooms[roomCode];
            console.log(`Room ${roomCode} closed`);
            return true;
        }
        return false;
    }

    // Get all players in a room
    getPlayers(roomCode) {
        const room = this.rooms[roomCode];
        return room ? room.players : {};
    }
}

module.exports = PongResourceManager;
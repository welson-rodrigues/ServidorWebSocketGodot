// ========================
// Servidor Multiplayer Simples para Godot
// Criado pelo Zee GameDev lindo de mãe
// ========================

// Importa as dependências
const express = require("express");  // Framework para criar um servidor HTTP simples
const WebSocket = require("ws");     // Biblioteca para trabalhar com WebSockets
const { v4: uuidv4 } = require("uuid"); // Gera IDs únicos para identificar cada jogador

// Cria o app Express e inicia o servidor HTTP
const app = express();
const PORT = process.env.PORT || 9090;
const server = app.listen(PORT, () => {
    console.log(`Servidor iniciado na porta: ${PORT}`);
});

// Cria o servidor WebSocket em cima do servidor HTTP
const wss = new WebSocket.Server({ server });

// "rooms" é um Map que guarda todas as salas criadas
// cada sala tem um código e a lista de jogadores conectados
const rooms = new Map();

// Função que gera um código aleatório para a sala (ex: 8GJ9Q)
function generateRoomCode(length = 5) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

// Lista de jogadores conectados
// Guarda posição (x,y) e a sala que pertence
const playerlist = {
    players: [],
    
    getAll: function() {
        return this.players;
    },
    
    get: function(uuid) {
        return this.players.find(player => player.uuid === uuid);
    },
    
    // Adiciona um novo jogador ao playerlist
    add: function(uuid, roomCode) {
        // Descobre se é o primeiro jogador da sala
        const playersInRoom = this.getByRoom(roomCode);
        const isFirstPlayer = playersInRoom.length === 0;

        // Define posição inicial para o jogador
        // Jogador 1 começa na esquerda, Jogador 2 na direita
        let player = {
            uuid,
            room: roomCode,
            x: isFirstPlayer ? 550 : 700,
            y: 300,
        };

        this.players.push(player);
        return player;
    },
    
    // Atualiza a posição de um jogador específico
    update: function(uuid, newX, newY, newZ, newRY) {
    const player = this.get(uuid);

    if (player) {
        player.x = newX;
        player.y = newY;
        player.z = newZ;
        player.r_y = newRY;
    }
},

    
    // Remove jogador da lista quando ele sai
    remove: function(uuid) {
        this.players = this.players.filter(player => player.uuid !== uuid);
    },
    
    // Retorna todos os jogadores de uma sala específica
    getByRoom: function(roomCode) {
        return this.players.filter(player => player.room === roomCode);
    }
};

// ========================================
// Evento disparado quando um cliente conecta
// ========================================
wss.on("connection", (socket) => {
    const uuid = uuidv4();  // Gera ID único para o cliente
    socket.uuid = uuid;
    console.log(`Cliente conectado: ${uuid}`);

    // Envia o UUID para o cliente assim que ele conecta
    socket.send(JSON.stringify({ 
        cmd: "joined_server", 
        content: { uuid: uuid } 
    }));

    // ========================================
    // Recebe mensagens do cliente
    // ========================================
    socket.on("message", (message) => {
        let data;
        try { 
            data = JSON.parse(message.toString()); 
        } catch (err) { 
            console.error("Erro ao parsear mensagem:", err);
            return; 
        }

        switch (data.cmd) {
            case "create_room": {
                // Gera novo código e cria sala
                const newRoomId = generateRoomCode();
                socket.roomId = newRoomId;
                rooms.set(newRoomId, { players: {} });
                rooms.get(newRoomId).players[uuid] = socket;
                
                // Adiciona o jogador à lista
                const newPlayer = playerlist.add(uuid, newRoomId);
                
                console.log(`Sala ${newRoomId} criada pelo jogador ${uuid}`);
                
                // Responde ao cliente com o código da sala
                socket.send(JSON.stringify({ 
                    cmd: "room_created", 
                    content: { code: newRoomId } 
                }));
                
                // Manda o jogador spawnar a si mesmo
                socket.send(JSON.stringify({
                    cmd: "spawn_local_player",
                    content: { player: newPlayer }
                }));
                break;
            }
            
            case "join_room": {
                const roomCode = data.content.code.toUpperCase();
                const roomToJoin = rooms.get(roomCode);
                
                if (!roomToJoin) {
                    socket.send(JSON.stringify({ 
                        cmd: "error", 
                        content: { msg: "Sala não encontrada." } 
                    }));
                    return;
                }
                
                // Adiciona o jogador na sala
                socket.roomId = roomCode;
                roomToJoin.players[uuid] = socket;
                
                const newPlayer = playerlist.add(uuid, socket.roomId);
                
                console.log(`Jogador ${uuid} entrou na sala ${socket.roomId}`);
                
                // Informa o jogador que entrou com sucesso
                socket.send(JSON.stringify({ 
                    cmd: "room_joined", 
                    content: { code: socket.roomId } 
                }));
                
                // Spawna o jogador local no cliente
                socket.send(JSON.stringify({
                    cmd: "spawn_local_player",
                    content: { player: newPlayer }
                }));
                
                // Envia a lista dos jogadores já existentes na sala
                const roomPlayers = playerlist.getByRoom(socket.roomId)
                    .filter(p => p.uuid !== uuid);
                
                socket.send(JSON.stringify({
                    cmd: "spawn_network_players",
                    content: { players: roomPlayers }
                }));
                
                // Avisa os jogadores antigos que entrou um novo player
                for (const clientUuid in roomToJoin.players) {
                    const client = roomToJoin.players[clientUuid];
                    if (client !== socket && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ 
                            cmd: "spawn_new_player", 
                            content: { player: newPlayer } 
                        }));
                    }
                }

                // Quando há 2 ou mais jogadores na sala, começa o jogo
                // Troque o "length >= 2" pelo número de jogadores que você quer na sala
                if (Object.keys(roomToJoin.players).length >= 2) {
                    console.log(`Sala ${socket.roomId} atingiu o número de jogadores. Começando o jogo!`);
                    for (const clientUuid in roomToJoin.players) {
                        const client = roomToJoin.players[clientUuid];
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                cmd: "start_game",
                                content: {}
                            }));
                        }
                    }
                }
                break;
            }
            case "position": {
    playerlist.update(
        uuid,
        data.content.x,
        data.content.y,
        data.content.z,
        data.content.r_y
    );
                const room = rooms.get(socket.roomId);
                if (room) {
                    // Repassa para os outros jogadores da sala
                    for (const clientUuid in room.players) {
                        const client = room.players[clientUuid];
                        if (client !== socket && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
    cmd: "update_position",
    content: {
        uuid: uuid,
        x: data.content.x,
        y: data.content.y,
        z: data.content.z,
        r_y: data.content.r_y
    }
}));
                                }
                            }));
                        }
                    }
                }
                break;
            }
            
            case "chat": {
                // Repassa a mensagem de chat para todos os jogadores na sala
                const room = rooms.get(socket.roomId);
                if (room) {
                    for (const clientUuid in room.players) {
                        const client = room.players[clientUuid];
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                cmd: "new_chat_message",
                                content: {
                                    uuid: uuid,
                                    msg: data.content.msg
                                }
                            }));
                        }
                    }
                }
                break;
            }
        }
    });

    // ========================================
    // Evento disparado quando o cliente desconecta
    // ========================================
    socket.on("close", () => {
        console.log(`Cliente desconectado: ${uuid}`);
        
        playerlist.remove(uuid);
        
        const room = rooms.get(socket.roomId);
        if (room) {
            delete room.players[uuid];
            
            // Avisa os outros jogadores que alguém saiu
            for (const clientUuid in room.players) {
                const client = room.players[clientUuid];
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ 
                        cmd: "player_disconnected", 
                        content: { uuid: uuid } 
                    }));
                }
            }
            
            // Remove a sala se ela ficou vazia
            if (Object.keys(room.players).length === 0) {
                rooms.delete(socket.roomId);
                console.log(`Sala ${socket.roomId} vazia e removida.`);
            }
        }
    });
});

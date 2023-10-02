import mineflayer from 'mineflayer';
import path from 'mineflayer-pathfinder';
import express from 'express';
import fs from 'fs'
import WebSocket, { WebSocketServer } from 'ws';

const SERVER_PORT = 25565;
const PASSWORD = 'ikea';
const pathfinder = path.pathfinder;
const Movements = path.Movements;
const { GoalBlock } = path.goals;

class IkeaControl {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.host = 'play.6b6t.org';
    this.port = 25565;
    this.version = '1.18';
    this.loggedIn = false;
    this.connections = new Map();

    this.initApp();
    this.initWebSocket();
  }

  initApp() {
    this.app = express();
    this.app.use(express.json());

    this.app.all('/', (req, res) => {
      res.send('success');
    });

    this.server = this.app.listen(SERVER_PORT, () => {
      console.log(`Server listening at http://localhost:${SERVER_PORT}`);
    });
  }

  initWebSocket() {
    this.wss = new WebSocketServer({ noServer: true });

    this.server.on('upgrade', (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.handleWebSocketConnection(ws, request);
      });
    });

    let host = this.server.address().address
    console.log(`WebSocket server is running on http://${host}:${SERVER_PORT}`);
  }

  handleWebSocketConnection(ws, request) {
    const urlParams = new URLSearchParams(request.url.slice(request.url.indexOf('?') + 1));
    const password = urlParams.get('password');

    let ip = null;
    if (password === PASSWORD) {
      this.connections.set(ws, true);
      this.handleMessages(ws, request);
      ip = request.socket.remoteAddress.replace("::ffff:", "");
      console.log(`${ip} connected to the websocket`);
    }

    ws.on('close', () => {
      if (this.connections.has(ws)) {
        this.connections.delete(ws);
      }
    });
  }

  handleMessages(ws, request) {
    ws.on('message', (message) => {
      const data = JSON.parse(message.toString());
      if (data.type === 'ping') {
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: Math.floor(new Date().getTime() / 1000)
        }))
      } else if (data.type === 'start') {
        this.initBot();
        ws.send(JSON.stringify({
          type: 'log',
          message: `Started bot for {white}${this.username}{gray}`
        }))
      } else if (data.type === 'exit') {
        this.endWebsocket();
      } else if (data.type === 'chat') {
        try {
          this.bot.chat(data.text);
        } catch {}
      } else if (data.type === 'goto') {
        let pos = data['pos'];
        try {
          this.bot.pathfinder.setGoal(new GoalBlock(pos[0], pos[1], pos[2]));
        } catch (e) {
          ws.send(JSON.stringify({
            type: 'log',
            message: `[{white}${this.username}{gray}] An error occurred in goto: ${e}`
          }))
        }
      }
    });
  }

  endWebsocket() {
    this.connections.forEach((value, connection) => {
      if (connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify({
          type: 'log',
          message: 'Ending connection',
        }));
        connection.close();
      }
    });

    this.server.close(() => {
      process.exit(0);
    });
  }

  // Init bot instance
  initBot() {
    this.bot = mineflayer.createBot({
      username: this.username,
      host: this.host,
      port: this.port,
      version: this.version,
      skipValidation: true,
      hideErrors: false,
      chatLengthLimit: 9999,
      checkTimeoutInterval: 120 * 1000
    });

    this.loginCount = 0;
    this.loggedIn = false;
    this.bot.loadPlugin(pathfinder);
    this.initEvents();
  }

  // Logger
  log(...msg) {
    console.log(`[${this.username}]`, ...msg);
  }

  sendData(data) {
    this.connections.forEach((value, connection) => {
      if (connection.readyState === WebSocket.OPEN) {
        connection.send(data);
      }
    });
  }

  // Init bot events
  initEvents() {
    this.bot.on('login', async () => {
      console.log(this.loginCount)
      try {
        this.bot.chat(`/login ${this.password}`);
      } catch { }
      await this.bot.waitForTicks(80);
      this.bot.setControlState('forward', true);
      this.loginCount += 1;

      if (this.loginCount === 2) {
        this.bot.pathfinder.setMovements(new Movements(this.bot));
        this.loginCount = 0;
        this.bot.setControlState('forward', false);
        await this.bot.waitForTicks(60);
        this.loggedIn = true;
        this.sendData(JSON.stringify({
          type: 'log',
          message: `Bot {white}${this.username}{gray} has joined 6b6t`
        }))
      }
    });

    this.bot.on('goal_reached', (goal) => {
      this.sendData(JSON.stringify({
        type: 'log',
        message: `[{white}${this.username}{gray}] Goal reached`
      }))
    })

    this.bot.on('path_update', (path) => {
      if (path.status === 'success') {
        this.sendData(JSON.stringify({
          type: 'log',
          message: `[{white}${this.username}{gray}] Path found`
        }))
      }
    })

    this.bot.on('kicked', async (reason) => {
      this.bot.end();
    });

    this.bot.on('error', async (err) => {
      if (err.code === 'ECONNREFUSED') {
        this.bot.end()
      } else {
        this.bot.end()
      }
    });

    this.bot.on('end', async (reason) => {
      this.bot.removeAllListeners();
      setTimeout(() => this.initBot(), 2000);
      if (this.loggedIn === true) {
        this.sendData(JSON.stringify({
          type: 'log',
          message: `Bot ${this.username} got kicked with reason ${reason}`
        }))
        this.loggedIn = false;
      }
    });
  }
}

let accounts = fs.readFileSync('./accounts.txt', 'utf-8').split('\n');
for (let account of accounts) {
  let [name, pass] = account.split(':');
  new IkeaControl(name, pass)
}

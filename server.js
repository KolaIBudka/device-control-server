const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store connected clients and devices
const connectedClients = new Map();
const connectedDevices = new Map();

// User database with roles
const users = {
  'admin': {
    password: 'admin123',
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    role: 'admin',
    username: 'admin'
  },
  'user1': {
    password: 'user123', 
    id: 'b2c3d4e5-f6g7-8901-bcde-f23456789012',
    role: 'user',
    username: 'user1'
  }
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve Socket.IO client library
app.get('/socket.io/socket.io.js', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'node_modules', 'socket.io-client', 'dist', 'socket.io.js'));
});

// Authentication endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  console.log('Login attempt:', username);
  
  const user = users[username];
  
  if (user && user.password === password) {
    console.log('Login successful:', username, 'Role:', user.role);
    res.json({ 
      success: true, 
      message: 'Login successful',
      user: {
        username: user.username,
        id: user.id,
        role: user.role
      }
    });
  } else {
    console.log('Login failed:', username);
    res.status(401).json({ 
      success: false, 
      message: 'Invalid credentials' 
    });
  }
});

// Health check endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    clients: Array.from(connectedClients.values()),
    devices: Array.from(connectedDevices.values()),
    timestamp: new Date().toISOString()
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Send welcome message
  socket.emit('welcome', { 
    message: 'Connected to server successfully',
    socketId: socket.id,
    timestamp: new Date().toISOString()
  });

  // Client login
  socket.on('client-login', (userData) => {
    console.log('Client login:', userData.username, 'Role:', userData.role);
    
    const clientInfo = {
      ...userData,
      socketId: socket.id,
      type: 'client',
      connectedAt: new Date().toISOString(),
      role: userData.role || 'user'
    };
    
    connectedClients.set(socket.id, clientInfo);
    
    socket.emit('login-success', { 
      message: 'Logged in successfully',
      role: userData.role
    });
    
    // Send current devices list to the client
    socket.emit('devices-update', Array.from(connectedDevices.values()));
    
    // Update all dashboard clients with new clients list
    io.emit('clients-update', Array.from(connectedClients.values()));
    
    console.log('Connected clients:', connectedClients.size);
  });

  // Device registration
  socket.on('device-register', (deviceData) => {
    const deviceId = Math.random().toString(36).substr(2, 9);
    
    const deviceInfo = {
      ...deviceData,
      deviceId,
      socketId: socket.id,
      status: 'connected',
      type: 'device',
      ipAddress: null,
      registeredAt: new Date().toISOString()
    };
    
    connectedDevices.set(socket.id, deviceInfo);
    
    console.log('Device registered:', deviceId);
    
    socket.emit('device-registered', {
      deviceId,
      success: true,
      message: 'Device registered successfully'
    });
    
    // Notify all clients about new device
    io.emit('device-connected', {
      deviceId: deviceInfo.deviceId,
      deviceName: deviceInfo.name,
      message: 'New device connected'
    });
    
    // Update all clients with new devices list
    io.emit('devices-update', Array.from(connectedDevices.values()));
    
    console.log('Connected devices:', connectedDevices.size);
  });

  // Start command from client
  socket.on('start-command', (data) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      socket.emit('error', 'Not authenticated');
      return;
    }

    // Check if user has permission (only admin can send commands)
    if (client.role !== 'admin') {
      socket.emit('error', 'Access denied. Admin privileges required.');
      return;
    }

    console.log('Start command from admin:', client.username);

    if (connectedDevices.size > 0) {
      let commandsSent = 0;
      
      connectedDevices.forEach((device, deviceSocketId) => {
        io.to(deviceSocketId).emit('start-device', {
          command: 'start',
          from: client.username,
          clientSocketId: socket.id,
          timestamp: new Date().toISOString()
        });
        
        commandsSent++;
        console.log('Command sent to device:', device.deviceId);
      });
      
      socket.emit('command-sent', {
        success: true,
        message: `Start command sent to ${commandsSent} device(s)`,
        devicesCount: commandsSent
      });
    } else {
      socket.emit('error', 'No devices connected');
    }
  });

  // Device sends IP
  socket.on('device-ip', (data) => {
    const device = connectedDevices.get(socket.id);
    if (!device) {
      console.log('IP received from unregistered device:', socket.id);
      return;
    }

    device.ipAddress = data.ip;
    device.status = 'ready';
    device.lastIPUpdate = new Date().toISOString();
    
    console.log('Device IP received:', device.deviceId, data.ip);
    
    // Notify all clients about device IP
    io.emit('device-ip-received', {
      deviceId: device.deviceId,
      ip: data.ip,
      message: 'Device IP address received'
    });
    
    // Update all clients with updated devices list
    io.emit('devices-update', Array.from(connectedDevices.values()));
  });

  // Get devices list
  socket.on('get-devices', () => {
    socket.emit('devices-update', Array.from(connectedDevices.values()));
  });

  // Get clients list
  socket.on('get-clients', () => {
    socket.emit('clients-update', Array.from(connectedClients.values()));
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log('Disconnected:', socket.id, 'Reason:', reason);
    
    const client = connectedClients.get(socket.id);
    if (client) {
      connectedClients.delete(socket.id);
      console.log('Client disconnected:', client.username);
      
      io.emit('client-disconnected', {
        username: client.username,
        message: 'Client disconnected'
      });
      
      // Update clients list
      io.emit('clients-update', Array.from(connectedClients.values()));
    }
    
    const device = connectedDevices.get(socket.id);
    if (device) {
      connectedDevices.delete(socket.id);
      console.log('Device disconnected:', device.deviceId);
      
      io.emit('device-disconnected', {
        deviceId: device.deviceId,
        message: 'Device disconnected'
      });
      
      io.emit('devices-update', Array.from(connectedDevices.values()));
    }

    console.log('Remaining - Clients:', connectedClients.size, 'Devices:', connectedDevices.size);
  });

  // Error handling
  socket.on('error', (error) => {
    console.error('Socket error:', socket.id, error);
  });
});

// Start server
server.listen(PORT, () => {
  console.log('🚀 ========================================');
  console.log('🚀 Server running on port', PORT);
  console.log('🚀 ========================================');
  console.log('📍 Access the server at: http://localhost:' + PORT);
  console.log('👤 Demo accounts:');
  console.log('   - admin / admin123 (Admin privileges)');
  console.log('   - user1 / user123 (User - limited access)');
  console.log('📱 Waiting for clients and devices...');
  console.log('============================================');
});
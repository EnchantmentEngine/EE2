# EE2

## Overview

EE2 is a real-time multiplayer 3D application with WebXR (Augmented Reality) support. It combines BabylonJS for 3D rendering, Colyseus for multiplayer state management, and WebRTC for peer-to-peer video/audio communication.

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client (Browser)                     │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────┐│
│  │ BabylonJS  │  │   Colyseus   │  │  WebRTC Peers       ││
│  │ 3D Engine  │  │   Client     │  │  (Video/Audio)      ││
│  │ + WebXR    │  │              │  │                      ││
│  └────────────┘  └──────────────┘  └──────────────────────┘│
│         │               │                      │             │
└─────────┼───────────────┼──────────────────────┼─────────────┘
          │               │                      │
          │         WebSocket (State)            │
          │               │                 P2P Connection
          │               │                      │
┌─────────┴───────────────┴──────────────────────┴─────────────┐
│                    Server (Node.js)                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │            Colyseus Game Server                         │ │
│  │  • Player State Management                              │ │
│  │  • Position Synchronization                             │ │
│  │  • WebRTC Signaling Relay                               │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### **Server (Node.js + Colyseus)**
- **Technology**: TypeScript, Colyseus Arena
- **Location**: `/server` directory
- **Key Components**:
  - `MyRoom`: Game room managing up to 10 concurrent players
  - `MyRoomState`: Synchronized state containing player positions (x, y, z)
  - WebRTC signaling: Relays offer/answer/ICE candidates between peers

#### **Client (BabylonJS + Colyseus Client + WebRTC)**
- **Technology**: TypeScript, BabylonJS, Webpack
- **Location**: `/client` directory
- **Key Components**:
  - `Menu`: Room creation/joining interface
  - `Game`: Main game loop and multiplayer logic
  - **3D Rendering**: BabylonJS scene with player spheres
  - **WebXR Support**: Optional AR mode with desktop fallback
  - **WebRTC**: Peer-to-peer video/audio streams displayed above players

### Multiplayer System

#### State Synchronization (via Colyseus)
1. **Player Spawning**: Random position within 500x500 game area
2. **Position Updates**: Click-to-move system sends coordinates to server
3. **State Broadcasting**: Server broadcasts all player positions to all clients
4. **Client Interpolation**: Smooth movement via `Vector3.Lerp`

#### Communication Flow
```
Client A clicks ground → Send "updatePosition" to server
                              ↓
                         Server updates state
                              ↓
                    State broadcast to all clients
                              ↓
              All clients interpolate to new positions
```

### WebRTC Video/Audio System

#### P2P Architecture
- **Mesh Topology**: Each client connects directly to every other client
- **Maximum Peers**: 10 clients = 45 peer connections (n*(n-1)/2)
- **Signaling**: Coordinated via Colyseus server messages

#### Connection Flow
```
1. Client joins room → Get local media (video/audio)
2. For each remote player:
   a. Create RTCPeerConnection
   b. Add local media tracks
   c. If higher sessionId → Send offer
   d. Exchange ICE candidates via server
3. On remote track received → Create video texture above player
```

#### Video Display
- 3D plane mesh with VideoTexture material
- Billboard mode (always faces camera)
- Positioned 50 units above player sphere
- Audio enabled for voice chat

### WebXR (AR) System

#### Session Detection
1. Check if `immersive-ar` WebXR session is supported
2. If supported → Initialize WebXR with BabylonJS
3. If not supported → Fallback to ArcRotateCamera (desktop mode)

#### AR vs Desktop Mode
- **AR Mode**: No skybox, semi-transparent ground for real-world overlay
- **Desktop Mode**: Full skybox, standard 3D scene with camera controls

## How to Run

### Prerequisites
- **Node.js LTS** (v16+ recommended)
- **npm** (comes with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/EnchantmentEngine/EE2.git
cd EE2

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### Running the Application

#### Option 1: Run Both Server and Client

**Terminal 1 - Start the Server**:
```bash
cd server
npm start
```
Server will start on `ws://localhost:2567`
Monitor interface available at `http://localhost:2567/colyseus`

**Terminal 2 - Start the Client**:
```bash
cd client
npm start
```
Client will be accessible at `http://localhost:8080`

#### Option 2: Production Build

**Build the Client**:
```bash
cd client
npm run build
```
This creates optimized production files in the `dist/` directory.

### Testing

**Run Server Tests**:
```bash
cd server
npm test
```

Tests include:
- ✅ Multiplayer room lifecycle
- ✅ Player state management
- ✅ WebRTC signaling support
- ✅ Message handler validation

### Usage

1. Open `http://localhost:8080` in your browser
2. Choose an option:
   - **CREATE GAME**: Create a new room
   - **JOIN GAME**: Join an existing room
   - **CREATE OR JOIN**: Automatically join or create
3. Once in game:
   - Click anywhere on the ground to move your player
   - See other players as gray spheres (you're orange)
   - Video/audio streams appear above players (if media permitted)
4. **For AR Mode** (mobile devices with AR support):
   - Grant camera permissions
   - Tap the AR button when prompted
   - See players overlaid in your real environment

## Project Structure

```
EE2/
├── client/                 # Frontend application
│   ├── src/
│   │   ├── app.ts         # Application entry point
│   │   ├── menu.ts        # Room selection UI
│   │   ├── game.ts        # Main game logic, multiplayer, WebRTC
│   │   └── utils.ts       # Helper functions (skybox)
│   ├── public/            # Static assets (images, textures)
│   ├── index.html         # HTML entry point
│   ├── package.json
│   └── webpack.config.js  # Build configuration
│
├── server/                # Backend application
│   ├── src/
│   │   ├── index.ts       # Server entry point
│   │   ├── arena.config.ts # Colyseus configuration
│   │   └── rooms/
│   │       ├── MyRoom.ts  # Game room logic
│   │       └── schema/
│   │           └── MyRoomState.ts # State schema
│   ├── test/              # Server tests
│   │   ├── MyRoom_test.ts
│   │   └── WebRTC_signaling_test.ts
│   ├── package.json
│   └── tsconfig.json
│
└── README.md              # This file
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **3D Engine** | BabylonJS | Scene rendering, physics, WebXR |
| **State Sync** | Colyseus | Multiplayer state management |
| **P2P Communication** | WebRTC | Video/audio streaming |
| **Server** | Node.js + Express | WebSocket server, signaling |
| **Language** | TypeScript | Type-safe development |
| **Build** | Webpack | Client bundling |
| **Testing** | Mocha + Chai | Server-side testing |

## Configuration

### Server Configuration
- **Port**: 2567 (configurable via `PORT` environment variable)
- **Max Clients per Room**: 10
- **Environment Files**: `development.env`, `arena.env`

### Client Configuration
- **Server Endpoint**: `ws://localhost:2567` (see `client/src/menu.ts`)
- **WebRTC**: Uses Google STUN server for NAT traversal
- **Ground Size**: 500x500 units
- **Player Spawn**: Random within ±250 units from center

## Security Considerations

- **WebRTC Signaling Validation**: Server validates all signal messages
- **Input Sanitization**: Position updates clamped to game boundaries
- **Session Management**: Colyseus handles secure session IDs

## Troubleshooting

**Video/Audio Not Working**:
- Grant camera/microphone permissions when prompted
- Check browser console for WebRTC errors
- Ensure HTTPS for production (HTTP works for localhost)

**AR Mode Not Available**:
- AR requires WebXR-compatible device (recent Android/iOS)
- Desktop browsers will automatically use fallback camera

**Connection Issues**:
- Verify server is running on port 2567
- Check firewall settings
- Ensure client endpoint matches server address

## License

MIT

## Credits

Based on the BabylonJS + Colyseus tutorial. Enhanced with WebXR support and WebRTC integration.

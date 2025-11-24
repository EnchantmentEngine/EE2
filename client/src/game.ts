import * as BABYLON from 'babylonjs';
import * as GUI from 'babylonjs-gui';
import { Room } from "colyseus.js";

import Menu from "./menu";
import { createSkyBox } from "./utils";

const GROUND_SIZE = 500;
const BOUNDARY_LIMIT = 245; // Position boundary limit
const KEYBOARD_SPEED = 5; // Movement speed for keyboard controls
const JOYSTICK_SPEED = 3; // Movement speed for joystick controls

// WebRTC Configuration
const RTC_CONFIG = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export default class Game {
    private canvas: HTMLCanvasElement;
    private engine: BABYLON.Engine;
    private scene: BABYLON.Scene;
    private camera: BABYLON.Camera; // Generic camera to support WebXR
    private light: BABYLON.Light;

    private room: Room<any>;
    private playerEntities: { [playerId: string]: BABYLON.Mesh } = {};
    private playerNextPosition: { [playerId: string]: BABYLON.Vector3 } = {};
    
    // WebRTC Properties
    private localStream: MediaStream | null = null;
    private peers: { [sessionId: string]: RTCPeerConnection } = {};
    private videoMeshes: { [sessionId: string]: BABYLON.Mesh } = {};

    // Mobile/Desktop Controls
    private isMobile: boolean = false;
    private virtualJoystick: GUI.Ellipse | null = null;
    private joystickContainer: GUI.Ellipse | null = null;
    private joystickActive: boolean = false;
    private joystickOffset: BABYLON.Vector2 = BABYLON.Vector2.Zero();
    private keyboardMovement: BABYLON.Vector3 = BABYLON.Vector3.Zero();

    constructor(canvas: HTMLCanvasElement, engine: BABYLON.Engine, room: Room<any>) {
        this.canvas = canvas;
        this.engine = engine;
        this.room = room;
        
        // Detect mobile device
        this.isMobile = this.detectMobileDevice();
    }

    private detectMobileDevice(): boolean {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
            || (window.innerWidth <= 768);
    }

    initPlayers(): void {
        this.room.state.players.onAdd((player: any, sessionId: string) => {
            const isCurrentPlayer = (sessionId === this.room.sessionId);

            const sphere = BABYLON.MeshBuilder.CreateSphere(`player-${sessionId}`, {
                segments: 16,
                diameter: 40
            }, this.scene);

            // Set player mesh properties
            const sphereMaterial = new BABYLON.StandardMaterial(`playerMat-${sessionId}`, this.scene);
            sphereMaterial.emissiveColor = (isCurrentPlayer) ? BABYLON.Color3.FromHexString("#ff9900") : BABYLON.Color3.Gray();
            sphere.material = sphereMaterial;

            // Set player spawning position
            sphere.position.set(player.x, player.y, player.z);

            this.playerEntities[sessionId] = sphere;
            this.playerNextPosition[sessionId] = sphere.position.clone();

            // update local target position
            player.onChange(() => {
                this.playerNextPosition[sessionId].set(player.x, player.y, player.z);
            });

            // WebRTC Connection Logic
            if (!isCurrentPlayer) {
                this.createPeerConnection(sessionId);
            }
        });

        this.room.state.players.onRemove((player: any, sessionId: string) => {
            if (this.playerEntities[sessionId]) {
                this.playerEntities[sessionId].dispose();
                delete this.playerEntities[sessionId];
                delete this.playerNextPosition[sessionId];
            }
            if (this.peers[sessionId]) {
                this.peers[sessionId].close();
                delete this.peers[sessionId];
            }
            if (this.videoMeshes[sessionId]) {
                this.videoMeshes[sessionId].dispose();
                delete this.videoMeshes[sessionId];
            }
        });

        this.room.onLeave(code => {
            this.gotoMenu();
        })
    }

    createGround(): void {
        // Create ground plane (transparent for AR mode)
        const plane = BABYLON.MeshBuilder.CreatePlane("plane", { size: GROUND_SIZE }, this.scene);
        plane.position.y = -15;
        plane.rotation.x = Math.PI / 2;

        let floorPlane = new BABYLON.StandardMaterial('floorTexturePlane', this.scene);
        floorPlane.diffuseTexture = new BABYLON.Texture('./public/ground.jpg', this.scene);
        floorPlane.backFaceCulling = false; // Always show the front and the back of an element
        floorPlane.alpha = 0.5; // Semi-transparent for AR

        let materialPlane = new BABYLON.MultiMaterial('materialPlane', this.scene);
        materialPlane.subMaterials.push(floorPlane);

        plane.material = materialPlane;
    }

    displayGameControls() {
        const advancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI("textUI");

        const playerInfo = new GUI.TextBlock("playerInfo");
        playerInfo.text = `Room: ${this.room.name}      Player: ${this.room.sessionId}`.toUpperCase();
        playerInfo.color = "#eaeaea";
        playerInfo.fontFamily = "Roboto";
        playerInfo.fontSize = this.isMobile ? 14 : 20;
        playerInfo.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        playerInfo.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        playerInfo.paddingTop = "10px";
        playerInfo.paddingLeft = "10px";
        playerInfo.outlineColor = "#000000";
        advancedTexture.addControl(playerInfo);

        const instructions = new GUI.TextBlock("instructions");
        if (this.isMobile) {
            instructions.text = "USE JOYSTICK TO MOVE OR TAP GROUND!";
        } else {
            instructions.text = "CLICK GROUND TO MOVE OR USE WASD KEYS!";
        }
        instructions.color = "#fff000"
        instructions.fontFamily = "Roboto";
        instructions.fontSize = this.isMobile ? 16 : 24;
        instructions.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        instructions.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        instructions.paddingBottom = "10px";
        advancedTexture.addControl(instructions);

        // back to menu button
        const button = GUI.Button.CreateImageWithCenterTextButton("back", "<- BACK", "./public/btn-default.png");
        button.width = this.isMobile ? "80px" : "100px";
        button.height = this.isMobile ? "40px" : "50px";
        button.fontFamily = "Roboto";
        button.fontSize = this.isMobile ? "12px" : "16px";
        button.thickness = 0;
        button.color = "#f8f8f8";
        button.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        button.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        button.paddingTop = "10px";
        button.paddingRight = "10px";
        button.onPointerClickObservable.add(async () => {
            // Clean up local media streams
            if (this.localStream) {
                this.localStream.getTracks().forEach(t => t.stop());
            }
            await this.room.leave(true);
        });
        advancedTexture.addControl(button);

        // Add virtual joystick for mobile
        if (this.isMobile) {
            this.createVirtualJoystick(advancedTexture);
        }
    }

    private createVirtualJoystick(advancedTexture: GUI.AdvancedDynamicTexture): void {
        // Joystick container (outer circle)
        this.joystickContainer = new GUI.Ellipse("joystickContainer");
        this.joystickContainer.width = "120px";
        this.joystickContainer.height = "120px";
        this.joystickContainer.color = "white";
        this.joystickContainer.thickness = 4;
        this.joystickContainer.background = "rgba(0, 0, 0, 0.3)";
        this.joystickContainer.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.joystickContainer.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.joystickContainer.left = 60;
        this.joystickContainer.top = -60;
        advancedTexture.addControl(this.joystickContainer);

        // Joystick thumb (inner circle)
        this.virtualJoystick = new GUI.Ellipse("joystickThumb");
        this.virtualJoystick.width = "60px";
        this.virtualJoystick.height = "60px";
        this.virtualJoystick.color = "white";
        this.virtualJoystick.thickness = 3;
        this.virtualJoystick.background = "rgba(255, 255, 255, 0.6)";
        this.joystickContainer.addControl(this.virtualJoystick);

        // Joystick touch handling
        this.joystickContainer.onPointerDownObservable.add((coords) => {
            this.joystickActive = true;
        });

        this.joystickContainer.onPointerUpObservable.add(() => {
            this.joystickActive = false;
            this.joystickOffset = BABYLON.Vector2.Zero();
            if (this.virtualJoystick) {
                this.virtualJoystick.left = 0;
                this.virtualJoystick.top = 0;
            }
        });

        this.joystickContainer.onPointerMoveObservable.add((coords) => {
            if (this.joystickActive && this.virtualJoystick && this.joystickContainer) {
                // Get container size
                const containerSize = 120;
                const maxDistance = 30; // Half of thumb movement range

                // Calculate offset from center
                const centerX = parseInt(this.joystickContainer.leftInPixels.toString()) + containerSize / 2;
                const centerY = parseInt(this.joystickContainer.topInPixels.toString()) + containerSize / 2;
                
                let deltaX = coords.x - centerX;
                let deltaY = coords.y - centerY;

                // Limit thumb movement
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                if (distance > maxDistance) {
                    deltaX = (deltaX / distance) * maxDistance;
                    deltaY = (deltaY / distance) * maxDistance;
                }

                // Update thumb position
                this.virtualJoystick.left = deltaX;
                this.virtualJoystick.top = deltaY;

                // Store normalized offset for movement
                this.joystickOffset.x = deltaX / maxDistance;
                this.joystickOffset.y = deltaY / maxDistance;
            }
        });
    }

    async bootstrap(): Promise<void> {
        this.scene = new BABYLON.Scene(this.engine);
        this.light = new BABYLON.HemisphericLight("pointLight", new BABYLON.Vector3(0, 1, 0), this.scene);

        // 1. Get Local Video/Audio
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (e) {
            console.error("Could not get user media:", e);
        }

        // 2. Setup WebXR (AR)
        await this.initXR();

        // 3. Setup Scene Objects
        this.createGround();
        this.displayGameControls();
        
        // 4. Initialize Multiplayer & WebRTC
        this.initPlayers();
        this.initSignalHandler();

        // 5. Input Logic
        this.initInputHandlers();

        this.doRender();
    }

    private initInputHandlers(): void {
        // Mouse/Touch click to move
        this.scene.onPointerDown = (event, pointer) => {
            // Only handle left mouse button or touch
            if (event.button == 0) {
                // Ignore clicks on joystick
                if (this.joystickActive) return;
                
                const pickInfo = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
                if (pickInfo.hit && pickInfo.pickedMesh?.name === "plane") {
                    const targetPosition = pickInfo.pickedPoint.clone();
                    this.updatePlayerPosition(targetPosition);
                }
            }
        };

        // Desktop keyboard controls (WASD)
        if (!this.isMobile) {
            this.initKeyboardControls();
        }
    }

    private initKeyboardControls(): void {
        const inputMap: { [key: string]: boolean } = {};
        
        this.scene.actionManager = new BABYLON.ActionManager(this.scene);

        // Key down events
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, (evt) => {
                inputMap[evt.sourceEvent.key.toLowerCase()] = true;
            })
        );

        // Key up events
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, (evt) => {
                inputMap[evt.sourceEvent.key.toLowerCase()] = false;
            })
        );

        // Movement processing in render loop
        this.scene.onBeforeRenderObservable.add(() => {
            let hasMovement = false;

            // Calculate movement direction
            let forward = 0;
            let right = 0;

            if (inputMap["w"] || inputMap["arrowup"]) {
                forward = 1;
                hasMovement = true;
            }
            if (inputMap["s"] || inputMap["arrowdown"]) {
                forward = -1;
                hasMovement = true;
            }
            if (inputMap["a"] || inputMap["arrowleft"]) {
                right = -1;
                hasMovement = true;
            }
            if (inputMap["d"] || inputMap["arrowright"]) {
                right = 1;
                hasMovement = true;
            }

            if (hasMovement) {
                const playerMesh = this.playerEntities[this.room.sessionId];
                if (playerMesh) {
                    // Get camera direction for movement relative to camera
                    const { forward: cameraDirection, right: cameraRight } = this.getCameraDirectionVectors();

                    // Calculate new position
                    const movement = cameraDirection.scale(forward * KEYBOARD_SPEED)
                        .add(cameraRight.scale(right * KEYBOARD_SPEED));
                    
                    const newPosition = playerMesh.position.add(movement);
                    this.updatePlayerPosition(newPosition);
                }
            }
        });
    }

    async initXR(): Promise<void> {
        // Check if WebXR AR is supported first
        const isARSupported = await BABYLON.WebXRSessionManager.IsSessionSupportedAsync('immersive-ar');
        
        if (isARSupported) {
            try {
                const xr = await this.scene.createDefaultXRExperienceAsync({
                    uiOptions: {
                        sessionMode: "immersive-ar",
                    },
                    optionalFeatures: true
                });
                console.log("WebXR AR initialized successfully");
                
                // Store reference to XR camera if needed
                if (xr.baseExperience.camera) {
                    this.camera = xr.baseExperience.camera;
                }
                return; // Exit early if WebXR initialized successfully
            } catch (error) {
                console.error("WebXR AR initialization failed:", error);
            }
        } else {
            console.log("WebXR AR not supported on this device");
        }

        // Fallback to standard camera if WebXR is not supported or failed
        console.log("Using desktop/mobile camera fallback");
        const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, 1.0, 550, BABYLON.Vector3.Zero(), this.scene);
        camera.setTarget(BABYLON.Vector3.Zero());
        camera.attachControl(this.canvas, true);
        
        // Optimize camera for mobile devices
        if (this.isMobile) {
            camera.lowerRadiusLimit = 300;
            camera.upperRadiusLimit = 800;
            camera.panningSensibility = 50; // Less sensitive panning for touch
            camera.pinchPrecision = 100; // Pinch to zoom sensitivity
            camera.wheelPrecision = 50; // Scroll zoom sensitivity
            // Adjust touch sensitivity using available properties
            camera.angularSensibilityX = 5000;
            camera.angularSensibilityY = 5000;
        } else {
            camera.lowerRadiusLimit = 200;
            camera.upperRadiusLimit = 1000;
        }
        
        this.camera = camera;
        createSkyBox(this.scene); // Only add skybox in non-AR
    }

    // WebRTC & Video Logic

    createPeerConnection(remoteSessionId: string): void {
        const pc = new RTCPeerConnection(RTC_CONFIG);
        this.peers[remoteSessionId] = pc;

        // Add local tracks to the connection
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream!));
        }

        // Handle incoming remote stream
        pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                this.addVideoMesh(remoteSessionId, event.streams[0]);
            }
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.room.send("signal", {
                    to: remoteSessionId,
                    type: "candidate",
                    payload: event.candidate
                });
            }
        };

        // Negotiation Strategy: The peer with the "higher" sessionId string initiates the offer.
        // This prevents both sides from offering simultaneously.
        if (this.room.sessionId > remoteSessionId) {
            console.log(`Initiating call to ${remoteSessionId}`);
            
            // Handle negotiation with proper state management
            let isNegotiating = false;
            pc.onnegotiationneeded = async () => {
                if (isNegotiating) {
                    console.log("Already negotiating, skipping...");
                    return;
                }
                
                isNegotiating = true;
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    this.room.send("signal", {
                        to: remoteSessionId,
                        type: "offer",
                        payload: offer
                    });
                } catch (err) {
                    console.error("Error creating offer:", err);
                } finally {
                    isNegotiating = false;
                }
            };
        }
    }

    initSignalHandler(): void {
        this.room.onMessage("signal", async (data: any) => {
            const { from, type, payload } = data;
            const pc = this.peers[from];
            
            if (!pc) {
                console.warn(`Received signal for unknown peer: ${from}`);
                return;
            }

            try {
                if (type === "offer") {
                    await pc.setRemoteDescription(new RTCSessionDescription(payload));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    this.room.send("signal", { to: from, type: "answer", payload: answer });
                } else if (type === "answer") {
                    await pc.setRemoteDescription(new RTCSessionDescription(payload));
                } else if (type === "candidate") {
                    await pc.addIceCandidate(new RTCIceCandidate(payload));
                }
            } catch (err) {
                console.error("Signaling error:", err);
            }
        });
    }

    addVideoMesh(sessionId: string, stream: MediaStream): void {
        if (this.videoMeshes[sessionId]) return;

        // Create a video element in memory
        const video = document.createElement("video");
        video.autoplay = true;
        video.muted = false; // Enable audio for voice chat
        video.playsInline = true;
        video.srcObject = stream;
        video.play().catch(e => {
            console.warn("Video autoplay blocked. User interaction required to enable video/audio.", e);
            console.info("Click anywhere on the page to enable video and audio playback.");
        });

        // Create Video Texture
        const videoTexture = new BABYLON.VideoTexture(`videoTex-${sessionId}`, video, this.scene, true, false);

        // Create Plane for Video
        const plane = BABYLON.MeshBuilder.CreatePlane(`videoPlane-${sessionId}`, {
            width: 40,
            height: 30
        }, this.scene);

        const mat = new BABYLON.StandardMaterial(`videoMat-${sessionId}`, this.scene);
        mat.diffuseTexture = videoTexture;
        mat.emissiveColor = new BABYLON.Color3(1, 1, 1); // Make it bright
        mat.backFaceCulling = false;
        plane.material = mat;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; // Always face camera

        // Attach to player mesh
        const playerMesh = this.playerEntities[sessionId];
        if (playerMesh) {
            plane.parent = playerMesh;
            plane.position.y = 50; // Float above head
        }

        this.videoMeshes[sessionId] = plane;
    }

    private getCameraDirectionVectors(): { forward: BABYLON.Vector3, right: BABYLON.Vector3 } {
        let cameraDirection = BABYLON.Vector3.Zero();
        let cameraRight = BABYLON.Vector3.Zero();
        
        if (this.camera && this.camera instanceof BABYLON.ArcRotateCamera) {
            const arcCamera = this.camera as BABYLON.ArcRotateCamera;
            cameraDirection = arcCamera.target.subtract(arcCamera.position).normalize();
            cameraDirection.y = 0; // Keep movement horizontal
            cameraDirection.normalize();
            cameraRight = BABYLON.Vector3.Cross(cameraDirection, BABYLON.Vector3.Up());
        } else {
            // Default to world axes if camera is not available
            cameraDirection = new BABYLON.Vector3(0, 0, 1);
            cameraRight = new BABYLON.Vector3(1, 0, 0);
        }
        
        return { forward: cameraDirection, right: cameraRight };
    }

    private clampToBoundaries(position: BABYLON.Vector3): BABYLON.Vector3 {
        const clampedPosition = position.clone();
        clampedPosition.y = -1;
        
        if (clampedPosition.x > BOUNDARY_LIMIT) clampedPosition.x = BOUNDARY_LIMIT;
        else if (clampedPosition.x < -BOUNDARY_LIMIT) clampedPosition.x = -BOUNDARY_LIMIT;
        if (clampedPosition.z > BOUNDARY_LIMIT) clampedPosition.z = BOUNDARY_LIMIT;
        else if (clampedPosition.z < -BOUNDARY_LIMIT) clampedPosition.z = -BOUNDARY_LIMIT;
        
        return clampedPosition;
    }

    private updatePlayerPosition(newPosition: BABYLON.Vector3): void {
        const clampedPosition = this.clampToBoundaries(newPosition);
        this.playerNextPosition[this.room.sessionId] = clampedPosition;

        // Send position update to server
        this.room.send("updatePosition", {
            x: clampedPosition.x,
            y: clampedPosition.y,
            z: clampedPosition.z,
        });
    }

    private gotoMenu() {
        this.scene.dispose();
        const menu = new Menu('renderCanvas');
        menu.createMenu();
    }

    private doRender(): void {
        // constantly lerp players
        this.scene.registerBeforeRender(() => {
            for (let sessionId in this.playerEntities) {
              const entity = this.playerEntities[sessionId];
              const targetPosition = this.playerNextPosition[sessionId];
              entity.position = BABYLON.Vector3.Lerp(entity.position, targetPosition, 0.05);
            }

            // Process joystick input for mobile
            if (this.isMobile && this.joystickActive && this.joystickOffset.length() > 0.1) {
                const playerMesh = this.playerEntities[this.room.sessionId];
                if (playerMesh) {
                    // Get camera direction for movement relative to camera
                    const { forward: cameraDirection, right: cameraRight } = this.getCameraDirectionVectors();

                    // Calculate movement from joystick
                    const movement = cameraDirection.scale(-this.joystickOffset.y * JOYSTICK_SPEED)
                        .add(cameraRight.scale(this.joystickOffset.x * JOYSTICK_SPEED));
                    
                    const newPosition = playerMesh.position.add(movement);
                    this.updatePlayerPosition(newPosition);
                }
            }
        });

        // Run the render loop.
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });

        // The canvas/window resize event handler.
        window.addEventListener('resize', () => {
            this.engine.resize();
        });
    }
}

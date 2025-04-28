// Constants
const WIDTH = 800;
const HEIGHT = 800;
const GRID_SIZE = 20;
const FPS = 60;
const MS_PER_FRAME = 1000 / FPS;

// Game state
let gameState = {
  budget: 10000,
  devices: [], // {type, x, y, capacity, cost, connections: []}
  cables: [],  // {startDevice, endDevice, cost, currentLoad, capacity}
  requests: [], // {source, destination, active, path, progress}
  menuOpen: false,
  selectedDeviceType: null,
  selectedDevice: null,
  isDrawingCable: false,
  cableStartDevice: null,
  gameTime: 0,
  targetRequests: 20, // Nombre cible de requêtes à traiter
  remainingRequests: 20, // Requêtes restantes à générer
  requestsProcessed: 0,
  requestsFailed: 0,
  mouseX: 0,
  mouseY: 0,
  gameStarted: false,
  lastFrameTime: 0
};

// Device types with their properties
const deviceTypes = {
  router: { capacity: 4, cost: 1500, img: 'asset\\router.png', description: 'Router' },
  switch: { capacity: 3, cost: 1000, img: 'asset\\switch.png', description: 'Switch' },
  server: { capacity: 5, cost: 2000, img: 'asset\\server.png', description: 'Server' },
  client: { capacity: 10, cost: 0, img: 'asset\\client.png', description: 'Client' }
};

// Cable types
const cableTypes = {
  copper: { speed: 1, cost: 5, color: '#8B4513', capacity: 3 },
  fiber: { speed: 2, cost: 10, color: '#00FF00', capacity: 5 }
};

// Cached elements
let canvas, ctx;
let offscreenCanvas, offscreenCtx; // Pour le double buffering

// Asset preloading system
const assetLoader = {
  assets: {},
  loaded: false,
  loadPromises: [],
  
  load() {
    for (const type in deviceTypes) {
      const img = new Image();
      const promise = new Promise(resolve => {
        img.onload = resolve;
        img.onerror = () => {
          // Fallback to placeholder if image fails to load
          const assetCanvas = document.createElement('canvas');
          assetCanvas.width = GRID_SIZE;
          assetCanvas.height = GRID_SIZE;
          const assetCtx = assetCanvas.getContext('2d');
          
          const deviceColors = {
            router: '#FF5733',
            switch: '#33FF57',
            server: '#3357FF',
            client: '#F3FF33'
          };
          
          assetCtx.fillStyle = deviceColors[type];
          assetCtx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);
          assetCtx.fillStyle = '#000';
          assetCtx.font = '10px Arial';
          assetCtx.fillText(type.slice(0, 1).toUpperCase(), 6, 13);
          
          img.src = assetCanvas.toDataURL();
        };
      });
      
      // Try to load the actual image first
      img.src = deviceTypes[type].img;
      this.assets[type] = img;
      this.loadPromises.push(promise);
    }
    
    return Promise.all(this.loadPromises).then(() => {
      this.loaded = true;
    });
  }
};

// Initialize game
function initGame() {
  // Check if game is already initialized
  if (document.querySelector('#gameContainer canvas')) {
    return;
  }
  
  // Create main canvas
  canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  ctx = canvas.getContext('2d');
  
  // Create offscreen canvas for double buffering
  offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = WIDTH;
  offscreenCanvas.height = HEIGHT;
  offscreenCtx = offscreenCanvas.getContext('2d');
  
  // Remove loading div and append canvas
  const loadingElement = document.getElementById('loading');
  if (loadingElement) {
    loadingElement.remove();
  }
  
  document.getElementById('gameContainer').appendChild(canvas);
  
  // Load assets
  assetLoader.load()
    .then(() => {
      addEventListeners();
      
      // Start the game loop with better timing
      gameState.lastFrameTime = performance.now();
      requestAnimationFrame(gameLoop);
    });
}

// DOM Event listeners
function addEventListeners() {
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('mousemove', handleMouseMove);
  
  // Bouton Menu
  document.getElementById('menuButton').addEventListener('click', function() {
    gameState.menuOpen = !gameState.menuOpen;
    gameState.selectedDeviceType = null;
    gameState.isDrawingCable = false;
  });
  
  // Bouton Simulation
  document.getElementById('simulateButton').addEventListener('click', function() {
    if (!gameState.gameStarted) {
      startSimulation();
      gameState.gameStarted = true;
    }
  });
  
  // Boutons Appareils
  document.querySelectorAll('.device-button').forEach(button => {
    button.addEventListener('click', function() {
      gameState.selectedDeviceType = this.dataset.type;
      gameState.menuOpen = false;
    });
  });
}

// Handle mouse click
function handleClick(event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / GRID_SIZE) * GRID_SIZE;
  const y = Math.floor((event.clientY - rect.top) / GRID_SIZE) * GRID_SIZE;
  
  if (gameState.menuOpen) {
    handleMenuClick(x, y);
    return;
  }
  
  // Check if clicking on a device - use more efficient device detection
  const clickedDevice = findDeviceAt(x, y);
  
  if (clickedDevice) {
    if (gameState.isDrawingCable) {
      // Complete cable drawing
      if (gameState.cableStartDevice !== clickedDevice) {
        const cableType = 'fiber'; // Default to fiber
        const cableCost = Math.round(calculateCableDistance(gameState.cableStartDevice, clickedDevice) 
                                    * cableTypes[cableType].cost);
        
        if (cableCost <= gameState.budget) {
          gameState.cables.push({
            startDevice: gameState.cableStartDevice,
            endDevice: clickedDevice,
            type: cableType,
            cost: cableCost,
            currentLoad: 0,
            capacity: cableTypes[cableType].capacity
          });
          
          // Connect devices
          gameState.cableStartDevice.connections.push(clickedDevice);
          clickedDevice.connections.push(gameState.cableStartDevice);
          
          // Deduct cost
          gameState.budget -= cableCost;
        }
      }
      
      gameState.isDrawingCable = false;
      gameState.cableStartDevice = null;
    } else {
      // Start drawing cable
      gameState.isDrawingCable = true;
      gameState.cableStartDevice = clickedDevice;
      gameState.selectedDevice = clickedDevice;
    }
  } else if (gameState.selectedDeviceType) {
    // Check for device overlap before placing
    if (!isDeviceAt(x, y)) {
      // Place new device
      const deviceInfo = deviceTypes[gameState.selectedDeviceType];
      if (deviceInfo.cost <= gameState.budget) {
        const newDevice = {
          type: gameState.selectedDeviceType,
          x,
          y,
          capacity: deviceInfo.capacity,
          cost: deviceInfo.cost,
          connections: [],
          currentLoad: 0
        };
        
        gameState.devices.push(newDevice);
        gameState.budget -= deviceInfo.cost;
        gameState.selectedDeviceType = null;
      }
    }
  }
}

// Optimized device detection 
function findDeviceAt(x, y) {
  for (let i = 0; i < gameState.devices.length; i++) {
    const device = gameState.devices[i];
    if (x >= device.x && x < device.x + GRID_SIZE && 
        y >= device.y && y < device.y + GRID_SIZE) {
      return device;
    }
  }
  return null;
}

// Check if there's already a device at position
function isDeviceAt(x, y) {
  return findDeviceAt(x, y) !== null;
}

// Handle mouse movement
function handleMouseMove(event) {
  const rect = canvas.getBoundingClientRect();
  gameState.mouseX = event.clientX - rect.left;
  gameState.mouseY = event.clientY - rect.top;
}

// Handle key press
function handleKeyPress(event) {
  if (event.key === 'Escape') {
    gameState.menuOpen = !gameState.menuOpen;
    gameState.selectedDeviceType = null;
    gameState.isDrawingCable = false;
  }
  
  if (event.key === 'r') {
    // Start the simulation
    if (!gameState.gameStarted) {
      startSimulation();
      gameState.gameStarted = true;
    }
  }
}

// Menu handling
function handleMenuClick(x, y) {
  // Simple menu implementation
  const menuItems = Object.keys(deviceTypes);
  const itemHeight = 40;
  
  for (let i = 0; i < menuItems.length; i++) {
    const itemY = 150 + i * itemHeight;
    
    if (x >= 30 && x <= 210 && y >= itemY - 15 && y <= itemY + 5) {
      gameState.selectedDeviceType = menuItems[i];
      gameState.menuOpen = false;
      return;
    }
  }
  
  // Close menu if clicked outside
  if (x < 50 || x > 250 || y < 50 || y > 90 + menuItems.length * itemHeight) {
    gameState.menuOpen = false;
  }
}

// Calculate distance between devices for cable cost
function calculateCableDistance(device1, device2) {
  const dx = device1.x - device2.x;
  const dy = device1.y - device2.y;
  return Math.sqrt(dx * dx + dy * dy) / GRID_SIZE;
}

// Simulation logic
function startSimulation() {
  // Generate initial requests
  generateNewRequest();
}

// Generate a new request with improved error handling
function generateNewRequest() {
  if (gameState.remainingRequests <= 0) return;
  
  const clients = gameState.devices.filter(device => device.type === 'client');
  const servers = gameState.devices.filter(device => device.type === 'server');
  
  if (clients.length > 0 && servers.length > 0) {
    const randomClient = clients[Math.floor(Math.random() * clients.length)];
    const randomServer = servers[Math.floor(Math.random() * servers.length)];
    
    gameState.requests.push({
      source: randomClient,
      destination: randomServer,
      active: true,
      path: [],
      progress: 0,
      successful: false
    });
    
    gameState.remainingRequests--;
    
    // Generate a new request with slight delay if we still have requests left
    if (gameState.remainingRequests > 0) {
      setTimeout(generateNewRequest, 1000);
    }
  }
}

// Process active requests with optimized cable load tracking
function processRequests() {
  // First reset all cable loads
  for (const cable of gameState.cables) {
    cable.currentLoad = 0;
  }
  
  for (const request of gameState.requests) {
    if (!request.active) continue;
    
    // If path not found yet, find it
    if (request.path.length === 0) {
      request.path = findBestPath(request.source, request.destination);
      
      if (request.path.length === 0) {
        // No path found
        request.active = false;
        request.successful = false;
        gameState.requestsFailed++;
        continue;
      }
    }
    
    // Process request along path
    request.progress += cableTypes.fiber.speed; // Use cable speed 
    
    // Calculate current position in path
    const pathIndex = Math.floor(request.progress / 10);
    
    if (pathIndex < request.path.length - 1) {
      // Find cable between current and next device
      const currentDevice = request.path[pathIndex];
      const nextDevice = request.path[pathIndex + 1];
      
      const cable = findCableBetweenDevices(currentDevice, nextDevice);
      
      if (cable) {
        // Increment cable load
        cable.currentLoad += 1;
        
        // Check if cable is overloaded
        if (cable.currentLoad > cable.capacity) {
          request.active = false;
          request.successful = false;
          gameState.requestsFailed++;
        }
      }
    } else if (pathIndex >= request.path.length - 1) {
      // Request completed successfully
      request.active = false;
      request.successful = true;
      gameState.requestsProcessed++;
      
      // Generate a new request with slight delay
      if (gameState.remainingRequests > 0) {
        setTimeout(generateNewRequest, 500);
      }
    }
  }
}

// Utility function to find cable between devices
function findCableBetweenDevices(device1, device2) {
  return gameState.cables.find(cable => 
    (cable.startDevice === device1 && cable.endDevice === device2) || 
    (cable.startDevice === device2 && cable.endDevice === device1)
  );
}

// Find all paths between two devices using DFS
function findAllPaths(source, destination) {
  const paths = [];
  const visited = new Set();
  
  function dfs(current, path) {
    visited.add(current);
    path.push(current);
    
    if (current === destination) {
      paths.push([...path]);
    } else {
      for (const neighbor of current.connections) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, path);
        }
      }
    }
    
    path.pop();
    visited.delete(current);
  }
  
  dfs(source, []);
  return paths;
}

// Find best path based on current network load
function findBestPath(source, destination) {
  const allPaths = findAllPaths(source, destination);
  
  if (allPaths.length === 0) return [];
  
  // Score paths based on current load and predicted future load
  const scoredPaths = allPaths.map(path => {
    const currentLoad = calculatePathLoad(path);
    const hopCount = path.length - 1;
    const deviceCount = path.filter(d => d.type !== 'client' && d.type !== 'server').length;
    
    // Favor paths with:
    // - Lower current load (50% weight)
    // - Fewer hops (30% weight) 
    // - Fewer intermediate devices (20% weight)
    const score = 
      (currentLoad * 0.5) + 
      (hopCount * 0.3) + 
      (deviceCount * 0.2);
    
    return { path, score };
  });
  
  // Sort by best score and return the best path
  scoredPaths.sort((a, b) => a.score - b.score);
  return scoredPaths[0].path;
}

// Calculate total load of a path
function calculatePathLoad(path) {
  let totalLoad = 0;
  
  for (let i = 0; i < path.length - 1; i++) {
    const cable = findCableBetweenDevices(path[i], path[i+1]);
    if (cable) {
      totalLoad += cable.currentLoad / cable.capacity;
    }
  }
  
  return totalLoad;
}

// Main game loop with timing control
function gameLoop(timestamp) {
  // Calculate delta time for consistent updates
  const deltaTime = timestamp - gameState.lastFrameTime;
  gameState.lastFrameTime = timestamp;
  
  // Update game state
  update(deltaTime);
  
  // Render game with double buffering
  render();
  
  // Request next frame
  requestAnimationFrame(gameLoop);
}

// Update game state with delta time
function update(deltaTime) {
  gameState.gameTime += deltaTime / 16.67; // Normalize to ~60fps
  
  // Process requests at regular intervals
  if (Math.floor(gameState.gameTime / 60) > Math.floor((gameState.gameTime - deltaTime / 16.67) / 60)) {
    processRequests();
    
    // Generate new requests periodically if game has started
    if (gameState.gameStarted && 
        Math.floor(gameState.gameTime / 180) > Math.floor((gameState.gameTime - deltaTime / 16.67) / 180) && 
        gameState.requests.length < 5 && 
        gameState.remainingRequests > 0) {
      generateNewRequest();
    }
  }
}

// Render game with optimized drawing
function render() {
  // Clear offscreen canvas first for double buffering
  offscreenCtx.fillStyle = '#f0f0f0';
  offscreenCtx.fillRect(0, 0, WIDTH, HEIGHT);
  
  // Draw grid more efficiently
  drawGrid();
  
  // Draw cables
  drawCables();
  
  // Draw active requests
  drawRequests();
  
  // Draw devices
  drawDevices();
  
  // Draw cable being created
  if (gameState.isDrawingCable && gameState.cableStartDevice) {
    drawCableBeingCreated();
  }
  
  // Draw menu
  if (gameState.menuOpen) {
    drawMenu();
  }
  
  // Draw HUD (heads-up display)
  drawHUD();
  
  // Copy from offscreen canvas to main canvas for smooth rendering
  ctx.drawImage(offscreenCanvas, 0, 0);
}

// Draw grid efficiently
function drawGrid() {
  offscreenCtx.strokeStyle = '#ddd';
  offscreenCtx.lineWidth = 0.5;
  
  // Draw vertical grid lines
  for (let x = 0; x < WIDTH; x += GRID_SIZE) {
    offscreenCtx.beginPath();
    offscreenCtx.moveTo(x, 0);
    offscreenCtx.lineTo(x, HEIGHT);
    offscreenCtx.stroke();
  }
  
  // Draw horizontal grid lines
  for (let y = 0; y < HEIGHT; y += GRID_SIZE) {
    offscreenCtx.beginPath();
    offscreenCtx.moveTo(0, y);
    offscreenCtx.lineTo(WIDTH, y);
    offscreenCtx.stroke();
  }
}

// Draw cables with load indicators
function drawCables() {
  for (const cable of gameState.cables) {
    // Determine cable color based on load
    const loadPercentage = cable.currentLoad / cable.capacity;
    let cableColor;
    
    if (loadPercentage > 0.8) {
      cableColor = '#FF0000'; // Red if close to capacity
    } else if (loadPercentage > 0.5) {
      cableColor = '#FFAA00'; // Orange if medium load
    } else if (loadPercentage > 0) {
      cableColor = '#FFFF00'; // Yellow if light load
    } else {
      cableColor = cableTypes[cable.type].color; // Default color
    }
    
    // Draw cable
    offscreenCtx.strokeStyle = cableColor;
    offscreenCtx.lineWidth = 2 + loadPercentage * 3; // Variable width based on load
    offscreenCtx.beginPath();
    offscreenCtx.moveTo(cable.startDevice.x + GRID_SIZE/2, cable.startDevice.y + GRID_SIZE/2);
    offscreenCtx.lineTo(cable.endDevice.x + GRID_SIZE/2, cable.endDevice.y + GRID_SIZE/2);
    offscreenCtx.stroke();
    
    // Display current load on cable
    if (cable.currentLoad > 0) {
      const midX = (cable.startDevice.x + cable.endDevice.x) / 2 + GRID_SIZE/2;
      const midY = (cable.startDevice.y + cable.endDevice.y) / 2 + GRID_SIZE/2;
      
      offscreenCtx.fillStyle = '#FFFFFF';
      offscreenCtx.beginPath();
      offscreenCtx.arc(midX, midY, 8, 0, Math.PI * 2);
      offscreenCtx.fill();
      
      offscreenCtx.fillStyle = '#000000';
      offscreenCtx.font = '10px Arial';
      offscreenCtx.textAlign = 'center';
      offscreenCtx.textBaseline = 'middle';
      offscreenCtx.fillText(cable.currentLoad + '/' + cable.capacity, midX, midY);
      offscreenCtx.textAlign = 'start';
      offscreenCtx.textBaseline = 'alphabetic';
    }
  }
}

// Draw request packets
function drawRequests() {
  for (const request of gameState.requests) {
    if (request.active && request.path.length > 0) {
      const pathIndex = Math.floor(request.progress / 10);
      
      if (pathIndex < request.path.length - 1) {
        const current = request.path[pathIndex];
        const next = request.path[pathIndex + 1];
        
        const progress = (request.progress % 10) / 10;
        const startX = current.x + GRID_SIZE/2;
        const startY = current.y + GRID_SIZE/2;
        const endX = next.x + GRID_SIZE/2;
        const endY = next.y + GRID_SIZE/2;
        
        const x = startX + (endX - startX) * progress;
        const y = startY + (endY - startY) * progress;
        
        // Draw request packet with animation effect
        offscreenCtx.fillStyle = '#FF0000';
        offscreenCtx.beginPath();
        offscreenCtx.arc(x, y, 5, 0, Math.PI * 2);
        offscreenCtx.fill();
        
        // Optional: add packet trail for visual effect
        offscreenCtx.fillStyle = 'rgba(255, 0, 0, 0.3)';
        offscreenCtx.beginPath();
        offscreenCtx.arc(x - (endX - startX) * 0.05, y - (endY - startY) * 0.05, 3, 0, Math.PI * 2);
        offscreenCtx.fill();
      }
    }
  }
}

// Draw devices
function drawDevices() {
  for (const device of gameState.devices) {
    // Draw device background
    offscreenCtx.fillStyle = device === gameState.selectedDevice ? '#FFCC00' : '#FFFFFF';
    offscreenCtx.fillRect(device.x, device.y, GRID_SIZE, GRID_SIZE);
    
    // Draw device image or placeholder
    if (assetLoader.loaded && assetLoader.assets[device.type]) {
      offscreenCtx.drawImage(assetLoader.assets[device.type], device.x, device.y, GRID_SIZE, GRID_SIZE);
    } else {
      offscreenCtx.fillStyle = '#000000';
      offscreenCtx.font = '10px Arial';
      offscreenCtx.fillText(device.type[0].toUpperCase(), device.x + 5, device.y + 15);
    }
  }
}

// Draw cable being created
function drawCableBeingCreated() {
  offscreenCtx.strokeStyle = '#0000FF';
  offscreenCtx.lineWidth = 2;
  offscreenCtx.setLineDash([5, 3]);
  offscreenCtx.beginPath();
  offscreenCtx.moveTo(gameState.cableStartDevice.x + GRID_SIZE/2, gameState.cableStartDevice.y + GRID_SIZE/2);
  offscreenCtx.lineTo(gameState.mouseX, gameState.mouseY);
  offscreenCtx.stroke();
  offscreenCtx.setLineDash([]);
}

// Draw menu
function drawMenu() {
  offscreenCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  offscreenCtx.fillRect(10, 90, 200, Object.keys(deviceTypes).length * 40 + 40);
  
  offscreenCtx.fillStyle = '#000000';
  offscreenCtx.font = '16px Arial';
  offscreenCtx.fillText('Appareils', 30, 110);
  
  const menuItems = Object.keys(deviceTypes);
  for (let i = 0; i < menuItems.length; i++) {
    const itemY = 150 + i * 40;
    offscreenCtx.fillText(deviceTypes[menuItems[i]].description + ' (Cap: ' + deviceTypes[menuItems[i]].capacity + ')', 30, itemY);
    offscreenCtx.fillText('$' + deviceTypes[menuItems[i]].cost, 160, itemY);
  }
}

// Draw HUD (heads-up display)
function drawHUD() {
  offscreenCtx.fillStyle = '#000000';
  offscreenCtx.font = '16px Arial';
  offscreenCtx.fillText('Budget: $' + gameState.budget, 10, 20);
  offscreenCtx.fillText('Requêtes traitées: ' + gameState.requestsProcessed + '/' + gameState.targetRequests, 10, 40);
  offscreenCtx.fillText('Requêtes restantes: ' + gameState.remainingRequests, 10, 60);
  offscreenCtx.fillText('Requêtes échouées: ' + gameState.requestsFailed, 10, 80);
  
  if (gameState.selectedDeviceType) {
    offscreenCtx.fillText('Sélectionné: ' + gameState.selectedDeviceType, WIDTH - 200, 20);
  }
}

document.addEventListener('DOMContentLoaded', function() {
    const playButton = document.getElementById('playButton');
    const backButton = document.getElementById('backButton');
    const gameContainer = document.getElementById('gameContainer');
    const gameControls = document.getElementById('gameControls');
    const gameInstructions = document.getElementById('gameInstructions');
    const homePage = document.querySelector('.acceuil');
    const footer = document.querySelector('footer');
    const infoButton = document.getElementById('infoButton');
    
    // Gestion du bouton Info
    infoButton.addEventListener('click', function() {
        const howToPlay = document.getElementById('howToPlay');
        const equipmentInfo = document.getElementById('equipmentInfo');
        
        if (howToPlay.style.display === 'none') {
            howToPlay.style.display = 'block';
            equipmentInfo.style.display = 'none';
            this.textContent = 'Info';
        } else {
            howToPlay.style.display = 'none';
            equipmentInfo.style.display = 'block';
            this.textContent = 'Instructions';
        }
    });

    playButton.addEventListener('click', function() {
        homePage.style.display = 'none';
        footer.style.display = 'none';
        backButton.style.display = 'block';
        gameContainer.style.display = 'block';
        gameControls.style.display = 'block';
        gameInstructions.style.display = 'block';
        
        // Initialiser le jeu seulement quand on clique sur "Jouer"
        initGame();
    });

    backButton.addEventListener('click', function() {
        homePage.style.display = 'block';
        footer.style.display = 'block';
        backButton.style.display = 'none';
        gameContainer.style.display = 'none';
        gameControls.style.display = 'none';
        gameInstructions.style.display = 'none';
    });
});
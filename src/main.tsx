import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { useRef, useMemo, useEffect, useState, useCallback, createContext, useContext } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { KeyboardControls, useKeyboardControls, Sky, MapControls, RoundedBox, Text3D, Center } from '@react-three/drei'
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata'
import "./App.css"

// Control mode context - shared between components
type ControlMode = 'player' | 'map'
const ControlModeContext = createContext<{
  mode: ControlMode
  setMode: (mode: ControlMode) => void
}>({ mode: 'player', setMode: () => {} })

// Global control mode state (for components outside context)
const controlModeState = {
  mode: 'player' as ControlMode,
  setMode: (mode: ControlMode) => { controlModeState.mode = mode }
}


// Simple seeded random number generator for consistent terrain
function seededRandom(seed: number): () => number {
  return function() {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
}

// 2D Perlin-like noise implementation
const permutation: number[] = []
const gradients: [number, number][] = []

// Initialize noise tables
function initNoise(seed: number = 42) {
  const rng = seededRandom(seed)
  
  // Create permutation table
  for (let i = 0; i < 256; i++) {
    permutation[i] = i
  }
  // Shuffle permutation
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[permutation[i], permutation[j]] = [permutation[j], permutation[i]]
  }
  // Duplicate for overflow
  for (let i = 0; i < 256; i++) {
    permutation[256 + i] = permutation[i]
  }
  
  // Create gradient vectors
  for (let i = 0; i < 256; i++) {
    const angle = rng() * Math.PI * 2
    gradients[i] = [Math.cos(angle), Math.sin(angle)]
  }
}

initNoise(12345) // Initialize with a seed

// Smooth interpolation function (5th order polynomial)
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// Linear interpolation
function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

// Dot product of gradient and distance vector
function dotGrad(hash: number, x: number, y: number): number {
  const g = gradients[hash & 255]
  return g[0] * x + g[1] * y
}

// 2D Perlin noise
function perlin2D(x: number, y: number): number {
  // Grid cell coordinates
  const xi = Math.floor(x) & 255
  const yi = Math.floor(y) & 255
  
  // Relative position within cell
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)
  
  // Fade curves
  const u = fade(xf)
  const v = fade(yf)
  
  // Hash coordinates of 4 corners
  const aa = permutation[permutation[xi] + yi]
  const ab = permutation[permutation[xi] + yi + 1]
  const ba = permutation[permutation[xi + 1] + yi]
  const bb = permutation[permutation[xi + 1] + yi + 1]
  
  // Blend
  const x1 = lerp(dotGrad(aa, xf, yf), dotGrad(ba, xf - 1, yf), u)
  const x2 = lerp(dotGrad(ab, xf, yf - 1), dotGrad(bb, xf - 1, yf - 1), u)
  
  return lerp(x1, x2, v)
}

// Fractal Brownian Motion - multiple octaves of noise (like Minecraft)
function fbm(x: number, y: number, octaves: number, lacunarity: number = 2, persistence: number = 0.5): number {
  let value = 0
  let amplitude = 1
  let frequency = 1
  let maxValue = 0
  
  for (let i = 0; i < octaves; i++) {
    value += perlin2D(x * frequency, y * frequency) * amplitude
    maxValue += amplitude
    amplitude *= persistence
    frequency *= lacunarity
  }
  
  return value / maxValue
}

// Ridged noise for mountain ridges
function ridgedNoise(x: number, y: number, octaves: number): number {
  let value = 0
  let amplitude = 1
  let frequency = 1
  let maxValue = 0
  
  for (let i = 0; i < octaves; i++) {
    let n = perlin2D(x * frequency, y * frequency)
    n = 1 - Math.abs(n) // Create ridges
    n = n * n // Sharpen ridges
    value += n * amplitude
    maxValue += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  
  return value / maxValue
}

// ============================================================================
// TERRAIN DIMENSION CONFIGURATION
// Single source of truth for all terrain size and geometry settings
// Change these values to adjust the overall world dimensions
// ============================================================================
const TERRAIN_DIMENSIONS = {
  // Overall terrain size (centered at origin, so extends from -SIZE/2 to +SIZE/2)
  SIZE: 1000,
  
  // Terrain mesh resolution (segments per axis)
  SEGMENTS: 128,
  
  // Half the terrain size (calculated for convenience)
  get HALF_SIZE() { return this.SIZE / 2 },
  
  // Noise scale factor (how many "tiles" of noise across terrain)
  NOISE_SCALE: 8,
  
  // Object spawn areas (as a fraction of terrain, or absolute values)
  TREE_SPAWN_SPREAD: 900,
  ROCK_SPAWN_SPREAD: 900,
  SHEEP_SPAWN_SPREAD: 1000,
  SHEEP_MOVEMENT_BOUNDS: 250,
  
  // Cloud settings
  CLOUD_SPREAD: 1000,
  CLOUD_HEIGHT: 150,
  CLOUD_WRAP_DISTANCE: 500,
  
  // Camera and rendering
  FOG_FAR: 1500,
  CAMERA_FAR: 2000,
  SHADOW_CAMERA_SIZE: 500,
}

// ============================================================================
// TERRAIN ZONE CONFIGURATION
// Single source of truth for all terrain elevation thresholds
// Change these values to adjust where objects can be placed
// ============================================================================
const TERRAIN_ZONES = {
  // Water level - anything below this is underwater
  WATER_LEVEL: 0,
  
  // Grass zones (low elevation, flat areas)
  GRASS_MIN: 0,
  GRASS_MAX: 15,
  
  // Sheep grazing zone - flat grassy areas only
  SHEEP_MIN: 0, //. water level
  SHEEP_MAX: 20,
  
  // Tree zone - grassy to mid-elevation
  TREE_MIN: 0,
  TREE_MAX: 50,
  
  // Rock zone - above water, up to high mountain (but not peaks)
  ROCK_MIN: 0,
  ROCK_MAX: 75,
  
  // High altitude threshold for larger boulders
  HIGH_ALTITUDE: 10,
  
  // Mountain zones for terrain coloring reference
  DEEP_VALLEY: -30,
  VALLEY: -15,
  LOW_VALLEY: -5,
  LOW_GRASS: 5,
  MID_ELEVATION: 15,
  CLIFF_TOPS: 30,
  MOUNTAIN_SLOPES: 60,
  HIGH_MOUNTAIN: 100,
  NEAR_PEAK: 140,
}

function isSheepZone(height: number): boolean {
  return height > TERRAIN_ZONES.SHEEP_MIN && height < TERRAIN_ZONES.SHEEP_MAX
}

function isTreeZone(height: number): boolean {
  return height > TERRAIN_ZONES.TREE_MIN && height < TERRAIN_ZONES.TREE_MAX
}

function isRockZone(height: number): boolean {
  return height > TERRAIN_ZONES.ROCK_MIN && height < TERRAIN_ZONES.ROCK_MAX
}

function isHighAltitude(height: number): boolean {
  return height > TERRAIN_ZONES.HIGH_ALTITUDE
}

// ============================================================================
// TERRAIN HEIGHT CALCULATION
// ============================================================================

// Core terrain height calculation at noise coordinates (x, z are in noise space: 0-8 range)
// This is the single source of truth for terrain height - all placement uses this
function calculateTerrainHeightAtNoiseCoords(x: number, z: number): number {
  // Base terrain - rolling hills (multiple octaves of noise)
  let height = fbm(x, z, 6, 2, 0.5) * 30
  
  // Continental/biome-scale variation - creates large elevation differences
  const continentalNoise = fbm(x * 0.3, z * 0.3, 3, 2, 0.5)
  
  // MASSIVE Mountains - use ridged noise for dramatic towering peaks
  const mountainNoise = ridgedNoise(x * 0.5, z * 0.5, 5)
  const mountainMask = Math.max(0, fbm(x * 0.2 + 100, z * 0.2 + 100, 2, 2, 0.5) + 0.3)
  const mountainHeight = mountainNoise * mountainMask * 200
  
  // Steep cliffs - create dramatic vertical drops
  const cliffNoise = fbm(x * 0.4 + 50, z * 0.4 + 50, 4, 2, 0.5)
  const cliffiness = Math.abs(fbm(x * 0.4 + 50.1, z * 0.4 + 50, 4, 2, 0.5) - cliffNoise) * 150
  const cliffContribution = Math.min(cliffiness * 3, 60) * Math.max(0, cliffNoise + 0.2)
  
  // Deep valley carving - creates dramatic canyons and gorges
  const valleyNoise = fbm(x * 0.25 + 200, z * 0.25 + 200, 3, 2, 0.5)
  const valleyDepth = Math.max(0, -valleyNoise - 0.1) * 100
  
  // Plateaus - elevated flat areas
  const plateauNoise = fbm(x * 0.15 + 300, z * 0.15 + 300, 2, 2, 0.5)
  const plateauMask = Math.max(0, plateauNoise - 0.3) * 2
  const plateauHeight = plateauMask > 0.1 ? plateauMask * 50 : 0
  
  // Detail noise for rocky texture
  const detailNoise = fbm(x * 3, z * 3, 3, 2, 0.5) * 5
  
  // Combine all features
  height += continentalNoise * 25
  height += mountainHeight
  height += cliffContribution
  height -= valleyDepth
  height += plateauHeight
  height += detailNoise
  
  // Cave entrance depressions - carve holes into hillsides
  const caveNoise = fbm(x * 0.8 + 400, z * 0.8 + 400, 3, 2, 0.5)
  if (caveNoise > 0.4 && height > 5) {
    // Create a depression that could be a cave entrance
    const caveDepth = (caveNoise - 0.4) * 8
    height -= caveDepth
  }
  
  return height
}

// Helper to get terrain height at a world position (used by objects for placement/collision)
// Terrain is SIZE x SIZE, centered at origin (-HALF_SIZE to +HALF_SIZE)
function getTerrainHeight(worldX: number, worldZ: number): number {
  // Convert world position to normalized [0,1] then to noise coordinates
  const nx = (worldX + TERRAIN_DIMENSIONS.HALF_SIZE) / TERRAIN_DIMENSIONS.SIZE  // Maps -HALF_SIZE..HALF_SIZE to 0..1
  const nz = (worldZ + TERRAIN_DIMENSIONS.HALF_SIZE) / TERRAIN_DIMENSIONS.SIZE
  const x = nx * TERRAIN_DIMENSIONS.NOISE_SCALE  // Same scaling as generateHeightData
  const z = nz * TERRAIN_DIMENSIONS.NOISE_SCALE
  
  return calculateTerrainHeightAtNoiseCoords(x, z)
}

// Generate height map data for terrain with Minecraft-style procedural generation
function generateHeightData(width: number, depth: number, scale: number) {
  const data = []
  
  for (let i = 0; i < depth; i++) {
    for (let j = 0; j < width; j++) {
      // Map grid indices to normalized coordinates [0, 1]
      const nx = j / (width - 1)
      const nz = i / (depth - 1)
      // Scale for noise sampling
      const x = nx * TERRAIN_DIMENSIONS.NOISE_SCALE // Gives us NOISE_SCALE "tiles" of noise across terrain
      const z = nz * TERRAIN_DIMENSIONS.NOISE_SCALE
      
      // Use the shared height calculation function
      const height = calculateTerrainHeightAtNoiseCoords(x, z)
      
      data.push(height * scale)
    }
  }
  return data
}

function Terrain() {
  const meshRef = useRef<THREE.Mesh>(null!)
  
  const geometry = useMemo(() => {
    const width = TERRAIN_DIMENSIONS.SIZE
    const depth = TERRAIN_DIMENSIONS.SIZE
    const segmentsX = TERRAIN_DIMENSIONS.SEGMENTS
    const segmentsZ = TERRAIN_DIMENSIONS.SEGMENTS
    
    const geo = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ)
    geo.rotateX(-Math.PI / 2)
    
    const heightData = generateHeightData(segmentsX + 1, segmentsZ + 1, 1)
    const positions = geo.attributes.position.array as Float32Array
    
    for (let i = 0; i < positions.length / 3; i++) {
      positions[i * 3 + 1] = heightData[i] // Y position is height
    }
    
    geo.computeVertexNormals()
    return geo
  }, [])

  // Create gradient colors based on height
  const colors = useMemo(() => {
    const positions = geometry.attributes.position.array as Float32Array
    const colorsArray = new Float32Array(positions.length)
    
    for (let i = 0; i < positions.length / 3; i++) {
      const height = positions[i * 3 + 1]
      
      let r, g, b
      if (height < 1) {
        // Very deep valleys - dark sandy brown
        r = 0.25
        g = 0.28
        b = 0.18
      } else if (height < 25) {
        // Deep valleys - darker green/brown
        r = 0.2
        g = 0.35
        b = 0.15
      } else if (height < 50) {
        // Low areas - grass green
        r = 0.3
        g = 0.5
        b = 0.2
      } else if (height < 75) {
        // Mid elevation - lighter green
        r = 0.4
        g = 0.6
        b = 0.25
      } else if (height < 90) {
        // Higher areas - brownish (cliff/hill tops)
        r = 0.5
        g = 0.45
        b = 0.3
      } else if (height < 100) {
        // Mountain slopes - rocky gray
        r = 0.55
        g = 0.5
        b = 0.45
      } else if (height < 105) {
        // High mountain - darker rocky
        r = 0.45
        g = 0.42
        b = 0.4
      } else if (height < 110) {
        // Near peak - lighter rocky with hints of snow
        r = 0.65
        g = 0.63
        b = 0.62
      } else {
        // Snow caps - white/light gray (above 140)
        r = .7
        g = .8
        b = 1
      }
      
      // Add some variation
      const variation = (Math.random() - 0.5) * 0.1
      colorsArray[i * 3] = Math.max(0, Math.min(1, r + variation))
      colorsArray[i * 3 + 1] = Math.max(0, Math.min(1, g + variation))
      colorsArray[i * 3 + 2] = Math.max(0, Math.min(1, b + variation))
    }
    
    return colorsArray
  }, [geometry])

  useMemo(() => {
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }, [geometry, colors])

  return (
    <RigidBody type="fixed" colliders="trimesh" friction={1}>
      <mesh ref={meshRef} geometry={geometry} receiveShadow castShadow>
        <meshStandardMaterial 
          vertexColors 
          roughness={0.9}
          metalness={0.1}
          flatShading={false}
        />
      </mesh>
    </RigidBody>
  )
}

function Water() {
  
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[TERRAIN_DIMENSIONS.SIZE, TERRAIN_DIMENSIONS.SIZE]} />
      <meshStandardMaterial 
        color="#1a5276"
        transparent
        opacity={0.8}
        roughness={0.1}
        metalness={0.3}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}

// Single destructible tree component
function DestructibleTree({ x, y, z, scale }: { x: number, y: number, z: number, scale: number }) {
  const groupRef = useRef<THREE.Group>(null!)
  const [destroyed, setDestroyed] = useState(false)
  const [fragments, setFragments] = useState<THREE.Mesh[]>([])
  
  const handleClick = useCallback(() => {
    if (destroyed) return
    
    // Create geometries and materials for the tree parts
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 8)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5D4037, roughness: 0.9 })
    const trunkInnerMat = new THREE.MeshStandardMaterial({ color: 0x8D6E63, roughness: 0.9 })
    
    const foliage1Geo = new THREE.ConeGeometry(1.2, 2, 8)
    const foliage2Geo = new THREE.ConeGeometry(0.9, 1.5, 8)
    const foliage3Geo = new THREE.ConeGeometry(0.6, 1.2, 8)
    const foliageMat1 = new THREE.MeshStandardMaterial({ color: 0x2E7D32, roughness: 0.8 })
    const foliageMat2 = new THREE.MeshStandardMaterial({ color: 0x388E3C, roughness: 0.8 })
    const foliageMat3 = new THREE.MeshStandardMaterial({ color: 0x43A047, roughness: 0.8 })
    const foliageInnerMat = new THREE.MeshStandardMaterial({ color: 0x1B5E20, roughness: 0.8 })
    
    const allFragments: THREE.Mesh[] = []
    
    const options = new FractureOptions({
      fractureMethod: 'voronoi',
      fragmentCount: 8,
      voronoiOptions: {
        mode: '3D',
      },
    })
    
    // Fracture trunk
    const trunkMesh = new DestructibleMesh(trunkGeo, trunkMat, trunkInnerMat)
    trunkMesh.position.set(0, 1 * scale, 0)
    trunkMesh.scale.setScalar(scale)
    trunkMesh.fracture(options, (fragment) => {
      fragment.position.add(new THREE.Vector3(x, y, z))
      allFragments.push(fragment)
    })
    
    // Fracture foliage layers
    const foliage1Mesh = new DestructibleMesh(foliage1Geo, foliageMat1, foliageInnerMat)
    foliage1Mesh.position.set(0, 2.5 * scale, 0)
    foliage1Mesh.scale.setScalar(scale)
    foliage1Mesh.fracture(options, (fragment) => {
      fragment.position.add(new THREE.Vector3(x, y, z))
      allFragments.push(fragment)
    })
    
    const foliage2Mesh = new DestructibleMesh(foliage2Geo, foliageMat2, foliageInnerMat)
    foliage2Mesh.position.set(0, 3.5 * scale, 0)
    foliage2Mesh.scale.setScalar(scale)
    foliage2Mesh.fracture(options, (fragment) => {
      fragment.position.add(new THREE.Vector3(x, y, z))
      allFragments.push(fragment)
    })
    
    const foliage3Mesh = new DestructibleMesh(foliage3Geo, foliageMat3, foliageInnerMat)
    foliage3Mesh.position.set(0, 4.3 * scale, 0)
    foliage3Mesh.scale.setScalar(scale)
    foliage3Mesh.fracture(options, (fragment) => {
      fragment.position.add(new THREE.Vector3(x, y, z))
      allFragments.push(fragment)
    })
    
    setFragments(allFragments)
    setDestroyed(true)
    
    // Play blast sound effect
    playBlastSound()
  }, [destroyed, x, y, z, scale])
  
  if (destroyed) {
    return (
      <FragmentsContainer 
        fragments={fragments} 
      />
    )
  }
  
  return (
    <group ref={groupRef} position={[x, y, z]} scale={scale} onClick={handleClick}>
      {/* Trunk */}
      <mesh position={[0, 1, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.3, 2, 8]} />
        <meshStandardMaterial color="#5D4037" roughness={0.9} />
      </mesh>
      {/* Foliage layers */}
      <mesh position={[0, 2.5, 0]} castShadow>
        <coneGeometry args={[1.2, 2, 8]} />
        <meshStandardMaterial color="#2E7D32" roughness={0.8} />
      </mesh>
      <mesh position={[0, 3.5, 0]} castShadow>
        <coneGeometry args={[0.9, 1.5, 8]} />
        <meshStandardMaterial color="#388E3C" roughness={0.8} />
      </mesh>
      <mesh position={[0, 4.3, 0]} castShadow>
        <coneGeometry args={[0.6, 1.2, 8]} />
        <meshStandardMaterial color="#43A047" roughness={0.8} />
      </mesh>
    </group>
  )
}

function Trees() {
  const trees = useMemo(() => {
    const treeData = []
    const rng = seededRandom(54321) // Use seeded random for consistent tree placement
    for (let i = 0; i < 1000; i++) {
      const x = (rng() - 0.5) * TERRAIN_DIMENSIONS.TREE_SPAWN_SPREAD
      const z = (rng() - 0.5) * TERRAIN_DIMENSIONS.TREE_SPAWN_SPREAD
      const height = getTerrainHeight(x, z)
      
      // Only place trees in valid tree zones (uses terrain system)
      if (isTreeZone(height)) {
        treeData.push({ x, y: height, z, scale: 0.5 + rng() * 2 })
      }
    }
    return treeData
  }, [])

  return (
    <group>
      {trees.map((tree, i) => (
        <DestructibleTree 
          key={i}
          x={tree.x}
          y={tree.y}
          z={tree.z}
          scale={tree.scale}
        />
      ))}
    </group>
  )
}


// Fragment component with physics - used for destruction debris
// OPTIMIZED: Uses refs instead of state for opacity to avoid re-renders
function Fragment({ 
  fragment
}: { 
  fragment: THREE.Mesh
}) {
  const meshRef = useRef<THREE.Mesh>(null!)
  const velocityRef = useRef(new THREE.Vector3(
    (Math.random() - 0.5) * 8,
    Math.random() * 5 + 2,
    (Math.random() - 0.5) * 8
  ))
  const angularVelRef = useRef(new THREE.Vector3(
    (Math.random() - 0.5) * 10,
    (Math.random() - 0.5) * 10,
    (Math.random() - 0.5) * 10
  ))
  const opacityRef = useRef(1)
  const isDeadRef = useRef(false)
  const startTime = useRef(0)
  
  // Store the initial position from the fragment
  const initialPos = useMemo(() => fragment.position.clone(), [fragment])
  
  // Clone the fragment and use its geometry/material - MUST be before any conditional returns
  const clonedFragment = useMemo(() => {
    const clone = fragment.clone()
    // Ensure the material is transparent for fading
    if (clone.material) {
      if (Array.isArray(clone.material)) {
        clone.material = clone.material.map(m => {
          const cloned = m.clone()
          cloned.transparent = true
          return cloned
        })
      } else if (clone.material.clone) {
        const mat = clone.material.clone()
        mat.transparent = true
        clone.material = mat
      }
    }
    return clone
  }, [fragment])
  
  useFrame((state, delta) => {
    if (!meshRef.current || isDeadRef.current) return
    
    if (startTime.current === 0) {
      startTime.current = state.clock.elapsedTime
    }
    
    const elapsed = state.clock.elapsedTime - startTime.current
    
    // Apply gravity
    velocityRef.current.y -= 15 * delta
    
    // Update position
    meshRef.current.position.x += velocityRef.current.x * delta
    meshRef.current.position.y += velocityRef.current.y * delta
    meshRef.current.position.z += velocityRef.current.z * delta
    
    // Update rotation
    meshRef.current.rotation.x += angularVelRef.current.x * delta
    meshRef.current.rotation.y += angularVelRef.current.y * delta
    meshRef.current.rotation.z += angularVelRef.current.z * delta
    
    // Ground collision
    const groundHeight = getTerrainHeight(meshRef.current.position.x, meshRef.current.position.z)
    if (meshRef.current.position.y < groundHeight) {
      meshRef.current.position.y = groundHeight
      velocityRef.current.y *= -0.3
      velocityRef.current.x *= 0.8
      velocityRef.current.z *= 0.8
      angularVelRef.current.multiplyScalar(0.8)
    }
    
    // Fade out after 2 seconds - update material opacity directly without re-render
    if (elapsed > 2) {
      const fadeProgress = (elapsed - 2) / 2
      opacityRef.current = Math.max(0, 1 - fadeProgress)
      
      // Update material opacity directly
      const material = meshRef.current.material as THREE.Material | THREE.Material[]
      if (Array.isArray(material)) {
        material.forEach(m => { (m as any).opacity = opacityRef.current })
      } else {
        (material as any).opacity = opacityRef.current
      }
      
      // Mark as dead and hide when fully faded
      if (opacityRef.current <= 0) {
        isDeadRef.current = true
        meshRef.current.visible = false
      }
    }
  })
  
  return (
    <primitive 
      ref={meshRef}
      object={clonedFragment}
      position={initialPos}
      castShadow
    />
  )
}

// Fragments container component
function FragmentsContainer({ fragments }: { 
  fragments: THREE.Mesh[]
}) {
  return (
    <group>
      {fragments.map((frag, i) => (
        <Fragment 
          key={i}
          fragment={frag}
        />
      ))}
    </group>
  )
}

// Laser beam component - a single laser shot
interface LaserData {
  id: number
  start: THREE.Vector3
  end: THREE.Vector3
  createdAt: number
}

// LaserBeam component with proper timing and flash effect
function LaserBeam({ start, end, createdAt }: { start: THREE.Vector3, end: THREE.Vector3, createdAt: number }) {
  const groupRef = useRef<THREE.Group>(null!)
  const meshRef = useRef<THREE.Mesh>(null!)
  const glowRef = useRef<THREE.Mesh>(null!)
  const impactRef = useRef<THREE.Mesh>(null!)
  const originRef = useRef<THREE.Mesh>(null!)
  const light1Ref = useRef<THREE.PointLight>(null!)
  const light2Ref = useRef<THREE.PointLight>(null!)
  const light3Ref = useRef<THREE.PointLight>(null!)
  const [opacity, setOpacity] = useState(1)
  
  // Calculate beam geometry
  const { midpoint, length, rotation } = useMemo(() => {
    const direction = new THREE.Vector3().subVectors(end, start)
    const length = direction.length()
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
    
    // Calculate rotation to align cylinder with the laser direction
    const up = new THREE.Vector3(0, 1, 0)
    const quaternion = new THREE.Quaternion()
    quaternion.setFromUnitVectors(up, direction.normalize())
    const euler = new THREE.Euler().setFromQuaternion(quaternion)
    
    return { midpoint, length, rotation: euler }
  }, [start, end])
  
  useFrame(() => {
    // Use performance.now() consistently with createdAt
    const elapsed = performance.now() - createdAt
    const duration = 200 
    
    if (elapsed > duration) {
      setOpacity(0)
      if (groupRef.current) groupRef.current.visible = false
    } else {
      // Quick fade in, then fade out
      const fadeIn = Math.min(1, elapsed / 30)
      const fadeOut = Math.max(0, 1 - (elapsed - duration * 0.6) / (duration * 0.4))
      setOpacity(fadeIn * fadeOut)
    }
  })
  
  // Calculate light intensities based on opacity
  const lightIntensity = opacity * 1000
  
  return (
    <group ref={groupRef} position={midpoint} rotation={rotation}>
      {/* Light emission from impact point */}
      <pointLight 
        ref={light1Ref}
        position={[0, length / 2, 0]} 
        color="#ff6a00" 
        intensity={lightIntensity}
        castShadow
        distance={300}
      />
      {/* Light emission from origin point */}
      <pointLight 
        ref={light2Ref}
        position={[0, -length / 2, 0]} 
        color="#ffe600" 
        castShadow
        intensity={lightIntensity}
        distance={200}
      />
      {/* Light emission along the beam */}
      <pointLight 
        ref={light3Ref}
        castShadow
        position={[0, 0, 0]} 
        color="#ff4400" 
        intensity={lightIntensity}
        distance={200}
      />
      {/* Inner bright core */}
      <mesh ref={meshRef}>
        <cylinderGeometry args={[0.3, 0.3, length, 8]} />
        <meshBasicMaterial 
          color="#ff0000" 
          transparent 
          opacity={opacity}
        />
      </mesh>
      {/* Outer glow */}
      <mesh ref={glowRef}>
        <cylinderGeometry args={[0.4, 0.4, length, 8]} />
        <meshBasicMaterial 
          color="#ffb444" 
          transparent 
          opacity={opacity * 0.4}
        />
      </mesh>
      {/* Impact point glow */}
      <mesh ref={impactRef} position={[0, length / 2, 0]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial 
          color="#ff6a00" 
          transparent 
          opacity={opacity * 0.8}
        />
      </mesh>
      {/* Origin point glow */}
      <mesh ref={originRef} position={[0, -length / 2, 0]}>
        <sphereGeometry args={[.2, 16, 16]} />
        <meshBasicMaterial 
          color="#ffe600" 
          transparent 
          opacity={opacity * 0.8}
        />
      </mesh>
    </group>
  )
}

// Shared AudioContext for mobile compatibility
let sharedAudioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  
  // Resume if suspended (required for mobile after user gesture)
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume()
  }
  
  return sharedAudioContext
}

// Initialize audio on first user interaction (required for mobile)
function initAudioOnInteraction() {
  const initAudio = () => {
    const ctx = getAudioContext()
    if (ctx && ctx.state === 'suspended') {
      ctx.resume()
    }
    // Remove listeners after first interaction
    document.removeEventListener('touchstart', initAudio)
    document.removeEventListener('touchend', initAudio)
    document.removeEventListener('click', initAudio)
  }
  
  document.addEventListener('touchstart', initAudio, { once: true })
  document.addEventListener('touchend', initAudio, { once: true })
  document.addEventListener('click', initAudio, { once: true })
}

// Call this immediately to set up listeners
initAudioOnInteraction()

// Play blast/explosion sound effect when something is destroyed
function playBlastSound() {
  const audioContext = getAudioContext()
  if (!audioContext) return
  
  // Create noise for explosion texture
  const bufferSize = audioContext.sampleRate * 0.3 // 300ms of noise
  const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate)
  const noiseData = noiseBuffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    noiseData[i] = Math.random() * 2 - 1
  }
  
  const noiseSource = audioContext.createBufferSource()
  noiseSource.buffer = noiseBuffer
  
  // Filter for rumble effect
  const lowpass = audioContext.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.setValueAtTime(400, audioContext.currentTime + 0.15)
  lowpass.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.3)
  
  // Gain envelope for explosion
  const noiseGain = audioContext.createGain()
  noiseGain.gain.setValueAtTime(0.6, audioContext.currentTime + 0.15)
  noiseGain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3)
  
  noiseSource.connect(lowpass)
  lowpass.connect(noiseGain)
  noiseGain.connect(audioContext.destination)
  
  // Add a low frequency "boom" oscillator
  const oscillator = audioContext.createOscillator()
  const oscGain = audioContext.createGain()
  
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(150, audioContext.currentTime + 0.15)
  oscillator.frequency.exponentialRampToValueAtTime(30, audioContext.currentTime + 0.2)
  
  oscGain.gain.setValueAtTime(0.5, audioContext.currentTime + 0.15)
  oscGain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.25)
  
  oscillator.connect(oscGain)
  oscGain.connect(audioContext.destination)
  
  // Add a crackle/debris sound - higher frequency burst
  const crackleOsc = audioContext.createOscillator()
  const crackleGain = audioContext.createGain()
  
  crackleOsc.type = 'square'
  crackleOsc.frequency.setValueAtTime(800, audioContext.currentTime + 0.15)
  crackleOsc.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.08)
  
  crackleGain.gain.setValueAtTime(0.15, audioContext.currentTime + 0.15)
  crackleGain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1)
  
  crackleOsc.connect(crackleGain)
  crackleGain.connect(audioContext.destination)
  
  // Start all sounds
  noiseSource.start(audioContext.currentTime + 0.15)
  oscillator.start(audioContext.currentTime + 0.15)
  crackleOsc.start(audioContext.currentTime + 0.15)
  
  noiseSource.stop(audioContext.currentTime + 0.3)
  oscillator.stop(audioContext.currentTime + 0.25)
  crackleOsc.stop(audioContext.currentTime + 0.1)
}

// Play laser sound effect using Web Audio API
function playLaserSound() {
  const audioContext = getAudioContext()
  if (!audioContext) return
  
  // Create oscillator for the main laser tone
  const oscillator = audioContext.createOscillator()
  const gainNode = audioContext.createGain()
  
  // Connect nodes
  oscillator.connect(gainNode)
  gainNode.connect(audioContext.destination)
  
  // Set up the laser sound - start high, sweep down
  oscillator.type = 'sawtooth'
  oscillator.frequency.setValueAtTime(3000, audioContext.currentTime)
  oscillator.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.15)
  
  // Quick attack, fast decay for that "pew" effect
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3)
  
  // Add a secondary oscillator for texture
  const oscillator2 = audioContext.createOscillator()
  const gainNode2 = audioContext.createGain()
  oscillator2.connect(gainNode2)
  gainNode2.connect(audioContext.destination)
  
  oscillator2.type = 'square'
  oscillator2.frequency.setValueAtTime(800, audioContext.currentTime)
  oscillator2.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.1)
  
  gainNode2.gain.setValueAtTime(0.1, audioContext.currentTime)
  gainNode2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1)
  
  // Start and stop the oscillators
  oscillator.start(audioContext.currentTime)
  oscillator.stop(audioContext.currentTime + 0.15)
  oscillator2.start(audioContext.currentTime)
  oscillator2.stop(audioContext.currentTime + 0.1)
}

// Laser system - manages all active lasers and listens for clicks
function LaserSystem() {
  const { camera, scene, gl } = useThree()
  const [lasers, setLasers] = useState<LaserData[]>([])
  const nextLaserId = useRef(0)
  const lastFireTime = useRef(0)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const { mode } = useContext(ControlModeContext)
  
  // Track mouse movement to distinguish clicks from drags (OrbitControls)
  const mouseDownPos = useRef<{ x: number, y: number } | null>(null)
  const isDragging = useRef(false)
  
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      mouseDownPos.current = { x: event.clientX, y: event.clientY }
      isDragging.current = false
    }
    
    const handleMouseMove = (event: MouseEvent) => {
      if (mouseDownPos.current) {
        const dx = event.clientX - mouseDownPos.current.x
        const dy = event.clientY - mouseDownPos.current.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        // If mouse moved more than 5 pixels, consider it a drag - switch to map mode
        if (distance > 5) {
          isDragging.current = true
          // Switch to map mode when dragging
          controlModeState.setMode('map')
          mouseDownPos.current = null
        }
      }
    }
    
    const handleMouseUp = () => {
      mouseDownPos.current = null
    }
    
    const handleClick = (event: MouseEvent) => {
      // Don't fire if user was dragging (using MapControls)
      if (isDragging.current) {
        isDragging.current = false
        return
      }
      
      // Don't fire lasers in map mode
      if (controlModeState.mode === 'map') {
        return
      }
      
      // Debounce - prevent double firing within 50ms
      const now = performance.now()
      if (now - lastFireTime.current < 50) return
      lastFireTime.current = now
      
      // Convert mouse position to normalized device coordinates
      const rect = gl.domElement.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      
      // Set up raycaster from camera through mouse position
      raycaster.setFromCamera(mouse, camera)
      
      // Get all intersections
      const intersects = raycaster.intersectObjects(scene.children, true)
      
      if (intersects.length > 0) {
        // Start the laser from the player's sphere position
        const start = new THREE.Vector3(playerPosition.x, playerPosition.y, playerPosition.z)
        
        // Get the hit point as the end of the laser
        const end = intersects[0].point.clone()
        
        const newLaser: LaserData = {
          id: nextLaserId.current++,
          start,
          end,
          createdAt: performance.now()
        }
        
        // Play laser sound effect
        playLaserSound()
        
        setLasers(prev => [...prev, newLaser])
        
        // Remove laser after animation completes
        setTimeout(() => {
          setLasers(prev => prev.filter(l => l.id !== newLaser.id))
        }, 200)
      }
    }
    
    gl.domElement.addEventListener('mousedown', handleMouseDown)
    gl.domElement.addEventListener('mousemove', handleMouseMove)
    gl.domElement.addEventListener('mouseup', handleMouseUp)
    gl.domElement.addEventListener('click', handleClick)
    return () => {
      gl.domElement.removeEventListener('mousedown', handleMouseDown)
      gl.domElement.removeEventListener('mousemove', handleMouseMove)
      gl.domElement.removeEventListener('mouseup', handleMouseUp)
      gl.domElement.removeEventListener('click', handleClick)
    }
  }, [camera, scene, gl, raycaster, mode])
  
  return (
    <>
      {lasers.map(laser => (
        <LaserBeam 
          key={laser.id}
          start={laser.start}
          end={laser.end}
          createdAt={laser.createdAt}
        />
      ))}
    </>
  )
}

// Single sheep with physics body - now destructible
function SingleSheep({ initialX, initialZ, scale, phase }: { 
  initialX: number
  initialZ: number
  scale: number
  phase: number 
}) {
  const rigidBodyRef = useRef<RapierRigidBody>(null!)
  const visualGroupRef = useRef<THREE.Group>(null!)
  const [destroyed, setDestroyed] = useState(false)
  const [fragments, setFragments] = useState<THREE.Mesh[]>([])
  const [lastPosition, setLastPosition] = useState<[number, number, number]>([initialX, getTerrainHeight(initialX, initialZ) + 2, initialZ])
  
  // Mutable state for movement behavior - calculate initial valid target
  const initialState = useMemo(() => {
    // Find a valid initial target
    let targetX = initialX
    let targetZ = initialZ
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = Math.random() * Math.PI * 2
      const distance = 5 + Math.random() * 15
      const testX = initialX + Math.cos(angle) * distance
      const testZ = initialZ + Math.sin(angle) * distance
      const testHeight = getTerrainHeight(testX, testZ)
      // Use terrain system to check if valid sheep zone
      if (isSheepZone(testHeight)) {
        targetX = testX
        targetZ = testZ
        break
      }
    }
    return {
      targetX,
      targetZ,
      rotY: Math.random() * Math.PI * 2,
      moveSpeed: 2 + Math.random() * 3, // Slightly slower for more natural grazing behavior
      nextDirectionChange: Math.random() * 3 + 3, // Time until next direction change
      isMoving: true // Start moving immediately
    }
  }, [initialX, initialZ])
  
  const state = useRef(initialState)
  
  const handleClick = useCallback(() => {
    if (destroyed) return
    
    // Get current position from physics body
    let currentPos = lastPosition
    if (rigidBodyRef.current) {
      const pos = rigidBodyRef.current.translation()
      currentPos = [pos.x, pos.y, pos.z]
    }
    
    const woolMat = new THREE.MeshStandardMaterial({ color: 0xF5F5F0, roughness: 1 })
    const woolInnerMat = new THREE.MeshStandardMaterial({ color: 0xE0E0E0, roughness: 1 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2D2D2D, roughness: 0.8 })
    const darkInnerMat = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.8 })
    
    const allFragments: THREE.Mesh[] = []
    
    const options = new FractureOptions({
      fractureMethod: 'voronoi',
      fragmentCount: 6,
      voronoiOptions: {
        mode: '3D',
      },
    })
    
    // Fracture main body - use local positions, add world position in callback
    const bodyGeo = new THREE.SphereGeometry(0.6, 12, 10)
    const bodyMesh = new DestructibleMesh(bodyGeo, woolMat, woolInnerMat)
    bodyMesh.position.set(0, 0.6 * scale, 0)
    bodyMesh.scale.setScalar(scale)
    bodyMesh.fracture(options, (fragment) => {
      fragment.position.add(new THREE.Vector3(currentPos[0], currentPos[1], currentPos[2]))
      allFragments.push(fragment)
    })
    
    // Fracture head
    const headGeo = new THREE.SphereGeometry(0.28, 10, 8)
    const headMesh = new DestructibleMesh(headGeo, darkMat, darkInnerMat)
    headMesh.position.set(0.65 * scale, 0.65 * scale, 0)
    headMesh.scale.setScalar(scale)
    headMesh.fracture(options, (fragment) => {
      fragment.position.add(new THREE.Vector3(currentPos[0], currentPos[1], currentPos[2]))
      allFragments.push(fragment)
    })
    
    // Fracture wool puffs
    const puff1Geo = new THREE.SphereGeometry(0.35, 8, 8)
    const puff1Mesh = new DestructibleMesh(puff1Geo, woolMat, woolInnerMat)
    puff1Mesh.position.set(0.2 * scale, 0.75 * scale, 0.2 * scale)
    puff1Mesh.scale.setScalar(scale)
    puff1Mesh.fracture(options, (fragment) => {
      fragment.position.add(new THREE.Vector3(currentPos[0], currentPos[1], currentPos[2]))
      allFragments.push(fragment)
    })
    
    const puff2Geo = new THREE.SphereGeometry(0.32, 8, 8)
    const puff2Mesh = new DestructibleMesh(puff2Geo, woolMat, woolInnerMat)
    puff2Mesh.position.set(-0.2 * scale, 0.75 * scale, -0.15 * scale)
    puff2Mesh.scale.setScalar(scale)
    puff2Mesh.fracture(options, (fragment) => {
      fragment.position.add(new THREE.Vector3(currentPos[0], currentPos[1], currentPos[2]))
      allFragments.push(fragment)
    })
    
    setFragments(allFragments)
    setDestroyed(true)
    
    // Play blast sound effect
    playBlastSound()
  }, [destroyed, scale, lastPosition])
  
  useFrame((frameState, delta) => {
    if (destroyed) return
    if (!rigidBodyRef.current || !visualGroupRef.current) return
    
    const time = frameState.clock.elapsedTime
    const sheep = state.current
    
    // Get current position from physics body
    const position = rigidBodyRef.current.translation()
    const currentX = position.x
    const currentZ = position.z
    
    // Update last position for destruction
    setLastPosition([position.x, position.y, position.z])
    
    // Check if it's time to change direction
    if (time > sheep.nextDirectionChange) {
      sheep.isMoving = Math.random() > 0.3 // 70% chance to move
      if (sheep.isMoving) {
        // Pick a new target within a reasonable range
        const angle = Math.random() * Math.PI * 2
        const distance = 5 + Math.random() * 15
        sheep.targetX = currentX + Math.cos(angle) * distance
        sheep.targetZ = currentZ + Math.sin(angle) * distance
        
        // Keep within terrain bounds
        sheep.targetX = Math.max(-TERRAIN_DIMENSIONS.SHEEP_MOVEMENT_BOUNDS, Math.min(TERRAIN_DIMENSIONS.SHEEP_MOVEMENT_BOUNDS, sheep.targetX))
        sheep.targetZ = Math.max(-TERRAIN_DIMENSIONS.SHEEP_MOVEMENT_BOUNDS, Math.min(TERRAIN_DIMENSIONS.SHEEP_MOVEMENT_BOUNDS, sheep.targetZ))
        
        // Check if target is valid terrain (uses terrain system)
        const targetHeight = getTerrainHeight(sheep.targetX, sheep.targetZ)
        if (!isSheepZone(targetHeight)) {
          // Invalid target, try to find a valid one nearby
          let foundValid = false
          for (let attempt = 0; attempt < 5; attempt++) {
            const retryAngle = Math.random() * Math.PI * 2
            const retryDist = 3 + Math.random() * 8
            const testX = currentX + Math.cos(retryAngle) * retryDist
            const testZ = currentZ + Math.sin(retryAngle) * retryDist
            const testHeight = getTerrainHeight(testX, testZ)
            if (isSheepZone(testHeight)) {
              sheep.targetX = testX
              sheep.targetZ = testZ
              foundValid = true
              break
            }
          }
          if (!foundValid) {
            sheep.isMoving = false
          }
        }
      }
      sheep.nextDirectionChange = time + 2 + Math.random() * 5
    }
    
    // Calculate velocity based on movement
    let velX = 0
    let velZ = 0
    
    if (sheep.isMoving) {
      const dx = sheep.targetX - currentX
      const dz = sheep.targetZ - currentZ
      const dist = Math.sqrt(dx * dx + dz * dz)
      
      if (dist > 0.5) {
        // Calculate target rotation
        const targetRotY = Math.atan2(dx, dz)
        
        // Smoothly rotate towards movement direction
        let rotDiff = targetRotY - sheep.rotY
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
        sheep.rotY += rotDiff * delta * 3
        
        // Set velocity towards target
        velX = (dx / dist) * sheep.moveSpeed
        velZ = (dz / dist) * sheep.moveSpeed
      } else {
        // Reached target - immediately pick a new one to keep moving
        // Find a valid new target
        let foundValid = false
        for (let attempt = 0; attempt < 10; attempt++) {
          const newAngle = Math.random() * Math.PI * 2
          const newDist = 5 + Math.random() * 15
          const testX = currentX + Math.cos(newAngle) * newDist
          const testZ = currentZ + Math.sin(newAngle) * newDist
          const testHeight = getTerrainHeight(testX, testZ)
          // Use terrain system for validation
          if (isSheepZone(testHeight) && 
              Math.abs(testX) < TERRAIN_DIMENSIONS.SHEEP_MOVEMENT_BOUNDS && Math.abs(testZ) < TERRAIN_DIMENSIONS.SHEEP_MOVEMENT_BOUNDS) {
            sheep.targetX = testX
            sheep.targetZ = testZ
            foundValid = true
            break
          }
        }
        if (!foundValid) {
          // Couldn't find valid target, rest briefly
          sheep.isMoving = false
          sheep.nextDirectionChange = time + 1 + Math.random() * 2 // Short rest
        }
      }
    }
    
    // Get current velocity and preserve Y component (gravity)
    const currentVel = rigidBodyRef.current.linvel()
    rigidBodyRef.current.setLinvel({ x: velX, y: currentVel.y, z: velZ }, true)
    
    // Update visual rotation (physics body stays upright via locked rotations)
    visualGroupRef.current.rotation.y = sheep.rotY
    
    // Walking animation - bobbing motion when moving
    if (sheep.isMoving) {
      visualGroupRef.current.rotation.x = Math.sin(time * 8 + phase) * 0.05
    } else {
      // Grazing animation - subtle head bob
      visualGroupRef.current.rotation.x = Math.sin(time * 1.5 + phase) * 0.03
    }
    
    // Subtle body sway
    visualGroupRef.current.rotation.z = Math.sin(time * 0.5 + phase) * 0.015
  })
  
  const startHeight = getTerrainHeight(initialX, initialZ) + 2 // Start slightly above ground
  
  if (destroyed) {
    return (
      <FragmentsContainer 
        fragments={fragments} 
      />
    )
  }
  
  return (
    <RigidBody
      ref={rigidBodyRef}
      position={[initialX, startHeight, initialZ]}
      colliders={false}
      mass={1}
      linearDamping={2}
      angularDamping={10}
      enabledRotations={[false, false, false]} // Lock all rotations - keep sheep upright
      friction={1}
    >
      <CuboidCollider args={[0.4 * scale, 0.4 * scale, 0.5 * scale]} position={[0, 0.5 * scale, 0]} />
      <group ref={visualGroupRef} scale={scale} onClick={handleClick}>
        {/* Body - fluffy wool */}
        <mesh position={[0, 0.6, 0]} castShadow>
          <sphereGeometry args={[0.6, 12, 10]} />
          <meshStandardMaterial color="#F5F5F0" roughness={1} />
        </mesh>
        {/* Body wool puffs */}
        <mesh position={[0.2, 0.75, 0.2]} castShadow>
          <sphereGeometry args={[0.35, 8, 8]} />
          <meshStandardMaterial color="#FAFAFA" roughness={1} />
        </mesh>
        <mesh position={[-0.2, 0.75, -0.15]} castShadow>
          <sphereGeometry args={[0.32, 8, 8]} />
          <meshStandardMaterial color="#F0F0E8" roughness={1} />
        </mesh>
        <mesh position={[0, 0.85, -0.1]} castShadow>
          <sphereGeometry args={[0.28, 8, 8]} />
          <meshStandardMaterial color="#FAFAFA" roughness={1} />
        </mesh>
        
        {/* Head */}
        <mesh position={[0.65, 0.65, 0]} castShadow>
          <sphereGeometry args={[0.28, 10, 8]} />
          <meshStandardMaterial color="#2D2D2D" roughness={0.8} />
        </mesh>
        
        {/* Ears */}
        <mesh position={[0.6, 0.85, 0.18]} rotation={[0.3, 0.2, 0.5]} castShadow>
          <boxGeometry args={[0.08, 0.15, 0.06]} />
          <meshStandardMaterial color="#3D3D3D" roughness={0.8} />
        </mesh>
        <mesh position={[0.6, 0.85, -0.18]} rotation={[-0.3, -0.2, 0.5]} castShadow>
          <boxGeometry args={[0.08, 0.15, 0.06]} />
          <meshStandardMaterial color="#3D3D3D" roughness={0.8} />
        </mesh>
        
        {/* Snout */}
        <mesh position={[0.88, 0.58, 0]} castShadow>
          <sphereGeometry args={[0.12, 8, 6]} />
          <meshStandardMaterial color="#4A4A4A" roughness={0.7} />
        </mesh>
        
        {/* Eyes */}
        <mesh position={[0.78, 0.72, 0.12]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial color="#1A1A1A" roughness={0.3} />
        </mesh>
        <mesh position={[0.78, 0.72, -0.12]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial color="#1A1A1A" roughness={0.3} />
        </mesh>
        
        {/* Legs */}
        <mesh position={[0.25, 0.2, 0.25]} castShadow>
          <cylinderGeometry args={[0.06, 0.05, 0.45, 6]} />
          <meshStandardMaterial color="#2D2D2D" roughness={0.8} />
        </mesh>
        <mesh position={[0.25, 0.2, -0.25]} castShadow>
          <cylinderGeometry args={[0.06, 0.05, 0.45, 6]} />
          <meshStandardMaterial color="#2D2D2D" roughness={0.8} />
        </mesh>
        <mesh position={[-0.25, 0.2, 0.25]} castShadow>
          <cylinderGeometry args={[0.06, 0.05, 0.45, 6]} />
          <meshStandardMaterial color="#2D2D2D" roughness={0.8} />
        </mesh>
        <mesh position={[-0.25, 0.2, -0.25]} castShadow>
          <cylinderGeometry args={[0.06, 0.05, 0.45, 6]} />
          <meshStandardMaterial color="#2D2D2D" roughness={0.8} />
        </mesh>
        
        {/* Tail - small wool tuft */}
        <mesh position={[-0.55, 0.55, 0]} castShadow>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshStandardMaterial color="#F5F5F0" roughness={1} />
        </mesh>
      </group>
    </RigidBody>
  )
}

function Sheep() {
  // Generate initial sheep positions
  const sheepData = useMemo(() => {
    const data = []
    for (let i = 0; i < 300; i++) {
      const x = (Math.random() - 0.5) * TERRAIN_DIMENSIONS.SHEEP_SPAWN_SPREAD
      const z = (Math.random() - 0.5) * TERRAIN_DIMENSIONS.SHEEP_SPAWN_SPREAD
      const height = getTerrainHeight(x, z)
      
      // Only place sheep in valid sheep zones (uses terrain system)
      if (isSheepZone(height)) {
        data.push({ 
          x, 
          z,
          scale: 0.8 + Math.random() * 0.4,
          phase: Math.random() * Math.PI * 2
        })
      }
    }
    return data
  }, [])

  return (
    <>
      {sheepData.map((sheep, i) => (
        <SingleSheep
          key={i}
          initialX={sheep.x}
          initialZ={sheep.z}
          scale={sheep.scale}
          phase={sheep.phase}
        />
      ))}
    </>
  )
}

// Single destructible rock component
function DestructibleRock({ x, y, z, scale, rotY }: { x: number, y: number, z: number, scale: number, rotY: number }) {
  const [destroyed, setDestroyed] = useState(false)
  const [fragments, setFragments] = useState<THREE.Mesh[]>([])
  
  const handleClick = useCallback(() => {
    if (destroyed) return
    
    const rockGeo = new THREE.DodecahedronGeometry(1, 0)
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x757575, roughness: 0.95, metalness: 0.05 })
    const rockInnerMat = new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.95, metalness: 0.05 })
    
    const options = new FractureOptions({
      fractureMethod: 'voronoi',
      fragmentCount: 12,
      voronoiOptions: {
        mode: '3D',
      },
    })
    
    const rockMesh = new DestructibleMesh(rockGeo, rockMat, rockInnerMat)
    rockMesh.scale.setScalar(scale)
    rockMesh.rotation.set(0, rotY, 0)
    
    const allFragments: THREE.Mesh[] = []
    rockMesh.fracture(options, (fragment) => {
      // Add world position to fragment
      fragment.position.add(new THREE.Vector3(x, y, z))
      allFragments.push(fragment)
    })
    
    setFragments(allFragments)
    setDestroyed(true)
    
    // Play blast sound effect
    playBlastSound()
  }, [destroyed, x, y, z, scale, rotY])
  
  if (destroyed) {
    return (
      <FragmentsContainer 
        fragments={fragments} 
      />
    )
  }
  
  return (
    <mesh 
      position={[x, y, z]} 
      scale={scale}
      rotation={[0, rotY, 0]}
      castShadow
      onClick={handleClick}
    >
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial 
        color="#757575" 
        roughness={0.95}
        metalness={0.05}
      />
    </mesh>
  )
}

// Font URL for Text3D (Inter Bold from Google Fonts converted to typeface.js format)
const FONT_URL = 'https://cdn.jsdelivr.net/npm/three/examples/fonts/helvetiker_bold.typeface.json'

// Destructible TypeScript Block - blue cube with "TS" letters using Text3D
function DestructibleTypeScriptBlock({ x, y, z, scale }: { x: number, y: number, z: number, scale: number }) {
  const [destroyed, setDestroyed] = useState(false)
  const [fragments, setFragments] = useState<THREE.Mesh[]>([])
  
  // TypeScript blue color
  const tsBlue = 0x3178C6
  const tsBlueLight = 0x4A90D9
  const white = 0xFFFFFF
  
  const handleClick = useCallback(() => {
    if (destroyed) return
    
    // Create materials
    const blueMat = new THREE.MeshStandardMaterial({ color: tsBlue, roughness: 0.3, metalness: 0.1 })
    const blueInnerMat = new THREE.MeshStandardMaterial({ color: tsBlueLight, roughness: 0.3, metalness: 0.1 })
    
    const allFragments: THREE.Mesh[] = []
    
    const options = new FractureOptions({
      fractureMethod: 'voronoi',
      fragmentCount: 15,
      voronoiOptions: {
        mode: '3D',
      },
    })
    
    // Fracture main cube
    const cubeGeo = new THREE.BoxGeometry(2, 2, 2, 4, 4, 4)
    const cubeMesh = new DestructibleMesh(cubeGeo, blueMat, blueInnerMat)
    cubeMesh.scale.setScalar(scale)
    cubeMesh.fracture(options, (fragment) => {
      fragment.position.add(new THREE.Vector3(x, y, z))
      allFragments.push(fragment)
    })
    
    setFragments(allFragments)
    setDestroyed(true)
    
    // Play blast sound effect
    playBlastSound()
  }, [destroyed, x, y, z, scale])
  
  if (destroyed) {
    return (
      <FragmentsContainer 
        fragments={fragments} 
      />
    )
  }
  
  return (
    <group position={[x, y, z]} rotation={[0,Math.PI/4,0]} scale={scale} onClick={handleClick}>
      {/* Main blue cube with rounded edges using drei RoundedBox */}
      <RoundedBox args={[2, 2, 2]} radius={0.15} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial 
          color={tsBlue}
          roughness={0.3}
          metalness={0.1}
        />
      </RoundedBox>
      
      {/* "TS" text using Text3D from drei */}
      <Center position={[.2, -0.3, 1.01]}>
        <Text3D
          font={FONT_URL}
          size={0.7}
          height={0.15}
          curveSegments={12}
          bevelEnabled
          bevelThickness={0.02}
          bevelSize={0.02}
          bevelOffset={0}
          bevelSegments={3}
          castShadow
        >
          TS
          <meshStandardMaterial color={white} roughness={0.4} />
        </Text3D>
      </Center>
    </group>
  )
}


// Single cloud made of multiple spheres for a fluffy look
function Cloud({ initialX, initialY, initialZ, scale, speed }: { 
  initialX: number
  initialY: number
  initialZ: number
  scale: number
  speed: number 
}) {
  const groupRef = useRef<THREE.Group>(null!)
  
  // Generate random puffs for this cloud
  const puffs = useMemo(() => {
    const rng = seededRandom(Math.floor(initialX * 1000 + initialZ * 100))
    const numPuffs = 5 + Math.floor(rng() * 8)
    const puffData = []
    
    for (let i = 0; i < numPuffs; i++) {
      puffData.push({
        x: (rng() - 0.5) * 200 * scale,
        y: (rng() - 0.5) * 10 * scale,
        z: (rng() - 0.5) * 200 * scale,
        radius: (8 + rng() * 15) * scale,
      })
    }
    return puffData
  }, [initialX, initialZ, scale])
  
  useFrame((_, delta) => {
    if (!groupRef.current) return
    
    // Move cloud along X axis
    groupRef.current.position.x += speed * delta
    
    // Wrap around when cloud goes too far
    if (groupRef.current.position.x > TERRAIN_DIMENSIONS.CLOUD_WRAP_DISTANCE) {
      groupRef.current.position.x = -TERRAIN_DIMENSIONS.CLOUD_WRAP_DISTANCE
    }
  })
  
  return (
    <group ref={groupRef} position={[initialX, initialY, initialZ]}>
      {puffs.map((puff, i) => (
        <mesh castShadow key={i} position={[puff.x, puff.y, puff.z]}>
          <sphereGeometry args={[puff.radius, 12, 10]} />
          <meshStandardMaterial 
            color="#ffffff"
            roughness={1}
            metalness={0}
            transparent
            opacity={0.9}
          />
        </mesh>
      ))}
    </group>
  )
}

// Clouds system - multiple clouds drifting across the sky
function Clouds() {
  const cloudsData = useMemo(() => {
    const data = []
    const rng = seededRandom(77777)
    
    // Create clouds spread across the sky
    for (let i = 0; i < 50; i++) {
      data.push({
        x: (rng() - 0.5) * TERRAIN_DIMENSIONS.CLOUD_SPREAD + TERRAIN_DIMENSIONS.CLOUD_WRAP_DISTANCE + 50,
        y: TERRAIN_DIMENSIONS.CLOUD_HEIGHT,
        z: (rng() - 0.5) * TERRAIN_DIMENSIONS.CLOUD_SPREAD,
        scale: 0.6 + rng() * 0.8,
        speed: 3 + rng() * 8, // Drift speed
      })
    }
    return data
  }, [])
  
  return (
    <group>
      {cloudsData.map((cloud, i) => (
        <Cloud
          key={i}
          initialX={cloud.x}
          initialY={cloud.y}
          initialZ={cloud.z}
          scale={cloud.scale}
          speed={cloud.speed}
        />
      ))}
    </group>
  )
}

function Rocks() {
  const rocks = useMemo(() => {
    const rockData = []
    const rng = seededRandom(98765) // Use seeded random for consistent rock placement
    for (let i = 0; i < 800; i++) {
      const x = (rng() - 0.5) * TERRAIN_DIMENSIONS.ROCK_SPAWN_SPREAD
      const z = (rng() - 0.5) * TERRAIN_DIMENSIONS.ROCK_SPAWN_SPREAD
      const height = getTerrainHeight(x, z)
      
      // Place rocks in valid rock zones (uses terrain system)
      if (isRockZone(height)) {
        // More rocks on mountain slopes and cliffs (uses terrain system)
        const scale = isHighAltitude(height) 
          ? 0.5 + rng() * 3 // Bigger boulders on mountains
          : 0.3 + rng() * (rng() > 0.9 ? 4 : 1)
        
        rockData.push({ 
          x, 
          y: height - 0.3, 
          z, 
          scale,
          rotY: rng() * Math.PI * 2
        })
      }
    }
    return rockData
  }, [])

  return (
    <group>
      {rocks.map((rock, i) => (
        <DestructibleRock 
          key={i}
          x={rock.x}
          y={rock.y}
          z={rock.z}
          scale={rock.scale}
          rotY={rock.rotY}
        />
      ))}
    </group>
  )
}

// Control key mappings for KeyboardControls (const object instead of enum for TypeScript compatibility)
const Controls = {
  forward: 'forward',
  backward: 'backward',
  left: 'left',
  right: 'right',
  jump: 'jump',
  turnLeft: 'turnLeft',
  turnRight: 'turnRight',
  lookUp: 'lookUp',
  lookDown: 'lookDown',
} as const

// Mobile joystick state (shared between components)
const mobileInput = {
  moveX: 0,
  moveY: 0,
  cameraX: 0,
  cameraY: 0,
  jump: false,
}

// Player position state (shared between PlayerSphere and LaserSystem)
const playerPosition = {
  x: 0,
  y: 0,
  z: 0,
}

// Player sphere with keyboard controls (drei) and mobile touch support
function PlayerSphere() {
  const rigidBodyRef = useRef<RapierRigidBody>(null!)
  const { camera } = useThree()
  
  // Get keyboard state from drei's KeyboardControls
  const [, getKeys] = useKeyboardControls()
  
  // Camera rotation state
  const cameraAngle = useRef(0)
  const cameraPitch = useRef(0.3)
  const cameraDistance = useRef(100)
  
  useFrame((_, delta) => {
    if (!rigidBodyRef.current) return
    
    const moveSpeed = 300
    const jumpForce = 5000
    const turnSpeed = 2
    const pitchSpeed = 1
    
    // Get keyboard state
    const { forward, backward, left, right, jump, turnLeft, turnRight, lookUp, lookDown } = getKeys()
    
    // Only process player controls and camera following in player mode
    if (controlModeState.mode === 'player') {
      // Handle camera rotation (keyboard + mobile)
      if (turnLeft || mobileInput.cameraX < -0.2) cameraAngle.current += turnSpeed * delta
      if (turnRight || mobileInput.cameraX > 0.2) cameraAngle.current -= turnSpeed * delta
      if (lookUp || mobileInput.cameraY < -0.2) cameraPitch.current = Math.max(0.1, cameraPitch.current - pitchSpeed * delta)
      if (lookDown || mobileInput.cameraY > 0.2) cameraPitch.current = Math.min(1.2, cameraPitch.current + pitchSpeed * delta)
    }
    
    // Get camera direction for relative movement
    const cameraDirection = new THREE.Vector3(
      -Math.sin(cameraAngle.current),
      0,
      -Math.cos(cameraAngle.current)
    ).normalize()
    
    // Calculate right vector
    const rightVector = new THREE.Vector3()
    rightVector.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0)).normalize()
    
    // Calculate movement direction (keyboard + mobile joystick) - only in player mode
    const moveDirection = new THREE.Vector3()
    
    if (controlModeState.mode === 'player') {
      // Keyboard input
      if (forward) moveDirection.add(cameraDirection)
      if (backward) moveDirection.sub(cameraDirection)
      if (left) moveDirection.sub(rightVector)
      if (right) moveDirection.add(rightVector)
      
      // Mobile joystick input
      if (Math.abs(mobileInput.moveY) > 0.1) {
        const forwardAmount = cameraDirection.clone().multiplyScalar(-mobileInput.moveY)
        moveDirection.add(forwardAmount)
      }
      if (Math.abs(mobileInput.moveX) > 0.1) {
        const rightAmount = rightVector.clone().multiplyScalar(mobileInput.moveX)
        moveDirection.add(rightAmount)
      }
    }
    
    if (moveDirection.length() > 0) {
      moveDirection.normalize()
      rigidBodyRef.current.applyImpulse(
        { x: moveDirection.x * moveSpeed, y: 0, z: moveDirection.z * moveSpeed },
        true
      )
    }
    
    // Jump (keyboard or mobile button) - only in player mode
    if (controlModeState.mode === 'player' && (jump || mobileInput.jump)) {
      const vel = rigidBodyRef.current.linvel()
      if (Math.abs(vel.y) < 0.5) {
        rigidBodyRef.current.applyImpulse({ x: 0, y: jumpForce, z: 0 }, true)
      }
    }
    
    // Update shared player position for laser system
    const pos = rigidBodyRef.current.translation()
    playerPosition.x = pos.x
    playerPosition.y = pos.y
    playerPosition.z = pos.z
    
    // Only follow player with camera in player mode
    if (controlModeState.mode === 'player') {
      const heightOffset = Math.sin(cameraPitch.current) * cameraDistance.current
      const horizontalDist = Math.cos(cameraPitch.current) * cameraDistance.current
      
      const targetCameraPos = new THREE.Vector3(
        pos.x + Math.sin(cameraAngle.current) * horizontalDist,
        pos.y + heightOffset,
        pos.z + Math.cos(cameraAngle.current) * horizontalDist
      )
      camera.position.lerp(targetCameraPos, 0.08)
      camera.lookAt(pos.x, pos.y, pos.z)
    }
  })
  
  const startX = 0
  const startZ = 0
  const startY = getTerrainHeight(startX, startZ) + 5
  
  return (
    <RigidBody
      ref={rigidBodyRef}
      position={[startX, startY, startZ]}
      colliders="ball"
      mass={5}
      linearDamping={2}
      angularDamping={0.5}
      restitution={0.3}
    >
      <mesh castShadow>
        <sphereGeometry args={[2, 32, 32]} />
        <meshStandardMaterial color="#ff6b35" roughness={0.4} metalness={0.3} />
      </mesh>
    </RigidBody>
  )
}

// Mobile virtual joystick component (rendered outside Canvas)
function MobileJoystick({ side, onMove }: { side: 'left' | 'right', onMove: (x: number, y: number) => void }) {
  const joystickRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const touchId = useRef<number | null>(null)
  const centerRef = useRef({ x: 0, y: 0 })
  
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (touchId.current !== null) return
    const touch = e.changedTouches[0]
    touchId.current = touch.identifier
    const rect = joystickRef.current?.getBoundingClientRect()
    if (rect) {
      centerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
  }, [])
  
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      if (touch.identifier === touchId.current) {
        const dx = touch.clientX - centerRef.current.x
        const dy = touch.clientY - centerRef.current.y
        const maxDist = 40
        const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist)
        const angle = Math.atan2(dy, dx)
        const normX = (dist / maxDist) * Math.cos(angle)
        const normY = (dist / maxDist) * Math.sin(angle)
        
        if (knobRef.current) {
          knobRef.current.style.transform = `translate(${normX * maxDist}px, ${normY * maxDist}px)`
        }
        onMove(normX, normY)
      }
    }
  }, [onMove])
  
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId.current) {
        touchId.current = null
        if (knobRef.current) {
          knobRef.current.style.transform = 'translate(0px, 0px)'
        }
        onMove(0, 0)
      }
    }
  }, [onMove])
  
  return (
    <div
      ref={joystickRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'fixed',
        bottom: 30,
        [side]: 30,
        width: 120,
        height: 120,
        borderRadius: '50%',
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        border: '2px solid rgba(255, 255, 255, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'none',
        zIndex: 1000,
      }}
    >
      <div
        ref={knobRef}
        style={{
          width: 50,
          height: 50,
          borderRadius: '50%',
          backgroundColor: 'rgba(255, 255, 255, 0.6)',
          transition: 'transform 0.05s',
        }}
      />
    </div>
  )
}

// Mobile controls overlay
function MobileControls() {
  const [isMobile, setIsMobile] = useState(false)
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  
  if (!isMobile) return null
  
  return (
    <>
      <MobileJoystick 
        side="left" 
        onMove={(x, y) => { mobileInput.moveX = x; mobileInput.moveY = y }}
      />
      <MobileJoystick 
        side="right" 
        onMove={(x, y) => { mobileInput.cameraX = x; mobileInput.cameraY = y }}
      />
      {/* Jump button */}
      <button
        onTouchStart={() => { 
          mobileInput.jump = true
        }}
        onTouchEnd={() => {
          mobileInput.jump = false
        }}
        style={{
          position: 'fixed',
          bottom: 160,
          right: 50,
          width: 70,
          height: 70,
          borderRadius: '50%',
          backgroundColor: 'rgba(255, 107, 53, 0.6)',
          border: '2px solid rgba(255, 255, 255, 0.4)',
          color: 'white',
          fontSize: 14,
          fontWeight: 'bold',
          touchAction: 'none',
          zIndex: 1000,
        }}
      >
        JUMP
      </button>
    </>
  )
}

// Day/Night cycle configuration
const DAY_NIGHT_CYCLE = {
  CYCLE_DURATION: 5 * 60, // 5 minutes in seconds
  TRANSITION_DURATION: 30, // 30 seconds for smooth transition
}

// OPTIMIZED: Dynamic stars that read from timeOfDayRef without re-renders
function DynamicStars({ timeOfDayRef }: { timeOfDayRef: React.MutableRefObject<number> }) {
  const starsRef = useRef<THREE.Points>(null!)
  const isVisibleRef = useRef(false)
  
  const { positions, colors } = useMemo(() => {
    const count = 2000
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const rng = seededRandom(42424)
    
    for (let i = 0; i < count; i++) {
      const theta = rng() * Math.PI * 2
      const phi = Math.acos(2 * rng() - 1)
      const radius = 800 + rng() * 100
      
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi)) + 100
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
      
      const colorVariation = rng()
      if (colorVariation < 0.7) {
        colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1
      } else if (colorVariation < 0.85) {
        colors[i * 3] = 0.8; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 1
      } else {
        colors[i * 3] = 1; colors[i * 3 + 1] = 0.95; colors[i * 3 + 2] = 0.8
      }
    }
    return { positions, colors }
  }, [])
  
  useFrame((state) => {
    if (!starsRef.current) return
    
    const timeOfDay = timeOfDayRef.current
    let starOpacity = 0
    if (timeOfDay >= 0.2 && timeOfDay <= 0.8) {
      if (timeOfDay < 0.35) starOpacity = (timeOfDay - 0.2) / 0.15
      else if (timeOfDay > 0.65) starOpacity = (0.8 - timeOfDay) / 0.15
      else starOpacity = 1
    }
    
    const shouldBeVisible = starOpacity > 0
    if (shouldBeVisible !== isVisibleRef.current) {
      starsRef.current.visible = shouldBeVisible
      isVisibleRef.current = shouldBeVisible
    }
    
    if (shouldBeVisible) {
      const material = starsRef.current.material as THREE.PointsMaterial
      material.opacity = starOpacity * (0.8 + Math.sin(state.clock.elapsedTime * 0.5) * 0.2)
    }
  })
  
  return (
    <points ref={starsRef} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={2} transparent opacity={0} vertexColors sizeAttenuation={false} />
    </points>
  )
}

// OPTIMIZED: Dynamic moon that reads from timeOfDayRef without re-renders
function DynamicMoon({ timeOfDayRef }: { timeOfDayRef: React.MutableRefObject<number> }) {
  const groupRef = useRef<THREE.Group>(null!)
  const mainMoonRef = useRef<THREE.Mesh>(null!)
  const patch1Ref = useRef<THREE.Mesh>(null!)
  const patch2Ref = useRef<THREE.Mesh>(null!)
  const patch3Ref = useRef<THREE.Mesh>(null!)
  const outerGlowRef = useRef<THREE.Mesh>(null!)
  const innerGlowRef = useRef<THREE.Mesh>(null!)
  const moonLightRef = useRef<THREE.PointLight>(null!)
  const isVisibleRef = useRef(false)
  
  useFrame(() => {
    if (!groupRef.current) return
    
    const timeOfDay = timeOfDayRef.current
    
    // Calculate visibility and progress
    let moonProgress = 0
    let moonVisibility = 0
    
    if (timeOfDay >= 0.2 && timeOfDay <= 0.8) {
      if (timeOfDay < 0.25) {
        moonProgress = 0
        moonVisibility = (timeOfDay - 0.2) / 0.05
        moonVisibility = moonVisibility * moonVisibility * (3 - 2 * moonVisibility)
      } else if (timeOfDay > 0.75) {
        moonProgress = 1
        moonVisibility = (0.8 - timeOfDay) / 0.05
        moonVisibility = moonVisibility * moonVisibility * (3 - 2 * moonVisibility)
      } else {
        moonProgress = (timeOfDay - 0.25) / 0.5
        moonVisibility = 1
      }
    }
    
    const shouldBeVisible = moonVisibility > 0
    if (shouldBeVisible !== isVisibleRef.current) {
      groupRef.current.visible = shouldBeVisible
      isVisibleRef.current = shouldBeVisible
    }
    
    if (!shouldBeVisible) return
    
    // Update position
    const angle = moonProgress * Math.PI
    const height = Math.sin(angle) * 400 + 50
    const x = Math.cos(angle) * 600
    groupRef.current.position.set(x, height, -200)
    
    // Calculate opacity
    let arcOpacity = 1
    if (moonProgress <= 0.2) {
      const t = moonProgress / 0.2
      arcOpacity = t * t * (3 - 2 * t)
    } else if (moonProgress >= 0.8) {
      const t = (1 - moonProgress) / 0.2
      arcOpacity = t * t * (3 - 2 * t)
    }
    const moonOpacity = arcOpacity * moonVisibility
    
    // Calculate glow intensity
    const heightFactor = Math.max(0, Math.sin(moonProgress * Math.PI))
    const smoothVisibility = moonVisibility * moonVisibility * moonVisibility
    const glowIntensity = heightFactor * moonOpacity * smoothVisibility
    
    // Update materials directly
    if (mainMoonRef.current) (mainMoonRef.current.material as THREE.MeshBasicMaterial).opacity = moonOpacity
    if (patch1Ref.current) (patch1Ref.current.material as THREE.MeshBasicMaterial).opacity = moonOpacity * 0.6
    if (patch2Ref.current) (patch2Ref.current.material as THREE.MeshBasicMaterial).opacity = moonOpacity * 0.5
    if (patch3Ref.current) (patch3Ref.current.material as THREE.MeshBasicMaterial).opacity = moonOpacity * 0.55
    if (outerGlowRef.current) (outerGlowRef.current.material as THREE.MeshBasicMaterial).opacity = glowIntensity * 0.15
    if (innerGlowRef.current) (innerGlowRef.current.material as THREE.MeshBasicMaterial).opacity = glowIntensity * 0.25
    if (moonLightRef.current) {
      moonLightRef.current.intensity = glowIntensity * glowIntensity * 10000
      moonLightRef.current.castShadow = glowIntensity > 0.1
    }
  })
  
  return (
    <group ref={groupRef} visible={false}>
      <mesh ref={mainMoonRef}>
        <sphereGeometry args={[80, 32, 32]} />
        <meshBasicMaterial color="#fffde7" transparent opacity={0} />
      </mesh>
      <mesh ref={patch1Ref} position={[-15, 20, 70]}>
        <sphereGeometry args={[20, 16, 16]} />
        <meshBasicMaterial color="#d4d4c4" transparent opacity={0} />
      </mesh>
      <mesh ref={patch2Ref} position={[25, -10, 65]}>
        <sphereGeometry args={[15, 16, 16]} />
        <meshBasicMaterial color="#c8c8b8" transparent opacity={0} />
      </mesh>
      <mesh ref={patch3Ref} position={[-30, -25, 60]}>
        <sphereGeometry args={[18, 16, 16]} />
        <meshBasicMaterial color="#d0d0c0" transparent opacity={0} />
      </mesh>
      <mesh ref={outerGlowRef}>
        <sphereGeometry args={[120, 32, 32]} />
        <meshBasicMaterial color="#fffef0" transparent opacity={0} side={THREE.BackSide} />
      </mesh>
      <mesh ref={innerGlowRef}>
        <sphereGeometry args={[95, 32, 32]} />
        <meshBasicMaterial color="#fffff8" transparent opacity={0} side={THREE.BackSide} />
      </mesh>
      <pointLight 
        ref={moonLightRef}
        color="#c4d4ff"
        intensity={0}
        distance={5000}
        decay={1.5}
        shadow-radius={8}
        shadow-bias={-0.001}
      />
    </group>
  )
}

// OPTIMIZED: Dynamic lighting component that updates lights directly without re-renders
function DynamicLighting({ timeOfDayRef }: { timeOfDayRef: React.MutableRefObject<number> }) {
  const sunRef = useRef<THREE.DirectionalLight>(null!)
  const ambientRef = useRef<THREE.AmbientLight>(null!)
  const hemisphereRef = useRef<THREE.HemisphereLight>(null!)
  const { scene } = useThree()
  
  // Color arrays for interpolation (pre-computed)
  const dayAmbient = useMemo(() => new THREE.Color(135/255, 206/255, 235/255), [])
  const nightAmbient = useMemo(() => new THREE.Color(50/255, 50/255, 50/255), [])
  const daySunColor = useMemo(() => new THREE.Color(255/255, 248/255, 220/255), [])
  const sunsetColor = useMemo(() => new THREE.Color(255/255, 179/255, 71/255), [])
  const nightSunColor = useMemo(() => new THREE.Color(42/255, 48/255, 80/255), [])
  const dayHemisphereSky = useMemo(() => new THREE.Color(135/255, 206/255, 235/255), [])
  const nightHemisphereSky = useMemo(() => new THREE.Color(10/255, 16/255, 48/255), [])
  const dayHemisphereGround = useMemo(() => new THREE.Color(61/255, 92/255, 61/255), [])
  const nightHemisphereGround = useMemo(() => new THREE.Color(26/255, 42/255, 26/255), [])
  const dayFog = useMemo(() => new THREE.Color(1, 1, 1), [])
  const sunsetFog = useMemo(() => new THREE.Color(255/255, 153/255, 102/255), [])
  const nightFog = useMemo(() => new THREE.Color(10/255, 16/255, 32/255), [])
  
  // Temp colors for lerping
  const tempColor = useMemo(() => new THREE.Color(), [])
  const tempColor2 = useMemo(() => new THREE.Color(), [])
  
  useFrame(() => {
    const timeOfDay = timeOfDayRef.current
    const dayAmount = Math.cos(timeOfDay * Math.PI * 2) * 0.5 + 0.5
    
    // Update sun position
    if (sunRef.current) {
      const angle = timeOfDay * Math.PI * 2
      sunRef.current.position.set(
        Math.sin(angle) * 400,
        Math.cos(angle) * 300,
        100
      )
      sunRef.current.intensity = Math.max(0.1, dayAmount * 1.5)
      
      // Update sun color
      if (dayAmount > 0.5) {
        const t = (dayAmount - 0.5) / 0.5
        tempColor.copy(sunsetColor).lerp(daySunColor, t)
      } else if (dayAmount > 0.15) {
        const t = (dayAmount - 0.15) / 0.35
        tempColor.copy(nightSunColor).lerp(sunsetColor, t)
      } else {
        tempColor.copy(nightSunColor)
      }
      sunRef.current.color.copy(tempColor)
    }
    
    // Update ambient light
    if (ambientRef.current) {
      tempColor.copy(nightAmbient).lerp(dayAmbient, dayAmount)
      ambientRef.current.color.copy(tempColor)
    }
    
    // Update hemisphere light
    if (hemisphereRef.current) {
      tempColor.copy(nightHemisphereSky).lerp(dayHemisphereSky, dayAmount)
      tempColor2.copy(nightHemisphereGround).lerp(dayHemisphereGround, dayAmount)
      hemisphereRef.current.color.copy(tempColor)
      hemisphereRef.current.groundColor.copy(tempColor2)
      hemisphereRef.current.intensity = 0.2 + dayAmount * 0.5
    }
    
    // Update fog
    if (scene.fog) {
      const fog = scene.fog as THREE.Fog
      if (dayAmount > 0.5) {
        const t = (dayAmount - 0.5) / 0.5
        tempColor.copy(sunsetFog).lerp(dayFog, t)
      } else if (dayAmount > 0.15) {
        const t = (dayAmount - 0.15) / 0.35
        tempColor.copy(nightFog).lerp(sunsetFog, t)
      } else {
        tempColor.copy(nightFog)
      }
      fog.color.copy(tempColor)
    }
  })
  
  return (
    <>
      <ambientLight ref={ambientRef} intensity={1} />
      <directionalLight 
        ref={sunRef}
        position={[0, 300, 100]}
        intensity={1.5}
        castShadow
        shadow-radius={4}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={3000}
        shadow-camera-left={-TERRAIN_DIMENSIONS.SHADOW_CAMERA_SIZE}
        shadow-camera-right={TERRAIN_DIMENSIONS.SHADOW_CAMERA_SIZE}
        shadow-camera-top={TERRAIN_DIMENSIONS.SHADOW_CAMERA_SIZE}
        shadow-camera-bottom={-TERRAIN_DIMENSIONS.SHADOW_CAMERA_SIZE}
      />
      <hemisphereLight 
        ref={hemisphereRef}
        args={['#87CEEB', '#3d5c3d', 0.7]} 
      />
    </>
  )
}

// OPTIMIZED: Dynamic sky component that updates sky directly without re-renders
function DynamicSky({ timeOfDayRef }: { timeOfDayRef: React.MutableRefObject<number> }) {
  const skyRef = useRef<any>(null!)
  
  useFrame(() => {
    if (!skyRef.current) return
    
    const timeOfDay = timeOfDayRef.current
    const dayAmount = Math.cos(timeOfDay * Math.PI * 2) * 0.5 + 0.5
    const smoothDayAmount = dayAmount * dayAmount * (3 - 2 * dayAmount)
    
    // Update sun position
    const angle = timeOfDay * Math.PI * 2
    const sunPosition = [
      Math.sin(angle) * 400,
      Math.cos(angle) * 300,
      100
    ]
    
    // Update sky material uniforms directly
    if (skyRef.current.material && skyRef.current.material.uniforms) {
      const uniforms = skyRef.current.material.uniforms
      if (uniforms.sunPosition) {
        uniforms.sunPosition.value.set(sunPosition[0], sunPosition[1], sunPosition[2])
      }
      if (uniforms.turbidity) uniforms.turbidity.value = 0.1 + smoothDayAmount * 9.9
      if (uniforms.rayleigh) uniforms.rayleigh.value = 0.1 + smoothDayAmount * 1.9
      if (uniforms.mieCoefficient) uniforms.mieCoefficient.value = 0.001 + smoothDayAmount * 0.004
      if (uniforms.mieDirectionalG) uniforms.mieDirectionalG.value = 0.999 - smoothDayAmount * 0.899
    }
  })
  
  return (
    <Sky 
      ref={skyRef}
      distance={1000}
      sunPosition={[0, 300, 100]}
      turbidity={10}
      rayleigh={2}
      mieCoefficient={0.005}
      mieDirectionalG={0.1}
    />
  )
}

// OPTIMIZED: Scene component uses refs for timeOfDay to avoid re-renders
function Scene() {
  // Time of day stored in ref to avoid re-renders - child components will read this ref
  const timeOfDayRef = useRef(0)
  
  // Update time of day based on real time - no state updates!
  useFrame((state) => {
    const elapsed = state.clock.elapsedTime
    // Complete cycle every CYCLE_DURATION seconds
    const cycleProgress = (elapsed % DAY_NIGHT_CYCLE.CYCLE_DURATION) / DAY_NIGHT_CYCLE.CYCLE_DURATION
    timeOfDayRef.current = cycleProgress + 0.1
  })
  
  return (
    <>
      {/* Player */}
      <PlayerSphere />
      
      {/* Sky - updated directly via refs */}
      <DynamicSky timeOfDayRef={timeOfDayRef} />
      
      {/* Night sky elements - these need timeOfDay but update themselves */}
      <DynamicStars timeOfDayRef={timeOfDayRef} />
      <DynamicMoon timeOfDayRef={timeOfDayRef} />
      
      {/* Fog for atmosphere */}
      <fog attach="fog" args={['#ffffff', 0, TERRAIN_DIMENSIONS.FOG_FAR]} />
      
      {/* Lighting - updated directly via refs */}
      <DynamicLighting timeOfDayRef={timeOfDayRef} />
      
      {/* Landscape Elements */}
      <Terrain />
      <Water />
      <Trees />
      <Rocks />
      <Sheep />
      <Clouds />
      
      {/* TypeScript Block - destructible */}
      <DestructibleTypeScriptBlock 
        x={350} 
        y={getTerrainHeight(350, -50) + 5} 
        z={-50} 
        scale={8} 
      />
      
      {/* Laser System */}
      <LaserSystem />
    </>
  )
}

// Key map for KeyboardControls
const keyMap = [
  { name: Controls.forward, keys: ['KeyW'] },
  { name: Controls.backward, keys: ['KeyS'] },
  { name: Controls.left, keys: ['KeyA'] },
  { name: Controls.right, keys: ['KeyD'] },
  { name: Controls.jump, keys: ['Space'] },
  { name: Controls.turnLeft, keys: ['ArrowLeft'] },
  { name: Controls.turnRight, keys: ['ArrowRight'] },
  { name: Controls.lookUp, keys: ['ArrowDown', 'KeyQ'] },
  { name: Controls.lookDown, keys: ['ArrowUp', 'KeyE'] },
]

// Return to player button - appears when in map mode
function ReturnToPlayerButton({ mode, onReturnToPlayer }: { mode: ControlMode, onReturnToPlayer: () => void }) {
  if (mode === 'player') return null
  
  return (
    <button
      onClick={onReturnToPlayer}
      style={{
        position: 'fixed',
        bottom: 30,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '12px 24px',
        fontSize: 24,
        fontWeight: 'bold',
        backgroundColor: 'rgba(255, 107, 53, 0.9)',
        border: '3px solid rgba(255, 255, 255, 0.8)',
        borderRadius: 12,
        color: 'white',
        cursor: 'pointer',
        zIndex: 1001,
        boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
        transition: 'transform 0.1s, box-shadow 0.1s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateX(-50%) scale(1.05)'
        e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.4)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateX(-50%) scale(1)'
        e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.3)'
      }}
    >
      📍 Return to Player
    </button>
  )
}

// App wrapper that manages control mode state
function App() {
  const [mode, setMode] = useState<ControlMode>('player')
  
  // Sync global state with React state
  useEffect(() => {
    controlModeState.setMode = (newMode: ControlMode) => {
      controlModeState.mode = newMode
      setMode(newMode)
    }
  }, [])
  
  const handleReturnToPlayer = useCallback(() => {
    controlModeState.setMode('player')
  }, [])
  
  return (
    <ControlModeContext.Provider value={{ mode, setMode: controlModeState.setMode }}>
      <KeyboardControls map={keyMap}>
        <Canvas 
          style={{ width: "100vw", height: "100vh" }}
          camera={{ position: [TERRAIN_DIMENSIONS.HALF_SIZE, 50, -175], fov: 60, near: 0.1, far: TERRAIN_DIMENSIONS.CAMERA_FAR }}
          shadows="soft"
        >
          <Physics gravity={[0, -150, 0]}>
            <Scene />
          </Physics>
          <MapControls enabled={mode === 'map'} />
        </Canvas>
      </KeyboardControls>
      <MobileControls />
      <ReturnToPlayerButton mode={mode} onReturnToPlayer={handleReturnToPlayer} />
    </ControlModeContext.Provider>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)

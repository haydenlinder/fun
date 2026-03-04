import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { useRef, useMemo, useEffect, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { MapControls, Sky } from '@react-three/drei'
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata'
import "./App.css"


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

// Generate height map data for terrain with Minecraft-style procedural generation
function generateHeightData(width: number, depth: number, scale: number) {
  const data = []
  
  for (let i = 0; i < depth; i++) {
    for (let j = 0; j < width; j++) {
      // Map grid indices to normalized coordinates [0, 1]
      const nx = j / (width - 1)
      const nz = i / (depth - 1)
      // Scale for noise sampling
      const x = nx * 8 // Gives us 8 "tiles" of noise across terrain
      const z = nz * 8
      
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
      
      data.push(height * scale)
    }
  }
  return data
}

function Terrain() {
  const meshRef = useRef<THREE.Mesh>(null!)
  
  const geometry = useMemo(() => {
    const width = 1000
    const depth = 1000
    const segmentsX = 128
    const segmentsZ = 128
    
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
      if (height < -30) {
        // Extremely deep valleys - dark muddy brown
        r = 0.2
        g = 0.22
        b = 0.15
      } else if (height < -15) {
        // Very deep valleys - dark sandy brown
        r = 0.25
        g = 0.28
        b = 0.18
      } else if (height < -5) {
        // Deep valleys - darker green/brown
        r = 0.2
        g = 0.35
        b = 0.15
      } else if (height < 5) {
        // Low areas - grass green
        r = 0.3
        g = 0.5
        b = 0.2
      } else if (height < 15) {
        // Mid elevation - lighter green
        r = 0.4
        g = 0.6
        b = 0.25
      } else if (height < 30) {
        // Higher areas - brownish (cliff/hill tops)
        r = 0.5
        g = 0.45
        b = 0.3
      } else if (height < 60) {
        // Mountain slopes - rocky gray
        r = 0.55
        g = 0.5
        b = 0.45
      } else if (height < 100) {
        // High mountain - darker rocky
        r = 0.45
        g = 0.42
        b = 0.4
      } else if (height < 140) {
        // Near peak - lighter rocky with hints of snow
        r = 0.65
        g = 0.63
        b = 0.62
      } else {
        // Snow caps - white/light gray (above 140)
        r = 0.9
        g = 0.92
        b = 0.95
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
      <planeGeometry args={[1000, 1000]} />
      <meshStandardMaterial 
        color="#1a5276"
        transparent
        opacity={0.8}
        roughness={0.1}
        metalness={0.3}
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
    for (let i = 0; i < 1500; i++) {
      const x = (rng() - 0.5) * 900
      const z = (rng() - 0.5) * 900
      const height = getTerrainHeight(x, z)
      
      // Only place trees in grassy areas (not underwater, not on high mountains)
      if (height > 0 && height < 50) {
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
  const [opacity, setOpacity] = useState(1)
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
    if (!meshRef.current || opacity <= 0) return
    
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
    
    // Fade out after 2 seconds
    if (elapsed > 2) {
      const fadeProgress = (elapsed - 2) / 2
      setOpacity(Math.max(0, 1 - fadeProgress))
    }
  })
  
  if (opacity <= 0) return null
  
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

function LaserBeam({ start, end, createdAt }: { start: THREE.Vector3, end: THREE.Vector3, createdAt: number }) {
  const meshRef = useRef<THREE.Mesh>(null!)
  const glowRef = useRef<THREE.Mesh>(null!)
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
  
  useFrame((state) => {
    const elapsed = state.clock.elapsedTime * 1000 - createdAt
    const duration = 200 // Laser lasts 200ms
    
    if (elapsed > duration) {
      setOpacity(0)
    } else {
      // Quick fade in, then fade out
      const fadeIn = Math.min(1, elapsed / 30)
      const fadeOut = Math.max(0, 1 - (elapsed - duration * 0.6) / (duration * 0.4))
      setOpacity(fadeIn * fadeOut)
      
      // Pulse effect
      const pulse = 1 + Math.sin(elapsed * 0.05) * 0.2
      if (meshRef.current) {
        meshRef.current.scale.x = pulse
        meshRef.current.scale.z = pulse
      }
      if (glowRef.current) {
        glowRef.current.scale.x = pulse * 1.5
        glowRef.current.scale.z = pulse * 1.5
      }
    }
  })
  
  if (opacity <= 0) return null
  
  return (
    <group position={midpoint} rotation={rotation}>
      {/* Inner bright core */}
      <mesh ref={meshRef}>
        <cylinderGeometry args={[0.05, 0.05, length, 8]} />
        <meshBasicMaterial 
          color="#ff0000" 
          transparent 
          opacity={opacity}
        />
      </mesh>
      {/* Outer glow */}
      <mesh ref={glowRef}>
        <cylinderGeometry args={[0.15, 0.15, length, 8]} />
        <meshBasicMaterial 
          color="#ffb444" 
          transparent 
          opacity={opacity * 0.4}
        />
      </mesh>
      {/* Impact point glow */}
      <mesh position={[0, length / 2, 0]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial 
          color="#ff6a00" 
          transparent 
          opacity={opacity * 0.8}
        />
      </mesh>
      {/* Origin point glow */}
      <mesh position={[0, -length / 2, 0]}>
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
        // If mouse moved more than 5 pixels, consider it a drag
        if (distance > 5) {
          isDragging.current = true
        }
      }
    }
    
    const handleMouseUp = () => {
      mouseDownPos.current = null
    }
    
    const handleClick = (event: MouseEvent) => {
      // Don't fire if user was dragging (using OrbitControls)
      if (isDragging.current) {
        isDragging.current = false
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
        // Calculate the center of the screen in world coordinates
        // This is done by raycasting from the center of the screen (0, 0 in NDC)
        const centerRay = new THREE.Raycaster()
        centerRay.setFromCamera(new THREE.Vector2(0, 0), camera)
        
        // Start the laser from a point at the center of screen, near the camera
        // This creates the effect of firing from the center of the viewport
        const start = camera.position.clone()
        const centerDirection = centerRay.ray.direction.clone()
        start.add(centerDirection.multiplyScalar(2)) // Start 2 units in front of camera at center
        
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
  }, [camera, scene, gl, raycaster])
  
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

// Helper to get terrain height at a position using the same noise as terrain generation
function getTerrainHeight(worldX: number, worldZ: number): number {
  // Convert world position to normalized [0,1] then to noise coordinates
  // Terrain is 1000x1000, centered at origin (-500 to +500)
  const nx = (worldX + 500) / 1000  // Maps -500..500 to 0..1
  const nz = (worldZ + 500) / 1000
  const x = nx * 8  // Same scaling as generateHeightData
  const z = nz * 8
  
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
  
  // Cave entrance depressions
  const caveNoise = fbm(x * 0.8 + 400, z * 0.8 + 400, 3, 2, 0.5)
  if (caveNoise > 0.4 && height > 5) {
    const caveDepth = (caveNoise - 0.4) * 8
    height -= caveDepth
  }
  
  return height
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
      if (testHeight > 0 && testHeight <= 3.5) {
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
        sheep.targetX = Math.max(-250, Math.min(250, sheep.targetX))
        sheep.targetZ = Math.max(-250, Math.min(250, sheep.targetZ))
        
        // Check if target is valid terrain
        const targetHeight = getTerrainHeight(sheep.targetX, sheep.targetZ)
        if (targetHeight < 0 || targetHeight > 3.5) {
          // Invalid target, try to find a valid one nearby
          let foundValid = false
          for (let attempt = 0; attempt < 5; attempt++) {
            const retryAngle = Math.random() * Math.PI * 2
            const retryDist = 3 + Math.random() * 8
            const testX = currentX + Math.cos(retryAngle) * retryDist
            const testZ = currentZ + Math.sin(retryAngle) * retryDist
            const testHeight = getTerrainHeight(testX, testZ)
            if (testHeight >= 0 && testHeight <= 3.5) {
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
          if (testHeight >= 0 && testHeight <= 3.5 && 
              Math.abs(testX) < 250 && Math.abs(testZ) < 250) {
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
      const x = (Math.random() - 0.5) * 500
      const z = (Math.random() - 0.5) * 500
      const height = getTerrainHeight(x, z)
      
      // Only place sheep on grass areas (above water, not too steep)
      if (height > 0 && height < 3.5) {
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


function Rocks() {
  const rocks = useMemo(() => {
    const rockData = []
    const rng = seededRandom(98765) // Use seeded random for consistent rock placement
    for (let i = 0; i < 800; i++) {
      const x = (rng() - 0.5) * 900
      const z = (rng() - 0.5) * 900
      const height = getTerrainHeight(x, z)
      
      // Place rocks everywhere except deep underwater
      if (height > 0 && height < 75) {
        // More rocks on mountain slopes and cliffs
        const isHighAltitude = height > 10
        const scale = isHighAltitude 
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

function Scene() {
  return (
    <>
      {/* Camera Controls */}
      <MapControls 
        makeDefault
        maxPolarAngle={1.55}
        // enableDamping
        // dampingFactor={0.05}
        minDistance={50}
        maxDistance={1000}
        // maxPolarAngle={Math.PI / 2 - 0.1}
      />
      
      {/* Sky */}
      <Sky 
        distance={1000}
        sunPosition={[100, 20, 100]}
        inclination={0.6}
        azimuth={0.25}
        turbidity={10}
        rayleigh={2}
        mieCoefficient={0.005}
        mieDirectionalG={0.1}
      />
      
      {/* Fog for atmosphere */}
      <fog attach="fog" args={['#81abb7']} />
      
      {/* Lighting */}
      <ambientLight intensity={0.4} color="#87CEEB" />
      <directionalLight 
        position={[100, 50, 100]} 
        intensity={1.5}
        color="#FFF8DC"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={300}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      <hemisphereLight 
        args={['#87CEEB', '#3d5c3d', 0.6]} 
      />
      
      {/* Landscape Elements */}
      <Terrain />
      <Water />
      <Trees />
      <Rocks />
      <Sheep />
      
      {/* Laser System */}
      <LaserSystem />
    </>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <Canvas 

    style={{ width: "100vw", height: "100vh" }}
    camera={{ position: [300, 100, 250], fov: 60, near: 0.1, far: 1500 }}
    shadows
  >
    <Physics gravity={[0, -9.81, 0]}>
      <Scene />
      {/* <fog attach="fog" args={['white']}/> */}
    </Physics>
  </Canvas>,
)

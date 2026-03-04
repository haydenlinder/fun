import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame, extend } from '@react-three/fiber'
import { OrbitControls, Sky, shaderMaterial } from '@react-three/drei'
import { Physics, RigidBody, CuboidCollider, useRapier } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'

// Import web worker for grass generation
import GrassWorker from './grassWorker?worker'

// Generate height map data for terrain
function generateHeightData(width: number, depth: number, scale: number) {
  const data = []
  for (let i = 0; i < depth; i++) {
    for (let j = 0; j < width; j++) {
      const x = j / width
      const z = i / depth
      // Multiple octaves of noise for more realistic terrain
      let height = 0
      height += Math.sin(x * 8 + 0.5) * Math.cos(z * 6) * 2
      height += Math.sin(x * 15 + 1) * Math.cos(z * 12 + 0.5) * 1
      height += Math.sin(x * 30) * Math.cos(z * 25) * 0.5
      height += Math.sin(x * 50 + 2) * Math.cos(z * 45 + 1) * 0.25
      // Add some rolling hills
      height += Math.sin(x * 3) * 3
      height += Math.cos(z * 4) * 2
      data.push(height * scale)
    }
  }
  return data
}

function Terrain() {
  const meshRef = useRef<THREE.Mesh>(null!)
  
  const geometry = useMemo(() => {
    const width = 200
    const depth = 200
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
      if (height < -2) {
        // Deep valleys - darker green/brown
        r = 0.2
        g = 0.35
        b = 0.15
      } else if (height < 0) {
        // Low areas - grass green
        r = 0.3
        g = 0.5
        b = 0.2
      } else if (height < 3) {
        // Mid elevation - lighter green
        r = 0.4
        g = 0.6
        b = 0.25
      } else if (height < 5) {
        // Higher areas - brownish
        r = 0.5
        g = 0.45
        b = 0.3
      } else {
        // Peaks - rocky gray
        r = 0.6
        g = 0.55
        b = 0.5
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
  const waterRef = useRef<THREE.Mesh>(null!)
  
  useFrame((state) => {
    if (waterRef.current) {
      waterRef.current.position.y = -3 + Math.sin(state.clock.elapsedTime * 0.5) * 0.1
    }
  })
  
  return (
    <mesh ref={waterRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]} receiveShadow>
      <planeGeometry args={[200, 200]} />
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

function Trees() {
  const trees = useMemo(() => {
    const treeData = []
    for (let i = 0; i < 100; i++) {
      const x = (Math.random() - 0.5) * 180
      const z = (Math.random() - 0.5) * 180
      // Calculate approximate height at this position
      const nx = (x / 200) + 0.5
      const nz = (z / 200) + 0.5
      let height = 0
      height += Math.sin(nx * 8 + 0.5) * Math.cos(nz * 6) * 2
      height += Math.sin(nx * 15 + 1) * Math.cos(nz * 12 + 0.5) * 1
      height += Math.sin(nx * 3) * 3
      height += Math.cos(nz * 4) * 2
      
      // Only place trees above water level and below peaks
      if (height > -1 && height < 4) {
        treeData.push({ x, y: height, z, scale: 0.5 + Math.random() * 1 })
      }
    }
    return treeData
  }, [])

  return (
    <group>
      {trees.map((tree, i) => (
        <group key={i} position={[tree.x, tree.y, tree.z]} scale={tree.scale}>
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
      ))}
    </group>
  )
}

// GPU Grass Shader - wind animation runs entirely on the GPU
const GrassShaderMaterial = shaderMaterial(
  {
    uTime: 0,
    uWindStrength: 0.12,
    uWindSpeed: 1.0,
  },
  // Vertex Shader - dramatic bending and movement
  `
    attribute vec3 instancePosition;
    attribute vec3 instanceColor;
    attribute float instanceRotation;
    attribute float instanceScale;
    attribute float instancePhase;
    attribute float instanceBend;
    attribute float instanceTilt;
    
    uniform float uTime;
    uniform float uWindStrength;
    uniform float uWindSpeed;
    
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vHeight;
    varying vec3 vWorldPos;
    varying float vAO;
    varying float vSunExposure;
    
    mat3 rotateY(float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
    }
    
    void main() {
      // Normalize height for shader calculations (0 to 1)
      float normalizedHeight = position.y / 0.4;
      vHeight = normalizedHeight;
      vColor = instanceColor;
      
      // Multi-layered wind with more movement
      float windTime = uTime * uWindSpeed;
      float wx = instancePosition.x * 0.04 + instancePosition.z * 0.025;
      
      // Primary wind wave - strong and sweeping
      float wind1 = sin(windTime * 0.7 + wx + instancePhase) * 0.7;
      // Secondary turbulence
      float wind2 = sin(windTime * 1.5 + wx * 1.8 + instancePhase * 0.6) * 0.35;
      // High frequency flutter
      float wind3 = sin(windTime * 2.5 + wx * 3.0 + instancePhase * 1.5) * 0.15;
      // Cross-wind
      float crossWind = cos(windTime * 0.9 + instancePosition.z * 0.06) * 0.4;
      
      float totalWind = wind1 + wind2 + wind3;
      
      // Height-cubed for more dramatic top bending
      float bendInfluence = normalizedHeight * normalizedHeight * normalizedHeight;
      float bendInfluence2 = normalizedHeight * normalizedHeight;
      
      vec3 pos = position;
      
      // Scale blade - keep thin, only slight width variation
      pos.y *= instanceScale;
      pos.x *= (0.9 + instanceScale * 0.2);  // Much less width scaling
      
      // Apply rotation
      pos = rotateY(instanceRotation) * pos;
      
      // DRAMATIC natural droop/tilt - blades lean significantly
      float tiltAmount = instanceTilt * bendInfluence * 0.25;
      pos.x += tiltAmount;
      
      // DRAMATIC pre-bend curve - natural arch
      float preBend = instanceBend * bendInfluence * 0.18;
      pos.z += preBend;
      
      // Additional quadratic bend for curved shape
      float curveBend = bendInfluence2 * 0.08 * instanceScale;
      pos.z += curveBend;
      
      // Wind sway - more dramatic
      float windSway = totalWind * uWindStrength * bendInfluence * instanceScale;
      float crossSway = crossWind * uWindStrength * 0.5 * bendInfluence * instanceScale;
      pos.x += windSway;
      pos.z += crossSway;
      
      // Compensate height when bending significantly
      float totalBend = abs(windSway) + abs(tiltAmount) + abs(preBend) + abs(crossSway);
      pos.y *= 1.0 - totalBend * 0.12;
      
      pos += instancePosition;
      
      vWorldPos = pos;
      
      // Stronger AO at base
      vAO = pow(normalizedHeight, 0.7) * 0.7 + 0.3;
      
      // Calculate sun exposure based on blade orientation
      vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
      float bendDir = atan(tiltAmount + windSway, pos.y - instancePosition.y);
      vSunExposure = max(0.0, sin(bendDir + 0.5)) * normalizedHeight;
      
      vNormal = normalize(normalMatrix * rotateY(instanceRotation) * normal);
      
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  // Fragment Shader - high contrast with bright sunlit tips
  `
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vHeight;
    varying vec3 vWorldPos;
    varying float vAO;
    varying float vSunExposure;
    
    void main() {
      vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      vec3 normal = normalize(vNormal);
      
      // Strong wrapped diffuse
      float NdotL = dot(normal, lightDir);
      float diffuse = NdotL * 0.45 + 0.55;
      
      // Enhanced subsurface scattering
      float scatter = pow(clamp(-NdotL * 0.6 + 0.5, 0.0, 1.0), 1.8) * 0.5;
      vec3 scatterColor = vec3(0.5, 0.75, 0.25); // Bright lime transmission
      
      // Rim lighting
      float rim = pow(1.0 - max(0.0, dot(viewDir, normal)), 2.5) * 0.2;
      
      // DARK base, BRIGHT tips - strong contrast
      float heightContrast = pow(vHeight, 0.8);
      vec3 darkBase = vColor * 0.25; // Very dark at ground
      vec3 brightTip = vColor * 1.4; // Overbright at tips
      vec3 baseColor = mix(darkBase, brightTip, heightContrast);
      
      // Golden sunlit tips
      vec3 sunTint = vec3(0.18, 0.15, -0.05) * vHeight * vHeight;
      baseColor += sunTint;
      
      // Extra brightness for sun-exposed blades
      baseColor += vec3(0.08, 0.1, 0.02) * vSunExposure;
      
      // Combine lighting with strong AO
      vec3 color = baseColor * diffuse * vAO;
      
      // Add scattering (lime glow when backlit)
      color += scatterColor * scatter * vHeight * 0.8;
      
      // Rim highlight (bright edges)
      color += vec3(0.95, 1.0, 0.7) * rim * vHeight;
      
      // Subtle specular for wet/dewy look
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(0.0, dot(normal, halfDir)), 48.0) * 0.12;
      color += vec3(1.0, 1.0, 0.9) * spec * vHeight;
      
      // Cool shadow ambient
      vec3 shadowColor = vColor * vec3(0.6, 0.7, 0.9) * 0.12;
      color += shadowColor * (1.0 - vAO);
      
      // Atmospheric perspective
      float dist = length(vWorldPos - cameraPosition);
      float fog = smoothstep(25.0, 100.0, dist);
      vec3 fogColor = vec3(0.55, 0.65, 0.55);
      color = mix(color, fogColor, fog * 0.35);
      
      // Slight saturation boost
      float luminance = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(luminance), color, 1.15);
      
      gl_FragColor = vec4(color, 1.0);
    }
  `
)

// Extend so React Three Fiber recognizes our custom material
extend({ GrassShaderMaterial })

// TypeScript declaration for the custom material
declare module '@react-three/fiber' {
  interface ThreeElements {
    grassShaderMaterial: any
  }
}

function Grass() {
  const meshRef = useRef<THREE.Mesh>(null!)
  const materialRef = useRef<any>(null!)
  const [geometry, setGeometry] = useState<THREE.InstancedBufferGeometry | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  
  // Create base blade geometry (small, runs on main thread)
  const bladeGeo = useMemo(() => {
    const bladeWidth = 0.015  // Thin blades
    const bladeHeight = 0.4
    const segments = 3
    
    const vertices: number[] = []
    
    for (let i = 0; i < segments; i++) {
      const t1 = i / segments
      const t2 = (i + 1) / segments
      
      const w1 = bladeWidth * (1 - t1 * 0.9)
      const w2 = bladeWidth * (1 - t2 * 0.9)
      
      const y1 = t1 * bladeHeight
      const y2 = t2 * bladeHeight
      
      const curve1 = t1 * t1 * 0.04
      const curve2 = t2 * t2 * 0.04
      
      vertices.push(
        -w1, y1, curve1,
        w1, y1, curve1,
        w2, y2, curve2,
        -w1, y1, curve1,
        w2, y2, curve2,
        -w2, y2, curve2
      )
    }
    
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3))
    geo.computeVertexNormals()
    return geo
  }, [])
  
  // Use web worker to generate grass data off main thread
  useEffect(() => {
    const worker = new GrassWorker()
    
    worker.onmessage = (e) => {
      const { positions, colors, rotations, scales, phases, bends, tilts, instanceCount } = e.data
      
      console.log(`GPU Grass (Worker): ${instanceCount.toLocaleString()} blades`)
      
      // Create instanced geometry with worker data
      const instancedGeo = new THREE.InstancedBufferGeometry()
      instancedGeo.index = bladeGeo.index
      instancedGeo.setAttribute('position', bladeGeo.getAttribute('position'))
      instancedGeo.setAttribute('normal', bladeGeo.getAttribute('normal'))
      
      instancedGeo.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(positions, 3))
      instancedGeo.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3))
      instancedGeo.setAttribute('instanceRotation', new THREE.InstancedBufferAttribute(rotations, 1))
      instancedGeo.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(scales, 1))
      instancedGeo.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phases, 1))
      instancedGeo.setAttribute('instanceBend', new THREE.InstancedBufferAttribute(bends, 1))
      instancedGeo.setAttribute('instanceTilt', new THREE.InstancedBufferAttribute(tilts, 1))
      
      instancedGeo.instanceCount = instanceCount
      
      setGeometry(instancedGeo)
      setIsLoading(false)
      worker.terminate()
    }
    
    // HIGH DENSITY - dense carpet of grass (~3M+ blades)
    worker.postMessage({
      fieldSize: 180,
      baseDensity: 2000000,   // Dense base layer
      mediumDensity: 800000,  // Medium grass
      tallDensity: 350000,    // Tall grass
      clusterCount: 6000      // Accent clusters
    })
    
    return () => worker.terminate()
  }, [bladeGeo])
  
  // Update time uniform each frame
  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uTime = state.clock.elapsedTime
    }
  })
  
  if (!geometry) return null
  
  return (
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false}>
      <grassShaderMaterial 
        ref={materialRef}
        side={THREE.DoubleSide}
        transparent={false}
      />
    </mesh>
  )
}

// Helper to get terrain height at a position
function getTerrainHeight(x: number, z: number): number {
  const nx = (x / 200) + 0.5
  const nz = (z / 200) + 0.5
  let height = 0
  height += Math.sin(nx * 8 + 0.5) * Math.cos(nz * 6) * 2
  height += Math.sin(nx * 15 + 1) * Math.cos(nz * 12 + 0.5) * 1
  height += Math.sin(nx * 3) * 3
  height += Math.cos(nz * 4) * 2
  return height
}

// Single sheep with physics body
function SingleSheep({ initialX, initialZ, scale, phase }: { 
  initialX: number
  initialZ: number
  scale: number
  phase: number 
}) {
  const rigidBodyRef = useRef<RapierRigidBody>(null!)
  const visualGroupRef = useRef<THREE.Group>(null!)
  
  // Mutable state for movement behavior
  const state = useRef({
    targetX: initialX,
    targetZ: initialZ,
    rotY: Math.random() * Math.PI * 2,
    moveSpeed: 1.5 + Math.random() * 1.5,
    nextDirectionChange: Math.random() * 3,
    isMoving: Math.random() > 0.5
  })
  
  useFrame((frameState, delta) => {
    if (!rigidBodyRef.current || !visualGroupRef.current) return
    
    const time = frameState.clock.elapsedTime
    const sheep = state.current
    
    // Get current position from physics body
    const position = rigidBodyRef.current.translation()
    const currentX = position.x
    const currentZ = position.z
    
    // Check if it's time to change direction
    if (time > sheep.nextDirectionChange) {
      sheep.isMoving = Math.random() > 0.3 // 70% chance to move
      if (sheep.isMoving) {
        // Pick a new target within a reasonable range
        const angle = Math.random() * Math.PI * 2
        const distance = 5 + Math.random() * 15
        sheep.targetX = currentX + Math.cos(angle) * distance
        sheep.targetZ = currentZ + Math.sin(angle) * distance
        
        // Keep within bounds
        sheep.targetX = Math.max(-60, Math.min(60, sheep.targetX))
        sheep.targetZ = Math.max(-60, Math.min(60, sheep.targetZ))
        
        // Check if target is valid terrain
        const targetHeight = getTerrainHeight(sheep.targetX, sheep.targetZ)
        if (targetHeight < 0 || targetHeight > 3.5) {
          // Invalid target, stay put
          sheep.targetX = currentX
          sheep.targetZ = currentZ
          sheep.isMoving = false
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
        sheep.isMoving = false
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
      <group ref={visualGroupRef} scale={scale}>
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
    for (let i = 0; i < 30; i++) {
      const x = (Math.random() - 0.5) * 120
      const z = (Math.random() - 0.5) * 120
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

function Rocks() {
  const rocks = useMemo(() => {
    const rockData = []
    for (let i = 0; i < 50; i++) {
      const x = (Math.random() - 0.5) * 180
      const z = (Math.random() - 0.5) * 180
      const nx = (x / 200) + 0.5
      const nz = (z / 200) + 0.5
      let height = 0
      height += Math.sin(nx * 8 + 0.5) * Math.cos(nz * 6) * 2
      height += Math.sin(nx * 15 + 1) * Math.cos(nz * 12 + 0.5) * 1
      height += Math.sin(nx * 3) * 3
      height += Math.cos(nz * 4) * 2
      
      if (height > -2) {
        rockData.push({ 
          x, 
          y: height - 0.3, 
          z, 
          scale: 0.3 + Math.random() * 0.7,
          rotY: Math.random() * Math.PI * 2
        })
      }
    }
    return rockData
  }, [])

  return (
    <group>
      {rocks.map((rock, i) => (
        <mesh 
          key={i} 
          position={[rock.x, rock.y, rock.z]} 
          scale={rock.scale}
          rotation={[0, rock.rotY, 0]}
          castShadow
        >
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial 
            color="#757575" 
            roughness={0.95}
            metalness={0.05}
          />
        </mesh>
      ))}
    </group>
  )
}

function Scene() {
  return (
    <>
      {/* Camera Controls */}
      <OrbitControls 
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={150}
        maxPolarAngle={Math.PI / 2 - 0.1}
      />
      
      {/* Sky */}
      <Sky 
        distance={450000}
        sunPosition={[100, 20, 100]}
        inclination={0.6}
        azimuth={0.25}
        turbidity={10}
        rayleigh={2}
        mieCoefficient={0.005}
        mieDirectionalG={0.8}
      />
      
      {/* Fog for atmosphere */}
      <fog attach="fog" args={['#87CEEB', 50, 200]} />
      
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
      <Grass />
      <Trees />
      <Rocks />
      <Sheep />
    </>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <Canvas 
    style={{ width: "100vw", height: "100vh" }}
    camera={{ position: [30, 20, 50], fov: 60, near: 0.1, far: 1000 }}
    shadows
  >
    <Physics gravity={[0, -9.81, 0]}>
      <Scene />
    </Physics>
  </Canvas>,
)

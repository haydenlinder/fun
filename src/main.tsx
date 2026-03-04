import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { useRef, useMemo, useEffect, useState, useCallback } from 'react'
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber'
import { OrbitControls, Sky, shaderMaterial } from '@react-three/drei'
import { Physics, RigidBody, CuboidCollider, useRapier } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata'

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

// Single destructible tree component
function DestructibleTree({ x, y, z, scale }: { x: number, y: number, z: number, scale: number }) {
  const { scene } = useThree()
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
          color="#ffcd44" 
          transparent 
          opacity={opacity * 0.4}
        />
      </mesh>
      {/* Impact point glow */}
      <mesh position={[0, -length / 2, 0]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshBasicMaterial 
          color="#ffaa00" 
          transparent 
          opacity={opacity * 0.8}
        />
      </mesh>
    </group>
  )
}

// Laser system - manages all active lasers and listens for clicks
function LaserSystem() {
  const { camera, scene, gl, viewport } = useThree()
  const [lasers, setLasers] = useState<LaserData[]>([])
  const nextLaserId = useRef(0)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
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
        
        setLasers(prev => [...prev, newLaser])
        
        // Remove laser after animation completes
        setTimeout(() => {
          setLasers(prev => prev.filter(l => l.id !== newLaser.id))
        }, 300)
      }
    }
    
    gl.domElement.addEventListener('click', handleClick)
    return () => gl.domElement.removeEventListener('click', handleClick)
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
  
  // Mutable state for movement behavior
  const state = useRef({
    targetX: initialX,
    targetZ: initialZ,
    rotY: Math.random() * Math.PI * 2,
    moveSpeed: 1.5 + Math.random() * 1.5,
    nextDirectionChange: Math.random() * 3,
    isMoving: Math.random() > 0.5
  })
  
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
      
      {/* Laser System */}
      <LaserSystem />
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

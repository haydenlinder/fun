import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Sky, Environment } from '@react-three/drei'

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
    <mesh ref={meshRef} geometry={geometry} receiveShadow castShadow>
      <meshStandardMaterial 
        vertexColors 
        roughness={0.9}
        metalness={0.1}
        flatShading={false}
      />
    </mesh>
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
      <Trees />
      <Rocks />
    </>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <Canvas 
    style={{ width: "100vw", height: "100vh" }}
    camera={{ position: [30, 20, 50], fov: 60, near: 0.1, far: 1000 }}
    shadows
  >
    <Scene />
  </Canvas>,
)

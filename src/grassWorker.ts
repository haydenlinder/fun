// Web Worker for generating grass blade instance data
// This runs on a separate thread to avoid blocking the main UI

interface GrassWorkerMessage {
  fieldSize: number
  baseDensity: number
  mediumDensity: number
  tallDensity: number
  clusterCount: number
}

// Helper to get terrain height (must be duplicated here since workers are isolated)
function getTerrainHeight(x: number, z: number): number {
  const nx = (x / 200) + 0.5
  const nz = (z / 200) + 0.5
  let h = 0
  h += Math.sin(nx * 8 + 0.5) * Math.cos(nz * 6) * 2
  h += Math.sin(nx * 15 + 1) * Math.cos(nz * 12 + 0.5) * 1
  h += Math.sin(nx * 30) * Math.cos(nz * 25) * 0.5
  h += Math.sin(nx * 50 + 2) * Math.cos(nz * 45 + 1) * 0.25
  h += Math.sin(nx * 3) * 3
  h += Math.cos(nz * 4) * 2
  return h
}

// Perlin-like noise for natural density variation
function noise2D(x: number, z: number, freq: number): number {
  const v1 = Math.sin(x * freq * 1.0) * Math.cos(z * freq * 1.3)
  const v2 = Math.sin(x * freq * 2.1 + 5) * Math.cos(z * freq * 1.8 + 3)
  return (v1 + v2 * 0.5) * 0.5 + 0.5
}

self.onmessage = function(e: MessageEvent<GrassWorkerMessage>) {
  const { fieldSize, baseDensity, mediumDensity, tallDensity, clusterCount } = e.data
  
  // Arrays for instance data
  const positions: number[] = []
  const colors: number[] = []
  const rotations: number[] = []
  const scales: number[] = []
  const phases: number[] = []
  const bends: number[] = []
  const tilts: number[] = []
  
  // Add blade helper
  function addBlade(x: number, z: number, h: number, scale: number, colorVariant: number) {
    positions.push(x, h, z)
    rotations.push(Math.random() * Math.PI * 2)
    scales.push(scale)
    phases.push(Math.random() * Math.PI * 2)
    
    const bendStrength = scale * 1.5
    bends.push((Math.random() * 0.7 + 0.3) * bendStrength * (Math.random() > 0.3 ? 1 : -1))
    tilts.push((Math.random() - 0.5) * 3.0 * scale)
    
    let r: number, g: number, b: number
    const cv = colorVariant + (Math.random() - 0.5) * 0.15
    
    if (cv < 0.25) {
      r = 0.03 + Math.random() * 0.02
      g = 0.12 + Math.random() * 0.05
      b = 0.02 + Math.random() * 0.01
    } else if (cv < 0.45) {
      r = 0.06 + Math.random() * 0.03
      g = 0.25 + Math.random() * 0.08
      b = 0.04 + Math.random() * 0.02
    } else if (cv < 0.65) {
      r = 0.12 + Math.random() * 0.05
      g = 0.38 + Math.random() * 0.1
      b = 0.06 + Math.random() * 0.03
    } else if (cv < 0.82) {
      r = 0.2 + Math.random() * 0.08
      g = 0.5 + Math.random() * 0.12
      b = 0.1 + Math.random() * 0.05
    } else {
      r = 0.35 + Math.random() * 0.1
      g = 0.55 + Math.random() * 0.1
      b = 0.12 + Math.random() * 0.05
    }
    
    colors.push(r, g, b)
  }
  
  // Base layer - short grass everywhere
  for (let i = 0; i < baseDensity; i++) {
    const x = (Math.random() - 0.5) * fieldSize
    const z = (Math.random() - 0.5) * fieldSize
    const h = getTerrainHeight(x, z)
    
    if (h < -1.5 || h > 4) continue
    
    const scale = 0.35 + Math.random() * 0.35
    const colorVar = noise2D(x, z, 0.2)
    addBlade(x, z, h, scale, colorVar)
  }
  
  // Medium grass layer
  for (let i = 0; i < mediumDensity; i++) {
    const x = (Math.random() - 0.5) * fieldSize
    const z = (Math.random() - 0.5) * fieldSize
    const h = getTerrainHeight(x, z)
    
    if (h < -1.5 || h > 4) continue
    
    const scale = 0.6 + Math.random() * 0.5
    const colorVar = noise2D(x, z, 0.15)
    addBlade(x, z, h, scale, colorVar)
  }
  
  // Tall grass layer
  for (let i = 0; i < tallDensity; i++) {
    const x = (Math.random() - 0.5) * fieldSize
    const z = (Math.random() - 0.5) * fieldSize
    const h = getTerrainHeight(x, z)
    
    if (h < -1.5 || h > 4) continue
    
    const localDensity = noise2D(x, z, 0.08)
    if (Math.random() > localDensity * 0.8 + 0.2) continue
    
    const scale = 0.9 + Math.random() * 0.7
    const colorVar = noise2D(x, z, 0.12)
    addBlade(x, z, h, scale, colorVar)
  }
  
  // Clusters
  for (let c = 0; c < clusterCount; c++) {
    const cx = (Math.random() - 0.5) * fieldSize
    const cz = (Math.random() - 0.5) * fieldSize
    const ch = getTerrainHeight(cx, cz)
    
    if (ch < -1 || ch > 3.5) continue
    
    const clusterSize = 0.3 + Math.random() * 0.8
    const bladesPerCluster = 8 + Math.floor(Math.random() * 15)
    const clusterColor = Math.random()
    
    for (let b = 0; b < bladesPerCluster; b++) {
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * clusterSize
      const x = cx + Math.cos(angle) * dist
      const z = cz + Math.sin(angle) * dist
      
      const scale = 1.2 + Math.random() * 0.9
      addBlade(x, z, ch, scale, clusterColor + (Math.random() - 0.5) * 0.15)
    }
  }
  
  // Convert to typed arrays and transfer
  const positionsArray = new Float32Array(positions)
  const colorsArray = new Float32Array(colors)
  const rotationsArray = new Float32Array(rotations)
  const scalesArray = new Float32Array(scales)
  const phasesArray = new Float32Array(phases)
  const bendsArray = new Float32Array(bends)
  const tiltsArray = new Float32Array(tilts)
  
  // Post back with transferable buffers for zero-copy transfer
  self.postMessage({
    positions: positionsArray,
    colors: colorsArray,
    rotations: rotationsArray,
    scales: scalesArray,
    phases: phasesArray,
    bends: bendsArray,
    tilts: tiltsArray,
    instanceCount: positions.length / 3
  }, [
    positionsArray.buffer,
    colorsArray.buffer,
    rotationsArray.buffer,
    scalesArray.buffer,
    phasesArray.buffer,
    bendsArray.buffer,
    tiltsArray.buffer
  ] as any)
}

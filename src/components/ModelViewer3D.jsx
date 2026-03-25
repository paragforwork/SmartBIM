import { memo, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

const SELECTED_COLOR = '#fbbf24'
const DEFAULT_COLOR = '#7a8798'
const IFC_TYPE_COLORS = {
  IfcWall: '#8f868b',
  IfcWallStandardCase: '#8f868b',
  IfcSlab: '#8b8e90',
  IfcPlate: '#8f9398',
  IfcFloor: '#8f9398',
  IfcRoof: '#a6a8aa',
  IfcDoor: '#8a7b6c',
  IfcColumn: '#777d83',
}

const ElementMesh = memo(function ElementMesh({ item, isSelected, onSelect }) {
  const geometry = useMemo(() => {
    const verts = Array.isArray(item.vertices) ? item.vertices : []
    const faces = Array.isArray(item.faces) ? item.faces : []
    if (verts.length < 9 || faces.length < 3) return null

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    g.setIndex(faces)

    const normals = Array.isArray(item.normals) ? item.normals : []
    if (normals.length === verts.length) {
      g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    } else {
      g.computeVertexNormals()
    }

    g.computeBoundingSphere()
    return g
  }, [item.vertices, item.faces, item.normals])

  const matrix = useMemo(() => {
    const m = new THREE.Matrix4()
    const values = Array.isArray(item.matrix) && item.matrix.length === 16 ? item.matrix : undefined
    if (values) m.fromArray(values)
    return m
  }, [item.matrix])

  if (!geometry) return null
  const typeKey = typeof item.type === 'string' ? item.type.trim() : ''
  const typeColor = IFC_TYPE_COLORS[typeKey] || DEFAULT_COLOR

  return (
    <mesh
      geometry={geometry}
      matrix={matrix}
      matrixAutoUpdate={false}
      onClick={(e) => {
        e.stopPropagation()
        onSelect?.(item.guid)
      }}
      >
      <meshStandardMaterial
        color={isSelected ? SELECTED_COLOR : typeColor}
        roughness={0.78}
        metalness={0.02}
      />
    </mesh>
  )
})

const SceneContent = memo(function SceneContent({ elements, selectedGuid, onSelect }) {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {elements.map((item) => (
        <ElementMesh
          key={item.guid}
          item={item}
          isSelected={item.guid === selectedGuid}
          onSelect={onSelect}
        />
      ))}
    </group>
  )
})

const ModelViewer3D = memo(function ModelViewer3D({ elements, selectedGuid, onSelect }) {
  return (
    <Canvas
      className="model-canvas"
      camera={{ position: [30, 18, 30], fov: 50, near: 0.1, far: 20000 }}
    >
      <color attach="background" args={['#3a3a3a']} />
      <ambientLight intensity={0.72} />
      <directionalLight position={[20, 40, 10]} intensity={0.85} />
      <directionalLight position={[-20, 12, -20]} intensity={0.32} />
      <gridHelper args={[240, 120, '#4f4f4f', '#464646']} />

      <SceneContent elements={elements} selectedGuid={selectedGuid} onSelect={onSelect} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </Canvas>
  )
})

export default ModelViewer3D

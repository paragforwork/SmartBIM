import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import ModelViewer3D from './components/ModelViewer3D'

// ─── Constants ──────────────────────────────────────────────────────────────
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/pyodide.js'
const WHL_PATH = '/wheels/ifcopenshell-0.8.5+a51b2c5-cp313-cp313-pyodide_2025_0_wasm32.whl'
const CONTEXT_PATH = '/context.py'

const IFC_CLASSES = [
  'IfcWall', 'IfcSlab', 'IfcDoor', 'IfcWindow', 'IfcBeam', 'IfcColumn',
  'IfcStair', 'IfcRoof', 'IfcCurtainWall', 'IfcFlowTerminal', 'IfcSpace',
]

// ─── Status badge ────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  idle: { text: 'Ready', cls: 'status-idle' },
  initializing: { text: 'Initializing Engine…', cls: 'status-loading' },
  loading_pkg: { text: 'Loading IfcOpenShell…', cls: 'status-loading' },
  ready: { text: 'Engine Ready', cls: 'status-ready' },
  loading_file: { text: 'Loading File…', cls: 'status-loading' },
  parsing: { text: 'Parsing Graph…', cls: 'status-loading' },
  done: { text: 'Model Loaded', cls: 'status-done' },
  error: { text: 'Error', cls: 'status-error' },
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Spinner */
function Spinner() {
  return <span className="spinner" aria-label="Loading" />
}

/** Status Bar */
function StatusBar({ status, summary }) {
  const { text, cls } = STATUS_LABELS[status] || STATUS_LABELS.idle
  const isLoading = cls === 'status-loading'
  return (
    <div className={`status-bar ${cls}`}>
      {isLoading && <Spinner />}
      <span className="status-text">{text}</span>
      {summary && <span className="status-summary">{summary}</span>}
    </div>
  )
}

/** Collapsible Tree Node — Blender outliner-style */
function TreeNode({ node, depth = 0, selectedGuid, onSelect }) {
  const [open, setOpen] = useState(depth < 2)
  const [visible, setVisible] = useState(true)   // UI placeholder — no 3D effect yet
  const hasChildren = node.children && node.children.length > 0
  const isLeaf = !hasChildren
  const isSelected = node.guid === selectedGuid

  // Per-type colour coding (matches Blender icon colours)
  const TYPE_META = {
    IfcProject:        { color: '#60a5fa', icon: '⬡' },
    IfcSite:           { color: '#34d399', icon: '◈' },
    IfcBuilding:       { color: '#a78bfa', icon: '⬛' },
    IfcBuildingStorey: { color: '#fbbf24', icon: '▤'  },
    IfcWall:           { color: '#f87171', icon: '▭'  },
    IfcSlab:           { color: '#fb923c', icon: '▱'  },
    IfcDoor:           { color: '#4ade80', icon: '⬚'  },
    IfcWindow:         { color: '#38bdf8', icon: '⬜'  },
    IfcBeam:           { color: '#c084fc', icon: '╠'  },
    IfcColumn:         { color: '#e879f9', icon: '║'  },
    IfcStair:          { color: '#fb7185', icon: '⊟'  },
    IfcRoof:           { color: '#a3e635', icon: '△'  },
    IfcSpace:          { color: '#67e8f9', icon: '▢'  },
    IfcFurnishingElement: { color: '#94a3b8', icon: '⬕' },
    IfcCurtainWall:    { color: '#7dd3fc', icon: '▭'  },
    IfcCovering:       { color: '#d4d4aa', icon: '▤'  },
    IfcMember:         { color: '#a8a29e', icon: '╠'  },
    IfcFlowTerminal:   { color: '#86efac', icon: '○'  },
  }
  const meta = TYPE_META[node.type] || { color: '#94a3b8', icon: '◆' }

  // Build the display label: "IfcType / Name"
  const typeLabel = node.type ? node.type.replace('Ifc', '') : ''
  const nameLabel = node.name || node.type

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${isSelected ? 'tree-row--selected' : ''}`}
        style={{ paddingLeft: `${6 + depth * 10}px` }}
        onClick={() => {
          if (!isLeaf) setOpen(o => !o)
          if (node.guid) onSelect(node.guid, node)
        }}
      >
        {/* ▶ Expand toggle */}
        <span
          className={`tree-toggle ${hasChildren ? 'tree-toggle--active' : 'tree-toggle--leaf'} ${open && hasChildren ? 'open' : ''}`}
          onClick={e => { if (hasChildren) { e.stopPropagation(); setOpen(o => !o) } }}
        >
          {hasChildren ? '▶' : '·'}
        </span>

        {/* Coloured type icon */}
        <span className="tree-type-icon" style={{ color: meta.color }}>{meta.icon}</span>

        {/* Type prefix (small, coloured) + name */}
        <span className="tree-label">
          <span className="tree-type-prefix" style={{ color: meta.color }}>{typeLabel}</span>
          <span className="tree-sep">/</span>
          <span className="tree-name-text">{nameLabel}</span>
        </span>

        {/* Right-side actions — visibility eye (placeholder) */}
        <span className="tree-actions">
          <button
            className={`tree-eye ${visible ? 'tree-eye--on' : 'tree-eye--off'}`}
            title={visible ? 'Hide' : 'Show'}
            onClick={e => { e.stopPropagation(); setVisible(v => !v) }}
          >
            {visible
              ? <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/></svg>
              : <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>
            }
          </button>
        </span>
      </div>

      {/* Children */}
      {hasChildren && open && (
        <div className="tree-children">
          {node.children.map(child => (
            <TreeNode
              key={child.guid || child.id}
              node={child}
              depth={depth + 1}
              selectedGuid={selectedGuid}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Properties Panel */
function PropertiesPanel({ properties, selectedGuid, onUpdateProperty }) {
  const [editingCell, setEditingCell] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [savingCellKey, setSavingCellKey] = useState(null)

  if (!selectedGuid) {
    return (
      <div className="panel-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" />
        </svg>
        <p>Select an element from the tree to view its properties</p>
      </div>
    )
  }
  if (!properties) {
    return <div className="panel-empty"><Spinner /><p>Loading properties…</p></div>
  }

  const { guid, type, name, psets } = properties
  const hasExportData = Boolean(psets && Object.keys(psets).length > 0)
  const getCellKey = (psetName, propName) => `${psetName}::${propName}`
  const startEdit = (psetName, propName, value) => {
    const key = getCellKey(psetName, propName)
    if (savingCellKey === key) return
    setEditingCell({ psetName, propName })
    setEditingValue(String(value ?? ''))
  }

  const saveEdit = async () => {
    if (!editingCell || !onUpdateProperty) return
    const { psetName, propName } = editingCell
    const key = getCellKey(psetName, propName)
    setSavingCellKey(key)
    try {
      await onUpdateProperty(guid, psetName, propName, editingValue)
    } finally {
      setSavingCellKey(null)
      setEditingCell(null)
      setEditingValue('')
    }
  }

  const toCsvCell = (value) => {
    const text = String(value ?? '')
    return `"${text.replace(/"/g, '""')}"`
  }

  const buildCsvRows = () => {
    if (!psets || typeof psets !== 'object') return []
    const rows = []
    for (const [groupName, groupProps] of Object.entries(psets)) {
      if (groupProps && typeof groupProps === 'object' && !Array.isArray(groupProps)) {
        for (const [propName, propValue] of Object.entries(groupProps)) {
          rows.push([groupName, propName, String(propValue ?? '—')])
        }
      } else {
        rows.push([groupName, 'Value', String(groupProps ?? '—')])
      }
    }
    return rows
  }

  const handleExportCsv = () => {
    if (!properties || !hasExportData) return
    const rows = buildCsvRows()
    if (rows.length === 0) return

    const csvLines = [
      ['Property Group', 'Property Name', 'Value'],
      ...rows,
    ].map(row => row.map(toCsvCell).join(','))

    const csvContent = csvLines.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const safeGuid = String(guid || 'element').replace(/[^\w.-]/g, '_')
    const fileName = `properties_${safeGuid}.csv`

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="props-panel">
      <div className="props-header">
        <div className="props-title-row">
          <div className="props-title">{name}</div>
          <button
            className="export-csv-btn"
            onClick={handleExportCsv}
            disabled={!hasExportData}
            title={hasExportData ? 'Download selected element properties as CSV' : 'No properties available to export'}
          >
            Export CSV
          </button>
        </div>
        <div className="props-meta">
          <span className="badge badge--type">{type}</span>
          <span className="badge badge--guid" title={guid}>{guid.slice(0, 8)}…</span>
        </div>
      </div>

      {psets && Object.entries(psets).length > 0 ? (
        Object.entries(psets).map(([psetName, props]) => (
          <div key={psetName} className="pset-group">
            <div className="pset-name">{psetName}</div>
            <table className="props-table">
              <tbody>
                {typeof props === 'object' && !Array.isArray(props)
                  ? Object.entries(props).map(([k, v]) => (
                    <tr key={k}>
                      <td className="prop-key">{k}</td>
                      <td
                        className={`prop-val ${editingCell?.psetName === psetName && editingCell?.propName === k ? 'prop-val--editing' : 'prop-val--editable'} ${savingCellKey === getCellKey(psetName, k) ? 'prop-val--saving' : ''}`}
                        onClick={() => startEdit(psetName, k, v)}
                      >
                        {editingCell?.psetName === psetName && editingCell?.propName === k ? (
                          <input
                            className="prop-edit-input"
                            autoFocus
                            value={editingValue}
                            onChange={e => setEditingValue(e.target.value)}
                            onBlur={saveEdit}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                saveEdit()
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                setEditingCell(null)
                                setEditingValue('')
                              }
                            }}
                          />
                        ) : (
                          String(v ?? '—')
                        )}
                      </td>
                    </tr>
                  ))
                  : <tr><td colSpan={2}>{String(props)}</td></tr>
                }
              </tbody>
            </table>
          </div>
        ))
      ) : (
        <div className="panel-empty" style={{ marginTop: '2rem' }}>
          <p>No property sets found for this element.</p>
        </div>
      )}
    </div>
  )
}

/** Takeoff Panel */
function TakeoffPanel({ pyodide, engineStatus }) {
  const [selectedClass, setSelectedClass] = useState('IfcWall')
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const runTakeoff = useCallback(async () => {
    if (!pyodide || engineStatus !== 'done') return
    setLoading(true); setError(null)
    try {
      await pyodide.runPythonAsync(`get_quantities_by_type(${JSON.stringify(selectedClass)})`)
      const raw = pyodide.globals.get('_result')
      const data = JSON.parse(raw)
      if (data.error) throw new Error(data.error)
      setRows(data)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [pyodide, engineStatus, selectedClass])

  const QTY_COLS = ['NetVolume', 'NetArea', 'GrossArea', 'Length', 'Width', 'Height']

  return (
    <div className="takeoff-panel">
      <div className="takeoff-controls">
        <select
          className="ifc-select"
          value={selectedClass}
          onChange={e => setSelectedClass(e.target.value)}
          disabled={engineStatus !== 'done'}
        >
          {IFC_CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>
        <button
          className="btn btn--primary"
          onClick={runTakeoff}
          disabled={loading || engineStatus !== 'done'}
        >
          {loading ? <><Spinner /> Running…</> : '⚡ Run Takeoff'}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {rows === null && !loading && (
        <div className="panel-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
          <p>Select an IFC class and run the takeoff to see quantities</p>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="panel-empty"><p>No elements of type <strong>{selectedClass}</strong> found.</p></div>
      )}

      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>GUID</th>
                {QTY_COLS.map(c => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.guid}>
                  <td>{i + 1}</td>
                  <td>{r.name}</td>
                  <td className="guid-cell" title={r.guid}>{r.guid.slice(0, 8)}…</td>
                  {QTY_COLS.map(c => (
                    <td key={c}>{r[c] != null ? r[c] : <span className="null-val">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Search Results Panel */
function SearchPanel({ results, onSelect, selectedGuid }) {
  if (!results) return null
  if (results.length === 0) return <div className="panel-empty"><p>No results found.</p></div>
  return (
    <div className="search-results">
      <div className="search-count">{results.length} result{results.length !== 1 ? 's' : ''}</div>
      {results.map(r => (
        <div
          key={r.guid}
          className={`search-row ${r.guid === selectedGuid ? 'search-row--selected' : ''}`}
          onClick={() => onSelect(r.guid, r)}
        >
          <span className="search-type">{r.type}</span>
          <span className="search-name">{r.name}</span>
          {r.matched_prop && (
            <span className="search-match">{r.matched_prop}: {String(r.matched_value)}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [engineStatus, setEngineStatus] = useState('idle')
  const [statusSummary, setStatusSummary] = useState('')
  const [errorMsg, setErrorMsg] = useState(null)
  const [pyodide, setPyodide] = useState(null)

  const [spatialTree, setSpatialTree] = useState(null)
  const [selectedGuid, setSelectedGuid] = useState(null)
  const [properties, setProperties] = useState(null)

  const [activeTab, setActiveTab] = useState('properties')

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)

  const [sidebarWidth, setSidebarWidth] = useState(300)
  const [sidebarOpen, setSidebarOpen]   = useState(true)
  const [savingIfc, setSavingIfc] = useState(false)
  const [loadedFileName, setLoadedFileName] = useState('updated-model')
  const [modelGeometry, setModelGeometry] = useState([])
  const [geometryLoading, setGeometryLoading] = useState(false)
  const fileInputRef = useRef(null)
  const pyodideRef   = useRef(null)

  // ── Sidebar resize ────────────────────────────────────────────────────────
  const onDragStart = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    const onMove = (ev) => {
      const delta = ev.clientX - startX
      setSidebarWidth(Math.max(200, Math.min(600, startW + delta)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  // ── Boot Pyodide ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        setEngineStatus('initializing')
        // Pyodide is already loaded via <script> in index.html — just init runtime
        const py = await window.loadPyodide()
        if (cancelled) return

        setEngineStatus('loading_pkg')
        // 1) Load built-in Pyodide packages that ifcopenshell depends on
        await py.loadPackage(['numpy', 'lxml', 'shapely'])
        if (cancelled) return

        // 2) Load micropip and install the local ifcopenshell whl
        await py.loadPackage('micropip')
        await py.runPythonAsync(`
import micropip
await micropip.install("${WHL_PATH}", keep_going=True)
`)
        if (cancelled) return

        // 3) Load context.py
        const res = await fetch(CONTEXT_PATH)
        if (!res.ok) throw new Error(`Could not load ${CONTEXT_PATH}: ${res.status}`)
        const code = await res.text()
        await py.runPythonAsync(code)

        pyodideRef.current = py
        setPyodide(py)
        setEngineStatus('ready')
        setStatusSummary('Upload an IFC file to begin')
      } catch (e) {
        if (!cancelled) { setEngineStatus('error'); setErrorMsg(e.message) }
      }
    }
    boot()
    return () => { cancelled = true }
  }, [])

  // ── File Upload ───────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    const py = pyodideRef.current
    if (!py || !file) return
    setSearchResults(null)
    setSearchQuery('')
    setSelectedGuid(null)
    setProperties(null)
    setSpatialTree(null)
    setModelGeometry([])

    try {
      setEngineStatus('loading_file')
      setStatusSummary(file.name)
      setLoadedFileName(file.name.replace(/\.ifc$/i, '') || 'updated-model')
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)

      setEngineStatus('parsing')
      py.globals.set('_file_bytes', py.toPy(bytes))
      await py.runPythonAsync('load_ifc(bytes(_file_bytes))')
      const summaryRaw = py.globals.get('_result')
      const summary = JSON.parse(summaryRaw)

      setStatusSummary(`${summary.project} — ${summary.schema} — ${summary.element_count} entities`)

      // Build spatial tree
      await py.runPythonAsync('get_spatial_tree()')
      const treeRaw = py.globals.get('_result')
      const tree = JSON.parse(treeRaw)
      setSpatialTree(tree)

      // Build geometry payload for Three.js viewer
      setGeometryLoading(true)
      try {
        await py.runPythonAsync('get_model_geometry()')
        const geomRaw = py.globals.get('_result')
        const geomResponse = JSON.parse(geomRaw)
        if (geomResponse.error) throw new Error(geomResponse.error)
        setModelGeometry(Array.isArray(geomResponse.elements) ? geomResponse.elements : [])
      } catch (geomError) {
        setModelGeometry([])
        setErrorMsg(`3D geometry unavailable: ${geomError.message}`)
      } finally {
        setGeometryLoading(false)
      }

      setEngineStatus('done')
    } catch (e) {
      setEngineStatus('error')
      setErrorMsg(e.message)
    }
  }, [])

  const onFileChange = useCallback(e => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onDrop = useCallback(e => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const fetchPropertiesByGuid = useCallback(async (guid) => {
    const py = pyodideRef.current
    if (!py) return
    try {
      await py.runPythonAsync(`get_element_properties(${JSON.stringify(guid)})`)
      const raw = py.globals.get('_result')
      const data = JSON.parse(raw)
      setProperties(data.error ? null : data)
    } catch (e) {
      setErrorMsg(e.message)
    }
  }, [])

  // ── Element Selection ─────────────────────────────────────────────────────
  const handleSelect = useCallback(async (guid) => {
    setSelectedGuid(guid)
    setProperties(null)
    setActiveTab('properties')
    await fetchPropertiesByGuid(guid)
  }, [fetchPropertiesByGuid])

  // ── Property Editing ──────────────────────────────────────────────────────
  const handlePropertyUpdate = useCallback(async (guid, psetName, propName, value) => {
    const py = pyodideRef.current
    if (!py) return
    try {
      await py.runPythonAsync(
        `update_element_property(${JSON.stringify(guid)}, ${JSON.stringify(psetName)}, ${JSON.stringify(propName)}, ${JSON.stringify(value)})`,
      )
      const raw = py.globals.get('_result')
      const response = JSON.parse(raw)
      if (response.error) throw new Error(response.error)
      await fetchPropertiesByGuid(guid)
    } catch (e) {
      setErrorMsg(e.message)
      throw e
    }
  }, [fetchPropertiesByGuid])

  // ── Save IFC File ─────────────────────────────────────────────────────────
  const handleSaveIfcFile = useCallback(async () => {
    const py = pyodideRef.current
    if (!py || engineStatus !== 'done') return
    setSavingIfc(true)
    try {
      await py.runPythonAsync('export_ifc_text()')
      const raw = py.globals.get('_result')
      const response = JSON.parse(raw)
      if (response.error) throw new Error(response.error)

      const blob = new Blob([response.ifc_text], { type: 'application/x-step' })
      const fileName = `${loadedFileName || 'updated-model'}-edited.ifc`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setStatusSummary(`Saved ${fileName}`)
    } catch (e) {
      setErrorMsg(e.message)
    } finally {
      setSavingIfc(false)
    }
  }, [engineStatus, loadedFileName])

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async (q) => {
    const py = pyodideRef.current
    setSearchQuery(q)
    if (!q.trim() || !py || engineStatus !== 'done') {
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      await py.runPythonAsync(`search_elements(${JSON.stringify(q.trim())})`)
      const raw = py.globals.get('_result')
      const data = JSON.parse(raw)
      setSearchResults(Array.isArray(data) ? data : null)
    } catch (e) { console.error(e) }
    finally { setSearching(false) }
  }, [engineStatus])

  const isLoaded = engineStatus === 'done'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {/* ── TOP BAR ── */}
      <header className="topbar">
        <div className="topbar-brand">
          <svg className="brand-icon" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#6366f1" />
            <path d="M8 22L16 10l8 12H8z" fill="white" opacity="0.9" />
            <rect x="13" y="16" width="6" height="6" rx="1" fill="white" />
          </svg>
          <span className="brand-name">Smart<span className="brand-accent">BIM</span></span>
          <span className="brand-sub">Dashboard</span>
        </div>

        <div className="topbar-center">
          <div className="search-wrap" onBlur={e => {
            // Hide dropdown when focus leaves the entire search-wrap
            if (!e.currentTarget.contains(e.relatedTarget)) setSearchFocused(false)
          }}>
            <svg className="search-icon" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            <input
              className="search-input"
              placeholder='Search: "IfcDoor" or "Width > 900"'
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              disabled={!isLoaded}
            />
            {searching && <Spinner />}
            {searchQuery && (
              <button className="search-clear" onClick={() => {
                setSearchQuery('')
                setSearchResults(null)
                setSearchFocused(false)
              }}>✕</button>
            )}

            {/* ── Floating search dropdown ── */}
            {searchFocused && searchResults && searchResults.length > 0 && (
              <div className="search-dropdown" onMouseDown={e => e.preventDefault()}>
                <div className="search-dropdown-header">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for <em>"{searchQuery}"</em>
                </div>
                <div className="search-dropdown-list">
                  {searchResults.map(r => (
                    <div
                      key={r.guid}
                      className={`search-dropdown-row ${r.guid === selectedGuid ? 'search-dropdown-row--active' : ''}`}
                      onClick={() => { handleSelect(r.guid, r); setSearchFocused(false) }}
                    >
                      <span className="search-dropdown-type">{r.type.replace('Ifc', '')}</span>
                      <span className="search-dropdown-name">{r.name}</span>
                      {r.matched_prop && (
                        <span className="search-dropdown-match">{r.matched_prop}: {String(r.matched_value)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {searchFocused && searchResults && searchResults.length === 0 && (
              <div className="search-dropdown">
                <div className="search-dropdown-empty">No results for "{searchQuery}"</div>
              </div>
            )}
          </div>
        </div>

        <div className="topbar-right">
          <StatusBar status={engineStatus} summary={statusSummary} />
          <button
            className="btn btn--save-ifc"
            onClick={handleSaveIfcFile}
            disabled={engineStatus !== 'done' || savingIfc}
          >
            {savingIfc ? <><Spinner /> Saving…</> : 'Save .ifc File'}
          </button>
          <button
            className="btn btn--upload"
            onClick={() => fileInputRef.current?.click()}
            disabled={engineStatus === 'initializing' || engineStatus === 'loading_pkg'}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            Upload IFC
          </button>
          <input ref={fileInputRef} type="file" accept=".ifc" style={{ display: 'none' }} onChange={onFileChange} />
        </div>
      </header>

      {/* ── MAIN ── */}
      <div
        className="main-layout"
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
      >
        {/* ── SIDEBAR ── */}
        <aside
          className={`sidebar ${sidebarOpen ? '' : 'sidebar--collapsed'}`}
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
        >
          <div className="sidebar-header">
            <span className="sidebar-title">Spatial Hierarchy</span>
            <div className="sidebar-header-actions">
              {spatialTree && (
                <span className="sidebar-count">{spatialTree.length} project{spatialTree.length !== 1 ? 's' : ''}</span>
              )}
              {/* Collapse toggle */}
              <button
                className="sidebar-collapse-btn"
                title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                onClick={() => setSidebarOpen(o => !o)}
              >
                {sidebarOpen
                  ? <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                  : <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
                }
              </button>
            </div>
          </div>

          <div className="sidebar-body">
            {!isLoaded && (
              <div className="panel-empty sidebar-empty">
                {(engineStatus === 'initializing' || engineStatus === 'loading_pkg' || engineStatus === 'loading_file' || engineStatus === 'parsing')
                  ? <><Spinner /><p>Loading…</p></>
                  : <>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                    <p>Upload an IFC file to explore the spatial hierarchy</p>
                  </>
                }
              </div>
            )}

            {/* Tree always visible — search dropdown is in topbar, not here */}
            {spatialTree && spatialTree.map(node => (
              <TreeNode
                key={node.guid || node.id}
                node={node}
                depth={0}
                selectedGuid={selectedGuid}
                onSelect={handleSelect}
              />
            ))}
          </div>

          {/* ── Drag resize handle ── */}
          <div
            className="sidebar-resizer"
            onMouseDown={onDragStart}
            title="Drag to resize"
          />
        </aside>

        {/* Collapsed tab — click to re-open sidebar */}
        {!sidebarOpen && (
          <button className="sidebar-reopen-btn" onClick={() => setSidebarOpen(true)} title="Open hierarchy panel">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
            <span style={{ writingMode: 'vertical-lr', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 8 }}>Hierarchy</span>
          </button>
        )}

        {/* ── CENTER WORKSPACE ── */}
        <section className="workspace-panel">
          {!isLoaded ? (
            <div className="workspace-placeholder">
              <>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                <p>Upload an IFC file to start exploring your model</p>
              </>
            </div>
          ) : (
            <div className="workspace-viewer">
              {geometryLoading ? (
                <div className="workspace-placeholder">
                  <Spinner />
                  <p>Building 3D geometry…</p>
                </div>
              ) : modelGeometry.length > 0 ? (
                <ModelViewer3D
                  elements={modelGeometry}
                  selectedGuid={selectedGuid}
                  onSelect={handleSelect}
                />
              ) : (
                <div className="workspace-placeholder">
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                  <p>No renderable 3D geometry found in this model.</p>
                </div>
              )}
            </div>
          )}
          {!isLoaded && (
            <div className="workspace-status-note">
              <>
                <p>
                  3D viewer will be available after IFC load.
                </p>
              </>
            </div>
          )}
        </section>

        {/* ── RIGHT INSPECTOR PANEL ── */}
        <aside className="content-panel">
          {/* Tab bar */}
          <div className="tab-bar">
            <button
              className={`tab-btn ${activeTab === 'properties' ? 'tab-btn--active' : ''}`}
              onClick={() => setActiveTab('properties')}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
              Properties
            </button>
            <button
              className={`tab-btn ${activeTab === 'takeoff' ? 'tab-btn--active' : ''}`}
              onClick={() => setActiveTab('takeoff')}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                <path fillRule="evenodd" d="M5 4a3 3 0 00-3 3v6a3 3 0 003 3h10a3 3 0 003-3V7a3 3 0 00-3-3H5zm-1 9v-1h5v2H5a1 1 0 01-1-1zm7 1h4a1 1 0 001-1v-1h-5v2zm0-4h5V8h-5v2zM9 8H4v2h5V8z" clipRule="evenodd" />
              </svg>
              Quantity Takeoff
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'properties' && (
              <PropertiesPanel
                properties={properties}
                selectedGuid={selectedGuid}
                onUpdateProperty={handlePropertyUpdate}
              />
            )}
            {activeTab === 'takeoff' && (
              <TakeoffPanel pyodide={pyodide} engineStatus={engineStatus} />
            )}
          </div>
        </aside>
      </div>

      {/* ── Drop overlay hint ── */}
      {engineStatus === 'ready' && (
        <div className="drop-hint">Drop an IFC file anywhere to load it</div>
      )}

      {/* ── Global Error ── */}
      {errorMsg && (
        <div className="global-error">
          <strong>⚠ Error:</strong> {errorMsg}
          <button onClick={() => setErrorMsg(null)}>✕</button>
        </div>
      )}
    </div>
  )
}

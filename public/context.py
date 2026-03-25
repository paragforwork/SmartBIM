"""
context.py — Smart BIM Dashboard Python Engine
Runs inside Pyodide + IfcOpenShell (WASM).
All public functions store their output in the global `_result` string.
JavaScript reads it via: pyodide.globals.get("_result")
"""

import json
import ifcopenshell

# ifc_util is imported lazily inside functions to avoid
# top-level failures from transitive optional dependencies

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------
_ifc_model = None
_result = ""


# ---------------------------------------------------------------------------
# 1. Load IFC from raw bytes
# ---------------------------------------------------------------------------
def load_ifc(file_bytes: bytes) -> str:
    """Write bytes to Pyodide VFS and open with ifcopenshell."""
    global _ifc_model, _result

    tmp_path = "/tmp/model.ifc"
    with open(tmp_path, "wb") as f:
        f.write(file_bytes)

    _ifc_model = ifcopenshell.open(tmp_path)
    schema = _ifc_model.schema
    projects = _ifc_model.by_type("IfcProject")
    project_name = projects[0].Name if projects else "Unknown Project"

    summary = {
        "status": "ok",
        "project": project_name,
        "schema": schema,
        "element_count": len(list(_ifc_model)),
    }
    _result = json.dumps(summary)
    return _result


# ---------------------------------------------------------------------------
# 2. Spatial Hierarchy Tree
# ---------------------------------------------------------------------------
def _get_related_elements(storey):
    """Return all physical elements assigned to a storey via IfcRelContainedInSpatialStructure."""
    elements = []
    for rel in getattr(storey, "ContainsElements", []) or []:
        for elem in rel.RelatedElements:
            elements.append({
                "id": elem.id(),
                "guid": elem.GlobalId,
                "type": elem.is_a(),
                "name": getattr(elem, "Name", None) or f"{elem.is_a()} #{elem.id()}",
            })
    return elements


def get_spatial_tree() -> str:
    """Crawl IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey → elements."""
    global _ifc_model, _result

    if _ifc_model is None:
        _result = json.dumps({"error": "No model loaded"})
        return _result

    tree = []
    for project in _ifc_model.by_type("IfcProject"):
        proj_node = {
            "id": project.id(),
            "guid": project.GlobalId,
            "type": "IfcProject",
            "name": getattr(project, "Name", None) or "Project",
            "children": []
        }

        for rel in getattr(project, "IsDecomposedBy", []) or []:
            for site in rel.RelatedObjects:
                if not site.is_a("IfcSite"):
                    continue
                site_node = {
                    "id": site.id(),
                    "guid": site.GlobalId,
                    "type": "IfcSite",
                    "name": getattr(site, "Name", None) or "Site",
                    "children": []
                }

                for rel2 in getattr(site, "IsDecomposedBy", []) or []:
                    for building in rel2.RelatedObjects:
                        if not building.is_a("IfcBuilding"):
                            continue
                        bld_node = {
                            "id": building.id(),
                            "guid": building.GlobalId,
                            "type": "IfcBuilding",
                            "name": getattr(building, "Name", None) or "Building",
                            "children": []
                        }

                        for rel3 in getattr(building, "IsDecomposedBy", []) or []:
                            for storey in rel3.RelatedObjects:
                                if not storey.is_a("IfcBuildingStorey"):
                                    continue
                                storey_node = {
                                    "id": storey.id(),
                                    "guid": storey.GlobalId,
                                    "type": "IfcBuildingStorey",
                                    "name": getattr(storey, "Name", None) or "Storey",
                                    "children": _get_related_elements(storey)
                                }
                                bld_node["children"].append(storey_node)

                        site_node["children"].append(bld_node)
                proj_node["children"].append(site_node)
        tree.append(proj_node)

    _result = json.dumps(tree)
    return _result


# ---------------------------------------------------------------------------
# 3. Property Sets for a single element
# ---------------------------------------------------------------------------
def get_element_properties(guid: str) -> str:
    """Return all Psets for the element identified by GUID."""
    global _ifc_model, _result

    if _ifc_model is None:
        _result = json.dumps({"error": "No model loaded"})
        return _result

    try:
        element = _ifc_model.by_guid(guid)
    except Exception:
        _result = json.dumps({"error": f"Element with GUID {guid} not found"})
        return _result

    import ifcopenshell.util.element as ifc_util
    psets = ifc_util.get_psets(element)

    # Flatten nested pset dicts; convert non-serialisable values to str
    clean = {}
    for pset_name, props in psets.items():
        if isinstance(props, dict):
            clean[pset_name] = {k: (str(v) if not isinstance(v, (str, int, float, bool, type(None))) else v)
                                for k, v in props.items()}
        else:
            clean[pset_name] = str(props)

    meta = {
        "guid": guid,
        "type": element.is_a(),
        "name": getattr(element, "Name", None) or element.is_a(),
        "psets": clean
    }
    _result = json.dumps(meta)
    return _result


# ---------------------------------------------------------------------------
# 4. Quantity Takeoff by IFC class
# ---------------------------------------------------------------------------
def get_quantities_by_type(ifc_class: str) -> str:
    """Aggregate BaseQuantities for all elements of the given IFC class."""
    global _ifc_model, _result

    if _ifc_model is None:
        _result = json.dumps({"error": "No model loaded"})
        return _result

    rows = []
    try:
        elements = _ifc_model.by_type(ifc_class)
    except Exception as e:
        _result = json.dumps({"error": str(e)})
        return _result

    for elem in elements:
        row = {
            "guid": elem.GlobalId,
            "name": getattr(elem, "Name", None) or f"{ifc_class} #{elem.id()}",
            "type": elem.is_a(),
            "NetVolume": None,
            "NetArea": None,
            "GrossArea": None,
            "Length": None,
            "Width": None,
            "Height": None,
        }

        import ifcopenshell.util.element as ifc_util
        psets = ifc_util.get_psets(elem, qtos_only=True)
        for pset_name, props in psets.items():
            if isinstance(props, dict):
                for key, val in props.items():
                    normalized = key.strip()
                    if normalized in row and isinstance(val, (int, float)):
                        row[normalized] = round(val, 4)

        rows.append(row)

    _result = json.dumps(rows)
    return _result


# ---------------------------------------------------------------------------
# 5. Update element property value
# ---------------------------------------------------------------------------
def _coerce_input_value(raw_value: str):
    """Parse common scalar formats while preserving plain strings."""
    if raw_value is None:
        return None

    text = str(raw_value).strip()
    lowered = text.lower()

    if lowered in {"", "null", "none"}:
        return None
    if lowered == "true":
        return True
    if lowered == "false":
        return False

    try:
        if "." in text:
            return float(text)
        return int(text)
    except ValueError:
        return text


def _find_property_set(element, pset_name: str):
    """Find IfcPropertySet or IfcElementQuantity by name on an element."""
    for rel in getattr(element, "IsDefinedBy", []) or []:
        if not rel.is_a("IfcRelDefinesByProperties"):
            continue
        definition = rel.RelatingPropertyDefinition
        if not definition:
            continue
        definition_name = getattr(definition, "Name", None)
        if definition_name == pset_name and (definition.is_a("IfcPropertySet") or definition.is_a("IfcElementQuantity")):
            return definition
    return None


def _update_quantity_value(quantity_set, prop_name: str, parsed_value):
    """Update an IfcPhysicalSimpleQuantity value by name."""
    for quantity in getattr(quantity_set, "Quantities", []) or []:
        if getattr(quantity, "Name", None) != prop_name:
            continue

        candidate_attrs = [a for a in dir(quantity) if a.endswith("Value")]
        for attr in candidate_attrs:
            if attr in {"Formula", "Unit"}:
                continue
            try:
                setattr(quantity, attr, parsed_value)
                return {"status": "ok", "message": f"Updated quantity {prop_name}"}
            except Exception:
                continue
        raise ValueError(f"Quantity '{prop_name}' has no writable value attribute")

    raise ValueError(f"Property '{prop_name}' not found in quantity set '{quantity_set.Name}'")


def update_element_property(guid: str, pset_name: str, prop_name: str, new_value: str) -> str:
    """Update a property value on an element and return operation status."""
    global _ifc_model, _result

    if _ifc_model is None:
        _result = json.dumps({"error": "No model loaded"})
        return _result

    if not guid or not pset_name or not prop_name:
        _result = json.dumps({"error": "guid, pset_name and prop_name are required"})
        return _result

    try:
        element = _ifc_model.by_guid(guid)
    except Exception:
        _result = json.dumps({"error": f"Element with GUID {guid} not found"})
        return _result

    parsed_value = _coerce_input_value(new_value)

    try:
        definition = _find_property_set(element, pset_name)

        if definition and definition.is_a("IfcElementQuantity"):
            op = _update_quantity_value(definition, prop_name, parsed_value)
        else:
            import ifcopenshell.api

            # Create property set if missing so users can author new values.
            if definition is None:
                definition = ifcopenshell.api.run(
                    "pset.add_pset",
                    _ifc_model,
                    product=element,
                    name=pset_name,
                )

            if not definition or not definition.is_a("IfcPropertySet"):
                raise ValueError(f"'{pset_name}' is not an editable property set")

            ifcopenshell.api.run(
                "pset.edit_pset",
                _ifc_model,
                pset=definition,
                properties={prop_name: parsed_value},
            )
            op = {"status": "ok", "message": f"Updated property {prop_name}"}

        _result = json.dumps({
            "status": "ok",
            "guid": guid,
            "pset_name": pset_name,
            "prop_name": prop_name,
            "value": parsed_value,
            "message": op["message"],
        })
        return _result
    except Exception as e:
        _result = json.dumps({"error": str(e)})
        return _result


# ---------------------------------------------------------------------------
# 6. Export updated IFC model as text
# ---------------------------------------------------------------------------
def export_ifc_text() -> str:
    """Serialize current IFC model and return full IFC text."""
    global _ifc_model, _result

    if _ifc_model is None:
        _result = json.dumps({"error": "No model loaded"})
        return _result

    try:
        out_path = "/tmp/updated_model.ifc"
        _ifc_model.write(out_path)
        with open(out_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
        _result = json.dumps({"status": "ok", "ifc_text": text})
        return _result
    except Exception as e:
        _result = json.dumps({"error": str(e)})
        return _result


# ---------------------------------------------------------------------------
# 7. Search / Filter elements
# ---------------------------------------------------------------------------
def search_elements(query: str) -> str:
    """
    Parse query and return matching elements.
    Supports:
      - Class filter:   "IfcWall"
      - Property compare: "Width > 900", "FireRating == 2HR"
    """
    global _ifc_model, _result

    if _ifc_model is None:
        _result = json.dumps({"error": "No model loaded"})
        return _result

    query = query.strip()
    results = []

    # ---- Comparison query: "Prop OP value" --------------------------------
    import re
    cmp_match = re.match(r'^(\w+)\s*(>=|<=|!=|>|<|==)\s*(.+)$', query)
    if cmp_match:
        prop_name, operator, raw_value = cmp_match.groups()
        raw_value = raw_value.strip()
        try:
            num_value = float(raw_value)
            is_numeric = True
        except ValueError:
            is_numeric = False

        for elem in _ifc_model:
            if not hasattr(elem, "GlobalId"):
                continue
            import ifcopenshell.util.element as ifc_util
            psets = ifc_util.get_psets(elem)
            for pset_props in psets.values():
                if not isinstance(pset_props, dict):
                    continue
                for k, v in pset_props.items():
                    if k.strip().lower() == prop_name.lower():
                        try:
                            ev = float(v) if is_numeric else str(v).strip()
                            cv = num_value if is_numeric else raw_value.strip('"\'')
                            match = False
                            if operator == ">":  match = ev > cv
                            elif operator == "<":  match = ev < cv
                            elif operator == ">=": match = ev >= cv
                            elif operator == "<=": match = ev <= cv
                            elif operator == "==": match = ev == cv
                            elif operator == "!=": match = ev != cv
                            if match:
                                results.append({
                                    "guid": elem.GlobalId,
                                    "type": elem.is_a(),
                                    "name": getattr(elem, "Name", None) or elem.is_a(),
                                    "matched_prop": k,
                                    "matched_value": v,
                                })
                        except Exception:
                            pass

    # ---- Class name filter: "IfcDoor" -------------------------------------
    else:
        try:
            elements = _ifc_model.by_type(query)
        except Exception:
            # Partial name match fallback
            elements = [e for e in _ifc_model
                        if hasattr(e, "GlobalId") and query.lower() in e.is_a().lower()]

        for elem in elements:
            results.append({
                "guid": elem.GlobalId,
                "type": elem.is_a(),
                "name": getattr(elem, "Name", None) or elem.is_a(),
            })

    _result = json.dumps(results)
    return _result


# Signal to JS that module is loaded
_result = json.dumps({"status": "engine_ready"})

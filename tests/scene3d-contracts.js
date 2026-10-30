// Chạy trong browser: import("/tests/scene3d-contracts.js").then(m => m.runScene3DContracts())

const waitTask = () => new Promise(resolve => setTimeout(resolve, 0));
const waitEvent = (target, type, timeoutMs = 1200) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
  target.addEventListener(type, event => {
    clearTimeout(timer);
    resolve(event);
  }, { once: true });
});

export async function runScene3DContracts() {
  const { mountScene } = await import(`../src/scene3d.js?scene3d-contracts=${Date.now()}`);
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  const sceneSource = await fetch(new URL("../src/scene3d.js", import.meta.url)).then(response => response.text());
  const inspectionStart = sceneSource.indexOf("function setInspectedTerminal");
  const inspectionEnd = sceneSource.indexOf("function setLabLayout", inspectionStart);
  const inspectionSource = inspectionStart >= 0 && inspectionEnd > inspectionStart
    ? sceneSource.slice(inspectionStart, inspectionEnd)
    : "";
  check("inspection-source-validates-read-only-layout",
    /setInspectedTerminal\(terminalId,layout=null\)/.test(inspectionSource) &&
    /validateLabLayout\(layout,layout\?\.terminals\)/.test(inspectionSource) &&
    /layout\.terminals\.some/.test(inspectionSource));
  check("inspection-source-does-not-mount-or-position-read-only-layout",
    !/setLabLayout\(/.test(inspectionSource) &&
    !/labTerminalAnchor\(/.test(inspectionSource) &&
    /read-only-label/.test(inspectionSource) &&
    /lab-halo/.test(inspectionSource));

  const pendingStart = sceneSource.indexOf("function setPendingWireTerminal");
  const pendingEnd = sceneSource.indexOf("function setHighlightedLabWire", pendingStart);
  const pendingSource = pendingStart >= 0 && pendingEnd > pendingStart
    ? sceneSource.slice(pendingStart, pendingEnd)
    : "";
  check("pending-wire-source-requires-mounted-edit-layout",
    /setPendingWireTerminal\(terminalId\)/.test(pendingSource) &&
    /!labEdit\.enabled\|\|!activeLabLayout/.test(pendingSource) &&
    /labTerminals\.has\(terminalId\)/.test(pendingSource) &&
    /terminalId\.length>80/.test(pendingSource));
  check("pending-wire-source-is-visual-only",
    /first-terminal-preview/.test(pendingSource) &&
    !/onTerminalSelect|onMoveComponent|refreshLabWireLayer|labWireObjects\.push|setWiring\(/.test(pendingSource));
  const highlightedWireStart = sceneSource.indexOf("function setHighlightedLabWire");
  const highlightedWireEnd = sceneSource.indexOf("function setLabLayout", highlightedWireStart);
  const highlightedWireSource = highlightedWireStart >= 0 && highlightedWireEnd > highlightedWireStart
    ? sceneSource.slice(highlightedWireStart, highlightedWireEnd)
    : "";
  check("highlighted-wire-source-is-strict-canonical-membership",
    /setHighlightedLabWire\(wireId\)/.test(highlightedWireSource) &&
    /wireId\.trim\(\)!==wireId/.test(highlightedWireSource) &&
    /wireId\.length>LAB_WIRE_ID_MAX/.test(highlightedWireSource) &&
    /lastWiringModel\.wires\.some/.test(highlightedWireSource) &&
    /labWireObjects\.some/.test(highlightedWireSource));
  check("highlighted-wire-source-is-visual-only",
    /committed-wire-highlight/.test(highlightedWireSource) &&
    /refreshLabWireHighlight\(\)/.test(highlightedWireSource) &&
    !/setWiring\(|onTerminalSelect|onMoveComponent|selectLabComponent|focusLabComponent|theta=|phi=|zoom=/.test(highlightedWireSource));
  check("highlighted-wire-identity-includes-unordered-endpoints",
    /function sameCommittedWireIdentity\(left,right\)/.test(sceneSource) &&
    /left\.id!==right\.id/.test(sceneSource) &&
    /left\.from===right\.from&&left\.to===right\.to/.test(sceneSource) &&
    /left\.from===right\.to&&left\.to===right\.from/.test(sceneSource));
  const setWiringStart = sceneSource.indexOf("function setWiring");
  const updateStart = sceneSource.indexOf("function update(snapshot)", setWiringStart);
  const setWiringSource = sceneSource.slice(setWiringStart, updateStart);
  check("set-wiring-clears-highlight-on-same-id-different-endpoints",
    /previousHighlightedWire/.test(setWiringSource) &&
    /replacement=model\.wires\.find/.test(setWiringSource) &&
    /!sameCommittedWireIdentity\(previousHighlightedWire,replacement\)/.test(setWiringSource));
  const setLabLayoutStart = sceneSource.indexOf("function setLabLayout");
  const setLabEditStart = sceneSource.indexOf("function validateLabEditCallback", setLabLayoutStart);
  const setLabLayoutSource = sceneSource.slice(setLabLayoutStart, setLabEditStart);
  check("same-lesson-layout-rebuild-preserves-wire-highlight-state",
    /clearLabLayout\(false,true,true\)/.test(setLabLayoutSource) &&
    /refreshLabWireLayer\(true\)/.test(setLabLayoutSource));
  check("same-lesson-layout-rebuild-preserves-wire-geometry-revision",
    /function clearLabWireLayer\(clearHighlight=true,preserveRevision=false\)/.test(sceneSource) &&
    /if\(!preserveRevision\)labWireGeometryRevision=0/.test(sceneSource) &&
    /function clearLabLayout\(redraw=true,preserveWireHighlight=false,preserveWireRevision=false\)/.test(sceneSource) &&
    /canvas\.dataset\.labWireGeometryRevision=String\(labWireGeometryRevision\)/.test(sceneSource));
  const committedRouteStart = sceneSource.indexOf("function updateLabWireGeometry");
  const committedRouteEnd = sceneSource.indexOf("function refreshLabWireLayer", committedRouteStart);
  const committedRouteSource = sceneSource.slice(committedRouteStart, committedRouteEnd);
  check("committed-wire-route-is-elevated-multisegment",
    /LAB_COMMITTED_WIRE_ROUTE_POINTS/.test(committedRouteSource) &&
    /from\.getWorldPosition\(start\);to\.getWorldPosition\(end\)/.test(committedRouteSource) &&
    /const points=\[\s*start,[\s\S]*end,\s*\]/.test(committedRouteSource) &&
    /laneY/.test(committedRouteSource) &&
    /midX/.test(committedRouteSource) &&
    /position\.setXYZ\(pointIndex/.test(committedRouteSource));
  const transformStart = sceneSource.indexOf("function setLabVisualTransform");
  const transformEnd = sceneSource.indexOf("function restoreLabComponent", transformStart);
  const transformSource = sceneSource.slice(transformStart, transformEnd);
  const lodStart = sceneSource.indexOf("function applySceneLod");
  const lodEnd = sceneSource.indexOf("function resize", lodStart);
  const lodSource = sceneSource.slice(lodStart, lodEnd);
  check("committed-wire-route-recomputes-on-transform-and-lod",
    /updateLabWireGeometry\(\)/.test(transformSource) &&
    /updateLabWireGeometry\(\)/.test(lodSource));
  const ghostStart = sceneSource.indexOf("function ensurePendingWirePreviewLine");
  const ghostEnd = sceneSource.indexOf("function refreshLabInteractionFeedback", ghostStart);
  const ghostSource = ghostStart >= 0 && ghostEnd > ghostStart
    ? sceneSource.slice(ghostStart, ghostEnd)
    : "";
  check("pending-wire-ghost-is-uncommitted-canonical-hover-only",
    /kind:"lab-pending-wire-preview",committed:false/.test(ghostSource) &&
    !/labWireObjects\.push|onTerminalSelect|setWiring\(/.test(ghostSource) &&
    /targetId===pendingWireTerminalId/.test(sceneSource) &&
    /!labTerminals\.has\(targetId\)/.test(sceneSource) &&
    /labPendingWirePreview="ghost"/.test(sceneSource) &&
    /clearPendingWireHover\(true\);finishPointer\(event,false\)/.test(sceneSource));
  const editOptionStart = sceneSource.indexOf("function validateLabEditCallback");
  const editOptionEnd = sceneSource.indexOf("function clampLabTarget", editOptionStart);
  const editOptionSource = sceneSource.slice(editOptionStart, editOptionEnd);
  check("terminal-drag-callback-options-are-validated-and-preserved",
    /validateLabEditCallback\(options\.onTerminalDragStart,"onTerminalDragStart"\)/.test(editOptionSource) &&
    /onTerminalDragStart:options\.onTerminalDragStart===undefined/.test(editOptionSource) &&
    /\? labEdit\.onTerminalDragStart : options\.onTerminalDragStart/.test(editOptionSource) &&
    /validateLabEditCallback\(options\.onTerminalLink,"onTerminalLink"\)/.test(editOptionSource) &&
    /onTerminalLink:options\.onTerminalLink===undefined/.test(editOptionSource) &&
    /\? labEdit\.onTerminalLink : options\.onTerminalLink/.test(editOptionSource));
  const directDragStart = sceneSource.indexOf("function isActiveTerminalDragId");
  const directDragEnd = sceneSource.indexOf("function restorePointerSelection", directDragStart);
  const directDragSource = sceneSource.slice(directDragStart, directDragEnd);
  check("terminal-link-drag-validates-current-layout-canonical-distinct-endpoints",
    /typeof labEdit\.onTerminalLink==="function"&&isActiveTerminalDragId/.test(directDragSource) &&
    /layoutRef!==activeLabLayout/.test(directDragSource) &&
    /Object\.prototype\.hasOwnProperty\.call\(terminalMap,terminalId\)/.test(directDragSource) &&
    /canonical\?\.terminalId===terminalId&&labTerminals\.has\(terminalId\)/.test(directDragSource) &&
    /targetId===sourceId/.test(directDragSource) &&
    /isActiveTerminalLinkId\(targetId,layoutRef\)/.test(directDragSource));
  const pointerMoveStart = sceneSource.indexOf("function move(event)");
  const pointerMoveEnd = sceneSource.indexOf("function finishPointer", pointerMoveStart);
  const pointerMoveSource = sceneSource.slice(pointerMoveStart, pointerMoveEnd);
  check("terminal-drag-start-callback-fires-on-threshold-once-with-canonical-frozen-meta",
    /pointerState\.dragStartEmitted/.test(directDragSource) &&
    /pointerState\.dragStartEmitted=true/.test(directDragSource) &&
    /typeof labEdit\.onTerminalDragStart!=="function"/.test(directDragSource) &&
    /isActiveTerminalDragId\(pointerState\.terminalId,pointerState\.layoutRef\)/.test(directDragSource) &&
    /labEdit\.onTerminalDragStart\(/.test(directDragSource) &&
    /Object\.freeze\(\{source:"pointer-drag",physicalVerified:false\}\)/.test(directDragSource) &&
    /const crossedTapThreshold=!moved&&Math\.hypot\(totalDx,totalDy\)>drag\.tapThreshold/.test(pointerMoveSource) &&
    /if\(crossedTapThreshold\)emitTerminalDragStart\(drag\)/.test(pointerMoveSource) &&
    !/setWiring\(|connectCircuit\(|disconnectCircuit\(|labWireObjects\.push/.test(directDragSource));
  check("terminal-link-drag-preview-is-transient-rendering-only",
    /labTerminalDragPreview="ghost"/.test(directDragSource) &&
    /updateWirePreviewGeometry\(sourceId,targetId\)/.test(directDragSource) &&
    !/setWiring\(|connectCircuit\(|labWireObjects\.push|lastWiringModel\s*=/.test(directDragSource));
  const finishPointerStart = sceneSource.indexOf("function finishPointer");
  const finishPointerEnd = sceneSource.indexOf("const up=", finishPointerStart);
  const finishPointerSource = sceneSource.slice(finishPointerStart, finishPointerEnd);
  check("terminal-link-drop-delegates-exact-callback-on-drag-only",
    /drag\.kind==="terminal"&&select&&moved/.test(finishPointerSource) &&
    /labEdit\.onTerminalLink\?\.\(/.test(finishPointerSource) &&
    /Object\.freeze\(\{source:"pointer-drag",physicalVerified:false\}\)/.test(finishPointerSource) &&
    /if\(select&&!moved\)/.test(finishPointerSource) &&
    /labEdit\.onTerminalSelect/.test(finishPointerSource) &&
    !/setWiring\(|connectCircuit\(|disconnectCircuit\(/.test(finishPointerSource));
  check("committed-wire-inspect-callback-option-is-validated-and-preserved",
    /validateLabEditCallback\(options\.onCommittedWireInspect,"onCommittedWireInspect"\)/.test(editOptionSource) &&
    /onCommittedWireInspect:options\.onCommittedWireInspect===undefined/.test(editOptionSource) &&
    /\? labEdit\.onCommittedWireInspect : options\.onCommittedWireInspect/.test(editOptionSource));
  const committedInspectStart = sceneSource.indexOf("function inspectableCommittedWireId");
  const committedInspectEnd = sceneSource.indexOf("function updatePendingWireHover", committedInspectStart);
  const committedInspectSource = sceneSource.slice(committedInspectStart, committedInspectEnd);
  const pointerDownStart = sceneSource.indexOf("function down(event)");
  const pointerDownEnd = sceneSource.indexOf("function move(event)", pointerDownStart);
  const pointerDownSource = sceneSource.slice(pointerDownStart, pointerDownEnd);
  check("committed-wire-inspect-source-raycasts-only-current-rendered-committed-lines",
    /LAB_COMMITTED_WIRE_PICK_THRESHOLD = Math\.min\(\.20,Math\.max\(\.08,\.16\)\)/.test(sceneSource) &&
    /committedWireRaycaster\.params\.Line\.threshold=LAB_COMMITTED_WIRE_PICK_THRESHOLD/.test(sceneSource) &&
    /committedLines=labWireObjects\.map\(item=>item\.line\)/.test(committedInspectSource) &&
    /committedWireRaycaster\.intersectObjects\(committedLines,false\)/.test(committedInspectSource) &&
    !/pendingWirePreviewLine|authoredPairGuideDashLine|authoredPairGuideBackdropLine/.test(committedInspectSource));
  check("committed-wire-inspect-source-revalidates-id-unordered-endpoints-and-layout",
    /wireId\.trim\(\)===wireId/.test(committedInspectSource) &&
    /\["__proto__","prototype","constructor"\]\.includes\(wireId\)/.test(committedInspectSource) &&
    /function sameRenderedCommittedWireIdentity\(rendered,canonical\)/.test(committedInspectSource) &&
    /id:rendered\.wireId/.test(committedInspectSource) &&
    /layoutRef!==activeLabLayout/.test(committedInspectSource) &&
    /lastWiringModel\?\.wires\?\.find\(wire=>wire\.id===rendered\.wireId\)/.test(committedInspectSource) &&
    /sameRenderedCommittedWireIdentity\(rendered,canonical\)/.test(committedInspectSource) &&
    /hasOwnProperty\.call\(terminalMap,terminalId\)/.test(committedInspectSource) &&
    /labTerminals\.has\(terminalId\)/.test(committedInspectSource));
  check("committed-wire-inspect-source-preserves-mode-off-component-priority-and-camera-drag",
    pointerDownSource.indexOf('kind==="lab-terminal"') >= 0 &&
    /if\(breadboardHoleStudyActive\(\)\)[\s\S]*wireHit=committedWireHit/.test(pointerDownSource) &&
    pointerDownSource.indexOf('kind==="lab-component-hit"') >
      pointerDownSource.indexOf("const holeHit=breadboardHoleStudyHit") &&
    pointerDownSource.indexOf("wireHit=wireHit||committedWireHit") >
      pointerDownSource.indexOf('kind==="lab-component-hit"') &&
    /drag\.kind==="camera"\|\|drag\.kind==="committed-wire"/.test(pointerMoveSource));
  check("committed-wire-inspect-source-tap-only-visual-highlight-and-frozen-callback",
    /finished\.kind==="committed-wire"/.test(finishPointerSource) &&
    /if\(select&&!moved\)/.test(finishPointerSource) &&
    /sameCommittedWireIdentity\(finished\.wireIdentity,releaseHit\.canonical\)/.test(finishPointerSource) &&
    /setHighlightedLabWire\(releaseHit\.canonical\.id\)/.test(finishPointerSource) &&
    /labEdit\.onCommittedWireInspect\?\.\(/.test(finishPointerSource) &&
    /Object\.freeze\(\{source:"pointer",physicalVerified:false\}\)/.test(finishPointerSource) &&
    !/setWiring\(|connectCircuit\(|disconnectCircuit\(/.test(finishPointerSource));
  check("committed-wire-inspect-source-cancels-with-edit-layout-and-context-lifecycle",
    /cancelCommittedWireInspectPointer\(false\)/.test(editOptionSource) &&
    /function clearLabLayout[\s\S]*cancelCommittedWireInspectPointer\(false\)/.test(sceneSource) &&
    /const onContextLost=event=>\{[\s\S]*if\(drag\)\{try\{canvas\.releasePointerCapture/.test(sceneSource) &&
    /const onContextLost=event=>\{[\s\S]*drag=null/.test(sceneSource));
  const breadboardStudyMapStart = sceneSource.indexOf("function breadboardStudyHoleIndex");
  const breadboardStudyMapEnd = sceneSource.indexOf("function unrotateLabVector", breadboardStudyMapStart);
  const breadboardStudyMapSource = sceneSource.slice(breadboardStudyMapStart, breadboardStudyMapEnd);
  const breadboardStudyStateStart = sceneSource.indexOf("function breadboardHoleStudyStatus");
  const breadboardStudyStateEnd = sceneSource.indexOf("function refreshLabInteractionFeedback", breadboardStudyStateStart);
  const breadboardStudySource = sceneSource.slice(breadboardStudyStateStart, breadboardStudyStateEnd);
  check("breadboard-hole-study-source-has-deterministic-630-row-major-canonical-identity",
    /BREADBOARD_STUDY_ROWS = Object\.freeze\("ABCDEFGHIJ"\.split\(""\)\)/.test(sceneSource) &&
    /BREADBOARD_STUDY_COLUMNS = 63/.test(sceneSource) &&
    /BREADBOARD_STUDY_HOLE_COUNT = BREADBOARD_STUDY_ROWS\.length \* BREADBOARD_STUDY_COLUMNS/.test(sceneSource) &&
    /\^\(\[A-J\]\)\(\[1-9\]\|\[1-5\]\[0-9\]\|6\[0-3\]\)\$/.test(breadboardStudyMapSource) &&
    /rowIndex\*BREADBOARD_STUDY_COLUMNS\+\(Number\(match\[2\]\)-1\)/.test(breadboardStudyMapSource) &&
    /BREADBOARD_STUDY_ROWS\[rowIndex\]\+String\(column\)/.test(breadboardStudyMapSource));
  check("breadboard-hole-study-source-is-single-instanced-conceptual-overlay-with-no-rail-authority",
    /new T\.InstancedMesh\([\s\S]*BREADBOARD_STUDY_HOLE_COUNT/.test(breadboardStudySource) &&
    /visualInstanceCount:BREADBOARD_STUDY_HOLE_COUNT/.test(breadboardStudySource) &&
    /identityModel:"row-major-A1-through-J63"/.test(breadboardStudySource) &&
    /new T\.RingGeometry\(/.test(breadboardStudySource) &&
    /kind:"lab-breadboard-hole-study-selection"/.test(breadboardStudySource) &&
    /conceptualStudy:true,railInference:false,breadboardHoleMapping:false/.test(breadboardStudySource) &&
    /electricalAuthority:false,physicalLocation:false,physicalVerified:false/.test(breadboardStudySource) &&
    !/setWiring\(|connectCircuit\(|disconnectCircuit\(|lastWiringModel\s*=|labWireObjects\.push/.test(breadboardStudySource));
  check("breadboard-hole-study-source-api-disabled-path-is-harmless-and-status-truthful",
    /function setBreadboardHoleStudy\(options=\{\}\)/.test(breadboardStudySource) &&
    /if\(options\.enabled!==true\)\{\s*return resetBreadboardHoleStudy\(true\);\s*\}/.test(breadboardStudySource) &&
    /holeCount:BREADBOARD_STUDY_HOLE_COUNT/.test(breadboardStudySource) &&
    /mode:active\?"conceptual-strip-study":"none"/.test(breadboardStudySource) &&
    /physicalVerified:false/.test(breadboardStudySource));
  check("breadboard-hole-study-source-validates-profile-and-selected-canonical-hole",
    /profileId\.trim\(\)!==profileId/.test(breadboardStudySource) &&
    /BREADBOARD_STUDY_PROFILE_ID_MAX/.test(breadboardStudySource) &&
    /\["__proto__","prototype","constructor"\]\.includes\(profileId\)/.test(breadboardStudySource) &&
    /selectedHoleId breadboard hole study phải là canonical A1\.\.J63/.test(breadboardStudySource) &&
    /profileChanged\?null:breadboardHoleStudy\.selectedHoleId/.test(breadboardStudySource));
  check("breadboard-hole-study-source-requires-explicit-mode-edit-layout-visible-breadboard",
    /breadboardHoleStudy\.enabled===true&&labEdit\.enabled===true/.test(breadboardStudySource) &&
    /activeBreadboardStudyEntry\(\)!==null/.test(breadboardStudySource) &&
    /entry\?\.component\?\.visualKind!=="breadboard"/.test(breadboardStudySource) &&
    /entry\.root\?\.visible===false/.test(breadboardStudySource));
  check("breadboard-hole-study-source-pointer-priority-and-tap-camera-boundary",
    pointerDownSource.indexOf('kind==="lab-terminal"') >= 0 &&
    pointerDownSource.indexOf("wireHit=committedWireHit") >
      pointerDownSource.indexOf('kind==="lab-terminal"') &&
    pointerDownSource.indexOf("const holeHit=breadboardHoleStudyHit") >
      pointerDownSource.indexOf("wireHit=committedWireHit") &&
    pointerDownSource.indexOf('kind==="lab-component-hit"') >
      pointerDownSource.indexOf("const holeHit=breadboardHoleStudyHit") &&
    /drag\.kind==="breadboard-hole-study"/.test(pointerMoveSource) &&
    /drag\.kind==="camera"\|\|drag\.kind==="committed-wire"[\s\S]*drag\.kind==="breadboard-hole-study"/.test(pointerMoveSource));
  check("breadboard-hole-study-source-pointer-revalidates-and-callback-meta-remains-exact",
    /finished\.kind==="breadboard-hole-study"/.test(finishPointerSource) &&
    /finished\.layoutRef===activeLabLayout/.test(finishPointerSource) &&
    /finished\.lessonId===Number\(currentLessonId\)/.test(finishPointerSource) &&
    /releaseHit\.holeId===finished\.holeId/.test(finishPointerSource) &&
    /releaseHit\.instanceId===finished\.instanceId/.test(finishPointerSource) &&
    /Object\.freeze\(\{source:"pointer",physicalVerified:false\}\)/.test(finishPointerSource) &&
    /accepted\?\.accepted===true\?accepted\.selection:null/.test(finishPointerSource) &&
    /selection\.profileId===finished\.profileId/.test(finishPointerSource) &&
    /selection\.holeId===finished\.holeId/.test(finishPointerSource));
  check("breadboard-hole-study-source-fail-closed-lifecycle-and-public-api",
    /function clearLabLayout[\s\S]*resetBreadboardHoleStudy\(false\)/.test(sceneSource) &&
    /const onContextLost=event=>\{[\s\S]*resetBreadboardHoleStudy\(false\)/.test(sceneSource) &&
    /canvas\.removeEventListener\("webglcontextrestored"[\s\S]*resetBreadboardHoleStudy\(false\)/.test(sceneSource) &&
    /setBreadboardHoleStudy/.test(sceneSource.slice(sceneSource.indexOf("return {setLesson"))));
  const authoredGuideStart = sceneSource.indexOf("function authoredGuideResult");
  const authoredGuideEnd = sceneSource.indexOf("function refreshLabInteractionFeedback", authoredGuideStart);
  const authoredGuideSource = sceneSource.slice(authoredGuideStart, authoredGuideEnd);
  check("authored-pair-guide-source-validates-exact-own-canonical-pair",
    /function setAuthoredPairGuide\(pair\)/.test(authoredGuideSource) &&
    /Reflect\.ownKeys\(pair\)/.test(authoredGuideSource) &&
    /ownKeys\.length!==2/.test(authoredGuideSource) &&
    /hasOwnProperty\.call\(pair,"from"\)/.test(authoredGuideSource) &&
    /hasOwnProperty\.call\(pair,"to"\)/.test(authoredGuideSource) &&
    /hasOwnProperty\.call\(terminalMap,terminalId\)/.test(authoredGuideSource) &&
    /terminalId\.trim\(\)!==terminalId/.test(authoredGuideSource) &&
    /from===to/.test(authoredGuideSource) &&
    /"__proto__","prototype","constructor"/.test(authoredGuideSource) &&
    /if\(contextLost\)/.test(authoredGuideSource) &&
    /if\(!activeLabLayout\)/.test(authoredGuideSource) &&
    /if\(labEdit\.enabled\)/.test(authoredGuideSource) &&
    /drag\?\.kind==="terminal"/.test(authoredGuideSource));
  check("authored-pair-guide-source-is-distinct-dashed-visual-only-route",
    /LAB_AUTHORED_GUIDE_ROUTE_POINTS = 6/.test(sceneSource) &&
    /new T\.LineDashedMaterial\(/.test(sceneSource) &&
    /kind:"lab-authored-pair-guide-contrast"/.test(authoredGuideSource) &&
    /kind:"lab-authored-pair-guide-dash"/.test(authoredGuideSource) &&
    /computeLineDistances\(\)/.test(authoredGuideSource) &&
    /viewOnly:true,committed:false,visualOnly:true/.test(authoredGuideSource) &&
    /electricalAuthority:false/.test(authoredGuideSource) &&
    !/pendingWirePreviewLine|ensurePendingWirePreviewLine|labWireObjects\.push|setWiring\(|lastWiringModel\s*=/.test(authoredGuideSource));
  check("authored-pair-guide-source-clears-and-revalidates-lifecycle",
    /function clearLabLayout[\s\S]*clearAuthoredPairGuide\(false\)/.test(sceneSource) &&
    /previousAuthoredGuideLesson===layout\.lessonId/.test(setLabLayoutSource) &&
    /mountAuthoredPairGuide\(previousAuthoredGuide\)/.test(setLabLayoutSource) &&
    /guideBeforeContextLoss/.test(sceneSource) &&
    /guideBeforeContextLoss[\s\S]*clearAuthoredPairGuide\(false\)/.test(sceneSource) &&
    /guideToRestore/.test(sceneSource) &&
    /mountAuthoredPairGuide\(guideToRestore\)/.test(sceneSource) &&
    /setAuthoredPairGuide/.test(sceneSource.slice(sceneSource.indexOf("return {setLesson"))));
  const contextLostStart = sceneSource.indexOf("const onContextLost=");
  const contextRestoredStart = sceneSource.indexOf("const onContextRestored=", contextLostStart);
  const contextHandlersEnd = sceneSource.indexOf('canvas.addEventListener("pointerdown"', contextRestoredStart);
  const contextLostSource = sceneSource.slice(contextLostStart, contextRestoredStart);
  const contextRestoredSource = sceneSource.slice(contextRestoredStart, contextHandlersEnd);
  check("pending-wire-context-reset-is-fail-closed",
    /clearPendingWireState\(false\)/.test(contextLostSource) &&
    !/setPendingWireTerminal\(|pendingWireTerminalId\s*=/.test(contextRestoredSource));
  check("terminal-link-drag-context-reset-is-fail-closed",
    /drag=null;[\s\S]*clearTerminalLinkDragState\(false\)/.test(contextLostSource) &&
    !/onTerminalLink|terminalLinkDragSourceId\s*=|terminalLinkDragTargetId\s*=/.test(contextRestoredSource));
  check("wire-geometry-revision-resets-on-context-loss",
    /labWireGeometryRevision=0/.test(contextLostSource) &&
    /labWireGeometryRevision="0"/.test(contextLostSource));
  check("component-fidelity-source-remains-conceptual-and-visual-only",
    /function conceptualVisualFeature/.test(sceneSource) &&
    /conceptualFeature: true/.test(sceneSource) &&
    /physicalVerified: false/.test(sceneSource) &&
    /electricalAuthority: false/.test(sceneSource) &&
    /COMPONENT_VISUAL_PROFILE = "conceptual-components-v1"/.test(sceneSource));
  check("terminal-contrast-source-is-separate-from-electrical-authority",
    /TERMINAL_FEEDBACK_PROFILE = "contrast-rings-v1"/.test(sceneSource) &&
    /kind:"lab-terminal-contrast-backdrop"/.test(sceneSource) &&
    /kind:"lab-terminal-committed-wire-affordance"/.test(sceneSource) &&
    /kind:"lab-conceptual-wire-highlight-backdrop"/.test(sceneSource) &&
    /labWireHighlightFeedback/.test(sceneSource));

  const detached = document.createElement("div");
  let detachedRejected = false;
  try { mountScene(detached); } catch (error) { detachedRejected = /3D/.test(error.message); }
  check("detached-host-rejected", detachedRejected);

  const realRaf = window.requestAnimationFrame;
  const realCancelRaf = window.cancelAnimationFrame;
  let nextFrameId = 1;
  const queuedFrames = new Map();
  window.requestAnimationFrame = callback => {
    const id = nextFrameId++;
    queuedFrames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = id => queuedFrames.delete(id);

  const flushFrames = () => {
    let rounds = 0;
    while (queuedFrames.size && rounds++ < 10) {
      const batch = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of batch) callback(performance.now());
    }
  };
  const makeHost = () => {
    const host = document.createElement("div");
    host.className = "scene-mount";
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:640px;height:360px";
    document.body.append(host);
    return host;
  };

  let host;
  let mounted;
  try {
    host = makeHost();
    let selected = 0;
    mounted = mountScene(host, () => { selected += 1; });
    mounted.setLesson({ id: 5, wiring: ["D11 → RGB", "D10 → RGB", "GND → RGB"] });
    await waitTask();
    flushFrames();
    const canvas = host.querySelector("canvas");

    check("mount-one-canvas", canvas instanceof HTMLCanvasElement && host.querySelectorAll("canvas").length === 1);
    check("canvas-focusable", canvas.tabIndex === 0);
    check("canvas-accessible-role", canvas.getAttribute("role") === "application");
    check("canvas-keyboard-help", /mũi tên/i.test(canvas.getAttribute("aria-label") || "") && /Enter/i.test(canvas.getAttribute("aria-label") || ""));
    check("canvas-keyshortcuts", /ArrowLeft/.test(canvas.getAttribute("aria-keyshortcuts") || "") && /Home/.test(canvas.getAttribute("aria-keyshortcuts") || ""));
    check("touch-preserves-page-scroll", getComputedStyle(canvas).touchAction === "pan-y");
    check("context-ready-metadata", canvas.dataset.sceneContext === "ready" && !canvas.hasAttribute("aria-busy"));
    const legacyHeaderSockets = Number(canvas.dataset.sceneUnoHeaderSocketVisualCount);
    const legacyBreadboardHoles = Number(canvas.dataset.sceneBreadboardHoleVisualCount);
    const legacyContactStrips = Number(canvas.dataset.sceneBreadboardContactStripVisualCount);
    const legacyComponentFeatures = Number(canvas.dataset.sceneComponentVisualFeatureCount);
    const legacyComponentKinds = Number(canvas.dataset.sceneComponentVisualKindCount);
    const legacyComponentMarkings = Number(canvas.dataset.sceneComponentMarkingCount);
    const legacyTerminalContrast = Number(canvas.dataset.sceneTerminalContrastAffordanceCount);
    check("visual-fidelity-conceptual-profile",
      canvas.dataset.sceneVisualProfile === "conceptual-r3-fidelity-v2" &&
      canvas.dataset.sceneComponentVisualProfile === "conceptual-components-v1" &&
      canvas.dataset.sceneTerminalFeedbackProfile === "contrast-rings-v1" &&
      canvas.dataset.sceneCadMapping === "none" &&
      canvas.dataset.sceneElectricalAuthority === "none" &&
      legacyHeaderSockets >= 20 &&
      legacyBreadboardHoles >= 100 &&
      legacyContactStrips >= 10);
    check("visual-fidelity-instanced-detail-budget",
      Number(canvas.dataset.sceneInstancedVisualCount) >= legacyHeaderSockets + legacyBreadboardHoles &&
      Number(canvas.dataset.sceneFineDetailInstanceCount) > Number(canvas.dataset.sceneFineDetailObjectCount) &&
      Number(canvas.dataset.sceneFineDetailCount) === Number(canvas.dataset.sceneFineDetailObjectCount));

    canvas.focus();
    const arrow = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    check("keyboard-arrow-handled", !canvas.dispatchEvent(arrow) && arrow.defaultPrevented);
    const zoom = new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true });
    check("keyboard-zoom-handled", !canvas.dispatchEvent(zoom) && zoom.defaultPrevented);
    const reset = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    check("keyboard-reset-handled", !canvas.dispatchEvent(reset) && reset.defaultPrevented);
    const activate = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    canvas.dispatchEvent(activate);
    check("keyboard-select", activate.defaultPrevented && selected === 1);

    flushFrames();
    mounted.control("left");
    mounted.control("right");
    check("render-invalidations-coalesce", queuedFrames.size === 1);
    flushFrames();
    check("render-stays-on-demand", queuedFrames.size === 0);

    const otherFocus = document.createElement("button");
    host.append(otherFocus);
    otherFocus.focus();
    const inactiveKey = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    canvas.dispatchEvent(inactiveKey);
    check("keyboard-requires-canvas-focus", !inactiveKey.defaultPrevented && queuedFrames.size === 0);
    otherFocus.remove();

    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const beforeCancel = selected;
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 41, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 41, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    check("pointer-cancel-does-not-select", selected === beforeCancel);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 42, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 42, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    check("touch-tap-selects", selected === beforeCancel + 1);

    const beforeJitter = selected;
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 43, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 43, pointerType: "touch", clientX: 21, clientY: 10, bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 43, pointerType: "touch", clientX: 21, clientY: 10, bubbles: true }));
    check("touch-11px-jitter-still-selects", selected === beforeJitter + 1);

    const beforeTrueDrag = selected;
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 44, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 44, pointerType: "touch", clientX: 24, clientY: 10, bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 44, pointerType: "touch", clientX: 24, clientY: 10, bubbles: true }));
    check("touch-14px-drag-does-not-select", selected === beforeTrueDrag);

    const [{ createLabLayout, moveLabComponent, rotateLabComponent, labTerminalAnchor }, {
      listTerminals, createCircuit, connectCircuit, createSampleCircuit, disconnectCircuit,
    }, T] = await Promise.all([
      import("../src/lab-layout.js"),
      import("../src/circuit-router.js"),
      import("../assets/vendor/three.module.min.js"),
    ]);
    const labVisualHeight = visualKind => {
      if (visualKind === "arduino-uno") return .46;
      if (visualKind === "breadboard") return .34;
      if (visualKind === "ultrasonic-sensor") return .68;
      if (visualKind === "servo" || visualKind === "driver") return .62;
      if (visualKind === "power-source") return .55;
      return .48;
    };
    const resetCameraForTerminalProjection = sceneCanvas => {
      sceneCanvas.focus();
      sceneCanvas.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Home", bubbles: true, cancelable: true,
      }));
    };
    const projectedWorldPoint = (sceneCanvas, labLayout, worldPoint) => {
      const rect = sceneCanvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const camera = new T.PerspectiveCamera(38, aspect, .1, 100);
      const theta = .48, phi = .94;
      const fitted = Math.max(16.7, 18.5 /
        (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Math.max(.45, aspect)));
      const radius = Math.min(48, Math.max(8, fitted));
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi) + 5,
        radius * Math.sin(phi) * Math.cos(theta),
      );
      camera.lookAt(new T.Vector3(
        ((labLayout.bounds.minX + labLayout.bounds.maxX) / 2) * .72,
        .35,
        ((labLayout.bounds.minZ + labLayout.bounds.maxZ) / 2) * .72,
      ));
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const point = worldPoint.clone().project(camera);
      return {
        clientX: rect.left + (point.x + 1) * rect.width / 2,
        clientY: rect.top + (1 - point.y) * rect.height / 2,
      };
    };
    const projectedTerminalPoint = (sceneCanvas, labLayout, terminalId) => {
      const anchor = labTerminalAnchor(labLayout, terminalId);
      const terminal = labLayout.terminalMap[terminalId];
      const component = labLayout.components.find(item => item.id === terminal.componentId);
      if (!component) throw new Error("Missing terminal component: " + terminalId);
      return projectedWorldPoint(sceneCanvas, labLayout, new T.Vector3(
        anchor.x * .72,
        labVisualHeight(component.visualKind) + .10,
        anchor.z * .72,
      ));
    };
    const projectedComponentPoint = (sceneCanvas, labLayout, componentId) => {
      const component = labLayout.components.find(item => item.id === componentId);
      if (!component) throw new Error("Missing component: " + componentId);
      return projectedWorldPoint(sceneCanvas, labLayout, new T.Vector3(
        component.x * .72,
        Math.max(.20, labVisualHeight(component.visualKind) / 2),
        component.z * .72,
      ));
    };
    const projectedBreadboardStudyHolePoint = (sceneCanvas, labLayout, holeId) => {
      const match = /^([A-J])([1-9]|[1-5][0-9]|6[0-3])$/.exec(holeId);
      if (!match) throw new Error("Invalid conceptual breadboard study hole: " + holeId);
      const breadboardComponent = labLayout.components.find(item => item.visualKind === "breadboard");
      if (!breadboardComponent) throw new Error("Missing conceptual breadboard component");
      const rowIndex = "ABCDEFGHIJ".indexOf(match[1]);
      const columnIndex = Number(match[2]) - 1;
      const rowZ = [-.30, -.24, -.18, -.12, -.06, .06, .12, .18, .24, .30][rowIndex];
      const width = breadboardComponent.width * .72;
      const depth = breadboardComponent.depth * .72;
      const local = new T.Vector3(
        -width * .39 + width * .78 * columnIndex / 62,
        .318,
        depth * rowZ,
      );
      local.applyAxisAngle(
        new T.Vector3(0, 1, 0),
        -breadboardComponent.quarterTurns * Math.PI / 2,
      );
      local.x += breadboardComponent.x * .72;
      local.z += breadboardComponent.z * .72;
      return projectedWorldPoint(sceneCanvas, labLayout, local);
    };
    const projectedCommittedWirePoint = (sceneCanvas, labLayout, wire, wireIndex = 0) => {
      const terminalWorld = terminalId => {
        const anchor = labTerminalAnchor(labLayout, terminalId);
        const terminal = labLayout.terminalMap[terminalId];
        const component = labLayout.components.find(item => item.id === terminal.componentId);
        if (!component) throw new Error("Missing wire terminal component: " + terminalId);
        return new T.Vector3(
          anchor.x * .72,
          labVisualHeight(component.visualKind) + .10,
          anchor.z * .72,
        );
      };
      const start = terminalWorld(wire.from);
      const end = terminalWorld(wire.to);
      const routeOffset = ((wireIndex % 5) - 2) * .085;
      const laneY = Math.max(start.y, end.y) + .34 + (wireIndex % 4) * .065;
      const midX = (start.x + end.x) / 2 + routeOffset;
      return projectedWorldPoint(sceneCanvas, labLayout, new T.Vector3(
        midX,
        laneY,
        (start.z + end.z) / 2,
      ));
    };
    const dispatchScenePointer = (sceneCanvas, type, point, pointerId, pointerType = "mouse") => {
      const event = new PointerEvent(type, {
        button: 0, pointerId, pointerType,
        clientX: point.clientX, clientY: point.clientY,
        bubbles: true, cancelable: true,
      });
      sceneCanvas.dispatchEvent(event);
      return event;
    };
    const findTerminalPoint = (sceneCanvas, labLayout, terminalId, pointerId = 800) => {
      const projected = projectedTerminalPoint(sceneCanvas, labLayout, terminalId);
      const offsets = [0, -3, 3, -6, 6, -10, 10];
      for (const dx of offsets) {
        for (const dy of offsets) {
          const point = { clientX: projected.clientX + dx, clientY: projected.clientY + dy };
          dispatchScenePointer(sceneCanvas, "pointermove", point, pointerId, "mouse");
          if (sceneCanvas.dataset.labHoveredTerminal === terminalId) return point;
        }
      }
      throw new Error("Could not hit projected terminal " + terminalId);
    };
    mounted.setLesson({ id: 2 });
    const terminals = listTerminals(2);
    const layout = createLabLayout(2, terminals);
    check("public-inspected-terminal-api", typeof mounted.setInspectedTerminal === "function");
    check("public-breadboard-hole-study-api", typeof mounted.setBreadboardHoleStudy === "function");
    const disabledStudyBeforeLayout = mounted.setBreadboardHoleStudy({
      enabled: false,
      profileId: { invalid: true },
      selectedHoleId: "Z99",
      onHoleSelect: "invalid",
    });
    check("breadboard-hole-study-disabled-is-harmless-before-layout",
      Object.isFrozen(disabledStudyBeforeLayout) &&
      disabledStudyBeforeLayout.ok === true &&
      disabledStudyBeforeLayout.enabled === false &&
      disabledStudyBeforeLayout.active === false &&
      disabledStudyBeforeLayout.profileId === null &&
      disabledStudyBeforeLayout.selectedHoleId === null &&
      disabledStudyBeforeLayout.holeCount === 630 &&
      disabledStudyBeforeLayout.mode === "none" &&
      disabledStudyBeforeLayout.physicalVerified === false &&
      canvas.dataset.labBreadboardHoleStudyMode === "none" &&
      canvas.dataset.labBreadboardHoleCount === "0");
    const inactiveStudyBeforeLayout = mounted.setBreadboardHoleStudy({
      enabled: true,
      profileId: "pre-layout-study",
      selectedHoleId: null,
      onHoleSelect: null,
    });
    check("breadboard-hole-study-enabled-without-layout-fails-closed",
      inactiveStudyBeforeLayout.ok === false &&
      inactiveStudyBeforeLayout.enabled === true &&
      inactiveStudyBeforeLayout.active === false &&
      inactiveStudyBeforeLayout.profileId === "pre-layout-study" &&
      inactiveStudyBeforeLayout.mode === "none" &&
      canvas.dataset.labBreadboardHoleStudyMode === "none");

    let noLayoutProofRejected = false;
    try { mounted.setInspectedTerminal("D13"); }
    catch (error) { noLayoutProofRejected = error instanceof RangeError; }
    check("inspection-no-layout-no-proof-rejected",
      noLayoutProofRejected &&
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");

    const beforeReadOnlyInspection = mounted.getLabViewState();
    const readOnlyInspection = mounted.setInspectedTerminal("D13", layout);
    const afterReadOnlyInspection = mounted.getLabViewState();
    const readOnlyBadge = host.querySelector('[data-scene-inspection-badge="read-only"]');
    check("inspection-read-only-label-mode",
      readOnlyInspection.active === true &&
      readOnlyInspection.terminalId === "D13" &&
      readOnlyInspection.mode === "read-only-label" &&
      readOnlyInspection.physicalVerified === false &&
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "label" &&
      readOnlyBadge instanceof HTMLElement &&
      readOnlyBadge.hidden === false &&
      /D13/.test(readOnlyBadge.textContent || "") &&
      /D13/.test(canvas.getAttribute("aria-label") || ""));
    check("inspection-read-only-label-does-not-mount-or-move-scene",
      beforeReadOnlyInspection.mode === "legacy" &&
      afterReadOnlyInspection.mode === "legacy" &&
      afterReadOnlyInspection.focusedComponentId === beforeReadOnlyInspection.focusedComponentId &&
      afterReadOnlyInspection.selectedComponentId === beforeReadOnlyInspection.selectedComponentId &&
      JSON.stringify(afterReadOnlyInspection.camera) === JSON.stringify(beforeReadOnlyInspection.camera) &&
      canvas.dataset.labWireCount === "0" &&
      afterReadOnlyInspection.claims.physicalVerified === false &&
      afterReadOnlyInspection.claims.breadboardHoleMapping === false &&
      afterReadOnlyInspection.claims.electricalPower === false);

    let readOnlyUnknownRejected = false;
    try { mounted.setInspectedTerminal("NOT_A_TERMINAL", layout); }
    catch (error) { readOnlyUnknownRejected = error instanceof RangeError; }
    check("inspection-read-only-unknown-id-is-transactional",
      readOnlyUnknownRejected &&
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "label");

    mounted.setLabLayout(layout);
    check("layout-mount-clears-read-only-label",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none" &&
      readOnlyBadge.hidden === true);
    check("lab-layout-adds-conceptual-geometry-without-cad-claim",
      Number(canvas.dataset.sceneUnoHeaderSocketVisualCount) > legacyHeaderSockets &&
      Number(canvas.dataset.sceneBreadboardHoleVisualCount) > legacyBreadboardHoles &&
      Number(canvas.dataset.sceneBreadboardContactStripVisualCount) > legacyContactStrips &&
      Number(canvas.dataset.sceneComponentVisualFeatureCount) > legacyComponentFeatures &&
      Number(canvas.dataset.sceneComponentVisualKindCount) > legacyComponentKinds &&
      Number(canvas.dataset.sceneComponentMarkingCount) > legacyComponentMarkings &&
      Number(canvas.dataset.sceneTerminalContrastAffordanceCount) === layout.terminals.length &&
      Number(canvas.dataset.sceneTerminalContrastAffordanceCount) > legacyTerminalContrast &&
      canvas.dataset.sceneCadMapping === "none" &&
      canvas.dataset.sceneElectricalAuthority === "none" &&
      canvas.dataset.labHoveredTerminal === "" &&
      canvas.dataset.labTerminalLabelFeedback === "none" &&
      canvas.dataset.labTerminalContrastFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labWireHighlightFeedback === "none");

    check("public-authored-pair-guide-api-starts-clear",
      typeof mounted.setAuthoredPairGuide === "function" &&
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");
    const guidePair = { from: "D13", to: "R1:A" };
    const guideWireCountBefore = canvas.dataset.labWireCount;
    const guideRevisionBefore = canvas.dataset.labWireGeometryRevision;
    const guideStateBefore = mounted.getLabViewState();
    const guideResult = mounted.setAuthoredPairGuide(guidePair);
    const guideStateAfter = mounted.getLabViewState();
    check("authored-pair-guide-valid-result-is-frozen-view-only",
      Object.isFrozen(guideResult) &&
      guideResult.active === true &&
      guideResult.mode === "view-only" &&
      guideResult.from === "D13" &&
      guideResult.to === "R1:A" &&
      guideResult.physicalVerified === false &&
      guideResult.electricalAuthority === false &&
      Object.keys(guideResult).sort().join(",") ===
        "active,electricalAuthority,from,mode,physicalVerified,to" &&
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labAuthoredGuideFrom === "D13" &&
      canvas.dataset.labAuthoredGuideTo === "R1:A");
    check("authored-pair-guide-does-not-create-wire-or-scene-state-authority",
      canvas.dataset.labWireCount === guideWireCountBefore &&
      canvas.dataset.labWireGeometryRevision === guideRevisionBefore &&
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none" &&
      canvas.dataset.labHighlightedWire === "" &&
      guideStateAfter.selectedComponentId === guideStateBefore.selectedComponentId &&
      guideStateAfter.focusedComponentId === guideStateBefore.focusedComponentId &&
      JSON.stringify(guideStateAfter.camera) === JSON.stringify(guideStateBefore.camera) &&
      guideStateAfter.claims.physicalVerified === false &&
      guideStateAfter.claims.breadboardHoleMapping === false &&
      guideStateAfter.claims.electricalPower === false);

    const lesson3ForeignTerminal = listTerminals(3).find(item =>
      !Object.prototype.hasOwnProperty.call(layout.terminalMap, item.id)
    )?.id || "NOT_A_TERMINAL";
    const inheritedGuidePair = Object.create({ from: "D13", to: "R1:A" });
    const invalidGuidePairs = [
      {},
      { from: "D13" },
      { from: "D13", to: "D13" },
      { from: "D13 ", to: "R1:A" },
      { from: "D13", to: lesson3ForeignTerminal },
      { from: "__proto__", to: "R1:A" },
      { from: "constructor", to: "R1:A" },
      { from: "D13", to: "R1:A", extra: true },
      inheritedGuidePair,
      ["D13", "R1:A"],
      "D13:R1:A",
    ];
    const invalidGuideOutcomes = invalidGuidePairs.map(candidate => {
      try {
        mounted.setAuthoredPairGuide(candidate);
        return false;
      } catch (error) {
        return error instanceof TypeError || error instanceof RangeError;
      }
    });
    check("authored-pair-guide-invalid-foreign-prototype-inputs-are-transactional",
      invalidGuideOutcomes.every(Boolean) &&
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labAuthoredGuideFrom === "D13" &&
      canvas.dataset.labAuthoredGuideTo === "R1:A" &&
      canvas.dataset.labWireCount === guideWireCountBefore &&
      canvas.dataset.labWireGeometryRevision === guideRevisionBefore);

    const movedGuideLayout = moveLabComponent(layout, "R1", layout.bounds.maxX, layout.bounds.maxZ);
    mounted.setLabLayout(movedGuideLayout);
    check("authored-pair-guide-rebuilds-on-same-lesson-layout-with-canonical-endpoints",
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labAuthoredGuideFrom === "D13" &&
      canvas.dataset.labAuthoredGuideTo === "R1:A" &&
      canvas.dataset.labWireCount === guideWireCountBefore);
    mounted.setLabLayout(layout);
    check("authored-pair-guide-remains-view-only-after-layout-restore",
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labWireCount === guideWireCountBefore &&
      canvas.dataset.labPendingWirePreview === "none");

    const clearedGuide = mounted.setAuthoredPairGuide(null);
    const clearedGuideAgain = mounted.setAuthoredPairGuide(null);
    check("authored-pair-guide-null-clear-is-frozen-idempotent",
      Object.isFrozen(clearedGuide) &&
      Object.isFrozen(clearedGuideAgain) &&
      clearedGuide.active === false &&
      clearedGuide.mode === "none" &&
      clearedGuide.from === null &&
      clearedGuide.to === null &&
      clearedGuide.physicalVerified === false &&
      clearedGuide.electricalAuthority === false &&
      clearedGuideAgain.active === false &&
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");

    mounted.setAuthoredPairGuide(guidePair);
    mounted.setLabLayout(null);
    check("authored-pair-guide-clears-on-layout-null",
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");
    let inactiveGuideRejected = false;
    try { mounted.setAuthoredPairGuide(guidePair); }
    catch (error) { inactiveGuideRejected = error instanceof RangeError; }
    check("authored-pair-guide-rejects-inactive-layout",
      inactiveGuideRejected &&
      canvas.dataset.labAuthoredGuideMode === "none");
    mounted.setLabLayout(layout);
    mounted.setAuthoredPairGuide(guidePair);
    mounted.setLesson({ id: 3 });
    check("authored-pair-guide-clears-on-lesson-change",
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");
    const layout3ForGuide = createLabLayout(3, listTerminals(3));
    mounted.setLabLayout(layout3ForGuide);
    const staleLesson2Terminal = terminals.find(item =>
      !Object.prototype.hasOwnProperty.call(layout3ForGuide.terminalMap, item.id)
    )?.id || "NOT_A_TERMINAL";
    const lesson3CanonicalTerminal = layout3ForGuide.terminals.find(item =>
      item.id !== staleLesson2Terminal
    )?.id;
    let staleGuideRejected = false;
    try {
      mounted.setAuthoredPairGuide({
        from: staleLesson2Terminal,
        to: lesson3CanonicalTerminal || "D2",
      });
    } catch (error) {
      staleGuideRejected = error instanceof RangeError;
    }
    check("authored-pair-guide-rejects-stale-terminal-after-lesson-layout-change",
      staleGuideRejected &&
      canvas.dataset.labAuthoredGuideMode === "none");
    mounted.setLesson({ id: 2 });
    mounted.setLabLayout(layout);
    mounted.setAuthoredPairGuide(guidePair);
    mounted.setLabEdit({ enabled: true, selectedComponentId: "arduino", onTerminalLink: null });
    check("authored-pair-guide-edit-entry-clears-view-only-guide",
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");
    let editModeGuideRejected = false;
    try { mounted.setAuthoredPairGuide(guidePair); }
    catch (error) { editModeGuideRejected = error instanceof RangeError; }
    check("authored-pair-guide-rejects-while-edit-mode-active",
      editModeGuideRejected &&
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labPendingWirePreview === "none");

    const holeSelectEvents = [];
    const holeComponentEvents = [];
    const holeTerminalEvents = [];
    let holeAcceptanceMode = "accept";
    let holeAcceptedProfile = "bb-study-v1";
    const onHoleSelect = (holeId, meta) => {
      holeSelectEvents.push({ holeId, meta });
      if (holeAcceptanceMode === "reject") {
        return { accepted: false, reason: "fixture-reject" };
      }
      if (holeAcceptanceMode === "mismatch") {
        return {
          accepted: true,
          selection: { lessonId: 2, profileId: "wrong-profile", holeId },
        };
      }
      return {
        accepted: true,
        selection: { lessonId: 2, profileId: holeAcceptedProfile, holeId },
      };
    };
    mounted.setLabEdit({
      enabled: true,
      selectedComponentId: "arduino",
      onSelectComponent: componentId => holeComponentEvents.push(componentId),
      onTerminalSelect: terminalId => holeTerminalEvents.push(terminalId),
    });
    flushFrames();
    const fineInstancesBeforeStudy = canvas.dataset.sceneFineDetailInstanceCount;
    const studyEnabled = mounted.setBreadboardHoleStudy({
      enabled: true,
      profileId: holeAcceptedProfile,
      selectedHoleId: null,
      onHoleSelect,
    });
    check("breadboard-hole-study-active-status-and-630-instance-datasets",
      Object.isFrozen(studyEnabled) &&
      studyEnabled.ok === true &&
      studyEnabled.enabled === true &&
      studyEnabled.active === true &&
      studyEnabled.profileId === "bb-study-v1" &&
      studyEnabled.selectedHoleId === null &&
      studyEnabled.holeCount === 630 &&
      studyEnabled.mode === "conceptual-strip-study" &&
      studyEnabled.physicalVerified === false &&
      Object.keys(studyEnabled).sort().join(",") ===
        "active,enabled,holeCount,mode,ok,physicalVerified,profileId,selectedHoleId" &&
      canvas.dataset.labBreadboardHoleStudyMode === "conceptual-strip-study" &&
      canvas.dataset.labBreadboardHoleStudyProfile === "bb-study-v1" &&
      canvas.dataset.labBreadboardHoleSelected === "" &&
      canvas.dataset.labBreadboardHoleCount === "630" &&
      canvas.dataset.labBreadboardHolePhysicalVerified === "false");
    check("breadboard-hole-study-instancing-does-not-expand-fine-detail-budget",
      canvas.dataset.sceneFineDetailInstanceCount === fineInstancesBeforeStudy &&
      queuedFrames.size === 1);
    flushFrames();

    const invalidHoleStudyInputs = [
      { enabled: true, profileId: "bb-study-v1", selectedHoleId: "A0", onHoleSelect },
      { enabled: true, profileId: "bb-study-v1", selectedHoleId: "A64", onHoleSelect },
      { enabled: true, profileId: "bb-study-v1", selectedHoleId: "K1", onHoleSelect },
      { enabled: true, profileId: "bb-study-v1", selectedHoleId: "A01", onHoleSelect },
      { enabled: true, profileId: "bb-study-v1", selectedHoleId: "a1", onHoleSelect },
      { enabled: true, profileId: "bb-study-v1", selectedHoleId: " A1", onHoleSelect },
      { enabled: true, profileId: " constructor ", selectedHoleId: null, onHoleSelect },
      { enabled: true, profileId: "constructor", selectedHoleId: null, onHoleSelect },
      { enabled: true, profileId: "x".repeat(81), selectedHoleId: null, onHoleSelect },
      { enabled: true, profileId: "bb-study-v1", selectedHoleId: null, onHoleSelect: "bad" },
    ];
    const invalidHoleStudyResults = invalidHoleStudyInputs.map(options => {
      try {
        mounted.setBreadboardHoleStudy(options);
        return false;
      } catch (error) {
        return error instanceof TypeError || error instanceof RangeError;
      }
    });
    check("breadboard-hole-study-invalid-profile-hole-callback-inputs-are-transactional",
      invalidHoleStudyResults.every(Boolean) &&
      canvas.dataset.labBreadboardHoleStudyMode === "conceptual-strip-study" &&
      canvas.dataset.labBreadboardHoleStudyProfile === "bb-study-v1" &&
      canvas.dataset.labBreadboardHoleSelected === "" &&
      canvas.dataset.labBreadboardHoleCount === "630");

    const apiSelected = mounted.setBreadboardHoleStudy({
      enabled: true,
      profileId: "bb-study-v1",
      selectedHoleId: "J63",
      onHoleSelect,
    });
    check("breadboard-hole-study-api-selected-hole-is-visual-only",
      apiSelected.active === true &&
      apiSelected.selectedHoleId === "J63" &&
      canvas.dataset.labBreadboardHoleSelected === "J63" &&
      holeSelectEvents.length === 0 &&
      canvas.dataset.labBreadboardHoleMapping === "false" &&
      canvas.dataset.sceneElectricalAuthority === "none");

    holeAcceptedProfile = "bb-study-v2";
    const profileChanged = mounted.setBreadboardHoleStudy({
      enabled: true,
      profileId: holeAcceptedProfile,
      onHoleSelect,
    });
    check("breadboard-hole-study-profile-change-resets-stale-selection",
      profileChanged.ok === true &&
      profileChanged.active === true &&
      profileChanged.selectedHoleId === null &&
      canvas.dataset.labBreadboardHoleStudyProfile === "bb-study-v2" &&
      canvas.dataset.labBreadboardHoleSelected === "");

    holeAcceptedProfile = "bb-study-v1";
    mounted.setBreadboardHoleStudy({
      enabled: true,
      profileId: holeAcceptedProfile,
      selectedHoleId: null,
      onHoleSelect,
    });
    resetCameraForTerminalProjection(canvas);
    const holeA1Point = projectedBreadboardStudyHolePoint(canvas, layout, "A1");
    const componentCountBeforeHoleTap = holeComponentEvents.length;
    const terminalCountBeforeHoleTap = holeTerminalEvents.length;
    const wireCountBeforeHoleTap = canvas.dataset.labWireCount;
    const revisionBeforeHoleTap = canvas.dataset.labWireGeometryRevision;
    const stateBeforeHoleTap = mounted.getLabViewState();
    dispatchScenePointer(canvas, "pointerdown", holeA1Point, 960, "mouse");
    dispatchScenePointer(canvas, "pointerup", holeA1Point, 960, "mouse");
    const firstHolePick = holeSelectEvents.at(-1);
    const stateAfterHoleTap = mounted.getLabViewState();
    check("breadboard-hole-study-pointer-selects-canonical-A1-exactly-once",
      holeSelectEvents.length === 1 &&
      firstHolePick?.holeId === "A1" &&
      firstHolePick?.meta?.source === "pointer" &&
      firstHolePick?.meta?.physicalVerified === false &&
      Object.isFrozen(firstHolePick.meta) &&
      Object.keys(firstHolePick.meta).sort().join(",") === "physicalVerified,source" &&
      canvas.dataset.labBreadboardHoleSelected === "A1" &&
      holeComponentEvents.length === componentCountBeforeHoleTap &&
      holeTerminalEvents.length === terminalCountBeforeHoleTap);
    check("breadboard-hole-study-pointer-selection-has-no-electrical-or-wire-authority",
      canvas.dataset.labWireCount === wireCountBeforeHoleTap &&
      canvas.dataset.labWireGeometryRevision === revisionBeforeHoleTap &&
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none" &&
      canvas.dataset.labBreadboardHoleMapping === "false" &&
      canvas.dataset.labElectricalPower === "false" &&
      canvas.dataset.sceneElectricalAuthority === "none" &&
      stateAfterHoleTap.selectedComponentId === stateBeforeHoleTap.selectedComponentId &&
      stateAfterHoleTap.focusedComponentId === stateBeforeHoleTap.focusedComponentId &&
      JSON.stringify(stateAfterHoleTap.camera) === JSON.stringify(stateBeforeHoleTap.camera));

    const holeJ63Point = projectedBreadboardStudyHolePoint(canvas, layout, "J63");
    const holeCountBeforeJ63 = holeSelectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", holeJ63Point, 961, "touch");
    dispatchScenePointer(canvas, "pointerup", holeJ63Point, 961, "touch");
    check("breadboard-hole-study-row-major-endpoint-J63-is-pointer-selectable",
      holeSelectEvents.length === holeCountBeforeJ63 + 1 &&
      holeSelectEvents.at(-1)?.holeId === "J63" &&
      canvas.dataset.labBreadboardHoleSelected === "J63");

    const holeH40Point = projectedBreadboardStudyHolePoint(canvas, layout, "H40");
    const holeCountBeforePenPick = holeSelectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", holeH40Point, 973, "pen");
    dispatchScenePointer(canvas, "pointerup", holeH40Point, 973, "pen");
    check("breadboard-hole-study-pen-tap-selects-canonical-hole",
      holeSelectEvents.length === holeCountBeforePenPick + 1 &&
      holeSelectEvents.at(-1)?.holeId === "H40" &&
      canvas.dataset.labBreadboardHoleSelected === "H40");

    holeAcceptanceMode = "reject";
    const holeE32Point = projectedBreadboardStudyHolePoint(canvas, layout, "E32");
    const holeCountBeforeReject = holeSelectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", holeE32Point, 962, "pen");
    dispatchScenePointer(canvas, "pointerup", holeE32Point, 962, "pen");
    check("breadboard-hole-study-rejected-controller-pick-does-not-change-halo",
      holeSelectEvents.length === holeCountBeforeReject + 1 &&
      holeSelectEvents.at(-1)?.holeId === "E32" &&
      canvas.dataset.labBreadboardHoleSelected === "H40");

    holeAcceptanceMode = "mismatch";
    const holeD31Point = projectedBreadboardStudyHolePoint(canvas, layout, "D31");
    const holeCountBeforeMismatch = holeSelectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", holeD31Point, 963, "mouse");
    dispatchScenePointer(canvas, "pointerup", holeD31Point, 963, "mouse");
    check("breadboard-hole-study-mismatched-acceptance-context-does-not-change-halo",
      holeSelectEvents.length === holeCountBeforeMismatch + 1 &&
      holeSelectEvents.at(-1)?.holeId === "D31" &&
      canvas.dataset.labBreadboardHoleSelected === "H40");
    holeAcceptanceMode = "accept";

    const holeCountBeforeDrag = holeSelectEvents.length;
    const cameraBeforeHoleDrag = mounted.getLabViewState().camera;
    const holeDragPoint = { clientX: holeA1Point.clientX + 24, clientY: holeA1Point.clientY + 8 };
    dispatchScenePointer(canvas, "pointerdown", holeA1Point, 964, "mouse");
    dispatchScenePointer(canvas, "pointermove", holeDragPoint, 964, "mouse");
    dispatchScenePointer(canvas, "pointerup", holeDragPoint, 964, "mouse");
    const cameraAfterHoleDrag = mounted.getLabViewState().camera;
    check("breadboard-hole-study-drag-becomes-camera-not-selection",
      holeSelectEvents.length === holeCountBeforeDrag &&
      (cameraAfterHoleDrag.theta !== cameraBeforeHoleDrag.theta ||
        cameraAfterHoleDrag.phi !== cameraBeforeHoleDrag.phi));

    resetCameraForTerminalProjection(canvas);
    const holeCancelPoint = projectedBreadboardStudyHolePoint(canvas, layout, "A1");
    const holeCountBeforeCancel = holeSelectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", holeCancelPoint, 965, "touch");
    dispatchScenePointer(canvas, "pointercancel", holeCancelPoint, 965, "touch");
    check("breadboard-hole-study-pointercancel-emits-no-selection",
      holeSelectEvents.length === holeCountBeforeCancel);
    dispatchScenePointer(canvas, "pointerdown", holeCancelPoint, 966, "pen");
    canvas.dispatchEvent(new PointerEvent("lostpointercapture", {
      pointerId: 966,
      pointerType: "pen",
      clientX: holeCancelPoint.clientX,
      clientY: holeCancelPoint.clientY,
      bubbles: true,
      cancelable: true,
    }));
    check("breadboard-hole-study-lostcapture-emits-no-selection",
      holeSelectEvents.length === holeCountBeforeCancel);

    const terminalPriorityPoint = findTerminalPoint(canvas, layout, "D13", 967);
    const holeCountBeforeTerminalPriority = holeSelectEvents.length;
    const terminalCountBeforeStudyPriority = holeTerminalEvents.length;
    dispatchScenePointer(canvas, "pointerdown", terminalPriorityPoint, 968, "mouse");
    dispatchScenePointer(canvas, "pointerup", terminalPriorityPoint, 968, "mouse");
    check("breadboard-hole-study-does-not-steal-terminal-priority",
      holeSelectEvents.length === holeCountBeforeTerminalPriority &&
      holeTerminalEvents.length === terminalCountBeforeStudyPriority + 1 &&
      holeTerminalEvents.at(-1) === "D13");

    const studyComponentPriorityPoint = projectedComponentPoint(canvas, layout, "arduino");
    const holeCountBeforeComponentPriority = holeSelectEvents.length;
    const componentCountBeforeStudyPriority = holeComponentEvents.length;
    dispatchScenePointer(canvas, "pointerdown", studyComponentPriorityPoint, 969, "mouse");
    dispatchScenePointer(canvas, "pointerup", studyComponentPriorityPoint, 969, "mouse");
    check("breadboard-hole-study-does-not-steal-nonbreadboard-component-priority",
      holeSelectEvents.length === holeCountBeforeComponentPriority &&
      holeComponentEvents.length === componentCountBeforeStudyPriority + 1 &&
      holeComponentEvents.at(-1) === "arduino");

    const disabledStudy = mounted.setBreadboardHoleStudy({
      enabled: false,
      profileId: { ignored: true },
      selectedHoleId: "ignored",
      onHoleSelect: "ignored",
    });
    check("breadboard-hole-study-disabled-clears-overlay-and-selection",
      disabledStudy.ok === true &&
      disabledStudy.enabled === false &&
      disabledStudy.active === false &&
      disabledStudy.profileId === null &&
      disabledStudy.selectedHoleId === null &&
      canvas.dataset.labBreadboardHoleStudyMode === "none" &&
      canvas.dataset.labBreadboardHoleSelected === "" &&
      canvas.dataset.labBreadboardHoleCount === "0");
    resetCameraForTerminalProjection(canvas);
    const breadboardComponentPoint = projectedComponentPoint(canvas, layout, "breadboard");
    const componentCountBeforeModeOffTap = holeComponentEvents.length;
    const holeCountBeforeModeOffTap = holeSelectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", breadboardComponentPoint, 970, "mouse");
    dispatchScenePointer(canvas, "pointerup", breadboardComponentPoint, 970, "mouse");
    check("breadboard-hole-study-mode-off-does-not-swallow-existing-component-tap",
      holeSelectEvents.length === holeCountBeforeModeOffTap &&
      holeComponentEvents.length === componentCountBeforeModeOffTap + 1 &&
      holeComponentEvents.at(-1) === "breadboard");

    holeAcceptedProfile = "bb-study-v1";
    mounted.setBreadboardHoleStudy({
      enabled: true,
      profileId: holeAcceptedProfile,
      selectedHoleId: null,
      onHoleSelect,
    });
    resetCameraForTerminalProjection(canvas);
    const stageHolePoint = projectedBreadboardStudyHolePoint(canvas, layout, "B2");
    const holeCountBeforeStageReset = holeSelectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", stageHolePoint, 971, "mouse");
    mounted.setLabLayout(null);
    dispatchScenePointer(canvas, "pointerup", stageHolePoint, 971, "mouse");
    check("breadboard-hole-study-layout-clear-cancels-pointer-and-resets-mode",
      holeSelectEvents.length === holeCountBeforeStageReset &&
      canvas.dataset.labBreadboardHoleStudyMode === "none" &&
      canvas.dataset.labBreadboardHoleSelected === "" &&
      canvas.dataset.labBreadboardHoleCount === "0");
    mounted.setLabLayout(layout);
    mounted.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    mounted.setBreadboardHoleStudy({
      enabled: true,
      profileId: holeAcceptedProfile,
      selectedHoleId: null,
      onHoleSelect,
    });
    resetCameraForTerminalProjection(canvas);
    const lessonHolePoint = projectedBreadboardStudyHolePoint(canvas, layout, "C3");
    const holeCountBeforeLessonReset = holeSelectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", lessonHolePoint, 972, "mouse");
    mounted.setLesson({ id: 3 });
    dispatchScenePointer(canvas, "pointerup", lessonHolePoint, 972, "mouse");
    check("breadboard-hole-study-lesson-change-cancels-pointer-and-resets-mode",
      holeSelectEvents.length === holeCountBeforeLessonReset &&
      canvas.dataset.labBreadboardHoleStudyMode === "none" &&
      canvas.dataset.labBreadboardHoleCount === "0");
    mounted.setLesson({ id: 2 });
    mounted.setLabLayout(layout);
    mounted.setLabEdit({
      enabled: true,
      selectedComponentId: "arduino",
      onSelectComponent: null,
      onTerminalSelect: null,
    });

    resetCameraForTerminalProjection(canvas);
    const noHandlerSourcePoint = findTerminalPoint(canvas, layout, "D13", 799);
    const noHandlerTargetPoint = findTerminalPoint(canvas, layout, "R1:A", 800);
    dispatchScenePointer(canvas, "pointerdown", noHandlerSourcePoint, 809, "mouse");
    dispatchScenePointer(canvas, "pointermove", noHandlerTargetPoint, 809, "mouse");
    check("terminal-drag-without-controller-handler-does-not-arm-ghost",
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");
    dispatchScenePointer(canvas, "pointercancel", noHandlerSourcePoint, 809, "mouse");

    const terminalLinkEvents = [];
    const terminalSelectEvents = [];
    const terminalDragStartEvents = [];
    let clearPendingOnDragStart = false;
    mounted.setLabEdit({
      enabled: true,
      selectedComponentId: "arduino",
      onTerminalSelect: (terminalId, meta) => terminalSelectEvents.push({ terminalId, meta }),
      onTerminalDragStart: (sourceId, meta) => {
        terminalDragStartEvents.push({ sourceId, meta });
        if (clearPendingOnDragStart) mounted.setPendingWireTerminal(null);
      },
      onTerminalLink: (fromId, toId, meta) => terminalLinkEvents.push({ fromId, toId, meta }),
    });
    mounted.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    resetCameraForTerminalProjection(canvas);
    const dragSourcePoint = findTerminalPoint(canvas, layout, "D13", 801);
    const dragTargetPoint = findTerminalPoint(canvas, layout, "R1:A", 802);
    const selectedBeforeTerminalDrag = canvas.dataset.labSelectedComponent;
    const wireCountBeforeTerminalDrag = canvas.dataset.labWireCount;
    const geometryRevisionBeforeTerminalDrag = canvas.dataset.labWireGeometryRevision;
    for (const [index, pointerType] of ["mouse", "touch", "pen"].entries()) {
      const pointerId = 810 + index;
      const linkCountBefore = terminalLinkEvents.length;
      const selectCountBefore = terminalSelectEvents.length;
      const dragStartCountBefore = terminalDragStartEvents.length;
      dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, pointerId, pointerType);
      const dragMove = dispatchScenePointer(canvas, "pointermove", dragTargetPoint, pointerId, pointerType);
      dispatchScenePointer(canvas, "pointermove", dragTargetPoint, pointerId, pointerType);
      const dragStart = terminalDragStartEvents.at(-1);
      check("terminal-drag-" + pointerType + "-shows-valid-ghost",
        dragMove.defaultPrevented &&
        terminalDragStartEvents.length === dragStartCountBefore + 1 &&
        dragStart?.sourceId === "D13" &&
        dragStart?.meta?.source === "pointer-drag" &&
        dragStart?.meta?.physicalVerified === false &&
        Object.isFrozen(dragStart.meta) &&
        Object.keys(dragStart.meta).sort().join(",") === "physicalVerified,source" &&
        canvas.dataset.labTerminalDragSource === "D13" &&
        canvas.dataset.labTerminalDragTarget === "R1:A" &&
        canvas.dataset.labTerminalDragPreview === "ghost" &&
        canvas.dataset.labPendingWirePreview === "none");
      dispatchScenePointer(canvas, "pointerup", dragTargetPoint, pointerId, pointerType);
      const link = terminalLinkEvents.at(-1);
      check("terminal-drag-" + pointerType + "-emits-once-through-controller-callback",
        terminalLinkEvents.length === linkCountBefore + 1 &&
        terminalDragStartEvents.length === dragStartCountBefore + 1 &&
        terminalSelectEvents.length === selectCountBefore &&
        link?.fromId === "D13" &&
        link?.toId === "R1:A" &&
        link?.meta?.source === "pointer-drag" &&
        link?.meta?.physicalVerified === false &&
        Object.isFrozen(link.meta) &&
        Object.keys(link.meta).sort().join(",") === "physicalVerified,source");
      check("terminal-drag-" + pointerType + "-cleans-transient-state-without-graph-mutation",
        canvas.dataset.labTerminalDragSource === "" &&
        canvas.dataset.labTerminalDragTarget === "" &&
        canvas.dataset.labTerminalDragPreview === "none" &&
        canvas.dataset.labSelectedComponent === selectedBeforeTerminalDrag &&
        canvas.dataset.labWireCount === wireCountBeforeTerminalDrag &&
        canvas.dataset.labWireGeometryRevision === geometryRevisionBeforeTerminalDrag);
    }

    const linkCountBeforeTap = terminalLinkEvents.length;
    const selectCountBeforeTap = terminalSelectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 820, "mouse");
    dispatchScenePointer(canvas, "pointerup", dragSourcePoint, 820, "mouse");
    check("terminal-tap-keeps-onTerminalSelect-without-link-fallback",
      terminalLinkEvents.length === linkCountBeforeTap &&
      terminalSelectEvents.length === selectCountBeforeTap + 1 &&
      terminalSelectEvents.at(-1)?.terminalId === "D13" &&
      terminalSelectEvents.at(-1)?.meta?.source === "pointer");

    const linkCountBeforeJitter = terminalLinkEvents.length;
    const selectCountBeforeJitter = terminalSelectEvents.length;
    const dragStartCountBeforeJitter = terminalDragStartEvents.length;
    const touchJitterPoint = { clientX: dragSourcePoint.clientX + 11, clientY: dragSourcePoint.clientY };
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 821, "touch");
    dispatchScenePointer(canvas, "pointermove", touchJitterPoint, 821, "touch");
    dispatchScenePointer(canvas, "pointerup", touchJitterPoint, 821, "touch");
    check("terminal-touch-11px-jitter-stays-tap-not-link",
      terminalLinkEvents.length === linkCountBeforeJitter &&
      terminalDragStartEvents.length === dragStartCountBeforeJitter &&
      terminalSelectEvents.length === selectCountBeforeJitter + 1 &&
      canvas.dataset.labTerminalDragPreview === "none");

    const backgroundPoint = (() => {
      const rect = canvas.getBoundingClientRect();
      return { clientX: rect.left + 2, clientY: rect.top + 2 };
    })();
    clearPendingOnDragStart = true;
    mounted.setPendingWireTerminal("D13");
    const linkCountBeforeCanceledArmDrag = terminalLinkEvents.length;
    const dragStartCountBeforeCanceledArmDrag = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragTargetPoint, 829, "touch");
    dispatchScenePointer(canvas, "pointermove", backgroundPoint, 829, "touch");
    const canceledArmDragStart = terminalDragStartEvents.at(-1);
    check("terminal-drag-start-clears-controller-owned-two-tap-arm-before-eventual-cancel",
      terminalDragStartEvents.length === dragStartCountBeforeCanceledArmDrag + 1 &&
      canceledArmDragStart?.sourceId === "R1:A" &&
      canceledArmDragStart?.meta?.source === "pointer-drag" &&
      canceledArmDragStart?.meta?.physicalVerified === false &&
      Object.isFrozen(canceledArmDragStart.meta) &&
      canvas.dataset.labPendingWireTerminal === "" &&
      terminalLinkEvents.length === linkCountBeforeCanceledArmDrag);
    dispatchScenePointer(canvas, "pointercancel", backgroundPoint, 829, "touch");
    check("terminal-drag-start-cancel-remains-exactly-once-without-link",
      terminalDragStartEvents.length === dragStartCountBeforeCanceledArmDrag + 1 &&
      terminalLinkEvents.length === linkCountBeforeCanceledArmDrag &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");
    clearPendingOnDragStart = false;

    const linkCountBeforeBackground = terminalLinkEvents.length;
    const selectCountBeforeBackground = terminalSelectEvents.length;
    const dragStartCountBeforeBackground = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 822, "mouse");
    dispatchScenePointer(canvas, "pointermove", backgroundPoint, 822, "mouse");
    check("terminal-drag-background-has-no-valid-target-or-ghost",
      terminalDragStartEvents.length === dragStartCountBeforeBackground + 1 &&
      canvas.dataset.labTerminalDragSource === "D13" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");
    dispatchScenePointer(canvas, "pointerup", backgroundPoint, 822, "mouse");
    check("terminal-drag-background-drop-emits-nothing",
      terminalLinkEvents.length === linkCountBeforeBackground &&
      terminalDragStartEvents.length === dragStartCountBeforeBackground + 1 &&
      terminalSelectEvents.length === selectCountBeforeBackground &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragPreview === "none");

    const linkCountBeforeSameEndpoint = terminalLinkEvents.length;
    const selectCountBeforeSameEndpoint = terminalSelectEvents.length;
    const dragStartCountBeforeSameEndpoint = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 828, "mouse");
    dispatchScenePointer(canvas, "pointermove", backgroundPoint, 828, "mouse");
    dispatchScenePointer(canvas, "pointermove", dragSourcePoint, 828, "mouse");
    check("terminal-drag-same-endpoint-is-not-valid-target",
      terminalDragStartEvents.length === dragStartCountBeforeSameEndpoint + 1 &&
      canvas.dataset.labTerminalDragSource === "D13" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");
    dispatchScenePointer(canvas, "pointerup", dragSourcePoint, 828, "mouse");
    check("terminal-drag-same-endpoint-emits-nothing",
      terminalLinkEvents.length === linkCountBeforeSameEndpoint &&
      terminalDragStartEvents.length === dragStartCountBeforeSameEndpoint + 1 &&
      terminalSelectEvents.length === selectCountBeforeSameEndpoint &&
      canvas.dataset.labTerminalDragPreview === "none");

    const linkCountBeforeForeignPointer = terminalLinkEvents.length;
    const dragStartCountBeforeForeignPointer = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 823, "mouse");
    dispatchScenePointer(canvas, "pointermove", dragTargetPoint, 824, "mouse");
    dispatchScenePointer(canvas, "pointerup", dragTargetPoint, 824, "mouse");
    dispatchScenePointer(canvas, "pointercancel", dragSourcePoint, 823, "mouse");
    check("terminal-drag-foreign-pointer-cannot-complete-link",
      terminalLinkEvents.length === linkCountBeforeForeignPointer &&
      terminalDragStartEvents.length === dragStartCountBeforeForeignPointer &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragPreview === "none");

    const linkCountBeforeTouchCancel = terminalLinkEvents.length;
    const dragStartCountBeforeTouchCancel = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 825, "touch");
    dispatchScenePointer(canvas, "pointermove", dragTargetPoint, 825, "touch");
    check("terminal-touch-drag-arms-ghost-before-cancel",
      terminalDragStartEvents.length === dragStartCountBeforeTouchCancel + 1 &&
      canvas.dataset.labTerminalDragPreview === "ghost" &&
      canvas.dataset.labTerminalDragTarget === "R1:A");
    dispatchScenePointer(canvas, "pointercancel", dragTargetPoint, 825, "touch");
    check("terminal-touch-cancel-clears-ghost-without-link",
      terminalLinkEvents.length === linkCountBeforeTouchCancel &&
      terminalDragStartEvents.length === dragStartCountBeforeTouchCancel + 1 &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");

    const linkCountBeforeLostCapture = terminalLinkEvents.length;
    const dragStartCountBeforeLostCapture = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 826, "pen");
    dispatchScenePointer(canvas, "pointermove", dragTargetPoint, 826, "pen");
    canvas.dispatchEvent(new PointerEvent("lostpointercapture", {
      pointerId: 826, pointerType: "pen",
      clientX: dragTargetPoint.clientX, clientY: dragTargetPoint.clientY,
      bubbles: true, cancelable: true,
    }));
    check("terminal-pen-lost-capture-clears-ghost-without-link",
      terminalLinkEvents.length === linkCountBeforeLostCapture &&
      terminalDragStartEvents.length === dragStartCountBeforeLostCapture + 1 &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");

    const linkCountBeforeStageClear = terminalLinkEvents.length;
    const dragStartCountBeforeStageClear = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 827, "mouse");
    dispatchScenePointer(canvas, "pointermove", dragTargetPoint, 827, "mouse");
    check("terminal-drag-stage-clear-fixture-has-active-ghost",
      terminalDragStartEvents.length === dragStartCountBeforeStageClear + 1 &&
      canvas.dataset.labTerminalDragPreview === "ghost");
    mounted.setLabLayout(null);
    dispatchScenePointer(canvas, "pointerup", dragTargetPoint, 827, "mouse");
    check("terminal-drag-stage-clear-cancels-stale-drop",
      terminalLinkEvents.length === linkCountBeforeStageClear &&
      terminalDragStartEvents.length === dragStartCountBeforeStageClear + 1 &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");
    mounted.setLabLayout(layout);
    // Direct-drag fixture teardown: historical contracts below intentionally
    // start outside edit mode (notably pending-wire-requires-edit-mode).
    mounted.setLabEdit({
      enabled: false,
      onTerminalSelect: null,
      onTerminalDragStart: null,
      onTerminalLink: null,
    });

    let highlightWithoutWiringRejected = false;
    try { mounted.setHighlightedLabWire("w1"); }
    catch (error) { highlightWithoutWiringRejected = error instanceof RangeError; }
    check("highlighted-wire-requires-current-canonical-wiring",
      highlightWithoutWiringRejected && canvas.dataset.labHighlightedWire === "");

    const sampleCircuit = createSampleCircuit(2);
    const committedWireId = sampleCircuit.wires[0].id;
    mounted.setWiring(sampleCircuit, terminals);
    check("committed-wire-route-metadata",
      canvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      canvas.dataset.labWireRoutePointCount === "8" &&
      Number(canvas.dataset.labWireGeometryRevision) > 0 &&
      Number(canvas.dataset.labWireCount) === sampleCircuit.wires.length &&
      canvas.dataset.labPendingWirePreview === "none");

    let invalidWireInspectCallbackRejected = false;
    try { mounted.setLabEdit({ enabled: true, onCommittedWireInspect: "invalid" }); }
    catch (error) { invalidWireInspectCallbackRejected = error instanceof TypeError; }
    check("committed-wire-inspect-rejects-nonfunction-callback-transactionally",
      invalidWireInspectCallbackRejected &&
      canvas.dataset.labEdit === "off" &&
      canvas.dataset.labHighlightedWire === "");

    const wireInspectEvents = [];
    const wireInspectTerminalEvents = [];
    const wireInspectComponentEvents = [];
    const wireInspectLinkEvents = [];
    mounted.setLabEdit({
      enabled: true,
      onSelectComponent: componentId => wireInspectComponentEvents.push(componentId),
      onTerminalSelect: terminalId => wireInspectTerminalEvents.push(terminalId),
      onTerminalLink: (fromId, toId) => wireInspectLinkEvents.push({ fromId, toId }),
      onCommittedWireInspect: (wireId, meta) => wireInspectEvents.push({ wireId, meta }),
    });
    mounted.setLabEdit({ enabled: true, selectedComponentId: null });
    holeAcceptedProfile = "bb-wire-priority";
    mounted.setBreadboardHoleStudy({
      enabled: true,
      profileId: holeAcceptedProfile,
      selectedHoleId: null,
      onHoleSelect,
    });
    const holeCountBeforeCommittedWirePriority = holeSelectEvents.length;
    resetCameraForTerminalProjection(canvas);
    const committedWirePoint = projectedCommittedWirePoint(
      canvas, layout, sampleCircuit.wires[0], 0
    );
    const wireCountBeforeInspect = canvas.dataset.labWireCount;
    const wireRevisionBeforeInspect = canvas.dataset.labWireGeometryRevision;
    const wireStateBeforeInspect = mounted.getLabViewState();
    dispatchScenePointer(canvas, "pointerdown", committedWirePoint, 930, "mouse");
    dispatchScenePointer(canvas, "pointerup", committedWirePoint, 930, "mouse");
    const committedInspect = wireInspectEvents.at(-1);
    const wireStateAfterInspect = mounted.getLabViewState();
    check("committed-wire-pointer-tap-inspects-current-canonical-wire",
      wireInspectEvents.length === 1 &&
      committedInspect?.wireId === committedWireId &&
      committedInspect?.meta?.source === "pointer" &&
      committedInspect?.meta?.physicalVerified === false &&
      Object.isFrozen(committedInspect.meta) &&
      Object.keys(committedInspect.meta).sort().join(",") === "physicalVerified,source" &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints");
    check("committed-wire-pointer-inspection-is-visual-only",
      canvas.dataset.labWireCount === wireCountBeforeInspect &&
      canvas.dataset.labWireGeometryRevision === wireRevisionBeforeInspect &&
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none" &&
      wireInspectTerminalEvents.length === 0 &&
      wireInspectComponentEvents.length === 0 &&
      wireInspectLinkEvents.length === 0 &&
      wireStateAfterInspect.selectedComponentId === wireStateBeforeInspect.selectedComponentId &&
      wireStateAfterInspect.focusedComponentId === wireStateBeforeInspect.focusedComponentId &&
      JSON.stringify(wireStateAfterInspect.camera) === JSON.stringify(wireStateBeforeInspect.camera));
    check("breadboard-hole-study-does-not-steal-committed-wire-priority",
      holeSelectEvents.length === holeCountBeforeCommittedWirePriority &&
      wireInspectEvents.length === 1 &&
      canvas.dataset.labBreadboardHoleStudyMode === "conceptual-strip-study" &&
      canvas.dataset.labHighlightedWire === committedWireId);
    mounted.setBreadboardHoleStudy({ enabled: false });

    const inspectCountBeforeAltPointers = wireInspectEvents.length;
    for (const [pointerType, pointerId] of [["touch", 944], ["pen", 945]]) {
      dispatchScenePointer(canvas, "pointerdown", committedWirePoint, pointerId, pointerType);
      dispatchScenePointer(canvas, "pointerup", committedWirePoint, pointerId, pointerType);
    }
    check("committed-wire-pointer-tap-supports-touch-and-pen-without-connect-action",
      wireInspectEvents.length === inspectCountBeforeAltPointers + 2 &&
      wireInspectEvents.slice(-2).every(item =>
        item.wireId === committedWireId &&
        item.meta?.source === "pointer" &&
        item.meta?.physicalVerified === false &&
        Object.isFrozen(item.meta)
      ) &&
      wireInspectLinkEvents.length === 0 &&
      canvas.dataset.labWireCount === wireCountBeforeInspect &&
      canvas.dataset.labWireGeometryRevision === wireRevisionBeforeInspect);

    mounted.setPendingWireTerminal("D13");
    const inspectCountBeforePendingSeparation = wireInspectEvents.length;
    const linkCountBeforePendingSeparation = wireInspectLinkEvents.length;
    dispatchScenePointer(canvas, "pointerdown", committedWirePoint, 942, "mouse");
    dispatchScenePointer(canvas, "pointerup", committedWirePoint, 942, "mouse");
    check("committed-wire-inspection-stays-separate-from-two-tap-pending-preview",
      wireInspectEvents.length === inspectCountBeforePendingSeparation + 1 &&
      wireInspectLinkEvents.length === linkCountBeforePendingSeparation &&
      canvas.dataset.labPendingWireTerminal === "D13" &&
      canvas.dataset.labPendingWirePreview === "none" &&
      canvas.dataset.labWireCount === wireCountBeforeInspect &&
      canvas.dataset.labWireGeometryRevision === wireRevisionBeforeInspect);
    mounted.setPendingWireTerminal(null);

    const inspectCountBeforeTerminalPriority = wireInspectEvents.length;
    const terminalCountBeforeWirePriority = wireInspectTerminalEvents.length;
    const priorityTerminalPoint = findTerminalPoint(canvas, layout, "D13", 931);
    dispatchScenePointer(canvas, "pointerdown", priorityTerminalPoint, 932, "touch");
    dispatchScenePointer(canvas, "pointerup", priorityTerminalPoint, 932, "touch");
    check("committed-wire-inspection-does-not-steal-terminal-tap-priority",
      wireInspectEvents.length === inspectCountBeforeTerminalPriority &&
      wireInspectTerminalEvents.length === terminalCountBeforeWirePriority + 1 &&
      wireInspectTerminalEvents.at(-1) === "D13");

    const inspectCountBeforeTerminalJitter = wireInspectEvents.length;
    const terminalCountBeforeWireJitter = wireInspectTerminalEvents.length;
    const priorityTerminalJitter = {
      clientX: priorityTerminalPoint.clientX + 11,
      clientY: priorityTerminalPoint.clientY,
    };
    dispatchScenePointer(canvas, "pointerdown", priorityTerminalPoint, 933, "touch");
    dispatchScenePointer(canvas, "pointermove", priorityTerminalJitter, 933, "touch");
    dispatchScenePointer(canvas, "pointerup", priorityTerminalJitter, 933, "touch");
    check("committed-wire-inspection-preserves-terminal-touch-jitter-tap",
      wireInspectEvents.length === inspectCountBeforeTerminalJitter &&
      wireInspectTerminalEvents.length === terminalCountBeforeWireJitter + 1);

    const inspectCountBeforeComponentPriority = wireInspectEvents.length;
    const componentCountBeforeWirePriority = wireInspectComponentEvents.length;
    const componentPriorityPoint = projectedComponentPoint(canvas, layout, "arduino");
    dispatchScenePointer(canvas, "pointerdown", componentPriorityPoint, 934, "mouse");
    dispatchScenePointer(canvas, "pointerup", componentPriorityPoint, 934, "mouse");
    check("committed-wire-inspection-does-not-steal-component-tap-priority",
      wireInspectEvents.length === inspectCountBeforeComponentPriority &&
      wireInspectComponentEvents.length === componentCountBeforeWirePriority + 1 &&
      wireInspectComponentEvents.at(-1) === "arduino");

    resetCameraForTerminalProjection(canvas);
    const cameraWirePoint = projectedCommittedWirePoint(canvas, layout, sampleCircuit.wires[0], 0);
    const inspectCountBeforeWireCameraDrag = wireInspectEvents.length;
    const cameraBeforeWireDrag = mounted.getLabViewState().camera;
    const cameraWireDragPoint = {
      clientX: cameraWirePoint.clientX + 24,
      clientY: cameraWirePoint.clientY + 8,
    };
    dispatchScenePointer(canvas, "pointerdown", cameraWirePoint, 935, "mouse");
    dispatchScenePointer(canvas, "pointermove", cameraWireDragPoint, 935, "mouse");
    dispatchScenePointer(canvas, "pointerup", cameraWireDragPoint, 935, "mouse");
    const cameraAfterWireDrag = mounted.getLabViewState().camera;
    check("committed-wire-pointer-drag-falls-through-to-camera-without-inspection",
      wireInspectEvents.length === inspectCountBeforeWireCameraDrag &&
      (cameraAfterWireDrag.theta !== cameraBeforeWireDrag.theta ||
        cameraAfterWireDrag.phi !== cameraBeforeWireDrag.phi));

    resetCameraForTerminalProjection(canvas);
    const cancelWirePoint = projectedCommittedWirePoint(canvas, layout, sampleCircuit.wires[0], 0);
    const inspectCountBeforeWireCancel = wireInspectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", cancelWirePoint, 936, "mouse");
    dispatchScenePointer(canvas, "pointercancel", cancelWirePoint, 936, "mouse");
    check("committed-wire-pointercancel-emits-no-inspection",
      wireInspectEvents.length === inspectCountBeforeWireCancel);
    dispatchScenePointer(canvas, "pointerdown", cancelWirePoint, 937, "pen");
    canvas.dispatchEvent(new PointerEvent("lostpointercapture", {
      pointerId: 937,
      pointerType: "pen",
      clientX: cancelWirePoint.clientX,
      clientY: cancelWirePoint.clientY,
      bubbles: true,
      cancelable: true,
    }));
    check("committed-wire-lostcapture-emits-no-inspection",
      wireInspectEvents.length === inspectCountBeforeWireCancel);

    const staleWirePoint = projectedCommittedWirePoint(canvas, layout, sampleCircuit.wires[0], 0);
    const inspectCountBeforeStaleIdentity = wireInspectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", staleWirePoint, 938, "mouse");
    const staleReplacementCircuit = connectCircuit(createCircuit(2), "D13", "GND");
    mounted.setWiring(staleReplacementCircuit, terminals);
    dispatchScenePointer(canvas, "pointerup", staleWirePoint, 938, "mouse");
    check("committed-wire-inspection-rejects-stale-same-id-different-endpoints",
      staleReplacementCircuit.wires[0].id === committedWireId &&
      wireInspectEvents.length === inspectCountBeforeStaleIdentity &&
      canvas.dataset.labHighlightedWire === "");

    mounted.setWiring(sampleCircuit, terminals);
    resetCameraForTerminalProjection(canvas);
    const prototypeWirePoint = projectedCommittedWirePoint(canvas, layout, sampleCircuit.wires[0], 0);
    const prototypeWireCircuit = {
      ...sampleCircuit,
      wires: sampleCircuit.wires.map((wire, index) =>
        index === 0 ? { ...wire, id: "constructor" } : wire
      ),
    };
    mounted.setWiring(prototypeWireCircuit, terminals);
    const inspectCountBeforePrototypeWire = wireInspectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", prototypeWirePoint, 939, "mouse");
    dispatchScenePointer(canvas, "pointerup", prototypeWirePoint, 939, "mouse");
    check("committed-wire-inspection-rejects-prototype-like-wire-id",
      wireInspectEvents.length === inspectCountBeforePrototypeWire &&
      canvas.dataset.labHighlightedWire === "");

    const whitespaceWireCircuit = {
      ...sampleCircuit,
      wires: sampleCircuit.wires.map((wire, index) =>
        index === 0 ? { ...wire, id: wire.id + " " } : wire
      ),
    };
    mounted.setWiring(whitespaceWireCircuit, terminals);
    const inspectCountBeforeWhitespaceWire = wireInspectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", prototypeWirePoint, 943, "mouse");
    dispatchScenePointer(canvas, "pointerup", prototypeWirePoint, 943, "mouse");
    check("committed-wire-inspection-rejects-nonexact-wire-id",
      wireInspectEvents.length === inspectCountBeforeWhitespaceWire &&
      canvas.dataset.labHighlightedWire === "");

    mounted.setWiring(sampleCircuit, terminals);
    resetCameraForTerminalProjection(canvas);
    const stageWirePoint = projectedCommittedWirePoint(canvas, layout, sampleCircuit.wires[0], 0);
    const inspectCountBeforeStageClearWire = wireInspectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", stageWirePoint, 940, "mouse");
    mounted.setLabLayout(null);
    dispatchScenePointer(canvas, "pointerup", stageWirePoint, 940, "mouse");
    check("committed-wire-inspection-stage-clear-cancels-stale-pointer",
      wireInspectEvents.length === inspectCountBeforeStageClearWire &&
      canvas.dataset.labHighlightedWire === "" &&
      canvas.dataset.labWireCount === "0");
    mounted.setLabLayout(layout);
    mounted.setWiring(sampleCircuit, terminals);
    resetCameraForTerminalProjection(canvas);
    const lessonWirePoint = projectedCommittedWirePoint(canvas, layout, sampleCircuit.wires[0], 0);
    const inspectCountBeforeLessonClearWire = wireInspectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", lessonWirePoint, 941, "mouse");
    mounted.setLesson({ id: 3 });
    dispatchScenePointer(canvas, "pointerup", lessonWirePoint, 941, "mouse");
    check("committed-wire-inspection-lesson-change-cancels-stale-pointer",
      wireInspectEvents.length === inspectCountBeforeLessonClearWire &&
      canvas.dataset.labHighlightedWire === "" &&
      canvas.dataset.labWireCount === "0");
    mounted.setLesson({ id: 2 });
    mounted.setLabLayout(layout);
    mounted.setWiring(sampleCircuit, terminals);
    mounted.setLabEdit({
      enabled: false,
      onSelectComponent: null,
      onTerminalSelect: null,
      onTerminalLink: null,
      onCommittedWireInspect: null,
    });

    const beforeWireHighlight = mounted.getLabViewState();
    const wireCountBeforeHighlight = canvas.dataset.labWireCount;
    const highlightedWire = mounted.setHighlightedLabWire(committedWireId);
    const afterWireHighlight = mounted.getLabViewState();
    check("highlighted-wire-visual-only-state",
      highlightedWire.active === true &&
      highlightedWire.wireId === committedWireId &&
      highlightedWire.mode === "committed-wire-highlight" &&
      highlightedWire.physicalVerified === false &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      /committed/.test(canvas.dataset.labTerminalContrastFeedback) &&
      canvas.dataset.labWireCount === wireCountBeforeHighlight &&
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none" &&
      afterWireHighlight.selectedComponentId === beforeWireHighlight.selectedComponentId &&
      afterWireHighlight.focusedComponentId === beforeWireHighlight.focusedComponentId &&
      JSON.stringify(afterWireHighlight.camera) === JSON.stringify(beforeWireHighlight.camera));

    const committedGuideWireCount = canvas.dataset.labWireCount;
    const committedGuideRevision = canvas.dataset.labWireGeometryRevision;
    const committedGuide = mounted.setAuthoredPairGuide(guidePair);
    check("authored-pair-guide-coexists-with-committed-wire-without-authority",
      committedGuide.active === true &&
      committedGuide.mode === "view-only" &&
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      canvas.dataset.labWireCount === committedGuideWireCount &&
      canvas.dataset.labWireGeometryRevision === committedGuideRevision &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2);
    const guideModeBeforeWiringRefresh = canvas.dataset.labAuthoredGuideMode;
    const guideFromBeforeWiringRefresh = canvas.dataset.labAuthoredGuideFrom;
    const guideToBeforeWiringRefresh = canvas.dataset.labAuthoredGuideTo;
    mounted.setWiring(sampleCircuit, terminals);
    check("authored-pair-guide-survives-setWiring-projection-after-guide-mount",
      guideModeBeforeWiringRefresh === "view-only" &&
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labAuthoredGuideFrom === guideFromBeforeWiringRefresh &&
      canvas.dataset.labAuthoredGuideTo === guideToBeforeWiringRefresh &&
      canvas.dataset.labWireCount === String(sampleCircuit.wires.length) &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      canvas.dataset.labPendingWirePreview === "none");
    mounted.setAuthoredPairGuide(null);
    check("clearing-authored-pair-guide-preserves-committed-wire-state",
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireCount === committedGuideWireCount &&
      canvas.dataset.labWireGeometryRevision === committedGuideRevision);

    for (const badWireId of ["w1 ", "X".repeat(81), "w999999"]) {
      let rejected = false;
      try { mounted.setHighlightedLabWire(badWireId); }
      catch (error) { rejected = error instanceof TypeError || error instanceof RangeError; }
      check("highlighted-wire-invalid-id-transactional-" + badWireId.length,
        rejected && canvas.dataset.labHighlightedWire === committedWireId);
    }

    mounted.setWiring(sampleCircuit, terminals);
    check("highlighted-wire-survives-canonical-refresh-when-id-remains",
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment");
    const reversedSameIdentity = connectCircuit(createCircuit(2), "R1:A", "D13");
    mounted.setWiring(reversedSameIdentity, terminals);
    check("highlighted-wire-preserves-unordered-endpoint-identity",
      reversedSameIdentity.wires[0].id === committedWireId &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      Number(canvas.dataset.labWireCount) === 1);
    mounted.setWiring(sampleCircuit, terminals);

    const resistorBeforeLayoutMove = layout.components.find(component => component.id === "R1");
    const movedLayout = moveLabComponent(
      layout,
      "R1",
      layout.bounds.maxX,
      layout.bounds.maxZ,
    );
    const resistorAfterLayoutMove = movedLayout.components.find(component => component.id === "R1");
    const revisionBeforeLayoutMove = Number(canvas.dataset.labWireGeometryRevision);
    mounted.setLabLayout(movedLayout);
    const revisionAfterLayoutMove = Number(canvas.dataset.labWireGeometryRevision);
    check("highlighted-wire-survives-same-lesson-layout-move-rebuild",
      resistorAfterLayoutMove && resistorBeforeLayoutMove &&
      (resistorAfterLayoutMove.x !== resistorBeforeLayoutMove.x ||
        resistorAfterLayoutMove.z !== resistorBeforeLayoutMove.z) &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      canvas.dataset.labWireRoutePointCount === "8" &&
      revisionAfterLayoutMove > revisionBeforeLayoutMove);
    const rotatedLayout = rotateLabComponent(movedLayout, "R1", 1);
    mounted.setLabLayout(rotatedLayout);
    const revisionAfterLayoutRotate = Number(canvas.dataset.labWireGeometryRevision);
    check("highlighted-wire-survives-same-lesson-layout-rotate-rebuild",
      rotatedLayout.components.find(component => component.id === "R1")?.quarterTurns !==
        resistorAfterLayoutMove.quarterTurns &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      revisionAfterLayoutRotate > revisionAfterLayoutMove);
    check("wire-geometry-revision-strictly-increases-through-layout-move-rotate",
      revisionBeforeLayoutMove < revisionAfterLayoutMove &&
      revisionAfterLayoutMove < revisionAfterLayoutRotate);
    mounted.setLabLayout(layout);
    check("highlighted-wire-survives-same-lesson-layout-restore-rebuild",
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireRoutePointCount === "8");

    const sameIdDifferentEndpoints = connectCircuit(createCircuit(2), "D13", "GND");
    check("highlight-fixture-reuses-id-with-different-endpoints",
      sameIdDifferentEndpoints.wires[0].id === committedWireId &&
      !(
        sameIdDifferentEndpoints.wires[0].from === sampleCircuit.wires[0].from &&
        sameIdDifferentEndpoints.wires[0].to === sampleCircuit.wires[0].to
      ));
    mounted.setWiring(sameIdDifferentEndpoints, terminals);
    check("highlighted-wire-clears-on-same-id-different-endpoints",
      canvas.dataset.labHighlightedWire === "" &&
      Number(canvas.dataset.labWireCount) === 1 &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment");

    mounted.setWiring(sampleCircuit, terminals);
    mounted.setHighlightedLabWire(committedWireId);
    const withoutHighlightedWire = disconnectCircuit(sampleCircuit, committedWireId);
    mounted.setWiring(withoutHighlightedWire, terminals);
    check("highlighted-wire-clears-when-canonical-wire-removed",
      canvas.dataset.labHighlightedWire === "" &&
      Number(canvas.dataset.labWireCount) === withoutHighlightedWire.wires.length);
    const clearedWireHighlight = mounted.setHighlightedLabWire(null);
    check("highlighted-wire-null-clear-idempotent",
      clearedWireHighlight.active === false &&
      clearedWireHighlight.mode === "none" &&
      canvas.dataset.labHighlightedWire === "");
    mounted.setWiring(sampleCircuit, terminals);
    mounted.setHighlightedLabWire(committedWireId);
    check("wiring-clear-fixture-has-committed-endpoint-feedback",
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      /committed/.test(canvas.dataset.labTerminalContrastFeedback));
    mounted.setWiring(null);
    check("clearing-wiring-clears-committed-route-metadata",
      canvas.dataset.labWireCount === "0" &&
      canvas.dataset.labWireRouteMode === "none" &&
      canvas.dataset.labWireRoutePointCount === "0" &&
      canvas.dataset.labHighlightedWire === "" &&
      canvas.dataset.labWireHighlightFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labTerminalContrastFeedback === "none");

    let pendingOutsideEditRejected = false;
    try { mounted.setPendingWireTerminal("D13"); }
    catch (error) { pendingOutsideEditRejected = error instanceof RangeError; }
    check("pending-wire-requires-edit-mode",
      pendingOutsideEditRejected &&
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none");
    const clearedOutsideEdit = mounted.setPendingWireTerminal(null);
    check("pending-wire-null-clear-is-idempotent-outside-edit",
      clearedOutsideEdit.active === false &&
      clearedOutsideEdit.mode === "none" &&
      canvas.dataset.labPendingWireTerminal === "");

    const beforeInspectionState = mounted.getLabViewState();
    const wireCountBeforeInspection = canvas.dataset.labWireCount;
    const inspected = mounted.setInspectedTerminal("D13");
    const afterInspectionState = mounted.getLabViewState();
    check("inspection-read-only-dataset",
      inspected.active === true &&
      inspected.terminalId === "D13" &&
      inspected.mode === "lab-halo" &&
      inspected.physicalVerified === false &&
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "highlight");
    check("inspection-does-not-focus-or-select",
      afterInspectionState.focusedComponentId === beforeInspectionState.focusedComponentId &&
      afterInspectionState.selectedComponentId === beforeInspectionState.selectedComponentId &&
      JSON.stringify(afterInspectionState.camera) === JSON.stringify(beforeInspectionState.camera));
    check("inspection-does-not-create-wire-or-electrical-claim",
      canvas.dataset.labWireCount === wireCountBeforeInspection &&
      afterInspectionState.claims.physicalVerified === false &&
      afterInspectionState.claims.breadboardHoleMapping === false &&
      afterInspectionState.claims.electricalPower === false);

    let unknownInspectionRejected = false;
    try { mounted.setInspectedTerminal("NOT_A_TERMINAL"); }
    catch (error) { unknownInspectionRejected = error instanceof RangeError; }
    check("inspection-unknown-id-is-transactional",
      unknownInspectionRejected &&
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "highlight");

    let oversizedInspectionRejected = false;
    try { mounted.setInspectedTerminal("X".repeat(81)); }
    catch (error) { oversizedInspectionRejected = error instanceof RangeError; }
    check("inspection-id-is-bounded",
      oversizedInspectionRejected && canvas.dataset.labInspectedTerminal === "D13");

    const clearedInspection = mounted.setInspectedTerminal(null);
    check("inspection-null-clears",
      clearedInspection.active === false &&
      clearedInspection.terminalId === null &&
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");

    mounted.setInspectedTerminal("D13");
    mounted.setLabLayout(layout);
    check("layout-refresh-clears-inspection",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");

    const editTerminalEvents = [];
    mounted.setInspectedTerminal("D13");
    mounted.setLabEdit({
      enabled: true,
      selectedComponentId: "arduino",
      onTerminalSelect: id => editTerminalEvents.push(id),
    });
    check("edit-transition-clears-inspection",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");
    check("lab-selection-feedback-metadata",
      canvas.dataset.labSelectionFeedback === "outline" &&
      canvas.dataset.labTerminalFeedback === "selected-component" &&
      Number(canvas.dataset.labTerminalHighlightCount) > 0);
    const beforePendingState = mounted.getLabViewState();
    const wireCountBeforePending = canvas.dataset.labWireCount;
    const pending = mounted.setPendingWireTerminal("D13");
    const afterPendingState = mounted.getLabViewState();
    check("pending-wire-first-terminal-visual-prompt",
      pending.active === true &&
      pending.terminalId === "D13" &&
      pending.mode === "first-terminal-preview" &&
      pending.physicalVerified === false &&
      canvas.dataset.labPendingWireTerminal === "D13" &&
      canvas.dataset.labPendingWirePreview === "none" &&
      canvas.dataset.labTerminalLabelFeedback === "pending" &&
      /pending/.test(canvas.dataset.labTerminalContrastFeedback) &&
      !/committed/.test(canvas.dataset.labTerminalContrastFeedback) &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 0 &&
      /D13/.test(canvas.getAttribute("aria-label") || "") &&
      /chưa tạo dây/i.test(canvas.getAttribute("aria-label") || ""));
    check("pending-wire-prompt-is-visual-only",
      editTerminalEvents.length === 0 &&
      canvas.dataset.labWireCount === wireCountBeforePending &&
      afterPendingState.selectedComponentId === beforePendingState.selectedComponentId &&
      afterPendingState.focusedComponentId === beforePendingState.focusedComponentId &&
      JSON.stringify(afterPendingState.camera) === JSON.stringify(beforePendingState.camera) &&
      afterPendingState.claims.physicalVerified === false &&
      afterPendingState.claims.breadboardHoleMapping === false &&
      afterPendingState.claims.electricalPower === false);

    let invalidPendingRejected = false;
    try { mounted.setPendingWireTerminal("NOT_A_TERMINAL"); }
    catch (error) { invalidPendingRejected = error instanceof RangeError; }
    check("pending-wire-invalid-id-is-transactional",
      invalidPendingRejected &&
      canvas.dataset.labPendingWireTerminal === "D13" &&
      canvas.dataset.labPendingWirePreview === "none" &&
      /pending/.test(canvas.dataset.labTerminalContrastFeedback) &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 0);

    mounted.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    check("pending-wire-survives-same-edit-state-refresh",
      canvas.dataset.labPendingWireTerminal === "D13");
    mounted.setInspectedTerminal("D13");
    check("inspection-feedback-distinct-from-edit-feedback",
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "highlight" &&
      canvas.dataset.labTerminalFeedback === "selected-component" &&
      canvas.dataset.labSelectedComponent === "arduino" &&
      canvas.dataset.labPendingWireTerminal === "D13" &&
      canvas.dataset.labTerminalLabelFeedback === "pending" &&
      editTerminalEvents.length === 0);
    mounted.setPendingWireTerminal(null);
    check("inspection-terminal-label-feedback-after-pending-clears",
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labTerminalLabelFeedback === "inspection" &&
      /inspection/.test(canvas.dataset.labTerminalContrastFeedback) &&
      !/committed/.test(canvas.dataset.labTerminalContrastFeedback));
    mounted.setPendingWireTerminal("D13");
    mounted.focusLabComponent("arduino");
    check("lab-focus-feedback-metadata", canvas.dataset.labFocusFeedback === "outline");

    let invalidSelectionRejected = false;
    try { mounted.setLabEdit({ enabled: false, selectedComponentId: "missing-component" }); }
    catch (error) { invalidSelectionRejected = error instanceof RangeError; }
    check("invalid-selection-is-transactional",
      invalidSelectionRejected &&
      canvas.dataset.labEdit === "on" &&
      canvas.dataset.labSelectedComponent === "arduino");
    mounted.focusLabComponent(null);
    check("lab-focus-feedback-clears", canvas.dataset.labFocusFeedback === "none");
    mounted.setLabEdit({ enabled: false });
    check("edit-exit-clears-inspection",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");
    check("edit-exit-clears-pending-wire-preview",
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWireHoverTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none");
    mounted.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    mounted.setWiring(sampleCircuit, terminals);
    mounted.setHighlightedLabWire(committedWireId);
    mounted.setPendingWireTerminal("D13");
    check("pending-and-committed-feedback-compose-before-stage-clear",
      /pending/.test(canvas.dataset.labTerminalContrastFeedback) &&
      /committed/.test(canvas.dataset.labTerminalContrastFeedback) &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2);
    mounted.setLabLayout(null);
    check("layout-stage-clear-resets-pending-wire-preview",
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWireHoverTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none");
    check("layout-stage-clear-resets-highlighted-wire",
      canvas.dataset.labHighlightedWire === "" &&
      canvas.dataset.labWireRouteMode === "none" &&
      canvas.dataset.labWireRoutePointCount === "0" &&
      canvas.dataset.labWireGeometryRevision === "0" &&
      canvas.dataset.labWireHighlightFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labTerminalContrastFeedback === "none");
    let highlightAfterStageClearRejected = false;
    try { mounted.setHighlightedLabWire(committedWireId); }
    catch (error) { highlightAfterStageClearRejected = error instanceof RangeError; }
    check("highlighted-wire-rejected-after-stage-layout-clear",
      highlightAfterStageClearRejected && canvas.dataset.labHighlightedWire === "");
    mounted.setWiring(null);
    mounted.setLabEdit({ enabled: false });
    const readOnlyBeforeContext = mounted.setInspectedTerminal("D13", layout);
    check("read-only-label-before-context-loss",
      readOnlyBeforeContext.mode === "read-only-label" &&
      canvas.dataset.labInspectionFeedback === "label" &&
      readOnlyBadge.hidden === false);

    flushFrames();
    const gl = canvas.getContext("webgl2");
    const contextExtension = gl?.getExtension("WEBGL_lose_context");
    const lostPromise = waitEvent(canvas, "webglcontextlost");
    if (contextExtension) contextExtension.loseContext();
    else canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const lost = await lostPromise;
    check("context-loss-cancelled", lost.defaultPrevented);
    check("context-loss-accessibility-state",
      canvas.dataset.sceneContext === "lost" && canvas.getAttribute("aria-busy") === "true");
    check("context-loss-preserves-read-only-inspection",
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "label" &&
      readOnlyBadge.hidden === false);
    mounted.control("left");
    check("context-loss-pauses-render", queuedFrames.size === 0);
    // Restoration is only allowed after the cancelable context-lost event has
    // fully returned to the browser event loop.
    await waitTask();
    const restoredPromise = waitEvent(canvas, "webglcontextrestored");
    if (contextExtension) contextExtension.restoreContext();
    else canvas.dispatchEvent(new Event("webglcontextrestored"));
    await restoredPromise;
    check("context-restore-invalidates", queuedFrames.size === 1);
    check("context-restore-accessibility-state",
      canvas.dataset.sceneContext === "ready" && !canvas.hasAttribute("aria-busy"));
    check("context-restore-preserves-read-only-inspection",
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "label" &&
      readOnlyBadge.hidden === false);
    flushFrames();

    mounted.setLesson({ id: 3 });
    check("lesson-change-clears-inspection",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");
    const layout3 = createLabLayout(3, listTerminals(3));
    let staleInspectionRejected = false;
    try { mounted.setInspectedTerminal("D13", layout); }
    catch (error) { staleInspectionRejected = error instanceof RangeError; }
    check("stale-terminal-rejected-after-lesson-layout-change",
      staleInspectionRejected &&
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");
    const lesson3ReadOnly = mounted.setInspectedTerminal("D2", layout3);
    check("new-lesson-read-only-layout-accepted",
      lesson3ReadOnly.mode === "read-only-label" &&
      canvas.dataset.labInspectedTerminal === "D2" &&
      canvas.dataset.labInspectionFeedback === "label");

    mounted.setLesson({ id: 2 });
    mounted.setLabLayout(layout);
    const guideBeforeDispose = mounted.setAuthoredPairGuide(guidePair);
    check("dispose-authored-guide-fixture-is-active",
      guideBeforeDispose.active === true &&
      canvas.dataset.labAuthoredGuideMode === "view-only");

    mounted.dispose();
    mounted = null;
    check("dispose-removes-canvas", !canvas.isConnected && !host.querySelector("canvas"));
    check("dispose-cancels-render", queuedFrames.size === 0);
    check("dispose-clears-inspection-metadata",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none" &&
      !readOnlyBadge.isConnected);
    check("dispose-clears-pending-wire-metadata",
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWireHoverTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none");
    check("dispose-clears-highlighted-wire-metadata",
      canvas.dataset.labHighlightedWire === "" &&
      canvas.dataset.labWireRouteMode === "none" &&
      canvas.dataset.labWireRoutePointCount === "0" &&
      canvas.dataset.labWireGeometryRevision === "0" &&
      canvas.dataset.labWireHighlightFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labTerminalContrastFeedback === "none");
    check("dispose-clears-authored-pair-guide-metadata",
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    check("dispose-detaches-context-listeners", queuedFrames.size === 0);

    host.remove();
    host = makeHost();
    const remount = mountScene(host);
    await waitTask();
    flushFrames();
    check("remount-after-dispose", host.querySelectorAll("canvas").length === 1);
    const remountCanvas = host.querySelector("canvas");
    const disposeLinkEvents = [];
    remountCanvas.setPointerCapture = () => {};
    remountCanvas.releasePointerCapture = () => {};
    remount.setLesson({ id: 2 });
    remount.setLabLayout(layout);
    remount.setLabEdit({
      enabled: true,
      selectedComponentId: "arduino",
      onTerminalLink: (fromId, toId, meta) => disposeLinkEvents.push({ fromId, toId, meta }),
    });
    resetCameraForTerminalProjection(remountCanvas);
    const disposeSourcePoint = findTerminalPoint(remountCanvas, layout, "D13", 901);
    const disposeTargetPoint = findTerminalPoint(remountCanvas, layout, "R1:A", 902);
    dispatchScenePointer(remountCanvas, "pointerdown", disposeSourcePoint, 903, "mouse");
    dispatchScenePointer(remountCanvas, "pointermove", disposeTargetPoint, 903, "mouse");
    check("dispose-terminal-drag-fixture-has-active-ghost",
      remountCanvas.dataset.labTerminalDragPreview === "ghost" &&
      remountCanvas.dataset.labTerminalDragTarget === "R1:A");
    remount.dispose();
    check("dispose-clears-terminal-drag-without-callback",
      disposeLinkEvents.length === 0 &&
      remountCanvas.dataset.labTerminalDragSource === "" &&
      remountCanvas.dataset.labTerminalDragTarget === "" &&
      remountCanvas.dataset.labTerminalDragPreview === "none");

    host.remove();
    host = makeHost();
    const guideLoss = mountScene(host);
    await waitTask();
    flushFrames();
    const guideLossCanvas = host.querySelector("canvas");
    guideLoss.setLesson({ id: 2 });
    guideLoss.setLabLayout(layout);
    const guideLossResult = guideLoss.setAuthoredPairGuide(guidePair);
    check("context-loss-authored-guide-fixture-is-active",
      guideLossResult.active === true &&
      guideLossCanvas.dataset.labAuthoredGuideMode === "view-only" &&
      guideLossCanvas.dataset.labAuthoredGuideFrom === "D13" &&
      guideLossCanvas.dataset.labAuthoredGuideTo === "R1:A");
    const guideGl = guideLossCanvas.getContext("webgl2");
    const guideContextExtension = guideGl?.getExtension("WEBGL_lose_context");
    const guideLostPromise = waitEvent(guideLossCanvas, "webglcontextlost");
    if (guideContextExtension) guideContextExtension.loseContext();
    else guideLossCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await guideLostPromise;
    check("context-loss-clears-authored-guide-public-state",
      guideLossCanvas.dataset.sceneContext === "lost" &&
      guideLossCanvas.dataset.labAuthoredGuideMode === "none" &&
      guideLossCanvas.dataset.labAuthoredGuideFrom === "" &&
      guideLossCanvas.dataset.labAuthoredGuideTo === "");
    await waitTask();
    const guideRestoredPromise = waitEvent(guideLossCanvas, "webglcontextrestored");
    if (guideContextExtension) guideContextExtension.restoreContext();
    else guideLossCanvas.dispatchEvent(new Event("webglcontextrestored"));
    await guideRestoredPromise;
    check("context-restore-revalidates-and-rebuilds-authored-guide",
      guideLossCanvas.dataset.sceneContext === "ready" &&
      guideLossCanvas.dataset.labAuthoredGuideMode === "view-only" &&
      guideLossCanvas.dataset.labAuthoredGuideFrom === "D13" &&
      guideLossCanvas.dataset.labAuthoredGuideTo === "R1:A" &&
      guideLossCanvas.dataset.labWireCount === "0" &&
      guideLossCanvas.dataset.labPendingWirePreview === "none");
    flushFrames();
    await waitTask();
    const guideLostAgainPromise = waitEvent(guideLossCanvas, "webglcontextlost");
    if (guideContextExtension) guideContextExtension.loseContext();
    else guideLossCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await guideLostAgainPromise;
    const explicitGuideClearWhileLost = guideLoss.setAuthoredPairGuide(null);
    check("context-loss-explicit-null-clears-authored-guide-restore-candidate",
      Object.isFrozen(explicitGuideClearWhileLost) &&
      explicitGuideClearWhileLost.active === false &&
      explicitGuideClearWhileLost.mode === "none" &&
      guideLossCanvas.dataset.labAuthoredGuideMode === "none" &&
      guideLossCanvas.dataset.labAuthoredGuideFrom === "" &&
      guideLossCanvas.dataset.labAuthoredGuideTo === "");
    await waitTask();
    const guideRestoredAfterClearPromise = waitEvent(guideLossCanvas, "webglcontextrestored");
    if (guideContextExtension) guideContextExtension.restoreContext();
    else guideLossCanvas.dispatchEvent(new Event("webglcontextrestored"));
    await guideRestoredAfterClearPromise;
    check("context-restore-does-not-resurrect-explicitly-cleared-authored-guide",
      guideLossCanvas.dataset.sceneContext === "ready" &&
      guideLossCanvas.dataset.labAuthoredGuideMode === "none" &&
      guideLossCanvas.dataset.labAuthoredGuideFrom === "" &&
      guideLossCanvas.dataset.labAuthoredGuideTo === "");
    flushFrames();
    guideLoss.dispose();

    host.remove();
    host = makeHost();
    const holeLoss = mountScene(host);
    await waitTask();
    flushFrames();
    const holeLossCanvas = host.querySelector("canvas");
    holeLossCanvas.setPointerCapture = () => {};
    holeLossCanvas.releasePointerCapture = () => {};
    const holeLossEvents = [];
    holeLoss.setLesson({ id: 2 });
    holeLoss.setLabLayout(layout);
    holeLoss.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    holeLoss.setBreadboardHoleStudy({
      enabled: true,
      profileId: "context-hole-study",
      selectedHoleId: null,
      onHoleSelect: (holeId, meta) => {
        holeLossEvents.push({ holeId, meta });
        return {
          accepted: true,
          selection: { lessonId: 2, profileId: "context-hole-study", holeId },
        };
      },
    });
    resetCameraForTerminalProjection(holeLossCanvas);
    const holeLossPoint = projectedBreadboardStudyHolePoint(
      holeLossCanvas, layout, "F33"
    );
    dispatchScenePointer(holeLossCanvas, "pointerdown", holeLossPoint, 952, "mouse");
    check("context-loss-breadboard-hole-study-fixture-is-active",
      holeLossCanvas.dataset.labBreadboardHoleStudyMode === "conceptual-strip-study" &&
      holeLossCanvas.dataset.labBreadboardHoleCount === "630");
    const holeLossGl = holeLossCanvas.getContext("webgl2");
    const holeLossExtension = holeLossGl?.getExtension("WEBGL_lose_context");
    const holeLossPromise = waitEvent(holeLossCanvas, "webglcontextlost");
    if (holeLossExtension) holeLossExtension.loseContext();
    else holeLossCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await holeLossPromise;
    dispatchScenePointer(holeLossCanvas, "pointerup", holeLossPoint, 952, "mouse");
    check("context-loss-resets-breadboard-hole-study-and-cancels-pointer",
      holeLossEvents.length === 0 &&
      holeLossCanvas.dataset.sceneContext === "lost" &&
      holeLossCanvas.dataset.labBreadboardHoleStudyMode === "none" &&
      holeLossCanvas.dataset.labBreadboardHoleSelected === "" &&
      holeLossCanvas.dataset.labBreadboardHoleCount === "0");
    const disabledAfterHoleLoss = holeLoss.setBreadboardHoleStudy({
      enabled: false,
      profileId: { ignored: true },
      selectedHoleId: "ignored",
      onHoleSelect: "ignored",
    });
    check("breadboard-hole-study-disabled-remains-harmless-during-context-loss",
      disabledAfterHoleLoss.ok === true &&
      disabledAfterHoleLoss.enabled === false &&
      disabledAfterHoleLoss.active === false &&
      disabledAfterHoleLoss.mode === "none");
    await waitTask();
    const holeRestorePromise = waitEvent(holeLossCanvas, "webglcontextrestored");
    if (holeLossExtension) holeLossExtension.restoreContext();
    else holeLossCanvas.dispatchEvent(new Event("webglcontextrestored"));
    await holeRestorePromise;
    check("context-restore-does-not-resurrect-breadboard-hole-study",
      holeLossEvents.length === 0 &&
      holeLossCanvas.dataset.sceneContext === "ready" &&
      holeLossCanvas.dataset.labBreadboardHoleStudyMode === "none" &&
      holeLossCanvas.dataset.labBreadboardHoleCount === "0");
    flushFrames();
    holeLoss.setBreadboardHoleStudy({
      enabled: true,
      profileId: "dispose-hole-study",
      selectedHoleId: null,
      onHoleSelect: (holeId, meta) => {
        holeLossEvents.push({ holeId, meta });
        return {
          accepted: true,
          selection: { lessonId: 2, profileId: "dispose-hole-study", holeId },
        };
      },
    });
    resetCameraForTerminalProjection(holeLossCanvas);
    const holeDisposePoint = projectedBreadboardStudyHolePoint(
      holeLossCanvas, layout, "G34"
    );
    dispatchScenePointer(holeLossCanvas, "pointerdown", holeDisposePoint, 953, "touch");
    const holeEventsBeforeDispose = holeLossEvents.length;
    holeLoss.dispose();
    check("dispose-resets-breadboard-hole-study-and-cancels-pointer",
      holeLossEvents.length === holeEventsBeforeDispose &&
      holeLossCanvas.dataset.labBreadboardHoleStudyMode === "none" &&
      holeLossCanvas.dataset.labBreadboardHoleSelected === "" &&
      holeLossCanvas.dataset.labBreadboardHoleCount === "0" &&
      !holeLossCanvas.isConnected);

    host.remove();
    host = makeHost();
    const wireLoss = mountScene(host);
    await waitTask();
    flushFrames();
    const wireLossCanvas = host.querySelector("canvas");
    wireLossCanvas.setPointerCapture = () => {};
    wireLossCanvas.releasePointerCapture = () => {};
    const wireLossInspectEvents = [];
    wireLoss.setLesson({ id: 2 });
    wireLoss.setLabLayout(layout);
    wireLoss.setWiring(sampleCircuit, terminals);
    wireLoss.setLabEdit({
      enabled: true,
      onCommittedWireInspect: (wireId, meta) => wireLossInspectEvents.push({ wireId, meta }),
    });
    resetCameraForTerminalProjection(wireLossCanvas);
    const wireLossPoint = projectedCommittedWirePoint(
      wireLossCanvas, layout, sampleCircuit.wires[0], 0
    );
    dispatchScenePointer(wireLossCanvas, "pointerdown", wireLossPoint, 950, "mouse");
    const wireInspectGl = wireLossCanvas.getContext("webgl2");
    const wireInspectContextExtension = wireInspectGl?.getExtension("WEBGL_lose_context");
    const wireInspectLostPromise = waitEvent(wireLossCanvas, "webglcontextlost");
    if (wireInspectContextExtension) wireInspectContextExtension.loseContext();
    else wireLossCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await wireInspectLostPromise;
    dispatchScenePointer(wireLossCanvas, "pointerup", wireLossPoint, 950, "mouse");
    check("committed-wire-inspection-context-loss-cancels-stale-pointer",
      wireLossInspectEvents.length === 0 &&
      wireLossCanvas.dataset.sceneContext === "lost" &&
      wireLossCanvas.dataset.labHighlightedWire === "");
    await waitTask();
    const wireInspectRestoredPromise = waitEvent(wireLossCanvas, "webglcontextrestored");
    if (wireInspectContextExtension) wireInspectContextExtension.restoreContext();
    else wireLossCanvas.dispatchEvent(new Event("webglcontextrestored"));
    await wireInspectRestoredPromise;
    check("committed-wire-inspection-context-restore-does-not-replay-callback",
      wireLossInspectEvents.length === 0 &&
      wireLossCanvas.dataset.sceneContext === "ready");
    flushFrames();
    resetCameraForTerminalProjection(wireLossCanvas);
    const wireDisposePoint = projectedCommittedWirePoint(
      wireLossCanvas, layout, sampleCircuit.wires[0], 0
    );
    dispatchScenePointer(wireLossCanvas, "pointerdown", wireDisposePoint, 951, "mouse");
    wireLoss.dispose();
    check("committed-wire-inspection-dispose-cancels-stale-pointer",
      wireLossInspectEvents.length === 0 &&
      !wireLossCanvas.isConnected &&
      !host.querySelector("canvas"));

    host.remove();
    host = makeHost();
    const lossDispose = mountScene(host);
    await waitTask();
    flushFrames();
    const lossCanvas = host.querySelector("canvas");
    lossCanvas.setPointerCapture = () => {};
    lossCanvas.releasePointerCapture = () => {};
    const lossTerminalLinkEvents = [];
    lossDispose.setLesson({ id: 2 });
    lossDispose.setLabLayout(layout);
    lossDispose.setWiring(sampleCircuit, terminals);
    lossDispose.setHighlightedLabWire(committedWireId);
    lossDispose.setLabEdit({
      enabled: true,
      selectedComponentId: "arduino",
      onTerminalLink: (fromId, toId, meta) => lossTerminalLinkEvents.push({ fromId, toId, meta }),
    });
    resetCameraForTerminalProjection(lossCanvas);
    const lossSourcePoint = findTerminalPoint(lossCanvas, layout, "D13", 904);
    const lossTargetPoint = findTerminalPoint(lossCanvas, layout, "R1:A", 905);
    dispatchScenePointer(lossCanvas, "pointerdown", lossSourcePoint, 906, "mouse");
    dispatchScenePointer(lossCanvas, "pointermove", lossTargetPoint, 906, "mouse");
    check("lesson-change-terminal-drag-fixture-has-active-ghost",
      lossCanvas.dataset.labTerminalDragPreview === "ghost");
    lossDispose.setLesson({ id: 3 });
    check("lesson-change-clears-highlighted-wire",
      lossCanvas.dataset.labHighlightedWire === "" &&
      lossCanvas.dataset.labWireRouteMode === "none" &&
      lossCanvas.dataset.labWireRoutePointCount === "0" &&
      lossCanvas.dataset.labWireGeometryRevision === "0");
    check("lesson-change-cancels-terminal-drag-without-stale-callback",
      lossTerminalLinkEvents.length === 0 &&
      lossCanvas.dataset.labTerminalDragSource === "" &&
      lossCanvas.dataset.labTerminalDragTarget === "" &&
      lossCanvas.dataset.labTerminalDragPreview === "none");
    lossDispose.setLesson({ id: 2 });
    lossDispose.setLabLayout(layout);
    lossDispose.setWiring(sampleCircuit, terminals);
    lossDispose.setHighlightedLabWire(committedWireId);
    lossDispose.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    lossDispose.setPendingWireTerminal("D13");
    resetCameraForTerminalProjection(lossCanvas);
    const contextSourcePoint = findTerminalPoint(lossCanvas, layout, "D13", 907);
    const contextTargetPoint = findTerminalPoint(lossCanvas, layout, "R1:A", 908);
    dispatchScenePointer(lossCanvas, "pointerdown", contextSourcePoint, 909, "touch");
    dispatchScenePointer(lossCanvas, "pointermove", contextTargetPoint, 909, "touch");
    const revisionBeforeContextLoss = Number(lossCanvas.dataset.labWireGeometryRevision);
    check("pending-wire-armed-before-context-reset",
      lossCanvas.dataset.labPendingWireTerminal === "D13" &&
      lossCanvas.dataset.labPendingWirePreview === "none" &&
      lossCanvas.dataset.labHighlightedWire === committedWireId &&
      lossCanvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(lossCanvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      /pending/.test(lossCanvas.dataset.labTerminalContrastFeedback) &&
      /committed/.test(lossCanvas.dataset.labTerminalContrastFeedback) &&
      lossCanvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      revisionBeforeContextLoss > 0);
    check("terminal-drag-armed-before-context-reset",
      lossCanvas.dataset.labTerminalDragSource === "D13" &&
      lossCanvas.dataset.labTerminalDragTarget === "R1:A" &&
      lossCanvas.dataset.labTerminalDragPreview === "ghost");
    const linkCountBeforeContextLoss = lossTerminalLinkEvents.length;
    const lossGl = lossCanvas.getContext("webgl2");
    const lossExtension = lossGl?.getExtension("WEBGL_lose_context");
    const lossPromise = waitEvent(lossCanvas, "webglcontextlost");
    if (lossExtension) lossExtension.loseContext();
    else lossCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await lossPromise;
    check("context-reset-clears-pending-wire-preview",
      lossCanvas.dataset.labPendingWireTerminal === "" &&
      lossCanvas.dataset.labPendingWireHoverTerminal === "" &&
      lossCanvas.dataset.labPendingWirePreview === "none" &&
      !/Terminal đầu đang chờ nối/.test(lossCanvas.getAttribute("aria-label") || ""));
    check("context-reset-cancels-terminal-drag-without-callback",
      lossTerminalLinkEvents.length === linkCountBeforeContextLoss &&
      lossCanvas.dataset.labTerminalDragSource === "" &&
      lossCanvas.dataset.labTerminalDragTarget === "" &&
      lossCanvas.dataset.labTerminalDragPreview === "none");
    check("context-reset-clears-highlighted-wire",
      lossCanvas.dataset.labHighlightedWire === "" &&
      lossCanvas.dataset.labWireGeometryRevision === "0" &&
      lossCanvas.dataset.labWireHighlightFeedback === "none" &&
      lossCanvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      lossCanvas.dataset.labTerminalContrastFeedback === "none" &&
      !/Dây đang được đánh dấu/.test(lossCanvas.getAttribute("aria-label") || ""));
    lossDispose.dispose();
    check("dispose-while-context-lost-removes-canvas", !lossCanvas.isConnected && !host.querySelector("canvas"));
    check("dispose-while-context-lost-no-render", queuedFrames.size === 0);
  } finally {
    try { mounted?.dispose(); } catch {}
    host?.remove();
    queuedFrames.clear();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancelRaf;
  }

  return { total: results.length, passed: results.length, failed: 0, results };
}

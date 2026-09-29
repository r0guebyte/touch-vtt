import {MODULE_NAME} from "../config/ModuleConstants"
import FoundryCanvas from "../foundryvtt/FoundryCanvas"
import {injectMethodCondition, wrapMethod} from "../utils/Injection.js"
import {dispatchModifiedEvent} from "../logic/FakeTouchEvent.js"
import {getSetting, MEASUREMENT_HUD_LEFT, MEASUREMENT_HUD_OFF, MEASUREMENT_HUD_SETTING} from "../config/TouchSettings.js"
import {addSceneControlButton, ApplicationV1} from "../foundryvtt/FoundryUtils"

const TOOL_NAME_ERASE = "erase"

class TouchMeasuredTemplateHud extends ApplicationV1 {
  constructor({ touchPointerEventsManager, templateManager }) {
    super()

    this._touchPointerEventsManager = touchPointerEventsManager
    this._templateManager = templateManager
    this._worldPosition = null
    this._screenPosition = {}
    this._currentTemplate = null
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "touch-measured-template-hud",
      template: `/modules/${MODULE_NAME}/templates/measured-template-hud.hbs`,
      popOut: false,
      width: 200,
      height: 100,
      left: 150,
      top: 80,
      scale: 1,
      minimizable: false,
      resizable: false,
      dragDrop: [],
      tabs: [],
      scrollY: [],
    })
  }

  getData(...args) {
    const data = super.getData(...args)
    data.id = this.options.id
    data.top = this._screenPosition.top
    data.left = this._screenPosition.left
    data.offsetX = this.calcOffsetX()
    data.showRotate = true
    data.showConfirm = true
    data.showCancel = true
    return data
  }

  activateListeners(html) {
    html.find(".rotate").on("pointerdown", () => this._templateManager.onHudRotate(this._currentTemplate, this._screenPosition))
    html.find(".confirm").on("pointerdown", () => this._templateManager.onHudConfirm(this._screenPosition))
    html.find(".cancel").on("pointerdown", () => this._templateManager.onHudCancel(this._screenPosition))
  }

  async show(template) {
    this._currentTemplate = template
    const worldPosition = {x: template.document.x, y: template.document.y}
    if (this._templateManager._touchMode) {
      await this.showAt(FoundryCanvas.worldToScreen(worldPosition))
    }
  }

  // Shows the HUD at the given screen coordinates (used directly for v14+ Region placement)
  async showAt({x, y}) {
    this.setScreenPosition({
      left: x,
      top: y,
    })

    const states = this.constructor.RENDER_STATES
    await this.render(this._state <= states.NONE)

    this._touchPointerEventsManager.disableGestures()
  }

  clear() {
    const states = this.constructor.RENDER_STATES
    if (this._state <= states.NONE) return
    this._state = states.CLOSING

    this.element.hide()
    this._state = states.NONE

    this._touchPointerEventsManager.enableGestures()
  }

  setScreenPosition({top, left}) {
    this._screenPosition = { top, left }
  }

  calcOffsetX() {
    const offset = FoundryCanvas.worldToScreenLength(FoundryCanvas.gridSize) * 0.75
    if (getSetting(MEASUREMENT_HUD_SETTING) === MEASUREMENT_HUD_LEFT) {
      return `calc(-100% - ${offset}px)`
    } else {
      return `${offset}px`
    }
  }
}

export class MeasuredTemplateManager {

  constructor() {
    this._touchMode = false
    this._touchEventReplacer = this.touchEventReplacer.bind(this)
    // v14+: number of Region placements (canvas.regions.placeRegion/placeRegions) currently in progress
    this._activeRegionPlacements = 0
    this._forceShiftModifier = false
  }

  // v14 replaced Measured Templates with Scene Regions: templates are now placed through canvas.regions.placeRegion(s)
  get usesRegions() {
    return game.release.generation >= 14
  }

  get isPlacingRegion() {
    return this._activeRegionPlacements > 0
  }

  get templateLayerPath() {
    return game.release.generation < 13 ? "TemplateLayer" : "foundry.canvas.layers.TemplateLayer"
  }
  get measuredTemplatePath() {
    return game.release.generation < 13 ? "MeasuredTemplate" : "foundry.canvas.placeables.MeasuredTemplate"
  }

  initMeasuredTemplateHud(touchPointerEventsManager) {
    if (canvas.hud.touchMeasuredTemplate == null) {
      canvas.hud.touchMeasuredTemplate = new TouchMeasuredTemplateHud({ touchPointerEventsManager, templateManager: this })

      // v14+: the HUD is shown by the touch event replacer while a Region is being placed
      if (this.usesRegions) return

      wrapMethod(`${this.measuredTemplatePath}.prototype._applyRenderFlags`, function(originalMethod, flags) {
        if (flags.refreshPosition) {
          canvas.hud.touchMeasuredTemplate.show(this)
        }
        return originalMethod.call(this, flags)
      })
    }
  }

  touchEventReplacer(evt) {
    // An event gets here if the listeners have been activated; we replace them all with pointermove until the template is confirmed
    if (evt.isTrusted || evt.touchvttTrusted) {
      if (evt instanceof TouchEvent || evt instanceof PointerEvent && (["touch", "pen"].includes(evt.pointerType) || evt.touchvttTrusted)) {
        this._touchMode = true
      } else {
        this._touchMode = false
        return this.toggleMeasuredTemplateTouchManagementListeners(false)
      }
    }
    if (this._touchMode && (evt.isTrusted || evt.touchvttTrusted) && evt.target.tagName == "CANVAS") {
      evt.preventDefault()
      evt.stopPropagation()
      if (evt instanceof PointerEvent) {
        dispatchModifiedEvent(evt, "pointermove", {trusted: false, button: -1, buttons: 0})
        if (this.usesRegions && this.isPlacingRegion) {
          // Regions have no render hook we can rely on for the preview, so we just follow the finger
          canvas.hud.touchMeasuredTemplate?.showAt({x: evt.clientX, y: evt.clientY})
        }
      }
      return false
    } else {
      return true
    }
  }

  // HUD actions

  onHudRotate(template, screenPosition) {
    if (this.usesRegions) {
      // Region placement previews are rotated with the mouse wheel (while holding a rotation modifier)
      this._forceShiftModifier = true
      try {
        canvas.app.view.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true, view: window,
          clientX: screenPosition.left, clientY: screenPosition.top,
          deltaY: 100, deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          shiftKey: true,
        }))
      } finally {
        this._forceShiftModifier = false
      }
    } else {
      template.document.updateSource({direction: template.document.direction + 15})
      template.refresh()
    }
  }

  onHudConfirm(screenPosition) {
    this.toggleMeasuredTemplateTouchManagementListeners(false)
    this._touchMode = false
    // We send mousedown/mouseup events to be as close as possible to the expected behavior
    this.dispatchCanvasClick(screenPosition, 0)
    canvas.hud.touchMeasuredTemplate.clear()
    this.resumeRegionPlacement()
  }

  onHudCancel(screenPosition) {
    this.toggleMeasuredTemplateTouchManagementListeners(false)
    this._touchMode = false
    if (this.usesRegions) {
      // A right click skips the placement of the current Region shape
      this.dispatchCanvasClick(screenPosition, 2)
    } else {
      canvas.app.view.dispatchEvent(new MouseEvent("contextmenu", {clientX: 0, clientY: 0, bubbles: true, cancelable: true, view: window, button: 2}))
    }
    canvas.hud.touchMeasuredTemplate.clear()
    this.resumeRegionPlacement()
  }

  dispatchCanvasClick({left, top}, button) {
    const buttons = button === 2 ? 2 : 1
    canvas.app.view.dispatchEvent(new PointerEvent("pointerdown", {pointerType: "mouse", isPrimary: true, clientX: left, clientY: top, button, buttons}))
    canvas.app.view.dispatchEvent(new PointerEvent("pointerup", {pointerType: "mouse", isPrimary: true, clientX: left, clientY: top, button, buttons}))
  }

  // v14+: a placement can have multiple shapes/regions, so we keep listening if it's still going after a confirm/skip
  resumeRegionPlacement() {
    if (!this.usesRegions) return
    setTimeout(() => {
      if (this.isPlacingRegion) {
        this.toggleMeasuredTemplateTouchManagementListeners(true)
      }
    }, 0)
  }

  // Used by the isModifierActive wrapper, so that our fake wheel events are treated as rotations
  callbackForModifier(modifier) {
    return this._forceShiftModifier && ["SHIFT", "Shift"].includes(modifier)
  }

  toggleMeasuredTemplateTouchManagementListeners(activate = true) {
    // When active, we capture all relevant events to see if they need to be replaced
    if (activate) {
      ["pointerdown", "pointerup", "pointermove", "pointercancel", "touchstart", "touchmove", "touchend"].forEach(e => {
        window.document.addEventListener(e, this._touchEventReplacer, true)
      })
    } else {
      ["pointerdown", "pointerup", "pointermove", "pointercancel", "touchstart", "touchmove", "touchend"].forEach(e => {
        window.document.removeEventListener(e, this._touchEventReplacer, true)
      })
    }
  }

  onTemplatePreviewCreated(template) {
    if (this.isPremade(template)) {
      // This is a pre-made template that we want to place, so we activate our listeners
      this.toggleMeasuredTemplateTouchManagementListeners(true)
    }
  }

  initMeasuredTemplateManagement() {
    if (this.usesRegions) {
      return this.initRegionPlacementManagement()
    }

    const isEraserActive = () => game.activeTool === TOOL_NAME_ERASE
    const shouldIgnoreEvent = () => !isEraserActive() && !this._touchMode 

    injectMethodCondition(`${this.templateLayerPath}.prototype._onDragLeftStart`, shouldIgnoreEvent)
    injectMethodCondition(`${this.templateLayerPath}.prototype._onDragLeftMove`, shouldIgnoreEvent)
    injectMethodCondition(`${this.templateLayerPath}.prototype._onDragLeftDrop`, shouldIgnoreEvent)
    injectMethodCondition(`${this.templateLayerPath}.prototype._onDragLeftCancel`, shouldIgnoreEvent)

    wrapMethod(`${this.measuredTemplatePath}.prototype._onClickLeft`, function(callOriginal, ...args) {
      if (isEraserActive()) {
        this.document.delete()
        // v11 only: we dispatch a left click on the canvas because the template shape was lingering while dragging after the deletion
        if (game.release.generation < 12) {
          setTimeout(() => { canvas.app.view.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true, view: window, button: 2})) }, 0)
        }
      } else {
        callOriginal(...args)
      }
    }, "MIXED")
  }

  initRegionPlacementManagement() {
    const manager = this
    const regionLayerPath = "foundry.canvas.layers.RegionLayer"
    const regionLayer = foundry.canvas.layers.RegionLayer

    // placeRegion and placeRegions may call each other, so we just count how many placements are in progress
    const placementWrapper = async function(originalMethod, ...args) {
      manager._activeRegionPlacements++
      manager.toggleMeasuredTemplateTouchManagementListeners(true)
      try {
        return await originalMethod.call(this, ...args)
      } finally {
        manager._activeRegionPlacements--
        if (!manager.isPlacingRegion) {
          manager.toggleMeasuredTemplateTouchManagementListeners(false)
          manager._touchMode = false
          canvas.hud.touchMeasuredTemplate?.clear()
        }
      }
    }

    ;["placeRegion", "placeRegions"].forEach(method => {
      if (typeof regionLayer?.prototype[method] === "function") {
        wrapMethod(`${regionLayerPath}.prototype.${method}`, placementWrapper, "MIXED")
      }
    })
  }

  isPremade(template) {
    // Explaining the condition here for future reference:
    // A pre-made template doesn't have an id, and has a distance already set, usually larger than half a square.
    // A template created by dragging triggers two draws: on dragStart, it doesn't have an id and has distance 1 (in v11) or half a square (in v12); on confirmation, it has an id, and has a set distance
    // When you move an existing template, it doesn't have an id, and it has a set distance
    const gridSize = game.release.generation < 12 ? canvas.grid.grid.options.dimensions.distance : canvas.grid.distance
    return !template.id && template.document.distance > gridSize
  }

}

MeasuredTemplateManager.init = function init() {
  return new MeasuredTemplateManager()
}

export function installMeasurementTemplateEraser(menuStructure) {
  // v14+ has no Measured Template controls anymore (templates are Regions)
  if (game.release.generation >= 14) return
  addSceneControlButton(menuStructure, "templates", {
    name: TOOL_NAME_ERASE,
    title: "TOUCHVTT.Erase",
    icon: "fas fa-eraser"
  })
}

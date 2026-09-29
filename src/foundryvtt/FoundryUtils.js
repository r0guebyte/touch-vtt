export function addSceneControlButton(menuStructure, category, button) {
  let menuCategory
  if (game.release.generation <= 12) {
    menuCategory = menuStructure.find(c => c.layer === category)
    if (menuCategory) {
        menuCategory.tools.push(button)
    }
  } else {
    menuCategory = menuStructure[category]
    if (menuCategory) {
        menuCategory.tools[button.name] = button
    }
  }
}

// Application V1 classes are only namespaced from v13 on (global access is deprecated and goes away in later versions)
export const ApplicationV1 = foundry.appv1?.api?.Application ?? globalThis.Application
export const FormApplicationV1 = foundry.appv1?.api?.FormApplication ?? globalThis.FormApplication
export const DialogV1 = foundry.appv1?.api?.Dialog ?? globalThis.Dialog

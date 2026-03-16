// app.js
import {
  state, dom, qs, showToast, showStep,
  setupToggleGroup, getCurrentListName,
  resetPageSelection, resetWorkState,
  overlayToCanvasPoint, applyZoomTransform,
  generateFloorId, getCurrentFloorName
} from './core.js';

import {
  handleFile, renderWorkPage, renderExtractedList,
  updatePageControls, updateThumbnailStyles, updateModeButtons,
  drawUserLines, getDownloadFileName,
  executeCrop, pushUndoSnapshot, performUndo, updateUndoButton
} from './pdf-workflow.js';

import {
  getViewportCenterCanvasPoint,
  pasteEditClipboardAt, removeSelectedEditItem,
  setEditTool, syncDrawToolUi, renderEditOverlay,
  setupSelectedImageOverlayFrame, scheduleSelectedImageOverlayFrame,
  syncPersistentCanvasImages, setupPersistentCanvasImageVisibility
} from './edit-mode.js';

import { setupCanvasInteractions } from './canvas-interactions.js';

// ===== Settings popover =====
if (dom.btnSettingsToggle) {
  dom.btnSettingsToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.settingsPopover.classList.toggle('hidden');
  });
}
document.addEventListener('click', (e) => {
  if (!dom.settingsPopover || !dom.btnSettingsToggle) return;
  if (!dom.settingsPopover.contains(e.target) && e.target !== dom.btnSettingsToggle) {
    dom.settingsPopover.classList.add('hidden');
  }
});

// ===== UI sync =====
function syncSelectionModeUi() {
  const isGridMode = state.selectionMode === 'grid';
  const isSingleMode = state.selectionMode === 'single';
  const selectMethodItem = qs('#selectMethodGroup')?.closest('.setting-item');
  if (selectMethodItem) selectMethodItem.style.display = isGridMode ? 'none' : 'flex';
  const settingsWrap = dom.btnSettingsToggle?.parentElement;
  if (settingsWrap) settingsWrap.style.display = isGridMode ? 'none' : 'flex';
  if (dom.btnSettingsToggle) {
    dom.btnSettingsToggle.disabled = isGridMode || state.selectMethod === 'manual';
  }
  if (dom.settingsPopover && isGridMode) {
    dom.settingsPopover.classList.add('hidden');
  }
  const borderSettingItem = qs('#borderSettingItem');
  if (borderSettingItem) borderSettingItem.style.display = 'flex';
  if (dom.positionSettingItem) dom.positionSettingItem.style.display = isGridMode || isSingleMode ? 'none' : 'flex';
  const lineStyleGroup = qs('#lineStyleGroup');
  if (lineStyleGroup) lineStyleGroup.style.display = isGridMode ? 'inline-flex' : 'none';
  if (dom.btnClearLines) dom.btnClearLines.style.display = isGridMode ? 'inline-flex' : 'none';
  if (dom.btnUndo) dom.btnUndo.style.display = isGridMode ? 'inline-flex' : 'none';
}

function updateLineToolsVisibility() {
  const isGrid = state.selectionMode === 'grid';
  const tg = qs('#drawToolGroup');
  if (tg) tg.style.display = isGrid ? 'inline-flex' : 'none';
  const styleGroup = qs('#lineStyleGroup');
  if (styleGroup) styleGroup.style.display = isGrid ? 'inline-flex' : 'none';
  if (dom.btnClearLines) dom.btnClearLines.style.display = isGrid ? 'inline-flex' : 'none';
  if (!isGrid) {
    state.selectedUserLineIndex = -1;
    state._toolDrag = null;
  }
  if (dom.btnClearLines) dom.btnClearLines.disabled = (state.userLines.length === 0);
  drawUserLines();
}

function applySelectionMode() {
  const m = state.selectionMode;
  const isSingle = m === 'single';
  const isGrid = m === 'grid';
  const isEdit = m === 'edit';
  if (dom.singleExtractReadSettingItem) {
    dom.singleExtractReadSettingItem.style.display = isSingle ? 'flex' : 'none';
  }
  if (dom.singleExtractTextPositionSettingItem) {
    dom.singleExtractTextPositionSettingItem.style.display =
      (isSingle && state.singleExtractReadText) ? 'flex' : 'none';
  }
  const iconPathTarget = qs('#iconPathTarget');
  if (iconPathTarget) {
    iconPathTarget.setAttribute('d',
      isSingle
        ? 'M5 3 H19 A 2 2 0 0 1 21 5 V19 A 2 2 0 0 1 19 21 H5 A 2 2 0 0 1 3 19 V5 A 2 2 0 0 1 5 3 Z'
        : 'M12 12 H21 V19 A 2 2 0 0 1 19 21 H12 Z'
    );
  }
  dom.btnSelectFixedHeader.style.display = (!isGrid && !isEdit && m === 'withHeader') ? 'inline-flex' : 'none';
  dom.btnSelectHeader.style.display = (!isGrid && !isSingle && !isEdit) ? 'inline-flex' : 'none';
  dom.btnSelectHeaderRow.style.display = (!isGrid && !isEdit && m === 'withHeader') ? 'inline-flex' : 'none';
  dom.btnSelectTarget.style.display = (isGrid || isEdit) ? 'none' : 'inline-flex';
  dom.btnClearHeader.style.display = (isGrid || isEdit) ? 'none' : 'inline-flex';
  if (dom.positionSettingItem) {
    dom.positionSettingItem.style.display = (!isSingle && !isGrid && !isEdit) ? 'flex' : 'none';
  }
  dom.btnSelectTarget.disabled = !isSingle;
  dom.btnSelectHeaderRow.disabled = true;
  updateLineToolsVisibility();
  renderEditOverlay();
}

// ===== Toggle groups =====
setupToggleGroup('headerPositionGroup', 'headerPosition');

setupToggleGroup('selectionModeGroup', 'selectionMode', (val) => {
  state.undoStack = [];
  state._cropPreview = null;
  if (dom.btnCropExec) dom.btnCropExec.style.display = 'none';
  state.headerRegion = null;
  state.targetRegion = null;
  state.headerImageData = null;
  state.headerRowRegion = null;
  state.headerRowCells = [];
  state.headerRowImageData = null;
  state.fixedHeaderRegion = null;
  state.fixedHeaderImageData = null;

  if (val === 'grid') {
    state.mode = 'manual';
    setEditTool('select');
    state.selectedEditItemId = null;
    state.editSelectionRect = null;
    state._editDrag = null;
  } else {
    state.mode = val === 'withHeader' ? 'fixedHeader'
      : val === 'single' ? 'single' : 'header';
  }

  state.selectMethod = (val === 'single' || val === 'grid') ? 'manual' : 'auto';
  qs('#selectMethodGroup').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === state.selectMethod);
  });

  dom.btnClearHeader.disabled = true;
  applySelectionMode();
  updateModeButtons();
  renderEditOverlay();
  syncSelectionModeUi();

  requestAnimationFrame(() => {
    syncPersistentCanvasImages();
    scheduleSelectedImageOverlayFrame();
  });

  const msgs = {
    grid: '編集モード',
    headerOnly: '見出しを選択してください',
    withHeader: '固定ヘッダーを選択してください',
    single: '抽出する範囲を選択してください'
  };
  showToast(msgs[val] || '');
});

setupToggleGroup('selectMethodGroup', 'selectMethod', () => {
  if (state.mode === 'target' && state.selectMethod === 'manual') state.mode = 'manual';
  else if (state.mode === 'manual' && state.selectMethod === 'auto') state.mode = 'target';
  updateModeButtons();
  syncSelectionModeUi();
});

setupToggleGroup('singleExtractReadTextGroup', 'singleExtractReadText', (val) => {
  state.singleExtractReadText = val !== 'false';
  applySelectionMode();
  syncSelectionModeUi();
});
setupToggleGroup('singleExtractTextPositionGroup', 'singleExtractTextPosition');

// ===== Init setups =====
syncDrawToolUi();
syncSelectionModeUi();
setupSelectedImageOverlayFrame();
setupPersistentCanvasImageVisibility();
syncPersistentCanvasImages();
scheduleSelectedImageOverlayFrame();
setupCanvasInteractions(); // ★ canvas-interactions.js に委譲
// ===== Crop direction + execute + undo buttons =====
dom.btnCropH?.addEventListener('click', () => { state.cropDirection = 'horizontal'; });
dom.btnCropV?.addEventListener('click', () => { state.cropDirection = 'vertical'; });
dom.btnCropExec?.addEventListener('click', () => {
  if (state._cropPreview) {
    executeCrop(state._cropPreview);
    renderEditOverlay();
  }
});
dom.btnUndo?.addEventListener('click', () => { performUndo().then(() => renderEditOverlay()); });

// ===== Edit tool buttons =====

qs('#drawToolGroup')?.querySelectorAll('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => setEditTool(btn.dataset.tool));
});
qs('#btnPasteEditItem')?.addEventListener('click', () => {
  pasteEditClipboardAt(getViewportCenterCanvasPoint());
});
qs('#btnDeleteEditItem')?.addEventListener('click', () => {
  removeSelectedEditItem();
});
// テキスト入力はPDF上のインライン入力に移行（#editTextInputは不要）


// ===== Sliders =====
dom.gridThreshold?.addEventListener('input', () => {
  dom.thresholdValue.textContent = dom.gridThreshold.value;
});
dom.minLineLen?.addEventListener('input', () => {
  dom.minLineLenValue.textContent = dom.minLineLen.value;
});
dom.gridThreshold?.addEventListener('dblclick', () => {
  dom.gridThreshold.value = 170;
  dom.thresholdValue.textContent = 170;
});
dom.minLineLen?.addEventListener('dblclick', () => {
  dom.minLineLen.value = 30;
  dom.minLineLenValue.textContent = 30;
});

// ===== listName =====
if (dom.listNameInput) {
  dom.listNameInput.addEventListener('focus', (e) => {
    e.target.select();
    e.target.addEventListener('mouseup', function prevent(e2) {
      e2.preventDefault();
      e.target.removeEventListener('mouseup', prevent);
    });
  });
  dom.listNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });
  dom.listNameInput.addEventListener('change', (e) => {
    const oldName = getCurrentListName();
    const newName = e.target.value.trim() || '名称未設定';
    if (oldName !== newName) {
      const pageNum = state.selectedPages[state.currentWorkPage];
      for (let i = 0; i < state.pages.length; i++) {
        if (state.pages[i].pageNum === pageNum) {
          state.pages[i].drawingName = newName;
          break;
        }
      }
      state.extractedImages.forEach((img) => {
        if (img.listName === oldName) img.listName = newName;
      });
      if (state.collapsedGroups[oldName] !== undefined) {
        state.collapsedGroups[newName] = state.collapsedGroups[oldName];
        delete state.collapsedGroups[oldName];
      }
      renderExtractedList(true);
      showToast('リスト名を変更しました');
    } else {
      e.target.value = oldName;
    }
  });
}

// ===== Border checkbox =====
if (dom.addBorderCheckbox) {
  const borderLabel = qs('#borderCheckboxLabel');
  const borderText = qs('#borderCheckboxText');
  dom.addBorderCheckbox.addEventListener('change', (e) => {
    state.addBorder = e.target.checked;
    if (e.target.checked) {
      if (borderLabel) borderLabel.classList.add('active');
      if (borderText) borderText.textContent = 'あり';
    } else {
      if (borderLabel) borderLabel.classList.remove('active');
      if (borderText) borderText.textContent = 'なし';
    }
  });
}

// ===== File input =====
dom.pdfInput?.addEventListener('change', (e) => { handleFile(e.target.files[0]); });
dom.dropZone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  dom.dropZone.classList.add('dragover');
});
dom.dropZone?.addEventListener('dragleave', () => { dom.dropZone.classList.remove('dragover'); });
dom.dropZone?.addEventListener('drop', (e) => {
  e.preventDefault();
  dom.dropZone.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});

// ===== step2 buttons =====
dom.btnSelectAll?.addEventListener('click', () => {
  state.pages.forEach((p) => { p.selected = true; });
  updateThumbnailStyles();
  updatePageControls();
});
dom.btnDeselectAll?.addEventListener('click', () => {
  state.pages.forEach((p) => { p.selected = false; });
  updateThumbnailStyles();
  updatePageControls();
});
dom.goToStep3?.addEventListener('click', () => {
  state.selectedPages = state.pages.filter((p) => p.selected).map((p) => p.pageNum);
  state.currentWorkPage = 0;
  resetWorkState();
  renderFloorList();
  updateFloorSelector();
  showStep('2b');
});

// ===== Floor management =====
function renderFloorList() {
  if (!dom.floorList) return;
  dom.floorList.innerHTML = '';
  state.floors.forEach((floor) => {
    if (floor.id === 'default') return;
    const el = document.createElement('div');
    el.className = 'floor-item';
    el.innerHTML =
      '<div class="floor-item-name">' +
      '<span class="material-symbols-rounded">layers</span>' +
      '<span>' + floor.name + '</span>' +
      '</div>' +
      '<div class="floor-item-actions">' +
      '<button class="btn-floor-remove" title="削除"><span class="material-symbols-rounded" style="font-size:18px">close</span></button>' +
      '</div>';
    el.querySelector('.btn-floor-remove').addEventListener('click', () => {
      state.floors = state.floors.filter((f) => f.id !== floor.id);
      state.extractedImages.forEach((img) => {
        if (img.floorId === floor.id) img.floorId = 'default';
      });
      if (state.currentFloorId === floor.id) state.currentFloorId = state.floors[0]?.id || 'default';
      renderFloorList();
      updateFloorSelector();
    });
    dom.floorList.appendChild(el);
  });
  if (state.floors.length <= 1) {
    dom.floorList.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:24px 0;">階層が未登録です。上の入力欄から追加してください。</div>';
  }
}
function updateFloorSelector() {
  if (!dom.floorSelector) return;
  dom.floorSelector.innerHTML = '';
  state.floors.forEach((floor) => {
    const opt = document.createElement('option');
    opt.value = floor.id;
    opt.textContent = floor.name;
    if (floor.id === state.currentFloorId) opt.selected = true;
    dom.floorSelector.appendChild(opt);
  });
}
dom.btnAddFloor?.addEventListener('click', () => {
  const name = dom.floorNameInput?.value.trim();
  if (!name) { showToast('階層名を入力してください'); return; }
  state.floors.push({ id: generateFloorId(), name });
  dom.floorNameInput.value = '';
  renderFloorList();
  updateFloorSelector();
  showToast(name + ' を追加しました');
});
dom.floorNameInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); dom.btnAddFloor?.click(); }
});
dom.goToStep3FromFloors?.addEventListener('click', () => {
  if (state.floors.length <= 1) {
    state.floors = [{ id: 'default', name: '未分類' }];
  }
  state.currentFloorId = state.floors[0].id;
  updateFloorSelector();
  renderWorkPage().then(() => { renderEditOverlay(); });
  showStep(3);
});
dom.btnBackToStep2?.addEventListener('click', () => {
  showStep(2);
});
dom.floorSelector?.addEventListener('change', (e) => {
  state.currentFloorId = e.target.value;
  showToast(getCurrentFloorName() + ' に切り替えました');
});
qs('#btnAddFloorInStep4')?.addEventListener('click', () => {
  const name = prompt('追加する階層名を入力してください');
  if (!name || !name.trim()) return;
  const newFloor = { id: generateFloorId(), name: name.trim() };
  state.floors.push(newFloor);
  state.currentFloorId = newFloor.id;
  updateFloorSelector();
  renderExtractedList(true);
  showToast(newFloor.name + ' を追加しました');
});
// ===== mode buttons =====
dom.btnSelectHeader?.addEventListener('click', () => {
  state.mode = 'header';
  updateModeButtons();
});
dom.btnSelectTarget?.addEventListener('click', () => {
  if (!state.headerRegion && !state.headerRect && state.selectionMode !== 'single') {
    showToast('先に見出しを選択してください');
    return;
  }
  state.mode = state.selectMethod === 'manual' ? 'manual' : 'target';
  updateModeButtons();
});
dom.btnSelectHeaderRow?.addEventListener('click', () => {
  if (!state.headerRegion && !state.headerRect) {
    showToast('先に見出しを選択してください');
    return;
  }
  state.mode = 'headerRow';
  updateModeButtons();
});
dom.btnSelectFixedHeader?.addEventListener('click', () => {
  state.mode = 'fixedHeader';
  updateModeButtons();
});
dom.btnClearHeader?.addEventListener('click', () => {
  if (state.selectionMode === 'grid') {
    state.selectedEditItemId = null;
    state.editSelectionRect = null;
    renderEditOverlay();
    return;
  }
  resetPageSelection();
  updateModeButtons();
});

// ===== page move =====
dom.btnPrevWork?.addEventListener('click', () => {
  if (state.currentWorkPage > 0) {
    state.currentWorkPage--;
    dom.canvasContainer.scrollLeft = 0;
    dom.canvasContainer.scrollTop = 0;
    resetPageSelection();
    renderWorkPage().then(() => { renderEditOverlay(); });
  }
});
dom.btnNextWork?.addEventListener('click', () => {
  if (state.currentWorkPage < state.selectedPages.length - 1) {
    state.currentWorkPage++;
    dom.canvasContainer.scrollLeft = 0;
    dom.canvasContainer.scrollTop = 0;
    resetPageSelection();
    renderWorkPage().then(() => { renderEditOverlay(); });
  }
});

// ===== draw tools (罫線スタイルのみ — ツール切替は setEditTool に統一) =====

function applyUserLineStyleFromUI() {
  if (dom.lineColor) state.userLineStyle.color = dom.lineColor.value || '#ef4444';
  if (dom.lineWidth) state.userLineStyle.width = parseInt(dom.lineWidth.value, 10) || 4;
  if (dom.lineWidthValue) dom.lineWidthValue.textContent = String(state.userLineStyle.width);
  drawUserLines();
}
dom.lineColor?.addEventListener('input', applyUserLineStyleFromUI);
dom.lineWidth?.addEventListener('input', applyUserLineStyleFromUI);
applyUserLineStyleFromUI();

// ===== clear images =====
dom.btnClearImages?.addEventListener('click', () => {
  state.extractedImages = [];
  state.collapsedGroups = {};
  renderExtractedList();
  showToast('画像をすべてクリアしました');
});

// ===== reset =====
dom.btnResetAlls.forEach((btn) => {
  btn.addEventListener('click', () => {
    state.pdfDoc = null;
    state.pages = [];
    state.selectedPages = [];
    state.currentWorkPage = 0;
    state.scale = 4;
    resetPageSelection();
    state.extractedImages = [];
    state.collapsedGroups = {};
    state.userLines = [];
    state.userLinesByPage = {};
    state.selectedUserLineIndex = -1;
    state.selectedUserLineIndices = [];
    state._copiedUserLine = null;
    state._toolDrag = null;
    state.editItemsByPage = {};
    state.cropOperationsByPage = {};
    state.editItems = [];
    state.editClipboard = null;
    state.editSelectionRect = null;
    state.selectedEditItemId = null;
    state.selectedEditItemIds = [];
    state.pendingEditText = '';
    state.floors = [{ id: 'default', name: '未分類' }];
    state.currentFloorId = 'default';
    state.collapsedFloors = {};
    state.drawTool = 'select';
    state._editDrag = null;
    drawUserLines();
    renderExtractedList();
    state.selectionMode = 'headerOnly';
    state.selectMethod = 'auto';
    state.headerPosition = 'left';
    state.addBorder = true;
    qs('#selectionModeGroup').querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.value === 'headerOnly');
    });
    qs('#selectMethodGroup').querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.value === 'auto');
    });
    qs('#headerPositionGroup').querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.value === 'left');
    });
    if (dom.addBorderCheckbox) {
      dom.addBorderCheckbox.checked = true;
      const lbl = qs('#borderCheckboxLabel');
      const txt = qs('#borderCheckboxText');
      if (lbl) lbl.classList.add('active');
      if (txt) txt.textContent = 'あり';
    }
    dom.pdfInput.value = '';
    dom.pageThumbnails.innerHTML = '';
    dom.btnDownloadAll.disabled = true;
    applySelectionMode();
    showStep(1);
    showToast('リセットしました');
  });
});

// ===== download =====
dom.btnDownloadAll.onclick = function () {
  if (state.extractedImages.length === 0) return;
  if (state.extractedImages.length === 1) {
    const a = document.createElement('a');
    a.href = state.extractedImages[0].dataUrl;
    a.download = getDownloadFileName(state.extractedImages[0], 0) + '.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }
  showToast('ZIPファイルを作成中...');
  const zip = new JSZip();
  for (let i = 0; i < state.extractedImages.length; i++) {
    const img = state.extractedImages[i];
    const fn = getDownloadFileName(img, i);
    const floorName = (state.floors.find((f) => f.id === (img.floorId || 'default')) || { name: '未分類' }).name;
    zip.folder(floorName).folder(img.listName).file(fn + '.jpg', img.dataUrl.split(',')[1], { base64: true });
  }
  zip.generateAsync({ type: 'blob' })
    .then(async (blob) => {
      const zipName = '抽出画像.zip';
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: zipName,
            types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          showToast('ダウンロード完了');
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          console.warn('showSaveFilePicker failed', err);
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
      }, 500);
      showToast('ダウンロード完了');
    })
    .catch((err) => {
      showToast('ZIP作成失敗: ' + err.message);
    });
};

// ===== init =====
applySelectionMode();
renderEditOverlay();
updateModeButtons();
showStep(1);
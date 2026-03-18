// Photoshop JSX Script for TIFF Conversion
// Based on TIPPY v2.92 processing pipeline, integrated with COMIC-Bridge config/result pattern

#target photoshop

var originalDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
app.preferences.rulerUnits = Units.PIXELS;

/* -----------------------------------------------------
  Text Group Names (for consolidation)
 ----------------------------------------------------- */
var TEXT_GROUP_NAMES = ["#text#", "text", "\u5199\u690D", "\u30BB\u30EA\u30D5", "\u30C6\u30AD\u30B9\u30C8", "\u53F0\u8A5E"];

/* -----------------------------------------------------
  Main Processing
 ----------------------------------------------------- */
function main() {
    var tempFolder = Folder.temp;

    var settingsFile = new File(tempFolder + "/psd_tiff_settings.json");

    if (!settingsFile.exists) {
        alert("Settings file not found: " + settingsFile.fsName);
        return;
    }

    settingsFile.open("r");
    settingsFile.encoding = "UTF-8";
    var jsonStr = settingsFile.read();
    settingsFile.close();

    // BOM skip
    if (jsonStr.charCodeAt(0) === 0xFEFF || jsonStr.charCodeAt(0) === 0xEF) {
        jsonStr = jsonStr.substring(1);
    }

    var config;
    try {
        config = parseJSON(jsonStr);
    } catch (e) {
        alert("Failed to parse settings: " + e.message);
        return;
    }

    var globalSettings = config.globalSettings;
    var results = [];

    // Initial heartbeat: signal script has started
    try {
        var pf = new File(tempFolder + "/psd_tiff_progress.txt");
        pf.open("w"); pf.write("0/" + String(config.files.length)); pf.close();
    } catch (e_hb0) {}

    for (var i = 0; i < config.files.length; i++) {
        var fileConfig = config.files[i];
        var result = processFile(fileConfig, globalSettings);
        results.push(result);

        // Heartbeat: write progress so Rust knows we are still alive
        try {
            var progressFile = new File(tempFolder + "/psd_tiff_progress.txt");
            progressFile.open("w");
            progressFile.write(String(i + 1) + "/" + String(config.files.length));
            progressFile.close();
        } catch (e_hb) { /* ignore */ }
    }

    // Write results
    var resultFile = new File(tempFolder + "/psd_tiff_results.json");
    resultFile.open("w");
    resultFile.encoding = "UTF-8";
    resultFile.write(valueToJSON({ results: results }));
    resultFile.close();

    app.displayDialogs = originalDialogs;
}

/* -----------------------------------------------------
  Process Single File
 ----------------------------------------------------- */
function processFile(fileConfig, globalSettings) {
    var filePath = fileConfig.path;
    var fileName = decodeURI(new File(filePath).name);

    try {
        // 1. Open file
        var file = new File(filePath);
        if (!file.exists) {
            return { fileName: fileName, success: false, error: "File not found" };
        }

        var doc = app.open(file);

        // 2. Unlock all layers
        unlockAllLayers(doc);

        // 3. Always find existing text group for text/background separation
        var textGroup = null;
        for (var gi = 0; gi < doc.layerSets.length; gi++) {
            var gName = doc.layerSets[gi].name;
            for (var gj = 0; gj < TEXT_GROUP_NAMES.length; gj++) {
                if (gName === TEXT_GROUP_NAMES[gj] || gName.toLowerCase() === TEXT_GROUP_NAMES[gj].toLowerCase()) {
                    textGroup = doc.layerSets[gi];
                    break;
                }
            }
            if (textGroup) break;
        }

        // Text layer organization (if enabled)
        if (globalSettings.reorganizeText) {
            if (!textGroup) {
                textGroup = findOrCreateTextGroup(doc);
            }
            if (textGroup) {
                consolidateTextLayers(doc, textGroup);
            }
        }

        // Move text group to top of layer stack (matching Tippy)
        if (textGroup) {
            try { textGroup.move(doc, ElementPlacement.PLACEATBEGINNING); } catch (e) {}
        }

        // 4. Separate text and background, convert both to smart objects
        var backgroundSO = null;
        var textSO = null;

        if (doc.layers.length > 1) {
            var bgLayers = collectNonTextLayers(doc, textGroup);

            // Background: Select all non-text layers -> convert to SO
            if (bgLayers.length > 0) {
                // Save visibility state before selection (selectLayers may alter hidden layers)
                var bgVisibility = [];
                for (var vi = 0; vi < bgLayers.length; vi++) {
                    bgVisibility.push(bgLayers[vi].visible);
                }

                selectLayers(bgLayers);

                // Restore visibility after selection, before SO creation
                for (var vi = 0; vi < bgLayers.length; vi++) {
                    try { bgLayers[vi].visible = bgVisibility[vi]; } catch (e) {}
                }

                backgroundSO = convertToSmartObject();
                if (backgroundSO) backgroundSO.name = "\u80CC\u666F";
            }

            // Text: Select text group with all children -> convert to SO
            if (textGroup) {
                try {
                    // Save text group visibility
                    var textGroupVisible = textGroup.visible;

                    selectLayerWithChildren(textGroup);

                    // Restore text group visibility
                    try { textGroup.visible = textGroupVisible; } catch (e) {}

                    textSO = convertToSmartObject();
                    if (textSO) textSO.name = "\u30C6\u30AD\u30B9\u30C8";
                } catch (e) {
                    textSO = null;
                }
            }
        }

        // 5. Rasterize both smart objects (DOM method matching Tippy)
        var textLayer = null;
        if (textSO) {
            try {
                doc.activeLayer = textSO;
                textSO.rasterize(RasterizeType.ENTIRELAYER);
                textLayer = doc.activeLayer;
                textLayer.name = "\u30C6\u30AD\u30B9\u30C8";
            } catch (e) {}
        }
        var backgroundLayer = null;
        if (backgroundSO) {
            try {
                doc.activeLayer = backgroundSO;
                backgroundSO.rasterize(RasterizeType.ENTIRELAYER);
                backgroundLayer = doc.activeLayer;
                backgroundLayer.name = "\u80CC\u666F";
            } catch (e) {}
        }

        // 6. Color mode conversion
        var targetColorMode = fileConfig.colorMode;
        if (targetColorMode === "mono" && doc.mode !== DocumentMode.GRAYSCALE) {
            doc.changeMode(ChangeMode.GRAYSCALE);
        } else if (targetColorMode === "color" && doc.mode !== DocumentMode.RGB) {
            doc.changeMode(ChangeMode.RGB);
        }

        // 7. Re-convert rasterized text to smart object (fresh ref after color mode change)
        var textSOFinal = null;
        if (textLayer) {
            try {
                doc.activeLayer = textLayer;
                textSOFinal = convertToSmartObject();
                if (textSOFinal) textSOFinal.name = "\u30C6\u30AD\u30B9\u30C8";
            } catch (e) {}
        }

        // 8. Hide text SO
        if (textSOFinal) {
            try { textSOFinal.visible = false; } catch (e) {}
        }

        // 9. Optional: Save intermediate PSD
        if (globalSettings.saveIntermediatePsd) {
            saveIntermediatePsd(doc, fileConfig, globalSettings);
        }

        // 10. Apply Gaussian blur to background only (Tippy v2.92 pattern)
        // Check for page-specific partial blur settings
        var currentPartialBlurSettings = null;
        if (fileConfig.partialBlur && fileConfig.partialBlur.blurRadius !== undefined) {
            currentPartialBlurSettings = fileConfig.partialBlur;
        }

        if (backgroundLayer && fileConfig.applyBlur && fileConfig.blurRadius > 0) {
            doc.activeLayer = backgroundLayer;
            try {
                if (backgroundLayer.allLocked) backgroundLayer.allLocked = false;

                if (currentPartialBlurSettings) {
                    applyPartialBlur(doc, fileConfig.blurRadius, currentPartialBlurSettings);
                } else {
                    doc.activeLayer.applyGaussianBlur(fileConfig.blurRadius);
                }
            } catch (e) {}
        } else if (backgroundLayer && currentPartialBlurSettings) {
            // Blur disabled globally but partial blur exists for this page
            doc.activeLayer = backgroundLayer;
            try {
                if (backgroundLayer.allLocked) backgroundLayer.allLocked = false;
                applyPartialBlur(doc, 0, currentPartialBlurSettings);
            } catch (e) {}
        }

        // 11. Show text SO
        if (textSOFinal) {
            try { textSOFinal.visible = true; } catch (e) {}
        }

        // 12. Final merge: re-acquire layers by name -> SO (matching Tippy)
        var layersToMerge = [];
        if (textSOFinal) {
            try { layersToMerge.push(doc.layers.getByName("\u30C6\u30AD\u30B9\u30C8")); } catch (e) {}
        }
        if (backgroundLayer) {
            try { layersToMerge.push(doc.layers.getByName("\u80CC\u666F")); } catch (e) {}
        }

        if (layersToMerge.length > 0) {
            try {
                selectLayers(layersToMerge);
                convertToSmartObject();
            } catch (e) {}
        } else if (doc.layers.length > 1) {
            doc.flatten();
        }

        // 13. Crop (if not skipped)
        if (!fileConfig.skipCrop && fileConfig.cropBounds) {
            var cb = fileConfig.cropBounds;
            doc.crop([
                new UnitValue(cb.left, "px"),
                new UnitValue(cb.top, "px"),
                new UnitValue(cb.right, "px"),
                new UnitValue(cb.bottom, "px")
            ]);
        }

        // 14. Resize
        var targetW = new UnitValue(globalSettings.targetWidth, "px");
        var targetH = new UnitValue(globalSettings.targetHeight, "px");

        // DPI based on color mode
        var targetDPI;
        if (targetColorMode === "mono") {
            targetDPI = 600;
        } else if (targetColorMode === "color") {
            targetDPI = 350;
        } else {
            targetDPI = doc.resolution;
        }

        doc.resizeImage(targetW, targetH, targetDPI, ResampleMethod.AUTOMATIC);

        // 15. Remove alpha channels
        while (doc.channels.length > getExpectedChannelCount(doc)) {
            doc.channels[doc.channels.length - 1].remove();
        }

        // 16. Save
        var outputDir = new Folder(fileConfig.outputPath);
        if (!outputDir.exists) outputDir.create();
        var outputFile = new File(fileConfig.outputPath + "/" + fileConfig.outputName);
        var baseName = fileConfig.outputName.replace(/\.[^.]+$/, "");

        if (globalSettings.proceedAsTiff) {
            // TIFF with LZW compression
            var tiffOpts = new TiffSaveOptions();
            tiffOpts.imageCompression = TIFFEncoding.TIFFLZW;
            tiffOpts.layers = false;
            tiffOpts.alphaChannels = false;
            tiffOpts.byteOrder = ByteOrder.IBM;
            doc.saveAs(outputFile, tiffOpts, true, Extension.LOWERCASE);
        } else if (globalSettings.outputJpg) {
            // JPG only (TIFF OFF + JPG ON)
            var jpgOpts = new JPEGSaveOptions();
            jpgOpts.quality = 12;
            jpgOpts.embedColorProfile = true;
            jpgOpts.formatOptions = FormatOptions.STANDARDBASELINE;
            var jpgFile = new File(fileConfig.outputPath + "/" + baseName + ".jpg");
            doc.saveAs(jpgFile, jpgOpts, true, Extension.LOWERCASE);
            outputFile = jpgFile;
        } else {
            // PSD
            var psdOpts = new PhotoshopSaveOptions();
            psdOpts.layers = false;
            psdOpts.alphaChannels = false;
            doc.saveAs(outputFile, psdOpts, true, Extension.LOWERCASE);
        }

        // 16b. TIFF+JPG: save JPG copy to separate folder
        if (globalSettings.proceedAsTiff && globalSettings.outputJpg && fileConfig.jpgOutputPath) {
            var jpgDir2 = new Folder(fileConfig.jpgOutputPath);
            if (!jpgDir2.exists) jpgDir2.create();
            var jpgFile2 = new File(fileConfig.jpgOutputPath + "/" + baseName + ".jpg");
            var jpgOpts2 = new JPEGSaveOptions();
            jpgOpts2.quality = 12;
            jpgOpts2.embedColorProfile = true;
            jpgOpts2.formatOptions = FormatOptions.STANDARDBASELINE;
            doc.saveAs(jpgFile2, jpgOpts2, true, Extension.LOWERCASE);
        }

        // 17. Capture final document metadata before closing
        var finalColorMode = (doc.mode == DocumentMode.GRAYSCALE) ? "mono" : "color";
        var finalWidth = Math.round(doc.width.value);
        var finalHeight = Math.round(doc.height.value);
        var finalDpi = Math.round(doc.resolution);

        // 18. Close
        doc.close(SaveOptions.DONOTSAVECHANGES);

        return {
            fileName: fileName,
            success: true,
            outputPath: outputFile.fsName.replace(/\\/g, "/"),
            colorMode: finalColorMode,
            finalWidth: finalWidth,
            finalHeight: finalHeight,
            dpi: finalDpi
        };

    } catch (e) {
        // Close doc if open
        try {
            if (app.documents.length > 0) {
                app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
            }
        } catch (ex) {}

        return {
            fileName: fileName,
            success: false,
            error: e.message || String(e)
        };
    }
}

/* -----------------------------------------------------
  Layer Operations
 ----------------------------------------------------- */
function unlockAllLayers(doc) {
    // Unlock background layer
    try {
        if (doc.layers.length > 0 && doc.layers[doc.layers.length - 1].isBackgroundLayer) {
            doc.layers[doc.layers.length - 1].isBackgroundLayer = false;
        }
    } catch (e) {}

    // Unlock all locked layers recursively
    unlockRecursive(doc);
}

function unlockRecursive(container) {
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        try {
            var originalVisibility = layer.visible;
            layer.allLocked = false;
            layer.visible = originalVisibility;
        } catch (e) {}
        if (layer.typename === "LayerSet") {
            unlockRecursive(layer);
        }
    }
}

function findOrCreateTextGroup(doc) {
    // Search existing text group
    for (var i = 0; i < doc.layerSets.length; i++) {
        var groupName = doc.layerSets[i].name;
        for (var j = 0; j < TEXT_GROUP_NAMES.length; j++) {
            if (groupName === TEXT_GROUP_NAMES[j] || groupName.toLowerCase() === TEXT_GROUP_NAMES[j].toLowerCase()) {
                return doc.layerSets[i];
            }
        }
    }

    // Check if any text layers exist
    var hasTextLayers = false;
    checkForTextLayers(doc, function() { hasTextLayers = true; });
    if (!hasTextLayers) return null;

    // Create new text group at top
    var textGroup = doc.layerSets.add();
    textGroup.name = "#text#";
    return textGroup;
}

function checkForTextLayers(container, callback) {
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        if (layer.kind === LayerKind.TEXT) {
            callback();
            return;
        }
        if (layer.typename === "LayerSet") {
            checkForTextLayers(layer, callback);
        }
    }
}

function consolidateTextLayers(doc, targetGroup) {
    // Move scattered text layers into the target group
    var layersToMove = [];
    findTextLayersOutside(doc, targetGroup, layersToMove);
    for (var i = 0; i < layersToMove.length; i++) {
        try {
            layersToMove[i].move(targetGroup, ElementPlacement.INSIDE);
        } catch (e) {}
    }
}

function findTextLayersOutside(container, excludeGroup, list) {
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        if (excludeGroup && layer.id === excludeGroup.id) continue;
        if (layer.kind === LayerKind.TEXT) {
            list.push(layer);
        } else if (layer.typename === "LayerSet") {
            // Check if this group is only text
            var allText = true;
            checkAllText(layer, function() { allText = false; });
            if (allText && layer.layers.length > 0) {
                list.push(layer);
            } else {
                findTextLayersOutside(layer, excludeGroup, list);
            }
        }
    }
}

function checkAllText(container, onNonText) {
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        if (layer.kind !== LayerKind.TEXT && layer.typename !== "LayerSet") {
            onNonText();
            return;
        }
        if (layer.typename === "LayerSet") {
            checkAllText(layer, onNonText);
        }
    }
}

function collectTextLayers(doc, textGroup) {
    if (!textGroup) return [];
    return [textGroup];
}

function collectNonTextLayers(doc, textGroup) {
    var layers = [];
    for (var i = 0; i < doc.layers.length; i++) {
        if (!textGroup || doc.layers[i].id !== textGroup.id) {
            layers.push(doc.layers[i]);
        }
    }
    return layers;
}

function selectLayerWithChildren(layer) {
    var descendants = [];
    function collectDescendants(parent) {
        if (parent.typename === "LayerSet") {
            descendants.push(parent);
            for (var i = 0; i < parent.layers.length; i++) {
                collectDescendants(parent.layers[i]);
            }
        } else {
            descendants.push(parent);
        }
    }
    collectDescendants(layer);
    selectLayers(descendants);
}

function selectLayers(layers) {
    if (layers.length === 0) return;
    // Select first layer by ID (handles hidden layers correctly)
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layers[0].id);
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putBoolean(stringIDToTypeID("makeVisible"), false);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);

    // Add remaining layers to selection by ID
    for (var i = 1; i < layers.length; i++) {
        var addDesc = new ActionDescriptor();
        var addRef = new ActionReference();
        addRef.putIdentifier(charIDToTypeID("Lyr "), layers[i].id);
        addDesc.putReference(charIDToTypeID("null"), addRef);
        addDesc.putEnumerated(
            stringIDToTypeID("selectionModifier"),
            stringIDToTypeID("selectionModifierType"),
            stringIDToTypeID("addToSelection")
        );
        addDesc.putBoolean(stringIDToTypeID("makeVisible"), false);
        executeAction(charIDToTypeID("slct"), addDesc, DialogModes.NO);
    }
}

function convertToSmartObject() {
    try {
        executeAction(stringIDToTypeID("newPlacedLayer"), new ActionDescriptor(), DialogModes.NO);
        return app.activeDocument.activeLayer;
    } catch (e) { return null; }
}

function rasterizeLayer() {
    try {
        var desc = new ActionDescriptor();
        var ref = new ActionReference();
        ref.putEnumerated(stringIDToTypeID("layer"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
        desc.putReference(stringIDToTypeID("target"), ref);
        executeAction(stringIDToTypeID("rasterizeLayer"), desc, DialogModes.NO);
    } catch (e) {}
}

/* -----------------------------------------------------
  Blur Operations
 ----------------------------------------------------- */
// 部分ぼかし: regionsがある場合は各ポリゴン領域に個別の半径を適用
// regionsが無い場合はレガシーboundsまたは全体にpartialBlurRadiusを適用
function applyPartialBlur(doc, defaultBlurRadius, partialSettings) {
    try {
        var activeLayer = doc.activeLayer;
        var partialBlurRadius = partialSettings.blurRadius;
        var regions = partialSettings.regions;

        // --- regions配列がある場合: 新方式（複数ポリゴン領域） ---
        if (regions && regions.length > 0) {
            applyRegionsBlur(doc, activeLayer, defaultBlurRadius, partialBlurRadius, regions);
            return;
        }

        // --- レガシー: bounds方式 ---
        var bounds = partialSettings.bounds;

        // boundsがnull/未定義: 全体にpartialBlurRadiusを適用
        if (!bounds || bounds.left === undefined) {
            if (partialBlurRadius > 0) {
                activeLayer.applyGaussianBlur(partialBlurRadius);
            } else if (defaultBlurRadius > 0) {
                activeLayer.applyGaussianBlur(defaultBlurRadius);
            }
            return;
        }

        // boundsがドキュメント全体と同じ場合も同様にスキップ
        var docW = doc.width.value;
        var docH = doc.height.value;
        if (bounds.left <= 0 && bounds.top <= 0 && bounds.right >= docW && bounds.bottom >= docH) {
            if (partialBlurRadius > 0) {
                activeLayer.applyGaussianBlur(partialBlurRadius);
            } else if (defaultBlurRadius > 0) {
                activeLayer.applyGaussianBlur(defaultBlurRadius);
            }
            return;
        }

        // 有効なboundsがある場合のみ選択範囲ベースの処理
        var selRegion = [
            [bounds.left, bounds.top],
            [bounds.right, bounds.top],
            [bounds.right, bounds.bottom],
            [bounds.left, bounds.bottom]
        ];

        // 1. 選択範囲外に通常のぼかしを適用
        if (defaultBlurRadius > 0) {
            doc.selection.select(selRegion);
            doc.selection.invert();
            var hasSelection = false;
            try { var sb = doc.selection.bounds; hasSelection = true; } catch (eSel) {}
            if (hasSelection) {
                activeLayer.applyGaussianBlur(defaultBlurRadius);
            }
            doc.selection.deselect();
        }

        // 2. 選択範囲内に指定したぼかしを適用
        if (partialBlurRadius > 0) {
            doc.selection.select(selRegion);
            activeLayer.applyGaussianBlur(partialBlurRadius);
            doc.selection.deselect();
        }
    } catch (e) {
        try { doc.selection.deselect(); } catch (ed) {}
        if (defaultBlurRadius > 0) {
            try { doc.activeLayer.applyGaussianBlur(defaultBlurRadius); } catch (e2) {}
        }
    }
}

// 複数ポリゴン領域ぼかし
// 1. 全regions選択→invert→外側にdefaultBlur
// 2. 各regionを個別選択→個別blurRadius適用
function applyRegionsBlur(doc, activeLayer, defaultBlurRadius, fallbackBlurRadius, regions) {
    try {
        // 1. 外側にデフォルトぼかし
        if (defaultBlurRadius > 0) {
            // 全regionsをunion選択
            for (var i = 0; i < regions.length; i++) {
                var pts = regions[i].points;
                if (!pts || pts.length < 3) continue;
                if (i === 0) {
                    doc.selection.select(pts);
                } else {
                    doc.selection.select(pts, SelectionType.EXTEND);
                }
            }
            doc.selection.invert();
            var hasOuter = false;
            try { var sb = doc.selection.bounds; hasOuter = true; } catch (eOuter) {}
            if (hasOuter) {
                activeLayer.applyGaussianBlur(defaultBlurRadius);
            }
            doc.selection.deselect();
        }

        // 2. 各regionに個別ぼかし
        for (var j = 0; j < regions.length; j++) {
            var region = regions[j];
            var pts2 = region.points;
            var regionBlur = region.blurRadius;
            if (!pts2 || pts2.length < 3) continue;
            if (regionBlur === undefined || regionBlur === null) regionBlur = fallbackBlurRadius;
            if (regionBlur > 0) {
                doc.selection.select(pts2);
                activeLayer.applyGaussianBlur(regionBlur);
                doc.selection.deselect();
            }
        }
    } catch (e) {
        try { doc.selection.deselect(); } catch (ed) {}
        if (defaultBlurRadius > 0) {
            try { activeLayer.applyGaussianBlur(defaultBlurRadius); } catch (e2) {}
        }
    }
}

/* -----------------------------------------------------
  Intermediate PSD Save
 ----------------------------------------------------- */
function saveIntermediatePsd(doc, fileConfig, globalSettings) {
    try {
        var baseName = decodeURI(new File(fileConfig.path).name).replace(/\.[^.]+$/, "");
        var suffix = globalSettings.mergeAfterColor ? "_merged" : "_color";
        var psdDir = new Folder(fileConfig.outputPath + "/../Processed_PSD");
        if (!psdDir.exists) psdDir.create();

        if (globalSettings.mergeAfterColor) {
            // Merge visible, then save
            doc.mergeVisibleLayers();
        }

        var midFile = new File(psdDir.fsName + "/" + baseName + suffix + ".psd");
        var opts = new PhotoshopSaveOptions();
        opts.layers = true;
        doc.saveAs(midFile, opts, true, Extension.LOWERCASE);
    } catch (e) {}
}

/* -----------------------------------------------------
  Helpers
 ----------------------------------------------------- */
function getExpectedChannelCount(doc) {
    // RGB=3, Grayscale=1, CMYK=4
    switch (doc.mode) {
        case DocumentMode.RGB: return 3;
        case DocumentMode.GRAYSCALE: return 1;
        case DocumentMode.CMYK: return 4;
        default: return doc.channels.length;
    }
}

/* -----------------------------------------------------
  JSON Utilities (same as other COMIC-Bridge scripts)
 ----------------------------------------------------- */
function valueToJSON(val) {
    if (val === null || val === undefined) {
        return "null";
    } else if (typeof val === "string") {
        return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
    } else if (typeof val === "number" || typeof val === "boolean") {
        return String(val);
    } else if (val instanceof Array) {
        return arrayToJSON(val);
    } else if (typeof val === "object") {
        return objectToJSON(val);
    }
    return "null";
}

function arrayToJSON(arr) {
    var json = "[";
    for (var i = 0; i < arr.length; i++) {
        if (i > 0) json += ",";
        json += valueToJSON(arr[i]);
    }
    json += "]";
    return json;
}

function objectToJSON(obj) {
    var json = "{";
    var first = true;
    for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
            if (!first) json += ",";
            first = false;
            json += '"' + key + '":';
            json += valueToJSON(obj[key]);
        }
    }
    json += "}";
    return json;
}

function parseJSON(str) {
    var pos = 0;

    function parseValue() {
        skipWhitespace();
        var ch = str.charAt(pos);
        if (ch === '{') return parseObject();
        if (ch === '[') return parseArray();
        if (ch === '"') return parseString();
        if (ch === 't' || ch === 'f') return parseBoolean();
        if (ch === 'n') return parseNull();
        if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
        throw new Error("Unexpected character at position " + pos + ": " + ch);
    }

    function skipWhitespace() {
        while (pos < str.length) {
            var ch = str.charAt(pos);
            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { pos++; } else { break; }
        }
    }

    function parseObject() {
        var obj = {}; pos++; skipWhitespace();
        if (str.charAt(pos) === '}') { pos++; return obj; }
        while (true) {
            skipWhitespace(); var key = parseString(); skipWhitespace();
            if (str.charAt(pos) !== ':') throw new Error("Expected ':' at position " + pos);
            pos++; var value = parseValue(); obj[key] = value; skipWhitespace();
            var ch = str.charAt(pos);
            if (ch === '}') { pos++; return obj; }
            if (ch !== ',') throw new Error("Expected ',' or '}' at position " + pos);
            pos++;
        }
    }

    function parseArray() {
        var arr = []; pos++; skipWhitespace();
        if (str.charAt(pos) === ']') { pos++; return arr; }
        while (true) {
            var value = parseValue(); arr.push(value); skipWhitespace();
            var ch = str.charAt(pos);
            if (ch === ']') { pos++; return arr; }
            if (ch !== ',') throw new Error("Expected ',' or ']' at position " + pos);
            pos++;
        }
    }

    function parseString() {
        pos++; var result = "";
        while (pos < str.length) {
            var ch = str.charAt(pos);
            if (ch === '"') { pos++; return result; }
            if (ch === '\\') {
                pos++; var escaped = str.charAt(pos);
                switch (escaped) {
                    case '"': result += '"'; break; case '\\': result += '\\'; break;
                    case '/': result += '/'; break; case 'b': result += '\b'; break;
                    case 'f': result += '\f'; break; case 'n': result += '\n'; break;
                    case 'r': result += '\r'; break; case 't': result += '\t'; break;
                    case 'u': var hex = str.substr(pos + 1, 4); result += String.fromCharCode(parseInt(hex, 16)); pos += 4; break;
                    default: result += escaped;
                }
                pos++;
            } else { result += ch; pos++; }
        }
        throw new Error("Unterminated string");
    }

    function parseNumber() {
        var start = pos;
        if (str.charAt(pos) === '-') pos++;
        while (pos < str.length && str.charAt(pos) >= '0' && str.charAt(pos) <= '9') pos++;
        if (pos < str.length && str.charAt(pos) === '.') { pos++; while (pos < str.length && str.charAt(pos) >= '0' && str.charAt(pos) <= '9') pos++; }
        if (pos < str.length && (str.charAt(pos) === 'e' || str.charAt(pos) === 'E')) { pos++; if (str.charAt(pos) === '+' || str.charAt(pos) === '-') pos++; while (pos < str.length && str.charAt(pos) >= '0' && str.charAt(pos) <= '9') pos++; }
        return parseFloat(str.substring(start, pos));
    }

    function parseBoolean() {
        if (str.substr(pos, 4) === 'true') { pos += 4; return true; }
        if (str.substr(pos, 5) === 'false') { pos += 5; return false; }
        throw new Error("Invalid boolean at position " + pos);
    }

    function parseNull() {
        if (str.substr(pos, 4) === 'null') { pos += 4; return null; }
        throw new Error("Invalid null at position " + pos);
    }

    return parseValue();
}

/* -----------------------------------------------------
  Execute
 ----------------------------------------------------- */
try {
    main();
} catch (e) {
    // Write error to temp file for Rust to read
    try {
        var errFile = new File(Folder.temp + "/psd_tiff_script_error.txt");
        errFile.open("w");
        errFile.write("JSX Error: " + (e.message || String(e)) + " (line: " + (e.line || "?") + ")");
        errFile.close();
    } catch (ef) {}
    app.displayDialogs = originalDialogs;
}

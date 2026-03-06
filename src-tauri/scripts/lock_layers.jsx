#target photoshop
app.displayDialogs = DialogModes.NO;

function main() {
    var tempFolder = Folder.temp;
    var settingsFile = new File(tempFolder + "/psd_layer_lock_settings.json");

    if (!settingsFile.exists) {
        alert("Settings file not found: " + settingsFile.fsName);
        return;
    }

    settingsFile.open("r");
    settingsFile.encoding = "UTF-8";
    var jsonStr = settingsFile.read();
    settingsFile.close();

    // Remove UTF-8 BOM if present
    if (jsonStr.charCodeAt(0) === 0xFEFF || jsonStr.charCodeAt(0) === 65279) {
        jsonStr = jsonStr.substring(1);
    }

    var settings;
    try {
        settings = parseJSON(jsonStr);
    } catch (e) {
        alert("Failed to parse settings: " + e.message);
        return;
    }

    var lockBottom = settings.lockBottom;
    var unlockAll = settings.unlockAll || false;
    var saveFolder = settings.saveFolder || null;
    var results = [];

    for (var i = 0; i < settings.files.length; i++) {
        var filePath = settings.files[i];
        var result = processLockFile(filePath, lockBottom, unlockAll, saveFolder);
        results.push(result);
    }

    // Write results
    var outputFile = new File(settings.outputPath);
    outputFile.open("w");
    outputFile.encoding = "UTF-8";
    outputFile.write(arrayToJSON(results));
    outputFile.close();
}

function processLockFile(filePath, lockBottom, unlockAll, saveFolder) {
    var result = {
        filePath: filePath,
        success: false,
        changes: [],
        error: null
    };

    var doc = null;

    try {
        var file = new File(filePath);
        if (!file.exists) {
            result.error = "File not found: " + filePath;
            return result;
        }

        doc = app.open(file);

        if (!doc.layers || doc.layers.length === 0) {
            result.changes.push("No layers found");
            result.success = true;
            doc.close(SaveOptions.DONOTSAVECHANGES);
            return result;
        }

        var lockedCount = 0;
        var unlockedCount = 0;
        var changedNames = [];

        // Unlock all layers first (if enabled)
        if (unlockAll) {
            var unlockResult = unlockAllLayersRecursive(doc, changedNames);
            unlockedCount = unlockResult;
        }

        // Lock bottom layer (if enabled)
        if (lockBottom) {
            // Find the bottom-most layer (last in doc.layers, which is top-to-bottom order)
            var bottomLayer = doc.layers[doc.layers.length - 1];

            // Check if it's a Background layer (needs special handling)
            if (bottomLayer.isBackgroundLayer) {
                changedNames.push("  -> \"" + decodeURI(bottomLayer.name) + "\" (Background layer - already locked)");
                lockedCount++;
            } else {
                if (!bottomLayer.allLocked) {
                    bottomLayer.allLocked = true;
                    changedNames.push("  -> \"" + decodeURI(bottomLayer.name) + "\"");
                    lockedCount++;
                } else {
                    changedNames.push("  -> \"" + decodeURI(bottomLayer.name) + "\" (already locked)");
                }
            }
        }

        // Build summary
        var summaryParts = [];
        if (lockedCount > 0) summaryParts.push(lockedCount + " layer(s) locked");
        if (unlockedCount > 0) summaryParts.push(unlockedCount + " layer(s) unlocked");
        if (summaryParts.length === 0) summaryParts.push("0 layer(s) changed");
        result.changes.push(summaryParts.join(", "));

        for (var c = 0; c < changedNames.length; c++) {
            result.changes.push(changedNames[c]);
        }

        // Save
        var totalChanged = lockedCount + unlockedCount;
        if (totalChanged > 0) {
            if (saveFolder) {
                var saveFolderObj = new Folder(saveFolder);
                if (!saveFolderObj.exists) saveFolderObj.create();
                var saveFile = new File(saveFolder + "/" + decodeURI(file.name));
                doc.saveAs(saveFile);
            } else {
                doc.save();
            }
        }

        result.success = true;
        doc.close(SaveOptions.DONOTSAVECHANGES);

    } catch (e) {
        result.error = e.message;
        if (doc) {
            try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (ex) {}
        }
    }

    return result;
}

function unlockAllLayersRecursive(container, changedNames) {
    var count = 0;
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];

        // Skip background layers (cannot set allLocked on them)
        if (layer.isBackgroundLayer) continue;

        var wasLocked = false;
        var wasVisible = layer.visible;

        if (layer.allLocked) {
            layer.allLocked = false;
            wasLocked = true;
        }

        // Also check individual lock properties
        if (layer.positionLocked) {
            layer.positionLocked = false;
            wasLocked = true;
        }

        // pixelsLocked / transparentPixelsLocked are not supported on
        // text layers, adjustment layers, and layer sets - wrap in try/catch
        try {
            if (layer.pixelsLocked) {
                layer.pixelsLocked = false;
                wasLocked = true;
            }
        } catch (e) { /* not supported for this layer type */ }

        try {
            if (layer.transparentPixelsLocked) {
                layer.transparentPixelsLocked = false;
                wasLocked = true;
            }
        } catch (e) { /* not supported for this layer type */ }

        // Restore visibility (unlocking can change visibility as side effect)
        if (layer.visible !== wasVisible) {
            layer.visible = wasVisible;
        }

        if (wasLocked) {
            changedNames.push("  -> unlocked \"" + decodeURI(layer.name) + "\"");
            count++;
        }

        // Recurse into layer sets (groups)
        if (layer.typename === "LayerSet") {
            count += unlockAllLayersRecursive(layer, changedNames);
        }
    }
    return count;
}

// =====================================================
// JSON helpers (ExtendScript has no native JSON)
// =====================================================
function parseJSON(str) {
    var i = 0;
    function skipWhitespace() {
        while (i < str.length && " \t\n\r".indexOf(str.charAt(i)) >= 0) i++;
    }
    function parseValue() {
        skipWhitespace();
        var c = str.charAt(i);
        if (c === '"') return parseString();
        if (c === '{') return parseObject();
        if (c === '[') return parseArray();
        if (c === 't') { i += 4; return true; }
        if (c === 'f') { i += 5; return false; }
        if (c === 'n') { i += 4; return null; }
        return parseNumber();
    }
    function parseString() {
        i++; // skip opening quote
        var s = "";
        while (i < str.length) {
            var c = str.charAt(i);
            if (c === '"') { i++; return s; }
            if (c === '\\') {
                i++;
                var next = str.charAt(i);
                if (next === '"') s += '"';
                else if (next === '\\') s += '\\';
                else if (next === '/') s += '/';
                else if (next === 'n') s += '\n';
                else if (next === 'r') s += '\r';
                else if (next === 't') s += '\t';
                else if (next === 'u') {
                    var hex = str.substr(i + 1, 4);
                    s += String.fromCharCode(parseInt(hex, 16));
                    i += 4;
                }
                else s += next;
            } else {
                s += c;
            }
            i++;
        }
        return s;
    }
    function parseNumber() {
        var start = i;
        if (str.charAt(i) === '-') i++;
        while (i < str.length && str.charAt(i) >= '0' && str.charAt(i) <= '9') i++;
        if (i < str.length && str.charAt(i) === '.') {
            i++;
            while (i < str.length && str.charAt(i) >= '0' && str.charAt(i) <= '9') i++;
        }
        if (i < str.length && (str.charAt(i) === 'e' || str.charAt(i) === 'E')) {
            i++;
            if (str.charAt(i) === '+' || str.charAt(i) === '-') i++;
            while (i < str.length && str.charAt(i) >= '0' && str.charAt(i) <= '9') i++;
        }
        return parseFloat(str.substring(start, i));
    }
    function parseArray() {
        i++; // skip [
        var arr = [];
        skipWhitespace();
        if (str.charAt(i) === ']') { i++; return arr; }
        while (true) {
            arr.push(parseValue());
            skipWhitespace();
            if (str.charAt(i) === ',') { i++; continue; }
            if (str.charAt(i) === ']') { i++; return arr; }
        }
    }
    function parseObject() {
        i++; // skip {
        var obj = {};
        skipWhitespace();
        if (str.charAt(i) === '}') { i++; return obj; }
        while (true) {
            skipWhitespace();
            var key = parseString();
            skipWhitespace();
            i++; // skip :
            obj[key] = parseValue();
            skipWhitespace();
            if (str.charAt(i) === ',') { i++; continue; }
            if (str.charAt(i) === '}') { i++; return obj; }
        }
    }
    return parseValue();
}

function arrayToJSON(arr) {
    var parts = [];
    for (var i = 0; i < arr.length; i++) {
        parts.push(objectToJSON(arr[i]));
    }
    return "[" + parts.join(",") + "]";
}

function objectToJSON(obj) {
    if (obj === null || obj === undefined) return "null";
    if (typeof obj === "boolean") return obj ? "true" : "false";
    if (typeof obj === "number") return String(obj);
    if (typeof obj === "string") return '"' + escapeString(obj) + '"';
    if (obj instanceof Array) return arrayToJSON(obj);
    var parts = [];
    for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
            var val = obj[key];
            if (val === undefined) continue;
            parts.push('"' + escapeString(key) + '":' + objectToJSON(val));
        }
    }
    return "{" + parts.join(",") + "}";
}

function escapeString(s) {
    return s.replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t");
}

main();

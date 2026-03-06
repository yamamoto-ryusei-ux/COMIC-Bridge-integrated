//! PSD/PSB バイナリ直接パーサー — メタデータ＋埋め込みサムネイル抽出
//!
//! ag-psd (JS) が担っていた機能を Rust で高速に再実装する。
//! 巨大な画像ピクセルデータ (Section 5) はスキップするため、
//! 50–200 MB クラスの PSD でも数十 ms で完了する。

use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

// ================================================================
// Public types (JSON shape must match TypeScript PsdMetadata exactly)
// ================================================================

#[derive(Debug, Clone, Serialize)]
pub struct PsdMetadata {
    pub width: u32,
    pub height: u32,
    pub dpi: u32,
    #[serde(rename = "colorMode")]
    pub color_mode: String,
    #[serde(rename = "bitsPerChannel")]
    pub bits_per_channel: u16,
    #[serde(rename = "hasGuides")]
    pub has_guides: bool,
    pub guides: Vec<Guide>,
    #[serde(rename = "layerCount")]
    pub layer_count: u32,
    #[serde(rename = "layerTree")]
    pub layer_tree: Vec<LayerNode>,
    #[serde(rename = "hasAlphaChannels")]
    pub has_alpha_channels: bool,
    #[serde(rename = "alphaChannelCount")]
    pub alpha_channel_count: u32,
    #[serde(rename = "alphaChannelNames")]
    pub alpha_channel_names: Vec<String>,
    #[serde(rename = "hasTombo")]
    pub has_tombo: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Guide {
    pub direction: String, // "horizontal" | "vertical"
    pub position: i32,     // pixels from top/left
}

#[derive(Debug, Clone, Serialize)]
pub struct LayerBounds {
    pub top: i32,
    pub left: i32,
    pub bottom: i32,
    pub right: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayerNode {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub layer_type: String,
    pub visible: bool,
    pub opacity: u32, // 0-100
    #[serde(rename = "blendMode")]
    pub blend_mode: String,
    #[serde(rename = "hasMask")]
    pub has_mask: bool,
    #[serde(rename = "hasVectorMask")]
    pub has_vector_mask: bool,
    pub clipping: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    #[serde(rename = "textInfo", skip_serializing_if = "Option::is_none")]
    pub text_info: Option<TextInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<LayerNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayerBounds>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TextInfo {
    pub text: String,
    pub fonts: Vec<String>,
    #[serde(rename = "fontSizes")]
    pub font_sizes: Vec<f64>,
    #[serde(rename = "strokeSize", skip_serializing_if = "Option::is_none")]
    pub stroke_size: Option<f64>,
    #[serde(rename = "antiAlias", skip_serializing_if = "Option::is_none")]
    pub anti_alias: Option<String>,
    /// カーニング（トラッキング）値のリスト（0以外の値のみ収集）
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tracking: Vec<f64>,
}

// ================================================================
// Internal raw layer record (before tree construction)
// ================================================================

#[derive(Debug)]
struct RawLayer {
    name: String,
    visible: bool,
    opacity: u8,
    blend_mode: String,
    clipping: bool,
    has_mask: bool,
    has_vector_mask: bool,
    is_text: bool,
    is_smart_object: bool,
    is_adjustment: bool,
    is_shape: bool,
    /// lsct section divider type: None = normal layer, Some(0) = hidden divider,
    /// Some(1/2) = open/closed group
    section_type: Option<u32>,
    /// Parsed TySh (text layer) data
    tysh_data: Option<TyShData>,
    /// Stroke (border) size from lfx2 layer effects
    stroke_size: Option<f64>,
    /// transparency protected flag (bit 0 of layer flags byte)
    transparency_protected: bool,
    /// Bounding rect from layer record
    top: i32,
    left: i32,
    bottom: i32,
    right: i32,
}

#[derive(Debug)]
struct TyShData {
    text: String,
    fonts: Vec<String>,
    font_sizes: Vec<f64>,
    anti_alias: Option<String>,
    tracking: Vec<f64>,
}

// ================================================================
// Public entry point
// ================================================================

/// PSD ファイルをパースしてメタデータとサムネイルbase64 (Option) を返す。
pub fn parse_psd_file(file_path: &str) -> Result<(PsdMetadata, Option<String>), String> {
    let path = Path::new(file_path);
    let file = File::open(path).map_err(|e| format!("ファイルを開けません: {}", e))?;
    let mut r = BufReader::with_capacity(256 * 1024, file);

    // ---- Section 1: Header (26 bytes) ----
    let (version, _channels, height, width, depth, color_mode_num) = read_header(&mut r)?;

    // ---- Section 2: Color Mode Data ----
    skip_section_u32(&mut r)?;

    // ---- Section 3: Image Resources ----
    let section3_len = read_u32(&mut r)?;
    let section3_start = stream_pos(&mut r)?;
    let resources = parse_image_resources(&mut r, section3_len as u64)?;
    // Ensure we move past section 3 entirely
    seek_to(&mut r, section3_start + section3_len as u64)?;

    // ---- Section 4: Layer and Mask Information ----
    let section4_len = if version == 2 {
        read_u64(&mut r)?
    } else {
        read_u32(&mut r)? as u64
    };
    let section4_start = stream_pos(&mut r)?;
    let raw_layers = if section4_len > 0 {
        parse_layer_info(&mut r, version)?
    } else {
        Vec::new()
    };
    // Skip rest of section 4
    let _ = seek_to(&mut r, section4_start + section4_len);

    // ---- Build results ----
    let dpi = resources.dpi.unwrap_or(72);
    let color_mode = map_color_mode(color_mode_num);

    // Build layer tree from flat raw_layers
    let layer_tree = build_layer_tree(&raw_layers, dpi);
    let layer_count = count_layers(&layer_tree);
    let has_tombo = detect_tombo(&layer_tree);

    // Thumbnail: encode JFIF as base64 (no temp file / asset protocol needed)
    let thumb_base64 = resources.thumbnail_jfif.as_ref().map(|jfif| base64_encode(jfif));

    let metadata = PsdMetadata {
        width,
        height,
        dpi,
        color_mode,
        bits_per_channel: depth,
        has_guides: !resources.guides.is_empty(),
        guides: resources.guides,
        layer_count,
        layer_tree,
        has_alpha_channels: !resources.alpha_channel_names.is_empty(),
        alpha_channel_count: resources.alpha_channel_names.len() as u32,
        alpha_channel_names: resources.alpha_channel_names,
        has_tombo,
    };

    Ok((metadata, thumb_base64))
}

// ================================================================
// Section 1: Header
// ================================================================

fn read_header<R: Read + Seek>(r: &mut R) -> Result<(u16, u16, u32, u32, u16, u16), String> {
    let mut sig = [0u8; 4];
    r.read_exact(&mut sig).map_err(|e| format!("ヘッダー読み取りエラー: {}", e))?;
    if &sig != b"8BPS" {
        return Err("PSDファイルではありません".to_string());
    }

    let version = read_u16(r)?;
    if version != 1 && version != 2 {
        return Err(format!("未対応のPSDバージョン: {}", version));
    }

    // Reserved 6 bytes
    r.seek(SeekFrom::Current(6)).map_err(|e| format!("Seek error: {}", e))?;

    let channels = read_u16(r)?;
    let height = read_u32(r)?;
    let width = read_u32(r)?;
    let depth = read_u16(r)?;
    let color_mode = read_u16(r)?;

    Ok((version, channels, height, width, depth, color_mode))
}

// ================================================================
// Section 3: Image Resources
// ================================================================

struct ImageResources {
    dpi: Option<u32>,
    guides: Vec<Guide>,
    alpha_channel_names: Vec<String>,
    thumbnail_jfif: Option<Vec<u8>>,
}

fn parse_image_resources<R: Read + Seek>(r: &mut R, section_len: u64) -> Result<ImageResources, String> {
    let mut result = ImageResources {
        dpi: None,
        guides: Vec::new(),
        alpha_channel_names: Vec::new(),
        thumbnail_jfif: None,
    };

    let start = stream_pos(r)?;
    let end = start + section_len;

    while stream_pos(r)? + 12 <= end {
        // Signature: "8BIM" (or "MeSa", "AgHg", "PHUT", "DCSR") (4 bytes)
        let mut sig = [0u8; 4];
        if r.read_exact(&mut sig).is_err() {
            break;
        }

        // Non-8BIM signatures still follow the same resource format — parse and skip
        let is_8bim = &sig == b"8BIM";
        if !is_8bim && &sig != b"MeSa" && &sig != b"AgHg" && &sig != b"PHUT" && &sig != b"DCSR" {
            // Unknown signature — can't safely continue
            break;
        }

        // Resource ID (2 bytes)
        let resource_id = read_u16(r)?;

        // Pascal string (name) — padded to even length
        let name_len = read_u8(r)? as u64;
        // Total bytes for pascal string: 1 (length byte) + name_len, padded to even
        let pascal_total = 1 + name_len;
        let padded = if pascal_total % 2 != 0 { pascal_total + 1 } else { pascal_total };
        // We already read 1 byte (name_len), skip the rest
        let skip = padded - 1;
        if skip > 0 {
            r.seek(SeekFrom::Current(skip as i64))
                .map_err(|e| format!("Seek error: {}", e))?;
        }

        // Data length (4 bytes)
        let data_len = read_u32(r)? as u64;
        let data_start = stream_pos(r)?;

        if is_8bim {
            match resource_id {
                // Resolution Info (0x03ED = 1005)
                0x03ED => {
                    result.dpi = parse_resolution_info(r).ok();
                }
                // Grid and Guides (0x0408 = 1032)
                0x0408 => {
                    if let Ok(guides) = parse_guides(r, data_len) {
                        result.guides = guides;
                    }
                }
                // Alpha Channel Names (0x0415 = 1045)
                0x0415 => {
                    if let Ok(names) = parse_alpha_channel_names(r, data_len) {
                        result.alpha_channel_names = names;
                    }
                }
                // Thumbnail (0x040C = 1036, 0x0409 = 1033) — JFIF data
                0x040C | 0x0409 => {
                    if result.thumbnail_jfif.is_none() {
                        if let Ok(jfif) = parse_thumbnail_resource(r, data_len) {
                            result.thumbnail_jfif = Some(jfif);
                        }
                    }
                }
                _ => {}
            }
        }

        // Advance to end of this resource data (padded to even)
        let padded_len = if data_len % 2 != 0 { data_len + 1 } else { data_len };
        let _ = seek_to(r, data_start + padded_len);
    }

    Ok(result)
}

/// Resolution Info: Fixed 16.16 horizontal resolution
fn parse_resolution_info<R: Read>(r: &mut R) -> Result<u32, String> {
    // hRes: Fixed 16.16 (4 bytes) = integer part is the DPI
    let h_res_fixed = read_u32(r)?;
    let dpi = h_res_fixed >> 16; // integer part
    // Skip: hResUnit(2), widthUnit(2), vRes(4), vResUnit(2), heightUnit(2) = 12 bytes
    // (caller will seek past the full resource anyway)
    Ok(if dpi == 0 { 72 } else { dpi })
}

/// Grid and Guides Information
fn parse_guides<R: Read>(r: &mut R, data_len: u64) -> Result<Vec<Guide>, String> {
    if data_len < 16 {
        return Ok(Vec::new());
    }
    // Version (4), grid spacing H (4), grid spacing V (4)
    let mut _skip = [0u8; 12];
    r.read_exact(&mut _skip).map_err(|e| format!("Guide read error: {}", e))?;

    // Number of guides (4 bytes)
    let count = read_u32(r)?;
    let mut guides = Vec::with_capacity(count as usize);

    for _ in 0..count {
        // Position: Fixed 27.5 (4 bytes) — divide by 32 to get pixels
        let pos_raw = read_u32(r)? as i32;
        let position = pos_raw / 32;
        // Direction: 0 = vertical, 1 = horizontal
        let dir_byte = read_u8(r)?;
        let direction = if dir_byte == 0 { "vertical" } else { "horizontal" };
        guides.push(Guide {
            direction: direction.to_string(),
            position,
        });
    }

    Ok(guides)
}

/// Alpha Channel Names — sequence of Pascal strings
fn parse_alpha_channel_names<R: Read>(r: &mut R, data_len: u64) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let mut consumed = 0u64;

    while consumed < data_len {
        let len = read_u8(r)? as u64;
        consumed += 1;
        if len == 0 {
            // Empty name — still a valid alpha channel
            names.push(String::new());
            continue;
        }
        if consumed + len > data_len {
            break;
        }
        let mut buf = vec![0u8; len as usize];
        r.read_exact(&mut buf).map_err(|e| format!("Alpha name read error: {}", e))?;
        consumed += len;
        // Try UTF-8 first, then Shift-JIS fallback
        let name = String::from_utf8(buf.clone()).unwrap_or_else(|_| {
            // Simple fallback: replace invalid bytes with ?
            buf.iter().map(|&b| if b.is_ascii() { b as char } else { '?' }).collect()
        });
        names.push(name);
    }

    Ok(names)
}

/// Thumbnail Resource (ID 0x040C) — JFIF data
fn parse_thumbnail_resource<R: Read>(r: &mut R, data_len: u64) -> Result<Vec<u8>, String> {
    if data_len < 28 {
        return Err("Thumbnail resource too short".to_string());
    }
    // Header: format(4), width(4), height(4), widthBytes(4), totalSize(4), compressedSize(4), bitsPerPixel(2), numPlanes(2) = 28 bytes
    let format = read_u32(r)?;
    // Skip width(4), height(4), widthBytes(4), totalSize(4), compressedSize(4), bitsPerPixel(2), numPlanes(2)
    let mut _skip = [0u8; 24];
    r.read_exact(&mut _skip).map_err(|e| format!("Thumbnail header read error: {}", e))?;

    let jfif_len = data_len - 28;
    if format != 1 || jfif_len == 0 {
        return Err("Not JFIF thumbnail or empty".to_string());
    }

    let mut jfif = vec![0u8; jfif_len as usize];
    r.read_exact(&mut jfif).map_err(|e| format!("Thumbnail data read error: {}", e))?;

    Ok(jfif)
}

// ================================================================
// Section 4: Layer and Mask Information
// ================================================================

fn parse_layer_info<R: Read + Seek>(r: &mut R, version: u16) -> Result<Vec<RawLayer>, String> {
    // Layer info length
    let layer_info_len = if version == 2 {
        read_u64(r)?
    } else {
        read_u32(r)? as u64
    };

    if layer_info_len == 0 {
        return Ok(Vec::new());
    }

    let layer_info_start = stream_pos(r)?;

    // Layer count (2 bytes, signed — negative means first alpha is merged result)
    let layer_count_raw = read_i16(r)?;
    let layer_count = layer_count_raw.unsigned_abs() as usize;

    if layer_count == 0 {
        return Ok(Vec::new());
    }

    // Read layer records
    let mut raw_layers = Vec::with_capacity(layer_count);

    for _ in 0..layer_count {
        match parse_layer_record(r, version) {
            Ok(layer) => raw_layers.push(layer),
            Err(_) => {
                // Can't continue parsing if one layer record fails
                break;
            }
        }
    }

    // Skip channel image data (we don't need pixel data)
    // Jump past the entire layer info section
    let _ = seek_to(r, layer_info_start + layer_info_len);

    Ok(raw_layers)
}

fn parse_layer_record<R: Read + Seek>(r: &mut R, version: u16) -> Result<RawLayer, String> {
    // Bounding rect: top(4), left(4), bottom(4), right(4) = 16 bytes
    let top = read_i32(r)?;
    let left = read_i32(r)?;
    let bottom = read_i32(r)?;
    let right = read_i32(r)?;

    // Number of channels (2 bytes)
    let channel_count = read_u16(r)? as u64;
    // Channel info: each is (2 bytes ID + 4/8 bytes data length)
    let channel_entry_size = if version == 2 { 2 + 8 } else { 2 + 4 };
    r.seek(SeekFrom::Current((channel_count * channel_entry_size) as i64))
        .map_err(|e| format!("Seek error: {}", e))?;

    // Blend mode signature: "8BIM" (4 bytes)
    let mut blend_sig = [0u8; 4];
    r.read_exact(&mut blend_sig).map_err(|e| format!("Blend sig read error: {}", e))?;

    // Blend mode key (4 bytes)
    let mut blend_key = [0u8; 4];
    r.read_exact(&mut blend_key).map_err(|e| format!("Blend mode read error: {}", e))?;
    let blend_mode = blend_mode_to_string(&blend_key);

    // Opacity (1 byte, 0-255)
    let opacity_raw = read_u8(r)?;
    // Clipping (1 byte, 0=base, 1=non-base)
    let clipping_raw = read_u8(r)?;
    // Flags (1 byte)
    let flags = read_u8(r)?;
    // Filler (1 byte)
    r.seek(SeekFrom::Current(1)).map_err(|e| format!("Seek error: {}", e))?;

    let transparency_protected = (flags & 0x01) != 0; // bit 0: transparency protected
    let visible = (flags & 0x02) == 0; // bit 1: 0=visible, 1=hidden

    // Extra data field length (4 bytes)
    let extra_len = read_u32(r)? as u64;
    let extra_start = stream_pos(r)?;

    // Parse extra data for: mask, vector mask, layer name, section divider, etc.
    let mut name = String::new();
    let mut section_type: Option<u32> = None;
    let mut has_mask = false;
    let mut has_vector_mask = false;
    let mut is_text = false;
    let mut is_smart_object = false;
    let mut is_adjustment = false;
    let mut is_shape = false;
    let mut tysh_data: Option<TyShData> = None;
    let mut stroke_size: Option<f64> = None;

    // Layer mask data
    let mask_len = read_u32(r)? as u64;
    if mask_len > 0 {
        has_mask = true;
        r.seek(SeekFrom::Current(mask_len as i64))
            .map_err(|e| format!("Seek error: {}", e))?;
    }

    // Layer blending ranges
    let blend_ranges_len = read_u32(r)? as u64;
    r.seek(SeekFrom::Current(blend_ranges_len as i64))
        .map_err(|e| format!("Seek error: {}", e))?;

    // Layer name (Pascal string, padded to 4 bytes)
    let name_start = stream_pos(r)?;
    let name_byte_len = read_u8(r)? as u64;
    if name_byte_len > 0 {
        let mut name_buf = vec![0u8; name_byte_len as usize];
        r.read_exact(&mut name_buf).map_err(|e| format!("Name read error: {}", e))?;
        name = String::from_utf8(name_buf.clone()).unwrap_or_else(|_| {
            // Try Shift-JIS fallback for Japanese names (simple lossy)
            name_buf.iter().map(|&b| if b.is_ascii() { b as char } else { '?' }).collect()
        });
    }
    // Pad to multiple of 4
    let name_total = 1 + name_byte_len;
    let name_padded = ((name_total + 3) / 4) * 4;
    let _ = seek_to(r, name_start + name_padded);

    // Additional layer information (tagged blocks)
    let extra_end = extra_start + extra_len;
    while stream_pos(r)? + 12 <= extra_end {
        let mut tag_sig = [0u8; 4];
        if r.read_exact(&mut tag_sig).is_err() {
            break;
        }
        if &tag_sig != b"8BIM" && &tag_sig != b"8B64" {
            break;
        }

        let mut tag_key = [0u8; 4];
        if r.read_exact(&mut tag_key).is_err() {
            break;
        }

        // For PSB (version 2), certain keys use 8-byte lengths
        let tag_data_len = if version == 2 && is_psb_long_key(&tag_key) {
            read_u64(r)?
        } else {
            read_u32(r)? as u64
        };
        let tag_data_start = stream_pos(r)?;

        match &tag_key {
            // Unicode layer name
            b"luni" => {
                if let Ok(uname) = read_unicode_string(r) {
                    if !uname.is_empty() {
                        name = uname;
                    }
                }
            }
            // Section divider (group markers)
            b"lsct" | b"lsdk" => {
                if tag_data_len >= 4 {
                    section_type = Some(read_u32(r)?);
                }
            }
            // Vector mask
            b"vmsk" | b"vsms" => {
                has_vector_mask = true;
            }
            // Text layer — also extract text content, fonts, sizes
            b"TySh" => {
                is_text = true;
                if tag_data_len > 50 && tag_data_len < 10_000_000 {
                    let mut tysh_buf = vec![0u8; tag_data_len as usize];
                    if r.read_exact(&mut tysh_buf).is_ok() {
                        tysh_data = parse_tysh_data(&tysh_buf);
                    }
                }
            }
            // Layer effects (stroke/border etc.)
            b"lfx2" | b"lmfx" => {
                if tag_data_len > 8 && tag_data_len < 1_000_000 {
                    let mut buf = vec![0u8; tag_data_len as usize];
                    if r.read_exact(&mut buf).is_ok() {
                        stroke_size = parse_lfx2_stroke_size(&buf);
                    }
                }
            }
            // Smart object
            b"SoLd" | b"PlLd" | b"SoLE" => {
                is_smart_object = true;
            }
            // Vector fill / stroke → shape layer
            b"vscg" | b"vstk" | b"SoCo" | b"GdFl" | b"PtFl" => {
                is_shape = true;
            }
            // Adjustment layers
            b"brit" | b"levl" | b"curv" | b"expA" | b"vibA"
            | b"hue " | b"hue2" | b"blnc" | b"blwh" | b"phfl"
            | b"mixr" | b"clrL" | b"nvrt" | b"post" | b"thrs"
            | b"grdm" | b"selc" | b"CgEd" => {
                is_adjustment = true;
            }
            _ => {}
        }

        // Padded to even
        let padded_len = if tag_data_len % 2 != 0 { tag_data_len + 1 } else { tag_data_len };
        let _ = seek_to(r, tag_data_start + padded_len);
    }

    // Ensure we're at end of extra data
    let _ = seek_to(r, extra_start + extra_len);

    Ok(RawLayer {
        name: if name.is_empty() { "Unnamed Layer".to_string() } else { name },
        visible,
        opacity: opacity_raw,
        blend_mode,
        clipping: clipping_raw != 0,
        has_mask,
        has_vector_mask,
        is_text,
        is_smart_object,
        is_adjustment,
        is_shape,
        section_type,
        tysh_data,
        stroke_size,
        transparency_protected,
        top,
        left,
        bottom,
        right,
    })
}

/// PSB (v2) uses 8-byte data lengths for certain tagged blocks
fn is_psb_long_key(key: &[u8; 4]) -> bool {
    matches!(
        key,
        b"LMsk" | b"Lr16" | b"Lr32" | b"Layr" | b"Mt16" | b"Mt32"
        | b"Mtrn" | b"Alph" | b"FMsk" | b"lnk2" | b"FEid" | b"FXid"
        | b"PxSD" | b"cinf" | b"lnkE"
    )
}

// ================================================================
// Layer tree construction
// ================================================================

fn build_layer_tree(raw_layers: &[RawLayer], dpi: u32) -> Vec<LayerNode> {
    // PSD stores layers in bottom-to-top order (file order).
    // ag-psd returns layers in this same bottom-to-top order, and UI components
    // (.reverse()) handle the display reversal. So we process in file order.
    //
    // Group structure in file order (bottom-to-top):
    //   type=0 (hidden divider) = group START boundary
    //   ...children layers...
    //   type=1/2 (open/closed group) = group END boundary (has the group name)

    let mut root: Vec<LayerNode> = Vec::new();
    let mut stack: Vec<Vec<LayerNode>> = Vec::new(); // stack of children-in-progress
    let mut index_counter = 0u32;
    let mut path_stack: Vec<String> = Vec::new();

    for raw in raw_layers {
        match raw.section_type {
            Some(0) | Some(3) => {
                // Group START (hidden divider) — push current context, start collecting children
                stack.push(std::mem::take(&mut root));
                let path = if path_stack.is_empty() {
                    format!("{}", index_counter)
                } else {
                    format!("{}-{}", path_stack.last().unwrap(), index_counter)
                };
                path_stack.push(path);
                root = Vec::new();
                index_counter += 1;
            }
            Some(1) | Some(2) => {
                // Group END — pop and create group node with the group's name from this record
                let children = std::mem::take(&mut root);
                root = stack.pop().unwrap_or_default();
                let path = path_stack.pop().unwrap_or_else(|| format!("{}", index_counter));

                let node = LayerNode {
                    id: format!("layer-{}", path),
                    name: raw.name.clone(),
                    layer_type: "group".to_string(),
                    visible: raw.visible,
                    opacity: ((raw.opacity as u32) * 100 / 255),
                    blend_mode: raw.blend_mode.clone(),
                    has_mask: raw.has_mask,
                    has_vector_mask: raw.has_vector_mask,
                    clipping: raw.clipping,
                    locked: if raw.transparency_protected { Some(true) } else { None },
                    text_info: None,
                    children: if children.is_empty() { None } else { Some(children) },
                    bounds: None, // Groups don't have meaningful bounds
                };
                root.push(node);
            }
            None => {
                // Normal layer
                let path = if path_stack.is_empty() {
                    format!("{}", index_counter)
                } else {
                    format!("{}-{}", path_stack.last().unwrap(), index_counter)
                };

                let layer_type = if raw.is_text {
                    "text"
                } else if raw.is_adjustment {
                    "adjustment"
                } else if raw.is_smart_object {
                    "smartObject"
                } else if raw.is_shape {
                    "shape"
                } else {
                    "layer"
                };

                let text_info = raw.tysh_data.as_ref().map(|td| {
                    // EngineData stores font sizes in document pixels;
                    // convert to points: pt = px * 72 / dpi
                    let dpi_f = dpi as f64;
                    let font_sizes: Vec<f64> = if dpi > 72 {
                        td.font_sizes.iter().map(|&s| {
                            let pt = s * 72.0 / dpi_f;
                            (pt * 10.0).round() / 10.0
                        }).collect()
                    } else {
                        td.font_sizes.clone()
                    };
                    TextInfo {
                        text: td.text.clone(),
                        fonts: td.fonts.clone(),
                        font_sizes,
                        stroke_size: raw.stroke_size,
                        anti_alias: td.anti_alias.clone(),
                        tracking: td.tracking.clone(),
                    }
                });

                let bounds = if raw.right > raw.left && raw.bottom > raw.top {
                    Some(LayerBounds {
                        top: raw.top,
                        left: raw.left,
                        bottom: raw.bottom,
                        right: raw.right,
                    })
                } else {
                    None
                };

                let node = LayerNode {
                    id: format!("layer-{}", path),
                    name: raw.name.clone(),
                    layer_type: layer_type.to_string(),
                    visible: raw.visible,
                    opacity: ((raw.opacity as u32) * 100 / 255),
                    blend_mode: raw.blend_mode.clone(),
                    has_mask: raw.has_mask,
                    has_vector_mask: raw.has_vector_mask,
                    clipping: raw.clipping,
                    locked: if raw.transparency_protected { Some(true) } else { None },
                    text_info,
                    children: None,
                    bounds,
                };
                root.push(node);
                index_counter += 1;
            }
            _ => {}
        }
    }

    root
}

fn count_layers(nodes: &[LayerNode]) -> u32 {
    let mut count = 0u32;
    for node in nodes {
        count += 1;
        if let Some(ref children) = node.children {
            count += count_layers(children);
        }
    }
    count
}

fn detect_tombo(nodes: &[LayerNode]) -> bool {
    for node in nodes {
        if node.name.contains("トンボ") {
            return true;
        }
        if let Some(ref children) = node.children {
            if detect_tombo(children) {
                return true;
            }
        }
    }
    false
}

// ================================================================
// TySh (Text Layer) Parsing
// ================================================================

/// Parse TySh tagged block data to extract text content, font names, and sizes.
/// Returns None on any parse error (graceful fallback to text_info: None).
fn parse_tysh_data(data: &[u8]) -> Option<TyShData> {
    use std::io::Cursor;
    let mut r = Cursor::new(data);

    // Version (2 bytes) — expect 1
    let _version = read_u16(&mut r).ok()?;

    // Transform matrix: 6 doubles (48 bytes) — skip for now
    r.seek(SeekFrom::Current(48)).ok()?;

    // Text data version (2 bytes)
    let _text_version = read_u16(&mut r).ok()?;

    // Descriptor version (4 bytes)
    let _desc_version = read_u32(&mut r).ok()?;

    // Parse text descriptor — extract "Txt " text, "EngineData" blob, and "AntA" anti-alias
    let (text, engine_data, anti_alias) = parse_ps_descriptor_for_text(&mut r)?;

    // Extract font names and sizes from EngineData
    // Note: font sizes are in document pixels; DPI conversion happens in build_layer_tree
    let (fonts, font_sizes, tracking) = match engine_data {
        Some(ed) => extract_from_engine_data(&ed),
        None => (Vec::new(), Vec::new(), Vec::new()),
    };

    Some(TyShData { text, fonts, font_sizes, anti_alias, tracking })
}

/// Parse a Photoshop descriptor, extracting "Txt " (text content),
/// "EngineData" (raw blob for font extraction), and "AntA" (anti-aliasing enum).
fn parse_ps_descriptor_for_text<R: Read + Seek>(r: &mut R) -> Option<(String, Option<Vec<u8>>, Option<String>)> {
    // Unicode class name (length-prefixed, UTF-16BE)
    let name_len = read_u32(r).ok()? as i64;
    r.seek(SeekFrom::Current(name_len * 2)).ok()?;

    // Class ID (length-prefixed; if length=0, read 4 bytes)
    let class_id_len = read_u32(r).ok()?;
    r.seek(SeekFrom::Current(if class_id_len == 0 { 4 } else { class_id_len as i64 })).ok()?;

    // Item count
    let count = read_u32(r).ok()?;
    if count > 200 { return None; }

    let mut text: Option<String> = None;
    let mut engine_data: Option<Vec<u8>> = None;
    let mut anti_alias: Option<String> = None;

    for _ in 0..count {
        // Key
        let key = read_ps_key(r)?;

        // Type tag (4 bytes)
        let mut tt = [0u8; 4];
        r.read_exact(&mut tt).ok()?;

        match &tt {
            b"TEXT" => {
                let s = read_ps_text(r)?;
                if key == b"Txt " { text = Some(s); }
            }
            b"tdta" => {
                let data_len = read_u32(r).ok()? as usize;
                if data_len > 50_000_000 { return None; }
                if key.starts_with(b"Engin") {
                    let mut buf = vec![0u8; data_len];
                    r.read_exact(&mut buf).ok()?;
                    engine_data = Some(buf);
                } else {
                    r.seek(SeekFrom::Current(data_len as i64)).ok()?;
                }
            }
            b"enum" if key == b"AntA" => {
                // Read enum type ID (skip)
                let t = read_u32(r).ok()?;
                r.seek(SeekFrom::Current(if t == 0 { 4 } else { t as i64 })).ok()?;
                // Read enum value (4-byte OSType)
                let v = read_u32(r).ok()?;
                let actual = if v == 0 { 4 } else { v as usize };
                let mut val_buf = vec![0u8; actual];
                r.read_exact(&mut val_buf).ok()?;
                anti_alias = Some(String::from_utf8_lossy(&val_buf).trim_end_matches('\0').to_string());
            }
            _ => {
                if skip_ps_value(r, &tt).is_none() { break; }
            }
        }
    }

    Some((text.unwrap_or_default(), engine_data, anti_alias))
}

/// Read a Photoshop descriptor key (4-byte length; if 0, key is 4 bytes)
fn read_ps_key<R: Read>(r: &mut R) -> Option<Vec<u8>> {
    let len = read_u32(r).ok()?;
    let actual = if len == 0 { 4 } else { len as usize };
    let mut buf = vec![0u8; actual];
    r.read_exact(&mut buf).ok()?;
    Some(buf)
}

/// Read a Unicode TEXT value from a Photoshop descriptor
fn read_ps_text<R: Read>(r: &mut R) -> Option<String> {
    let char_count = read_u32(r).ok()? as usize;
    if char_count == 0 { return Some(String::new()); }
    if char_count > 10_000_000 { return None; }
    let mut buf = vec![0u8; char_count * 2];
    r.read_exact(&mut buf).ok()?;
    let utf16: Vec<u16> = buf.chunks_exact(2)
        .map(|c| u16::from_be_bytes([c[0], c[1]]))
        .collect();
    let end = utf16.iter().position(|&c| c == 0).unwrap_or(utf16.len());
    Some(String::from_utf16_lossy(&utf16[..end]))
}

/// Skip a typed Photoshop descriptor value (for types we don't need)
fn skip_ps_value<R: Read + Seek>(r: &mut R, tt: &[u8; 4]) -> Option<()> {
    match tt {
        b"TEXT" => { let n = read_u32(r).ok()? as i64; r.seek(SeekFrom::Current(n * 2)).ok()?; }
        b"tdta" | b"alis" | b"Pth " => { let n = read_u32(r).ok()? as i64; r.seek(SeekFrom::Current(n)).ok()?; }
        b"Objc" | b"GlbO" => { skip_ps_descriptor(r)?; }
        b"VlLs" => {
            let count = read_u32(r).ok()?;
            for _ in 0..count { skip_ps_typed_value(r)?; }
        }
        b"enum" => {
            let t = read_u32(r).ok()?;
            r.seek(SeekFrom::Current(if t == 0 { 4 } else { t as i64 })).ok()?;
            let v = read_u32(r).ok()?;
            r.seek(SeekFrom::Current(if v == 0 { 4 } else { v as i64 })).ok()?;
        }
        b"long" => { r.seek(SeekFrom::Current(4)).ok()?; }
        b"doub" => { r.seek(SeekFrom::Current(8)).ok()?; }
        b"bool" => { r.seek(SeekFrom::Current(1)).ok()?; }
        b"UntF" => { r.seek(SeekFrom::Current(12)).ok()?; } // unit(4) + double(8)
        b"comp" => { r.seek(SeekFrom::Current(8)).ok()?; }
        b"type" | b"GlbC" => {
            // Class reference: name + classID
            let n = read_u32(r).ok()? as i64;
            r.seek(SeekFrom::Current(n * 2)).ok()?;
            let c = read_u32(r).ok()?;
            r.seek(SeekFrom::Current(if c == 0 { 4 } else { c as i64 })).ok()?;
        }
        _ => { return None; } // Unknown type — bail
    }
    Some(())
}

/// Skip an entire Photoshop descriptor (for nested Objc values)
fn skip_ps_descriptor<R: Read + Seek>(r: &mut R) -> Option<()> {
    let name_len = read_u32(r).ok()? as i64;
    r.seek(SeekFrom::Current(name_len * 2)).ok()?;
    let class_id_len = read_u32(r).ok()?;
    r.seek(SeekFrom::Current(if class_id_len == 0 { 4 } else { class_id_len as i64 })).ok()?;
    let count = read_u32(r).ok()?;
    if count > 200 { return None; }
    for _ in 0..count {
        // Key
        let kl = read_u32(r).ok()?;
        r.seek(SeekFrom::Current(if kl == 0 { 4 } else { kl as i64 })).ok()?;
        // Typed value
        skip_ps_typed_value(r)?;
    }
    Some(())
}

/// Skip a single typed value (type tag + value)
fn skip_ps_typed_value<R: Read + Seek>(r: &mut R) -> Option<()> {
    let mut tt = [0u8; 4];
    r.read_exact(&mut tt).ok()?;
    skip_ps_value(r, &tt)
}

// ================================================================
// lfx2: Layer effects — extract stroke (FrFX) size
// ================================================================

/// Parse lfx2 tag data and extract stroke (border/FrFX) size in pixels.
/// Returns None if no enabled stroke effect is found.
fn parse_lfx2_stroke_size(data: &[u8]) -> Option<f64> {
    use std::io::Cursor;
    let mut r = Cursor::new(data);

    // Version (4 bytes)
    let _version = read_u32(&mut r).ok()?;

    // Descriptor version (4 bytes) — present in lfx2
    let _desc_version = read_u32(&mut r).ok()?;

    // Parse outer descriptor: look for "FrFX" key
    // Unicode class name
    let name_len = read_u32(&mut r).ok()? as i64;
    r.seek(SeekFrom::Current(name_len * 2)).ok()?;
    // Class ID
    let class_id_len = read_u32(&mut r).ok()?;
    r.seek(SeekFrom::Current(if class_id_len == 0 { 4 } else { class_id_len as i64 })).ok()?;

    let count = read_u32(&mut r).ok()?;
    if count > 100 { return None; }

    for _ in 0..count {
        let key = read_ps_key(&mut r)?;
        let mut tt = [0u8; 4];
        r.read_exact(&mut tt).ok()?;

        if key == b"FrFX" && (&tt == b"Objc" || &tt == b"GlbO") {
            // Parse the FrFX descriptor to find enab and Sz
            return parse_frfx_descriptor(&mut r);
        } else {
            skip_ps_value(&mut r, &tt)?;
        }
    }
    None
}

/// Parse a FrFX (stroke) descriptor, extracting enabled state and size.
fn parse_frfx_descriptor<R: Read + Seek>(r: &mut R) -> Option<f64> {
    // Unicode class name
    let name_len = read_u32(r).ok()? as i64;
    r.seek(SeekFrom::Current(name_len * 2)).ok()?;
    // Class ID
    let class_id_len = read_u32(r).ok()?;
    r.seek(SeekFrom::Current(if class_id_len == 0 { 4 } else { class_id_len as i64 })).ok()?;

    let count = read_u32(r).ok()?;
    if count > 100 { return None; }

    let mut enabled = true;
    let mut size: Option<f64> = None;

    for _ in 0..count {
        let key = read_ps_key(r)?;
        let mut tt = [0u8; 4];
        r.read_exact(&mut tt).ok()?;

        if key == b"enab" && &tt == b"bool" {
            let mut b = [0u8; 1];
            r.read_exact(&mut b).ok()?;
            enabled = b[0] != 0;
        } else if key == b"Sz  " && &tt == b"UntF" {
            // Unit (4 bytes) + double (8 bytes)
            r.seek(SeekFrom::Current(4)).ok()?; // skip unit (e.g. #Pxl)
            let val = read_f64(r).ok()?;
            size = Some(val);
        } else {
            skip_ps_value(r, &tt)?;
        }
    }

    if enabled { size } else { None }
}

/// Extract font PostScript names and font sizes from EngineData blob.
/// Builds a font index from /FontSet, then only returns fonts actually
/// referenced by /Font indices in style runs (filtering out Photoshop
/// internal fonts like AdobeInvisFont and CJK fallbacks).
fn extract_from_engine_data(data: &[u8]) -> (Vec<String>, Vec<f64>, Vec<f64>) {
    // 1. Build indexed font name list from /FontSet
    let mut font_index: Vec<String> = Vec::new();
    if let Some(font_set_pos) = find_subsequence(data, b"/FontSet") {
        let region = &data[font_set_pos..];
        let end = find_byte(region, b']').unwrap_or(region.len().min(8192));
        let region = &region[..end];

        let mut pos = 0;
        while pos < region.len() {
            if let Some(offset) = find_subsequence(&region[pos..], b"/Name") {
                let after = pos + offset + 5;
                if let Some(s) = read_paren_string(region, after) {
                    font_index.push(s);
                } else {
                    font_index.push(String::new());
                }
                pos = after + 1;
            } else {
                break;
            }
        }
    }

    // 2. Find /Font N references only in /StyleRun section (before /ResourceDict)
    //    /ResourceDict contains /StyleSheetSet with fallback font definitions
    //    that are NOT actual text fonts — exclude them.
    let font_scan_end = find_subsequence(data, b"/ResourceDict").unwrap_or(data.len());
    let mut used_indices = std::collections::BTreeSet::new();
    let mut pos = 0;
    while pos < font_scan_end {
        if let Some(offset) = find_subsequence(&data[pos..font_scan_end], b"/Font") {
            let abs = pos + offset;
            let after_key = abs + 5; // position after "/Font"
            // Ensure it's exactly "/Font" followed by whitespace, not "/FontSize" etc.
            if after_key < font_scan_end && is_ed_whitespace(data[after_key]) {
                if let Some(idx) = read_number_after_whitespace(data, after_key) {
                    used_indices.insert(idx as usize);
                }
            }
            pos = after_key + 1;
        } else {
            break;
        }
    }

    // 3. Map indices to names, filtering internal fonts
    let fonts: Vec<String> = if used_indices.is_empty() {
        // Fallback: return all non-internal fonts from FontSet
        font_index.iter()
            .filter(|f| !f.is_empty() && !is_internal_font(f))
            .cloned()
            .collect()
    } else {
        let mut seen = std::collections::HashSet::new();
        used_indices.iter()
            .filter_map(|&idx| font_index.get(idx).cloned())
            .filter(|f| !f.is_empty() && !is_internal_font(f) && seen.insert(f.clone()))
            .collect()
    };

    // 4. Find all /FontSize values (only in /StyleRun section, before /ResourceDict)
    let mut sizes_set = std::collections::BTreeSet::new();
    let mut pos = 0;
    while pos < font_scan_end {
        if let Some(offset) = find_subsequence(&data[pos..font_scan_end], b"/FontSize") {
            let after = pos + offset + 9;
            if let Some(size) = read_number_after_whitespace(data, after) {
                if size > 0.0 {
                    let rounded = (size * 10.0).round() / 10.0;
                    sizes_set.insert((rounded * 10.0) as i64);
                }
            }
            pos = after + 1;
        } else {
            break;
        }
    }

    let font_sizes: Vec<f64> = sizes_set.iter().rev().map(|&v| v as f64 / 10.0).collect();

    // 5. Find all /Tracking values (only in /StyleRun section, before /ResourceDict)
    let mut tracking_set = std::collections::BTreeSet::new();
    let mut pos = 0;
    while pos < font_scan_end {
        if let Some(offset) = find_subsequence(&data[pos..font_scan_end], b"/Tracking") {
            let after = pos + offset + 9; // "/Tracking".len() == 9
            if let Some(val) = read_number_after_whitespace(data, after) {
                // 0以外のトラッキング値のみ収集（0はデフォルト）
                if val.abs() > 0.001 {
                    let rounded = (val * 10.0).round() / 10.0;
                    tracking_set.insert((rounded * 1000.0) as i64);
                }
            }
            pos = after + 1;
        } else {
            break;
        }
    }
    let tracking: Vec<f64> = tracking_set.iter().map(|&v| v as f64 / 1000.0).collect();

    (fonts, font_sizes, tracking)
}

fn is_ed_whitespace(b: u8) -> bool {
    b == b' ' || b == b'\t' || b == b'\n' || b == b'\r'
}

/// Filter out Photoshop-internal fonts that appear in /FontSet but aren't user fonts
fn is_internal_font(name: &str) -> bool {
    name.contains("AdobeInvisFont")
}

/// Find a byte subsequence in a slice
fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Find a single byte in a slice
fn find_byte(data: &[u8], byte: u8) -> Option<usize> {
    data.iter().position(|&b| b == byte)
}

/// Read a parenthesized string from EngineData: skip whitespace, then read (...)
fn read_paren_string(data: &[u8], start: usize) -> Option<String> {
    let mut i = start;
    // Skip whitespace
    while i < data.len() && (data[i] == b' ' || data[i] == b'\t' || data[i] == b'\n' || data[i] == b'\r') {
        i += 1;
    }
    if i >= data.len() || data[i] != b'(' { return None; }
    i += 1; // skip '('
    let str_start = i;
    let mut depth = 1u32;
    while i < data.len() && depth > 0 {
        match data[i] {
            b'\\' => { i += 1; } // skip escaped char
            b'(' => depth += 1,
            b')' => depth -= 1,
            _ => {}
        }
        if depth > 0 { i += 1; }
    }
    // Handle potential UTF-16BE encoding (starts with \xfe\xff BOM)
    let raw = &data[str_start..i];
    if raw.len() >= 2 && raw[0] == 0xFE && raw[1] == 0xFF {
        // UTF-16BE: decode skipping BOM
        let utf16: Vec<u16> = raw[2..].chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        let end = utf16.iter().position(|&c| c == 0).unwrap_or(utf16.len());
        Some(String::from_utf16_lossy(&utf16[..end]))
    } else {
        // ASCII
        Some(String::from_utf8_lossy(raw).to_string())
    }
}

/// Read a number (int or float) after skipping whitespace
fn read_number_after_whitespace(data: &[u8], start: usize) -> Option<f64> {
    let mut i = start;
    while i < data.len() && (data[i] == b' ' || data[i] == b'\t' || data[i] == b'\n' || data[i] == b'\r') {
        i += 1;
    }
    let num_start = i;
    // Allow leading minus
    if i < data.len() && data[i] == b'-' { i += 1; }
    while i < data.len() && (data[i].is_ascii_digit() || data[i] == b'.') {
        i += 1;
    }
    if i == num_start { return None; }
    let s = std::str::from_utf8(&data[num_start..i]).ok()?;
    s.parse::<f64>().ok()
}

// ================================================================
// Base64 encoding (no external dependency)
// ================================================================

const B64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(data: &[u8]) -> String {
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(B64_CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(B64_CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(B64_CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(B64_CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

// ================================================================
// Helpers: binary read utilities
// ================================================================

fn read_u8<R: Read>(r: &mut R) -> Result<u8, String> {
    let mut buf = [0u8; 1];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(buf[0])
}

fn read_u16<R: Read>(r: &mut R) -> Result<u16, String> {
    let mut buf = [0u8; 2];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(u16::from_be_bytes(buf))
}

fn read_i16<R: Read>(r: &mut R) -> Result<i16, String> {
    let mut buf = [0u8; 2];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(i16::from_be_bytes(buf))
}

fn read_i32<R: Read>(r: &mut R) -> Result<i32, String> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(i32::from_be_bytes(buf))
}

fn read_u32<R: Read>(r: &mut R) -> Result<u32, String> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(u32::from_be_bytes(buf))
}

fn read_u64<R: Read>(r: &mut R) -> Result<u64, String> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(u64::from_be_bytes(buf))
}

fn read_f64<R: Read>(r: &mut R) -> Result<f64, String> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    Ok(f64::from_be_bytes(buf))
}

fn stream_pos<R: Seek>(r: &mut R) -> Result<u64, String> {
    r.stream_position().map_err(|e| format!("Stream position error: {}", e))
}

fn seek_to<R: Seek>(r: &mut R, pos: u64) -> Result<u64, String> {
    r.seek(SeekFrom::Start(pos)).map_err(|e| format!("Seek error: {}", e))
}

fn skip_section_u32<R: Read + Seek>(r: &mut R) -> Result<(), String> {
    let len = read_u32(r)? as u64;
    r.seek(SeekFrom::Current(len as i64))
        .map_err(|e| format!("Seek error: {}", e))?;
    Ok(())
}

/// Read Unicode string (length-prefixed, UTF-16BE)
fn read_unicode_string<R: Read>(r: &mut R) -> Result<String, String> {
    let char_count = read_u32(r)? as usize;
    if char_count == 0 {
        return Ok(String::new());
    }
    let mut buf = vec![0u8; char_count * 2];
    r.read_exact(&mut buf).map_err(|e| format!("Unicode read error: {}", e))?;

    let utf16: Vec<u16> = buf
        .chunks_exact(2)
        .map(|c| u16::from_be_bytes([c[0], c[1]]))
        .collect();

    // Trim trailing nulls
    let end = utf16.iter().position(|&c| c == 0).unwrap_or(utf16.len());
    String::from_utf16(&utf16[..end]).map_err(|e| format!("UTF-16 decode error: {}", e))
}

// ================================================================
// Mapping tables
// ================================================================

fn map_color_mode(mode: u16) -> String {
    match mode {
        0 => "Bitmap",
        1 => "Grayscale",
        2 => "Indexed",
        3 => "RGB",
        4 => "CMYK",
        7 => "Multichannel",
        8 => "Duotone",
        9 => "Lab",
        _ => "RGB",
    }
    .to_string()
}

fn blend_mode_to_string(key: &[u8; 4]) -> String {
    match key {
        b"norm" => "normal",
        b"diss" => "dissolve",
        b"dark" => "darken",
        b"mul " => "multiply",
        b"idiv" => "colorBurn",
        b"lbrn" => "linearBurn",
        b"dkCl" => "darkerColor",
        b"lite" => "lighten",
        b"scrn" => "screen",
        b"div " => "colorDodge",
        b"lddg" => "linearDodge",
        b"lgCl" => "lighterColor",
        b"over" => "overlay",
        b"sLit" => "softLight",
        b"hLit" => "hardLight",
        b"vLit" => "vividLight",
        b"lLit" => "linearLight",
        b"pLit" => "pinLight",
        b"hMix" => "hardMix",
        b"diff" => "difference",
        b"smud" => "exclusion",
        b"fsub" => "subtract",
        b"fdiv" => "divide",
        b"hue " => "hue",
        b"sat " => "saturation",
        b"colr" => "color",
        b"lum " => "luminosity",
        b"pass" => "passThrough",
        _ => "normal",
    }
    .to_string()
}

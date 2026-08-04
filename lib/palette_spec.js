var PALETTE_SIZE = 256;

/*
 * Parses a compact palette spec into a PALETTE_SIZE * 4 RGBA buffer, ready to hand
 * to `new mapnik.Palette(buf, 'rgba')`. Kept free of the mapnik binding so it can be
 * unit tested without the native module.
 *
 * A spec is a ';'-separated list of entries describing PALETTE_SIZE slots:
 *
 *   entry  := colour | colour '-' colour
 *   colour := RRGGBB | RRGGBBAA          (alpha defaults to ff)
 *
 * A bare colour occupies one slot. A `from-to` entry is a ramp, interpolated
 * linearly in RGBA and inclusive of both endpoints. Slots not taken by bare
 * colours are shared out among the ramps, earlier ramps taking the remainder
 * when the division is uneven.
 *
 * So "00000000;010101-ffffff" is a transparent slot 0 followed by a 255-step
 * ramp -- i.e. grays 1..255 -- which is the lossless encoding for a grayscale
 * DEM whose 256 grays plus transparent nodata would otherwise need 257 slots.
 *
 * Passing an explicit palette is what makes PNG8 output deterministic: mapnik
 * otherwise quantises each tile independently, so neighbouring tiles merge
 * different colours and a continuous gradient bands at tile boundaries.
 */
module.exports = paletteBufferForSpec;
function paletteBufferForSpec(spec) {
    if (typeof spec !== 'string' || !spec.length) {
        throw new Error('palette spec must be a non-empty string');
    }

    var entries = spec.split(';').map(parseEntry);
    var ramps = entries.filter(function(e) { return e.isRamp; });
    var fixedSlots = entries.length - ramps.length;

    if (fixedSlots > PALETTE_SIZE) {
        throw new Error('palette spec describes more than ' + PALETTE_SIZE + ' slots');
    }
    if (!ramps.length && fixedSlots !== PALETTE_SIZE) {
        throw new Error('palette spec with no ramps must describe exactly ' +
                        PALETTE_SIZE + ' slots, got ' + fixedSlots);
    }

    // Share the leftover slots among the ramps; earlier ramps take the remainder.
    var perRamp = 0, remainder = 0;
    if (ramps.length) {
        var spare = PALETTE_SIZE - fixedSlots;
        if (spare < ramps.length) {
            throw new Error('palette spec has ' + ramps.length + ' ramps but only ' +
                            spare + ' slots left for them');
        }
        perRamp = Math.floor(spare / ramps.length);
        remainder = spare % ramps.length;
    }

    var out = Buffer.alloc(PALETTE_SIZE * 4);
    var slot = 0;
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isRamp) {
            writeColour(out, slot++, entry.from);
            continue;
        }
        var steps = perRamp + (remainder-- > 0 ? 1 : 0);
        for (var s = 0; s < steps; s++) {
            // t spans [0, 1] inclusive so both endpoints land exactly; a 1-slot
            // ramp degenerates to its start colour.
            var t = (steps === 1) ? 0 : (s / (steps - 1));
            writeColour(out, slot++, interpolate(entry.from, entry.to, t));
        }
    }

    return out;
}

function parseEntry(text) {
    var parts = text.split('-');
    if (parts.length === 1) {
        return { isRamp: false, from: parseColour(parts[0]) };
    }
    if (parts.length === 2) {
        return { isRamp: true, from: parseColour(parts[0]), to: parseColour(parts[1]) };
    }
    throw new Error('bad palette entry: ' + JSON.stringify(text));
}

function parseColour(text) {
    var hex = text.trim();
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
        throw new Error('bad palette colour: ' + JSON.stringify(text));
    }
    return [
        parseInt(hex.substr(0, 2), 16),
        parseInt(hex.substr(2, 2), 16),
        parseInt(hex.substr(4, 2), 16),
        (hex.length === 8) ? parseInt(hex.substr(6, 2), 16) : 255
    ];
}

function interpolate(from, to, t) {
    var out = new Array(4);
    for (var i = 0; i < 4; i++) {
        out[i] = Math.round(from[i] + (to[i] - from[i]) * t);
    }
    return out;
}

function writeColour(buf, slot, rgba) {
    var o = slot * 4;
    buf[o] = rgba[0];
    buf[o + 1] = rgba[1];
    buf[o + 2] = rgba[2];
    buf[o + 3] = rgba[3];
}

module.exports.PALETTE_SIZE = PALETTE_SIZE;
